import { refreshModelRatings } from "./backend-service.mjs";

try {
  const options = parseArgs(process.argv.slice(2));
  const refresh = refreshModelRatings(options);
  const payload = { ok: true, refresh };
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("Model ratings refresh completed.");
    console.log(`Official results exported: ${refresh.officialResults.matchCount}`);
    console.log(`Current ratings changed: ${refresh.calibration.changed}`);
    console.log(`Prediction snapshots generated: ${refresh.predictionRun?.matchCount ?? 0}`);
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: {
      code: error.code ?? "model_ratings_refresh_failed",
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
    } else if (arg === "--official-results-path") {
      options.officialResultsPath = requiredValue(args, ++index, "--official-results-path");
    } else if (arg === "--current-ratings-path") {
      options.currentRatingsPath = requiredValue(args, ++index, "--current-ratings-path");
    } else if (arg === "--prediction-mode") {
      options.predictionMode = requiredValue(args, ++index, "--prediction-mode");
    } else if (arg === "--all") {
      options.all = true;
      options.predictionMode = "all";
    } else if (arg === "--refresh") {
      options.refresh = true;
    } else if (arg === "--refresh-predictions") {
      options.refreshPredictions = true;
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
  console.log(`Usage: node prediction-api/sync-model-ratings.mjs [options]

Options:
  --match-id <id>                  Limit refreshed predictions to one match. Repeatable.
  --prediction-mode <pending|all>  Re-run pending future matches by default; use all for all predictable matches.
  --all                            Shortcut for --prediction-mode all.
  --official-results-path <path>   Write generated FIFA results to a custom path.
  --current-ratings-path <path>    Write current Elo ratings to a custom path.
  --refresh                        Recompute current ratings even if inputs have not changed.
  --refresh-predictions            Re-run predictions even when ratings input hash is unchanged.
  --json                           Print machine-readable JSON.

Exports completed FIFA results, applies them incrementally to the frozen base
Elo ratings, and appends new prediction snapshots while preserving previous
prediction history.
`);
}
