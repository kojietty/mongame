import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import { Dex } from "./components/Dex.jsx";
import { Gacha } from "./components/Gacha.jsx";
import { Trainer } from "./components/Trainer.jsx";
import { Arena } from "./components/Arena.jsx";
import { Challenge } from "./components/Challenge.jsx";
import { Leaderboard } from "./components/Leaderboard.jsx";
import { Wiki } from "./components/Wiki.jsx";
import { MeProvider, ToastProvider, useMeCtx, useToast } from "./lib/store.jsx";
import { NameEditor } from "./components/NameEditor.jsx";
import { authUrl, api } from "./lib/api.js";
import "./app.css";

const NAV = [
  { to: "/", label: "図鑑", ic: "📖", end: true },
  { to: "/gacha", label: "召喚", ic: "🎰" },
  { to: "/train", label: "育成", ic: "💪" },
  { to: "/arena", label: "対戦", ic: "⚔️" },
  { to: "/challenge", label: "挑戦", ic: "🔥" },
  { to: "/ranking", label: "順位", ic: "🏆" },
  { to: "/wiki", label: "Wiki", ic: "📚" },
];

function TopBar() {
  const { me, displayName, tickets, trainTickets, dailyClaimed, refresh } = useMeCtx();
  const toast = useToast();
  const [editName, setEditName] = useState(false);
  const claim = async () => {
    try {
      const d = await api.claim();
      if (d.claimed) toast(`デイリーチケット +1 🎟 (${d.tickets})`, "ok");
      else toast("本日は受取済みです", "");
      refresh();
    } catch { toast("受け取りに失敗しました", "err"); }
  };
  return (
    <header className="topbar">
      <div className="brand"><span className="dot" />MONSTER LAB</div>
      <nav className="tabs">
        {NAV.map(n => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => "tab" + (isActive ? " active" : "")}>{n.label}</NavLink>
        ))}
      </nav>
      <div className="topbar-right">
        {me ? (
          <>
            <span className="ticket-chip">🎟 {tickets}</span>
            {trainTickets > 0 && <span className="ticket-chip train" title="育成チケット(上限を超えて育成)">💪 {trainTickets}</span>}
            <button className="claim-btn" onClick={claim} disabled={dailyClaimed}>{dailyClaimed ? "受取済" : "デイリー"}</button>
            <span className="user-tag">
              <button className={"name-btn" + (displayName ? "" : " unset")} onClick={() => setEditName(true)} title="プレイヤー名を変更">
                {displayName || "＋名前を設定"}
              </button>
              {" · "}<a href={authUrl("/auth/logout")}>ログアウト</a>
            </span>
          </>
        ) : (
          <a href={authUrl("/auth/google/start")}><button className="btn btn-primary">Googleでログイン</button></a>
        )}
      </div>
      {editName && <NameEditor onClose={() => setEditName(false)} />}
    </header>
  );
}

function TabBar() {
  const { me } = useMeCtx();
  if (!me) return null;
  return (
    <nav className="tabbar">
      {NAV.map(n => (
        <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? "active" : "")}>
          <span className="ic">{n.ic}</span>{n.label}
        </NavLink>
      ))}
    </nav>
  );
}

function App() {
  return (
    <BrowserRouter>
      <MeProvider>
        <ToastProvider>
          <div className="shell">
            <TopBar />
            <main className="wrap">
              <Routes>
                <Route path="/" element={<Dex />} />
                <Route path="/gacha" element={<Gacha />} />
                <Route path="/train" element={<Trainer />} />
                <Route path="/arena" element={<Arena />} />
                <Route path="/challenge" element={<Challenge />} />
                <Route path="/ranking" element={<Leaderboard />} />
                <Route path="/wiki" element={<Wiki />} />
                <Route path="/wiki/*" element={<Wiki />} />
                <Route path="*" element={<Navigate to="/" />} />
              </Routes>
            </main>
            <TabBar />
          </div>
        </ToastProvider>
      </MeProvider>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")).render(<App />);
