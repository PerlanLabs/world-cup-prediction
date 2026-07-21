import assert from "node:assert/strict";
import test from "node:test";

import { buildStrategyAnalysis } from "./strategyAnalysis.js";

test("buildStrategyAnalysis waits for single-match odds when only trophy market exists", () => {
  const strategy = buildStrategyAnalysis(match({
    homeMarket: { impliedProbabilityPercent: 8.4, price: 0.084 },
    awayMarket: { impliedProbabilityPercent: 1.6, price: 0.016 },
  }));

  assert.equal(strategy.hasModel, true);
  assert.equal(strategy.hasSingleMatchMarkets, false);
  assert.equal(strategy.trophySignals.length, 2);
  assert.equal(strategy.portfolio, null);
  assert.match(strategy.summary.title, /等待单场盘口/);
});

test("buildStrategyAnalysis uses Polymarket more-markets for portfolio and score scenarios", () => {
  const strategy = buildStrategyAnalysis(match({
    marketOdds: {
      polymarket: {
        moneyline: [
          { type: "home", label: "巴西", impliedProbabilityPercent: 58.5, price: 0.585 },
          { type: "draw", label: "平局", impliedProbabilityPercent: 25.5, price: 0.255 },
          { type: "away", label: "摩洛哥", impliedProbabilityPercent: 16.5, price: 0.165 },
        ],
        derivativeMarkets: [
          { key: "away-over-0.5", label: "摩洛哥进球大 0.5", impliedProbabilityPercent: 56.5, price: 0.565 },
          { key: "away+1.5", label: "摩洛哥 +1.5", impliedProbabilityPercent: 68.5, price: 0.685 },
          { key: "btts-yes", label: "双方进球 Yes", impliedProbabilityPercent: 47.5, price: 0.475 },
          { key: "total-over-2.5", label: "大 2.5 球", impliedProbabilityPercent: 44.5, price: 0.445 },
          { key: "away-over-1.5", label: "摩洛哥进球大 1.5", impliedProbabilityPercent: 19.5, price: 0.195 },
        ],
      },
    },
  }));

  const awayGoal = strategy.marketRows.find((row) => row.key === "away-over-0.5");
  const awayWin = strategy.marketRows.find((row) => row.key === "away-win");

  assert.equal(strategy.hasSingleMatchMarkets, true);
  assert.equal(strategy.hasDerivativeMarkets, true);
  assert.equal(awayWin.edge, 6.3);
  assert.equal(awayGoal.verdict, "强价值");
  assert.equal(strategy.portfolio.status, "ready");
  assert.equal(strategy.portfolio.rows.reduce((sum, row) => sum + row.units, 0), 100);
  assert.equal(strategy.portfolio.rows.some((row) => row.key === "away-over-0.5"), true);
  assert.equal(strategy.portfolio.rows.some((row) => row.key === "away+1.5"), true);
  assert.equal(strategy.portfolio.scoreRows.some((row) => row.line === "1-1" && row.net > 0), true);
  assert.equal(strategy.portfolio.scoreRows.some((row) => row.line === "2-0" && row.net < 0), true);
});

function match(overrides = {}) {
  return {
    home: {
      name: "巴西",
      flag: "/assets/flags/br.png",
      profile: {
        marketSignals: {
          polymarket: {
            worldCupWinner: overrides.homeMarket,
          },
        },
      },
    },
    away: {
      name: "摩洛哥",
      flag: "/assets/flags/ma.png",
      profile: {
        marketSignals: {
          polymarket: {
            worldCupWinner: overrides.awayMarket,
          },
        },
      },
    },
    probabilities: [
      { type: "home", label: "胜", value: 49.6 },
      { type: "draw", label: "平", value: 27.6 },
      { type: "away", label: "胜", value: 22.8 },
    ],
    modelPrediction: {
      expectedGoals: { home: 1.65, away: 1.06 },
      scorelines: [
        { line: "1-1", probabilityPercent: 13.2 },
        { line: "2-1", probabilityPercent: 9.6 },
        { line: "1-0", probabilityPercent: 9.5 },
        { line: "2-0", probabilityPercent: 9.1 },
        { line: "0-0", probabilityPercent: 8.2 },
        { line: "1-2", probabilityPercent: 6.2 },
      ],
    },
    marketOdds: overrides.marketOdds,
  };
}
