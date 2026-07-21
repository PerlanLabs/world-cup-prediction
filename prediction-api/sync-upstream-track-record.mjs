import { backfillUpstreamTrackRecord } from "./backend-service.mjs";

try {
  const options = parseArgs(process.argv.slice(2));
  const backfill = await backfillUpstreamTrackRecord(options);
  const payload = { ok: true, backfill };
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("Upstream track-record backfill completed.");
    console.log(`Imported frozen snapshots: ${backfill.importedCount}`);
    console.log(`Skipped matches: ${backfill.skippedCount}`);
    console.log(`Upstream updated at: ${backfill.upstreamUpdatedAt ?? "unknown"}`);
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: {
      code: error.code ?? "upstream_track_record_backfill_failed",
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
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--results-url") {
      options.resultsUrl = requiredValue(args, ++index, "--results-url");
    } else if (arg === "--ratings-url") {
      options.ratingsUrl = requiredValue(args, ++index, "--ratings-url");
    } else if (arg === "--local-repo") {
      options.localRepoPath = requiredValue(args, ++index, "--local-repo");
    } else if (arg === "--no-local-fallback") {
      options.disableLocalFallback = true;
    } else if (arg === "--fetched-at") {
      options.fetchedAt = requiredValue(args, ++index, "--fetched-at");
    } else if (arg === "--generated-at") {
      options.generatedAt = requiredValue(args, ++index, "--generated-at");
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
  console.log(`Usage: node prediction-api/sync-upstream-track-record.mjs [options]

Options:
  --force                    Replace prior upstream backfilled snapshots, but never live frozen snapshots.
  --results-url <url>        Override upstream data/wc2026-results.json URL.
  --ratings-url <url>        Override upstream data/elo-calibrated.json URL.
  --local-repo <path>        Local upstream clone fallback path. Defaults to ./world-cup-2026-prediction-model.
  --no-local-fallback        Fail instead of reading the local upstream clone when raw GitHub fetch fails.
  --fetched-at <iso>         Override source retrieval timestamp.
  --generated-at <iso>       Override model-run timestamp.
  --json                     Print machine-readable JSON.

Backfills missing pre-match frozen prediction snapshots from the upstream
GitHub track-record data. It only writes matches that are already completed
locally, have no existing live frozen snapshot, match the upstream result, and
have ratings in the upstream frozen Elo file.
`);
}
