import { syncApiFootballSupplementalData } from "./backend-service.mjs";

try {
  const options = parseArgs(process.argv.slice(2));
  const summary = await syncApiFootballSupplementalData(options);
  const payload = { ok: true, sync: summary };
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("API-Football supplemental sync completed.");
    console.log(`Fixture IDs imported: ${summary.summary.fixtureImportedCount ?? "skipped"}`);
    console.log(`Statistics imported: ${summary.summary.statisticsImportedCount}`);
    console.log(`Statistics skipped: ${summary.summary.statisticsSkippedCount}`);
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: {
      code: error.code ?? "api_football_sync_failed",
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
    } else if (arg === "--league") {
      options.league = requiredValue(args, ++index, "--league");
    } else if (arg === "--season") {
      options.season = requiredValue(args, ++index, "--season");
    } else if (arg === "--key") {
      options.key = requiredValue(args, ++index, "--key");
    } else if (arg === "--skip-fixtures") {
      options.skipFixtureSync = true;
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
  console.log(`Usage: node prediction-api/sync-api-football.mjs [options]

Runs API-Football fixture-id mapping, then imports supplemental technical
statistics for selected matches. Requires API_FOOTBALL_KEY or --key.

Options:
  --completed              Sync completed matches only. Default.
  --all                    Sync every match with an API-Football fixture id.
  --match-id <id>          Sync one local match id. Can be repeated.
  --league <id>            API-Football league id. Defaults to 1.
  --season <year>          API-Football season. Defaults to 2026.
  --skip-fixtures          Reuse existing fixture IDs and only fetch stats.
  --key <key>              API-Football key. Prefer API_FOOTBALL_KEY env var.
  --json                   Print machine-readable JSON.
`);
}
