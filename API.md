# API

## Current Scope

Phase 2B now exposes a local backend for the command-center UI. It wraps the cloned `Hicruben/world-cup-2026-prediction-model`, stores prediction snapshots in a local SQLite store, and returns schedule records with their latest model output and computed recent-form summaries.

The current backend is still a local development service, not the production data platform. SQLite gives us durable local persistence and queryable tables while we validate the product contract before choosing the final cloud database, auth, background jobs, and deployment shape.

## Local Commands

Run from the repository root:

```bash
npm run build
HOST=127.0.0.1 PORT=8787 npm start
```

Or run the backend file directly:

```bash
node prediction-api/server.mjs
```

Default URL:

```text
http://127.0.0.1:8787
```

The React app uses Vite proxy routes and reads from `/api/matches?include=prediction`.
In production, the same Node server serves the built React app from `world-cup-command-center/dist` and keeps `/api/*` for backend routes.

Run from `world-cup-command-center/` to validate or import a reviewed local lineup file:

```bash
npm run sync:lineups -- --path ../prediction-api/data/lineups.local.json --dry-run
npm run sync:lineups -- --path ../prediction-api/data/lineups.local.json
```

Run from `world-cup-command-center/` to inspect or run official FIFA lineup sync:

```bash
npm run watch:official-lineups -- --dry-run
npm run watch:official-lineups -- --once
```

Run from `world-cup-command-center/` to import public expected lineups:

```bash
npm run sync:expected-lineups -- --json
```

Run from `world-cup-command-center/` to import FIFA public match events/facts for completed mapped matches:

```bash
npm run sync:match-facts -- --json
```

Run from `world-cup-command-center/` to refresh official FIFA fixtures/results, import completed-match facts, refresh current Elo ratings, append pending-match prediction snapshots, and freeze due pre-match prediction snapshots in one cycle, or keep it polling locally:

```bash
npm run sync:local
npm run watch:match-updates -- --once --json
npm run watch:match-updates
```

For local live development, `npm run dev:live` starts the API, Vite dev server, and the same watcher together. The watcher writes the local SQLite store plus generated model files under `prediction-api/data/`, freezes due pre-match prediction snapshots, and a long-running API process reloads the updated store and current Elo file on demand.

Run from `world-cup-command-center/` or the repository root to backfill missing pre-match frozen snapshots for already-completed matches that happened before the local freeze job existed:

```bash
npm run sync:upstream-track-record -- --json
```

This reads the upstream GitHub `data/wc2026-results.json` and frozen tournament `data/elo-calibrated.json`, verifies that the local final score matches the upstream result, and writes only missing `audit.freezeType=pre_match_final` snapshots. It does not overwrite live frozen snapshots unless the existing snapshot was previously created by the same upstream backfill path and `--force` is passed.
If the GitHub raw fetch fails, the command falls back to the local `world-cup-2026-prediction-model` clone, preferring `origin/main` blobs when the `.git` directory is available and then the working-tree files.

Run from `world-cup-command-center/` to refresh only the model data path from already-synced official results:

```bash
npm run refresh:model -- --json
```

Run from the repository root for a quick CLI prediction using the same current Elo preference as the backend:

```bash
npm run predict:match -- australia turkiye neutral
```

The CLI prints `ratings source: current` when it reads `prediction-api/data/elo-calibrated.current.json`; it prints `base` only when the generated current Elo file is unavailable.

For pre-match betting-analysis cards, use the Cup26 frozen baseline command instead:

```bash
npm run predict:match:base -- australia turkiye neutral
```

This keeps match advice aligned with the upstream Cup26 live-tournament policy: completed World Cup results update tournament state and track-record review, but they do not recalibrate team Elo for future single-match probabilities. Use the rolling command only as a sensitivity/reference check:

```bash
npm run predict:match:current -- australia turkiye neutral
```

Run from `world-cup-command-center/` to import FIFA public men's live world ranking into team display profiles:

```bash
npm run sync:team-rankings -- --json
```

Run from `world-cup-command-center/` to dry-run API-Football coverage after setting a free API key:

```bash
npm run probe:api-football -- --fixture-id <api-football-fixture-id> --json
```

Run from `world-cup-command-center/` to map local matches to API-Football fixture IDs and then import technical statistics:

```bash
npm run sync:api-football -- --completed --json
npm run sync:api-football-fixtures -- --json
npm run sync:api-football-match-stats -- --completed --json
```

Run from `world-cup-command-center/` to probe or import read-only Polymarket market-implied World Cup probabilities:

```bash
npm run probe:polymarket -- --json
npm run sync:polymarket-markets -- --json
```

Run from `world-cup-command-center/` to fetch read-only Polymarket single-match moneyline and More Markets derivative markets locally, or import a locally generated snapshot on a server that cannot reach Polymarket:

```bash
npm run sync:polymarket-match-markets -- --match-id brazil-morocco --output ../prediction-api/data/polymarket-match-markets.local.json --json
npm run import:polymarket-match-markets -- --path ../prediction-api/data/polymarket-match-markets.local.json --json
```

Run from the repository root, or from `world-cup-command-center/`, to enrich a betting-analysis snapshot with live read-only CLOB order-book execution quotes. This is the Codex-facing Polymarket radar: it never connects a wallet, signs orders, or places trades.

```bash
npm run polymarket:radar -- --home usa --away bosnia-and-herzegovina --event-slug fifwc-usa-bih-2026-07-01 --types moneyline,spread,total,btts --stake 100 --output _tmp_polymarket/usa-bosnia-radar.json
npm run polymarket:radar -- --snapshot-file _tmp_polymarket/usa-bosnia-20260702-data.json --types moneyline --stake 100 --markdown
```

Add `DEEPSEEK_API_KEY` in the shell environment and pass `--with-ai` when generating the local snapshot to attach DeepSeek narrative explanations. The key must not be written to source files, command examples, or logs.

Run from `world-cup-command-center/` to backfill DeepSeek AI explanations from stored model predictions and already-imported Polymarket match-market snapshots:

```bash
npm run sync:ai-analyses -- --limit 8 --json
npm run sync:ai-analyses -- --match-id brazil-morocco --refresh --json
npm run sync:ai-analyses -- --model-only --missing-market-only --json
```

This path does not fetch Polymarket. It is useful on a deployment server that already has market snapshots in the store but cannot reach Polymarket directly.
Use `--model-only --missing-market-only` to generate right-side AI explanations for matches without stored Polymarket single-match markets.

Useful environment variables:

- `HOST`: optional bind host. Defaults to `127.0.0.1`; any non-loopback value requires a strong `ADMIN_TOKEN`.
- `ADMIN_TOKEN`: required for non-loopback binding and protects `/api/admin/*`. Must contain at least 24 characters.
- `CORS_ORIGIN`: optional single exact browser origin. Cross-origin access is disabled by default; `*` is rejected.
- `MAX_JSON_BODY_BYTES`: optional JSON request limit. Defaults to 10 MiB.
- `PREDICTION_STORE_DRIVER`: optional. Defaults to `sqlite`. Set to `json` only for fallback/debug work.
- `PREDICTION_STORE_PATH`: optional path for the writable SQLite or JSON store. Tests use this to avoid touching local development data.
- `PREDICTION_SEED_PATH`: optional path for the seed JSON file.
- `PREDICTION_MODEL_RESULTS_PATH`: optional path for generated FIFA official results used by model refresh. Defaults to `official-results.generated.json` beside `PREDICTION_STORE_PATH`.
- `PREDICTION_CURRENT_RATINGS_PATH`: optional path for generated current Elo ratings. Defaults to `elo-calibrated.current.json` beside `PREDICTION_STORE_PATH`; the model reads this file before falling back to the bundled baseline ratings.
- `PREDICTION_LINEUP_SOURCE_PATH`: optional local JSON file used by `POST /api/admin/sync-lineups` when no inline payload is provided.
- `API_FOOTBALL_KEY`: optional but required for API-Football probe/sync commands. Used for supplemental fixture IDs and technical statistics; FIFA remains the primary fixture/result/event source.
- `DEEPSEEK_API_KEY`: optional but required for `sync:ai-analyses` or Polymarket snapshot generation with `--with-ai`. The key must remain in the environment and must not be committed, printed, or embedded in scripts.

## Runtime Data

- Seed data: `prediction-api/data/seed-data.json`
- Lineup template: `prediction-api/data/lineups.example.json`
- Local reviewed lineup file: `prediction-api/data/lineups.local.json`
- Default local writable store: `prediction-api/data/backend-store.sqlite`
- Legacy JSON store: `prediction-api/data/backend-store.json`
- Generated official model results: `prediction-api/data/official-results.generated.json`, or `/data/official-results.generated.json` in Docker/VPS deployment.
- Generated current Elo ratings: `prediction-api/data/elo-calibrated.current.json`, or `/data/elo-calibrated.current.json` in Docker/VPS deployment.
- Writable stores are ignored by Git. On first SQLite startup, the backend imports the legacy JSON store when present; otherwise it initializes from seed data.
- The store layer reloads SQLite/JSON data when the writable store file changes, so a long-running API process can observe updates written by local sync commands and watchers.
- `lineups.local.json` is ignored by Git so local review notes and player availability data do not get committed accidentally.
- Teams can include `profile.worldRanking` after FIFA live world ranking sync. This is display context only and does not change prediction snapshots.
- Team market value is not provided by FIFA in the current official APIs. The UI marks it as pending unless an approved free source is added later.
- Teams can include `profile.marketSignals.polymarket.worldCupWinner` after Polymarket read-only sync. This is market-implied probability context only; it is not official odds, not betting advice, and not a model input.
- Matches can include `marketOdds.polymarket` after Polymarket single-match market sync or snapshot import. Current short-term coverage reads win/draw/loss markets plus same-event `*-more-markets` derivatives such as spreads, totals, BTTS, and team totals when Polymarket exposes them. These prices are external market context, not official odds, betting advice, or model inputs.
- Public wallet-address snapshots can be read on demand through `/api/polymarket/account`. This is a user-supplied address lookup against public Polymarket data; it does not connect a wallet, request signatures, store private keys, place orders, or withdraw funds.
- Completed matches can include `matchFacts` after FIFA live-football sync. Current coverage includes official score, goals, cards, substitutions, weather when present, and a coverage note for unsupported statistics such as shots, shots on target, corners, fouls, offsides, and pass success.
- Matches can include `externalIds.apiFootball` after API-Football fixture ID sync. API-Football technical statistics are stored under `matchFacts.statistics` with `matchFacts.statisticsSource` and do not replace FIFA official score/events.
- Predictions can include `audit.freezeType=pre_match_final` after the freeze job runs. These immutable pre-match snapshots are the only snapshots used for model track-record scoring; post-match refreshed predictions remain in history but are excluded from hit-rate calculations.
- Backfilled pre-match snapshots created from upstream GitHub track-record data include `audit.backfilled=true`, `audit.backfillSource=upstream-github-track-record`, and model metadata pointing at upstream frozen tournament ratings. These are for repairing historical track-record gaps only; normal future matches should be frozen by the local watcher before kickoff.

## Endpoints

### `GET /api/health`

Returns service health and model metadata.

### `GET /api/teams`

Returns product teams plus the calibrated model team slugs.

### `GET /api/sources`

Returns the current source records used by the local seed data.

After official fixture sync, this includes `fifa-api-world-cup-2026-calendar` with `lastSync` counts and fetch time.
After Polymarket sync, this includes `polymarket-world-cup-markets` with read-only compliance flags and imported/skipped market counts.
After upstream track-record backfill, this includes `upstream-github-track-record` with upstream result/rating hashes and imported/skipped counts.

### `GET /api/polymarket/account`

Returns a read-only public wallet snapshot for a user-supplied EVM address. The backend fetches public Polymarket positions, closed positions, activity, trades, and portfolio value, then matches open position token IDs against locally stored World Cup `marketOdds.polymarket` token IDs.

This endpoint is intentionally not an authenticated wallet integration. It does not accept private keys, does not ask the wallet to sign, and does not call order, trading, withdrawal, or authenticated account APIs.

Query parameters:

- `address`: required EVM wallet address, for example `0x1111111111111111111111111111111111111111`.
- `limit`: optional public API row limit. Defaults to `50`.
- `scenarioMaxGoals`: optional max score-grid goals for settlement scenarios. Defaults to `6`.

Example:

```text
GET /api/polymarket/account?address=0x1111111111111111111111111111111111111111
```

Response shape:

```json
{
  "account": {
    "source": {
      "id": "polymarket-public-wallet-monitor",
      "readOnly": true,
      "tradingEnabled": false
    },
    "permissions": {
      "readOnly": true,
      "requiresPrivateKey": false,
      "requiresWalletSignature": false,
      "canTrade": false,
      "canWithdraw": false
    },
    "totals": {
      "openPositionCount": 6,
      "matchedWorldCupPositionCount": 4,
      "openCurrentValue": 128.09,
      "worldCupPnl": 12.34
    },
    "worldCup": {
      "groups": [
        {
          "match": { "id": "germany-curacao" },
          "positions": [],
          "bestScenarios": [],
          "worstScenarios": []
        }
      ]
    }
  }
}
```

### `GET /api/polymarket/movement/events`

Lists the newest cached Polymarket pre-match movement snapshot per event. Each row includes the event slug, kickoff, schema version, quality readiness, discovered-market count, tracked-history count, and available-history count.

### `GET /api/polymarket/movement/events/:eventSlug`

Returns the full cached `polymarket-movement/v3` dataset. `marketInventory` preserves every market discovered by PaperTrader, while `rows` contains the explicitly selected history scope. `dataQuality` reports uniqueness, token integrity, lifecycle-opening coverage, history coverage, kickoff leakage, stale/sparse histories, initialization anomalies, and analysis readiness. `marketStructure` reconstructs fixed-contract margin, total-goal, and team-goal probability curves and records cross-market signals with their shared comparison window.

Use `?view=assistant` for the compact Codex-facing contract containing quality checks, category coverage, top movers, normalized movement rows, and `marketStructure` without the full market inventory.

### `GET /api/polymarket/movement/events/:eventSlug/structure`

Returns only the `polymarket-market-structure/v1` analysis plus source metadata. It treats every Polymarket line as a fixed contract whose price moves over time; it does not infer a sportsbook-style main line. The response includes stage snapshots, normalized result probabilities, derived margin/goal distributions, key-contract timelines, shared-window cross-market signals, and structure-specific quality warnings.

Opening-to-close distribution comparisons are marked unavailable when either curve needs a material consistency correction. Individual later-window signals may remain usable when their own fixed-contract histories and shared anchors pass the quality checks. Every signal separates observed fact, evidence-backed interpretation, possible mechanism, and claims unsupported by price history.

### `GET /api/polymarket/backtest`

Returns the latest frozen `polymarket-signal-backtest/v1` report generated from completed official matches, pre-kickoff Polymarket lifecycle snapshots, and frozen baseline-model expected goals. The response includes:

- collected, quality-eligible, blocked, and signal-bearing match counts;
- first-trigger-per-match/market CLV, fixed-cost simulated ROI, model EV, and maximum drawdown;
- metrics grouped by signal code and historical decision window;
- lenient, baseline, and strict threshold sensitivity without treating same-sample tuning as validation;
- event slug, official 90-minute score, quality status, signal count, and frozen-model audit metadata for every included match.

Generate or refresh the report from the repository root:

```powershell
npm run polymarket:backtest -- --collect --limit 20
npm run polymarket:backtest -- --no-collect --limit 20
```

`--collect` fetches missing full-lifecycle snapshots and caches them under `prediction-api/data/polymarket-movement/`. `--no-collect` recalculates the report from cached snapshots only. The batch validates both teams and kickoff before accepting a discovered event. It uses only pre-kickoff prices, keeps globally blocked matches in the audit section, and evaluates later windows independently when warnings affect only the opening anchor.

The current simulation intentionally uses a fixed 3% sports-fee assumption; dynamic fee schedules are out of scope. Synthetic events such as an exact two-goal winning margin or exactly three total goals receive hit-rate/model-edge metrics only and are not assigned executable ROI. A positive exploratory ROI is not proof of a betting edge; the report status remains a review state when CLV/ROI conflict with frozen-model EV or when no independent holdout sample has been run.

### `POST /api/admin/polymarket/movement/refresh`

Discovers the exact event through the local PaperTrader, fetches read-only CLOB price history, applies the kickoff cutoff, runs quality checks, and writes a reusable cache under `prediction-api/data/polymarket-movement/`.

```json
{
  "eventSlug": "fifwc-fra-mar-2026-07-09",
  "historyMode": "lifecycle",
  "fidelity": 15,
  "allCategories": false,
  "limit": 120
}
```

This endpoint is read-only against Polymarket. It does not connect a wallet, sign, trade, or withdraw. The default `lifecycle` mode requests `interval=max`, keeps the earliest available price through the pre-kickoff cutoff, and records whether that first observation is close to known market-creation metadata. Pass `historyMode: "window"` with `lookbackDays` only for an intentionally bounded replay. A default refresh tracks directly modelable match markets and keeps every other discovered category in the inventory with an explicit exclusion reason.

### `GET /api/matches`

Query parameters:

- `date`: optional exact date filter, for example `2026-06-11`.
- `from`: optional lower date bound.
- `to`: optional upper date bound.
- `status`: optional match status filter.
- `include`: optional. Use `prediction` to include `latestPrediction`. Defaults to `prediction`.

Example:

```text
GET /api/matches?include=prediction
```

Response shape:

```json
{
  "matches": [
    {
      "id": "mexico-south-africa",
      "date": "2026-06-11",
      "dateLabel": "6月11日",
      "homeTeamId": "mexico",
      "awayTeamId": "south-africa",
      "homeTeam": {
        "id": "mexico",
        "name": "墨西哥",
        "flagCode": "mx",
        "profile": {
          "worldRanking": {
            "sourceId": "fifa-live-world-ranking",
            "rank": 14,
            "previousRank": 15,
            "points": 1665.2,
            "lastUpdateDate": "2026-06-11T10:00:59.636Z"
          },
          "marketValue": {
            "status": "unavailable",
            "reason": "fifa_no_official_market_value"
          }
        }
      },
      "awayTeam": { "id": "south-africa", "name": "南非", "flagCode": "za" },
      "modelHome": "mexico",
      "modelAway": "south-africa",
      "modelVenue": "home",
      "recentForm": {
        "home": {
          "label": "近5场 3胜2平0负",
          "goalsFor": 8,
          "goalsAgainst": 1,
          "metrics": { "attack": 75, "defense": 98, "stability": 80 }
        },
        "away": {
          "label": "近5场 1胜1平3负",
          "goalsFor": 6,
          "goalsAgainst": 8,
          "metrics": { "attack": 69, "defense": 53, "stability": 57 }
        },
        "matchup": {
          "basis": "recent_form",
          "metrics": { "attack": 72, "defense": 75, "stability": 69 }
        }
      },
      "lineupIntel": {
        "policy": "official_and_expected_only",
        "appliesToModel": false,
        "displayMode": "pending",
        "official": {
          "label": "官方首发",
          "sourceType": "official",
          "status": "not_released",
          "home": { "formation": null, "starters": [], "substitutes": [], "unavailable": [] },
          "away": { "formation": null, "starters": [], "substitutes": [], "unavailable": [] }
        },
        "expected": {
          "label": "预计首发",
          "sourceType": "expected",
          "status": "not_ready",
          "home": { "formation": null, "starters": [], "substitutes": [], "unavailable": [] },
          "away": { "formation": null, "starters": [], "substitutes": [], "unavailable": [] }
        }
      },
      "matchFacts": {
        "status": "partial",
        "sourceId": "fifa-api-live-football-match-facts",
        "sourceUrl": "https://api.fifa.com/api/v3/live/football/400021443?language=en",
        "retrievedAt": "2026-06-12T04:41:00.000Z",
        "coverage": {
          "events": true,
          "statistics": false,
          "weather": false,
          "unsupportedStatistics": ["shots", "shotsOnTarget", "corners", "fouls", "offsides", "passSuccess"]
        },
        "score": { "home": 2, "away": 0 },
        "statistics": {
          "possession": { "home": 62, "away": 38 },
          "totalShots": { "home": 15, "away": 7 },
          "shotsOnTarget": { "home": 6, "away": 4 },
          "corners": { "home": 4, "away": 5 },
          "fouls": { "home": 9, "away": 16 },
          "offsides": { "home": 2, "away": 2 },
          "passAccuracy": { "home": 86, "away": 70 }
        },
        "statisticsSource": {
          "sourceId": "api-football-fixture-statistics",
          "sourceUrl": "https://v3.football.api-sports.io/fixtures/statistics?fixture=1538999",
          "retrievedAt": "2026-06-12T12:05:00.000Z",
          "fixtureId": "1538999"
        },
        "events": [
          {
            "type": "goal",
            "side": "home",
            "minute": 9,
            "playerName": "Julian QUINONES"
          }
        ]
      },
      "latestPrediction": {
        "matchId": "mexico-south-africa",
        "probabilityPercent": { "homeWin": 73.6, "draw": 19.1, "awayWin": 7.4 },
        "expectedGoals": { "home": 2.21, "away": 0.59 }
      }
    }
  ]
}
```

### `GET /api/matches/:id`

Returns one enriched match with `latestPrediction`.

`lineupIntel` is always returned for enriched matches. It separates official confirmed lineups from expected lineups and marks `appliesToModel=false` until lineup variables are explicitly backtested and approved as model inputs.

`matchFacts` is returned when official FIFA live-football facts have been synced for the match. It is source-backed display context only and does not change historical prediction snapshots.

When API-Football statistics have also been synced, `matchFacts.statistics` may include `possession`, `totalShots`, `shotsOnTarget`, `corners`, `fouls`, `offsides`, `passAccuracy`, `passes`, cards, and related technical-stat fields. These are supplemental user-facing statistics only; they are not model inputs until separately backtested.

### `GET /api/matches/:id/prediction/latest`

Returns the latest prediction snapshot for a match.

### `GET /api/matches/:id/predictions/history`

Returns prediction snapshots for a match, newest first.

### `GET /api/model-track-record`

Returns the model track record computed from pre-match frozen prediction snapshots only. Completed matches without a frozen snapshot are reported as missing and are not counted as scored rows.

Optional query parameters:

- `limit`: maximum number of rows to return. Defaults to `200`.

Example response:

```json
{
  "trackRecord": {
    "policy": {
      "freezeType": "pre_match_final",
      "defaultLockBeforeMinutes": 60
    },
    "summary": {
      "frozenCount": 24,
      "scoredCount": 18,
      "missingFreezeCompletedCount": 0,
      "accuracy": 0.5556,
      "averageRps": 0.1821
    },
    "rows": [
      {
        "matchId": "mexico-south-africa",
        "status": "scored",
        "finalScore": { "home": 2, "away": 0, "line": "2-0" },
        "score": {
          "pickedCorrect": true,
          "actualProbability": 0.736,
          "rps": 0.0742,
          "brier": 0.1013
        }
      }
    ]
  }
}
```

### `POST /api/admin/run-predictions`

Runs the baseline model and appends new prediction snapshots.

Body:

```json
{
  "matchIds": ["mexico-south-africa"]
}
```

If `matchIds` is omitted, all seeded matches are predicted.

### `POST /api/admin/refresh-model-ratings`

Exports completed FIFA official results into the generated model-results file, recalibrates current Elo ratings, resets the model cache, and appends new prediction snapshots while preserving previous prediction history.

By default, refreshed predictions are generated only for predictable matches without a final score. Use `predictionMode: "all"` only for explicit full reruns.

Body:

```json
{
  "matchIds": ["canada-bosnia"],
  "predictionMode": "pending",
  "refresh": false,
  "refreshPredictions": false
}
```

Example response:

```json
{
  "refresh": {
    "sourceId": "model-rating-refresh",
    "officialResults": {
      "path": "/data/official-results.generated.json",
      "matchCount": 9
    },
    "calibration": {
      "path": "/data/elo-calibrated.current.json",
      "changed": true,
      "officialResultsCount": 9,
      "matchesApplied": 929
    },
    "predictionRun": {
      "matchCount": 63
    }
  }
}
```

### `POST /api/admin/freeze-predictions`

Marks the latest prediction generated before kickoff as the immutable pre-match snapshot for selected matches or matches entering the lock window. By default the lock window is 60 minutes before kickoff. The watcher and `npm run sync:local` call this automatically, so this endpoint is mainly for admin backfill or manual repair.

Body:

```json
{
  "matchIds": ["mexico-south-africa"],
  "lockBeforeMinutes": 60,
  "force": false
}
```

Response shape:

```json
{
  "freeze": {
    "sourceId": "model-prediction-freeze",
    "frozenCount": 1,
    "skippedCount": 0,
    "frozen": [
      {
        "matchId": "mexico-south-africa",
        "predictionId": "prediction-id",
        "predictionGeneratedAt": "2026-06-11T00:10:00.000Z",
        "kickoffAt": "2026-06-11T01:00:00.000Z"
      }
    ]
  }
}
```

### `POST /api/admin/backfill-upstream-track-record`

Backfills missing immutable pre-match snapshots for completed local matches using the upstream GitHub result list and frozen tournament Elo ratings. This is intended only for matches that finished before the local freeze watcher existed.

The backfill is conservative:

- it only writes completed local matches;
- it verifies that the local final score matches the upstream result;
- it skips matches that already have a live frozen snapshot;
- it tags imported snapshots with `audit.backfilled=true` and `audit.backfillSource=upstream-github-track-record`;
- `force: true` only replaces prior upstream-backfilled snapshots, not live frozen snapshots.

Body:

```json
{
  "force": false,
  "resultsUrl": "https://raw.githubusercontent.com/Hicruben/world-cup-2026-prediction-model/main/data/wc2026-results.json",
  "ratingsUrl": "https://raw.githubusercontent.com/Hicruben/world-cup-2026-prediction-model/main/data/elo-calibrated.json"
}
```

Response shape:

```json
{
  "backfill": {
    "sourceId": "upstream-github-track-record",
    "rawMatchCount": 24,
    "importedCount": 24,
    "skippedCount": 0,
    "runId": "run_upstream_track_record_20260618043632248_9e6a8ad9"
  }
}
```

### `POST /api/admin/sync-fixtures`

Fetches official FIFA 2026 World Cup fixtures/results from the FIFA calendar API, normalizes them into the local match feed, and stores source metadata.

Default behavior imports every FIFA fixture whose two teams are known and mapped to product teams. If a future fixture contains a mapped team outside the baseline model, the match is still imported with `predictionStatus.available=false` and no fake probability is generated.

Body:

```json
{
  "mode": "mapped"
}
```

Example response:

```json
{
  "sync": {
    "sourceId": "fifa-api-world-cup-2026-calendar",
    "rawCount": 104,
    "normalizedCount": 72,
    "importedCount": 72,
    "predictableImportedCount": 72,
    "modelUnsupportedImportedCount": 0,
    "skippedCount": 0,
    "importedMatchIds": ["mexico-south-africa"]
  }
}
```

### `POST /api/admin/sync-lineups`

Imports free official or reviewed expected lineup data into the local match feed. The endpoint accepts inline JSON, or reads `PREDICTION_LINEUP_SOURCE_PATH` / `prediction-api/data/lineups.local.json` when a path is supplied. Paid sources are rejected.

Body:

```json
{
  "source": {
    "id": "manual-reviewed-expected-lineups",
    "name": "Manual reviewed expected lineups",
    "retrievedAt": "2026-06-12T10:00:00.000Z",
    "access": "free_reviewed"
  },
  "lineups": [
    {
      "matchId": "mexico-south-africa",
      "expected": {
        "confidence": "medium",
        "reviewedAt": "2026-06-12T10:05:00.000Z",
        "home": {
          "formation": "4-3-3",
          "starters": []
        },
        "away": {
          "formation": "4-2-3-1",
          "unavailable": []
        }
      }
    }
  ]
}
```

Lineup entries may identify a match by product `matchId` or FIFA `idMatch` / `officialIdMatch`. `official` and `expected` sections are stored separately. `expected` lineups are user-facing context only; they do not change model probabilities.

Example response:

```json
{
  "sync": {
    "sourceId": "manual-reviewed-expected-lineups",
    "rawCount": 1,
    "importedCount": 1,
    "officialImportedCount": 0,
    "expectedImportedCount": 1,
    "skippedCount": 0,
    "importedMatchIds": ["mexico-south-africa"]
  }
}
```

### `POST /api/admin/sync-expected-lineups`

Fetches RotoWire's public World Cup lineup page and imports parsed starters/injuries into `lineupIntel.expected` only. This source is treated as a public editorial expected-lineup feed, not an official source. It never overwrites `lineupIntel.official` and does not change model probabilities.

Body:

```json
{
  "url": "https://www.rotowire.com/soccer/lineups.php?league=WOC"
}
```

`url` is optional and defaults to the RotoWire World Cup lineups page.

Example response:

```json
{
  "sync": {
    "sourceId": "rotowire-world-cup-lineups",
    "importedCount": 23,
    "expectedImportedCount": 23,
    "officialImportedCount": 0,
    "probe": {
      "rawCount": 26,
      "skippedCount": 3
    }
  }
}
```

### `POST /api/admin/sync-official-lineups`

Fetches official lineups from FIFA's public live football endpoint for matches already mapped to a FIFA `idMatch`, then imports confirmed lineups into `lineupIntel.official`.

By default, the endpoint selects only pending matches whose kickoff is within the due window: 1 hour behind and 4 hours ahead of `now`. Use `mode: "all"` for an audit pass across every pending mapped match, or pass `matchIds` to force specific matches regardless of window or current lineup status.

Body:

```json
{
  "matchIds": ["mexico-south-africa"],
  "language": "en",
  "mode": "due",
  "lookaheadHours": 4,
  "lookbackHours": 1,
  "onlyPending": true
}
```

The sync imports a match only when both teams have 11 official starters. FIFA player `Status=1` is mapped to starters, `Status=2` is mapped to substitutes, and team `Tactics` is mapped to formation.

Example response:

```json
{
  "sync": {
    "sourceId": "fifa-api-live-football-lineups",
    "rawCount": 1,
    "importedCount": 1,
    "officialImportedCount": 1,
    "expectedImportedCount": 0,
    "probe": {
      "requestedCount": 1,
      "availableCount": 1,
      "skippedCount": 0
    },
    "selection": {
      "mode": "due",
      "selectedCount": 1,
      "selectedMatchIds": ["mexico-south-africa"]
    }
  }
}
```

### `GET /api/admin/official-lineup-candidates`

Returns the matches that would be selected for official FIFA lineup sync without fetching FIFA live data or mutating the local store.

Query parameters:

- `mode`: optional. `due` or `all`. Defaults to `due`.
- `lookaheadHours`: optional. Defaults to `4`.
- `lookbackHours`: optional. Defaults to `1`.
- `onlyPending`: optional boolean. Defaults to `true`.
- `now`: optional ISO timestamp for tests/debugging.
- `matchId`: optional product match id. Repeatable or comma-separated.

Example:

```text
GET /api/admin/official-lineup-candidates?mode=due&lookaheadHours=4&lookbackHours=1
```

### `POST /api/admin/sync-match-facts`

Fetches FIFA public live-football match facts for mapped matches that have an official `IdMatch`, then stores official score, goals, cards, substitutions, weather when present, and statistics only when the FIFA payload exposes them.

Default behavior selects completed matches. Use `mode: "all"` for an audit pass across every mapped match, or pass `matchIds` to force specific matches.

Body:

```json
{
  "matchIds": ["mexico-south-africa"],
  "language": "en",
  "mode": "completed"
}
```

Example response:

```json
{
  "sync": {
    "sourceId": "fifa-api-live-football-match-facts",
    "rawCount": 1,
    "importedCount": 1,
    "partialCount": 1,
    "skippedCount": 0,
    "importedMatchIds": ["mexico-south-africa"],
    "probe": {
      "requestedCount": 1,
      "availableCount": 1,
      "skippedCount": 0
    },
    "selection": {
      "mode": "completed",
      "selectedCount": 1,
      "selectedMatchIds": ["mexico-south-africa"]
    }
  }
}
```

### `POST /api/admin/sync-team-rankings`

Fetches FIFA's public men's live world ranking and stores ranking context under each mapped team profile.

The ranking is user-facing context only. It does not modify prediction snapshots or model inputs. FIFA does not provide an official team market-value field, so `profile.marketValue` remains unavailable unless an approved free valuation source is added later.

Example response:

```json
{
  "sync": {
    "sourceId": "fifa-live-world-ranking",
    "sourceUrl": "https://inside.fifa.com/fifa-world-ranking/men",
    "fetchedAt": "2026-06-12T12:00:00.000Z",
    "lastUpdateDate": "2026-06-11T10:00:59.636Z",
    "nextUpdateDate": "2026-07-20T00:00:00.000Z",
    "rawCount": 211,
    "importedCount": 48,
    "missingCount": 0
  }
}
```

### `POST /api/admin/sync-api-football-fixtures`

Fetches API-Football World Cup 2026 fixtures and maps them onto local FIFA-synced matches by kickoff date and team aliases. This stores `externalIds.apiFootball` on matched local records so later technical-stat syncs can query by fixture ID.

Body:

```json
{
  "league": "1",
  "season": "2026"
}
```

`league` and `season` are optional and default to `1` and `2026`.

Example response:

```json
{
  "sync": {
    "sourceId": "api-football-world-cup-fixtures",
    "rawCount": 104,
    "importedCount": 72,
    "skippedCount": 0,
    "importedMatchIds": ["mexico-south-africa"]
  }
}
```

### `POST /api/admin/sync-api-football-match-stats`

Fetches API-Football technical statistics for matches that already have `externalIds.apiFootball`, then merges supported rows into `matchFacts.statistics`.

Default behavior selects completed matches. Use `mode: "all"` for all mapped matches, or pass `matchIds` to force specific matches.

Body:

```json
{
  "matchIds": ["mexico-south-africa"],
  "mode": "completed"
}
```

Example response:

```json
{
  "sync": {
    "sourceId": "api-football-fixture-statistics",
    "importedCount": 1,
    "importedMatchIds": ["mexico-south-africa"],
    "selection": {
      "mode": "completed",
      "selectedCount": 1,
      "selectedMatchIds": ["mexico-south-africa"]
    }
  }
}
```

### `POST /api/admin/sync-api-football`

Runs API-Football fixture-ID mapping and technical-statistics import together. This is the preferred local path after `API_FOOTBALL_KEY` is configured because it avoids forgetting the fixture-ID step.

Default behavior maps fixture IDs, then imports statistics for completed mapped matches. Use `mode: "all"` for all mapped matches, `matchIds` for specific local matches, or `skipFixtureSync: true` when fixture IDs are already stored.

Body:

```json
{
  "mode": "completed",
  "matchIds": ["mexico-south-africa"],
  "skipFixtureSync": false
}
```

Example response:

```json
{
  "sync": {
    "sourceId": "api-football-supplemental-sync",
    "summary": {
      "fixtureImportedCount": 72,
      "statisticsImportedCount": 2,
      "statisticsSkippedCount": 0,
      "statisticsMatchIds": ["mexico-south-africa", "south-korea-czech-republic"]
    }
  }
}
```

### `POST /api/admin/sync-polymarket-markets`

Fetches Polymarket public World Cup market metadata through the Gamma API and imports mapped `world-cup-winner` market-implied probabilities into team profiles.

Body:

```json
{
  "eventSlugs": ["world-cup-winner"]
}
```

Notes:

- This endpoint is read-only against Polymarket.
- It does not use wallet, account, order, or trading APIs.
- It filters placeholder markets such as `Team AK`.
- Imported signals are display context only and do not mutate prediction snapshots or model inputs.

### `POST /api/admin/sync-polymarket-match-markets`

Fetches or imports Polymarket public single-match World Cup moneyline and More Markets derivative markets and stores them under `match.marketOdds.polymarket`.

When the deployment server cannot reach Polymarket, pass a previously generated snapshot as `payload`. This is the preferred short-term path over installing a server-wide VPN.

Body for server-side fetch:

```json
{
  "matchIds": ["brazil-morocco"],
  "mode": "all",
  "limit": 8,
  "eventSlugByMatchId": {
    "brazil-morocco": "fifwc-bra-mar-2026-06-13"
  }
}
```

Body for snapshot import:

```json
{
  "payload": {
    "source": { "id": "polymarket-match-markets" },
    "matches": []
  }
}
```

Stored match field:

```json
{
  "marketOdds": {
    "polymarket": {
      "status": "available",
      "sourceId": "polymarket-match-markets",
      "retrievedAt": "2026-06-14T00:00:00.000Z",
      "eventSlug": "fifwc-bra-mar-2026-06-13",
      "sourceUrl": "https://polymarket.com/event/fifwc-bra-mar-2026-06-13",
      "moneyline": [
        { "type": "home", "label": "巴西", "price": 0.585, "impliedProbabilityPercent": 58.5 },
        { "type": "draw", "label": "平局", "price": 0.255, "impliedProbabilityPercent": 25.5 },
        { "type": "away", "label": "摩洛哥", "price": 0.165, "impliedProbabilityPercent": 16.5 }
      ],
      "derivativeEventSlug": "fifwc-bra-mar-2026-06-13-more-markets",
      "derivativeMarkets": [
        { "key": "away+1.5", "type": "spread", "label": "摩洛哥 +1.5", "price": 0.685, "impliedProbabilityPercent": 68.5 },
        { "key": "total-over-2.5", "type": "total", "label": "大 2.5", "price": 0.435, "impliedProbabilityPercent": 43.5 },
        { "key": "btts-yes", "type": "btts", "label": "双方进球 Yes", "price": 0.475, "impliedProbabilityPercent": 47.5 },
        { "key": "away-over-0.5", "type": "team-total", "label": "摩洛哥进球大 0.5", "price": 0.575, "impliedProbabilityPercent": 57.5 }
      ],
      "aiAnalysis": {
        "provider": "deepseek",
        "model": "deepseek-chat",
        "text": "可选，由本地快照生成流程写入。"
      },
      "readOnly": true,
      "tradingEnabled": false
    }
  }
}
```

Notes:

- This endpoint is read-only against Polymarket.
- It does not use wallet, account, order, or trading APIs.
- It imports external market-implied prices only; prediction snapshots are not mutated.

### `POST /api/admin/sync-ai-analyses`

Generates DeepSeek explanations from stored model predictions and existing `match.marketOdds.polymarket` snapshots. With `modelOnly=true`, it generates a model-only explanation for matches that do not have market rows. This endpoint does not fetch Polymarket and does not use trading APIs. It requires `DEEPSEEK_API_KEY` in the server environment.

Body:

```json
{
  "matchIds": ["brazil-morocco"],
  "limit": 8,
  "refresh": false,
  "modelOnly": false,
  "missingMarketOnly": false
}
```

Stored match field:

```json
{
  "marketOdds": {
    "polymarket": {
      "aiAnalysis": {
        "provider": "deepseek",
        "model": "deepseek-chat",
        "generatedAt": "2026-06-14T12:00:00.000Z",
        "text": "基于模型概率和只读市场价格生成的中文解释。",
        "safety": {
          "noTradingAction": true,
          "noFabricatedFacts": true,
          "sourceBounded": true
        }
      }
    }
  }
}
```

Notes:

- The LLM receives only structured model output and stored read-only market rows.
- It must not invent injuries, lineups, odds, or sources.
- The generated text is explanatory product copy, not betting advice.

### `GET /api/admin/model-runs`

Returns recorded model runs, newest first.

### `GET /api/admin/data-quality`

Returns a backend data-quality report. This checks required store arrays, unique IDs, match-team references, model team slugs, prediction snapshot references, and model-run references.

Example response:

```json
{
  "report": {
    "ok": true,
    "errorCount": 0,
    "warningCount": 0,
    "counts": {
      "matches": 72,
      "predictions": 74
    },
    "store": {
      "persistence": "sqlite"
    }
  }
}
```

### `GET /api/predict`

Compatibility/debug endpoint for direct single-match prediction.

Query parameters:

- `home`: required team slug or alias.
- `away`: required team slug or alias.
- `venue`: optional. Use `neutral`, `home`, `away`, or one of the two team slugs.

## Error Shape

```json
{
  "error": {
    "code": "not_found",
    "message": "Unknown match id: not-a-match."
  }
}
```

## Notes

- Predictions are deterministic for the current baseline model and inputs.
- Every snapshot stores model metadata, generated time, input teams, probabilities, expected goals, scorelines, recommendation, and confidence.
- `confidence.score` is a UI helper derived from probability separation. It is not a guarantee and must not be presented as betting certainty.
- Store reads and writes are validated. Invalid store data fails loudly instead of silently serving broken predictions.
- The default store uses Node 24 `node:sqlite` with tables for sources, teams, matches, predictions, model runs, and metadata.
- Official fixture/result sync uses `https://api.fifa.com/api/v3/calendar/matches` with `idCompetition=17` and `idSeason=285023`.
- Official lineup sync uses `https://api.fifa.com/api/v3/live/football/{IdMatch}?language=en` after fixture sync has provided each match's FIFA `IdMatch`.
- Official match-facts sync uses the same FIFA live-football endpoint and stores only fields present in the official payload. Current observed payloads expose events and score, but not a complete shot/corner/foul/pass-success stat pack.
- Team ranking sync uses FIFA's public live world ranking route at `https://inside.fifa.com/api/live-world-ranking/get-rankings` plus the official ranking page metadata at `https://inside.fifa.com/fifa-world-ranking/men`.
- API-Football is a Tier 2 supplemental source. Use `npm run probe:api-football` with a free key to inspect raw coverage, `npm run sync:api-football` for the preferred fixture-ID + technical-statistics sync, or the lower-level `npm run sync:api-football-fixtures` / `npm run sync:api-football-match-stats` commands when debugging.
- Polymarket is a Tier 3 read-only market-reference source. Use `npm run probe:polymarket` to inspect public market coverage and `npm run sync:polymarket-markets` to import mapped market-implied probabilities. The only wallet-related feature is `/api/polymarket/account`, which reads public wallet-address data without authentication, signatures, private keys, orders, withdrawals, or trading APIs.
- Expected lineup sync uses `https://www.rotowire.com/soccer/lineups.php?league=WOC` as a free public editorial source and stores it only under `lineupIntel.expected`.
- The official endpoint returns 104 matches. At this point, 72 group-stage matches have known teams and are imported; 32 knockout matches remain placeholders until teams are known.
- The product maps all 48 qualified teams. The local baseline model currently covers all 72 imported known group-stage matches after extending and recalibrating ratings for the 9 teams that were present in `results.json` but missing from the upstream seed list.
- `recentForm` is computed at read time from `world-cup-2026-prediction-model/data/results.json` plus completed FIFA-synced match results already in the local store. Each match uses only results before that match's kickoff time.
- `recentForm.metrics.attack`, `defense`, and `stability` are 0-100 recent-performance display metrics derived from near-5 goals for, goals against, clean sheets, scoring rate, points per match, unbeaten rate, and goal difference. They do not currently alter the baseline win/draw/loss probabilities.
