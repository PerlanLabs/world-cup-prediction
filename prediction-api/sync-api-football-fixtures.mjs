import { syncApiFootballFixtureIds } from "./backend-service.mjs";

try {
  const options = parseArgs(process.argv.slice(2));
  const summary = await syncApiFootballFixtureIds(options);
  const payload = { ok: true, sync: summary };
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("API-Football fixture id sync completed.");
    console.log(`Imported: ${summary.importedCount}`);
    console.log(`Skipped: ${summary.skippedCount}`);
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: {
      code: error.code ?? "api_football_fixture_sync_failed",
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
    } else if (arg === "--league") {
      options.league = requiredValue(args, ++index, "--league");
    } else if (arg === "--season") {
      options.season = requiredValue(args, ++index, "--season");
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
  console.log(`Usage: node prediction-api/sync-api-football-fixtures.mjs [options]

Options:
  --league <id>            API-Football league id. Defaults to 1.
  --season <year>          API-Football season. Defaults to 2026.
  --key <key>              API-Football key. Prefer API_FOOTBALL_KEY env var.
  --json                   Print machine-readable JSON.
`);
}
