#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { DC_RHO, matchProb, poissonPmf } from "../../world-cup-2026-prediction-model/elo.mjs";

const execFileAsync = promisify(execFile);
const GAMMA_BASE_URL = "https://gamma-api.polymarket.com";
const CLOB_BASE_URL = "https://clob.polymarket.com";
const BASE_RATINGS_PATH = fileURLToPath(new URL("../../world-cup-2026-prediction-model/data/elo-calibrated.json", import.meta.url));
const CURRENT_RATINGS_PATH = fileURLToPath(new URL("../../prediction-api/data/elo-calibrated.current.json", import.meta.url));
const DEFAULT_TIMEOUT_MS = 18_000;
const FAST_CLOB_TIMEOUT_MS = 1_500;
const MAX_GOALS = 10;
const HOME_BONUS = 75;
const MIN_RECOMMEND_PRICE = 0.02;
const MAX_RECOMMEND_PRICE = 0.98;
const MAX_RECOMMEND_EV_PER_UNIT = 3;
const SPORTS_TAKER_FEE_RATE = 0.03;

const TEAM_ALIASES = new Map([
  ["united-states", "usa"],
  ["us", "usa"],
  ["u-s-a", "usa"],
  ["korea-republic", "south-korea"],
  ["cote-d-ivoire", "ivory-coast"],
  ["cote-divoire", "ivory-coast"],
  ["côte-divoire", "ivory-coast"],
  ["cape-verde", "cape-verde"],
  ["cabo-verde", "cape-verde"],
  ["cape-verde-islands", "cape-verde"],
  ["congo-dr", "dr-congo"],
  ["congo-democratic-republic", "dr-congo"],
  ["democratic-republic-of-the-congo", "dr-congo"],
  ["curao", "curacao"],
  ["curaçao", "curacao"],
  ["curacao", "curacao"],
  ["czechia", "czech-republic"],
  ["turkiye", "turkey"],
  ["türkiye", "turkey"],
]);

const TEAM_DISPLAY_ALIASES = new Map([
  ["usa", ["United States", "USA", "United States of America"]],
  ["south-korea", ["Korea Republic", "South Korea", "Korea"]],
  ["czech-republic", ["Czechia", "Czech Republic"]],
  ["bosnia-and-herzegovina", ["Bosnia-Herzegovina", "Bosnia and Herzegovina", "Bosnia"]],
  ["south-africa", ["South Africa", "RSA"]],
  ["ivory-coast", ["Cote d'Ivoire", "Côte d'Ivoire", "Ivory Coast"]],
  ["cape-verde", ["Cabo Verde", "Cape Verde"]],
  ["dr-congo", ["DR Congo", "Democratic Republic of Congo", "Congo DR"]],
  ["turkey", ["Türkiye", "Turkey", "Turkiye"]],
  ["saudi-arabia", ["Saudi Arabia", "KSA"]],
  ["new-zealand", ["New Zealand"]],
  ["curacao", ["Curaçao", "Curacao"]],
]);

const TEAM_ZH = new Map([
  ["algeria", "阿尔及利亚"],
  ["argentina", "阿根廷"],
  ["australia", "澳大利亚"],
  ["austria", "奥地利"],
  ["belgium", "比利时"],
  ["bosnia-and-herzegovina", "波黑"],
  ["brazil", "巴西"],
  ["canada", "加拿大"],
  ["cape-verde", "佛得角"],
  ["colombia", "哥伦比亚"],
  ["croatia", "克罗地亚"],
  ["curacao", "库拉索"],
  ["czech-republic", "捷克"],
  ["dr-congo", "刚果（金）"],
  ["ecuador", "厄瓜多尔"],
  ["egypt", "埃及"],
  ["england", "英格兰"],
  ["france", "法国"],
  ["germany", "德国"],
  ["ghana", "加纳"],
  ["haiti", "海地"],
  ["iran", "伊朗"],
  ["iraq", "伊拉克"],
  ["ivory-coast", "科特迪瓦"],
  ["japan", "日本"],
  ["jordan", "约旦"],
  ["mexico", "墨西哥"],
  ["morocco", "摩洛哥"],
  ["netherlands", "荷兰"],
  ["new-zealand", "新西兰"],
  ["norway", "挪威"],
  ["panama", "巴拿马"],
  ["paraguay", "巴拉圭"],
  ["portugal", "葡萄牙"],
  ["qatar", "卡塔尔"],
  ["saudi-arabia", "沙特"],
  ["scotland", "苏格兰"],
  ["senegal", "塞内加尔"],
  ["south-africa", "南非"],
  ["south-korea", "韩国"],
  ["spain", "西班牙"],
  ["sweden", "瑞典"],
  ["switzerland", "瑞士"],
  ["tunisia", "突尼斯"],
  ["turkey", "土耳其"],
  ["uruguay", "乌拉圭"],
  ["usa", "美国"],
  ["uzbekistan", "乌兹别克斯坦"],
]);

const EVENT_CODE = new Map([
  ["algeria", "alg"],
  ["argentina", "arg"],
  ["australia", "aus"],
  ["austria", "aut"],
  ["belgium", "bel"],
  ["bosnia-and-herzegovina", "bih"],
  ["brazil", "bra"],
  ["cape-verde", "cpv"],
  ["canada", "can"],
  ["colombia", "col"],
  ["croatia", "hrv"],
  ["curacao", "cuw"],
  ["czech-republic", "cze"],
  ["dr-congo", "cod"],
  ["ecuador", "ecu"],
  ["egypt", "egy"],
  ["england", "eng"],
  ["france", "fra"],
  ["germany", "ger"],
  ["ghana", "gha"],
  ["haiti", "hai"],
  ["iran", "irn"],
  ["iraq", "irq"],
  ["ivory-coast", "civ"],
  ["japan", "jpn"],
  ["jordan", "jor"],
  ["mexico", "mex"],
  ["morocco", "mar"],
  ["netherlands", "nld"],
  ["new-zealand", "nzl"],
  ["norway", "nor"],
  ["panama", "pan"],
  ["paraguay", "par"],
  ["portugal", "por"],
  ["qatar", "qat"],
  ["saudi-arabia", "ksa"],
  ["scotland", "sco"],
  ["senegal", "sen"],
  ["south-africa", "rsa"],
  ["south-korea", "kor"],
  ["spain", "esp"],
  ["sweden", "swe"],
  ["switzerland", "che"],
  ["tunisia", "tun"],
  ["turkey", "tur"],
  ["uruguay", "uru"],
  ["usa", "usa"],
  ["uzbekistan", "uzb"],
]);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if ((options.html || options.chatSummary) && !options.analysisFile) {
    throw new Error("--html and --chat-summary require --analysis-file. The script no longer auto-generates betting strategies.");
  }

  const snapshot = options.snapshotFile ? loadAnalysisSnapshot(options.snapshotFile) : null;
  const movementSnapshot = options.movementFile ? loadMovementSnapshot(options.movementFile) : null;
  const home = normalizeTeam(options.home ?? snapshot?.input?.home ?? required(options.home, "--home"));
  const away = normalizeTeam(options.away ?? snapshot?.input?.away ?? required(options.away, "--away"));
  if (snapshot) validateSnapshotTeams(snapshot, home, away);
  const venue = normalizeVenue(options.venue ?? snapshot?.input?.venue ?? "neutral", home, away);
  const fetchedAt = snapshot?.generatedAt ?? new Date().toISOString();

  if (snapshot) {
    const output = buildOutputFromSnapshot({ snapshot, movementSnapshot, options, home, away, fetchedAt });
    emitOutput(output, options);
    return;
  }

  const baseModel = buildModelSnapshot({ home, away, venue, ratingsSource: "base" });
  const currentModel = existsSync(CURRENT_RATINGS_PATH)
    ? buildModelSnapshot({ home, away, venue, ratingsSource: "current" })
    : null;

  let eventBundle = await fetchPolymarketBundle({
    home,
    away,
    query: options.query,
    eventSlug: options.eventSlug,
    moreSlug: options.moreSlug,
    exactSlug: options.exactSlug,
    fetchedAt,
  });

  let liveState = resolveLiveState(options, eventBundle.mainEvent);
  let modelForMarkets = liveState
    ? buildLiveModelSnapshot(baseModel, liveState, options)
    : baseModel;

  let marketRows = await buildMarketRows(eventBundle, {
    home,
    away,
    model: modelForMarkets,
    includeHalves: options.includeHalves,
    clobPrices: options.clobPrices,
    fast: options.fast,
    clobTimeoutMs: options.clobTimeoutMs,
  });

  const refreshedBundle = await refreshBundleIfLiveMoved({
    options,
    home,
    away,
    previousBundle: eventBundle,
    fetchedAt,
  });
  const liveRecheck = refreshedBundle ? {
    previous: summarizeEvent(eventBundle.mainEvent),
    refreshed: summarizeEvent(refreshedBundle.mainEvent),
  } : null;
  if (refreshedBundle) {
    eventBundle = refreshedBundle;
    liveState = resolveLiveState(options, eventBundle.mainEvent);
    modelForMarkets = liveState
      ? buildLiveModelSnapshot(baseModel, liveState, options)
      : baseModel;
    marketRows = await buildMarketRows(eventBundle, {
      home,
      away,
      model: modelForMarkets,
      includeHalves: options.includeHalves,
      clobPrices: options.clobPrices,
      fast: options.fast,
      clobTimeoutMs: options.clobTimeoutMs,
    });
  }

  const valueTable = attachMarketMovement(marketRows
    .filter((row) => row.supported && row.price > 0 && Number.isFinite(row.modelProbability))
    .map((row) => ({
      ...row,
      fairPrice: round(row.modelProbability, 4),
      edge: round(row.modelProbability - row.price, 4),
      evPerUnit: round(row.modelProbability / row.price - 1, 4),
      valueGrade: gradeValue(row.modelProbability, row.price),
    }))
    .sort(sortValueRows), movementSnapshot);

  const finalAnalysis = options.analysisFile ? loadFinalAnalysis(options.analysisFile) : null;
  const strategyDrafts = finalAnalysis
    ? buildStrategyDraftsFromFinalAnalysis(finalAnalysis, valueTable, modelForMarkets.scoreDistribution)
    : null;
  const scorePnl = strategyDrafts
    ? buildScorePnlTable(modelForMarkets.scoreDistribution, strategyDrafts, options.scoreRows)
    : [];

  if ((options.html || options.chatSummary) && !finalAnalysis) {
    throw new Error("--html and --chat-summary require --analysis-file. The script no longer auto-generates betting strategies.");
  }

  const output = {
    ok: true,
    generatedAt: fetchedAt,
    input: {
      home,
      away,
      homeZh: options.homeZh ?? null,
      awayZh: options.awayZh ?? null,
      venue: venue.type,
      eventSlug: eventBundle.mainEvent?.slug ?? null,
    },
    sources: {
      polymarket: {
        publicSearch: `${GAMMA_BASE_URL}/public-search?q=${encodeURIComponent(options.query ?? `${home} ${away}`)}`,
        main: eventBundle.mainEvent?.slug ? `${GAMMA_BASE_URL}/events/slug/${eventBundle.mainEvent.slug}` : null,
        more: eventBundle.moreEvent?.slug ? `${GAMMA_BASE_URL}/events/slug/${eventBundle.moreEvent.slug}` : null,
        exactScore: eventBundle.exactScoreEvent?.slug ? `${GAMMA_BASE_URL}/events/slug/${eventBundle.exactScoreEvent.slug}` : null,
        clob: `${CLOB_BASE_URL}/price`,
        priceHistory: movementSnapshot?.source?.priceHistory ?? null,
      },
      model: {
        baseRatingsPath: BASE_RATINGS_PATH,
        currentRatingsPath: existsSync(CURRENT_RATINGS_PATH) ? CURRENT_RATINGS_PATH : null,
      },
    },
    events: {
      main: summarizeEvent(eventBundle.mainEvent),
      more: summarizeEvent(eventBundle.moreEvent),
      exactScore: summarizeEvent(eventBundle.exactScoreEvent),
      liveRecheck,
    },
    model: {
      base: baseModel,
      current: currentModel,
      usedForMarkets: liveState ? "live-from-base" : "base",
      live: liveState ? modelForMarkets : null,
    },
    markets: {
      rows: valueTable,
      unsupportedCount: marketRows.filter((row) => !row.supported).length,
      priceErrorCount: marketRows.filter((row) => row.priceError).length,
    },
    marketMovement: summarizeMovementSnapshot(movementSnapshot, options.movementFile),
    strategyDrafts,
    scorePnl,
    finalAnalysis,
    notes: [
      "This is a deterministic analysis snapshot, not a trading instruction.",
      finalAnalysis
        ? "Portfolio legs were supplied by the final analysis file. The script only calculated metrics and rendered output."
        : "Data mode only: no portfolio or betting strategy was generated by this script.",
      "Prices use CLOB BUY when available. Fills can differ due to spread, slippage, liquidity, and fast live movement.",
    ],
  };

  emitOutput(output, options);
}

function buildOutputFromSnapshot({ snapshot, movementSnapshot, options, home, away, fetchedAt }) {
  const modelForMarkets = modelForMarketsFromSnapshot(snapshot);
  const valueTable = attachMarketMovement(normalizeSnapshotMarketRows(snapshot.markets?.rows ?? [], {
    home,
    away,
    model: modelForMarkets,
  }), movementSnapshot);
  const finalAnalysis = options.analysisFile ? loadFinalAnalysis(options.analysisFile) : null;
  const strategyDrafts = finalAnalysis
    ? buildStrategyDraftsFromFinalAnalysis(finalAnalysis, valueTable, modelForMarkets.scoreDistribution)
    : null;
  const scorePnl = strategyDrafts
    ? buildScorePnlTable(modelForMarkets.scoreDistribution, strategyDrafts, options.scoreRows)
    : [];

  return {
    ...snapshot,
    ok: true,
    generatedAt: fetchedAt,
    input: {
      ...(snapshot.input ?? {}),
      home,
      away,
      homeZh: options.homeZh ?? snapshot.input?.homeZh ?? null,
      awayZh: options.awayZh ?? snapshot.input?.awayZh ?? null,
      venue: snapshot.input?.venue ?? "neutral",
    },
    markets: {
      ...(snapshot.markets ?? {}),
      rows: valueTable,
      unsupportedCount: snapshot.markets?.unsupportedCount ?? valueTable.filter((row) => !row.supported).length,
      priceErrorCount: snapshot.markets?.priceErrorCount ?? valueTable.filter((row) => row.priceError).length,
    },
    marketMovement: summarizeMovementSnapshot(movementSnapshot, options.movementFile)
      ?? snapshot.marketMovement
      ?? null,
    strategyDrafts,
    scorePnl,
    finalAnalysis,
    artifacts: undefined,
    notes: [
      `Reused local market/model snapshot from ${resolve(options.snapshotFile)}. No Polymarket or CLOB requests were made for this calculation/render step.`,
      finalAnalysis
        ? "Portfolio legs were supplied by the final analysis file. The script only calculated metrics and rendered output."
        : "Snapshot data mode only: no portfolio or betting strategy was generated by this script.",
      "Refresh the snapshot before execution if prices may have moved materially.",
    ],
  };
}

function emitOutput(output, options) {
  if (options.html) {
    const htmlPath = writeHtmlCard(output, options);
    output.artifacts = { ...(output.artifacts ?? {}), htmlPath };
  }

  if (options.chatSummary) {
    console.log(renderChatSummary(output));
  } else {
    console.log(JSON.stringify(output, null, 2));
  }
}

function loadAnalysisSnapshot(snapshotPath) {
  const absolutePath = resolve(snapshotPath);
  const parsed = JSON.parse(readFileSync(absolutePath, "utf8").replace(/^\uFEFF/, ""));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--snapshot-file must point to a JSON object generated by this script.");
  }
  if (!Array.isArray(parsed.markets?.rows)) {
    throw new Error("--snapshot-file is missing markets.rows. Run data mode first and pass the JSON output here.");
  }
  if (!parsed.model?.base && !parsed.model?.live) {
    throw new Error("--snapshot-file is missing model data.");
  }
  return parsed;
}

function loadMovementSnapshot(snapshotPath) {
  const absolutePath = resolve(snapshotPath);
  const parsed = JSON.parse(readFileSync(absolutePath, "utf8").replace(/^\uFEFF/, ""));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--movement-file must point to a Polymarket movement JSON object.");
  }
  if (!Array.isArray(parsed.rows)) {
    throw new Error("--movement-file is missing rows. Run polymarket:movement first.");
  }
  return parsed;
}

function attachMarketMovement(rows, movementSnapshot) {
  if (!movementSnapshot?.rows?.length) return rows;
  const byToken = new Map(
    movementSnapshot.rows
      .filter((row) => row?.tokenId)
      .map((row) => [String(row.tokenId), row]),
  );
  return rows.map((row) => {
    const movementRow = row?.tokenId ? byToken.get(String(row.tokenId)) : null;
    if (!movementRow) return row;
    return {
      ...row,
      priceMovement: {
        status: movementRow.status,
        firstObserved: movementRow.movement?.firstObserved ?? null,
        preKickoff: movementRow.movement?.preKickoff ?? null,
        change: movementRow.movement?.change ?? null,
        windows: movementRow.movement?.windows ?? null,
        quality: movementRow.movement?.quality ?? null,
      },
    };
  });
}

function summarizeMovementSnapshot(snapshot, sourcePath) {
  if (!snapshot) return null;
  return {
    sourceFile: sourcePath ? resolve(sourcePath) : null,
    generatedAt: snapshot.generatedAt ?? null,
    eventSlug: snapshot.input?.eventSlug ?? snapshot.event?.slug ?? null,
    cutoffTime: snapshot.input?.cutoffTime ?? null,
    cutoffPolicy: snapshot.input?.cutoffPolicy ?? null,
    categoryCoverage: snapshot.categoryCoverage ?? [],
    summary: snapshot.summary ?? null,
    interpretationRule: "Movement is market-support context only; it does not prove manipulation or choose portfolio legs.",
  };
}

function validateSnapshotTeams(snapshot, home, away) {
  const snapshotHome = normalizeTeam(snapshot.input?.home);
  const snapshotAway = normalizeTeam(snapshot.input?.away);
  if (snapshotHome && snapshotHome !== home) {
    throw new Error(`--snapshot-file home team is ${snapshotHome}, but --home resolved to ${home}.`);
  }
  if (snapshotAway && snapshotAway !== away) {
    throw new Error(`--snapshot-file away team is ${snapshotAway}, but --away resolved to ${away}.`);
  }
}

function modelForMarketsFromSnapshot(snapshot) {
  const used = snapshot.model?.usedForMarkets;
  const model = used === "live-from-base"
    ? snapshot.model?.live
    : used && snapshot.model?.[used]
      ? snapshot.model[used]
      : snapshot.model?.live ?? snapshot.model?.base;
  if (!model?.scoreDistribution) {
    throw new Error("--snapshot-file model is missing scoreDistribution for portfolio calculations.");
  }
  return model;
}

const POLYMARKET_LISTED_EXACT_SCORES = new Set([
  "0-0", "0-1", "1-0", "0-2", "1-1", "2-0", "0-3", "1-2",
  "2-1", "3-0", "1-3", "2-2", "3-1", "2-3", "3-2", "3-3",
]);

function isListedPolymarketExactScore(homeGoals, awayGoals) {
  return POLYMARKET_LISTED_EXACT_SCORES.has(`${homeGoals}-${awayGoals}`);
}

function normalizeSnapshotMarketRows(rows, context) {
  return rows.map((row) => {
    const condition = row.condition ?? restoreMarketCondition(row, context.home, context.away);
    const price = finiteNumber(row.price);
    const modelProbability = Number.isFinite(finiteNumber(row.modelProbability))
      ? finiteNumber(row.modelProbability)
      : condition
        ? probabilityOf(condition, context.model.scoreDistribution)
        : null;
    const supported = row.supported !== false && Boolean(condition);
    const fairPrice = Number.isFinite(modelProbability) ? round(modelProbability, 4) : null;
    const edge = Number.isFinite(modelProbability) && Number.isFinite(price)
      ? round(modelProbability - price, 4)
      : null;
    const evPerUnit = Number.isFinite(modelProbability) && Number.isFinite(price) && price > 0
      ? round(modelProbability / price - 1, 4)
      : null;
    return {
      ...row,
      price,
      condition,
      supported,
      modelProbability,
      fairPrice,
      edge,
      evPerUnit,
      valueGrade: Number.isFinite(modelProbability) && Number.isFinite(price)
        ? gradeValue(modelProbability, price)
        : row.valueGrade,
    };
  }).sort(sortValueRows);
}

function restoreMarketCondition(row, home, away) {
  const key = String(row.key ?? "");
  if (key === "home_win") return (h, a) => h > a;
  if (key === "draw") return (h, a) => h === a;
  if (key === "away_win") return (h, a) => h < a;
  if (key === "btts_yes") return (h, a) => h >= 1 && a >= 1;
  if (key === "btts_no") return (h, a) => h === 0 || a === 0;
  if (key === "exact_any_other") return (h, a) => !isListedPolymarketExactScore(h, a);

  const exactMatch = key.match(/^exact_(\d+)_(\d+)$/);
  if (exactMatch) {
    const homeGoals = Number(exactMatch[1]);
    const awayGoals = Number(exactMatch[2]);
    return (h, a) => h === homeGoals && a === awayGoals;
  }

  const spreadMatch = key.match(/^(home|away)_([+-]\d+(?:\.\d+)?)$/);
  if (spreadMatch) {
    const side = spreadMatch[1];
    const line = Number(spreadMatch[2]);
    return (h, a) => side === "home" ? h + line > a : a + line > h;
  }

  const matchTotal = key.match(/^match_total_match_(over|under)_(\d+(?:\.\d+)?)$/);
  if (matchTotal) {
    const side = matchTotal[1];
    const line = Number(matchTotal[2]);
    return (h, a) => side === "over" ? h + a > line : h + a < line;
  }

  const teamTotal = key.match(/^team_total_(.+)_(over|under)_(\d+(?:\.\d+)?)$/);
  if (teamTotal) {
    const team = normalizeTeam(teamTotal[1]);
    const side = teamTotal[2];
    const line = Number(teamTotal[3]);
    return (h, a) => {
      const goals = team === home ? h : team === away ? a : null;
      if (goals == null) return false;
      return side === "over" ? goals > line : goals < line;
    };
  }

  return null;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseArgs(args) {
  const options = {
    scoreRows: 16,
    fast: true,
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
    else if (arg === "--stoppage") options.stoppage = Number(next(args, ++index, arg));
    else if (arg === "--live-intensity") options.liveIntensity = Number(next(args, ++index, arg));
    else if (arg === "--favorite-chase") options.favoriteChase = Number(next(args, ++index, arg));
    else if (arg === "--score-rows") options.scoreRows = Number(next(args, ++index, arg));
    else if (arg === "--output-dir") options.outputDir = next(args, ++index, arg);
    else if (arg === "--analysis-file") options.analysisFile = next(args, ++index, arg);
    else if (arg === "--snapshot-file" || arg === "--data-file") options.snapshotFile = next(args, ++index, arg);
    else if (arg === "--movement-file") options.movementFile = next(args, ++index, arg);
    else if (arg === "--clob-timeout-ms") options.clobTimeoutMs = Number(next(args, ++index, arg));
    else if (arg === "--include-halves") options.includeHalves = true;
    else if (arg === "--clob-prices") options.clobPrices = true;
    else if (arg === "--fast") options.fast = true;
    else if (arg === "--slow") options.fast = false;
    else if (arg === "--html") options.html = true;
    else if (arg === "--chat-summary") options.chatSummary = true;
    else if (arg === "--json") options.outputFormat = "json";
    else if (arg === "--no-live") options.noLive = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function next(args, index, label) {
  const value = args[index];
  if (!value) throw new Error(`${label} requires a value.`);
  return value;
}

function required(value, label) {
  if (!value) throw new Error(`${label} is required.`);
  return value;
}

function printHelp() {
  console.log(`Usage:
  node scripts/betting-analysis/analyze-match.mjs --home ecuador --away curacao [options]

Options:
  --home <team>              Home/left-side team slug or name.
  --away <team>              Away/right-side team slug or name.
  --venue <neutral|home|away|team>
  --query <text>             Override Polymarket public-search query.
  --event-slug <slug>        Force the main Polymarket event slug.
  --more-slug <slug>         Force the expanded markets event slug.
  --exact-slug <slug>        Force the exact-score event slug.
  --score <A-B>              Override live score.
  --elapsed <minute>         Override live elapsed minute.
  --stoppage <minutes>       Expected stoppage time for live model, default 5.
  --live-intensity <number>  Multiplier for remaining xG in live model, default 1.
  --favorite-chase <number>  Tied-live favorite xG multiplier, default 1.12.
  --no-live                  Ignore Polymarket/event live score and use pre-match model.
  --score-rows <n>           Score P/L rows to output, default 16.
  --analysis-file <path>     Final human-authored strategy JSON for chat/HTML rendering.
  --snapshot-file <path>     Reuse a prior JSON data-mode snapshot; skips Polymarket/model fetching.
  --movement-file <path>     Attach a polymarket:movement JSON snapshot to matching token rows.
  --clob-prices              Fetch CLOB BUY prices for priority markets. Default uses faster Gamma outcomePrices.
  --fast                     Use fast defaults: short CLOB timeout and Gamma fallback. Default on.
  --slow                     Allow slower CLOB retries.
  --clob-timeout-ms <n>      Per-token CLOB timeout, default 5000 in fast mode.
  --html                     Save the fixed-format HTML card. Requires --analysis-file.
  --chat-summary             Print a Chinese markdown summary. Requires --analysis-file.
  --json                     Explicit raw JSON data mode. Kept for compatibility.
  --output-dir <path>        HTML output directory, default project root.
`);
}

function normalizeTeam(value) {
  if (typeof value !== "string") return "";
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-\s]/g, "")
    .replace(/\s+/g, "-");
  return TEAM_ALIASES.get(slug) ?? slug;
}

function normalizeVenue(value, home, away) {
  const raw = String(value ?? "neutral").trim().toLowerCase();
  const normalized = normalizeTeam(raw);
  if (!raw || raw === "neutral" || raw === "none") return { type: "neutral", homeBonus: 0 };
  if (raw === "home" || normalized === home) return { type: "home", homeBonus: HOME_BONUS };
  if (raw === "away" || normalized === away) return { type: "away", homeBonus: -HOME_BONUS };
  return { type: normalized, homeBonus: normalized === home ? HOME_BONUS : normalized === away ? -HOME_BONUS : 0 };
}

function buildModelSnapshot({ home, away, venue, ratingsSource }) {
  const ratingsPath = ratingsSource === "current" ? CURRENT_RATINGS_PATH : BASE_RATINGS_PATH;
  const data = JSON.parse(readFileSync(ratingsPath, "utf8"));
  const homeRating = data.ratings?.[home];
  const awayRating = data.ratings?.[away];
  if (homeRating == null || awayRating == null) {
    throw new Error(`Missing ${ratingsSource} rating for ${homeRating == null ? home : away}.`);
  }
  const probabilities = matchProb(homeRating, awayRating, venue.homeBonus);
  const scoreDistribution = getScoreDistribution({
    lambdaHome: probabilities.expectedGoalsA,
    lambdaAway: probabilities.expectedGoalsB,
    currentHomeGoals: 0,
    currentAwayGoals: 0,
    useDixonColes: true,
  });
  return {
    ratingsSource,
    ratingsPath,
    homeRating,
    awayRating,
    expectedGoals: {
      home: round(probabilities.expectedGoalsA, 3),
      away: round(probabilities.expectedGoalsB, 3),
    },
    probabilities: {
      homeWin: round(probabilities.winA, 4),
      draw: round(probabilities.draw, 4),
      awayWin: round(probabilities.winB, 4),
    },
    scoreDistribution,
  };
}

function buildLiveModelSnapshot(baseModel, liveState, options) {
  const totalMinutes = 90 + finiteOr(options.stoppage, 5);
  const remainingShare = Math.max(0, totalMinutes - liveState.elapsed) / 90;
  const intensity = finiteOr(options.liveIntensity, 1);
  let homeMultiplier = intensity;
  let awayMultiplier = intensity;

  if (liveState.homeGoals === liveState.awayGoals) {
    const favoriteChase = finiteOr(options.favoriteChase, 1.12);
    if (baseModel.probabilities.homeWin > baseModel.probabilities.awayWin) homeMultiplier *= favoriteChase;
    if (baseModel.probabilities.awayWin > baseModel.probabilities.homeWin) awayMultiplier *= favoriteChase;
  }

  const lambdaHome = Math.max(0, baseModel.expectedGoals.home * remainingShare * homeMultiplier);
  const lambdaAway = Math.max(0, baseModel.expectedGoals.away * remainingShare * awayMultiplier);
  const scoreDistribution = getScoreDistribution({
    lambdaHome,
    lambdaAway,
    currentHomeGoals: liveState.homeGoals,
    currentAwayGoals: liveState.awayGoals,
    useDixonColes: false,
  });
  return {
    ratingsSource: "live-from-base",
    liveState,
    remainingExpectedGoals: {
      home: round(lambdaHome, 3),
      away: round(lambdaAway, 3),
    },
    probabilities: probabilitySummary(scoreDistribution),
    scoreDistribution,
  };
}

function resolveLiveState(options, event) {
  if (options.noLive) return null;
  const score = options.score ?? event?.score;
  const elapsed = finiteOr(options.elapsed, Number(event?.elapsed));
  if (!score || !Number.isFinite(elapsed)) return null;
  if (elapsed <= 0 && options.elapsed == null) return null;
  const match = String(score).match(/(\d+)\s*-\s*(\d+)/);
  if (!match) return null;
  return {
    score: `${match[1]}-${match[2]}`,
    elapsed,
    homeGoals: Number(match[1]),
    awayGoals: Number(match[2]),
  };
}

function getScoreDistribution({ lambdaHome, lambdaAway, currentHomeGoals, currentAwayGoals, useDixonColes }) {
  const rows = [];
  let total = 0;
  for (let extraHome = 0; extraHome <= MAX_GOALS; extraHome += 1) {
    const homeP = poissonPmf(extraHome, lambdaHome);
    for (let extraAway = 0; extraAway <= MAX_GOALS; extraAway += 1) {
      const awayP = poissonPmf(extraAway, lambdaAway);
      const tau = useDixonColes ? dcTau(extraHome, extraAway, lambdaHome, lambdaAway, DC_RHO) : 1;
      const probability = homeP * awayP * tau;
      total += probability;
      rows.push({
        homeGoals: currentHomeGoals + extraHome,
        awayGoals: currentAwayGoals + extraAway,
        extraHomeGoals: extraHome,
        extraAwayGoals: extraAway,
        probability,
      });
    }
  }

  return rows
    .map((row) => ({
      ...row,
      line: `${row.homeGoals}-${row.awayGoals}`,
      probability: row.probability / total,
      probabilityPercent: round((row.probability / total) * 100, 2),
    }))
    .sort((a, b) => b.probability - a.probability)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function dcTau(homeGoals, awayGoals, lambda, mu, rho) {
  if (homeGoals === 0 && awayGoals === 0) return 1 - lambda * mu * rho;
  if (homeGoals === 0 && awayGoals === 1) return 1 + lambda * rho;
  if (homeGoals === 1 && awayGoals === 0) return 1 + mu * rho;
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}

async function fetchPolymarketBundle({ home, away, query, eventSlug, moreSlug, exactSlug, fetchedAt }) {
  const mainEvent = eventSlug
    ? await fetchEventBySlug(eventSlug)
    : await discoverEvent({ home, away, query });

  const [moreEvent, exactScoreEvent] = await Promise.all([
    moreSlug ? fetchEventBySlug(moreSlug).catch(() => null) : mainEvent?.slug ? fetchEventBySlug(`${mainEvent.slug}-more-markets`).catch(() => null) : null,
    exactSlug ? fetchEventBySlug(exactSlug).catch(() => null) : mainEvent?.slug ? fetchEventBySlug(`${mainEvent.slug}-exact-score`).catch(() => null) : null,
  ]);

  return { fetchedAt, mainEvent, moreEvent, exactScoreEvent };
}

async function refreshBundleIfLiveMoved({ options, home, away, previousBundle, fetchedAt }) {
  if (options.noLive || options.score != null || options.elapsed != null) return null;
  const slug = previousBundle.mainEvent?.slug;
  if (!slug) return null;

  const latestMain = await fetchEventBySlug(slug).catch(() => null);
  if (!latestMain) return null;

  const previousScore = previousBundle.mainEvent?.score ?? null;
  const latestScore = latestMain.score ?? null;
  const previousElapsed = Number(previousBundle.mainEvent?.elapsed);
  const latestElapsed = Number(latestMain.elapsed);
  const scoreChanged = previousScore !== latestScore;
  const elapsedMoved = Number.isFinite(previousElapsed)
    && Number.isFinite(latestElapsed)
    && latestElapsed - previousElapsed >= 3;

  if (!scoreChanged && !elapsedMoved) return null;

  return fetchPolymarketBundle({
    home,
    away,
    query: options.query,
    eventSlug: slug,
    moreSlug: options.moreSlug,
    exactSlug: options.exactSlug,
    fetchedAt,
  });
}

async function discoverEvent({ home, away, query }) {
  const candidates = buildSlugCandidates(home, away);
  for (const slug of candidates) {
    const event = await fetchEventBySlug(slug).catch(() => null);
    if (event && eventMatches(event, home, away)) return event;
  }

  const searchQuery = query ?? `${displayName(home)} ${displayName(away)}`;
  const result = await fetchGammaJson(`${GAMMA_BASE_URL}/public-search?q=${encodeURIComponent(searchQuery)}`);
  const events = Array.isArray(result?.events) ? result.events : [];
  return events.find((event) => eventMatches(event, home, away)) ?? events[0] ?? null;
}

function buildSlugCandidates(home, away) {
  const homeCode = EVENT_CODE.get(home);
  const awayCode = EVENT_CODE.get(away);
  if (!homeCode || !awayCode) return [];
  const today = new Date();
  const dates = [];
  for (let offset = -2; offset <= 2; offset += 1) {
    const date = new Date(today.getTime() + offset * 86_400_000);
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates.flatMap((date) => [
    `fifwc-${homeCode}-${awayCode}-${date}`,
    `fifwc-${awayCode}-${homeCode}-${date}`,
  ]);
}

async function fetchEventBySlug(slug) {
  return fetchGammaJson(`${GAMMA_BASE_URL}/events/slug/${encodeURIComponent(slug)}`);
}

function eventMatches(event, home, away) {
  const text = normalizeText(`${event?.title ?? ""} ${event?.slug ?? ""}`);
  return hasTeamText(text, home) && hasTeamText(text, away);
}

function hasTeamText(text, team) {
  return teamTextVariants(team).some((variant) => text.includes(normalizeText(variant)));
}

async function buildMarketRows(eventBundle, context) {
  const rawRows = [];
  for (const [family, event] of [
    ["main", eventBundle.mainEvent],
    ["more", eventBundle.moreEvent],
    ["exactScore", eventBundle.exactScoreEvent],
  ]) {
    for (const market of event?.markets ?? []) {
      const outcomes = parseJsonArray(market.outcomes);
      const tokenIds = parseJsonArray(market.clobTokenIds);
      const outcomePrices = parseJsonArray(market.outcomePrices);
      for (let index = 0; index < outcomes.length; index += 1) {
        const outcome = String(outcomes[index]);
        if (!tokenIds[index]) continue;
        const classified = classifyMarket({ market, outcome, family, ...context });
        if (!classified) continue;
        rawRows.push({
          family,
          question: fixEncoding(market.question ?? ""),
          marketSlug: market.slug,
          outcome: fixEncoding(outcome),
          tokenId: String(tokenIds[index]),
          gammaPrice: toNullableNumber(outcomePrices[index]),
          liquidity: Number(market.liquidity ?? 0),
          volume: Number(market.volume ?? 0),
          ...classified,
        });
      }
    }
  }

  const rowsWithPrices = await mapLimit(rawRows, context.clobPrices && context.fast ? 25 : 10, async (row) => {
    const shouldFetchClob = context.clobPrices && (!context.fast || isPriorityClobRow(row));
    let priceResult = row.supported === false
      ? { price: null, error: null, source: null }
      : shouldFetchClob
        ? await fetchClobPrice(row.tokenId, context)
        : { price: row.gammaPrice, error: null, source: "gamma_outcomePrices" };
    if (context.fast && priceResult.price == null && row.gammaPrice != null) {
      priceResult = {
        price: row.gammaPrice,
        error: priceResult.error,
        source: priceResult.source ? `${priceResult.source}_fallback_gamma` : "gamma_outcomePrices",
      };
    }
    return {
      ...row,
      price: priceResult.price,
      priceSource: priceResult.source,
      priceError: priceResult.error,
    };
  });

  return rowsWithPrices.map((row) => {
    if (!row.condition) return { ...row, supported: false };
    const modelProbability = probabilityOf(row.condition, context.model.scoreDistribution);
    return {
      ...row,
      supported: true,
      modelProbability,
    };
  });
}

function isPriorityClobRow(row) {
  if (row.marketType === "exact_score") return false;
  if (row.liquidity != null && row.liquidity < 5_000) return false;
  return ["moneyline", "spread", "total", "team_total", "btts"].includes(row.marketType);
}

function classifyMarket({ market, outcome, family, home, away, includeHalves }) {
  const question = fixEncoding(market.question ?? "");
  const slug = String(market.slug ?? "");
  const normalizedOutcome = normalizeText(outcome);
  const q = normalizeText(question);

  if (!includeHalves && (q.includes("1st half") || q.includes("first half") || q.includes("2nd half") || q.includes("second half"))) {
    return { supported: false, marketType: "ignored_half_market" };
  }

  if (q.includes("end in a draw") && normalizedOutcome === "yes") {
    return makeClassified("moneyline", "draw", "Draw", (h, a) => h === a);
  }
  if (q.includes("will") && q.includes("win") && normalizedOutcome === "yes") {
    if (hasTeamText(q, home)) return makeClassified("moneyline", "home_win", `${home} win`, (h, a) => h > a);
    if (hasTeamText(q, away)) return makeClassified("moneyline", "away_win", `${away} win`, (h, a) => h < a);
  }

  const spreadMatch = question.match(/Spread:\s*(.+?)\s*\(([+-]?\d+(?:\.\d+)?)\)/i);
  if (spreadMatch) {
    const spreadTeam = teamFromText(spreadMatch[1], home, away);
    const line = Number(spreadMatch[2]);
    const outcomeTeam = teamFromText(outcome, home, away);
    if (spreadTeam && outcomeTeam) {
      const selectedLine = outcomeTeam === spreadTeam ? line : -line;
      const selectedSide = outcomeTeam === home ? "home" : "away";
      return makeClassified(
        "spread",
        `${selectedSide}_${formatSignedLine(selectedLine)}`,
        `${outcomeTeam} ${formatSignedLine(selectedLine)}`,
        (h, a) => selectedSide === "home" ? h + selectedLine > a : a + selectedLine > h,
      );
    }
  }

  const exactMatch = question.match(/Exact Score:\s*.+?\s+(\d+)\s*-\s*(\d+)\s+.+?\?/i);
  if (exactMatch && normalizedOutcome === "yes") {
    const homeGoals = Number(exactMatch[1]);
    const awayGoals = Number(exactMatch[2]);
    return makeClassified(
      "exact_score",
      `exact_${homeGoals}_${awayGoals}`,
      `Exact ${homeGoals}-${awayGoals}`,
      (h, a) => h === homeGoals && a === awayGoals,
    );
  }

  if (q.includes("exact score: any other score") && normalizedOutcome === "yes") {
    return makeClassified(
      "exact_score",
      "exact_any_other",
      "Exact Any Other",
      (h, a) => !isListedPolymarketExactScore(h, a),
    );
  }

  if (q.includes("both teams to score") && !q.includes("half")) {
    if (normalizedOutcome === "yes") return makeClassified("btts", "btts_yes", "BTTS Yes", (h, a) => h >= 1 && a >= 1);
    if (normalizedOutcome === "no") return makeClassified("btts", "btts_no", "BTTS No", (h, a) => h === 0 || a === 0);
  }

  const totalLine = extractTotalLine({ question, slug, home, away });
  if (totalLine) {
    const isOver = normalizedOutcome === "over";
    const isUnder = normalizedOutcome === "under";
    if (!isOver && !isUnder) return null;
    const { scope, team, line } = totalLine;
    const side = isOver ? "over" : "under";
    return makeClassified(
      scope === "match_total" ? "total" : "team_total",
      `${scope}_${team ?? "match"}_${side}_${line}`,
      `${team ? `${team} ` : ""}${side.toUpperCase()} ${line}`,
      (h, a) => {
        const goals = scope === "match_total" ? h + a : team === home ? h : a;
        return isOver ? goals > line : goals < line;
      },
    );
  }

  return null;
}

function extractTotalLine({ question, slug, home, away }) {
  const q = fixEncoding(question);
  const slugText = String(slug ?? "");
  const teamTotalSlug = slugText.match(/team-total-(home|away)-(\d+)pt(\d+)/);
  if (teamTotalSlug) {
    const side = teamTotalSlug[1] === "home" ? home : away;
    return { scope: "team_total", team: side, line: Number(`${teamTotalSlug[2]}.${teamTotalSlug[3]}`) };
  }
  const matchTotalSlug = slugText.match(/total-(\d+)pt(\d+)/);
  if (matchTotalSlug && !slugText.includes("team-total") && !slugText.includes("half")) {
    return { scope: "match_total", line: Number(`${matchTotalSlug[1]}.${matchTotalSlug[2]}`) };
  }

  const team = teamFromText(q.split(":").at(-1) ?? "", home, away);
  const match = q.match(/O\/U\s+(\d+(?:\.\d+)?)/i);
  if (!match) return null;
  if (team) return { scope: "team_total", team, line: Number(match[1]) };
  return { scope: "match_total", line: Number(match[1]) };
}

function makeClassified(marketType, key, label, condition) {
  return { marketType, key, label, condition };
}

function teamFromText(value, home, away) {
  const text = normalizeText(value);
  if (hasTeamText(text, home)) return home;
  if (hasTeamText(text, away)) return away;
  return null;
}

function probabilityOf(condition, scoreDistribution) {
  return scoreDistribution.reduce((sum, row) => (
    condition(row.homeGoals, row.awayGoals) ? sum + row.probability : sum
  ), 0);
}

function probabilitySummary(scoreDistribution) {
  return {
    homeWin: round(probabilityOf((h, a) => h > a, scoreDistribution), 4),
    draw: round(probabilityOf((h, a) => h === a, scoreDistribution), 4),
    awayWin: round(probabilityOf((h, a) => h < a, scoreDistribution), 4),
  };
}

async function fetchClobPrice(tokenId, options = {}) {
  if (!tokenId) return { price: null, error: "missing_token_id" };
  const attempts = options.fast ? 1 : 3;
  const baseTimeout = Number.isFinite(options.clobTimeoutMs)
    ? options.clobTimeoutMs
    : options.fast ? FAST_CLOB_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const data = await fetchJson(`${CLOB_BASE_URL}/price?token_id=${encodeURIComponent(tokenId)}&side=BUY`, {
        attempts: 1,
        timeoutMs: baseTimeout + attempt * 4_000,
        disablePowerShellFallback: options.fast,
      });
      const price = Number(data?.price);
      return { price: Number.isFinite(price) ? price : null, error: null, source: "clob_buy" };
    } catch (error) {
      if (attempt === attempts - 1) return { price: null, error: error.message, source: "clob_buy" };
      await sleep(300 + attempt * 350);
    }
  }
  return { price: null, error: "unknown_price_error", source: "clob_buy" };
}

async function fetchJson(url, options = {}) {
  if (options.preferPowerShell && process.platform === "win32") {
    return fetchJsonWithPowerShell(url, options);
  }
  const attempts = options.attempts ?? 3;
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), (options.timeoutMs ?? DEFAULT_TIMEOUT_MS) + attempt * 4_000);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "user-agent": "world-cup-betting-analysis/0.1" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await sleep(300 + attempt * 500);
    } finally {
      clearTimeout(timeout);
    }
  }
  if (process.platform === "win32" && !options.disablePowerShellFallback) {
    try {
      return await fetchJsonWithPowerShell(url, options);
    } catch (fallbackError) {
      fallbackError.cause = lastError;
      throw fallbackError;
    }
  }
  throw lastError;
}

async function fetchGammaJson(url) {
  return fetchJson(url, {
    preferPowerShell: process.platform === "win32",
    timeoutMs: 18_000,
  });
}

async function fetchJsonWithPowerShell(url, options = {}) {
  const timeoutSec = Math.ceil(((options.timeoutMs ?? DEFAULT_TIMEOUT_MS) + 8_000) / 1000);
  const escapedUrl = String(url).replace(/'/g, "''");
  const command = [
    "$ProgressPreference='SilentlyContinue';",
    `$r=Invoke-RestMethod -Uri '${escapedUrl}' -TimeoutSec ${timeoutSec};`,
    "$r | ConvertTo-Json -Depth 100 -Compress",
  ].join(" ");
  const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-Command", command], {
    timeout: timeoutSec * 1000 + 5_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function loadFinalAnalysis(analysisPath) {
  const absolutePath = resolve(analysisPath);
  const parsed = JSON.parse(readFileSync(absolutePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--analysis-file must point to a JSON object.");
  }
  return {
    ...parsed,
    sourcePath: absolutePath,
  };
}

function buildStrategyDraftsFromFinalAnalysis(finalAnalysis, valueTable, scoreDistribution) {
  const rowsByKey = new Map(valueTable.map((row) => [row.key, row]));
  const rowsByLabel = new Map(valueTable.map((row) => [String(row.label).toLowerCase(), row]));
  const strategies = finalAnalysis.strategies ?? finalAnalysis.strategyDrafts ?? {};
  const strategyNames = [
    ["main", ["main", "primary", "practical"]],
    ["profitProbability", ["profitProbability", "profit_probability", "profit", "hitRate"]],
    ["maxEv", ["maxEv", "max_ev", "ev", "highestEv"]],
    ["hedged", ["hedged", "balanced", "stable"]],
  ];

  return Object.fromEntries(strategyNames.map(([outputName, aliases]) => {
    const spec = findStrategySpec(strategies, aliases);
    const legs = buildManualLegs(spec, rowsByKey, rowsByLabel, outputName);
    const used = legs.reduce((sum, leg) => sum + leg.stake, 0);
    const explicitCash = spec && !Array.isArray(spec) && Number.isFinite(Number(spec.cash))
      ? Number(spec.cash)
      : null;
    const draft = {
      stake: round(used, 2),
      cash: explicitCash ?? Math.max(0, round(100 - used, 2)),
      legs,
    };
    return [outputName, {
      ...draft,
      metrics: portfolioMetrics(draft.legs, scoreDistribution),
    }];
  }));
}

function findStrategySpec(strategies, aliases) {
  for (const alias of aliases) {
    if (Object.hasOwn(strategies, alias)) return strategies[alias];
  }
  return { legs: [], cash: 100 };
}

function buildManualLegs(spec, rowsByKey, rowsByLabel, strategyName) {
  const legSpecs = Array.isArray(spec) ? spec : Array.isArray(spec?.legs) ? spec.legs : [];
  return legSpecs.map((legSpec, index) => {
    const key = legSpec.key ?? legSpec.marketKey ?? null;
    const label = legSpec.label ?? legSpec.marketLabel ?? null;
    const row = key ? rowsByKey.get(key) : rowsByLabel.get(String(label ?? "").toLowerCase());
    if (!row) {
      throw new Error(`Unknown market leg in ${strategyName}[${index}]: ${key ?? label ?? "(missing key)"}. Use a key from data mode output.markets.rows.`);
    }
    const stake = Number(legSpec.stake ?? legSpec.amount ?? legSpec.units);
    if (!Number.isFinite(stake) || stake <= 0) {
      throw new Error(`Invalid stake in ${strategyName}[${index}] for ${row.key}.`);
    }
    return marketLeg(row, round(stake, 2));
  });
}

// Legacy auto-draft helper kept for historical comparison only. Do not call it
// in the normal workflow: final portfolios must come from --analysis-file.
function buildStrategyDrafts(valueTable, scoreDistribution) {
  const usable = valueTable.filter((row) => row.price > 0 && row.price < 0.995 && row.evPerUnit > 0);
  const recommendable = usable.filter(isRecommendableRow);
  const exactScores = usable
    .filter((row) => row.marketType === "exact_score" && isRecommendableRow(row) && row.modelProbability >= 0.035)
    .sort((a, b) => strategyScore(b, "ev") - strategyScore(a, "ev"));
  const practical = selectDiversifiedRows(
    recommendable
      .filter((row) => row.marketType !== "exact_score")
      .filter((row) => row.price >= 0.08 && row.price <= 0.92)
      .filter((row) => row.modelProbability >= 0.12 && row.modelProbability <= 0.97)
      .filter((row) => row.evPerUnit >= 0.025)
      .sort((a, b) => strategyScore(b, "main") - strategyScore(a, "main")),
    { maxRows: 7, maxPerGroup: 2 },
  );
  const highProbability = selectDiversifiedRows(
    recommendable
      .filter((row) => row.modelProbability >= 0.72 && row.marketType !== "exact_score")
      .filter((row) => row.price >= 0.35 && row.price <= 0.94)
      .sort((a, b) => strategyScore(b, "profit") - strategyScore(a, "profit")),
    { maxRows: 5, maxPerGroup: 3 },
  );
  const highEv = selectDiversifiedRows(
    recommendable
      .filter((row) => row.modelProbability >= (row.marketType === "exact_score" ? 0.035 : 0.05))
      .sort((a, b) => strategyScore(b, "ev") - strategyScore(a, "ev")),
    { maxRows: 8, maxPerGroup: 3 },
  );
  const hedgedCore = selectDiversifiedRows(
    recommendable
      .filter((row) => row.marketType !== "exact_score")
      .filter((row) => row.price >= 0.18 && row.price <= 0.93)
      .filter((row) => row.modelProbability >= 0.45)
      .filter((row) => row.evPerUnit >= 0.02)
      .sort((a, b) => strategyScore(b, "hedged") - strategyScore(a, "hedged")),
    { maxRows: 6, maxPerGroup: 2 },
  );

  const drafts = {
    main: allocateDraft([
      ...practical.slice(0, 4),
      ...exactScores.slice(0, 1),
      ...topScoreHedges(valueTable, scoreDistribution).slice(0, 1),
    ], { maxStake: 100, perLegCap: 25, exactCap: 10 }),
    profitProbability: allocateDraft(highProbability.slice(0, 5), { maxStake: 100, perLegCap: 35, exactCap: 0 }),
    maxEv: allocateDraft(highEv.slice(0, 8), { maxStake: 100, perLegCap: 25, exactCap: 45 }),
    hedged: allocateDraft([
      ...hedgedCore.slice(0, 5),
      ...exactScores.slice(0, 1),
    ], { maxStake: 100, perLegCap: 25, exactCap: 10 }),
  };

  for (const [name, draft] of Object.entries(drafts)) {
    drafts[name] = {
      ...draft,
      metrics: portfolioMetrics(draft.legs, scoreDistribution),
    };
  }
  return drafts;
}

function isRecommendableRow(row) {
  if (row.price < MIN_RECOMMEND_PRICE || row.price > MAX_RECOMMEND_PRICE) return false;
  if (!Number.isFinite(row.evPerUnit) || row.evPerUnit > MAX_RECOMMEND_EV_PER_UNIT) return false;
  if (!Number.isFinite(row.modelProbability) || row.modelProbability <= 0) return false;
  return true;
}

function selectDiversifiedRows(rows, { maxRows, maxPerGroup }) {
  const selected = [];
  const groups = new Map();
  for (const row of rows) {
    const group = strategyGroup(row);
    const count = groups.get(group) ?? 0;
    const limit = group === "scoring_presence" ? 1 : maxPerGroup;
    if (count >= limit) continue;
    selected.push(row);
    groups.set(group, count + 1);
    if (selected.length >= maxRows) break;
  }
  return selected;
}

function strategyGroup(row) {
  if (row.key === "btts_yes" || row.key === "btts_no") return "scoring_presence";
  if (/^team_total_.+_(over|under)_0\.5$/.test(row.key)) return "scoring_presence";
  if (row.marketType === "spread") {
    const side = row.key.startsWith("home_") ? "home" : row.key.startsWith("away_") ? "away" : "unknown";
    return `spread_${side}`;
  }
  if (row.marketType === "team_total") {
    const parts = row.key.split("_");
    return `team_total_${parts[2] ?? row.label}`;
  }
  if (row.marketType === "total") return "match_total";
  if (row.marketType === "exact_score") return "exact_score";
  if (row.marketType === "moneyline") return "moneyline";
  return row.marketType;
}

function strategyScore(row, mode) {
  const edge = Math.max(0, row.edge ?? row.modelProbability - row.price);
  const ev = Math.max(0, row.evPerUnit ?? 0);
  const probability = Math.max(0.001, row.modelProbability ?? 0);
  const liquidityScore = Math.log10(Math.max(10, row.liquidity ?? 10)) / 6;
  const exactPenalty = row.marketType === "exact_score" ? 0.35 : 1;
  if (mode === "profit") return probability * 2 + ev * 0.25 + edge + liquidityScore * 0.1;
  if (mode === "ev") return ev * 2 + edge + probability * 0.2 + liquidityScore * 0.05;
  if (mode === "hedged") return probability * 1.1 + edge * 1.5 + ev * 0.35 + liquidityScore * 0.1;
  return (edge * 2 + ev * 0.7 + probability * 0.45 + liquidityScore * 0.1) * exactPenalty;
}

function allocateDraft(rows, { maxStake, perLegCap, exactCap }) {
  const uniqueRows = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || seen.has(row.key) || row.price == null || row.price <= 0) continue;
    seen.add(row.key);
    uniqueRows.push(row);
  }

  const weights = uniqueRows.map((row) => {
    const probabilityWeight = Math.max(0.2, row.modelProbability);
    const evWeight = Math.max(0.01, row.evPerUnit);
    const exactPenalty = row.marketType === "exact_score" ? 0.5 : 1;
    return probabilityWeight * evWeight * exactPenalty;
  });
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);

  let exactStake = 0;
  const legs = uniqueRows.map((row, index) => {
    const raw = totalWeight > 0 ? (weights[index] / totalWeight) * maxStake : 0;
    let stake = Math.min(perLegCap, roundToFive(raw));
    if (row.marketType === "exact_score") {
      const allowed = Math.max(0, exactCap - exactStake);
      stake = Math.min(stake, allowed);
      exactStake += stake;
    }
    return stake > 0 ? marketLeg(row, stake) : null;
  }).filter(Boolean);

  let used = legs.reduce((sum, leg) => sum + leg.stake, 0);
  for (const leg of legs) {
    if (used >= maxStake) break;
    const add = Math.min(5, maxStake - used, perLegCap - leg.stake);
    if (add > 0) {
      leg.stake += add;
      used += add;
    }
  }

  return {
    stake: used,
    cash: Math.max(0, maxStake - used),
    legs,
  };
}

function topScoreHedges(valueTable, scoreDistribution) {
  const byKey = new Map(valueTable.map((row) => [row.key, row]));
  return scoreDistribution
    .slice(0, 8)
    .map((score) => byKey.get(`exact_${score.homeGoals}_${score.awayGoals}`))
    .filter((row) => row && isRecommendableRow(row));
}

function marketLeg(row, stake) {
  return {
    key: row.key,
    label: row.label,
    marketType: row.marketType,
    stake,
    price: row.price,
    modelProbability: round(row.modelProbability, 4),
    evPerUnit: row.evPerUnit,
    condition: row.condition,
  };
}

function portfolioMetrics(legs, scoreDistribution) {
  const stake = legs.reduce((sum, leg) => sum + leg.stake, 0);
  const estimatedTakerFees = portfolioTakerFees(legs);
  const grossProfits = scoreDistribution.map((score) => ({
    probability: score.probability,
    profit: portfolioGrossProfit(legs, score.homeGoals, score.awayGoals),
  }));
  const profits = scoreDistribution.map((score) => ({
    probability: score.probability,
    profit: portfolioProfit(legs, score.homeGoals, score.awayGoals),
  }));
  const expectedValue = grossProfits.reduce((sum, row) => sum + row.probability * row.profit, 0);
  const costAdjustedExpectedValue = profits.reduce((sum, row) => sum + row.probability * row.profit, 0);
  const profitProbability = profits.reduce((sum, row) => row.profit > 0 ? sum + row.probability : sum, 0);
  const bigLossProbability = profits.reduce((sum, row) => row.profit < -50 ? sum + row.probability : sum, 0);
  return {
    stake,
    estimatedTakerFees: round(estimatedTakerFees, 2),
    expectedValue: round(expectedValue, 2),
    costAdjustedExpectedValue: round(costAdjustedExpectedValue, 2),
    profitProbability: round(profitProbability, 4),
    lossProbability: round(1 - profitProbability, 4),
    bigLossProbability: round(bigLossProbability, 4),
    confidence: portfolioConfidence({
      expectedValue,
      stake,
      profitProbability,
      bigLossProbability,
    }),
  };
}

function portfolioConfidence({ expectedValue, stake, profitProbability, bigLossProbability }) {
  if (stake <= 0) return 0;
  const evRate = expectedValue / stake;
  const score = 45
    + Math.max(-20, Math.min(25, evRate * 120))
    + Math.max(-15, Math.min(18, (profitProbability - 0.5) * 70))
    - Math.max(0, Math.min(25, bigLossProbability * 90));
  return Math.max(0, Math.min(95, Math.round(score)));
}

function portfolioProfit(legs, homeGoals, awayGoals) {
  const stake = legs.reduce((sum, leg) => sum + leg.stake, 0);
  const payout = legs.reduce((sum, leg) => {
    if (!leg.condition(homeGoals, awayGoals)) return sum;
    const fee = takerFeeForLeg(leg);
    return sum + (leg.stake - fee) / leg.price;
  }, 0);
  return payout - stake;
}

function portfolioGrossProfit(legs, homeGoals, awayGoals) {
  const stake = legs.reduce((sum, leg) => sum + leg.stake, 0);
  const payout = legs.reduce((sum, leg) => {
    if (!leg.condition(homeGoals, awayGoals)) return sum;
    return sum + leg.stake / leg.price;
  }, 0);
  return payout - stake;
}

function portfolioTakerFees(legs) {
  return legs.reduce((sum, leg) => sum + takerFeeForLeg(leg), 0);
}

function takerFeeForLeg(leg) {
  if (!Number.isFinite(leg.stake) || !Number.isFinite(leg.price)) return 0;
  // Official Polymarket fee formula for Sports taker trades:
  // fee = shares * feeRate * price * (1 - price). Since stake = shares * price,
  // fee = stake * feeRate * (1 - price).
  return round(leg.stake * SPORTS_TAKER_FEE_RATE * (1 - leg.price), 5);
}

function buildScorePnlTable(scoreDistribution, strategyDrafts, limit = 16) {
  return scoreDistribution.slice(0, limit).map((score) => {
    const row = {
      score: score.line,
      homeGoals: score.homeGoals,
      awayGoals: score.awayGoals,
      modelProbability: round(score.probability, 4),
      modelProbabilityPercent: round(score.probability * 100, 2),
      pnl: {},
    };
    for (const [name, draft] of Object.entries(strategyDrafts)) {
      row.pnl[name] = round(portfolioProfit(draft.legs, score.homeGoals, score.awayGoals), 2);
    }
    return row;
  });
}

function renderChatSummary(output) {
  const names = displayNamesForOutput(output);
  const htmlLine = output.artifacts?.htmlPath
    ? `已生成同款 HTML 卡片：[打开 HTML 分析卡](${output.artifacts.htmlPath})\n\n`
    : "";
  const model = output.model.live ?? output.model.base;
  const prices = moneylinePrices(output.markets.rows);
  const main = output.strategyDrafts.main;
  const rows = [
    `${htmlLine}数据源：`,
    "Polymarket 主盘",
    output.events.more ? "Polymarket 扩展盘" : null,
    output.events.exactScore ? "Polymarket 准确比分盘" : null,
    "本地预测模型",
    "",
    "核心结论",
    coreConclusion(output),
    "",
    `| 结果 | 模型概率 | Polymarket |`,
    `|---|---:|---:|`,
    `| ${names.home}胜 | ${percent(model.probabilities.homeWin)} | ${priceCell(prices.home_win)} |`,
    `| 平局 | ${percent(model.probabilities.draw)} | ${priceCell(prices.draw)} |`,
    `| ${names.away}胜 | ${percent(model.probabilities.awayWin)} | ${priceCell(prices.away_win)} |`,
    "",
    "我的主线是：",
    strategyThesis(output),
    "",
    "价值盘",
    "| 盘口 | 当前价 | 模型概率 | EV/1u | 判断 |",
    "|---|---:|---:|---:|---|",
    ...valueRowsForDisplay(output).map((row) => `| ${humanMarketLabel(row.label, output)} | ${priceCell(row.price)} | ${percent(row.modelProbability)} | ${signedPercent(row.evPerUnit)} | ${valueJudgment(row)} |`),
    "",
    "100u主策略 - 组合",
    "| 投注 | 金额 |",
    "|---|---:|",
    ...main.legs.map((leg) => `| ${humanMarketLabel(leg.label, output)} | ${leg.stake}u |`),
    ...(main.cash > 0 ? [`| 保留现金 / 不下注 | ${main.cash}u |`] : []),
    "",
    "100u主策略 - 组合测算",
    metricsMarkdown(main.metrics),
    "",
    "三个分析版本摘要",
    "| 版本 | EV | 成本后EV | 盈利概率 | 亏损超过50u | 置信度 |",
    "|---|---:|---:|---:|---:|---:|",
    ...strategySummaryRows(output),
    "",
    "准确比分检查",
    exactScoreCheck(output),
    "",
    `比分格式：${names.home}-${names.away}。`,
    "| 比分 | 模型比分概率 | 100u主策略 | 盈利概率最高版 | EV最高版 | 对冲稳健版 |",
    "|---|---:|---:|---:|---:|---:|",
    ...output.scorePnl.slice(0, Math.min(20, output.scorePnl.length)).map(scoreRowMarkdown),
    "",
    `一句话：${oneSentence(output)}`,
    "实际成交仍看盘口变化、买卖价差、滑点和流动性。",
  ].filter((line) => line != null);
  return rows.join("\n");
}

function writeHtmlCard(output, options) {
  const names = displayNamesForOutput(output);
  const timestamp = formatFileTimestamp(new Date(output.generatedAt));
  const filename = `${timestamp}_${output.input.home}-vs-${output.input.away}_betting-advice-card.html`;
  const htmlPath = resolve(options.outputDir ?? process.cwd(), filename);
  const html = renderHtmlCard(output, names);
  validateChineseHtml(html);
  writeFileSync(htmlPath, html, "utf8");
  return htmlPath;
}

function renderHtmlCard(output, names) {
  const model = output.model.live ?? output.model.base;
  const prices = moneylinePrices(output.markets.rows);
  const main = output.strategyDrafts.main;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(names.home)} vs ${escapeHtml(names.away)} - Polymarket 投注建议</title>
  <style>
    :root{color-scheme:dark;--bg:#0e151b;--panel:#151f28;--panel2:#1c2833;--line:#293947;--text:#eef6fd;--muted:#91a4b5;--blue:#20a8f3;--green:#17d77c;--red:#ff4e60;--yellow:#ffd166;--teal:#20d6b5}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 20% 0%,rgba(32,168,243,.16),transparent 28%),radial-gradient(circle at 92% 12%,rgba(23,215,124,.10),transparent 26%),var(--bg);color:var(--text);font-family:"Microsoft YaHei","PingFang SC","Noto Sans SC",Arial,sans-serif;line-height:1.65;padding:32px 18px}.page{width:min(1120px,100%);margin:0 auto}.eyebrow{color:var(--blue);font-size:14px;font-weight:800;margin-bottom:6px}h1{margin:0;font-size:clamp(30px,4vw,48px);line-height:1.12;letter-spacing:0}.subtitle{color:var(--muted);margin-top:10px;font-size:16px}.metric-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:22px 0}.metric,.section{background:rgba(21,31,40,.92);border:1px solid var(--line);border-radius:8px}.metric{min-height:112px;padding:15px 16px}.metric-label{color:var(--muted);font-size:13px;margin-bottom:6px}.metric-value{font-size:25px;font-weight:900;line-height:1.18}.metric-note{color:var(--muted);font-size:13px;margin-top:5px}.section{padding:20px;margin-top:16px}h2{margin:0 0 12px;font-size:23px;letter-spacing:0}p{margin:10px 0;font-size:16px}.callout{background:var(--panel2);border-left:4px solid var(--blue);border-radius:8px;padding:14px 16px;margin:14px 0}.callout.green{border-left-color:var(--green)}.callout.yellow{border-left-color:var(--yellow)}.pill{display:inline-block;background:#253542;border:1px solid #34495a;border-radius:999px;color:var(--text);font-weight:800;padding:2px 10px;white-space:nowrap}table{width:100%;border-collapse:collapse;margin-top:10px;border-radius:8px;overflow:hidden}th,td{border-bottom:1px solid var(--line);padding:12px 10px;text-align:left;font-size:15px;vertical-align:middle}th{color:#b8c8d5;background:#111b24;font-weight:900}tr:last-child td{border-bottom:0}.stake-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px}.stake-card{background:#101922;border:1px solid var(--line);border-radius:8px;padding:14px;min-height:118px}.stake-card strong{display:block;font-size:18px;margin-bottom:5px}.stake-card span{color:var(--muted);font-size:13px}.amount{color:var(--teal);font-size:30px;font-weight:900;margin-top:8px}.money-plus,.edge-good{color:var(--green);font-weight:900}.money-minus,.edge-bad{color:var(--red);font-weight:900}.edge-warn{color:var(--yellow);font-weight:900}.small{color:var(--muted);font-size:13px}a{color:#8fd0ff}@media(max-width:860px){.metric-grid,.stake-grid{grid-template-columns:1fr}body{padding:20px 12px}th,td{font-size:14px;padding:10px 8px}}
  </style>
</head>
<body>
  <main class="page">
    <div class="eyebrow">World Cup 2026 · Polymarket · 本地模型</div>
    <h1>${escapeHtml(names.home)} vs ${escapeHtml(names.away)}</h1>
    <div class="subtitle">${escapeHtml(snapshotSubtitle(output))}</div>
    <section class="metric-grid">
      <div class="metric"><div class="metric-label">模型胜平负</div><div class="metric-value">${percent(model.probabilities.homeWin)} / ${percent(model.probabilities.draw)} / ${percent(model.probabilities.awayWin)}</div><div class="metric-note">${escapeHtml(names.home)} / 平 / ${escapeHtml(names.away)}</div></div>
      <div class="metric"><div class="metric-label">Polymarket 胜平负</div><div class="metric-value">${priceCell(prices.home_win)} / ${priceCell(prices.draw)} / ${priceCell(prices.away_win)}</div><div class="metric-note">页面快照价，成交看买入面板</div></div>
      <div class="metric"><div class="metric-label">主策略 EV</div><div class="metric-value ${moneyClass(main.metrics.expectedValue)}">${signedMoney(main.metrics.expectedValue)}</div><div class="metric-note">成本后 ${signedMoney(main.metrics.costAdjustedExpectedValue)}</div></div>
      <div class="metric"><div class="metric-label">主策略置信度</div><div class="metric-value">${main.metrics.confidence}/100</div><div class="metric-note">盈利概率 ${percent(main.metrics.profitProbability)}</div></div>
    </section>
    <section class="section"><h2>核心结论</h2><div class="callout green"><p>${escapeHtml(coreConclusion(output))}</p><p>${escapeHtml(strategyThesis(output))}</p></div></section>
    <section class="section"><h2>价值盘</h2>${tableHtml(["盘口","当前价","模型概率","EV/1u","判断"], valueRowsForDisplay(output).map((row) => [humanMarketLabel(row.label, output), priceCell(row.price), percent(row.modelProbability), signedPercent(row.evPerUnit), valueJudgment(row)]))}</section>
    <section class="section"><h2>100u主策略 - 组合</h2><div class="stake-grid">${main.legs.map((leg) => `<div class="stake-card"><strong>${escapeHtml(humanMarketLabel(leg.label, output))}</strong><span>${priceCell(leg.price)}，模型 ${percent(leg.modelProbability)}</span><div class="amount">${leg.stake}u</div></div>`).join("")}${main.cash > 0 ? `<div class="stake-card"><strong>保留现金 / 不下注</strong><span>不强行凑满低质量盘口</span><div class="amount">${main.cash}u</div></div>` : ""}</div>${metricsHtml(main.metrics)}</section>
    <section class="section"><h2>三个分析版本摘要</h2>${tableHtml(["版本","EV","成本后EV","盈利概率","亏损超过50u","置信度"], strategySummaryCells(output), { raw: true })}</section>
    ${strategyVersionSectionHtml("盈利概率最高版", output.strategyDrafts.profitProbability, output)}
    ${strategyVersionSectionHtml("EV最高版", output.strategyDrafts.maxEv, output)}
    ${strategyVersionSectionHtml("对冲稳健版", output.strategyDrafts.hedged, output)}
    <section class="section"><h2>准确比分检查</h2><p>${escapeHtml(exactScoreCheck(output))}</p>${tableHtml(["比分盘","当前价","模型概率","EV/1u","判断"], exactRowsForDisplay(output).map((row) => [humanMarketLabel(row.label, output), priceCell(row.price), percent(row.modelProbability), signedPercent(row.evPerUnit), valueJudgment(row)]))}</section>
    <section class="section"><h2>比分盈亏表</h2><p class="small">比分格式：${escapeHtml(names.home)}-${escapeHtml(names.away)}。包含模型比分概率。</p>${tableHtml(["比分","模型比分概率","100u主策略","盈利概率最高版","EV最高版","对冲稳健版"], output.scorePnl.slice(0, 24).map((row) => [row.score, percent(row.modelProbability), moneyHtml(row.pnl.main), moneyHtml(row.pnl.profitProbability), moneyHtml(row.pnl.maxEv), moneyHtml(row.pnl.hedged)]), { raw: true })}</section>
    <section class="section"><h2>一句话</h2><div class="callout yellow"><p>${escapeHtml(oneSentence(output))}</p></div><p class="small">实际成交仍看盘口变化、买卖价差、滑点和流动性。此页面是模型和市场分析，不是保证收益。</p></section>
  </main>
</body>
</html>`;
}

function validateChineseHtml(html) {
  if (html.includes("\uFFFD") || html.includes("???")) {
    throw new Error("HTML validation failed: replacement characters or placeholder question marks detected.");
  }
  for (const requiredText of ["核心结论", "价值盘", "比分盈亏表", "模型比分概率"]) {
    if (!html.includes(requiredText)) throw new Error(`HTML validation failed: missing ${requiredText}.`);
  }
}

function displayNamesForOutput(output) {
  return {
    home: output.input.homeZh ?? TEAM_ZH.get(output.input.home) ?? displayName(output.input.home),
    away: output.input.awayZh ?? TEAM_ZH.get(output.input.away) ?? displayName(output.input.away),
  };
}

function snapshotSubtitle(output) {
  const event = output.events.main;
  const live = output.model.live?.liveState;
  const state = live ? `实时比分 ${live.score}，${live.elapsed}'` : "赛前快照";
  return `${formatDisplayTimestamp(new Date(output.generatedAt))}，${state}。价格源：${priceSourceLabel(output)}。`;
}

function priceSourceLabel(output) {
  const first = output.markets.rows.find((row) => row.priceSource);
  if (!first) return "Polymarket Gamma";
  return first.priceSource.includes("clob") ? "CLOB BUY / Gamma fallback" : "Gamma 页面快照价";
}

function coreConclusion(output) {
  const manual = finalAnalysisText(output, "coreConclusion");
  if (manual) return manual;
  const names = displayNamesForOutput(output);
  const model = output.model.live ?? output.model.base;
  const fav = model.probabilities.homeWin >= model.probabilities.awayWin ? names.home : names.away;
  const main = output.strategyDrafts.main;
  if (main.metrics.confidence < 45) return `这场没有特别干净的执行盘。${fav}方向是模型主线，但建议降低实际下注比例，把 100u 表当作标准化比较。`;
  return `这场模型主线偏向 ${fav}，但真正要看的是价格有没有高估热门或低估弱队进球/守住差距。主策略置信度 ${main.metrics.confidence}/100。`;
}

function strategyThesis(output) {
  const manual = finalAnalysisText(output, "strategyThesis");
  if (manual) return manual;
  const topLegs = output.strategyDrafts.main.legs.slice(0, 3).map((leg) => humanMarketLabel(leg.label, output)).join(" + ");
  return topLegs ? `我的主线是：${topLegs}。` : "我的主线是：没有足够清晰的组合，优先保留现金。";
}

function oneSentence(output) {
  const manual = finalAnalysisText(output, "oneSentence");
  if (manual) return manual;
  const main = output.strategyDrafts.main.metrics;
  const action = main.confidence >= 65 ? "可以参考主策略执行，但需要按实际成交价缩放仓位" : main.confidence >= 45 ? "只适合小仓或观察，不建议满仓照抄" : "不建议实际下重注";
  return `${action}；核心风险是高概率比分簇里是否出现主策略共振亏损。`;
}

function finalAnalysisText(output, field) {
  const value = output.finalAnalysis?.[field];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function valueRowsForDisplay(output) {
  return output.markets.rows
    .filter((row) => row.supported && row.price > 0 && Number.isFinite(row.evPerUnit))
    .filter(isRecommendableRow)
    .filter((row) => row.marketType !== "exact_score")
    .sort((a, b) => strategyScore(b, "main") - strategyScore(a, "main"))
    .slice(0, 10);
}

function exactRowsForDisplay(output) {
  return output.markets.rows
    .filter((row) => row.supported && row.price > 0 && row.marketType === "exact_score" && Number.isFinite(row.evPerUnit))
    .filter(isRecommendableRow)
    .sort((a, b) => strategyScore(b, "ev") - strategyScore(a, "ev"))
    .slice(0, 8);
}

function exactScoreCheck(output) {
  const manual = finalAnalysisText(output, "exactScoreCheck");
  if (manual) return manual;
  const rows = exactRowsForDisplay(output);
  if (!rows.length) return "这场没有拿到可用的准确比分盘口，比分只用于风险路径分析。";
  const selectedKeys = new Set(Object.values(output.strategyDrafts).flatMap((draft) => draft.legs.map((leg) => leg.key)));
  const selected = rows.filter((row) => selectedKeys.has(row.key));
  if (!selected.length) return "准确比分已检查，但没有进入主策略；原因通常是波动高、价格接近公平或只适合作为比分路径参考。";
  return `准确比分已检查，只有 ${selected.map((row) => humanMarketLabel(row.label, output)).join("、")} 进入某个分析版本，且应小仓处理。`;
}

function moneylinePrices(rows) {
  return Object.fromEntries(rows.filter((row) => ["home_win", "draw", "away_win"].includes(row.key)).map((row) => [row.key, row.price]));
}

function strategySummaryRows(output) {
  return [
    ["盈利概率最高版", output.strategyDrafts.profitProbability],
    ["EV最高版", output.strategyDrafts.maxEv],
    ["对冲稳健版", output.strategyDrafts.hedged],
  ].map(([label, draft]) => `| ${label} | ${signedMoney(draft.metrics.expectedValue)} | ${signedMoney(draft.metrics.costAdjustedExpectedValue)} | ${percent(draft.metrics.profitProbability)} | ${percent(draft.metrics.bigLossProbability)} | ${draft.metrics.confidence}/100 |`);
}

function strategySummaryCells(output) {
  return [
    ["盈利概率最高版", output.strategyDrafts.profitProbability],
    ["EV最高版", output.strategyDrafts.maxEv],
    ["对冲稳健版", output.strategyDrafts.hedged],
  ].map(([label, draft]) => [
    label,
    moneyHtml(draft.metrics.expectedValue),
    moneyHtml(draft.metrics.costAdjustedExpectedValue),
    percent(draft.metrics.profitProbability),
    percent(draft.metrics.bigLossProbability),
    `${draft.metrics.confidence}/100`,
  ]);
}

function metricsMarkdown(metrics) {
  return [
    "| 指标 | 结果 |",
    "|---|---:|",
    `| 模型期望净收益 | ${signedMoney(metrics.expectedValue)} |`,
    `| 成本后期望净收益 | ${signedMoney(metrics.costAdjustedExpectedValue)} |`,
    `| 盈利概率 | ${percent(metrics.profitProbability)} |`,
    `| 亏损概率 | ${percent(metrics.lossProbability)} |`,
    `| 亏损超过 50u 概率 | ${percent(metrics.bigLossProbability)} |`,
    `| 置信度 / 执行强度 | ${metrics.confidence}/100 |`,
  ].join("\n");
}

function strategyVersionSectionHtml(title, draft, output) {
  if (!draft) return "";
  const legCards = draft.legs.map((leg) => `<div class="stake-card"><strong>${escapeHtml(humanMarketLabel(leg.label, output))}</strong><span>${priceCell(leg.price)}，模型 ${percent(leg.modelProbability)}</span><div class="amount">${leg.stake}u</div></div>`).join("");
  const cashCard = draft.cash > 0
    ? `<div class="stake-card"><strong>保留现金 / 不下注</strong><span>不强行凑满低质量盘口</span><div class="amount">${draft.cash}u</div></div>`
    : "";
  return `<section class="section"><h2>${escapeHtml(title)} - 100u 组合</h2><div class="stake-grid">${legCards}${cashCard}</div>${metricsHtml(draft.metrics)}</section>`;
}

function metricsHtml(metrics) {
  return tableHtml(["指标", "结果"], [
    ["模型期望净收益", moneyHtml(metrics.expectedValue)],
    ["成本后期望净收益", moneyHtml(metrics.costAdjustedExpectedValue)],
    ["盈利概率", percent(metrics.profitProbability)],
    ["亏损概率", percent(metrics.lossProbability)],
    ["亏损超过 50u 概率", percent(metrics.bigLossProbability)],
    ["置信度 / 执行强度", `${metrics.confidence}/100`],
  ], { raw: true });
}

function scoreRowMarkdown(row) {
  return `| ${row.score} | ${percent(row.modelProbability)} | ${signedMoney(row.pnl.main)} | ${signedMoney(row.pnl.profitProbability)} | ${signedMoney(row.pnl.maxEv)} | ${signedMoney(row.pnl.hedged)} |`;
}

function tableHtml(headers, rows, options = {}) {
  const cell = options.raw ? (value) => String(value) : (value) => escapeHtml(value);
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((value) => `<td>${cell(value)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function moneyHtml(value) {
  return `<span class="${moneyClass(value)}">${signedMoney(value)}</span>`;
}

function moneyClass(value) {
  return Number(value) >= 0 ? "money-plus" : "money-minus";
}

function humanMarketLabel(label, output) {
  return String(label ?? "")
    .replaceAll(output.input.home, displayNamesForOutput(output).home)
    .replaceAll(output.input.away, displayNamesForOutput(output).away)
    .replace(/\bwin\b/i, "胜")
    .replace(/\bDraw\b/i, "平局")
    .replace(/\bOVER\b/g, "Over")
    .replace(/\bUNDER\b/g, "Under")
    .replace(/\bExact\b/g, "准确比分");
}

function valueJudgment(row) {
  if (row.evPerUnit >= 0.2) return "强价值";
  if (row.evPerUnit >= 0.08) return "中等价值";
  if (row.evPerUnit > 0) return "弱价值";
  if (row.evPerUnit > -0.03) return "接近公平";
  return "不买";
}

function priceCell(value) {
  return Number.isFinite(value) ? `${round(value * 100, 1)}c` : "-";
}

function percent(value) {
  return Number.isFinite(value) ? `${round(value * 100, 1)}%` : "-";
}

function signedPercent(value) {
  if (!Number.isFinite(value)) return "-";
  const rounded = round(value * 100, 1);
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

function signedMoney(value) {
  if (!Number.isFinite(value)) return "-";
  const rounded = round(value, 2);
  return `${rounded >= 0 ? "+" : ""}${rounded.toFixed(2)}u`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatFileTimestamp(date) {
  return formatInTimeZone(date)
    .replace(" ", "_")
    .replaceAll(":", "-");
}

function formatDisplayTimestamp(date) {
  return `${formatInTimeZone(date)} HKT`;
}

function formatInTimeZone(date) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute}:${byType.second}`;
}

function gradeValue(modelProbability, price) {
  const edge = modelProbability - price;
  if (edge >= 0.08) return "strong";
  if (edge >= 0.04) return "medium";
  if (edge >= 0.01) return "weak";
  if (edge > -0.01) return "fair";
  return "negative";
}

function sortValueRows(a, b) {
  const typeOrder = new Map([
    ["moneyline", 0],
    ["spread", 1],
    ["total", 2],
    ["team_total", 3],
    ["btts", 4],
    ["exact_score", 5],
  ]);
  return (typeOrder.get(a.marketType) ?? 99) - (typeOrder.get(b.marketType) ?? 99)
    || b.evPerUnit - a.evPerUnit
    || b.modelProbability - a.modelProbability;
}

function summarizeEvent(event) {
  if (!event) return null;
  return {
    title: fixEncoding(event.title ?? ""),
    slug: event.slug,
    updatedAt: event.updatedAt,
    startDate: event.startDate,
    endDate: event.endDate,
    score: event.score ?? null,
    elapsed: event.elapsed ?? null,
    active: event.active ?? null,
    closed: event.closed ?? null,
    volume: Number(event.volume ?? 0),
    liquidity: Number(event.liquidity ?? 0),
  };
}

function displayName(team) {
  return TEAM_DISPLAY_ALIASES.get(team)?.[0] ?? team.split("-").map(capitalize).join(" ");
}

function teamTextVariants(team) {
  return [team, displayName(team), ...(TEAM_DISPLAY_ALIASES.get(team) ?? [])];
}

function normalizeText(value) {
  return fixEncoding(String(value ?? ""))
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9+\-.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fixEncoding(value) {
  return String(value ?? "")
    .replace(/CuraÃ§ao/g, "Curaçao")
    .replace(/CÃ´te/g, "Côte")
    .replace(/TÃ¼rkiye/g, "Türkiye");
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatSignedLine(value) {
  return `${value > 0 ? "+" : ""}${value}`;
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function toNullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 2) {
  return Number(Number(value).toFixed(digits));
}

function roundToFive(value) {
  return Math.max(0, Math.round(value / 5) * 5);
}

function capitalize(value) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
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
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: {
      message: error.message,
      cause: process.env.DEBUG && error.cause ? String(error.cause.message ?? error.cause) : undefined,
      stack: process.env.DEBUG ? error.stack : undefined,
    },
  }, null, 2));
  process.exitCode = 1;
});
