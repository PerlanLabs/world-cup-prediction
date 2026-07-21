import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DC_RHO, expectedGoals, matchProb, poissonPmf } from "../world-cup-2026-prediction-model/elo.mjs";

const BASE_RATINGS_PATH = fileURLToPath(new URL("../world-cup-2026-prediction-model/data/elo-calibrated.json", import.meta.url));
const DEFAULT_CURRENT_RATINGS_PATH = fileURLToPath(new URL("./data/elo-calibrated.current.json", import.meta.url));
const CURRENT_RATINGS_FILENAME = "elo-calibrated.current.json";
const RATINGS_SOURCE_ENV = "PREDICTION_RATINGS_SOURCE";
const baseRatingsData = readJson(BASE_RATINGS_PATH);
const backtestData = JSON.parse(
  readFileSync(new URL("../world-cup-2026-prediction-model/data/model-backtest.json", import.meta.url), "utf8"),
);
const packageInfo = JSON.parse(
  readFileSync(new URL("../world-cup-2026-prediction-model/package.json", import.meta.url), "utf8"),
);

const HOME_BONUS = 75;
const UPSTREAM_COMMIT = "b3d264ec8de22ced20d0c9350358d78d2a41b21b";
let cachedRatingsBundle = null;

const TEAM_ALIASES = new Map([
  ["united-states", "usa"],
  ["us", "usa"],
  ["u-s-a", "usa"],
  ["south-korea", "south-korea"],
  ["korea-republic", "south-korea"],
  ["cote-d-ivoire", "ivory-coast"],
  ["cote-divoire", "ivory-coast"],
  ["cabo-verde", "cape-verde"],
  ["cape-verde-islands", "cape-verde"],
  ["congo-dr", "dr-congo"],
  ["congo-democratic-republic", "dr-congo"],
  ["democratic-republic-of-the-congo", "dr-congo"],
  ["curao", "curacao"],
  ["czechia", "czech-republic"],
  ["new-zealand", "new-zealand"],
  ["south-africa", "south-africa"],
  ["turkiye", "turkey"],
  ["türkiye", "turkey"],
]);

export const modelMetadata = getModelMetadata();

export function getModelMetadata() {
  const bundle = getActiveRatingsBundle();
  return Object.freeze({
  engine: "Elo + Dixon-Coles bivariate Poisson",
  upstreamRepo: "https://github.com/Hicruben/world-cup-2026-prediction-model",
  upstreamCommit: UPSTREAM_COMMIT,
  packageVersion: packageInfo.version,
  license: packageInfo.license,
  ratingsAppliedMatches: bundle.data.matchesApplied,
  ratingsGeneratedAt: bundle.data.generatedAt ?? null,
  ratingSource: {
    type: bundle.sourceType,
    preference: bundle.preference,
    path: bundle.path,
    generatedAt: bundle.data.generatedAt ?? null,
    officialResultsCount: bundle.data.officialResultsCount ?? 0,
    officialResultsHash: bundle.data.officialResultsHash ?? null,
    inputHash: bundle.data.inputHash ?? null,
  },
  backtest: {
    generatedAt: backtestData.generatedAt,
    evaluated: backtestData.evaluated,
    burnIn: backtestData.burnIn,
    dateFrom: backtestData.dateFrom,
    dateTo: backtestData.dateTo,
    accuracy: round(backtestData.model.accuracy, 4),
    brier: round(backtestData.model.brier, 4),
    logloss: round(backtestData.model.logloss, 4),
    favouriteAccuracy: round(backtestData.model.favouriteAccuracy, 4),
  },
  });
}

export function resetModelCache() {
  cachedRatingsBundle = null;
}

export function listTeams() {
  const { ratings } = getActiveRatingsBundle();
  return Object.keys(ratings).sort();
}

export function predictMatch({ home, away, venue = "neutral" }) {
  const { ratings } = getActiveRatingsBundle();
  const homeSlug = normalizeTeam(home);
  const awaySlug = normalizeTeam(away);

  if (!homeSlug || !awaySlug) {
    throw clientError(400, "Both home and away teams are required.");
  }
  if (homeSlug === awaySlug) {
    throw clientError(400, "Home and away teams must be different.");
  }
  if (ratings[homeSlug] == null) {
    throw clientError(404, `Unknown home team: ${home}`);
  }
  if (ratings[awaySlug] == null) {
    throw clientError(404, `Unknown away team: ${away}`);
  }

  const venueState = resolveVenue(venue, homeSlug, awaySlug);
  const homeRating = ratings[homeSlug];
  const awayRating = ratings[awaySlug];
  const probabilities = matchProb(homeRating, awayRating, venueState.homeBonus);
  const scorelineDistribution = getScorelineDistribution(homeRating, awayRating, venueState.homeBonus);
  const topScorelines = scorelineDistribution.slice(0, 5);
  const favourite = getFavourite(probabilities);
  const recommendation = getRecommendation(favourite.key, probabilities);
  const confidence = getConfidence(probabilities);

  return {
    input: {
      home: homeSlug,
      away: awaySlug,
      venue: venueState.type,
    },
    teams: {
      home: { slug: homeSlug, elo: homeRating },
      away: { slug: awaySlug, elo: awayRating },
    },
    probabilities: {
      homeWin: round(probabilities.winA, 4),
      draw: round(probabilities.draw, 4),
      awayWin: round(probabilities.winB, 4),
    },
    probabilityPercent: {
      homeWin: round(probabilities.winA * 100, 1),
      draw: round(probabilities.draw * 100, 1),
      awayWin: round(probabilities.winB * 100, 1),
    },
    expectedGoals: {
      home: round(probabilities.expectedGoalsA, 2),
      away: round(probabilities.expectedGoalsB, 2),
    },
    scorelines: topScorelines,
    scorelineDistribution,
    recommendation,
    confidence,
    model: getModelMetadata(),
    generatedAt: new Date().toISOString(),
  };
}

export function normalizeTeam(value) {
  if (typeof value !== "string") return "";
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-\s]/g, "")
    .replace(/\s+/g, "-");
  return TEAM_ALIASES.get(slug) ?? slug;
}

function resolveVenue(value, homeSlug, awaySlug) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "neutral";
  const normalized = normalizeTeam(raw);

  if (!raw || raw === "neutral" || raw === "none") {
    return { type: "neutral", homeBonus: 0 };
  }
  if (raw === "home" || normalized === homeSlug) {
    return { type: "home", homeBonus: HOME_BONUS };
  }
  if (raw === "away" || normalized === awaySlug) {
    return { type: "away", homeBonus: -HOME_BONUS };
  }

  throw clientError(400, `Venue must be neutral, home, away, ${homeSlug}, or ${awaySlug}.`);
}

function getScorelineDistribution(homeRating, awayRating, homeBonus) {
  const lambda = expectedGoals(homeRating, awayRating, homeBonus);
  const mu = expectedGoals(awayRating, homeRating, -homeBonus / 2);
  const rows = [];
  let total = 0;

  for (let homeGoals = 0; homeGoals <= 8; homeGoals += 1) {
    const homeP = poissonPmf(homeGoals, lambda);
    for (let awayGoals = 0; awayGoals <= 8; awayGoals += 1) {
      const probability = homeP * poissonPmf(awayGoals, mu) * dcTau(homeGoals, awayGoals, lambda, mu, DC_RHO);
      total += probability;
      rows.push({ homeGoals, awayGoals, probability });
    }
  }

  return rows
    .map((row) => ({
      line: `${row.homeGoals}-${row.awayGoals}`,
      homeGoals: row.homeGoals,
      awayGoals: row.awayGoals,
      probability: round(row.probability / total, 4),
      probabilityPercent: round((row.probability / total) * 100, 1),
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

function getFavourite(probabilities) {
  const options = [
    { key: "homeWin", value: probabilities.winA },
    { key: "draw", value: probabilities.draw },
    { key: "awayWin", value: probabilities.winB },
  ];
  return options.sort((a, b) => b.value - a.value)[0];
}

function getRecommendation(favouriteKey, probabilities) {
  const max = Math.max(probabilities.winA, probabilities.draw, probabilities.winB);
  if (favouriteKey === "homeWin") {
    return {
      key: max >= 0.5 ? "home-win" : "home-lean",
      label: max >= 0.5 ? "主队胜" : "主队方向",
    };
  }
  if (favouriteKey === "awayWin") {
    return {
      key: max >= 0.5 ? "away-win" : "away-lean",
      label: max >= 0.5 ? "客队胜" : "客队方向",
    };
  }
  return { key: "draw-risk", label: "平局权重高" };
}

function getConfidence(probabilities) {
  const sorted = [probabilities.winA, probabilities.draw, probabilities.winB].sort((a, b) => b - a);
  const separation = sorted[0] - sorted[1];
  const score = Math.round(Math.max(52, Math.min(82, 52 + separation * 70)));

  return {
    score,
    basis: "probability-separation",
    description: "基于最高概率与次高概率的差距估算，只代表模型结论集中度，不等于赛果确定性。",
  };
}

function clientError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function round(value, digits) {
  return Number(value.toFixed(digits));
}

function getActiveRatingsBundle() {
  const preference = getRatingsSourcePreference();
  const currentPath = getCurrentRatingsPath();
  const currentSignature = getFileSignature(currentPath);
  const useBase = preference === "base" || (!currentSignature && preference !== "current");
  const sourceType = useBase ? "base" : currentSignature ? "current" : "base";
  const path = sourceType === "current" ? currentPath : BASE_RATINGS_PATH;
  const signature = sourceType === "current"
    ? currentSignature
    : getFileSignature(BASE_RATINGS_PATH) ?? "base";
  const cacheKey = `${preference}:${sourceType}:${path}:${signature}`;

  if (cachedRatingsBundle?.cacheKey === cacheKey) return cachedRatingsBundle;

  const data = sourceType === "current" ? readJson(currentPath) : baseRatingsData;
  if (!data || typeof data !== "object" || !data.ratings || typeof data.ratings !== "object") {
    throw new Error(`Invalid Elo ratings file: ${path}`);
  }

  cachedRatingsBundle = {
    cacheKey,
    data,
    path,
    preference,
    ratings: data.ratings,
    sourceType,
  };
  return cachedRatingsBundle;
}

function getRatingsSourcePreference() {
  const raw = String(process.env[RATINGS_SOURCE_ENV] ?? "current").trim().toLowerCase();
  if (!raw || raw === "current" || raw === "rolling") return "current";
  if (raw === "base" || raw === "baseline" || raw === "upstream") return "base";
  if (raw === "auto") return "auto";
  throw new Error(`Invalid ${RATINGS_SOURCE_ENV}: ${process.env[RATINGS_SOURCE_ENV]}. Use current, base, or auto.`);
}

function getCurrentRatingsPath() {
  if (process.env.PREDICTION_CURRENT_RATINGS_PATH) {
    return resolve(process.env.PREDICTION_CURRENT_RATINGS_PATH);
  }
  if (process.env.PREDICTION_STORE_PATH) {
    return resolve(dirname(process.env.PREDICTION_STORE_PATH), CURRENT_RATINGS_FILENAME);
  }
  return DEFAULT_CURRENT_RATINGS_PATH;
}

function getFileSignature(path) {
  try {
    if (!existsSync(path)) return null;
    const stat = statSync(path);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
