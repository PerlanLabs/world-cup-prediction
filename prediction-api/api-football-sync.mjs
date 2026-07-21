import { getFifaCodeForTeamId } from "./fifa-sync.mjs";

const API_FOOTBALL_BASE_URL = "https://v3.football.api-sports.io";
const API_FOOTBALL_FIXTURE_SOURCE_ID = "api-football-world-cup-fixtures";
const API_FOOTBALL_STATS_SOURCE_ID = "api-football-fixture-statistics";
const DEFAULT_LEAGUE_ID = "1";
const DEFAULT_SEASON = "2026";

const STAT_MAP = new Map([
  ["ballpossession", { key: "possession", percent: true }],
  ["totalshots", { key: "totalShots" }],
  ["shotsongoal", { key: "shotsOnTarget" }],
  ["shotsoffgoal", { key: "shotsOffTarget" }],
  ["blockedshots", { key: "blockedShots" }],
  ["shotsinsidebox", { key: "shotsInsideBox" }],
  ["shotsoutsidebox", { key: "shotsOutsideBox" }],
  ["cornerkicks", { key: "corners" }],
  ["offsides", { key: "offsides" }],
  ["fouls", { key: "fouls" }],
  ["yellowcards", { key: "yellowCards" }],
  ["redcards", { key: "redCards" }],
  ["goalkeepersaves", { key: "goalkeeperSaves" }],
  ["totalpasses", { key: "passes" }],
  ["passesaccurate", { key: "accuratePasses" }],
  ["passes", { key: "passes" }],
  ["passes%", { key: "passAccuracy", percent: true }],
  ["expectedgoals", { key: "expectedGoals" }],
  ["expected_goal", { key: "expectedGoals" }],
  ["expected_goals", { key: "expectedGoals" }],
]);

const API_FOOTBALL_SUPPORTED_STATS = [
  "shots",
  "shotsOnTarget",
  "corners",
  "fouls",
  "offsides",
  "passSuccess",
];

export async function fetchApiFootballFixtureIndexPayload(matches, options = {}) {
  const fetchedAt = options.fetchedAt ?? new Date().toISOString();
  const url = buildApiFootballUrl("/fixtures", {
    league: options.league ?? DEFAULT_LEAGUE_ID,
    season: options.season ?? DEFAULT_SEASON,
  });
  const payload = await fetchApiFootballJson(url, options);
  const fixtures = Array.isArray(payload.response) ? payload.response.map(normalizeApiFixture).filter(Boolean) : [];
  const mapped = [];
  const skipped = [];

  for (const match of matches) {
    const fixture = fixtures.find((candidate) => isSameFixture(candidate, match));
    if (!fixture) {
      skipped.push({ matchId: match.id, reason: "fixture_not_matched" });
      continue;
    }

    mapped.push({
      matchId: match.id,
      fixtureId: fixture.id,
      fixtureDate: fixture.date,
      homeName: fixture.home.name,
      awayName: fixture.away.name,
    });
  }

  return {
    source: {
      id: API_FOOTBALL_FIXTURE_SOURCE_ID,
      name: "API-Football World Cup fixtures",
      url: url.toString(),
      retrievedAt: fetchedAt,
      tier: 2,
      access: "free_key",
      notes: "Supplemental API-Football fixture IDs used only to fetch technical statistics for mapped FIFA fixtures.",
    },
    rawCount: fixtures.length,
    mapped,
    skipped,
  };
}

export function applyApiFootballFixtureIdsToStore(store, payload) {
  const nextStore = structuredClone(store);
  const importedMatchIds = [];
  const skipped = [];

  for (const item of payload.mapped ?? []) {
    const match = nextStore.matches.find((candidate) => candidate.id === item.matchId);
    if (!match) {
      skipped.push({ matchId: item.matchId, reason: "unknown_match" });
      continue;
    }

    match.externalIds = {
      ...(match.externalIds ?? {}),
      apiFootball: item.fixtureId,
    };
    importedMatchIds.push(match.id);
  }

  upsertById(nextStore.sources, {
    ...payload.source,
    lastSync: {
      fetchedAt: payload.source.retrievedAt,
      rawCount: payload.rawCount,
      importedCount: importedMatchIds.length,
      skippedCount: (payload.skipped?.length ?? 0) + skipped.length,
    },
  });

  return {
    store: nextStore,
    summary: {
      sourceId: payload.source.id,
      sourceUrl: payload.source.url,
      fetchedAt: payload.source.retrievedAt,
      rawCount: payload.rawCount,
      importedCount: importedMatchIds.length,
      importedMatchIds,
      skippedCount: (payload.skipped?.length ?? 0) + skipped.length,
      skipped: [...(payload.skipped ?? []), ...skipped],
    },
  };
}

export async function fetchApiFootballStatsPayloadForMatches(matches, options = {}) {
  const fetchedAt = options.fetchedAt ?? new Date().toISOString();
  const stats = [];
  const skipped = [];

  for (const match of matches) {
    const fixtureId = match.externalIds?.apiFootball;
    if (!fixtureId) {
      skipped.push({ matchId: match.id, reason: "missing_api_football_fixture_id" });
      continue;
    }

    const url = buildApiFootballUrl("/fixtures/statistics", { fixture: fixtureId });
    let payload;
    try {
      payload = await fetchApiFootballJson(url, options);
    } catch (error) {
      skipped.push({
        matchId: match.id,
        fixtureId,
        reason: error.code ?? "source_fetch_failed",
        status: error.status ?? null,
      });
      continue;
    }

    const matchStats = normalizeApiFootballStatistics(payload.response, {
      match,
      fixtureId,
      fetchedAt,
      sourceUrl: url.toString(),
    });

    if (!matchStats || Object.keys(matchStats.statistics).length === 0) {
      skipped.push({ matchId: match.id, fixtureId, reason: "statistics_not_available" });
      continue;
    }

    stats.push(matchStats);
  }

  return {
    source: {
      id: API_FOOTBALL_STATS_SOURCE_ID,
      name: "API-Football fixture statistics",
      url: "https://v3.football.api-sports.io/fixtures/statistics",
      retrievedAt: fetchedAt,
      tier: 2,
      access: "free_key",
      notes: "Supplemental technical statistics. FIFA remains the primary source for fixtures, score, and official event facts.",
    },
    stats,
    probe: {
      fetchedAt,
      requestedCount: matches.length,
      availableCount: stats.length,
      skippedCount: skipped.length,
      skipped,
    },
  };
}

export function applyApiFootballStatsToStore(store, payload) {
  const nextStore = structuredClone(store);
  const importedMatchIds = [];
  const skipped = [];

  for (const item of payload.stats ?? []) {
    const match = nextStore.matches.find((candidate) => candidate.id === item.matchId);
    if (!match) {
      skipped.push({ matchId: item.matchId, reason: "unknown_match" });
      continue;
    }

    match.matchFacts = mergeApiFootballStats(match.matchFacts, item);
    importedMatchIds.push(match.id);
  }

  upsertById(nextStore.sources, {
    ...payload.source,
    lastSync: {
      fetchedAt: payload.source.retrievedAt,
      requestedCount: payload.probe?.requestedCount ?? 0,
      importedCount: importedMatchIds.length,
      skippedCount: (payload.probe?.skippedCount ?? 0) + skipped.length,
    },
  });

  return {
    store: nextStore,
    summary: {
      sourceId: payload.source.id,
      sourceUrl: payload.source.url,
      fetchedAt: payload.source.retrievedAt,
      importedCount: importedMatchIds.length,
      importedMatchIds,
      skippedCount: (payload.probe?.skippedCount ?? 0) + skipped.length,
      skipped: [...(payload.probe?.skipped ?? []), ...skipped],
    },
  };
}

export function normalizeApiFootballStatistics(rows, context = {}) {
  if (!Array.isArray(rows)) return null;

  const bySide = { home: {}, away: {} };
  for (const row of rows) {
    const side = getApiFootballSide(row.team, context.match);
    if (!side) continue;
    for (const stat of row.statistics ?? []) {
      const mapped = STAT_MAP.get(normalizeStatName(stat.type));
      if (!mapped) continue;
      const value = parseStatValue(stat.value);
      if (value == null) continue;
      bySide[side][mapped.key] = value;
    }
  }

  const statistics = {};
  for (const key of new Set([...Object.keys(bySide.home), ...Object.keys(bySide.away)])) {
    if (bySide.home[key] == null || bySide.away[key] == null) continue;
    statistics[key] = {
      home: bySide.home[key],
      away: bySide.away[key],
    };
  }

  return {
    matchId: context.match?.id ?? null,
    fixtureId: String(context.fixtureId ?? ""),
    sourceId: API_FOOTBALL_STATS_SOURCE_ID,
    sourceUrl: context.sourceUrl ?? null,
    retrievedAt: context.fetchedAt,
    statistics,
  };
}

function mergeApiFootballStats(existingFacts, item) {
  const facts = existingFacts && typeof existingFacts === "object" ? structuredClone(existingFacts) : {
    status: "partial",
    sourceId: API_FOOTBALL_STATS_SOURCE_ID,
    sourceUrl: item.sourceUrl,
    retrievedAt: item.retrievedAt,
    coverage: {
      events: false,
      statistics: false,
      weather: false,
      unsupportedStatistics: [],
    },
    score: { home: null, away: null },
    statistics: {},
    events: [],
  };

  const unsupported = new Set(facts.coverage?.unsupportedStatistics ?? []);
  for (const key of API_FOOTBALL_SUPPORTED_STATS) unsupported.delete(key);

  facts.status = "available";
  facts.coverage = {
    ...(facts.coverage ?? {}),
    statistics: true,
    unsupportedStatistics: [...unsupported],
  };
  facts.statistics = {
    ...(facts.statistics ?? {}),
    ...item.statistics,
  };
  facts.statisticsSource = {
    sourceId: item.sourceId,
    sourceUrl: item.sourceUrl,
    retrievedAt: item.retrievedAt,
    fixtureId: item.fixtureId,
  };
  facts.supplementalSources = upsertSourceReference(facts.supplementalSources, facts.statisticsSource);

  return facts;
}

function upsertSourceReference(sources, source) {
  const next = Array.isArray(sources) ? sources.filter((item) => item.sourceId !== source.sourceId) : [];
  next.push(source);
  return next;
}

function buildApiFootballUrl(path, params = {}) {
  const url = new URL(`${API_FOOTBALL_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  return url;
}

async function fetchApiFootballJson(url, options = {}) {
  const key = options.key ?? process.env.API_FOOTBALL_KEY;
  if (!key) {
    const error = new Error("Missing API_FOOTBALL_KEY. API-Football sync needs a free API key.");
    error.status = 400;
    error.code = "missing_api_football_key";
    throw error;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    headers: {
      "x-apisports-key": key,
      accept: "application/json",
      "user-agent": "world-cup-prediction-api-football-sync/0.1",
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`API-Football request failed with HTTP ${response.status}.`);
    error.status = response.status;
    error.code = "source_fetch_failed";
    error.payload = payload;
    throw error;
  }
  return payload ?? {};
}

function normalizeApiFixture(item) {
  if (!item?.fixture?.id || !item.fixture.date || !item.teams?.home || !item.teams?.away) return null;
  return {
    id: String(item.fixture.id),
    date: item.fixture.date,
    home: {
      id: item.teams.home.id ? String(item.teams.home.id) : null,
      name: item.teams.home.name ?? null,
      code: item.teams.home.code ?? null,
      country: item.teams.home.country ?? null,
    },
    away: {
      id: item.teams.away.id ? String(item.teams.away.id) : null,
      name: item.teams.away.name ?? null,
      code: item.teams.away.code ?? null,
      country: item.teams.away.country ?? null,
    },
  };
}

function isSameFixture(fixture, match) {
  return sameUtcDate(fixture.date, match.official?.dateUtc ?? match.kickoffLocal)
    && matchesAlias(fixture.home, teamAliases(match.homeTeamId, match.official?.homeCode))
    && matchesAlias(fixture.away, teamAliases(match.awayTeamId, match.official?.awayCode));
}

function getApiFootballSide(team, match) {
  if (matchesAlias(team, teamAliases(match.homeTeamId, match.official?.homeCode))) return "home";
  if (matchesAlias(team, teamAliases(match.awayTeamId, match.official?.awayCode))) return "away";
  return null;
}

function sameUtcDate(left, right) {
  if (!left || !right) return false;
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  if (Number.isNaN(leftDate.getTime()) || Number.isNaN(rightDate.getTime())) {
    return String(left).slice(0, 10) === String(right).slice(0, 10);
  }
  return leftDate.toISOString().slice(0, 10) === rightDate.toISOString().slice(0, 10);
}

function matchesAlias(team, aliases) {
  const values = [team?.name, team?.code, team?.country].filter(Boolean).map(normalizeText);
  return aliases.some((alias) => values.includes(normalizeText(alias)));
}

function teamAliases(teamId, fifaCode) {
  const code = fifaCode ?? getFifaCodeForTeamId(teamId);
  const base = [teamId, code];
  const extras = {
    "bosnia-and-herzegovina": ["Bosnia-Herzegovina", "Bosnia and Herzegovina", "BIH"],
    "czech-republic": ["Czech Republic", "Czechia", "CZE"],
    "congo-dr": ["DR Congo", "Congo DR", "Congo-Kinshasa", "COD"],
    "ivory-coast": ["Côte d'Ivoire", "Cote d'Ivoire", "Ivory Coast", "CIV"],
    "south-africa": ["South Africa", "RSA"],
    "south-korea": ["South Korea", "Korea Republic", "KOR"],
    turkiye: ["Türkiye", "Turkey", "TUR"],
    usa: ["United States", "USA"],
  };
  return [...base, ...(extras[teamId] ?? [])].filter(Boolean);
}

function normalizeText(value) {
  return String(value).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
}

function normalizeStatName(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9_%]+/g, "");
}

function parseStatValue(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (!text || text === "-") return null;
  const number = Number(text.replace("%", ""));
  return Number.isFinite(number) ? number : null;
}

function upsertById(items, item) {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) {
    items[index] = { ...items[index], ...item };
    return;
  }
  items.push(item);
}
