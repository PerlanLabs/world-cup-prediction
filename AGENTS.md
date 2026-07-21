# Repository Instructions

## Project

This repository contains a World Cup prediction product prototype.

- Phase 1 is a Vibe Coding demo: a polished, interactive front-end using mock data.
- Phase 2 turns the demo into a data-driven prediction tool using a deployed baseline model, real data, snapshots, and backtests.

## Structure

- `world-cup-command-center/` - React/Vite prototype for Phase 1.
- `prediction-api/` - local Node backend around the baseline prediction model, match feed, sources, SQLite persistence, prediction snapshots, pre-match frozen snapshots, scoring, and model runs.
- `world-cup-2026-prediction-model/` - shallow clone of the upstream MIT model repo used as the Phase 2A baseline.
- `Dockerfile` - single-service deployment image for the React app plus prediction API.
- `DEPLOY.md` - local/VPS/Docker deployment notes.
- `PRODUCT.md` - product definition and maturity ladder.
- `DESIGN.md` - UX, interaction, and visual direction.
- `PLAN.md` - current delivery target, milestones, and next work.
- `SOURCE_POLICY.md` - data/source rules for real predictions.
- `EVALS.md` - model and product evaluation plan.
- `API.md` - local prediction API contract and response shape.

## Commands

Run commands from `world-cup-command-center/`:

- `npm install` - install prototype dependencies.
- `npm run api` - start the local prediction API on `127.0.0.1:8787`.
- `npm run dev` - start local dev server on `127.0.0.1`.
- `npm run dev:live` - start the local prediction API, Vite dev server, and local FIFA fixture/result watcher together.
- `npm run build` - production build check.
- `npm run test:backend` - run Node native backend tests using a temporary store.
- `npm run test:frontend` - run lightweight frontend/data-mapping tests.
- `npm run sync:lineups -- --path ../prediction-api/data/lineups.local.json --dry-run` - validate a local reviewed lineup payload without writing it.
- `npm run sync:lineups -- --path ../prediction-api/data/lineups.local.json` - import a free official/reviewed expected lineup payload into the local store.
- `npm run sync:expected-lineups -- --json` - fetch RotoWire public World Cup predicted lineups into the expected-lineup slot.
- `npm run sync:match-facts -- --json` - fetch FIFA public live football match events/facts for completed mapped matches.
- `npm run sync:team-rankings -- --json` - fetch FIFA public men's live world ranking into team display profiles.
- `npm run sync:api-football-fixtures -- --json` - map local FIFA fixtures to API-Football fixture IDs using a free API-Football key.
- `npm run sync:api-football-match-stats -- --completed --json` - fetch API-Football technical statistics into `matchFacts.statistics`.
- `npm run sync:api-football -- --completed --json` - run API-Football fixture-ID mapping and completed-match technical-statistics sync in one command.
- `npm run probe:api-football -- --fixture-id <id> --json` - dry-run API-Football free-key coverage without writing local data.
- `npm run probe:polymarket -- --json` - dry-run Polymarket read-only World Cup market coverage without trading APIs.
- `npm run polymarket:movement -- --papertrader-snapshot <snapshot.json> --output <movement.json>` - backfill pre-kickoff Polymarket price history from a complete PaperTrader discovery snapshot and calculate 24h/6h/1h movement signals without trading.
- `npm run polymarket:backtest -- --collect --limit 20` - collect missing full-lifecycle snapshots for completed matches, settle fixed-contract movement signals, and regenerate the frozen CLV/ROI/model-EV report; use `--no-collect` for cache-only recalculation.
- `npm run sync:polymarket-markets -- --json` - import Polymarket market-implied World Cup winner probabilities into team display profiles.
- `npm run sync:ai-analyses -- --limit 8 --json` - generate DeepSeek AI explanations from stored model predictions and read-only Polymarket match-market snapshots.
- `npm run sync:ai-analyses -- --model-only --missing-market-only --json` - generate DeepSeek model-only explanations for matches that do not have Polymarket match-market snapshots.
- `npm run sync:local` - run one local official FIFA fixture/result, completed-match facts, current-Elo refresh, pending-prediction sync, and pre-match prediction freeze cycle.
- `npm run pnl:import-inbox` - import final accepted betting-advice HTML/manual JSON files from `../盈亏分析/_inbox/`.
- `npm run pnl:update` - import the P&L inbox, refresh/settle results, and regenerate match/daily/cumulative/market-performance P&L reports.
- `npm run pnl:update -- --skip-sync` - recalculate P&L and market-performance reports from locally stored results without fetching FIFA updates.
- `npm run model:review` - regenerate model-only review reports from frozen pre-match prediction snapshots, including W/D/L, scoreline Top-N, exact-score probability, and derived market checks.
- `npm run refresh:model -- --json` - export completed FIFA results, recalibrate current Elo ratings, and append new pending-match prediction snapshots.
- `npm run watch:match-updates -- --once --json` - run one official FIFA fixture/result, completed-match facts, current-Elo refresh, and pre-match freeze cycle.
- `npm run watch:match-updates` - keep polling official FIFA fixture/result updates, completed-match facts, current-Elo refresh, and pre-match freezes every 5 minutes.
- `npm run sync:upstream-track-record -- --json` - backfill missing pre-match frozen snapshots for already-completed local matches from the upstream GitHub `wc2026-results.json` plus frozen tournament Elo ratings.
- `npm run watch:official-lineups -- --dry-run` - list official FIFA lineup sync candidates without fetching live data.
- `npm run watch:official-lineups -- --once` - run one official FIFA lineup sync cycle for due pending matches.
- `npm run preview` - preview production build.

Run commands from the repository root:

- `npm run build` - build the React app for production serving by the Node API.
- `npm start` - start the single-service app/API server.
- `npm run dev:live` - start API, Vite, and the local match-update watcher together for local live development.
- `npm run predict:match -- australia turkiye neutral` - run the local model CLI; it prefers generated current rolling Elo ratings and falls back to bundled baseline ratings.
- `npm run predict:match:base -- australia turkiye neutral` - run the model against Cup26 upstream frozen baseline ratings. Use this as the default probability source for pre-match betting-analysis cards, matching Cup26's no-mid-tournament-Elo-recalibration policy. Match Cup26 single-match pages by using the venue-aware third argument: pass `usa`, `mexico`, or `canada` when that host team plays in its own country; otherwise pass `neutral`.
- `npm run predict:match:current -- australia turkiye neutral` - run the local rolling-Elo variant as a sensitivity/reference check only.
- `npm run predict:match -- --ratings=base australia turkiye neutral` - equivalent explicit baseline form.
- `npm run sync:local` - run one local official fixture/result, completed-match facts, current-Elo refresh, pending-prediction sync, and pre-match prediction freeze cycle.
- `npm run pnl:import-inbox` - import final accepted betting-advice HTML/manual JSON files from `盈亏分析/_inbox/`.
- `npm run pnl:update` - import the P&L inbox, refresh/settle results, and regenerate match/daily/cumulative/market-performance P&L reports.
- `npm run pnl:update -- --skip-sync` - recalculate P&L and market-performance reports from locally stored results without fetching FIFA updates.
- `npm run model:review` - regenerate model-only review reports from frozen pre-match prediction snapshots.
- `npm run watch:match-updates -- --once --json` - run one official fixture/result, completed facts, current-Elo refresh, and pre-match freeze cycle.
- `npm run sync:upstream-track-record -- --json` - backfill missing pre-match frozen snapshots for already-completed local matches from upstream GitHub track-record data.
- `node prediction-api/server.mjs` - start the local prediction API.
- `node --test prediction-api/*.test.mjs` - run backend tests from the root.
- `node world-cup-2026-prediction-model/predict.mjs usa paraguay usa` - run the local CLI against current rolling Elo by default.
- `node world-cup-2026-prediction-model/predict.mjs --ratings=base usa paraguay usa` - run the local CLI against the Cup26 upstream frozen baseline. Use this for betting-analysis model probabilities unless the user explicitly asks for rolling current Elo.
- `node world-cup-2026-prediction-model/backtest.mjs` - reproduce the upstream walk-forward backtest.

Local backend endpoints:

- `GET /api/matches?include=prediction` - UI match feed with latest prediction snapshots.
- `GET /api/model-track-record` - model track record scored only from pre-match frozen prediction snapshots.
- `GET /api/matches/:id/predictions/history` - prediction history for one match.
- `POST /api/admin/run-predictions` - manually append new prediction snapshots.
- `POST /api/admin/refresh-model-ratings` - export completed FIFA results, write current Elo ratings, and append refreshed prediction snapshots while preserving history.
- `POST /api/admin/freeze-predictions` - mark the latest prediction generated before kickoff as the immutable pre-match snapshot for selected or due matches.
- `POST /api/admin/backfill-upstream-track-record` - backfill missing immutable pre-match snapshots for completed local matches using upstream GitHub frozen tournament ratings and result list without overwriting live frozen snapshots.
- `POST /api/admin/sync-fixtures` - fetch official FIFA fixtures/results and import mapped-team matches.
- `POST /api/admin/sync-lineups` - import free official or reviewed expected lineups into matches while rejecting paid sources.
- `POST /api/admin/sync-expected-lineups` - import RotoWire public predicted lineups as expected lineups only.
- `GET /api/admin/official-lineup-candidates` - list matches selected for official lineup sync without mutating the store.
- `POST /api/admin/sync-official-lineups` - fetch FIFA public live football lineups for due pending matches with official `IdMatch`.
- `POST /api/admin/sync-match-facts` - fetch FIFA public live football match events/facts for mapped matches with official `IdMatch`.
- `POST /api/admin/sync-team-rankings` - fetch FIFA public men's live world ranking into team display profiles.
- `POST /api/admin/sync-api-football-fixtures` - map local matches to API-Football fixture IDs.
- `POST /api/admin/sync-api-football-match-stats` - fetch API-Football technical statistics for mapped matches.
- `POST /api/admin/sync-api-football` - run API-Football fixture-ID mapping and supplemental technical-statistics sync together.
- `POST /api/admin/sync-polymarket-markets` - import read-only Polymarket World Cup market-implied probabilities into team profiles.
- `GET /api/polymarket/account` - read a user-supplied public wallet address through Polymarket public data endpoints and map open positions to locally stored World Cup markets; no signatures, private keys, orders, withdrawals, or trading APIs.
- `GET /api/polymarket/backtest` - read the latest frozen movement-signal research report with quality-eligible sample counts, first-position CLV/ROI, model EV, drawdown, signal/window splits, threshold sensitivity, and per-match audit rows.
- `POST /api/admin/sync-ai-analyses` - generate DeepSeek explanations from existing model/market snapshots, or model-only explanations when `modelOnly=true`; uses `DEEPSEEK_API_KEY` from the server environment.
- `GET /api/admin/model-runs` - model run history.
- `GET /api/admin/data-quality` - structural/source/model-reference quality report.

## Delivery Rules

- Phase 1 must stay honest: clearly label mock/demo data and avoid implying betting certainty.
- Use real image assets for visible flags, backgrounds, avatars, and generated visuals.
- Do not add paid APIs, prediction data providers, or production dependencies without approval.
- Lineup and injury/availability work must follow the `official_and_expected_only` policy: no paid providers, official confirmed data and expected data must be displayed separately, and expected data must not be presented as official.
- Do not commit or push unless explicitly asked.
- For Phase 2, every prediction must be traceable to input data, upstream commit/model version, timestamp, and output probabilities.
- Model performance claims must use `audit.freezeType=pre_match_final` snapshots only; refreshed post-match predictions must not be backfilled into hit-rate calculations.
- Upstream GitHub track-record backfill is allowed only for completed matches that predate local freezing. It must be tagged with `audit.backfilled=true` and `audit.backfillSource=upstream-github-track-record`, must verify the local final score matches the upstream result, and must not overwrite a live frozen snapshot.
- `prediction-api/data/backend-store.sqlite` is the default generated local runtime store and must stay out of Git.
- `prediction-api/data/backend-store.json` is a legacy/fallback generated local runtime store and must stay out of Git.
- Use `PREDICTION_STORE_DRIVER=json` only for fallback/debug work; default local persistence is SQLite through Node 24 `node:sqlite`.
- Use `PREDICTION_STORE_PATH` for tests or experiments that should not mutate the local development store.
- Official fixture sync may import mapped teams even when the baseline model is missing ratings, but those matches must be marked `predictionStatus.available=false` and must not show fake probabilities.
- Current local baseline coverage includes all 48 qualified teams; the 9 upstream-missing teams use added seed anchors plus `results.json` recalibration and should be audited before public accuracy claims.
- Polymarket integration is read-only only. It may display market-implied probabilities as external reference context, and may read user-supplied public wallet-address snapshots for portfolio monitoring. It must not request wallet signatures, store private keys, place orders, withdraw funds, use authenticated wallet/order/trading APIs, or be described as official odds or betting advice.
- The P&L review workflow has a no-backend local UI at `盈亏分析/操作台.html`. Prefer it for user-facing daily operation: drag final accepted HTML advice cards from any folder, edit actual match dates/scores, persist in browser local storage, and export CSV/Markdown/backup JSON. Keep CLI inbox commands as the automation/backfill path.

## Betting Analysis Handoff

- For future Codex chats that should continue the user's current World Cup betting-analysis workflow, read `新对话启动包.md` first.
- The betting-analysis script is data mode only. It may fetch/normalize model probabilities and Polymarket market rows, but final portfolio construction, reasoning, and user-facing conclusions must be decided by the assistant.
- Default pre-match probability source is the Cup26/base ratings mode, not rolling current Elo, unless the user explicitly asks for current sensitivity.
- When calculating user-facing P&L for direct Polymarket buys, include Sports taker fees by default: `fee = stake * 0.03 * (1 - price)`. Mention bid/ask spread and market-depth slippage separately when relevant.
