import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { assertValidStore } from "./validation.mjs";

const DEFAULT_JSON_STORE_PATH = fileURLToPath(new URL("./data/backend-store.json", import.meta.url));
const DEFAULT_SQLITE_STORE_PATH = fileURLToPath(new URL("./data/backend-store.sqlite", import.meta.url));
const DEFAULT_SEED_PATH = fileURLToPath(new URL("./data/seed-data.json", import.meta.url));
const STORE_ARRAY_KEYS = ["sources", "teams", "matches", "predictions", "modelRuns"];

let cachedStore = null;
let cachedDriver = null;
let cachedStorePath = null;
let cachedStoreSignature = null;
let cachedDatabase = null;

export function initializeStore() {
  const driver = getStoreDriver();
  const storePath = getStoreFilePath();
  const storeSignature = getStoreSignature(storePath);

  if (
    cachedStore &&
    cachedDriver === driver &&
    cachedStorePath === storePath &&
    cachedStoreSignature === storeSignature
  ) {
    return cachedStore;
  }

  cachedDriver = driver;
  cachedStorePath = storePath;
  cachedStore = driver === "sqlite" ? initializeSqliteStore(storePath) : initializeJsonStore(storePath);
  cachedStoreSignature = getStoreSignature(storePath);
  return cachedStore;
}

export function getStore() {
  return initializeStore();
}

export function saveStore(nextStore) {
  const validStore = assertValidStore(nextStore);
  const driver = getStoreDriver();

  if (driver === "sqlite") {
    writeSqliteStore(getDatabase(getStoreFilePath()), validStore);
  } else {
    writeJson(getStoreFilePath(), validStore);
  }

  cachedDriver = driver;
  cachedStorePath = getStoreFilePath();
  cachedStore = validStore;
  cachedStoreSignature = getStoreSignature(cachedStorePath);
  return validStore;
}

export function mutateStore(mutator) {
  const current = getStore();
  const next = mutator(structuredClone(current)) ?? current;
  return saveStore(next);
}

export function getStoreDriver() {
  const driver = (process.env.PREDICTION_STORE_DRIVER ?? "sqlite").trim().toLowerCase();
  if (driver !== "sqlite" && driver !== "json") {
    throw new Error(`Unsupported PREDICTION_STORE_DRIVER: ${driver}. Use sqlite or json.`);
  }
  return driver;
}

export function getStoreFilePath() {
  const explicitPath = process.env.PREDICTION_STORE_PATH;
  if (explicitPath) return resolve(explicitPath);
  return getStoreDriver() === "sqlite" ? DEFAULT_SQLITE_STORE_PATH : DEFAULT_JSON_STORE_PATH;
}

export function getSeedFilePath() {
  return resolve(process.env.PREDICTION_SEED_PATH ?? DEFAULT_SEED_PATH);
}

export function resetStoreCache() {
  cachedStore = null;
  cachedDriver = null;
  cachedStorePath = null;
  cachedStoreSignature = null;
  if (cachedDatabase) {
    cachedDatabase.close();
    cachedDatabase = null;
  }
}

function getStoreSignature(storePath) {
  try {
    const stat = statSync(storePath);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function initializeJsonStore(storePath) {
  if (!existsSync(storePath)) {
    writeJson(storePath, {
      ...assertValidStore(readJson(getSeedFilePath())),
      initializedAt: new Date().toISOString(),
    });
  }

  return assertValidStore(readJson(storePath));
}

function initializeSqliteStore(storePath) {
  const existed = existsSync(storePath);
  const db = getDatabase(storePath);
  ensureSchema(db);

  if (!existed || isSqliteStoreEmpty(db)) {
    writeSqliteStore(db, getInitialSqliteStore());
  }

  return readSqliteStore(db);
}

function getInitialSqliteStore() {
  const shouldImportLegacyJson =
    !process.env.PREDICTION_STORE_PATH &&
    !process.env.PREDICTION_SEED_PATH &&
    existsSync(DEFAULT_JSON_STORE_PATH);

  const initialPath = shouldImportLegacyJson ? DEFAULT_JSON_STORE_PATH : getSeedFilePath();
  return assertValidStore({
    ...readJson(initialPath),
    initializedAt: new Date().toISOString(),
    migratedFrom: shouldImportLegacyJson ? "json-file" : undefined,
  });
}

function getDatabase(storePath) {
  if (cachedDatabase && cachedStorePath === storePath && cachedDriver === "sqlite") {
    return cachedDatabase;
  }

  if (cachedDatabase) {
    cachedDatabase.close();
  }

  mkdirSync(dirname(storePath), { recursive: true });
  cachedDatabase = new DatabaseSync(storePath);
  cachedDatabase.exec("PRAGMA foreign_keys = ON");
  return cachedDatabase;
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      kickoff_sort TEXT NOT NULL,
      home_team_id TEXT NOT NULL,
      away_team_id TEXT NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS predictions (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_runs (
      id TEXT PRIMARY KEY,
      generated_at TEXT NOT NULL,
      data TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_matches_date ON matches(date, kickoff_sort);
    CREATE INDEX IF NOT EXISTS idx_predictions_match_generated ON predictions(match_id, generated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_predictions_run ON predictions(run_id);
    CREATE INDEX IF NOT EXISTS idx_model_runs_generated ON model_runs(generated_at DESC);
  `);
}

function isSqliteStoreEmpty(db) {
  return db.prepare("SELECT COUNT(*) AS count FROM teams").get().count === 0;
}

function readSqliteStore(db) {
  const rootRow = db.prepare("SELECT value FROM metadata WHERE key = ?").get("root");
  const root = rootRow ? JSON.parse(rootRow.value) : {};

  return assertValidStore({
    ...root,
    sources: readJsonRows(db, "sources", "id"),
    teams: readJsonRows(db, "teams", "id"),
    matches: readJsonRows(db, "matches", "date, kickoff_sort, id"),
    predictions: readJsonRows(db, "predictions", "generated_at, id"),
    modelRuns: readJsonRows(db, "model_runs", "generated_at, id"),
  });
}

function writeSqliteStore(db, store) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      DELETE FROM predictions;
      DELETE FROM model_runs;
      DELETE FROM matches;
      DELETE FROM teams;
      DELETE FROM sources;
      DELETE FROM metadata;
    `);

    const root = Object.fromEntries(Object.entries(store).filter(([key]) => !STORE_ARRAY_KEYS.includes(key)));
    db.prepare("INSERT INTO metadata (key, value) VALUES (?, ?)").run("root", JSON.stringify(root));

    for (const source of store.sources) {
      db.prepare("INSERT INTO sources (id, data) VALUES (?, ?)").run(source.id, JSON.stringify(source));
    }

    for (const team of store.teams) {
      db.prepare("INSERT INTO teams (id, slug, name, data) VALUES (?, ?, ?, ?)").run(
        team.id,
        team.slug,
        team.name,
        JSON.stringify(team),
      );
    }

    for (const match of store.matches) {
      db.prepare(
        "INSERT INTO matches (id, date, kickoff_sort, home_team_id, away_team_id, data) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(match.id, match.date, match.kickoffSort, match.homeTeamId, match.awayTeamId, JSON.stringify(match));
    }

    for (const prediction of store.predictions) {
      db.prepare("INSERT INTO predictions (id, match_id, run_id, generated_at, data) VALUES (?, ?, ?, ?, ?)").run(
        prediction.id,
        prediction.matchId,
        prediction.runId,
        prediction.generatedAt,
        JSON.stringify(prediction),
      );
    }

    for (const run of store.modelRuns) {
      db.prepare("INSERT INTO model_runs (id, generated_at, data) VALUES (?, ?, ?)").run(
        run.id,
        run.generatedAt,
        JSON.stringify(run),
      );
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function readJsonRows(db, table, orderBy) {
  return db.prepare(`SELECT data FROM ${table} ORDER BY ${orderBy}`).all().map((row) => JSON.parse(row.data));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, path);
}
