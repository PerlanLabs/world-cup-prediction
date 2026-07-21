import { getStore } from "./store.mjs";
import {
  buildManualQatarAdvice,
  enrichAdviceWithSchedule,
  importAdvice,
  parseAdviceHtmlFile,
  writeAggregateReports,
} from "./pnl-core.mjs";

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

try {
  const imported = [];
  const store = getStore();
  for (const htmlPath of args.htmlFiles) {
    const advice = enrichAdviceWithSchedule(parseAdviceHtmlFile(htmlPath), store.matches);
    imported.push(importAdvice(advice, {
      root: args.root,
      strategyPolicy: args.strategyPolicy,
    }));
  }

  if (args.manualQatar) {
    const advice = enrichAdviceWithSchedule(buildManualQatarAdvice(args.qatarEvidence), store.matches);
    imported.push(importAdvice(advice, {
      root: args.root,
      strategyPolicy: args.strategyPolicy,
    }));
  }

  const aggregate = writeAggregateReports(args.root);
  const payload = {
    ok: true,
    importedCount: imported.length,
    imported: imported.map((item) => ({
      matchId: item.accepted.match.id,
      match: item.accepted.match.displayName,
      selectedStrategy: item.accepted.selectedStrategy,
      totalStake: item.accepted.totalStake,
      matchDir: item.matchDir,
    })),
    aggregate,
  };

  if (args.json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`P&L import completed. Imported ${payload.importedCount} advice file(s).`);
    for (const item of payload.imported) {
      console.log(`- ${item.match}: ${item.selectedStrategy}, ${item.totalStake}u -> ${item.matchDir}`);
    }
  }
} catch (error) {
  const payload = {
    ok: false,
    error: {
      code: error.code ?? "pnl_import_failed",
      message: error.message,
    },
  };
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
}

function parseArgs(argv) {
  const parsed = {
    root: "盈亏分析",
    htmlFiles: [],
    qatarEvidence: [],
    manualQatar: false,
    strategyPolicy: "auto",
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      parsed.root = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--html") {
      parsed.htmlFiles.push(requireValue(argv, index, arg));
      index += 1;
    } else if (arg === "--manual-qatar") {
      parsed.manualQatar = true;
    } else if (arg === "--qatar-evidence") {
      parsed.qatarEvidence.push(requireValue(argv, index, arg));
      index += 1;
    } else if (arg === "--strategy-policy") {
      parsed.strategyPolicy = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      parsed.htmlFiles.push(arg);
    }
  }

  if (!["auto", "html", "hedged", "main"].includes(parsed.strategyPolicy)) {
    throw new Error("--strategy-policy must be auto, html, hedged, or main.");
  }
  if (parsed.htmlFiles.length === 0 && !parsed.manualQatar) {
    throw new Error("Provide at least one HTML file or --manual-qatar.");
  }
  return parsed;
}

function requireValue(argv, index, arg) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
  return value;
}

function printHelp() {
  console.log(`Usage: node prediction-api/pnl-import.mjs [options] [html files...]

Options:
  --html <path>                 Import one HTML advice card. Can be repeated.
  --manual-qatar                Import the manually recorded Qatar vs Switzerland screenshot advice.
  --qatar-evidence <path>       Copy a Qatar screenshot evidence file. Can be repeated.
  --strategy-policy <mode>      auto, html, hedged, or main. Use hedged for this batch's default.
  --root <path>                 Output folder. Defaults to 盈亏分析.
  --json                        Print machine-readable JSON.
  --help                        Show this help.
`);
}
