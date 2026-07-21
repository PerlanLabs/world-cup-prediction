import { buildFifaLiveFootballUrl, fetchFifaLiveFootballMatch } from "./fifa-lineup-sync.mjs";

const FIFA_MATCH_FACTS_SOURCE_ID = "fifa-api-live-football-match-facts";

export async function fetchFifaMatchFactsPayloadForMatches(matches, options = {}) {
  const fetchedAt = options.fetchedAt ?? new Date().toISOString();
  const facts = [];
  const skipped = [];

  for (const match of matches) {
    const idMatch = match?.official?.idMatch;
    if (!idMatch) {
      skipped.push({ matchId: match?.id ?? null, idMatch: null, reason: "missing_fifa_match_id" });
      continue;
    }

    const url = buildFifaLiveFootballUrl(idMatch, options);
    let liveMatch;
    try {
      liveMatch = await fetchFifaLiveFootballMatch(url, options);
    } catch (error) {
      skipped.push({
        matchId: match.id,
        idMatch,
        reason: error.code ?? "source_fetch_failed",
        status: error.status ?? null,
      });
      continue;
    }

    const matchFacts = normalizeFifaMatchFacts(liveMatch, {
      match,
      idMatch,
      fetchedAt,
      sourceUrl: url,
    });

    if (!matchFacts) {
      skipped.push({ matchId: match.id, idMatch, reason: "match_facts_not_available" });
      continue;
    }

    facts.push(matchFacts);
  }

  return {
    source: {
      id: FIFA_MATCH_FACTS_SOURCE_ID,
      name: "FIFA API live football match facts",
      url: "https://api.fifa.com/api/v3/live/football/{IdMatch}",
      retrievedAt: fetchedAt,
      tier: 1,
      access: "official_public",
      notes: "Official FIFA live football endpoint used for match events and available match facts. This endpoint currently exposes goals, bookings, substitutions, weather, and possession-like fields when available; it may not expose shots, corners, fouls, or pass success.",
    },
    facts,
    probe: {
      fetchedAt,
      requestedCount: matches.length,
      availableCount: facts.length,
      skippedCount: skipped.length,
      skipped,
    },
  };
}

export function applyFifaMatchFactsToStore(store, payload) {
  const nextStore = structuredClone(store);
  const importedMatchIds = [];
  const skipped = [];

  for (const item of payload.facts ?? []) {
    const match = nextStore.matches.find((candidate) => (
      candidate.id === item.matchId ||
      candidate.official?.idMatch === item.idMatch
    ));

    if (!match) {
      skipped.push({ matchId: item.matchId ?? null, idMatch: item.idMatch ?? null, reason: "unknown_match" });
      continue;
    }

    match.matchFacts = item.matchFacts;
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

export function normalizeFifaMatchFacts(liveMatch, context = {}) {
  if (!liveMatch || typeof liveMatch !== "object") return null;

  const homeTeamId = context.match?.homeTeamId ?? null;
  const awayTeamId = context.match?.awayTeamId ?? null;
  const home = liveMatch.HomeTeam ?? {};
  const away = liveMatch.AwayTeam ?? {};
  const homePlayers = buildPlayerLookup(home.Players);
  const awayPlayers = buildPlayerLookup(away.Players);
  const allPlayers = new Map([...homePlayers, ...awayPlayers]);
  const events = [
    ...normalizeGoals(home.Goals, "home", homeTeamId, homePlayers),
    ...normalizeGoals(away.Goals, "away", awayTeamId, awayPlayers),
    ...normalizeBookings(home.Bookings, "home", homeTeamId, homePlayers),
    ...normalizeBookings(away.Bookings, "away", awayTeamId, awayPlayers),
    ...normalizeSubstitutions(home.Substitutions, "home", homeTeamId, allPlayers),
    ...normalizeSubstitutions(away.Substitutions, "away", awayTeamId, allPlayers),
  ].sort(compareEvents);

  const statistics = normalizeStatistics(liveMatch);
  const weather = normalizeWeather(liveMatch.Weather);

  return {
    matchId: context.match?.id ?? null,
    idMatch: String(context.idMatch ?? liveMatch.IdMatch ?? ""),
    matchFacts: {
      status: events.length > 0 || hasStatistics(statistics) || weather ? "available" : "partial",
      sourceId: FIFA_MATCH_FACTS_SOURCE_ID,
      sourceUrl: context.sourceUrl ?? null,
      retrievedAt: context.fetchedAt,
      coverage: {
        events: events.length > 0,
        statistics: hasStatistics(statistics),
        weather: Boolean(weather),
        unsupportedStatistics: ["shots", "shotsOnTarget", "corners", "fouls", "offsides", "passSuccess"],
      },
      score: {
        home: toNullableNumber(home.Score ?? liveMatch.HomeTeamScore),
        away: toNullableNumber(away.Score ?? liveMatch.AwayTeamScore),
      },
      statistics,
      weather,
      events,
    },
  };
}

function normalizeGoals(goals = [], side, teamId, players) {
  if (!Array.isArray(goals)) return [];
  return goals.map((goal, index) => {
    const player = players.get(String(goal.IdPlayer));
    const assist = goal.IdAssistPlayer ? players.get(String(goal.IdAssistPlayer)) : null;
    return {
      id: `goal-${side}-${goal.Minute ?? index}-${goal.IdPlayer ?? index}`,
      type: "goal",
      side,
      teamId,
      minute: toNullableString(goal.Minute),
      period: toNullableNumber(goal.Period),
      playerId: toNullableString(goal.IdPlayer),
      playerName: player?.name ?? toNullableString(goal.IdPlayer),
      shirtNumber: player?.shirtNumber ?? null,
      assistPlayerId: toNullableString(goal.IdAssistPlayer),
      assistPlayerName: assist?.name ?? null,
      goalType: toGoalType(goal.Type),
    };
  });
}

function normalizeBookings(bookings = [], side, teamId, players) {
  if (!Array.isArray(bookings)) return [];
  return bookings.map((booking, index) => {
    const player = players.get(String(booking.IdPlayer));
    const card = toCardType(booking.Card);
    return {
      id: `booking-${side}-${booking.Minute ?? index}-${booking.IdPlayer ?? index}-${booking.Card ?? ""}`,
      type: "booking",
      side,
      teamId,
      minute: toNullableString(booking.Minute),
      period: toNullableNumber(booking.Period),
      playerId: toNullableString(booking.IdPlayer),
      playerName: player?.name ?? toNullableString(booking.IdPlayer),
      shirtNumber: player?.shirtNumber ?? null,
      card,
    };
  });
}

function normalizeSubstitutions(substitutions = [], side, teamId, players) {
  if (!Array.isArray(substitutions)) return [];
  return substitutions.map((substitution, index) => {
    const offPlayer = players.get(String(substitution.IdPlayerOff));
    const onPlayer = players.get(String(substitution.IdPlayerOn));
    return {
      id: `sub-${side}-${substitution.Minute ?? index}-${substitution.IdPlayerOff ?? index}-${substitution.IdPlayerOn ?? ""}`,
      type: "substitution",
      side,
      teamId,
      minute: toNullableString(substitution.Minute),
      period: toNullableNumber(substitution.Period),
      playerOffId: toNullableString(substitution.IdPlayerOff),
      playerOffName: offPlayer?.name ?? localizedDescription(substitution.PlayerOffName) ?? toNullableString(substitution.IdPlayerOff),
      playerOnId: toNullableString(substitution.IdPlayerOn),
      playerOnName: onPlayer?.name ?? localizedDescription(substitution.PlayerOnName) ?? toNullableString(substitution.IdPlayerOn),
    };
  });
}

function normalizeStatistics(liveMatch) {
  return {
    possession: normalizeSidePair(liveMatch.BallPossession),
    territorialPossession: normalizeSidePair(liveMatch.TerritorialPossesion),
    territorialThirdPossession: normalizeSidePair(liveMatch.TerritorialThirdPossesion),
  };
}

function normalizeSidePair(value) {
  if (value == null) return null;
  if (typeof value === "number") return null;
  if (Array.isArray(value)) return null;
  if (typeof value !== "object") return null;

  const home = firstFinite(
    value.Home,
    value.home,
    value.HomeTeam,
    value.homeTeam,
    value.HomeValue,
    value.homeValue,
  );
  const away = firstFinite(
    value.Away,
    value.away,
    value.AwayTeam,
    value.awayTeam,
    value.AwayValue,
    value.awayValue,
  );

  if (home == null || away == null) return null;
  return { home, away };
}

function normalizeWeather(weather) {
  if (!weather || typeof weather !== "object") return null;
  const temperature = toNullableNumber(weather.Temperature);
  const humidity = toNullableNumber(weather.Humidity);
  const windSpeed = toNullableNumber(weather.WindSpeed);
  const type = localizedDescription(weather.TypeLocalized) ?? toNullableString(weather.Type);
  if (temperature == null && humidity == null && windSpeed == null && !type) return null;
  return { temperature, humidity, windSpeed, type };
}

function buildPlayerLookup(players = []) {
  const lookup = new Map();
  if (!Array.isArray(players)) return lookup;
  for (const player of players) {
    if (player?.IdPlayer == null) continue;
    lookup.set(String(player.IdPlayer), {
      id: String(player.IdPlayer),
      name: localizedDescription(player.PlayerName) ?? localizedDescription(player.ShortName) ?? String(player.IdPlayer),
      shirtNumber: toNullableString(player.ShirtNumber),
      position: player.Position,
    });
  }
  return lookup;
}

function compareEvents(a, b) {
  return minuteSort(a.minute) - minuteSort(b.minute) || eventPriority(a.type) - eventPriority(b.type);
}

function minuteSort(value) {
  const match = String(value ?? "").match(/\d+/);
  return match ? Number(match[0]) : 999;
}

function eventPriority(type) {
  if (type === "goal") return 1;
  if (type === "booking") return 2;
  return 3;
}

function hasStatistics(statistics) {
  return Boolean(statistics?.possession || statistics?.territorialPossession || statistics?.territorialThirdPossession);
}

function toGoalType(value) {
  const number = Number(value);
  if (number === 1) return "own_goal";
  if (number === 3) return "penalty";
  return "regular";
}

function toCardType(value) {
  const number = Number(value);
  if (number === 2) return "red";
  if (number === 3) return "second_yellow";
  return "yellow";
}

function firstFinite(...values) {
  for (const value of values) {
    const number = toNullableNumber(value);
    if (number != null) return number;
  }
  return null;
}

function localizedDescription(value, locale = "en-GB") {
  if (!Array.isArray(value)) return null;
  return value.find((item) => item.Locale === locale)?.Description ?? value[0]?.Description ?? null;
}

function toNullableNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toNullableString(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function upsertById(items, item) {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) {
    items[index] = { ...items[index], ...item };
    return;
  }
  items.push(item);
}
