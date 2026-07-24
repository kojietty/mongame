# アーキテクチャ設計書 — Monster Game

Claude Code で本開発を始めるための設計と手順。試作(単一HTML 3本)で検証済みの決定論エンジンを核に、Cloudflare 上でユーザー登録・育成・PvP を成立させる。

---

## 1. 設計の背骨:すべて決定論

生成・育成・戦闘はすべて「個体コード + シード付き乱数」から一意に決まる。ここから重要な性質が導かれる。

- **保存が極小**: 画像もステータスも保存しない。DBに持つのは「個体コード」と「育成state(小さなJSON)」だけ。表示に必要な値はすべて `engine.js` が再計算する。
- **サーバー権威PvPがnetcode無しで成立**: 対戦は入力(両者のコード+育成)が同じなら結果も同じ。サーバーが `battleRun` を1回実行して勝敗と全リプレイ(events)を確定し、両クライアントは同じeventsを演出再生するだけ。リアルタイム同期が要らない。
- **チート耐性**: ステータスも戦闘結果もサーバーが計算する。クライアントが送るのは「どのモンスターで」「どの育成メニューを押したか」だけ。数値を詐称できない。

この3点が、個人開発でオンライン対戦まで到達可能にしている最大の理由。

---

## 2. 全体構成

```
┌────────────┐        ┌──────────────────────────┐
│  React SPA │  HTTPS │   Cloudflare Worker (API)  │
│  (Pages)   │ ─────▶ │  - /auth/google/*  OAuth   │
│  図鑑/育成 │  Cookie│  - /monsters/*     CRUD     │
│  /対戦     │ ◀───── │  - /battle/*       PvP      │
└────────────┘        │        │            │       │
                      │        ▼            ▼       │
                      │   ┌────────┐  ┌────────────┐│
                      │   │  D1    │  │ Durable Obj││
                      │   │(SQLite)│  │ matchmaking││
                      │   └────────┘  └────────────┘│
                      │   ┌────────┐                │
                      │   │  KV    │ session        │
                      │   └────────┘                │
                      └──────────────────────────┘
        共有: packages/core/engine.js(ブラウザ・Worker両方で同一実行)
```

- **web/**: React SPA。`engine.js` を直接importして図鑑の見た目やステータスをクライアント計算(表示のみ)。書き込み系(召喚・育成・対戦)はAPIを叩く。
- **worker/**: 薄いルーター + OAuth + DB。ドメイン計算は `engine.js` に委譲。
- **packages/core/**: 唯一の真実。生成・育成・戦闘の全ロジックとテスト。

---

## 3. データモデル(D1)

`worker/schema.sql` 参照。要点のみ。

- **users**: `google_sub`(GoogleのサブジェクトID, unique), email, name
- **monsters**: `user_id`, `code`(個体コード=シード), `train_json`(育成state)
- **battles**: `p1_user/p2_user`, `p1_code/p2_code`, `result_json`(events+winner)

個体コードの形式: `playerId|word|nonce`。プレイヤーIDで他人と絶対に被らず、nonceで同じ入力でも毎回別個体。この文字列だけで見た目・ステータス・才能グレードが再現される。

---

## 4. 認証(Google OAuth 2.0)

Authorization Code フロー(`worker/src/auth.js`)。

1. `/auth/google/start` → state発行(CSRF用に短命Cookie)→ Google同意画面へ302
2. Google → `/auth/google/callback?code&state` に戻る
3. state照合 → `code` をトークンに交換 → `id_token`(JWT)から `sub/email/name`
4. users をupsert → セッションIDを KV に保存(30日)→ HttpOnly/Secure Cookie発行 → SPAへ302

以降のAPIは `requireUser`(Cookie→KV)でユーザー解決。未ログインは401。

**本番の追加推奨**: id_tokenの署名検証(GoogleのJWKSで検証)、stateのKV保存、リフレッシュ不要なら `access_type=online` のままでOK。

セットアップ: Google Cloud Console でOAuthクライアント(Webアプリ)を作成し、承認済みリダイレクトURIに Worker の `/auth/google/callback`(dev: `http://localhost:8787/...`、本番: APIドメイン)を登録。`GOOGLE_CLIENT_ID/SECRET` は `wrangler secret put`。

---

## 5. API エンドポイント

| Method | Path | 説明 |
|---|---|---|
| GET | `/auth/google/start` | OAuth開始 |
| GET | `/auth/google/callback` | コールバック(ユーザー作成+セッション) |
| POST | `/auth/logout` | セッション破棄 |
| GET | `/me` | ログイン中ユーザー |
| GET | `/monsters` | 所持一覧 |
| POST | `/monsters/summon` | 召喚(個体コード発行)。body: `{word?}` |
| POST | `/monsters/:id/train` | 育成1回。body: `{menuId}`。**サーバーが `applyTrain` 実行** |
| POST | `/battle/queue` | マッチメイキング登録。body: `{monsterId}` |
| GET | `/battle/:id` | 対戦結果(events)取得 |

育成も対戦もサーバー計算。クライアントの計算結果は一切信用しない(表示の先読みには使ってよい)。

---

## 6. PvP フロー(非同期・決定論)

1. プレイヤーA が `/battle/queue` にモンスターを登録 → Durable Object `MatchmakingQueue` が待機
2. プレイヤーB が登録 → 2人揃う → サーバーで `resolveBattle(A, B)` を実行し勝敗+events確定
3. `battles` に保存し、両者へ `battleId` を返す
4. 各クライアントは `/battle/:id` でeventsを取得し、`SpriteAnim` で攻撃/被弾/撃破を演出再生

**待機中の通知**は最小実装では「B側は即マッチ、A側はポーリング」で足りる。本番は次のいずれか: Durable ObjectのWebSocketでpush / 定期ポーリング / タイムアウトでBot戦にフォールバック。

**将来のリアルタイム化**(手動コマンド選択を入れる場合): Durable Object を「対戦ルーム」に拡張し、両者のWebSocketを保持、ターンごとに入力を集約 → engine の1ステップを適用 → 差分をbroadcast。エンジンが決定論なので、ルームは入力列だけ保持すれば状態を再現できる。

---

## 7. 対戦バランスの現状(調整ノブ)

- 歪み特性は「強力な上振れ + 明確な代償」の諸刃。属性矛盾持ちは先手97.6% / 後手67.7%(速度依存の大きなスイング)。
- 総合ではまだ強め(約84%)。締めたい場合のノブ:
  - `genParadox` の `offType.selfHurt`(被ダメ倍率)
  - `condMult` の非条件時ペナルティ(現状 ×0.5)
  - `useless` の不発ペナルティ(現状 ×0.6)
  - ステータス予算 `budget`、HP係数(`makeFighter` の `*3.2+40`)
- レートマッチ(近い戦績どうし)を入れると理不尽の体感が和らぐ。

---

## 8. Claude Code での着手手順(マイルストーン)

**M0 — 足場**
- `npm install`、`npm test`(コア回帰テストが通ることを確認)
- `wrangler d1 create` / `kv namespace create` → `wrangler.toml` にID記入 → `npm run db:init`

**M1 — 認証**
- Google OAuthクライアント作成 → `.dev.vars` 設定 → `dev:api`+`dev:web` でログイン往復を確認
- `GET /me` が返ることを確認

**M2 — 図鑑 & 召喚**
- `/monsters/summon` → `/monsters` → SPAでスプライト+ステータス表示(`engine.js` のクライアント計算)

**M3 — 育成**
- `/monsters/:id/train` をサーバー計算に統一 → Trainer UI で努力値/歪み/後天特性が反映されるか

**M4 — PvP(非同期)**
- `MatchmakingQueue` DO で2人マッチ → `resolveBattle` → `/battle/:id` 取得 → Arena でリプレイ再生
- 同一 battleId を2ブラウザで開くと**完全に同じ**リプレイになることを確認(決定論の検証)

**M5 — デプロイ**
- Worker を `wrangler deploy`、web を Pages へ。OAuthリダイレクト/オリジンを本番URLに更新

**M6以降(任意)**
- レートマッチ、ダンジョン(PvE)、協力ボス戦、トレード(個体コードの受け渡し)、リアルタイム対戦、バランス調整パス

---

## 9. テスト方針

- **コア**: `packages/core/test.js`(決定論・無限ループ無し・育成不変条件・serialize往復・resolveBattle)。CIで必ず走らせる。
- **回帰**: バランス調整のたびに、属性矛盾勝率・平均ターン数・歪み発現率をスクリプトで計測して大崩れを検知。
- **PvP整合**: 同じ (codeA, trainA, codeB, trainB) から常に同一 events になることをテスト化。

---

## 10. 注意点 / 落とし穴

- **決定論を壊さない**: エンジン内で `Math.random()` を使ってよいのは「新しいnonce生成」など保存対象を作る瞬間だけ。生成・戦闘・育成計算の中では必ずシード付き乱数。浮動小数の順序も結果に効くので、既存の計算順を変えない。
- **`nodejs_compat`**: Worker で `Buffer`(serialize)を使うため `compatibility_flags = ["nodejs_compat"]` が必要(設定済み)。
- **Cookie**: SPAとAPIが別オリジンなら `SameSite`/CORS/credentials に注意。dev は Vite proxy で同一オリジン化している。
- **id_token署名検証**: 最小実装では未検証。本番前に必ず追加。
