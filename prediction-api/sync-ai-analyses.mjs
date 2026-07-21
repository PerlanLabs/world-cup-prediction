import { syncDeepSeekAnalyses, syncModelOnlyDeepSeekAnalyses } from "./backend-service.mjs";

try {
  const options = parseArgs(process.argv.slice(2));
  const summary = options.modelOnly
    ? await syncModelOnlyDeepSeekAnalyses(options)
    : await syncDeepSeekAnalyses(options);
  const payload = { ok: true, sync: summary };
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("DeepSeek AI analysis sync completed.");
    console.log(`Generated analyses: ${summary.generatedCount}`);
    console.log(`Skipped matches: ${summary.skippedCount}`);
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: {
      code: error.code ?? "deepseek_analysis_sync_failed",
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
    } else if (arg === "--match-id") {
      options.matchIds = [...(options.matchIds ?? []), requiredValue(args, ++index, "--match-id")];
    } else if (arg === "--limit") {
      options.limit = Number(requiredValue(args, ++index, "--limit"));
    } else if (arg === "--refresh") {
      options.refresh = true;
    } else if (arg === "--model-only") {
      options.modelOnly = true;
    } else if (arg === "--missing-market-only") {
      options.missingMarketOnly = true;
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
  console.log(`Usage: node prediction-api/sync-ai-analyses.mjs [options]

Options:
  --match-id <id>              Generate analysis for one match. Repeatable.
  --limit <n>                  Limit DeepSeek calls for a small batch.
  --refresh                    Regenerate analyses that already exist.
  --model-only                 Explain model output without requiring Polymarket single-match markets.
  --missing-market-only        With --model-only, skip matches that already have Polymarket match markets.
  --json                       Print machine-readable JSON.

Generates DeepSeek explanations from stored model probabilities and read-only
Polymarket match-market snapshots. It does not fetch Polymarket or use trading APIs.
Use --model-only when a match has no Polymarket single-match market snapshot.
DEEPSEEK_API_KEY must be provided through the environment.
`);
}
