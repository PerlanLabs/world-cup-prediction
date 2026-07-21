import { importPolymarketMatchMarkets } from "./backend-service.mjs";

try {
  const options = parseArgs(process.argv.slice(2));
  const summary = await importPolymarketMatchMarkets(options);
  const payload = { ok: true, sync: summary };
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("Polymarket single-match market import completed.");
    console.log(`Imported matches: ${summary.importedCount}`);
    console.log(`Skipped matches: ${summary.skippedCount}`);
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: {
      code: error.code ?? "polymarket_match_market_import_failed",
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
    } else if (arg === "--path") {
      options.path = requiredValue(args, ++index, "--path");
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!options.path) throw new Error("--path is required.");
  return options;
}

function requiredValue(args, index, label) {
  const value = args[index];
  if (!value) throw new Error(`${label} requires a value.`);
  return value;
}

function printHelp() {
  console.log(`Usage: node prediction-api/import-polymarket-match-markets.mjs --path <payload.json> [--json]

Imports a previously generated Polymarket single-match market snapshot. This is
the preferred short-term server path when the server cannot reach Polymarket.
`);
}
