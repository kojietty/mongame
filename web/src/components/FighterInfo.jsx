/** 戦闘参加キャラの詳細(スプライト+タイプ+ステータス+特性)。振り返り用。 */
import React from "react";
import { STAT_NAMES, TYPES, typeIdx, describe } from "@monster-game/core";
import { MonsterSprite } from "./MonsterSprite.jsx";
import { ringClass, stripTags } from "../lib/ui.js";

export function FighterInfo({ code, name, rarityName, types, stats, abilities, tag }) {
  return (
    <div className="panel" style={{ flex: 1, minWidth: 0 }}>
      <div style={{ textAlign: "center" }}>
        <div className={"mon-stage " + (rarityName ? ringClass(rarityName) : "")} style={{ display: "inline-grid", padding: 8 }}>
          <MonsterSprite code={code} size={84} />
        </div>
        <div className="mon-name" style={{ marginTop: 6, fontSize: 14 }}>{name}</div>
        {tag && <div className="mon-sub">{tag}</div>}
        <div className="chips" style={{ marginTop: 4 }}>
          {types.map((t, i) => <span key={i} className="chip" style={{ background: TYPES[typeIdx(t)].css }}>{TYPES[typeIdx(t)].name}</span>)}
        </div>
      </div>
      <table className="stat-tbl" style={{ marginTop: 10 }}>
        <tbody>
          {STAT_NAMES.map((s, i) => (
            <tr key={i}><td className="muted">{s}</td><td style={{ textAlign: "right", fontWeight: 700 }}>{stats[i]}</td></tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 8 }}>
        {abilities.map((a, i) => (
          <div key={i} className={"abil" + (a.eff.pdx ? " pdx" : "")}>{a.label} {stripTags(describe(a.eff))}</div>
        ))}
      </div>
    </div>
  );
}
