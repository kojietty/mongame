/** 決定論events を静的なテキストログとして表示(振り返り用)。 */
import React from "react";

function line(e) {
  if (e.type === "attack") return { c: e.crit || e.tmult > 1 ? "crit" : "", t: `${e.atkName} の${e.atkType}攻撃 → ${e.defName} に ${e.dmg}${e.tmult > 1 ? " 効果抜群!" : ""}${e.crit ? " 会心!" : ""}` };
  if (e.type === "heal") return { c: "", t: `＋ ${e.name} が ${e.amt} 回復` };
  if (e.type === "faint") return { c: "", t: `✖ ${e.name} は倒れた` };
  if (e.type === "win") return { c: "win", t: `🏆 ${e.name} の勝利!` };
  return { c: "", t: "" };
}

export function BattleLog({ events, style }) {
  return (
    <div className="log" style={style}>
      {events.map((e, i) => { const l = line(e); return <div key={i} className={l.c}>{l.t}</div>; })}
    </div>
  );
}
