# Evals

## Purpose

Evaluate whether the prediction product is useful, calibrated, and honest.

## Phase 1 Product Evals

- The UI clearly labels demo data.
- The main flow works without external APIs.
- Match switching updates all probability, variable, AI brief, confidence, and change panels.
- Tabs, filters, compare modal, refresh, and expansion controls are functional.

## Phase 2 Model Evals

Compare at least four predictors:

- Odds baseline.
- Elo + Dixon-Coles / Poisson.
- LLM-only structured prediction.
- Hybrid model.

## Backend Contract Evals

- `node --test prediction-api/*.test.mjs` must pass before changing backend service behavior.
- Tests must use `PREDICTION_STORE_PATH` or another isolated store so they do not mutate local development data.
- Data-quality checks must report `ok: true` before a prediction feed is considered usable for demos.
- Manual reruns must append prediction history rather than overwriting previous snapshots.
- SQLite persistence must preserve prediction history after store cache resets or server restarts.
- Fixture sync tests must use mocked FIFA responses and verify mapped teams receive predictions while unmapped teams are skipped.
- Official sync smoke checks must confirm all 72 known group-stage fixtures have latest prediction snapshots; if future model-unsupported matches appear, they must not show fake probabilities.
- Recent-form tests must verify completed synced results are included for later matches and the target match itself is excluded from its own pre-match form.
- Recent-form metric tests must verify stronger recent records score higher on attack, defense, and stability while remaining within the 0-100 display range.
- Lineup sync tests must verify reviewed expected lineups are displayed separately from official lineups and never set `appliesToModel=true`.
- RotoWire expected-lineup sync tests must verify parsed public lineups populate only `lineupIntel.expected`, include injuries/unavailable notes, and never write official lineups.
- FIFA official lineup sync tests must verify `Status=1` players become starters, `Status=2` players become substitutes, formations come from `Tactics`, and official lineup data remains `appliesToModel=false`.
- Official lineup candidate tests must verify default due-window selection skips matches that already have official lineups and avoids full-feed probing unless explicitly requested.
- Lineup sync tests must reject payloads marked as paid, premium, or commercial.
- Lineup CLI tests must verify `--dry-run` summarizes imports without mutating the store.

## Metrics

- Accuracy for win/draw/loss.
- Brier score.
- Log loss.
- Calibration by probability bucket.
- Performance versus odds baseline.

## Leakage Rules

- Backtests must be walk-forward or otherwise prevent post-match information from entering pre-match predictions.
- Every prediction snapshot must include input timestamp and model version.

## Polymarket Movement Signal Evals

- Use at least 20 completed matches selected by chronology and data availability, never by outcome.
- Validate both event teams and kickoff before joining a Polymarket snapshot to an official result.
- Exclude every price after kickoff. A signal at `h72`, `h24`, `h6`, or `h1` may use only prices at or before that decision stage.
- Evaluate opening warnings only against signals that consume the opening anchor. Later windows may remain eligible when each required contract is usable inside that interval.
- Report independent match count separately from signal-occurrence count.
- Primary strategy metrics must keep only the first trigger per match and direct market; repeated-trigger metrics remain diagnostic only.
- Report CLV, fixed-cost simulated ROI, frozen-model EV, maximum drawdown, hit-rate interval, signal family, decision window, and threshold sensitivity.
- Do not assign executable ROI to synthetic exact-margin or exact-total events without directly executable contracts.
- Do not infer bookmaker intent, inside information, manipulation, or guaranteed outcomes from fixed-contract price movement.
- Do not tune thresholds on the same sample and call the result validated. Promote a signal only after an untouched chronological holdout confirms direction and risk.

## Acceptance Signal

The tool is credible only if it can show where each probability came from and how prior probabilities performed after matches finished.
