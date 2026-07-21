import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PNL_ROOT } from "./pnl-core.mjs";

const apiDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = dirname(apiDir);
const defaultRoot = resolve(repoRoot, DEFAULT_PNL_ROOT);
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

try {
  const importArgs = [
    join(apiDir, "pnl-import-inbox.mjs"),
    "--root",
    args.root,
    "--strategy-policy",
    args.strategyPolicy,
  ];
  const settleArgs = [
    join(apiDir, "pnl-settle.mjs"),
    "--root",
    args.root,
    "--fixture-mode",
    args.fixtureMode,
    "--facts-mode",
    args.factsMode,
  ];

  if (args.skipSync) settleArgs.push("--skip-sync");
  if (args.language) settleArgs.push("--language", args.language);
  for (const matchId of args.matchIds) settleArgs.push("--match-id", matchId);
  if (args.json) {
    importArgs.push("--json");
    settleArgs.push("--json");
  }

  const imported = runNode(importArgs, args.json);
  const settled = runNode(settleArgs, args.json);

  if (args.json) {
    console.log(JSON.stringify({
      ok: true,
      import: imported,
      settlement: settled,
    }, null, 2));
  }
} catch (error) {
  const payload = {
    ok: false,
    error: {
      code: error.code ?? "pnl_update_failed",
      message: error.message,
    },
  };
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
}

function runNode(childArgs, json) {
  const result = spawnSync(process.execPath, childArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: json ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0) {
    const message = json
      ? [result.stdout, result.stderr].filter(Boolean).join("\n").trim()
      : `Command failed: ${process.execPath} ${childArgs.join(" ")}`;
    throw new Error(message || "P&L update child command failed.");
  }
  if (!json) return null;
  const stdout = result.stdout.trim();
  return stdout ? JSON.parse(stdout) : null;
}

function parseArgs(argv) {
  const parsed = {
    root: defaultRoot,
    strategyPolicy: "hedged",
    matchIds: [],
    fixtureMode: "mapped",
    factsMode: "completed",
    language: undefined,
    skipSync: false,
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
    } else if (arg === "--match-id") {
      parsed.matchIds.push(requireValue(argv, index, arg));
      index += 1;
    } else if (arg === "--fixture-mode") {
      parsed.fixtureMode = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--facts-mode") {
      parsed.factsMode = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--language") {
      parsed.language = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--skip-sync") {
      parsed.skipSync = true;
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
  if (!["mapped", "supported", "predictable"].includes(parsed.fixtureMode)) {
    throw new Error("--fixture-mode must be mapped, supported, or predictable.");
  }
  if (!["completed", "all"].includes(parsed.factsMode)) {
    throw new Error("--facts-mode must be completed or all.");
  }
  return parsed;
}

function requireValue(argv, index, arg) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
  return value;
}

function printHelp() {
  console.log(`Usage: node prediction-api/pnl-update.mjs [options]

Options:
  --root <path>                 P&L folder. Defaults to ${defaultRoot}.
  --strategy-policy <mode>      auto, html, hedged, or main. Defaults to hedged.
  --skip-sync                   Do not fetch FIFA updates before settlement.
  --match-id <id>               Settle one local match id. Can be repeated.
  --fixture-mode <mode>         FIFA fixture import mode. Defaults to mapped.
  --facts-mode <mode>           Match facts sync mode. Defaults to completed.
  --language <code>             FIFA API language. Defaults to en.
  --json                        Print machine-readable JSON.
  --help                        Show this help.
`);
}
