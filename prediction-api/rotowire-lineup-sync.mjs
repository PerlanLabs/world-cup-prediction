const ROTOWIRE_SOURCE_ID = "rotowire-world-cup-lineups";
const ROTOWIRE_WORLD_CUP_LINEUPS_URL = "https://www.rotowire.com/soccer/lineups.php?league=WOC";

export async function fetchRotowireExpectedLineupPayload(matches, options = {}) {
  const fetchedAt = options.fetchedAt ?? new Date().toISOString();
  const url = options.url ?? ROTOWIRE_WORLD_CUP_LINEUPS_URL;
  const html = await fetchRotowireLineupsHtml(url, options);
  const parsed = parseRotowireLineupsHtml(html);
  const lineups = [];
  const skipped = [];

  for (const lineup of parsed) {
    const match = findStoreMatch(matches, lineup);
    if (!match) {
      skipped.push({
        homeCode: lineup.homeCode,
        awayCode: lineup.awayCode,
        reason: "match_not_found",
      });
      continue;
    }

    if (!lineup.home.starters.length || !lineup.away.starters.length) {
      skipped.push({
        matchId: match.id,
        homeCode: lineup.homeCode,
        awayCode: lineup.awayCode,
        reason: "empty_expected_lineup",
      });
      continue;
    }

    lineups.push({
      matchId: match.id,
      expected: {
        label: "预计首发",
        status: "available",
        confidence: lineup.statuses.every((status) => status.toLowerCase().includes("confirmed")) ? "high" : "medium",
        sourceId: ROTOWIRE_SOURCE_ID,
        sourceUrl: url,
        retrievedAt: fetchedAt,
        reviewedAt: fetchedAt,
        note: "RotoWire 公开预测首发，仅作为赛前参考；不是 FIFA 官方首发。",
        home: lineup.home,
        away: lineup.away,
      },
    });
  }

  return {
    source: {
      id: ROTOWIRE_SOURCE_ID,
      name: "RotoWire World Cup predicted lineups",
      url,
      retrievedAt: fetchedAt,
      tier: 3,
      access: "free_public",
      notes: "Public editorial predicted/confirmed lineup page. Imported only as expected lineups and never treated as official FIFA lineups.",
    },
    lineups,
    probe: {
      fetchedAt,
      rawCount: parsed.length,
      importedCandidateCount: lineups.length,
      skippedCount: skipped.length,
      skipped,
    },
  };
}

export async function fetchRotowireLineupsHtml(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "user-agent": "world-cup-prediction-expected-lineup-sync/0.1",
    },
  });

  if (!response.ok) {
    const error = new Error(`RotoWire expected lineup sync failed with HTTP ${response.status}.`);
    error.status = response.status;
    error.code = "source_fetch_failed";
    throw error;
  }

  return response.text();
}

export function parseRotowireLineupsHtml(html) {
  if (typeof html !== "string" || !html.trim()) return [];
  return html
    .split('<div class="lineup is-soccer">')
    .slice(1)
    .map(parseLineupBlock)
    .filter(Boolean);
}

function parseLineupBlock(block) {
  const codes = [...block.matchAll(/<div class="lineup__abbr">([^<]+)<\/div>/g)]
    .map((match) => decodeHtml(match[1]).trim())
    .filter(Boolean);
  if (codes.length < 2) return null;

  const lists = [...block.matchAll(/<ul class="lineup__list is-(home|visit)">([\s\S]*?)<\/ul>/g)];
  const homeList = lists.find((match) => match[1] === "home")?.[2];
  const awayList = lists.find((match) => match[1] === "visit")?.[2];
  if (!homeList || !awayList) return null;

  return {
    homeCode: codes[0],
    awayCode: codes[1],
    statuses: [parseStatus(homeList), parseStatus(awayList)].filter(Boolean),
    home: parseTeamLineup(homeList),
    away: parseTeamLineup(awayList),
  };
}

function parseStatus(listHtml) {
  const match = listHtml.match(/<li class="lineup__status[^>]*">[\s\S]*?<\/div>\s*([^<]+)<\/li>/);
  return decodeHtml(match?.[1] ?? "").trim();
}

function parseTeamLineup(listHtml) {
  const [startersHtml, injuriesHtml = ""] = listHtml.split(/<li class="lineup__title[^>]*">\s*Injuries\s*<\/li>/i);
  return {
    formation: null,
    starters: parsePlayers(startersHtml),
    substitutes: [],
    unavailable: parsePlayers(injuriesHtml),
  };
}

function parsePlayers(sectionHtml) {
  return [...sectionHtml.matchAll(/<li class="lineup__player">([\s\S]*?)<\/li>/g)]
    .map((match) => parsePlayer(match[1]))
    .filter(Boolean);
}

function parsePlayer(playerHtml) {
  const position = decodeHtml(playerHtml.match(/<div class="lineup__pos[^"]*">([^<]*)<\/div>/)?.[1] ?? "").trim();
  const titleName = playerHtml.match(/<a[^>]*title="([^"]+)"/)?.[1];
  const linkedName = playerHtml.match(/<a[^>]*>([^<]+)<\/a>/)?.[1];
  const name = decodeHtml(titleName ?? linkedName ?? "").trim();
  if (!name) return null;
  const injury = decodeHtml(playerHtml.match(/<span class="lineup__inj">([^<]+)<\/span>/)?.[1] ?? "").trim();

  return {
    name,
    position: normalizePosition(position),
    shirtNumber: null,
    note: injury ? `RotoWire: ${injury}` : null,
  };
}

function normalizePosition(position) {
  if (!position) return null;
  if (position === "GK") return "GK";
  if (position.startsWith("D")) return "DF";
  if (position.startsWith("M")) return "MF";
  if (position.startsWith("F")) return "FW";
  return position;
}

function findStoreMatch(matches, lineup) {
  return matches.find((match) => (
    match.official?.homeCode === lineup.homeCode &&
    match.official?.awayCode === lineup.awayCode
  ));
}

function decodeHtml(value) {
  return String(value)
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "-")
    .replace(/&mdash;/g, "-")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
