/** モンスター詳細モーダル: ステータス表示 + 育成/お気に入り/名前変更。 */
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { genStats, trainedStats, allAbilities, aptFor, APT_GRADES, STAT_NAMES, TYPES, typeIdx, describe } from "@monster-game/core";
import { api } from "../lib/api.js";
import { useToast } from "../lib/store.jsx";
import { MonsterSprite } from "./MonsterSprite.jsx";
import { rarityTextClass, ringClass, stripTags } from "../lib/ui.js";

export function MonsterDetail({ monster, onClose, onChange }) {
  const nav = useNavigate();
  const toast = useToast();
  const info = genStats(monster.code);
  const rn = info.rarity.name;
  const cur = trainedStats(monster.train);
  const apt = aptFor(monster.code);
  const [fav, setFav] = useState(monster.favorite);
  const [editing, setEditing] = useState(false);
  const [nick, setNick] = useState(monster.nickname || "");
  const [busy, setBusy] = useState(false);

  const toggleFav = async () => {
    const next = !fav; setFav(next);
    try { await api.favorite(monster.id, next); onChange && onChange({ ...monster, favorite: next }); }
    catch { setFav(!next); toast("更新に失敗しました", "err"); }
  };

  const saveName = async () => {
    setBusy(true);
    try {
      const d = await api.rename(monster.id, nick);
      onChange && onChange({ ...monster, nickname: d.nickname });
      setEditing(false);
      toast(d.nickname ? "名前を変更しました" : "名前をリセットしました", "ok");
    } catch { toast("変更に失敗しました", "err"); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ position: "relative" }}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-body">
          <div style={{ textAlign: "center" }}>
            <div className={"mon-stage " + ringClass(rn)} style={{ display: "inline-grid", padding: 14 }}>
              <MonsterSprite code={monster.code} size={132} />
            </div>
            <div style={{ marginTop: 10 }}>
              <span style={{ fontSize: 18, fontWeight: 700 }}>{monster.nickname || info.name}</span>{" "}
              <span className={"stars " + rarityTextClass(rn)}>{info.rarity.stars}</span>
            </div>
            {monster.nickname && <div className="mon-sub">（{info.name}）</div>}
            <div className="chips" style={{ marginTop: 6 }}>
              {info.types.map((t, i) => <span key={i} className="chip" style={{ background: TYPES[typeIdx(t)].css }}>{TYPES[typeIdx(t)].name}</span>)}
            </div>
            <div className="mon-sub" style={{ marginTop: 4 }}>Lv{monster.train.level} ・ 歪み {monster.train.dist}/240</div>
          </div>

          {editing ? (
            <div className="row" style={{ marginTop: 12 }}>
              <input className="input name-input" value={nick} maxLength={12} placeholder="新しい名前(空で解除)"
                onChange={e => setNick(e.target.value)} autoFocus />
              <button className="btn btn-primary" disabled={busy} onClick={saveName}>保存</button>
              <button className="btn" onClick={() => { setEditing(false); setNick(monster.nickname || ""); }}>取消</button>
            </div>
          ) : (
            <div className="row" style={{ marginTop: 12, justifyContent: "center" }}>
              <button className="btn btn-primary" onClick={() => nav("/train?m=" + monster.id)}>💪 育成する</button>
              <button className="btn" onClick={toggleFav}>{fav ? "★ お気に入り解除" : "☆ お気に入り"}</button>
              <button className="btn" onClick={() => setEditing(true)}>✎ 名前変更</button>
            </div>
          )}

          <table className="stat-tbl" style={{ marginTop: 16 }}>
            <tbody>
              {STAT_NAMES.map((s, i) => (
                <tr key={i}>
                  <td className="muted" style={{ width: "5em" }}>{s}</td>
                  <td style={{ width: "1.6em", textAlign: "center", color: APT_GRADES[apt[i]][3], fontWeight: 700 }}>{APT_GRADES[apt[i]][0]}</td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>{cur[i]}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 12 }}>
            {allAbilities(monster.train).map((a, i) => (
              <div key={i} className={"abil" + (a.eff.pdx ? " pdx" : "")} style={{ padding: "3px 0" }}>
                {a.label} {stripTags(describe(a.eff))}{a.grown ? " 〔後天〕" : ""}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
