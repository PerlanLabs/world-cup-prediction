#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { buildPolymarketMarketStructure } from "./polymarket-market-structure.mjs";

const execFileAsync = promisify(execFile);

const PROJECT_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DEFAULT_PAPERTRADER_DATA_DIR = resolve(PROJECT_ROOT, "tools/polymarket-paper-trader/runtime");
const CLOB_BASE_URL = "https://clob.polymarket.com";
const CLOB_BATCH_HISTORY_URL = `${CLOB_BASE_URL}/batch-prices-history`;
const USER_AGENT = "world-cup-prediction-market-movement/0.1";
const DEFAULT_LOOKBACK_DAYS = 7;
const DEFAULT_FIDELITY_MINUTES = 15;
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_LIMIT = 120;
const DEFAULT_TIMEOUT_MS = 12_000;
const WINDOW_SECONDS = {
  d7: 7 * 24 * 60 * 60,
  h72: 72 * 60 * 60,
  h24: 24 * 60 * 60,
  h6: 6 * 60 * 60,
  h1: 60 * 60,
};

export const DEFAULT_MOVEMENT_CATEGORIES = new Set([
  "moneyline",
  "team_to_advance",
  "spreads",
  "totals",
  "team_totals",
  "both_teams_to_score",
  "exact_score",
  "extra_time",
  "penalty_shootout",
  "first_to_score",
  "halftime_result",
  "second_half_result",
]);

export async function buildMovementSnapshot(options = {}) {
  const envelope = options.snapshotFile
    ? loadJson(options.snapshotFile)
    : await runPaperTraderDiscovery(options);
  const discovery = unwrapPaperTraderSnapshot(envelope);
  const event = discovery.event ?? discovery.events?.[0] ?? null;
  if (!event) throw new Error("PaperTrader snapshot is missing the selected event.");
  if (!Array.isArray(discovery.markets)) throw new Error("PaperTrader snapshot is missing data.markets.");

  const cutoffTs = resolveCutoffTimestamp(options.endTs, event);
  const historyMode = resolveHistoryMode(options);
  const lookbackDays = historyMode === "window"
    ? positiveNumber(options.lookbackDays, DEFAULT_LOOKBACK_DAYS)
    : null;
  const startTs = historyMode === "window"
    ? integerOrNull(options.startTs) ?? Math.max(0, cutoffTs - Math.round(lookbackDays * 86_400))
    : null;
  if (startTs != null && startTs >= cutoffTs) {
    throw new Error("History start timestamp must be earlier than the pre-kickoff cutoff.");
  }

  const selectedCategories = options.allCategories
    ? null
    : parseCategorySet(options.categories) ?? DEFAULT_MOVEMENT_CATEGORIES;
  const limit = positiveInteger(options.limit, DEFAULT_LIMIT);
  const eligibleCandidates = discovery.markets
    .filter((market) => !selectedCategories || selectedCategories.has(market.category))
    .map(selectPrimaryOutcome)
    .filter(Boolean);
  const candidates = eligibleCandidates.slice(0, limit);
  const fidelityMinutes = positiveInteger(options.fidelity, DEFAULT_FIDELITY_MINUTES);
  const historyResults = await fetchPriceHistories(candidates, {
    historyMode,
    startTs,
    endTs: cutoffTs,
    fidelity: fidelityMinutes,
    concurrency: positiveInteger(options.concurrency, DEFAULT_CONCURRENCY),
    timeoutMs: positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS),
    allowPowerShellFallback: options.powerShellFallback !== false,
  });

  const rows = await Promise.all(candidates.map(async (candidate) => {
      const historyResult = historyResults.get(candidate.tokenId);
      try {
        if (historyResult?.error) throw new Error(historyResult.error);
        const raw = historyResult?.raw ?? [];
        const normalizedPoints = normalizePriceHistory(raw);
        const points = normalizedPoints.filter((point) => (
          (startTs == null || point.timestamp >= startTs) && point.timestamp <= cutoffTs
        ));
        return {
          ...candidate,
          status: points.length ? "available" : "empty",
          movement: summarizePriceHistory(points, {
            cutoffTs,
            fidelityMinutes,
          }),
          openingCoverage: summarizeOpeningCoverage(candidate, points, fidelityMinutes),
          historyFetchSource: historyResult?.source ?? null,
          history: options.summaryOnly ? undefined : points,
          error: points.length ? null : "empty_history",
          discardedPointCount: normalizedPoints.length - points.length,
        };
      } catch (error) {
        return {
          ...candidate,
          status: "unavailable",
          movement: null,
          openingCoverage: summarizeOpeningCoverage(candidate, [], fidelityMinutes),
          historyFetchSource: historyResult?.source ?? null,
          history: options.summaryOnly ? undefined : [],
          error: cleanErrorMessage(error),
        };
      }
    }));

  const categoryCoverage = buildCategoryCoverage(discovery.categories, discovery.markets, rows);
  const marketInventory = buildMarketInventory(discovery.markets, rows, {
    selectedCategories,
    eligibleMarketCount: eligibleCandidates.length,
    limit,
  });
  const dataQuality = buildMovementDataQuality({
    cutoffTs,
    historyMode,
    markets: discovery.markets,
    marketInventory,
    rows,
    selectedCategories,
    eligibleMarketCount: eligibleCandidates.length,
  });
  const availableRows = rows.filter((row) => row.status === "available");
  const observedStartTs = availableRows.length
    ? Math.min(...availableRows.map((row) => row.movement?.firstObserved?.timestamp).filter(Number.isFinite))
    : null;
  const topMovers = [...availableRows]
    .map((row) => ({ row, ranking: movementRanking(row.movement) }))
    .filter((item) => Number.isFinite(item.ranking?.percentagePoints))
    .sort((a, b) => Math.abs(b.ranking.percentagePoints) - Math.abs(a.ranking.percentagePoints))
    .slice(0, 12)
    .map(({ row, ranking }) => ({
      category: row.category,
      marketSlug: row.marketSlug,
      selection: row.selection,
      outcome: row.outcome,
      basis: ranking.basis,
      percentagePoints: ranking.percentagePoints,
      direction: classifyMovement(ranking.percentagePoints),
      quality: row.movement.quality.analysisStatus ?? row.movement.quality.status,
    }));
  const marketStructure = buildPolymarketMarketStructure({
    rows,
    event,
    cutoffTs,
  });

  return {
    ok: true,
    schemaVersion: "polymarket-movement/v3",
    generatedAt: new Date().toISOString(),
    source: {
      discovery: "local polymarket-paper-trader worldcup discover snapshot",
      priceHistory: `${CLOB_BASE_URL}/prices-history`,
      batchPriceHistory: CLOB_BATCH_HISTORY_URL,
      readOnly: true,
      tradingEnabled: false,
    },
    input: {
      home: options.home ?? event.teams?.find((team) => team.ordering === "home")?.name ?? null,
      away: options.away ?? event.teams?.find((team) => team.ordering === "away")?.name ?? null,
      eventSlug: event.slug ?? null,
      snapshotFile: options.snapshotFile ? resolve(options.snapshotFile) : null,
      historyMode,
      historyInterval: historyMode === "lifecycle" ? "max" : null,
      requestedStartTs: startTs,
      startTs: startTs ?? observedStartTs,
      cutoffTs,
      startTime: Number.isFinite(startTs ?? observedStartTs) ? new Date((startTs ?? observedStartTs) * 1000).toISOString() : null,
      cutoffTime: new Date(cutoffTs * 1000).toISOString(),
      cutoffPolicy: options.endTs == null ? "event_start_time_pre_kickoff" : "explicit_end_ts",
      lookbackDays,
      fidelityMinutes,
      categories: selectedCategories ? [...selectedCategories] : "all",
      summaryOnly: Boolean(options.summaryOnly),
    },
    event,
    discovery: {
      relatedEventCount: Array.isArray(discovery.events) ? discovery.events.length : null,
      marketCount: discovery.market_count ?? discovery.markets.length,
      categoryCount: Object.keys(discovery.categories ?? {}).length,
    },
    categoryCoverage,
    marketInventory,
    rows,
    dataQuality,
    marketStructure,
    assistantView: buildAssistantView({
      event,
      cutoffTs,
      categoryCoverage,
      dataQuality,
      rows,
      topMovers,
      marketStructure,
    }),
    summary: {
      selectedMarketCount: rows.length,
      historyAvailableCount: availableRows.length,
      historyEmptyCount: rows.filter((row) => row.status === "empty").length,
      historyErrorCount: rows.filter((row) => row.status === "unavailable").length,
      staleCount: availableRows.filter((row) => row.movement?.quality?.status === "stale").length,
      sparseCount: availableRows.filter((row) => row.movement?.quality?.status === "sparse").length,
      topMovers,
    },
    notes: [
      "The cutoff defaults to the selected event kickoff, so post-kickoff and settlement prices are excluded.",
      historyMode === "lifecycle"
        ? "firstObserved is the earliest price returned by the CLOB max-history query. openingCoverage compares it with known market creation metadata; it is not called a confirmed opening quote when that metadata is missing or the first price arrives much later."
        : "firstObserved is the first point inside the configured lookback window, not necessarily the true market opening price.",
      "Price movement measures changing market-implied support. It does not prove bookmaker intent, manipulation, or a future result.",
      "The complete PaperTrader category inventory is preserved in categoryCoverage even when history fetching is limited to directly useful categories.",
      "marketInventory preserves every discovered market and explains whether its primary outcome was tracked, excluded by category scope, or excluded by the request limit.",
      "Historical price points outside the requested start/cutoff range are discarded before storage and analysis.",
    ],
  };
}

export function normalizePriceHistory(raw) {
  const history = Array.isArray(raw) ? raw : Array.isArray(raw?.history) ? raw.history : [];
  const points = new Map();
  for (const item of history) {
    const timestamp = Number(item?.timestamp ?? item?.t);
    const price = Number(item?.price ?? item?.p);
    if (!Number.isFinite(timestamp) || !Number.isFinite(price)) continue;
    if (timestamp < 0 || price < 0 || price > 1) continue;
    points.set(Math.trunc(timestamp), round(price, 6));
  }
  return [...points.entries()]
    .sort(([a], [b]) => a - b)
    .map(([timestamp, price]) => ({ timestamp, price }));
}

export function summarizePriceHistory(rawPoints, { cutoffTs, fidelityMinutes = 60 } = {}) {
  const points = normalizePriceHistory(rawPoints);
  if (!points.length) return null;
  const cutoff = integerOrNull(cutoffTs) ?? points.at(-1).timestamp;
  const eligible = points.filter((point) => point.timestamp <= cutoff);
  if (!eligible.length) return null;

  const firstObserved = eligible[0];
  const preKickoff = eligible.at(-1);
  const high = eligible.reduce((best, point) => point.price > best.price ? point : best, eligible[0]);
  const low = eligible.reduce((best, point) => point.price < best.price ? point : best, eligible[0]);
  const change = movementBetween(firstObserved, preKickoff);
  const windows = Object.fromEntries(Object.entries(WINDOW_SECONDS).map(([key, seconds]) => {
    const anchor = pointAtOrBefore(eligible, cutoff - seconds);
    return [key, anchor ? {
      anchor,
      ...movementBetween(anchor, preKickoff),
    } : null];
  }));
  const closeLagSeconds = Math.max(0, cutoff - preKickoff.timestamp);
  const durationSeconds = Math.max(0, preKickoff.timestamp - firstObserved.timestamp);
  const warnings = detectHistoryWarnings(eligible, windows);
  const staleThresholdSeconds = Math.max(1_800, positiveInteger(fidelityMinutes, 60) * 120);
  const qualityStatus = eligible.length < 3
    ? "sparse"
    : closeLagSeconds > staleThresholdSeconds
      ? "stale"
      : "usable";

  return {
    pointCount: eligible.length,
    firstObserved,
    preKickoff,
    high,
    low,
    rangePercentagePoints: round((high.price - low.price) * 100, 2),
    durationSeconds,
    closeLagSeconds,
    change,
    windows,
    quality: {
      status: qualityStatus,
      analysisStatus: qualityStatus === "usable" && warnings.length ? "review" : qualityStatus,
      reason: qualityStatus === "sparse"
        ? "fewer_than_3_points"
        : qualityStatus === "stale"
          ? "last_point_too_far_before_cutoff_for_requested_fidelity"
          : null,
      warnings,
    },
  };
}

function detectHistoryWarnings(points, windows) {
  const warnings = [];
  const first = points[0];
  const laterPrices = points.slice(1).map((point) => point.price);
  const reachesTail = laterPrices.some((price) => price <= 0.05 || price >= 0.95);
  const hasLateAnchor = Number.isFinite(windows?.h24?.anchor?.price) || Number.isFinite(windows?.h6?.anchor?.price);
  if (first?.price === 0.5 && reachesTail && !hasLateAnchor) {
    warnings.push("suspected_market_initialization_anchor");
  }
  let largestStep = 0;
  for (let index = 1; index < points.length; index += 1) {
    largestStep = Math.max(largestStep, Math.abs(points[index].price - points[index - 1].price));
  }
  if (largestStep >= 0.35) warnings.push("large_single_step_move");
  return warnings;
}

function movementRanking(movement) {
  for (const [basis, value] of [
    ["24h", movement?.windows?.h24?.percentagePoints],
    ["6h", movement?.windows?.h6?.percentagePoints],
    ["full_window", movement?.change?.percentagePoints],
  ]) {
    if (Number.isFinite(value)) return { basis, percentagePoints: value };
  }
  return null;
}

export function classifyMovement(percentagePoints) {
  if (!Number.isFinite(percentagePoints)) return "unknown";
  if (percentagePoints >= 5) return "strong_support_increase";
  if (percentagePoints >= 2) return "support_increase";
  if (percentagePoints <= -5) return "strong_support_decrease";
  if (percentagePoints <= -2) return "support_decrease";
  return "flat";
}

function movementBetween(from, to) {
  const absolute = round(to.price - from.price, 6);
  const percentagePoints = round(absolute * 100, 2);
  return {
    fromPrice: from.price,
    toPrice: to.price,
    absolute,
    percentagePoints,
    relativePercent: from.price > 0 ? round((absolute / from.price) * 100, 2) : null,
    direction: classifyMovement(percentagePoints),
  };
}

function pointAtOrBefore(points, targetTs) {
  let candidate = null;
  for (const point of points) {
    if (point.timestamp > targetTs) break;
    candidate = point;
  }
  return candidate;
}

function selectPrimaryOutcome(market) {
  const outcome = Array.isArray(market?.outcomes) ? market.outcomes[0] : null;
  const tokenId = outcome?.token_id ?? outcome?.tokenId;
  if (!tokenId) return null;
  return {
    category: market.category ?? "unknown",
    categoryFamily: market.category_family ?? null,
    period: market.period ?? null,
    marketSlug: market.slug ?? null,
    question: market.question ?? null,
    selection: market.selection ?? null,
    selectionLine: market.selection_line ?? null,
    line: finiteNumber(market.line),
    createdAt: market.created_at ?? market.createdAt ?? null,
    updatedAt: market.updated_at ?? market.updatedAt ?? null,
    startDate: market.start_date ?? market.startDate ?? null,
    acceptingOrdersTimestamp: market.accepting_orders_timestamp ?? market.acceptingOrdersTimestamp ?? null,
    outcome: outcome.name ?? market.tokens?.[0]?.outcome ?? null,
    tokenId: String(tokenId),
    snapshotPrice: finiteNumber(outcome.price),
    bestBid: finiteNumber(market.best_bid),
    bestAsk: finiteNumber(market.best_ask),
    liquidity: finiteNumber(market.liquidity),
    volume: finiteNumber(market.volume),
  };
}

export function summarizeOpeningCoverage(candidate, points, fidelityMinutes) {
  const origin = firstTimestamp([
    candidate.createdAt,
    candidate.startDate,
    candidate.acceptingOrdersTimestamp,
  ]);
  const firstObserved = points[0] ?? null;
  if (!firstObserved) {
    return {
      status: origin ? "no_price_history" : "unknown_market_origin",
      marketOriginTime: origin ? new Date(origin * 1000).toISOString() : null,
      firstObservedTime: null,
      lagSeconds: null,
      openingLabel: "unavailable",
    };
  }
  if (!origin) {
    return {
      status: "unknown_market_origin",
      marketOriginTime: null,
      firstObservedTime: new Date(firstObserved.timestamp * 1000).toISOString(),
      lagSeconds: null,
      openingLabel: "earliest_available_price",
    };
  }
  const lagSeconds = Math.max(0, firstObserved.timestamp - origin);
  const nearCreationThreshold = Math.max(6 * 60 * 60, positiveInteger(fidelityMinutes, 15) * 120);
  return {
    status: lagSeconds <= nearCreationThreshold ? "near_market_creation" : "late_first_observation",
    marketOriginTime: new Date(origin * 1000).toISOString(),
    firstObservedTime: new Date(firstObserved.timestamp * 1000).toISOString(),
    lagSeconds,
    openingLabel: lagSeconds <= nearCreationThreshold
      ? "earliest_available_near_market_creation"
      : "earliest_available_price_not_confirmed_opening",
  };
}

function buildCategoryCoverage(categories, markets, rows) {
  const discovered = categories && typeof categories === "object" ? categories : {};
  const rowsByCategory = groupCount(rows, (row) => row.category);
  const availableByCategory = groupCount(rows.filter((row) => row.status === "available"), (row) => row.category);
  const names = new Set([
    ...Object.keys(discovered),
    ...markets.map((market) => market.category ?? "unknown"),
  ]);
  return [...names].sort().map((category) => ({
    category,
    family: discovered[category]?.family ?? null,
    discoveredCount: Number(discovered[category]?.count ?? markets.filter((market) => market.category === category).length),
    trackedCount: rowsByCategory.get(category) ?? 0,
    historyAvailableCount: availableByCategory.get(category) ?? 0,
    decision: rowsByCategory.has(category) ? "tracked" : "discovery_only",
    reason: rowsByCategory.has(category)
      ? null
      : "not selected for history fetch; full market metadata remains in the PaperTrader discovery snapshot",
  }));
}

export function buildMarketInventory(markets, rows, options = {}) {
  const rowByToken = new Map(rows.filter((row) => row.tokenId).map((row) => [String(row.tokenId), row]));
  const selectedCategories = options.selectedCategories;
  let eligibleIndex = 0;
  return markets.map((market) => {
    const outcomes = Array.isArray(market?.outcomes) ? market.outcomes : [];
    const primaryTokenId = outcomes[0]?.token_id ?? outcomes[0]?.tokenId ?? null;
    const tracked = primaryTokenId ? rowByToken.get(String(primaryTokenId)) ?? null : null;
    const categoryEligible = !selectedCategories || selectedCategories.has(market.category);
    const withinLimit = categoryEligible && Boolean(primaryTokenId) && eligibleIndex < options.limit;
    if (categoryEligible && primaryTokenId) eligibleIndex += 1;
    const historyDecision = tracked
      ? "tracked"
      : !primaryTokenId
        ? "missing_primary_token"
        : !categoryEligible
          ? "category_scope_excluded"
          : withinLimit
            ? "history_unavailable"
            : "request_limit_excluded";
    return {
      id: market.id ?? null,
      slug: market.slug ?? null,
      conditionId: market.condition_id ?? market.conditionId ?? null,
      eventRole: market.event_role ?? null,
      category: market.category ?? "unknown",
      categoryFamily: market.category_family ?? null,
      period: market.period ?? null,
      question: market.question ?? null,
      selection: market.selection ?? null,
      selectionLine: market.selection_line ?? null,
      line: finiteNumber(market.line),
      active: Boolean(market.active),
      closed: Boolean(market.closed),
      acceptingOrders: Boolean(market.accepting_orders),
      createdAt: market.created_at ?? market.createdAt ?? null,
      updatedAt: market.updated_at ?? market.updatedAt ?? null,
      startDate: market.start_date ?? market.startDate ?? null,
      acceptingOrdersTimestamp: market.accepting_orders_timestamp ?? market.acceptingOrdersTimestamp ?? null,
      liquidity: finiteNumber(market.liquidity),
      volume: finiteNumber(market.volume),
      volume24h: finiteNumber(market.volume_24h),
      bestBid: finiteNumber(market.best_bid),
      bestAsk: finiteNumber(market.best_ask),
      spread: finiteNumber(market.spread),
      lastTradePrice: finiteNumber(market.last_trade_price),
      outcomes: outcomes.map((outcome) => ({
        name: outcome.name ?? null,
        tokenId: String(outcome.token_id ?? outcome.tokenId ?? "") || null,
        snapshotPrice: finiteNumber(outcome.price),
      })),
      history: {
        decision: historyDecision,
        primaryTokenId: primaryTokenId ? String(primaryTokenId) : null,
        status: tracked?.status ?? null,
        quality: tracked?.movement?.quality ?? null,
      },
    };
  });
}

export function buildMovementDataQuality({
  cutoffTs,
  historyMode = "window",
  markets,
  marketInventory,
  rows,
  selectedCategories,
  eligibleMarketCount,
}) {
  const slugs = markets.map((market) => market.slug).filter(Boolean);
  const allTokens = marketInventory.flatMap((market) => market.outcomes.map((outcome) => outcome.tokenId).filter(Boolean));
  const duplicateMarketSlugCount = slugs.length - new Set(slugs).size;
  const duplicateTokenCount = allTokens.length - new Set(allTokens).size;
  const missingTokenMarketCount = marketInventory.filter((market) => market.outcomes.length === 0 || !market.outcomes[0]?.tokenId).length;
  const availableRows = rows.filter((row) => row.status === "available");
  const unusableRows = rows.filter((row) => row.status !== "available");
  const reviewRows = availableRows.filter((row) => row.movement?.quality?.analysisStatus === "review");
  const staleRows = availableRows.filter((row) => row.movement?.quality?.status === "stale");
  const sparseRows = availableRows.filter((row) => row.movement?.quality?.status === "sparse");
  const nearCreationRows = availableRows.filter((row) => row.openingCoverage?.status === "near_market_creation");
  const lateOpeningRows = availableRows.filter((row) => row.openingCoverage?.status === "late_first_observation");
  const unknownOriginRows = availableRows.filter((row) => row.openingCoverage?.status === "unknown_market_origin");
  const postCutoffPointCount = rows.reduce((sum, row) => sum + (row.history ?? []).filter((point) => point.timestamp > cutoffTs).length, 0);
  const discardedOutOfRangePointCount = rows.reduce((sum, row) => sum + Number(row.discardedPointCount ?? 0), 0);
  const historyCoverageRate = rows.length ? availableRows.length / rows.length : 0;
  const requestScopeCoverageRate = eligibleMarketCount ? rows.length / eligibleMarketCount : 1;
  const issues = [];
  if (duplicateMarketSlugCount) issues.push(issue("critical", "duplicate_market_slug", duplicateMarketSlugCount, "Market slug is not unique."));
  if (duplicateTokenCount) issues.push(issue("critical", "duplicate_token_id", duplicateTokenCount, "Outcome token is reused across discovered markets."));
  if (postCutoffPointCount) issues.push(issue("critical", "post_cutoff_leakage", postCutoffPointCount, "Stored history contains points after kickoff cutoff."));
  if (missingTokenMarketCount) issues.push(issue("high", "missing_primary_token", missingTokenMarketCount, "Discovered markets cannot be joined to CLOB history."));
  if (historyCoverageRate < 1) issues.push(issue("high", "history_fetch_gap", unusableRows.length, "Selected history scope has unavailable markets."));
  if (requestScopeCoverageRate < 1) issues.push(issue("medium", "request_limit_truncation", eligibleMarketCount - rows.length, "History request limit excluded eligible markets."));
  if (staleRows.length) issues.push(issue("medium", "stale_history", staleRows.length, "Latest history point is too far before kickoff."));
  if (sparseRows.length) issues.push(issue("medium", "sparse_history", sparseRows.length, "History has fewer than three usable points."));
  if (reviewRows.length) issues.push(issue("medium", "history_anomaly_review", reviewRows.length, "History contains initialization or large-step warnings."));
  if (historyMode === "lifecycle" && (lateOpeningRows.length || unknownOriginRows.length)) {
    issues.push(issue("low", "opening_quote_not_confirmed", lateOpeningRows.length + unknownOriginRows.length, "Earliest available price is not close enough to known market creation metadata to call it a confirmed opening quote."));
  }
  const hasBlockingIssue = issues.some((item) => item.severity === "critical" || item.severity === "high");
  const readiness = hasBlockingIssue
    ? "blocked"
    : issues.some((item) => item.severity === "medium")
      ? "review"
      : "ready";
  return {
    readiness,
    intendedGrain: "one discovered Polymarket market per inventory row; one fetched primary outcome token per movement row",
    historyScope: selectedCategories ? [...selectedCategories] : "all_categories",
    checks: {
      discoveredMarketCount: markets.length,
      inventoryMarketCount: marketInventory.length,
      discoveredOutcomeTokenCount: allTokens.length,
      uniqueOutcomeTokenCount: new Set(allTokens).size,
      duplicateMarketSlugCount,
      duplicateTokenCount,
      missingTokenMarketCount,
      eligibleHistoryMarketCount: eligibleMarketCount,
      requestedHistoryMarketCount: rows.length,
      historyAvailableCount: availableRows.length,
      historyUnavailableCount: unusableRows.length,
      historyCoverageRate: round(historyCoverageRate, 4),
      requestScopeCoverageRate: round(requestScopeCoverageRate, 4),
      staleHistoryCount: staleRows.length,
      sparseHistoryCount: sparseRows.length,
      anomalyReviewCount: reviewRows.length,
      openingNearMarketCreationCount: nearCreationRows.length,
      openingLateFirstObservationCount: lateOpeningRows.length,
      openingUnknownMarketOriginCount: unknownOriginRows.length,
      openingNearMarketCreationRate: availableRows.length ? round(nearCreationRows.length / availableRows.length, 4) : 0,
      postCutoffPointCount,
      discardedOutOfRangePointCount,
    },
    limitations: [
      "Historical CLOB prices do not contain historical order-book depth, bid/ask spread, or trade size for each point.",
      "Only the primary outcome token is fetched per binary market; opposite-outcome movement must be treated as an inverse probability signal, not an executable historical quote.",
      historyMode === "lifecycle"
        ? "firstObserved is the earliest price returned by interval=max. Treat it as a confirmed opening quote only when openingCoverage is near_market_creation."
        : "firstObserved is bounded by the configured lookback window and is not guaranteed to be the true opening price.",
      "Categories outside historyScope remain complete in marketInventory but do not have price histories in this snapshot.",
      "marketInventory reflects the PaperTrader discovery time; a replay generated later cannot prove that every listed prop was already available at each earlier history timestamp.",
    ],
    issues,
  };
}

function buildAssistantView({ event, cutoffTs, categoryCoverage, dataQuality, rows, topMovers, marketStructure }) {
  return {
    event: {
      id: event.id ?? null,
      slug: event.slug ?? null,
      title: event.title ?? null,
      kickoffTime: new Date(cutoffTs * 1000).toISOString(),
    },
    readiness: dataQuality.readiness,
    checks: dataQuality.checks,
    issues: dataQuality.issues,
    limitations: dataQuality.limitations,
    categoryCoverage,
    topMovers,
    marketStructure,
    movements: rows.map((row) => ({
      category: row.category,
      period: row.period,
      marketSlug: row.marketSlug,
      question: row.question,
      selection: row.selection,
      line: row.line,
      outcome: row.outcome,
      tokenId: row.tokenId,
      liquidity: row.liquidity,
      volume: row.volume,
      status: row.status,
      movement: row.movement,
      openingCoverage: row.openingCoverage,
      historyFetchSource: row.historyFetchSource,
      error: row.error,
    })),
  };
}

function issue(severity, code, count, message) {
  return { severity, code, count, message };
}

async function fetchPriceHistories(candidates, options) {
  const results = new Map();
  const batches = chunk(candidates, DEFAULT_BATCH_SIZE);
  await mapLimit(batches, Math.min(positiveInteger(options.concurrency, DEFAULT_CONCURRENCY), batches.length || 1), async (batch) => {
    try {
      const raw = await fetchBatchPriceHistories(batch.map((candidate) => candidate.tokenId), options);
      const historyMap = raw?.history && !Array.isArray(raw.history) ? raw.history : raw;
      for (const candidate of batch) {
        const history = historyMap?.[candidate.tokenId] ?? [];
        results.set(candidate.tokenId, { raw: { history }, source: "clob_batch_prices_history" });
      }
    } catch (batchError) {
      const fallbackRows = await mapLimit(batch, Math.min(4, batch.length), async (candidate) => {
        try {
          const raw = await fetchPriceHistory(candidate.tokenId, options);
          return [candidate.tokenId, { raw, source: "clob_individual_prices_history_fallback" }];
        } catch (error) {
          return [candidate.tokenId, {
            raw: [],
            source: "clob_history_unavailable",
            error: `${cleanErrorMessage(batchError)}; fallback: ${cleanErrorMessage(error)}`,
          }];
        }
      });
      for (const [tokenId, result] of fallbackRows) results.set(tokenId, result);
    }
  });
  return results;
}

async function fetchBatchPriceHistories(tokenIds, options) {
  const body = {
    markets: tokenIds,
    fidelity: options.fidelity,
    ...(options.historyMode === "lifecycle"
      ? { interval: "max" }
      : { start_ts: options.startTs, end_ts: options.endTs }),
  };
  return fetchJson(CLOB_BATCH_HISTORY_URL, {
    ...options,
    method: "POST",
    body,
  });
}

async function fetchPriceHistory(tokenId, options) {
  const query = new URLSearchParams({ market: tokenId, fidelity: String(options.fidelity) });
  if (options.historyMode === "lifecycle") query.set("interval", "max");
  else {
    query.set("startTs", String(options.startTs));
    query.set("endTs", String(options.endTs));
  }
  return fetchJson(`${CLOB_BASE_URL}/prices-history?${query}`, options);
}

async function runPaperTraderDiscovery(options) {
  if (!options.eventSlug && !(options.home && options.away)) {
    throw new Error("Provide --papertrader-snapshot, --event-slug, or HOME/AWAY.");
  }
  const args = [
    "--data-dir", resolvePaperTraderDataDir(options.dataDir),
    "worldcup", "discover",
  ];
  if (options.home && options.away) args.push(options.home, options.away);
  if (options.date) args.push("--date", options.date);
  if (options.eventSlug) args.push("--event-slug", options.eventSlug);
  if (options.query) args.push("--query", options.query);
  args.push("--no-raw");

  const { stdout } = await execFileAsync(resolvePaperTraderExecutable(options.paperTraderExe), args, {
    cwd: PROJECT_ROOT,
    maxBuffer: 60 * 1024 * 1024,
    windowsHide: true,
  });
  return parseJson(stdout);
}

export function resolvePaperTraderExecutable(configuredValue, options = {}) {
  const configured = String(configuredValue ?? process.env.PAPERTRADER_EXE ?? "").trim();
  if (configured) {
    return /[\\/]/.test(configured) ? resolve(options.projectRoot ?? PROJECT_ROOT, configured) : configured;
  }

  const projectRoot = options.projectRoot ?? PROJECT_ROOT;
  const fileExists = options.fileExists ?? existsSync;
  const candidates = process.platform === "win32"
    ? [
        resolve(projectRoot, "tools/polymarket-paper-trader/.venv/Scripts/pm-trader.exe"),
        resolve(projectRoot, "tools/polymarket-paper-trader/.venv/bin/pm-trader"),
      ]
    : [
        resolve(projectRoot, "tools/polymarket-paper-trader/.venv/bin/pm-trader"),
        resolve(projectRoot, "tools/polymarket-paper-trader/.venv/Scripts/pm-trader.exe"),
      ];
  return candidates.find((candidate) => fileExists(candidate)) ?? "pm-trader";
}

export function resolvePaperTraderDataDir(configuredValue) {
  const configured = String(configuredValue ?? process.env.PAPERTRADER_DATA_DIR ?? "").trim();
  return configured ? resolve(configured) : DEFAULT_PAPERTRADER_DATA_DIR;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: options.method ?? "GET",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": USER_AGENT,
        ...(options.body ? { "content-type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 180)}`);
    return await response.json();
  } catch (error) {
    if (options.allowPowerShellFallback && process.platform === "win32") {
      return fetchJsonWithPowerShell(url, options);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonWithPowerShell(url, options = {}) {
  const timeoutSec = Math.ceil(((options.timeoutMs ?? DEFAULT_TIMEOUT_MS) + 8_000) / 1000);
  const script = `
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$headers = @{ Accept = 'application/json'; 'User-Agent' = '${USER_AGENT}' }
if ($env:POLYMARKET_MOVEMENT_METHOD -eq 'POST') {
  Invoke-RestMethod -Uri $env:POLYMARKET_MOVEMENT_URL -Method Post -Headers $headers -ContentType 'application/json' -Body $env:POLYMARKET_MOVEMENT_BODY -TimeoutSec ${timeoutSec} | ConvertTo-Json -Depth 100 -Compress
} else {
  Invoke-RestMethod -Uri $env:POLYMARKET_MOVEMENT_URL -Headers $headers -TimeoutSec ${timeoutSec} | ConvertTo-Json -Depth 100 -Compress
}
`;
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], {
    env: {
      ...process.env,
      POLYMARKET_MOVEMENT_URL: url,
      POLYMARKET_MOVEMENT_METHOD: options.method ?? "GET",
      POLYMARKET_MOVEMENT_BODY: options.body ? JSON.stringify(options.body) : "",
    },
    maxBuffer: 120 * 1024 * 1024,
    windowsHide: true,
  });
  return parseJson(stdout);
}

function unwrapPaperTraderSnapshot(value) {
  const data = value?.ok === true && value?.data ? value.data : value;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Invalid PaperTrader snapshot JSON.");
  }
  return data;
}

function resolveCutoffTimestamp(explicitEndTs, event) {
  const explicit = integerOrNull(explicitEndTs);
  if (explicit != null) return explicit;
  for (const value of [event.start_time, event.game_start_time, event.end_date]) {
    const timestamp = Date.parse(value ?? "");
    if (Number.isFinite(timestamp)) return Math.trunc(timestamp / 1000);
  }
  throw new Error("Cannot determine kickoff cutoff from the PaperTrader event. Pass --end-ts.");
}

function resolveHistoryMode(options) {
  const explicit = String(options.historyMode ?? "").trim().toLowerCase();
  if (explicit && !["lifecycle", "window"].includes(explicit)) {
    throw new Error("--history-mode must be lifecycle or window.");
  }
  if (explicit) return explicit;
  return options.startTs != null || options.lookbackDays != null ? "window" : "lifecycle";
}

function parseArgs(args) {
  const options = {};
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("-")) positional.push(arg);
    else if (arg === "--home") options.home = next(args, ++index, arg);
    else if (arg === "--away") options.away = next(args, ++index, arg);
    else if (arg === "--date") options.date = next(args, ++index, arg);
    else if (arg === "--event-slug") options.eventSlug = next(args, ++index, arg);
    else if (arg === "--query") options.query = next(args, ++index, arg);
    else if (arg === "--papertrader-snapshot" || arg === "--snapshot-file") options.snapshotFile = next(args, ++index, arg);
    else if (arg === "--data-dir") options.dataDir = next(args, ++index, arg);
    else if (arg === "--categories") options.categories = next(args, ++index, arg);
    else if (arg === "--all-categories") options.allCategories = true;
    else if (arg === "--history-mode") options.historyMode = next(args, ++index, arg);
    else if (arg === "--lookback-days") options.lookbackDays = Number(next(args, ++index, arg));
    else if (arg === "--start-ts") options.startTs = Number(next(args, ++index, arg));
    else if (arg === "--end-ts") options.endTs = Number(next(args, ++index, arg));
    else if (arg === "--fidelity") options.fidelity = Number(next(args, ++index, arg));
    else if (arg === "--limit") options.limit = Number(next(args, ++index, arg));
    else if (arg === "--concurrency") options.concurrency = Number(next(args, ++index, arg));
    else if (arg === "--timeout-ms") options.timeoutMs = Number(next(args, ++index, arg));
    else if (arg === "--summary-only") options.summaryOnly = true;
    else if (arg === "--no-powershell-fallback") options.powerShellFallback = false;
    else if (arg === "--output") options.output = next(args, ++index, arg);
    else if (arg === "--markdown") options.markdown = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.home && positional[0]) options.home = positional[0];
  if (!options.away && positional[1]) options.away = positional[1];
  if (positional.length > 2) throw new Error("Too many positional arguments.");
  return options;
}

function printHelp() {
  console.log(`Usage:
  npm run polymarket:movement -- france morocco --event-slug fifwc-fra-mar-2026-07-09
  npm run polymarket:movement -- --papertrader-snapshot _tmp_polymarket/france-morocco-papertrader.json

Options:
  --papertrader-snapshot <path>  Reuse a complete PaperTrader discovery snapshot.
  --event-slug <slug>            Force the exact match event.
  --date <YYYY-MM-DD>            Match date for PaperTrader discovery.
  --categories <csv>             History categories; defaults to directly useful match markets.
  --all-categories               Fetch history for every discovered category.
  --history-mode <mode>          lifecycle (default) or window.
  --lookback-days <n>            Use a fixed pre-kickoff window; default 7 when window mode is selected.
  --start-ts / --end-ts <unix>   Explicit history range; end defaults to kickoff.
  --fidelity <minutes>           CLOB history resolution, default 15.
  --limit <n>                    Max markets to fetch, default 120.
  --concurrency <n>              Parallel history requests, default 8.
  --summary-only                 Omit raw history points from the output.
  --output <path>                Save JSON or markdown.
  --markdown                     Render a compact movement report.
`);
}

function renderMarkdown(output) {
  const historyRange = output.input.historyMode === "lifecycle"
    ? "完整生命周期（最早可得价至开球）"
    : `回看：${output.input.lookbackDays}天`;
  const lines = [
    `# Polymarket盘口走势：${output.event.title ?? output.event.slug}`,
    "",
    `赛前截止：${output.input.cutoffTime}；${historyRange}；粒度：${output.input.fidelityMinutes}分钟`,
    "",
    "| 盘口 | 分类 | 最早可得 | 临场价 | 全期 | 7d | 72h | 24h | 6h | 1h | 初盘覆盖 | 数据质量 |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|",
  ];
  for (const row of output.rows) {
    const movement = row.movement;
    lines.push([
      row.selection ?? row.question ?? row.marketSlug,
      row.category,
      formatPrice(movement?.firstObserved?.price),
      formatPrice(movement?.preKickoff?.price),
      formatPp(movement?.change?.percentagePoints),
      formatPp(movement?.windows?.d7?.percentagePoints),
      formatPp(movement?.windows?.h72?.percentagePoints),
      formatPp(movement?.windows?.h24?.percentagePoints),
      formatPp(movement?.windows?.h6?.percentagePoints),
      formatPp(movement?.windows?.h1?.percentagePoints),
      row.openingCoverage?.status ?? "-",
      movement?.quality?.status ?? row.status,
    ].map(escapePipe).join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  lines.push("", "## 分类覆盖", "", "| 分类 | 发现 | 抓取 | 有历史 | 状态 |", "|---|---:|---:|---:|---|");
  for (const row of output.categoryCoverage) {
    lines.push(`| ${escapePipe(row.category)} | ${row.discoveredCount} | ${row.trackedCount} | ${row.historyAvailableCount} | ${row.decision} |`);
  }
  return `${lines.join("\n")}\n`;
}

function loadJson(path) {
  return parseJson(readFileSync(resolve(path), "utf8"));
}

function parseJson(value) {
  return JSON.parse(String(value).replace(/^\uFEFF/, ""));
}

function parseCategorySet(value) {
  if (!value) return null;
  return new Set(String(value).split(",").map((item) => item.trim()).filter(Boolean));
}

function groupCount(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await mapper(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function chunk(items, size) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

function firstTimestamp(values) {
  for (const value of values) {
    const timestamp = Date.parse(value ?? "");
    if (Number.isFinite(timestamp)) return Math.trunc(timestamp / 1000);
  }
  return null;
}

function next(args, index, label) {
  const value = args[index];
  if (value == null || value === "") throw new Error(`${label} requires a value.`);
  return value;
}

function integerOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveInteger(value, fallback) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function cleanErrorMessage(error) {
  return String(error?.message ?? error ?? "unknown_error").split(/\r?\n/)[0].slice(0, 300);
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function formatPrice(value) {
  return Number.isFinite(value) ? `${round(value * 100, 2)}c` : "-";
}

function formatPp(value) {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${round(value, 2)}pp` : "-";
}

function escapePipe(value) {
  return String(value ?? "-").replaceAll("|", "\\|");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const output = await buildMovementSnapshot(options);
  const rendered = options.markdown ? renderMarkdown(output) : `${JSON.stringify(output, null, 2)}\n`;
  if (options.output) {
    const outputPath = resolve(options.output);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, rendered, "utf8");
  } else {
    process.stdout.write(rendered);
  }
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
