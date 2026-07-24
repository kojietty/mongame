/** ランキング: チャレンジのスコア上位20 + 自己ベスト。 */
import React, { useEffect, useState } from "react";
import { genStats } from "@monster-game/core";
import { api } from "../lib/api.js";
import { useMeCtx } from "../lib/store.jsx";
import { MonsterSprite } from "./MonsterSprite.jsx";

export function Leaderboard() {
  const { me, loaded } = useMeCtx();
  const [data, setData] = useState(null);
  useEffect(() => { if (me) api.leaderboard().then(setData).catch(() => setData({ top: [], mine: { best: 0 } })); }, [me]);

  if (loaded && !me) return <p className="muted">ログインしてください。</p>;
  if (!data) return <p className="muted">読み込み中…</p>;

  const inTop = data.top.some(r => r.user_id === me?.id);

  return (
    <div>
      <div className="title" style={{ marginBottom: 4 }}>🏆 ランキング</div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 14 }}>チャレンジモードの最高討伐数</div>

      <div className="panel">
        {data.top.length === 0 && <div className="muted" style={{ textAlign: "center", padding: 20 }}>まだ記録がありません。挑戦して1位を狙おう！</div>}
        {data.top.map((r, i) => (
          <div key={r.user_id} className={"lb-row" + (r.user_id === me?.id ? " me" : "")}>
            <div className={"lb-rank" + (i < 3 ? " top" : "")}>{i + 1}</div>
            <div className="mon-stage" style={{ padding: 3, margin: 0 }}><MonsterSprite code={r.code} size={34} /></div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{r.name}</div>
              <div className="mon-sub">{genStats(r.code).name}</div>
            </div>
            <div className="lb-score">{r.score}</div>
          </div>
        ))}
      </div>

      {!inTop && (
        <div className="panel" style={{ marginTop: 12, textAlign: "center" }}>
          <span className="muted" style={{ fontSize: 13 }}>あなたの自己ベスト </span>
          <span className="lb-score" style={{ fontSize: 18 }}>{data.mine.best}</span>
        </div>
      )}
    </div>
  );
}
