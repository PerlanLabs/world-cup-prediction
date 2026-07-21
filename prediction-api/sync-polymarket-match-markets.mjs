import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { maybeAttachDeepSeekAnalyses } from "./deepseek-analysis.mjs";
import { fetchPolymarketMatchMarketsPayload } from "./polymarket-match-markets-sync.mjs";
import { getStore } from "./store.mjs";
import { syncPolymarketMatchMarkets } from "./backend-service.mjs";

try {
  const options = parseArgs(process.argv.slice(2));

  if (options.output) {
    const store = getStore();
    let payload = await fetchPolymarketMatchMarketsPayload(store.matches, {
      teams: store.teams,
      matchIds: options.matchIds,
      mode: options.mode,
      limit: options.limit,
      eventSlugByMatchId: options.eventSlugByMatchId,
    });
    payload = await maybeAttachDeepSeekAnalyses(payload, store, {
      withAi: options.withAi,
      aiLimit: options.aiLimit,
    });
    writeFileSync(resolve(options.output), JSON.stringify(payload, null, 2));
    const result = {
      ok: true,
      output: resolve(options.output),
      probe: payload.probe,
      ai: payload.ai ?? null,
    };
    printResult(result, options);
  } else {
    const summary = await syncPolymarketMatchMarkets(options);
    printResult({ ok: true, sync: summary }, options);
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: {
      code: error.code ?? "polymarket_match_market_sync_failed",
      message: error.message,
    },
  }, null, 2));
  process.exitCode = 1;
}

function parseArgs(args) {
  const options = { eventSlugByMatchId: {} };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--match-id") {
      options.matchIds = [...(options.matchIds ?? []), requiredValue(args, ++index, "--match-id")];
    } else if (arg === "--mode") {
      options.mode = requiredValue(args, ++index, "--mode");
    } else if (arg === "--limit") {
      options.limit = Number(requiredValue(args, ++index, "--limit"));
    } else if (arg === "--output") {
      options.output = requiredValue(args, ++index, "--output");
    } else if (arg === "--event-slug") {
      const value = requiredValue(args, ++index, "--event-slug");
      const [matchId, slug] = value.split("=");
      if (!matchId || !slug) throw new Error("--event-slug requires matchId=slug.");
      options.eventSlugByMatchId[matchId] = slug;
    } else if (arg === "--with-ai") {
      options.withAi = true;
    } else if (arg === "--ai-limit") {
      options.aiLimit = Number(requiredValue(args, ++index, "--ai-limit"));
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (Object.keys(options.eventSlugByMatchId).length === 0) delete options.eventSlugByMatchId;
  return options;
}

function printResult(result, options) {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.output) {
    console.log("Polymarket single-match market snapshot written.");
    console.log(`Output: ${result.output}`);
    console.log(`Available matches: ${result.probe?.availableCount ?? 0}/${result.probe?.requestedCount ?? 0}`);
    return;
  }
  console.log("Polymarket single-match market sync completed.");
  console.log(`Imported matches: ${result.sync.importedCount}`);
  console.log(`Skipped matches: ${result.sync.skippedCount}`);
}

function requiredValue(args, index, label) {
  const value = args[index];
  if (!value) throw new Error(`${label} requires a value.`);
  return value;
}

function printHelp() {
  console.log(`Usage: node prediction-api/sync-polymarket-match-markets.mjs [options]

Options:
  --match-id <id>              Sync one match. Repeatable.
  --mode <all|upcoming|completed>
  --limit <n>                  Limit selected matches for a small probe.
  --event-slug <id=slug>       Force a Polymarket event slug for one match.
  --output <path>              Write a portable snapshot JSON instead of mutating the store.
  --with-ai                    Generate DeepSeek analysis when DEEPSEEK_API_KEY is set.
  --ai-limit <n>               Limit DeepSeek analysis calls.
  --json                       Print machine-readable JSON.

This command is read-only against Polymarket. It does not use wallet, account,
order, or trading APIs. DeepSeek is optional and only explains structured data.
`);
}
