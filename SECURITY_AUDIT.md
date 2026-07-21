# Pre-Publication Security And Privacy Audit

Audit date: 2026-07-21

Scope: files intended for the first public GitHub commit, the Node API exposure boundary, frontend dependencies, generated/runtime data, optional PaperTrader integration, and the model submodule.

## Findings And Remediation

| ID | Severity | Finding | Resolution |
|---|---|---|---|
| SEC-001 | High | Local wallet snapshots, portfolio/P&L records, accepted advice HTML, runtime databases, archives, browser artifacts, and PaperTrader state existed in the workspace. | Added explicit Git and Docker exclusions. These files remain local and are not part of the staged/public tree. |
| SEC-002 | High | Setting only `PORT` made the API bind to all interfaces while `/api/admin/*` allowed requests when no token was configured. CORS also allowed every origin. | Default binding is now loopback. Non-loopback binding fails closed unless `ADMIN_TOKEN` has at least 24 characters. Admin-token comparison is timing-safe. CORS is off by default and accepts only one exact configured origin. |
| SEC-003 | High | Vite 6.4.2 matched a published Windows development-server file-access advisory. | Upgraded to Vite 6.4.3. `npm audit` reports no known vulnerabilities at publication time. |
| SEC-004 | Medium | Responses lacked baseline browser security headers, request JSON had no size limit, and unhandled errors returned internal messages. | Added CSP, clickjacking/content-type/referrer/permissions protections, a configurable 10 MiB JSON limit, and generic 500 responses with server-side logging. |
| SEC-005 | Medium | The Polymarket movement script depended on one user-specific Windows virtual-environment path. | Added cross-platform local discovery plus `PAPERTRADER_EXE` and `PAPERTRADER_DATA_DIR` overrides. The runtime is kept outside the public repository. |
| SEC-006 | Low | Generated movement reports can contain local absolute paths and stale snapshots. | Generated movement/backtest directories are excluded; only source and contracts are public. |

## Secret And Privacy Checks

- Scanned candidate source/configuration files for common API key, bearer token, private-key, GitHub token, AWS key, and absolute-user-path patterns.
- Confirmed `.env`, key/certificate files, SQLite/JSON stores, archives, logs, wallet/P&L output, and local review material are ignored.
- Confirmed the Polymarket account endpoint accepts only a public EVM address and does not accept signing material.
- Confirmed the public model dependency is referenced as a Git submodule rather than publishing its internal Git metadata or silently dropping local model changes.

## Residual Risks

- This remains a research prototype, not a hardened multi-tenant service. It has no user accounts, role system, distributed rate limiter, managed secrets service, or production observability stack.
- Public read endpoints can trigger upstream data reads. A production deployment should add reverse-proxy rate limits, TLS, monitoring, backups, and egress controls.
- Third-party data sources and their schemas can change. Source attribution and read-only boundaries do not guarantee availability or correctness.
- Model output and market prices are uncertain and must not be treated as guaranteed financial outcomes.

## Release Gate

The release is acceptable for public source publication after tests, production build, dependency audit, staged-tree secret scan, staged-file size review, and a clean-clone verification all pass. This document records the controls, not a claim that the software is free of all vulnerabilities.
