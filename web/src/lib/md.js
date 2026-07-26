import React from "react";

function addBr(tokens) {
  const out = [];
  for (const t of tokens) {
    if (typeof t !== "string") { out.push(t); continue; }
    const parts = t.split("\n");
    for (let j = 0; j < parts.length; j++) {
      if (j > 0) out.push(React.createElement("br"));
      if (parts[j]) out.push(parts[j]);
    }
  }
  return out;
}

function inline(text, resolveLink) {
  const tokens = [];
  let rest = text;

  while (rest.length > 0) {
    let bestType = null, bestIdx = Infinity, bestM = null;
    for (const [type, re] of [
      ["link", /\[([^\]]+)\]\(([^)]+)\)/],
      ["bold", /\*\*(.+?)\*\*/],
      ["code", /`([^`]+)`/],
      ["italic", /\*(.+?)\*/],
    ]) {
      const m = rest.match(re);
      if (m && m.index < bestIdx) { bestType = type; bestIdx = m.index; bestM = m; }
    }
    if (!bestType) { tokens.push(rest); break; }
    if (bestIdx > 0) tokens.push(rest.slice(0, bestIdx));
    if (bestType === "link") {
      const href = resolveLink ? resolveLink(bestM[2]) : bestM[2];
      tokens.push(React.createElement("a", { href }, bestM[1]));
    } else if (bestType === "bold") {
      tokens.push(React.createElement("strong", null, bestM[1]));
    } else if (bestType === "italic") {
      tokens.push(React.createElement("em", null, bestM[1]));
    } else {
      tokens.push(React.createElement("code", null, bestM[1]));
    }
    rest = rest.slice(bestIdx + bestM[0].length);
  }
  return addBr(tokens);
}

export function renderMd(src, resolveLink) {
  const lines = src.split("\n");
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const ln = lines[i];
    const key = blocks.length;

    if (ln.trim() === "") { i++; continue; }

    if (/^---+\s*$/.test(ln)) {
      blocks.push(React.createElement("hr", { key }));
      i++; continue;
    }

    const fenceMatch = ln.match(/^```(\w*)/);
    if (fenceMatch) {
      const lang = fenceMatch[1];
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) { code.push(lines[i]); i++; }
      i++;
      blocks.push(React.createElement("pre", { key },
        React.createElement("code", lang ? { className: "lang-" + lang } : null, code.join("\n"))
      ));
      continue;
    }

    if (ln.includes("|") && i + 1 < lines.length && /^\|?\s*-+/.test(lines[i + 1].replace(/\|/g, "").trim())) {
      const parseRow = r => r.replace(/^\||\|$/g, "").split("|").map(c => inline(c.trim(), resolveLink));
      const header = parseRow(ln);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(parseRow(lines[i])); i++;
      }
      blocks.push(React.createElement("table", { key },
        React.createElement("thead", null,
          React.createElement("tr", null,
            ...header.map((h, j) => React.createElement("th", { key: j }, h))
          )
        ),
        React.createElement("tbody", null,
          ...rows.map((r, ri) =>
            React.createElement("tr", { key: ri },
              ...r.map((c, ci) => React.createElement("td", { key: ci }, c))
            )
          )
        )
      ));
      continue;
    }

    const hMatch = ln.match(/^(#{1,4})\s+(.+)/);
    if (hMatch) {
      const tag = "h" + hMatch[1].length;
      blocks.push(React.createElement(tag, { key }, inline(hMatch[2], resolveLink)));
      i++; continue;
    }

    if (ln.startsWith("> ")) {
      const bq = [];
      while (i < lines.length && lines[i].startsWith("> ")) { bq.push(lines[i].slice(2)); i++; }
      blocks.push(React.createElement("blockquote", { key }, inline(bq.join(" "), resolveLink)));
      continue;
    }

    if (/^\d+\.\s/.test(ln)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(inline(lines[i].replace(/^\d+\.\s+/, ""), resolveLink));
        i++;
      }
      blocks.push(React.createElement("ol", { key },
        ...items.map((item, j) => React.createElement("li", { key: j }, item))
      ));
      continue;
    }

    if (/^[-*]\s/.test(ln)) {
      const items = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push(inline(lines[i].replace(/^[-*]\s+/, ""), resolveLink));
        i++;
      }
      blocks.push(React.createElement("ul", { key },
        ...items.map((item, j) => React.createElement("li", { key: j }, item))
      ));
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() !== "" && !lines[i].startsWith("#") && !lines[i].startsWith("```") && !lines[i].startsWith("> ") && !/^---+\s*$/.test(lines[i]) && !/^[-*]\s/.test(lines[i]) && !/^\d+\.\s/.test(lines[i])) {
      para.push(lines[i]); i++;
    }
    if (para.length) {
      blocks.push(React.createElement("p", { key }, inline(para.join("\n"), resolveLink)));
    }
  }
  return blocks;
}
