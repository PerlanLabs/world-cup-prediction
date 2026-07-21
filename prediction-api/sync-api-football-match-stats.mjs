import { syncApiFootballMatchStats } from "./backend-service.mjs";

try {
  const options = parseArgs(process.argv.slice(2));
  const summary = await syncApiFootballMatchStats(options);
  const payload = { ok: true, sync: summary };
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("API-Football match statistics sync completed.");
    console.log(`Mode: ${summary.selection.mode}`);
    console.log(`Selected: ${summary.selection.selectedCount}`);
    console.log(`Imported: ${summary.importedCount}`);
    console.log(`Skipped: ${summary.skippedCount}`);
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: {
      code: error.code ?? "api_football_match_stats_sync_failed",
      message: error.message,
    },
  }, null, 2));
  process.exitCode = 1;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--all") {
      options.mode = "all";
    } else if (arg === "--completed") {
      options.mode = "completed";
    } else if (arg === "--match-id") {
      const value = requiredValue(args, ++index, "--match-id");
      options.matchIds = [...(options.matchIds ?? []), value];
    } else if (arg === "--key") {
      options.key = requiredValue(args, ++index, "--key");
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function requiredValue(args, index, label) {
  const value = args[index];
  if (!value) throw new Error(`${label} requires a value.`);
  return value;
}

function printHelp() {
  console.log(`Usage: node prediction-api/sync-api-football-match-stats.mjs [options]

Options:
  --completed              Sync completed matches only. Default.
  --all                    Sync every match with an API-Football fixture id.
  --match-id <id>          Sync one match id. Can be repeated.
  --key <key>              API-Football key. Prefer API_FOOTBALL_KEY env var.
  --json                   Print machine-readable JSON.
`);
}
