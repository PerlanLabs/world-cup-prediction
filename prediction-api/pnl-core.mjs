import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

export const PNL_SCHEMA_VERSION = 1;
export const DEFAULT_PNL_ROOT = "盈亏分析";
export const DEFAULT_COST_BASIS = 100;

const TEAM_ALIASES = {
  "united-states": ["united states", "united-states", "usa"],
  "usa": ["united states", "united-states", "usa"],
  "argentina": ["argentina", "阿根廷"],
  "algeria": ["algeria", "阿尔及利亚"],
  "australia": ["australia", "澳大利亚"],
  "austria": ["austria", "奥地利"],
  "belgium": ["belgium", "比利时"],
  "bosnia-herzegovina": ["bosnia herzegovina", "bosnia-herzegovina", "bosnia and herzegovina", "bosnia-and-herzegovina", "波黑"],
  "bosnia-and-herzegovina": ["bosnia herzegovina", "bosnia-herzegovina", "bosnia and herzegovina", "bosnia-and-herzegovina", "波黑"],
  "brazil": ["brazil", "巴西"],
  "cabo-verde": ["cabo verde", "cabo-verde", "佛得角"],
  "cote-divoire": ["cote d'ivoire", "côte d'ivoire", "cote-divoire", "ivory coast", "科特迪瓦"],
  "curacao": ["curacao", "curaçao", "库拉索"],
  "czechia": ["czechia", "czech republic", "czech-republic", "捷克"],
  "czech-republic": ["czechia", "czech republic", "czech-republic", "捷克"],
  "ecuador": ["ecuador", "厄瓜多尔"],
  "egypt": ["egypt", "埃及"],
  "france": ["france", "法国"],
  "germany": ["germany", "德国"],
  "haiti": ["haiti", "海地"],
  "iran": ["iran", "伊朗"],
  "iraq": ["iraq", "伊拉克"],
  "japan": ["japan", "日本"],
  "jordan": ["jordan", "约旦"],
  "morocco": ["morocco", "摩洛哥"],
  "netherlands": ["netherlands", "荷兰"],
  "new-zealand": ["new zealand", "new-zealand", "新西兰"],
  "norway": ["norway", "挪威"],
  "portugal": ["portugal", "葡萄牙"],
  "congo-dr": ["congo dr", "congo-dr", "dr-congo", "刚果（金）", "刚果金"],
  "dr-congo": ["congo dr", "congo-dr", "dr-congo", "刚果（金）", "刚果金"],
  "england": ["england", "英格兰"],
  "croatia": ["croatia", "克罗地亚"],
  "qatar": ["qatar", "卡塔尔"],
  "saudi-arabia": ["saudi arabia", "saudi-arabia", "沙特阿拉伯", "沙特"],
  "scotland": ["scotland", "苏格兰"],
  "senegal": ["senegal", "塞内加尔"],
  "spain": ["spain", "西班牙"],
  "south-africa": ["south africa", "south-africa", "rsa", "南非"],
  "sweden": ["sweden", "瑞典"],
  "switzerland": ["switzerland", "瑞士"],
  "tunisia": ["tunisia", "突尼斯"],
  "turkiye": ["turkiye", "turkey", "türkiye", "土耳其"],
  "uruguay": ["uruguay", "乌拉圭"],
};

export function parseAdviceHtmlFile(filePath, options = {}) {
  const absolutePath = resolve(filePath);
  const html = readFileSync(absolutePath, "utf8");
  return parseAdviceHtml(html, {
    ...options,
    sourceFile: absolutePath,
  });
}

export function enrichAdviceWithSchedule(advice, matches = []) {
  const matchRecord = findScheduleMatch(advice.match, matches);
  if (!matchRecord) return advice;
  return {
    ...advice,
    match: {
      ...advice.match,
      matchDate: matchRecord.date ?? advice.match.matchDate ?? null,
      kickoffLocal: matchRecord.kickoffLocal ?? advice.match.kickoffLocal ?? null,
      storeMatchId: matchRecord.id ?? advice.match.storeMatchId ?? null,
      scheduleSource: "fifa-api-world-cup-2026-calendar",
    },
  };
}

export function parseAdviceHtml(html, options = {}) {
  const sourceFile = options.sourceFile ? resolve(options.sourceFile) : null;
  const fileMeta = sourceFile ? parseAdviceIdFromFile(sourceFile) : {};
  const match = parseMatch(html, fileMeta);
  const priceMap = buildPriceMap(html);
  const strategies = parseStrategies(html, match, priceMap);
  const scoreRows = parseScoreRows(html);
  const advice = {
    schemaVersion: PNL_SCHEMA_VERSION,
    sourceType: "html",
    sourceFile,
    sourceFileName: sourceFile ? basename(sourceFile) : null,
    adviceId: fileMeta.adviceId ?? buildAdviceId(fileMeta.date, fileMeta.time, match.id),
    adviceDate: fileMeta.date ?? parseDateFromHtml(html),
    adviceTime: parseAdviceTime(html, fileMeta),
    title: stripTags(firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ?? ""),
    subtitle: stripTags(firstMatch(html, /<div class="subtitle"[^>]*>([\s\S]*?)<\/div>/i) ?? firstMatch(html, /<p class="sub"[^>]*>([\s\S]*?)<\/p>/i) ?? ""),
    match,
    executionPreference: parseExecutionPreference(html),
    strategies,
    scorePnlRows: scoreRows,
    parser: {
      strategyCount: strategies.length,
      scoreRowCount: scoreRows.length,
      priceMapCount: priceMap.size,
    },
  };

  for (const strategy of advice.strategies) {
    inferMissingPricesFromScoreRows(strategy, advice.scorePnlRows, advice.match);
  }

  return advice;
}

export function buildAcceptedBets(advice, options = {}) {
  const selection = chooseAcceptedStrategy(advice, {
    strategyPolicy: options.strategyPolicy,
  });
  const strategy = selection.strategyName
    ? advice.strategies.find((item) => item.name === selection.strategyName)
    : null;
  const bets = (strategy?.bets ?? [])
    .filter((bet) => bet.kind !== "cash")
    .map((bet, index) => normalizeAcceptedBet(bet, advice.match, index));
  const cashReserved = (strategy?.bets ?? [])
    .filter((bet) => bet.kind === "cash")
    .reduce((sum, bet) => sum + (bet.stake ?? 0), 0);
  const totalStake = round2(bets.reduce((sum, bet) => sum + bet.stake, 0));

  return {
    schemaVersion: PNL_SCHEMA_VERSION,
    adviceId: advice.adviceId,
    importedAt: new Date().toISOString(),
    sourceType: advice.sourceType,
    sourceFiles: advice.sourceFiles ?? [advice.sourceFile].filter(Boolean),
    match: advice.match,
    selectedStrategy: selection.strategyName ?? "不下注",
    selectedStrategyReason: selection.reason,
    unit: "u",
    totalStake,
    cashReserved,
    bets,
    scorePnlReference: buildScorePnlReference(advice, selection.strategyName),
    status: "pending",
    notes: buildAcceptedNotes(advice, strategy, selection),
  };
}

export function importAdvice(advice, options = {}) {
  const root = resolve(options.root ?? DEFAULT_PNL_ROOT);
  const date = advice.match?.matchDate ?? options.matchDate ?? advice.adviceDate ?? dateFromAdviceId(advice.adviceId) ?? "unknown-date";
  const matchFolderName = advice.match?.matchupSlug ?? advice.match?.id ?? "unknown-match";
  const matchDir = join(root, date, matchFolderName);
  mkdirSync(matchDir, { recursive: true });

  const copiedSources = [];
  if (advice.sourceType === "html" && advice.sourceFile) {
    const target = join(matchDir, "accepted-advice.html");
    copyFileSync(advice.sourceFile, target);
    copiedSources.push(target);
  }
  for (const source of advice.sourceFiles ?? []) {
    if (!source || source === advice.sourceFile) continue;
    const target = join(matchDir, basename(source));
    copyFileSync(source, target);
    copiedSources.push(target);
  }
  if (advice.sourceType === "manual_screenshot") {
    writeFileSync(join(matchDir, "accepted-advice.md"), buildManualAdviceMarkdown(advice), "utf8");
  }

  const parsedForDisk = {
    ...advice,
    sourceFiles: copiedSources.length > 0 ? copiedSources.map((item) => resolve(item)) : advice.sourceFiles,
  };
  const accepted = buildAcceptedBets(parsedForDisk, options);
  writeJson(join(matchDir, "advice-parsed.json"), parsedForDisk);
  writeJson(join(matchDir, "accepted-bets.json"), accepted);
  writeMatchReport(matchDir, accepted, null, {
    status: "pending",
    reason: "official_result_not_checked_yet",
  });

  return {
    matchDir,
    advice: parsedForDisk,
    accepted,
  };
}

export function buildManualQatarAdvice(imagePaths = []) {
  const sourceFiles = imagePaths.map((item) => resolve(item));
  const match = {
    id: "qatar-switzerland",
    matchupSlug: "qatar-vs-switzerland",
    matchDate: "2026-06-14",
    kickoffLocal: null,
    homeSlug: "qatar",
    awaySlug: "switzerland",
    homeName: "卡塔尔",
    awayName: "瑞士",
    displayName: "卡塔尔 vs 瑞士",
  };
  const strategy = {
    name: "主推荐组合",
    heading: "卡塔尔 vs 瑞士主推荐组合",
    totalStake: 100,
    cashReserved: 0,
    bets: [
      buildBet("卡塔尔 +2.5", "64.5c", 35, match),
      buildBet("瑞士进球小 2.5", "53.5c", 25, match),
      buildBet("全场小 3.5", "64.5c", 20, match),
      buildBet("卡塔尔 +1.5", "39.5c", 15, match),
      buildBet("平局", "12.5c", 5, match),
    ],
    metrics: {},
  };
  return {
    schemaVersion: PNL_SCHEMA_VERSION,
    sourceType: "manual_screenshot",
    sourceFiles,
    sourceFileName: null,
    adviceId: "2026-06-14_05-47-23_qatar-vs-switzerland_screenshot-advice",
    adviceDate: "2026-06-14",
    adviceTime: "2026-06-14T05:47:23+08:00",
    title: "卡塔尔 vs 瑞士：主推荐组合",
    subtitle: "由用户提供的两张截图手工录入；比分格式为卡塔尔-瑞士。",
    match,
    executionPreference: "主推荐组合",
    strategies: [strategy],
    scorePnlRows: [
      scorePnl("0-0", "主推荐组合", 109.97),
      scorePnl("1-0", "主推荐组合", 69.97),
      scorePnl("0-1", "主推荐组合", 69.97),
      scorePnl("1-1", "主推荐组合", 109.97),
      scorePnl("0-2", "主推荐组合", 32.00),
      scorePnl("1-2", "主推荐组合", 69.97),
      scorePnl("2-2", "主推荐组合", 78.97),
      scorePnl("0-3", "主推荐组合", -68.99),
      scorePnl("1-3", "主推荐组合", -45.74),
      scorePnl("2-3", "主推荐组合", -7.76),
      scorePnl("3-3", "主推荐组合", 32.24),
      scorePnl("0-4 / 1-4", "主推荐组合", -100.00),
      scorePnl("2-4", "主推荐组合", -45.74),
    ],
    parser: {
      strategyCount: 1,
      scoreRowCount: 13,
      priceMapCount: 0,
      manual: true,
    },
  };
}

export function scanAcceptedBetFiles(root = DEFAULT_PNL_ROOT) {
  const absoluteRoot = resolve(root);
  if (!existsSync(absoluteRoot)) return [];
  const files = [];
  for (const dateName of readdirSync(absoluteRoot, { withFileTypes: true })) {
    if (!dateName.isDirectory() || dateName.name.startsWith("_")) continue;
    const dateDir = join(absoluteRoot, dateName.name);
    for (const matchName of readdirSync(dateDir, { withFileTypes: true })) {
      if (!matchName.isDirectory()) continue;
      const file = join(dateDir, matchName.name, "accepted-bets.json");
      if (existsSync(file)) files.push(file);
    }
  }
  return files.sort();
}

export function settleAcceptedBets(accepted, matchRecord) {
  const officialScore = getOfficialScore(matchRecord);
  if (!officialScore) {
    return {
      status: "pending",
      reason: "official_result_not_available_yet",
      matchId: accepted.match.id,
      checkedAt: new Date().toISOString(),
    };
  }

  const factScore = getFactScore(matchRecord);
  if (factScore && (factScore.home !== officialScore.home || factScore.away !== officialScore.away)) {
    return {
      status: "needs_review",
      reason: "official_score_conflicts_with_match_facts",
      matchId: accepted.match.id,
      checkedAt: new Date().toISOString(),
      finalScore: officialScore,
      matchFactsScore: factScore,
    };
  }

  const betResults = accepted.bets.map((bet) => settleBet(bet, officialScore, accepted.match));
  const unresolved = betResults.filter((item) => item.status !== "settled");
  const referencePnl = findReferencePnl(accepted.scorePnlReference, officialScore);
  const netPnl = round2(betResults.reduce((sum, item) => sum + (item.pnl ?? 0), 0));
  const grossReturn = round2(betResults.reduce((sum, item) => sum + (item.grossReturn ?? 0), 0));
  const computed = {
    status: unresolved.length > 0 && referencePnl == null ? "needs_review" : "settled",
    reason: unresolved.length > 0 && referencePnl == null ? "unsettled_bets_require_manual_review" : "official_score_available",
    matchId: accepted.match.id,
    checkedAt: new Date().toISOString(),
    source: "fifa-api-world-cup-2026-calendar",
    sourceFetchedAt: findSourceFetchedAt(matchRecord),
    finalScore: officialScore,
    selectedStrategy: accepted.selectedStrategy,
    totalStake: accepted.totalStake,
    grossReturn,
    netPnl,
    roiPercent: accepted.totalStake > 0 ? round2((netPnl / accepted.totalStake) * 100) : 0,
    betResults,
    scorePnlReference: referencePnl == null ? null : {
      netPnl: referencePnl,
      difference: round2(netPnl - referencePnl),
    },
  };

  if (unresolved.length > 0 && referencePnl != null) {
    computed.status = "settled_with_score_reference";
    computed.reason = "used_score_reference_for_unresolved_bet_details";
    computed.netPnl = referencePnl;
    computed.roiPercent = accepted.totalStake > 0 ? round2((referencePnl / accepted.totalStake) * 100) : 0;
  }

  return computed;
}

export function settleBet(bet, score, match) {
  if (!bet.settlement || bet.settlement.type === "unknown") {
    return {
      ...bet,
      status: "needs_review",
      reason: "unknown_settlement_rule",
    };
  }
  if (!(bet.price > 0)) {
    return {
      ...bet,
      status: "needs_review",
      reason: "missing_price",
    };
  }
  const won = isBetWon(bet.settlement, score, match);
  if (won == null) {
    return {
      ...bet,
      status: "needs_review",
      reason: "unsupported_settlement_rule",
    };
  }
  const grossReturn = won ? round2(bet.stake / bet.price) : 0;
  const pnl = won ? round2(grossReturn - bet.stake) : round2(-bet.stake);
  return {
    ...bet,
    status: "settled",
    won,
    grossReturn,
    pnl,
  };
}

export function writeSettlementOutputs(matchDir, accepted, settlement) {
  writeJson(join(matchDir, "settlement.json"), settlement);
  writeMatchReport(matchDir, accepted, settlement);
}

export function writeAggregateReports(root = DEFAULT_PNL_ROOT) {
  const absoluteRoot = resolve(root);
  const acceptedFiles = scanAcceptedBetFiles(absoluteRoot);
  const rows = acceptedFiles.map((file) => {
    const accepted = readJson(file);
    const settlementPath = join(dirname(file), "settlement.json");
    const settlement = existsSync(settlementPath) ? readJson(settlementPath) : null;
    return {
      file,
      matchDir: dirname(file),
      date: basename(dirname(dirname(file))),
      accepted,
      settlement,
    };
  });

  const generatedDir = join(absoluteRoot, "_generated");
  mkdirSync(generatedDir, { recursive: true });
  writeDailyReports(absoluteRoot, rows);
  writeFileSync(join(generatedDir, "all-bets.csv"), buildAllBetsCsv(rows), "utf8");
  writeFileSync(join(generatedDir, "match-pnl.csv"), buildMatchPnlCsv(rows), "utf8");
    writeFileSync(join(generatedDir, "daily-pnl.csv"), buildDailyPnlCsv(rows), "utf8");
    writeFileSync(join(generatedDir, "cumulative-pnl.md"), buildCumulativeMarkdown(rows), "utf8");
    writeFileSync(join(generatedDir, "strategy-comparison.md"), buildStrategyComparisonMarkdown(rows), "utf8");
    writeFileSync(join(generatedDir, "market-performance.csv"), buildMarketPerformanceCsv(rows), "utf8");
    writeFileSync(join(generatedDir, "market-performance.md"), buildMarketPerformanceMarkdown(rows), "utf8");

    return {
      acceptedCount: rows.length,
      generatedDir,
  };
}

function parseAdviceIdFromFile(filePath) {
  const name = basename(filePath, extname(filePath));
  const match = name.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})_(.+?)(?:_(?:betting-advice-card|80u-strategy-card|strategy-card|live-position-review|polymarket-analysis).*)?$/);
  if (!match) return { adviceId: name };
  const [, date, hour, minute, second, matchupSlug] = match;
  return {
    adviceId: name,
    date,
    time: `${hour}:${minute}:${second}`,
    matchupSlug,
    homeSlug: matchupSlug.split("-vs-")[0],
    awaySlug: matchupSlug.split("-vs-")[1],
  };
}

function findScheduleMatch(adviceMatch, matches) {
  if (!adviceMatch || !Array.isArray(matches)) return null;
  return matches.find((match) => match.id === adviceMatch.id)
    ?? matches.find((match) => (
      sameTeamId(match.homeTeamId, adviceMatch.homeSlug) &&
      sameTeamId(match.awayTeamId, adviceMatch.awaySlug)
    ))
    ?? matches.find((match) => (
      sameTeamId(match.homeTeamId, adviceMatch.awaySlug) &&
      sameTeamId(match.awayTeamId, adviceMatch.homeSlug)
    ))
    ?? null;
}

function sameTeamId(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const equivalentGroups = [
    ["bosnia-herzegovina", "bosnia-and-herzegovina"],
    ["cote-divoire", "ivory-coast"],
    ["czechia", "czech-republic"],
    ["cabo-verde", "cape-verde"],
    ["united-states", "usa"],
    ["turkiye", "turkey"],
    ["dr-congo", "congo-dr"],
  ];
  return equivalentGroups.some((group) => group.includes(left) && group.includes(right));
}

function parseMatch(html, fileMeta) {
  const h1 = stripTags(firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ?? "");
  const titlePart = h1.split(/[：:]/)[0];
  const nameParts = titlePart.split(/\s+vs\s+/i).map((item) => item.trim()).filter(Boolean);
  const homeSlug = fileMeta.homeSlug;
  const awaySlug = fileMeta.awaySlug;
  const homeName = nameParts[0] ?? displayNameForSlug(homeSlug);
  const awayName = nameParts[1] ?? displayNameForSlug(awaySlug);
  const id = homeSlug && awaySlug ? `${homeSlug}-${awaySlug}` : slugifyMatch(homeName, awayName);
  return {
    id,
    matchupSlug: homeSlug && awaySlug ? `${homeSlug}-vs-${awaySlug}` : id,
    homeSlug,
    awaySlug,
    homeName,
    awayName,
    displayName: homeName && awayName ? `${homeName} vs ${awayName}` : id,
  };
}

function parseAdviceTime(html, fileMeta) {
  if (fileMeta.date && fileMeta.time) return `${fileMeta.date}T${fileMeta.time}+08:00`;
  const text = stripTags(html);
  const match = text.match(/生成时间[:：]\s*(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return `${match[1]}T${match[2]}:${match[3]}:${match[4] ?? "00"}+08:00`;
}

function parseDateFromHtml(html) {
  const text = stripTags(html);
  return text.match(/生成时间[:：]\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

function parseExecutionPreference(html) {
  const metricMatch = html.match(/<div class="metric-label">\s*我的执行偏好\s*<\/div>\s*<div class="metric-value">([\s\S]*?)<\/div>/i);
  if (metricMatch) return stripTags(metricMatch[1]);
  const text = stripTags(html);
  const proseMatch = text.match(/我的执行偏好[:：]\s*([^。；;\n]+)/);
  if (proseMatch) return proseMatch[1].trim();
  const executionMatch = text.match(/执行偏好(?:仍然|依然|仍)?(?:是|[:：])\s*([^。；;\n]+)/);
  return executionMatch?.[1]?.trim() ?? null;
}

function buildPriceMap(html) {
  const priceMap = new Map();
  for (const table of parseTables(html)) {
    for (const row of table.rows) {
      if (row.length < 2) continue;
      const label = cleanCell(row[0]);
      if (!label || /^(盘口|市场|结果|版本|投注|比分|最终比分|指标)$/.test(label)) continue;
      const price = row.slice(1).map(parsePrice).find((value) => value != null);
      if (price != null) priceMap.set(normalizeMarketKey(label), price);
    }
  }
  return priceMap;
}

function parseStrategies(html, match, priceMap) {
  const headings = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)]
    .map((item) => ({
      index: item.index,
      end: item.index + item[0].length,
      text: stripTags(item[1]),
    }));
  const strategies = [];

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    if (!isStrategyHeading(heading.text)) continue;
    const next = headings[index + 1]?.index ?? html.length;
    const section = html.slice(heading.end, next);
    const bets = [
      ...parseStakeCards(section, match, priceMap),
      ...parseMetricBetCards(section, match, priceMap),
      ...parseStakeTable(section, match, priceMap),
    ];
    if (bets.length === 0) continue;
    const name = strategyNameFromHeading(heading.text);
    strategies.push({
      name,
      heading: heading.text,
      totalStake: round2(bets.filter((bet) => bet.kind !== "cash").reduce((sum, bet) => sum + bet.stake, 0)),
      cashReserved: round2(bets.filter((bet) => bet.kind === "cash").reduce((sum, bet) => sum + bet.stake, 0)),
      bets,
      metrics: parseStrategyMetrics(section),
    });
  }

  return dedupeStrategies(strategies);
}

function isStrategyHeading(text) {
  if (/比分|期望|风险|摘要|价值|核心|来源|建议$|为什么|不同比分|关键/.test(text) && !/组合$/.test(text)) return false;
  if (/组合比分|比分盈亏|常见比分|组合期望|三个版本摘要|三套\s*100u\s*版本/.test(text)) return false;
  return /盈利概率最高版|EV\s*最高版|对冲稳健版|主推荐组合|主策略|建议\s*\d+u\s*组合|\d+u\s*稳健组合|\d+u\s*资金处理|建议\s*100u\s*组合/i.test(text);
}

function strategyNameFromHeading(text) {
  if (/盈利概率最高版/.test(text)) return "盈利概率最高版";
  if (/EV\s*最高版/i.test(text)) return "EV 最高版";
  if (/对冲稳健版/.test(text)) return "对冲稳健版";
  if (/80u\s*稳健/.test(text)) return "80u 稳健版";
  if (/资金处理|轻仓/.test(text)) return "轻仓组合";
  return "主推荐组合";
}

function parseStakeCards(section, match, priceMap) {
  const bets = [];
  const regex = /<div class="stake-title">([\s\S]*?)<\/div>\s*<div class="stake-detail">([\s\S]*?)<\/div>\s*<div class="stake-amount">([\s\S]*?)<\/div>/gi;
  for (const item of section.matchAll(regex)) {
    const market = cleanCell(item[1]);
    const detail = cleanCell(item[2]);
    const stake = parseStake(item[3]);
    if (!market || stake == null) continue;
    const price = parsePrice(detail) ?? lookupPrice(priceMap, market);
    bets.push(buildBet(market, price, stake, match, { detail }));
  }
  const utf8CardRegex = /<div class="stake-card">\s*<strong>([\s\S]*?)<\/strong>\s*<span>([\s\S]*?)<\/span>\s*<div class="(?:stake-amount|amount)">([\s\S]*?)<\/div>\s*<\/div>/gi;
  for (const item of section.matchAll(utf8CardRegex)) {
    const market = cleanCell(item[1]);
    const detail = cleanCell(item[2]);
    const stake = parseStake(item[3]);
    if (!market || stake == null) continue;
    const price = parsePrice(detail) ?? lookupPrice(priceMap, market);
    bets.push(buildBet(market, price, stake, match, { detail }));
  }
  const inlineStakeCardRegex = /<div class="card">\s*<strong>([\s\S]*?)<\/strong>\s*(?:<span>([\s\S]*?)<\/span>)?\s*<\/div>/gi;
  for (const item of section.matchAll(inlineStakeCardRegex)) {
    const parsed = parseInlineStakeLabel(item[1]);
    const detail = cleanCell(item[2] ?? "");
    if (!parsed) continue;
    const price = parsePrice(detail) ?? lookupPrice(priceMap, parsed.market);
    bets.push(buildBet(parsed.market, price, parsed.stake, match, { detail }));
  }
  return bets;
}

function parseMetricBetCards(section, match, priceMap) {
  const bets = [];
  const regex = /<div class="metric-label">([\s\S]*?)<\/div>\s*<div class="metric-value">([\s\S]*?)<\/div>\s*<div class="metric-note">([\s\S]*?)<\/div>/gi;
  for (const item of section.matchAll(regex)) {
    const market = cleanCell(item[1]);
    const stake = parseStake(item[2]);
    const detail = cleanCell(item[3]);
    if (!market || stake == null) continue;
    const price = parsePrice(detail) ?? lookupPrice(priceMap, market);
    bets.push(buildBet(market, price, stake, match, { detail }));
  }
  return bets;
}

function parseStakeTable(section, match, priceMap) {
  const bets = [];
  for (const table of parseTables(section)) {
    const header = table.rows[0] ?? [];
    if (!header.some((cell) => /投注/.test(cell)) || !header.some((cell) => /金额/.test(cell))) continue;
    for (const row of table.rows.slice(1)) {
      if (row.length < 2) continue;
      const market = cleanCell(row[0]);
      const stake = parseStake(row[1]);
      if (!market || stake == null) continue;
      const explicitPrice = row.slice(2).map(parsePrice).find((value) => value != null);
      const price = explicitPrice ?? lookupPrice(priceMap, market);
      bets.push(buildBet(market, price, stake, match, { detail: row.slice(2).join(" ") }));
    }
    if (bets.length > 0) break;
  }
  return bets;
}

function buildBet(market, priceInput, stake, match, extra = {}) {
  const kind = /保留现金|现金|不下注/.test(market) ? "cash" : "bet";
  const price = typeof priceInput === "number" ? priceInput : parsePrice(priceInput);
  const settlement = kind === "cash" ? { type: "cash" } : inferSettlement(market, match);
  return {
    kind,
    market,
    stake: round2(stake),
    price: price == null ? null : round4(price),
    shares: price ? round2(stake / price) : null,
    sourceDetail: extra.detail ?? null,
    priceStatus: price == null && kind !== "cash" ? "missing" : "available",
    settlement,
  };
}

function parseStrategyMetrics(section) {
  const text = stripTags(section);
  return {
    expectedValue: parseMetric(text, /模型期望净收益\s*([+-]?\d+(?:\.\d+)?)u/),
    costAdjustedExpectedValue: parseMetric(text, /成本后(?:期望)?净收益\s*([+-]?\d+(?:\.\d+)?)u/),
    profitProbabilityPercent: parseMetric(text, /盈利概率\s*([0-9.]+)%/),
    lossProbabilityPercent: parseMetric(text, /亏损概率\s*([0-9.]+)%/),
    bigLossProbabilityPercent: parseMetric(text, /亏损超过\s*50u\s*概率\s*([0-9.]+)%/),
    confidence: parseMetric(text, /置信度\s*\/?\s*执行强度\s*([0-9.]+)\s*\/\s*100/),
  };
}

function parseMetric(text, regex) {
  const match = text.match(regex);
  return match ? Number(match[1]) : null;
}

function parseScoreRows(html) {
  const rows = [];
  for (const table of parseTables(html)) {
    const header = table.rows[0] ?? [];
    const looksLikeScoreTable = header.some((cell) => /比分/.test(cell)) && header.some((cell) => /盈亏|净盈亏|盈利概率最高版|对冲稳健版|组合/.test(cell));
    if (!looksLikeScoreTable) continue;
    for (const row of table.rows.slice(1)) {
      const score = cleanCell(row[0]);
      if (!/\d+\s*-\s*\d+/.test(score)) continue;
      const probability = row.map((cell) => cleanCell(cell).match(/^([0-9.]+)%$/)?.[1]).find(Boolean);
      const pnlByStrategy = {};
      for (let index = 1; index < row.length; index += 1) {
        const value = parsePnl(row[index]);
        if (value == null) continue;
        const headerName = cleanCell(header[index] ?? "");
        const key = scorePnlStrategyKey(headerName);
        pnlByStrategy[key] = value;
      }
      rows.push({
        score,
        probabilityPercent: probability == null ? null : Number(probability),
        pnlByStrategy,
      });
    }
  }
  return rows;
}

function scorePnlStrategyKey(headerName) {
  if (/盈利概率最高版/.test(headerName)) return "盈利概率最高版";
  if (/EV\s*最高版/i.test(headerName)) return "EV 最高版";
  if (/对冲稳健版/.test(headerName)) return "对冲稳健版";
  return "主推荐组合";
}

function inferMissingPricesFromScoreRows(strategy, scoreRows, match) {
  const missing = strategy.bets.filter((bet) => bet.kind !== "cash" && !(bet.price > 0));
  if (missing.length === 0 || scoreRows.length === 0) return;

  const missingIndexes = strategy.bets
    .map((bet, index) => ({ bet, index }))
    .filter((item) => item.bet.kind !== "cash" && !(item.bet.price > 0));
  const equations = [];
  const rhs = [];
  const totalStake = strategy.bets.filter((bet) => bet.kind !== "cash").reduce((sum, bet) => sum + bet.stake, 0);

  for (const row of scoreRows) {
    const pnl = row.pnlByStrategy[strategy.name] ?? row.pnlByStrategy["主推荐组合"];
    const score = parseScore(row.score);
    if (pnl == null || !score) continue;
    let knownGross = 0;
    const coefficients = [];
    let supported = true;
    for (const bet of strategy.bets) {
      if (bet.kind === "cash") continue;
      const won = isBetWon(bet.settlement, score, match);
      if (won == null) {
        supported = false;
        break;
      }
      if (bet.price > 0) {
        if (won) knownGross += bet.stake / bet.price;
      }
    }
    if (!supported) continue;
    for (const { bet } of missingIndexes) {
      coefficients.push(isBetWon(bet.settlement, score, match) ? 1 : 0);
    }
    equations.push(coefficients);
    rhs.push(pnl + totalStake - knownGross);
  }

  const solved = solveLinearSystem(equations, rhs, missingIndexes.length);
  if (!solved) return;
  for (let index = 0; index < solved.length; index += 1) {
    const grossPayout = solved[index];
    const target = missingIndexes[index].bet;
    if (grossPayout > 0 && target.stake > 0) {
      target.price = round4(target.stake / grossPayout);
      target.shares = round2(grossPayout);
      target.priceStatus = "inferred_from_score_table";
    }
  }
}

function chooseAcceptedStrategy(advice, options = {}) {
  const policy = options.strategyPolicy ?? "auto";
  const strategyNames = new Set(advice.strategies.map((item) => item.name));
  if (policy === "main" && strategyNames.has("主推荐组合")) {
    return { strategyName: "主推荐组合", reason: "user_policy_main" };
  }
  if (policy === "hedged" && strategyNames.has("对冲稳健版")) {
    return { strategyName: "对冲稳健版", reason: "user_policy_default_hedged" };
  }
  if (policy && policy !== "auto" && policy !== "html" && strategyNames.has(policy)) {
    return { strategyName: policy, reason: "user_selected_strategy" };
  }

  const preference = advice.executionPreference ?? "";
  if (/不下注|不建议实际下注|跳过|no bet/i.test(preference)) {
    return { strategyName: null, reason: "html_execution_preference_no_bet" };
  }
  const mainPreferenceIndex = findPreferenceIndex(preference, /主策略|主推荐|main/i);
  const hedgedPreferenceIndex = findPreferenceIndex(preference, /对冲稳健版|稳健|对冲|hedg/i);
  if (
    strategyNames.has("主推荐组合") &&
    mainPreferenceIndex !== -1 &&
    (hedgedPreferenceIndex === -1 || mainPreferenceIndex < hedgedPreferenceIndex)
  ) {
    return { strategyName: "主推荐组合", reason: "html_execution_preference_main" };
  }
  if (
    strategyNames.has("对冲稳健版") &&
    hedgedPreferenceIndex !== -1 &&
    (mainPreferenceIndex === -1 || hedgedPreferenceIndex < mainPreferenceIndex)
  ) {
    return { strategyName: "对冲稳健版", reason: "html_execution_preference_hedged" };
  }
  for (const name of strategyNames) {
    if (preference.includes(name)) return { strategyName: name, reason: "html_execution_preference" };
  }
  if (/主策略|主推荐|main/i.test(preference) && strategyNames.has("主推荐组合")) {
    return { strategyName: "主推荐组合", reason: "html_execution_preference_main" };
  }
  if (/稳健|对冲|hedg/i.test(preference) && strategyNames.has("对冲稳健版")) {
    return { strategyName: "对冲稳健版", reason: "html_execution_preference_hedged" };
  }
  if (strategyNames.has("对冲稳健版")) {
    return { strategyName: "对冲稳健版", reason: "default_three_strategy_hedged" };
  }
  const first = advice.strategies[0]?.name ?? null;
  return { strategyName: first, reason: first ? "single_or_first_strategy" : "no_strategy_found" };
}

function findPreferenceIndex(text, regex) {
  const match = String(text ?? "").match(regex);
  return match?.index ?? -1;
}

function normalizeAcceptedBet(bet, match, index) {
  return {
    id: `bet-${String(index + 1).padStart(2, "0")}`,
    market: bet.market,
    stake: bet.stake,
    price: bet.price,
    shares: bet.shares,
    priceStatus: bet.priceStatus,
    settlement: bet.settlement ?? inferSettlement(bet.market, match),
    sourceDetail: bet.sourceDetail,
  };
}

function buildScorePnlReference(advice, strategyName) {
  if (!strategyName) return [];
  return advice.scorePnlRows
    .map((row) => ({
      score: row.score,
      probabilityPercent: row.probabilityPercent,
      netPnl: row.pnlByStrategy[strategyName] ?? row.pnlByStrategy["主推荐组合"] ?? null,
    }))
    .filter((row) => row.netPnl != null);
}

function buildAcceptedNotes(advice, strategy, selection) {
  const notes = [`采用策略规则：${selection.reason}`];
  if (!strategy) notes.push("本场按不下注处理，真实投注金额为 0u。");
  const missing = strategy?.bets?.filter((bet) => bet.kind !== "cash" && !(bet.price > 0)) ?? [];
  if (missing.length > 0) notes.push(`以下盘口缺少可计算价格：${missing.map((bet) => bet.market).join("、")}。`);
  const inferred = strategy?.bets?.filter((bet) => bet.priceStatus === "inferred_from_score_table") ?? [];
  if (inferred.length > 0) notes.push(`部分价格由 HTML 比分盈亏表反推：${inferred.map((bet) => bet.market).join("、")}。`);
  return notes;
}

function inferSettlement(market, match) {
  const label = market.trim();
  const totalDirection = parseDirectionAndLine(label);
  const side = findMarketTeamSide(label, match);
  const exactScore = parseExactScoreMarket(label);

  if (exactScore) {
    return {
      type: "exact_score",
      home: exactScore.home,
      away: exactScore.away,
    };
  }
  if (/BTTS|双方进球/i.test(label)) {
    return {
      type: "btts",
      selection: /no|否/i.test(label) ? "no" : "yes",
    };
  }
  if (/平局|draw/i.test(label)) {
    return {
      type: "moneyline",
      selection: "draw",
    };
  }
  if (side && /胜|win/i.test(label)) {
    return {
      type: "moneyline",
      selection: side,
    };
  }
  if (side) {
    const spread = label.match(/([+-]\s*\d+(?:\.\d+)?)/);
    if (spread) {
      return {
        type: "spread",
        side,
        line: Number(spread[1].replace(/\s+/g, "")),
      };
    }
  }
  if (side && totalDirection) {
    return {
      type: "team_total",
      side,
      direction: totalDirection.direction,
      line: totalDirection.line,
    };
  }
  if (totalDirection) {
    return {
      type: "total",
      direction: totalDirection.direction,
      line: totalDirection.line,
    };
  }
  return {
    type: "unknown",
    raw: market,
  };
}

function parseDirectionAndLine(label) {
  const normalized = label.replace(/Ｏ/g, "O").replace(/Ｕ/g, "U");
  const overMatch = normalized.match(/(?:\bover\b|(?:^|[^A-Za-z0-9])O|大)\s*([0-9]+(?:\.[0-9]+)?)/i);
  const underMatch = normalized.match(/(?:\bunder\b|(?:^|[^A-Za-z0-9])U|小)\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (overMatch) return { direction: "over", line: Number(overMatch[1]) };
  if (underMatch) return { direction: "under", line: Number(underMatch[1]) };
  return null;
}

function parseExactScoreMarket(label) {
  if (!/准确比分|精确比分|exact\s*score|correct\s*score/i.test(label)) return null;
  const match = label.match(/(\d+)\s*-\s*(\d+)/);
  return match ? { home: Number(match[1]), away: Number(match[2]) } : null;
}

function findMarketTeamSide(label, match) {
  const normalized = label.toLowerCase();
  const sides = [
    ["home", match.homeSlug, match.homeName],
    ["away", match.awaySlug, match.awayName],
  ];
  for (const [side, slug, displayName] of sides) {
    const aliases = [...new Set([...(TEAM_ALIASES[slug] ?? [slug]), displayName].filter(Boolean))];
    for (const alias of aliases.sort((a, b) => b.length - a.length)) {
      if (alias && normalized.includes(alias.toLowerCase())) return side;
    }
  }
  return null;
}

function isBetWon(settlement, score) {
  const home = score.home;
  const away = score.away;
  if (settlement.type === "moneyline") {
    if (settlement.selection === "draw") return home === away;
    if (settlement.selection === "home") return home > away;
    if (settlement.selection === "away") return away > home;
  }
  if (settlement.type === "spread") {
    const teamGoals = settlement.side === "home" ? home : away;
    const opponentGoals = settlement.side === "home" ? away : home;
    return teamGoals + settlement.line > opponentGoals;
  }
  if (settlement.type === "total") {
    const total = home + away;
    return settlement.direction === "over" ? total > settlement.line : total < settlement.line;
  }
  if (settlement.type === "team_total") {
    const goals = settlement.side === "home" ? home : away;
    return settlement.direction === "over" ? goals > settlement.line : goals < settlement.line;
  }
  if (settlement.type === "btts") {
    const yes = home > 0 && away > 0;
    return settlement.selection === "yes" ? yes : !yes;
  }
  if (settlement.type === "exact_score") {
    return home === settlement.home && away === settlement.away;
  }
  if (settlement.type === "cash") return false;
  return null;
}

function solveLinearSystem(equations, rhs, variableCount) {
  if (variableCount === 0 || equations.length < variableCount) return null;
  const matrix = equations.map((row, index) => [...row.map(Number), Number(rhs[index])]);
  let rank = 0;

  for (let col = 0; col < variableCount && rank < matrix.length; col += 1) {
    let pivot = rank;
    for (let row = rank + 1; row < matrix.length; row += 1) {
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    }
    if (Math.abs(matrix[pivot][col]) < 1e-9) continue;
    [matrix[rank], matrix[pivot]] = [matrix[pivot], matrix[rank]];
    const divisor = matrix[rank][col];
    for (let c = col; c <= variableCount; c += 1) matrix[rank][c] /= divisor;
    for (let row = 0; row < matrix.length; row += 1) {
      if (row === rank) continue;
      const factor = matrix[row][col];
      if (Math.abs(factor) < 1e-9) continue;
      for (let c = col; c <= variableCount; c += 1) {
        matrix[row][c] -= factor * matrix[rank][c];
      }
    }
    rank += 1;
  }

  if (rank < variableCount) return null;
  const solution = Array(variableCount).fill(0);
  for (let row = 0; row < variableCount; row += 1) {
    const pivotCol = matrix[row].findIndex((value, index) => index < variableCount && Math.abs(value) > 1e-9);
    if (pivotCol >= 0) solution[pivotCol] = matrix[row][variableCount];
  }
  return solution.every((value) => Number.isFinite(value) && value > 0) ? solution : null;
}

function writeMatchReport(matchDir, accepted, settlement) {
  const status = settlement?.status ?? "pending";
  const lines = [
    `# ${accepted.match.displayName} 盈亏复盘`,
    "",
    `- 采用策略：${accepted.selectedStrategy}`,
    `- 状态：${status}`,
    `- 本场投注金额：${formatU(accepted.totalStake)}`,
  ];
  if (accepted.cashReserved > 0) lines.push(`- 保留现金：${formatU(accepted.cashReserved)}`);
  if (settlement?.finalScore) {
    lines.push(`- 最终比分：${settlement.finalScore.home}-${settlement.finalScore.away}`);
    lines.push(`- 净盈亏：${formatSignedU(settlement.netPnl)}`);
    lines.push(`- 收益率：${formatPercent((settlement.netPnl / DEFAULT_COST_BASIS) * 100)}`);
  } else {
    lines.push(`- 未结算原因：${settlement?.reason ?? "official_result_not_checked_yet"}`);
  }
  lines.push("", "## 投注明细", "", "| 投注 | 价格 | 投注金额 | 结算 | 盈亏 |", "|---|---:|---:|---|---:|");
  const resultsById = new Map((settlement?.betResults ?? []).map((item) => [item.id, item]));
  for (const bet of accepted.bets) {
    const result = resultsById.get(bet.id);
    lines.push(`| ${bet.market} | ${bet.price == null ? "待补" : `${round2(bet.price * 100)}c`} | ${formatU(bet.stake)} | ${formatBetStatus(result)} | ${result?.pnl == null ? "-" : formatSignedU(result.pnl)} |`);
  }
  if (accepted.notes?.length) {
    lines.push("", "## 备注", "");
    for (const note of accepted.notes) lines.push(`- ${note}`);
  }
  writeFileSync(join(matchDir, "match-pnl.md"), `${lines.join("\n")}\n`, "utf8");
}

function writeDailyReports(root, rows) {
  const byDate = groupBy(rows, (row) => row.date);
  for (const [date, dayRows] of byDate) {
    const lines = [
      `# ${date} 每日盈亏`,
      "",
      "| 比赛 | 采用策略 | 投注金额 | 盈亏 | 收益率 | 状态 |",
      "|---|---|---:|---:|---:|---|",
    ];
    for (const row of dayRows) {
      const settlement = row.settlement;
      lines.push(`| ${row.accepted.match.displayName} | ${row.accepted.selectedStrategy} | ${formatU(row.accepted.totalStake)} | ${settlement?.netPnl == null ? "-" : formatSignedU(settlement.netPnl)} | ${settlement?.netPnl == null ? "-" : formatPercent((settlement.netPnl / DEFAULT_COST_BASIS) * 100)} | ${settlement?.status ?? "pending"} |`);
    }
    const settledRows = dayRows.filter((row) => row.settlement?.netPnl != null);
    const stake = sum(settledRows, (row) => row.accepted.totalStake);
    const pnl = sum(settledRows, (row) => row.settlement.netPnl);
    lines.push("", `已结算投注金额：${formatU(stake)}`);
    lines.push(`当日净盈亏：${formatSignedU(pnl)}`);
    lines.push(`收益率：${formatPercent((pnl / DEFAULT_COST_BASIS) * 100)}`);
    lines.push(`未结算比赛数：${dayRows.length - settledRows.length}`);
    writeFileSync(join(root, date, "daily-pnl.md"), `${lines.join("\n")}\n`, "utf8");
  }
}

function buildAllBetsCsv(rows) {
  const csvRows = [["date", "matchId", "match", "strategy", "betId", "market", "price", "stake", "priceStatus", "status", "won", "pnl"]];
  for (const row of rows) {
    const results = new Map((row.settlement?.betResults ?? []).map((item) => [item.id, item]));
    for (const bet of row.accepted.bets) {
      const result = results.get(bet.id);
      csvRows.push([
        row.date,
        row.accepted.match.id,
        row.accepted.match.displayName,
        row.accepted.selectedStrategy,
        bet.id,
        bet.market,
        bet.price ?? "",
        bet.stake,
        bet.priceStatus,
        result?.status ?? "pending",
        result?.won ?? "",
        result?.pnl ?? "",
      ]);
    }
  }
  return toCsv(csvRows);
}

function buildMatchPnlCsv(rows) {
  const csvRows = [["date", "matchId", "match", "strategy", "betAmount", "netPnl", "returnPercent", "status", "finalScore"]];
  for (const row of rows) {
    const score = row.settlement?.finalScore ? `${row.settlement.finalScore.home}-${row.settlement.finalScore.away}` : "";
    csvRows.push([
      row.date,
      row.accepted.match.id,
      row.accepted.match.displayName,
      row.accepted.selectedStrategy,
      row.accepted.totalStake,
      row.settlement?.netPnl ?? "",
      row.settlement?.netPnl == null ? "" : round2((row.settlement.netPnl / DEFAULT_COST_BASIS) * 100),
      row.settlement?.status ?? "pending",
      score,
    ]);
  }
  return toCsv(csvRows);
}

function buildDailyPnlCsv(rows) {
  const csvRows = [["date", "settledMatches", "pendingMatches", "betAmount", "netPnl", "returnPercent"]];
  for (const [date, dayRows] of groupBy(rows, (row) => row.date)) {
    const settled = dayRows.filter((row) => row.settlement?.netPnl != null);
    const stake = sum(settled, (row) => row.accepted.totalStake);
    const pnl = sum(settled, (row) => row.settlement.netPnl);
    csvRows.push([date, settled.length, dayRows.length - settled.length, stake, round2(pnl), round2((pnl / DEFAULT_COST_BASIS) * 100)]);
  }
  return toCsv(csvRows);
}

function buildCumulativeMarkdown(rows) {
  const settled = rows.filter((row) => row.settlement?.netPnl != null);
  const stake = sum(settled, (row) => row.accepted.totalStake);
  const pnl = sum(settled, (row) => row.settlement.netPnl);
  const wins = settled.filter((row) => row.settlement.netPnl > 0).length;
  const lines = [
    "# 累计盈亏",
    "",
    `- 已导入比赛：${rows.length}`,
    `- 已结算比赛：${settled.length}`,
    `- 未结算比赛：${rows.length - settled.length}`,
    `- 总投注金额：${formatU(stake)}`,
    `- 成本基准：${formatU(DEFAULT_COST_BASIS)}`,
    `- 总净盈亏：${formatSignedU(pnl)}`,
    `- 收益率：${formatPercent((pnl / DEFAULT_COST_BASIS) * 100)}`,
    `- 盈利场次胜率：${settled.length > 0 ? formatPercent((wins / settled.length) * 100) : "-"}`,
    "",
    "| 日期 | 比赛 | 策略 | 投注金额 | 盈亏 | 状态 |",
    "|---|---|---|---:|---:|---|",
  ];
  for (const row of rows) {
    lines.push(`| ${row.date} | ${row.accepted.match.displayName} | ${row.accepted.selectedStrategy} | ${formatU(row.accepted.totalStake)} | ${row.settlement?.netPnl == null ? "-" : formatSignedU(row.settlement.netPnl)} | ${row.settlement?.status ?? "pending"} |`);
  }
  return `${lines.join("\n")}\n`;
}

function buildStrategyComparisonMarkdown(rows) {
  const lines = [
    "# 策略对比",
    "",
    "当前版本先保留每场 HTML 里的备选策略结构；真实累计盈亏只统计 `accepted-bets.json` 里的采用策略。",
    "后续如果要模拟三套策略的长期 ROI，可以在每场 `advice-parsed.json` 的策略价格完整后启用全策略结算。",
    "",
    "| 日期 | 比赛 | 实际采用策略 | 状态 | 实际盈亏 |",
    "|---|---|---|---|---:|",
  ];
  for (const row of rows) {
    lines.push(`| ${row.date} | ${row.accepted.match.displayName} | ${row.accepted.selectedStrategy} | ${row.settlement?.status ?? "pending"} | ${row.settlement?.netPnl == null ? "-" : formatSignedU(row.settlement.netPnl)} |`);
  }
  return `${lines.join("\n")}\n`;
}

function buildMarketPerformanceCsv(rows) {
  const betRows = collectSettledBetRows(rows);
  const summaries = [
    ...summarizeBetGroups(betRows, "strategy", (row) => row.strategy),
    ...summarizeBetGroups(betRows, "marketType", (row) => row.marketType),
    ...summarizeBetGroups(betRows, "marketDetail", (row) => row.marketDetail),
    ...summarizeBetGroups(betRows, "strategyMarketType", (row) => `${row.strategy} / ${row.marketType}`),
  ];
  const csvRows = [["dimension", "group", "betCount", "matchCount", "winCount", "stake", "netPnl", "roiPercent", "winRatePercent"]];
  for (const item of summaries) {
    csvRows.push([
      item.dimension,
      item.group,
      item.betCount,
      item.matchCount,
      item.winCount,
      item.stake,
      item.netPnl,
      item.roiPercent,
      item.winRatePercent,
    ]);
  }
  return toCsv(csvRows);
}

function buildMarketPerformanceMarkdown(rows) {
  const betRows = collectSettledBetRows(rows);
  const settledMatches = rows.filter((row) => row.settlement?.netPnl != null);
  const totalStake = sum(betRows, (row) => row.stake);
  const totalPnl = sum(betRows, (row) => row.pnl);
  const totalWins = betRows.filter((row) => row.won).length;
  const lines = [
    "# 盘口类型复盘",
    "",
    "这个报告只统计 `accepted-bets.json` 里的实际采用策略，并复用每场 `settlement.json` 的单注结算结果。",
    "ROI 使用真实下注金额作为分母，不使用 100u 成本基准归一化。",
    "",
    "## 总览",
    "",
    `- 已结算比赛：${settledMatches.length}`,
    `- 已结算单注：${betRows.length}`,
    `- 总投注金额：${formatU(totalStake)}`,
    `- 总净盈亏：${formatSignedU(totalPnl)}`,
    `- 真实 ROI：${totalStake > 0 ? formatPercent((totalPnl / totalStake) * 100) : "-"}`,
    `- 单注命中率：${betRows.length > 0 ? formatPercent((totalWins / betRows.length) * 100) : "-"}`,
    "",
  ];

  appendSummaryTable(lines, "按采用策略", summarizeBetGroups(betRows, "strategy", (row) => row.strategy));
  appendSummaryTable(lines, "按盘口类型", summarizeBetGroups(betRows, "marketType", (row) => row.marketType));
  appendSummaryTable(lines, "按盘口方向 / 线型", summarizeBetGroups(betRows, "marketDetail", (row) => row.marketDetail));
  appendSummaryTable(lines, "策略 x 盘口类型", summarizeBetGroups(betRows, "strategyMarketType", (row) => `${row.strategy} / ${row.marketType}`));

  lines.push("## 迭代提示", "");
  lines.push(...buildMarketPerformanceNotes(betRows));
  return `${lines.join("\n")}\n`;
}

function appendSummaryTable(lines, title, summaries) {
  lines.push(`## ${title}`, "");
  if (summaries.length === 0) {
    lines.push("暂无已结算单注。", "");
    return;
  }
  lines.push("| 分组 | 单注数 | 比赛数 | 命中 | 投注金额 | 净盈亏 | ROI | 命中率 |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const item of summaries) {
    lines.push(`| ${item.group} | ${item.betCount} | ${item.matchCount} | ${item.winCount} | ${formatU(item.stake)} | ${formatSignedU(item.netPnl)} | ${formatPercent(item.roiPercent)} | ${formatPercent(item.winRatePercent)} |`);
  }
  lines.push("");
}

function collectSettledBetRows(rows) {
  const betRows = [];
  for (const row of rows) {
    const resultsById = new Map((row.settlement?.betResults ?? []).map((item) => [item.id, item]));
    for (const acceptedBet of row.accepted.bets ?? []) {
      const result = resultsById.get(acceptedBet.id);
      if (result?.status !== "settled" || result.pnl == null || !(acceptedBet.stake > 0)) continue;
      const settlement = result.settlement ?? acceptedBet.settlement ?? {};
      betRows.push({
        date: row.date,
        matchId: row.accepted.match.id,
        match: row.accepted.match.displayName,
        strategy: row.accepted.selectedStrategy ?? "unknown",
        betId: acceptedBet.id,
        market: acceptedBet.market,
        marketType: settlement.type ?? "unknown",
        marketDetail: describeSettlement(settlement),
        price: result.price ?? acceptedBet.price ?? null,
        stake: Number(acceptedBet.stake),
        won: Boolean(result.won),
        pnl: Number(result.pnl),
      });
    }
  }
  return betRows;
}

function summarizeBetGroups(betRows, dimension, keyFn) {
  const grouped = groupBy(betRows, (row) => keyFn(row) || "unknown");
  return [...grouped.entries()]
    .map(([group, items]) => {
      const stake = sum(items, (row) => row.stake);
      const netPnl = sum(items, (row) => row.pnl);
      const winCount = items.filter((row) => row.won).length;
      return {
        dimension,
        group,
        betCount: items.length,
        matchCount: new Set(items.map((row) => row.matchId)).size,
        winCount,
        stake,
        netPnl,
        roiPercent: stake > 0 ? round2((netPnl / stake) * 100) : 0,
        winRatePercent: items.length > 0 ? round2((winCount / items.length) * 100) : 0,
      };
    })
    .sort((a, b) => Math.abs(b.stake) - Math.abs(a.stake) || a.group.localeCompare(b.group));
}

function describeSettlement(settlement) {
  if (!settlement?.type) return "unknown";
  if (settlement.type === "moneyline") return `moneyline:${settlement.selection ?? "unknown"}`;
  if (settlement.type === "spread") return `spread:${settlement.side ?? "unknown"} ${formatSignedLine(settlement.line)}`;
  if (settlement.type === "total") return `total:${settlement.direction ?? "unknown"} ${formatPlainLine(settlement.line)}`;
  if (settlement.type === "team_total") return `team_total:${settlement.side ?? "unknown"} ${settlement.direction ?? "unknown"} ${formatPlainLine(settlement.line)}`;
  if (settlement.type === "btts") return `btts:${settlement.selection ?? "unknown"}`;
  if (settlement.type === "exact_score") return `exact_score:${settlement.home}-${settlement.away}`;
  return settlement.type;
}

function formatSignedLine(value) {
  if (value == null || Number.isNaN(Number(value))) return "";
  const numeric = Number(value);
  return numeric > 0 ? `+${numeric}` : String(numeric);
}

function formatPlainLine(value) {
  if (value == null || Number.isNaN(Number(value))) return "";
  return String(Number(value));
}

function buildMarketPerformanceNotes(betRows) {
  if (betRows.length === 0) return ["- 暂无足够已结算单注。"];
  const byType = new Map(summarizeBetGroups(betRows, "marketType", (row) => row.marketType).map((item) => [item.group, item]));
  const byDetail = new Map(summarizeBetGroups(betRows, "marketDetail", (row) => row.marketDetail).map((item) => [item.group, item]));
  const notes = [
    "- 样本仍然偏小，不能把短期 ROI 当成确定规律；它更适合用来发现需要降权或复核的盘口族。",
  ];
  addTypeNote(notes, byType.get("team_total"), "team_total", "球队进球数");
  addTypeNote(notes, byType.get("spread"), "spread", "让球");
  addTypeNote(notes, byType.get("total"), "total", "总进球");
  addTypeNote(notes, byType.get("btts"), "btts", "双方进球");
  addTypeNote(notes, byType.get("moneyline"), "moneyline", "胜平负");
  addTypeNote(notes, byType.get("exact_score"), "exact_score", "准确比分");

  const weakDetails = [...byDetail.values()]
    .filter((item) => item.stake >= 30 && item.roiPercent < -10)
    .sort((a, b) => a.roiPercent - b.roiPercent)
    .slice(0, 5);
  if (weakDetails.length > 0) {
    notes.push(`- 需要重点复核的亏损方向：${weakDetails.map((item) => `${item.group} ${formatPercent(item.roiPercent)}`).join("；")}。`);
  }
  const strongDetails = [...byDetail.values()]
    .filter((item) => item.stake >= 30 && item.roiPercent > 10)
    .sort((a, b) => b.roiPercent - a.roiPercent)
    .slice(0, 5);
  if (strongDetails.length > 0) {
    notes.push(`- 当前表现较好的方向：${strongDetails.map((item) => `${item.group} ${formatPercent(item.roiPercent)}`).join("；")}。`);
  }
  return notes;
}

function addTypeNote(notes, summary, key, label) {
  if (!summary) return;
  const direction = summary.roiPercent >= 0 ? "正收益" : "负收益";
  notes.push(`- ${label}（${key}）：${summary.betCount} 注，${formatU(summary.stake)}，${formatSignedU(summary.netPnl)}，ROI ${formatPercent(summary.roiPercent)}，目前为${direction}。`);
}

function getOfficialScore(matchRecord) {
  if (matchRecord?.score?.home != null && matchRecord?.score?.away != null) {
    return { home: Number(matchRecord.score.home), away: Number(matchRecord.score.away) };
  }
  return null;
}

function getFactScore(matchRecord) {
  if (matchRecord?.matchFacts?.score?.home != null && matchRecord?.matchFacts?.score?.away != null) {
    return { home: Number(matchRecord.matchFacts.score.home), away: Number(matchRecord.matchFacts.score.away) };
  }
  return null;
}

function findSourceFetchedAt(matchRecord) {
  return matchRecord?.official?.dateUtc ?? matchRecord?.matchFacts?.retrievedAt ?? null;
}

function findReferencePnl(referenceRows = [], score) {
  const exact = referenceRows.find((row) => {
    const parsed = parseScore(row.score);
    return parsed && parsed.home === score.home && parsed.away === score.away;
  });
  return exact?.netPnl ?? null;
}

function parseTables(html) {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((tableMatch) => {
    const rows = [...tableMatch[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((rowMatch) => (
      [...rowMatch[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => cleanCell(cell[1]))
    )).filter((row) => row.length > 0);
    return { html: tableMatch[0], rows };
  });
}

function cleanCell(value) {
  return stripTags(value).replace(/\s+/g, " ").trim();
}

function stripTags(value) {
  return decodeHtml(String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function firstMatch(value, regex) {
  return value.match(regex)?.[1] ?? null;
}

function parsePrice(value) {
  if (value == null) return null;
  const text = cleanCell(value);
  const cents = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:c|¢)/i);
  if (cents) return Number(cents[1]) / 100;
  const percent = text.match(/^([0-9]+(?:\.[0-9]+)?)\s*%$/);
  if (percent) return Number(percent[1]) / 100;
  return null;
}

function parseStake(value) {
  const match = cleanCell(value).match(/([0-9]+(?:\.[0-9]+)?)\s*u/i);
  return match ? Number(match[1]) : null;
}

function parseInlineStakeLabel(value) {
  const text = cleanCell(value);
  const stake = parseStake(text);
  if (stake == null) return null;
  const market = text
    .replace(/\s*(?:[·•]\s*|\s+-\s*)?[0-9]+(?:\.[0-9]+)?\s*u\b/i, "")
    .trim();
  return market ? { market, stake } : null;
}

function parsePnl(value) {
  const match = cleanCell(value).match(/([+-]?\d+(?:\.\d+)?)\s*u/i);
  return match ? Number(match[1]) : null;
}

function parseScore(value) {
  if (String(value).includes("/")) return null;
  const match = cleanCell(value).match(/^(\d+)\s*-\s*(\d+)$/);
  return match ? { home: Number(match[1]), away: Number(match[2]) } : null;
}

function scorePnl(score, strategyName, pnl) {
  return {
    score,
    probabilityPercent: null,
    pnlByStrategy: {
      [strategyName]: pnl,
    },
  };
}

function lookupPrice(priceMap, market) {
  return priceMap.get(normalizeMarketKey(market)) ?? null;
}

function normalizeMarketKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/全场/g, "")
    .replace(/进球/g, "")
    .replace(/\bover\b/g, "大")
    .replace(/\bunder\b/g, "小")
    .replace(/\bO\s*(\d)/gi, "大$1")
    .replace(/\bU\s*(\d)/gi, "小$1")
    .replace(/\s+/g, "")
    .replace(/yes/g, "")
    .trim();
}

function dedupeStrategies(strategies) {
  const seen = new Set();
  const deduped = [];
  for (const strategy of strategies) {
    const key = `${strategy.name}:${strategy.bets.map((bet) => `${bet.market}:${bet.stake}`).join("|")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(strategy);
  }
  return deduped;
}

function dateFromAdviceId(adviceId) {
  return adviceId?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
}

function buildAdviceId(date, time, matchId) {
  if (!date || !matchId) return `advice-${Date.now()}`;
  return `${date}_${String(time ?? "00:00:00").replaceAll(":", "-")}_${matchId}`;
}

function slugifyMatch(homeName, awayName) {
  if (!homeName || !awayName) return "unknown-match";
  return `${slugify(homeName)}-${slugify(awayName)}`;
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-|-$/g, "");
}

function displayNameForSlug(slug) {
  return TEAM_ALIASES[slug]?.find((item) => /[\u4e00-\u9fa5]/.test(item)) ?? slug;
}

function buildManualAdviceMarkdown(advice) {
  const lines = [
    `# ${advice.title}`,
    "",
    advice.subtitle,
    "",
    "## 投注组合",
    "",
    "| 盘口 | 当前价附近 | 投注金额 |",
    "|---|---:|---:|",
  ];
  for (const bet of advice.strategies[0].bets) {
    lines.push(`| ${bet.market} | ${round2(bet.price * 100)}c | ${formatU(bet.stake)} |`);
  }
  lines.push("", "## 证据截图", "");
  for (const file of advice.sourceFiles ?? []) lines.push(`- ${file}`);
  return `${lines.join("\n")}\n`;
}

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function sum(items, valueFn) {
  return round2(items.reduce((total, item) => total + Number(valueFn(item) ?? 0), 0));
}

function toCsv(rows) {
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function formatBetStatus(result) {
  if (!result) return "pending";
  if (result.status !== "settled") return result.reason ?? result.status;
  return result.won ? "命中" : "未命中";
}

function formatU(value) {
  return `${round2(value).toFixed(2)}u`;
}

function formatSignedU(value) {
  const rounded = round2(value);
  return `${rounded >= 0 ? "+" : ""}${rounded.toFixed(2)}u`;
}

function formatPercent(value) {
  return `${round2(value).toFixed(2)}%`;
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function round4(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
}
