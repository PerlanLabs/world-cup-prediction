import { syncOfficialMatchFacts } from "./backend-service.mjs";

const args = process.argv.slice(2);

try {
  const options = parseArgs(args);
  const summary = await syncOfficialMatchFacts(options);
  const payload = { ok: true, sync: summary };
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("Official match facts sync completed.");
    console.log(`Mode: ${summary.selection.mode}`);
    console.log(`Selected: ${summary.selection.selectedCount}`);
    console.log(`Imported: ${summary.importedCount}`);
    console.log(`Skipped: ${summary.skippedCount}`);
  }
} catch (error) {
  const payload = {
    ok: false,
    error: {
      code: error.code ?? "match_facts_sync_failed",
      message: error.message,
    },
  };
  console.error(JSON.stringify(payload, null, 2));
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
      const value = args[index + 1];
      if (!value) throw new Error("--match-id requires a value.");
      options.matchIds = [...(options.matchIds ?? []), value];
      index += 1;
    } else if (arg === "--language") {
      const value = args[index + 1];
      if (!value) throw new Error("--language requires a value.");
      options.language = value;
      index += 1;
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
  console.log(`Usage: node prediction-api/sync-match-facts.mjs [options]

Options:
  --completed              Sync completed matches only. Default.
  --all                    Probe every match with a FIFA IdMatch.
  --match-id <id>          Sync one match id. Can be repeated.
  --language <code>        FIFA API language. Defaults to en.
  --json                   Print machine-readable JSON.
`);
}
