# World Cup Prediction Command Center

一个可审计的 2026 世界杯预测与市场研究原型。项目把透明的 Elo + Dixon-Coles 比赛模型、官方赛程/赛果、本地预测快照，以及只读 Polymarket 市场数据整合到一个 React 控制台中。

> This repository is research software, not a promise of betting returns. Market prices and model outputs can be wrong. No wallet signing, order placement, withdrawal, or private-key handling is implemented.

## What Is Included

- React/Vite command center for fixtures, model probabilities, scorelines, form, market context, and audit views.
- Node 24 API with SQLite persistence, immutable pre-match snapshots, model runs, data-quality checks, and P&L review helpers.
- A forked model submodule based on [`Hicruben/world-cup-2026-prediction-model`](https://github.com/Hicruben/world-cup-2026-prediction-model).
- Read-only Polymarket discovery, order-book reference data, full-lifecycle price movement snapshots, market-structure analysis, and frozen-signal backtests.
- Optional integration with [`agent-next/polymarket-paper-trader`](https://github.com/agent-next/polymarket-paper-trader) for event/market discovery. The local checkout, databases, and paper positions are deliberately not versioned.

## Quick Start

Requirements: Node.js 24 or newer.

```bash
git clone --recurse-submodules https://github.com/PerlanLabs/world-cup-prediction.git
cd world-cup-prediction
npm --prefix world-cup-command-center ci
npm test
npm run build
npm start
```

Open `http://127.0.0.1:8787`.

For development with the API, Vite, and local match watcher:

```bash
npm run dev:live
```

## Optional PaperTrader Setup

The market-movement collector can call `pm-trader` from `PATH`:

```bash
pip install polymarket-paper-trader
npm run polymarket:movement -- --event-slug <event-slug> --output <movement.json>
```

Alternatively set `PAPERTRADER_EXE` to a local executable and `PAPERTRADER_DATA_DIR` to a private runtime directory. Neither the PaperTrader runtime nor its SQLite databases are committed.

## Configuration

Copy values from `.env.example` into your shell or a private `.env` file. Secret files are ignored by Git.

- Local startup defaults to `HOST=127.0.0.1` and does not require an admin token.
- Any non-loopback `HOST`, including `0.0.0.0`, requires an `ADMIN_TOKEN` of at least 24 characters.
- Cross-origin browser access is disabled by default. Set one exact `CORS_ORIGIN` only when needed; wildcard CORS is rejected.
- API keys are optional and must be provided through environment variables.

See [`DEPLOY.md`](DEPLOY.md), [`API.md`](API.md), and [`SOURCE_POLICY.md`](SOURCE_POLICY.md) for the full runtime and data contracts.

## Data And Privacy

The public repository intentionally excludes:

- SQLite/JSON runtime stores and caches;
- public-wallet snapshots and portfolio/P&L records;
- accepted betting-advice cards and generated reports;
- local lineup notes, API keys, `.env` files, logs, archives, and browser artifacts;
- PaperTrader databases, virtual environments, and local source checkout.

Only seed/example data and source code are versioned. Review [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) for the pre-publication audit and [`SECURITY.md`](SECURITY.md) for reporting issues.

## Validation

```bash
npm test
npm run build
npm --prefix world-cup-command-center audit --audit-level=high
```

## License And Attribution

The command-center and integration code are released under the MIT License. The prediction model remains under its upstream MIT license in a separate submodule. PaperTrader is an optional external MIT-licensed dependency. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
