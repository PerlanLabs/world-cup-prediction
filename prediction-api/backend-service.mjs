import { randomUUID } from "node:crypto";
import {
  applyApiFootballFixtureIdsToStore,
  applyApiFootballStatsToStore,
  fetchApiFootballFixtureIndexPayload,
  fetchApiFootballStatsPayloadForMatches,
} from "./api-football-sync.mjs";
import { applyFifaFixturesToStore, fetchFifaFixtures } from "./fifa-sync.mjs";
import { fetchOfficialLineupPayloadForMatches } from "./fifa-lineup-sync.mjs";
import { applyFifaMatchFactsToStore, fetchFifaMatchFactsPayloadForMatches } from "./fifa-match-facts-sync.mjs";
import { applyFifaRankingsToStore, fetchFifaRankingPayload } from "./fifa-ranking-sync.mjs";
import { generateDeepSeekModelAnalysis, generateDeepSeekStrategyAnalysis, maybeAttachDeepSeekAnalyses } from "./deepseek-analysis.mjs";
import { getLineupIntelForMatch } from "./lineup-intel.mjs";
import { applyLineupPayloadToStore, readLineupPayloadFromFile } from "./lineup-sync.mjs";
import { calibrateCurrentRatings, exportOfficialResults } from "./model-refresh.mjs";
import {
  applyPolymarketMatchMarketsToStore,
  fetchPolymarketMatchMarketsPayload,
  readPolymarketMatchMarketsPayloadFromFile,
} from "./polymarket-match-markets-sync.mjs";
import { fetchPolymarketAccountSnapshot } from "./polymarket-account-monitor.mjs";
import { applyPolymarketWorldCupMarketsToStore, fetchPolymarketWorldCupMarketsPayload } from "./polymarket-sync.mjs";
import { fetchRotowireExpectedLineupPayload } from "./rotowire-lineup-sync.mjs";
import { getStore, getStoreDriver, getStoreFilePath, mutateStore } from "./store.mjs";
import { getRecentFormsForMatch } from "./team-form.mjs";
import { applyUpstreamTrackRecordToStore, fetchUpstreamTrackRecordPayload } from "./upstream-track-record-sync.mjs";
import { getModelMetadata, listTeams, predictMatch, resetModelCache } from "./model-adapter.mjs";
import { analyzeStore } from "./validation.mjs";
import { DC_RHO, poissonPmf } from "../world-cup-2026-prediction-model/elo.mjs";

const SCORELINE_MAX_GOALS = 8;

export function listBackendTeams() {
  return getStore().teams;
}

export function listBackendSources() {
  return getStore().sources;
}

export function listModelRuns() {
  return [...getStore().modelRuns].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

export function getBackendDataQuality() {
  return {
    ...analyzeStore(getStore(), { modelTeams: listTeams() }),
    store: {
      path: getStoreFilePath(),
      persistence: getStoreDriver(),
    },
    model: getModelMetadata(),
  };
}

export function listBackendMatches(query = {}) {
  const store = getStore();
  const includePrediction = query.include === "prediction" || query.include === "all";

  return store.matches
    .filter((match) => filterMatch(match, query))
    .sort(sortMatches)
    .map((match) => enrichMatch(store, match, includePrediction));
}

export function getBackendMatch(matchId, options = {}) {
  const store = getStore();
  const match = store.matches.find((item) => item.id === matchId);
  if (!match) return null;
  return enrichMatch(store, match, options.includePrediction ?? true);
}

export function getLatestPrediction(matchId) {
  const store = getStore();
  return findLatestPrediction(store, matchId);
}

export function listPredictionHistory(matchId) {
  return getStore().predictions
    .filter((prediction) => prediction.matchId === matchId)
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

export function freezePreMatchPredictions(options = {}) {
  const generatedAt = options.generatedAt ?? options.now ?? new Date().toISOString();
  const lockBeforeMinutes = toNumber(options.lockBeforeMinutes, 60);
  const selectedIds = normalizeMatchIds(options.matchIds);
  let summary;

  mutateStore((store) => {
    validateKnownMatchIds(store, selectedIds);
    const nowMs = Date.parse(generatedAt);
    if (!Number.isFinite(nowMs)) {
      throw apiError(400, `Invalid freeze time: ${generatedAt}.`, "bad_request");
    }

    const lockWindowEnd = nowMs + lockBeforeMinutes * 60 * 1000;
    const frozen = [];
    const skipped = [];

    for (const match of store.matches.filter(isPredictableMatch).sort(sortMatches)) {
      if (selectedIds?.length && !selectedIds.includes(match.id)) continue;

      const kickoffMs = getMatchKickoffTime(match);
      if (!Number.isFinite(kickoffMs)) {
        skipped.push({ matchId: match.id, reason: "missing_kickoff" });
        continue;
      }

      const existing = findFrozenPrediction(store, match.id);
      if (existing) {
        skipped.push({ matchId: match.id, reason: "already_frozen", predictionId: existing.id });
        continue;
      }

      const due = kickoffMs <= lockWindowEnd || hasFinalScore(match);
      if (!due && !options.force) {
        continue;
      }

      const candidate = findFreezeCandidatePrediction(store, match.id, Math.min(nowMs, kickoffMs));
      if (!candidate) {
        skipped.push({ matchId: match.id, reason: "no_prediction_before_kickoff" });
        continue;
      }

      candidate.audit = {
        ...(candidate.audit ?? {}),
        freezeType: "pre_match_final",
        frozenAt: generatedAt,
        kickoffAt: new Date(kickoffMs).toISOString(),
        lockBeforeMinutes,
        policy: "latest_prediction_generated_before_kickoff",
      };
      frozen.push({
        matchId: match.id,
        predictionId: candidate.id,
        predictionGeneratedAt: candidate.generatedAt,
        kickoffAt: candidate.audit.kickoffAt,
      });
    }

    upsertById(store.sources, {
      id: "model-prediction-freeze",
      name: "Pre-match final prediction freeze",
      retrievedAt: generatedAt,
      tier: 1,
      access: "local_generated",
      notes: "Marks the latest prediction generated before kickoff as the immutable pre-match snapshot for model performance review.",
      lastSync: {
        generatedAt,
        lockBeforeMinutes,
        frozenCount: frozen.length,
        skippedCount: skipped.length,
      },
    });

    summary = {
      sourceId: "model-prediction-freeze",
      generatedAt,
      lockBeforeMinutes,
      frozenCount: frozen.length,
      frozen,
      skippedCount: skipped.length,
      skipped,
    };

    return store;
  });

  return summary;
}

export function getModelTrackRecord(options = {}) {
  const store = getStore();
  const limit = Number(options.limit ?? 200);
  const allRows = store.matches
    .filter(isPredictableMatch)
    .sort(sortMatches)
    .map((match) => buildTrackRecordRow(store, match))
    .filter((row) => row.status !== "not_due");
  const rows = allRows.slice(0, Number.isFinite(limit) && limit > 0 ? limit : 200);
  const scoredRows = allRows.filter((row) => row.status === "scored");
  const frozenRows = allRows.filter((row) => row.frozenPrediction);
  const missingFreezeRows = allRows.filter((row) => row.status === "missing_freeze");
  const correctRows = scoredRows.filter((row) => row.score?.pickedCorrect);
  const exactTopScoreRows = scoredRows.filter((row) => row.score?.topScorelineHit);
  const top3ScoreRows = scoredRows.filter((row) => row.score?.top3ScorelineHit);
  const top5ScoreRows = scoredRows.filter((row) => row.score?.top5ScorelineHit);

  return {
    generatedAt: new Date().toISOString(),
    policy: {
      freezeType: "pre_match_final",
      defaultLockBeforeMinutes: 60,
      scoring: "Frozen prediction snapshots are compared against official final scores. Refreshed post-match predictions are ignored.",
    },
    summary: {
      matchCount: allRows.length,
      frozenCount: frozenRows.length,
      scoredCount: scoredRows.length,
      pendingFrozenCount: allRows.filter((row) => row.status === "frozen_pending").length,
      missingFreezeCompletedCount: missingFreezeRows.length,
      correctPicks: correctRows.length,
      accuracy: scoredRows.length ? round(correctRows.length / scoredRows.length, 4) : null,
      exactTopScoreHits: exactTopScoreRows.length,
      exactTopScoreRate: scoredRows.length ? round(exactTopScoreRows.length / scoredRows.length, 4) : null,
      top3ScorelineHits: top3ScoreRows.length,
      top3ScorelineRate: scoredRows.length ? round(top3ScoreRows.length / scoredRows.length, 4) : null,
      top5ScorelineHits: top5ScoreRows.length,
      top5ScorelineRate: scoredRows.length ? round(top5ScoreRows.length / scoredRows.length, 4) : null,
      averageActualProbability: average(scoredRows.map((row) => row.score?.actualProbability)),
      averageActualOutcomeProbability: average(scoredRows.map((row) => row.score?.actualProbability)),
      averageActualScorelineProbability: average(scoredRows.map((row) => row.score?.actualScorelineProbability)),
      averageExactScoreLogLoss: average(scoredRows.map((row) => row.score?.exactScoreLogLoss)),
      averageRps: average(scoredRows.map((row) => row.score?.rps)),
      averageBrier: average(scoredRows.map((row) => row.score?.brier)),
      derivedMarketAccuracy: summarizeDerivedMarkets(scoredRows),
    },
    rows,
    model: getModelMetadata(),
  };
}

export async function backfillUpstreamTrackRecord(options = {}) {
  const payload = options.payload ?? await fetchUpstreamTrackRecordPayload({
    fetchImpl: options.fetchImpl,
    fetchedAt: options.fetchedAt,
    resultsUrl: options.resultsUrl,
    ratingsUrl: options.ratingsUrl,
    localRepoPath: options.localRepoPath,
    disableLocalFallback: options.disableLocalFallback,
  });
  let summary;

  mutateStore((store) => {
    summary = applyUpstreamTrackRecordToStore(store, payload, {
      generatedAt: options.generatedAt,
      force: options.force,
    });
    return store;
  });

  return summary;
}

export function runPredictions({ matchIds } = {}) {
  const now = new Date().toISOString();
  const selectedIds = Array.isArray(matchIds)
    ? [...new Set(matchIds.filter((matchId) => typeof matchId === "string" && matchId.trim()))]
    : undefined;
  let runSummary;

  mutateStore((store) => {
    if (selectedIds?.length) {
      const knownIds = new Set(store.matches.map((match) => match.id));
      const unknownIds = selectedIds.filter((matchId) => !knownIds.has(matchId));
      if (unknownIds.length > 0) {
        throw apiError(404, `Unknown match id: ${unknownIds.join(", ")}.`, "not_found");
      }
    }

    const candidateMatches = store.matches.filter((match) => !selectedIds?.length || selectedIds.includes(match.id));
    if (candidateMatches.length === 0) {
      throw apiError(400, "No matches selected for prediction run.");
    }

    const unsupportedMatches = candidateMatches.filter((match) => !isPredictableMatch(match));
    if (selectedIds?.length && unsupportedMatches.length > 0) {
      throw apiError(
        400,
        `Selected matches are not covered by the prediction model: ${unsupportedMatches.map((match) => match.id).join(", ")}.`,
      );
    }

    const selectedMatches = candidateMatches.filter(isPredictableMatch);
    if (selectedMatches.length === 0) {
      throw apiError(400, "No selected matches are covered by the prediction model.");
    }

    const runId = `run_${compactTimestamp(now)}_${shortId()}`;
    const snapshots = selectedMatches.map((match) => buildPredictionSnapshot(match, runId, now));

    store.predictions.push(...snapshots);
    store.modelRuns.push({
      id: runId,
      generatedAt: now,
      matchIds: selectedMatches.map((match) => match.id),
      predictionIds: snapshots.map((snapshot) => snapshot.id),
      model: getModelMetadata(),
    });

    runSummary = {
      id: runId,
      generatedAt: now,
      matchCount: selectedMatches.length,
      skippedUnsupportedCount: unsupportedMatches.length,
      skippedUnsupportedMatches: unsupportedMatches.map((match) => match.id),
      predictionIds: snapshots.map((snapshot) => snapshot.id),
      matches: selectedMatches.map((match) => match.id),
    };

    return store;
  });

  return runSummary;
}

export function ensureInitialPredictions() {
  const store = getStore();
  if (store.predictions.length > 0) return;
  runPredictions();
}

export function refreshModelRatings(options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const officialResults = exportOfficialResults({
    generatedAt,
    path: options.officialResultsPath,
  });
  const calibration = calibrateCurrentRatings({
    generatedAt,
    officialResultsPath: officialResults.path,
    outputPath: options.currentRatingsPath,
    refresh: options.refresh,
  });

  resetModelCache();

  const predictionMatchIds = getRefreshPredictionMatchIds(options);
  const shouldRunPredictions = predictionMatchIds.length > 0 && (calibration.changed || options.refreshPredictions);
  const predictionRun = shouldRunPredictions ? runPredictions({ matchIds: predictionMatchIds }) : null;

  mutateStore((store) => {
    upsertById(store.sources, {
      id: "model-rating-refresh",
      name: "Current model rating refresh",
      url: calibration.path,
      retrievedAt: generatedAt,
      tier: 1,
      access: "local_generated",
      notes: "Generated from immutable base results plus FIFA official World Cup results exported from the local store.",
      lastSync: {
        generatedAt,
        officialResultsPath: officialResults.path,
        officialResultsCount: officialResults.matchCount,
        officialResultsHash: officialResults.hash,
        currentRatingsPath: calibration.path,
        inputHash: calibration.inputHash,
        ratingsChanged: calibration.changed,
        predictionMode: options.predictionMode ?? "pending",
        predictionRunId: predictionRun?.id ?? null,
        predictionMatchCount: predictionRun?.matchCount ?? 0,
      },
    });
    return store;
  });

  return {
    sourceId: "model-rating-refresh",
    generatedAt,
    officialResults,
    calibration,
    predictionMode: options.predictionMode ?? "pending",
    predictionMatchCount: predictionMatchIds.length,
    predictionMatchIds,
    predictionRun,
    skippedPredictionRun: !shouldRunPredictions,
    model: getModelMetadata(),
  };
}

export async function syncOfficialFixtures(options = {}) {
  const syncPayload = await fetchFifaFixtures(options);
  let summary;

  mutateStore((store) => {
    const result = applyFifaFixturesToStore(store, syncPayload, {
      mode: options.mode ?? "supported",
    });
    summary = result.summary;
    return result.store;
  });

  const missingPredictionMatchIds = summary.predictableMatchIds.filter((matchId) => !getLatestPrediction(matchId));
  if (missingPredictionMatchIds.length > 0) {
    summary.predictionRun = runPredictions({ matchIds: missingPredictionMatchIds });
  }

  return summary;
}

export function syncLineups(options = {}) {
  const payload = options.payload ?? loadLineupPayloadFromFile(options.path);
  let summary;

  mutateStore((store) => {
    const result = applyLineupPayloadToStore(store, payload, {
      retrievedAt: options.retrievedAt,
      reviewedAt: options.reviewedAt,
    });
    summary = result.summary;
    return result.store;
  });

  return summary;
}

export async function syncExpectedLineups(options = {}) {
  const store = getStore();
  const payload = await fetchRotowireExpectedLineupPayload(store.matches, {
    fetchImpl: options.fetchImpl,
    fetchedAt: options.fetchedAt,
    url: options.url,
  });
  let summary;

  mutateStore((currentStore) => {
    const result = applyLineupPayloadToStore(currentStore, payload, {
      retrievedAt: payload.source.retrievedAt,
      reviewedAt: payload.source.retrievedAt,
    });
    summary = result.summary;
    return result.store;
  });

  return {
    ...summary,
    probe: payload.probe,
  };
}

export async function syncOfficialLineups(options = {}) {
  const store = getStore();
  const selection = selectMatchesForLineupSync(store.matches, options);
  const selectedMatches = selection.matches;
  const payload = await fetchOfficialLineupPayloadForMatches(selectedMatches, {
    fetchImpl: options.fetchImpl,
    fetchedAt: options.fetchedAt,
    language: options.language,
  });
  let summary;

  mutateStore((currentStore) => {
    const result = applyLineupPayloadToStore(currentStore, payload, {
      retrievedAt: payload.source.retrievedAt,
    });
    summary = result.summary;
    return result.store;
  });

  return {
    ...summary,
    selection: {
      ...selection,
      matches: undefined,
    },
    probe: payload.probe,
  };
}

export async function syncOfficialMatchFacts(options = {}) {
  const store = getStore();
  const selection = selectMatchesForMatchFactsSync(store.matches, options);
  const selectedMatches = selection.matches;
  const payload = await fetchFifaMatchFactsPayloadForMatches(selectedMatches, {
    fetchImpl: options.fetchImpl,
    fetchedAt: options.fetchedAt,
    language: options.language,
  });
  let summary;

  mutateStore((currentStore) => {
    const result = applyFifaMatchFactsToStore(currentStore, payload);
    summary = result.summary;
    return result.store;
  });

  return {
    ...summary,
    selection: {
      ...selection,
      matches: undefined,
    },
    probe: payload.probe,
  };
}

export async function syncFifaTeamRankings(options = {}) {
  const payload = await fetchFifaRankingPayload({
    fetchImpl: options.fetchImpl,
    fetchedAt: options.fetchedAt,
    rankingUrl: options.rankingUrl,
    pageUrl: options.pageUrl,
  });
  let summary;

  mutateStore((store) => {
    const result = applyFifaRankingsToStore(store, payload);
    summary = result.summary;
    return result.store;
  });

  return summary;
}

export async function syncApiFootballFixtureIds(options = {}) {
  const store = getStore();
  const payload = await fetchApiFootballFixtureIndexPayload(store.matches, {
    fetchImpl: options.fetchImpl,
    fetchedAt: options.fetchedAt,
    key: options.key,
    league: options.league,
    season: options.season,
  });
  let summary;

  mutateStore((currentStore) => {
    const result = applyApiFootballFixtureIdsToStore(currentStore, payload);
    summary = result.summary;
    return result.store;
  });

  return summary;
}

export async function syncApiFootballMatchStats(options = {}) {
  const store = getStore();
  const selection = selectMatchesForApiFootballStatsSync(store.matches, options);
  if (selection.matches.length === 0) {
    return {
      sourceId: "api-football-fixture-statistics",
      sourceUrl: "https://v3.football.api-sports.io/fixtures/statistics",
      fetchedAt: options.fetchedAt ?? new Date().toISOString(),
      importedCount: 0,
      importedMatchIds: [],
      skippedCount: 0,
      skipped: [],
      selection: {
        ...selection,
        matches: undefined,
      },
      probe: {
        requestedCount: 0,
        availableCount: 0,
        skippedCount: 0,
        skipped: [],
      },
      noop: true,
    };
  }
  const payload = await fetchApiFootballStatsPayloadForMatches(selection.matches, {
    fetchImpl: options.fetchImpl,
    fetchedAt: options.fetchedAt,
    key: options.key,
  });
  let summary;

  mutateStore((currentStore) => {
    const result = applyApiFootballStatsToStore(currentStore, payload);
    summary = result.summary;
    return result.store;
  });

  return {
    ...summary,
    selection: {
      ...selection,
      matches: undefined,
    },
    probe: payload.probe,
  };
}

export async function syncApiFootballSupplementalData(options = {}) {
  const fixtureSync = options.skipFixtureSync
    ? null
    : await syncApiFootballFixtureIds({
      fetchImpl: options.fetchImpl,
      fetchedAt: options.fetchedAt,
      key: options.key,
      league: options.league,
      season: options.season,
    });

  const statisticsSync = await syncApiFootballMatchStats({
    fetchImpl: options.fetchImpl,
    fetchedAt: options.fetchedAt,
    key: options.key,
    matchIds: options.matchIds,
    mode: options.mode ?? "completed",
  });

  return {
    sourceId: "api-football-supplemental-sync",
    fetchedAt: statisticsSync.fetchedAt ?? fixtureSync?.fetchedAt ?? new Date().toISOString(),
    fixtureSync,
    statisticsSync,
    summary: {
      fixtureImportedCount: fixtureSync?.importedCount ?? null,
      statisticsImportedCount: statisticsSync.importedCount,
      statisticsSkippedCount: statisticsSync.skippedCount,
      statisticsMatchIds: statisticsSync.importedMatchIds,
    },
  };
}

export async function syncPolymarketWorldCupMarkets(options = {}) {
  const payload = await fetchPolymarketWorldCupMarketsPayload({
    fetchImpl: options.fetchImpl,
    fetchedAt: options.fetchedAt,
    eventSlugs: options.eventSlugs,
  });
  let summary;

  mutateStore((store) => {
    const result = applyPolymarketWorldCupMarketsToStore(store, payload);
    summary = result.summary;
    return result.store;
  });

  return summary;
}

export async function getPolymarketAccountSnapshot(options = {}) {
  return fetchPolymarketAccountSnapshot({
    store: getStore(),
    address: options.address,
    fetchImpl: options.fetchImpl,
    limit: options.limit,
    scenarioMaxGoals: options.scenarioMaxGoals,
    fetchedAt: options.fetchedAt,
  });
}

export async function syncPolymarketMatchMarkets(options = {}) {
  const store = getStore();
  let payload = await fetchPolymarketMatchMarketsPayload(store.matches, {
    teams: store.teams,
    fetchImpl: options.fetchImpl,
    fetchedAt: options.fetchedAt,
    matchIds: options.matchIds,
    mode: options.mode,
    limit: options.limit,
    eventSlugByMatchId: options.eventSlugByMatchId,
  });
  payload = await maybeAttachDeepSeekAnalyses(payload, store, {
    fetchImpl: options.aiFetchImpl,
    fetchedAt: options.fetchedAt,
    withAi: options.withAi,
    aiLimit: options.aiLimit,
    deepseekApiKey: options.deepseekApiKey,
    deepseekBaseUrl: options.deepseekBaseUrl,
    deepseekModel: options.deepseekModel,
  });
  let summary;

  mutateStore((currentStore) => {
    const result = applyPolymarketMatchMarketsToStore(currentStore, payload);
    summary = result.summary;
    return result.store;
  });

  return {
    ...summary,
    probe: payload.probe,
    ai: payload.ai ?? null,
  };
}

export async function syncDeepSeekAnalyses(options = {}) {
  const store = getStore();
  const selectedMatchIds = normalizeMatchIds(options.matchIds);
  validateKnownMatchIds(store, selectedMatchIds);

  const candidates = [];
  const skipped = [];
  const limit = Math.max(0, toNumber(options.limit, Number.POSITIVE_INFINITY));
  if (limit === 0) {
    return {
      sourceId: "deepseek-ai-analysis",
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      generatedCount: 0,
      generatedMatchIds: [],
      skippedCount: 0,
      skipped: [],
      noop: true,
    };
  }

  for (const match of store.matches.sort(sortMatches)) {
    if (selectedMatchIds?.length && !selectedMatchIds.includes(match.id)) continue;

    const polymarket = match.marketOdds?.polymarket;
    if (!polymarket || polymarket.status !== "available" || !Array.isArray(polymarket.moneyline) || polymarket.moneyline.length === 0) {
      skipped.push({ matchId: match.id, reason: "polymarket_market_unavailable" });
      continue;
    }
    if (polymarket.aiAnalysis?.text && !options.refresh) {
      skipped.push({ matchId: match.id, reason: "ai_analysis_exists" });
      continue;
    }

    const prediction = findLatestPrediction(store, match.id);
    if (!prediction) {
      skipped.push({ matchId: match.id, reason: "prediction_unavailable" });
      continue;
    }

    const homeTeam = store.teams.find((team) => team.id === match.homeTeamId);
    const awayTeam = store.teams.find((team) => team.id === match.awayTeamId);
    if (!homeTeam || !awayTeam) {
      skipped.push({ matchId: match.id, reason: "team_unavailable" });
      continue;
    }

    candidates.push({ match, homeTeam, awayTeam, prediction, polymarket });
    if (candidates.length >= limit) break;
  }

  if (candidates.length === 0) {
    return {
      sourceId: "deepseek-ai-analysis",
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      generatedCount: 0,
      generatedMatchIds: [],
      skippedCount: skipped.length,
      skipped,
      noop: true,
    };
  }

  const apiKey = options.deepseekApiKey ?? process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw apiError(400, "DEEPSEEK_API_KEY is required for AI analysis generation.", "missing_deepseek_api_key");
  }

  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const generated = [];
  for (const candidate of candidates) {
    const aiAnalysis = await generateDeepSeekStrategyAnalysis({
      match: candidate.match,
      homeTeam: candidate.homeTeam,
      awayTeam: candidate.awayTeam,
      prediction: candidate.prediction,
      polymarket: candidate.polymarket,
    }, {
      apiKey,
      fetchImpl: options.fetchImpl,
      baseUrl: options.deepseekBaseUrl,
      model: options.deepseekModel,
      generatedAt,
    });
    generated.push({ matchId: candidate.match.id, aiAnalysis });
  }

  mutateStore((currentStore) => {
    const analysesByMatchId = new Map(generated.map((item) => [item.matchId, item.aiAnalysis]));
    for (const match of currentStore.matches) {
      const aiAnalysis = analysesByMatchId.get(match.id);
      if (!aiAnalysis) continue;
      match.marketOdds = {
        ...(match.marketOdds ?? {}),
        polymarket: {
          ...(match.marketOdds?.polymarket ?? {}),
          aiAnalysis,
        },
      };
    }
    upsertById(currentStore.sources, {
      id: "deepseek-ai-analysis",
      name: "DeepSeek AI structured match analysis",
      url: "https://api.deepseek.com",
      retrievedAt: generatedAt,
      tier: 3,
      access: "api_key",
      notes: "LLM explanation generated only from stored model probabilities and read-only Polymarket market data.",
      lastSync: {
        generatedAt,
        generatedCount: generated.length,
        generatedMatchIds: generated.map((item) => item.matchId),
        refresh: Boolean(options.refresh),
      },
    });
    return currentStore;
  });

  return {
    sourceId: "deepseek-ai-analysis",
    generatedAt,
    provider: "deepseek",
    model: options.deepseekModel ?? "deepseek-chat",
    generatedCount: generated.length,
    generatedMatchIds: generated.map((item) => item.matchId),
    skippedCount: skipped.length,
    skipped,
    refresh: Boolean(options.refresh),
  };
}

export async function syncModelOnlyDeepSeekAnalyses(options = {}) {
  const store = getStore();
  const selectedMatchIds = normalizeMatchIds(options.matchIds);
  validateKnownMatchIds(store, selectedMatchIds);

  const candidates = [];
  const skipped = [];
  const limit = Math.max(0, toNumber(options.limit, Number.POSITIVE_INFINITY));
  if (limit === 0) {
    return {
      sourceId: "deepseek-model-only-analysis",
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      generatedCount: 0,
      generatedMatchIds: [],
      skippedCount: 0,
      skipped: [],
      noop: true,
    };
  }

  for (const match of store.matches.sort(sortMatches)) {
    if (selectedMatchIds?.length && !selectedMatchIds.includes(match.id)) continue;
    if (options.missingMarketOnly && match.marketOdds?.polymarket?.status === "available") {
      skipped.push({ matchId: match.id, reason: "polymarket_market_available" });
      continue;
    }
    if (match.aiAnalysis?.modelOnly?.text && !options.refresh) {
      skipped.push({ matchId: match.id, reason: "model_only_ai_analysis_exists" });
      continue;
    }

    const prediction = findLatestPrediction(store, match.id);
    if (!prediction) {
      skipped.push({ matchId: match.id, reason: "prediction_unavailable" });
      continue;
    }

    const homeTeam = store.teams.find((team) => team.id === match.homeTeamId);
    const awayTeam = store.teams.find((team) => team.id === match.awayTeamId);
    if (!homeTeam || !awayTeam) {
      skipped.push({ matchId: match.id, reason: "team_unavailable" });
      continue;
    }

    candidates.push({
      match,
      homeTeam,
      awayTeam,
      prediction,
      recentForm: getRecentFormsForMatch(match, store),
    });
    if (candidates.length >= limit) break;
  }

  if (candidates.length === 0) {
    return {
      sourceId: "deepseek-model-only-analysis",
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      generatedCount: 0,
      generatedMatchIds: [],
      skippedCount: skipped.length,
      skipped,
      noop: true,
    };
  }

  const apiKey = options.deepseekApiKey ?? process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw apiError(400, "DEEPSEEK_API_KEY is required for AI analysis generation.", "missing_deepseek_api_key");
  }

  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const generated = [];
  for (const candidate of candidates) {
    const aiAnalysis = await generateDeepSeekModelAnalysis({
      match: candidate.match,
      homeTeam: candidate.homeTeam,
      awayTeam: candidate.awayTeam,
      prediction: candidate.prediction,
      recentForm: candidate.recentForm,
    }, {
      apiKey,
      fetchImpl: options.fetchImpl,
      baseUrl: options.deepseekBaseUrl,
      model: options.deepseekModel,
      generatedAt,
    });
    generated.push({ matchId: candidate.match.id, aiAnalysis });
  }

  mutateStore((currentStore) => {
    const analysesByMatchId = new Map(generated.map((item) => [item.matchId, item.aiAnalysis]));
    for (const match of currentStore.matches) {
      const aiAnalysis = analysesByMatchId.get(match.id);
      if (!aiAnalysis) continue;
      match.aiAnalysis = {
        ...(match.aiAnalysis ?? {}),
        modelOnly: aiAnalysis,
      };
    }
    upsertById(currentStore.sources, {
      id: "deepseek-model-only-analysis",
      name: "DeepSeek AI model-only match analysis",
      url: "https://api.deepseek.com",
      retrievedAt: generatedAt,
      tier: 3,
      access: "api_key",
      notes: "LLM explanation generated only from stored model probabilities, FIFA ranking context, and computed recent form.",
      lastSync: {
        generatedAt,
        generatedCount: generated.length,
        generatedMatchIds: generated.map((item) => item.matchId),
        refresh: Boolean(options.refresh),
      },
    });
    return currentStore;
  });

  return {
    sourceId: "deepseek-model-only-analysis",
    generatedAt,
    provider: "deepseek",
    model: options.deepseekModel ?? "deepseek-chat",
    generatedCount: generated.length,
    generatedMatchIds: generated.map((item) => item.matchId),
    skippedCount: skipped.length,
    skipped,
    refresh: Boolean(options.refresh),
  };
}

export async function importPolymarketMatchMarkets(options = {}) {
  const payload = options.payload ?? readPolymarketMatchMarketsPayloadFromFile(options.path);
  let summary;

  mutateStore((store) => {
    const result = applyPolymarketMatchMarketsToStore(store, payload);
    summary = result.summary;
    return result.store;
  });

  return {
    ...summary,
    probe: payload.probe,
    ai: payload.ai ?? null,
  };
}

function normalizeMatchIds(matchIds) {
  return Array.isArray(matchIds)
    ? [...new Set(matchIds.filter((matchId) => typeof matchId === "string" && matchId.trim()))]
    : undefined;
}

function validateKnownMatchIds(store, matchIds) {
  if (!matchIds?.length) return;
  const knownIds = new Set(store.matches.map((match) => match.id));
  const unknownIds = matchIds.filter((matchId) => !knownIds.has(matchId));
  if (unknownIds.length > 0) {
    throw apiError(404, `Unknown match id: ${unknownIds.join(", ")}.`, "not_found");
  }
}

function loadLineupPayloadFromFile(path) {
  try {
    return readLineupPayloadFromFile(path);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw apiError(404, `Lineup source file not found: ${path ?? "default"}.`, "lineup_source_not_found");
    }
    throw error;
  }
}

function upsertById(rows, row) {
  const index = rows.findIndex((item) => item.id === row.id);
  if (index === -1) rows.push(row);
  else rows[index] = { ...rows[index], ...row };
}

export function listOfficialLineupSyncCandidates(options = {}) {
  const store = getStore();
  const selection = selectMatchesForLineupSync(store.matches, options);
  return {
    ...selection,
    matches: selection.matches.map((match) => enrichMatch(store, match, false)),
  };
}

function selectMatchesForLineupSync(matches, options = {}) {
  const matchIds = options.matchIds;
  if (!Array.isArray(matchIds) || matchIds.length === 0) {
    const mode = options.mode ?? "due";
    if (!["all", "due"].includes(mode)) {
      throw apiError(400, `Unsupported official lineup sync mode: ${mode}.`, "bad_request");
    }
    const selected = matches.filter((match) => isOfficialLineupCandidate(match, options, mode));
    return {
      mode,
      now: normalizedNow(options.now).toISOString(),
      lookaheadHours: toNumber(options.lookaheadHours, 4),
      lookbackHours: toNumber(options.lookbackHours, 1),
      onlyPending: options.onlyPending !== false,
      selectedCount: selected.length,
      selectedMatchIds: selected.map((match) => match.id),
      matches: selected,
    };
  }

  const uniqueIds = [...new Set(matchIds.filter((matchId) => typeof matchId === "string" && matchId.trim()))];
  const selected = uniqueIds.map((matchId) => matches.find((match) => match.id === matchId));
  const unknownIds = uniqueIds.filter((matchId, index) => !selected[index]);
  if (unknownIds.length > 0) {
    throw apiError(404, `Unknown match id: ${unknownIds.join(", ")}.`, "not_found");
  }
  return {
    mode: "selected",
    now: normalizedNow(options.now).toISOString(),
    lookaheadHours: null,
    lookbackHours: null,
    onlyPending: false,
    selectedCount: selected.length,
    selectedMatchIds: selected.map((match) => match.id),
    matches: selected,
  };
}

function selectMatchesForMatchFactsSync(matches, options = {}) {
  const matchIds = options.matchIds;
  if (Array.isArray(matchIds) && matchIds.length > 0) {
    const uniqueIds = [...new Set(matchIds.filter((matchId) => typeof matchId === "string" && matchId.trim()))];
    const selected = uniqueIds.map((matchId) => matches.find((match) => match.id === matchId));
    const unknownIds = uniqueIds.filter((matchId, index) => !selected[index]);
    if (unknownIds.length > 0) {
      throw apiError(404, `Unknown match id: ${unknownIds.join(", ")}.`, "not_found");
    }
    return {
      mode: "selected",
      selectedCount: selected.length,
      selectedMatchIds: selected.map((match) => match.id),
      matches: selected,
    };
  }

  const mode = options.mode ?? "completed";
  if (!["completed", "all"].includes(mode)) {
    throw apiError(400, `Unsupported match facts sync mode: ${mode}.`, "bad_request");
  }

  const selected = matches.filter((match) => (
    match.official?.idMatch &&
    (mode === "all" || hasFinalScore(match))
  ));

  return {
    mode,
    selectedCount: selected.length,
    selectedMatchIds: selected.map((match) => match.id),
    matches: selected,
  };
}

function selectMatchesForApiFootballStatsSync(matches, options = {}) {
  const matchIds = options.matchIds;
  if (Array.isArray(matchIds) && matchIds.length > 0) {
    const uniqueIds = [...new Set(matchIds.filter((matchId) => typeof matchId === "string" && matchId.trim()))];
    const selected = uniqueIds.map((matchId) => matches.find((match) => match.id === matchId));
    const unknownIds = uniqueIds.filter((matchId, index) => !selected[index]);
    if (unknownIds.length > 0) {
      throw apiError(404, `Unknown match id: ${unknownIds.join(", ")}.`, "not_found");
    }
    return {
      mode: "selected",
      selectedCount: selected.length,
      selectedMatchIds: selected.map((match) => match.id),
      matches: selected,
    };
  }

  const mode = options.mode ?? "completed";
  if (!["completed", "all"].includes(mode)) {
    throw apiError(400, `Unsupported API-Football stats sync mode: ${mode}.`, "bad_request");
  }

  const selected = matches.filter((match) => (
    match.externalIds?.apiFootball &&
    (mode === "all" || hasFinalScore(match))
  ));

  return {
    mode,
    selectedCount: selected.length,
    selectedMatchIds: selected.map((match) => match.id),
    matches: selected,
  };
}

function hasFinalScore(match) {
  return match?.score?.home != null && match?.score?.away != null;
}

function getMatchKickoffTime(match) {
  return Date.parse(match?.official?.dateUtc ?? match?.kickoffLocal ?? "");
}

function findFrozenPrediction(store, matchId) {
  return store.predictions
    .filter((prediction) => prediction.matchId === matchId && prediction.audit?.freezeType === "pre_match_final")
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0] ?? null;
}

function findFreezeCandidatePrediction(store, matchId, cutoffMs) {
  return store.predictions
    .filter((prediction) => {
      if (prediction.matchId !== matchId) return false;
      const generatedMs = Date.parse(prediction.generatedAt);
      return Number.isFinite(generatedMs) && generatedMs <= cutoffMs;
    })
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0] ?? null;
}

function buildTrackRecordRow(store, match) {
  const homeTeam = store.teams.find((team) => team.id === match.homeTeamId);
  const awayTeam = store.teams.find((team) => team.id === match.awayTeamId);
  const frozenPrediction = findFrozenPrediction(store, match.id);
  const kickoffMs = getMatchKickoffTime(match);

  if (!frozenPrediction) {
    return {
      matchId: match.id,
      date: match.date,
      kickoffAt: Number.isFinite(kickoffMs) ? new Date(kickoffMs).toISOString() : null,
      status: hasFinalScore(match) ? "missing_freeze" : "not_due",
      homeTeam,
      awayTeam,
      finalScore: getFinalScore(match),
      frozenPrediction: null,
      score: null,
    };
  }

  const finalScore = getFinalScore(match);
  const score = finalScore ? scoreFrozenPrediction(frozenPrediction, finalScore) : null;

  return {
    matchId: match.id,
    date: match.date,
    kickoffAt: frozenPrediction.audit?.kickoffAt ?? (Number.isFinite(kickoffMs) ? new Date(kickoffMs).toISOString() : null),
    status: score ? "scored" : "frozen_pending",
    homeTeam,
    awayTeam,
    finalScore,
    frozenPrediction: {
      id: frozenPrediction.id,
      generatedAt: frozenPrediction.generatedAt,
      frozenAt: frozenPrediction.audit?.frozenAt ?? null,
      runId: frozenPrediction.runId,
      probabilityPercent: frozenPrediction.probabilityPercent,
      expectedGoals: frozenPrediction.expectedGoals,
      scorelines: frozenPrediction.scorelines,
      scorelineDistribution: frozenPrediction.scorelineDistribution ?? null,
      model: frozenPrediction.model,
      predictedOutcome: getPredictedOutcome(frozenPrediction),
    },
    score,
  };
}

function getFinalScore(match) {
  if (!hasFinalScore(match)) return null;
  return {
    home: Number(match.score.home),
    away: Number(match.score.away),
    line: `${match.score.home}-${match.score.away}`,
    outcome: getOutcomeKey(Number(match.score.home), Number(match.score.away)),
  };
}

function scoreFrozenPrediction(prediction, finalScore) {
  const probabilities = getOutcomeProbabilities(prediction);
  const predictedOutcome = getPredictedOutcome(prediction);
  const actualProbability = probabilities[finalScore.outcome];
  const topScoreline = prediction.scorelines?.[0]?.line ?? null;
  const distributionState = getScorelineDistributionForPrediction(prediction);
  const scorelineDistribution = distributionState.rows;
  const actualScoreline = scorelineDistribution.find((row) => row.line === finalScore.line) ?? null;
  const derivedMarkets = buildDerivedMarketChecks(scorelineDistribution, finalScore);

  return {
    actualOutcome: finalScore.outcome,
    actualOutcomeLabel: outcomeLabel(finalScore.outcome),
    predictedOutcome: predictedOutcome.key,
    predictedOutcomeLabel: predictedOutcome.label,
    predictedProbability: round(predictedOutcome.probability, 4),
    pickedCorrect: predictedOutcome.key === finalScore.outcome,
    actualProbability: round(actualProbability, 4),
    actualProbabilityPercent: round(actualProbability * 100, 1),
    topScoreline,
    topScorelineHit: topScoreline === finalScore.line,
    top3ScorelineHit: scorelineDistribution.slice(0, 3).some((row) => row.line === finalScore.line),
    top5ScorelineHit: scorelineDistribution.slice(0, 5).some((row) => row.line === finalScore.line),
    actualScorelineProbability: actualScoreline ? round(actualScoreline.probability, 4) : null,
    actualScorelineProbabilityPercent: actualScoreline ? round(actualScoreline.probability * 100, 1) : null,
    actualScorelineRank: actualScoreline?.rank ?? null,
    exactScoreLogLoss: actualScoreline ? round(-Math.log(Math.max(1e-12, actualScoreline.probability)), 4) : null,
    scorelineDistributionSource: distributionState.source,
    scorelineDistributionComplete: distributionState.complete,
    derivedMarkets,
    brier: round(brierScore(probabilities, finalScore.outcome), 4),
    rps: round(rankedProbabilityScore(probabilities, finalScore.outcome), 4),
  };
}

function getScorelineDistributionForPrediction(prediction) {
  const frozenRows = normalizeScorelineRows(prediction.scorelineDistribution);
  if (frozenRows.length > 0) {
    return {
      rows: frozenRows,
      source: "frozen_distribution",
      complete: frozenRows.length >= (SCORELINE_MAX_GOALS + 1) ** 2,
    };
  }

  const reconstructed = reconstructScorelineDistributionFromExpectedGoals(prediction.expectedGoals);
  if (reconstructed.length > 0) {
    return {
      rows: reconstructed,
      source: "reconstructed_from_frozen_expected_goals",
      complete: true,
    };
  }

  const topRows = normalizeScorelineRows(prediction.scorelines);
  return {
    rows: topRows,
    source: topRows.length > 0 ? "top_scorelines_only" : "missing",
    complete: false,
  };
}

function normalizeScorelineRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const parsed = parseScoreline(row.line);
      const probability = Number(row.probability);
      if (!parsed || !Number.isFinite(probability)) return null;
      return {
        line: row.line,
        homeGoals: Number.isFinite(Number(row.homeGoals)) ? Number(row.homeGoals) : parsed.home,
        awayGoals: Number.isFinite(Number(row.awayGoals)) ? Number(row.awayGoals) : parsed.away,
        probability,
        probabilityPercent: Number.isFinite(Number(row.probabilityPercent))
          ? Number(row.probabilityPercent)
          : round(probability * 100, 1),
        rank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.probability - a.probability)
    .map((row, index) => ({ ...row, rank: row.rank ?? index + 1 }));
}

function reconstructScorelineDistributionFromExpectedGoals(expectedGoalsValue) {
  const lambda = Number(expectedGoalsValue?.home);
  const mu = Number(expectedGoalsValue?.away);
  if (!Number.isFinite(lambda) || !Number.isFinite(mu) || lambda <= 0 || mu <= 0) return [];

  const rows = [];
  let total = 0;
  for (let homeGoals = 0; homeGoals <= SCORELINE_MAX_GOALS; homeGoals += 1) {
    const homeP = poissonPmf(homeGoals, lambda);
    for (let awayGoals = 0; awayGoals <= SCORELINE_MAX_GOALS; awayGoals += 1) {
      const probability = homeP * poissonPmf(awayGoals, mu) * dcTau(homeGoals, awayGoals, lambda, mu, DC_RHO);
      total += probability;
      rows.push({ homeGoals, awayGoals, probability });
    }
  }

  if (!Number.isFinite(total) || total <= 0) return [];
  return rows
    .map((row) => ({
      line: `${row.homeGoals}-${row.awayGoals}`,
      homeGoals: row.homeGoals,
      awayGoals: row.awayGoals,
      probability: row.probability / total,
      probabilityPercent: round((row.probability / total) * 100, 1),
    }))
    .sort((a, b) => b.probability - a.probability)
    .map((row, index) => ({
      ...row,
      probability: round(row.probability, 4),
      rank: index + 1,
    }));
}

function buildDerivedMarketChecks(scorelineDistribution, finalScore) {
  if (!Array.isArray(scorelineDistribution) || scorelineDistribution.length === 0) return [];
  const markets = [
    { key: "total_over_1_5", label: "全场 Over 1.5", predicate: (score) => totalGoals(score) > 1.5 },
    { key: "total_over_2_5", label: "全场 Over 2.5", predicate: (score) => totalGoals(score) > 2.5 },
    { key: "total_over_3_5", label: "全场 Over 3.5", predicate: (score) => totalGoals(score) > 3.5 },
    { key: "btts_yes", label: "BTTS Yes", predicate: (score) => score.homeGoals > 0 && score.awayGoals > 0 },
    { key: "home_over_0_5", label: "主队 Over 0.5", predicate: (score) => score.homeGoals > 0.5 },
    { key: "home_over_1_5", label: "主队 Over 1.5", predicate: (score) => score.homeGoals > 1.5 },
    { key: "away_over_0_5", label: "客队 Over 0.5", predicate: (score) => score.awayGoals > 0.5 },
    { key: "away_over_1_5", label: "客队 Over 1.5", predicate: (score) => score.awayGoals > 1.5 },
    { key: "home_minus_1_5", label: "主队 -1.5", predicate: (score) => score.homeGoals - score.awayGoals > 1.5 },
    { key: "away_plus_1_5", label: "客队 +1.5", predicate: (score) => score.awayGoals + 1.5 > score.homeGoals },
    { key: "away_minus_1_5", label: "客队 -1.5", predicate: (score) => score.awayGoals - score.homeGoals > 1.5 },
    { key: "home_plus_1_5", label: "主队 +1.5", predicate: (score) => score.homeGoals + 1.5 > score.awayGoals },
  ];

  return markets.map((market) => {
    const probability = scorelineDistribution
      .filter(market.predicate)
      .reduce((sum, row) => sum + row.probability, 0);
    const pickedYes = probability >= 0.5;
    const actualYes = market.predicate({
      homeGoals: finalScore.home,
      awayGoals: finalScore.away,
    });
    return {
      key: market.key,
      label: market.label,
      probability: round(probability, 4),
      probabilityPercent: round(probability * 100, 1),
      pickedYes,
      actualYes,
      hit: pickedYes === actualYes,
    };
  });
}

function totalGoals(score) {
  return score.homeGoals + score.awayGoals;
}

function getOutcomeProbabilities(prediction) {
  return {
    homeWin: Number(prediction.probabilities?.homeWin ?? 0),
    draw: Number(prediction.probabilities?.draw ?? 0),
    awayWin: Number(prediction.probabilities?.awayWin ?? 0),
  };
}

function getPredictedOutcome(prediction) {
  const probabilities = getOutcomeProbabilities(prediction);
  const [key, probability] = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0];
  return {
    key,
    label: outcomeLabel(key),
    probability,
    probabilityPercent: round(probability * 100, 1),
  };
}

function getOutcomeKey(homeScore, awayScore) {
  if (homeScore > awayScore) return "homeWin";
  if (homeScore < awayScore) return "awayWin";
  return "draw";
}

function outcomeLabel(key) {
  if (key === "homeWin") return "主胜";
  if (key === "awayWin") return "客胜";
  return "平局";
}

function brierScore(probabilities, actualKey) {
  return ["homeWin", "draw", "awayWin"].reduce((sum, key) => {
    const actual = key === actualKey ? 1 : 0;
    return sum + (probabilities[key] - actual) ** 2;
  }, 0);
}

function rankedProbabilityScore(probabilities, actualKey) {
  const order = ["homeWin", "draw", "awayWin"];
  const actual = Object.fromEntries(order.map((key) => [key, key === actualKey ? 1 : 0]));
  let forecastCumulative = 0;
  let actualCumulative = 0;
  let total = 0;

  for (let index = 0; index < order.length - 1; index += 1) {
    const key = order[index];
    forecastCumulative += probabilities[key];
    actualCumulative += actual[key];
    total += (forecastCumulative - actualCumulative) ** 2;
  }

  return total / (order.length - 1);
}

function summarizeDerivedMarkets(scoredRows) {
  const byMarket = new Map();
  for (const row of scoredRows) {
    for (const market of row.score?.derivedMarkets ?? []) {
      if (!byMarket.has(market.key)) {
        byMarket.set(market.key, {
          key: market.key,
          label: market.label,
          count: 0,
          hitCount: 0,
          averageProbability: 0,
        });
      }
      const summary = byMarket.get(market.key);
      summary.count += 1;
      if (market.hit) summary.hitCount += 1;
      summary.averageProbability += market.probability;
    }
  }

  return [...byMarket.values()]
    .map((summary) => ({
      ...summary,
      accuracy: summary.count ? round(summary.hitCount / summary.count, 4) : null,
      averageProbability: summary.count ? round(summary.averageProbability / summary.count, 4) : null,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function parseScoreline(line) {
  const match = String(line ?? "").trim().match(/^(\d+)-(\d+)$/);
  if (!match) return null;
  return {
    home: Number(match[1]),
    away: Number(match[2]),
  };
}

function dcTau(homeGoals, awayGoals, lambda, mu, rho) {
  if (homeGoals === 0 && awayGoals === 0) return 1 - lambda * mu * rho;
  if (homeGoals === 0 && awayGoals === 1) return 1 + lambda * rho;
  if (homeGoals === 1 && awayGoals === 0) return 1 + mu * rho;
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}

function average(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return null;
  return round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length, 4);
}

function round(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number(number.toFixed(digits));
}

function isOfficialLineupCandidate(match, options, mode) {
  if (!match.official?.idMatch) return false;
  if (options.onlyPending !== false && getLineupIntelForMatch(match).official.status === "available") return false;
  if (mode !== "due") return true;
  return isMatchInsideLineupWindow(match, options);
}

function isMatchInsideLineupWindow(match, options) {
  const kickoff = Date.parse(match.official?.dateUtc ?? match.kickoffLocal ?? "");
  if (!Number.isFinite(kickoff)) return false;
  const now = normalizedNow(options.now).getTime();
  const lookaheadMs = toNumber(options.lookaheadHours, 4) * 60 * 60 * 1000;
  const lookbackMs = toNumber(options.lookbackHours, 1) * 60 * 60 * 1000;
  return kickoff >= now - lookbackMs && kickoff <= now + lookaheadMs;
}

function normalizedNow(value) {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    throw apiError(400, `Invalid now value: ${value}.`, "bad_request");
  }
  return parsed;
}

function toNumber(value, fallback) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function buildPredictionSnapshot(match, runId, now) {
  if (!isPredictableMatch(match)) {
    throw apiError(400, `Match ${match.id} is not covered by the prediction model.`);
  }

  const prediction = predictMatch({
    home: match.modelHome,
    away: match.modelAway,
    venue: match.modelVenue,
  });

  return {
    id: `pred_${match.id}_${compactTimestamp(now)}_${shortId()}`,
    matchId: match.id,
    runId,
    source: "world-cup-2026-prediction-model",
    generatedAt: now,
    input: prediction.input,
    teams: prediction.teams,
    probabilities: prediction.probabilities,
    probabilityPercent: prediction.probabilityPercent,
    expectedGoals: prediction.expectedGoals,
    scorelines: prediction.scorelines,
    scorelineDistribution: prediction.scorelineDistribution,
    recommendation: prediction.recommendation,
    confidence: prediction.confidence,
    model: prediction.model,
  };
}

function enrichMatch(store, match, includePrediction) {
  const homeTeam = store.teams.find((team) => team.id === match.homeTeamId);
  const awayTeam = store.teams.find((team) => team.id === match.awayTeamId);
  return {
    ...match,
    homeTeam,
    awayTeam,
    recentForm: getRecentFormsForMatch(match, store),
    lineupIntel: getLineupIntelForMatch(match),
    latestPrediction: includePrediction ? findLatestPrediction(store, match.id) : undefined,
  };
}

function findLatestPrediction(store, matchId) {
  return store.predictions
    .filter((prediction) => prediction.matchId === matchId)
    .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0] ?? null;
}

function filterMatch(match, query) {
  if (query.date && match.date !== query.date) return false;
  if (query.from && match.date < query.from) return false;
  if (query.to && match.date > query.to) return false;
  if (query.status && match.status !== query.status) return false;
  return true;
}

function sortMatches(a, b) {
  const dateSort = a.date.localeCompare(b.date);
  if (dateSort !== 0) return dateSort;
  return a.kickoffSort.localeCompare(b.kickoffSort);
}

function compactTimestamp(value) {
  return value.replace(/[-:.TZ]/g, "");
}

function shortId() {
  return randomUUID().slice(0, 8);
}

function isPredictableMatch(match) {
  return match.predictionStatus?.available !== false && Boolean(match.modelHome && match.modelAway);
}

function getRefreshPredictionMatchIds(options = {}) {
  const store = getStore();
  const selectedIds = normalizeMatchIds(options.matchIds);
  validateKnownMatchIds(store, selectedIds);
  const mode = options.predictionMode ?? (options.all ? "all" : "pending");
  if (!["pending", "all"].includes(mode)) {
    throw apiError(400, `Unsupported predictionMode: ${mode}.`, "bad_request");
  }

  return store.matches
    .filter((match) => !selectedIds?.length || selectedIds.includes(match.id))
    .filter(isPredictableMatch)
    .filter((match) => mode === "all" || !hasFinalScore(match))
    .sort(sortMatches)
    .map((match) => match.id);
}

function apiError(status, message, code = "bad_request") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}
