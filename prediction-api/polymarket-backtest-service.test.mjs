import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getPolymarketBacktestReport, getPolymarketBacktestSummary } from "./polymarket-backtest-service.mjs";

test("Polymarket backtest service validates and summarizes the frozen report", () => {
  const directory = mkdtempSync(join(tmpdir(), "pm-backtest-"));
  const path = join(directory, "latest.json");
  writeFileSync(path, JSON.stringify({
    schemaVersion: "polymarket-signal-backtest/v1",
    generatedAt: "2026-07-11T00:00:00.000Z",
    sample: { matchCount: 20 },
    collection: { requestedMatchCount: 20, minimumTargetMet: true, failures: [] },
    policy: { fixedFeeRate: 0.03 },
    overall: { status: "market_model_conflict" },
    bySignal: [],
    byWindow: [],
    stability: [],
    thresholdSensitivity: [],
    matches: [],
    notes: [],
  }), "utf8");

  assert.equal(getPolymarketBacktestReport({ path }).sample.matchCount, 20);
  const summary = getPolymarketBacktestSummary({ path });
  assert.equal(summary.collection.minimumTargetMet, true);
  assert.equal(summary.overall.status, "market_model_conflict");
});

test("Polymarket backtest service returns null when no report exists", () => {
  assert.equal(getPolymarketBacktestReport({ path: join(tmpdir(), "missing-pm-backtest.json") }), null);
});
