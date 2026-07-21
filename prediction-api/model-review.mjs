#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getModelTrackRecord } from "./backend-service.mjs";
import { DEFAULT_PNL_ROOT } from "./pnl-core.mjs";

export const DEFAULT_MODEL_REVIEW_ROOT = join(DEFAULT_PNL_ROOT, "模型复盘");

export function generateModelReviewReports(options = {}) {
  const root = resolve(options.root ?? DEFAULT_MODEL_REVIEW_ROOT);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const trackRecord = options.trackRecord ?? getModelTrackRecord({ limit: options.limit ?? 1000 });
  const scoredRows = (trackRecord.rows ?? []).filter((row) => row.status === "scored");
  const generatedDir = join(root, "_generated");

  mkdirSync(generatedDir, { recursive: true });

  const cumulative = buildReviewPayload({
    title: "模型预测复盘",
    generatedAt,
    rows: scoredRows,
    policy: trackRecord.policy,
    model: trackRecord.model,
  });
  const cumulativeMarkdown = renderReviewMarkdown(cumulative);
  const cumulativeJsonPath = join(generatedDir, "cumulative-model-review.json");
  const cumulativeMarkdownPath = join(generatedDir, "cumulative-model-review.md");
  writeJson(cumulativeJsonPath, cumulative);
  writeFileSync(cumulativeMarkdownPath, cumulativeMarkdown, "utf8");

  const dailyReports = [];
  for (const [date, rows] of groupBy(scoredRows, (row) => row.date ?? dateFromIso(row.kickoffAt) ?? "unknown-date")) {
    const dayDir = join(root, date);
    mkdirSync(dayDir, { recursive: true });
    const daily = buildReviewPayload({
      title: `${date} 模型预测复盘`,
      generatedAt,
      rows,
      policy: trackRecord.policy,
      model: trackRecord.model,
    });
    const jsonPath = join(dayDir, "daily-model-review.json");
    const markdownPath = join(dayDir, "daily-model-review.md");
    writeJson(jsonPath, daily);
    writeFileSync(markdownPath, renderReviewMarkdown(daily), "utf8");
    dailyReports.push({ date, count: rows.length, jsonPath, markdownPath });
  }

  return {
    root,
    generatedAt,
    scoredCount: scoredRows.length,
    cumulative: {
      jsonPath: cumulativeJsonPath,
      markdownPath: cumulativeMarkdownPath,
    },
    dailyReports,
  };
}

function buildReviewPayload({ title, generatedAt, rows, policy, model }) {
  const summary = summarizeRows(rows);
  return {
    title,
    generatedAt,
    policy,
    model,
    summary,
    derivedMarketAccuracy: summarizeDerivedMarkets(rows),
    rows: rows.map(normalizeRow),
  };
}

function summarizeRows(rows) {
  const count = rows.length;
  const correct = rows.filter((row) => row.score?.pickedCorrect).length;
  const top1 = rows.filter((row) => row.score?.topScorelineHit).length;
  const top3 = rows.filter((row) => row.score?.top3ScorelineHit).length;
  const top5 = rows.filter((row) => row.score?.top5ScorelineHit).length;
  return {
    scoredCount: count,
    correctPicks: correct,
    accuracy: rate(correct, count),
    top1ScorelineHits: top1,
    top1ScorelineRate: rate(top1, count),
    top3ScorelineHits: top3,
    top3ScorelineRate: rate(top3, count),
    top5ScorelineHits: top5,
    top5ScorelineRate: rate(top5, count),
    averageActualOutcomeProbability: average(rows.map((row) => row.score?.actualProbability)),
    averageActualScorelineProbability: average(rows.map((row) => row.score?.actualScorelineProbability)),
    averageExactScoreLogLoss: average(rows.map((row) => row.score?.exactScoreLogLoss)),
    averageBrier: average(rows.map((row) => row.score?.brier)),
    averageRps: average(rows.map((row) => row.score?.rps)),
  };
}

function summarizeDerivedMarkets(rows) {
  const byMarket = new Map();
  for (const row of rows) {
    for (const market of row.score?.derivedMarkets ?? []) {
      if (!byMarket.has(market.key)) {
        byMarket.set(market.key, {
          key: market.key,
          label: market.label,
          count: 0,
          hitCount: 0,
          probabilitySum: 0,
        });
      }
      const summary = byMarket.get(market.key);
      summary.count += 1;
      if (market.hit) summary.hitCount += 1;
      summary.probabilitySum += Number(market.probability ?? 0);
    }
  }

  return [...byMarket.values()]
    .map((summary) => ({
      key: summary.key,
      label: summary.label,
      count: summary.count,
      hitCount: summary.hitCount,
      accuracy: rate(summary.hitCount, summary.count),
      averageProbability: summary.count ? round(summary.probabilitySum / summary.count, 4) : null,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function normalizeRow(row) {
  const prediction = row.frozenPrediction;
  const score = row.score;
  return {
    matchId: row.matchId,
    date: row.date,
    kickoffAt: row.kickoffAt,
    matchup: `${row.homeTeam?.name ?? row.matchId} vs ${row.awayTeam?.name ?? ""}`,
    finalScore: row.finalScore?.line ?? null,
    predictedOutcome: prediction?.predictedOutcome ?? null,
    actualOutcome: score?.actualOutcomeLabel ?? null,
    actualOutcomeProbability: score?.actualProbability ?? null,
    pickedCorrect: score?.pickedCorrect ?? null,
    topScoreline: score?.topScoreline ?? null,
    topScorelineHit: score?.topScorelineHit ?? null,
    top3ScorelineHit: score?.top3ScorelineHit ?? null,
    top5ScorelineHit: score?.top5ScorelineHit ?? null,
    actualScorelineProbability: score?.actualScorelineProbability ?? null,
    actualScorelineRank: score?.actualScorelineRank ?? null,
    scorelineDistributionSource: score?.scorelineDistributionSource ?? null,
    exactScoreLogLoss: score?.exactScoreLogLoss ?? null,
    brier: score?.brier ?? null,
    rps: score?.rps ?? null,
    derivedMarkets: score?.derivedMarkets ?? [],
  };
}

function renderReviewMarkdown(report) {
  const s = report.summary;
  const lines = [
    `# ${report.title}`,
    "",
    `生成时间：${formatIso(report.generatedAt)}`,
    "",
    "说明：这里只复盘模型本身，不复盘投注收益。复盘口径使用赛前冻结预测；赛后重新生成或滚动 Elo 不会回填命中率。",
    "",
    "## 总览",
    "",
    "| 指标 | 结果 |",
    "| --- | ---: |",
    `| 已评分比赛 | ${s.scoredCount} |`,
    `| 胜平负命中率 | ${formatPercent(s.accuracy)} |`,
    `| 比分 Top1 命中率 | ${formatPercent(s.top1ScorelineRate)} |`,
    `| 比分 Top3 命中率 | ${formatPercent(s.top3ScorelineRate)} |`,
    `| 比分 Top5 命中率 | ${formatPercent(s.top5ScorelineRate)} |`,
    `| 平均真实赛果概率 | ${formatPercent(s.averageActualOutcomeProbability)} |`,
    `| 平均真实比分概率 | ${formatPercent(s.averageActualScorelineProbability)} |`,
    `| 平均 exact-score log loss | ${formatNumber(s.averageExactScoreLogLoss)} |`,
    `| 平均 Brier | ${formatNumber(s.averageBrier)} |`,
    `| 平均 RPS | ${formatNumber(s.averageRps)} |`,
    "",
    "## 派生盘口方向复盘",
    "",
    "| 派生市场 | 样本 | 命中 | 命中率 | 平均模型概率 |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...report.derivedMarketAccuracy.map((market) => (
      `| ${market.label} | ${market.count} | ${market.hitCount} | ${formatPercent(market.accuracy)} | ${formatPercent(market.averageProbability)} |`
    )),
    "",
    "## 逐场复盘",
    "",
    "| 比赛 | 比分 | 模型判断 | 赛果命中 | 首选比分 | Top3 | Top5 | 真实比分概率 | 真实比分排名 | RPS |",
    "| --- | --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |",
    ...report.rows.map((row) => {
      const predicted = row.predictedOutcome
        ? `${row.predictedOutcome.label} ${formatPercent(row.predictedOutcome.probability)}`
        : "--";
      return [
        row.matchup,
        row.finalScore ?? "--",
        predicted,
        formatHit(row.pickedCorrect),
        row.topScoreline ?? "--",
        formatHit(row.top3ScorelineHit),
        formatHit(row.top5ScorelineHit),
        formatPercent(row.actualScorelineProbability),
        row.actualScorelineRank ?? "--",
        formatNumber(row.rps),
      ].join(" | ");
    }).map((line) => `| ${line} |`),
    "",
    "## 字段解释",
    "",
    "- 胜平负命中率：模型赛前最高概率方向是否与最终胜平负一致。",
    "- 比分 TopN 命中率：最终准确比分是否落在模型赛前比分概率前 N 名。",
    "- 平均真实比分概率：模型赛前分配给最终准确比分的概率，越高说明比分分布越贴近真实结果。",
    "- exact-score log loss：准确比分概率评分，越低越好；过度自信但押错比分会受到更大惩罚。",
    "- 派生盘口方向复盘：从比分分布推导大小球、BTTS、球队进球、让球覆盖等事件，检查模型方向是否判断正确。",
  ];

  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = {
    root: DEFAULT_MODEL_REVIEW_ROOT,
    limit: 1000,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--root") {
      args.root = argv[++index] ?? args.root;
    } else if (arg.startsWith("--root=")) {
      args.root = arg.slice("--root=".length);
    } else if (arg === "--limit") {
      args.limit = Number(argv[++index] ?? args.limit);
    } else if (arg.startsWith("--limit=")) {
      args.limit = Number(arg.slice("--limit=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node prediction-api/model-review.mjs [--root <dir>] [--limit <n>] [--json]

Generates model-only review reports from frozen pre-match prediction snapshots.
Default root: ${DEFAULT_MODEL_REVIEW_ROOT}`);
}

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function average(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return null;
  return round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length, 4);
}

function rate(hit, count) {
  return count ? round(hit / count, 4) : null;
}

function round(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Number(number.toFixed(digits));
}

function formatIso(value) {
  if (!value) return "--";
  return String(value).replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function dateFromIso(value) {
  const match = String(value ?? "").match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "--";
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "--";
  return Number(value).toFixed(4);
}

function formatHit(value) {
  if (value == null) return "--";
  return value ? "是" : "否";
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
      process.exit(0);
    }

    const result = generateModelReviewReports(args);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Generated model review: ${result.cumulative.markdownPath}`);
      if (result.dailyReports.length > 0) {
        console.log(`Daily reports: ${result.dailyReports.length}`);
      }
    }
  } catch (error) {
    console.error(error?.stack ?? error);
    process.exit(1);
  }
}
