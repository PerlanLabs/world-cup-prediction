import assert from "node:assert/strict";
import test from "node:test";

import { mergeModelPrediction } from "./modelClient.js";

test("mergeModelPrediction keeps detail fields safe for sparse API matches", () => {
  const merged = mergeModelPrediction(
    {
      id: "sparse-match",
      home: { name: "Home" },
      away: { name: "Away" },
      recommendation: "Observe",
    },
    {
      probabilityPercent: { homeWin: 41.2, draw: 28.4, awayWin: 30.4 },
      scorelines: [{ line: "1-1", probabilityPercent: 12.3 }],
      recommendation: { label: "Home lean" },
      confidence: { score: 61 },
      expectedGoals: { home: 1.25, away: 1.05 },
      teams: { home: { elo: 1730 }, away: { elo: 1680 } },
      model: { engine: "Elo + Dixon-Coles", backtest: { accuracy: 0.6104 } },
    },
  );

  assert.equal(merged.probabilities.length, 3);
  assert.equal(merged.scores.length, 1);
  assert.ok(merged.variables.length > 0);
  assert.ok(Array.isArray(merged.radar));
  assert.ok(merged.compare.length > 0);
  assert.ok(merged.changes.length > 0);
  assert.ok(merged.script.length > 0);
  assert.ok(merged.models.length > 0);
  assert.equal(merged.lineupIntel.policy, "official_and_expected_only");
  assert.equal(merged.lineupIntel.official.status, "not_released");
});
