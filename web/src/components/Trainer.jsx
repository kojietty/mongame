/** 育成: モンスターを選び育成メニューを適用(計算はサーバー権威、1日5回まで)。 */
import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { genStats, trainedStats, allAbilities, aptFor, APT_GRADES, MENUS, STAT_NAMES, describe, TOTAL_EFFORT_CAP } from "@monster-game/core";
import { api } from "../lib/api.js";
import { useMeCtx, useToast } from "../lib/store.jsx";
import { MonsterSprite } from "./MonsterSprite.jsx";
import { stripTags } from "../lib/ui.js";

const DAILY = 5;
const dispName = (m) => (m.nickname || genStats(m.code).name);

export function Trainer() {
  const { me, loaded, trainTickets, refresh } = useMeCtx();
  const toast = useToast();
  const [params] = useSearchParams();
  const [mons, setMons] = useState([]);
  const [sel, setSel] = useState(null);   // {id, code, train, trainCount, nickname}
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!me) return;
    api.monsters().then(d => {
      setMons(d.monsters);
      const want = Number(params.get("m"));
      const pre = d.monsters.find(x => x.id === want);
      setSel(s => s || pre || d.monsters[0] || null);
    });
  }, [me]);

  if (loaded && !me) return <p className="muted">ログインしてください。</p>;
  if (!sel) return <p className="muted">図鑑でモンスターを召喚してください。</p>;

  const info = genStats(sel.code);
  const apt = aptFor(sel.code);
  const cur = trainedStats(sel.train);
  const count = sel.trainCount ?? 0;
  const overLimit = count >= DAILY;        // 本日の無料枠を使い切った
  const canTrain = !overLimit || trainTickets > 0; // チケットがあれば続行可
  const useTicket = overLimit && trainTickets > 0;  // 次の育成はチケット消費

  const doTrain = async (menuId) => {
    if (busy || !canTrain) return;
    setBusy(true);
    try {
      const d = await api.train(sel.id, menuId);
      const next = { ...sel, train: d.state, trainCount: d.trainCount };
      setSel(next);
      setMons(ms => ms.map(m => m.id === sel.id ? next : m));
      setLog(l => [...d.events.map(e => e.text || MENUS.find(m => m.id === menuId)?.name), ...l].slice(0, 30));
      if (d.usedTicket) { toast(`育成チケットを使用 (残り ${d.trainTickets})`, "ok"); refresh(); }
    } catch (e) {
      if (e.status === 429) { toast("本日の育成上限。育成チケットもありません", "err"); setSel(s => ({ ...s, trainCount: DAILY })); refresh(); }
      else if (e.status === 409) toast("競合しました。もう一度お試しください", "err");
      else toast("育成に失敗しました", "err");
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="title" style={{ marginBottom: 12 }}>育成</div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,260px) 1fr", gap: 14 }} className="train-grid">
        <div className="panel">
          <select className="select" value={sel.id} style={{ width: "100%", marginBottom: 10 }}
            onChange={e => setSel(mons.find(m => m.id === Number(e.target.value)))}>
            {mons.map(m => <option key={m.id} value={m.id}>{dispName(m)}{m.favorite ? " ⭐" : ""}</option>)}
          </select>
          <div className="mon-stage"><MonsterSprite code={sel.code} size={140} /></div>
          <div className="mon-name" style={{ marginTop: 8 }}>{dispName(sel)} <span className={"stars r-" + info.rarity.name}>{info.rarity.stars}</span></div>
          <div className="mon-sub" style={{ marginTop: 4 }}>Lv{sel.train.level} ・ 歪み {sel.train.dist}/240{sel.train.buff ? " ・好調" : ""}</div>
          <div className="mon-sub">総努力 {sel.train.effort.reduce((a, b) => a + b, 0)}/{TOTAL_EFFORT_CAP}</div>
          <div style={{ marginTop: 10 }}>
            <div className="hpbar"><div className="hpbar-fill" style={{ width: (Math.min(count, DAILY) / DAILY * 100) + "%", background: overLimit ? "linear-gradient(90deg,#ff5468,#ff8a5c)" : undefined }} /></div>
            <div className="mon-sub" style={{ marginTop: 4, textAlign: "right" }}>本日の育成 {Math.min(count, DAILY)}/{DAILY}{trainTickets > 0 ? ` ・ 💪${trainTickets}` : ""}</div>
          </div>
        </div>

        <div>
          <table className="stat-tbl panel" style={{ marginBottom: 12 }}>
            <tbody>
              {STAT_NAMES.map((s, i) => (
                <tr key={i}>
                  <td className="muted" style={{ width: "5em" }}>{s}</td>
                  <td style={{ width: "1.6em", textAlign: "center", color: APT_GRADES[apt[i]][3], fontWeight: 700 }}>{APT_GRADES[apt[i]][0]}</td>
                  <td style={{ textAlign: "right", fontWeight: 700, width: "3em" }}>{cur[i]}</td>
                  <td className="muted" style={{ fontSize: 10 }}>努力 {sel.train.effort[i]}/{APT_GRADES[apt[i]][2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {overLimit && (
            <div className={"toast " + (useTicket ? "ok" : "err")} style={{ position: "static", display: "inline-block", marginBottom: 10 }}>
              {useTicket ? `本日の無料枠は終了。以降は育成チケットを消費します（💪${trainTickets}）` : "本日の育成は上限です（明日リセット / 育成チケットで継続可）"}
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 12 }}>
            {MENUS.map(m => (
              <button key={m.id} className="btn" disabled={busy || !canTrain} onClick={() => doTrain(m.id)} style={{ textAlign: "left", padding: 10 }}>
                <b style={{ fontSize: 13 }}>{m.name}{useTicket ? " 💪" : ""}</b><br /><small className="muted" style={{ fontFamily: "var(--sans)" }}>{m.desc}</small>
              </button>
            ))}
          </div>
          <div style={{ marginBottom: 12 }}>
            {allAbilities(sel.train).map((a, i) => (
              <div key={i} className={"abil" + (a.eff.pdx ? " pdx" : "")} style={{ padding: "3px 0" }}>
                {a.label} {stripTags(describe(a.eff))}{a.grown ? " 〔後天〕" : ""}
              </div>
            ))}
          </div>
          <div className="log">{log.map((l, i) => <div key={i}>{l}</div>)}</div>
        </div>
      </div>
    </div>
  );
}
