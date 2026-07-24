/** D1(SQLite)薄いヘルパ。env.DB がバインディング。 */
export async function q(env, sql, params = []) {
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return results || [];
}
export async function one(env, sql, params = []) {
  return await env.DB.prepare(sql).bind(...params).first();
}
export async function run(env, sql, params = []) {
  return await env.DB.prepare(sql).bind(...params).run();
}
