import { syncPolymarketWorldCupMarkets } from "./backend-service.mjs";

try {
  const options = parseArgs(process.argv.slice(2));
  const summary = await syncPolymarketWorldCupMarkets(options);
  const payload = { ok: true, sync: summary };
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("Polymarket read-only market sync completed.");
    console.log(`Imported team signals: ${summary.importedCount}`);
    console.log(`Skipped markets: ${summary.skippedCount}`);
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: {
      code: error.code ?? "polymarket_market_sync_failed",
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
    } else if (arg === "--event-slug") {
      options.eventSlugs = [...(options.eventSlugs ?? []), requiredValue(args, ++index, "--event-slug")];
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
  console.log(`Usage: node prediction-api/sync-polymarket-markets.mjs [options]

Options:
  --event-slug <slug>      Polymarket event slug. Defaults to world-cup-winner.
  --json                   Print machine-readable JSON.

This command is read-only against Polymarket. It does not use wallet, account,
order, or trading APIs. It stores market-implied probability references only.
`);
}
