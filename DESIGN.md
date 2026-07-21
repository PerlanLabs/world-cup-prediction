# Design

## Selected Direction

Phase 1 uses the `赛事指挥舱` concept: a dark, high-trust sports analytics dashboard with broadcast energy, green/gold accents, dense but readable panels, and a clear match-analysis workflow.

## Primary Flow

1. Open command center.
2. Scan today's fixtures.
3. Select a match.
4. Read win/draw/loss probability, score tendency, key variables, AI explanation, risk signals, and confidence.
5. Optional: open team comparison or switch to variable, intelligence, and review tabs.

## Interaction Model

- Left rail navigation is presentational in Phase 1.
- Fixture rows switch the selected match.
- Filters show all, live, or high-watch matches.
- Tabs switch the center analysis content.
- Compare opens a modal with team metrics.
- Refresh updates the displayed timestamp.
- Variable expansion reveals additional factors.

## Visual Rules

- Dark neutral surface with turf green, gold, cyan, and red as semantic accents.
- Use simple dividers and surface tints before heavy shadows.
- Avoid decorative blobs, one-note purple palettes, oversized marketing hero layouts, and nested cards.
- Keep dense data readable with strong numeric hierarchy and stable component dimensions.

## Copy Tone

Professional, concise, analyst-like. The product should sound useful and grounded, not magical.

User-facing screens should not expose implementation details such as local APIs, model wiring, raw model names, internal source labels, or engineering status logs. Keep those details in API responses, docs, or admin/debug surfaces.

The left-rail account area shows an unauthenticated state by default: blank avatar plus `登录 / 注册`. After authentication it should show the user's avatar, display name, and user ID.

## Accessibility Basics

- Buttons use clear labels or title text.
- Important images have alt text.
- Text should maintain readable contrast on dark surfaces.
- Responsive layout should preserve all core information on narrower screens.
