import { getFifaCodeForTeamId } from "./fifa-sync.mjs";

const FIFA_RANKING_SOURCE_ID = "fifa-live-world-ranking";
const FIFA_RANKING_PAGE_URL = "https://inside.fifa.com/fifa-world-ranking/men";
const FIFA_RANKING_API_URL =
  "https://inside.fifa.com/api/live-world-ranking/get-rankings?mode=live&gender=1&locale=en&count=250&rankingType=football";

export async function fetchFifaRankingPayload(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const fetchedAt = options.fetchedAt ?? new Date().toISOString();
  const [rankingResponse, metadataResponse] = await Promise.all([
    fetchImpl(options.rankingUrl ?? FIFA_RANKING_API_URL, {
      headers: {
        accept: "application/json",
        "user-agent": "world-cup-prediction-local-sync/0.1",
      },
    }),
    fetchImpl(options.pageUrl ?? FIFA_RANKING_PAGE_URL, {
      headers: {
        accept: "text/html",
        "user-agent": "world-cup-prediction-local-sync/0.1",
      },
    }),
  ]);

  if (!rankingResponse.ok) {
    const error = new Error(`FIFA ranking sync failed with HTTP ${rankingResponse.status}.`);
    error.status = rankingResponse.status;
    error.code = "source_fetch_failed";
    throw error;
  }

  const rankingPayload = await rankingResponse.json();
  if (!Array.isArray(rankingPayload.rankings)) {
    const error = new Error("FIFA ranking sync response did not include rankings array.");
    error.status = 502;
    error.code = "source_shape_changed";
    throw error;
  }

  const metadata = metadataResponse.ok ? extractRankingMetadata(await metadataResponse.text()) : {};

  return {
    source: {
      id: FIFA_RANKING_SOURCE_ID,
      name: "FIFA live world ranking",
      url: options.pageUrl ?? FIFA_RANKING_PAGE_URL,
      apiUrl: options.rankingUrl ?? FIFA_RANKING_API_URL,
      retrievedAt: fetchedAt,
      tier: 1,
      access: "official_public",
      notes: "Official FIFA men's live world ranking used for team display context only.",
      lastUpdateDate: metadata.lastUpdateDate ?? null,
      nextUpdateDate: metadata.nextUpdateDate ?? null,
    },
    fetchedAt,
    rawCount: rankingPayload.rankings.length,
    rankings: rankingPayload.rankings.map(normalizeRanking).filter(Boolean),
  };
}

export function applyFifaRankingsToStore(store, payload) {
  const rankingByCode = new Map(payload.rankings.map((ranking) => [ranking.countryCode, ranking]));
  const nextStore = structuredClone(store);
  const updatedTeamIds = [];
  const missingTeamIds = [];

  nextStore.teams = nextStore.teams.map((team) => {
    const ranking = rankingByCode.get(getTeamFifaCode(team));
    if (!ranking) {
      missingTeamIds.push(team.id);
      return team;
    }

    updatedTeamIds.push(team.id);
    return {
      ...team,
      profile: {
        ...(team.profile ?? {}),
        worldRanking: {
          sourceId: payload.source.id,
          sourceUrl: payload.source.url,
          retrievedAt: payload.fetchedAt,
          lastUpdateDate: payload.source.lastUpdateDate,
          nextUpdateDate: payload.source.nextUpdateDate,
          rank: ranking.rank,
          previousRank: ranking.previousRank,
          points: ranking.totalPoints,
          previousPoints: ranking.previousPoints,
          fifaTeamId: ranking.idTeam,
          confederation: ranking.confederationName,
        },
        marketValue: team.profile?.marketValue ?? {
          status: "unavailable",
          reason: "fifa_no_official_market_value",
          sourceId: null,
        },
      },
    };
  });

  upsertById(nextStore.sources, {
    ...payload.source,
    lastSync: {
      fetchedAt: payload.fetchedAt,
      rawCount: payload.rawCount,
      importedCount: updatedTeamIds.length,
      missingCount: missingTeamIds.length,
      updatedTeamIds,
      missingTeamIds,
    },
  });

  return {
    store: nextStore,
    summary: {
      sourceId: payload.source.id,
      sourceUrl: payload.source.url,
      fetchedAt: payload.fetchedAt,
      lastUpdateDate: payload.source.lastUpdateDate,
      nextUpdateDate: payload.source.nextUpdateDate,
      rawCount: payload.rawCount,
      importedCount: updatedTeamIds.length,
      missingCount: missingTeamIds.length,
      updatedTeamIds,
      missingTeamIds,
    },
  };
}

function normalizeRanking(item) {
  if (!item?.countryCode || item.rank == null) return null;
  return {
    idTeam: item.idTeam ? String(item.idTeam) : null,
    teamName: item.teamName ?? null,
    countryCode: String(item.countryCode).toUpperCase(),
    confederationName: item.confederationName ?? null,
    rank: toNumber(item.rank),
    previousRank: toNumber(item.previousRank),
    totalPoints: toNumber(item.totalPoints),
    previousPoints: toNumber(item.previousPoints),
  };
}

function getTeamFifaCode(team) {
  return team.fifaCode ?? getFifaCodeForTeamId(team.id);
}

function extractRankingMetadata(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return {};
  try {
    const data = JSON.parse(match[1]);
    const ranking = data.props?.pageProps?.pageData?.ranking ?? {};
    return {
      lastUpdateDate: ranking.lastUpdateDate ?? null,
      nextUpdateDate: ranking.nextUpdateDate ?? null,
    };
  } catch {
    return {};
  }
}

function toNumber(value) {
  const number = Number(value);
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
