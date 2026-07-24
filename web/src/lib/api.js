/** APIクライアント(Cookieセッション前提。fetchは credentials:include) */
import { useEffect, useState } from "react";

// dev: VITE_API_BASE未設定(undefined) → "/api"(vite proxyがWorkerへ、/apiを剥がす)
// prod: WorkerがSPAを同一オリジン配信するので VITE_API_BASE="" でビルド → "/me"等を直接叩く。
const RAW = import.meta.env.VITE_API_BASE;
const base = RAW === undefined ? "/api" : RAW;
// 認証リンク(トップレベル遷移)用。dev/prodとも同一オリジン("")。
export const authUrl = (p) => (RAW ?? "") + p;

/** fetch wrapper。失敗時は {status, error} を持つ Error を投げる。 */
async function jf(path, opts = {}) {
  const res = await fetch(base + path, { credentials: "include", headers: { "content-type": "application/json" }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || res.statusText);
    e.status = res.status; e.data = data;
    throw e;
  }
  return data;
}

export const api = {
  me: () => jf("/me"),
  setName: (name) => jf("/me/name", { method: "POST", body: JSON.stringify({ name }) }),
  claim: () => jf("/tickets/claim", { method: "POST" }),
  monsters: () => jf("/monsters"),
  summon: (word, count) => jf("/monsters/summon", { method: "POST", body: JSON.stringify({ word, count }) }),
  train: (id, menuId) => jf(`/monsters/${id}/train`, { method: "POST", body: JSON.stringify({ menuId }) }),
  favorite: (id, favorite) => jf(`/monsters/${id}/favorite`, { method: "POST", body: JSON.stringify({ favorite }) }),
  rename: (id, name) => jf(`/monsters/${id}/rename`, { method: "POST", body: JSON.stringify({ name }) }),
  sell: (ids) => jf("/monsters/sell", { method: "POST", body: JSON.stringify({ ids }) }),
  queue: (monsterId) => jf("/battle/queue", { method: "POST", body: JSON.stringify({ monsterId }) }),
  pollMatch: () => jf("/battle/poll", { method: "POST" }),
  cancelMatch: () => jf("/battle/cancel", { method: "POST" }),
  battle: (id) => jf(`/battle/${id}`),
  challengeActive: () => jf("/challenge/active"),
  challengeStart: (monsterId) => jf("/challenge/start", { method: "POST", body: JSON.stringify({ monsterId }) }),
  challengeFight: () => jf("/challenge/fight", { method: "POST" }),
  challengeRetire: () => jf("/challenge/retire", { method: "POST" }),
  leaderboard: () => jf("/challenge/leaderboard"),
};

/** 旧: ログインユーザー単体取得(後方互換)。新規は MeContext を使う。 */
export function useMe() {
  const [me, setMe] = useState(null);
  useEffect(() => { api.me().then(d => setMe(d.user)).catch(() => setMe(null)); }, []);
  return me;
}
