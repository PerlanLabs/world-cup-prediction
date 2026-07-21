import { readFileSync } from "node:fs";

const HISTORICAL_RESULTS_URL = new URL("../world-cup-2026-prediction-model/data/results.json", import.meta.url);
const DEFAULT_LIMIT = 5;

let cachedHistoricalEvents = null;

export function getRecentFormsForMatch(match, store, options = {}) {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const cutoffMs = getMatchCutoffMs(match);
  const home = summarizeRecentForm(match.modelHome, store, {
    cutoffMs,
    currentMatchId: match.id,
    limit,
  });
  const away = summarizeRecentForm(match.modelAway, store, {
    cutoffMs,
    currentMatchId: match.id,
    limit,
  });

  return {
    home,
    away,
    matchup: summarizeMatchupMetrics(home, away),
  };
}

export function summarizeRecentForm(teamSlug, store, options = {}) {
  if (!teamSlug) {
    return emptyForm(teamSlug, options.limit ?? DEFAULT_LIMIT);
  }

  const limit = options.limit ?? DEFAULT_LIMIT;
  const cutoffMs = Number.isFinite(options.cutoffMs) ? options.cutoffMs : Number.POSITIVE_INFINITY;
  const events = [
    ...getHistoricalEventsForTeam(teamSlug, cutoffMs),
    ...getStoreEventsForTeam(teamSlug, store, cutoffMs, options.currentMatchId),
  ]
    .sort((a, b) => b.kickoffMs - a.kickoffMs)
    .slice(0, limit);

  if (events.length === 0) {
    return emptyForm(teamSlug, limit);
  }

  const wins = events.filter((event) => event.result === "W").length;
  const draws = events.filter((event) => event.result === "D").length;
  const losses = events.filter((event) => event.result === "L").length;
  const goalsFor = sum(events, "goalsFor");
  const goalsAgainst = sum(events, "goalsAgainst");
  const points = wins * 3 + draws;
  const scoringMatches = events.filter((event) => event.goalsFor > 0).length;
  const cleanSheets = events.filter((event) => event.goalsAgainst === 0).length;
  const metrics = calculateRecentFormMetrics({
    matches: events.length,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    scoringMatches,
    cleanSheets,
  });

  return {
    teamSlug,
    window: limit,
    matches: events.length,
    wins,
    draws,
    losses,
    points,
    goalsFor,
    goalsAgainst,
    goalDifference: goalsFor - goalsAgainst,
    goalsForPerMatch: round(goalsFor / events.length, 2),
    goalsAgainstPerMatch: round(goalsAgainst / events.length, 2),
    pointsPerMatch: round(points / events.length, 2),
    scoringMatches,
    cleanSheets,
    metrics,
    label: `近${events.length}场 ${wins}胜${draws}平${losses}负`,
    goalsForLabel: String(goalsFor),
    goalsAgainstLabel: String(goalsAgainst),
    asOf: Number.isFinite(cutoffMs) ? new Date(cutoffMs).toISOString() : null,
    sources: [...new Set(events.map((event) => event.source))],
    sample: events,
  };
}

export function calculateRecentFormMetrics(form) {
  if (!form?.matches) {
    return {
      attack: 0,
      defense: 0,
      stability: 0,
    };
  }

  const matches = form.matches;
  const goalsForPerMatch = form.goalsFor / matches;
  const goalsAgainstPerMatch = form.goalsAgainst / matches;
  const scoringRate = form.scoringMatches / matches;
  const cleanSheetRate = form.cleanSheets / matches;
  const pointsPerMatch = (form.wins * 3 + form.draws) / matches;
  const unbeatenRate = (form.wins + form.draws) / matches;
  const goalDifferencePerMatch = (form.goalsFor - form.goalsAgainst) / matches;

  return {
    attack: clampMetric(35 + (Math.min(goalsForPerMatch, 3) / 3) * 45 + scoringRate * 20),
    defense: clampMetric(35 + (1 - Math.min(goalsAgainstPerMatch, 3) / 3) * 45 + cleanSheetRate * 20),
    stability: clampMetric(
      35 +
      (pointsPerMatch / 3) * 35 +
      unbeatenRate * 20 +
      clamp(goalDifferencePerMatch * 5, -10, 10),
    ),
  };
}

function summarizeMatchupMetrics(home, away) {
  if (!hasMetrics(home) || !hasMetrics(away)) {
    return {
      basis: "recent_form",
      metrics: {
        attack: 0,
        defense: 0,
        stability: 0,
      },
      sources: [],
    };
  }

  return {
    basis: "recent_form",
    metrics: {
      attack: averageMetric(home.metrics.attack, away.metrics.attack),
      defense: averageMetric(home.metrics.defense, away.metrics.defense),
      stability: averageMetric(home.metrics.stability, away.metrics.stability),
    },
    sources: [...new Set([...(home.sources ?? []), ...(away.sources ?? [])])],
  };
}

function getHistoricalEventsForTeam(teamSlug, cutoffMs) {
  return getHistoricalEvents()
    .filter((event) => event.teamSlug === teamSlug && event.kickoffMs < cutoffMs);
}

function getHistoricalEvents() {
  if (cachedHistoricalEvents) return cachedHistoricalEvents;

  const payload = JSON.parse(readFileSync(HISTORICAL_RESULTS_URL, "utf8"));
  cachedHistoricalEvents = payload.matches.flatMap((match) => {
    if (match.hg == null || match.ag == null || !Number.isFinite(match.ts)) return [];

    const kickoffMs = match.ts * 1000;
    const events = [];
    if (match.homeSlug) {
      events.push(buildEvent({
        id: `historical:${match.id}:home`,
        source: "historical_results",
        date: match.date,
        kickoffMs,
        teamSlug: match.homeSlug,
        opponentSlug: match.awaySlug,
        opponentName: match.awayName,
        goalsFor: match.hg,
        goalsAgainst: match.ag,
        venue: "home",
        competition: match.leagueName,
      }));
    }
    if (match.awaySlug) {
      events.push(buildEvent({
        id: `historical:${match.id}:away`,
        source: "historical_results",
        date: match.date,
        kickoffMs,
        teamSlug: match.awaySlug,
        opponentSlug: match.homeSlug,
        opponentName: match.homeName,
        goalsFor: match.ag,
        goalsAgainst: match.hg,
        venue: "away",
        competition: match.leagueName,
      }));
    }
    return events;
  });

  return cachedHistoricalEvents;
}

function getStoreEventsForTeam(teamSlug, store, cutoffMs, currentMatchId) {
  if (!Array.isArray(store?.matches)) return [];

  return store.matches.flatMap((match) => {
    if (match.id === currentMatchId) return [];
    if (match.score?.home == null || match.score?.away == null) return [];
    if (!match.modelHome || !match.modelAway) return [];

    const kickoffMs = getMatchCutoffMs(match);
    if (!Number.isFinite(kickoffMs) || kickoffMs >= cutoffMs) return [];

    if (match.modelHome === teamSlug) {
      return [buildEvent({
        id: `store:${match.id}:home`,
        source: "fifa_synced_results",
        date: match.date,
        kickoffMs,
        teamSlug: match.modelHome,
        opponentSlug: match.modelAway,
        opponentName: match.awayTeamId,
        goalsFor: match.score.home,
        goalsAgainst: match.score.away,
        venue: resolveVenue(match, "home"),
        competition: match.competition,
      })];
    }

    if (match.modelAway === teamSlug) {
      return [buildEvent({
        id: `store:${match.id}:away`,
        source: "fifa_synced_results",
        date: match.date,
        kickoffMs,
        teamSlug: match.modelAway,
        opponentSlug: match.modelHome,
        opponentName: match.homeTeamId,
        goalsFor: match.score.away,
        goalsAgainst: match.score.home,
        venue: resolveVenue(match, "away"),
        competition: match.competition,
      })];
    }

    return [];
  });
}

function buildEvent(event) {
  const result = event.goalsFor > event.goalsAgainst
    ? "W"
    : event.goalsFor < event.goalsAgainst
      ? "L"
      : "D";

  return {
    id: event.id,
    source: event.source,
    date: event.date,
    kickoffMs: event.kickoffMs,
    teamSlug: event.teamSlug,
    opponentSlug: event.opponentSlug ?? null,
    opponentName: event.opponentName ?? null,
    goalsFor: event.goalsFor,
    goalsAgainst: event.goalsAgainst,
    result,
    venue: event.venue,
    competition: event.competition ?? null,
  };
}

function getMatchCutoffMs(match) {
  const fromUtc = Date.parse(match?.official?.dateUtc ?? "");
  if (Number.isFinite(fromUtc)) return fromUtc;

  const fromLocal = Date.parse(match?.kickoffLocal ?? "");
  if (Number.isFinite(fromLocal)) return fromLocal;

  const fallback = Date.parse(`${match?.date ?? ""}T${match?.kickoffSort ?? "00:00"}:00+08:00`);
  return Number.isFinite(fallback) ? fallback : Number.POSITIVE_INFINITY;
}

function resolveVenue(match, side) {
  if (side === "home") return match.modelVenue === "home" ? "home" : "neutral";
  return match.modelVenue === "away" ? "home" : "neutral";
}

function emptyForm(teamSlug, limit) {
  return {
    teamSlug,
    window: limit,
    matches: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    points: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    goalsForPerMatch: 0,
    goalsAgainstPerMatch: 0,
    pointsPerMatch: 0,
    scoringMatches: 0,
    cleanSheets: 0,
    metrics: {
      attack: 0,
      defense: 0,
      stability: 0,
    },
    label: "赛前信息更新中",
    goalsForLabel: "-",
    goalsAgainstLabel: "-",
    asOf: null,
    sources: [],
    sample: [],
  };
}

function sum(items, key) {
  return items.reduce((total, item) => total + item[key], 0);
}

function hasMetrics(form) {
  return form?.matches > 0 && Number.isFinite(form.metrics?.attack);
}

function averageMetric(a, b) {
  return clampMetric((a + b) / 2);
}

function clampMetric(value) {
  return Math.round(clamp(value, 0, 100));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits) {
  return Number(value.toFixed(digits));
}
