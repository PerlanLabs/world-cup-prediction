# Security Policy

## Supported Version

Security fixes currently target the latest commit on the default branch.

## Reporting A Vulnerability

Please use GitHub private vulnerability reporting from this repository's **Security** tab. Do not post credentials, wallet information, exploit details, or personal data in a public issue.

Include the affected path, reproducible steps, impact, and any suggested mitigation. Reports will be acknowledged through GitHub and handled before public disclosure when practical.

## Security Boundaries

- This application never needs a wallet seed phrase, private key, signature, or trading permission.
- Polymarket integration is read-only and must not place orders or withdraw funds.
- API keys and `ADMIN_TOKEN` belong in environment variables, never source files.
- Local wallet snapshots, P&L records, generated reports, runtime databases, and PaperTrader state are excluded from version control.
- Binding the API beyond loopback requires an `ADMIN_TOKEN` with at least 24 characters.
