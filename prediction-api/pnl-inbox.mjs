import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { getStore } from "./store.mjs";
import {
  DEFAULT_PNL_ROOT,
  enrichAdviceWithSchedule,
  importAdvice,
  parseAdviceHtmlFile,
  writeAggregateReports,
} from "./pnl-core.mjs";

export const PNL_INBOX_DIRS = {
  html: ["_inbox", "html"],
  screenshots: ["_inbox", "screenshots"],
  manual: ["_inbox", "manual"],
  processed: ["_processed"],
  failed: ["_failed"],
  generated: ["_generated"],
};

export function ensurePnlInbox(root = DEFAULT_PNL_ROOT) {
  const absoluteRoot = resolve(root);
  const dirs = Object.fromEntries(
    Object.entries(PNL_INBOX_DIRS).map(([key, parts]) => [key, join(absoluteRoot, ...parts)]),
  );
  mkdirSync(absoluteRoot, { recursive: true });
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  return {
    root: absoluteRoot,
    ...dirs,
  };
}

export function importInbox(options = {}) {
  const root = resolve(options.root ?? DEFAULT_PNL_ROOT);
  const strategyPolicy = options.strategyPolicy ?? "hedged";
  const dirs = ensurePnlInbox(root);
  const logPath = join(dirs.generated, "import-log.json");
  const log = readImportLog(logPath);
  const store = getStore();
  const files = [
    ...listFiles(dirs.html, [".html"]).map((file) => ({ type: "html", file })),
    ...listFiles(dirs.manual, [".json"]).map((file) => ({ type: "manual_json", file })),
  ].sort((left, right) => left.file.localeCompare(right.file));
  const importedHashes = new Set(log.imported.map((item) => item.sha256).filter(Boolean));
  const results = [];

  for (const item of files) {
    const originalPath = resolve(item.file);
    assertInside(originalPath, dirs.root);
    const sha256 = hashFile(originalPath);
    const sourceMeta = {
      sourceType: item.type,
      sourceFileName: basename(originalPath),
      sourceOriginalPath: originalPath,
      sha256,
    };

    if (importedHashes.has(sha256)) {
      const archivedPath = archiveSource(originalPath, join(dirs.processed, "duplicates"), today());
      results.push({
        ...sourceMeta,
        status: "skipped_duplicate",
        sourceArchivedPath: archivedPath,
      });
      continue;
    }

    try {
      const advice = enrichAdviceWithSchedule(parseInboxAdvice(item, dirs), store.matches);
      const imported = importAdvice(advice, {
        root,
        strategyPolicy,
      });
      const archiveDate = advice.match?.matchDate ?? advice.adviceDate ?? today();
      const archivedPath = archiveSource(originalPath, dirs.processed, archiveDate);
      const result = {
        ...sourceMeta,
        status: "imported",
        sourceArchivedPath: archivedPath,
        adviceId: imported.accepted.adviceId,
        matchId: imported.accepted.match.id,
        match: imported.accepted.match.displayName,
        matchDate: imported.accepted.match.matchDate ?? archiveDate,
        selectedStrategy: imported.accepted.selectedStrategy,
        totalStake: imported.accepted.totalStake,
        matchDir: imported.matchDir,
        importedAt: imported.accepted.importedAt,
      };
      log.imported.push(result);
      importedHashes.add(sha256);
      results.push(result);
    } catch (error) {
      const archivedPath = archiveSource(originalPath, dirs.failed, today());
      const result = {
        ...sourceMeta,
        status: "failed",
        sourceArchivedPath: archivedPath,
        failedAt: new Date().toISOString(),
        error: {
          code: error.code ?? "pnl_inbox_import_failed",
          message: error.message,
        },
      };
      log.failed.push(result);
      results.push(result);
    }
  }

  log.updatedAt = new Date().toISOString();
  log.lastRun = summarizeRun(results);
  writeJson(logPath, log);
  const aggregate = writeAggregateReports(root);

  return {
    ok: true,
    root,
    inbox: {
      html: dirs.html,
      screenshots: dirs.screenshots,
      manual: dirs.manual,
    },
    processedDir: dirs.processed,
    failedDir: dirs.failed,
    logPath,
    scannedCount: results.length,
    importedCount: results.filter((item) => item.status === "imported").length,
    skippedDuplicateCount: results.filter((item) => item.status === "skipped_duplicate").length,
    failedCount: results.filter((item) => item.status === "failed").length,
    results,
    aggregate,
  };
}

function parseInboxAdvice(item, dirs) {
  if (item.type === "html") return parseAdviceHtmlFile(item.file);
  if (item.type === "manual_json") return parseManualAdviceFile(item.file, dirs);
  throw new Error(`Unsupported inbox source type: ${item.type}`);
}

function parseManualAdviceFile(filePath, dirs) {
  const raw = JSON.parse(readFileSync(filePath, "utf8"));
  const input = raw.advice ?? raw;
  const strategyName = input.selectedStrategy ?? input.strategyName ?? input.executionPreference ?? "主推荐组合";
  const match = normalizeManualMatch(input.match, filePath);
  const strategies = normalizeManualStrategies(input, strategyName, match);
  const scorePnlRows = normalizeManualScoreRows(input.scorePnlRows ?? input.scoreRows ?? [], strategyName);
  const sourceFiles = [
    resolve(filePath),
    ...resolveManualEvidenceFiles(input.sourceFiles ?? input.evidenceFiles ?? [], filePath, dirs),
  ];

  return {
    schemaVersion: input.schemaVersion ?? 1,
    sourceType: input.sourceType ?? "manual_screenshot",
    sourceFiles,
    sourceFileName: basename(filePath),
    adviceId: input.adviceId ?? basename(filePath, extname(filePath)),
    adviceDate: input.adviceDate ?? match.matchDate ?? null,
    adviceTime: input.adviceTime ?? null,
    title: input.title ?? `${match.displayName} manual accepted advice`,
    subtitle: input.subtitle ?? "Manual JSON advice imported from the P&L inbox.",
    match,
    executionPreference: input.executionPreference ?? strategyName,
    strategies,
    scorePnlRows,
    parser: {
      strategyCount: strategies.length,
      scoreRowCount: scorePnlRows.length,
      manualJson: true,
    },
  };
}

function normalizeManualMatch(match, filePath) {
  if (!match) throw new Error(`${basename(filePath)} is missing match.`);
  const matchupSlug = match.matchupSlug ?? match.slug ?? null;
  const [homeFromSlug, awayFromSlug] = matchupSlug?.split("-vs-") ?? [];
  const homeSlug = match.homeSlug ?? match.homeTeamId ?? homeFromSlug;
  const awaySlug = match.awaySlug ?? match.awayTeamId ?? awayFromSlug;
  if (!homeSlug || !awaySlug) {
    throw new Error(`${basename(filePath)} match must include homeSlug and awaySlug or matchupSlug.`);
  }
  const id = match.id ?? `${homeSlug}-${awaySlug}`;
  const normalizedMatchupSlug = matchupSlug ?? `${homeSlug}-vs-${awaySlug}`;
  const homeName = match.homeName ?? match.home ?? homeSlug;
  const awayName = match.awayName ?? match.away ?? awaySlug;
  return {
    id,
    matchupSlug: normalizedMatchupSlug,
    matchDate: match.matchDate ?? match.date ?? null,
    kickoffLocal: match.kickoffLocal ?? null,
    storeMatchId: match.storeMatchId ?? null,
    scheduleSource: match.scheduleSource ?? "manual_json",
    homeSlug,
    awaySlug,
    homeName,
    awayName,
    displayName: match.displayName ?? `${homeName} vs ${awayName}`,
  };
}

function normalizeManualStrategies(input, defaultStrategyName, match) {
  const rawStrategies = input.strategies?.length
    ? input.strategies
    : [{
      name: defaultStrategyName,
      bets: input.bets ?? [],
      metrics: input.metrics ?? {},
    }];
  const strategies = rawStrategies.map((strategy) => {
    const bets = (strategy.bets ?? []).map((bet) => normalizeManualBet(bet, match));
    return {
      name: strategy.name ?? defaultStrategyName,
      heading: strategy.heading ?? strategy.name ?? defaultStrategyName,
      totalStake: round2(bets.filter((bet) => bet.kind !== "cash").reduce((sum, bet) => sum + bet.stake, 0)),
      cashReserved: round2(bets.filter((bet) => bet.kind === "cash").reduce((sum, bet) => sum + bet.stake, 0)),
      bets,
      metrics: strategy.metrics ?? {},
    };
  });
  if (strategies.every((strategy) => strategy.bets.length === 0)) {
    throw new Error("Manual advice JSON must include at least one bet.");
  }
  return strategies;
}

function normalizeManualBet(bet) {
  const market = bet.market ?? bet.name ?? bet.label;
  const stake = Number(bet.stake ?? bet.amount);
  if (!market || !Number.isFinite(stake)) throw new Error("Manual bet must include market and stake.");
  const price = parseManualPrice(bet.price ?? bet.priceText ?? bet.currentPrice ?? bet.priceCents);
  const kind = bet.kind ?? (/cash|reserve|hold/i.test(market) ? "cash" : "bet");
  return {
    kind,
    market,
    stake: round2(stake),
    price,
    shares: price ? round2(stake / price) : null,
    sourceDetail: bet.sourceDetail ?? bet.detail ?? null,
    priceStatus: price == null && kind !== "cash" ? "missing" : "available",
    settlement: bet.settlement,
  };
}

function normalizeManualScoreRows(rows, strategyName) {
  return rows.map((row) => {
    const pnlByStrategy = row.pnlByStrategy
      ?? (row.netPnl == null ? {} : { [strategyName]: Number(row.netPnl) });
    return {
      score: row.score,
      probabilityPercent: row.probabilityPercent ?? row.probability ?? null,
      pnlByStrategy,
    };
  }).filter((row) => row.score && Object.keys(row.pnlByStrategy).length > 0);
}

function parseManualPrice(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return round4(value > 1 ? value / 100 : value);
  const text = String(value).trim();
  const cents = text.match(/^([0-9]+(?:\.[0-9]+)?)\s*(?:c|cent|cents|¢)$/i);
  if (cents) return round4(Number(cents[1]) / 100);
  const numeric = Number(text.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(numeric)) return null;
  return round4(numeric > 1 ? numeric / 100 : numeric);
}

function resolveManualEvidenceFiles(files, filePath, dirs) {
  const resolved = [];
  for (const file of files) {
    const candidates = isAbsolute(file)
      ? [resolve(file)]
      : [
        resolve(dirname(filePath), file),
        resolve(dirs.screenshots, file),
        resolve(dirs.root, file),
      ];
    const existing = candidates.find((candidate) => existsSync(candidate));
    if (!existing) throw new Error(`Manual evidence file not found: ${file}`);
    resolved.push(existing);
  }
  return resolved;
}

function listFiles(dir, extensions) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath, extensions));
    else if (extensions.includes(extname(entry.name).toLowerCase())) files.push(fullPath);
  }
  return files;
}

function archiveSource(sourcePath, archiveRoot, date) {
  const targetDir = join(archiveRoot, sanitizeDate(date));
  mkdirSync(targetDir, { recursive: true });
  const targetPath = uniquePath(join(targetDir, basename(sourcePath)));
  renameSync(sourcePath, targetPath);
  return targetPath;
}

function uniquePath(targetPath) {
  if (!existsSync(targetPath)) return targetPath;
  const dir = dirname(targetPath);
  const ext = extname(targetPath);
  const name = basename(targetPath, ext);
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = join(dir, `${name}-${index}${ext}`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error(`Unable to find a unique archive path for ${targetPath}`);
}

function readImportLog(logPath) {
  if (!existsSync(logPath)) {
    return {
      schemaVersion: 1,
      imported: [],
      failed: [],
      createdAt: new Date().toISOString(),
      updatedAt: null,
    };
  }
  const parsed = JSON.parse(readFileSync(logPath, "utf8"));
  return {
    schemaVersion: parsed.schemaVersion ?? 1,
    imported: Array.isArray(parsed.imported) ? parsed.imported : [],
    failed: Array.isArray(parsed.failed) ? parsed.failed : [],
    createdAt: parsed.createdAt ?? null,
    updatedAt: parsed.updatedAt ?? null,
    lastRun: parsed.lastRun ?? null,
  };
}

function summarizeRun(results) {
  return {
    ranAt: new Date().toISOString(),
    scannedCount: results.length,
    importedCount: results.filter((item) => item.status === "imported").length,
    skippedDuplicateCount: results.filter((item) => item.status === "skipped_duplicate").length,
    failedCount: results.filter((item) => item.status === "failed").length,
  };
}

function hashFile(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertInside(child, parent) {
  const resolvedChild = resolve(child);
  const resolvedParent = resolve(parent);
  const diff = relative(resolvedParent, resolvedChild);
  if (diff.startsWith("..") || isAbsolute(diff)) {
    throw new Error(`Refusing to process a path outside the P&L root: ${child}`);
  }
}

function sanitizeDate(value) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : today();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function round4(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10000) / 10000;
}
