import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { calibrateCurrentRatings } from "./model-refresh.mjs";

test("current ratings increment from frozen base ratings instead of recalibrating from seeds", () => {
  const dir = mkdtempSync(join(tmpdir(), "world-cup-model-refresh-"));
  const baseRatingsPath = join(dir, "elo-calibrated.json");
  const officialResultsPath = join(dir, "official-results.generated.json");
  const outputPath = join(dir, "elo-calibrated.current.json");

  try {
    writeFileSync(baseRatingsPath, JSON.stringify({
      generatedAt: "2026-06-11T00:00:00.000Z",
      matchesApplied: 913,
      ratings: {
        mexico: 1000,
        "south-africa": 2000,
        canada: 1700,
      },
      method: "test-frozen-base",
    }), "utf8");

    writeFileSync(officialResultsPath, JSON.stringify({
      generatedAt: "2026-06-12T00:00:00.000Z",
      matches: [
        {
          id: "fifa-world-cup-2026-400021443",
          ts: Date.parse("2026-06-11T19:00:00Z") / 1000,
          homeSlug: "mexico",
          awaySlug: "south-africa",
          homeName: "Mexico",
          awayName: "South Africa",
          hg: 2,
          ag: 0,
          leagueName: "FIFA World Cup",
        },
      ],
    }), "utf8");

    const result = calibrateCurrentRatings({
      generatedAt: "2026-06-12T01:00:00.000Z",
      baseRatingsPath,
      officialResultsPath,
      outputPath,
    });
    const payload = JSON.parse(readFileSync(outputPath, "utf8"));

    assert.equal(result.changed, true);
    assert.equal(existsSync(outputPath), true);
    assert.equal(payload.calibration.officialResultsOnly, true);
    assert.match(payload.calibration.method, /Incremental Elo/);
    assert.equal(payload.baseMatchesApplied, 913);
    assert.equal(payload.officialMatchesApplied, 1);
    assert.equal(payload.matchesApplied, 914);
    assert.equal(payload.ratings.canada, 1700);
    assert.ok(payload.ratings.mexico > 1000);
    assert.ok(payload.ratings.mexico < 1100);
    assert.ok(payload.ratings["south-africa"] < 2000);
    assert.ok(payload.ratings["south-africa"] > 1900);

    const reused = calibrateCurrentRatings({
      generatedAt: "2026-06-12T01:05:00.000Z",
      baseRatingsPath,
      officialResultsPath,
      outputPath,
    });
    assert.equal(reused.changed, false);
    assert.equal(reused.reused, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
