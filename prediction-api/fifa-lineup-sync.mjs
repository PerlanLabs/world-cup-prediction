const FIFA_LIVE_FOOTBALL_SOURCE_ID = "fifa-api-live-football-lineups";
const POSITION_LABELS = new Map([
  [0, "GK"],
  [1, "DF"],
  [2, "MF"],
  [3, "FW"],
]);

export function buildFifaLiveFootballUrl(idMatch, options = {}) {
  const params = new URLSearchParams({
    language: options.language ?? "en",
  });
  return `https://api.fifa.com/api/v3/live/football/${encodeURIComponent(idMatch)}?${params.toString()}`;
}

export async function fetchOfficialLineupPayloadForMatches(matches, options = {}) {
  const fetchedAt = options.fetchedAt ?? new Date().toISOString();
  const lineups = [];
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

    const lineup = normalizeFifaOfficialLineup(liveMatch, {
      matchId: match.id,
      idMatch,
      fetchedAt,
      sourceUrl: url,
    });

    if (!lineup) {
      skipped.push({ matchId: match.id, idMatch, reason: "official_lineup_not_available" });
      continue;
    }

    lineups.push(lineup);
  }

  return {
    source: {
      id: FIFA_LIVE_FOOTBALL_SOURCE_ID,
      name: "FIFA API live football official lineups",
      url: "https://api.fifa.com/api/v3/live/football/{IdMatch}",
      retrievedAt: fetchedAt,
      tier: 1,
      access: "official_public",
      notes: "Official FIFA live football endpoint used for confirmed lineups. Player Status=1 is treated as starter and Status=2 as substitute.",
    },
    lineups,
    probe: {
      fetchedAt,
      requestedCount: matches.length,
      availableCount: lineups.length,
      skippedCount: skipped.length,
      skipped,
    },
  };
}

export async function fetchFifaLiveFootballMatch(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "world-cup-prediction-lineup-sync/0.1",
    },
  });

  if (!response.ok) {
    const error = new Error(`FIFA official lineup sync failed with HTTP ${response.status}.`);
    error.status = response.status;
    error.code = "source_fetch_failed";
    throw error;
  }

  const payload = await response.json();
  if (!payload || typeof payload !== "object") {
    const error = new Error("FIFA official lineup response was not a JSON object.");
    error.status = 502;
    error.code = "source_shape_changed";
    throw error;
  }
  return payload;
}

export function normalizeFifaOfficialLineup(liveMatch, context = {}) {
  const home = normalizeTeamLineup(liveMatch?.HomeTeam);
  const away = normalizeTeamLineup(liveMatch?.AwayTeam);

  if (home.starters.length !== 11 || away.starters.length !== 11) {
    return null;
  }

  return {
    matchId: context.matchId,
    idMatch: context.idMatch ?? liveMatch?.IdMatch,
    official: {
      status: "available",
      confidence: "confirmed",
      sourceId: FIFA_LIVE_FOOTBALL_SOURCE_ID,
      sourceUrl: context.sourceUrl ?? null,
      retrievedAt: context.fetchedAt,
      note: "FIFA 官方首发已确认。",
      home,
      away,
    },
  };
}

function normalizeTeamLineup(team) {
  const players = Array.isArray(team?.Players) ? team.Players : [];
  return {
    formation: toNullableString(team?.Tactics),
    starters: normalizePlayers(players.filter((player) => Number(player.Status) === 1)),
    substitutes: normalizePlayers(players.filter((player) => Number(player.Status) === 2)),
    unavailable: [],
  };
}

function normalizePlayers(players) {
  return players
    .map((player) => ({
      name: localizedDescription(player.PlayerName) ?? localizedDescription(player.ShortName) ?? "未知球员",
      position: POSITION_LABELS.get(Number(player.Position)) ?? null,
      shirtNumber: toNullableString(player.ShirtNumber),
      note: player.Captain ? "队长" : null,
    }))
    .sort(sortPlayers);
}

function sortPlayers(a, b) {
  const numberA = Number(a.shirtNumber);
  const numberB = Number(b.shirtNumber);
  if (Number.isFinite(numberA) && Number.isFinite(numberB) && numberA !== numberB) {
    return numberA - numberB;
  }
  return a.name.localeCompare(b.name);
}

function localizedDescription(value, locale = "en-GB") {
  if (!Array.isArray(value)) return null;
  return value.find((item) => item.Locale === locale)?.Description ?? value[0]?.Description ?? null;
}

function toNullableString(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}
