import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAcceptedBets, buildManualQatarAdvice, enrichAdviceWithSchedule, parseAdviceHtmlFile, settleAcceptedBets, writeAggregateReports } from "./pnl-core.mjs";
import { writeSyntheticAdviceCard } from "./test-advice-fixture.mjs";

test("parses a single-strategy HTML advice card", () => {
  const advice = parseSyntheticAdvice({
    fileName: "2026-06-14_05-52-11_brazil-vs-morocco_betting-advice-card.html",
    homeName: "Brazil",
    awayName: "Morocco",
    strategies: [{
      name: "主推荐组合",
      bets: [
        bet("Morocco Over 0.5", 20, 0.565),
        bet("Brazil Win", 20, 0.6),
        bet("Under 3.5", 15, 0.6),
        bet("Exact Score 2-1", 15, 0.12),
        bet("Draw", 15, 0.25),
        bet("BTTS Yes", 15, 0.5),
      ],
    }],
  });
  const accepted = buildAcceptedBets(advice);

  assert.equal(advice.match.id, "brazil-morocco");
  assert.equal(accepted.selectedStrategy, "主推荐组合");
  assert.equal(accepted.totalStake, 100);
  assert.equal(accepted.bets.length, 6);
  assert.equal(accepted.bets[0].market, "Morocco Over 0.5");
  assert.equal(accepted.bets[0].price, 0.565);
});

test("uses hedged strategy policy for three-strategy cards", () => {
  const advice = parseSyntheticAdvice({
    fileName: "2026-06-16_04-24-27_iran-vs-new-zealand_betting-advice-card.html",
    homeName: "伊朗",
    awayName: "新西兰",
    strategies: [
      { name: "主推荐组合", bets: [bet("伊朗胜", 100, 0.55)] },
      { name: "EV 最高版", bets: [bet("伊朗 -0.5", 100, 0.5)] },
      {
        name: "对冲稳健版",
        bets: [
          bet("伊朗胜", 20, 0.55),
          bet("伊朗 -0.5", 15, 0.5),
          bet("伊朗 O1.5", 15, 0.5),
          bet("Under 3.5", 10, 0.6),
          bet("Draw", 10, 0.25),
          bet("Exact Score 1-0", 10, 0.12),
          bet("Exact Score 2-0", 10, 0.1),
          bet("BTTS No", 10, 0.55),
        ],
      },
    ],
  });
  const accepted = buildAcceptedBets(advice, { strategyPolicy: "hedged" });

  assert.equal(accepted.selectedStrategy, "对冲稳健版");
  assert.equal(accepted.totalStake, 100);
  assert.equal(accepted.bets.length, 8);
  assert.equal(accepted.bets[0].market, "伊朗胜");
});

test("parses UTF-8 stake-card advice and maps DR Congo schedule alias", () => {
  const advice = enrichAdviceWithSchedule(
    parseSyntheticAdvice({
      fileName: "2026-06-17_21-31-20_portugal-vs-dr-congo_betting-advice-card.html",
      homeName: "葡萄牙",
      awayName: "刚果（金）",
      strategies: [
        { name: "主推荐组合", bets: [bet("葡萄牙胜", 100, 0.6)] },
        { name: "EV 最高版", bets: [bet("葡萄牙 -1.5", 100, 0.4)] },
        { name: "盈利概率最高版", bets: [bet("Under 4.5", 100, 0.7)] },
        {
          name: "对冲稳健版",
          bets: [
            bet("刚果（金） +2.5", 55, 0.65),
            bet("Under 3.5", 40, 0.6),
            bet("保留现金", 5),
          ],
        },
      ],
    }),
    [scheduleMatch("portugal-congo-dr", "2026-06-18", "portugal", "congo-dr")],
  );
  const accepted = buildAcceptedBets(advice, { strategyPolicy: "hedged" });

  assert.equal(advice.match.matchDate, "2026-06-18");
  assert.equal(advice.match.storeMatchId, "portugal-congo-dr");
  assert.equal(advice.strategies.length, 4);
  assert.equal(accepted.selectedStrategy, "对冲稳健版");
  assert.equal(accepted.totalStake, 95);
  assert.equal(accepted.cashReserved, 5);
  assert.equal(accepted.bets[0].market, "刚果（金） +2.5");
  assert.equal(accepted.bets[0].settlement.side, "away");
});

test("supports main strategy policy for UTF-8 advice cards", () => {
  const advice = parseSyntheticAdvice({
    fileName: "2026-06-17_21-31-20_england-vs-croatia_betting-advice-card.html",
    homeName: "英格兰",
    awayName: "克罗地亚",
    strategies: [{
      name: "主推荐组合",
      bets: [bet("克罗地亚胜", 85, 0.3), bet("保留现金", 15)],
    }],
  });
  const accepted = buildAcceptedBets(advice, { strategyPolicy: "main" });

  assert.equal(accepted.selectedStrategy, "主推荐组合");
  assert.equal(accepted.totalStake, 85);
  assert.equal(accepted.cashReserved, 15);
  assert.equal(accepted.bets[0].market, "克罗地亚胜");
  assert.equal(accepted.bets[0].settlement.selection, "away");
});

test("parses inline card main strategy and honors main policy", () => {
  const advice = enrichAdviceWithSchedule(
    parseSyntheticAdvice({
      fileName: "2026-06-18_22-47-30_czechia-vs-south-africa_betting-advice-card.html",
      homeName: "捷克",
      awayName: "南非",
      strategies: [{
        name: "主推荐组合",
        inline: true,
        bets: [
          bet("南非 +1.5", 20, 0.6),
          bet("捷克胜", 10, 0.55),
          bet("Draw", 10, 0.25),
          bet("BTTS No", 8, 0.55),
          bet("Exact Score 1-0", 8, 0.12),
          bet("Exact Score 2-0", 6, 0.1),
          bet("南非 O0.5", 5, 0.45),
          bet("捷克 U2.5", 6, 0.6),
          bet("Under 2.5", 7, 0.5),
          bet("保留现金", 20),
        ],
      }],
    }),
    [scheduleMatch("czech-republic-south-africa", "2026-06-19", "czech-republic", "south-africa")],
  );
  const accepted = buildAcceptedBets(advice, { strategyPolicy: "main" });

  assert.equal(advice.match.matchDate, "2026-06-19");
  assert.equal(advice.match.storeMatchId, "czech-republic-south-africa");
  assert.equal(accepted.selectedStrategy, "主推荐组合");
  assert.equal(accepted.selectedStrategyReason, "user_policy_main");
  assert.equal(accepted.totalStake, 80);
  assert.equal(accepted.cashReserved, 20);
  assert.equal(accepted.bets.length, 9);
  assert.equal(accepted.bets[0].market, "南非 +1.5");
  assert.equal(accepted.bets[0].stake, 20);
  assert.equal(accepted.bets.at(-1).market, "Under 2.5");
  assert.equal(accepted.bets.at(-1).stake, 7);
});

test("maps Bosnia alias and imports hedged inline-card strategy", () => {
  const advice = enrichAdviceWithSchedule(
    parseSyntheticAdvice({
      fileName: "2026-06-18_23-14-00_switzerland-vs-bosnia-herzegovina_betting-advice-card.html",
      homeName: "瑞士",
      awayName: "波黑",
      strategies: [{
        name: "对冲稳健版",
        inline: true,
        bets: [
          bet("瑞士 O1.5", 18, 0.6),
          bet("波黑 +1.5", 12, 0.5),
          bet("Draw", 10, 0.5),
          bet("BTTS No", 8, 0.5),
          bet("准确比分 1-0", 8, 0.12),
          bet("准确比分 2-0", 8, 0.1),
          bet("Under 2.5", 8),
          bet("Over 2.5", 8, 0.5),
          bet("保留现金", 20),
        ],
      }],
      scoreRows: [{ score: "0-0", pnl: -4 }],
    }),
    [scheduleMatch("switzerland-bosnia-and-herzegovina", "2026-06-19", "switzerland", "bosnia-and-herzegovina")],
  );
  const accepted = buildAcceptedBets(advice, { strategyPolicy: "hedged" });

  assert.equal(advice.match.matchDate, "2026-06-19");
  assert.equal(advice.match.storeMatchId, "switzerland-bosnia-and-herzegovina");
  assert.equal(accepted.selectedStrategy, "对冲稳健版");
  assert.equal(accepted.totalStake, 80);
  assert.equal(accepted.cashReserved, 20);
  assert.equal(accepted.bets.length, 8);
  assert.equal(accepted.bets[0].market, "瑞士 O1.5");
  assert.equal(accepted.bets[0].stake, 18);
  assert.deepEqual(accepted.bets[4].settlement, { type: "exact_score", home: 1, away: 0 });
  assert.equal(accepted.bets[6].market, "Under 2.5");
  assert.equal(accepted.bets[6].priceStatus, "inferred_from_score_table");
  assert.equal(accepted.bets[6].price, 0.5);
});

test("does not treat Chinese team-name 大 as over in team totals", () => {
  const advice = enrichAdviceWithSchedule(
    parseSyntheticAdvice({
      fileName: "2026-06-18_23-51-19_canada-vs-qatar_betting-advice-card.html",
      homeName: "加拿大",
      awayName: "卡塔尔",
      strategies: [{
        name: "对冲稳健版",
        bets: [
          bet("卡塔尔 +1.5", 20, 0.5),
          bet("BTTS Yes", 20, 0.5),
          bet("加拿大 U2.5", 20, 0.5),
          bet("Under 2.5", 15, 0.5),
          bet("准确比分 1-0", 15, 0.1),
          bet("加拿大 -2.5", 10),
        ],
      }],
      scoreRows: [{ score: "3-0", pnl: -80 }],
    }),
    [scheduleMatch("canada-qatar", "2026-06-19", "canada", "qatar")],
  );
  const accepted = buildAcceptedBets(advice, { strategyPolicy: "hedged" });

  assert.equal(advice.match.matchDate, "2026-06-19");
  assert.equal(advice.match.storeMatchId, "canada-qatar");
  assert.equal(accepted.selectedStrategy, "对冲稳健版");
  assert.equal(accepted.totalStake, 100);
  assert.equal(accepted.bets[2].market, "加拿大 U2.5");
  assert.equal(accepted.bets[2].settlement.direction, "under");
  assert.equal(accepted.bets[5].market, "加拿大 -2.5");
  assert.equal(accepted.bets[5].priceStatus, "inferred_from_score_table");
  assert.equal(accepted.bets[5].price, 0.5);
});

function parseSyntheticAdvice(options) {
  const root = mkdtempSync(join(tmpdir(), "pnl-advice-fixture-"));
  try {
    return parseAdviceHtmlFile(writeSyntheticAdviceCard(root, options));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function bet(market, stake, price = null) {
  return { market, stake, price };
}

function scheduleMatch(id, date, homeTeamId, awayTeamId) {
  return { id, date, homeTeamId, awayTeamId };
}

test("imports manual Qatar screenshot advice and settles by score", () => {
  const advice = buildManualQatarAdvice([]);
  const accepted = buildAcceptedBets(advice);
  const settlement = settleAcceptedBets(accepted, {
    id: "qatar-switzerland",
    score: { home: 0, away: 1 },
  });

  assert.equal(settlement.status, "settled");
  assert.equal(settlement.netPnl, 69.97);
  assert.equal(settlement.scorePnlReference.difference, 0);
});

test("writes market performance aggregate reports", () => {
  const root = mkdtempSync(join(tmpdir(), "pnl-market-performance-"));
  try {
    const matchDir = join(root, "2026-06-14", "sample-match");
    mkdirSync(matchDir, { recursive: true });
    const accepted = {
      match: {
        id: "sample-match",
        displayName: "样例A vs 样例B",
      },
      selectedStrategy: "主推荐组合",
      totalStake: 30,
      bets: [
        {
          id: "bet-01",
          market: "样例A +1.5",
          stake: 20,
          price: 0.6,
          priceStatus: "available",
          settlement: { type: "spread", side: "home", line: 1.5 },
        },
        {
          id: "bet-02",
          market: "样例A Over 0.5",
          stake: 10,
          price: 0.5,
          priceStatus: "available",
          settlement: { type: "team_total", side: "home", direction: "over", line: 0.5 },
        },
      ],
    };
    const settlement = {
      status: "settled",
      finalScore: { home: 1, away: 1 },
      netPnl: 23.33,
      betResults: [
        { ...accepted.bets[0], status: "settled", won: true, grossReturn: 33.33, pnl: 13.33 },
        { ...accepted.bets[1], status: "settled", won: true, grossReturn: 20, pnl: 10 },
      ],
    };
    writeFileSync(join(matchDir, "accepted-bets.json"), `${JSON.stringify(accepted, null, 2)}\n`, "utf8");
    writeFileSync(join(matchDir, "settlement.json"), `${JSON.stringify(settlement, null, 2)}\n`, "utf8");

    const result = writeAggregateReports(root);
    const markdown = readFileSync(join(result.generatedDir, "market-performance.md"), "utf8");
    const csv = readFileSync(join(result.generatedDir, "market-performance.csv"), "utf8");

    assert.equal(result.acceptedCount, 1);
    assert.match(markdown, /# 盘口类型复盘/);
    assert.match(markdown, /spread/);
    assert.match(markdown, /team_total/);
    assert.match(csv, /marketType,spread/);
    assert.match(csv, /marketType,team_total/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
