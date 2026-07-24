/**
 * コアの回帰テスト。`node test.js`。
 * 決定論・戦闘の健全性・育成の不変条件・serialize往復を検証する。
 */
import * as E from "./engine.js";

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error("FAIL:", name); } };

// 1) 生成の決定論
{
  const c = "player-A|honoo|f1r3";
  ok("sprite deterministic", JSON.stringify(E.genSprite(c)) === JSON.stringify(E.genSprite(c)));
  ok("stats deterministic", JSON.stringify(E.genStats(c)) === JSON.stringify(E.genStats(c)));
}

// 2) スプライトが空でない
{
  let sparse = 0;
  for (let i = 0; i < 500; i++) if (E.genSprite("t|" + i).flat().filter(v => v > 0).length < 160) sparse++;
  ok("no sparse sprites", sparse === 0);
}

// 3) 戦闘: エラーなし・決定論・無限ループなし
{
  let err = 0, det = true, capped = 0;
  for (let i = 0; i < 3000; i++) {
    const a = "a|" + i, b = "b|" + (i * 7 + 1);
    const e1 = E.battleRun(a, b), e2 = E.battleRun(a, b);
    if (!e1.find(x => x.type === "win")) err++;
    if (JSON.stringify(e1) !== JSON.stringify(e2)) det = false;
    if (e1.filter(x => x.type === "attack").length >= 190) capped++;
  }
  ok("battle no errors", err === 0);
  ok("battle deterministic", det);
  ok("battle no runaway", capped === 0);
}

// 4) 育成: 通常メニューは努力値が減らない・総320を超えない・NaNなし・効果は非負
{
  const menus = ["str", "foc", "run", "end", "rest"];  // hard は諸刃で減少しうるので別途検証
  let dec = 0, over = 0, nan = 0;
  const allMenus = ["str", "foc", "run", "end", "hard", "rest"];
  for (let t = 0; t < 1000; t++) {
    const st = E.newTrain("z|" + t);
    let prev = st.effort.slice();
    for (let d = 0; d < 120; d++) {
      E.applyTrain(st, menus[Math.floor(Math.random() * menus.length)]);
      for (let i = 0; i < 6; i++) if (st.effort[i] < prev[i]) dec++;
      prev = st.effort.slice();
    }
    // 総キャップ・非負は hard を含む全メニューで担保されること
    const st2 = E.newTrain("z2|" + t);
    for (let d = 0; d < 120; d++) {
      E.applyTrain(st2, allMenus[Math.floor(Math.random() * allMenus.length)]);
      if (st2.effort.reduce((a, b) => a + b, 0) > E.TOTAL_EFFORT_CAP) over++;
      if (st2.effort.some(v => v < 0)) nan++;
    }
    if (E.trainedStats(st2).some(v => Number.isNaN(v) || v < 0)) nan++;
  }
  ok("normal training never decreases effort", dec === 0);
  ok("training respects total cap", over === 0);
  ok("training no NaN/negative effort", nan === 0);
}

// 4b) 過酷な特訓は努力値を減らしうる(諸刃)
{
  let decreased = false;
  for (let t = 0; t < 300 && !decreased; t++) {
    const st = E.newTrain("h|" + t);
    for (let d = 0; d < 6; d++) E.applyTrain(st, "str");  // 先に努力値を積む
    const before = st.effort.slice();
    E.applyTrain(st, "hard");
    if (st.effort.some((v, i) => v < before[i])) decreased = true;
  }
  ok("hard training can reduce effort", decreased);
}

// 5) serialize往復
{
  const st = E.newTrain("z|z|1");
  for (let d = 0; d < 40; d++) E.applyTrain(st, ["str", "foc", "hard", "rest"][d % 4]);
  const back = E.deserializeTrain(E.serializeTrain(st));
  ok("serialize round-trip", JSON.stringify(E.trainedStats(st)) === JSON.stringify(E.trainedStats(back)));
}

// 6) resolveBattle(サーバー権威)
{
  const r = E.resolveBattle({ code: "player-A|x|1" }, { code: "player-B|y|2" });
  ok("resolveBattle returns winner+events", !!r.winner && r.events.length > 0);
}

// 7) チャレンジ: 決定論・スケーリング単調・難易度レンジ
{
  const a = E.resolveChallenge({ code: "p|x|1" }, "seed123", 3);
  const b = E.resolveChallenge({ code: "p|x|1" }, "seed123", 3);
  ok("challenge deterministic", JSON.stringify(a.events) === JSON.stringify(b.events));

  const s1 = E.challengeEnemy("s", 1).info.total, s10 = E.challengeEnemy("s", 10).info.total;
  ok("challenge scaling monotonic", s10 > s1 * 2);

  // 未育成モンスターが最初に敗北するステージ(200シード平均)。2〜8 の範囲を期待。
  let sum = 0;
  for (let i = 0; i < 200; i++) {
    let st = 1; for (; st <= 60; st++) if (!E.resolveChallenge({ code: "usr|m|" + i }, "e" + i, st).win) break;
    sum += st;
  }
  const untrained = sum / 200;
  ok("untrained dies stage 2-8", untrained >= 2 && untrained <= 8);

  // ほぼ最大育成なら 10〜35 まで到達(境界はゆるめ)。
  let sum2 = 0;
  for (let i = 0; i < 100; i++) {
    const code = "usr|m|" + i, st0 = E.newTrain(code), menus = ["str", "foc", "run", "end"];
    for (let d = 0; d < 150; d++) E.applyTrain(st0, menus[d % 4]);
    let st = 1; for (; st <= 80; st++) if (!E.resolveChallenge({ code, train: st0 }, "x" + i, st).win) break;
    sum2 += st;
  }
  const maxed = sum2 / 100;
  ok("maxed reaches stage 8-40", maxed >= 8 && maxed <= 40);
}

// 8) チャレンジ報酬: 決定論・算術・捕獲率
{
  const r1 = E.challengeRewards("rseed", 14);
  const r2 = E.challengeRewards("rseed", 14);
  ok("rewards deterministic", JSON.stringify(r1) === JSON.stringify(r2));
  ok("rewards arithmetic (score14 → 2/2)", r1.gacha === 2 && r1.train === 2);
  ok("rewards captures within score", r1.captures.every(c => c.stage >= 1 && c.stage <= 14));

  // 捕獲率サニティ: 2000ロールで 6〜15%
  let cap = 0;
  for (let k = 0; k < 2000; k++) if (E.captureRoll("cap", k)) cap++;
  const rate = cap / 2000;
  ok("capture rate ~10%", rate >= 0.06 && rate <= 0.15);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
