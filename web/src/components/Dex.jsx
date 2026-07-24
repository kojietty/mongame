/** 図鑑: 所持モンスター一覧(ソート・詳細モーダル・売却)。召喚は /gacha に分離。 */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { useMeCtx, useToast } from "../lib/store.jsx";
import { MonsterGrid } from "./MonsterGrid.jsx";
import { MonsterDetail } from "./MonsterDetail.jsx";

export function Dex() {
  const { me, loaded, refresh } = useMeCtx();
  const toast = useToast();
  const [mons, setMons] = useState([]);
  const [monsLoaded, setMonsLoaded] = useState(false);
  const [sel, setSel] = useState(null);        // 詳細モーダル対象
  const [sellMode, setSellMode] = useState(false);
  const [picked, setPicked] = useState([]);    // 売却選択中のid配列
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!me) return;
    api.monsters().then(d => { setMons(d.monsters); setMonsLoaded(true); }).catch(() => setMonsLoaded(true));
  }, [me]);

  const onChange = (upd) => {
    setMons(ms => ms.map(m => m.id === upd.id ? { ...m, ...upd } : m));
    setSel(s => s && s.id === upd.id ? { ...s, ...upd } : s);
  };

  const exitSell = () => { setSellMode(false); setPicked([]); };
  const togglePick = (m) => setPicked(p => p.includes(m.id) ? p.filter(x => x !== m.id) : [...p, m.id]);

  const sell = async () => {
    if (picked.length === 0 || picked.length % 10 !== 0 || busy) return;
    if (!window.confirm(`${picked.length} 匹を売却して育成チケット ${picked.length / 10} 枚に変換します。よろしいですか？`)) return;
    setBusy(true);
    try {
      const d = await api.sell(picked);
      toast(`${d.sold} 匹を売却 → 育成チケット +${d.granted} 💪`, "gold");
      setMons(ms => ms.filter(m => !picked.includes(m.id)));
      exitSell(); refresh();
    } catch (e) {
      toast(e.status === 400 ? "選択が不正です（お気に入りは売却不可）" : "売却に失敗しました", "err");
    } finally { setBusy(false); }
  };

  if (loaded && !me) return <LoginGate />;

  const remainder = picked.length % 10;
  const canSell = picked.length >= 10 && remainder === 0;

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div className="title">図鑑</div>
          <div className="muted" style={{ fontSize: 13 }}>所持モンスター {mons.length} 体</div>
        </div>
        <div className="row">
          {mons.length > 0 && (
            sellMode
              ? <button className="btn" onClick={exitSell}>売却をやめる</button>
              : <button className="btn" onClick={() => setSellMode(true)}>🪙 売却</button>
          )}
          <Link to="/gacha"><button className="btn btn-primary">🎰 召喚へ</button></Link>
        </div>
      </div>

      {sellMode && (
        <div className="panel" style={{ marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div className="muted" style={{ fontSize: 13 }}>
            10匹ごとに育成チケット💪1枚。お気に入り⭐は選べません。<br />
            <b style={{ color: "var(--text)" }}>選択 {picked.length} 匹</b>
            {remainder !== 0 && <span style={{ color: "var(--danger)" }}> ・ あと {10 - remainder} 匹で {Math.floor(picked.length / 10) + 1} 枚</span>}
            {canSell && <span style={{ color: "var(--ok)" }}> → 💪{picked.length / 10} 枚</span>}
          </div>
          <button className="btn btn-primary" disabled={!canSell || busy} onClick={sell}>売却する</button>
        </div>
      )}

      {/* 読み込み完了までは空状態(初回20連)を出さない */}
      {!monsLoaded ? (
        <div className="muted" style={{ padding: 30, textAlign: "center" }}>読み込み中…</div>
      ) : mons.length === 0 ? (
        <div className="panel" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🥚</div>
          <div className="muted">まだモンスターがいません。</div>
          <Link to="/gacha"><button className="btn btn-primary btn-lg" style={{ marginTop: 14 }}>初回20連を引く</button></Link>
        </div>
      ) : sellMode ? (
        <MonsterGrid monsters={mons} onPick={togglePick} selectedIds={picked} isDisabled={m => m.favorite}
          sub={m => m.favorite ? "⭐保護中" : "タップで選択"} />
      ) : (
        <MonsterGrid monsters={mons} onPick={setSel} />
      )}

      {sel && <MonsterDetail monster={sel} onClose={() => setSel(null)} onChange={onChange} />}
    </div>
  );
}

function LoginGate() {
  return (
    <div className="panel" style={{ textAlign: "center", padding: 48 }}>
      <div style={{ fontSize: 44, marginBottom: 10 }}>🧬</div>
      <div className="title">MONSTER LAB へようこそ</div>
      <div className="muted" style={{ maxWidth: 380, margin: "8px auto 0" }}>
        Googleでログインすると、あなただけのモンスターを召喚・育成し、対戦やチャレンジに挑めます。
      </div>
    </div>
  );
}
