/**
 * Google OAuth 2.0 (Authorization Code フロー) + セッション。
 * セッションは KV に保存し、HttpOnly Cookie にセッションIDを持たせる。
 *
 * 必要なシークレット(wrangler secret put):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 * 必要なvars(wrangler.toml):
 *   OAUTH_REDIRECT_URI (例 https://api.example.com/auth/google/callback)
 *   WEB_ORIGIN         (SPAのURL。ログイン後リダイレクト先)
 * バインディング:
 *   SESSIONS (KV), DB (D1)
 */
import { one, run } from "./db.js";

const COOKIE = "mg_session";

export function googleStart(env, url) {
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.OAUTH_REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  // state はCSRF対策で短命Cookieに保存(本番はKVでも可)
  return new Response(null, {
    status: 302,
    headers: {
      location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      "set-cookie": cookie("mg_oauth_state", state, 600),
    },
  });
}

export async function googleCallback(request, env, url) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookies = parseCookies(request);
  if (!code || !state || state !== cookies["mg_oauth_state"]) {
    return new Response("invalid oauth state", { status: 400 });
  }
  // code → token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.OAUTH_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return new Response("token exchange failed", { status: 401 });
  const token = await tokenRes.json();
  // id_token(JWT)の payload から email/sub を取り出す(署名検証は本番で追加推奨)
  const profile = decodeJwtPayload(token.id_token);
  const sub = profile.sub, email = profile.email, name = profile.name || email;

  // ユーザーをupsert
  let user = await one(env, "SELECT * FROM users WHERE google_sub = ?", [sub]);
  if (!user) {
    const res = await run(env,
      "INSERT INTO users (google_sub, email, name, created_at) VALUES (?, ?, ?, ?)",
      [sub, email, name, Date.now()]);
    user = { id: res.meta.last_row_id, google_sub: sub, email, name };
  }

  // セッション発行(KV, 30日)
  const sid = crypto.randomUUID();
  await env.SESSIONS.put(`sess:${sid}`, JSON.stringify({ id: user.id, email: user.email, name: user.name }), { expirationTtl: 60 * 60 * 24 * 30 });

  return new Response(null, {
    status: 302,
    headers: {
      location: env.WEB_ORIGIN || "/",
      "set-cookie": cookie(COOKIE, sid, 60 * 60 * 24 * 30),
    },
  });
}

export async function requireUser(request, env) {
  const sid = parseCookies(request)[COOKIE];
  if (!sid) return null;
  const raw = await env.SESSIONS.get(`sess:${sid}`);
  return raw ? JSON.parse(raw) : null;
}

/**
 * ログアウト。KVのセッションも破棄しCookieを失効させる。
 * GET(リンク遷移)なら WEB_ORIGIN へ302、POST(API)なら JSON を返す。
 */
export async function clearSession(request, env) {
  const sid = parseCookies(request)[COOKIE];
  if (sid) await env.SESSIONS.delete(`sess:${sid}`);
  const setCookie = cookie(COOKIE, "", 0);
  if (request.method === "GET") {
    return new Response(null, { status: 302, headers: { location: env.WEB_ORIGIN || "/", "set-cookie": setCookie } });
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json", "set-cookie": setCookie },
  });
}

/* ---- helpers ---- */
// SPAはWorkerが同一オリジンで配信するため SameSite=Lax で堅牢
// (サードパーティCookieのブロックを受けない)。Secureはlocalhostでも動作する。
function cookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
function parseCookies(request) {
  const h = request.headers.get("cookie") || "";
  return Object.fromEntries(h.split(";").map(s => s.trim()).filter(Boolean).map(kv => {
    const i = kv.indexOf("="); return [kv.slice(0, i), kv.slice(i + 1)];
  }));
}
function decodeJwtPayload(jwt) {
  const part = jwt.split(".")[1];
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const json = atob(b64.padEnd(b64.length + (4 - b64.length % 4) % 4, "="));
  return JSON.parse(decodeURIComponent(escape(json)));
}
