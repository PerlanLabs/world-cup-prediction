import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_LINEUP_SOURCE_ID = "local-reviewed-lineups";
const DEFAULT_LINEUP_SOURCE_PATH = fileURLToPath(new URL("./data/lineups.local.json", import.meta.url));
const ALLOWED_LINEUP_TYPES = new Set(["official", "expected"]);
const PAID_ACCESS_VALUES = new Set(["paid", "premium", "commercial"]);

export function getDefaultLineupSourcePath() {
  return resolve(process.env.PREDICTION_LINEUP_SOURCE_PATH ?? DEFAULT_LINEUP_SOURCE_PATH);
}

export function readLineupPayloadFromFile(path = getDefaultLineupSourcePath()) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

export function applyLineupPayloadToStore(store, payload, options = {}) {
  const source = normalizePayloadSource(payload, options);
  ensureFreeLineupSource(source);
  const updates = normalizeLineupUpdates(payload);
  const nextStore = structuredClone(store);
  const summary = {
    sourceId: source.id,
    sourceUrl: source.url ?? null,
    retrievedAt: source.retrievedAt,
    rawCount: updates.length,
    importedCount: 0,
    officialImportedCount: 0,
    expectedImportedCount: 0,
    skippedCount: 0,
    importedMatchIds: [],
    skipped: [],
  };

  for (const update of updates) {
    const match = findMatch(nextStore.matches, update);
    if (!match) {
      summary.skippedCount += 1;
      summary.skipped.push({
        matchId: update.matchId ?? null,
        idMatch: update.idMatch ?? null,
        reason: "match_not_found",
      });
      continue;
    }

    const importedTypes = [];
    for (const type of ALLOWED_LINEUP_TYPES) {
      if (!update[type]) continue;
      match.lineups = {
        ...(match.lineups ?? {}),
        [type]: normalizeLineupSource(update[type], type, source, options),
      };
      importedTypes.push(type);
    }

    if (importedTypes.length === 0) {
      summary.skippedCount += 1;
      summary.skipped.push({
        matchId: match.id,
        idMatch: match.official?.idMatch ?? null,
        reason: "no_lineup_sections",
      });
      continue;
    }

    summary.importedCount += 1;
    summary.officialImportedCount += importedTypes.includes("official") ? 1 : 0;
    summary.expectedImportedCount += importedTypes.includes("expected") ? 1 : 0;
    summary.importedMatchIds.push(match.id);
  }

  upsertById(nextStore.sources, {
    ...source,
    lastSync: {
      fetchedAt: source.retrievedAt,
      rawCount: summary.rawCount,
      importedCount: summary.importedCount,
      officialImportedCount: summary.officialImportedCount,
      expectedImportedCount: summary.expectedImportedCount,
      skippedCount: summary.skippedCount,
    },
  });

  return { store: nextStore, summary };
}

function normalizePayloadSource(payload, options) {
  const source = payload?.source ?? {};
  const retrievedAt = source.retrievedAt ?? options.retrievedAt ?? new Date().toISOString();
  return {
    id: nonEmptyString(source.id) ?? DEFAULT_LINEUP_SOURCE_ID,
    name: nonEmptyString(source.name) ?? "Local reviewed lineup feed",
    url: nonEmptyString(source.url),
    retrievedAt,
    tier: Number.isInteger(source.tier) ? source.tier : 1,
    access: nonEmptyString(source.access) ?? "free_reviewed",
    paid: Boolean(source.paid),
    notes: nonEmptyString(source.notes) ?? "Free official/expected lineup feed. Expected lineups require review before display.",
  };
}

function ensureFreeLineupSource(source) {
  const access = String(source.access ?? "").toLowerCase();
  if (source.paid || PAID_ACCESS_VALUES.has(access)) {
    const error = new Error("Paid lineup sources are not allowed by the current source policy.");
    error.status = 400;
    error.code = "paid_source_not_allowed";
    throw error;
  }
}

function normalizeLineupUpdates(payload) {
  const updates = payload?.lineups ?? payload?.matches ?? [];
  if (!Array.isArray(updates)) {
    const error = new Error("Lineup payload must include a lineups array.");
    error.status = 400;
    error.code = "bad_request";
    throw error;
  }

  return updates.map((update) => ({
    matchId: nonEmptyString(update.matchId),
    idMatch: nonEmptyString(update.idMatch ?? update.officialIdMatch),
    official: update.official,
    expected: update.expected,
  }));
}

function normalizeLineupSource(lineup, type, source, options) {
  ensureFreeLineupSource(lineup?.source ?? source);
  const status = nonEmptyString(lineup.status) ?? (hasLineupData(lineup) ? "available" : defaultEmptyStatus(type));
  const retrievedAt = lineup.retrievedAt ?? source.retrievedAt;
  const reviewedAt = lineup.reviewedAt ?? (type === "expected" ? options.reviewedAt ?? source.retrievedAt : null);

  return {
    label: nonEmptyString(lineup.label) ?? (type === "official" ? "官方首发" : "预计首发"),
    sourceType: type,
    status,
    confidence: nonEmptyString(lineup.confidence) ?? (type === "official" && status === "available" ? "confirmed" : "reviewed"),
    sourceId: nonEmptyString(lineup.sourceId) ?? source.id,
    sourceUrl: nonEmptyString(lineup.sourceUrl) ?? source.url ?? null,
    retrievedAt,
    reviewedAt,
    note: nonEmptyString(lineup.note) ?? defaultLineupNote(type, status),
    home: normalizeTeamLineup(lineup.home),
    away: normalizeTeamLineup(lineup.away),
  };
}

function normalizeTeamLineup(lineup = {}) {
  return {
    formation: nonEmptyString(lineup.formation),
    starters: normalizePlayers(lineup.starters),
    substitutes: normalizePlayers(lineup.substitutes),
    unavailable: normalizePlayers(lineup.unavailable),
  };
}

function normalizePlayers(players) {
  if (!Array.isArray(players)) return [];
  return players
    .map((player) => ({
      name: nonEmptyString(player?.name ?? player?.playerName) ?? "未知球员",
      position: nonEmptyString(player?.position),
      shirtNumber: nonEmptyString(player?.shirtNumber ?? player?.number),
      note: nonEmptyString(player?.note),
    }))
    .filter((player) => player.name);
}

function hasLineupData(lineup) {
  return hasTeamLineupData(lineup?.home) || hasTeamLineupData(lineup?.away);
}

function hasTeamLineupData(lineup = {}) {
  return Boolean(
    nonEmptyString(lineup.formation) ||
    lineup.starters?.length ||
    lineup.substitutes?.length ||
    lineup.unavailable?.length,
  );
}

function defaultEmptyStatus(type) {
  return type === "official" ? "not_released" : "not_ready";
}

function defaultLineupNote(type, status) {
  if (type === "official" && status === "available") return "官方首发已确认。";
  if (type === "official") return "官方首发暂未发布。";
  if (status === "available") return "预计首发已通过来源审核。";
  return "预计首发待来源审核。";
}

function findMatch(matches, update) {
  if (update.matchId) {
    return matches.find((match) => match.id === update.matchId);
  }
  if (update.idMatch) {
    return matches.find((match) => match.official?.idMatch === update.idMatch);
  }
  return null;
}

function upsertById(items, item) {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) {
    items[index] = { ...items[index], ...item };
    return;
  }
  items.push(item);
}

function nonEmptyString(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}
