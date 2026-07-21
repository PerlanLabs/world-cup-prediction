#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`dev-live: ${error.message}`);
  process.exit(1);
}

if (args.help) {
  printHelp();
  process.exit(0);
}

const children = new Set();
let stopping = false;

const services = [
  {
    name: "api",
    command: process.execPath,
    args: ["prediction-api/server.mjs"],
  },
  {
    name: "web",
    command: npmCommand,
    args: ["--prefix", "world-cup-command-center", "run", "dev"],
  },
];

if (args.watch) {
  services.push({
    name: "sync",
    command: process.execPath,
    args: ["prediction-api/watch-match-updates.mjs", "--interval-ms", String(args.intervalMs)],
  });
}

console.log("Starting local live development services...");
console.log(`- api:  http://127.0.0.1:8787`);
console.log(`- web:  Vite dev server from world-cup-command-center/`);
console.log(args.watch
  ? `- sync: official fixture/result + facts + current Elo refresh every ${args.intervalMs} ms`
  : "- sync: disabled by --no-watch");
console.log("");

for (const service of services) {
  startService(service);
}

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

function startService(service) {
  const child = spawn(service.command, service.args, {
    cwd: repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  children.add(child);
  prefixStream(child.stdout, service.name, process.stdout);
  prefixStream(child.stderr, service.name, process.stderr);

  child.on("exit", (code, signal) => {
    children.delete(child);
    if (stopping) return;

    const reason = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`[dev-live] ${service.name} exited with ${reason}. Stopping the other services.`);
    stopAll(typeof code === "number" && code !== 0 ? code : 1);
  });

  child.on("error", (error) => {
    if (stopping) return;
    console.error(`[dev-live] failed to start ${service.name}: ${error.message}`);
    stopAll(1);
  });
}

function prefixStream(stream, name, writer) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > 0) writer.write(`[${name}] ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (buffer.length > 0) writer.write(`[${name}] ${buffer}\n`);
  });
}

function stopAll(exitCode) {
  if (stopping) return;
  stopping = true;

  for (const child of children) {
    killProcessTree(child);
  }

  setTimeout(() => {
    process.exit(exitCode);
  }, 1000);
}

function killProcessTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  child.kill("SIGTERM");
}

function parseArgs(argv) {
  const parsed = {
    help: false,
    intervalMs: 5 * 60 * 1000,
    watch: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else if (arg === "--no-watch") {
      parsed.watch = false;
    } else if (arg === "--interval-ms" || arg === "--watch-interval-ms") {
      parsed.intervalMs = parsePositiveNumber(requireValue(argv, index, arg), arg);
      index += 1;
    } else {
      const error = new Error(`Unknown argument: ${arg}`);
      error.code = "unknown_argument";
      throw error;
    }
  }

  return parsed;
}

function requireValue(argv, index, arg) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    const error = new Error(`${arg} requires a value.`);
    error.code = "missing_argument_value";
    throw error;
  }
  return value;
}

function parsePositiveNumber(value, arg) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    const error = new Error(`${arg} must be a positive number.`);
    error.code = "bad_request";
    throw error;
  }
  return number;
}

function printHelp() {
  console.log(`Usage: npm run dev:live -- [options]

Starts the local API, Vite frontend, and the official match-update watcher.
The watcher refreshes FIFA fixtures/results, completed-match facts, current
Elo ratings, and pending-match prediction snapshots.

Options:
  --interval-ms <number>       Watcher polling interval. Defaults to 300000.
  --watch-interval-ms <number> Alias for --interval-ms.
  --no-watch                   Start only API + Vite, without local sync.
  --help                       Show this help.
`);
}
