export async function fetchModelPredictions(matches) {
  const entries = await Promise.all(
    matches.map(async (match) => {
      const params = new URLSearchParams({
        home: match.modelHome,
        away: match.modelAway,
        venue: match.modelVenue ?? "neutral",
      });
      const response = await fetch(`/api/predict?${params.toString()}`);

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? `Prediction API failed with ${response.status}`);
      }

      return [match.id, await response.json()];
    }),
  );

  return Object.fromEntries(entries);
}

export async function fetchDashboardMatches() {
  const response = await fetch("/api/matches?include=prediction");

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? `Matches API failed with ${response.status}`);
  }

  const payload = await response.json();
  return payload.matches;
}

export async function fetchPolymarketAccount(address, options = {}) {
  const params = new URLSearchParams({
    address,
    limit: String(options.limit ?? 100),
    scenarioMaxGoals: String(options.scenarioMaxGoals ?? 6),
  });
  const response = await fetch(`/api/polymarket/account?${params.toString()}`);

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? `Polymarket account API failed with ${response.status}`);
  }

  const payload = await response.json();
  return payload.account;
}

export async function fetchModelTrackRecord() {
  const response = await fetch("/api/model-track-record");

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? `Model track record API failed with ${response.status}`);
  }

  const payload = await response.json();
  return payload.trackRecord;
}

export async function fetchPolymarketMovementEvents() {
  const response = await fetch("/api/polymarket/movement/events");
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? `Polymarket movement events API failed with ${response.status}`);
  }
  const payload = await response.json();
  return Array.isArray(payload.events) ? payload.events : [];
}

export async function fetchPolymarketBacktest() {
  const response = await fetch("/api/polymarket/backtest");
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? `Polymarket backtest API failed with ${response.status}`);
  }
  const payload = await response.json();
  return payload.backtest;
}

export async function fetchPolymarketMovement(eventSlug, options = {}) {
  const suffix = options.assistantView ? "?view=assistant" : "";
  const response = await fetch(`/api/polymarket/movement/events/${encodeURIComponent(eventSlug)}${suffix}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? `Polymarket movement API failed with ${response.status}`);
  }
  const payload = await response.json();
  return payload.movement;
}

export async function refreshPolymarketMovement(eventSlug, options = {}) {
  const response = await fetch("/api/admin/polymarket/movement/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventSlug,
      historyMode: options.historyMode ?? "lifecycle",
      lookbackDays: options.lookbackDays,
      fidelity: options.fidelity ?? 15,
      allCategories: Boolean(options.allCategories),
      limit: options.limit ?? 120,
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? `Polymarket movement refresh failed with ${response.status}`);
  }
  const payload = await response.json();
  return payload.movement;
}

export function mergeModelPrediction(match, prediction) {
  const safeMatch = withSafeDetailFields(match);

  if (!prediction) {
    if (safeMatch.predictionStatus?.available === false) {
      return {
        ...safeMatch,
        modelRuntime: "unavailable",
        modelSourceLabel: "模型待覆盖",
        recommendation: "模型待覆盖",
        confidence: "--",
        confidenceScore: 0,
        confidenceCopy: "这场比赛已进入官方赛程，但当前基础模型还没有覆盖其中至少一支球队。",
        probabilities: [
          { label: "待", value: 0, type: "home", pending: true },
          { label: "覆盖", value: 0, type: "draw", pending: true },
          { label: "中", value: 0, type: "away", pending: true },
        ],
        scores: [
          { line: "待模型", probability: "补齐球队评级后生成" },
          { line: "-", probability: "暂无比分倾向" },
          { line: "-", probability: "暂无期望进球" },
        ],
        aiBrief: buildUnavailableBrief(safeMatch),
        scoreRange: "模型待覆盖",
        backtest: "该场暂未纳入模型",
      };
    }

    return {
      ...safeMatch,
      modelRuntime: "mock",
      modelSourceLabel: "演示数据 fallback",
    };
  }

  const probabilityPercent = prediction.probabilityPercent ?? {};
  const scorelines = Array.isArray(prediction.scorelines) ? prediction.scorelines : safeMatch.scores;
  const scoreRange = scorelines
    .slice(0, 2)
    .map((scoreline) => scoreline.line)
    .join(" / ");

  return {
    ...safeMatch,
    modelPrediction: prediction,
    modelRuntime: "live",
    modelSourceLabel: "预测系统",
    recommendation: prediction.recommendation?.label ?? safeMatch.recommendation,
    confidence: String(prediction.confidence?.score ?? safeMatch.confidenceScore),
    confidenceScore: prediction.confidence?.score ?? safeMatch.confidenceScore,
    confidenceCopy: "当前赛前判断较集中，但足球比赛波动较高，结果仍存在不确定性。",
    probabilities: [
      { ...safeMatch.probabilities[0], value: probabilityPercent.homeWin ?? safeMatch.probabilities[0].value },
      { ...safeMatch.probabilities[1], value: probabilityPercent.draw ?? safeMatch.probabilities[1].value },
      { ...safeMatch.probabilities[2], value: probabilityPercent.awayWin ?? safeMatch.probabilities[2].value },
    ],
    scores: scorelines.map((scoreline) => ({
      line: scoreline.line,
      probability: scoreline.probabilityPercent == null ? scoreline.probability : `${scoreline.probabilityPercent}%`,
    })),
    aiBrief: buildModelBrief(safeMatch, prediction),
    scoreRange,
    model: prediction.model?.engine ?? safeMatch.model,
    backtest: prediction.model?.backtest?.accuracy == null
      ? safeMatch.backtest
      : `历史表现 ${(prediction.model.backtest.accuracy * 100).toFixed(1)}%`,
    compare: safeMatch.compare.map((row) =>
      row.label.includes("实力评分")
        ? {
            ...row,
            home: String(prediction.teams?.home?.elo ?? row.home),
            away: String(prediction.teams?.away?.elo ?? row.away),
          }
        : row,
    ),
    changes: safeMatch.changes,
  };
}

function withSafeDetailFields(match) {
  return {
    ...match,
    probabilities: ensureArray(match?.probabilities, defaultProbabilities),
    scores: ensureArray(match?.scores, defaultScores),
    variables: ensureArray(match?.variables, defaultVariables),
    radar: Array.isArray(match?.radar) ? match.radar : defaultRadar,
    changes: ensureArray(match?.changes, defaultChanges),
    script: ensureArray(match?.script, defaultScript),
    compare: ensureArray(match?.compare, defaultCompare),
    models: ensureArray(match?.models, defaultModels),
    lineupIntel: ensureLineupIntel(match?.lineupIntel),
    confidence: match?.confidence ?? "60",
    confidenceScore: Number(match?.confidenceScore ?? match?.confidence ?? 60),
    confidenceCopy: match?.confidenceCopy ?? "赛前信息仍在更新，模型结果仅作为概率参考。",
    aiBrief: match?.aiBrief ?? "赛程已同步，赛前变量将在后续数据源接入后补充。",
    scoreRange: match?.scoreRange ?? "待模型输出",
  };
}

function ensureArray(value, fallback) {
  return Array.isArray(value) && value.length > 0 ? value : fallback;
}

function ensureLineupIntel(value = {}) {
  return {
    policy: value.policy ?? "official_and_expected_only",
    appliesToModel: Boolean(value.appliesToModel),
    displayMode: value.displayMode ?? "pending",
    official: ensureLineupSource(value.official, {
      label: "官方首发",
      sourceType: "official",
      status: "not_released",
      confidence: "pending",
    }),
    expected: ensureLineupSource(value.expected, {
      label: "预计首发",
      sourceType: "expected",
      status: "not_ready",
      confidence: "pending",
    }),
  };
}

function ensureLineupSource(value = {}, fallback) {
  return {
    label: value.label ?? fallback.label,
    sourceType: value.sourceType ?? fallback.sourceType,
    status: value.status ?? fallback.status,
    confidence: value.confidence ?? fallback.confidence,
    sourceId: value.sourceId ?? null,
    sourceUrl: value.sourceUrl ?? null,
    retrievedAt: value.retrievedAt ?? null,
    reviewedAt: value.reviewedAt ?? null,
    note: value.note ?? "",
    home: ensureTeamLineup(value.home),
    away: ensureTeamLineup(value.away),
  };
}

function ensureTeamLineup(value = {}) {
  return {
    formation: value.formation ?? null,
    starters: Array.isArray(value.starters) ? value.starters : [],
    substitutes: Array.isArray(value.substitutes) ? value.substitutes : [],
    unavailable: Array.isArray(value.unavailable) ? value.unavailable : [],
  };
}

const defaultProbabilities = [
  { label: "胜", value: 34, type: "home" },
  { label: "平", value: 32, type: "draw" },
  { label: "胜", value: 34, type: "away" },
];

const defaultScores = [
  { line: "1-1", probability: "待模型" },
  { line: "1-0", probability: "待模型" },
  { line: "0-1", probability: "待模型" },
];

const defaultVariables = [
  { icon: "dataset", title: "官方赛程", copy: "赛程来自 FIFA 官方数据源。", impact: 0 },
  { icon: "sports_soccer", title: "基础模型", copy: "当前先使用 Elo + Dixon-Coles 生成赛前概率。", impact: 0 },
  { icon: "cloud", title: "天气场地", copy: "天气与场地变量尚未接入。", impact: 0 },
];

const defaultRadar = [];
const legacyDefaultRadar = [
  { label: "进攻火力", value: 60 },
  { label: "防守稳固", value: 60 },
  { label: "状态稳定", value: 60 },
  { label: "伤病影响", value: 50 },
  { label: "战术执行", value: 60 },
  { label: "临场应变", value: 60 },
];

const defaultChanges = [
  { time: "官方", copy: "已接入 FIFA 官方赛程同步", delta: "", direction: "flat" },
  { time: "赛前", copy: "天气、伤停、阵容数据源待接入", delta: "", direction: "flat" },
];

const defaultScript = [
  "这场比赛已进入官方赛程同步范围。",
  "当前概率来自基础统计模型，后续会补充天气、阵容、伤停和赔率基线。",
];

const defaultCompare = [
  { label: "实力评分", home: "待模型", away: "待模型" },
  { label: "数据源", home: "FIFA", away: "" },
  { label: "赛前变量", home: "待接入", away: "" },
];

const defaultModels = [
  { name: "官方赛程", signal: "已同步", metric: "FIFA" },
  { name: "统计模型", signal: "基础概率", metric: "已启用" },
  { name: "赛前变量", signal: "待接入", metric: "天气/伤停/阵容" },
];

function buildModelBrief(match, prediction) {
  return `预测系统给出 ${match.home.name} 胜 ${prediction.probabilityPercent.homeWin}%、平 ${prediction.probabilityPercent.draw}%、${match.away.name} 胜 ${prediction.probabilityPercent.awayWin}%。期望进球为 ${prediction.expectedGoals.home} - ${prediction.expectedGoals.away}，比分倾向集中在 ${prediction.scorelines
    .slice(0, 3)
    .map((scoreline) => scoreline.line)
    .join("、")}。这不是投注建议，只是当前赛前信息下的概率参考。`;
}

function buildUnavailableBrief(match) {
  const unsupported = match.predictionStatus?.unsupportedTeams?.join("、") || "部分球队";
  return `${match.home.name} vs ${match.away.name} 已来自 FIFA 官方赛程同步，但当前 Elo + Dixon-Coles 基础模型尚未覆盖 ${unsupported}。因此这里先展示赛程与情报占位，不生成胜平负概率。`;
}
