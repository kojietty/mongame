/** 図鑑・対戦・挑戦で共通のモンスターカード。 */
import React from "react";
import { genStats, TYPES, typeIdx } from "@monster-game/core";
import { MonsterSprite } from "./MonsterSprite.jsx";
import { rarityTextClass, ringClass } from "../lib/ui.js";

export function MonsterCard({ monster, onClick, sub }) {
  const info = genStats(monster.code);
  const rn = info.rarity.name;
  return (
    <div className="card mon-card" onClick={onClick}>
      {monster.favorite && <div className="fav-badge">⭐</div>}
      <div className={"mon-stage " + ringClass(rn)}><MonsterSprite code={monster.code} size={104} /></div>
      <div className="mon-name">{monster.nickname || info.name} <span className={"stars " + rarityTextClass(rn)}>{info.rarity.stars}</span></div>
      <div className="chips">
        {info.types.map((t, i) => <span key={i} className="chip" style={{ background: TYPES[typeIdx(t)].css }}>{TYPES[typeIdx(t)].name}</span>)}
      </div>
      <div className="mon-sub" style={{ marginTop: 4 }}>{sub != null ? sub : `Lv${monster.train.level}${monster.nickname ? " ・ " + info.name : ""}`}</div>
    </div>
  );
}
