# Plan

## Current Delivery Target

Build Phase 2B local backend: keep the baseline World Cup prediction model running locally, add a backend contract for matches, teams, sources, prediction snapshots, pre-match frozen snapshots, prediction history, manual model runs, data-quality checks, SQLite persistence, official fixture/result sync, model track-record scoring, and local polling watchers, then connect the command-center UI to that backend with mock fallback.

## Active Milestone

`phase-2b-local-backend-contract`

## Product-To-Implementation Sequence

1. Lock product flow and acceptance criteria. Status: done for Phase 1 and Phase 2A.
2. Select visual direction. Status: done.
3. Implement front-end mock with realistic data. Status: done.
4. Wrap baseline model as an API. Status: done.
5. Add local backend contract and prediction snapshots. Status: done.
6. Connect UI to backend match feed. Status: done with mock fallback.
7. Add backend validation, data-quality report, and isolated tests. Status: done.
8. Replace manual seed data with approved production sources and sync jobs. Status: in progress through FIFA official fixture sync, completed-match facts sync, generated official model-results export, current Elo recalibration, local polling watchers, and a trial single-service deployment package.

## Phase 1 Deliverables

- React/Vite prototype in `world-cup-command-center/`.
- Mock match data for at least four fixtures.
- Interactive command-center UI.
- Demo-data and non-real-prediction language.
- Project docs for the next stage.

## Phase 2 Delivery Sequence

1. Deploy/fork `Hicruben/world-cup-2026-prediction-model`. Status: local shallow clone added at `world-cup-2026-prediction-model/`.
2. Wrap its CLI/model as a prediction API. Status: local Node API added at `prediction-api/`.
3. Connect model output to this UI. Status: front end calls `/api/matches?include=prediction` through the Vite proxy and falls back to mock data when the API is unavailable.
4. Store prediction snapshots with model version and input data. Status: local SQLite snapshot store implemented in `prediction-api/data/backend-store.sqlite`.
5. Add model run history, pre-match snapshot freezing, track-record scoring, and manual rerun endpoint. Status: implemented through `/api/admin/model-runs`, `/api/admin/run-predictions`, `/api/admin/refresh-model-ratings`, `/api/admin/freeze-predictions`, `/api/admin/backfill-upstream-track-record`, `npm run sync:upstream-track-record`, and `/api/model-track-record`.
6. Add backend store validation, data-quality report, configurable store path, and backend tests. Status: implemented through `/api/admin/data-quality`, `PREDICTION_STORE_PATH`, and `node --test`.
7. Add SQLite persistence with JSON fallback and legacy JSON import. Status: implemented through `PREDICTION_STORE_DRIVER=sqlite`.
8. Add real fixtures/results sync. Status: implemented for FIFA official calendar API with mapped-team import, generated official-results export for model refresh, and an explicit local watcher that polls fixture/result updates, completed-match facts, and current Elo refresh.
9. Expand team/flag mapping to all 48 qualified teams. Status: implemented; 72 known group-stage fixtures import successfully.
10. Extend or replace baseline model ratings for teams not covered by the upstream model. Status: implemented for all 48 qualified teams by adding seed anchors for the 9 missing `results.json` teams and recalibrating Elo; current runtime ratings can now be recalibrated from immutable base results plus generated FIFA official World Cup results.
11. Replace demo recent-form fields with computed historical/FIFA result summaries. Status: implemented for near-5 match record, goals for, goals against, and the attack/defense/stability radar metrics.
12. Add odds baseline, weather, injuries, lineups, match facts, team display profiles, and source policy enforcement. Status: implemented for lineup display, FIFA official lineup sync, RotoWire public expected lineup sync, official sync candidate selection, local lineup sync, dry-run validation, template-based local review through `official_and_expected_only`, FIFA public match-event/facts sync for completed mapped matches, FIFA world-ranking sync for team display profiles, API-Football supplemental technical-statistics sync behind a free-key gate, Polymarket read-only market-implied probability sync for World Cup winner team profiles, Polymarket single-match snapshot import, DeepSeek AI explanation backfill from stored model/market snapshots, and model-only DeepSeek explanations for matches without Polymarket match markets; paid providers and trading APIs are out of scope.
13. Add backtest and calibration dashboard. Status: implemented for model scoring through the `模型战绩` page and for the first Polymarket movement-signal research pass through `npm run polymarket:backtest`, `/api/polymarket/backtest`, and the `走势回测` page. The current frozen report contains at least 20 quality-eligible completed matches, signal/window/threshold metrics, first-position deduplication, CLV, fixed-3%-cost simulated ROI, model EV, drawdown, and full match audit rows. Signal thresholds remain provisional until an independent holdout sample is evaluated.
14. Add LLM-only and Hybrid experiments.
15. Trial deployment package. Status: implemented as one Node service serving both the React `dist` app and `/api/*`, with Docker/VPS notes and optional `ADMIN_TOKEN` protection for admin routes.

## Phase 2A Acceptance Criteria

- Upstream model can run locally through its CLI.
- Local API returns structured single-match predictions with probabilities, expected goals, scoreline tendencies, model metadata, and generated timestamp.
- React UI uses real model output when the API is running.
- React UI preserves mock fallback when the API is unavailable.
- React UI reflects the current date: on 2026-06-09 it shows the World Cup has not started and displays opening-stage fixtures rather than fake live matches.
- Fixture dates are a manually maintained snapshot from the FIFA official schedule page until real fixture sync is added.
- Build and browser smoke test pass.

## Phase 2B Acceptance Criteria

- Backend returns enriched matches through `/api/matches?include=prediction`.
- Backend persists prediction snapshots locally with generated time, model metadata, input teams, probabilities, expected goals, and scorelines.
- Backend exposes latest prediction, prediction history, source metadata, and model run history.
- Manual prediction reruns can be triggered for one match or all seeded matches.
- Backend data-quality report returns `ok: true` for the current local store.
- Default backend persistence is SQLite and prediction history survives store cache resets/server restarts.
- Official FIFA fixture sync imports mapped-team matches and stores source metadata.
- Newly imported supported matches receive prediction snapshots automatically.
- All 48 qualified teams have product mapping and stable flag URLs.
- All 72 known group-stage fixtures are covered by the current local baseline model.
- Match responses include computed recent-form summaries and recent-form radar metrics using only results before each match kickoff.
- Match responses include lineup intel slots for official confirmed lineups and expected lineups, with both clearly separated and not treated as model inputs.
- Reviewed expected lineup payloads can be imported through `/api/admin/sync-lineups`; paid lineup sources are rejected.
- Public expected lineups can be imported from RotoWire through `/api/admin/sync-expected-lineups` / `npm run sync:expected-lineups`, stored only as expected context.
- Local lineup review now has `prediction-api/data/lineups.example.json` as a schema template and `npm run sync:lineups` with `--dry-run` for safe validation before writing.
- FIFA official lineups can be imported through `/api/admin/sync-official-lineups` once the live football endpoint exposes 11 starters for both teams.
- Official lineup sync defaults to due pending matches, exposes a candidate dry-run endpoint, and can be run once or as an explicit polling command with `npm run watch:official-lineups`.
- FIFA official match events/facts can be imported through `/api/admin/sync-match-facts` or `npm run sync:match-facts`; completed synced matches expose official score, goals, cards, substitutions, weather when present, and an explicit unsupported-statistics coverage list.
- Official match status/results, completed-match facts, generated official model results, current Elo ratings, pending prediction snapshots, and due pre-match frozen snapshots can be refreshed together through `npm run sync:local` or `npm run watch:match-updates -- --once`, kept polling locally through `npm run watch:match-updates`, or run alongside API/Vite through `npm run dev:live`.
- Pre-match prediction freezing is available through `/api/admin/freeze-predictions`; missing frozen snapshots for already-completed early matches can be repaired through `/api/admin/backfill-upstream-track-record` or `npm run sync:upstream-track-record` using upstream GitHub frozen tournament ratings; model performance review uses only `audit.freezeType=pre_match_final` snapshots and is exposed through `/api/model-track-record` plus the `模型战绩` navigation entry.
- Long-running API processes reload the local writable store when another local sync process updates SQLite/JSON data.
- FIFA men's world rankings can be imported through `/api/admin/sync-team-rankings` or `npm run sync:team-rankings`; the UI displays rankings near team names while keeping market value pending because FIFA does not provide official valuation data.
- API-Football supplemental coverage can be probed through `npm run probe:api-football` with a free key. Approved local write paths now exist for one-command fixture-ID mapping plus completed-match technical statistics through `npm run sync:api-football`, with lower-level debugging paths through `npm run sync:api-football-fixtures` and `npm run sync:api-football-match-stats`.
- Polymarket public market coverage can be probed through `npm run probe:polymarket`; read-only World Cup winner market-implied probabilities can be imported through `npm run sync:polymarket-markets` and `/api/admin/sync-polymarket-markets` without using wallet, account, order, or trading APIs.
- Polymarket lifecycle signal research can be reproduced through `npm run polymarket:backtest -- --collect --limit 20`, read through `/api/polymarket/backtest`, and inspected in the `走势回测` view. Event identity and kickoff must match, post-kickoff prices are forbidden, synthetic events must not claim executable ROI, and repeated triggers are deduplicated per match/direct market for the primary verdict.
- Future matches with teams outside the baseline model are imported but clearly marked `模型待覆盖`.
- Backend tests run against an isolated temporary store.
- Front end uses the backend match feed by default and preserves mock fallback if the backend is unavailable.
- The built React app can be served by the Node API server for trial deployment, and Docker/VPS instructions exist in `DEPLOY.md`.
- Build, API smoke test, and browser smoke test pass.

## Risks

- Phase 1 mock data may look more certain than it is; keep demo labels visible.
- Real injury/news/lineup data can be costly or unreliable; current direction excludes paid providers and requires official/expected labeling.
- Official sync currently imports 72 known group-stage matches; 32 knockout fixtures remain placeholders until FIFA assigns teams.
- FIFA live-football match-facts sync currently provides useful event timelines, but observed completed-match payloads do not include a full technical-statistics pack for shots, shots on target, corners, fouls, offsides, or pass success. API-Football can supplement those fields once `API_FOOTBALL_KEY` is configured and fixture IDs are mapped.
- Team market value has no current approved free source. It should stay as a pending UI state rather than a fabricated estimate.
- Polymarket prices are market-implied probabilities, not official odds. They can be distorted by liquidity, spread, regional restrictions, trader sentiment, and resolution rules, so the UI must keep them as reference context only.
- The first movement-signal sample is exploratory and reused for threshold sensitivity; it is not an independent holdout. Positive CLV or simulated ROI must not be described as a proven edge while frozen-model EV conflicts or before a later untouched sample confirms the result.
- Trial deployment has optional admin-token protection but not full auth, user accounts, rate limiting, or production observability.
- The 9 newly covered teams use internal seed anchors plus `results.json` calibration; this is acceptable for local baseline coverage but should be audited or replaced with an approved rating baseline before public claims.
- LLM-generated explanations must not invent sources or unsupported certainty.
- Prediction accuracy claims require reproducible backtests.
- Upstream track-record backfill is a historical repair path. It should not become the normal prediction path for future matches; future public scoring should come from local pre-kickoff frozen snapshots created by the watcher.

## Open Decisions

- Hosting target for shareable demo.
- Whether Phase 2 uses a separate prediction service or a monorepo package.
- Whether additional odds/weather sources should follow the same no-paid-source constraint as lineups; current Polymarket coverage is read-only market reference only, not a trading feature.
- Whether to keep the upstream model as a nested clone, fork/submodule, or vendored package before cloud deployment.
- Whether to deploy with SQLite first or move to Postgres before public launch.
- Whether to keep the internal rating seed extension or replace it with an approved 48-team baseline rating source before public launch.
