import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const POLYMARKET_GAMMA_BASE_URL = "https://gamma-api.polymarket.com";
const POLYMARKET_EVENT_PAGE_BASE_URL = "https://polymarket.com/event";
const POLYMARKET_SOURCE_ID = "polymarket-world-cup-markets";
const DEFAULT_EVENT_SLUGS = ["world-cup-winner"];

const TEAM_ALIAS_OVERRIDES = new Map([
  ["usa", ["united states", "usmnt", "united states of america"]],
  ["south-korea", ["korea republic", "republic of korea"]],
  ["czech-republic", ["czechia"]],
  ["ivory-coast", ["cote d ivoire", "cote divoire"]],
  ["cape-verde", ["cabo verde"]],
  ["cabo-verde", ["cape verde"]],
  ["curacao", ["curacao", "curaçao", "curaao"]],
  ["congo-dr", ["dr congo", "d r congo", "democratic republic of congo", "congo dr"]],
  ["dr-congo", ["dr congo", "d r congo", "democratic republic of congo", "congo dr"]],
  ["turkiye", ["turkey"]],
  ["saudi-arabia", ["ksa"]],
  ["new-zealand", ["new zealand"]],
  ["bosnia-and-herzegovina", ["bosnia herzegovina", "bosnia"]],
]);

export async function fetchPolymarketWorldCupMarketsPayload(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const fetchedAt = options.fetchedAt ?? new Date().toISOString();
  const eventSlugs = normalizeStringList(options.eventSlugs ?? DEFAULT_EVENT_SLUGS);
  const events = [];

  for (const slug of eventSlugs) {
    const url = `${POLYMARKET_GAMMA_BASE_URL}/events/slug/${encodeURIComponent(slug)}`;
    const raw = await fetchPolymarketJson(url, fetchImpl, { allowWindowsFallback: !options.fetchImpl });
    const event = normalizePolymarketEvent(raw, { fetchedAt });
    if (event) events.push(event);
  }

  const markets = events.flatMap((event) => event.markets);
  return {
    source: buildPolymarketSource({ fetchedAt, eventSlugs, events }),
    fetchedAt,
    events,
    markets,
  };
}

export async function fetchPolymarketSearchPayload(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const fetchedAt = options.fetchedAt ?? new Date().toISOString();
  const query = options.query ?? "World Cup 2026";
  const url = new URL(`${POLYMARKET_GAMMA_BASE_URL}/public-search`);
  url.searchParams.set("q", query);
  const raw = await fetchPolymarketJson(url, fetchImpl, { allowWindowsFallback: !options.fetchImpl });
  const events = Array.isArray(raw?.events)
    ? raw.events.map((event) => normalizePolymarketEvent(event, { fetchedAt })).filter(Boolean)
    : [];
  const filteredEvents = events.filter(isWorldCupEvent);
  const markets = filteredEvents.flatMap((event) => event.markets).filter(isWorldCupMarket);

  return {
    query,
    sourceUrl: url.toString(),
    fetchedAt,
    rawEventCount: Array.isArray(raw?.events) ? raw.events.length : 0,
    eventCount: filteredEvents.length,
    marketCount: markets.length,
    events: filteredEvents,
    markets,
    pagination: raw?.pagination ?? null,
  };
}

export function applyPolymarketWorldCupMarketsToStore(store, payload) {
  const nextStore = structuredClone(store);
  const mapping = buildPolymarketTeamMarketMappings(nextStore.teams, payload.markets ?? [], {
    sourceId: payload.source.id,
    fetchedAt: payload.fetchedAt,
  });

  clearPolymarketWinnerSignals(nextStore.teams);

  for (const item of mapping.mapped) {
    const team = nextStore.teams.find((candidate) => candidate.id === item.teamId);
    if (!team) continue;
    team.profile = {
      ...(team.profile ?? {}),
      marketSignals: {
        ...(team.profile?.marketSignals ?? {}),
        polymarket: {
          ...(team.profile?.marketSignals?.polymarket ?? {}),
          worldCupWinner: item.signal,
        },
      },
    };
  }

  upsertById(nextStore.sources, {
    ...payload.source,
    lastSync: {
      fetchedAt: payload.fetchedAt,
      eventCount: payload.events?.length ?? 0,
      marketCount: payload.markets?.length ?? 0,
      importedCount: mapping.mapped.length,
      skippedCount: mapping.skipped.length,
      skipped: mapping.skipped,
      readOnly: true,
      tradingEnabled: false,
    },
  });

  return {
    store: nextStore,
    summary: {
      sourceId: payload.source.id,
      sourceUrl: payload.source.url,
      fetchedAt: payload.fetchedAt,
      eventCount: payload.events?.length ?? 0,
      marketCount: payload.markets?.length ?? 0,
      importedCount: mapping.mapped.length,
      importedTeamIds: mapping.mapped.map((item) => item.teamId),
      skippedCount: mapping.skipped.length,
      skipped: mapping.skipped,
      readOnly: true,
      tradingEnabled: false,
    },
  };
}

export function buildPolymarketTeamMarketMappings(teams, markets, context = {}) {
  const teamIndex = buildTeamIndex(teams);
  const mapped = [];
  const skipped = [];

  for (const market of markets ?? []) {
    if (market.marketType !== "world_cup_winner") {
      skipped.push({ marketId: market.id, slug: market.slug, reason: "unsupported_market_type" });
      continue;
    }
    if (!market.active || market.closed) {
      skipped.push({ marketId: market.id, slug: market.slug, subject: market.subject, reason: "inactive_or_closed" });
      continue;
    }
    if (isPlaceholderTeamName(market.subject)) {
      skipped.push({ marketId: market.id, slug: market.slug, subject: market.subject, reason: "placeholder_team" });
      continue;
    }
    if (market.yesPrice == null) {
      skipped.push({ marketId: market.id, slug: market.slug, subject: market.subject, reason: "missing_yes_price" });
      continue;
    }

    const teamMatch = findTeamMatchForMarket(teamIndex, market);
    if (!teamMatch) {
      skipped.push({ marketId: market.id, slug: market.slug, subject: market.subject, reason: "team_not_mapped" });
      continue;
    }

    mapped.push({
      teamId: teamMatch.teamId,
      marketId: market.id,
      signal: {
        sourceId: context.sourceId ?? POLYMARKET_SOURCE_ID,
        sourceUrl: market.url,
        retrievedAt: context.fetchedAt ?? market.retrievedAt,
        marketType: market.marketType,
        marketId: market.id,
        marketSlug: market.slug,
        eventSlug: market.eventSlug,
        title: market.question,
        subject: teamMatch.subject ?? market.subject,
        price: market.yesPrice,
        impliedProbabilityPercent: market.impliedProbabilityPercent,
        decimalOdds: market.decimalOdds,
        bestBid: market.bestBid,
        bestAsk: market.bestAsk,
        spread: market.spread,
        lastTradePrice: market.lastTradePrice,
        volume: market.volume,
        volume24hr: market.volume24hr,
        liquidity: market.liquidity,
        active: market.active,
        closed: market.closed,
        restricted: market.restricted,
        readOnly: true,
        notes: "Prediction-market price used as an external market-implied probability reference only.",
      },
    });
  }

  return { mapped, skipped };
}

export function normalizePolymarketEvent(raw, context = {}) {
  if (!raw?.id || !raw.slug) return null;
  const event = {
    id: String(raw.id),
    slug: String(raw.slug),
    title: raw.title ?? raw.ticker ?? raw.slug,
    description: raw.description ?? null,
    url: `${POLYMARKET_EVENT_PAGE_BASE_URL}/${raw.slug}`,
    active: Boolean(raw.active),
    closed: Boolean(raw.closed),
    restricted: Boolean(raw.restricted),
    volume: toNumber(raw.volume),
    volume24hr: toNumber(raw.volume24hr),
    liquidity: toNumber(raw.liquidity ?? raw.liquidityClob),
    openInterest: toNumber(raw.openInterest),
    updatedAt: raw.updatedAt ?? null,
    fetchedAt: context.fetchedAt,
  };

  return {
    ...event,
    markets: Array.isArray(raw.markets)
      ? raw.markets.map((market) => normalizePolymarketMarket(market, event, context)).filter(Boolean)
      : [],
  };
}

export function normalizePolymarketMarket(raw, event = {}, context = {}) {
  if (!raw?.id || !raw.slug) return null;
  const outcomes = parseArrayField(raw.outcomes);
  const outcomePrices = parseArrayField(raw.outcomePrices).map(toNumber);
  const clobTokenIds = parseArrayField(raw.clobTokenIds).map((value) => value == null ? null : String(value));
  const outcomeMetrics = outcomes.map((outcome, index) => {
    const price = outcomePrices[index];
    return {
      outcome: String(outcome),
      price,
      impliedProbabilityPercent: price == null ? null : round(price * 100, 1),
      decimalOdds: price > 0 ? round(1 / price, 2) : null,
      clobTokenId: clobTokenIds[index] ?? null,
    };
  });
  const yesOutcome = outcomeMetrics.find((item) => normalizeComparable(item.outcome) === "yes");
  const yesPrice = yesOutcome?.price ?? null;

  return {
    id: String(raw.id),
    conditionId: raw.conditionId ?? null,
    questionId: raw.questionID ?? raw.questionId ?? null,
    slug: String(raw.slug),
    eventSlug: event.slug ?? null,
    question: raw.question ?? raw.title ?? raw.slug,
    subject: extractMarketSubject(raw),
    marketType: classifyMarket(raw, event),
    url: `${POLYMARKET_EVENT_PAGE_BASE_URL}/${event.slug ?? "world-cup-winner"}#${raw.slug}`,
    active: Boolean(raw.active),
    closed: Boolean(raw.closed),
    restricted: Boolean(raw.restricted ?? event.restricted),
    acceptingOrders: Boolean(raw.acceptingOrders),
    endDate: raw.endDate ?? null,
    updatedAt: raw.updatedAt ?? null,
    retrievedAt: context.fetchedAt,
    outcomes: outcomeMetrics,
    yesPrice,
    impliedProbabilityPercent: yesPrice == null ? null : round(yesPrice * 100, 1),
    decimalOdds: yesPrice > 0 ? round(1 / yesPrice, 2) : null,
    bestBid: toNumber(raw.bestBid),
    bestAsk: toNumber(raw.bestAsk),
    spread: toNumber(raw.spread),
    lastTradePrice: toNumber(raw.lastTradePrice),
    volume: toNumber(raw.volume ?? raw.volumeClob),
    volume24hr: toNumber(raw.volume24hr ?? raw.volume24hrClob),
    liquidity: toNumber(raw.liquidity ?? raw.liquidityClob),
    clobTokenIds,
  };
}

function buildPolymarketSource({ fetchedAt, eventSlugs, events }) {
  return {
    id: POLYMARKET_SOURCE_ID,
    name: "Polymarket World Cup prediction markets",
    url: "https://polymarket.com/sports/world-cup/props",
    apiUrl: `${POLYMARKET_GAMMA_BASE_URL}/events/slug/{slug}`,
    eventUrls: eventSlugs.map((slug) => `${POLYMARKET_EVENT_PAGE_BASE_URL}/${slug}`),
    retrievedAt: fetchedAt,
    tier: 3,
    access: "public_read_only",
    notes: "Read-only prediction-market prices used as external market-implied probability references. No wallet, account, order, or trading API is used.",
    compliance: {
      readOnly: true,
      tradingEnabled: false,
      walletRequired: false,
      modelInput: false,
    },
    eventCount: events.length,
  };
}

async function fetchPolymarketJson(url, fetchImpl, options = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        "user-agent": "world-cup-prediction-polymarket-sync/0.1",
      },
    });
  } catch (error) {
    if (options.allowWindowsFallback && process.platform === "win32") {
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
  'User-Agent' = 'world-cup-prediction-polymarket-sync/0.1'
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

  try {
    return JSON.parse(stdout);
  } catch (error) {
    error.code = "source_shape_changed";
    throw error;
  }
}

function classifyMarket(raw, event) {
  const haystack = normalizeText(`${event.slug ?? ""} ${event.title ?? ""} ${raw.slug ?? ""} ${raw.question ?? ""}`);
  if (haystack.includes("world cup winner") || /will .+ win the 2026 fifa world cup/.test(haystack)) {
    return "world_cup_winner";
  }
  return "world_cup_related";
}

function extractMarketSubject(raw) {
  const groupTitle = stringOrNull(raw.groupItemTitle);
  if (groupTitle && !isPlaceholderTeamName(groupTitle)) return groupTitle.trim();

  const question = stringOrNull(raw.question);
  const winMatch = question?.match(/^Will\s+(.+?)\s+win\s+the\s+2026\s+FIFA\s+World\s+Cup\??$/i);
  if (winMatch) return winMatch[1].trim();
  return groupTitle ?? null;
}

function isWorldCupEvent(event) {
  const value = normalizeText(`${event.slug} ${event.title} ${event.description ?? ""}`);
  return value.includes("world cup") || value.includes("fifa world cup");
}

function isWorldCupMarket(market) {
  const value = normalizeText(`${market.slug} ${market.question} ${market.subject ?? ""}`);
  return value.includes("world cup") || value.includes("fifa world cup");
}

function clearPolymarketWinnerSignals(teams) {
  for (const team of teams) {
    const polymarket = team.profile?.marketSignals?.polymarket;
    if (!polymarket?.worldCupWinner) continue;
    const nextPolymarket = { ...polymarket };
    delete nextPolymarket.worldCupWinner;
    team.profile.marketSignals.polymarket = nextPolymarket;
    cleanEmptyMarketSignalObjects(team);
  }
}

function cleanEmptyMarketSignalObjects(team) {
  if (team.profile?.marketSignals?.polymarket && Object.keys(team.profile.marketSignals.polymarket).length === 0) {
    delete team.profile.marketSignals.polymarket;
  }
  if (team.profile?.marketSignals && Object.keys(team.profile.marketSignals).length === 0) {
    delete team.profile.marketSignals;
  }
}

function buildTeamIndex(teams) {
  const index = new Map();
  for (const team of teams ?? []) {
    const aliases = [
      team.id,
      team.slug,
      team.name,
      team.fifaCode,
      slugToWords(team.id),
      slugToWords(team.slug),
      ...(TEAM_ALIAS_OVERRIDES.get(team.id) ?? []),
      ...(TEAM_ALIAS_OVERRIDES.get(team.slug) ?? []),
    ].filter(Boolean);
    for (const alias of aliases) {
      index.set(normalizeComparable(alias), team.id);
    }
  }
  return index;
}

function findTeamMatchForMarket(teamIndex, market) {
  const subjects = [market.subject, extractSubjectFromWinnerSlug(market.slug)].filter(Boolean);
  for (const subject of subjects) {
    const teamId = teamIndex.get(normalizeComparable(subject));
    if (teamId) return { teamId, subject };
  }
  return null;
}

function extractSubjectFromWinnerSlug(slug) {
  const match = String(slug ?? "").match(/^will-(.+?)-win-the-2026-fifa-world-cup/i);
  if (!match) return null;
  return match[1].replace(/-/g, " ");
}

function isPlaceholderTeamName(value) {
  return /^team\s+[a-z]{1,3}$/i.test(String(value ?? "").trim());
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

function normalizeStringList(value) {
  return (Array.isArray(value) ? value : [value])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeComparable(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "");
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function slugToWords(value) {
  return String(value ?? "").replace(/-/g, " ");
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function upsertById(items, item) {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) {
    items[index] = { ...items[index], ...item };
    return;
  }
  items.push(item);
}
