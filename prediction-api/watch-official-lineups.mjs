import { listOfficialLineupSyncCandidates, syncOfficialLineups } from "./backend-service.mjs";

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

try {
  if (args.dryRun) {
    printResult({
      ok: true,
      dryRun: true,
      candidates: listOfficialLineupSyncCandidates(buildSyncOptions(args)),
    }, args);
    process.exit(0);
  }

  await runWatcher(args);
} catch (error) {
  printError(error, args);
  process.exit(1);
}

async function runWatcher(args) {
  let runCount = 0;
  while (true) {
    runCount += 1;
    try {
      const sync = await syncOfficialLineups(buildSyncOptions(args));
      printResult({
        ok: true,
        runCount,
        syncedAt: new Date().toISOString(),
        sync,
      }, args);
    } catch (error) {
      printError(error, args);
      if (args.once) throw error;
    }

    if (args.once || (args.maxRuns != null && runCount >= args.maxRuns)) {
      return;
    }
    await delay(args.intervalMs);
  }
}

function buildSyncOptions(args) {
  return {
    matchIds: args.matchIds.length > 0 ? args.matchIds : undefined,
    language: args.language,
    mode: args.mode,
    lookaheadHours: args.lookaheadHours,
    lookbackHours: args.lookbackHours,
    onlyPending: args.onlyPending,
    now: args.now,
  };
}

function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    help: false,
    intervalMs: 5 * 60 * 1000,
    json: false,
    language: undefined,
    lookaheadHours: 4,
    lookbackHours: 1,
    matchIds: [],
    maxRuns: null,
    mode: "due",
    now: undefined,
    once: false,
    onlyPending: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--include-existing") {
      parsed.onlyPending = false;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--once") {
      parsed.once = true;
    } else if (arg === "--all") {
      parsed.mode = "all";
    } else if (arg === "--interval-ms") {
      parsed.intervalMs = parsePositiveNumber(requireValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === "--language") {
      parsed.language = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--lookahead-hours") {
      parsed.lookaheadHours = parseNonNegativeNumber(requireValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === "--lookback-hours") {
      parsed.lookbackHours = parseNonNegativeNumber(requireValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === "--match-id") {
      parsed.matchIds.push(requireValue(argv, index, arg));
      index += 1;
    } else if (arg === "--max-runs") {
      parsed.maxRuns = parsePositiveNumber(requireValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === "--mode") {
      parsed.mode = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--now") {
      parsed.now = requireValue(argv, index, arg);
      index += 1;
    } else {
      const error = new Error(`Unknown argument: ${arg}`);
      error.code = "unknown_argument";
      throw error;
    }
  }

  if (!["all", "due"].includes(parsed.mode)) {
    const error = new Error(`Unsupported mode: ${parsed.mode}.`);
    error.code = "bad_request";
    throw error;
  }

  return parsed;
}

function requireValue(argv, index, arg) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    const error = new Error(`${arg} requires a value.`);
    error.code = "missing_argument_value";
    throw error;
  }
  return value;
}

function parsePositiveNumber(value, arg) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    const error = new Error(`${arg} must be a positive number.`);
    error.code = "bad_request";
    throw error;
  }
  return number;
}

function parseNonNegativeNumber(value, arg) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    const error = new Error(`${arg} must be zero or a positive number.`);
    error.code = "bad_request";
    throw error;
  }
  return number;
}

function printResult(payload, args) {
  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (payload.dryRun) {
    const candidates = payload.candidates;
    console.log("Official lineup candidate check completed.");
    console.log(`Mode: ${candidates.mode}`);
    console.log(`Window: -${candidates.lookbackHours}h to +${candidates.lookaheadHours}h from ${candidates.now}`);
    console.log(`Only pending: ${candidates.onlyPending}`);
    console.log(`Selected matches: ${candidates.selectedCount}`);
    if (candidates.selectedMatchIds.length > 0) {
      console.log(candidates.selectedMatchIds.join("\n"));
    }
    return;
  }

  const sync = payload.sync;
  console.log(`Official lineup sync run ${payload.runCount} completed at ${payload.syncedAt}.`);
  console.log(`Mode: ${sync.selection.mode}`);
  console.log(`Selected: ${sync.selection.selectedCount}`);
  console.log(`Imported official lineups: ${sync.officialImportedCount}`);
  console.log(`Skipped probes: ${sync.probe.skippedCount}`);
}

function printError(error, args) {
  const payload = {
    ok: false,
    code: error.code ?? "official_lineup_watch_failed",
    message: error.message,
  };
  console.error(args.json ? JSON.stringify(payload, null, 2) : `${payload.code}: ${payload.message}`);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function printHelp() {
  console.log(`Usage: node prediction-api/watch-official-lineups.mjs [options]

Options:
  --dry-run                    List selected matches without fetching FIFA live data.
  --once                       Run one sync cycle and exit.
  --all                        Probe every pending match with a FIFA IdMatch.
  --mode <due|all>             Selection mode. Defaults to due.
  --lookahead-hours <number>   Due-window lookahead. Defaults to 4.
  --lookback-hours <number>    Due-window lookback. Defaults to 1.
  --interval-ms <number>       Polling interval for watch mode. Defaults to 300000.
  --max-runs <number>          Stop after this many cycles.
  --match-id <id>              Sync a specific product match id. Repeatable.
  --include-existing           Re-fetch matches that already have official lineups.
  --language <code>            FIFA response language. Defaults to en.
  --now <iso>                  Override current time for tests/debugging.
  --json                       Print machine-readable JSON output.
  --help                       Show this help.
`);
}
