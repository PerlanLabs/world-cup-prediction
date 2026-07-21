const DEFAULT_FEE_RATE = 0.03;

export const BACKTEST_STAGE_WINDOWS = [
  { key: "h72", from: "opening", to: "h72", label: "开盘至72小时前" },
  { key: "h24", from: "h72", to: "h24", label: "72至24小时前" },
  { key: "h6", from: "h24", to: "h6", label: "24至6小时前" },
  { key: "h1", from: "h6", to: "h1", label: "6至1小时前" },
];

export const SIGNAL_DEFINITIONS = {
  favorite_tail_strengthening: {
    label: "热门方两球胜尾部增强",
    target: { type: "direct", marketKey: "favorite_minus_1_5", side: "yes" },
  },
  broad_favorite_strengthening: {
    label: "热门方整体增强",
    target: { type: "direct", marketKey: "favorite_win", side: "yes" },
  },
  two_goal_concentration: {
    label: "热门方净胜两球集中",
    target: { type: "synthetic", eventKey: "favorite_exactly_2" },
  },
  broad_blowout_tail_expansion: {
    label: "热门方大胜尾部扩张",
    target: { type: "direct", marketKey: "favorite_minus_2_5", side: "yes" },
  },
  home_scoring_drives_over: {
    label: "热门方进球驱动大球",
    target: { type: "direct", marketKey: "favorite_over_1_5", side: "yes" },
  },
  away_scoring_supports_over: {
    label: "弱势方进球支撑大球",
    target: { type: "direct", marketKey: "underdog_over_0_5", side: "yes" },
  },
  moderate_total_concentration: {
    label: "总进球集中在三球",
    target: { type: "synthetic", eventKey: "total_exactly_3" },
  },
  broad_total_tail_expansion: {
    label: "总进球高位尾部扩张",
    target: { type: "direct", marketKey: "over_3_5", side: "yes" },
  },
};

const REQUIRED_KEYS = {
  favorite_shift: ["favorite_win", "favorite_minus_1_5"],
  favorite_tail: ["favorite_minus_1_5", "favorite_minus_2_5"],
  scoring_driver: ["over_2_5", "favorite_over_1_5", "underdog_over_0_5"],
  total_tail: ["over_2_5", "over_3_5"],
};

export function buildSignalBacktestMatch({
  movement,
  match,
  prediction,
  feeRate = DEFAULT_FEE_RATE,
  thresholdScale = 1,
} = {}) {
  if (!movement?.marketStructure) throw new Error("Movement snapshot is missing marketStructure.");
  if (!Number.isFinite(Number(match?.score?.home)) || !Number.isFinite(Number(match?.score?.away))) {
    throw new Error("A settled regular-time score is required.");
  }

  const structure = movement.marketStructure;
  const score = { home: Number(match.score.home), away: Number(match.score.away) };
  const scoreGrid = buildModelScoreGrid(prediction?.expectedGoals);
  const quality = resolveMatchQuality(movement);
  const signals = [];

  for (const window of BACKTEST_STAGE_WINDOWS) {
    const detected = detectWindowSignals(structure.keyMarkets ?? [], window, thresholdScale);
    for (const item of detected) {
      signals.push(settleSignal({
        item,
        definition: SIGNAL_DEFINITIONS[item.code],
        window,
        structure,
        signalQuality: resolveSignalQuality({ movement, item, window }),
        score,
        scoreGrid,
        feeRate,
      }));
    }
  }

  for (const item of detectLateAccelerationSignals(structure.keyMarkets ?? [], thresholdScale)) {
    const window = { key: "close", from: "h1", to: "close", label: "最后1小时至封盘" };
    signals.push(settleSignal({
      item,
      definition: item.definition,
      window,
      structure,
      signalQuality: resolveSignalQuality({ movement, item, window }),
      score,
      scoreGrid,
      feeRate,
    }));
  }

  return {
    matchId: match.id,
    eventSlug: movement.event?.slug ?? structure.event?.slug ?? null,
    kickoffTime: movement.input?.cutoffTime ?? structure.event?.kickoffTime ?? match.official?.dateUtc ?? null,
    home: movement.event?.teams?.find((team) => team.ordering === "home")?.name ?? match.homeTeamId,
    away: movement.event?.teams?.find((team) => team.ordering === "away")?.name ?? match.awayTeamId,
    favorite: structure.teams?.favorite ?? null,
    favoriteSide: structure.teams?.favoriteSide ?? "home",
    score,
    quality,
    prediction: prediction ? {
      id: prediction.id ?? null,
      generatedAt: prediction.generatedAt ?? null,
      freezeType: prediction.audit?.freezeType ?? null,
      backfilled: Boolean(prediction.audit?.backfilled),
      expectedGoals: prediction.expectedGoals ?? null,
    } : null,
    signalCount: signals.length,
    signals,
  };
}

export function detectWindowSignals(keyMarkets, window, thresholdScale = 1) {
  const delta = Object.fromEntries(keyMarkets.map((market) => [
    market.key,
    changePp(market.prices?.[window.from]?.price, market.prices?.[window.to]?.price),
  ]));
  const signals = [];
  const small = 1 * thresholdScale;
  const strong = 2 * thresholdScale;

  const [favoriteWin, favoriteBy2] = values(delta, REQUIRED_KEYS.favorite_shift);
  if (allFinite(favoriteWin, favoriteBy2) && Math.abs(favoriteWin) <= small && favoriteBy2 >= small) {
    signals.push(observation("favorite_tail_strengthening", REQUIRED_KEYS.favorite_shift, delta));
  } else if (allFinite(favoriteWin, favoriteBy2) && favoriteWin >= strong && favoriteBy2 >= strong) {
    signals.push(observation("broad_favorite_strengthening", REQUIRED_KEYS.favorite_shift, delta));
  }

  const [favoriteBy2Tail, favoriteBy3] = values(delta, REQUIRED_KEYS.favorite_tail);
  if (allFinite(favoriteBy2Tail, favoriteBy3) && favoriteBy2Tail >= small && favoriteBy3 <= small / 2) {
    signals.push(observation("two_goal_concentration", REQUIRED_KEYS.favorite_tail, delta));
  } else if (allFinite(favoriteBy2Tail, favoriteBy3) && favoriteBy2Tail >= small && favoriteBy3 >= small) {
    signals.push(observation("broad_blowout_tail_expansion", REQUIRED_KEYS.favorite_tail, delta));
  }

  const [over25, favoriteOver15, underdogOver05] = values(delta, REQUIRED_KEYS.scoring_driver);
  if (
    allFinite(over25, favoriteOver15, underdogOver05)
    && over25 >= strong
    && favoriteOver15 >= strong
    && favoriteOver15 >= underdogOver05
  ) {
    signals.push(observation("home_scoring_drives_over", REQUIRED_KEYS.scoring_driver, delta));
  } else if (allFinite(over25, underdogOver05) && over25 >= strong && underdogOver05 >= strong) {
    signals.push(observation("away_scoring_supports_over", ["over_2_5", "underdog_over_0_5"], delta));
  }

  const [totalOver25, over35] = values(delta, REQUIRED_KEYS.total_tail);
  if (allFinite(totalOver25, over35) && totalOver25 >= strong && over35 <= small / 2) {
    signals.push(observation("moderate_total_concentration", REQUIRED_KEYS.total_tail, delta));
  } else if (allFinite(totalOver25, over35) && totalOver25 >= strong && over35 >= small) {
    signals.push(observation("broad_total_tail_expansion", REQUIRED_KEYS.total_tail, delta));
  }

  return signals;
}

export function detectLateAccelerationSignals(keyMarkets, thresholdScale = 1) {
  const minimum = 1 * thresholdScale;
  return keyMarkets.flatMap((market) => {
    const opening = finite(market.prices?.opening?.price);
    const h1 = finite(market.prices?.h1?.price);
    const close = finite(market.prices?.close?.price);
    if (![opening, h1, close].every(Number.isFinite)) return [];
    const full = changePp(opening, close);
    const late = changePp(h1, close);
    const sameDirection = full === 0 || Math.sign(full) === Math.sign(late);
    if (!sameDirection || Math.abs(late) < minimum || Math.abs(late) < Math.max(minimum, Math.abs(full) * 0.4)) return [];
    const side = late >= 0 ? "yes" : "no";
    return [{
      code: `late_acceleration_${market.key}_${side}`,
      requiredKeys: [market.key],
      deltas: { [market.key]: late },
      direction: side,
      definition: {
        label: `${market.label}临场${side === "yes" ? "强化" : "走弱"}`,
        target: { type: "direct", marketKey: market.key, side },
      },
    }];
  });
}

export function aggregateSignalBacktest(matches, options = {}) {
  const allSignals = matches
    .flatMap((match) => match.signals.map((signal) => ({ ...signal, matchId: match.matchId, kickoffTime: match.kickoffTime })))
    .sort(compareChronological);
  const primarySignals = allSignals.filter((signal) => signal.eligibleForPrimary);
  const bySignal = groupMetrics(primarySignals, (row) => row.code);
  const byWindow = groupMetrics(primarySignals, (row) => row.window.key);
  const stability = buildWindowStability(primarySignals);

  return {
    schemaVersion: "polymarket-signal-backtest/v1",
    generatedAt: new Date().toISOString(),
    policy: {
      fixedFeeRate: round(Number(options.feeRate ?? DEFAULT_FEE_RATE), 4),
      dynamicFeeSchedule: false,
      lifecycleOnly: true,
      postKickoffDataAllowed: false,
      primaryQualityRule: "Each signal window is reviewed independently. Opening-only warnings do not invalidate later windows when every required contract is usable in that interval.",
      syntheticRule: "Synthetic concentration events are scored for hit rate/model edge only; no executable CLV or ROI is claimed.",
      noOutcomeRule: "Negative primary-token movement is directional evidence only until the opposite token has its own executable quote.",
    },
    sample: {
      matchCount: matches.length,
      readyMatchCount: matches.filter((match) => match.quality.readiness === "ready").length,
      reviewMatchCount: matches.filter((match) => match.quality.readiness === "review").length,
      blockedMatchCount: matches.filter((match) => match.quality.readiness === "blocked").length,
      qualityEligibleMatchCount: matches.filter((match) => match.quality.readiness !== "blocked").length,
      signalCount: allSignals.length,
      primarySignalCount: primarySignals.length,
      directTradeCount: primarySignals.filter((signal) => signal.tradable).length,
      syntheticSignalCount: primarySignals.filter((signal) => signal.target.type === "synthetic").length,
      usableSignalMatchCount: new Set(primarySignals.map((signal) => signal.matchId)).size,
    },
    overall: aggregateRows(primarySignals),
    bySignal,
    byWindow,
    stability,
    researchPolicy: buildResearchPolicy(bySignal, stability),
    matches,
  };
}

export function buildThresholdSensitivity(matchInputs, profiles = [
  { key: "lenient", thresholdScale: 0.75 },
  { key: "baseline", thresholdScale: 1 },
  { key: "strict", thresholdScale: 1.5 },
]) {
  return profiles.map((profile) => {
    const matches = matchInputs.map((input) => buildSignalBacktestMatch({
      ...input,
      thresholdScale: profile.thresholdScale,
    }));
    const report = aggregateSignalBacktest(matches, { feeRate: matchInputs[0]?.feeRate ?? DEFAULT_FEE_RATE });
    return {
      key: profile.key,
      thresholdScale: profile.thresholdScale,
      signalCount: report.sample.primarySignalCount,
      directTradeCount: report.sample.directTradeCount,
      hitRate: report.overall.hitRate,
      averageClvPp: report.overall.uniquePositionAverageClvPp,
      simulatedRoi: report.overall.uniquePositionSimulatedRoi,
      maxDrawdown: report.overall.uniquePositionMaxDrawdown,
      status: report.overall.status,
    };
  });
}

export function buildModelScoreGrid(expectedGoals, maxGoals = 10) {
  const homeXg = finite(expectedGoals?.home);
  const awayXg = finite(expectedGoals?.away);
  if (!Number.isFinite(homeXg) || !Number.isFinite(awayXg)) return [];
  const rows = [];
  let total = 0;
  for (let home = 0; home <= maxGoals; home += 1) {
    for (let away = 0; away <= maxGoals; away += 1) {
      const probability = poisson(home, homeXg) * poisson(away, awayXg) * dixonColesTau(home, away, homeXg, awayXg, -0.13);
      rows.push({ home, away, probability });
      total += probability;
    }
  }
  return rows.map((row) => ({ ...row, probability: row.probability / total }));
}

function settleSignal({ item, definition, window, structure, signalQuality, score, scoreGrid, feeRate }) {
  const target = definition.target;
  const prices = resolveTargetPrices(target, structure.keyMarkets ?? [], window.to);
  const won = targetWon(target, score, structure.teams);
  const modelProbability = targetProbability(target, scoreGrid, structure.teams);
  const directYes = target.type === "direct" && target.side === "yes";
  const tradable = directYes && Number.isFinite(prices.entryPrice);
  const execution = tradable
    ? settleUnitStake({ price: prices.entryPrice, won, feeRate })
    : null;
  const closePrice = target.type === "direct" ? resolveDirectPrice(target, structure.keyMarkets ?? [], "close") : null;
  const clv = tradable && window.to !== "close" && Number.isFinite(closePrice)
    ? (closePrice - prices.entryPrice) * 100
    : null;
  const modelEdge = Number.isFinite(modelProbability) && Number.isFinite(prices.impliedPrice)
    ? (modelProbability - prices.impliedPrice) * 100
    : null;
  const modelEv = tradable && Number.isFinite(modelProbability)
    ? modelProbability * execution.winningPayout - 1
    : null;

  return {
    code: item.code,
    label: definition.label,
    window,
    observedDeltas: item.deltas,
    requiredKeys: item.requiredKeys,
    direction: item.direction ?? "yes",
    target,
    targetLabel: targetLabel(target, structure.teams),
    entryPrice: prices.entryPrice,
    impliedPrice: prices.impliedPrice,
    closePrice,
    clvPp: roundOrNull(clv, 3),
    modelProbability: roundOrNull(modelProbability, 6),
    modelEdgePp: roundOrNull(modelEdge, 3),
    modelEvPerUnit: roundOrNull(modelEv, 6),
    won,
    tradable,
    realizedPnl: execution ? round(execution.realizedPnl, 6) : null,
    feePaid: execution ? round(execution.feePaid, 6) : null,
    quality: signalQuality.readiness,
    qualityIssues: signalQuality.issues,
    eligibleForPrimary: signalQuality.readiness === "ready",
    caveat: target.type === "synthetic"
      ? "Synthetic event: hit rate and model edge only; no executable ROI."
      : target.side === "no"
        ? "Opposite token quote was not fetched; directional result only."
        : null,
  };
}

function detectStatus(metrics) {
  if (metrics.matchCount < 5) return "insufficient_sample";
  if (metrics.uniquePositionCount < 5) return "insufficient_trade_sample";
  const clv = metrics.uniquePositionAverageClvPp;
  const roi = metrics.uniquePositionSimulatedRoi;
  const modelEv = metrics.uniquePositionAverageModelEvPerUnit;
  if (!Number.isFinite(clv)) {
    if (roi < 0) return "downgrade";
    if (roi > 0 && modelEv > 0) return "result_only_review";
    return "mixed_review";
  }
  if (clv > 0 && roi > 0 && modelEv >= 0) return "provisional_keep";
  if (clv > 0 && roi > 0 && modelEv < 0) return "market_model_conflict";
  if (clv <= 0 && roi <= 0) return "downgrade";
  if (clv > 0 && roi <= 0) return "clv_only_review";
  if (clv <= 0 && roi > 0) return "outcome_only_review";
  return "mixed_review";
}

function aggregateRows(rows) {
  const settled = rows.filter((row) => typeof row.won === "boolean");
  const trades = rows.filter((row) => row.tradable && Number.isFinite(row.realizedPnl));
  const clvRows = trades.filter((row) => Number.isFinite(row.clvPp));
  const modelRows = rows.filter((row) => Number.isFinite(row.modelProbability));
  const pnl = trades.reduce((sum, row) => sum + row.realizedPnl, 0);
  const uniquePositions = dedupePositions(trades);
  const uniqueClvRows = uniquePositions.filter((row) => Number.isFinite(row.clvPp));
  const uniquePnl = uniquePositions.reduce((sum, row) => sum + row.realizedPnl, 0);
  const metrics = {
    count: rows.length,
    matchCount: new Set(rows.map((row) => row.matchId).filter(Boolean)).size,
    settledCount: settled.length,
    wins: settled.filter((row) => row.won).length,
    hitRate: ratio(settled.filter((row) => row.won).length, settled.length),
    tradeCount: trades.length,
    realizedPnl: round(pnl, 4),
    simulatedRoi: ratio(pnl, trades.length),
    averageEntryPrice: average(trades.map((row) => row.entryPrice)),
    averageClvPp: average(clvRows.map((row) => row.clvPp)),
    positiveClvRate: ratio(clvRows.filter((row) => row.clvPp > 0).length, clvRows.length),
    averageModelProbability: average(modelRows.map((row) => row.modelProbability)),
    averageModelEdgePp: average(modelRows.map((row) => row.modelEdgePp).filter(Number.isFinite)),
    averageModelEvPerUnit: average(trades.map((row) => row.modelEvPerUnit).filter(Number.isFinite)),
    maxDrawdown: maxDrawdown(trades),
    uniquePositionCount: uniquePositions.length,
    uniquePositionRealizedPnl: round(uniquePnl, 4),
    uniquePositionSimulatedRoi: ratio(uniquePnl, uniquePositions.length),
    uniquePositionAverageClvPp: average(uniqueClvRows.map((row) => row.clvPp)),
    uniquePositionPositiveClvRate: ratio(uniqueClvRows.filter((row) => row.clvPp > 0).length, uniqueClvRows.length),
    uniquePositionAverageModelEvPerUnit: average(uniquePositions.map((row) => row.modelEvPerUnit).filter(Number.isFinite)),
    uniquePositionMaxDrawdown: maxDrawdown(uniquePositions),
    hitRateInterval95: wilsonInterval(settled.filter((row) => row.won).length, settled.length),
  };
  return { ...metrics, status: detectStatus(metrics) };
}

function dedupePositions(rows) {
  const positions = new Map();
  for (const row of [...rows].sort(compareSignalDecision)) {
    const targetKey = row.target?.type === "direct" ? row.target.marketKey : row.target?.eventKey;
    const key = `${row.matchId}|${targetKey}|${row.target?.side ?? "yes"}`;
    if (!positions.has(key)) positions.set(key, row);
  }
  return [...positions.values()].sort(compareChronological);
}

function compareSignalDecision(a, b) {
  const stageOrder = { h72: 0, h24: 1, h6: 2, h1: 3, close: 4 };
  return compareChronological(a, b)
    || (stageOrder[a.window?.key] ?? 99) - (stageOrder[b.window?.key] ?? 99)
    || a.code.localeCompare(b.code);
}

function groupMetrics(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()]
    .map(([key, groupRows]) => ({ key, ...aggregateRows(groupRows) }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function buildWindowStability(rows) {
  const bySignal = new Map();
  for (const row of rows) {
    if (!bySignal.has(row.code)) bySignal.set(row.code, []);
    bySignal.get(row.code).push(row);
  }
  return [...bySignal.entries()].map(([code, signalRows]) => {
    const windows = groupMetrics(signalRows, (row) => row.window.key);
    const evaluable = windows.filter((window) => window.uniquePositionCount >= 3);
    const positiveClvWindows = evaluable.filter((window) => window.uniquePositionAverageClvPp > 0).length;
    const positiveRoiWindows = evaluable.filter((window) => window.uniquePositionSimulatedRoi > 0).length;
    return {
      code,
      windows,
      evaluableWindowCount: evaluable.length,
      positiveClvWindowCount: positiveClvWindows,
      positiveRoiWindowCount: positiveRoiWindows,
      stable: evaluable.length >= 2 && positiveClvWindows === evaluable.length && positiveRoiWindows === evaluable.length,
    };
  }).sort((a, b) => a.code.localeCompare(b.code));
}

function buildResearchPolicy(bySignal, stability) {
  const stableCodes = new Set(stability.filter((row) => row.stable).map((row) => row.code));
  const downgradedSignals = bySignal.filter((row) => row.status === "downgrade").map((row) => row.key);
  const insufficientSignals = bySignal
    .filter((row) => row.status === "insufficient_sample" || row.status === "insufficient_trade_sample")
    .map((row) => row.key);
  const candidateForHoldout = bySignal
    .filter((row) => stableCodes.has(row.key) && row.status !== "downgrade")
    .map((row) => row.key);
  const researchOnlySignals = bySignal
    .map((row) => row.key)
    .filter((code) => !downgradedSignals.includes(code));
  return {
    holdoutValidated: false,
    approvedForRecommendationWeight: [],
    candidateForHoldout,
    downgradedSignals,
    insufficientSignals,
    researchOnlySignals,
    rule: "No signal enters betting recommendation weight until an untouched chronological holdout confirms CLV, cost-adjusted ROI, model compatibility, and drawdown.",
  };
}

function resolveTargetPrices(target, keyMarkets, stage) {
  if (target.type === "direct") {
    const yesPrice = resolveMarketPrice(keyMarkets, target.marketKey, stage);
    const impliedPrice = target.side === "yes" ? yesPrice : Number.isFinite(yesPrice) ? 1 - yesPrice : null;
    return {
      entryPrice: target.side === "yes" ? yesPrice : null,
      impliedPrice,
    };
  }
  if (target.eventKey === "favorite_exactly_2") {
    const by2 = resolveMarketPrice(keyMarkets, "favorite_minus_1_5", stage);
    const by3 = resolveMarketPrice(keyMarkets, "favorite_minus_2_5", stage);
    const price = Number.isFinite(by2) && Number.isFinite(by3) ? clamp(by2 - by3, 0, 1) : null;
    return { entryPrice: null, impliedPrice: price };
  }
  if (target.eventKey === "total_exactly_3") {
    const over25 = resolveMarketPrice(keyMarkets, "over_2_5", stage);
    const over35 = resolveMarketPrice(keyMarkets, "over_3_5", stage);
    const price = Number.isFinite(over25) && Number.isFinite(over35) ? clamp(over25 - over35, 0, 1) : null;
    return { entryPrice: null, impliedPrice: price };
  }
  return { entryPrice: null, impliedPrice: null };
}

function resolveDirectPrice(target, keyMarkets, stage) {
  const yesPrice = resolveMarketPrice(keyMarkets, target.marketKey, stage);
  if (!Number.isFinite(yesPrice)) return null;
  return target.side === "yes" ? yesPrice : 1 - yesPrice;
}

function resolveMarketPrice(keyMarkets, key, stage) {
  return finite(keyMarkets.find((market) => market.key === key)?.prices?.[stage]?.price);
}

function targetWon(target, score, teams) {
  const eventWon = scoreEventWon(target.type === "direct" ? target.marketKey : target.eventKey, score, teams);
  if (typeof eventWon !== "boolean") return null;
  return target.side === "no" ? !eventWon : eventWon;
}

function targetProbability(target, grid, teams) {
  if (!grid.length) return null;
  const key = target.type === "direct" ? target.marketKey : target.eventKey;
  const probability = grid.reduce((sum, row) => sum + (scoreEventWon(key, row, teams) ? row.probability : 0), 0);
  return target.side === "no" ? 1 - probability : probability;
}

function scoreEventWon(key, score, teams = {}) {
  const favoriteSide = teams.favoriteSide ?? "home";
  const favoriteGoals = favoriteSide === "home" ? score.home : score.away;
  const underdogGoals = favoriteSide === "home" ? score.away : score.home;
  const margin = favoriteGoals - underdogGoals;
  const total = score.home + score.away;
  switch (key) {
    case "favorite_win": return margin > 0;
    case "draw": return margin === 0;
    case "underdog_win": return margin < 0;
    case "favorite_minus_1_5": return margin >= 2;
    case "favorite_minus_2_5": return margin >= 3;
    case "over_2_5": return total >= 3;
    case "over_3_5": return total >= 4;
    case "favorite_over_1_5": return favoriteGoals >= 2;
    case "underdog_over_0_5": return underdogGoals >= 1;
    case "btts_yes": return score.home >= 1 && score.away >= 1;
    case "favorite_exactly_2": return margin === 2;
    case "total_exactly_3": return total === 3;
    default: return null;
  }
}

function targetLabel(target, teams = {}) {
  const favorite = teams.favorite ?? "Favorite";
  const underdog = teams.underdog ?? "Underdog";
  const labels = {
    favorite_win: `${favorite} 90分钟胜`,
    draw: "90分钟平局",
    underdog_win: `${underdog} 90分钟胜`,
    favorite_minus_1_5: `${favorite} -1.5`,
    favorite_minus_2_5: `${favorite} -2.5`,
    over_2_5: "全场 O2.5",
    over_3_5: "全场 O3.5",
    favorite_over_1_5: `${favorite} O1.5`,
    underdog_over_0_5: `${underdog} O0.5`,
    btts_yes: "BTTS Yes",
    favorite_exactly_2: `${favorite}净胜恰好2球`,
    total_exactly_3: "全场恰好3球",
  };
  const key = target.type === "direct" ? target.marketKey : target.eventKey;
  return `${labels[key] ?? key}${target.side === "no" ? " NO" : ""}`;
}

function settleUnitStake({ price, won, feeRate }) {
  const feePaid = Number(feeRate ?? DEFAULT_FEE_RATE) * (1 - price);
  const shares = (1 - feePaid) / price;
  return {
    feePaid,
    winningPayout: shares,
    realizedPnl: won ? shares - 1 : -1,
  };
}

function resolveMatchQuality(movement) {
  const movementReadiness = movement.dataQuality?.readiness ?? movement.assistantView?.readiness ?? "review";
  const structureReadiness = movement.marketStructure?.quality?.readiness ?? "review";
  const readiness = [movementReadiness, structureReadiness].includes("blocked")
    ? "blocked"
    : [movementReadiness, structureReadiness].includes("review") ? "review" : "ready";
  return {
    readiness,
    movementReadiness,
    structureReadiness,
    issues: [
      ...(movement.dataQuality?.issues ?? []),
      ...(movement.marketStructure?.quality?.issues ?? []),
    ],
  };
}

function resolveSignalQuality({ movement, item, window }) {
  const issues = [];
  const structure = movement.marketStructure;
  const keyMarkets = structure?.keyMarkets ?? [];
  const rows = movement.rows ?? [];
  const globalBlocking = [
    ...(movement.dataQuality?.issues ?? []),
    ...(structure?.quality?.issues ?? []),
  ].filter((issue) => issue.severity === "high");
  if (globalBlocking.length) issues.push(...globalBlocking.map((issue) => issue.code));

  for (const key of item.requiredKeys ?? []) {
    const keyMarket = keyMarkets.find((market) => market.key === key);
    if (!keyMarket?.prices?.[window.from] || !keyMarket?.prices?.[window.to]) {
      issues.push(`missing_stage_price:${key}`);
      continue;
    }
    const row = rows.find((candidate) => (
      candidate.marketSlug === keyMarket.marketSlug
      || String(candidate.tokenId ?? "") === String(keyMarket.tokenId ?? "")
    ));
    if (!row || row.movement?.quality?.status !== "usable") {
      issues.push(`unusable_contract:${key}`);
      continue;
    }
    if (window.from === "opening") {
      if (row.openingCoverage?.status !== "near_market_creation") issues.push(`opening_not_confirmed:${key}`);
      if ((row.movement?.quality?.warnings ?? []).length) issues.push(`opening_history_warning:${key}`);
    } else if (hasLargeStepInside(row.history, keyMarket.prices[window.from].timestamp, keyMarket.prices[window.to].timestamp)) {
      issues.push(`large_step_inside_window:${key}`);
    }
  }

  const hasBlockingRowIssue = issues.some((issue) => (
    issue.startsWith("missing_stage_price") || issue.startsWith("unusable_contract")
  ));
  return {
    readiness: globalBlocking.length || hasBlockingRowIssue
      ? "blocked"
      : issues.length ? "review" : "ready",
    issues,
  };
}

function hasLargeStepInside(history, startTimestamp, endTimestamp) {
  const points = (Array.isArray(history) ? history : [])
    .filter((point) => point.timestamp >= startTimestamp && point.timestamp <= endTimestamp)
    .sort((a, b) => a.timestamp - b.timestamp);
  for (let index = 1; index < points.length; index += 1) {
    if (Math.abs(points[index].price - points[index - 1].price) >= 0.35) return true;
  }
  return false;
}

function observation(code, requiredKeys, delta) {
  return {
    code,
    requiredKeys,
    deltas: Object.fromEntries(requiredKeys.map((key) => [key, delta[key]])),
    direction: "yes",
  };
}

function values(source, keys) {
  return keys.map((key) => source[key]);
}

function changePp(from, to) {
  return Number.isFinite(from) && Number.isFinite(to) ? round((to - from) * 100, 3) : null;
}

function compareChronological(a, b) {
  return Date.parse(a.kickoffTime ?? "") - Date.parse(b.kickoffTime ?? "") || a.matchId.localeCompare(b.matchId);
}

function maxDrawdown(rows) {
  let cumulative = 0;
  let peak = 0;
  let drawdown = 0;
  for (const row of [...rows].sort(compareChronological)) {
    cumulative += row.realizedPnl;
    peak = Math.max(peak, cumulative);
    drawdown = Math.max(drawdown, peak - cumulative);
  }
  return round(drawdown, 4);
}

function wilsonInterval(wins, count) {
  if (!count) return { low: null, high: null };
  const z = 1.96;
  const p = wins / count;
  const denominator = 1 + z ** 2 / count;
  const center = (p + z ** 2 / (2 * count)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z ** 2 / (4 * count)) / count) / denominator;
  return { low: round(Math.max(0, center - margin), 4), high: round(Math.min(1, center + margin), 4) };
}

function poisson(k, lambda) {
  let probability = Math.exp(-lambda);
  for (let index = 1; index <= k; index += 1) probability *= lambda / index;
  return probability;
}

function dixonColesTau(home, away, lambda, mu, rho) {
  if (home === 0 && away === 0) return 1 - lambda * mu * rho;
  if (home === 0 && away === 1) return 1 + lambda * rho;
  if (home === 1 && away === 0) return 1 + mu * rho;
  if (home === 1 && away === 1) return 1 - rho;
  return 1;
}

function average(values) {
  const finiteValues = values.filter(Number.isFinite);
  return finiteValues.length ? round(finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length, 4) : null;
}

function ratio(numerator, denominator) {
  return denominator ? round(numerator / denominator, 4) : null;
}

function allFinite(...valuesToCheck) {
  return valuesToCheck.every(Number.isFinite);
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function roundOrNull(value, digits = 4) {
  return Number.isFinite(value) ? round(value, digits) : null;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}
