# Monster Game

48×48 の唯一無二モンスターを生成し、育成して、ユーザー同士で対戦するゲーム。
生成・育成・戦闘はすべて **決定論的**(同じ入力→同じ結果)で、LLMは使わない。

- **図鑑 / 育成 / 対戦** を React SPA(Cloudflare Pages)
- API は Cloudflare Workers、認証は Google OAuth、データは D1(SQLite)+ KV(セッション)+ Durable Object(マッチメイキング)
- 生成ロジックは `packages/core/engine.js` に集約し、**ブラウザとWorkerで同一に動く**
- PvP は決定論なので **サーバーが勝敗を確定し、両者が同じリプレイを再生**(リアルタイム通信不要・チート耐性)

詳細は [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 構成

```
monster-game/
├─ packages/core/     共有エンジン(生成・ステータス・アビリティ・育成・戦闘) + 描画 + テスト
├─ worker/            Cloudflare Worker(API + Google OAuth + D1/KV/DO)
└─ web/               React SPA(Vite)。図鑑/育成/対戦
```

## セットアップ

前提: Node 18+、Cloudflareアカウント、`npm i -g wrangler`、Google OAuthクライアント。

```bash
npm install                     # ルートでワークスペース一括

# 1) コアのテスト(ネット不要)
npm test

# 2) Cloudflareリソース作成
cd worker
wrangler d1 create monster-game-db          # 出力の database_id を wrangler.toml に貼る
wrangler kv namespace create SESSIONS       # 出力の id を wrangler.toml に貼る
npm run db:init                             # スキーマ適用(ローカル)

# 3) Google OAuth
#   - Google Cloud Console で OAuth 2.0 クライアントID(Webアプリ)を作成
#   - 承認済みリダイレクトURI に http://localhost:8787/auth/google/callback を追加
#   - worker/.dev.vars に GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を記入(.dev.vars.example 参照)

# 4) 開発サーバー(2つのターミナル)
npm run dev:api      # Worker  → http://localhost:8787
npm run dev:web      # SPA     → http://localhost:5173  (/api,/auth はWorkerへproxy)
```

## デプロイ(概要)

```bash
cd worker && wrangler deploy                # API
cd ../web && npm run build                  # dist/ を Cloudflare Pages へ
```
本番は wrangler.toml の OAUTH_REDIRECT_URI / WEB_ORIGIN を本番URLに更新し、
Google側の承認済みリダイレクトURIも本番に追加、シークレットは `wrangler secret put` で登録する。

## 元になった試作(このリポの外)

`monster_gen_prototype.html` / `monster_battle.html` / `monster_trainer.html` の3つの単一ファイル試作を
`packages/core/engine.js` に統合した。挙動は同一(テストで担保)。
