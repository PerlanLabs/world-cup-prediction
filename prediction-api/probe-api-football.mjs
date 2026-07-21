import { getStore } from "./store.mjs";

const API_FOOTBALL_BASE_URL = "https://v3.football.api-sports.io";
const DEFAULT_LEAGUE_ID = "1";
const DEFAULT_SEASON = "2026";

try {
  const options = parseArgs(process.argv.slice(2));
  const key = options.key ?? process.env.API_FOOTBALL_KEY;
  if (!key) {
    throw Object.assign(new Error("Missing API_FOOTBALL_KEY. Create a free API-Football key and set it before probing."), {
      code: "missing_api_football_key",
      status: 400,
    });
  }

  const probe = await runProbe({ ...options, key });
  if (options.json) {
    console.log(JSON.stringify({ ok: true, probe }, null, 2));
  } else {
    console.log("API-Football dry-run probe completed.");
    console.log(`Fixture: ${probe.fixtureId ?? "not resolved"}`);
    console.log(`Requests used: ${probe.requests.length}`);
    console.log(`Statistics rows: ${probe.statistics.rowCount}`);
    console.log(`Events: ${probe.events.rowCount}`);
    console.log(`Lineups: ${probe.lineups.rowCount}`);
    console.log(`Player stat groups: ${probe.players.rowCount}`);
    console.log(`Injuries: ${probe.injuries.rowCount}`);
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: {
      code: error.code ?? "api_football_probe_failed",
      message: error.message,
    },
  }, null, 2));
  process.exitCode = 1;
}

async function runProbe(options) {
  const fixtureId = options.fixtureId ?? await resolveFixtureId(options);
  if (!fixtureId) {
    throw Object.assign(new Error("Could not resolve an API-Football fixture id. Pass --fixture-id explicitly."), {
      code: "fixture_id_not_resolved",
    });
  }

  const requests = [];
  const call = async (path, params) => {
    const url = new URL(`${API_FOOTBALL_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value != null) url.searchParams.set(key, String(value));
    }
    requests.push(url.toString());
    return fetchApiFootball(url, options.key);
  };

  const [fixture, statistics, events, lineups, players, injuries] = await Promise.all([
    call("/fixtures", { id: fixtureId }),
    call("/fixtures/statistics", { fixture: fixtureId }),
    call("/fixtures/events", { fixture: fixtureId }),
    call("/fixtures/lineups", { fixture: fixtureId }),
    call("/fixtures/players", { fixture: fixtureId }),
    call("/injuries", { fixture: fixtureId }),
  ]);

  return {
    fixtureId,
    requests,
    fixture: summarizeApiFootballResponse(fixture),
    statistics: summarizeApiFootballResponse(statistics, summarizeStatistics),
    events: summarizeApiFootballResponse(events, summarizeEvents),
    lineups: summarizeApiFootballResponse(lineups, summarizeLineups),
    players: summarizeApiFootballResponse(players, summarizePlayers),
    injuries: summarizeApiFootballResponse(injuries, summarizeInjuries),
  };
}

async function resolveFixtureId(options) {
  if (options.fixtureId) return options.fixtureId;
  if (!options.matchId) return null;

  const match = getStore().matches.find((item) => item.id === options.matchId);
  if (!match) {
    throw Object.assign(new Error(`Unknown match id: ${options.matchId}.`), {
      code: "not_found",
      status: 404,
    });
  }

  if (match.externalIds?.apiFootball) return match.externalIds.apiFootball;

  const url = new URL(`${API_FOOTBALL_BASE_URL}/fixtures`);
  url.searchParams.set("league", options.league ?? DEFAULT_LEAGUE_ID);
  url.searchParams.set("season", options.season ?? DEFAULT_SEASON);

  const payload = await fetchApiFootball(url, options.key);
  const candidates = Array.isArray(payload.response) ? payload.response : [];
  const homeAliases = teamAliases(match.homeTeamId, match.official?.homeCode);
  const awayAliases = teamAliases(match.awayTeamId, match.official?.awayCode);

  const resolved = candidates.find((candidate) => (
    sameDate(candidate.fixture?.date, match.official?.dateUtc ?? match.kickoffLocal)
    && matchesAlias(candidate.teams?.home, homeAliases)
    && matchesAlias(candidate.teams?.away, awayAliases)
  ));

  return resolved?.fixture?.id ? String(resolved.fixture.id) : null;
}

async function fetchApiFootball(url, key) {
  const response = await fetch(url, {
    headers: {
      "x-apisports-key": key,
      accept: "application/json",
      "user-agent": "world-cup-prediction-api-football-probe/0.1",
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
  return payload;
}

function summarizeApiFootballResponse(payload, detailBuilder) {
  const response = Array.isArray(payload?.response) ? payload.response : [];
  return {
    rowCount: response.length,
    errors: payload?.errors ?? null,
    paging: payload?.paging ?? null,
    details: detailBuilder ? detailBuilder(response) : response.slice(0, 2),
  };
}

function summarizeStatistics(rows) {
  return rows.map((row) => ({
    team: row.team?.name,
    types: (row.statistics ?? []).map((stat) => stat.type),
  }));
}

function summarizeEvents(rows) {
  return rows.slice(0, 12).map((event) => ({
    time: event.time?.elapsed,
    team: event.team?.name,
    player: event.player?.name,
    assist: event.assist?.name,
    type: event.type,
    detail: event.detail,
  }));
}

function summarizeLineups(rows) {
  return rows.map((lineup) => ({
    team: lineup.team?.name,
    formation: lineup.formation,
    starters: lineup.startXI?.length ?? 0,
    substitutes: lineup.substitutes?.length ?? 0,
  }));
}

function summarizePlayers(rows) {
  return rows.map((team) => ({
    team: team.team?.name,
    players: team.players?.length ?? 0,
    sampleStats: team.players?.[0]?.statistics?.[0] ? Object.keys(team.players[0].statistics[0]) : [],
  }));
}

function summarizeInjuries(rows) {
  return rows.slice(0, 12).map((injury) => ({
    team: injury.team?.name,
    player: injury.player?.name,
    reason: injury.player?.reason,
    type: injury.player?.type,
  }));
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--fixture-id") {
      options.fixtureId = requiredValue(args, ++index, "--fixture-id");
    } else if (arg === "--match-id") {
      options.matchId = requiredValue(args, ++index, "--match-id");
    } else if (arg === "--league") {
      options.league = requiredValue(args, ++index, "--league");
    } else if (arg === "--season") {
      options.season = requiredValue(args, ++index, "--season");
    } else if (arg === "--key") {
      options.key = requiredValue(args, ++index, "--key");
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function requiredValue(args, index, label) {
  const value = args[index];
  if (!value) throw new Error(`${label} requires a value.`);
  return value;
}

function printHelp() {
  console.log(`Usage: node prediction-api/probe-api-football.mjs [options]

Options:
  --fixture-id <id>        Probe one API-Football fixture id directly.
  --match-id <id>          Resolve a local match id through API-Football fixtures, then probe it.
  --league <id>            API-Football league id. Defaults to 1.
  --season <year>          API-Football season. Defaults to 2026.
  --key <key>              API-Football key. Prefer API_FOOTBALL_KEY env var.
  --json                   Print machine-readable JSON.
`);
}

function sameDate(left, right) {
  if (!left || !right) return false;
  return left.slice(0, 10) === right.slice(0, 10);
}

function matchesAlias(team, aliases) {
  const values = [team?.name, team?.code, team?.country].filter(Boolean).map(normalize);
  return aliases.some((alias) => values.includes(normalize(alias)));
}

function teamAliases(teamId, fifaCode) {
  const base = [teamId, fifaCode];
  const extras = {
    "bosnia-and-herzegovina": ["Bosnia-Herzegovina", "Bosnia and Herzegovina", "BIH"],
    "czech-republic": ["Czech Republic", "Czechia", "CZE"],
    "south-africa": ["South Africa", "RSA"],
    "south-korea": ["South Korea", "Korea Republic", "KOR"],
    usa: ["United States", "USA"],
  };
  return [...base, ...(extras[teamId] ?? [])].filter(Boolean);
}

function normalize(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}
