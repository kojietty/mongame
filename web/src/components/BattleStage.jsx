/** 共通の戦闘演出。決定論events(サーバー確定)を左右スプライト+HPバー+ログで再生。
 *  events の side "L"/"R" が leftCode/rightCode に対応する。 */
import React, { useEffect, useRef, useState } from "react";
import { genStats } from "@monster-game/core";
import { MonsterSprite } from "./MonsterSprite.jsx";

// events を先読みして各サイドの最大HPを求める(attackのmaxは防御側の最大HP)。
function scanMax(events) {
  let maxL = 0, maxR = 0;
  for (const e of events) {
    if (e.type === "attack") { if (e.side === "L") maxR = Math.max(maxR, e.max); else maxL = Math.max(maxL, e.max); }
    else if (e.type === "heal") { if (e.side === "L") maxL = Math.max(maxL, e.max); else maxR = Math.max(maxR, e.max); }
  }
  return { maxL: maxL || 1, maxR: maxR || 1 };
}

export function BattleStage({ leftCode, rightCode, events, onDone, leftLabel, rightLabel, size = 108 }) {
  const leftRef = useRef(null), rightRef = useRef(null);
  const { maxL, maxR } = scanMax(events);
  const [hpL, setHpL] = useState(maxL);
  const [hpR, setHpR] = useState(maxR);
  const [log, setLog] = useState([]);
  const logRef = useRef(null);

  useEffect(() => {
    setHpL(maxL); setHpR(maxR); setLog([]);
    let i = 0, timer;
    const step = () => {
      if (i >= events.length) { onDone && onDone(); return; }
      const e = events[i++];
      const L = leftRef.current, R = rightRef.current;
      if (e.type === "attack") {
        const atk = e.side === "L" ? L : R, def = e.side === "L" ? R : L;
        atk?.attack(); def?.hit();
        if (e.side === "L") setHpR(e.hp); else setHpL(e.hp);
        setLog(l => [...l, { t: `${e.atkName} の${e.atkType}攻撃 → ${e.defName} に ${e.dmg}${e.tmult > 1 ? " 効果抜群!" : ""}${e.crit ? " 会心!" : ""}`, c: e.crit || e.tmult > 1 ? "crit" : "" }]);
      } else if (e.type === "heal") {
        (e.side === "L" ? L : R)?.happy();
        if (e.side === "L") setHpL(e.hp); else setHpR(e.hp);
        setLog(l => [...l, { t: `＋ ${e.name} が ${e.amt} 回復`, c: "" }]);
      } else if (e.type === "faint") {
        setLog(l => [...l, { t: `✖ ${e.name} は倒れた`, c: "" }]);
      } else if (e.type === "win") {
        (e.side === "L" ? L : R)?.happy();
        (e.side === "L" ? R : L)?.die();
        setLog(l => [...l, { t: `🏆 ${e.name} の勝利!`, c: "win" }]);
      }
      timer = setTimeout(step, e.type === "attack" ? 480 : 300);
    };
    timer = setTimeout(step, 250);
    return () => clearTimeout(timer);
  }, [events]);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  const pctL = Math.max(0, Math.min(100, (hpL / maxL) * 100));
  const pctR = Math.max(0, Math.min(100, (hpR / maxR) * 100));
  const nameL = leftLabel || genStats(leftCode).name;
  const nameR = rightLabel || genStats(rightCode).name;

  return (
    <div>
      <div className="arena" style={{ position: "relative" }}>
        <Fighter refSprite={leftRef} code={leftCode} facing={1} name={nameL} pct={pctL} size={size} />
        <span className="vs" style={{ top: "38%" }}>VS</span>
        <Fighter refSprite={rightRef} code={rightCode} facing={-1} name={nameR} pct={pctR} size={size} />
      </div>
      <div className="log" ref={logRef} style={{ marginTop: 12 }}>
        {log.map((l, i) => <div key={i} className={l.c}>{l.t}</div>)}
      </div>
    </div>
  );
}

function Fighter({ refSprite, code, facing, name, pct, size }) {
  return (
    <div className="fighter">
      <div className="mon-stage"><MonsterSprite ref={refSprite} code={code} size={size} facing={facing} /></div>
      <div className="mon-name" style={{ fontSize: 13 }}>{name}</div>
      <div className="hpbar" style={{ marginTop: 6 }}>
        <div className={"hpbar-fill" + (pct <= 30 ? " low" : "")} style={{ width: pct + "%" }} />
      </div>
    </div>
  );
}
