import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function writeSyntheticAdviceCard(root, options = {}) {
  const fileName = options.fileName ?? "2026-06-14_00-00-00_alpha-vs-beta_betting-advice-card.html";
  const path = join(root, fileName);
  mkdirSync(root, { recursive: true });
  writeFileSync(path, buildSyntheticAdviceHtml(options), "utf8");
  return path;
}

export function buildSyntheticAdviceHtml(options = {}) {
  const strategies = options.strategies ?? [];
  const scoreRows = options.scoreRows ?? [];
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>Synthetic parser fixture</title></head>
<body>
  <h1>${escapeHtml(options.homeName ?? "Alpha")} vs ${escapeHtml(options.awayName ?? "Beta")}</h1>
  ${strategies.map(renderStrategy).join("\n")}
  ${scoreRows.length ? renderScoreTable(scoreRows) : ""}
</body>
</html>
`;
}

function renderStrategy(strategy) {
  return `<h2>${escapeHtml(strategy.name)}</h2>
${strategy.bets.map((bet) => renderBet(bet, strategy.inline)).join("\n")}`;
}

function renderBet(bet, inline = false) {
  const detail = bet.price == null ? "price unavailable" : `price ${(bet.price * 100).toFixed(2)}c`;
  if (inline) {
    return `<div class="card"><strong>${escapeHtml(bet.market)} · ${bet.stake}u</strong><span>${detail}</span></div>`;
  }
  return `<div class="stake-card"><strong>${escapeHtml(bet.market)}</strong><span>${detail}</span><div class="stake-amount">${bet.stake}u</div></div>`;
}

function renderScoreTable(rows) {
  return `<h2>比分盈亏</h2>
<table>
  <tr><th>比分</th><th>对冲稳健版</th></tr>
  ${rows.map((row) => `<tr><td>${escapeHtml(row.score)}</td><td>${row.pnl >= 0 ? "+" : ""}${row.pnl}u</td></tr>`).join("\n")}
</table>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
