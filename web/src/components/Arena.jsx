/** 対戦: モンスターを選び「マッチング」で待機。相手が来たら決定論リプレイ。勝利で🎟+1。
 *  5秒マッチしなければキャンセルボタンを表示。待機中はポーリングで成立を検知。 */
import React, { useEffect, useRef, useState } from "react";
import { genStats } from "@monster-game/core";
import { api } from "../lib/api.js";
import { useMeCtx, useToast } from "../lib/store.jsx";
import { MonsterGrid } from "./MonsterGrid.jsx";
import { MonsterSprite } from "./MonsterSprite.jsx";
import { BattleStage } from "./BattleStage.jsx";

export function Arena() {
  const { me, loaded, refresh } = useMeCtx();
  const toast = useToast();
  const [mons, setMons] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | picked | queued | playing | done
  const [pick, setPick] = useState(null);        // 選択中モンスター
  const [battle, setBattle] = useState(null);
  const [won, setWon] = useState(null);
  const [showCancel, setShowCancel] = useState(false);
  const pollRef = useRef(null);
  const cancelTimerRef = useRef(null);

  useEffect(() => { if (me) api.monsters().then(d => setMons(d.monsters)); }, [me]);
  // アンマウント時に待機を掃除
  useEffect(() => () => { stopPolling(); }, []);

  if (loaded && !me) return <p className="muted">ログインしてください。</p>;

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (cancelTimerRef.current) { clearTimeout(cancelTimerRef.current); cancelTimerRef.current = null; }
  }

  async function loadBattle(battleId, myCode) {
    const b = await api.battle(battleId);
    setWon(b.battle.result.winner === myCode);
    setBattle(b.battle);
    setStatus("playing");
  }

  const startMatch = async () => {
    if (!pick) return;
    setStatus("queued"); setBattle(null); setWon(null); setShowCancel(false);
    try {
      const r = await api.queue(pick.id);
      if (r.status === "matched") { stopPolling(); await loadBattle(r.battleId, pick.code); return; }
      // 待機 → ポーリング開始 + 5秒後にキャンセル表示
      cancelTimerRef.current = setTimeout(() => setShowCancel(true), 5000);
      pollRef.current = setInterval(async () => {
        try {
          const p = await api.pollMatch();
          if (p.status === "matched") { stopPolling(); await loadBattle(p.battleId, pick.code); }
        } catch {}
      }, 1200);
    } catch { toast("対戦に失敗しました", "err"); setStatus("picked"); }
  };

  const cancelMatch = async () => {
    stopPolling();
    try {
      const r = await api.cancelMatch();
      if (r.status === "matched") { await loadBattle(r.battleId, pick.code); return; } // 直前に成立
    } catch {}
    setStatus("picked"); setShowCancel(false);
  };

  const onDone = () => {
    setStatus("done");
    if (won) { toast("勝利！ ガチャチケット +1 🎟", "gold"); refresh(); }
  };

  const reset = () => { stopPolling(); setStatus("idle"); setPick(null); setBattle(null); setShowCancel(false); };

  return (
    <div>
      <div className="title" style={{ marginBottom: 4 }}>対戦</div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>2人揃うとサーバーが勝敗を確定し、双方が同じリプレイを見ます。勝つとチケット +1。</div>

      {status === "idle" && (
        mons.length === 0
          ? <p className="muted">先にモンスターを召喚してください。</p>
          : <MonsterGrid monsters={mons} onPick={m => { setPick(m); setStatus("picked"); }} sub={() => "選ぶ"} />
      )}

      {status === "picked" && pick && (
        <div className="panel" style={{ textAlign: "center", padding: 24 }}>
          <div className="h">この個体で対戦</div>
          <div className="mon-stage" style={{ display: "inline-grid" }}><MonsterSprite code={pick.code} size={120} /></div>
          <div className="mon-name" style={{ marginTop: 8 }}>{pick.nickname || genStats(pick.code).name}</div>
          <div className="row" style={{ justifyContent: "center", marginTop: 16 }}>
            <button className="btn btn-primary btn-lg" onClick={startMatch}>⚔️ マッチング開始</button>
            <button className="btn" onClick={reset}>戻る</button>
          </div>
        </div>
      )}

      {status === "queued" && (
        <div className="panel" style={{ textAlign: "center", padding: 30 }}>
          <div style={{ color: "var(--accent)", marginBottom: 6 }}>マッチング中… 相手を待っています</div>
          <div className="muted" style={{ fontSize: 12 }}>{pick ? (pick.nickname || genStats(pick.code).name) : ""}</div>
          {showCancel && (
            <button className="btn btn-danger" style={{ marginTop: 16 }} onClick={cancelMatch}>キャンセル</button>
          )}
        </div>
      )}

      {(status === "playing" || status === "done") && battle && (
        <div>
          <BattleStage leftCode={battle.leftCode} rightCode={battle.rightCode} events={battle.result.events} onDone={onDone} />
          {status === "done" && (
            <div className="row" style={{ marginTop: 14, justifyContent: "center" }}>
              <div className="bignum" style={{ fontSize: 14 }}>{won ? "🏆 WIN" : "LOSE"}</div>
              <button className="btn" onClick={reset}>もう一度</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
