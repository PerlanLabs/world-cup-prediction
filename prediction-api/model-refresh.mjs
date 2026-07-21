import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getStore, getStoreFilePath } from "./store.mjs";

const BASE_RATINGS_PATH = fileURLToPath(new URL("../world-cup-2026-prediction-model/data/elo-calibrated.json", import.meta.url));
const GENERATED_RESULTS_FILENAME = "official-results.generated.json";
const CURRENT_RATINGS_FILENAME = "elo-calibrated.current.json";
const SOURCE_ID = "fifa-official-results-model-refresh";
const HOME_ADV = 75;
const HOST = new Set(["mexico", "usa", "canada"]);

const SEED = {
  argentina: 2085,
  france: 2065,
  spain: 2055,
  brazil: 2045,
  england: 2000,
  portugal: 1980,
  netherlands: 1965,
  germany: 1945,
  belgium: 1925,
  italy: 1915,
  colombia: 1890,
  uruguay: 1875,
  croatia: 1870,
  morocco: 1840,
  switzerland: 1825,
  usa: 1830,
  mexico: 1825,
  japan: 1810,
  senegal: 1795,
  denmark: 1790,
  ecuador: 1760,
  australia: 1735,
  "south-korea": 1730,
  iran: 1720,
  poland: 1715,
  canada: 1700,
  serbia: 1695,
  wales: 1665,
  ghana: 1665,
  tunisia: 1655,
  "ivory-coast": 1655,
  nigeria: 1645,
  "saudi-arabia": 1640,
  qatar: 1630,
  egypt: 1620,
  algeria: 1615,
  scotland: 1610,
  cameroon: 1600,
  paraguay: 1595,
  venezuela: 1590,
  chile: 1580,
  peru: 1575,
  "czech-republic": 1570,
  "bosnia-and-herzegovina": 1545,
  "south-africa": 1520,
  "new-zealand": 1495,
  panama: 1480,
  jamaica: 1460,
  honduras: 1440,
  jordan: 1420,
  haiti: 1380,
  "el-salvador": 1370,
  "trinidad-and-tobago": 1360,
  guatemala: 1345,
  austria: 1780,
  turkey: 1740,
  norway: 1725,
  sweden: 1715,
  iraq: 1590,
  uzbekistan: 1575,
  "cape-verde": 1540,
  "dr-congo": 1535,
  curacao: 1450,
};

export function getGeneratedResultsPath(path = process.env.PREDICTION_MODEL_RESULTS_PATH) {
  if (path) return resolve(path);
  return resolve(dirname(getStoreFilePath()), GENERATED_RESULTS_FILENAME);
}

export function getCurrentRatingsPath(path = process.env.PREDICTION_CURRENT_RATINGS_PATH) {
  if (path) return resolve(path);
  return resolve(dirname(getStoreFilePath()), CURRENT_RATINGS_FILENAME);
}

export function exportOfficialResults(options = {}) {
  const store = getStore();
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const outputPath = getGeneratedResultsPath(options.path);
  const teamsById = new Map(store.teams.map((team) => [team.id, team]));
  const skipped = [];

  const matches = store.matches
    .map((match) => toModelResult(match, teamsById, skipped))
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts || String(a.id).localeCompare(String(b.id)));

  const hash = hashJson(matches);
  const payload = {
    generatedAt,
    sourceId: SOURCE_ID,
    source: "FIFA official fixture/result sync",
    matchCount: matches.length,
    matchIds: matches.map((match) => match.id),
    hash,
    skippedCount: skipped.length,
    skipped,
    matches,
  };

  writeJson(outputPath, payload);

  return {
    sourceId: SOURCE_ID,
    path: outputPath,
    generatedAt,
    matchCount: matches.length,
    matchIds: payload.matchIds,
    hash,
    skippedCount: skipped.length,
    skipped,
  };
}

export function calibrateCurrentRatings(options = {}) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const baseRatingsPath = resolve(options.baseRatingsPath ?? BASE_RATINGS_PATH);
  const officialResultsPath = getGeneratedResultsPath(options.officialResultsPath);
  const outputPath = getCurrentRatingsPath(options.outputPath);
  const basePayload = readJson(baseRatingsPath);
  const officialPayload = existsSync(officialResultsPath)
    ? readJson(officialResultsPath)
    : { generatedAt: null, matches: [], hash: hashJson([]) };
  if (!basePayload?.ratings || typeof basePayload.ratings !== "object") {
    throw new Error(`Invalid base Elo ratings file: ${baseRatingsPath}`);
  }
  const baseRatingsHash = hashJson(basePayload.ratings);
  const baseRatingsCount = Object.keys(basePayload.ratings).length;
  const baseMatchesApplied = Number.isFinite(Number(basePayload.matchesApplied))
    ? Number(basePayload.matchesApplied)
    : null;
  const officialMatches = Array.isArray(officialPayload.matches) ? officialPayload.matches : [];
  const officialResultsHash = officialPayload.hash ?? hashJson(officialMatches);
  const inputHash = hashJson({
    method: "incremental-official-results-v1",
    baseGeneratedAt: basePayload.generatedAt ?? null,
    baseRatingsHash,
    baseRatingsCount,
    baseMatchesApplied,
    officialResultsCount: officialMatches.length,
    officialResultsHash,
  });

  const existing = existsSync(outputPath) ? readJson(outputPath) : null;
  if (!options.refresh && existing?.inputHash === inputHash) {
    return {
      sourceId: SOURCE_ID,
      path: outputPath,
      generatedAt: existing.generatedAt ?? null,
      changed: false,
      reused: true,
      inputHash,
      officialResultsHash,
      officialResultsCount: officialMatches.length,
      matchesApplied: existing.matchesApplied,
      officialMatchesApplied: existing.officialMatchesApplied,
      ratingsCount: Object.keys(existing.ratings ?? {}).length,
    };
  }

  const calibration = applyOfficialResultsToBaseRatings(basePayload.ratings, officialMatches);
  const matchesApplied = (baseMatchesApplied ?? 0) + calibration.officialMatchesApplied;
  const payload = {
    generatedAt,
    sourceId: SOURCE_ID,
    baseRatingsPath,
    baseRatingsGeneratedAt: basePayload.generatedAt ?? null,
    baseRatingsHash,
    baseRatingsCount,
    baseMatchesApplied,
    officialResultsPath,
    officialResultsCount: officialMatches.length,
    officialResultsHash,
    inputHash,
    matchesApplied,
    officialMatchesApplied: calibration.officialMatchesApplied,
    ratings: calibration.ratings,
    calibration: {
      method: "Incremental Elo from frozen base ratings plus generated FIFA official World Cup results",
      homeAdvantage: HOME_ADV,
      seedCount: Object.keys(SEED).length,
      baseMethod: basePayload.method ?? basePayload.calibration?.method ?? null,
      baseMatchesApplied,
      officialResultsOnly: true,
    },
  };

  writeJson(outputPath, payload);

  return {
    sourceId: SOURCE_ID,
    path: outputPath,
    generatedAt,
    changed: true,
    reused: false,
    inputHash,
    officialResultsHash,
    officialResultsCount: officialMatches.length,
    matchesApplied,
    officialMatchesApplied: calibration.officialMatchesApplied,
    ratingsCount: Object.keys(calibration.ratings).length,
  };
}

export function applyOfficialResultsToBaseRatings(baseRatings, matches) {
  const sortedMatches = matches
    .map(normalizeCalibrationMatch)
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts || String(a.id).localeCompare(String(b.id)));
  const nowSec = sortedMatches.length ? sortedMatches[sortedMatches.length - 1].ts : Math.floor(Date.now() / 1000);
  const ratingState = {};
  for (const [slug, rating] of Object.entries(baseRatings ?? {})) {
    const numericRating = toNullableNumber(rating);
    if (numericRating != null) ratingState[slug] = numericRating;
  }
  let applied = 0;

  for (const match of sortedMatches) {
    const homeRating = getRating(ratingState, match.homeSlug, match.homeName);
    const awayRating = getRating(ratingState, match.awaySlug, match.awayName);
    const homeBonus = HOST.has(match.homeSlug) ? HOME_ADV / 2 : 0;
    const expected = expectedScore(homeRating, awayRating, homeBonus);
    const score = match.hg > match.ag ? 1 : match.hg < match.ag ? 0 : 0.5;
    const k = baseK(match.leagueName) * recency(match.ts, nowSec) * goalMultiplier(match.hg - match.ag);
    const delta = k * (score - expected);
    setRating(ratingState, match.homeSlug, match.homeName, homeRating + delta);
    setRating(ratingState, match.awaySlug, match.awayName, awayRating - delta);
    applied += 1;
  }

  const ratings = {};
  for (const slug of new Set([...Object.keys(SEED), ...Object.keys(baseRatings ?? {})])) {
    if (slug.startsWith("ghost:")) continue;
    const rating = ratingState[slug] ?? baseRatings?.[slug] ?? SEED[slug];
    if (rating != null) ratings[slug] = Math.round(rating);
  }

  return { officialMatchesApplied: applied, ratings };
}

export function calibrateRatings(matches) {
  const sortedMatches = matches
    .map(normalizeCalibrationMatch)
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts || String(a.id).localeCompare(String(b.id)));
  const nowSec = sortedMatches.length ? sortedMatches[sortedMatches.length - 1].ts : Math.floor(Date.now() / 1000);
  const ratingState = {};
  let applied = 0;

  for (const match of sortedMatches) {
    const homeRating = getRating(ratingState, match.homeSlug, match.homeName);
    const awayRating = getRating(ratingState, match.awaySlug, match.awayName);
    const homeBonus = HOST.has(match.homeSlug) ? HOME_ADV / 2 : 0;
    const expected = expectedScore(homeRating, awayRating, homeBonus);
    const score = match.hg > match.ag ? 1 : match.hg < match.ag ? 0 : 0.5;
    const k = baseK(match.leagueName) * recency(match.ts, nowSec) * goalMultiplier(match.hg - match.ag);
    const delta = k * (score - expected);
    setRating(ratingState, match.homeSlug, match.homeName, homeRating + delta);
    setRating(ratingState, match.awaySlug, match.awayName, awayRating - delta);
    applied += 1;
  }

  const ratings = {};
  for (const slug of Object.keys(SEED)) {
    ratings[slug] = Math.round(0.7 * (ratingState[slug] ?? SEED[slug]) + 0.3 * SEED[slug]);
  }

  return { matchesApplied: applied, ratings };
}

function toModelResult(match, teamsById, skipped) {
  const score = getFinalScore(match);
  const kickoff = Date.parse(match.official?.dateUtc ?? match.kickoffLocal ?? "");
  const homeTeam = teamsById.get(match.homeTeamId);
  const awayTeam = teamsById.get(match.awayTeamId);
  const reason = getSkipReason(match, score, kickoff);
  if (reason) {
    skipped.push({ matchId: match.id, reason });
    return null;
  }

  return {
    id: `fifa-world-cup-2026-${match.official.idMatch}`,
    ts: Math.floor(kickoff / 1000),
    date: match.date,
    homeId: match.official?.homeCode ?? match.homeTeamId,
    awayId: match.official?.awayCode ?? match.awayTeamId,
    homeSlug: match.modelHome,
    awaySlug: match.modelAway,
    homeName: homeTeam?.name ?? match.homeTeamId,
    awayName: awayTeam?.name ?? match.awayTeamId,
    hg: score.home,
    ag: score.away,
    leagueId: 17,
    leagueName: "FIFA World Cup",
    sourceId: match.official.sourceId ?? "fifa-api-world-cup-2026-calendar",
    idMatch: String(match.official.idMatch),
  };
}

function getSkipReason(match, score, kickoff) {
  if (!match.official?.idMatch) return "missing_fifa_match_id";
  if (!match.modelHome || !match.modelAway || match.predictionStatus?.available === false) return "model_team_unavailable";
  if (score.home == null || score.away == null) return "score_unavailable";
  if (!Number.isFinite(kickoff)) return "kickoff_unavailable";
  return null;
}

function getFinalScore(match) {
  const home = toNullableNumber(match.score?.home ?? match.matchFacts?.score?.home);
  const away = toNullableNumber(match.score?.away ?? match.matchFacts?.score?.away);
  return { home, away };
}

function normalizeCalibrationMatch(match) {
  const hg = toNullableNumber(match.hg);
  const ag = toNullableNumber(match.ag);
  const ts = toNullableNumber(match.ts);
  if (hg == null || ag == null || ts == null) return null;
  return {
    ...match,
    hg,
    ag,
    ts,
    homeSlug: typeof match.homeSlug === "string" && match.homeSlug ? match.homeSlug : null,
    awaySlug: typeof match.awaySlug === "string" && match.awaySlug ? match.awaySlug : null,
    homeName: match.homeName ?? match.homeSlug ?? "Home",
    awayName: match.awayName ?? match.awaySlug ?? "Away",
    leagueName: match.leagueName ?? "",
  };
}

function baseK(leagueName = "") {
  const name = leagueName.toLowerCase();
  if (/world cup(?!.*qual)/.test(name)) return 55;
  if (/world cup.*qual|qualification/.test(name)) return 40;
  if (/copa america|euro championship\b|asian cup|africa cup|gold cup/.test(name)) return 50;
  if (/nations league|nations cup/.test(name)) return 32;
  if (/friendl/.test(name)) return 18;
  return 28;
}

function recency(tsSec, nowSec) {
  return Math.pow(0.5, ((nowSec - tsSec) / (30.44 * 86400)) / 18);
}

function expectedScore(homeRating, awayRating, homeBonus) {
  return 1 / (1 + Math.pow(10, (awayRating - (homeRating + homeBonus)) / 400));
}

function goalMultiplier(goalDifference) {
  const diff = Math.abs(goalDifference);
  if (diff <= 1) return 1;
  if (diff === 2) return 1.5;
  return (11 + diff) / 8;
}

function getRating(ratings, slug, name) {
  const key = slug ?? `ghost:${name}`;
  if (ratings[key] == null) ratings[key] = slug && SEED[slug] != null ? SEED[slug] : 1500;
  return ratings[key];
}

function setRating(ratings, slug, name, value) {
  ratings[slug ?? `ghost:${name}`] = value;
}

function toNullableNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function hashJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
