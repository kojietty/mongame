/**
 * Cloudflare Worker — Game API
 * ルーティングのみ薄く。ドメインロジックは @monster-game/core に集約。
 *
 * エンドポイント:
 *   GET  /auth/google/start      → GoogleのOAuth同意画面へリダイレクト
 *   GET  /auth/google/callback   → codeを交換しユーザー作成+セッションCookie発行
 *   POST /auth/logout
 *   GET  /me                     → ログイン中ユーザー
 *   GET  /monsters               → 所持モンスター一覧
 *   POST /monsters/summon        → 新規モンスター召喚(個体コード発行)
 *   POST /monsters/:id/train     → 育成メニュー適用(サーバーで決定論計算)
 *   POST /battle/queue           → マッチメイキング登録(Durable Objectへ)
 *   GET  /battle/:id             → 対戦結果(events)取得
 *
 * PvPは決定論なのでサーバーが battleRun を権威実行し、両者は同じevents再生。
 */
import { newNonce, buildCode, newTrain, applyTrain, resolveBattle, resolveChallenge, challengeRewards, MENUS } from "@monster-game/core";
import { googleStart, googleCallback, requireUser, clearSession } from "./auth.js";
import { q, one, run } from "./db.js";
import { jstDay, ensureWallet } from "./util.js";

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    try {
      // --- CORS(SPAが別オリジンの場合) ---
      if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), env);

      // --- 認証 ---
      if (p === "/auth/google/start") return googleStart(env, url);
      if (p === "/auth/google/callback") return googleCallback(request, env, url);
      if (p === "/auth/logout") return clearSession(request, env);

      // --- 静的SPA配信(同一オリジン) ---
      // 実ファイル(index.html, /assets/*)はStatic Assetsが自動配信するため、
      // ここに来るのはAPIパスかクライアントルート(/train等)。後者はSPAシェルを返す。
      // run_worker_first=true なので全リクエストがここを通る。API以外のGETは
      // 静的アセットを配信し、実ファイルが無ければSPAシェル(index.html)を返す。
      const isApi = p === "/me" || ["/me/", "/monsters", "/battle", "/tickets", "/challenge"].some(x => p.startsWith(x));
      if (!isApi && request.method === "GET" && env.ASSETS) {
        const res = await env.ASSETS.fetch(request);
        if (res.status !== 404) return res;
        return env.ASSETS.fetch(new URL("/", url)); // クライアントルート → index.html
      }

      // --- 以降は要ログイン ---
      const user = await requireUser(request, env);
      if (!user) return json({ error: "unauthorized" }, 401);
      await ensureWallet(env, user.id); // 初回20連ぶんを確保
      const day = jstDay();

      if (p === "/me") {
        const w = await one(env, "SELECT tickets FROM wallets WHERE user_id = ?", [user.id]);
        const claim = await one(env, "SELECT 1 AS c FROM daily_claims WHERE user_id = ? AND day = ?", [user.id, day]);
        const tt = await one(env, "SELECT amount FROM train_tickets WHERE user_id = ?", [user.id]);
        const prof = await one(env, "SELECT display_name FROM user_profiles WHERE user_id = ?", [user.id]);
        return cors(json({ user, displayName: prof && prof.display_name ? prof.display_name : null,
          tickets: w ? w.tickets : 0, trainTickets: tt ? tt.amount : 0, dailyClaimed: !!claim, day }), env);
      }

      // 公開表示名(ニックネーム)の設定。Googleアカウント名は公開しない。
      if (p === "/me/name" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const name = (typeof body.name === "string" ? body.name : "").trim().slice(0, 16);
        if (!name) return cors(json({ error: "empty" }, 400), env);
        await run(env,
          `INSERT INTO user_profiles (user_id, display_name) VALUES (?, ?)
           ON CONFLICT(user_id) DO UPDATE SET display_name = excluded.display_name`, [user.id, name]);
        return cors(json({ displayName: name }), env);
      }

      // デイリー無料チケット(1日1枚)。二重付与はbatchのPK違反ロールバックで構造的に防ぐ。
      if (p === "/tickets/claim" && request.method === "POST") {
        let claimed = true;
        try {
          await env.DB.batch([
            env.DB.prepare("INSERT INTO daily_claims (user_id, day) VALUES (?, ?)").bind(user.id, day),
            env.DB.prepare("UPDATE wallets SET tickets = tickets + 1 WHERE user_id = ?").bind(user.id),
          ]);
        } catch { claimed = false; } // 既に受取済み(PK違反)
        const w = await one(env, "SELECT tickets FROM wallets WHERE user_id = ?", [user.id]);
        return cors(json({ claimed, tickets: w ? w.tickets : 0 }), env);
      }

      if (p === "/monsters" && request.method === "GET") {
        // 本日の育成回数(train_count)とメタ(お気に入り/ニックネーム)を LEFT JOIN で同梱
        const rows = await q(env,
          `SELECT m.id, m.code, m.train_json, m.created_at, COALESCE(t.count, 0) AS train_count,
                  COALESCE(mm.favorite, 0) AS favorite, mm.nickname
           FROM monsters m
           LEFT JOIN train_limits t ON t.monster_id = m.id AND t.day = ?
           LEFT JOIN monster_meta mm ON mm.monster_id = m.id
           WHERE m.user_id = ? ORDER BY m.created_at DESC`, [day, user.id]);
        return cors(json({ monsters: rows.map(shapeMonster) }), env);
      }

      // お気に入り登録/解除
      const mFav = p.match(/^\/monsters\/(\d+)\/favorite$/);
      if (mFav && request.method === "POST") {
        const id = Number(mFav[1]);
        const body = await request.json().catch(() => ({}));
        const own = await one(env, "SELECT id FROM monsters WHERE id = ? AND user_id = ?", [id, user.id]);
        if (!own) return cors(json({ error: "not found" }, 404), env);
        const fav = body.favorite ? 1 : 0;
        await run(env,
          `INSERT INTO monster_meta (monster_id, favorite) VALUES (?, ?)
           ON CONFLICT(monster_id) DO UPDATE SET favorite = excluded.favorite`, [id, fav]);
        return cors(json({ favorite: !!fav }), env);
      }

      // 名前変更(ニックネーム)。空文字で解除。表示専用でcode/生成には無関係。
      const mRen = p.match(/^\/monsters\/(\d+)\/rename$/);
      if (mRen && request.method === "POST") {
        const id = Number(mRen[1]);
        const body = await request.json().catch(() => ({}));
        const own = await one(env, "SELECT id FROM monsters WHERE id = ? AND user_id = ?", [id, user.id]);
        if (!own) return cors(json({ error: "not found" }, 404), env);
        const nick = (typeof body.name === "string" ? body.name : "").trim().slice(0, 12) || null;
        await run(env,
          `INSERT INTO monster_meta (monster_id, nickname) VALUES (?, ?)
           ON CONFLICT(monster_id) DO UPDATE SET nickname = excluded.nickname`, [id, nick]);
        return cors(json({ nickname: nick }), env);
      }

      // ガチャ召喚。count枚のチケットを消費してcount体を発行(消費とINSERTは1トランザクション)。
      if (p === "/monsters/summon" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const count = body.count === 10 ? 10 : body.count === 20 ? 20 : body.count === 1 ? 1 : null;
        if (!count) return cors(json({ error: "invalid count" }, 400), env);
        const word = (body.word || "").slice(0, 20);
        const now = Date.now();
        const codes = Array.from({ length: count }, () => buildCode(user.id, word, newNonce()));
        // batch先頭で残高チェック付き消費(足りなければ changes=0 でロールバック扱い)
        const stmts = [
          env.DB.prepare("UPDATE wallets SET tickets = tickets - ? WHERE user_id = ? AND tickets >= ?").bind(count, user.id, count),
          ...codes.map(code =>
            env.DB.prepare("INSERT INTO monsters (user_id, code, train_json, created_at) VALUES (?, ?, ?, ?)")
              .bind(user.id, code, JSON.stringify(newTrain(code)), now)),
        ];
        const results = await env.DB.batch(stmts);
        if (results[0].meta.changes === 0) {
          // 消費が通らなかった=残高不足。batchはトランザクションなのでINSERTも入っていない。
          const w = await one(env, "SELECT tickets FROM wallets WHERE user_id = ?", [user.id]);
          return cors(json({ error: "tickets_insufficient", tickets: w ? w.tickets : 0 }, 402), env);
        }
        const monsters = codes.map((code, i) => ({ id: results[i + 1].meta.last_row_id, code }));
        const w = await one(env, "SELECT tickets FROM wallets WHERE user_id = ?", [user.id]);
        return cors(json({ monsters, tickets: w ? w.tickets : 0 }), env);
      }

      const mTrain = p.match(/^\/monsters\/(\d+)\/train$/);
      if (mTrain && request.method === "POST") {
        const id = Number(mTrain[1]);
        const body = await request.json().catch(() => ({}));
        // 入力検証(クライアントを信用しない): 未知のmenuIdは弾く
        if (!MENUS.some(m => m.id === body.menuId)) return cors(json({ error: "invalid menuId" }, 400), env);
        const row = await one(env, "SELECT * FROM monsters WHERE id = ? AND user_id = ?", [id, user.id]);
        if (!row) return cors(json({ error: "not found" }, 404), env);
        // 1日5回制限(モンスターあたり)。UPSERTで count<5 のときだけ +1(アトミック)。
        const g = await run(env,
          `INSERT INTO train_limits (monster_id, day, count) VALUES (?, ?, 1)
           ON CONFLICT(monster_id, day) DO UPDATE SET count = count + 1 WHERE count < 5`, [id, day]);
        // 上限到達時は育成チケットを1枚自動消費して続行(残0なら429)
        let usedTicket = false;
        if (g.meta.changes === 0) {
          const spend = await run(env, "UPDATE train_tickets SET amount = amount - 1 WHERE user_id = ? AND amount >= 1", [user.id]);
          if (spend.meta.changes === 0) return cors(json({ error: "train_limit", count: 5 }, 429), env);
          usedTicket = true;
          // チケット使用時は上限を無視して回数を進める(表示用)
          await run(env, "UPDATE train_limits SET count = count + 1 WHERE monster_id = ? AND day = ?", [id, day]);
        }
        const state = JSON.parse(row.train_json);
        // サーバー側で決定論計算(クライアントの結果は信用しない)
        const events = applyTrain(state, body.menuId);
        // train_jsonはCAS更新(並行更新のlost-update防止)。競合したら回数/チケットを戻して409。
        const upd = await run(env, "UPDATE monsters SET train_json = ? WHERE id = ? AND train_json = ?",
          [JSON.stringify(state), id, row.train_json]);
        if (upd.meta.changes === 0) {
          await run(env, "UPDATE train_limits SET count = count - 1 WHERE monster_id = ? AND day = ?", [id, day]);
          if (usedTicket) await run(env, "UPDATE train_tickets SET amount = amount + 1 WHERE user_id = ?", [user.id]);
          return cors(json({ error: "conflict" }, 409), env);
        }
        const cnt = await one(env, "SELECT count FROM train_limits WHERE monster_id = ? AND day = ?", [id, day]);
        const tt = await one(env, "SELECT amount FROM train_tickets WHERE user_id = ?", [user.id]);
        return cors(json({ state, events, trainCount: cnt ? cnt.count : 1, trainDay: day, usedTicket, trainTickets: tt ? tt.amount : 0 }), env);
      }

      // ===== チャレンジ(PvEエンドレス) =====
      if (p === "/challenge/active" && request.method === "GET") {
        const run0 = await one(env, "SELECT * FROM challenge_runs WHERE user_id = ? AND status = 'active'", [user.id]);
        return cors(json({ run: run0 ? shapeRun(run0) : null }), env);
      }

      if (p === "/challenge/leaderboard" && request.method === "GET") {
        // user毎のベスト行を ROW_NUMBER で1つに絞る(GROUP BY bare-column に依存しない)
        // 公開名は user_profiles.display_name のみ。未設定は 'プレイヤー<id>' で匿名化(Google名は出さない)。
        const top = await q(env,
          `SELECT r.user_id, COALESCE(pf.display_name, 'プレイヤー' || r.user_id) AS name, r.code, r.score FROM (
             SELECT *, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY score DESC, updated_at ASC) AS rn
             FROM challenge_runs WHERE status = 'dead'
           ) r LEFT JOIN user_profiles pf ON pf.user_id = r.user_id WHERE r.rn = 1 ORDER BY r.score DESC LIMIT 20`, []);
        const mine = await one(env, "SELECT MAX(score) AS best FROM challenge_runs WHERE user_id = ? AND status = 'dead'", [user.id]);
        return cors(json({ top, mine: { best: mine && mine.best != null ? mine.best : 0 } }), env);
      }

      if (p === "/challenge/start" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        // 既存アクティブランがあればそれを返す(resume)
        const active = await one(env, "SELECT * FROM challenge_runs WHERE user_id = ? AND status = 'active'", [user.id]);
        if (active) return cors(json({ run: shapeRun(active) }), env);
        const mon = await one(env, "SELECT * FROM monsters WHERE id = ? AND user_id = ?", [body.monsterId, user.id]);
        if (!mon) return cors(json({ error: "monster not found" }, 404), env);
        const id = crypto.randomUUID().slice(0, 12);
        const seed = crypto.randomUUID().slice(0, 8);
        const now = Date.now();
        try {
          await run(env,
            `INSERT INTO challenge_runs (id, user_id, monster_id, code, train_json, seed, stage, score, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, 0, 'active', ?, ?)`,
            [id, user.id, mon.id, mon.code, mon.train_json, seed, now, now]);
        } catch {
          // 部分ユニークインデックス衝突(競合で同時startした) → 既存を返す
          const ex = await one(env, "SELECT * FROM challenge_runs WHERE user_id = ? AND status = 'active'", [user.id]);
          if (ex) return cors(json({ run: shapeRun(ex) }), env);
          throw new Error("start failed");
        }
        return cors(json({ run: { id, stage: 1, score: 0, seed, code: mon.code } }), env);
      }

      if (p === "/challenge/fight" && request.method === "POST") {
        const runRow = await one(env, "SELECT * FROM challenge_runs WHERE user_id = ? AND status = 'active'", [user.id]);
        if (!runRow) return cors(json({ error: "no active run" }, 404), env);
        const result = resolveChallenge({ code: runRow.code, train: JSON.parse(runRow.train_json) }, runRow.seed, runRow.stage);
        const now = Date.now();
        if (result.win) {
          // stageをCAS条件に(二重送信でも1回ぶんだけ進む)
          const upd = await run(env,
            "UPDATE challenge_runs SET stage = stage + 1, score = score + 1, updated_at = ? WHERE id = ? AND status = 'active' AND stage = ?",
            [now, runRow.id, runRow.stage]);
          if (upd.meta.changes === 0) return cors(json({ error: "conflict" }, 409), env);
          return cors(json({ win: true, events: result.events, stage: runRow.stage + 1, score: runRow.score + 1, enemyCode: result.enemyCode }), env);
        } else {
          // 敗北 → ランを確定(=リーダーボード登録)。報酬は没収(付与しない)が演出用に返す。
          await run(env, "UPDATE challenge_runs SET status = 'dead', updated_at = ? WHERE id = ? AND status = 'active'", [now, runRow.id]);
          const lost = challengeRewards(runRow.seed, runRow.score);
          return cors(json({ win: false, events: result.events, stage: runRow.stage, score: runRow.score, enemyCode: result.enemyCode, lostRewards: lost }), env);
        }
      }

      if (p === "/challenge/retire" && request.method === "POST") {
        const runRow = await one(env, "SELECT * FROM challenge_runs WHERE user_id = ? AND status = 'active'", [user.id]);
        if (!runRow) return cors(json({ error: "no active run" }, 404), env);
        // 撤退でのみ報酬確定。status='active'→'dead' のCASで二重払いを構造的に防止。
        const fin = await run(env, "UPDATE challenge_runs SET status = 'dead', updated_at = ? WHERE id = ? AND status = 'active'", [Date.now(), runRow.id]);
        if (fin.meta.changes === 0) return cors(json({ error: "conflict" }, 409), env);
        const rewards = challengeRewards(runRow.seed, runRow.score);
        const now = Date.now();
        const stmts = [
          env.DB.prepare("INSERT OR IGNORE INTO wallets (user_id) VALUES (?)").bind(user.id),
          env.DB.prepare("UPDATE wallets SET tickets = tickets + ? WHERE user_id = ?").bind(rewards.gacha, user.id),
          env.DB.prepare("INSERT OR IGNORE INTO train_tickets (user_id, amount) VALUES (?, 0)").bind(user.id),
          env.DB.prepare("UPDATE train_tickets SET amount = amount + ? WHERE user_id = ?").bind(rewards.train, user.id),
          // 捕獲した個体を所持モンスターに追加(素の個体 = ステージ強化なし)
          ...rewards.captures.map(c =>
            env.DB.prepare("INSERT INTO monsters (user_id, code, train_json, created_at) VALUES (?, ?, ?, ?)")
              .bind(user.id, c.code, JSON.stringify(newTrain(c.code)), now)),
        ];
        const results = await env.DB.batch(stmts);
        // 捕獲個体のidを結果から拾う(captures は wallets/train_tickets の4文の後)
        const captures = rewards.captures.map((c, i) => ({ stage: c.stage, code: c.code, id: results[4 + i].meta.last_row_id }));
        return cors(json({ score: runRow.score, rewards: { gacha: rewards.gacha, train: rewards.train, captures } }), env);
      }

      const mmStub = () => env.MATCHMAKING.get(env.MATCHMAKING.idFromName("global"));
      const mmCall = (b) => mmStub().fetch("https://do/mm", { method: "POST", body: JSON.stringify(b) });

      if (p === "/battle/queue" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const row = await one(env, "SELECT * FROM monsters WHERE id = ? AND user_id = ?", [body.monsterId, user.id]);
        if (!row) return cors(json({ error: "monster not found" }, 404), env);
        // マッチメイキングは Durable Object に委譲(下の MatchmakingQueue)
        return cors(await mmCall({ action: "enqueue", userId: user.id, monsterId: row.id, code: row.code, train: JSON.parse(row.train_json) }), env);
      }

      // 待機中プレイヤーがマッチ成立を確認するポーリング
      if (p === "/battle/poll" && request.method === "POST") {
        return cors(await mmCall({ action: "poll", userId: user.id }), env);
      }

      // マッチング待機のキャンセル(既にマッチしていたら matched を返す)
      if (p === "/battle/cancel" && request.method === "POST") {
        return cors(await mmCall({ action: "cancel", userId: user.id }), env);
      }

      const mBattle = p.match(/^\/battle\/([\w-]+)$/);
      if (mBattle && request.method === "GET") {
        const row = await one(env, "SELECT * FROM battles WHERE id = ?", [mBattle[1]]);
        if (!row) return cors(json({ error: "not found" }, 404), env);
        // L=p1_code, R=p2_code(DOが resolveBattle(a,b) を a=p1,b=p2 で呼ぶため)
        return cors(json({ battle: { id: row.id, leftCode: row.p1_code, rightCode: row.p2_code, result: JSON.parse(row.result_json) } }), env);
      }

      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
};

function shapeMonster(r) {
  return {
    id: r.id, code: r.code, train: JSON.parse(r.train_json), created_at: r.created_at,
    trainCount: r.train_count ?? 0, favorite: !!r.favorite, nickname: r.nickname || null,
  };
}
function shapeRun(r) {
  return { id: r.id, stage: r.stage, score: r.score, seed: r.seed, code: r.code, monsterId: r.monster_id };
}
function cors(res, env) {
  const h = new Headers(res.headers);
  h.set("access-control-allow-origin", env.WEB_ORIGIN || "*");
  h.set("access-control-allow-credentials", "true");
  h.set("access-control-allow-headers", "content-type");
  h.set("access-control-allow-methods", "GET,POST,OPTIONS");
  return new Response(res.body, { status: res.status, headers: h });
}

/**
 * Durable Object: グローバルなマッチメイキングキュー。
 * 2人揃ったらサーバー権威で resolveBattle し、battles に保存、両者にbattleIdを返す。
 * 待機プレイヤーは storage に永続化する(DOはアイドルでエビクトされ得るため、
 * メモリ保持だと非同期=時間差のマッチで待機が消える)。DOのfetchは直列実行される
 * ので get→put の間に競合は起きない。
 * （最小実装。本番は待機タイムアウト・レート帯・再接続などを足す）
 */
export class MatchmakingQueue {
  constructor(state, env) { this.state = state; this.env = env; }
  reply(o) { return new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } }); }

  async fetch(request) {
    const body = await request.json();
    const action = body.action || "enqueue";
    const st = this.state.storage;

    // 待機側がマッチ成立を確認(相手が来たら battleId を拾って消費)
    if (action === "poll") {
      const m = await st.get("matched:" + body.userId);
      if (m) { await st.delete("matched:" + body.userId); return this.reply({ status: "matched", battleId: m }); }
      const waiting = await st.get("waiting");
      return this.reply({ status: waiting && waiting.userId === body.userId ? "queued" : "idle" });
    }

    // キャンセル(直前にマッチしていたらそれを優先して返す)
    if (action === "cancel") {
      const m = await st.get("matched:" + body.userId);
      if (m) { await st.delete("matched:" + body.userId); return this.reply({ status: "matched", battleId: m }); }
      const waiting = await st.get("waiting");
      if (waiting && waiting.userId === body.userId) { await st.delete("waiting"); return this.reply({ status: "cancelled" }); }
      return this.reply({ status: "idle" });
    }

    // enqueue: 待機が居ない or 同一ユーザーの再登録 → 自分を待機に据える
    const waiting = await st.get("waiting");
    if (!waiting || waiting.userId === body.userId) {
      await st.put("waiting", body);
      return this.reply({ status: "queued" });
    }
    // 2人揃った → 待機を消して決定論バトルを確定
    await st.delete("waiting");
    const a = waiting, b = body;
    const result = resolveBattle({ code: a.code, train: a.train }, { code: b.code, train: b.train });
    const battleId = crypto.randomUUID().slice(0, 12);
    const winnerId = result.winner === a.code ? a.userId : b.userId;
    // battles保存 + 勝者へガチャチケット+1 を同一トランザクションで
    const db = this.env.DB;
    await db.batch([
      db.prepare("INSERT INTO battles (id, p1_user, p2_user, p1_code, p2_code, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(battleId, a.userId, b.userId, a.code, b.code, JSON.stringify(result), Date.now()),
      db.prepare("INSERT OR IGNORE INTO wallets (user_id) VALUES (?)").bind(winnerId),
      db.prepare("UPDATE wallets SET tickets = tickets + 1 WHERE user_id = ?").bind(winnerId),
    ]);
    // 待機していたA(=a)が poll で拾えるようマーカーを残す
    await st.put("matched:" + a.userId, battleId);
    return this.reply({ status: "matched", battleId, winnerId });
  }
}
