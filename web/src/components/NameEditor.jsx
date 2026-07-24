/** 公開表示名(ニックネーム)の設定モーダル。Googleアカウント名は公開されない。 */
import React, { useState } from "react";
import { api } from "../lib/api.js";
import { useMeCtx, useToast } from "../lib/store.jsx";

export function NameEditor({ onClose }) {
  const { displayName, refresh } = useMeCtx();
  const toast = useToast();
  const [name, setName] = useState(displayName || "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const v = name.trim();
    if (!v) { toast("名前を入力してください", "err"); return; }
    setBusy(true);
    try {
      await api.setName(v);
      await refresh();
      toast("プレイヤー名を設定しました", "ok");
      onClose();
    } catch { toast("設定に失敗しました", "err"); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ position: "relative", maxWidth: 380 }}>
        <button className="modal-close" onClick={onClose}>✕</button>
        <div className="modal-body">
          <div className="title" style={{ fontSize: 18 }}>プレイヤー名の設定</div>
          <div className="muted" style={{ fontSize: 12, margin: "6px 0 14px" }}>
            ランキングなどに公開される名前です。Googleアカウント名は使われません（未設定時は「プレイヤー番号」で匿名表示）。
          </div>
          <input className="input name-input" value={name} maxLength={16} autoFocus placeholder="例: ドラゴンマスター"
            onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") save(); }} />
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
            <button className="btn" onClick={onClose}>キャンセル</button>
            <button className="btn btn-primary" disabled={busy} onClick={save}>保存</button>
          </div>
        </div>
      </div>
    </div>
  );
}
