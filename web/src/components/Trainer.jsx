/** 育成: 図鑑と同じグリッドから個体を選び、育成ページで鍛える(サーバー権威、1日5回まで)。 */
import React, { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { genStats, trainedStats, allAbilities, aptFor, APT_GRADES, MENUS, STAT_NAMES, describe, TOTAL_EFFORT_CAP } from "@monster-game/core";
import { api } from "../lib/api.js";
import { useMeCtx, useToast } from "../lib/store.jsx";
import { MonsterSprite } from "./MonsterSprite.jsx";
import { MonsterGrid } from "./MonsterGrid.jsx";
import { stripTags } from "../lib/ui.js";

const DAILY = 5;
const dispName = (m) => (m.nickname || genStats(m.code).name);

export function Trainer() {
  const { me, loaded, trainTickets, refresh } = useMeCtx();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mons, setMons] = useState([]);
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (me) api.monsters().then(d => setMons(d.monsters)); }, [me]);

  const selId = Number(params.get("m"));
  useEffect(() => { setLog([]); }, [selId]);   // 個体を切り替えたらログをリセット

  if (loaded && !me) return <p className="muted">ログインしてください。</p>;

  const sel = mons.find(m => m.id === selId) || null;

  // --- 個体未選択: 図鑑と同じグリッドから選ぶ ---
  if (!sel) {
    return (
      <div>
        <div className="title" style={{ marginBottom: 4 }}>育成</div>
        <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>育成するモンスターを選ぶと育成ページに移ります。</div>
        {mons.length === 0
          ? <p className="muted">先にモンスターを召喚してください。</p>
          : <MonsterGrid monsters={mons} onPick={m => navigate("/train?m=" + m.id)}
              sub={m => `Lv${m.train.level} ・ 本日 ${Math.min(m.trainCount ?? 0, DAILY)}/${DAILY}`} />}
      </div>
    );
  }

  // --- 個体選択済み: 育成ページ ---
  const info = genStats(sel.code);
  const apt = aptFor(sel.code);
  const cur = trainedStats(sel.train);
  const count = sel.trainCount ?? 0;
  const overLimit = count >= DAILY;
  const canTrain = !overLimit || trainTickets > 0;
  const useTicket = overLimit && trainTickets > 0;

  const doTrain = async (menuId) => {
    if (busy || !canTrain) return;
    setBusy(true);
    try {
      const d = await api.train(sel.id, menuId);
      setMons(ms => ms.map(m => m.id === sel.id ? { ...m, train: d.state, trainCount: d.trainCount } : m));
      setLog(l => [...d.events.map(e => e.text || MENUS.find(m => m.id === menuId)?.name), ...l].slice(0, 30));
      if (d.usedTicket) { toast(`育成チケットを使用 (残り ${d.trainTickets})`, "ok"); refresh(); }
    } catch (e) {
      if (e.status === 429) { toast("本日の育成上限。育成チケットもありません", "err"); setMons(ms => ms.map(m => m.id === sel.id ? { ...m, trainCount: DAILY } : m)); refresh(); }
      else if (e.status === 409) toast("競合しました。もう一度お試しください", "err");
      else toast("育成に失敗しました", "err");
    } finally { setBusy(false); }
  };

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div className="title">育成</div>
        <button className="btn" onClick={() => navigate("/train")}>← モンスター一覧</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,260px) 1fr", gap: 14 }} className="train-grid">
        <div className="panel">
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
              <button key={m.id} className={"btn" + (m.penalty ? " btn-danger" : "")} disabled={busy || !canTrain} onClick={() => doTrain(m.id)} style={{ textAlign: "left", padding: 10 }}>
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
