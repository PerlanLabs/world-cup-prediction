# Official Lineup Source Research

## Decision

Use FIFA public official endpoints for confirmed lineups when available. Keep reviewed expected lineups as a separate local/manual feed. Do not use paid providers.

## Confirmed FIFA Sources

- Match centre entry point: `https://www.fifa.com/en/match-centre`
- Fixture/result feed already used by the backend: `https://api.fifa.com/api/v3/calendar/matches`
- Official live match detail endpoint discovered from FIFA match-centre behavior and direct probing: `https://api.fifa.com/api/v3/live/football/{IdMatch}?language=en`

## Useful Fields

The live football endpoint returns:

- `HomeTeam.Tactics` and `AwayTeam.Tactics`: formation strings.
- `HomeTeam.Players` and `AwayTeam.Players`: official squad list for the match once published.
- `Players[].Status`: observed mapping:
  - `1`: starter.
  - `2`: substitute.
- `Players[].Position`: observed numeric role:
  - `0`: GK.
  - `1`: DF.
  - `2`: MF.
  - `3`: FW.
- `Players[].Captain`: captain flag.
- `HomeTeam.Substitutions` and `AwayTeam.Substitutions`: live/post-match substitution events.

## Product Contract

- Import official lineups only when both teams expose exactly 11 starters.
- Store official lineups in `lineupIntel.official`.
- Keep expected lineups in `lineupIntel.expected`.
- Keep `lineupIntel.appliesToModel=false` until lineup variables are backtested and explicitly approved as model inputs.
- If the official endpoint has not published both lineups, keep the UI state as `官方未发布`.

## Implementation

- `prediction-api/fifa-lineup-sync.mjs` fetches and normalizes FIFA official lineup payloads.
- `GET /api/admin/official-lineup-candidates` lists due-window candidates without fetching FIFA live data.
- `POST /api/admin/sync-official-lineups` imports official lineups for selected match IDs or pending matches inside the due window.
- `prediction-api/watch-official-lineups.mjs` can run a one-shot sync, a dry-run candidate check, or an explicit polling loop.
- `POST /api/admin/sync-lineups` remains the local/manual expected-lineup import path.
- `POST /api/admin/sync-expected-lineups` imports RotoWire public predicted lineups into `lineupIntel.expected` only.

## Limitations

- FIFA does not appear to publish a separate stable public documentation page for this live detail endpoint.
- The endpoint should be treated as a public official web API, but its shape can still change.
- Availability is match-time dependent: scheduled matches can return no players or incomplete players.
- The endpoint gives official match lineups, not necessarily a full injury report.
