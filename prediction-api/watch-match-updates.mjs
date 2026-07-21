import {
  freezePreMatchPredictions,
  refreshModelRatings,
  syncOfficialFixtures,
  syncOfficialMatchFacts,
} from "./backend-service.mjs";

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

try {
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
      const sync = await syncMatchUpdates(args);
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

async function syncMatchUpdates(args) {
  const fixtureSync = args.skipFixtures
    ? null
    : await syncOfficialFixtures({
      mode: args.fixtureMode,
      language: args.language,
    });

  const factsSync = args.skipFacts
    ? null
    : await syncOfficialMatchFacts({
      matchIds: args.matchIds.length > 0 ? args.matchIds : undefined,
      language: args.language,
      mode: args.factsMode,
    });
  const modelRefresh = args.skipModelRatings
    ? null
    : refreshModelRatings({
      matchIds: args.modelMatchIds.length > 0 ? args.modelMatchIds : undefined,
      predictionMode: args.modelPredictionMode,
    });
  const freeze = args.skipFreeze
    ? null
    : freezePreMatchPredictions({
      lockBeforeMinutes: args.freezeLockBeforeMinutes,
    });

  return {
    sourceId: "fifa-official-match-update-watch",
    fixtureSync,
    factsSync,
    modelRefresh,
    freeze,
    summary: {
      fixturesImportedCount: fixtureSync?.importedCount ?? null,
      fixturesUpdatedAt: fixtureSync?.fetchedAt ?? null,
      factsImportedCount: factsSync?.importedCount ?? null,
      factsSkippedCount: factsSync?.skippedCount ?? null,
      factsMatchIds: factsSync?.importedMatchIds ?? [],
      modelRatingsChanged: modelRefresh?.calibration?.changed ?? null,
      modelPredictionRunId: modelRefresh?.predictionRun?.id ?? null,
      modelPredictionMatchCount: modelRefresh?.predictionRun?.matchCount ?? 0,
      frozenPredictionCount: freeze?.frozenCount ?? null,
    },
  };
}

function parseArgs(argv) {
  const parsed = {
    factsMode: "completed",
    fixtureMode: "mapped",
    help: false,
    intervalMs: 5 * 60 * 1000,
    json: false,
    language: undefined,
    matchIds: [],
    maxRuns: null,
    freezeLockBeforeMinutes: 60,
    modelMatchIds: [],
    modelPredictionMode: "pending",
    once: false,
    skipFreeze: false,
    skipFacts: false,
    skipFixtures: false,
    skipModelRatings: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--all-facts") {
      parsed.factsMode = "all";
    } else if (arg === "--completed-facts") {
      parsed.factsMode = "completed";
    } else if (arg === "--facts-mode") {
      parsed.factsMode = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--fixture-mode") {
      parsed.fixtureMode = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--interval-ms") {
      parsed.intervalMs = parsePositiveNumber(requireValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === "--freeze-lock-before-minutes") {
      parsed.freezeLockBeforeMinutes = parsePositiveNumber(requireValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--language") {
      parsed.language = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--match-id") {
      parsed.matchIds.push(requireValue(argv, index, arg));
      index += 1;
    } else if (arg === "--model-match-id") {
      parsed.modelMatchIds.push(requireValue(argv, index, arg));
      index += 1;
    } else if (arg === "--model-prediction-mode") {
      parsed.modelPredictionMode = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--max-runs") {
      parsed.maxRuns = parsePositiveNumber(requireValue(argv, index, arg), arg);
      index += 1;
    } else if (arg === "--once") {
      parsed.once = true;
    } else if (arg === "--skip-facts") {
      parsed.skipFacts = true;
    } else if (arg === "--skip-fixtures") {
      parsed.skipFixtures = true;
    } else if (arg === "--skip-model-ratings") {
      parsed.skipModelRatings = true;
    } else if (arg === "--skip-freeze") {
      parsed.skipFreeze = true;
    } else {
      const error = new Error(`Unknown argument: ${arg}`);
      error.code = "unknown_argument";
      throw error;
    }
  }

  if (!["completed", "all"].includes(parsed.factsMode)) {
    const error = new Error(`Unsupported facts mode: ${parsed.factsMode}.`);
    error.code = "bad_request";
    throw error;
  }

  if (!["mapped", "supported", "predictable"].includes(parsed.fixtureMode)) {
    const error = new Error(`Unsupported fixture mode: ${parsed.fixtureMode}.`);
    error.code = "bad_request";
    throw error;
  }

  if (parsed.skipFacts && parsed.skipFixtures && parsed.skipModelRatings && parsed.skipFreeze) {
    const error = new Error("At least one sync step must be enabled.");
    error.code = "bad_request";
    throw error;
  }
  if (!["pending", "all"].includes(parsed.modelPredictionMode)) {
    const error = new Error(`Unsupported model prediction mode: ${parsed.modelPredictionMode}.`);
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

function printResult(payload, args) {
  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const { sync } = payload;
  console.log(`Official match update sync run ${payload.runCount} completed at ${payload.syncedAt}.`);
  if (sync.fixtureSync) {
    console.log(`Fixtures: imported ${sync.fixtureSync.importedCount}, skipped ${sync.fixtureSync.skippedCount}.`);
  } else {
    console.log("Fixtures: skipped by option.");
  }
  if (sync.factsSync) {
    console.log(`Facts: selected ${sync.factsSync.selection.selectedCount}, imported ${sync.factsSync.importedCount}, skipped ${sync.factsSync.skippedCount}.`);
  } else {
    console.log("Facts: skipped by option.");
  }
  if (sync.modelRefresh) {
    console.log(`Model ratings: changed ${sync.modelRefresh.calibration.changed}, prediction snapshots ${sync.modelRefresh.predictionRun?.matchCount ?? 0}.`);
  } else {
    console.log("Model ratings: skipped by option.");
  }
  if (sync.freeze) {
    console.log(`Frozen predictions: ${sync.freeze.frozenCount}.`);
  } else {
    console.log("Frozen predictions: skipped by option.");
  }
}

function printError(error, args) {
  const payload = {
    ok: false,
    code: error.code ?? "match_update_watch_failed",
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
  console.log(`Usage: node prediction-api/watch-match-updates.mjs [options]

Options:
  --once                       Run one sync cycle and exit.
  --interval-ms <number>       Polling interval for watch mode. Defaults to 300000.
  --max-runs <number>          Stop after this many cycles.
  --fixture-mode <mode>        FIFA fixture import mode: mapped, supported, predictable. Defaults to mapped.
  --facts-mode <mode>          Match facts mode: completed or all. Defaults to completed.
  --all-facts                  Probe every match with a FIFA IdMatch.
  --completed-facts            Sync completed matches only. Default.
  --match-id <id>              Sync facts for a specific product match id. Repeatable.
  --model-match-id <id>        Limit model prediction refresh to a specific match id. Repeatable.
  --model-prediction-mode <m>  Model prediction refresh mode: pending or all. Defaults to pending.
  --skip-fixtures              Do not refresh official fixtures/results in this cycle.
  --skip-facts                 Do not refresh official match facts/events in this cycle.
  --skip-model-ratings         Do not export official results or refresh current Elo ratings.
  --skip-freeze                Do not freeze pre-match prediction snapshots.
  --freeze-lock-before-minutes <n>
                               Freeze due matches whose kickoff is within this many minutes. Defaults to 60.
  --language <code>            FIFA API language. Defaults to en.
  --json                       Print machine-readable JSON output.
  --help                       Show this help.
`);
}
