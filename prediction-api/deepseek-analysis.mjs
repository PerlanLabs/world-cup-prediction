const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";

export async function maybeAttachDeepSeekAnalyses(payload, store, options = {}) {
  const apiKey = options.deepseekApiKey ?? process.env.DEEPSEEK_API_KEY;
  if (!apiKey || options.withAi !== true) return payload;

  const fetchImpl = options.fetchImpl ?? fetch;
  const latestPredictions = buildLatestPredictionIndex(store.predictions);
  const matchesById = new Map(store.matches.map((match) => [match.id, match]));
  const teamsById = new Map(store.teams.map((team) => [team.id, team]));
  const nextPayload = structuredClone(payload);
  const limit = toNumber(options.aiLimit) ?? nextPayload.matches.length;
  let generatedCount = 0;

  for (const item of nextPayload.matches) {
    if (generatedCount >= limit) break;
    if (item.status !== "available" || item.aiAnalysis?.text) continue;

    const match = matchesById.get(item.matchId);
    const prediction = latestPredictions.get(item.matchId);
    if (!match || !prediction) continue;

    const homeTeam = teamsById.get(match.homeTeamId);
    const awayTeam = teamsById.get(match.awayTeamId);
    if (!homeTeam || !awayTeam) continue;

    item.aiAnalysis = await generateDeepSeekStrategyAnalysis({
      match,
      homeTeam,
      awayTeam,
      prediction,
      polymarket: item,
    }, {
      apiKey,
      fetchImpl,
      baseUrl: options.deepseekBaseUrl,
      model: options.deepseekModel,
      generatedAt: options.fetchedAt ?? payload.fetchedAt ?? new Date().toISOString(),
    });
    generatedCount += 1;
  }

  nextPayload.ai = {
    provider: "deepseek",
    model: options.deepseekModel ?? DEFAULT_MODEL,
    generatedCount,
    generatedAt: options.fetchedAt ?? payload.fetchedAt ?? new Date().toISOString(),
  };

  return nextPayload;
}

export async function generateDeepSeekStrategyAnalysis(input, options = {}) {
  const apiKey = options.apiKey;
  if (!apiKey) {
    const error = new Error("DEEPSEEK_API_KEY is required for DeepSeek analysis generation.");
    error.code = "missing_deepseek_api_key";
    throw error;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? DEFAULT_MODEL;
  const baseUrl = (options.baseUrl ?? DEFAULT_DEEPSEEK_BASE_URL).replace(/\/$/, "");
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const strategyInput = buildStrategyInput(input);

  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: 420,
      messages: [
        {
          role: "system",
          content: [
            "你是世界杯预测产品里的 AI 分析模块。",
            "只能解释用户提供的结构化模型概率和 Polymarket 只读价格。",
            "不得编造概率、赔率、伤停、首发或来源。",
            "不得使用保证中奖、稳赚、下注指令等表达。",
            "输出中文，140 到 220 字，面向普通用户。",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify(strategyInput),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(`DeepSeek request failed with HTTP ${response.status}${body ? `: ${body.slice(0, 240)}` : ""}`);
    error.status = response.status;
    error.code = "deepseek_request_failed";
    throw error;
  }

  const body = await response.json();
  const text = sanitizeDeepSeekAnalysisText(body?.choices?.[0]?.message?.content?.trim());
  if (!text) {
    const error = new Error("DeepSeek response did not include message content.");
    error.code = "deepseek_empty_response";
    throw error;
  }

  return {
    provider: "deepseek",
    model,
    scope: "model_market",
    generatedAt,
    text,
    input: strategyInput,
    safety: {
      noTradingAction: true,
      noFabricatedFacts: true,
      sourceBounded: true,
    },
  };
}

export async function generateDeepSeekModelAnalysis(input, options = {}) {
  const apiKey = options.apiKey;
  if (!apiKey) {
    const error = new Error("DEEPSEEK_API_KEY is required for DeepSeek analysis generation.");
    error.code = "missing_deepseek_api_key";
    throw error;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? DEFAULT_MODEL;
  const baseUrl = (options.baseUrl ?? DEFAULT_DEEPSEEK_BASE_URL).replace(/\/$/, "");
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const modelInput = buildModelOnlyInput(input);

  const response = await fetchImpl(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.35,
      max_tokens: 360,
      messages: [
        {
          role: "system",
          content: [
            "你是世界杯预测产品里的 AI 分析模块。",
            "只能解释用户提供的结构化模型概率、期望进球、比分倾向、FIFA 排名和近期表现。",
            "不得编造 Polymarket、赔率、伤停、首发、天气或来源。",
            "不得使用保证中奖、稳赚、下注指令等表达。",
            "输出中文，120 到 200 字，面向普通用户。",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify(modelInput),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const error = new Error(`DeepSeek request failed with HTTP ${response.status}${body ? `: ${body.slice(0, 240)}` : ""}`);
    error.status = response.status;
    error.code = "deepseek_request_failed";
    throw error;
  }

  const body = await response.json();
  const text = sanitizeDeepSeekAnalysisText(body?.choices?.[0]?.message?.content?.trim());
  if (!text) {
    const error = new Error("DeepSeek response did not include message content.");
    error.code = "deepseek_empty_response";
    throw error;
  }

  return {
    provider: "deepseek",
    model,
    scope: "model_only",
    generatedAt,
    text,
    input: modelInput,
    safety: {
      noTradingAction: true,
      noFabricatedFacts: true,
      sourceBounded: true,
    },
  };
}

export function sanitizeDeepSeekAnalysisText(text) {
  if (!text) return text;
  return text
    .replaceAll("不构成任何下注建议", "不构成任何投注建议")
    .replaceAll("不构成下注建议", "不构成投注建议")
    .replaceAll("下注建议", "投注建议")
    .replaceAll("下注指令", "操作指令")
    .replaceAll("正边缘", "模型概率高于市场")
    .replaceAll("负边缘", "模型概率低于市场")
    .replaceAll("略有价值", "模型概率略高于市场")
    .replaceAll("有价值", "模型概率高于市场")
    .replaceAll("边缘", "概率差异")
    .replaceAll("下注", "投注")
    .replaceAll("下单", "操作");
}

function buildModelOnlyInput({ match, homeTeam, awayTeam, prediction, recentForm }) {
  return {
    matchId: match.id,
    fixture: `${homeTeam.name} vs ${awayTeam.name}`,
    status: match.status,
    sourceBoundary: "Model-only explanation. No odds, injuries, weather, or confirmed lineup data is provided.",
    teams: {
      home: {
        name: homeTeam.name,
        fifaRank: homeTeam.profile?.worldRanking?.rank ?? null,
        recentForm: recentForm?.home ?? null,
      },
      away: {
        name: awayTeam.name,
        fifaRank: awayTeam.profile?.worldRanking?.rank ?? null,
        recentForm: recentForm?.away ?? null,
      },
    },
    model: {
      probabilityPercent: prediction.probabilityPercent,
      expectedGoals: prediction.expectedGoals,
      scorelines: prediction.scorelines?.slice(0, 5),
      confidence: prediction.confidence,
      recommendation: prediction.recommendation,
    },
  };
}

function buildStrategyInput({ match, homeTeam, awayTeam, prediction, polymarket }) {
  const moneyline = (polymarket.moneyline ?? []).map((row) => {
    const modelProbability = row.type === "home"
      ? prediction.probabilityPercent?.homeWin
      : row.type === "draw"
        ? prediction.probabilityPercent?.draw
        : prediction.probabilityPercent?.awayWin;
    const marketProbability = row.impliedProbabilityPercent;
    return {
      type: row.type,
      label: row.label,
      modelProbabilityPercent: modelProbability,
      marketProbabilityPercent: marketProbability,
      edgePercentagePoints: modelProbability != null && marketProbability != null
        ? round(Number(modelProbability) - Number(marketProbability), 1)
        : null,
    };
  });
  const derivativeMarkets = (polymarket.derivativeMarkets ?? [])
    .filter((row) => row?.key && row.price != null)
    .slice(0, 12)
    .map((row) => ({
      key: row.key,
      type: row.type,
      label: row.label,
      side: row.side,
      line: row.line,
      price: row.price,
      marketProbabilityPercent: row.impliedProbabilityPercent,
      decimalOdds: row.decimalOdds,
    }));

  return {
    matchId: match.id,
    fixture: `${homeTeam.name} vs ${awayTeam.name}`,
    status: match.status,
    sourceBoundary: "Polymarket read-only public market data; not official odds; not betting advice.",
    model: {
      probabilityPercent: prediction.probabilityPercent,
      expectedGoals: prediction.expectedGoals,
      scorelines: prediction.scorelines?.slice(0, 5),
    },
    polymarket: {
      eventSlug: polymarket.eventSlug,
      eventTitle: polymarket.eventTitle,
      retrievedAt: polymarket.retrievedAt,
      moneyline,
      derivativeMarkets,
    },
  };
}

function buildLatestPredictionIndex(predictions) {
  const index = new Map();
  for (const prediction of [...predictions].sort((a, b) => a.generatedAt.localeCompare(b.generatedAt))) {
    index.set(prediction.matchId, prediction);
  }
  return index;
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
