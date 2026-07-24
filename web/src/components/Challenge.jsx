/** チャレンジ: 1体で連続討伐(毎戦全回復)。撤退で報酬確定・敗北で没収。捕獲あり。 */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { genStats, challengeEnemy, trainedStats, allAbilities, challengeRewards, captureRoll, CHALLENGE_REWARD_STEP } from "@monster-game/core";
import { api } from "../lib/api.js";
import { useMeCtx, useToast } from "../lib/store.jsx";
import { MonsterSprite } from "./MonsterSprite.jsx";
import { MonsterGrid } from "./MonsterGrid.jsx";
import { BattleStage } from "./BattleStage.jsx";
import { FighterInfo } from "./FighterInfo.jsx";
import { BattleLog } from "./BattleLog.jsx";

function RewardBank({ rewards, lost }) {
  return (
    <div className={"bank" + (lost ? " reward-lost" : "")}>
      <span className="item" style={{ color: "var(--accent)" }}>🎟 {rewards.gacha}</span>
      <span className="item" style={{ color: "var(--ok)" }}>💪 {rewards.train}</span>
      <span className="item" style={{ color: "var(--SR)" }}>🧬 捕獲 {rewards.captures.length}</span>
    </div>
  );
}

export function Challenge() {
  const { me, loaded, refresh } = useMeCtx();
  const toast = useToast();
  const [mons, setMons] = useState([]);
  const [run, setRun] = useState(null);        // {id, stage, score, seed, code}
  const [phase, setPhase] = useState("select"); // select | ready | battle | result | retired
  const [fight, setFight] = useState(null);     // {events, win, stage, score, enemyCode, lostRewards}
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [best, setBest] = useState(0);          // このラン開始前の自己ベスト
  const [record, setRecord] = useState(false);  // 自己ベスト更新したか
  const [gained, setGained] = useState(null);   // 撤退で得た報酬 {gacha, train, captures}

  useEffect(() => {
    if (!me) return;
    api.monsters().then(d => setMons(d.monsters));
    api.leaderboard().then(d => setBest(d.mine?.best || 0)).catch(() => {});
    api.challengeActive().then(d => { if (d.run) { setRun(d.run); setPhase("ready"); } });
  }, [me]);

  if (loaded && !me) return <p className="muted">ログインしてください。</p>;

  const start = async (monsterId) => {
    setBusy(true);
    try { const d = await api.challengeStart(monsterId); setRun(d.run); setPhase("ready"); setReview(false); }
    catch { toast("開始に失敗しました", "err"); }
    finally { setBusy(false); }
  };

  const doFight = async () => {
    if (busy) return;
    setBusy(true);
    try { const d = await api.challengeFight(); setFight(d); setPhase("battle"); }
    catch (e) { toast(e.status === 409 ? "処理が重複しました" : "戦闘に失敗しました", "err"); setBusy(false); }
  };

  const onBattleDone = () => {
    setBusy(false);
    if (fight.win) {
      setRun(r => ({ ...r, stage: fight.stage, score: fight.score }));
      // 5体ごとの報酬到達 / 捕獲チャンスの演出(付与は撤退時)
      if (fight.score % CHALLENGE_REWARD_STEP === 0) toast(`${fight.score}体撃破! 報酬 🎟+1 💪+1（撤退で確定）`, "gold");
      if (captureRoll(run.seed, fight.score)) toast("🧬 捕獲チャンス! 撤退すれば仲間になる", "gold");
      setPhase("ready");
    } else {
      setRecord(fight.score > best);
      setPhase("result");
    }
  };

  const retire = async () => {
    setBusy(true);
    try {
      const d = await api.challengeRetire();
      setGained(d.rewards);
      setRecord(d.score > best);
      refresh(); // ヘッダーのチケット反映
      if (d.rewards.captures.length) api.monsters().then(m => setMons(m.monsters)); // 捕獲を図鑑に反映
      setPhase("retired");
    } catch { toast("撤退に失敗しました", "err"); }
    finally { setBusy(false); }
  };

  // キャラ変更: 選択画面へ戻る
  const changeChar = () => { setRun(null); setPhase("select"); setFight(null); setReview(false); setRecord(false); setGained(null); };
  // もう一度: 同じ個体で新しいランを開始(周回)。個体が見つからなければ選択へ。
  const retrySame = async () => {
    const same = mons.find(m => m.code === run?.code);
    if (!same) { changeChar(); return; }
    setFight(null); setReview(false); setRecord(false); setGained(null);
    await start(same.id);
  };

  // --- select ---
  if (phase === "select") {
    return (
      <div>
        <Header />
        {mons.length === 0
          ? <p className="muted">先にモンスターを召喚してください。</p>
          : <>
              <div className="h">挑むモンスターを選択</div>
              <MonsterGrid monsters={mons} onPick={m => { if (!busy) start(m.id); }} />
            </>}
      </div>
    );
  }

  // --- ready (次ステージ + 報酬プレビュー) ---
  if (phase === "ready" && run) {
    const enemy = challengeEnemy(run.seed, run.stage);
    const eInfo = genStats(enemy.code);
    const pending = challengeRewards(run.seed, run.score);
    const nextIn = CHALLENGE_REWARD_STEP - (run.score % CHALLENGE_REWARD_STEP);
    return (
      <div>
        <Header />
        <div className="panel" style={{ textAlign: "center" }}>
          <div className="bignum" style={{ fontSize: 20 }}>STAGE {run.stage}</div>
          <div className="muted" style={{ fontSize: 13, margin: "6px 0 4px" }}>撃破数 {run.score} ・ 全回復して挑戦</div>
          <div className="h" style={{ margin: "8px 0 2px" }}>撤退で確定する報酬</div>
          <RewardBank rewards={pending} />
          <div className="muted" style={{ fontSize: 12 }}>あと {nextIn} 体で次の 🎟+1 💪+1</div>
          {pending.captures.length > 0 && (
            <div className="cap-strip">
              {pending.captures.map(c => <div key={c.stage} className="mon-stage"><MonsterSprite code={c.code} size={40} /></div>)}
            </div>
          )}
          <div className="row" style={{ justifyContent: "center", gap: 24, marginTop: 14 }}>
            <div style={{ textAlign: "center" }}>
              <div className="mon-stage" style={{ display: "inline-grid" }}><MonsterSprite code={run.code} size={96} /></div>
              <div className="mon-sub">{mons.find(m => m.code === run.code)?.nickname || genStats(run.code).name}</div>
            </div>
            <span className="vs inline">VS</span>
            <div style={{ textAlign: "center" }}>
              <div className="mon-stage" style={{ display: "inline-grid" }}><MonsterSprite code={enemy.code} size={96} facing={-1} /></div>
              <div className="mon-sub">{eInfo.name}（強化）</div>
            </div>
          </div>
          <div className="row" style={{ justifyContent: "center", marginTop: 18 }}>
            <button className="btn btn-primary btn-lg" disabled={busy} onClick={doFight}>戦う</button>
            <button className="btn btn-danger" disabled={busy} onClick={retire}>撤退して報酬確定</button>
          </div>
        </div>
      </div>
    );
  }

  // --- battle ---
  if (phase === "battle" && fight && run) {
    return (
      <div>
        <Header />
        <BattleStage leftCode={run.code} rightCode={fight.enemyCode} events={fight.events} onDone={onBattleDone}
          leftLabel={mons.find(m => m.code === run.code)?.nickname || genStats(run.code).name}
          rightLabel={genStats(fight.enemyCode).name + "（強化）"} />
      </div>
    );
  }

  // --- retired (報酬確定画面) ---
  if (phase === "retired" && gained) {
    return (
      <div>
        <Header />
        <div className="panel" style={{ textAlign: "center", padding: 30 }}>
          <div style={{ fontSize: 38 }}>🏳️</div>
          <div className="muted" style={{ marginTop: 2 }}>撤退 ・ 討伐 {run?.score ?? 0} 体</div>
          {record && <div className="newrec">🏆 NEW RECORD!</div>}
          <div className="h" style={{ marginTop: 8 }}>獲得報酬</div>
          <RewardBank rewards={gained} />
          {gained.captures.length > 0 && (
            <>
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>仲間になった！</div>
              <div className="cap-strip">
                {gained.captures.map(c => (
                  <div key={c.stage} style={{ textAlign: "center" }}>
                    <div className="mon-stage"><MonsterSprite code={c.code} size={56} /></div>
                    <div className="mon-sub">{genStats(c.code).name}</div>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="row" style={{ justifyContent: "center", marginTop: 18 }}>
            <button className="btn btn-primary" disabled={busy} onClick={retrySame}>もう一度（同じ個体）</button>
            <button className="btn" disabled={busy} onClick={changeChar}>キャラ変更</button>
            <Link to="/ranking"><button className="btn">ランキング</button></Link>
          </div>
        </div>
      </div>
    );
  }

  // --- result (敗北 = 報酬没収) ---
  let myFI = null, enFI = null;
  if (fight && run) {
    const enemy = challengeEnemy(run.seed, fight.stage);
    enFI = { code: enemy.code, name: enemy.info.name + "（強化）", rarityName: enemy.info.rarity.name, types: enemy.info.types, stats: enemy.info.stats, abilities: enemy.info.abilities };
    const mine = mons.find(m => m.code === run.code);
    const gi = genStats(run.code);
    myFI = mine
      ? { code: run.code, name: mine.nickname || gi.name, rarityName: gi.rarity.name, types: gi.types, stats: trainedStats(mine.train), abilities: allAbilities(mine.train) }
      : { code: run.code, name: gi.name, rarityName: gi.rarity.name, types: gi.types, stats: gi.stats, abilities: gi.abilities };
  }
  const lost = fight?.lostRewards;

  return (
    <div>
      <Header />
      <div className="panel" style={{ textAlign: "center", padding: 30 }}>
        <div style={{ fontSize: 40 }}>💀</div>
        <div className="muted" style={{ marginTop: 4 }}>STAGE {fight?.stage} で敗北</div>
        <div className="bignum" style={{ fontSize: 30, margin: "10px 0" }}>{fight?.score ?? 0}</div>
        <div className="muted" style={{ fontSize: 12 }}>体を討伐した</div>
        {record && <div className="newrec">🏆 NEW RECORD!</div>}
        {lost && (lost.gacha > 0 || lost.captures.length > 0) && (
          <>
            <div className="h" style={{ marginTop: 12, color: "var(--danger)" }}>逃した報酬（撤退していれば…）</div>
            <RewardBank rewards={lost} lost />
          </>
        )}
        <div className="row" style={{ justifyContent: "center", marginTop: 18 }}>
          <button className="btn btn-primary" disabled={busy} onClick={retrySame}>もう一度（同じ個体）</button>
          <button className="btn" disabled={busy} onClick={changeChar}>キャラ変更</button>
          <button className="btn" onClick={() => setReview(v => !v)}>{review ? "閉じる" : "⚔️ 対戦を振り返る"}</button>
          <Link to="/ranking"><button className="btn">ランキング</button></Link>
        </div>
      </div>

      {review && fight && (
        <div style={{ marginTop: 14 }}>
          <div className="h">最終戦(STAGE {fight.stage})の詳細</div>
          <div className="row" style={{ alignItems: "stretch", gap: 12 }}>
            {myFI && <FighterInfo {...myFI} tag="あなた" />}
            {enFI && <FighterInfo {...enFI} tag={`STAGE ${fight.stage} の敵`} />}
          </div>
          <div className="h" style={{ marginTop: 14 }}>対戦ログ</div>
          <BattleLog events={fight.events} style={{ maxHeight: 260 }} />
        </div>
      )}
    </div>
  );
}

function Header() {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="title">🔥 チャレンジ</div>
      <div className="muted" style={{ fontSize: 13 }}>連続討伐。撤退で報酬確定、敗北すると没収。5体ごとに 🎟+1 💪+1、敵を稀に捕獲。</div>
    </div>
  );
}
