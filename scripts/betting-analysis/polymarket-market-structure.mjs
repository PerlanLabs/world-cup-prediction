const STAGES = [
  { key: "opening", label: "最早可得" },
  { key: "d7", label: "7天前" },
  { key: "h72", label: "72小时前" },
  { key: "h24", label: "24小时前" },
  { key: "h6", label: "6小时前" },
  { key: "h1", label: "1小时前" },
  { key: "close", label: "封盘" },
];

export function buildPolymarketMarketStructure({ rows = [], event = null, cutoffTs = null } = {}) {
  const baseTeams = resolveTeams(event, rows);
  const stageStructures = Object.fromEntries(STAGES.map((stage) => [
    stage.key,
    buildStageStructure(rows, baseTeams, stage.key),
  ]));
  const teams = resolveFavorite(baseTeams, stageStructures.close?.moneyline ?? stageStructures.opening?.moneyline);
  const keyMarkets = buildKeyMarketTimelines(rows, teams);
  const comparison = compareOpeningAndClose(stageStructures.opening, stageStructures.close, keyMarkets, teams);
  const signals = buildStructureSignals(comparison, teams);
  const quality = buildStructureQuality({ rows, stageStructures, keyMarkets });

  return {
    schemaVersion: "polymarket-market-structure/v1",
    generatedAt: new Date().toISOString(),
    event: {
      id: event?.id ?? null,
      slug: event?.slug ?? null,
      title: event?.title ?? null,
      kickoffTime: Number.isFinite(Number(cutoffTs))
        ? new Date(Number(cutoffTs) * 1000).toISOString()
        : event?.start_time ?? null,
    },
    teams,
    stages: STAGES,
    stageStructures,
    keyMarkets,
    comparison,
    signals,
    quality,
    interpretationContract: {
      fact: "Observed fixed-contract prices and deterministic derived probabilities.",
      interpretation: "A probability-distribution reading supported by multiple related contracts.",
      hypothesis: "A possible mechanism such as news, order flow, or market making; not proven by prices alone.",
      unsupported: "Bookmaker intent, deliberate trapping, inside information, or a guaranteed result.",
    },
  };
}

function buildStageStructure(rows, teams, stageKey) {
  const stageRows = rows
    .map((row) => ({ row, point: priceAtStage(row, stageKey) }))
    .filter((entry) => Number.isFinite(entry.point?.price));
  const moneyline = buildMoneyline(stageRows, teams);
  const margin = buildMarginDistribution(stageRows, teams, moneyline);
  const totalGoals = buildGoalDistribution(stageRows, { category: "totals" });
  const homeGoals = buildGoalDistribution(stageRows, { category: "team_totals", team: teams.home });
  const awayGoals = buildGoalDistribution(stageRows, { category: "team_totals", team: teams.away });

  return {
    stage: stageKey,
    availableMarketCount: stageRows.length,
    moneyline,
    margin,
    totalGoals,
    teamGoals: {
      home: homeGoals,
      away: awayGoals,
    },
    bttsYes: stageSelectionPrice(stageRows, "both_teams_to_score", "Yes"),
    teamToAdvance: stageRows
      .filter(({ row }) => row.category === "team_to_advance")
      .map(({ row, point }) => ({ selection: row.outcome ?? row.selection, price: round(point.price, 6) })),
  };
}

function buildMoneyline(stageRows, teams) {
  const raw = {
    home: findStagePrice(stageRows, (row) => row.category === "moneyline" && teamMatches(row, teams.home, "home")),
    draw: findStagePrice(stageRows, (row) => row.category === "moneyline" && isDraw(row)),
    away: findStagePrice(stageRows, (row) => row.category === "moneyline" && teamMatches(row, teams.away, "away")),
  };
  const values = [raw.home, raw.draw, raw.away];
  if (!values.every(Number.isFinite)) return { raw, normalized: raw, overround: null };
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    raw,
    normalized: {
      home: round(raw.home / sum, 6),
      draw: round(raw.draw / sum, 6),
      away: round(raw.away / sum, 6),
    },
    overround: round(sum - 1, 6),
  };
}

function buildMarginDistribution(stageRows, teams, moneyline) {
  const normalized = moneyline.normalized ?? {};
  const homeCurve = buildMarginTail(stageRows, teams.home, normalized.home);
  const awayCurve = buildMarginTail(stageRows, teams.away, normalized.away);
  const drawProbability = finite(normalized.draw);
  if (!homeCurve.points.length || !awayCurve.points.length || !Number.isFinite(drawProbability)) {
    return {
      available: false,
      homeTail: homeCurve,
      awayTail: awayCurve,
      drawProbability,
      masses: [],
    };
  }

  const masses = [
    ...tailMasses(awayCurve.points).map((entry) => ({ margin: -entry.threshold, probability: entry.probability })),
    { margin: 0, probability: drawProbability },
    ...tailMasses(homeCurve.points).map((entry) => ({ margin: entry.threshold, probability: entry.probability })),
  ].sort((a, b) => a.margin - b.margin);
  const normalizedMasses = normalizeMasses(masses);
  const quality = combinedCurveQuality(homeCurve, awayCurve);
  return {
    available: true,
    quality,
    homeTail: homeCurve,
    awayTail: awayCurve,
    drawProbability,
    masses: normalizedMasses,
    medianMargin: discreteQuantile(normalizedMasses, "margin", 0.5),
    modalMargin: modalValue(normalizedMasses, "margin"),
    truncatedExpectedMargin: weightedMean(normalizedMasses, "margin"),
    homeWinBy2Plus: probabilityAtThreshold(homeCurve.points, 2),
    homeWinBy3Plus: probabilityAtThreshold(homeCurve.points, 3),
    awayWinBy2Plus: probabilityAtThreshold(awayCurve.points, 2),
    awayWinBy3Plus: probabilityAtThreshold(awayCurve.points, 3),
  };
}

function buildMarginTail(stageRows, team, winProbability) {
  const rawPoints = [];
  if (Number.isFinite(winProbability)) rawPoints.push({ threshold: 1, probability: winProbability, source: "moneyline" });
  for (const { row, point } of stageRows) {
    if (row.category !== "spreads" || !teamMatches(row, team)) continue;
    const line = Number(row.line);
    if (!Number.isFinite(line) || line >= 0) continue;
    rawPoints.push({
      threshold: Math.floor(Math.abs(line)) + 1,
      probability: point.price,
      source: row.marketSlug,
    });
  }
  return normalizeTailCurve(rawPoints);
}

function buildGoalDistribution(stageRows, { category, team = null }) {
  const rawPoints = [];
  for (const { row, point } of stageRows) {
    if (row.category !== category || !isOver(row)) continue;
    if (team && !teamMatches(row, team)) continue;
    const line = Number(row.line);
    if (!Number.isFinite(line)) continue;
    rawPoints.push({
      threshold: Math.floor(line) + 1,
      probability: point.price,
      source: row.marketSlug,
    });
  }
  const curve = normalizeTailCurve(rawPoints);
  if (!curve.points.length) return { available: false, ...curve, masses: [] };
  const points = curve.points[0].threshold === 0
    ? curve.points
    : [{ threshold: 0, probability: 1, rawProbability: 1, source: "identity" }, ...curve.points];
  const masses = normalizeMasses(tailMasses(points).map((entry) => ({
    goals: entry.threshold,
    probability: entry.probability,
  })));
  return {
    available: true,
    quality: curveQuality(curve),
    ...curve,
    points: points.slice(1),
    masses,
    medianGoals: discreteQuantile(masses, "goals", 0.5),
    modalGoals: modalValue(masses, "goals"),
    truncatedExpectedGoals: weightedMean(masses, "goals"),
    over1_5: probabilityAtThreshold(points, 2),
    over2_5: probabilityAtThreshold(points, 3),
    over3_5: probabilityAtThreshold(points, 4),
    over4_5: probabilityAtThreshold(points, 5),
  };
}

function normalizeTailCurve(rawPoints) {
  const byThreshold = new Map();
  for (const point of rawPoints) {
    if (!Number.isFinite(point.threshold) || !Number.isFinite(point.probability)) continue;
    byThreshold.set(point.threshold, point);
  }
  const sorted = [...byThreshold.values()].sort((a, b) => a.threshold - b.threshold);
  const adjusted = isotonicNonIncreasing(sorted.map((point) => clamp(point.probability, 0, 1)));
  let violationCount = 0;
  let maxAdjustment = 0;
  const points = sorted.map((point, index) => {
    const rawProbability = clamp(point.probability, 0, 1);
    const probability = adjusted[index];
    if (index > 0 && sorted[index - 1].probability < rawProbability) violationCount += 1;
    maxAdjustment = Math.max(maxAdjustment, Math.abs(probability - rawProbability));
    return {
      threshold: point.threshold,
      rawProbability: round(rawProbability, 6),
      probability: round(probability, 6),
      source: point.source,
    };
  });
  return {
    points,
    monotonicViolationCount: violationCount,
    maxIsotonicAdjustment: round(maxAdjustment, 6),
  };
}

export function isotonicNonIncreasing(values) {
  const blocks = values.map((value, index) => ({ start: index, end: index, weight: 1, value }));
  for (let index = 0; index < blocks.length - 1;) {
    if (blocks[index].value >= blocks[index + 1].value) {
      index += 1;
      continue;
    }
    const left = blocks[index];
    const right = blocks[index + 1];
    const weight = left.weight + right.weight;
    blocks.splice(index, 2, {
      start: left.start,
      end: right.end,
      weight,
      value: ((left.value * left.weight) + (right.value * right.weight)) / weight,
    });
    if (index > 0) index -= 1;
  }
  const output = new Array(values.length);
  for (const block of blocks) {
    for (let index = block.start; index <= block.end; index += 1) output[index] = round(block.value, 8);
  }
  return output;
}

function tailMasses(points) {
  return points.map((point, index) => ({
    threshold: point.threshold,
    probability: round(Math.max(0, point.probability - (points[index + 1]?.probability ?? 0)), 6),
  }));
}

function buildKeyMarketTimelines(rows, teams) {
  const definitions = [
    { key: "favorite_win", label: `${teams.favorite} 90分钟胜`, match: (row) => row.category === "moneyline" && teamMatches(row, teams.favorite, teams.favoriteSide) },
    { key: "draw", label: "90分钟平局", match: (row) => row.category === "moneyline" && isDraw(row) },
    { key: "underdog_win", label: `${teams.underdog} 90分钟胜`, match: (row) => row.category === "moneyline" && teamMatches(row, teams.underdog, teams.underdogSide) },
    { key: "favorite_minus_1_5", label: `${teams.favorite} -1.5`, match: (row) => row.category === "spreads" && teamMatches(row, teams.favorite) && Number(row.line) === -1.5 },
    { key: "favorite_minus_2_5", label: `${teams.favorite} -2.5`, match: (row) => row.category === "spreads" && teamMatches(row, teams.favorite) && Number(row.line) === -2.5 },
    { key: "over_2_5", label: "全场 O2.5", match: (row) => row.category === "totals" && isOver(row) && Number(row.line) === 2.5 },
    { key: "over_3_5", label: "全场 O3.5", match: (row) => row.category === "totals" && isOver(row) && Number(row.line) === 3.5 },
    { key: "favorite_over_1_5", label: `${teams.favorite} O1.5`, match: (row) => row.category === "team_totals" && teamMatches(row, teams.favorite) && isOver(row) && Number(row.line) === 1.5 },
    { key: "underdog_over_0_5", label: `${teams.underdog} O0.5`, match: (row) => row.category === "team_totals" && teamMatches(row, teams.underdog) && isOver(row) && Number(row.line) === 0.5 },
    { key: "btts_yes", label: "BTTS Yes", match: (row) => row.category === "both_teams_to_score" && String(row.selection ?? row.outcome).toLowerCase().includes("yes") },
  ];
  return definitions.map((definition) => {
    const row = rows.find(definition.match);
    if (!row) return { key: definition.key, label: definition.label, available: false, prices: {} };
    const prices = Object.fromEntries(STAGES.map((stage) => {
      const point = priceAtStage(row, stage.key);
      return [stage.key, Number.isFinite(point?.price) ? { price: round(point.price, 6), timestamp: point.timestamp } : null];
    }));
    return {
      key: definition.key,
      label: definition.label,
      available: true,
      category: row.category,
      marketSlug: row.marketSlug,
      tokenId: row.tokenId,
      prices,
      changes: {
        full: changeBetween(prices.opening, prices.close),
        d7: changeBetween(prices.d7, prices.close),
        h72: changeBetween(prices.h72, prices.close),
        h24: changeBetween(prices.h24, prices.close),
        h6: changeBetween(prices.h6, prices.close),
        h1: changeBetween(prices.h1, prices.close),
      },
      quality: row.movement?.quality ?? null,
      openingCoverage: row.openingCoverage ?? null,
    };
  });
}

function compareOpeningAndClose(opening, close, keyMarkets, teams) {
  const key = Object.fromEntries(keyMarkets.map((market) => [market.key, market]));
  return {
    teams,
    keyMarketLabels: Object.fromEntries(keyMarkets.map((market) => [market.key, market.label])),
    keyChanges: Object.fromEntries(keyMarkets.filter((market) => market.available).map((market) => [
      market.key,
      market.changes,
    ])),
    margin: compareDistribution(opening?.margin, close?.margin, [
      "medianMargin",
      "truncatedExpectedMargin",
      "homeWinBy2Plus",
      "homeWinBy3Plus",
      "awayWinBy2Plus",
      "awayWinBy3Plus",
    ]),
    totalGoals: compareDistribution(opening?.totalGoals, close?.totalGoals, [
      "medianGoals",
      "truncatedExpectedGoals",
      "over1_5",
      "over2_5",
      "over3_5",
      "over4_5",
    ]),
    homeGoals: compareDistribution(opening?.teamGoals?.home, close?.teamGoals?.home, [
      "medianGoals", "truncatedExpectedGoals", "over1_5", "over2_5",
    ]),
    awayGoals: compareDistribution(opening?.teamGoals?.away, close?.teamGoals?.away, [
      "medianGoals", "truncatedExpectedGoals", "over1_5", "over2_5",
    ]),
    lateAcceleration: Object.fromEntries(Object.entries(key).map(([marketKey, market]) => [
      marketKey,
      classifyAcceleration(market.changes),
    ])),
  };
}

function buildStructureSignals(comparison, teams) {
  const signals = [];
  const changes = comparison.keyChanges ?? {};
  const favoriteShift = sharedChanges(changes, ["favorite_win", "favorite_minus_1_5"]);
  const favoriteWin = favoriteShift.values?.[0];
  const favoriteBy2 = favoriteShift.values?.[1];
  const favoriteTail = sharedChanges(changes, ["favorite_minus_1_5", "favorite_minus_2_5"]);
  const favoriteTailBy2 = favoriteTail.values?.[0];
  const favoriteBy3 = favoriteTail.values?.[1];
  const scoringDriver = sharedChanges(changes, ["over_2_5", "favorite_over_1_5", "underdog_over_0_5"]);
  const over25 = scoringDriver.values?.[0];
  const favoriteOver15 = scoringDriver.values?.[1];
  const underdogOver05 = scoringDriver.values?.[2];
  const totalTail = sharedChanges(changes, ["over_2_5", "over_3_5"]);
  const totalOver25 = totalTail.values?.[0];
  const over35 = totalTail.values?.[1];

  if (allFinite(favoriteWin, favoriteBy2) && Math.abs(favoriteWin) <= 1 && favoriteBy2 >= 1) {
    signals.push(signal(
      "favorite_tail_strengthening",
      "局部强化",
      "medium",
      `${teams.favorite}普通胜率基本稳定，但净胜2球以上合约明显上涨。`,
      [`${windowLabel(favoriteShift.basis)} ${teams.favorite}胜 ${signed(favoriteWin)}pp`, `${teams.favorite} -1.5 ${signed(favoriteBy2)}pp`],
      "市场增加了大胜分支的权重，没有同步提高所有赢球路径。",
      favoriteShift.basis,
    ));
  } else if (allFinite(favoriteWin, favoriteBy2) && favoriteWin >= 2 && favoriteBy2 >= 2) {
    signals.push(signal(
      "broad_favorite_strengthening",
      "一致强化",
      "medium",
      `${teams.favorite}胜与净胜2球以上概率同步增强。`,
      [`${windowLabel(favoriteShift.basis)} ${teams.favorite}胜 ${signed(favoriteWin)}pp`, `${teams.favorite} -1.5 ${signed(favoriteBy2)}pp`],
      "赢球分布整体向主队方向移动。",
      favoriteShift.basis,
    ));
  }

  if (allFinite(favoriteTailBy2, favoriteBy3) && favoriteTailBy2 >= 1 && favoriteBy3 <= 0.5) {
    signals.push(signal(
      "two_goal_concentration",
      "区间集中",
      "medium",
      `${teams.favorite}净胜2球的权重增强，但3球以上尾部没有同步扩张。`,
      [`${windowLabel(favoriteTail.basis)} ${teams.favorite} -1.5 ${signed(favoriteTailBy2)}pp`, `${teams.favorite} -2.5 ${signed(favoriteBy3)}pp`],
      "变化更像集中在两球胜，而不是全面押注极端大胜。",
      favoriteTail.basis,
    ));
  } else if (allFinite(favoriteTailBy2, favoriteBy3) && favoriteTailBy2 >= 1 && favoriteBy3 >= 1) {
    signals.push(signal(
      "broad_blowout_tail_expansion",
      "尾部扩张",
      "medium",
      `${teams.favorite}净胜2球和3球以上合约同步增强。`,
      [`${windowLabel(favoriteTail.basis)} ${teams.favorite} -1.5 ${signed(favoriteTailBy2)}pp`, `${teams.favorite} -2.5 ${signed(favoriteBy3)}pp`],
      "大胜尾部整体变厚。",
      favoriteTail.basis,
    ));
  }

  if (allFinite(over25, favoriteOver15, underdogOver05) && over25 >= 2 && favoriteOver15 >= 2 && favoriteOver15 >= underdogOver05) {
    signals.push(signal(
      "home_scoring_drives_over",
      "一致强化",
      "high",
      `全场大球与${teams.favorite}至少2球同步上涨。`,
      [`${windowLabel(scoringDriver.basis)} O2.5 ${signed(over25)}pp`, `${teams.favorite} O1.5 ${signed(favoriteOver15)}pp`, `${teams.underdog} O0.5 ${signed(underdogOver05)}pp`],
      `大球变化主要由${teams.favorite}进球分支推动。`,
      scoringDriver.basis,
    ));
  } else if (allFinite(over25, underdogOver05) && over25 >= 2 && underdogOver05 >= 2) {
    signals.push(signal(
      "away_scoring_supports_over",
      "一致强化",
      "medium",
      `全场大球与${teams.underdog}进球概率同步上涨。`,
      [`${windowLabel(scoringDriver.basis)} O2.5 ${signed(over25)}pp`, `${teams.underdog} O0.5 ${signed(underdogOver05)}pp`],
      "大球变化包含客队进球贡献。",
      scoringDriver.basis,
    ));
  }

  if (allFinite(totalOver25, over35) && totalOver25 >= 2 && over35 <= 0.5) {
    signals.push(signal(
      "moderate_total_concentration",
      "区间集中",
      "medium",
      "O2.5上涨，但O3.5没有同步扩张。",
      [`${windowLabel(totalTail.basis)} O2.5 ${signed(totalOver25)}pp`, `O3.5 ${signed(over35)}pp`],
      "总进球概率更集中在3球附近，而非全面进入极端大球。",
      totalTail.basis,
    ));
  } else if (allFinite(totalOver25, over35) && totalOver25 >= 2 && over35 >= 1) {
    signals.push(signal(
      "broad_total_tail_expansion",
      "尾部扩张",
      "medium",
      "O2.5与O3.5在同一窗口同步上涨。",
      [`${windowLabel(totalTail.basis)} O2.5 ${signed(totalOver25)}pp`, `O3.5 ${signed(over35)}pp`],
      "总进球分布整体向更高区间移动，而非只集中在刚好3球。",
      totalTail.basis,
    ));
  }

  for (const [marketKey, acceleration] of Object.entries(comparison.lateAcceleration ?? {})) {
    if (acceleration.status !== "late_acceleration") continue;
    const market = comparison.keyMarketLabels?.[marketKey] ?? marketKey.replaceAll("_", " ");
    signals.push(signal(
      `late_acceleration_${marketKey}`,
      "临场加速",
      "medium",
      `${market}的主要变化集中在最后1小时。`,
      [`全期 ${signed(acceleration.full)}pp`, `最后1小时 ${signed(acceleration.h1)}pp`],
      "这是临场重新定价事实，不单独证明资金身份或消息来源。",
      "h1",
    ));
  }

  if (!signals.length) {
    signals.push(signal(
      "no_material_cross_market_shift",
      "变化有限",
      "high",
      "核心固定合约没有形成足够大的同步或背离信号。",
      [],
      "盘口变化暂不足以调整赛前判断。",
      null,
    ));
  }
  return signals;
}

function buildStructureQuality({ rows, stageStructures, keyMarkets }) {
  const curveSections = Object.values(stageStructures).flatMap((stage) => [
    stage.margin?.homeTail,
    stage.margin?.awayTail,
    stage.totalGoals,
    stage.teamGoals?.home,
    stage.teamGoals?.away,
  ]).filter(Boolean);
  const monotonicViolationCount = curveSections.reduce((sum, curve) => sum + Number(curve.monotonicViolationCount ?? 0), 0);
  const maxIsotonicAdjustment = Math.max(0, ...curveSections.map((curve) => Number(curve.maxIsotonicAdjustment ?? 0)));
  const availableKeyMarketCount = keyMarkets.filter((market) => market.available).length;
  const openingTimes = rows
    .map((row) => row.movement?.firstObserved?.timestamp)
    .filter(Number.isFinite);
  const openingTimeSpreadSeconds = openingTimes.length
    ? Math.max(...openingTimes) - Math.min(...openingTimes)
    : null;
  const issues = [];
  if (availableKeyMarketCount < 6) issues.push({ severity: "high", code: "insufficient_key_markets", count: 6 - availableKeyMarketCount });
  if (maxIsotonicAdjustment > 0.05) issues.push({ severity: "medium", code: "large_curve_consistency_adjustment", count: monotonicViolationCount });
  if (openingTimeSpreadSeconds > 24 * 60 * 60) issues.push({ severity: "medium", code: "asynchronous_opening_snapshot", count: openingTimeSpreadSeconds });
  return {
    readiness: issues.some((issue) => issue.severity === "high")
      ? "blocked"
      : issues.length ? "review" : "ready",
    availableKeyMarketCount,
    expectedKeyMarketCount: keyMarkets.length,
    monotonicViolationCount,
    maxIsotonicAdjustment: round(maxIsotonicAdjustment, 6),
    openingTimeSpreadSeconds,
    openingSnapshotPolicy: "Each fixed contract uses its own earliest available price; cross-sectional opening structure may be asynchronous.",
    issues,
  };
}

function compareDistribution(opening, close, fields) {
  const output = {
    available: Boolean(
      opening?.available
      && close?.available
      && opening?.quality?.status !== "review"
      && close?.quality?.status !== "review"
    ),
    openingQuality: opening?.quality ?? null,
    closeQuality: close?.quality ?? null,
  };
  for (const field of fields) {
    const from = finite(opening?.[field]);
    const to = finite(close?.[field]);
    output[field] = {
      opening: from,
      close: to,
      change: Number.isFinite(from) && Number.isFinite(to) ? round(to - from, 6) : null,
    };
  }
  return output;
}

function curveQuality(curve) {
  const maxAdjustment = Number(curve?.maxIsotonicAdjustment ?? 0);
  return {
    status: maxAdjustment > 0.05 ? "review" : "usable",
    monotonicViolationCount: Number(curve?.monotonicViolationCount ?? 0),
    maxIsotonicAdjustment: maxAdjustment,
  };
}

function combinedCurveQuality(...curves) {
  const qualities = curves.map(curveQuality);
  return {
    status: qualities.some((quality) => quality.status === "review") ? "review" : "usable",
    monotonicViolationCount: qualities.reduce((sum, quality) => sum + quality.monotonicViolationCount, 0),
    maxIsotonicAdjustment: Math.max(0, ...qualities.map((quality) => quality.maxIsotonicAdjustment)),
  };
}

function classifyAcceleration(changes) {
  const full = pp(changes?.full);
  const h1 = pp(changes?.h1);
  if (!Number.isFinite(full) || !Number.isFinite(h1)) return { status: "insufficient", full, h1 };
  const sameDirection = full === 0 || Math.sign(full) === Math.sign(h1);
  return {
    status: sameDirection && Math.abs(h1) >= 1 && Math.abs(h1) >= Math.max(1, Math.abs(full) * 0.4)
      ? "late_acceleration"
      : "no_late_acceleration",
    full,
    h1,
  };
}

function priceAtStage(row, stageKey) {
  const movement = row.movement;
  if (!movement) return null;
  if (stageKey === "opening") {
    const warnings = movement.quality?.warnings ?? [];
    if (warnings.includes("suspected_market_initialization_anchor") || warnings.includes("large_single_step_move")) return null;
    return movement.firstObserved ?? null;
  }
  if (stageKey === "close") return movement.preKickoff ?? null;
  return movement.windows?.[stageKey]?.anchor ?? null;
}

function stageSelectionPrice(stageRows, category, selection) {
  return findStagePrice(stageRows, (row) => (
    row.category === category
    && String(row.selection ?? row.outcome ?? "").toLowerCase().includes(selection.toLowerCase())
  ));
}

function findStagePrice(stageRows, predicate) {
  const entry = stageRows.find(({ row }) => predicate(row));
  return Number.isFinite(entry?.point?.price) ? round(entry.point.price, 6) : null;
}

function resolveTeams(event, rows) {
  const eventTeams = Array.isArray(event?.teams) ? event.teams : [];
  const home = eventTeams.find((team) => team.ordering === "home")?.name;
  const away = eventTeams.find((team) => team.ordering === "away")?.name;
  if (home && away) return { home, away };
  const moneyline = rows.filter((row) => row.category === "moneyline" && !isDraw(row));
  return {
    home: moneyline.find((row) => row.selectionLine === "home")?.selection ?? moneyline[0]?.selection ?? "Home",
    away: moneyline.find((row) => row.selectionLine === "away")?.selection ?? moneyline[1]?.selection ?? "Away",
  };
}

function resolveFavorite(teams, moneyline) {
  const home = finite(moneyline?.normalized?.home);
  const away = finite(moneyline?.normalized?.away);
  const favoriteSide = !Number.isFinite(home) || !Number.isFinite(away) || home >= away ? "home" : "away";
  const underdogSide = favoriteSide === "home" ? "away" : "home";
  return {
    ...teams,
    favoriteSide,
    underdogSide,
    favorite: teams[favoriteSide],
    underdog: teams[underdogSide],
  };
}

function teamMatches(row, team, selectionLine = null) {
  if (selectionLine) return row.selectionLine === selectionLine;
  const normalizedTeam = normalize(team);
  return [row.selection, row.outcome]
    .some((value) => normalize(value).includes(normalizedTeam));
}

function isDraw(row) {
  return row.selectionLine === "draw" || normalize(row.selection).includes("draw");
}

function isOver(row) {
  return normalize(row.selectionLine) === "over"
    || normalize(row.outcome) === "over"
    || normalize(row.selection).includes("over");
}

function probabilityAtThreshold(points, threshold) {
  const point = points.find((entry) => entry.threshold === threshold);
  return point ? point.probability : null;
}

function normalizeMasses(masses) {
  const total = masses.reduce((sum, entry) => sum + Math.max(0, entry.probability), 0);
  if (total <= 0) return masses;
  return masses.map((entry) => ({ ...entry, probability: round(Math.max(0, entry.probability) / total, 6) }));
}

function discreteQuantile(masses, field, quantile) {
  let cumulative = 0;
  for (const entry of masses) {
    cumulative += entry.probability;
    if (cumulative >= quantile) return entry[field];
  }
  return masses.at(-1)?.[field] ?? null;
}

function modalValue(masses, field) {
  if (!masses.length) return null;
  return masses.reduce((best, entry) => entry.probability > best.probability ? entry : best, masses[0])[field];
}

function weightedMean(masses, field) {
  if (!masses.length) return null;
  return round(masses.reduce((sum, entry) => sum + (entry[field] * entry.probability), 0), 4);
}

function changeBetween(from, to) {
  if (!Number.isFinite(from?.price) || !Number.isFinite(to?.price)) return null;
  return {
    fromPrice: from.price,
    toPrice: to.price,
    percentagePoints: round((to.price - from.price) * 100, 2),
  };
}

function pp(change) {
  return Number.isFinite(change?.percentagePoints) ? change.percentagePoints : null;
}

function signal(code, label, confidence, fact, evidence, interpretation, basis) {
  return {
    code,
    label,
    confidence,
    basis,
    fact,
    evidence,
    interpretation,
    hypothesis: "Possible causes include news, order flow, liquidity, or market-maker repricing; this dataset does not identify which cause is true.",
    unsupportedClaim: "This signal does not prove bookmaker intent, deliberate trapping, inside information, or the match result.",
  };
}

function sharedChanges(changes, keys) {
  for (const basis of ["d7", "h72", "h24", "h6", "h1", "full"]) {
    const values = keys.map((key) => pp(changes[key]?.[basis]));
    if (values.every(Number.isFinite)) return { basis, values };
  }
  return { basis: null, values: null };
}

function windowLabel(value) {
  return ({ d7: "7天", h72: "72小时", h24: "24小时", h6: "6小时", h1: "1小时", full: "全生命周期" })[value] ?? "共同窗口";
}

function signed(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `${value > 0 ? "+" : ""}${round(value, 2)}`;
}

function allFinite(...values) {
  return values.every(Number.isFinite);
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}
