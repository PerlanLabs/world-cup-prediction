#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CLOB_BASE_URL = "https://clob.polymarket.com";
const USER_AGENT = "world-cup-prediction-polymarket-radar/0.1";
const DEFAULT_STAKE = 100;
const DEFAULT_FEE_RATE = 0.03;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_LIMIT = 80;
const DEFAULT_CONCURRENCY = 8;
const ANALYZE_MATCH_PATH = fileURLToPath(new URL("./analyze-match.mjs", import.meta.url));
const PROJECT_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MARKET_TYPE_ORDER = new Map([
  ["moneyline", 1],
  ["spread", 2],
  ["total", 3],
  ["team_total", 4],
  ["btts", 5],
  ["exact_score", 6],
]);

export async function buildRadarSnapshot(options) {
  const snapshot = options.snapshotFile
    ? loadJson(options.snapshotFile)
    : await runAnalyzeMatchSnapshot(options);

  const sourceRows = Array.isArray(snapshot.markets?.rows) ? snapshot.markets.rows : [];
  const allowedTypes = parseTypeSet(options.types);
  const rows = sourceRows
    .filter((row) => row?.tokenId && (!allowedTypes || allowedTypes.has(row.marketType)))
    .sort(radarRowSort)
    .slice(0, options.limit ?? DEFAULT_LIMIT);

  const enrichedRows = await mapLimit(rows, options.concurrency ?? DEFAULT_CONCURRENCY, async (row) => {
    const bookQuote = await quoteToken(row.tokenId, {
      stake: options.stake ?? DEFAULT_STAKE,
      feeRate: options.feeRate ?? DEFAULT_FEE_RATE,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      allowPowerShellFallback: options.powerShellFallback !== false,
    });
    return buildRadarRow(row, bookQuote, {
      stake: options.stake ?? DEFAULT_STAKE,
      feeRate: options.feeRate ?? DEFAULT_FEE_RATE,
    });
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    input: {
      ...(snapshot.input ?? {}),
      snapshotFile: options.snapshotFile ? resolve(options.snapshotFile) : null,
      stake: options.stake ?? DEFAULT_STAKE,
      marketTypes: allowedTypes ? [...allowedTypes] : "all",
      limit: options.limit ?? DEFAULT_LIMIT,
    },
    sourceSnapshot: {
      generatedAt: snapshot.generatedAt ?? null,
      eventSlug: snapshot.input?.eventSlug ?? snapshot.events?.main?.slug ?? null,
      mainEvent: snapshot.events?.main ?? null,
      moreEvent: snapshot.events?.more ?? null,
      exactScoreEvent: snapshot.events?.exactScore ?? null,
      marketRowCount: sourceRows.length,
    },
    executionModel: {
      stake: options.stake ?? DEFAULT_STAKE,
      feeRate: options.feeRate ?? DEFAULT_FEE_RATE,
      feeFormula: "buyFee = stake * feeRate * (1 - avgFillPrice)",
      clobBookEndpoint: `${CLOB_BASE_URL}/book?token_id=<tokenId>`,
      readOnly: true,
      tradingEnabled: false,
    },
    rows: enrichedRows,
    summary: summarizeRows(enrichedRows),
    notes: [
      "This radar is read-only. It never connects a wallet, signs orders, or places trades.",
      "Fill simulation is a taker BUY estimate against the current CLOB ask book for each individual market row.",
      "If CLOB book is unavailable, the row keeps model/Gamma price context and marks execution as unavailable.",
      "Actual fills can differ because prices, spread, depth, fees, and market availability can move quickly.",
    ],
  };
}

export function normalizeBook(rawBook) {
  return {
    bids: normalizeLevels(rawBook?.bids).sort((a, b) => b.price - a.price),
    asks: normalizeLevels(rawBook?.asks).sort((a, b) => a.price - b.price),
  };
}

export function simulateBuyFill(asks, stake, feeRate = DEFAULT_FEE_RATE) {
  const levels = normalizeLevels(asks).sort((a, b) => a.price - b.price);
  const targetStake = Number(stake);
  if (!Number.isFinite(targetStake) || targetStake <= 0) {
    return emptyFill("invalid_stake");
  }

  let remaining = targetStake;
  let cost = 0;
  let shares = 0;
  const fills = [];

  for (const level of levels) {
    if (remaining <= 1e-9) break;
    const availableCost = level.price * level.size;
    const levelCost = Math.min(remaining, availableCost);
    if (levelCost <= 0) continue;
    const levelShares = levelCost / level.price;
    fills.push({
      price: round(level.price, 6),
      shares: round(levelShares, 4),
      cost: round(levelCost, 4),
    });
    cost += levelCost;
    shares += levelShares;
    remaining -= levelCost;
  }

  if (shares <= 0 || cost <= 0) return emptyFill("empty_ask_book");

  const avgPrice = cost / shares;
  const fee = cost * feeRate * (1 - avgPrice);
  return {
    status: remaining <= 1e-6 ? "filled" : "partial",
    filled: remaining <= 1e-6,
    stake: round(targetStake, 4),
    cost: round(cost, 4),
    unfilledUsd: round(Math.max(0, remaining), 4),
    shares: round(shares, 4),
    avgPrice: round(avgPrice, 6),
    fee: round(fee, 4),
    totalCashRequired: round(cost + fee, 4),
    payoutIfWin: round(shares, 4),
    netProfitIfWin: round(shares - cost - fee, 4),
    netLossIfLose: round(-(cost + fee), 4),
    levelsFilled: fills.length,
    fills,
    error: null,
  };
}

function buildRadarRow(row, quote, options) {
  const fill = quote.fill ?? emptyFill(quote.error ?? "book_unavailable");
  const bestAsk = quote.bestAsk ?? finiteNumber(row.price);
  const avgPrice = finiteNumber(fill.avgPrice);
  const slippageVsBestAsk = Number.isFinite(avgPrice) && Number.isFinite(bestAsk)
    ? round(avgPrice - bestAsk, 6)
    : null;
  const modelProbability = finiteNumber(row.modelProbability);
  const costAdjustedEvPerStake = Number.isFinite(modelProbability) && Number.isFinite(avgPrice) && avgPrice > 0
    ? round((modelProbability * fill.payoutIfWin - fill.totalCashRequired) / options.stake, 4)
    : null;

  return {
    key: row.key,
    label: row.label,
    marketType: row.marketType,
    family: row.family,
    marketSlug: row.marketSlug,
    outcome: row.outcome,
    tokenId: row.tokenId,
    question: row.question,
    modelProbability,
    fairPrice: finiteNumber(row.fairPrice),
    analysisPrice: finiteNumber(row.price),
    analysisPriceSource: row.priceSource ?? null,
    gammaPrice: finiteNumber(row.gammaPrice),
    liquidity: finiteNumber(row.liquidity),
    volume: finiteNumber(row.volume),
    orderBook: {
      status: quote.status,
      bestBid: quote.bestBid,
      bestAsk: quote.bestAsk,
      spread: quote.spread,
      topAskUsd: quote.topAskUsd,
      topBidShares: quote.topBidShares,
      asks: quote.asks,
      bids: quote.bids,
      error: quote.error,
    },
    buySimulation: {
      ...fill,
      stake: options.stake,
      feeRate: options.feeRate,
      slippageVsBestAsk,
      costAdjustedEvPerStake,
    },
    executionGrade: executionGrade({ quote, fill, row, costAdjustedEvPerStake }),
  };
}

async function quoteToken(tokenId, options) {
  try {
    const rawBook = await fetchJson(`${CLOB_BASE_URL}/book?token_id=${encodeURIComponent(tokenId)}`, options);
    const book = normalizeBook(rawBook);
    const bestBid = book.bids[0]?.price ?? null;
    const bestAsk = book.asks[0]?.price ?? null;
    const fill = simulateBuyFill(book.asks, options.stake, options.feeRate);
    return {
      status: "available",
      bestBid,
      bestAsk,
      spread: Number.isFinite(bestBid) && Number.isFinite(bestAsk) ? round(bestAsk - bestBid, 6) : null,
      topAskUsd: round(book.asks.slice(0, 5).reduce((sum, level) => sum + level.price * level.size, 0), 2),
      topBidShares: round(book.bids.slice(0, 5).reduce((sum, level) => sum + level.size, 0), 2),
      asks: book.asks.slice(0, 5),
      bids: book.bids.slice(0, 5),
      fill,
      error: null,
    };
  } catch (error) {
    const message = cleanErrorMessage(error);
    return {
      status: "unavailable",
      bestBid: null,
      bestAsk: null,
      spread: null,
      topAskUsd: null,
      topBidShares: null,
      asks: [],
      bids: [],
      fill: null,
      error: message,
    };
  }
}

async function runAnalyzeMatchSnapshot(options) {
  if (!options.home || !options.away) {
    throw new Error("--home and --away are required when --snapshot-file is not supplied.");
  }
  const args = [
    ANALYZE_MATCH_PATH,
    "--home", options.home,
    "--away", options.away,
    "--venue", options.venue ?? "neutral",
    "--json",
    "--fast",
    "--clob-prices",
  ];
  for (const [flag, value] of [
    ["--home-zh", options.homeZh],
    ["--away-zh", options.awayZh],
    ["--query", options.query],
    ["--event-slug", options.eventSlug],
    ["--more-slug", options.moreSlug],
    ["--exact-slug", options.exactSlug],
    ["--score", options.score],
    ["--elapsed", options.elapsed],
    ["--clob-timeout-ms", options.clobPriceTimeoutMs],
  ]) {
    if (value != null && value !== "") args.push(flag, String(value));
  }
  if (options.noLive) args.push("--no-live");

  const { stdout } = await execFileAsync(process.execPath, args, {
    cwd: PROJECT_ROOT,
    maxBuffer: 30 * 1024 * 1024,
    windowsHide: true,
  });
  return parseJson(stdout);
}

async function fetchJson(url, options = {}) {
  const attempts = options.attempts ?? 2;
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (options.timeoutMs ?? DEFAULT_TIMEOUT_MS) + attempt * 4_000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json", "user-agent": USER_AGENT },
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 160)}` : ""}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await sleep(250 + attempt * 400);
    } finally {
      clearTimeout(timeout);
    }
  }

  if (options.allowPowerShellFallback && process.platform === "win32") {
    return fetchJsonWithPowerShell(url, options);
  }
  throw lastError;
}

async function fetchJsonWithPowerShell(url, options = {}) {
  const timeoutSec = Math.ceil(((options.timeoutMs ?? DEFAULT_TIMEOUT_MS) + 8_000) / 1000);
  const script = `
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$headers = @{
  Accept = 'application/json'
  'User-Agent' = '${USER_AGENT}'
}
Invoke-RestMethod -Uri $env:POLYMARKET_RADAR_URL -Headers $headers -TimeoutSec ${timeoutSec} | ConvertTo-Json -Depth 100 -Compress
`;
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", script], {
    env: { ...process.env, POLYMARKET_RADAR_URL: url },
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  });
  return parseJson(stdout);
}

function executionGrade({ quote, fill, row, costAdjustedEvPerStake }) {
  if (quote.status !== "available") return "book_unavailable";
  if (!fill?.filled) return "insufficient_depth";
  if (quote.spread != null && quote.spread > 0.05) return "wide_spread";
  if (costAdjustedEvPerStake != null && costAdjustedEvPerStake > 0.08) return "actionable_watch";
  if (costAdjustedEvPerStake != null && costAdjustedEvPerStake > 0) return "thin_edge";
  if (row.modelProbability != null && row.price != null && row.modelProbability > row.price) return "edge_eroded_by_costs";
  return "no_value";
}

function summarizeRows(rows) {
  const byGrade = {};
  const byType = {};
  for (const row of rows) {
    byGrade[row.executionGrade] = (byGrade[row.executionGrade] ?? 0) + 1;
    byType[row.marketType] = (byType[row.marketType] ?? 0) + 1;
  }
  return {
    rowCount: rows.length,
    orderBookAvailableCount: rows.filter((row) => row.orderBook.status === "available").length,
    filledAtStakeCount: rows.filter((row) => row.buySimulation.filled).length,
    positiveCostAdjustedEvCount: rows.filter((row) => (row.buySimulation.costAdjustedEvPerStake ?? -Infinity) > 0).length,
    byGrade,
    byType,
  };
}

function radarRowSort(a, b) {
  const typeDiff = (MARKET_TYPE_ORDER.get(a.marketType) ?? 99) - (MARKET_TYPE_ORDER.get(b.marketType) ?? 99);
  if (typeDiff !== 0) return typeDiff;
  const liquidityDiff = (finiteNumber(b.liquidity) ?? 0) - (finiteNumber(a.liquidity) ?? 0);
  if (Math.abs(liquidityDiff) > 1e-9) return liquidityDiff;
  return String(a.key ?? "").localeCompare(String(b.key ?? ""));
}

function parseArgs(args) {
  const options = {
    stake: DEFAULT_STAKE,
    feeRate: DEFAULT_FEE_RATE,
    limit: DEFAULT_LIMIT,
    concurrency: DEFAULT_CONCURRENCY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    outputFormat: "json",
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--home") options.home = next(args, ++index, arg);
    else if (arg === "--away") options.away = next(args, ++index, arg);
    else if (arg === "--home-zh") options.homeZh = next(args, ++index, arg);
    else if (arg === "--away-zh") options.awayZh = next(args, ++index, arg);
    else if (arg === "--venue") options.venue = next(args, ++index, arg);
    else if (arg === "--query") options.query = next(args, ++index, arg);
    else if (arg === "--event-slug") options.eventSlug = next(args, ++index, arg);
    else if (arg === "--more-slug") options.moreSlug = next(args, ++index, arg);
    else if (arg === "--exact-slug" || arg === "--exact-score-slug") options.exactSlug = next(args, ++index, arg);
    else if (arg === "--score") options.score = next(args, ++index, arg);
    else if (arg === "--elapsed") options.elapsed = Number(next(args, ++index, arg));
    else if (arg === "--no-live") options.noLive = true;
    else if (arg === "--snapshot-file" || arg === "--data-file") options.snapshotFile = next(args, ++index, arg);
    else if (arg === "--stake") options.stake = Number(next(args, ++index, arg));
    else if (arg === "--fee-rate") options.feeRate = Number(next(args, ++index, arg));
    else if (arg === "--limit") options.limit = Number(next(args, ++index, arg));
    else if (arg === "--concurrency") options.concurrency = Number(next(args, ++index, arg));
    else if (arg === "--timeout-ms") options.timeoutMs = Number(next(args, ++index, arg));
    else if (arg === "--clob-price-timeout-ms") options.clobPriceTimeoutMs = Number(next(args, ++index, arg));
    else if (arg === "--types") options.types = next(args, ++index, arg);
    else if (arg === "--output") options.output = next(args, ++index, arg);
    else if (arg === "--markdown") options.outputFormat = "markdown";
    else if (arg === "--json") options.outputFormat = "json";
    else if (arg === "--no-powershell-fallback") options.powerShellFallback = false;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node scripts/betting-analysis/polymarket-market-radar.mjs --home usa --away bosnia-herzegovina [options]
  node scripts/betting-analysis/polymarket-market-radar.mjs --snapshot-file _tmp_polymarket/usa-bosnia-20260702-data.json [options]

Options:
  --home <team>              Home/left-side team slug or name.
  --away <team>              Away/right-side team slug or name.
  --venue <neutral|home|away|team>
  --query <text>             Override Polymarket search query passed to analyze-match.
  --event-slug <slug>        Force main Polymarket event slug.
  --more-slug <slug>         Force expanded markets event slug.
  --exact-slug <slug>        Force exact-score event slug.
  --snapshot-file <path>     Reuse an existing analyze-match JSON snapshot.
  --stake <u>                Per-row taker BUY simulation stake, default 100.
  --fee-rate <decimal>       Sports taker fee rate, default 0.03.
  --types <csv>              Market types to quote, e.g. moneyline,spread,total,btts.
  --limit <n>                Max market rows to quote, default 80.
  --concurrency <n>          CLOB book fetch concurrency, default 8.
  --timeout-ms <n>           Per CLOB book timeout, default 8000.
  --output <path>            Save JSON/markdown output to a file.
  --markdown                 Print a compact markdown table.
  --json                     Print JSON, default.
`);
}

function renderMarkdown(output) {
  const lines = [
    `# Polymarket盘口雷达：${output.input.home ?? ""} vs ${output.input.away ?? ""}`,
    "",
    `快照：${output.generatedAt}；单腿模拟：${output.executionModel.stake}u；手续费率：${round(output.executionModel.feeRate * 100, 2)}%`,
    "",
    "| 盘口 | 模型概率 | 分析价 | Best Ask | 100u均价 | 手续费 | 成本后EV/100u | 深度 | 执行判断 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---|",
  ];
  for (const row of output.rows) {
    lines.push([
      humanLabel(row),
      percent(row.modelProbability),
      price(row.analysisPrice),
      price(row.orderBook.bestAsk),
      price(row.buySimulation.avgPrice),
      money(row.buySimulation.fee),
      signedMoney((row.buySimulation.costAdjustedEvPerStake ?? 0) * output.executionModel.stake),
      row.buySimulation.filled ? "够100u" : row.buySimulation.status,
      row.executionGrade,
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  return `${lines.join("\n")}\n`;
}

function humanLabel(row) {
  const label = row.label ?? row.key ?? row.marketSlug;
  return `${label} (${row.marketType})`;
}

function loadJson(path) {
  return parseJson(readFileSync(resolve(path), "utf8"));
}

function parseJson(value) {
  return JSON.parse(String(value).replace(/^\uFEFF/, ""));
}

function parseTypeSet(value) {
  if (!value) return null;
  return new Set(String(value).split(",").map((item) => item.trim()).filter(Boolean));
}

function normalizeLevels(levels) {
  return (Array.isArray(levels) ? levels : [])
    .map((level) => ({
      price: finiteNumber(level.price ?? level.p),
      size: finiteNumber(level.size ?? level.s),
    }))
    .filter((level) => Number.isFinite(level.price) && Number.isFinite(level.size) && level.price > 0 && level.size > 0);
}

function emptyFill(error) {
  return {
    status: "unavailable",
    filled: false,
    stake: null,
    cost: 0,
    unfilledUsd: null,
    shares: 0,
    avgPrice: null,
    fee: 0,
    totalCashRequired: 0,
    payoutIfWin: 0,
    netProfitIfWin: 0,
    netLossIfLose: 0,
    levelsFilled: 0,
    fills: [],
    error,
  };
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

function next(args, index, label) {
  const value = args[index];
  if (value == null || value === "") throw new Error(`${label} requires a value.`);
  return value;
}

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanErrorMessage(error) {
  const message = String(error?.message ?? error ?? "unknown_error");
  const jsonError = message.match(/\{"error":"([^"]+)"\}/);
  if (jsonError) return jsonError[1];
  return message.split(/\r?\n/)[0].slice(0, 240);
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function price(value) {
  return Number.isFinite(value) ? `${round(value * 100, 2)}c` : "-";
}

function percent(value) {
  return Number.isFinite(value) ? `${round(value * 100, 1)}%` : "-";
}

function money(value) {
  return Number.isFinite(value) ? `${round(value, 2)}u` : "-";
}

function signedMoney(value) {
  if (!Number.isFinite(value)) return "-";
  const rounded = round(value, 2);
  return `${rounded >= 0 ? "+" : ""}${rounded}u`;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const output = await buildRadarSnapshot(options);
  const rendered = options.outputFormat === "markdown"
    ? renderMarkdown(output)
    : `${JSON.stringify(output, null, 2)}\n`;

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
