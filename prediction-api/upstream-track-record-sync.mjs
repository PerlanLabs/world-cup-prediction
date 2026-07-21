import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DC_RHO, expectedGoals, matchProb, poissonPmf } from "../world-cup-2026-prediction-model/elo.mjs";

export const UPSTREAM_TRACK_RECORD_SOURCE_ID = "upstream-github-track-record";

const RAW_BASE = "https://raw.githubusercontent.com/Hicruben/world-cup-2026-prediction-model/main";
const DEFAULT_RESULTS_URL = `${RAW_BASE}/data/wc2026-results.json`;
const DEFAULT_RATINGS_URL = `${RAW_BASE}/data/elo-calibrated.json`;
const DEFAULT_LOCAL_REPO_PATH = fileURLToPath(new URL("../world-cup-2026-prediction-model", import.meta.url));
const UPSTREAM_REPO_URL = "https://github.com/Hicruben/world-cup-2026-prediction-model";
const HOST_TEAMS = new Set(["mexico", "usa", "canada"]);
const HOME_BONUS = 75;

export async function fetchUpstreamTrackRecordPayload(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const fetchedAt = options.fetchedAt ?? new Date().toISOString();
  const resultsUrl = options.resultsUrl ?? DEFAULT_RESULTS_URL;
  const ratingsUrl = options.ratingsUrl ?? DEFAULT_RATINGS_URL;
  let results;
  let ratings;
  let retrieval = {
    method: "raw_github",
    resultsUrl,
    ratingsUrl,
  };

  try {
    [results, ratings] = await Promise.all([
      fetchJson(fetchImpl, resultsUrl, "upstream World Cup results"),
      fetchJson(fetchImpl, ratingsUrl, "upstream frozen Elo ratings"),
    ]);
  } catch (error) {
    if (options.disableLocalFallback) throw error;
    const local = readLocalUpstreamTrackRecordFiles({
      localRepoPath: options.localRepoPath,
      rawFetchError: error,
    });
    results = local.results;
    ratings = local.ratings;
    retrieval = local.retrieval;
  }

  const matches = Array.isArray(results.matches) ? results.matches : [];
  const ratingsMap = ratings.ratings && typeof ratings.ratings === "object" ? ratings.ratings : {};

  return {
    source: {
      id: UPSTREAM_TRACK_RECORD_SOURCE_ID,
      name: "Upstream GitHub frozen 2026 World Cup track record",
      url: UPSTREAM_REPO_URL,
      resultsUrl,
      ratingsUrl,
      retrievedAt: fetchedAt,
      tier: 2,
      access: retrieval.method === "raw_github" ? "public_github" : "local_upstream_clone",
      notes: "Backfills missing pre-match frozen snapshots from the upstream repository's frozen tournament ratings and finished-match result list.",
      retrieval,
      compliance: {
        readOnly: true,
        tradingEnabled: false,
        modelInput: false,
      },
    },
    fetchedAt,
    upstreamUpdatedAt: results.updated ?? null,
    resultsHash: hashJson(results),
    ratingsHash: hashJson(ratings),
    ratings: {
      matchesApplied: ratings.matchesApplied ?? null,
      generatedAt: ratings.generatedAt ?? null,
      ratings: ratingsMap,
    },
    matches,
    probe: {
      rawMatchCount: matches.length,
      ratingTeamCount: Object.keys(ratingsMap).length,
      retrievalMethod: retrieval.method,
    },
  };
}

function readLocalUpstreamTrackRecordFiles({ localRepoPath, rawFetchError } = {}) {
  const repoPath = localRepoPath ?? DEFAULT_LOCAL_REPO_PATH;
  const results = readLocalUpstreamJson(repoPath, "data/wc2026-results.json");
  const ratings = readLocalUpstreamJson(repoPath, "data/elo-calibrated.json");

  return {
    results,
    ratings,
    retrieval: {
      method: "local_upstream_clone",
      repoPath,
      ref: "origin/main",
      fallbackReason: rawFetchError?.message ?? null,
    },
  };
}

function readLocalUpstreamJson(repoPath, relativePath) {
  const gitResult = spawnSync("git", ["-C", repoPath, "show", `origin/main:${relativePath}`], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (gitResult.status === 0 && gitResult.stdout) {
    return parseJsonText(gitResult.stdout, `${repoPath} origin/main:${relativePath}`);
  }

  const text = readFileSync(join(repoPath, relativePath), "utf8");
  return parseJsonText(text, join(repoPath, relativePath));
}

export function applyUpstreamTrackRecordToStore(store, payload, options = {}) {
  const imported = [];
  const skipped = [];
  const runGeneratedAt = options.generatedAt ?? payload.fetchedAt ?? new Date().toISOString();
  const runId = `run_upstream_track_record_${compactTimestamp(runGeneratedAt)}_${shortId()}`;
  const upstreamResults = indexUpstreamResults(payload.matches ?? []);
  const ratings = payload.ratings?.ratings ?? {};
  const predictionIds = [];

  for (const match of store.matches) {
    if (!hasFinalScore(match)) continue;
    if (!isPredictableMatch(match)) {
      skipped.push({ matchId: match.id, reason: "not_predictable" });
      continue;
    }

    const existingFrozen = findFrozenPrediction(store, match.id);
    if (existingFrozen && existingFrozen.audit?.backfillSource !== UPSTREAM_TRACK_RECORD_SOURCE_ID) {
      skipped.push({ matchId: match.id, reason: "already_frozen_live_snapshot", predictionId: existingFrozen.id });
      continue;
    }
    if (existingFrozen && !options.force) {
      skipped.push({ matchId: match.id, reason: "already_frozen", predictionId: existingFrozen.id });
      continue;
    }

    const upstreamResult = findUpstreamResultForMatch(upstreamResults, match);
    if (!upstreamResult) {
      skipped.push({ matchId: match.id, reason: "no_upstream_result" });
      continue;
    }

    const localScore = orientResultForMatch(upstreamResult, match);
    if (!localScore) {
      skipped.push({ matchId: match.id, reason: "upstream_order_mismatch" });
      continue;
    }
    if (Number(match.score.home) !== localScore.home || Number(match.score.away) !== localScore.away) {
      skipped.push({
        matchId: match.id,
        reason: "score_mismatch",
        localScore: `${match.score.home}-${match.score.away}`,
        upstreamScore: `${localScore.home}-${localScore.away}`,
      });
      continue;
    }

    const homeRating = Number(ratings[match.modelHome]);
    const awayRating = Number(ratings[match.modelAway]);
    if (!Number.isFinite(homeRating) || !Number.isFinite(awayRating)) {
      skipped.push({ matchId: match.id, reason: "missing_rating" });
      continue;
    }

    if (existingFrozen && options.force) {
      store.predictions = store.predictions.filter((prediction) => (
        prediction.id !== existingFrozen.id
      ));
    }

    const prediction = buildUpstreamFrozenPrediction({
      match,
      runId,
      ratings,
      homeRating,
      awayRating,
      payload,
      upstreamResult,
    });
    store.predictions.push(prediction);
    predictionIds.push(prediction.id);
    imported.push({
      matchId: match.id,
      predictionId: prediction.id,
      upstreamDate: upstreamResult.date,
      upstreamTeams: [upstreamResult.t1, upstreamResult.t2],
      score: `${localScore.home}-${localScore.away}`,
    });
  }

  upsertById(store.sources, buildSource(payload, imported, skipped));

  if (predictionIds.length > 0) {
    store.modelRuns.push({
      id: runId,
      generatedAt: runGeneratedAt,
      source: UPSTREAM_TRACK_RECORD_SOURCE_ID,
      reason: "backfill_missing_pre_match_frozen_predictions",
      matchIds: imported.map((item) => item.matchId),
      predictionIds,
      metadata: {
        upstreamRepo: UPSTREAM_REPO_URL,
        upstreamUpdatedAt: payload.upstreamUpdatedAt ?? null,
        ratingsGeneratedAt: payload.ratings?.generatedAt ?? null,
        ratingsHash: payload.ratingsHash ?? null,
        resultsHash: payload.resultsHash ?? null,
      },
    });
  }

  return {
    sourceId: UPSTREAM_TRACK_RECORD_SOURCE_ID,
    generatedAt: runGeneratedAt,
    upstreamUpdatedAt: payload.upstreamUpdatedAt ?? null,
    rawMatchCount: payload.matches?.length ?? 0,
    importedCount: imported.length,
    imported,
    skippedCount: skipped.length,
    skipped,
    runId: predictionIds.length > 0 ? runId : null,
    predictionIds,
  };
}

function buildUpstreamFrozenPrediction({
  match,
  runId,
  homeRating,
  awayRating,
  payload,
  upstreamResult,
}) {
  const homeBonus = getHomeBonus(match);
  const probabilities = matchProb(homeRating, awayRating, homeBonus);
  const generatedAt = buildPreKickoffGeneratedAt(match);
  const scorelineDistribution = getScorelineDistribution(homeRating, awayRating, homeBonus);
  const topScorelines = scorelineDistribution.slice(0, 5);
  const favourite = getFavourite(probabilities);
  const confidence = getConfidence(probabilities);

  return {
    id: `pred_${match.id}_upstream_freeze_${shortHash([
      match.id,
      payload.upstreamUpdatedAt ?? "",
      payload.ratingsHash ?? "",
      payload.resultsHash ?? "",
    ].join(":"))}`,
    matchId: match.id,
    runId,
    source: UPSTREAM_TRACK_RECORD_SOURCE_ID,
    generatedAt,
    input: {
      home: match.modelHome,
      away: match.modelAway,
      venue: match.modelVenue ?? "neutral",
    },
    teams: {
      home: { slug: match.modelHome, elo: homeRating },
      away: { slug: match.modelAway, elo: awayRating },
    },
    probabilities: {
      homeWin: round(probabilities.winA, 4),
      draw: round(probabilities.draw, 4),
      awayWin: round(probabilities.winB, 4),
    },
    probabilityPercent: {
      homeWin: round(probabilities.winA * 100, 1),
      draw: round(probabilities.draw * 100, 1),
      awayWin: round(probabilities.winB * 100, 1),
    },
    expectedGoals: {
      home: round(probabilities.expectedGoalsA, 2),
      away: round(probabilities.expectedGoalsB, 2),
    },
    scorelines: topScorelines,
    scorelineDistribution,
    recommendation: {
      key: favourite.key,
      label: favourite.label,
    },
    confidence,
    model: {
      engine: "Elo + Dixon-Coles bivariate Poisson",
      upstreamRepo: UPSTREAM_REPO_URL,
      ratingSource: {
        type: "upstream_github_frozen_tournament_ratings",
        sourceId: UPSTREAM_TRACK_RECORD_SOURCE_ID,
        ratingsUrl: payload.source?.ratingsUrl ?? DEFAULT_RATINGS_URL,
        resultsUrl: payload.source?.resultsUrl ?? DEFAULT_RESULTS_URL,
        ratingsGeneratedAt: payload.ratings?.generatedAt ?? null,
        matchesApplied: payload.ratings?.matchesApplied ?? null,
        upstreamUpdatedAt: payload.upstreamUpdatedAt ?? null,
        ratingsHash: payload.ratingsHash ?? null,
        resultsHash: payload.resultsHash ?? null,
      },
    },
    audit: {
      freezeType: "pre_match_final",
      frozenAt: generatedAt,
      kickoffAt: buildKickoffIso(match),
      policy: "backfilled_from_upstream_frozen_tournament_ratings",
      backfilled: true,
      backfillSource: UPSTREAM_TRACK_RECORD_SOURCE_ID,
      retrievedAt: payload.fetchedAt,
      upstreamUpdatedAt: payload.upstreamUpdatedAt ?? null,
      upstreamResult: {
        date: upstreamResult.date,
        team1: upstreamResult.team1,
        team2: upstreamResult.team2,
        t1: upstreamResult.t1,
        t2: upstreamResult.t2,
        score: `${upstreamResult.g1}-${upstreamResult.g2}`,
        status: upstreamResult.status,
      },
    },
  };
}

function buildSource(payload, imported, skipped) {
  return {
    ...(payload.source ?? {}),
    id: UPSTREAM_TRACK_RECORD_SOURCE_ID,
    name: payload.source?.name ?? "Upstream GitHub frozen 2026 World Cup track record",
    url: payload.source?.url ?? UPSTREAM_REPO_URL,
    retrievedAt: payload.fetchedAt ?? new Date().toISOString(),
    tier: payload.source?.tier ?? 2,
    lastSync: {
      fetchedAt: payload.fetchedAt ?? null,
      upstreamUpdatedAt: payload.upstreamUpdatedAt ?? null,
      rawMatchCount: payload.matches?.length ?? 0,
      importedCount: imported.length,
      skippedCount: skipped.length,
      ratingsHash: payload.ratingsHash ?? null,
      resultsHash: payload.resultsHash ?? null,
    },
  };
}

function indexUpstreamResults(matches) {
  const index = new Map();
  for (const match of matches) {
    if (!match?.t1 || !match?.t2) continue;
    const key = pairKey(match.t1, match.t2);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(match);
  }
  return index;
}

function findUpstreamResultForMatch(index, match) {
  const candidates = index.get(pairKey(match.modelHome, match.modelAway)) ?? [];
  if (candidates.length === 0) return null;
  return candidates.find((candidate) => candidate.date === match.date) ?? candidates[0] ?? null;
}

function orientResultForMatch(result, match) {
  if (result.t1 === match.modelHome && result.t2 === match.modelAway) {
    return { home: Number(result.g1), away: Number(result.g2) };
  }
  if (result.t1 === match.modelAway && result.t2 === match.modelHome) {
    return { home: Number(result.g2), away: Number(result.g1) };
  }
  return null;
}

function isPredictableMatch(match) {
  return match?.predictionStatus?.available !== false && Boolean(match?.modelHome && match?.modelAway);
}

function hasFinalScore(match) {
  return match?.score?.home != null && match?.score?.away != null;
}

function findFrozenPrediction(store, matchId) {
  return store.predictions
    .find((prediction) => prediction.matchId === matchId && prediction.audit?.freezeType === "pre_match_final") ?? null;
}

function getHomeBonus(match) {
  const home = match.modelHome;
  const away = match.modelAway;
  return (HOST_TEAMS.has(home) ? HOME_BONUS : 0) - (HOST_TEAMS.has(away) ? HOME_BONUS : 0);
}

function buildKickoffIso(match) {
  const parsed = Date.parse(match?.official?.dateUtc ?? match?.kickoffLocal ?? "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function buildPreKickoffGeneratedAt(match) {
  const kickoffMs = Date.parse(match?.official?.dateUtc ?? match?.kickoffLocal ?? "");
  if (!Number.isFinite(kickoffMs)) return "2026-06-11T00:00:00.000Z";
  return new Date(kickoffMs - 60 * 60 * 1000).toISOString();
}

function getScorelineDistribution(homeRating, awayRating, homeBonus) {
  const lambda = expectedGoals(homeRating, awayRating, homeBonus);
  const mu = expectedGoals(awayRating, homeRating, -homeBonus / 2);
  const rows = [];
  let total = 0;

  for (let homeGoals = 0; homeGoals <= 8; homeGoals += 1) {
    const homeP = poissonPmf(homeGoals, lambda);
    for (let awayGoals = 0; awayGoals <= 8; awayGoals += 1) {
      const probability = homeP * poissonPmf(awayGoals, mu) * dcTau(homeGoals, awayGoals, lambda, mu, DC_RHO);
      total += probability;
      rows.push({ homeGoals, awayGoals, probability });
    }
  }

  return rows
    .map((row) => ({
      line: `${row.homeGoals}-${row.awayGoals}`,
      homeGoals: row.homeGoals,
      awayGoals: row.awayGoals,
      probability: round(row.probability / total, 4),
      probabilityPercent: round((row.probability / total) * 100, 1),
    }))
    .sort((a, b) => b.probability - a.probability)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function dcTau(homeGoals, awayGoals, lambda, mu, rho) {
  if (homeGoals === 0 && awayGoals === 0) return 1 - lambda * mu * rho;
  if (homeGoals === 0 && awayGoals === 1) return 1 + lambda * rho;
  if (homeGoals === 1 && awayGoals === 0) return 1 + mu * rho;
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}

function getFavourite(probabilities) {
  const rows = [
    { key: "homeWin", label: "主胜", value: probabilities.winA },
    { key: "draw", label: "平局", value: probabilities.draw },
    { key: "awayWin", label: "客胜", value: probabilities.winB },
  ];
  return rows.sort((a, b) => b.value - a.value)[0];
}

function getConfidence(probabilities) {
  const sorted = [probabilities.winA, probabilities.draw, probabilities.winB].sort((a, b) => b - a);
  const separation = sorted[0] - sorted[1];
  return {
    score: Math.round(Math.max(52, Math.min(82, 52 + separation * 70))),
    basis: "upstream-frozen-probability-separation",
    description: "Backfilled from upstream frozen tournament ratings; used only for model track-record review.",
  };
}

function upsertById(items, item) {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) {
    items[index] = { ...items[index], ...item };
    return;
  }
  items.push(item);
}

async function fetchJson(fetchImpl, url, label) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    const error = new Error(`Failed to fetch ${label}: HTTP ${response.status}`);
    error.status = response.status;
    error.code = "upstream_fetch_failed";
    throw error;
  }
  return response.json();
}

function parseJsonText(text, label) {
  try {
    return JSON.parse(String(text).replace(/^\uFEFF/, ""));
  } catch (error) {
    const parseError = new Error(`Failed to parse ${label}: ${error.message}`);
    parseError.code = "upstream_json_parse_failed";
    parseError.cause = error;
    throw parseError;
  }
}

function pairKey(a, b) {
  return [a, b].sort().join("__");
}

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function shortHash(value) {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function compactTimestamp(value) {
  return String(value).replace(/[-:.TZ]/g, "");
}

function shortId() {
  return randomUUID().slice(0, 8);
}

function round(value, digits) {
  return Number(value.toFixed(digits));
}
