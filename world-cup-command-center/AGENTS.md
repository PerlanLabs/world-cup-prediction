# Prototype Instructions

Run the local server yourself and open the preview in the in-app browser. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Selected visual target for Phase 1: `public/assets/reference-command-center.png`, the `赛事指挥舱` direction. Preserve the command-center layout: left navigation, fixture rail, central match analysis, right intelligence stack, dark sports analytics palette, and visible demo-data honesty.

Phase 2A adds a local prediction API at `../prediction-api/server.mjs`. Run `npm run api` from this directory or `node prediction-api/server.mjs` from the repository root before starting the Vite app when validating real model output. The Vite dev server proxies `/api/*` to `http://127.0.0.1:8787`; if the API is unavailable, the UI should fall back to demo data and show `演示数据 fallback`.
