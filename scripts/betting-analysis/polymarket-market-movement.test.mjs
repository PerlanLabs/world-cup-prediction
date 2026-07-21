import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildMovementSnapshot,
  buildMarketInventory,
  buildMovementDataQuality,
  classifyMovement,
  normalizePriceHistory,
  resolvePaperTraderDataDir,
  resolvePaperTraderExecutable,
  summarizeOpeningCoverage,
  summarizePriceHistory,
} from "./polymarket-market-movement.mjs";

test("PaperTrader paths support explicit configuration and PATH fallback", () => {
  assert.equal(resolvePaperTraderExecutable("pm-trader-custom"), "pm-trader-custom");
  assert.equal(resolvePaperTraderExecutable("", { fileExists: () => false }), "pm-trader");
  assert.equal(resolvePaperTraderDataDir("./paper-data"), join(process.cwd(), "paper-data"));
});

test("normalizePriceHistory sorts, deduplicates, and filters invalid rows", () => {
  const points = normalizePriceHistory({ history: [
    { t: 300, p: "0.62" },
    { t: 100, p: "0.55" },
    { t: 300, p: "0.63" },
    { t: "bad", p: 0.50 },
    { t: 400, p: 1.2 },
  ] });

  assert.deepEqual(points, [
    { timestamp: 100, price: 0.55 },
    { timestamp: 300, price: 0.63 },
  ]);
});

test("summarizePriceHistory reports pre-kickoff and late-window movement", () => {
  const cutoffTs = 100_000;
  const points = [
    { timestamp: cutoffTs - 90_000, price: 0.50 },
    { timestamp: cutoffTs - 86_400, price: 0.52 },
    { timestamp: cutoffTs - 21_600, price: 0.55 },
    { timestamp: cutoffTs - 3_600, price: 0.58 },
    { timestamp: cutoffTs - 60, price: 0.60 },
    { timestamp: cutoffTs + 60, price: 0.95 },
  ];

  const summary = summarizePriceHistory(points, { cutoffTs });

  assert.equal(summary.pointCount, 5);
  assert.equal(summary.firstObserved.price, 0.50);
  assert.equal(summary.preKickoff.price, 0.60);
  assert.equal(summary.change.percentagePoints, 10);
  assert.equal(summary.windows.h24.percentagePoints, 8);
  assert.equal(summary.windows.h6.percentagePoints, 5);
  assert.equal(summary.windows.h1.percentagePoints, 2);
  assert.equal(summary.quality.status, "usable");
});

test("classifyMovement uses explicit percentage-point thresholds", () => {
  assert.equal(classifyMovement(6), "strong_support_increase");
  assert.equal(classifyMovement(2.5), "support_increase");
  assert.equal(classifyMovement(-5), "strong_support_decrease");
  assert.equal(classifyMovement(-2.1), "support_decrease");
  assert.equal(classifyMovement(1.9), "flat");
});

test("summarizePriceHistory flags suspicious initialization anchors without rewriting prices", () => {
  const summary = summarizePriceHistory([
    { timestamp: 100, price: 0.5 },
    { timestamp: 200, price: 0.04 },
    { timestamp: 300, price: 0.02 },
  ], { cutoffTs: 400, fidelityMinutes: 15 });

  assert.equal(summary.firstObserved.price, 0.5);
  assert.equal(summary.preKickoff.price, 0.02);
  assert.equal(summary.quality.status, "usable");
  assert.equal(summary.quality.analysisStatus, "review");
  assert.ok(summary.quality.warnings.includes("suspected_market_initialization_anchor"));
  assert.ok(summary.quality.warnings.includes("large_single_step_move"));
});

test("market inventory preserves excluded markets and explains history scope", () => {
  const markets = [
    mockMarket("moneyline-market", "moneyline", "yes-1"),
    mockMarket("player-market", "player_shots", "yes-2"),
  ];
  const rows = [{
    tokenId: "yes-1",
    status: "available",
    movement: { quality: { status: "usable", analysisStatus: "usable", warnings: [] } },
  }];
  const inventory = buildMarketInventory(markets, rows, {
    selectedCategories: new Set(["moneyline"]),
    limit: 120,
  });

  assert.equal(inventory.length, 2);
  assert.equal(inventory[0].history.decision, "tracked");
  assert.equal(inventory[1].history.decision, "category_scope_excluded");
});

test("data quality distinguishes complete inventory from scoped history", () => {
  const markets = [
    mockMarket("moneyline-market", "moneyline", "yes-1"),
    mockMarket("player-market", "player_shots", "yes-2"),
  ];
  const rows = [{
    tokenId: "yes-1",
    status: "available",
    discardedPointCount: 0,
    history: [{ timestamp: 100, price: 0.5 }],
    movement: { quality: { status: "usable", analysisStatus: "usable", warnings: [] } },
  }];
  const inventory = buildMarketInventory(markets, rows, {
    selectedCategories: new Set(["moneyline"]),
    limit: 120,
  });
  const quality = buildMovementDataQuality({
    cutoffTs: 200,
    markets,
    marketInventory: inventory,
    rows,
    selectedCategories: new Set(["moneyline"]),
    eligibleMarketCount: 1,
  });

  assert.equal(quality.readiness, "ready");
  assert.equal(quality.checks.discoveredMarketCount, 2);
  assert.equal(quality.checks.requestedHistoryMarketCount, 1);
  assert.equal(quality.checks.historyCoverageRate, 1);
});

test("opening coverage distinguishes creation-adjacent history from late observations", () => {
  const near = summarizeOpeningCoverage(
    { createdAt: "1970-01-01T00:01:40.000Z" },
    [{ timestamp: 200, price: 0.5 }],
    15,
  );
  const late = summarizeOpeningCoverage(
    { createdAt: "1970-01-01T00:01:40.000Z" },
    [{ timestamp: 40_000, price: 0.6 }],
    15,
  );

  assert.equal(near.status, "near_market_creation");
  assert.equal(near.openingLabel, "earliest_available_near_market_creation");
  assert.equal(late.status, "late_first_observation");
});

test("buildMovementSnapshot defaults to max lifecycle history and removes post-kickoff points", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pm-lifecycle-"));
  const snapshotPath = join(directory, "papertrader.json");
  const originalFetch = globalThis.fetch;
  const cutoffTs = 100_000;
  try {
    writeFileSync(snapshotPath, JSON.stringify({
      ok: true,
      data: {
        event: {
          id: "event-1",
          slug: "fifwc-fra-mar-2026-07-09",
          title: "France vs. Morocco",
          start_time: new Date(cutoffTs * 1000).toISOString(),
        },
        events: [],
        categories: { moneyline: { count: 1, family: "result" } },
        market_count: 1,
        markets: [{
          ...mockMarket("moneyline-market", "moneyline", "yes-1"),
          created_at: new Date((cutoffTs - 90_000) * 1000).toISOString(),
        }],
      },
    }), "utf8");
    globalThis.fetch = async (url, init) => {
      assert.equal(String(url), "https://clob.polymarket.com/batch-prices-history");
      const body = JSON.parse(init.body);
      assert.equal(body.interval, "max");
      assert.equal(body.start_ts, undefined);
      return new Response(JSON.stringify({
        history: {
          "yes-1": [
            { t: cutoffTs - 80_000, p: 0.4 },
            { t: cutoffTs - 100, p: 0.55 },
            { t: cutoffTs + 100, p: 0.95 },
          ],
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await buildMovementSnapshot({ snapshotFile: snapshotPath, powerShellFallback: false });

    assert.equal(result.input.historyMode, "lifecycle");
    assert.equal(result.input.historyInterval, "max");
    assert.equal(result.rows[0].history.length, 2);
    assert.equal(result.rows[0].discardedPointCount, 1);
    assert.equal(result.dataQuality.checks.postCutoffPointCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});

function mockMarket(slug, category, tokenId) {
  return {
    id: slug,
    slug,
    category,
    selection: slug,
    outcomes: [
      { name: "Yes", token_id: tokenId, price: 0.5 },
      { name: "No", token_id: `${tokenId}-no`, price: 0.5 },
    ],
  };
}
