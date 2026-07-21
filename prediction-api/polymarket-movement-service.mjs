import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildMovementSnapshot } from "../scripts/betting-analysis/polymarket-market-movement.mjs";
import { buildPolymarketMarketStructure } from "../scripts/betting-analysis/polymarket-market-structure.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_CACHE_DIR = resolve(PROJECT_ROOT, "prediction-api/data/polymarket-movement");
const LEGACY_SNAPSHOT_DIR = resolve(PROJECT_ROOT, "_tmp_polymarket");
const inFlightRefreshes = new Map();

export function listPolymarketMovementSnapshots(options = {}) {
  const records = discoverSnapshotFiles(options)
    .map(readSnapshotRecord)
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.generatedAt ?? 0) - Date.parse(a.generatedAt ?? 0));
  const newestByEvent = new Map();
  for (const record of records) {
    if (!record.eventSlug || newestByEvent.has(record.eventSlug)) continue;
    newestByEvent.set(record.eventSlug, record);
  }
  return [...newestByEvent.values()];
}

export function getPolymarketMovementSnapshot(eventSlug, options = {}) {
  const normalizedSlug = normalizeEventSlug(eventSlug);
  const candidates = discoverSnapshotFiles(options)
    .map((path) => ({ path, snapshot: readMovementSnapshot(path) }))
    .filter((entry) => entry.snapshot && movementEventSlug(entry.snapshot) === normalizedSlug)
    .sort((a, b) => snapshotTimestamp(b) - snapshotTimestamp(a));
  const selected = candidates[0];
  if (!selected) return null;
  return normalizeForApi(selected.snapshot, selected.path);
}

export async function refreshPolymarketMovementSnapshot(input = {}, options = {}) {
  const eventSlug = normalizeEventSlug(input.eventSlug);
  const refreshKey = eventSlug || `${input.home ?? ""}:${input.away ?? ""}:${input.date ?? ""}`;
  if (!refreshKey || refreshKey === "::") {
    throw badRequest("eventSlug or home/away is required.");
  }
  if (inFlightRefreshes.has(refreshKey)) return inFlightRefreshes.get(refreshKey);

  const refresh = (async () => {
    const snapshot = await buildMovementSnapshot({
      eventSlug: eventSlug || undefined,
      home: cleanText(input.home),
      away: cleanText(input.away),
      date: cleanText(input.date),
      historyMode: cleanText(input.historyMode) ?? "lifecycle",
      lookbackDays: finiteNumber(input.lookbackDays),
      fidelity: finiteNumber(input.fidelity),
      categories: cleanText(input.categories),
      allCategories: Boolean(input.allCategories),
      limit: finiteNumber(input.limit),
      concurrency: finiteNumber(input.concurrency),
      timeoutMs: finiteNumber(input.timeoutMs),
      summaryOnly: false,
    });
    const cacheDir = resolve(options.cacheDir ?? DEFAULT_CACHE_DIR);
    mkdirSync(cacheDir, { recursive: true });
    const outputSlug = normalizeEventSlug(snapshot.input?.eventSlug ?? snapshot.event?.slug);
    const outputPath = join(cacheDir, `${outputSlug}.json`);
    writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    return normalizeForApi(snapshot, outputPath);
  })();

  inFlightRefreshes.set(refreshKey, refresh);
  try {
    return await refresh;
  } finally {
    inFlightRefreshes.delete(refreshKey);
  }
}

export function getPolymarketMovementAssistantView(eventSlug, options = {}) {
  const snapshot = getPolymarketMovementSnapshot(eventSlug, options);
  if (!snapshot) return null;
  return {
    schemaVersion: snapshot.schemaVersion,
    generatedAt: snapshot.generatedAt,
    sourceFile: snapshot.sourceFile,
    source: snapshot.source,
    input: snapshot.input,
    assistantView: snapshot.assistantView ?? buildLegacyAssistantView(snapshot),
  };
}

export function getPolymarketMarketStructure(eventSlug, options = {}) {
  const snapshot = getPolymarketMovementSnapshot(eventSlug, options);
  if (!snapshot) return null;
  return {
    schemaVersion: snapshot.marketStructure?.schemaVersion ?? null,
    generatedAt: snapshot.marketStructure?.generatedAt ?? snapshot.generatedAt,
    sourceSnapshot: snapshot.sourceFile,
    structure: snapshot.marketStructure,
  };
}

function discoverSnapshotFiles(options = {}) {
  const directories = [
    { path: resolve(options.cacheDir ?? DEFAULT_CACHE_DIR), requireMovementName: false },
    ...(options.includeLegacy === false ? [] : [{ path: LEGACY_SNAPSHOT_DIR, requireMovementName: true }]),
  ];
  const files = [];
  for (const directory of directories) {
    let names = [];
    try {
      names = readdirSync(directory.path);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.toLowerCase().endsWith(".json")) continue;
      if (directory.requireMovementName && !name.toLowerCase().includes("movement")) continue;
      files.push(join(directory.path, name));
    }
  }
  return files;
}

function readSnapshotRecord(path) {
  const snapshot = readMovementSnapshot(path);
  if (!snapshot) return null;
  const eventSlug = movementEventSlug(snapshot);
  if (!eventSlug) return null;
  const quality = snapshot.dataQuality ?? null;
  return {
    eventSlug,
    title: snapshot.event?.title ?? snapshot.assistantView?.event?.title ?? eventSlug,
    kickoffTime: snapshot.input?.cutoffTime ?? snapshot.assistantView?.event?.kickoffTime ?? null,
    generatedAt: snapshot.generatedAt ?? statSync(path).mtime.toISOString(),
    schemaVersion: snapshot.schemaVersion ?? "legacy",
    readiness: quality?.readiness ?? snapshot.assistantView?.readiness ?? "review",
    discoveredMarketCount: quality?.checks?.discoveredMarketCount ?? snapshot.discovery?.marketCount ?? null,
    trackedMarketCount: quality?.checks?.requestedHistoryMarketCount ?? snapshot.summary?.selectedMarketCount ?? snapshot.rows.length,
    historyAvailableCount: quality?.checks?.historyAvailableCount ?? snapshot.summary?.historyAvailableCount ?? null,
    issueCount: quality?.issues?.length ?? null,
    sourceFile: path,
  };
}

function readMovementSnapshot(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.rows)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeForApi(snapshot, path) {
  const marketStructure = snapshot.marketStructure ?? buildPolymarketMarketStructure({
    rows: snapshot.rows,
    event: snapshot.event,
    cutoffTs: snapshot.input?.cutoffTs,
  });
  const assistantView = snapshot.assistantView ?? buildLegacyAssistantView(snapshot);
  return {
    ...snapshot,
    sourceFile: path,
    schemaVersion: snapshot.schemaVersion ?? "legacy",
    dataQuality: snapshot.dataQuality ?? buildLegacyQuality(snapshot),
    marketStructure,
    assistantView: {
      ...assistantView,
      marketStructure: assistantView.marketStructure ?? marketStructure,
    },
  };
}

function buildLegacyQuality(snapshot) {
  const available = snapshot.rows.filter((row) => row.status === "available").length;
  const selected = snapshot.rows.length;
  return {
    readiness: available === selected && selected > 0 ? "review" : "blocked",
    intendedGrain: "legacy primary-outcome movement rows",
    historyScope: snapshot.input?.categories ?? "unknown",
    checks: {
      discoveredMarketCount: snapshot.discovery?.marketCount ?? null,
      inventoryMarketCount: null,
      requestedHistoryMarketCount: selected,
      historyAvailableCount: available,
      historyUnavailableCount: selected - available,
      historyCoverageRate: selected ? available / selected : 0,
    },
    limitations: ["Legacy snapshot has no complete market inventory or automated integrity checks. Refresh it before execution-sensitive analysis."],
    issues: [{
      severity: "medium",
      code: "legacy_snapshot_contract",
      count: 1,
      message: "Snapshot predates polymarket-movement/v1 quality metadata.",
    }],
  };
}

function buildLegacyAssistantView(snapshot) {
  const quality = snapshot.dataQuality ?? buildLegacyQuality(snapshot);
  return {
    event: {
      id: snapshot.event?.id ?? null,
      slug: movementEventSlug(snapshot),
      title: snapshot.event?.title ?? movementEventSlug(snapshot),
      kickoffTime: snapshot.input?.cutoffTime ?? null,
    },
    readiness: quality.readiness,
    checks: quality.checks,
    issues: quality.issues,
    limitations: quality.limitations,
    categoryCoverage: snapshot.categoryCoverage ?? [],
    topMovers: snapshot.summary?.topMovers ?? [],
    movements: snapshot.rows.map((row) => ({
      category: row.category,
      period: row.period,
      marketSlug: row.marketSlug,
      question: row.question,
      selection: row.selection,
      line: row.line,
      outcome: row.outcome,
      tokenId: row.tokenId,
      liquidity: row.liquidity,
      volume: row.volume,
      status: row.status,
      movement: row.movement,
      error: row.error,
    })),
  };
}

function movementEventSlug(snapshot) {
  return normalizeEventSlug(snapshot.input?.eventSlug ?? snapshot.event?.slug ?? snapshot.assistantView?.event?.slug);
}

function snapshotTimestamp(entry) {
  const generatedAt = entry.snapshot?.generatedAt;
  const parsed = Date.parse(generatedAt ?? "");
  return Number.isFinite(parsed) ? parsed : statSync(entry.path).mtimeMs;
}

function normalizeEventSlug(value) {
  const slug = String(value ?? "").trim().toLowerCase();
  if (!slug) return "";
  if (!/^[a-z0-9][a-z0-9-]{2,160}$/.test(slug)) throw badRequest("Invalid Polymarket event slug.");
  return slug;
}

function cleanText(value) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function finiteNumber(value) {
  if (value == null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400, code: "bad_request" });
}
