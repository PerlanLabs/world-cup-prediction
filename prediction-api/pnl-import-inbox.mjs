import { DEFAULT_PNL_ROOT } from "./pnl-core.mjs";
import { ensurePnlInbox, importInbox } from "./pnl-inbox.mjs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultRoot = resolve(repoRoot, DEFAULT_PNL_ROOT);
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

try {
  if (args.initOnly) {
    const dirs = ensurePnlInbox(args.root);
    const payload = {
      ok: true,
      initialized: true,
      root: dirs.root,
      inbox: {
        html: dirs.html,
        screenshots: dirs.screenshots,
        manual: dirs.manual,
      },
      processedDir: dirs.processed,
      failedDir: dirs.failed,
    };
    printPayload(payload, args.json);
    process.exit(0);
  }

  const payload = importInbox({
    root: args.root,
    strategyPolicy: args.strategyPolicy,
  });
  printPayload(payload, args.json);
} catch (error) {
  const payload = {
    ok: false,
    error: {
      code: error.code ?? "pnl_import_inbox_failed",
      message: error.message,
    },
  };
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
}

function parseArgs(argv) {
  const parsed = {
    root: defaultRoot,
    strategyPolicy: "hedged",
    initOnly: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      parsed.root = resolve(requireValue(argv, index, arg));
      index += 1;
    } else if (arg === "--strategy-policy") {
      parsed.strategyPolicy = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--init-only") {
      parsed.initOnly = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!["auto", "html", "hedged", "main"].includes(parsed.strategyPolicy)) {
    throw new Error("--strategy-policy must be auto, html, hedged, or main.");
  }
  return parsed;
}

function requireValue(argv, index, arg) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
  return value;
}

function printPayload(payload, json) {
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (payload.initialized) {
    console.log(`P&L inbox initialized: ${payload.root}`);
    console.log(`- HTML inbox: ${payload.inbox.html}`);
    console.log(`- Manual JSON inbox: ${payload.inbox.manual}`);
    console.log(`- Screenshot inbox: ${payload.inbox.screenshots}`);
    return;
  }

  console.log(`P&L inbox import completed. Imported ${payload.importedCount} file(s).`);
  console.log(`Skipped duplicates: ${payload.skippedDuplicateCount}; failed: ${payload.failedCount}.`);
  for (const item of payload.results) {
    if (item.status === "imported") {
      console.log(`- Imported ${item.match}: ${item.selectedStrategy}, ${item.totalStake}u -> ${item.matchDir}`);
    } else if (item.status === "skipped_duplicate") {
      console.log(`- Skipped duplicate ${item.sourceFileName} -> ${item.sourceArchivedPath}`);
    } else {
      console.log(`- Failed ${item.sourceFileName}: ${item.error?.message ?? "unknown error"}`);
    }
  }
}

function printHelp() {
  console.log(`Usage: node prediction-api/pnl-import-inbox.mjs [options]

Options:
  --root <path>                 P&L folder. Defaults to ${defaultRoot}.
  --strategy-policy <mode>      auto, html, hedged, or main. Defaults to hedged.
  --init-only                   Create inbox folders without importing.
  --json                        Print machine-readable JSON.
  --help                        Show this help.
`);
}
