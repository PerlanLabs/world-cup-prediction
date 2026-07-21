import { applyLineupPayloadToStore, getDefaultLineupSourcePath, readLineupPayloadFromFile } from "./lineup-sync.mjs";
import { syncLineups } from "./backend-service.mjs";
import { getStore } from "./store.mjs";

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

try {
  const path = args.path ?? getDefaultLineupSourcePath();
  const summary = args.dryRun
    ? dryRunLineups(path, args)
    : syncLineups({
        path,
        retrievedAt: args.retrievedAt,
        reviewedAt: args.reviewedAt,
      });

  printSummary({
    ...summary,
    dryRun: Boolean(args.dryRun),
    sourcePath: path,
  }, args);
} catch (error) {
  const payload = {
    ok: false,
    code: error.code ?? "lineup_sync_failed",
    message: error.message,
  };
  console.error(args.json ? JSON.stringify(payload, null, 2) : `${payload.code}: ${payload.message}`);
  process.exit(1);
}

function dryRunLineups(path, args) {
  const payload = readLineupPayloadFromFile(path);
  return applyLineupPayloadToStore(getStore(), payload, {
    retrievedAt: args.retrievedAt,
    reviewedAt: args.reviewedAt,
  }).summary;
}

function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    help: false,
    json: false,
    path: null,
    retrievedAt: null,
    reviewedAt: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--path") {
      parsed.path = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--retrieved-at") {
      parsed.retrievedAt = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--reviewed-at") {
      parsed.reviewedAt = requireValue(argv, index, arg);
      index += 1;
    } else {
      const error = new Error(`Unknown argument: ${arg}`);
      error.code = "unknown_argument";
      throw error;
    }
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

function printSummary(summary, args) {
  const payload = { ok: true, sync: summary };
  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`Lineup sync ${summary.dryRun ? "dry run" : "completed"}.`);
  console.log(`Source: ${summary.sourcePath}`);
  console.log(`Imported matches: ${summary.importedCount}/${summary.rawCount}`);
  console.log(`Official sections: ${summary.officialImportedCount}`);
  console.log(`Expected sections: ${summary.expectedImportedCount}`);
  console.log(`Skipped: ${summary.skippedCount}`);
  if (summary.skipped?.length) {
    console.log(JSON.stringify(summary.skipped, null, 2));
  }
}

function printHelp() {
  console.log(`Usage: node prediction-api/sync-lineups.mjs [options]

Options:
  --path <file>          Lineup JSON payload path. Defaults to PREDICTION_LINEUP_SOURCE_PATH or prediction-api/data/lineups.local.json.
  --dry-run              Validate and summarize without writing to the local store.
  --json                 Print machine-readable JSON output.
  --retrieved-at <iso>   Override source retrievedAt when payload does not provide it.
  --reviewed-at <iso>    Override expected lineup reviewedAt when payload does not provide it.
  --help                 Show this help.
`);
}
