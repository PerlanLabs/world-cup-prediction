import assert from "node:assert/strict";
import test from "node:test";

import { getLineupIntelForMatch } from "./lineup-intel.mjs";

test("lineup intel defaults to honest pending states", () => {
  const intel = getLineupIntelForMatch({});

  assert.equal(intel.policy, "official_and_expected_only");
  assert.equal(intel.appliesToModel, false);
  assert.equal(intel.displayMode, "pending");
  assert.equal(intel.official.status, "not_released");
  assert.equal(intel.expected.status, "not_ready");
  assert.deepEqual(intel.official.home.starters, []);
});

test("lineup intel prefers official lineups when available", () => {
  const intel = getLineupIntelForMatch({
    lineups: {
      official: {
        sourceId: "fifa-match-centre",
        retrievedAt: "2026-06-12T00:00:00.000Z",
        home: {
          formation: "4-3-3",
          starters: [{ name: "Player One", position: "GK", shirtNumber: 1 }],
        },
      },
      expected: {
        status: "available",
        home: {
          starters: [{ name: "Expected Player", position: "FW" }],
        },
      },
    },
  });

  assert.equal(intel.displayMode, "official");
  assert.equal(intel.official.status, "available");
  assert.equal(intel.official.home.formation, "4-3-3");
  assert.equal(intel.official.home.starters[0].shirtNumber, "1");
});

test("lineup intel can expose expected lineups before official release", () => {
  const intel = getLineupIntelForMatch({
    lineups: {
      expected: {
        status: "available",
        confidence: "medium",
        reviewedAt: "2026-06-11T20:00:00.000Z",
        away: {
          unavailable: [{ name: "Doubtful Player", note: "公开信息待复核" }],
        },
      },
    },
  });

  assert.equal(intel.displayMode, "expected");
  assert.equal(intel.official.status, "not_released");
  assert.equal(intel.expected.confidence, "medium");
  assert.equal(intel.expected.away.unavailable[0].name, "Doubtful Player");
});
