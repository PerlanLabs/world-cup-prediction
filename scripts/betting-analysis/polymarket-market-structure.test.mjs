import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPolymarketMarketStructure,
  isotonicNonIncreasing,
} from "./polymarket-market-structure.mjs";

test("isotonicNonIncreasing repairs cumulative-probability violations", () => {
  const adjusted = isotonicNonIncreasing([0.62, 0.36, 0.38, 0.12]);

  assert.deepEqual(adjusted, [0.62, 0.37, 0.37, 0.12]);
});

test("market structure reconstructs fixed-contract curves and detects localized favorite strengthening", () => {
  const structure = buildPolymarketMarketStructure({
    event: {
      id: "event-1",
      slug: "fifwc-fra-mar-2026-07-09",
      title: "France vs. Morocco",
      teams: [
        { name: "France", ordering: "home" },
        { name: "Morocco", ordering: "away" },
      ],
    },
    cutoffTs: 100_000,
    rows: buildRows(),
  });

  assert.equal(structure.teams.favorite, "France");
  assert.equal(structure.stageStructures.close.margin.available, true);
  assert.equal(structure.stageStructures.close.margin.medianMargin, 1);
  assert.equal(structure.stageStructures.close.margin.homeWinBy2Plus, 0.36);
  assert.equal(structure.stageStructures.close.totalGoals.over2_5, 0.52);
  assert.equal(structure.stageStructures.close.totalGoals.medianGoals, 3);
  assert.equal(structure.keyMarkets.find((market) => market.key === "favorite_minus_1_5").changes.full.percentagePoints, 4);
  assert.ok(structure.signals.some((signal) => signal.code === "favorite_tail_strengthening"));
  assert.ok(structure.signals.some((signal) => signal.code === "two_goal_concentration"));
  assert.ok(structure.signals.some((signal) => signal.code === "home_scoring_drives_over"));
  assert.equal(structure.quality.readiness, "ready");
});

function buildRows() {
  return [
    row("moneyline", "France", null, 0.60, 0.60, { selectionLine: "home", outcome: "Yes" }),
    row("moneyline", "Draw", null, 0.25, 0.25, { selectionLine: "draw", outcome: "Yes" }),
    row("moneyline", "Morocco", null, 0.15, 0.15, { selectionLine: "away", outcome: "Yes" }),
    row("spreads", "France -1.5", -1.5, 0.32, 0.36, { outcome: "France", h1: 0.34 }),
    row("spreads", "France -2.5", -2.5, 0.15, 0.15, { outcome: "France" }),
    row("spreads", "Morocco -1.5", -1.5, 0.04, 0.04, { outcome: "Morocco" }),
    row("spreads", "Morocco -2.5", -2.5, 0.01, 0.01, { outcome: "Morocco" }),
    row("totals", "Over 0.5", 0.5, 0.93, 0.94, { selectionLine: "over", outcome: "Over" }),
    row("totals", "Over 1.5", 1.5, 0.76, 0.77, { selectionLine: "over", outcome: "Over" }),
    row("totals", "Over 2.5", 2.5, 0.47, 0.52, { selectionLine: "over", outcome: "Over", h1: 0.49 }),
    row("totals", "Over 3.5", 3.5, 0.30, 0.30, { selectionLine: "over", outcome: "Over" }),
    row("totals", "Over 4.5", 4.5, 0.14, 0.14, { selectionLine: "over", outcome: "Over" }),
    row("team_totals", "France Over 0.5", 0.5, 0.86, 0.87, { selectionLine: "over", outcome: "Over" }),
    row("team_totals", "France Over 1.5", 1.5, 0.54, 0.58, { selectionLine: "over", outcome: "Over" }),
    row("team_totals", "France Over 2.5", 2.5, 0.27, 0.28, { selectionLine: "over", outcome: "Over" }),
    row("team_totals", "Morocco Over 0.5", 0.5, 0.55, 0.56, { selectionLine: "over", outcome: "Over" }),
    row("team_totals", "Morocco Over 1.5", 1.5, 0.18, 0.18, { selectionLine: "over", outcome: "Over" }),
    row("both_teams_to_score", "Yes", null, 0.49, 0.51, { outcome: "Yes" }),
  ];
}
function row(category, selection, line, opening, close, options = {}) {
  const firstTimestamp = 10_000;
  const closeTimestamp = 100_000;
  const stagePrice = options.h1 ?? opening;
  return {
    category,
    selection,
    line,
    outcome: options.outcome ?? "Yes",
    selectionLine: options.selectionLine ?? null,
    marketSlug: `${category}-${selection.toLowerCase().replaceAll(" ", "-")}`,
    tokenId: `${category}-${selection}`,
    status: "available",
    openingCoverage: { status: "near_market_creation" },
    movement: {
      firstObserved: { timestamp: firstTimestamp, price: opening },
      preKickoff: { timestamp: closeTimestamp, price: close },
      windows: {
        d7: null,
        h72: { anchor: { timestamp: 20_000, price: opening } },
        h24: { anchor: { timestamp: 60_000, price: opening } },
        h6: { anchor: { timestamp: 80_000, price: opening } },
        h1: { anchor: { timestamp: 96_400, price: stagePrice } },
      },
      quality: { status: "usable", analysisStatus: "usable", warnings: [] },
    },
  };
}
