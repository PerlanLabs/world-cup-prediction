# 世界杯预测

## Product Definition

世界杯预测 is an AI-assisted football match analysis product. It helps viewers quickly understand upcoming World Cup matches through probabilities, key variables, match narratives, and eventually model-backed prediction tracking.

## Target User

- Content creators who want a compelling AI/Vibe Coding demo.
- Football fans who want a quick pre-match read.
- Builders evaluating whether a demo can become a real prediction tool.

## Full Product Vision

A continuously updated World Cup prediction cockpit that combines real fixtures, historical results, odds baselines, Elo/Dixon-Coles modeling, LLM-assisted analysis, and post-match backtesting. The product should explain why a probability changed and whether prior predictions were well calibrated.

## Maturity Ladder

### Prototype / Demo

- Interactive command-center UI.
- Mock fixtures and prediction data.
- Match list, selected match detail, win/draw/loss probabilities, score tendencies, key variables, AI analyst copy, confidence, and risk signals.
- Clear demo-data labeling.

### MVP

- Deploy and wrap `Hicruben/world-cup-2026-prediction-model` as the baseline prediction engine.
- Replace mock probabilities with model output.
- Save prediction snapshots.
- Add a basic API boundary for match prediction.

### V1

- Add real fixture/results sync.
- Add odds baseline and weather source.
- Run scheduled refreshes.
- Add backtest dashboard: accuracy, Brier score, log loss, calibration.

### V2 / Later

- Compare odds baseline, Elo-Dixon-Coles, LLM-only, and Hybrid models.
- Add news/lineup/ injury extraction with LLM-assisted structured variables.
- Add alerts for probability movement and high-confidence matches.

## Non-Goals

- No betting advice or guaranteed outcome claims.
- No paid data providers in Phase 1.
- No hidden model outputs that cannot be traced or evaluated.
- Do not expose engineering/debug details on the consumer UI; keep model/source/version details in internal surfaces until a user-facing transparency page is designed.

## Current Acceptance Criteria

- A user can open the Phase 1 demo and understand the product in under 10 seconds.
- The fixture list, match detail, probability bars, variables, AI analysis, confidence, and recent changes are all visible.
- Controls are interactive: match switching, tabs, filters, refresh, compare modal, and variable expansion.
- The demo labels its data as mock/demo data.
