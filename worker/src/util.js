/** 共通ユーティリティ: JST日付境界 + ウォレット確保。 */
import { run } from "./db.js";

/** JSTの 'YYYY-MM-DD'(UTC+9固定, DST無し)。デイリー/育成制限の日境界に使う。 */
export function jstDay(ts = Date.now()) {
  return new Date(ts + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** ウォレット行を確保(初回は DEFAULT 20 = 初回20連ぶん)。既存なら何もしない。 */
export function ensureWallet(env, userId) {
  return run(env, "INSERT OR IGNORE INTO wallets (user_id) VALUES (?)", [userId]);
}
