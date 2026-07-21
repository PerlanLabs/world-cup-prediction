import { syncExpectedLineups } from "./backend-service.mjs";

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

try {
  const summary = await syncExpectedLineups({
    url: args.url,
    fetchedAt: args.fetchedAt,
  });
  printSummary(summary, args);
} catch (error) {
  const payload = {
    ok: false,
    code: error.code ?? "expected_lineup_sync_failed",
    message: error.message,
  };
  console.error(args.json ? JSON.stringify(payload, null, 2) : `${payload.code}: ${payload.message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {
    fetchedAt: null,
    help: false,
    json: false,
    url: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--fetched-at") {
      parsed.fetchedAt = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--url") {
      parsed.url = requireValue(argv, index, arg);
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

  console.log("Expected lineup sync completed.");
  console.log(`Source: ${summary.sourceId}`);
  console.log(`Imported matches: ${summary.importedCount}/${summary.rawCount}`);
  console.log(`Expected sections: ${summary.expectedImportedCount}`);
  console.log(`Skipped: ${summary.skippedCount}`);
  console.log(`Parsed source blocks: ${summary.probe.rawCount}`);
  if (summary.skipped?.length) {
    console.log(JSON.stringify(summary.skipped, null, 2));
  }
}

function printHelp() {
  console.log(`Usage: node prediction-api/sync-expected-lineups.mjs [options]

Options:
  --url <url>             Override the RotoWire World Cup lineups URL.
  --json                  Print machine-readable JSON output.
  --fetched-at <iso>      Override source fetched timestamp.
  --help                  Show this help.
`);
}
