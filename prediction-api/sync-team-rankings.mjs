import { syncFifaTeamRankings } from "./backend-service.mjs";

const args = process.argv.slice(2);

try {
  const options = parseArgs(args);
  const summary = await syncFifaTeamRankings(options);
  const payload = { ok: true, sync: summary };
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("FIFA team ranking sync completed.");
    console.log(`Imported teams: ${summary.importedCount}`);
    console.log(`Missing teams: ${summary.missingCount}`);
    if (summary.lastUpdateDate) console.log(`FIFA updated: ${summary.lastUpdateDate}`);
  }
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: {
      code: error.code ?? "team_ranking_sync_failed",
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
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node prediction-api/sync-team-rankings.mjs [options]

Options:
  --json                   Print machine-readable JSON.
`);
}
