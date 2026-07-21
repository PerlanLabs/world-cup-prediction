import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeBook,
  simulateBuyFill,
} from "./polymarket-market-radar.mjs";

test("simulateBuyFill fills a 100u buy through multiple ask levels with sports fee", () => {
  const result = simulateBuyFill([
    { price: 0.5, size: 100 },
    { price: 0.55, size: 200 },
  ], 100, 0.03);

  assert.equal(result.status, "filled");
  assert.equal(result.levelsFilled, 2);
  assert.equal(result.cost, 100);
  assert.equal(result.shares, 190.9091);
  assert.equal(result.avgPrice, 0.52381);
  assert.equal(result.fee, 1.4286);
  assert.equal(result.totalCashRequired, 101.4286);
  assert.equal(result.netProfitIfWin, 89.4805);
  assert.equal(result.netLossIfLose, -101.4286);
});

test("simulateBuyFill marks insufficient depth as partial", () => {
  const result = simulateBuyFill([{ price: 0.4, size: 50 }], 100, 0.03);

  assert.equal(result.status, "partial");
  assert.equal(result.filled, false);
  assert.equal(result.cost, 20);
  assert.equal(result.unfilledUsd, 80);
  assert.equal(result.shares, 50);
  assert.equal(result.avgPrice, 0.4);
});

test("normalizeBook filters bad levels and sorts bids/asks", () => {
  const book = normalizeBook({
    bids: [
      { price: "0.42", size: "10" },
      { price: "0.44", size: "12" },
      { price: "bad", size: "100" },
    ],
    asks: [
      { price: "0.49", size: "5" },
      { price: "0.47", size: "7" },
      { price: "0.5", size: "0" },
    ],
  });

  assert.deepEqual(book.bids, [
    { price: 0.44, size: 12 },
    { price: 0.42, size: 10 },
  ]);
  assert.deepEqual(book.asks, [
    { price: 0.47, size: 7 },
    { price: 0.49, size: 5 },
  ]);
});
