/** 図鑑: 所持モンスター一覧(ソート・詳細モーダル)。召喚は /gacha に分離。 */
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { useMeCtx } from "../lib/store.jsx";
import { MonsterGrid } from "./MonsterGrid.jsx";
import { MonsterDetail } from "./MonsterDetail.jsx";

export function Dex() {
  const { me, loaded } = useMeCtx();
  const [mons, setMons] = useState([]);
  const [monsLoaded, setMonsLoaded] = useState(false);
  const [sel, setSel] = useState(null);   // 詳細モーダル対象

  useEffect(() => {
    if (!me) return;
    api.monsters().then(d => { setMons(d.monsters); setMonsLoaded(true); }).catch(() => setMonsLoaded(true));
  }, [me]);

  const onChange = (upd) => {
    setMons(ms => ms.map(m => m.id === upd.id ? { ...m, ...upd } : m));
    setSel(s => s && s.id === upd.id ? { ...s, ...upd } : s);
  };

  if (loaded && !me) return <LoginGate />;

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div className="title">図鑑</div>
          <div className="muted" style={{ fontSize: 13 }}>所持モンスター {mons.length} 体</div>
        </div>
        <Link to="/gacha"><button className="btn btn-primary">🎰 召喚へ</button></Link>
      </div>

      {/* 読み込み完了までは空状態(初回20連)を出さない */}
      {!monsLoaded ? (
        <div className="muted" style={{ padding: 30, textAlign: "center" }}>読み込み中…</div>
      ) : mons.length === 0 ? (
        <div className="panel" style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🥚</div>
          <div className="muted">まだモンスターがいません。</div>
          <Link to="/gacha"><button className="btn btn-primary btn-lg" style={{ marginTop: 14 }}>初回20連を引く</button></Link>
        </div>
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
