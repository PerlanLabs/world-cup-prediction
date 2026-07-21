import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_REPORT_PATH = resolve(PROJECT_ROOT, "prediction-api/data/polymarket-backtest/latest.json");

export function getPolymarketBacktestReport(options = {}) {
  const path = resolve(options.path ?? DEFAULT_REPORT_PATH);
  if (!existsSync(path)) return null;
  const report = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
  if (report?.schemaVersion !== "polymarket-signal-backtest/v1") {
    throw new Error("Unsupported Polymarket signal backtest report schema.");
  }
  return report;
}

export function getPolymarketBacktestSummary(options = {}) {
  const report = getPolymarketBacktestReport(options);
  if (!report) return null;
  return {
    schemaVersion: report.schemaVersion,
    generatedAt: report.generatedAt,
    sample: report.sample,
    collection: {
      requestedMatchCount: report.collection?.requestedMatchCount ?? null,
      completedMatchCount: report.collection?.completedMatchCount ?? null,
      qualityEligibleMatchCount: report.collection?.qualityEligibleMatchCount ?? null,
      minimumTargetMet: Boolean(report.collection?.minimumTargetMet),
      failedCount: report.collection?.failedCount ?? 0,
      failures: report.collection?.failures ?? [],
    },
    policy: report.policy,
    overall: report.overall,
    bySignal: report.bySignal,
    byWindow: report.byWindow,
    stability: report.stability,
    researchPolicy: report.researchPolicy,
    thresholdSensitivity: report.thresholdSensitivity,
    matches: report.matches,
    notes: report.notes,
  };
}
