/** グローバル状態: ログインユーザー+チケット残高(MeContext) とトースト。 */
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "./api.js";

const MeCtx = createContext(null);
const ToastCtx = createContext(() => {});

export function MeProvider({ children }) {
  const [state, setState] = useState({ me: null, displayName: null, tickets: 0, trainTickets: 0, dailyClaimed: false, loaded: false });
  const refresh = useCallback(async () => {
    try {
      const d = await api.me();
      setState({ me: d.user, displayName: d.displayName || null, tickets: d.tickets, trainTickets: d.trainTickets || 0, dailyClaimed: d.dailyClaimed, loaded: true });
    } catch {
      setState({ me: null, displayName: null, tickets: 0, trainTickets: 0, dailyClaimed: false, loaded: true });
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return <MeCtx.Provider value={{ ...state, refresh, setState }}>{children}</MeCtx.Provider>;
}
export const useMeCtx = () => useContext(MeCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((text, kind = "") => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, text, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map(t => <div key={t.id} className={"toast " + t.kind}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
