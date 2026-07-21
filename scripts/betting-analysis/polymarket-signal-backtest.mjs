import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { buildMovementSnapshot } from "./polymarket-market-movement.mjs";
import {
  aggregateSignalBacktest,
  buildSignalBacktestMatch,
  buildThresholdSensitivity,
} from "./polymarket-signal-backtest-core.mjs";

const PROJECT_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DEFAULT_STORE_PATH = resolve(PROJECT_ROOT, "prediction-api/data/backend-store.sqlite");
const DEFAULT_MOVEMENT_DIR = resolve(PROJECT_ROOT, "prediction-api/data/polymarket-movement");
const DEFAULT_OUTPUT_PATH = resolve(PROJECT_ROOT, "prediction-api/data/polymarket-backtest/latest.json");
const DEFAULT_LIMIT = 20;
const DEFAULT_FEE_RATE = 0.03;
const POLYMARKET_TEAM_CODE_OVERRIDES = {
  COD: "cdr",
  CPV: "cvi",
  CRO: "hrv",
  CUR: "cuw",
  NED: "nld",
  POR: "prt",
  SUI: "che",
  URU: "ury",
};

export async function runSignalBacktest(options = {}) {
  const storePath = resolve(options.storePath ?? DEFAULT_STORE_PATH);
  const movementDir = resolve(options.movementDir ?? DEFAULT_MOVEMENT_DIR);
  const outputPath = resolve(options.output ?? DEFAULT_OUTPUT_PATH);
  const limit = positiveInteger(options.limit, DEFAULT_LIMIT);
  const feeRate = finite(options.feeRate) ?? DEFAULT_FEE_RATE;
  const candidates = loadCompletedCandidates(storePath);
  const selected = [];
  let qualityEligibleMatchCount = 0;
  const collection = {
    requestedMatchCount: limit,
    candidateCount: candidates.length,
    attemptedCount: 0,
    fetchedCount: 0,
    reusedCount: 0,
    failedCount: 0,
    failures: [],
  };

  await mkdir(movementDir, { recursive: true });
  for (const candidate of candidates) {
    if (qualityEligibleMatchCount >= limit) break;
    let snapshotPath = candidate.eventSlugs
      .map((eventSlug) => join(movementDir, `${eventSlug}.json`))
      .find((path) => existsSync(path))
      ?? join(movementDir, `${candidate.eventSlug}.json`);
    let movement = null;

    if (existsSync(snapshotPath) && !options.refresh) {
      movement = readJson(snapshotPath);
      try {
        assertMovementIdentity(movement, candidate.match);
        collection.reusedCount += 1;
      } catch (error) {
        movement = null;
        collection.failures.push({
          matchId: candidate.match.id,
          eventSlug: movement?.event?.slug ?? candidate.eventSlug,
          error: cleanError(error),
          ignoredCachedSnapshot: snapshotPath,
        });
      }
    }
    if (!movement && options.collect !== false) {
      collection.attemptedCount += 1;
      logProgress(options, `Fetching ${candidate.match.id} (${qualityEligibleMatchCount + 1}/${limit} quality-eligible)`);
      try {
        movement = await fetchCandidateMovement(candidate, options);
        assertMovementIdentity(movement, candidate.match);
        snapshotPath = join(movementDir, `${movement.event.slug}.json`);
        await writeJsonAtomic(snapshotPath, movement);
        collection.fetchedCount += 1;
      } catch (error) {
        collection.failedCount += 1;
        collection.failures.push({
          matchId: candidate.match.id,
          eventSlug: candidate.eventSlug,
          attemptedEventSlugs: candidate.eventSlugs,
          error: cleanError(error),
        });
        logProgress(options, `Skipped ${candidate.match.id}: ${cleanError(error)}`);
        continue;
      }
    } else if (!movement) {
      continue;
    }

    if (!movement?.marketStructure) {
      collection.failedCount += 1;
      collection.failures.push({
        matchId: candidate.match.id,
        eventSlug: candidate.eventSlug,
        error: "snapshot_missing_market_structure",
      });
      continue;
    }
    const selectedCandidate = {
      ...candidate,
      eventSlug: movement.event?.slug ?? candidate.eventSlug,
      movement,
      snapshotPath,
      feeRate,
    };
    const preview = buildSignalBacktestMatch({
      movement,
      match: candidate.match,
      prediction: candidate.prediction,
      feeRate,
    });
    selected.push(selectedCandidate);
    if (preview.quality.readiness !== "blocked") qualityEligibleMatchCount += 1;
  }

  const matchInputs = selected.map((candidate) => ({
    movement: candidate.movement,
    match: candidate.match,
    prediction: candidate.prediction,
    feeRate,
  }));
  const matches = matchInputs.map((input) => buildSignalBacktestMatch(input));
  const report = aggregateSignalBacktest(matches, { feeRate });
  report.collection = {
    ...collection,
    completedMatchCount: matches.length,
    usableMatchCount: report.sample.usableSignalMatchCount,
    qualityEligibleMatchCount: report.sample.qualityEligibleMatchCount,
    minimumTargetMet: report.sample.qualityEligibleMatchCount >= limit,
    sourceStorePath: storePath,
    movementDirectory: movementDir,
    snapshots: selected.map((candidate) => ({
      matchId: candidate.match.id,
      eventSlug: candidate.eventSlug,
      path: candidate.snapshotPath,
      generatedAt: candidate.movement.generatedAt ?? null,
      readiness: candidate.movement.dataQuality?.readiness ?? "review",
    })),
  };
  report.thresholdSensitivity = buildThresholdSensitivity(matchInputs);
  report.notes = [
    "The sample is selected by latest completed official matches with a derivable Polymarket event slug, not by result.",
    "Signals are generated at historical decision stages using only prices available at or before that stage.",
    "CLV compares a direct YES entry at the decision stage with the final pre-kickoff primary-token price.",
    "Simulated ROI uses a fixed 3% sports fee assumption; dynamic fee schedules are intentionally out of scope.",
    "Occurrence metrics include repeated triggers. uniquePosition metrics keep only the first trigger per match and direct market, and drive the verdict status.",
    "Threshold sensitivity is descriptive and must not be tuned on this same sample without an out-of-sample holdout.",
  ];

  await writeJsonAtomic(outputPath, report);
  return { report, outputPath };
}

export function loadCompletedCandidates(storePath = DEFAULT_STORE_PATH) {
  const database = new DatabaseSync(resolve(storePath), { readOnly: true });
  try {
    const matches = database.prepare("select data from matches order by date desc, kickoff_sort desc").all()
      .map((row) => parseJson(row.data))
      .filter((match) => match.score?.home != null && match.score?.away != null)
      .filter((match) => Number.isFinite(Number(match.score.home)) && Number.isFinite(Number(match.score.away)))
      .filter((match) => match.official?.homeCode && match.official?.awayCode && match.official?.dateUtc);
    const predictionStatement = database.prepare("select data from predictions where match_id = ? order by generated_at desc");
    return matches.map((match) => {
      const predictions = predictionStatement.all(match.id).map((row) => parseJson(row.data));
      const prediction = predictions.find((item) => item.audit?.freezeType === "pre_match_final")
        ?? predictions.find((item) => Date.parse(item.generatedAt ?? "") < Date.parse(match.official.dateUtc))
        ?? null;
      return {
        match,
        prediction,
        eventSlug: buildEventSlug(match),
        eventSlugs: buildEventSlugCandidates(match),
      };
    }).filter((candidate) => candidate.prediction?.expectedGoals);
  } finally {
    database.close();
  }
}

export function buildEventSlug(match) {
  const homeCode = polymarketTeamCode(match.official?.homeCode);
  const awayCode = polymarketTeamCode(match.official?.awayCode);
  const date = dateInTimeZone(match.official?.dateUtc, "America/New_York");
  if (!homeCode || !awayCode || date === "Invalid Date") throw new Error(`Cannot derive event slug for ${match.id}.`);
  return `fifwc-${homeCode}-${awayCode}-${date}`;
}

export function buildEventSlugCandidates(match) {
  const rawHome = String(match.official?.homeCode ?? "").trim().toLowerCase();
  const rawAway = String(match.official?.awayCode ?? "").trim().toLowerCase();
  const mappedHome = polymarketTeamCode(match.official?.homeCode);
  const mappedAway = polymarketTeamCode(match.official?.awayCode);
  const marketDate = dateInTimeZone(match.official?.dateUtc, "America/New_York");
  const utcDate = new Date(match.official?.dateUtc ?? "").toISOString().slice(0, 10);
  return [...new Set([
    `fifwc-${mappedHome}-${mappedAway}-${marketDate}`,
    `fifwc-${rawHome}-${rawAway}-${marketDate}`,
    `fifwc-${mappedHome}-${mappedAway}-${utcDate}`,
    `fifwc-${rawHome}-${rawAway}-${utcDate}`,
  ])];
}

async function fetchCandidateMovement(candidate, options) {
  const errors = [];
  const movementOptions = {
    historyMode: "lifecycle",
    fidelity: positiveInteger(options.fidelity, 15),
    limit: positiveInteger(options.marketLimit, 120),
    concurrency: positiveInteger(options.concurrency, 8),
    timeoutMs: positiveInteger(options.timeoutMs, 12_000),
    summaryOnly: false,
  };
  for (const eventSlug of candidate.eventSlugs) {
    try {
      const movement = await buildMovementSnapshot({ ...movementOptions, eventSlug });
      assertMovementIdentity(movement, candidate.match);
      return movement;
    } catch (error) {
      errors.push(`${eventSlug}: ${cleanError(error)}`);
    }
  }
  try {
    const movement = await buildMovementSnapshot({
      ...movementOptions,
      home: candidate.match.modelHome ?? candidate.match.homeTeamId,
      away: candidate.match.modelAway ?? candidate.match.awayTeamId,
      date: dateInTimeZone(candidate.match.official.dateUtc, "America/New_York"),
    });
    assertMovementIdentity(movement, candidate.match);
    return movement;
  } catch (error) {
    errors.push(`search fallback: ${cleanError(error)}`);
  }
  throw new Error(errors.join(" | "));
}

export function assertMovementIdentity(movement, match) {
  const eventTeams = Array.isArray(movement?.event?.teams) ? movement.event.teams : [];
  const eventHome = canonicalTeam(eventTeams.find((team) => team.ordering === "home")?.name);
  const eventAway = canonicalTeam(eventTeams.find((team) => team.ordering === "away")?.name);
  const expectedHome = new Set([match.modelHome, match.homeTeamId].map(canonicalTeam).filter(Boolean));
  const expectedAway = new Set([match.modelAway, match.awayTeamId].map(canonicalTeam).filter(Boolean));
  const nameIdentityMatches = eventHome && eventAway && expectedHome.has(eventHome) && expectedAway.has(eventAway);
  const slugIdentityMatches = buildEventSlugCandidates(match).includes(String(movement?.event?.slug ?? ""));
  if (!nameIdentityMatches && !slugIdentityMatches) {
    throw new Error(
      `event_identity_mismatch expected=${[...expectedHome].join("/")} vs ${[...expectedAway].join("/")} actual=${eventHome || "?"} vs ${eventAway || "?"}`,
    );
  }
  const expectedKickoff = Date.parse(match.official?.dateUtc ?? "");
  const actualKickoff = Date.parse(movement.event?.start_time ?? movement.input?.cutoffTime ?? "");
  if (Number.isFinite(expectedKickoff) && Number.isFinite(actualKickoff) && Math.abs(expectedKickoff - actualKickoff) > 6 * 60 * 60 * 1000) {
    throw new Error(`event_kickoff_mismatch expected=${match.official.dateUtc} actual=${movement.event?.start_time}`);
  }
  return true;
}

function canonicalTeam(value) {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  const aliases = {
    bosniaandherzegovina: "bosniaherzegovina",
    congodr: "drcongo",
    democraticrepublicofthecongo: "drcongo",
    cotedivoire: "ivorycoast",
    curacao: "curacao",
    republicofkorea: "southkorea",
    korea: "southkorea",
    unitedstates: "usa",
    unitedstatesofamerica: "usa",
  };
  return aliases[normalized] ?? normalized;
}

function polymarketTeamCode(value) {
  const raw = String(value ?? "").trim().toUpperCase();
  return POLYMARKET_TEAM_CODE_OVERRIDES[raw] ?? raw.toLowerCase();
}

function dateInTimeZone(value, timeZone) {
  const date = new Date(value ?? "");
  if (Number.isNaN(date.getTime())) return "Invalid Date";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function parseArgs(args) {
  const options = { collect: true };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--collect") options.collect = true;
    else if (arg === "--no-collect") options.collect = false;
    else if (arg === "--refresh") options.refresh = true;
    else if (arg === "--limit") options.limit = Number(next(args, ++index, arg));
    else if (arg === "--fee-rate") options.feeRate = Number(next(args, ++index, arg));
    else if (arg === "--fidelity") options.fidelity = Number(next(args, ++index, arg));
    else if (arg === "--market-limit") options.marketLimit = Number(next(args, ++index, arg));
    else if (arg === "--concurrency") options.concurrency = Number(next(args, ++index, arg));
    else if (arg === "--timeout-ms") options.timeoutMs = Number(next(args, ++index, arg));
    else if (arg === "--store-path") options.storePath = next(args, ++index, arg);
    else if (arg === "--movement-dir") options.movementDir = next(args, ++index, arg);
    else if (arg === "--output") options.output = next(args, ++index, arg);
    else if (arg === "--quiet") options.quiet = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  npm run polymarket:backtest -- --collect --limit 20
  npm run polymarket:backtest -- --no-collect --limit 20

Options:
  --collect / --no-collect  Fetch missing lifecycle snapshots or use cache only.
  --refresh                 Re-fetch cached snapshots.
  --limit <n>               Required completed-match sample size; default 20.
  --fee-rate <n>            Fixed simulation fee rate; default 0.03.
  --fidelity <minutes>      Lifecycle history resolution; default 15.
  --market-limit <n>        Maximum directly useful markets per match; default 120.
  --concurrency <n>         CLOB history request concurrency; default 8.
  --store-path <path>       SQLite result/model snapshot store.
  --movement-dir <path>     Lifecycle snapshot cache directory.
  --output <path>           Backtest report path.
  --quiet                   Suppress progress messages.
`);
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

function readJson(path) {
  return parseJson(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
}

function parseJson(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function next(args, index, label) {
  if (args[index] == null) throw new Error(`${label} requires a value.`);
  return args[index];
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanError(error) {
  return String(error?.message ?? error).replace(/\s+/g, " ").slice(0, 500);
}

function logProgress(options, message) {
  if (!options.quiet) process.stderr.write(`[polymarket-backtest] ${message}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const { report, outputPath } = await runSignalBacktest(options);
  console.log(JSON.stringify({
    ok: true,
    outputPath,
    sample: report.sample,
    collection: report.collection,
    overall: report.overall,
    thresholdSensitivity: report.thresholdSensitivity,
  }, null, 2));
  if (!report.collection.minimumTargetMet) process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
