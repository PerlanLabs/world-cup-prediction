# Source Policy

## Scope

This policy applies when the project uses real-world fixtures, results, odds, weather, injuries, lineups, news, or model performance claims.

## Phase 1

- Use mock/demo data only.
- Label mock data as `演示数据`.
- Do not present predictions as real betting advice.

## Current Local Backend

- Fixture seed data lives in `prediction-api/data/seed-data.json`.
- The default fixture/result sync uses the official FIFA calendar API at `https://api.fifa.com/api/v3/calendar/matches` with `idCompetition=17` and `idSeason=285023`.
- Official confirmed lineups use the FIFA live football endpoint `https://api.fifa.com/api/v3/live/football/{IdMatch}?language=en` when both teams expose 11 starters.
- Team display rankings use FIFA's public men's live world ranking route and official ranking page metadata. Rankings are display context only and are not model inputs.
- Team market value is not available from FIFA in the current official sources. It must remain unavailable/pending unless a free, approved source with clear terms is added later.
- API-Football is approved for local supplemental fixture-ID mapping and technical-statistics sync with a user-provided free key. It remains Tier 2 and must not replace FIFA official fixtures, scores, or official event facts.
- Polymarket is approved only as a Tier 3 read-only market-reference source for public World Cup prediction-market prices. It must not use wallet, account, order, or trading APIs.
- Polymarket single-match markets may be synced through local/worker-generated read-only snapshots when the deployment server cannot reach Polymarket directly. The server should import the snapshot payload rather than use a global VPN workaround.
- The seed file remains a bootstrap fallback, not the primary live source.
- Generated prediction snapshots live in the ignored local SQLite file `prediction-api/data/backend-store.sqlite`.
- `prediction-api/data/backend-store.json` is a legacy/fallback local store and may be imported when SQLite is initialized for the first time.
- Local prediction snapshots are acceptable for development and demos, but production must add source freshness checks and an approved deployment persistence strategy.
- All 48 qualified teams may be imported into the schedule feed once mapped to product teams and stable flags.
- Current local baseline coverage for all 48 qualified teams comes from the upstream model plus added seed anchors for Austria, Türkiye, Curaçao, Cabo Verde, Iraq, Norway, Sweden, Uzbekistan, and DR Congo, then recalibrated against `world-cup-2026-prediction-model/data/results.json`.
- Recent-form summaries must be computed from historical `results.json` records plus completed FIFA-synced results in the local store, using each target match kickoff as the cutoff.
- Lineups and injury/availability information use an `official_and_expected_only` policy: show official confirmed lineups separately from expected lineups, do not use paid providers, and do not merge expected lineups into official facts.
- Reviewed expected lineup payloads may be imported through `/api/admin/sync-lineups` only when the source metadata indicates free/public/manual-reviewed access.
- RotoWire's public World Cup lineups page may be imported through `/api/admin/sync-expected-lineups` as expected-lineup context only. It must not be labeled official and must not overwrite FIFA official lineups.
- Official FIFA lineup polling must use due-window candidate selection by default and should only use `mode=all` for explicit audits or manual recovery.
- `prediction-api/data/lineups.example.json` is a schema template only and must not be imported as real player data.
- `prediction-api/data/lineups.local.json` is ignored by Git and may hold locally reviewed free/public lineup data for development imports.
- Matches with teams missing from the baseline model must be marked as model-unavailable and must not show fabricated probabilities.
- Knockout fixtures must not be materialized as real matches until FIFA supplies actual teams.
- `/api/admin/data-quality` must return `ok: true` before local backend data is considered usable for demos.

## Trusted Source Tiers

### Tier 1

- Official competition, federation, or provider APIs.
- Deployed `world-cup-2026-prediction-model` baseline data and documented model outputs.
- Historical datasets used in reproducible backtests.

### Tier 2

- Established football data APIs and odds APIs with documented terms.
- Weather APIs with clear freshness and location metadata.

### Tier 3

- Public news, blogs, or social posts.
- Use only for qualitative context unless independently verified.

## Requirements

- Every real prediction must store source, fetch time, model version, and output timestamp.
- Rating extensions must identify whether they are internal seed anchors, historical-result calibration, or an approved external rating source.
- Team recent-form calculations must avoid post-match leakage: no result at or after the target kickoff may be included in that target match's form.
- Recent-form radar metrics may summarize attack, defense, and stability for display, but must not be described as model inputs until a backtest proves they improve the probability model.
- FIFA world ranking may be displayed near team names with source/fetch metadata. It must not be described as a market value, power rating, or direct model input unless separately backtested and approved.
- Market value must not be fabricated. If no approved free valuation source is present, show a pending/unavailable state rather than a number.
- API-Football technical statistics may be displayed as supplemental match context with source/fetch metadata. They must not alter prediction snapshots or be described as model inputs until separately backtested.
- API-Football free quota must be protected: prefer fixture-ID sync once, completed-match stat sync, and explicit match-id syncs over live high-frequency polling.
- Polymarket market-implied probabilities may be displayed as external market context with source/fetch/liquidity metadata. They are not official odds, not betting advice, and not model inputs until separately backtested and approved.
- Polymarket single-match moneyline prices may be compared against model win/draw/loss probabilities as a value-difference analysis. Derivative markets such as spreads, totals, BTTS, and team totals may be displayed only when a source-backed read-only `*-more-markets` payload supplies them; otherwise they must remain pending or be explicitly labeled as model-only simulation.
- DeepSeek or any other LLM may explain the structured strategy analysis, but must not invent odds, probabilities, injuries, lineups, sources, or direct betting instructions. API keys must be supplied through environment variables and must not be committed or logged.
- Polymarket placeholder outcomes such as `Team AK` must be filtered or labeled as unmapped, not shown as real teams.
- Prediction-market prices can be affected by liquidity, spread, regional restrictions, trader sentiment, and resolution rules; UI copy must use uncertainty language.
- Official lineups must be labeled as official and carry source/fetch metadata when available.
- FIFA official lineup sync may map player `Status=1` to starters, `Status=2` to substitutes, and team `Tactics` to formation. If either team lacks 11 starters, the match remains `official.not_released`.
- Official lineup sync candidates must be inspectable without mutating the store through `/api/admin/official-lineup-candidates` or `npm run watch:official-lineups -- --dry-run`.
- Expected lineups must be labeled as expected, carry source/review metadata, and remain user-facing context only until they are backtested as model inputs.
- Expected lineup sources may include public editorial predicted-lineup pages, but they must be tiered below official sources and displayed with uncertainty language.
- Lineup sync must reject sources marked as paid, premium, or commercial.
- Use `npm run sync:lineups -- --dry-run` before writing local lineup payloads into the development store.
- Fixture dates shown in the UI must come from official FIFA schedule data or be clearly labeled as a manual snapshot with retrieval date.
- FIFA fixture sync summaries must preserve fetched time, raw count, normalized count, imported count, and skipped count.
- FIFA fixture sync summaries must preserve predictable and model-unsupported counts separately.
- Current facts require freshness labels.
- Conflicting facts must be surfaced as uncertainty, not silently resolved.
- LLM output may summarize and structure facts, but must not fabricate citations.

## Forbidden

- Guaranteed-win language.
- Unsourced injury, lineup, or odds claims.
- Unsourced team market-value claims.
- Calling Polymarket prices official odds or betting recommendations.
- Using Polymarket wallet, account, order, or trading APIs in this product without explicit re-approval.
- Using a server-wide VPN to bypass platform restrictions as the default Polymarket data strategy.
- Paid lineup, injury, or odds providers unless explicitly re-approved later.
- Presenting expected lineups as official confirmed lineups.
- Hidden post-match data leakage into pre-match predictions.
