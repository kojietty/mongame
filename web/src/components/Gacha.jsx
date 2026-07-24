/** 召喚(ガチャ): チケット消費で単発/10連/20連。レア度リビール演出つき。 */
import React, { useEffect, useState } from "react";
import { genStats, TYPES, typeIdx } from "@monster-game/core";
import { api } from "../lib/api.js";
import { useMeCtx, useToast } from "../lib/store.jsx";
import { MonsterSprite } from "./MonsterSprite.jsx";
import { rarityTextClass, ringClass } from "../lib/ui.js";

export function Gacha() {
  const { me, loaded, tickets, refresh } = useMeCtx();
  const toast = useToast();
  const [word, setWord] = useState("");
  const [owned, setOwned] = useState(null);   // 所持数(初回20連判定)
  const [reveal, setReveal] = useState(null);  // {codes, shown}
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (me) api.monsters().then(d => setOwned(d.monsters.length)).catch(() => setOwned(0)); }, [me]);
  if (loaded && !me) return <p className="muted">ログインしてください。</p>;

  const firstTime = owned === 0;

  const pull = async (count) => {
    if (busy) return;
    setBusy(true); setReveal(null);
    try {
      const d = await api.summon(word, count);
      // UR判定で画面フラッシュ
      const hasUR = d.codes ? false : d.monsters.some(m => genStats(m.code).rarity.name === "UR");
      const codes = d.monsters.map(m => m.code);
      if (codes.some(c => genStats(c).rarity.name === "UR")) screenFlash();
      setReveal({ codes, shown: 0 });
      refresh();
      setOwned(o => (o || 0) + count);
      // 順次めくり
      let i = 0;
      const tick = () => { i++; setReveal(r => r ? { ...r, shown: i } : r); if (i < codes.length) setTimeout(tick, 130); };
      setTimeout(tick, 200);
    } catch (e) {
      if (e.status === 402) toast(`チケットが足りません(残り ${e.data?.tickets ?? tickets}）`, "err");
      else toast("召喚に失敗しました", "err");
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div className={"gacha-hero" + (firstTime ? " gacha-first" : "")}>
        {firstTime && <div className="stars r-UR" style={{ fontFamily: "var(--pixel)", fontSize: 11, marginBottom: 10 }}>★ FIRST 20 PULL ★</div>}
        <div className="title" style={{ fontSize: 24 }}>{firstTime ? "初回20連を引こう！" : "モンスター召喚"}</div>
        <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>チケット 🎟 {tickets} ・ 1召喚 = 1チケット</div>
        <div className="row" style={{ justifyContent: "center", marginTop: 8 }}>
          <input className="input" value={word} maxLength={20} onChange={e => setWord(e.target.value)}
            placeholder="味付けワード(任意)" style={{ width: 180 }} />
        </div>
        <div className="row" style={{ justifyContent: "center", marginTop: 14 }}>
          <button className="btn btn-lg" disabled={busy || tickets < 1} onClick={() => pull(1)}>単発 🎟1</button>
          <button className="btn btn-lg" disabled={busy || tickets < 10} onClick={() => pull(10)}>10連 🎟10</button>
          <button className="btn btn-primary btn-lg" disabled={busy || tickets < 20} onClick={() => pull(20)}>20連 🎟20</button>
        </div>
        {tickets < 1 && <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>チケットは対戦勝利・デイリー受取で増えます。</div>}
      </div>

      {reveal && (
        <div style={{ marginTop: 20 }}>
          <div className="h">結果 ({reveal.codes.length})</div>
          <div className="pull-grid">
            {reveal.codes.slice(0, reveal.shown).map((code, i) => <RevealCard key={i} code={code} delay={i} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function RevealCard({ code, delay }) {
  const info = genStats(code);
  const rn = info.rarity.name;
  return (
    <div className={"reveal-card " + ringClass(rn) + (rn === "UR" || rn === "SR" ? " glow-anim" : "")}
      style={{ animationDelay: (delay * 0.03) + "s" }}>
      <div className="inner">
        <MonsterSprite code={code} size={72} />
        <div className={"stars " + rarityTextClass(rn)} style={{ fontSize: 13 }}>{info.rarity.stars}</div>
        <div style={{ fontSize: 12, fontWeight: 700 }}>{info.name}</div>
        <div className="chips">
          {info.types.map((t, i) => <span key={i} className="chip" style={{ background: TYPES[typeIdx(t)].css, fontSize: 10 }}>{TYPES[typeIdx(t)].name}</span>)}
        </div>
      </div>
    </div>
  );
}

function screenFlash() {
  const el = document.createElement("div");
  el.className = "flash";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 650);
}
