import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const CLI_PATH = fileURLToPath(new URL("./sync-lineups.mjs", import.meta.url));
const STORE_MODULE_URL = pathToFileURL(fileURLToPath(new URL("./store.mjs", import.meta.url))).href;
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

test("lineup CLI dry-run does not mutate the store", () => {
  const dir = mkdtempSync(join(tmpdir(), "world-cup-lineup-cli-"));
  const storePath = join(dir, "store.sqlite");
  const payloadPath = join(dir, "lineups.json");
  writeFileSync(payloadPath, JSON.stringify(buildPayload(), null, 2));

  try {
    const dryRun = runCli(["--path", payloadPath, "--dry-run", "--json"], storePath);
    assert.equal(dryRun.status, 0);
    const dryRunPayload = JSON.parse(dryRun.stdout);
    assert.equal(dryRunPayload.sync.dryRun, true);
    assert.equal(dryRunPayload.sync.importedCount, 1);

    const dryRunStore = readStoreSnapshot(storePath);
    const dryRunMatch = dryRunStore.matches.find((match) => match.id === "mexico-south-africa");
    assert.equal(dryRunMatch.lineups, undefined);

    const sync = runCli(["--path", payloadPath, "--json"], storePath);
    assert.equal(sync.status, 0);
    const syncPayload = JSON.parse(sync.stdout);
    assert.equal(syncPayload.sync.dryRun, false);
    assert.equal(syncPayload.sync.expectedImportedCount, 1);

    const syncedStore = readStoreSnapshot(storePath);
    const syncedMatch = syncedStore.matches.find((match) => match.id === "mexico-south-africa");
    assert.equal(syncedMatch.lineups.expected.home.starters[0].name, "CLI Test Player");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("lineup CLI rejects paid sources", () => {
  const dir = mkdtempSync(join(tmpdir(), "world-cup-lineup-cli-paid-"));
  const storePath = join(dir, "store.sqlite");
  const payloadPath = join(dir, "lineups-paid.json");
  writeFileSync(payloadPath, JSON.stringify({
    ...buildPayload(),
    source: {
      id: "paid-source",
      name: "Paid source",
      retrievedAt: "2026-06-12T10:00:00.000Z",
      access: "paid",
    },
  }, null, 2));

  try {
    const result = runCli(["--path", payloadPath, "--json"], storePath);
    assert.notEqual(result.status, 0);
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.code, "paid_source_not_allowed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function runCli(args, storePath) {
  mkdirSync(dirname(storePath), { recursive: true });
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      PREDICTION_STORE_PATH: storePath,
    },
  });
}

function readStoreSnapshot(storePath) {
  const script = `
    import { getStore, resetStoreCache } from ${JSON.stringify(STORE_MODULE_URL)};
    resetStoreCache();
    console.log(JSON.stringify(getStore()));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      PREDICTION_STORE_PATH: storePath,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function buildPayload() {
  return {
    source: {
      id: "cli-reviewed-lineups",
      name: "CLI reviewed lineups",
      retrievedAt: "2026-06-12T10:00:00.000Z",
      access: "free_reviewed",
    },
    lineups: [
      {
        matchId: "mexico-south-africa",
        expected: {
          reviewedAt: "2026-06-12T10:05:00.000Z",
          home: {
            formation: "4-3-3",
            starters: [{ name: "CLI Test Player", position: "GK", shirtNumber: "1" }],
          },
          away: {
            formation: "4-4-2",
            starters: [],
          },
        },
      },
    ],
  };
}
