import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  getPolymarketMarketStructure,
  getPolymarketMovementAssistantView,
  getPolymarketMovementSnapshot,
  listPolymarketMovementSnapshots,
} from "./polymarket-movement-service.mjs";

test("movement service lists the newest snapshot per event", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "pm-movement-"));
  try {
    writeSnapshot(cacheDir, "older-movement.json", "2026-07-09T10:00:00.000Z", 1);
    writeSnapshot(cacheDir, "newer-movement.json", "2026-07-09T12:00:00.000Z", 2);

    const events = listPolymarketMovementSnapshots({ cacheDir, includeLegacy: false });

    assert.equal(events.length, 1);
    assert.equal(events[0].eventSlug, "fifwc-fra-mar-2026-07-09");
    assert.equal(events[0].trackedMarketCount, 2);
    assert.equal(events[0].generatedAt, "2026-07-09T12:00:00.000Z");
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

test("movement service exposes full and compact assistant views", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "pm-movement-"));
  try {
    writeSnapshot(cacheDir, "fifwc-fra-mar-2026-07-09.json", "2026-07-09T12:00:00.000Z", 1);

    const full = getPolymarketMovementSnapshot("fifwc-fra-mar-2026-07-09", { cacheDir, includeLegacy: false });
    const compact = getPolymarketMovementAssistantView("fifwc-fra-mar-2026-07-09", { cacheDir, includeLegacy: false });
    const structure = getPolymarketMarketStructure("fifwc-fra-mar-2026-07-09", { cacheDir, includeLegacy: false });

    assert.equal(full.schemaVersion, "polymarket-movement/v3");
    assert.equal(full.dataQuality.readiness, "ready");
    assert.equal(full.marketStructure.schemaVersion, "polymarket-market-structure/v1");
    assert.equal(compact.assistantView.event.slug, "fifwc-fra-mar-2026-07-09");
    assert.equal(compact.assistantView.movements.length, 1);
    assert.equal(compact.assistantView.marketStructure.schemaVersion, "polymarket-market-structure/v1");
    assert.equal(structure.schemaVersion, "polymarket-market-structure/v1");
    assert.equal(structure.structure.event.slug, "fifwc-fra-mar-2026-07-09");
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});

function writeSnapshot(cacheDir, filename, generatedAt, rowCount) {
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    category: "moneyline",
    marketSlug: `market-${index}`,
    selection: `Selection ${index}`,
    outcome: "Yes",
    tokenId: `token-${index}`,
    status: "available",
    movement: {
      quality: { status: "usable", analysisStatus: "usable", warnings: [] },
      windows: {},
    },
  }));
  const snapshot = {
    ok: true,
    schemaVersion: "polymarket-movement/v3",
    generatedAt,
    input: {
      eventSlug: "fifwc-fra-mar-2026-07-09",
      cutoffTime: "2026-07-09T20:00:00.000Z",
    },
    event: { slug: "fifwc-fra-mar-2026-07-09", title: "France vs. Morocco" },
    discovery: { marketCount: 351 },
    rows,
    summary: { selectedMarketCount: rowCount, historyAvailableCount: rowCount },
    dataQuality: {
      readiness: "ready",
      checks: {
        discoveredMarketCount: 351,
        requestedHistoryMarketCount: rowCount,
        historyAvailableCount: rowCount,
      },
      limitations: [],
      issues: [],
    },
    assistantView: {
      event: {
        slug: "fifwc-fra-mar-2026-07-09",
        title: "France vs. Morocco",
        kickoffTime: "2026-07-09T20:00:00.000Z",
      },
      readiness: "ready",
      checks: { requestedHistoryMarketCount: rowCount },
      issues: [],
      limitations: [],
      categoryCoverage: [],
      topMovers: [],
      movements: rows,
    },
  };
  writeFileSync(join(cacheDir, filename), JSON.stringify(snapshot), "utf8");
}
