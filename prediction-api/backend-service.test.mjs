import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const STORE_MODULE_URL = new URL("./store.mjs", import.meta.url).href;

async function withTempBackend(t) {
  const dir = mkdtempSync(join(tmpdir(), "world-cup-backend-"));
  process.env.PREDICTION_STORE_PATH = join(dir, "backend-store.sqlite");
  delete process.env.PREDICTION_SEED_PATH;

  const store = await import("./store.mjs");
  store.resetStoreCache();

  t.after(() => {
    store.resetStoreCache();
    delete process.env.PREDICTION_STORE_PATH;
    delete process.env.PREDICTION_SEED_PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  return import("./backend-service.mjs");
}

test("initializes a local store and returns matches with latest predictions", async (t) => {
  const backend = await withTempBackend(t);

  backend.ensureInitialPredictions();
  const matches = backend.listBackendMatches({ include: "prediction" });
  const quality = backend.getBackendDataQuality();

  assert.equal(matches.length, 4);
  assert.equal(matches.every((match) => Boolean(match.latestPrediction)), true);
  assert.equal(matches[0].lineupIntel.policy, "official_and_expected_only");
  assert.equal(matches[0].lineupIntel.official.status, "not_released");
  assert.equal(matches[0].lineupIntel.expected.status, "not_ready");
  assert.equal(quality.ok, true);
  assert.equal(quality.errorCount, 0);
  assert.equal(quality.counts.matches, 4);
  assert.equal(quality.counts.predictions, 4);
});

test("runs a subset prediction and appends history for that match", async (t) => {
  const backend = await withTempBackend(t);

  backend.ensureInitialPredictions();
  const before = backend.listPredictionHistory("mexico-south-africa");
  const run = backend.runPredictions({ matchIds: ["mexico-south-africa"] });
  const after = backend.listPredictionHistory("mexico-south-africa");

  assert.equal(run.matchCount, 1);
  assert.deepEqual(run.matches, ["mexico-south-africa"]);
  assert.equal(after.length, before.length + 1);
  assert.equal(after[0].matchId, "mexico-south-africa");
});

test("persists prediction history after store cache reset", async (t) => {
  const backend = await withTempBackend(t);
  const store = await import("./store.mjs");

  backend.ensureInitialPredictions();
  backend.runPredictions({ matchIds: ["mexico-south-africa"] });
  const beforeReset = backend.listPredictionHistory("mexico-south-africa").length;

  store.resetStoreCache();

  const afterReset = backend.listPredictionHistory("mexico-south-africa").length;
  const quality = backend.getBackendDataQuality();

  assert.equal(afterReset, beforeReset);
  assert.equal(quality.store.persistence, "sqlite");
  assert.equal(quality.ok, true);
});

test("reloads sqlite store when another process writes updates", async (t) => {
  const backend = await withTempBackend(t);

  backend.ensureInitialPredictions();
  const initial = backend.listBackendMatches({ include: "prediction" })
    .find((match) => match.id === "mexico-south-africa");
  assert.notEqual(initial.status, "External Update");

  await delay(20);
  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "-e",
    `
      import { mutateStore, resetStoreCache } from ${JSON.stringify(STORE_MODULE_URL)};
      resetStoreCache();
      mutateStore((store) => {
        const match = store.matches.find((item) => item.id === "mexico-south-africa");
        match.status = "External Update";
        return store;
      });
    `,
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      PREDICTION_STORE_DRIVER: "sqlite",
      PREDICTION_STORE_PATH: process.env.PREDICTION_STORE_PATH,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const refreshed = backend.listBackendMatches({ include: "prediction" })
    .find((match) => match.id === "mexico-south-africa");
  assert.equal(refreshed.status, "External Update");
});

test("rejects unknown match ids in manual prediction runs", async (t) => {
  const backend = await withTempBackend(t);

  backend.ensureInitialPredictions();

  assert.throws(
    () => backend.runPredictions({ matchIds: ["not-a-match"] }),
    (error) => error.status === 404 && error.code === "not_found",
  );
});

test("syncs mapped FIFA fixtures and skips unmapped teams", async (t) => {
  const backend = await withTempBackend(t);
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      Results: [
        buildFifaMatch({
          idMatch: "400021443",
          matchNumber: 1,
          date: "2026-06-11T19:00:00Z",
          homeCode: "MEX",
          homeName: "Mexico",
          awayCode: "RSA",
          awayName: "South Africa",
          groupName: "Group A",
          cityName: "Mexico City",
        }),
        buildFifaMatch({
          idMatch: "400021447",
          matchNumber: 8,
          date: "2026-06-13T19:00:00Z",
          homeCode: "AUT",
          homeName: "Austria",
          awayCode: "UZB",
          awayName: "Uzbekistan",
          groupName: "Group B",
          cityName: "San Francisco Bay Area",
        }),
        buildFifaMatch({
          idMatch: "400099999",
          matchNumber: 999,
          date: "2026-06-14T19:00:00Z",
          homeCode: "ZZZ",
          homeName: "Unknown Team",
          awayCode: "USA",
          awayName: "United States",
          groupName: "Group C",
          cityName: "Los Angeles",
        }),
      ],
    }),
  });

  const summary = await backend.syncOfficialFixtures({
    fetchImpl,
    fetchedAt: "2026-06-12T00:00:00.000Z",
  });
  const match = backend.getBackendMatch("mexico-south-africa");
  const source = backend.listBackendSources().find((item) => item.id === "fifa-api-world-cup-2026-calendar");

  assert.equal(summary.rawCount, 3);
  assert.equal(summary.importedCount, 2);
  assert.equal(summary.predictableImportedCount, 2);
  assert.equal(summary.modelUnsupportedImportedCount, 0);
  assert.equal(summary.skippedCount, 1);
  assert.equal(summary.skipped[0].reason, "unmapped_team");
  assert.equal(match.date, "2026-06-12");
  assert.equal(match.kickoffSort, "03:00");
  assert.equal(match.official.idMatch, "400021443");
  assert.equal(match.official.cityName, "Mexico City");
  assert.equal(source.lastSync.importedCount, 2);
  assert.equal(source.lastSync.modelUnsupportedImportedCount, 0);
  assert.equal(source.lastSync.skippedCount, 1);

  const coveredMatch = backend.getBackendMatch("austria-uzbekistan");
  assert.equal(coveredMatch.predictionStatus.available, true);
  assert.equal(coveredMatch.modelHome, "austria");
  assert.equal(coveredMatch.modelAway, "uzbekistan");
  assert.notEqual(backend.getLatestPrediction("austria-uzbekistan"), null);
});

test("refreshes current model ratings from completed FIFA results and preserves prediction history", async (t) => {
  const backend = await withTempBackend(t);

  await backend.syncOfficialFixtures({
    fetchedAt: "2026-06-12T04:30:00.000Z",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        Results: [
          buildFifaMatch({
            idMatch: "400021443",
            matchNumber: 1,
            date: "2026-06-11T19:00:00Z",
            homeCode: "MEX",
            homeName: "Mexico",
            awayCode: "RSA",
            awayName: "South Africa",
            groupName: "Group A",
            cityName: "Mexico City",
            homeScore: 2,
            awayScore: 0,
            matchStatus: 12,
          }),
        ],
      }),
    }),
  });

  const futureBefore = backend.listPredictionHistory("canada-bosnia").length;
  const completedBefore = backend.listPredictionHistory("mexico-south-africa").length;
  const refresh = backend.refreshModelRatings({
    generatedAt: "2026-06-12T05:00:00.000Z",
  });
  const futureAfter = backend.listPredictionHistory("canada-bosnia").length;
  const completedAfter = backend.listPredictionHistory("mexico-south-africa").length;
  const futureMatch = backend.getBackendMatch("canada-bosnia", { includePrediction: true });
  const resultsPayload = JSON.parse(readFileSync(refresh.officialResults.path, "utf8"));

  assert.equal(refresh.officialResults.matchCount, 1);
  assert.equal(refresh.calibration.changed, true);
  assert.equal(existsSync(refresh.officialResults.path), true);
  assert.equal(existsSync(refresh.calibration.path), true);
  assert.equal(resultsPayload.matches[0].homeSlug, "mexico");
  assert.equal(resultsPayload.matches[0].awaySlug, "south-africa");
  assert.equal(resultsPayload.matches[0].hg, 2);
  assert.equal(resultsPayload.matches[0].ag, 0);
  assert.equal(refresh.predictionMatchIds.includes("canada-bosnia"), true);
  assert.equal(refresh.predictionMatchIds.includes("mexico-south-africa"), false);
  assert.equal(futureAfter, futureBefore + 1);
  assert.equal(completedAfter, completedBefore);
  assert.equal(futureMatch.latestPrediction.model.ratingSource.type, "current");
  assert.equal(futureMatch.latestPrediction.model.ratingSource.officialResultsCount, 1);

  const secondRefresh = backend.refreshModelRatings({
    generatedAt: "2026-06-12T05:05:00.000Z",
  });
  assert.equal(secondRefresh.calibration.changed, false);
  assert.equal(secondRefresh.predictionRun, null);
});

test("freezes pre-match prediction snapshots and scores completed matches", async (t) => {
  const backend = await withTempBackend(t);
  const store = await import("./store.mjs");

  backend.ensureInitialPredictions();
  store.mutateStore((currentStore) => {
    const match = currentStore.matches.find((item) => item.id === "mexico-south-africa");
    match.date = "2026-06-18";
    match.dateLabel = "6月18日";
    match.kickoffSort = "12:00";
    match.kickoffLocal = "2026-06-18T12:00:00+08:00";
    match.status = "未开赛";
    match.score = { home: null, away: null };
    match.official = {
      ...(match.official ?? {}),
      dateUtc: "2026-06-18T04:00:00.000Z",
    };

    for (const prediction of currentStore.predictions.filter((item) => item.matchId === match.id)) {
      prediction.generatedAt = "2026-06-18T03:00:00.000Z";
    }

    return currentStore;
  });

  const freeze = backend.freezePreMatchPredictions({
    matchIds: ["mexico-south-africa"],
    now: "2026-06-18T03:30:00.000Z",
    lockBeforeMinutes: 60,
  });
  const frozenHistory = backend.listPredictionHistory("mexico-south-africa")
    .filter((prediction) => prediction.audit?.freezeType === "pre_match_final");

  assert.equal(freeze.frozenCount, 1);
  assert.equal(freeze.frozen[0].matchId, "mexico-south-africa");
  assert.equal(frozenHistory.length, 1);
  assert.equal(frozenHistory[0].audit.policy, "latest_prediction_generated_before_kickoff");
  assert.equal(frozenHistory[0].scorelineDistribution.length, 81);

  await backend.syncOfficialFixtures({
    fetchedAt: "2026-06-18T06:30:00.000Z",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        Results: [
          buildFifaMatch({
            idMatch: "400021443",
            matchNumber: 1,
            date: "2026-06-18T04:00:00Z",
            homeCode: "MEX",
            homeName: "Mexico",
            awayCode: "RSA",
            awayName: "South Africa",
            groupName: "Group A",
            cityName: "Mexico City",
            homeScore: 2,
            awayScore: 0,
            matchStatus: 12,
          }),
        ],
      }),
    }),
  });

  const trackRecord = backend.getModelTrackRecord();
  const row = trackRecord.rows.find((item) => item.matchId === "mexico-south-africa");
  const quality = backend.getBackendDataQuality();

  assert.equal(row.status, "scored");
  assert.equal(row.finalScore.line, "2-0");
  assert.equal(row.frozenPrediction.id, frozenHistory[0].id);
  assert.equal(typeof row.score.actualProbability, "number");
  assert.equal(typeof row.score.actualScorelineProbability, "number");
  assert.equal(typeof row.score.actualScorelineRank, "number");
  assert.equal(typeof row.score.exactScoreLogLoss, "number");
  assert.equal(typeof row.score.top3ScorelineHit, "boolean");
  assert.equal(typeof row.score.top5ScorelineHit, "boolean");
  assert.equal(row.score.scorelineDistributionSource, "frozen_distribution");
  assert.equal(row.score.scorelineDistributionComplete, true);
  assert.equal(row.score.derivedMarkets.some((market) => market.key === "total_over_1_5"), true);
  assert.equal(typeof row.score.rps, "number");
  assert.equal(typeof row.score.brier, "number");
  assert.equal(trackRecord.summary.frozenCount, 1);
  assert.equal(trackRecord.summary.scoredCount, 1);
  assert.equal(typeof trackRecord.summary.top3ScorelineRate, "number");
  assert.equal(typeof trackRecord.summary.top5ScorelineRate, "number");
  assert.equal(typeof trackRecord.summary.averageActualScorelineProbability, "number");
  assert.equal(Array.isArray(trackRecord.summary.derivedMarketAccuracy), true);
  assert.equal(trackRecord.summary.missingFreezeCompletedCount, 0);
  assert.equal(quality.errorCount, 0);
  assert.equal((quality.warnings ?? []).some((warning) => warning.code === "missing_frozen_prediction"), false);

  const reviewRoot = mkdtempSync(join(tmpdir(), "world-cup-model-review-"));
  t.after(() => rmSync(reviewRoot, { recursive: true, force: true }));
  const { generateModelReviewReports } = await import("./model-review.mjs");
  const report = generateModelReviewReports({
    root: reviewRoot,
    generatedAt: "2026-06-18T07:00:00.000Z",
    trackRecord,
  });
  const reviewJson = JSON.parse(readFileSync(report.cumulative.jsonPath, "utf8"));
  assert.equal(existsSync(report.cumulative.markdownPath), true);
  assert.equal(reviewJson.summary.scoredCount, 1);
  assert.equal(reviewJson.rows[0].actualScorelineProbability, row.score.actualScorelineProbability);
});

test("backfills missing frozen snapshots from upstream GitHub track-record payload", async (t) => {
  const backend = await withTempBackend(t);

  backend.ensureInitialPredictions();
  await backend.syncOfficialFixtures({
    fetchedAt: "2026-06-12T04:30:00.000Z",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        Results: [
          buildFifaMatch({
            idMatch: "400021443",
            matchNumber: 1,
            date: "2026-06-11T19:00:00Z",
            homeCode: "MEX",
            homeName: "Mexico",
            awayCode: "RSA",
            awayName: "South Africa",
            groupName: "Group A",
            cityName: "Mexico City",
            homeScore: 2,
            awayScore: 0,
            matchStatus: 12,
          }),
        ],
      }),
    }),
  });

  const before = backend.getModelTrackRecord();
  assert.equal(before.summary.missingFreezeCompletedCount, 1);

  const backfill = await backend.backfillUpstreamTrackRecord({
    generatedAt: "2026-06-18T02:00:00.000Z",
    payload: {
      fetchedAt: "2026-06-18T01:12:22.045Z",
      upstreamUpdatedAt: "2026-06-18T01:12:22.045Z",
      ratingsHash: "ratings-hash",
      resultsHash: "results-hash",
      source: {
        id: "upstream-github-track-record",
        name: "Upstream GitHub frozen 2026 World Cup track record",
        url: "https://github.com/Hicruben/world-cup-2026-prediction-model",
        resultsUrl: "https://raw.githubusercontent.com/Hicruben/world-cup-2026-prediction-model/main/data/wc2026-results.json",
        ratingsUrl: "https://raw.githubusercontent.com/Hicruben/world-cup-2026-prediction-model/main/data/elo-calibrated.json",
        retrievedAt: "2026-06-18T01:12:22.045Z",
        tier: 2,
      },
      ratings: {
        generatedAt: "2026-06-11T00:00:00.000Z",
        matchesApplied: 913,
        ratings: {
          mexico: 1700,
          "south-africa": 1500,
        },
      },
      matches: [
        {
          date: "2026-06-11",
          team1: "Mexico",
          team2: "South Africa",
          t1: "mexico",
          t2: "south-africa",
          g1: 2,
          g2: 0,
          status: "FT",
        },
      ],
    },
  });
  const history = backend.listPredictionHistory("mexico-south-africa");
  const frozen = history.find((prediction) => prediction.audit?.freezeType === "pre_match_final");
  const after = backend.getModelTrackRecord();
  const row = after.rows.find((item) => item.matchId === "mexico-south-africa");
  const source = backend.listBackendSources().find((item) => item.id === "upstream-github-track-record");
  const run = backend.listModelRuns().find((item) => item.id === backfill.runId);

  assert.equal(backfill.importedCount, 1);
  assert.equal(backfill.imported[0].matchId, "mexico-south-africa");
  assert.equal(frozen.audit.backfilled, true);
  assert.equal(frozen.audit.backfillSource, "upstream-github-track-record");
  assert.equal(frozen.model.ratingSource.type, "upstream_github_frozen_tournament_ratings");
  assert.equal(row.status, "scored");
  assert.equal(row.finalScore.line, "2-0");
  assert.equal(after.summary.missingFreezeCompletedCount, 0);
  assert.equal(source.lastSync.importedCount, 1);
  assert.equal(run.predictionIds.includes(frozen.id), true);
});

test("falls back to local upstream clone when raw GitHub track-record fetch fails", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "world-cup-upstream-fallback-"));
  const dataDir = join(dir, "data");
  mkdirSync(dataDir, { recursive: true });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(join(dataDir, "wc2026-results.json"), JSON.stringify({
    updated: "2026-06-18T04:12:21.735Z",
    matches: [
      {
        date: "2026-06-11",
        team1: "Mexico",
        team2: "South Africa",
        t1: "mexico",
        t2: "south-africa",
        g1: 2,
        g2: 0,
        status: "FT",
      },
    ],
  }), "utf8");
  writeFileSync(join(dataDir, "elo-calibrated.json"), JSON.stringify({
    generatedAt: "2026-06-11T00:00:00.000Z",
    matchesApplied: 913,
    ratings: {
      mexico: 1700,
      "south-africa": 1500,
    },
  }), "utf8");

  const { fetchUpstreamTrackRecordPayload } = await import("./upstream-track-record-sync.mjs");
  const payload = await fetchUpstreamTrackRecordPayload({
    localRepoPath: dir,
    fetchedAt: "2026-06-18T04:30:00.000Z",
    fetchImpl: async () => {
      throw new Error("network blocked");
    },
  });

  assert.equal(payload.source.retrieval.method, "local_upstream_clone");
  assert.equal(payload.source.retrieval.fallbackReason, "network blocked");
  assert.equal(payload.upstreamUpdatedAt, "2026-06-18T04:12:21.735Z");
  assert.equal(payload.probe.rawMatchCount, 1);
  assert.equal(payload.probe.ratingTeamCount, 2);
});

test("syncs FIFA team rankings into team profiles", async (t) => {
  const backend = await withTempBackend(t);

  const summary = await backend.syncFifaTeamRankings({
    fetchImpl: async (url) => {
      if (String(url).includes("get-rankings")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            rankings: [
              {
                idTeam: "43911",
                teamName: "Mexico",
                countryCode: "MEX",
                confederationName: "CONCACAF",
                rank: 14,
                previousRank: 15,
                totalPoints: 1665.2,
                previousPoints: 1658.1,
              },
              {
                idTeam: "43883",
                teamName: "South Africa",
                countryCode: "RSA",
                confederationName: "CAF",
                rank: 56,
                previousRank: 57,
                totalPoints: 1420.3,
                previousPoints: 1415.7,
              },
            ],
          }),
        };
      }

      return {
        ok: true,
        status: 200,
        text: async () => buildFifaRankingHtml(),
      };
    },
    fetchedAt: "2026-06-12T12:00:00.000Z",
  });

  const mexico = backend.listBackendTeams().find((team) => team.id === "mexico");
  const southAfrica = backend.getBackendMatch("mexico-south-africa").awayTeam;
  const source = backend.listBackendSources().find((item) => item.id === "fifa-live-world-ranking");

  assert.equal(summary.importedCount, 2);
  assert.equal(summary.lastUpdateDate, "2026-06-11T10:00:59.636Z");
  assert.equal(mexico.profile.worldRanking.rank, 14);
  assert.equal(mexico.profile.worldRanking.previousRank, 15);
  assert.equal(mexico.profile.worldRanking.sourceId, "fifa-live-world-ranking");
  assert.equal(mexico.profile.marketValue.status, "unavailable");
  assert.equal(mexico.profile.marketValue.reason, "fifa_no_official_market_value");
  assert.equal(southAfrica.profile.worldRanking.rank, 56);
  assert.equal(source.lastSync.importedCount, 2);
});

test("syncs reviewed expected lineups into enriched matches", async (t) => {
  const backend = await withTempBackend(t);

  const summary = backend.syncLineups({
    payload: {
      source: {
        id: "manual-reviewed-expected-lineups",
        name: "Manual reviewed expected lineups",
        retrievedAt: "2026-06-12T10:00:00.000Z",
        access: "free_reviewed",
      },
      lineups: [
        {
          matchId: "mexico-south-africa",
          expected: {
            confidence: "medium",
            reviewedAt: "2026-06-12T10:05:00.000Z",
            home: {
              formation: "4-3-3",
              starters: [
                { name: "Test Keeper", position: "GK", shirtNumber: 1 },
                { name: "Test Forward", position: "FW", shirtNumber: 9 },
              ],
            },
            away: {
              formation: "4-2-3-1",
              unavailable: [{ name: "Test Doubtful Player", note: "Public note under review" }],
            },
          },
        },
      ],
    },
  });
  const match = backend.getBackendMatch("mexico-south-africa");
  const source = backend.listBackendSources().find((item) => item.id === "manual-reviewed-expected-lineups");

  assert.equal(summary.importedCount, 1);
  assert.equal(summary.expectedImportedCount, 1);
  assert.equal(summary.officialImportedCount, 0);
  assert.equal(match.lineupIntel.displayMode, "expected");
  assert.equal(match.lineupIntel.appliesToModel, false);
  assert.equal(match.lineupIntel.expected.status, "available");
  assert.equal(match.lineupIntel.expected.confidence, "medium");
  assert.equal(match.lineupIntel.expected.home.formation, "4-3-3");
  assert.equal(match.lineupIntel.expected.home.starters[0].name, "Test Keeper");
  assert.equal(match.lineupIntel.official.status, "not_released");
  assert.equal(source.lastSync.expectedImportedCount, 1);
});

test("syncs free public expected lineups from RotoWire into expected slot", async (t) => {
  const backend = await withTempBackend(t);
  await backend.syncOfficialFixtures({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        Results: [
          buildFifaMatch({
            idMatch: "400021446",
            matchNumber: 3,
            date: "2026-06-12T19:00:00Z",
            homeCode: "CAN",
            homeName: "Canada",
            awayCode: "BIH",
            awayName: "Bosnia and Herzegovina",
            groupName: "Group B",
            cityName: "Toronto",
          }),
        ],
      }),
    }),
    fetchedAt: "2026-06-12T00:00:00.000Z",
  });

  const summary = await backend.syncExpectedLineups({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => buildRotowireLineupsHtml(),
    }),
    fetchedAt: "2026-06-12T10:30:00.000Z",
  });
  const match = backend.getBackendMatch("canada-bosnia");
  const source = backend.listBackendSources().find((item) => item.id === "rotowire-world-cup-lineups");

  assert.equal(summary.importedCount, 1);
  assert.equal(summary.expectedImportedCount, 1);
  assert.equal(summary.officialImportedCount, 0);
  assert.equal(summary.probe.rawCount, 1);
  assert.equal(match.lineupIntel.displayMode, "expected");
  assert.equal(match.lineupIntel.appliesToModel, false);
  assert.equal(match.lineupIntel.official.status, "not_released");
  assert.equal(match.lineupIntel.expected.status, "available");
  assert.equal(match.lineupIntel.expected.home.starters.length, 2);
  assert.equal(match.lineupIntel.expected.home.starters[0].name, "Maxime Crepeau");
  assert.equal(match.lineupIntel.expected.home.unavailable[0].note, "RotoWire: QUES");
  assert.equal(source.access, "free_public");
  assert.equal(source.lastSync.expectedImportedCount, 1);
});

test("syncs FIFA official lineups from live football endpoint", async (t) => {
  const backend = await withTempBackend(t);
  await backend.syncOfficialFixtures({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        Results: [
          buildFifaMatch({
            idMatch: "400021443",
            matchNumber: 1,
            date: "2026-06-11T19:00:00Z",
            homeCode: "MEX",
            homeName: "Mexico",
            awayCode: "RSA",
            awayName: "South Africa",
            groupName: "Group A",
            cityName: "Mexico City",
          }),
        ],
      }),
    }),
    fetchedAt: "2026-06-12T00:00:00.000Z",
  });

  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    json: async () => buildFifaLiveLineup({
      idMatch: "400021443",
      homeIdTeam: "43911",
      awayIdTeam: "43883",
    }),
    url,
  });

  const summary = await backend.syncOfficialLineups({
    matchIds: ["mexico-south-africa"],
    fetchImpl,
    fetchedAt: "2026-06-12T10:30:00.000Z",
  });
  const match = backend.getBackendMatch("mexico-south-africa");
  const source = backend.listBackendSources().find((item) => item.id === "fifa-api-live-football-lineups");

  assert.equal(summary.importedCount, 1);
  assert.equal(summary.officialImportedCount, 1);
  assert.equal(summary.expectedImportedCount, 0);
  assert.equal(summary.probe.availableCount, 1);
  assert.equal(match.lineupIntel.displayMode, "official");
  assert.equal(match.lineupIntel.appliesToModel, false);
  assert.equal(match.lineupIntel.official.status, "available");
  assert.equal(match.lineupIntel.official.home.formation, "4-3-3");
  assert.equal(match.lineupIntel.official.home.starters.length, 11);
  assert.equal(match.lineupIntel.official.home.substitutes.length, 2);
  assert.equal(match.lineupIntel.official.home.starters[0].position, "GK");
  assert.equal(match.lineupIntel.official.home.starters[0].note, "队长");
  assert.equal(source.access, "official_public");
  assert.equal(source.lastSync.officialImportedCount, 1);
});

test("syncs FIFA official match facts from live football endpoint", async (t) => {
  const backend = await withTempBackend(t);
  await backend.syncOfficialFixtures({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        Results: [
          buildFifaMatch({
            idMatch: "400021443",
            matchNumber: 1,
            date: "2026-06-11T19:00:00Z",
            homeCode: "MEX",
            homeName: "Mexico",
            awayCode: "RSA",
            awayName: "South Africa",
            groupName: "Group A",
            cityName: "Mexico City",
          }),
        ],
      }),
    }),
    fetchedAt: "2026-06-12T00:00:00.000Z",
  });

  const summary = await backend.syncOfficialMatchFacts({
    matchIds: ["mexico-south-africa"],
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => buildFifaLiveFacts({
        idMatch: "400021443",
        homeIdTeam: "43911",
        awayIdTeam: "43883",
      }),
    }),
    fetchedAt: "2026-06-12T11:00:00.000Z",
  });
  const match = backend.getBackendMatch("mexico-south-africa");
  const source = backend.listBackendSources().find((item) => item.id === "fifa-api-live-football-match-facts");

  assert.equal(summary.importedCount, 1);
  assert.equal(summary.probe.availableCount, 1);
  assert.equal(match.matchFacts.sourceId, "fifa-api-live-football-match-facts");
  assert.equal(match.matchFacts.score.home, 2);
  assert.equal(match.matchFacts.events.filter((event) => event.type === "goal").length, 2);
  assert.equal(match.matchFacts.events.find((event) => event.type === "goal").playerName, "Player 9");
  assert.equal(match.matchFacts.events.filter((event) => event.type === "booking").length, 1);
  assert.equal(match.matchFacts.events.filter((event) => event.type === "substitution").length, 1);
  assert.equal(source.access, "official_public");
  assert.equal(source.lastSync.importedCount, 1);
});

test("syncs API-Football fixture ids and technical statistics", async (t) => {
  const backend = await withTempBackend(t);
  await backend.syncOfficialFixtures({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        Results: [
          buildFifaMatch({
            idMatch: "400021443",
            matchNumber: 1,
            date: "2026-06-11T19:00:00Z",
            homeCode: "MEX",
            homeName: "Mexico",
            awayCode: "RSA",
            awayName: "South Africa",
            groupName: "Group A",
            cityName: "Mexico City",
          }),
        ],
      }),
    }),
    fetchedAt: "2026-06-12T00:00:00.000Z",
  });

  const fixtureSummary = await backend.syncApiFootballFixtureIds({
    key: "test-key",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => buildApiFootballFixturesResponse(),
    }),
    fetchedAt: "2026-06-12T12:00:00.000Z",
  });

  const statsSummary = await backend.syncApiFootballMatchStats({
    matchIds: ["mexico-south-africa"],
    key: "test-key",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => buildApiFootballStatsResponse(),
    }),
    fetchedAt: "2026-06-12T12:05:00.000Z",
  });

  const match = backend.getBackendMatch("mexico-south-africa");
  const source = backend.listBackendSources().find((item) => item.id === "api-football-fixture-statistics");

  assert.equal(fixtureSummary.importedCount, 1);
  assert.equal(match.externalIds.apiFootball, "1538999");
  assert.equal(statsSummary.importedCount, 1);
  assert.equal(match.matchFacts.coverage.statistics, true);
  assert.equal(match.matchFacts.statistics.possession.home, 62);
  assert.equal(match.matchFacts.statistics.totalShots.home, 15);
  assert.equal(match.matchFacts.statistics.shotsOnTarget.away, 4);
  assert.equal(match.matchFacts.statistics.corners.away, 5);
  assert.equal(match.matchFacts.statistics.passAccuracy.home, 86);
  assert.equal(match.matchFacts.statisticsSource.sourceId, "api-football-fixture-statistics");
  assert.equal(match.matchFacts.supplementalSources.length, 1);
  assert.equal(source.access, "free_key");
  assert.equal(source.lastSync.importedCount, 1);
});

test("syncs API-Football supplemental data in one command", async (t) => {
  const backend = await withTempBackend(t);
  await backend.syncOfficialFixtures({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        Results: [
          buildFifaMatch({
            idMatch: "400021443",
            matchNumber: 1,
            date: "2026-06-11T19:00:00Z",
            homeCode: "MEX",
            homeName: "Mexico",
            awayCode: "RSA",
            awayName: "South Africa",
            groupName: "Group A",
            cityName: "Mexico City",
          }),
        ],
      }),
    }),
    fetchedAt: "2026-06-12T00:00:00.000Z",
  });

  const summary = await backend.syncApiFootballSupplementalData({
    key: "test-key",
    matchIds: ["mexico-south-africa"],
    fetchImpl: async (url) => ({
      ok: true,
      status: 200,
      json: async () => String(url).includes("/fixtures/statistics")
        ? buildApiFootballStatsResponse()
        : buildApiFootballFixturesResponse(),
    }),
    fetchedAt: "2026-06-12T12:05:00.000Z",
  });

  const match = backend.getBackendMatch("mexico-south-africa");

  assert.equal(summary.fixtureSync.importedCount, 1);
  assert.equal(summary.statisticsSync.importedCount, 1);
  assert.equal(summary.summary.fixtureImportedCount, 1);
  assert.equal(summary.summary.statisticsImportedCount, 1);
  assert.equal(match.externalIds.apiFootball, "1538999");
  assert.equal(match.matchFacts.statisticsSource.sourceId, "api-football-fixture-statistics");
  assert.equal(match.matchFacts.statistics.totalShots.home, 15);
});

test("selects only due pending matches for official lineup sync", async (t) => {
  const backend = await withTempBackend(t);
  await backend.syncOfficialFixtures({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        Results: [
          buildFifaMatch({
            idMatch: "400021443",
            matchNumber: 1,
            date: "2026-06-11T19:00:00Z",
            homeCode: "MEX",
            homeName: "Mexico",
            awayCode: "RSA",
            awayName: "South Africa",
            groupName: "Group A",
            cityName: "Mexico City",
          }),
          buildFifaMatch({
            idMatch: "400021447",
            matchNumber: 8,
            date: "2026-06-13T19:00:00Z",
            homeCode: "AUT",
            homeName: "Austria",
            awayCode: "UZB",
            awayName: "Uzbekistan",
            groupName: "Group B",
            cityName: "San Francisco Bay Area",
          }),
        ],
      }),
    }),
    fetchedAt: "2026-06-12T00:00:00.000Z",
  });

  await backend.syncOfficialLineups({
    matchIds: ["mexico-south-africa"],
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => buildFifaLiveLineup({
        idMatch: "400021443",
        homeIdTeam: "43911",
        awayIdTeam: "43883",
      }),
    }),
    fetchedAt: "2026-06-12T10:30:00.000Z",
  });

  const selectionOptions = {
    mode: "due",
    now: "2026-06-13T17:00:00.000Z",
    lookaheadHours: 3,
    lookbackHours: 0,
  };
  const candidates = backend.listOfficialLineupSyncCandidates(selectionOptions);

  assert.equal(candidates.mode, "due");
  assert.equal(candidates.selectedCount, 1);
  assert.deepEqual(candidates.selectedMatchIds, ["austria-uzbekistan"]);
  assert.equal(candidates.matches[0].lineupIntel.official.status, "not_released");

  const summary = await backend.syncOfficialLineups({
    ...selectionOptions,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => buildFifaLiveLineup({
        idMatch: "400021447",
        homeIdTeam: "43934",
        awayIdTeam: "43935",
      }),
    }),
    fetchedAt: "2026-06-13T17:10:00.000Z",
  });
  const syncedMatch = backend.getBackendMatch("austria-uzbekistan");

  assert.deepEqual(summary.selection.selectedMatchIds, ["austria-uzbekistan"]);
  assert.equal(summary.officialImportedCount, 1);
  assert.equal(syncedMatch.lineupIntel.official.status, "available");
  assert.equal(backend.getBackendMatch("mexico-south-africa").lineupIntel.official.status, "available");
});

test("syncs Polymarket read-only World Cup winner market signals into team profiles", async (t) => {
  const backend = await withTempBackend(t);
  await backend.syncOfficialFixtures({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        Results: [
          buildFifaMatch({
            idMatch: "400021500",
            matchNumber: 31,
            date: "2026-06-14T19:00:00Z",
            homeCode: "ESP",
            homeName: "Spain",
            awayCode: "USA",
            awayName: "United States",
            groupName: "Group C",
            cityName: "Los Angeles",
          }),
        ],
      }),
    }),
    fetchedAt: "2026-06-12T00:00:00.000Z",
  });

  const summary = await backend.syncPolymarketWorldCupMarkets({
    fetchImpl: async (url) => {
      assert.match(String(url), /events\/slug\/world-cup-winner/);
      return {
        ok: true,
        status: 200,
        json: async () => buildPolymarketWinnerEventResponse(),
      };
    },
    fetchedAt: "2026-06-12T13:00:00.000Z",
  });
  const spain = backend.listBackendTeams().find((team) => team.id === "spain");
  const usa = backend.listBackendTeams().find((team) => team.id === "usa");
  const source = backend.listBackendSources().find((item) => item.id === "polymarket-world-cup-markets");
  const quality = backend.getBackendDataQuality();

  assert.equal(summary.importedCount, 2);
  assert.deepEqual(summary.importedTeamIds.sort(), ["spain", "usa"]);
  assert.equal(summary.readOnly, true);
  assert.equal(summary.tradingEnabled, false);
  assert.equal(summary.skipped.some((item) => item.reason === "placeholder_team"), true);
  assert.equal(spain.profile.marketSignals.polymarket.worldCupWinner.impliedProbabilityPercent, 16.5);
  assert.equal(spain.profile.marketSignals.polymarket.worldCupWinner.decimalOdds, 6.06);
  assert.equal(usa.profile.marketSignals.polymarket.worldCupWinner.subject, "United States");
  assert.equal(source.access, "public_read_only");
  assert.equal(source.compliance.tradingEnabled, false);
  assert.equal(source.lastSync.importedCount, 2);
  assert.equal(quality.ok, true);
});

test("syncs Polymarket read-only single-match moneyline markets into matches", async (t) => {
  const backend = await withTempBackend(t);

  const summary = await backend.syncPolymarketMatchMarkets({
    matchIds: ["mexico-south-africa"],
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.includes("/events/slug/fifwc-mex-rsa-2026-06-11")) {
        return {
          ok: true,
          status: 200,
          json: async () => value.includes("more-markets")
            ? buildPolymarketMoreMarketsEventResponse()
            : buildPolymarketMatchEventResponse(),
        };
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      };
    },
    fetchedAt: "2026-06-12T13:30:00.000Z",
  });

  const match = backend.getBackendMatch("mexico-south-africa");
  const source = backend.listBackendSources().find((item) => item.id === "polymarket-match-markets");

  assert.equal(summary.importedCount, 1);
  assert.equal(summary.readOnly, true);
  assert.equal(summary.tradingEnabled, false);
  assert.equal(match.marketOdds.polymarket.status, "available");
  assert.equal(match.marketOdds.polymarket.moneyline.length, 3);
  assert.deepEqual(match.marketOdds.polymarket.moneyline.map((row) => row.type), ["home", "draw", "away"]);
  assert.equal(match.marketOdds.polymarket.moneyline[0].impliedProbabilityPercent, 73.5);
  assert.equal(match.marketOdds.polymarket.moneyline[1].label, "平局");
  assert.equal(match.marketOdds.polymarket.derivativeEventSlug, "fifwc-mex-rsa-2026-06-11-more-markets");
  assert.equal(match.marketOdds.polymarket.derivativeMarkets.some((row) => row.key === "away+1.5" && row.price === 0.695), true);
  assert.equal(match.marketOdds.polymarket.derivativeMarkets.some((row) => row.key === "total-over-2.5" && row.price === 0.445), true);
  assert.equal(match.marketOdds.polymarket.derivativeMarkets.some((row) => row.key === "btts-yes" && row.price === 0.465), true);
  assert.equal(match.marketOdds.polymarket.derivativeMarkets.some((row) => row.key === "away-over-0.5" && row.price === 0.575), true);
  assert.equal(source.compliance.tradingEnabled, false);
  assert.equal(source.lastSync.importedCount, 1);
});

test("imports Polymarket single-match market snapshots without fetching", async (t) => {
  const backend = await withTempBackend(t);
  const payload = {
    source: {
      id: "polymarket-match-markets",
      name: "Polymarket World Cup single-match markets",
      url: "https://polymarket.com/sports/world-cup",
      retrievedAt: "2026-06-12T14:00:00.000Z",
      tier: 3,
      access: "public_read_only",
      compliance: { readOnly: true, tradingEnabled: false, walletRequired: false, modelInput: false },
    },
    fetchedAt: "2026-06-12T14:00:00.000Z",
    probe: { requestedCount: 1, availableCount: 1, skippedCount: 0 },
    matches: [
      {
        matchId: "korea-czechia",
        status: "available",
        sourceId: "polymarket-match-markets",
        retrievedAt: "2026-06-12T14:00:00.000Z",
        eventSlug: "fifwc-kr-cze-2026-06-11",
        eventTitle: "Korea Republic vs. Czechia",
        sourceUrl: "https://polymarket.com/event/fifwc-kr-cze-2026-06-11",
        moneyline: [
          { type: "home", label: "韩国", price: 0.42, impliedProbabilityPercent: 42, decimalOdds: 2.38 },
          { type: "draw", label: "平局", price: 0.28, impliedProbabilityPercent: 28, decimalOdds: 3.57 },
          { type: "away", label: "捷克", price: 0.30, impliedProbabilityPercent: 30, decimalOdds: 3.33 },
        ],
        aiAnalysis: {
          provider: "deepseek",
          model: "deepseek-chat",
          generatedAt: "2026-06-12T14:00:00.000Z",
          text: "模型与市场差异较小，适合观察临场信息。",
        },
      },
    ],
  };

  const summary = await backend.importPolymarketMatchMarkets({ payload });
  const match = backend.getBackendMatch("korea-czechia");

  assert.equal(summary.importedCount, 1);
  assert.equal(match.marketOdds.polymarket.eventSlug, "fifwc-kr-cze-2026-06-11");
  assert.equal(match.marketOdds.polymarket.aiAnalysis.text, "模型与市场差异较小，适合观察临场信息。");
});

test("generates DeepSeek analyses from stored Polymarket snapshots", async (t) => {
  const backend = await withTempBackend(t);
  backend.ensureInitialPredictions();
  await backend.importPolymarketMatchMarkets({
    payload: {
      source: {
        id: "polymarket-match-markets",
        name: "Polymarket World Cup single-match markets",
        url: "https://polymarket.com/sports/world-cup",
        retrievedAt: "2026-06-12T14:00:00.000Z",
        tier: 3,
        access: "public_read_only",
        compliance: { readOnly: true, tradingEnabled: false, walletRequired: false, modelInput: false },
      },
      fetchedAt: "2026-06-12T14:00:00.000Z",
      probe: { requestedCount: 1, availableCount: 1, skippedCount: 0 },
      matches: [
        {
          matchId: "korea-czechia",
          status: "available",
          sourceId: "polymarket-match-markets",
          retrievedAt: "2026-06-12T14:00:00.000Z",
          eventSlug: "fifwc-kr-cze-2026-06-11",
          eventTitle: "Korea Republic vs. Czechia",
          sourceUrl: "https://polymarket.com/event/fifwc-kr-cze-2026-06-11",
          moneyline: [
            { type: "home", label: "韩国", price: 0.42, impliedProbabilityPercent: 42, decimalOdds: 2.38 },
            { type: "draw", label: "平局", price: 0.28, impliedProbabilityPercent: 28, decimalOdds: 3.57 },
            { type: "away", label: "捷克", price: 0.30, impliedProbabilityPercent: 30, decimalOdds: 3.33 },
          ],
          derivativeMarkets: [
            { key: "total-over-2.5", type: "total", label: "大 2.5", price: 0.44, impliedProbabilityPercent: 44, decimalOdds: 2.27 },
          ],
        },
      ],
    },
  });

  let requestBody;
  const summary = await backend.syncDeepSeekAnalyses({
    matchIds: ["korea-czechia"],
    deepseekApiKey: "test-key",
    generatedAt: "2026-06-12T15:00:00.000Z",
    fetchImpl: async (_url, request) => {
      requestBody = JSON.parse(request.body);
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "模型认为韩国方向略有价值，平局存在正边缘，但这不构成下注建议。",
              },
            },
          ],
        }),
      };
    },
  });
  const match = backend.getBackendMatch("korea-czechia");

  assert.equal(summary.generatedCount, 1);
  assert.deepEqual(summary.generatedMatchIds, ["korea-czechia"]);
  assert.equal(match.marketOdds.polymarket.aiAnalysis.provider, "deepseek");
  assert.equal(match.marketOdds.polymarket.aiAnalysis.generatedAt, "2026-06-12T15:00:00.000Z");
  assert.match(match.marketOdds.polymarket.aiAnalysis.text, /韩国方向模型概率略高于市场/);
  assert.equal(match.marketOdds.polymarket.aiAnalysis.text.includes("正边缘"), false);
  assert.equal(match.marketOdds.polymarket.aiAnalysis.text.includes("下注"), false);
  assert.equal(requestBody.messages[1].content.includes("total-over-2.5"), true);
});

test("generates model-only DeepSeek analyses without Polymarket markets", async (t) => {
  const backend = await withTempBackend(t);
  backend.ensureInitialPredictions();

  let requestBody;
  const summary = await backend.syncModelOnlyDeepSeekAnalyses({
    matchIds: ["canada-bosnia"],
    deepseekApiKey: "test-key",
    generatedAt: "2026-06-12T16:00:00.000Z",
    fetchImpl: async (_url, request) => {
      requestBody = JSON.parse(request.body);
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: "模型显示加拿大方向略占优，但仍不能保证结果，只能作为赛前概率参考。",
              },
            },
          ],
        }),
      };
    },
  });
  const match = backend.getBackendMatch("canada-bosnia");

  assert.equal(summary.generatedCount, 1);
  assert.deepEqual(summary.generatedMatchIds, ["canada-bosnia"]);
  assert.equal(match.aiAnalysis.modelOnly.provider, "deepseek");
  assert.equal(match.aiAnalysis.modelOnly.scope, "model_only");
  assert.equal(match.aiAnalysis.modelOnly.generatedAt, "2026-06-12T16:00:00.000Z");
  assert.match(match.aiAnalysis.modelOnly.text, /加拿大方向略占优/);
  assert.equal(requestBody.messages[1].content.includes("Polymarket"), false);
  assert.equal(requestBody.messages[1].content.includes("expectedGoals"), true);
});

test("rejects paid lineup sources", async (t) => {
  const backend = await withTempBackend(t);

  assert.throws(
    () => backend.syncLineups({
      payload: {
        source: {
          id: "paid-lineup-provider",
          name: "Paid lineup provider",
          retrievedAt: "2026-06-12T10:00:00.000Z",
          access: "paid",
        },
        lineups: [{ matchId: "mexico-south-africa", expected: {} }],
      },
    }),
    (error) => error.status === 400 && error.code === "paid_source_not_allowed",
  );
});

function buildFifaMatch({
  idMatch,
  matchNumber,
  date,
  homeCode,
  homeName,
  awayCode,
  awayName,
  groupName,
  cityName,
  homeScore = null,
  awayScore = null,
  matchStatus = 1,
}) {
  return {
    IdCompetition: "17",
    IdSeason: "285023",
    IdStage: "289273",
    IdGroup: "289275",
    IdMatch: idMatch,
    MatchNumber: matchNumber,
    Date: date,
    LocalDate: date,
    Home: {
      IdCountry: homeCode,
      Abbreviation: homeCode,
      ShortClubName: homeName,
      TeamName: [{ Locale: "en-GB", Description: homeName }],
      Score: homeScore,
    },
    Away: {
      IdCountry: awayCode,
      Abbreviation: awayCode,
      ShortClubName: awayName,
      TeamName: [{ Locale: "en-GB", Description: awayName }],
      Score: awayScore,
    },
    HomeTeamScore: homeScore,
    AwayTeamScore: awayScore,
    StageName: [{ Locale: "en-GB", Description: "First Stage" }],
    GroupName: [{ Locale: "en-GB", Description: groupName }],
    Stadium: {
      Name: [{ Locale: "en-GB", Description: `${cityName} Stadium` }],
      CityName: [{ Locale: "en-GB", Description: cityName }],
    },
    MatchStatus: matchStatus,
    ResultType: 0,
  };
}

function buildFifaRankingHtml() {
  const nextData = {
    props: {
      pageProps: {
        pageData: {
          ranking: {
            lastUpdateDate: "2026-06-11T10:00:59.636Z",
            nextUpdateDate: "2026-07-20T00:00:00.000Z",
          },
        },
      },
    },
  };
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script></body></html>`;
}

function buildApiFootballFixturesResponse() {
  return {
    response: [
      {
        fixture: {
          id: 1538999,
          date: "2026-06-11T19:00:00+00:00",
        },
        teams: {
          home: { id: 16, name: "Mexico", code: "MEX", country: "Mexico" },
          away: { id: 17, name: "South Africa", code: "RSA", country: "South Africa" },
        },
      },
    ],
  };
}

function buildApiFootballStatsResponse() {
  return {
    response: [
      {
        team: { id: 16, name: "Mexico" },
        statistics: [
          { type: "Ball Possession", value: "62%" },
          { type: "Total Shots", value: 15 },
          { type: "Shots on Goal", value: 6 },
          { type: "Corner Kicks", value: 4 },
          { type: "Fouls", value: 9 },
          { type: "Offsides", value: 2 },
          { type: "Passes %", value: "86%" },
        ],
      },
      {
        team: { id: 17, name: "South Africa" },
        statistics: [
          { type: "Ball Possession", value: "38%" },
          { type: "Total Shots", value: 7 },
          { type: "Shots on Goal", value: 4 },
          { type: "Corner Kicks", value: 5 },
          { type: "Fouls", value: 16 },
          { type: "Offsides", value: 2 },
          { type: "Passes %", value: "70%" },
        ],
      },
    ],
  };
}

function buildPolymarketWinnerEventResponse() {
  return {
    id: "30615",
    ticker: "world-cup-winner",
    slug: "world-cup-winner",
    title: "World Cup Winner",
    description: "This market will resolve according to the national team that wins the 2026 FIFA World Cup.",
    active: true,
    closed: false,
    restricted: true,
    volume: 2143552974.153736,
    liquidity: 432710488.00995,
    markets: [
      {
        id: "558934",
        question: "Will Spain win the 2026 FIFA World Cup?",
        slug: "will-spain-win-the-2026-fifa-world-cup-963",
        groupItemTitle: "Spain",
        outcomes: "[\"Yes\", \"No\"]",
        outcomePrices: "[\"0.165\", \"0.835\"]",
        clobTokenIds: "[\"yes-spain\", \"no-spain\"]",
        active: true,
        closed: false,
        restricted: true,
        acceptingOrders: true,
        bestBid: 0.164,
        bestAsk: 0.166,
        spread: 0.002,
        lastTradePrice: 0.165,
        volume: "40984337.71088025",
        volume24hr: "1940838.1899279966",
        liquidity: "6192359.4918",
      },
      {
        id: "558980",
        question: "Will United States win the 2026 FIFA World Cup?",
        slug: "will-united-states-win-the-2026-fifa-world-cup",
        groupItemTitle: "United States",
        outcomes: "[\"Yes\", \"No\"]",
        outcomePrices: "[\"0.065\", \"0.935\"]",
        clobTokenIds: "[\"yes-usa\", \"no-usa\"]",
        active: true,
        closed: false,
        restricted: true,
        acceptingOrders: true,
        bestBid: 0.064,
        bestAsk: 0.066,
        spread: 0.002,
        lastTradePrice: 0.065,
        volume: "1210000",
        volume24hr: "80000",
        liquidity: "650000",
      },
      {
        id: "558990",
        question: "Will Team AK win the 2026 FIFA World Cup?",
        slug: "will-team-ak-win-the-2026-fifa-world-cup",
        groupItemTitle: "Team AK",
        outcomes: "[\"Yes\", \"No\"]",
        outcomePrices: "[\"0\", \"1\"]",
        active: true,
        closed: false,
      },
    ],
  };
}

function buildPolymarketMatchEventResponse() {
  return {
    id: "351001",
    slug: "fifwc-mex-rsa-2026-06-11",
    title: "Mexico vs. South Africa",
    active: true,
    closed: false,
    restricted: true,
    markets: [
      {
        id: "1897001",
        question: "Will Mexico win on 2026-06-11?",
        slug: "fifwc-mex-rsa-2026-06-11-mex",
        groupItemTitle: "Mexico",
        outcomes: "[\"Yes\", \"No\"]",
        outcomePrices: "[\"0.735\", \"0.265\"]",
        clobTokenIds: "[\"yes-mexico\", \"no-mexico\"]",
        active: true,
        closed: false,
        acceptingOrders: true,
        bestBid: 0.734,
        bestAsk: 0.736,
        volume: "1000",
        liquidity: "2000",
      },
      {
        id: "1897002",
        question: "Will Mexico vs. South Africa end in a draw?",
        slug: "fifwc-mex-rsa-2026-06-11-draw",
        groupItemTitle: "Draw (Mexico vs. South Africa)",
        outcomes: "[\"Yes\", \"No\"]",
        outcomePrices: "[\"0.191\", \"0.809\"]",
        clobTokenIds: "[\"yes-draw\", \"no-draw\"]",
        active: true,
        closed: false,
        acceptingOrders: true,
      },
      {
        id: "1897003",
        question: "Will South Africa win on 2026-06-11?",
        slug: "fifwc-mex-rsa-2026-06-11-rsa",
        groupItemTitle: "South Africa",
        outcomes: "[\"Yes\", \"No\"]",
        outcomePrices: "[\"0.074\", \"0.926\"]",
        clobTokenIds: "[\"yes-rsa\", \"no-rsa\"]",
        active: true,
        closed: false,
        acceptingOrders: true,
      },
    ],
  };
}

function buildPolymarketMoreMarketsEventResponse() {
  return {
    id: "351002",
    slug: "fifwc-mex-rsa-2026-06-11-more-markets",
    title: "Mexico vs. South Africa - More Markets",
    active: true,
    closed: false,
    restricted: true,
    markets: [
      {
        id: "1897101",
        question: "Spread: Mexico (-1.5)",
        slug: "fifwc-mex-rsa-2026-06-11-spread-home-1pt5",
        groupItemTitle: "Mexico (-1.5)",
        outcomes: "[\"Mexico\", \"South Africa\"]",
        outcomePrices: "[\"0.305\", \"0.695\"]",
        clobTokenIds: "[\"spread-home\", \"spread-away\"]",
        active: true,
        closed: false,
        acceptingOrders: true,
      },
      {
        id: "1897102",
        question: "Mexico vs. South Africa: O/U 2.5",
        slug: "fifwc-mex-rsa-2026-06-11-total-2pt5",
        groupItemTitle: "O/U 2.5",
        outcomes: "[\"Over\", \"Under\"]",
        outcomePrices: "[\"0.445\", \"0.555\"]",
        clobTokenIds: "[\"over-25\", \"under-25\"]",
        active: true,
        closed: false,
        acceptingOrders: true,
      },
      {
        id: "1897103",
        question: "Mexico vs. South Africa: Both Teams to Score",
        slug: "fifwc-mex-rsa-2026-06-11-btts",
        groupItemTitle: "Both Teams to Score",
        outcomes: "[\"Yes\", \"No\"]",
        outcomePrices: "[\"0.465\", \"0.535\"]",
        clobTokenIds: "[\"btts-yes\", \"btts-no\"]",
        active: true,
        closed: false,
        acceptingOrders: true,
      },
      {
        id: "1897104",
        question: "Mexico vs. South Africa: South Africa O/U 0.5",
        slug: "fifwc-mex-rsa-2026-06-11-team-total-away-0pt5",
        groupItemTitle: "South Africa O/U 0.5",
        outcomes: "[\"Over\", \"Under\"]",
        outcomePrices: "[\"0.575\", \"0.425\"]",
        clobTokenIds: "[\"away-over-05\", \"away-under-05\"]",
        active: true,
        closed: false,
        acceptingOrders: true,
      },
      {
        id: "1897105",
        question: "Mexico vs. South Africa: South Africa 1st Half O/U 0.5",
        slug: "fifwc-mex-rsa-2026-06-11-first-half-team-total-away-0pt5",
        groupItemTitle: "South Africa 1st Half O/U 0.5",
        outcomes: "[\"Over\", \"Under\"]",
        outcomePrices: "[\"0.29\", \"0.71\"]",
        active: true,
        closed: false,
        acceptingOrders: true,
      },
    ],
  };
}

function buildFifaLiveLineup({
  idMatch,
  homeIdTeam,
  awayIdTeam,
}) {
  return {
    IdMatch: idMatch,
    HomeTeam: {
      Tactics: "4-3-3",
      Players: [
        ...buildFifaPlayers(homeIdTeam, 1, 11),
        ...buildFifaPlayers(homeIdTeam, 12, 2, { status: 2 }),
      ],
    },
    AwayTeam: {
      Tactics: "5-3-2",
      Players: [
        ...buildFifaPlayers(awayIdTeam, 1, 11),
        ...buildFifaPlayers(awayIdTeam, 12, 2, { status: 2 }),
      ],
    },
  };
}

function buildFifaLiveFacts({
  idMatch,
  homeIdTeam,
  awayIdTeam,
}) {
  return {
    IdMatch: idMatch,
    HomeTeam: {
      Score: 2,
      Tactics: "4-3-3",
      Players: [
        ...buildFifaPlayers(homeIdTeam, 1, 11),
        ...buildFifaPlayers(homeIdTeam, 12, 2, { status: 2 }),
      ],
      Goals: [
        { Type: 2, IdPlayer: `${homeIdTeam}-9`, Minute: "9'", Period: 3, IdTeam: homeIdTeam },
        { Type: 2, IdPlayer: `${homeIdTeam}-10`, Minute: "67'", Period: 5, IdTeam: homeIdTeam },
      ],
      Bookings: [
        { Card: 1, Period: 3, IdPlayer: `${homeIdTeam}-5`, IdTeam: homeIdTeam, Minute: "23'" },
      ],
      Substitutions: [
        {
          Period: 5,
          IdPlayerOff: `${homeIdTeam}-8`,
          IdPlayerOn: `${homeIdTeam}-12`,
          PlayerOffName: [{ Locale: "en-GB", Description: "Player 8" }],
          PlayerOnName: [{ Locale: "en-GB", Description: "Player 12" }],
          Minute: "66'",
          IdTeam: homeIdTeam,
        },
      ],
    },
    AwayTeam: {
      Score: 0,
      Tactics: "5-3-2",
      Players: [
        ...buildFifaPlayers(awayIdTeam, 1, 11),
        ...buildFifaPlayers(awayIdTeam, 12, 2, { status: 2 }),
      ],
      Goals: [],
      Bookings: [],
      Substitutions: [],
    },
    Weather: {
      Temperature: 22,
      Humidity: 60,
      WindSpeed: null,
      TypeLocalized: [{ Locale: "en-GB", Description: "Cloudy" }],
    },
  };
}

function buildFifaPlayers(idTeam, startNumber, count, options = {}) {
  return Array.from({ length: count }, (_, index) => {
    const shirtNumber = startNumber + index;
    return {
      IdPlayer: `${idTeam}-${shirtNumber}`,
      IdTeam: idTeam,
      ShirtNumber: shirtNumber,
      Status: options.status ?? 1,
      Captain: shirtNumber === 1 && (options.status ?? 1) === 1,
      PlayerName: [{ Locale: "en-GB", Description: `Player ${shirtNumber}` }],
      ShortName: [{ Locale: "en-GB", Description: `P. ${shirtNumber}` }],
      Position: index === 0 ? 0 : index < 5 ? 1 : index < 8 ? 2 : 3,
    };
  });
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function buildRotowireLineupsHtml() {
  return `
    <div class="lineup is-soccer">
      <div class="lineup__team is-home">
        <div class="lineup__abbr">CAN</div>
      </div>
      <div class="lineup__team is-visit">
        <div class="lineup__abbr">BIH</div>
      </div>
      <ul class="lineup__list is-home">
        <li class="lineup__status is-expected"><div></div>Predicted Lineup</li>
        <li class="lineup__player">
          <div class="lineup__pos ">GK</div>
          <a title="Maxime Crepeau" href="/soccer/player/maxime-crepeau-19014">M. Crepeau</a>
        </li>
        <li class="lineup__player">
          <div class="lineup__pos ">FW</div>
          <a title="Jonathan David" href="/soccer/player/jonathan-david-27565">J. David</a>
        </li>
        <li class="lineup__title is-middle">Injuries</li>
        <li class="lineup__player">
          <div class="lineup__pos ">M</div>
          <a title="Tajon Buchanan" href="/soccer/player/tajon-buchanan-31603">T. Buchanan</a>
          <span class="lineup__inj">QUES</span>
        </li>
      </ul>
      <ul class="lineup__list is-visit">
        <li class="lineup__status is-expected"><div></div>Predicted Lineup</li>
        <li class="lineup__player">
          <div class="lineup__pos ">GK</div>
          <a title="Nikola Vasilj" href="/soccer/player/nikola-vasilj-33532">N. Vasilj</a>
        </li>
        <li class="lineup__player">
          <div class="lineup__pos ">FW</div>
          <a title="Ermedin Demirovic" href="/soccer/player/ermedin-demirovic-23458">E. Demirovic</a>
        </li>
      </ul>
    </div>
  `;
}
