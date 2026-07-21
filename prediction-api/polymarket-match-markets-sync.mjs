import { existsSync, readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const POLYMARKET_GAMMA_BASE_URL = "https://gamma-api.polymarket.com";
const POLYMARKET_EVENT_PAGE_BASE_URL = "https://polymarket.com/event";
const SOURCE_ID = "polymarket-match-markets";
const USER_AGENT = "world-cup-prediction-polymarket-match-sync/0.1";

const TEAM_EVENT_CODES = new Map([
  ["algeria", "alg"],
  ["argentina", "arg"],
  ["australia", "aus"],
  ["austria", "aut"],
  ["belgium", "bel"],
  ["bosnia-and-herzegovina", "bih"],
  ["brazil", "bra"],
  ["cabo-verde", "cpv"],
  ["canada", "can"],
  ["colombia", "col"],
  ["congo-dr", "cod"],
  ["croatia", "cro"],
  ["curacao", "cuw"],
  ["czech-republic", "cze"],
  ["ecuador", "ecu"],
  ["egypt", "egy"],
  ["england", "eng"],
  ["france", "fra"],
  ["germany", "ger"],
  ["ghana", "gha"],
  ["haiti", "hai"],
  ["iran", "irn"],
  ["iraq", "irq"],
  ["ivory-coast", "civ"],
  ["japan", "jpn"],
  ["jordan", "jor"],
  ["mexico", "mex"],
  ["morocco", "mar"],
  ["netherlands", "nld"],
  ["new-zealand", "nzl"],
  ["norway", "nor"],
  ["panama", "pan"],
  ["paraguay", "par"],
  ["portugal", "por"],
  ["qatar", "qat"],
  ["saudi-arabia", "ksa"],
  ["scotland", "sco"],
  ["senegal", "sen"],
  ["south-africa", "rsa"],
  ["south-korea", "kr"],
  ["spain", "esp"],
  ["sweden", "swe"],
  ["switzerland", "che"],
  ["tunisia", "tun"],
  ["turkiye", "tur"],
  ["uruguay", "uru"],
  ["usa", "usa"],
  ["uzbekistan", "uzb"],
]);

const TEAM_NAME_ALIASES = new Map([
  ["usa", ["United States", "USA", "United States of America"]],
  ["south-korea", ["Korea Republic", "South Korea", "Korea"]],
  ["czech-republic", ["Czechia", "Czech Republic"]],
  ["bosnia-and-herzegovina", ["Bosnia-Herzegovina", "Bosnia and Herzegovina", "Bosnia"]],
  ["south-africa", ["South Africa", "RSA"]],
  ["ivory-coast", ["Côte d'Ivoire", "Cote d'Ivoire", "Ivory Coast"]],
  ["cabo-verde", ["Cabo Verde", "Cape Verde"]],
  ["congo-dr", ["DR Congo", "Democratic Republic of Congo", "Congo DR"]],
  ["turkiye", ["Türkiye", "Turkey"]],
  ["saudi-arabia", ["Saudi Arabia", "KSA"]],
  ["new-zealand", ["New Zealand"]],
  ["curacao", ["Curaçao", "Curacao"]],
]);

export async function fetchPolymarketMatchMarketsPayload(matches, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const fetchedAt = options.fetchedAt ?? new Date().toISOString();
  const teamsById = new Map((options.teams ?? []).map((team) => [team.id, team]));
  const selectedMatches = selectMatches(matches, options);
  const matchPayloads = [];
  const skipped = [];

  for (const match of selectedMatches) {
    const homeTeam = teamsById.get(match.homeTeamId);
    const awayTeam = teamsById.get(match.awayTeamId);
    if (!homeTeam || !awayTeam) {
      skipped.push({ matchId: match.id, reason: "team_not_found" });
      continue;
    }

    const discovered = await discoverPolymarketEvent(match, homeTeam, awayTeam, {
      fetchImpl,
      preferPowerShell: !options.fetchImpl && process.platform === "win32",
      fetchedAt,
      eventSlug: options.eventSlugByMatchId?.[match.id],
    });

    if (!discovered?.event) {
      skipped.push({
        matchId: match.id,
        reason: discovered?.reason ?? "event_not_found",
        tried: discovered?.tried ?? [],
      });
      matchPayloads.push({
        matchId: match.id,
        status: "not_found",
        retrievedAt: fetchedAt,
        moneyline: [],
        skippedReason: discovered?.reason ?? "event_not_found",
      });
      continue;
    }

    const derivativeEvent = await fetchDerivativeEvent(discovered.event, {
      fetchImpl,
      preferPowerShell: !options.fetchImpl && process.platform === "win32",
      fetchedAt,
    });
    const normalized = normalizeMatchEvent(discovered.event, match, homeTeam, awayTeam, { fetchedAt, derivativeEvent });
    matchPayloads.push(normalized);

    if (normalized.status !== "available") {
      skipped.push({
        matchId: match.id,
        eventSlug: normalized.eventSlug,
        reason: normalized.skippedReason ?? "moneyline_incomplete",
      });
    }
  }

  return {
    source: buildSource({ fetchedAt }),
    fetchedAt,
    matches: matchPayloads,
    skipped,
    probe: {
      requestedCount: selectedMatches.length,
      availableCount: matchPayloads.filter((match) => match.status === "available").length,
      skippedCount: skipped.length,
    },
  };
}

export function applyPolymarketMatchMarketsToStore(store, payload) {
  const nextStore = structuredClone(store);
  const matchesById = new Map(nextStore.matches.map((match) => [match.id, match]));
  const importedMatchIds = [];
  const skipped = [];

  for (const item of payload.matches ?? []) {
    const match = matchesById.get(item.matchId);
    if (!match) {
      skipped.push({ matchId: item.matchId, reason: "match_not_found" });
      continue;
    }

    match.marketOdds = {
      ...(match.marketOdds ?? {}),
      polymarket: buildStoredMarketOdds(item, payload),
    };

    if (item.status === "available") importedMatchIds.push(match.id);
    else skipped.push({ matchId: match.id, reason: item.skippedReason ?? item.status ?? "not_available" });
  }

  upsertById(nextStore.sources, {
    ...payload.source,
    lastSync: {
      fetchedAt: payload.fetchedAt,
      requestedCount: payload.probe?.requestedCount ?? payload.matches?.length ?? 0,
      importedCount: importedMatchIds.length,
      skippedCount: skipped.length,
      skipped,
      readOnly: true,
      tradingEnabled: false,
    },
  });

  return {
    store: nextStore,
    summary: {
      sourceId: payload.source?.id ?? SOURCE_ID,
      sourceUrl: payload.source?.url ?? "https://polymarket.com/sports/world-cup",
      fetchedAt: payload.fetchedAt,
      importedCount: importedMatchIds.length,
      importedMatchIds,
      skippedCount: skipped.length,
      skipped,
      readOnly: true,
      tradingEnabled: false,
    },
  };
}

export function readPolymarketMatchMarketsPayloadFromFile(path) {
  if (!path || !existsSync(path)) {
    const error = new Error(`Polymarket match-market payload not found: ${path ?? "missing path"}.`);
    error.code = "payload_not_found";
    throw error;
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function selectMatches(matches, options) {
  const ids = Array.isArray(options.matchIds) ? new Set(options.matchIds) : null;
  let selected = ids ? matches.filter((match) => ids.has(match.id)) : matches;

  const mode = options.mode ?? "all";
  if (mode === "upcoming") selected = selected.filter((match) => !hasFinalScore(match));
  if (mode === "completed") selected = selected.filter(hasFinalScore);
  if (mode !== "all" && mode !== "upcoming" && mode !== "completed") {
    const error = new Error(`Unsupported Polymarket match-market sync mode: ${mode}.`);
    error.code = "bad_request";
    throw error;
  }

  const limit = toNumber(options.limit);
  return limit ? selected.slice(0, limit) : selected;
}

async function discoverPolymarketEvent(match, homeTeam, awayTeam, context) {
  const tried = [];
  const directSlugs = [
    context.eventSlug,
    ...buildSlugCandidates(match, homeTeam, awayTeam),
  ].filter(Boolean);

  for (const slug of [...new Set(directSlugs)]) {
    tried.push({ type: "slug", value: slug });
    const event = await fetchEventBySlug(slug, context.fetchImpl, context.fetchedAt, context);
    if (event && eventMatchesTeams(event, homeTeam, awayTeam)) return { event, tried };
  }

  for (const query of buildSearchQueries(homeTeam, awayTeam)) {
    tried.push({ type: "search", value: query });
    const event = await findEventBySearch(query, match, homeTeam, awayTeam, context);
    if (event) return { event, tried };
  }

  return { event: null, reason: "event_not_found", tried };
}

async function fetchEventBySlug(slug, fetchImpl, fetchedAt, options = {}) {
  const url = `${POLYMARKET_GAMMA_BASE_URL}/events/slug/${encodeURIComponent(slug)}`;
  try {
    const raw = await fetchPolymarketJson(url, fetchImpl, options);
    return normalizeRawEvent(raw, { fetchedAt });
  } catch {
    return null;
  }
}

async function fetchDerivativeEvent(event, context) {
  if (!event?.slug) return null;
  return fetchEventBySlug(`${event.slug}-more-markets`, context.fetchImpl, context.fetchedAt, context);
}

async function findEventBySearch(query, match, homeTeam, awayTeam, context) {
  const url = new URL(`${POLYMARKET_GAMMA_BASE_URL}/public-search`);
  url.searchParams.set("q", query);
  const raw = await fetchPolymarketJson(url.toString(), context.fetchImpl, context);
  const candidates = Array.isArray(raw?.events)
    ? raw.events.map((event) => normalizeRawEvent(event, { fetchedAt: context.fetchedAt })).filter(Boolean)
    : [];

  return candidates
    .filter((event) => event.slug?.startsWith("fifwc-"))
    .filter((event) => eventMatchesTeams(event, homeTeam, awayTeam))
    .sort((a, b) => scoreEventCandidate(b, match) - scoreEventCandidate(a, match))[0] ?? null;
}

function normalizeMatchEvent(event, match, homeTeam, awayTeam, context) {
  const moneyline = normalizeMoneyline(event, match, homeTeam, awayTeam, context);
  const derivativeMarkets = context.derivativeEvent
    ? normalizeDerivativeMarkets(context.derivativeEvent, homeTeam, awayTeam)
    : [];
  const status = moneyline.length === 3 ? "available" : moneyline.length > 0 ? "partial" : "not_available";

  return {
    matchId: match.id,
    status,
    sourceId: SOURCE_ID,
    retrievedAt: context.fetchedAt,
    eventId: event.id,
    eventSlug: event.slug,
    eventTitle: event.title,
    sourceUrl: event.url,
    active: event.active,
    closed: event.closed,
    restricted: event.restricted,
    moneyline,
    derivativeEventSlug: context.derivativeEvent?.slug ?? null,
    derivativeMarkets,
    readOnly: true,
    tradingEnabled: false,
    skippedReason: status === "available" ? null : "moneyline_incomplete",
  };
}

function normalizeMoneyline(event, match, homeTeam, awayTeam, context) {
  return (event.markets ?? [])
    .map((market) => normalizeMoneylineMarket(market, match, homeTeam, awayTeam, context))
    .filter(Boolean)
    .sort((a, b) => moneylineSort(a.type) - moneylineSort(b.type));
}

function normalizeMoneylineMarket(market, match, homeTeam, awayTeam) {
  if (!market.active || market.closed) return null;
  const yes = market.outcomes.find((outcome) => normalizeComparable(outcome.outcome) === "yes");
  if (yes?.price == null) return null;

  const type = classifyMoneylineType(market, homeTeam, awayTeam);
  if (!type) return null;

  return {
    type,
    label: type === "home" ? homeTeam.name : type === "away" ? awayTeam.name : "平局",
    subject: market.subject,
    sourceId: SOURCE_ID,
    sourceUrl: `${POLYMARKET_EVENT_PAGE_BASE_URL}/${market.eventSlug}#${market.slug}`,
    retrievedAt: market.retrievedAt,
    marketId: market.id,
    marketSlug: market.slug,
    question: market.question,
    outcome: yes.outcome,
    price: yes.price,
    impliedProbabilityPercent: yes.impliedProbabilityPercent,
    decimalOdds: yes.decimalOdds,
    clobTokenId: yes.clobTokenId,
    bestBid: market.bestBid,
    bestAsk: market.bestAsk,
    spread: market.spread,
    lastTradePrice: market.lastTradePrice,
    volume: market.volume,
    volume24hr: market.volume24hr,
    liquidity: market.liquidity,
    active: market.active,
    closed: market.closed,
    readOnly: true,
    notes: "Single-match prediction-market price used as an external reference only.",
  };
}

function normalizeDerivativeMarkets(event, homeTeam, awayTeam) {
  return (event.markets ?? [])
    .flatMap((market) => normalizeDerivativeMarket(market, homeTeam, awayTeam))
    .filter(Boolean)
    .sort((a, b) => derivativeSort(a) - derivativeSort(b));
}

function normalizeDerivativeMarket(market, homeTeam, awayTeam) {
  if (!market.active || market.closed) return [];
  if (isHalfMarket(market)) return [];

  if (isSpreadMarket(market)) return normalizeSpreadMarket(market, homeTeam, awayTeam);
  if (isTeamTotalMarket(market)) return normalizeTeamTotalMarket(market, homeTeam, awayTeam);
  if (isTotalMarket(market)) return normalizeTotalMarket(market);
  if (isBttsMarket(market)) return normalizeBttsMarket(market);
  return [];
}

function normalizeSpreadMarket(market, homeTeam, awayTeam) {
  const title = market.groupItemTitle ?? market.question ?? "";
  const line = parseLine(title);
  const side = titleMatchesTeam(title, homeTeam) ? "home" : titleMatchesTeam(title, awayTeam) ? "away" : null;
  if (!line || !side) return [];

  return market.outcomes.map((outcome) => {
    const outcomeSide = titleMatchesTeam(outcome.outcome, homeTeam) ? "home" : titleMatchesTeam(outcome.outcome, awayTeam) ? "away" : null;
    if (!outcomeSide || outcome.price == null) return null;
    const handicap = outcomeSide === side ? line : -line;
    const team = outcomeSide === "home" ? homeTeam : awayTeam;

    return buildDerivativeRow(market, outcome, {
      type: "spread",
      side: outcomeSide,
      selection: "cover",
      line: handicap,
      label: `${team.name} ${formatHandicap(handicap)}`,
      key: `${outcomeSide}${formatHandicap(handicap)}`,
      notes: "Spread market outcome from Polymarket more-markets event.",
    });
  });
}

function normalizeTotalMarket(market) {
  const line = parseLine(market.groupItemTitle ?? market.question);
  if (!line) return [];

  return market.outcomes.map((outcome) => {
    const selection = normalizeComparable(outcome.outcome);
    if (!["over", "under"].includes(selection) || outcome.price == null) return null;
    return buildDerivativeRow(market, outcome, {
      type: "total",
      side: null,
      selection,
      line,
      label: `${selection === "over" ? "大" : "小"} ${line}`,
      key: `total-${selection}-${line}`,
      notes: "Full-match total goals market from Polymarket more-markets event.",
    });
  });
}

function normalizeTeamTotalMarket(market, homeTeam, awayTeam) {
  const slug = market.slug ?? "";
  const side = slug.includes("team-total-home")
    ? "home"
    : slug.includes("team-total-away")
      ? "away"
      : titleMatchesTeam(market.groupItemTitle, homeTeam)
        ? "home"
        : titleMatchesTeam(market.groupItemTitle, awayTeam)
          ? "away"
          : null;
  const line = parseLine(market.groupItemTitle ?? market.question);
  if (!side || !line) return [];

  const team = side === "home" ? homeTeam : awayTeam;
  return market.outcomes.map((outcome) => {
    const selection = normalizeComparable(outcome.outcome);
    if (!["over", "under"].includes(selection) || outcome.price == null) return null;
    return buildDerivativeRow(market, outcome, {
      type: "team-total",
      side,
      selection,
      line,
      label: `${team.name}进球${selection === "over" ? "大" : "小"} ${line}`,
      key: `${side}-${selection}-${line}`,
      notes: "Full-match team-total market from Polymarket more-markets event.",
    });
  });
}

function normalizeBttsMarket(market) {
  return market.outcomes.map((outcome) => {
    const selection = normalizeComparable(outcome.outcome);
    if (!["yes", "no"].includes(selection) || outcome.price == null) return null;
    return buildDerivativeRow(market, outcome, {
      type: "btts",
      side: null,
      selection,
      line: null,
      label: `双方进球 ${selection === "yes" ? "Yes" : "No"}`,
      key: `btts-${selection}`,
      notes: "Both-teams-to-score market from Polymarket more-markets event.",
    });
  });
}

function buildDerivativeRow(market, outcome, detail) {
  return {
    ...detail,
    sourceId: SOURCE_ID,
    sourceUrl: `${POLYMARKET_EVENT_PAGE_BASE_URL}/${market.eventSlug}#${market.slug}`,
    retrievedAt: market.retrievedAt,
    marketId: market.id,
    marketSlug: market.slug,
    question: market.question,
    outcome: outcome.outcome,
    price: outcome.price,
    impliedProbabilityPercent: outcome.impliedProbabilityPercent,
    decimalOdds: outcome.decimalOdds,
    clobTokenId: outcome.clobTokenId,
    bestBid: market.bestBid,
    bestAsk: market.bestAsk,
    spread: market.spread,
    lastTradePrice: market.lastTradePrice,
    volume: market.volume,
    volume24hr: market.volume24hr,
    liquidity: market.liquidity,
    active: market.active,
    closed: market.closed,
    readOnly: true,
  };
}

function classifyMoneylineType(market, homeTeam, awayTeam) {
  const subject = normalizeComparable(market.subject);
  const question = normalizeComparable(market.question);
  const title = normalizeComparable(market.groupItemTitle);

  if (subject.includes("draw") || title.includes("draw") || question.includes("end in a draw")) return "draw";
  if (teamAliases(homeTeam).some((alias) => subject === normalizeComparable(alias) || question.includes(`will ${normalizeComparable(alias)} win`))) return "home";
  if (teamAliases(awayTeam).some((alias) => subject === normalizeComparable(alias) || question.includes(`will ${normalizeComparable(alias)} win`))) return "away";
  return null;
}

function buildStoredMarketOdds(item, payload) {
  return {
    status: item.status,
    sourceId: item.sourceId ?? payload.source?.id ?? SOURCE_ID,
    retrievedAt: item.retrievedAt ?? payload.fetchedAt,
    eventId: item.eventId ?? null,
    eventSlug: item.eventSlug ?? null,
    eventTitle: item.eventTitle ?? null,
    sourceUrl: item.sourceUrl ?? null,
    active: item.active ?? null,
    closed: item.closed ?? null,
    restricted: item.restricted ?? null,
    moneyline: item.moneyline ?? [],
    derivativeEventSlug: item.derivativeEventSlug ?? null,
    derivativeMarkets: item.derivativeMarkets ?? [],
    aiAnalysis: item.aiAnalysis ?? null,
    readOnly: true,
    tradingEnabled: false,
    notes: "Polymarket single-match markets are external market references only, not official odds or betting advice.",
  };
}

function normalizeRawEvent(raw, context) {
  if (!raw?.id || !raw.slug) return null;
  const event = {
    id: String(raw.id),
    slug: String(raw.slug),
    title: raw.title ?? raw.ticker ?? raw.slug,
    url: `${POLYMARKET_EVENT_PAGE_BASE_URL}/${raw.slug}`,
    active: Boolean(raw.active),
    closed: Boolean(raw.closed),
    restricted: Boolean(raw.restricted),
    updatedAt: raw.updatedAt ?? null,
    retrievedAt: context.fetchedAt,
  };

  return {
    ...event,
    markets: Array.isArray(raw.markets)
      ? raw.markets.map((market) => normalizeRawMarket(market, event, context)).filter(Boolean)
      : [],
  };
}

function normalizeRawMarket(raw, event, context) {
  if (!raw?.id || !raw.slug) return null;
  const outcomes = parseArrayField(raw.outcomes);
  const outcomePrices = parseArrayField(raw.outcomePrices).map(toNumber);
  const clobTokenIds = parseArrayField(raw.clobTokenIds).map((value) => value == null ? null : String(value));

  return {
    id: String(raw.id),
    slug: String(raw.slug),
    eventSlug: event.slug,
    question: raw.question ?? raw.title ?? raw.slug,
    groupItemTitle: raw.groupItemTitle ?? null,
    subject: raw.groupItemTitle ?? null,
    active: Boolean(raw.active),
    closed: Boolean(raw.closed),
    acceptingOrders: Boolean(raw.acceptingOrders),
    retrievedAt: context.fetchedAt,
    outcomes: outcomes.map((outcome, index) => {
      const price = outcomePrices[index];
      return {
        outcome: String(outcome),
        price,
        impliedProbabilityPercent: price == null ? null : round(price * 100, 1),
        decimalOdds: price > 0 ? round(1 / price, 2) : null,
        clobTokenId: clobTokenIds[index] ?? null,
      };
    }),
    bestBid: toNumber(raw.bestBid),
    bestAsk: toNumber(raw.bestAsk),
    spread: toNumber(raw.spread),
    lastTradePrice: toNumber(raw.lastTradePrice),
    volume: toNumber(raw.volume ?? raw.volumeClob),
    volume24hr: toNumber(raw.volume24hr ?? raw.volume24hrClob),
    liquidity: toNumber(raw.liquidity ?? raw.liquidityClob),
  };
}

function buildSlugCandidates(match, homeTeam, awayTeam) {
  const homeCode = TEAM_EVENT_CODES.get(homeTeam.id);
  const awayCode = TEAM_EVENT_CODES.get(awayTeam.id);
  if (!homeCode || !awayCode) return [];

  return dateCandidates(match.date).flatMap((date) => [
    `fifwc-${homeCode}-${awayCode}-${date}`,
    `fifwc-${awayCode}-${homeCode}-${date}`,
  ]);
}

function isSpreadMarket(market) {
  return market.slug?.includes("-spread-") || normalizeComparable(market.question).startsWith("spread:");
}

function isTotalMarket(market) {
  const slug = market.slug ?? "";
  return slug.includes("-total-") && !slug.includes("team-total");
}

function isTeamTotalMarket(market) {
  return (market.slug ?? "").includes("team-total");
}

function isBttsMarket(market) {
  const slug = market.slug ?? "";
  return slug.endsWith("-btts") || normalizeComparable(market.groupItemTitle) === "both teams to score";
}

function isHalfMarket(market) {
  const value = normalizeComparable(`${market.slug} ${market.question} ${market.groupItemTitle}`);
  return value.includes("1st half") || value.includes("first half") || value.includes("2nd half") || value.includes("second half");
}

function parseLine(value) {
  const match = String(value ?? "").match(/([+-]?\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function titleMatchesTeam(value, team) {
  const normalized = normalizeComparable(value);
  return teamAliases(team).some((alias) => normalized.includes(normalizeComparable(alias)));
}

function formatHandicap(value) {
  return `${value > 0 ? "+" : ""}${Math.abs(value) % 1 === 0 ? value.toFixed(0) : value.toFixed(1)}`;
}

function derivativeSort(row) {
  const order = { spread: 1, total: 2, "team-total": 3, btts: 4 };
  const sideOrder = { home: 1, away: 2 };
  return (order[row.type] ?? 9) * 100 + (sideOrder[row.side] ?? 0) * 10 + Number(row.line ?? 0);
}

function dateCandidates(dateValue) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return [dateValue].filter(Boolean);
  return [-1, 0, 1].map((offset) => {
    const item = new Date(date);
    item.setUTCDate(item.getUTCDate() + offset);
    return item.toISOString().slice(0, 10);
  });
}

function buildSearchQueries(homeTeam, awayTeam) {
  const homeNames = teamAliases(homeTeam).slice(0, 3);
  const awayNames = teamAliases(awayTeam).slice(0, 3);
  const queries = [];

  for (const home of homeNames) {
    for (const away of awayNames) {
      queries.push(`${home} vs ${away}`);
      queries.push(`${away} vs ${home}`);
    }
  }

  return [...new Set(queries)];
}

function eventMatchesTeams(event, homeTeam, awayTeam) {
  const value = normalizeComparable(`${event.slug} ${event.title}`);
  return teamAliases(homeTeam).some((alias) => value.includes(normalizeComparable(alias))) &&
    teamAliases(awayTeam).some((alias) => value.includes(normalizeComparable(alias)));
}

function scoreEventCandidate(event, match) {
  let score = 0;
  if (event.slug?.startsWith("fifwc-")) score += 20;
  if (event.active && !event.closed) score += 10;
  for (const date of dateCandidates(match.date)) {
    if (event.slug?.includes(date)) score += date === match.date ? 8 : 4;
  }
  return score;
}

function teamAliases(team) {
  return [
    ...(TEAM_NAME_ALIASES.get(team.id) ?? []),
    slugToWords(team.slug ?? team.id),
    team.id,
  ].filter(Boolean);
}

function hasFinalScore(match) {
  return match?.score?.home != null && match?.score?.away != null;
}

async function fetchPolymarketJson(url, fetchImpl, options = {}) {
  if (options.preferPowerShell) {
    return fetchPolymarketJsonWithPowerShell(url);
  }

  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        "user-agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(12000),
    });
  } catch (error) {
    if (process.platform === "win32") {
      return fetchPolymarketJsonWithPowerShell(url);
    }
    throw error;
  }

  if (!response.ok) {
    const error = new Error(`Polymarket request failed with HTTP ${response.status}.`);
    error.status = response.status;
    error.code = "source_fetch_failed";
    throw error;
  }

  return response.json();
}

async function fetchPolymarketJsonWithPowerShell(url) {
  const script = `
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$headers = @{
  Accept = 'application/json'
  'User-Agent' = '${USER_AGENT}'
}
Invoke-RestMethod -Uri $env:POLYMARKET_SYNC_URL -Headers $headers -TimeoutSec 30 | ConvertTo-Json -Depth 100 -Compress
`;
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ], {
    env: {
      ...process.env,
      POLYMARKET_SYNC_URL: String(url),
    },
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 50,
  });

  return JSON.parse(stdout);
}

function buildSource({ fetchedAt }) {
  return {
    id: SOURCE_ID,
    name: "Polymarket World Cup single-match markets",
    url: "https://polymarket.com/sports/world-cup",
    apiUrl: `${POLYMARKET_GAMMA_BASE_URL}/events/slug/{slug}`,
    retrievedAt: fetchedAt,
    tier: 3,
    access: "public_read_only",
    notes: "Read-only single-match prediction-market prices used as external market references. No wallet, account, order, or trading API is used.",
    compliance: {
      readOnly: true,
      tradingEnabled: false,
      walletRequired: false,
      modelInput: false,
    },
  };
}

function upsertById(rows, row) {
  const index = rows.findIndex((item) => item.id === row.id);
  if (index >= 0) rows[index] = row;
  else rows.push(row);
}

function moneylineSort(type) {
  return type === "home" ? 0 : type === "draw" ? 1 : 2;
}

function parseArrayField(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeComparable(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\band\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugToWords(value) {
  return String(value ?? "").replace(/-/g, " ");
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 1) {
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}
