const WDL_MARKETS = [
  { id: "home", type: "home", shortLabel: "主胜" },
  { id: "draw", type: "draw", shortLabel: "平局" },
  { id: "away", type: "away", shortLabel: "客胜" },
];

const PORTFOLIO_BLUEPRINT = [
  { role: "teamGoalOver05", baseUnits: 30 },
  { role: "plus15", baseUnits: 25 },
  { role: "bttsYes", baseUnits: 20 },
  { role: "over25", baseUnits: 15 },
  { role: "draw", baseUnits: 5 },
  { role: "sideWin", baseUnits: 5 },
];

export function buildStrategyAnalysis(match) {
  const modelRows = buildModelRows(match);
  const moneylineMarkets = normalizeSingleMatchMarkets(match);
  const derivativeMarkets = normalizeDerivativeMarkets(match);
  const trophySignals = buildTrophySignals(match);
  const scoreGrid = buildScoreGrid(match);
  const valueRows = buildValueRows(modelRows, moneylineMarkets);
  const valueSide = pickValueSide(valueRows, modelRows);
  const marketRows = buildMarketRows({
    match,
    modelRows,
    moneylineMarkets,
    derivativeMarkets,
    scoreGrid,
    valueSide,
  });
  const hasModel = modelRows.some((row) => Number.isFinite(row.modelProbability));
  const hasSingleMatchMarkets = moneylineMarkets.length > 0;
  const hasDerivativeMarkets = derivativeMarkets.length > 0;
  const portfolio = hasModel && hasSingleMatchMarkets
    ? buildPortfolio(marketRows, scoreGrid, match)
    : null;

  return {
    hasModel,
    hasSingleMatchMarkets,
    hasDerivativeMarkets,
    modelRows,
    moneylineMarkets,
    derivativeMarkets,
    trophySignals,
    valueRows,
    marketRows,
    portfolio,
    summary: buildStrategySummary(match, {
      hasModel,
      hasSingleMatchMarkets,
      hasDerivativeMarkets,
      modelRows,
      valueRows,
      marketRows,
      portfolio,
      trophySignals,
      valueSide,
    }),
    requirements: [
      "Polymarket 单场胜平负盘口",
      "Polymarket More Markets 衍生盘口",
      "模型比分分布与期望进球",
      "盘口更新时间、流动性和价差",
    ],
  };
}

function buildModelRows(match) {
  const probabilities = Array.isArray(match?.probabilities) ? match.probabilities : [];

  return WDL_MARKETS.map((market) => {
    const source = probabilities.find((row) => row.type === market.type);
    const modelProbability = toFiniteNumber(source?.pending ? null : source?.value);

    return {
      ...market,
      label: market.type === "home"
        ? `${match.home.name}胜`
        : market.type === "away"
          ? `${match.away.name}胜`
          : "平局",
      modelProbability,
    };
  });
}

function normalizeSingleMatchMarkets(match) {
  const source =
    match?.marketOdds?.polymarket?.moneyline ??
    match?.marketOdds?.moneyline ??
    match?.markets?.polymarket?.moneyline ??
    [];

  if (!Array.isArray(source)) return [];

  return source
    .map((row) => {
      const type = normalizeMarketType(row);
      const probability = toProbability(row);
      if (!type || probability == null) return null;

      return {
        type,
        key: type === "draw" ? "draw" : `${type}-win`,
        label: row.label ?? row.name ?? row.title ?? type,
        marketProbability: probability,
        price: toFiniteNumber(row.price),
        decimalOdds: toFiniteNumber(row.decimalOdds),
        sourceUrl: row.sourceUrl ?? null,
        updatedAt: row.updatedAt ?? row.retrievedAt ?? null,
      };
    })
    .filter(Boolean);
}

function normalizeDerivativeMarkets(match) {
  const source =
    match?.marketOdds?.polymarket?.derivativeMarkets ??
    match?.marketOdds?.derivativeMarkets ??
    [];

  if (!Array.isArray(source)) return [];

  return source
    .map((row) => {
      const probability = toProbability(row);
      const price = toFiniteNumber(row.price);
      if (!row.key || probability == null || price == null) return null;
      return {
        key: row.key,
        type: row.type,
        side: row.side ?? null,
        selection: row.selection,
        line: toFiniteNumber(row.line),
        label: row.label ?? row.key,
        marketProbability: probability,
        price,
        decimalOdds: toFiniteNumber(row.decimalOdds),
        liquidity: toFiniteNumber(row.liquidity),
        volume24hr: toFiniteNumber(row.volume24hr),
        sourceUrl: row.sourceUrl ?? null,
        updatedAt: row.updatedAt ?? row.retrievedAt ?? null,
      };
    })
    .filter(Boolean);
}

function normalizeMarketType(row) {
  const raw = String(row.type ?? row.id ?? row.outcome ?? row.side ?? "").toLowerCase();
  if (["home", "homewin", "home_win", "1"].includes(raw)) return "home";
  if (["draw", "x", "tie"].includes(raw)) return "draw";
  if (["away", "awaywin", "away_win", "2"].includes(raw)) return "away";
  return null;
}

function toProbability(row) {
  const percent = toFiniteNumber(row.impliedProbabilityPercent ?? row.probabilityPercent);
  if (percent != null) return percent;

  const probability = toFiniteNumber(row.impliedProbability ?? row.probability);
  if (probability == null) return null;
  return probability <= 1 ? round(probability * 100, 1) : probability;
}

function buildValueRows(modelRows, markets) {
  return modelRows.map((model) => {
    const market = markets.find((row) => row.type === model.type);
    return buildValueRow({
      ...model,
      marketProbability: toFiniteNumber(market?.marketProbability),
      price: market?.price ?? null,
      decimalOdds: market?.decimalOdds ?? null,
      source: "moneyline",
    });
  });
}

function buildValueRow(row) {
  const marketProbability = toFiniteNumber(row.marketProbability);
  const edge = row.modelProbability != null && marketProbability != null
    ? round(row.modelProbability - marketProbability, 1)
    : null;
  const ev = row.modelProbability != null && marketProbability
    ? round((row.modelProbability / marketProbability - 1) * 100, 1)
    : null;

  return {
    ...row,
    marketProbability,
    edge,
    ev,
    verdict: classifyValue(edge, ev),
  };
}

function classifyValue(edge, ev) {
  if (edge == null || ev == null) return "待盘口";
  if (edge >= 8 && ev >= 12) return "强价值";
  if (edge >= 3) return "有价值";
  if (edge >= 1) return "小价值";
  if (edge <= -6) return "偏贵";
  return "接近合理";
}

function pickValueSide(valueRows, modelRows) {
  const sideRows = valueRows
    .filter((row) => row.type === "home" || row.type === "away")
    .filter((row) => row.edge != null)
    .sort((a, b) => b.edge - a.edge);
  if (sideRows[0]?.edge > 0) return sideRows[0].type;

  const modelSideRows = modelRows
    .filter((row) => row.type === "home" || row.type === "away")
    .filter((row) => row.modelProbability != null)
    .sort((a, b) => a.modelProbability - b.modelProbability);
  return modelSideRows[0]?.type ?? "away";
}

function buildMarketRows({ match, modelRows, moneylineMarkets, derivativeMarkets, scoreGrid, valueSide }) {
  const side = valueSide;
  const sideTeam = side === "home" ? match.home : match.away;
  const sideWin = modelRows.find((row) => row.type === side);
  const draw = modelRows.find((row) => row.type === "draw");
  const rows = [
    buildCandidate({
      role: "teamGoalOver05",
      key: `${side}-over-0.5`,
      label: `${sideTeam.name}进球大 0.5`,
      category: "球队进球",
      source: findDerivative(derivativeMarkets, `${side}-over-0.5`),
      modelProbability: conditionProbability(scoreGrid, (score) => teamGoals(score, side) > 0),
      wins: (score) => teamGoals(score, side) > 0,
    }),
    buildCandidate({
      role: "plus15",
      key: `${side}+1.5`,
      label: `${sideTeam.name} +1.5`,
      category: "让球",
      source: findDerivative(derivativeMarkets, `${side}+1.5`),
      modelProbability: conditionProbability(scoreGrid, (score) => teamGoals(score, side) + 1.5 > opponentGoals(score, side)),
      wins: (score) => teamGoals(score, side) + 1.5 > opponentGoals(score, side),
    }),
    buildCandidate({
      role: "bttsYes",
      key: "btts-yes",
      label: "双方进球 Yes",
      category: "双方进球",
      source: findDerivative(derivativeMarkets, "btts-yes"),
      modelProbability: conditionProbability(scoreGrid, (score) => score.home > 0 && score.away > 0),
      wins: (score) => score.home > 0 && score.away > 0,
    }),
    buildCandidate({
      role: "over25",
      key: "total-over-2.5",
      label: "大 2.5 球",
      category: "大小球",
      source: findDerivative(derivativeMarkets, "total-over-2.5"),
      modelProbability: conditionProbability(scoreGrid, (score) => score.home + score.away > 2.5),
      wins: (score) => score.home + score.away > 2.5,
    }),
    buildCandidate({
      role: "draw",
      key: "draw",
      label: "平局",
      category: "胜平负",
      source: moneylineMarkets.find((row) => row.key === "draw"),
      modelProbability: draw?.modelProbability ?? null,
      wins: (score) => score.home === score.away,
    }),
    buildCandidate({
      role: "sideWin",
      key: `${side}-win`,
      label: `${sideTeam.name}胜`,
      category: "胜平负",
      source: moneylineMarkets.find((row) => row.key === `${side}-win`),
      modelProbability: sideWin?.modelProbability ?? null,
      wins: (score) => side === "home" ? score.home > score.away : score.away > score.home,
    }),
    buildCandidate({
      role: "teamGoalOver15",
      key: `${side}-over-1.5`,
      label: `${sideTeam.name}进球大 1.5`,
      category: "球队进球",
      source: findDerivative(derivativeMarkets, `${side}-over-1.5`),
      modelProbability: conditionProbability(scoreGrid, (score) => teamGoals(score, side) > 1.5),
      wins: (score) => teamGoals(score, side) > 1.5,
    }),
  ].filter(Boolean);

  return rows.filter((row) => row.modelProbability != null || row.marketProbability != null);
}

function buildCandidate({ source, modelProbability, wins, ...rest }) {
  return buildValueRow({
    ...rest,
    modelProbability: modelProbability == null ? null : round(modelProbability, 1),
    marketProbability: source?.marketProbability ?? null,
    price: source?.price ?? null,
    decimalOdds: source?.decimalOdds ?? null,
    liquidity: source?.liquidity ?? null,
    volume24hr: source?.volume24hr ?? null,
    updatedAt: source?.updatedAt ?? null,
    marketSource: source ? "polymarket" : "missing",
    wins,
  });
}

function findDerivative(markets, key) {
  return markets.find((row) => row.key === key) ?? null;
}

function buildPortfolio(marketRows, scoreGrid, match) {
  const byRole = new Map(marketRows.map((row) => [row.role, row]));
  const selected = PORTFOLIO_BLUEPRINT
    .map((item) => {
      const row = byRole.get(item.role);
      if (!isUsablePortfolioRow(row)) return null;
      return { ...row, targetUnits: item.baseUnits };
    })
    .filter(Boolean);

  const fallback = marketRows
    .filter(isUsablePortfolioRow)
    .filter((row) => !selected.some((item) => item.key === row.key))
    .sort((a, b) => (b.edge ?? -999) - (a.edge ?? -999))
    .slice(0, Math.max(0, 6 - selected.length))
    .map((row) => ({ ...row, targetUnits: 10 }));

  const rows = normalizeUnits([...selected, ...fallback].slice(0, 6));
  if (rows.length === 0) {
    return {
      status: "empty",
      title: "暂不生成组合",
      copy: "当前没有足够的真实单场盘口，先展示模型和市场差异。",
      rows: [],
      metrics: null,
      scoreRows: [],
    };
  }

  const scoredGrid = scoreGrid.map((score) => ({
    ...score,
    net: calculatePortfolioNet(rows, score),
  }));
  const metrics = buildPortfolioMetrics(scoredGrid);
  const scoreRows = buildScenarioRows(scoredGrid, match);

  return {
    status: "ready",
    title: "100u 模拟策略",
    copy: "按模型与 Polymarket 价差生成，仅用于模拟研究；不代表实际下注指令。",
    rows,
    metrics,
    scoreRows,
  };
}

function isUsablePortfolioRow(row) {
  return row?.price > 0 && row.modelProbability != null && row.marketProbability != null && row.edge >= 1;
}

function normalizeUnits(rows) {
  const total = rows.reduce((sum, row) => sum + row.targetUnits, 0);
  if (!total) return [];

  let used = 0;
  return rows.map((row, index) => {
    const units = index === rows.length - 1
      ? 100 - used
      : roundToFive((row.targetUnits / total) * 100);
    used += units;
    return {
      ...row,
      units,
      payoutOnWin: row.price > 0 ? round(units / row.price - units, 2) : null,
    };
  }).filter((row) => row.units > 0);
}

function calculatePortfolioNet(rows, score) {
  return round(rows.reduce((sum, row) => {
    if (row.wins(score)) return sum + (row.price > 0 ? row.units / row.price - row.units : 0);
    return sum - row.units;
  }, 0), 2);
}

function buildPortfolioMetrics(scoredGrid) {
  const totalProbability = scoredGrid.reduce((sum, row) => sum + row.probability, 0);
  if (!totalProbability) return null;

  const expectedNet = scoredGrid.reduce((sum, row) => sum + row.net * row.probability, 0) / totalProbability;
  const profitProbability = probabilityOf(scoredGrid, (row) => row.net > 0, totalProbability);
  const bigLossProbability = probabilityOf(scoredGrid, (row) => row.net <= -50, totalProbability);

  return {
    expectedNet: round(expectedNet, 1),
    profitProbability: round(profitProbability, 1),
    lossProbability: round(100 - profitProbability, 1),
    bigLossProbability: round(bigLossProbability, 1),
  };
}

function probabilityOf(rows, predicate, totalProbability) {
  return rows.filter(predicate).reduce((sum, row) => sum + row.probability, 0) / totalProbability * 100;
}

function buildScenarioRows(scoredGrid, match) {
  const modelScorelines = Array.isArray(match?.modelPrediction?.scorelines)
    ? match.modelPrediction.scorelines
    : Array.isArray(match?.latestPrediction?.scorelines)
      ? match.latestPrediction.scorelines
      : [];
  const byLine = new Map(scoredGrid.map((score) => [score.line, score]));
  const primary = modelScorelines
    .slice(0, 8)
    .map((item) => {
      const score = byLine.get(item.line) ?? parseScoreLine(item.line);
      if (!score) return null;
      const net = score.net ?? calculatePortfolioNet([], score);
      return {
        line: item.line,
        probabilityPercent: toFiniteNumber(item.probabilityPercent) ?? round(toFiniteNumber(item.probability) * 100, 1),
        net,
        tone: net >= 0 ? "positive" : "negative",
      };
    })
    .filter(Boolean);

  const risk = scoredGrid
    .filter((score) => score.net <= -40)
    .sort((a, b) => a.net - b.net)
    .slice(0, 4)
    .map((score) => ({
      line: score.line,
      probabilityPercent: score.probabilityPercent,
      net: score.net,
      tone: "negative",
    }));

  const positiveCommon = scoredGrid
    .filter((score) => score.net > 0)
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 6)
    .map((score) => ({
      line: score.line,
      probabilityPercent: score.probabilityPercent,
      net: score.net,
      tone: "positive",
    }));

  const merged = new Map();
  [...primary, ...positiveCommon, ...risk].forEach((row) => {
    if (!merged.has(row.line)) merged.set(row.line, row);
  });

  return [...merged.values()].slice(0, 12);
}

function buildScoreGrid(match) {
  const expectedGoals =
    match?.modelPrediction?.expectedGoals ??
    match?.latestPrediction?.expectedGoals ??
    null;

  if (expectedGoals?.home != null && expectedGoals?.away != null) {
    return buildPoissonGrid(Number(expectedGoals.home), Number(expectedGoals.away));
  }

  const scorelines =
    match?.modelPrediction?.scorelines ??
    match?.latestPrediction?.scorelines ??
    match?.scores ??
    [];

  return scorelines
    .map((row) => {
      const score = parseScoreLine(row.line);
      if (!score) return null;
      const probabilityPercent = toFiniteNumber(row.probabilityPercent) ?? parsePercent(row.probability);
      return {
        ...score,
        probability: probabilityPercent == null ? 0 : probabilityPercent / 100,
        probabilityPercent,
      };
    })
    .filter(Boolean);
}

function buildPoissonGrid(homeLambda, awayLambda) {
  const rows = [];
  for (let home = 0; home <= 7; home += 1) {
    for (let away = 0; away <= 7; away += 1) {
      const probability = poisson(home, homeLambda) * poisson(away, awayLambda);
      rows.push({
        home,
        away,
        line: `${home}-${away}`,
        probability,
        probabilityPercent: round(probability * 100, 1),
      });
    }
  }
  return rows.sort((a, b) => b.probability - a.probability);
}

function poisson(k, lambda) {
  return Math.exp(-lambda) * (lambda ** k) / factorial(k);
}

function factorial(value) {
  let result = 1;
  for (let index = 2; index <= value; index += 1) result *= index;
  return result;
}

function conditionProbability(scoreGrid, predicate) {
  const totalProbability = scoreGrid.reduce((sum, row) => sum + row.probability, 0);
  if (!totalProbability) return null;
  return scoreGrid.filter(predicate).reduce((sum, row) => sum + row.probability, 0) / totalProbability * 100;
}

function parseScoreLine(value) {
  const match = String(value ?? "").match(/^(\d+)-(\d+)$/);
  if (!match) return null;
  const home = Number(match[1]);
  const away = Number(match[2]);
  return { home, away, line: `${home}-${away}` };
}

function parsePercent(value) {
  if (typeof value === "string" && value.endsWith("%")) return toFiniteNumber(value.slice(0, -1));
  const number = toFiniteNumber(value);
  if (number == null) return null;
  return number <= 1 ? round(number * 100, 1) : number;
}

function teamGoals(score, side) {
  return side === "home" ? score.home : score.away;
}

function opponentGoals(score, side) {
  return side === "home" ? score.away : score.home;
}

function buildTrophySignals(match) {
  return [
    buildTrophySignal(match.home),
    buildTrophySignal(match.away),
  ].filter(Boolean);
}

function buildTrophySignal(team) {
  const signal = team?.profile?.marketSignals?.polymarket?.worldCupWinner;
  if (!signal) return null;

  return {
    team: team.name,
    flag: team.flag,
    probability: toFiniteNumber(signal.impliedProbabilityPercent),
    price: toFiniteNumber(signal.price),
    decimalOdds: toFiniteNumber(signal.decimalOdds),
    liquidity: toFiniteNumber(signal.liquidity),
    volume24hr: toFiniteNumber(signal.volume24hr),
  };
}

function buildStrategySummary(match, context) {
  if (!context.hasModel) {
    return {
      tone: "neutral",
      title: "模型待覆盖",
      copy: "这场比赛还没有可用的基础模型概率，因此不会生成策略参考。",
    };
  }

  const leader = [...context.modelRows]
    .filter((row) => row.modelProbability != null)
    .sort((a, b) => b.modelProbability - a.modelProbability)[0];

  if (!context.hasSingleMatchMarkets) {
    const marketCopy = context.trophySignals.length > 0
      ? "当前只有 Polymarket 冠军市场热度，不能直接当成本场盘口。"
      : "当前还没有同步到可用的 Polymarket 市场数据。";
    return {
      tone: "waiting",
      title: "等待单场盘口接入",
      copy: `模型主线是 ${leader.label} ${leader.modelProbability}%。${marketCopy}接入单场胜平负和 More Markets 后，才会生成组合推演。`,
    };
  }

  const best = [...context.marketRows]
    .filter((row) => row.edge != null)
    .sort((a, b) => b.edge - a.edge)[0];

  if (!best || best.edge < 1) {
    return {
      tone: "neutral",
      title: "市场与模型接近",
      copy: "当前单场盘口和模型概率差异不大，系统倾向观望。",
    };
  }

  const metrics = context.portfolio?.metrics;
  return {
    tone: best.edge >= 3 ? "positive" : "neutral",
    title: `${best.label} ${best.verdict}`,
    copy: metrics
      ? `模型概率 ${best.modelProbability}%，市场隐含概率 ${best.marketProbability}%，价差 ${best.edge} 个百分点。100u 模拟组合期望净收益 ${formatSigned(metrics.expectedNet)}u，盈利概率 ${metrics.profitProbability}%。`
      : `模型概率 ${best.modelProbability}%，市场隐含概率 ${best.marketProbability}%，价差 ${best.edge} 个百分点。`,
  };
}

function toFiniteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 1) {
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function roundToFive(value) {
  return Math.max(5, Math.round(value / 5) * 5);
}

function formatSigned(value) {
  return `${value > 0 ? "+" : ""}${value}`;
}
