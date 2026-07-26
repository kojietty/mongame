import React, { useCallback, useEffect, useMemo } from "react";
import { useParams, Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { renderMd } from "../lib/md.js";

import README from "../wiki/README.md?raw";
import GameOverview from "../wiki/Game-Overview.md?raw";
import MonsterGeneration from "../wiki/Monster-Generation.md?raw";
import StatsAndAttributes from "../wiki/Stats-and-Attributes.md?raw";
import TypeSystem from "../wiki/Type-System.md?raw";
import Abilities from "../wiki/Abilities.md?raw";
import BattleSystem from "../wiki/Battle-System.md?raw";
import Training from "../wiki/Training.md?raw";
import ChallengeMode from "../wiki/Challenge-Mode.md?raw";
import GachaAndDrops from "../wiki/Gacha-and-Drops.md?raw";

const PAGES = [
  { slug: "", title: "攻略Wiki", md: README },
  { slug: "game-overview", title: "ゲーム概要", md: GameOverview },
  { slug: "monster-generation", title: "モンスター生成", md: MonsterGeneration },
  { slug: "stats-and-attributes", title: "ステータスと個体値", md: StatsAndAttributes },
  { slug: "type-system", title: "属性相性", md: TypeSystem },
  { slug: "abilities", title: "アビリティ", md: Abilities },
  { slug: "battle-system", title: "戦闘システム", md: BattleSystem },
  { slug: "training", title: "育成ガイド", md: Training },
  { slug: "challenge-mode", title: "チャレンジモード", md: ChallengeMode },
  { slug: "gacha-and-drops", title: "ガチャとドロップ率", md: GachaAndDrops },
];

const SLUG_MAP = Object.fromEntries(PAGES.map(p => [p.slug, p]));

const FILE_TO_SLUG = Object.fromEntries(
  PAGES.filter(p => p.slug).map(p => [p.slug + ".md", p.slug])
);

function resolveLink(url) {
  const base = url.replace(/^\.\//, "");
  const slug = FILE_TO_SLUG[base];
  return slug !== undefined ? "/wiki/" + slug : url;
}

export function Wiki() {
  const { "*": splat } = useParams();
  const slug = splat || "";
  const page = SLUG_MAP[slug];
  const location = useLocation();
  const navigate = useNavigate();

  const blocks = useMemo(() => page ? renderMd(page.md, resolveLink) : [], [page]);

  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);

  const handleClick = useCallback((e) => {
    const a = e.target.closest("a");
    if (!a) return;
    if (a.target && a.target !== "_self") return;
    const href = a.getAttribute("href");
    if (!href || /^(https?:|javascript:|#|mailto:)/.test(href)) return;
    e.preventDefault();
    navigate(href);
  }, [navigate]);

  if (!page) return <Navigate to="/wiki" replace />;

  return (
    <div className="wiki-layout">
      <nav className="wiki-sidebar">
        <div className="wiki-nav-title">目次</div>
        {PAGES.map(p => (
          <Link
            key={p.slug}
            to={"/wiki" + (p.slug ? "/" + p.slug : "")}
            className={"wiki-link" + (p.slug === slug ? " active" : "")}
          >
            {p.title}
          </Link>
        ))}
      </nav>
      <article className="wiki-content md-body" onClick={handleClick}>
        {blocks}
      </article>
    </div>
  );
}
