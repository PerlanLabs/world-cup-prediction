const POLYMARKET_DATA_API_BASE_URL = "https://data-api.polymarket.com";
const SOURCE_ID = "polymarket-public-wallet-monitor";
const USER_AGENT = "world-cup-prediction-polymarket-public-wallet-monitor/0.1";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_SCENARIO_MAX_GOALS = 6;

export async function fetchPolymarketAccountSnapshot({
  store,
  address,
  fetchImpl = fetch,
  limit = DEFAULT_LIMIT,
  scenarioMaxGoals = DEFAULT_SCENARIO_MAX_GOALS,
  fetchedAt = new Date().toISOString(),
} = {}) {
  const normalizedAddress = normalizePolymarketAddress(address);
  const safeLimit = clampInteger(limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
  const safeScenarioMaxGoals = clampInteger(scenarioMaxGoals, 3, 9, DEFAULT_SCENARIO_MAX_GOALS);
  const tokenIndex = buildPolymarketTokenIndex(store);

  const [positionsResult, closedPositionsResult, activityResult, tradesResult, valueResult] = await Promise.all([
    fetchDataApiJson(fetchImpl, "/positions", { user: normalizedAddress, limit: safeLimit }),
    fetchDataApiJson(fetchImpl, "/closed-positions", { user: normalizedAddress, limit: safeLimit }),
    fetchDataApiJson(fetchImpl, "/activity", { user: normalizedAddress, limit: safeLimit }),
    fetchDataApiJson(fetchImpl, "/trades", { user: normalizedAddress, limit: safeLimit }),
    fetchDataApiJson(fetchImpl, "/value", { user: normalizedAddress }),
  ]);

  const positions = unwrapArray(positionsResult.data)
    .map((position) => normalizePolymarketAccountPosition(position, tokenIndex))
    .filter(Boolean);
  const closedPositions = unwrapArray(closedPositionsResult.data)
    .map((position) => normalizePolymarketAccountPosition(position, tokenIndex))
    .filter(Boolean);
  const activity = unwrapArray(activityResult.data).map(normalizePolymarketActivity).filter(Boolean);
  const trades = unwrapArray(tradesResult.data).map(normalizePolymarketActivity).filter(Boolean);
  const groups = buildWorldCupPositionGroups({
    positions,
    tokenIndex,
    scenarioMaxGoals: safeScenarioMaxGoals,
  });
  const matchedWorldCupPositions = positions.filter((position) => position.match);
  const openTotals = buildPositionTotals(positions);
  const worldCupTotals = buildPositionTotals(matchedWorldCupPositions);
  const value = normalizeAccountValue(valueResult.data, openTotals.currentValue);

  return {
    source: {
      id: SOURCE_ID,
      name: "Polymarket public wallet data API",
      url: POLYMARKET_DATA_API_BASE_URL,
      retrievedAt: fetchedAt,
      readOnly: true,
      tradingEnabled: false,
      notes: "Uses public wallet-address endpoints only. No wallet connection, private key, signing, order, or trading API is used.",
    },
    account: {
      address: normalizedAddress,
    },
    permissions: {
      readOnly: true,
      requiresPrivateKey: false,
      requiresWalletSignature: false,
      canTrade: false,
      canWithdraw: false,
    },
    dataSources: {
      positions: summarizeFetchResult(positionsResult),
      closedPositions: summarizeFetchResult(closedPositionsResult),
      activity: summarizeFetchResult(activityResult),
      trades: summarizeFetchResult(tradesResult),
      value: summarizeFetchResult(valueResult),
    },
    totals: {
      openPositionCount: positions.length,
      matchedWorldCupPositionCount: matchedWorldCupPositions.length,
      unmatchedOpenPositionCount: positions.length - matchedWorldCupPositions.length,
      openCost: roundMoney(openTotals.cost),
      openCurrentValue: roundMoney(value.currentValue ?? openTotals.currentValue),
      openPnl: roundMoney(value.pnl ?? openTotals.pnl),
      worldCupCost: roundMoney(worldCupTotals.cost),
      worldCupCurrentValue: roundMoney(worldCupTotals.currentValue),
      worldCupPnl: roundMoney(worldCupTotals.pnl),
    },
    value,
    positions,
    closedPositions,
    activity,
    trades,
    worldCup: {
      groups,
      scenarioMaxGoals: safeScenarioMaxGoals,
    },
  };
}

export function normalizePolymarketAddress(address) {
  const normalized = String(address ?? "").trim().toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(normalized)) {
    const error = new Error("A valid EVM wallet address is required.");
    error.status = 400;
    error.code = "invalid_polymarket_address";
    throw error;
  }
  return normalized;
}

export function buildPolymarketTokenIndex(store = {}) {
  const teamsById = new Map((store.teams ?? []).map((team) => [team.id, team]));
  const index = new Map();

  for (const match of store.matches ?? []) {
    const homeTeam = teamsById.get(match.homeTeamId) ?? null;
    const awayTeam = teamsById.get(match.awayTeamId) ?? null;
    const matchSummary = {
      id: match.id,
      date: match.date,
      dateLabel: match.dateLabel,
      kickoffLocal: match.kickoffLocal,
      kickoffSort: match.kickoffSort,
      competition: match.competition,
      group: match.group,
      stage: match.stage,
      status: match.status,
      score: match.score ?? null,
      result: match.result ?? null,
      home: simplifyTeam(homeTeam, match.homeTeamId),
      away: simplifyTeam(awayTeam, match.awayTeamId),
    };
    const polymarket = match.marketOdds?.polymarket;
    if (!polymarket) continue;

    for (const row of polymarket.moneyline ?? []) {
      addToken(index, row?.clobTokenId, {
        sourceId: row.sourceId,
        match: matchSummary,
        matchId: match.id,
        marketFamily: "moneyline",
        marketType: "moneyline",
        side: row.type,
        selection: row.type,
        line: null,
        label: row.label ?? row.question ?? row.marketSlug,
        outcome: row.outcome,
        price: toNumber(row.price),
        impliedProbabilityPercent: toNumber(row.impliedProbabilityPercent),
        marketId: row.marketId,
        marketSlug: row.marketSlug,
        question: row.question,
        sourceUrl: row.sourceUrl,
      });
    }

    for (const row of polymarket.derivativeMarkets ?? []) {
      addToken(index, row?.clobTokenId, {
        sourceId: row.sourceId,
        match: matchSummary,
        matchId: match.id,
        marketFamily: "derivative",
        marketType: row.type,
        side: row.side ?? null,
        selection: row.selection ?? null,
        line: toNumber(row.line),
        key: row.key,
        label: row.label ?? row.question ?? row.marketSlug,
        outcome: row.outcome,
        price: toNumber(row.price),
        impliedProbabilityPercent: toNumber(row.impliedProbabilityPercent),
        marketId: row.marketId,
        marketSlug: row.marketSlug,
        question: row.question,
        sourceUrl: row.sourceUrl,
      });
    }
  }

  return index;
}

export function normalizePolymarketAccountPosition(position = {}, tokenIndex = new Map()) {
  const tokenId = firstString(
    position.asset,
    position.tokenId,
    position.token_id,
    position.clobTokenId,
    position.clob_token_id,
    position.outcomeTokenId,
  );
  const market = tokenId ? tokenIndex.get(tokenId) ?? null : null;
  const shares = firstNumber(position.size, position.shares, position.quantity, position.balance, position.position);
  const avgPrice = normalizePrice(firstNumber(position.avgPrice, position.averagePrice, position.average_price, position.entryPrice));
  const currentPrice = normalizePrice(firstNumber(position.curPrice, position.currentPrice, position.price, position.endPrice, position.lastTradePrice));
  const cost = firstNumber(
    position.initialValue,
    position.cost,
    position.totalBought,
    position.invested,
    shares != null && avgPrice != null ? shares * avgPrice : null,
  );
  const currentValue = firstNumber(
    position.currentValue,
    position.value,
    position.marketValue,
    shares != null && currentPrice != null ? shares * currentPrice : null,
  );
  const pnl = firstNumber(position.cashPnl, position.pnl, position.profit, position.realizedPnl, currentValue != null && cost != null ? currentValue - cost : null);
  const percentPnl = firstNumber(position.percentPnl, position.percentReturn, cost ? (pnl / cost) * 100 : null);

  return {
    tokenId,
    conditionId: firstString(position.conditionId, position.condition_id),
    marketId: firstString(position.marketId, position.market),
    marketSlug: firstString(position.marketSlug, position.market_slug, market?.marketSlug),
    eventSlug: firstString(position.eventSlug, position.event_slug),
    title: firstString(position.title, position.question, position.marketTitle, position.eventTitle, market?.question, market?.label),
    outcome: firstString(position.outcome, position.outcomeTitle, position.side, market?.outcome),
    label: market?.label ?? firstString(position.title, position.question, position.outcome),
    shares: roundMoney(shares),
    avgPrice,
    currentPrice,
    cost: roundMoney(cost),
    currentValue: roundMoney(currentValue),
    pnl: roundMoney(pnl),
    percentPnl: percentPnl == null ? null : roundNumber(percentPnl, 2),
    redeemable: Boolean(position.redeemable),
    negativeRisk: Boolean(position.negativeRisk),
    match: market?.match ?? null,
    market: market ? omitMatch(market) : null,
  };
}

export function buildWorldCupPositionGroups({ positions = [], scenarioMaxGoals = DEFAULT_SCENARIO_MAX_GOALS } = {}) {
  const grouped = new Map();
  for (const position of positions) {
    if (!position.match || !position.market) continue;
    const current = grouped.get(position.match.id) ?? {
      match: position.match,
      positions: [],
      totals: { cost: 0, currentValue: 0, pnl: 0 },
      settlement: null,
      scenarioGrid: [],
      bestScenarios: [],
      worstScenarios: [],
    };
    current.positions.push(position);
    current.totals.cost += toNumber(position.cost) ?? 0;
    current.totals.currentValue += toNumber(position.currentValue) ?? 0;
    current.totals.pnl += toNumber(position.pnl) ?? 0;
    grouped.set(position.match.id, current);
  }

  return [...grouped.values()].map((group) => {
    const scenarioGrid = buildScenarioGrid(group, scenarioMaxGoals);
    const settlement = buildSettlementScenario(group);
    const sortedAscending = [...scenarioGrid].sort((a, b) => a.netPnl - b.netPnl);
    const sortedDescending = [...scenarioGrid].sort((a, b) => b.netPnl - a.netPnl);
    return {
      ...group,
      totals: {
        cost: roundMoney(group.totals.cost),
        currentValue: roundMoney(group.totals.currentValue),
        pnl: roundMoney(group.totals.pnl),
      },
      settlement,
      scenarioGrid,
      bestScenarios: sortedDescending.slice(0, 6),
      worstScenarios: sortedAscending.slice(0, 6),
    };
  }).sort((a, b) => String(a.match.kickoffLocal ?? a.match.date ?? "").localeCompare(String(b.match.kickoffLocal ?? b.match.date ?? "")));
}

export function calculateSoccerPositionScenario(position, homeGoals, awayGoals) {
  const market = position.market;
  if (!market) return null;
  const wins = doesMarketWin(market, homeGoals, awayGoals);
  const shares = toNumber(position.shares) ?? 0;
  const cost = toNumber(position.cost) ?? 0;
  const payout = wins ? shares : 0;
  return {
    tokenId: position.tokenId,
    label: position.label,
    wins,
    payout: roundMoney(payout),
    netPnl: roundMoney(payout - cost),
  };
}

async function fetchDataApiJson(fetchImpl, pathname, params = {}) {
  const url = new URL(pathname, POLYMARKET_DATA_API_BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  }

  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      return {
        ok: false,
        endpoint: pathname,
        status: response.status,
        error: response.statusText || "Polymarket Data API request failed.",
        data,
      };
    }
    return { ok: true, endpoint: pathname, status: response.status, data };
  } catch (error) {
    return {
      ok: false,
      endpoint: pathname,
      status: null,
      error: error.message,
      data: null,
    };
  }
}

function buildScenarioGrid(group, maxGoals) {
  const scenarios = [];
  for (let homeGoals = 0; homeGoals <= maxGoals; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= maxGoals; awayGoals += 1) {
      scenarios.push(buildScenario(group, homeGoals, awayGoals));
    }
  }
  return scenarios;
}

function buildSettlementScenario(group) {
  const homeGoals = firstNumber(group.match.score?.home, group.match.result?.homeGoals, group.match.result?.home);
  const awayGoals = firstNumber(group.match.score?.away, group.match.result?.awayGoals, group.match.result?.away);
  if (homeGoals == null || awayGoals == null) return null;
  return buildScenario(group, homeGoals, awayGoals);
}

function buildScenario(group, homeGoals, awayGoals) {
  const legs = group.positions.map((position) => calculateSoccerPositionScenario(position, homeGoals, awayGoals)).filter(Boolean);
  const payout = legs.reduce((sum, leg) => sum + (toNumber(leg.payout) ?? 0), 0);
  const cost = group.positions.reduce((sum, position) => sum + (toNumber(position.cost) ?? 0), 0);
  return {
    score: `${homeGoals}-${awayGoals}`,
    homeGoals,
    awayGoals,
    payout: roundMoney(payout),
    cost: roundMoney(cost),
    netPnl: roundMoney(payout - cost),
    winningCount: legs.filter((leg) => leg.wins).length,
    losingCount: legs.filter((leg) => !leg.wins).length,
    winningPositions: legs.filter((leg) => leg.wins).map((leg) => leg.label),
  };
}

function doesMarketWin(market, homeGoals, awayGoals) {
  switch (market.marketType) {
    case "moneyline":
      if (market.side === "home") return homeGoals > awayGoals;
      if (market.side === "away") return awayGoals > homeGoals;
      if (market.side === "draw") return homeGoals === awayGoals;
      return false;
    case "spread": {
      const line = toNumber(market.line);
      if (line == null) return false;
      if (market.side === "home") return homeGoals + line > awayGoals;
      if (market.side === "away") return awayGoals + line > homeGoals;
      return false;
    }
    case "total": {
      const totalGoals = homeGoals + awayGoals;
      const line = toNumber(market.line);
      if (line == null) return false;
      if (market.selection === "over") return totalGoals > line;
      if (market.selection === "under") return totalGoals < line;
      return false;
    }
    case "team-total": {
      const goals = market.side === "home" ? homeGoals : market.side === "away" ? awayGoals : null;
      const line = toNumber(market.line);
      if (goals == null || line == null) return false;
      if (market.selection === "over") return goals > line;
      if (market.selection === "under") return goals < line;
      return false;
    }
    case "btts": {
      const bothScore = homeGoals > 0 && awayGoals > 0;
      if (market.selection === "yes") return bothScore;
      if (market.selection === "no") return !bothScore;
      return false;
    }
    default:
      return false;
  }
}

function buildPositionTotals(positions) {
  const cost = positions.reduce((sum, position) => sum + (toNumber(position.cost) ?? 0), 0);
  const currentValue = positions.reduce((sum, position) => sum + (toNumber(position.currentValue) ?? 0), 0);
  const pnl = positions.reduce((sum, position) => sum + (toNumber(position.pnl) ?? 0), 0);
  return { cost, currentValue, pnl };
}

function normalizeAccountValue(valuePayload, fallbackCurrentValue) {
  const payload = Array.isArray(valuePayload) ? valuePayload[0] : valuePayload;
  const currentValue = firstNumber(
    payload?.value,
    payload?.currentValue,
    payload?.portfolioValue,
    payload?.totalValue,
    fallbackCurrentValue,
  );
  const pnl = firstNumber(payload?.pnl, payload?.profit, payload?.cashPnl);
  return {
    currentValue: currentValue == null ? null : roundMoney(currentValue),
    pnl: pnl == null ? null : roundMoney(pnl),
    rawAvailable: Boolean(payload),
  };
}

function normalizePolymarketActivity(item = {}) {
  const timestamp = firstString(item.timestamp, item.createdAt, item.created_at, item.time, item.date);
  const price = normalizePrice(firstNumber(item.price, item.avgPrice, item.averagePrice));
  return {
    id: firstString(item.id, item.transactionHash, item.transaction_hash, item.txHash),
    timestamp,
    type: firstString(item.type, item.activityType, item.action, item.side),
    side: firstString(item.side, item.outcome),
    title: firstString(item.title, item.question, item.marketTitle, item.eventTitle),
    slug: firstString(item.slug, item.marketSlug, item.eventSlug),
    price,
    shares: roundMoney(firstNumber(item.shares, item.size, item.amount, item.quantity)),
    value: roundMoney(firstNumber(item.value, item.usdcSize, item.usdcAmount, item.cashAmount)),
  };
}

function summarizeFetchResult(result) {
  return {
    ok: Boolean(result.ok),
    endpoint: result.endpoint,
    status: result.status,
    error: result.ok ? null : result.error,
    count: unwrapArray(result.data).length,
  };
}

function addToken(index, tokenId, value) {
  if (!tokenId) return;
  index.set(String(tokenId), value);
}

function simplifyTeam(team, fallbackId) {
  if (!team) return { id: fallbackId, name: fallbackId, flagCode: null };
  return {
    id: team.id,
    slug: team.slug,
    name: team.name,
    flagCode: team.flagCode,
  };
}

function omitMatch(market) {
  const { match, ...rest } = market;
  return rest;
}

function unwrapArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["data", "positions", "closedPositions", "activity", "trades", "results", "items"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function firstString(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = toNumber(value);
    if (number != null) return number;
  }
  return null;
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizePrice(value) {
  const number = toNumber(value);
  if (number == null) return null;
  if (number > 1 && number <= 100) return roundNumber(number / 100, 4);
  return roundNumber(number, 4);
}

function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function roundMoney(value) {
  const number = toNumber(value);
  if (number == null) return null;
  return roundNumber(number, 2);
}

function roundNumber(value, digits) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
