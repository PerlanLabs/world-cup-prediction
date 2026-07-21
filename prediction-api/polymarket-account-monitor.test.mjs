import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPolymarketTokenIndex,
  buildWorldCupPositionGroups,
  calculateSoccerPositionScenario,
  fetchPolymarketAccountSnapshot,
  normalizePolymarketAccountPosition,
} from "./polymarket-account-monitor.mjs";

const fixtureStore = {
  teams: [
    { id: "home", slug: "home", name: "Home", flagCode: "hh" },
    { id: "away", slug: "away", name: "Away", flagCode: "aa" },
  ],
  matches: [
    {
      id: "home-away",
      date: "2026-06-15",
      kickoffLocal: "2026-06-15T20:00:00+08:00",
      status: "scheduled",
      homeTeamId: "home",
      awayTeamId: "away",
      marketOdds: {
        polymarket: {
          moneyline: [
            {
              type: "home",
              label: "Home",
              outcome: "Yes",
              price: 0.5,
              clobTokenId: "home-win-token",
              marketSlug: "home-win",
              question: "Will Home win?",
            },
          ],
          derivativeMarkets: [
            {
              type: "total",
              selection: "over",
              line: 2.5,
              label: "Over 2.5",
              outcome: "Over",
              price: 0.4,
              clobTokenId: "over-token",
              marketSlug: "total-over-25",
              question: "O/U 2.5",
            },
            {
              type: "spread",
              side: "away",
              selection: "cover",
              line: 1.5,
              label: "Away +1.5",
              outcome: "Away",
              price: 0.6,
              clobTokenId: "away-plus-token",
              marketSlug: "away-plus-15",
              question: "Spread Home -1.5",
            },
          ],
        },
      },
    },
  ],
};

test("maps account position token ids to stored World Cup markets", () => {
  const index = buildPolymarketTokenIndex(fixtureStore);
  const position = normalizePolymarketAccountPosition(
    {
      asset: "away-plus-token",
      size: 5,
      avgPrice: 0.6,
      curPrice: 0.7,
      title: "Away +1.5",
    },
    index,
  );

  assert.equal(position.match.id, "home-away");
  assert.equal(position.market.marketType, "spread");
  assert.equal(position.market.side, "away");
  assert.equal(position.cost, 3);
  assert.equal(position.currentValue, 3.5);
});

test("calculates soccer settlement scenarios from share payouts", () => {
  const index = buildPolymarketTokenIndex(fixtureStore);
  const positions = [
    normalizePolymarketAccountPosition({ asset: "home-win-token", size: 10, avgPrice: 0.5 }, index),
    normalizePolymarketAccountPosition({ asset: "over-token", size: 20, avgPrice: 0.4 }, index),
    normalizePolymarketAccountPosition({ asset: "away-plus-token", size: 5, avgPrice: 0.6 }, index),
  ];

  assert.deepEqual(calculateSoccerPositionScenario(positions[0], 2, 1), {
    tokenId: "home-win-token",
    label: "Home",
    wins: true,
    payout: 10,
    netPnl: 5,
  });
  assert.equal(calculateSoccerPositionScenario(positions[1], 1, 1).wins, false);
  assert.equal(calculateSoccerPositionScenario(positions[2], 3, 1).wins, false);

  const [group] = buildWorldCupPositionGroups({ positions, scenarioMaxGoals: 3 });
  const twoOne = group.scenarioGrid.find((scenario) => scenario.score === "2-1");
  const threeOne = group.scenarioGrid.find((scenario) => scenario.score === "3-1");

  assert.equal(twoOne.netPnl, 19);
  assert.equal(threeOne.netPnl, 14);
  assert.deepEqual(twoOne.winningPositions, ["Home", "Over 2.5", "Away +1.5"]);
});

test("fetches public wallet snapshot without wallet signatures or trading permissions", async () => {
  const fetchImpl = async (url) => {
    const pathname = new URL(url).pathname;
    const payloadByPath = {
      "/positions": [
        { asset: "home-win-token", size: 10, avgPrice: 0.5, curPrice: 0.75 },
        { asset: "unknown-token", size: 2, avgPrice: 0.2, curPrice: 0.3 },
      ],
      "/closed-positions": [],
      "/activity": [{ id: "activity-1", type: "BUY", price: 0.5, shares: 10 }],
      "/trades": [{ id: "trade-1", side: "BUY", price: 0.5, shares: 10 }],
      "/value": { value: 8.1, pnl: 1.1 },
    };
    return new Response(JSON.stringify(payloadByPath[pathname]), { status: 200 });
  };

  const snapshot = await fetchPolymarketAccountSnapshot({
    store: fixtureStore,
    address: "0x1111111111111111111111111111111111111111",
    fetchImpl,
    fetchedAt: "2026-06-15T00:00:00.000Z",
  });

  assert.equal(snapshot.permissions.readOnly, true);
  assert.equal(snapshot.permissions.canTrade, false);
  assert.equal(snapshot.permissions.requiresPrivateKey, false);
  assert.equal(snapshot.totals.openPositionCount, 2);
  assert.equal(snapshot.totals.matchedWorldCupPositionCount, 1);
  assert.equal(snapshot.totals.unmatchedOpenPositionCount, 1);
  assert.equal(snapshot.worldCup.groups[0].match.id, "home-away");
});
