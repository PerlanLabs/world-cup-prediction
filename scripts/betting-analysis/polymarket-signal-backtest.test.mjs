import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateSignalBacktest,
  buildModelScoreGrid,
  buildSignalBacktestMatch,
  detectWindowSignals,
} from "./polymarket-signal-backtest-core.mjs";
import { assertMovementIdentity, buildEventSlug, buildEventSlugCandidates } from "./polymarket-signal-backtest.mjs";

test("detectWindowSignals uses only the requested historical stage pair", () => {
  const keyMarkets = syntheticKeyMarkets();
  const signals = detectWindowSignals(keyMarkets, { from: "opening", to: "h72" });
  assert.deepEqual(signals.map((signal) => signal.code).sort(), [
    "broad_favorite_strengthening",
    "two_goal_concentration",
  ]);
  assert.equal(signals[0].deltas.favorite_win, 3);
});

test("buildSignalBacktestMatch settles direct and synthetic targets without inventing synthetic ROI", () => {
  const movement = syntheticMovement();
  const match = {
    id: "alpha-beta",
    homeTeamId: "alpha",
    awayTeamId: "beta",
    score: { home: 2, away: 0 },
    official: { dateUtc: "2026-06-01T18:00:00Z" },
  };
  const prediction = {
    id: "pred-alpha-beta",
    generatedAt: "2026-06-01T17:00:00Z",
    audit: { freezeType: "pre_match_final" },
    expectedGoals: { home: 1.8, away: 0.7 },
  };
  const output = buildSignalBacktestMatch({ movement, match, prediction });
  const broad = output.signals.find((signal) => signal.code === "broad_favorite_strengthening");
  const exactTwo = output.signals.find((signal) => signal.code === "two_goal_concentration");

  assert.equal(broad.window.key, "h72");
  assert.equal(broad.won, true);
  assert.equal(broad.tradable, true);
  assert.equal(broad.entryPrice, 0.53);
  assert.equal(broad.closePrice, 0.55);
  assert.equal(broad.clvPp, 2);
  assert.ok(broad.realizedPnl > 0);
  assert.equal(exactTwo.won, true);
  assert.equal(exactTwo.tradable, false);
  assert.equal(exactTwo.realizedPnl, null);
  assert.match(exactTwo.caveat, /Synthetic event/);
});

test("aggregateSignalBacktest separates sample hit rate from executable trade metrics", () => {
  const base = buildSignalBacktestMatch({
    movement: syntheticMovement(),
    match: {
      id: "alpha-beta",
      homeTeamId: "alpha",
      awayTeamId: "beta",
      score: { home: 2, away: 0 },
      official: { dateUtc: "2026-06-01T18:00:00Z" },
    },
    prediction: { expectedGoals: { home: 1.8, away: 0.7 }, audit: { freezeType: "pre_match_final" } },
  });
  const report = aggregateSignalBacktest([base], { feeRate: 0.03 });
  assert.equal(report.sample.matchCount, 1);
  assert.ok(report.sample.signalCount >= 2);
  assert.ok(report.sample.directTradeCount >= 1);
  assert.ok(report.sample.syntheticSignalCount >= 1);
  assert.equal(report.policy.dynamicFeeSchedule, false);
  assert.equal(report.overall.status, "insufficient_sample");
});

test("model score grid is normalized and supports tail probabilities", () => {
  const grid = buildModelScoreGrid({ home: 1.7, away: 1.1 });
  const total = grid.reduce((sum, row) => sum + row.probability, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  assert.ok(grid.some((row) => row.home === 2 && row.away === 1 && row.probability > 0));
});

test("buildEventSlug uses official UTC date and FIFA team codes", () => {
  assert.equal(buildEventSlug({
    id: "mexico-south-africa",
    official: {
      homeCode: "MEX",
      awayCode: "RSA",
      dateUtc: "2026-06-11T19:00:00Z",
    },
  }), "fifwc-mex-rsa-2026-06-11");
  assert.equal(buildEventSlug({
    id: "portugal-uzbekistan",
    official: {
      homeCode: "POR",
      awayCode: "UZB",
      dateUtc: "2026-06-23T17:00:00Z",
    },
  }), "fifwc-prt-uzb-2026-06-23");
  assert.ok(buildEventSlugCandidates({
    id: "panama-croatia",
    official: {
      homeCode: "PAN",
      awayCode: "CRO",
      dateUtc: "2026-06-23T23:00:00Z",
    },
  }).includes("fifwc-pan-hrv-2026-06-23"));
});

test("assertMovementIdentity rejects a fuzzy-search match with the wrong opponent", () => {
  const match = {
    modelHome: "ecuador",
    modelAway: "curacao",
    homeTeamId: "ecuador",
    awayTeamId: "curacao",
    official: { homeCode: "ECU", awayCode: "CUR", dateUtc: "2026-06-21T00:00:00Z" },
  };
  assert.throws(() => assertMovementIdentity({
    event: {
      start_time: "2026-06-21T00:00:00Z",
      teams: [
        { ordering: "home", name: "Ecuador" },
        { ordering: "away", name: "South Korea" },
      ],
    },
  }, match), /event_identity_mismatch/);
  assert.equal(assertMovementIdentity({
    event: {
      start_time: "2026-06-21T00:00:00Z",
      teams: [
        { ordering: "home", name: "Ecuador" },
        { ordering: "away", name: "Curaçao" },
      ],
    },
  }, match), true);
  assert.equal(assertMovementIdentity({
    event: {
      slug: "fifwc-ecu-cuw-2026-06-20",
      start_time: "2026-06-21T00:00:00Z",
      teams: [
        { ordering: "home", name: "Ecuador" },
        { ordering: "away", name: "CuraÃ§ao" },
      ],
    },
  }, match), true);
});

function syntheticMovement() {
  const keyMarkets = syntheticKeyMarkets();
  return {
    event: {
      slug: "fifwc-alp-bet-2026-06-01",
      teams: [
        { ordering: "home", name: "Alpha" },
        { ordering: "away", name: "Beta" },
      ],
    },
    input: { cutoffTime: "2026-06-01T18:00:00Z" },
    dataQuality: { readiness: "ready", issues: [] },
    rows: keyMarkets.map((keyMarket) => ({
      marketSlug: keyMarket.marketSlug,
      tokenId: keyMarket.tokenId,
      movement: { quality: { status: "usable", warnings: [] } },
      openingCoverage: { status: "near_market_creation" },
      history: Object.values(keyMarket.prices).filter(Boolean),
    })),
    marketStructure: {
      event: { slug: "fifwc-alp-bet-2026-06-01", kickoffTime: "2026-06-01T18:00:00Z" },
      teams: {
        home: "Alpha",
        away: "Beta",
        favorite: "Alpha",
        underdog: "Beta",
        favoriteSide: "home",
        underdogSide: "away",
      },
      quality: { readiness: "ready", issues: [] },
      keyMarkets,
    },
  };
}

function syntheticKeyMarkets() {
  return [
    market("favorite_win", "Alpha 90分钟胜", 0.5, 0.53, 0.55),
    market("draw", "90分钟平局", 0.27, 0.26, 0.25),
    market("underdog_win", "Beta 90分钟胜", 0.23, 0.21, 0.2),
    market("favorite_minus_1_5", "Alpha -1.5", 0.3, 0.33, 0.35),
    market("favorite_minus_2_5", "Alpha -2.5", 0.15, 0.15, 0.16),
    market("over_2_5", "全场 O2.5", 0.5, 0.5, 0.51),
    market("over_3_5", "全场 O3.5", 0.28, 0.28, 0.29),
    market("favorite_over_1_5", "Alpha O1.5", 0.58, 0.58, 0.59),
    market("underdog_over_0_5", "Beta O0.5", 0.48, 0.48, 0.49),
    market("btts_yes", "BTTS Yes", 0.44, 0.44, 0.45),
  ];
}

function market(key, label, opening, h72, close) {
  return {
    key,
    label,
    marketSlug: `market-${key}`,
    tokenId: `token-${key}`,
    available: true,
    prices: {
      opening: point(opening, 1),
      d7: null,
      h72: point(h72, 2),
      h24: point(h72, 3),
      h6: point(h72, 4),
      h1: point(h72, 5),
      close: point(close, 6),
    },
  };
}

function point(price, timestamp) {
  return { price, timestamp };
}
