/** ソートバー付きのモンスターグリッド(図鑑・対戦・挑戦で共通)。 */
import React, { useMemo, useState } from "react";
import { genStats } from "@monster-game/core";
import { MonsterCard } from "./MonsterCard.jsx";

const RARITY_RANK = { N: 0, R: 1, SR: 2, UR: 3 };
const SORTS = [
  { id: "new", label: "新着" },
  { id: "rarity", label: "レア度" },
  { id: "level", label: "レベル" },
  { id: "fav", label: "★お気に入り" },
  { id: "name", label: "名前" },
];

export function sortMonsters(mons, sort) {
  const arr = [...mons];
  const dispName = m => (m.nickname || genStats(m.code).name);
  const rank = m => RARITY_RANK[genStats(m.code).rarity.name] ?? 0;
  if (sort === "new") arr.sort((a, b) => b.created_at - a.created_at);
  else if (sort === "rarity") arr.sort((a, b) => rank(b) - rank(a) || b.created_at - a.created_at);
  else if (sort === "level") arr.sort((a, b) => b.train.level - a.train.level || rank(b) - rank(a));
  else if (sort === "fav") arr.sort((a, b) => (b.favorite - a.favorite) || rank(b) - rank(a));
  else if (sort === "name") arr.sort((a, b) => dispName(a).localeCompare(dispName(b), "ja"));
  return arr;
}

export function MonsterGrid({ monsters, onPick, sub }) {
  const [sort, setSort] = useState("new");
  const sorted = useMemo(() => sortMonsters(monsters, sort), [monsters, sort]);
  return (
    <>
      <div className="toolbar" style={{ marginBottom: 14 }}>
        <span className="h" style={{ margin: 0 }}>並び替え</span>
        <div className="seg">
          {SORTS.map(s => (
            <button key={s.id} className={sort === s.id ? "on" : ""} onClick={() => setSort(s.id)}>{s.label}</button>
          ))}
        </div>
      </div>
      <div className="grid-mons">
        {sorted.map(m => <MonsterCard key={m.id} monster={m} onClick={() => onPick(m)} sub={sub ? sub(m) : undefined} />)}
      </div>
    </>
  );
}
