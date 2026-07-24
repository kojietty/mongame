/**
 * ============================================================
 *  Monster Game — Shared Deterministic Core Engine
 * ============================================================
 *  DOM非依存の純ロジック。ブラウザ(React)とCloudflare Worker の
 *  両方で同一に動く。生成・ステータス・アビリティ・育成・戦闘の
 *  すべてを「個体コード」から決定論的に導出する。
 *
 *  重要な設計原則:
 *   - 同じ入力 → 必ず同じ出力(乱数はすべてシード付き)
 *   - 保存するのは「個体コード」と「育成state(小さなJSON)」だけ。
 *     画像もステータスも保存しない(すべて再計算で復元できる)。
 *   - サーバーがこのengineで戦闘を確定 = チート不能・netcode不要。
 *
 *  スプライトの描画(canvas)はここには含めない → render.js(ブラウザ専用)。
 * ============================================================
 */

/* ---------------- 決定論PRNG ---------------- */
export function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** シード文字列 + 用途salt から独立した乱数関数を作る */
export function rngFromSeed(seedStr, salt) {
  const h = xmur3(seedStr + "::" + salt);
  return mulberry32(h());
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
const rint = (r, a, b) => a + Math.floor(r() * (b - a + 1));
const chance = (r, p) => r() < p;

/* ---------------- 個体コード ---------------- */
// 個体コード = playerId|word|nonce。この文字列そのものが全生成のシード。
export function buildCode(playerId, word, nonce) {
  return [playerId || "anon", word || "", nonce].join("|");
}
export function newNonce() {
  return Math.random().toString(36).slice(2, 8);
}

/* ---------------- 色 / タイプ ---------------- */
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = x => Math.round(x * 255).toString(16).padStart(2, "0");
  return "#" + to(f(0)) + to(f(8)) + to(f(4));
}
export const TYPES = [
  { name: "炎", hue: 8, css: "#e05a3a" }, { name: "水", hue: 205, css: "#3a7fe0" },
  { name: "草", hue: 110, css: "#4aa84a" }, { name: "雷", hue: 50, css: "#d8b02a" },
  { name: "氷", hue: 185, css: "#4ac2c8" }, { name: "土", hue: 30, css: "#a8763a" },
  { name: "風", hue: 155, css: "#3ab890" }, { name: "闇", hue: 275, css: "#7a4ac2" },
  { name: "光", hue: 46, css: "#c2a83a" }, { name: "毒", hue: 300, css: "#b04ab0" },
];
export const TYPE_IDX = Object.fromEntries(TYPES.map((t, i) => [t.name, i]));
// 攻撃タイプ → 効果抜群(2倍)になる相手
const STRONG = { 0: [2, 4, 9], 1: [0, 5], 2: [1, 5], 3: [1, 6], 4: [2, 6, 5], 5: [0, 3, 9], 6: [2, 5], 7: [8, 6], 8: [7, 9], 9: [2, 1] };
export function typeMult(atkIdx, defIdxs) {
  let m = 1;
  for (const d of defIdxs) {
    if (STRONG[atkIdx].includes(d)) m *= 2;
    else if (STRONG[d].includes(atkIdx)) m *= 0.5;
  }
  return m;
}
export function typeIdx(t) { return typeof t === "number" ? t : TYPE_IDX[t.name]; }
export function typeOf(info) { return typeIdx(info.types[0]); }

export function genPalette(rng, typeHue) {
  const h = (typeHue + rint(rng, -18, 18) + 360) % 360;
  const h2 = (h + rint(rng, 100, 260)) % 360;
  return {
    1: hslToHex(h, 45, 12), 2: hslToHex(h, 55, 30), 3: hslToHex(h, 60, 48),
    4: hslToHex(h, 55, 68), 5: hslToHex(h2, 60, 50), 6: "#f5f5ee",
    7: hslToHex(h2, 70, 20), 8: hslToHex(h2, 55, 68),
  };
}

/* ---------------- スプライト生成(48x48 セルオートマトン) ---------------- */
const makeGrid = n => Array.from({ length: n }, () => new Array(n).fill(0));
function bbox(g) {
  let x0 = 99, y0 = 99, x1 = -1, y1 = -1; const n = g.length;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (g[y][x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}
function keepLargest(g) {
  const n = g.length, seen = makeGrid(n); let best = null;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!g[y][x] || seen[y][x]) continue;
    const comp = [], q = [[x, y]]; seen[y][x] = 1;
    while (q.length) {
      const [cx, cy] = q.pop(); comp.push([cx, cy]);
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        const X = cx + dx, Y = cy + dy;
        if (X >= 0 && X < n && Y >= 0 && Y < n && g[Y][X] && !seen[Y][X]) { seen[Y][X] = 1; q.push([X, Y]); }
      });
    }
    if (!best || comp.length > best.length) best = comp;
  }
  const out = makeGrid(n);
  if (best) best.forEach(([x, y]) => out[y][x] = 1);
  return out;
}
function shadeByDepth(g, rng, pm) {
  const n = g.length; const depth = makeGrid(n); let cur = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!g[y][x]) continue;
    const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const X = x + dx, Y = y + dy; return X < 0 || X >= n || Y < 0 || Y >= n || !g[Y][X];
    });
    if (edge) { depth[y][x] = 1; cur.push([x, y]); }
  }
  let d = 1;
  while (cur.length) {
    const next = [];
    for (const [x, y] of cur) [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && X < n && Y >= 0 && Y < n && g[Y][X] && !depth[Y][X]) { depth[Y][X] = d + 1; next.push([X, Y]); }
    });
    cur = next; d++;
  }
  const maxD = d; const out = makeGrid(n); const { y0 } = bbox(g);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!g[y][x]) continue;
    if (depth[y][x] === 1) { out[y][x] = 1; continue; }
    const t = depth[y][x] / maxD;
    let c = t < 0.30 ? 4 : t < 0.62 ? 3 : 2;
    if ((y - y0) < n * 0.28 && t < 0.45 && c < 4) c = 4;
    if (pm === 1 && chance(rng, 0.16)) c = 5;
    else if (pm === 2 && (x + y) % 5 === 0) c = (c >= 3 ? 8 : 5);
    else if (pm === 0 && chance(rng, 0.04)) c = Math.max(2, c - 1);
    out[y][x] = c;
  }
  return out;
}
function addOutlineFeatures(g, rng, blob) {
  const n = g.length, H = n / 2;
  let sx = 0, sy = 0, cnt = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (g[y][x]) { sx += x; sy += y; cnt++; }
  if (!cnt) return;
  const cx = sx / cnt, cy = sy / cnt; const outline = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < H; x++) {
    if (!g[y][x]) continue;
    const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const X = x + dx, Y = y + dy; return X < 0 || X >= n || Y < 0 || Y >= n || !g[Y][X];
    });
    if (edge) outline.push([x, y]);
  }
  if (!outline.length) return;
  const nF = blob > 0.66 ? rint(rng, 3, 5) : rint(rng, 1, 3);
  const sharp = chance(rng, 0.55);
  for (let k = 0; k < nF; k++) {
    let best = null, bd = -1;
    for (let s = 0; s < 3; s++) {
      const c = pick(rng, outline);
      const d = Math.hypot(c[0] - cx, c[1] - cy) * (0.6 + rng() * 0.8);
      if (d > bd) { bd = d; best = c; }
    }
    const [ax, ay] = best;
    let dx = ax - cx, dy = ay - cy; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const L = rint(rng, blob > 0.66 ? 5 : 3, blob > 0.66 ? 11 : 7);
    for (let i = 0; i < L; i++) {
      const t = i / L;
      const px = Math.round(ax + dx * i), py = Math.round(ay + dy * i);
      const w = sharp ? Math.max(0, Math.round((1 - t) * 1.4)) : Math.round((1 - t) * 2.2);
      for (let wy = -w; wy <= w; wy++) for (let wx = -w; wx <= w; wx++) {
        const X = px + wx, Y = py + wy;
        if (X >= 0 && X < H && Y >= 0 && Y < n) g[Y][X] = 1;
      }
    }
  }
  for (let y = 0; y < n; y++) for (let x = 0; x < H; x++) g[y][n - 1 - x] = g[y][x];
}
function placeFace(g, rng, es) {
  const n = g.length; const { x0, x1, y0, y1 } = bbox(g);
  if (x1 < 0) return;
  const w = x1 - x0 + 1, h = y1 - y0 + 1; const cx = (x0 + x1) / 2;
  const eyeY = y0 + Math.max(1, Math.round(h * 0.30));
  const off = Math.max(es + 1, Math.round(w * 0.18));
  const put = (ex, ey) => {
    for (let yy = 0; yy < es; yy++) for (let xx = 0; xx < es; xx++) {
      const X = ex + xx, Y = ey + yy;
      if (X >= 0 && X < n && Y >= 0 && Y < n && g[Y][X] > 0) g[Y][X] = 6;
    }
    const px = ex + (es > 1 ? 1 : 0), py = ey + (es > 1 ? 1 : 0);
    if (px >= 0 && px < n && py >= 0 && py < n && g[py][px] > 0) g[py][px] = 7;
  };
  put(Math.round(cx - off), eyeY);
  put(Math.round(cx + off - es + 1), eyeY);
  if (chance(rng, 0.18)) put(Math.round(cx - (es - 1) / 2), eyeY - es - 1);
  if (chance(rng, 0.7)) {
    const my = y0 + Math.round(h * 0.52);
    const mw = rint(rng, 1, Math.max(1, Math.round(w * 0.2)));
    for (let x = Math.round(cx - mw); x <= Math.round(cx + mw); x++) {
      if (x >= 0 && x < n && my >= 0 && my < n && g[my][x] > 1 && g[my][x] !== 6 && g[my][x] !== 7) g[my][x] = 1;
    }
  }
}
/** 個体コードから 48x48 スプライト(0=空 1=輪郭 2-8=色index)を生成 */
export function genSprite(code) {
  const rng = rngFromSeed(code, "spriteA");
  const S = 48, H = 24;
  const dens = 0.60 + rng() * 0.22, iters = rint(rng, 2, 4), stretch = 0.75 + rng() * 0.7;
  let cells = Array.from({ length: S }, (_, y) => Array.from({ length: H }, (_, x) => {
    const dx = (H - 1 - x) / H, dy = Math.abs(y - S / 2) / (S / 2) * stretch;
    const dd = Math.sqrt(dx * dx * 0.85 + dy * dy * 1.2);
    return chance(rng, dens - dd * 0.7) ? 1 : 0;
  }));
  const creeps = rint(rng, 1, 4);
  for (let k = 0; k < creeps; k++) {
    const cy = rint(rng, 4, S - 5), cx = rint(rng, 1, H - 1);
    for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) {
      const Y = cy + yy, X = cx + xx;
      if (Y >= 0 && Y < S && X >= 0 && X < H && chance(rng, 0.7)) cells[Y][X] = 1;
    }
  }
  for (let it = 0; it < iters; it++) {
    const nc = cells.map(r => r.slice());
    for (let y = 0; y < S; y++) for (let x = 0; x < H; x++) {
      let cnt = 0;
      for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) {
        if (!xx && !yy) continue;
        const Y = y + yy; let X = x + xx;
        if (X >= H) X = 2 * H - 1 - X;
        if (Y < 0 || Y >= S || X < 0) continue;
        cnt += cells[Y][X];
      }
      nc[y][x] = cnt >= 5 ? 1 : cnt <= 2 ? 0 : cells[y][x];
    }
    cells = nc;
  }
  let g = makeGrid(S);
  for (let y = 0; y < S; y++) for (let x = 0; x < H; x++) { g[y][x] = cells[y][x]; g[y][S - 1 - x] = cells[y][x]; }
  g = keepLargest(g);
  let filled = 0; g.forEach(r => r.forEach(v => filled += v));
  if (filled < 160) {
    g = makeGrid(S);
    const rx = rint(rng, 10, 15), ry = rint(rng, 12, 18);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const dx = (x - 23.5) / rx, dy = (y - 24) / ry;
      if (dx * dx + dy * dy <= 1) g[y][x] = 1;
    }
    filled = 0; g.forEach(r => r.forEach(v => filled += v));
  }
  {
    const bb = bbox(g);
    const area = (bb.x1 - bb.x0 + 1) * (bb.y1 - bb.y0 + 1);
    const blob = filled / Math.max(1, area);
    if (blob > 0.6 || chance(rng, 0.4)) addOutlineFeatures(g, rng, blob);
    g = keepLargest(g);
  }
  const out = shadeByDepth(g, rng, rint(rng, 0, 2));
  placeFace(out, rng, rint(rng, 2, 3));
  return out;
}
/** スプライトのパレットを取得(描画側で g の値 → 色 に使う) */
export function spritePalette(code) {
  const info = genStats(code);
  return genPalette(rngFromSeed(code, "palA"), TYPES[typeOf(info)].hue);
}

/* ---------------- 名前 ---------------- */
const NH = ["ガ", "ゾ", "メ", "バ", "ドラ", "グラ", "ヴォ", "ピ", "モ", "ザ", "キュ", "ネ", "ル", "デ", "ボ", "ジ", "ギガ", "プチ"];
const NM = ["ル", "ギ", "ン", "ラ", "ゴ", "ミ", "ズ", "ッポ", "ク", "シャ", "ォル", "ビ"];
const NT = ["ス", "ン", "ドン", "ラス", "ゴン", "ート", "ニョ", "ザード", "ムー", "ペチ", "オス", "ルル"];
function genName(rng) { let n = pick(rng, NH); if (chance(rng, 0.6)) n += pick(rng, NM); n += pick(rng, NT); return n; }

/* ---------------- アビリティ(構造化 + 諸刃の代償) ---------------- */
export const STAT_NAMES = ["HP", "攻撃", "防御", "特攻", "特防", "素早さ"];
const TRIG_JA = { start: "戦闘開始時", low50: "HPが50%以下のとき", onHit: "攻撃するたび", everyTurn: "毎ターン", slower: "相手より遅いとき" };
export const RARITIES = [
  { name: "N", stars: "★", p: 0.55, bonus: 0, pdxP: 0.25 },
  { name: "R", stars: "★★", p: 0.30, bonus: 45, pdxP: 0.45 },
  { name: "SR", stars: "★★★", p: 0.12, bonus: 95, pdxP: 0.7 },
  { name: "UR", stars: "★★★★", p: 0.03, bonus: 160, pdxP: 1.0 },
];
const NATURES = [
  { name: "むこうみず", up: 1, down: 2 }, { name: "がんこ", up: 2, down: 5 },
  { name: "おくびょう", up: 5, down: 1 }, { name: "ずのうは", up: 3, down: 1 },
  { name: "てつのこころ", up: 4, down: 3 }, { name: "のんき", up: 0, down: 5 },
  { name: "ごうよく", up: 1, down: 4 },
];
const AB_A = ["灼熱", "逆流", "天罰", "慟哭", "閃光", "泥沼", "静寂", "暴走", "反骨", "月光", "硬直", "蜃気楼", "剛毅"];
const AB_B = ["の構え", "の呪い", "の加護", "の本能", "の刻印", "の衝動", "の理", "の残響", "の目覚め"];
const PDX_CONDS = [
  { k: "lowHP", ja: "HPが1/4以下のとき" }, { k: "evenTurn", ja: "偶数ターンのみ" },
  { k: "oddTurn", ja: "奇数ターンのみ" }, { k: "hi50", ja: "HPが半分より上のとき" },
];
function abLabel(rng, pdx) { return "「" + (pdx ? "歪んだ" : "") + pick(rng, AB_A) + pick(rng, AB_B) + "」"; }
function genEffect(rng) {
  const trig = pick(rng, ["start", "low50", "onHit", "everyTurn", "slower"]);
  const r = rng();
  if (r < 0.34) return { trig, kind: "statUp", stat: rint(rng, 1, 5), pct: pick(rng, [10, 15, 20, 25, 30]) };
  if (r < 0.52) return { trig, kind: "typeDmgUp", type: rint(rng, 0, 9), pct: pick(rng, [15, 20, 30, 40]) };
  if (r < 0.68) return { trig, kind: "typeResist", type: rint(rng, 0, 9), pct: pick(rng, [15, 20, 30]) };
  if (r < 0.84) return { trig, kind: "heal", pct: pick(rng, [5, 8, 10, 12]) };
  return { trig, kind: "crit", pct: pick(rng, [10, 15, 20, 30]) };
}
/** 歪み特性(理不尽)。すべて強力な上振れ + 明確な代償を持つ諸刃の剣。
 *  forceStat: 後天発現時に「最も鍛えた能力」に紐づけるための指定 */
export function genParadox(rng, myTypeIdx, forceStat) {
  const others = [...Array(10).keys()].filter(i => i !== myTypeIdx);
  const r = rng();
  if (r < 0.4) { // 属性矛盾: 別属性で超火力 / 代償: 被ダメージ激増(ガラスの大砲)
    const ot = pick(rng, others); const pct = rint(rng, 4, 20) * 100;
    return { pdx: true, kind: "offType", type: ot, pct, selfHurt: Math.min(300, Math.round(pct / 8)) };
  } else if (r < 0.66) { // 条件覚醒: 条件時ステ×N / 代償: 条件を外すと半減
    const c = pick(rng, PDX_CONDS); const stat = forceStat || rint(rng, 1, 5);
    return { pdx: true, kind: "condMult", cond: c.k, condJa: c.ja, stat, mult: pick(rng, [3, 5, 7, 10]) };
  } else if (r < 0.86) { // 等価交換: 片方極振り / 片方崩壊
    const up = forceStat || rint(rng, 1, 5); let dn = rint(rng, 1, 5); if (dn === up) dn = (dn % 5) + 1;
    return { pdx: true, kind: "exchange", up, upPct: rint(rng, 3, 18) * 100, down: dn, downPct: pick(rng, [90, 95, 99]) };
  } else { // 無意味特化: 特定相手に激烈 / それ以外には-40%
    const cond = pick(rng, [{ k: "sameType", ja: "自分と同じタイプの相手" }, { k: "lowerHP", ja: "最大HPが自分より低い相手" }, { k: "nameRa", ja: "名前に「ラ」を含む相手" }]);
    return { pdx: true, kind: "useless", cond: cond.k, condJa: cond.ja, pct: rint(rng, 3, 20) * 100 };
  }
}
/** 効果を日本語文に */
export function describe(e) {
  if (!e.pdx) {
    const t = TRIG_JA[e.trig];
    if (e.kind === "statUp") return `${t}、${STAT_NAMES[e.stat]}+${e.pct}%`;
    if (e.kind === "typeDmgUp") return `${t}、${TYPES[e.type].name}属性の与ダメージ+${e.pct}%`;
    if (e.kind === "typeResist") return `${t}、${TYPES[e.type].name}属性の被ダメージ-${e.pct}%`;
    if (e.kind === "heal") return `${t}、最大HPの${e.pct}%回復`;
    if (e.kind === "crit") return `${t}、クリティカル率+${e.pct}%`;
  } else {
    if (e.kind === "offType") return `攻撃が${TYPES[e.type].name}属性になり威力+${e.pct}%(自属性を捨てる)。ただし被ダメージ+${e.selfHurt}%`;
    if (e.kind === "condMult") return `${e.condJa}は${STAT_NAMES[e.stat]}が${e.mult}倍。ただし条件を外すと${STAT_NAMES[e.stat]}が半減`;
    if (e.kind === "exchange") return `${STAT_NAMES[e.up]}+${e.upPct}%、ただし${STAT_NAMES[e.down]}-${e.downPct}%`;
    if (e.kind === "useless") return `${e.condJa}への与ダメージ+${e.pct}%。ただし他の相手には与ダメージ-40%`;
  }
  return "";
}

/* ---------------- ステータス生成(個体コード → 素の個体) ---------------- */
export function genStats(code) {
  const rng = rngFromSeed(code, "stats");
  let roll = rng(), acc = 0, rarity = RARITIES[0];
  for (const R of RARITIES) { acc += R.p; if (roll < acc) { rarity = R; break; } }
  const t1 = rint(rng, 0, 9); const types = [t1];
  if (chance(rng, 0.3)) { let t2 = rint(rng, 0, 9); if (t2 === t1) t2 = (t2 + 1) % 10; types.push(t2); }
  const budget = 240 + rarity.bonus + rint(rng, -15, 15);
  const w = STAT_NAMES.map(() => 0.25 + rng()); const wSum = w.reduce((a, b) => a + b, 0);
  const stats = w.map(x => Math.max(10, Math.round(budget * x / wSum)));
  const nature = pick(rng, NATURES);
  stats[nature.up] = Math.round(stats[nature.up] * 1.1);
  stats[nature.down] = Math.round(stats[nature.down] * 0.9);
  const abilities = [{ label: abLabel(rng, false), eff: genEffect(rng) }];
  if (chance(rng, 0.5)) abilities.push({ label: abLabel(rng, false), eff: genEffect(rng) });
  if (chance(rng, rarity.pdxP)) abilities.push({ label: abLabel(rng, true), eff: genParadox(rng, t1) });
  return { name: genName(rng), rarity, types, nature, stats, total: stats.reduce((a, b) => a + b, 0), abilities };
}

/* ---------------- 育成モデル ---------------- */
// 才能グレード [記号, 育成効率, 努力値キャップ, 表示色]
export const APT_GRADES = [
  ["S", 1.6, 160, "#ff5c7a"], ["A", 1.35, 115, "#ffb347"], ["B", 1.1, 75, "#7ac27a"],
  ["C", 0.85, 45, "#5a9fe0"], ["D", 0.6, 22, "#9a9ab0"],
];
export const TOTAL_EFFORT_CAP = 320;
export const DIST_THRESHOLDS = [80, 180]; // 歪み特性が発現する閾値
/** 個体コード → 6能力の才能グレード(素質。個体固有・不変) */
export function aptFor(code) {
  const rng = rngFromSeed(code, "aptitude");
  return STAT_NAMES.map(() => {
    const r = rng();
    if (r < 0.06) return 0; if (r < 0.24) return 1; if (r < 0.55) return 2; if (r < 0.82) return 3; return 4;
  });
}
export const MENUS = [
  { id: "str", name: "筋力鍛錬", desc: "攻撃++ 防御+", gain: [[1, 14], [2, 6]], exp: 16, dist: 0 },
  { id: "foc", name: "瞑想", desc: "特攻++ 特防+", gain: [[3, 14], [4, 6]], exp: 16, dist: 0 },
  { id: "run", name: "疾走", desc: "素早さ++ 攻撃+", gain: [[5, 14], [1, 5]], exp: 16, dist: 0 },
  { id: "end", name: "耐久鍛錬", desc: "HP++ 防御+", gain: [[0, 14], [2, 6]], exp: 16, dist: 0 },
  { id: "hard", name: "過酷な特訓", desc: "全体を大きく+ 但し歪み大・稀に異変", gain: [[0, 7], [1, 7], [2, 7], [3, 7], [4, 7], [5, 7]], exp: 26, dist: 12, risk: true },
  { id: "rest", name: "休養", desc: "歪み-25 ＋ 次の育成が好調(+40%)", gain: [], exp: 6, dist: -25 },
];
/** 新規育成state(D1へJSONで保存する対象) */
export function newTrain(code) {
  return { code, level: 1, exp: 0, effort: [0, 0, 0, 0, 0, 0], dist: 0, days: 0, grown: [], lastStat: -1, streak: 0, awarded: 0, buff: 0 };
}
export function expNeed(lv) { return 20 + lv * 10; }
function bestStat(effort) { let bi = 1, bv = -1; for (let i = 1; i < 6; i++) { if (effort[i] > bv) { bv = effort[i]; bi = i; } } return bi; }
/**
 * 1回の育成を適用(1日進む)。決定論: 乱数は code + days でシードするため、
 * 同じstateに同じmenuを与えれば常に同じ結果(サーバー検証・リプレイ可能)。
 * @returns {Array} events  ログ用イベント配列
 */
export function applyTrain(state, menuId) {
  const info = genStats(state.code);
  const apt = aptFor(state.code);
  const menu = MENUS.find(m => m.id === menuId);
  const rng = rngFromSeed(state.code, "ev" + state.days);
  const events = [];
  state.days++;
  // 努力値: 加算のみ。各キャップと総320の範囲で増える(他能力を削らない)
  let primary = -1, primaryGain = 0;
  const buffMul = state.buff ? 1.4 : 1;
  let remainTotal = TOTAL_EFFORT_CAP - state.effort.reduce((a, b) => a + b, 0);
  for (const [idx, amt] of menu.gain) {
    const g = APT_GRADES[apt[idx]]; const cap = g[2];
    let add = Math.round(amt * g[1] * buffMul);
    if (menu.risk) add = Math.round(add * (0.8 + rng() * 0.6));
    add = Math.max(0, Math.min(add, cap - state.effort[idx], remainTotal));
    state.effort[idx] += add; remainTotal -= add;
    if (add > primaryGain) { primaryGain = add; primary = idx; }
    if (add === 0 && amt > 0) events.push({ t: "cap", text: `${STAT_NAMES[idx]}はこれ以上伸びない(才能グレード${g[0]}の限界 または 総努力値${TOTAL_EFFORT_CAP})` });
  }
  if (menu.id === "rest") state.buff = 1; else if (menu.gain.length > 0) state.buff = 0;
  const totalEff = state.effort.reduce((a, b) => a + b, 0);
  // EXP / レベル
  state.exp += menu.exp;
  while (state.exp >= expNeed(state.level) && state.level < 50) { state.exp -= expNeed(state.level); state.level++; events.push({ t: "lvup", text: `Lv${state.level} に上がった!` }); }
  // 歪み: 偏るほど加速(バランス育成なら溜まらない)
  let dd = menu.dist;
  if (primary >= 0) {
    if (primary === state.lastStat) { state.streak++; dd += 2 + state.streak * 2; } else { state.streak = Math.max(0, state.streak - 1); dd -= 2; }
    state.lastStat = primary;
    const mx = Math.max(...state.effort), avg = totalEff / 6;
    dd += Math.round((mx - avg) * 0.10);
  }
  dd = Math.max(-24, dd);
  state.dist = Math.max(0, Math.min(240, state.dist + dd));
  // 過酷な特訓の異変(総320を尊重)
  if (menu.risk && chance(rng, 0.28)) {
    const kind = rng();
    if (kind < 0.4) {
      const up = rint(rng, 0, 5);
      const room = Math.max(0, TOTAL_EFFORT_CAP - state.effort.reduce((a, b) => a + b, 0));
      const add = Math.max(0, Math.min(APT_GRADES[apt[up]][2] - state.effort[up], rint(rng, 10, 20), room));
      state.effort[up] += add; events.push({ t: "ev", text: `異変! ${STAT_NAMES[up]}が突然変異的に伸びた` });
    } else if (kind < 0.75) { state.dist = Math.min(240, state.dist + 18); events.push({ t: "ev", text: `異変! 歪みが急増した` }); }
    else { state.exp += 30; events.push({ t: "ev", text: `異変! 多量の経験を得た` }); }
  }
  // 歪み閾値で後天特性が発現(最も鍛えた能力に紐づく諸刃)
  while (state.awarded < DIST_THRESHOLDS.length && state.dist >= DIST_THRESHOLDS[state.awarded]) {
    const grng = rngFromSeed(state.code, "grown" + state.awarded);
    const eff = genParadox(grng, typeOf(info), bestStat(state.effort));
    const ab = { label: abLabel(grng, true), eff, grown: true };
    state.grown.push(ab);
    events.push({ t: "pdx", text: `⚠ 歪みが臨界に達し、後天特性 ${ab.label} が発現! ${describe(eff)}` });
    state.awarded++;
  }
  return events;
}
/** 育成state → 現在の実ステータス(基礎値×レベル + 努力値) */
export function trainedStats(state) {
  const info = genStats(state.code);
  const lvK = state.level * 0.03;
  return info.stats.map((b, i) => Math.round(b * (1 + lvK)) + state.effort[i]);
}
/** 素のアビリティ + 後天発現の歪み特性 */
export function allAbilities(state) {
  const info = genStats(state.code);
  return [...info.abilities, ...state.grown];
}
/** 育成state → 戦闘に渡す info(genStats + 育成反映) */
export function trainedInfo(state) {
  const base = genStats(state.code);
  return { ...base, stats: trainedStats(state), abilities: allAbilities(state) };
}
/** 育成state を保存用の短い文字列に(D1にはJSONのままでも可) */
export function serializeTrain(state) {
  const b64 = (typeof btoa !== "undefined")
    ? btoa(unescape(encodeURIComponent(JSON.stringify(pack(state)))))
    : Buffer.from(JSON.stringify(pack(state)), "utf-8").toString("base64");
  return state.code + "##" + b64;
}
function pack(state) {
  return { l: state.level, e: state.effort, d: state.dist, dy: state.days, g: state.grown, a: state.awarded, ls: state.lastStat, st: state.streak, b: state.buff };
}
export function deserializeTrain(str) {
  const [code, payload] = str.split("##");
  const json = (typeof atob !== "undefined")
    ? decodeURIComponent(escape(atob(payload)))
    : Buffer.from(payload, "base64").toString("utf-8");
  const o = JSON.parse(json);
  return { code, level: o.l, exp: 0, effort: o.e, dist: o.d, days: o.dy, grown: o.g || [], lastStat: o.ls, streak: o.st, awarded: o.a, buff: o.b || 0 };
}

/* ---------------- 戦闘エンジン(決定論・サーバー権威) ---------------- */
export function makeFighter(code, infoOverride) {
  const info = infoOverride || genStats(code);
  const base = info.stats.slice(); const permMult = [1, 1, 1, 1, 1, 1];
  let attackType = typeOf(info); const paradoxes = [];
  for (const a of info.abilities) {
    const e = a.eff; if (!e.pdx) continue; paradoxes.push(a);
    if (e.kind === "exchange") { permMult[e.up] *= (1 + e.upPct / 100); permMult[e.down] *= (1 - e.downPct / 100); }
    if (e.kind === "offType") attackType = e.type;
  }
  const maxHP = Math.round(base[0] * permMult[0] * 3.2 + 40);
  const category = (base[1] >= base[3]) ? "phys" : "spec";
  return { code, info, base, permMult, attackType, category, maxHP, hp: maxHP, paradoxes };
}
function effStat(f, idx, turn) {
  let v = f.base[idx] * f.permMult[idx];
  for (const a of f.paradoxes) {
    const e = a.eff; if (e.kind !== "condMult" || e.stat !== idx) continue;
    let on = false;
    if (e.cond === "lowHP") on = f.hp <= f.maxHP * 0.25;
    else if (e.cond === "hi50") on = f.hp > f.maxHP * 0.5;
    else if (e.cond === "evenTurn") on = (turn % 2 === 0);
    else if (e.cond === "oddTurn") on = (turn % 2 === 1);
    v *= on ? e.mult : 0.5; // 諸刃: 条件を外すと半減
  }
  return v;
}
function dmgBonus(f, defTypes, turn, slower) {
  let mult = 1, crit = 0;
  for (const a of f.info.abilities) {
    const e = a.eff; if (e.pdx) continue;
    const on = e.trig === "start" || e.trig === "onHit" || e.trig === "everyTurn" || (e.trig === "low50" && f.hp <= f.maxHP * 0.5) || (e.trig === "slower" && slower);
    if (!on) continue;
    if (e.kind === "typeDmgUp" && defTypes.includes(e.type)) mult *= (1 + e.pct / 100);
    if (e.kind === "crit") crit += e.pct / 100;
    if (e.kind === "statUp" && (e.stat === 1 || e.stat === 3)) mult *= (1 + e.pct / 100 * 0.5);
  }
  return { mult, crit };
}
function resistBonus(f, atkType, turn, slower) {
  let mult = 1;
  for (const a of f.info.abilities) {
    const e = a.eff; if (e.pdx) continue;
    const on = e.trig === "start" || e.trig === "everyTurn" || (e.trig === "low50" && f.hp <= f.maxHP * 0.5) || (e.trig === "slower" && slower);
    if (!on) continue;
    if (e.kind === "typeResist" && e.type === atkType) mult *= (1 - e.pct / 100);
  }
  return mult;
}
/**
 * 決定論バトル。両者の code(+ 任意で育成反映済みinfo)から勝敗と全リプレイを返す。
 * サーバーはこれを権威実行し、両クライアントは同じ events を再生するだけ。
 * @returns {Array} events  末尾に {type:"win", side, name}
 */
export function battleRun(codeL, codeR, infoL, infoR) {
  const L = makeFighter(codeL, infoL), R = makeFighter(codeR, infoR);
  const brng = rngFromSeed(codeL + "@@" + codeR + "@@" + L.maxHP + R.maxHP, "battle");
  const ev = [];
  const spdL = effStat(L, 5, 1), spdR = effStat(R, 5, 1);
  let order = spdL >= spdR ? [["L", L, R], ["R", R, L]] : [["R", R, L], ["L", L, R]];
  let turn = 0, guard = 0;
  while (L.hp > 0 && R.hp > 0 && guard < 200) {
    turn++;
    for (const [sid, att, def] of order) {
      if (att.hp <= 0 || def.hp <= 0) break;
      for (const a of att.info.abilities) {
        const e = a.eff; if (e.pdx || e.kind !== "heal") continue;
        const on = e.trig === "everyTurn" || (e.trig === "low50" && att.hp <= att.maxHP * 0.5);
        if (on && att.hp < att.maxHP) { const h = Math.round(att.maxHP * e.pct / 100); att.hp = Math.min(att.maxHP, att.hp + h); ev.push({ type: "heal", side: sid, amt: h, hp: att.hp, max: att.maxHP, name: att.info.name, label: a.label }); }
      }
      const slower = (sid === "L" ? spdL < spdR : spdR < spdL);
      const atkType = att.attackType; const opTypes = def.info.types.map(typeIdx);
      const eATK = effStat(att, att.category === "phys" ? 1 : 3, turn);
      const eDEF = effStat(def, att.category === "phys" ? 2 : 4, turn);
      const tmult = typeMult(atkType, opTypes);
      const bonus = dmgBonus(att, opTypes, turn, slower);
      const resist = resistBonus(def, atkType, turn, slower);
      let pdxMult = 1, pdxNote = null;
      for (const a of att.paradoxes) {
        const e = a.eff;
        if (e.kind === "offType") pdxMult *= (1 + e.pct / 100);
        if (e.kind === "useless") {
          let on = false;
          if (e.cond === "sameType") on = opTypes.includes(typeOf(att.info));
          else if (e.cond === "lowerHP") on = def.maxHP < att.maxHP;
          else if (e.cond === "nameRa") on = def.info.name.includes("ラ");
          if (on) { pdxMult *= (1 + e.pct / 100); pdxNote = `${a.label}! ${e.condJa}に刺さり+${e.pct}%`; }
          else { pdxMult *= 0.6; pdxNote = (pdxNote ? pdxNote + " / " : "") + `${a.label}が不発(-40%)`; }
        }
      }
      // 諸刃: 属性矛盾持ち(防御側)は被ダメージ増
      for (const a of def.paradoxes) { if (a.eff.kind === "offType") pdxMult *= (1 + a.eff.selfHurt / 100); }
      // condMult告知(今ターン攻撃/特攻が化けたか)
      for (const a of att.paradoxes) {
        const e = a.eff;
        if (e.kind === "condMult") {
          const st = att.category === "phys" ? 1 : 3; let on = false;
          if (e.cond === "lowHP") on = att.hp <= att.maxHP * 0.25;
          else if (e.cond === "hi50") on = att.hp > att.maxHP * 0.5;
          else if (e.cond === "evenTurn") on = (turn % 2 === 0);
          else if (e.cond === "oddTurn") on = (turn % 2 === 1);
          if (on && e.stat === st) pdxNote = (pdxNote ? pdxNote + " / " : "") + `${a.label}で${STAT_NAMES[e.stat]}${e.mult}倍`;
        }
      }
      const isCrit = chance(brng, Math.min(0.6, 0.05 + bonus.crit));
      const critMult = isCrit ? 1.6 : 1;
      const variance = 0.9 + brng() * 0.2;
      let dmg = Math.max(1, Math.round((6 + eATK * eATK / (eATK + eDEF)) * tmult * bonus.mult * resist * pdxMult * critMult * variance));
      def.hp = Math.max(0, def.hp - dmg);
      ev.push({ type: "attack", side: sid, atkName: att.info.name, defName: def.info.name, atkType: TYPES[atkType].name, dmg, crit: isCrit, tmult, pdxNote, hp: def.hp, max: def.maxHP, turn });
      if (def.hp <= 0) { ev.push({ type: "faint", name: def.info.name }); break; }
    }
    guard++;
  }
  const winner = L.hp > 0 && R.hp <= 0 ? "L" : R.hp > 0 && L.hp <= 0 ? "R" : (L.hp >= R.hp ? "L" : "R");
  ev.push({ type: "win", side: winner, name: (winner === "L" ? L : R).info.name });
  return ev;
}

/**
 * サーバー権威のPvP解決。両プレイヤーの (code, trainState) から勝敗を確定。
 * D1に result(events + winner) を保存し、両クライアントに配って再生させる。
 * @param {{code:string, train?:object}} a
 * @param {{code:string, train?:object}} b
 */
export function resolveBattle(a, b) {
  const infoA = a.train ? trainedInfo(a.train) : genStats(a.code);
  const infoB = b.train ? trainedInfo(b.train) : genStats(b.code);
  const events = battleRun(a.code, b.code, infoA, infoB);
  const win = events[events.length - 1];
  return { events, winner: win.side === "L" ? a.code : b.code, winnerName: win.name };
}

/* ---------------- チャレンジモード(PvEエンドレス) ---------------- */

/** ステージkの敵ステータス倍率。未育成は3〜5、最大育成は15〜25付近で敗北する曲線。 */
export function challengeScale(stage) { return 0.6 + 0.15 * stage; }

/**
 * runシード + ステージ番号 → スケール済みの敵info(決定論)。
 * 敵コードは "npc|<seed>|<stage>"。genStats を倍率で底上げする。
 */
export function challengeEnemy(seed, stage) {
  const code = buildCode("npc", seed, String(stage));
  const base = genStats(code);
  const f = challengeScale(stage);
  const stats = base.stats.map(v => Math.max(10, Math.round(v * f)));
  return { code, info: { ...base, stats, total: stats.reduce((a, b) => a + b, 0) } };
}

/**
 * サーバー権威のPvE 1戦解決(毎戦フルHP=makeFighterし直すので回復扱い)。
 * @param {{code:string, train?:object}} player
 */
export function resolveChallenge(player, seed, stage) {
  const infoL = player.train ? trainedInfo(player.train) : genStats(player.code);
  const enemy = challengeEnemy(seed, stage);
  const events = battleRun(player.code, enemy.code, infoL, enemy.info);
  const win = events[events.length - 1].side === "L";
  return { events, win, enemyCode: enemy.code, enemyName: enemy.info.name };
}

/* ---------------- チャレンジ報酬(撤退で確定・敗北で没収) ---------------- */

export const CHALLENGE_REWARD_STEP = 5;  // 5体撃破ごとにチケット
export const CAPTURE_RATE = 0.10;        // 撃破した敵を捕獲できる確率

/** stage k の敵を捕獲できるか(決定論。撃破時点で確定、入手は撤退時) */
export function captureRoll(seed, stage) {
  return rngFromSeed(seed + "|" + stage, "capture")() < CAPTURE_RATE;
}

/**
 * ランの獲得予定報酬(純関数)。追加状態を持たず (seed, score) だけから決まる。
 * @returns {{gacha:number, train:number, captures:{stage:number, code:string}[]}}
 */
export function challengeRewards(seed, score) {
  const n = Math.floor(score / CHALLENGE_REWARD_STEP);
  const captures = [];
  for (let k = 1; k <= score; k++)
    if (captureRoll(seed, k)) captures.push({ stage: k, code: buildCode("npc", seed, String(k)) });
  return { gacha: n, train: n, captures };
}
