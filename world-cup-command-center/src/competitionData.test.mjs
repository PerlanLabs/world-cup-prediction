import assert from "node:assert/strict";
import test from "node:test";

import { buildGroupStandings, buildMatchDays, buildPlayerLeaderboards, getMatchDataSummary } from "./competitionData.js";

const flag = (code) => `/assets/flags/${code}.png`;

test("buildGroupStandings calculates points and tie breakers from final scores", () => {
  const standings = buildGroupStandings([
    match({
      id: "opener",
      group: "世界杯 开幕战",
      homeTeamId: "mexico",
      awayTeamId: "south-africa",
      home: "墨西哥",
      away: "南非",
      score: { home: 2, away: 0 },
    }),
    match({
      id: "group-a-second",
      group: "世界杯 A组",
      homeTeamId: "korea",
      awayTeamId: "czechia",
      home: "韩国",
      away: "捷克",
      score: { home: 2, away: 1 },
    }),
    match({
      id: "future",
      group: "世界杯 A组",
      homeTeamId: "mexico",
      awayTeamId: "korea",
      home: "墨西哥",
      away: "韩国",
      score: { home: null, away: null },
    }),
  ]);

  assert.equal(standings.length, 1);
  assert.equal(standings[0].group, "世界杯 A组");
  assert.deepEqual(
    standings[0].rows.map((row) => [row.team.name, row.played, row.wins, row.losses, row.gf, row.ga, row.points]),
    [
      ["墨西哥", 1, 1, 0, 2, 0, 3],
      ["韩国", 1, 1, 0, 2, 1, 3],
      ["捷克", 1, 0, 1, 1, 2, 0],
      ["南非", 1, 0, 1, 0, 2, 0],
    ],
  );
});

test("buildMatchDays groups matches chronologically and summarizes completion", () => {
  const days = buildMatchDays([
    match({ id: "late", date: "2026-06-13", kickoffSort: "09:00", score: { home: null, away: null } }),
    match({ id: "early", date: "2026-06-12", kickoffSort: "03:00", score: { home: 2, away: 0 } }),
    match({ id: "middle", date: "2026-06-12", kickoffSort: "10:00", score: { home: 2, away: 1 } }),
  ]);

  assert.equal(days.length, 2);
  assert.equal(days[0].date, "2026-06-12");
  assert.equal(days[0].completed, 2);
  assert.equal(days[0].pending, 0);
  assert.equal(days[1].pending, 1);
});

test("buildGroupStandings ignores placeholder scores for matches that are not completed", () => {
  const standings = buildGroupStandings([
    match({
      id: "pending-placeholder",
      homeTeamId: "mexico",
      awayTeamId: "korea",
      home: "墨西哥",
      away: "韩国",
      score: { home: 0, away: 0 },
      status: "未开赛",
      isCompleted: false,
    }),
  ]);

  assert.equal(standings[0].rows[0].played, 0);
  assert.equal(standings[0].rows[0].points, 0);
  assert.equal(standings[0].rows[1].played, 0);
  assert.equal(standings[0].rows[1].points, 0);
});

test("getMatchDataSummary counts official and expected lineup coverage", () => {
  const summary = getMatchDataSummary([
    match({
      id: "done",
      score: { home: 2, away: 0 },
      lineupIntel: {
        official: { status: "available", home: { starters: [{ name: "A" }] }, away: {} },
        expected: { status: "not_available", home: {}, away: {} },
      },
    }),
    match({
      id: "pending",
      score: { home: null, away: null },
      lineupIntel: {
        expected: { status: "available", home: { starters: [{ name: "B" }] }, away: {} },
      },
    }),
  ]);

  assert.equal(summary.total, 2);
  assert.equal(summary.completed, 1);
  assert.equal(summary.upcoming, 1);
  assert.equal(summary.goals, 2);
  assert.equal(summary.officialLineups, 1);
  assert.equal(summary.expectedLineups, 1);
});

test("buildPlayerLeaderboards derives scorer and assist tables from official goal events", () => {
  const leaderboards = buildPlayerLeaderboards([
    match({
      id: "with-events",
      matchFacts: {
        events: [
          {
            type: "goal",
            side: "home",
            playerId: "p1",
            playerName: "Scorer One",
            assistPlayerId: "a1",
            assistPlayerName: "Creator One",
            minute: "9'",
          },
          {
            type: "goal",
            side: "home",
            playerId: "p1",
            playerName: "Scorer One",
            minute: "67'",
          },
          {
            type: "booking",
            side: "away",
            playerName: "Booked Player",
          },
        ],
      },
    }),
  ]);

  assert.equal(leaderboards.scorers[0].playerName, "Scorer One");
  assert.equal(leaderboards.scorers[0].count, 2);
  assert.equal(leaderboards.scorers[0].team.name, "Home");
  assert.equal(leaderboards.assists[0].playerName, "Creator One");
  assert.equal(leaderboards.assists[0].count, 1);
});

function match(overrides = {}) {
  const score = overrides.score ?? { home: 0, away: 0 };
  const hasScore = score.home != null && score.away != null;
  return {
    id: overrides.id ?? "match",
    date: overrides.date ?? "2026-06-12",
    dateLabel: overrides.dateLabel ?? "6月12日",
    kickoffSort: overrides.kickoffSort ?? "03:00",
    group: overrides.group ?? "世界杯 A组",
    status: overrides.status ?? (hasScore ? "已完赛" : "未开赛"),
    isCompleted: overrides.isCompleted ?? hasScore,
    score,
    homeTeamId: overrides.homeTeamId ?? "home",
    awayTeamId: overrides.awayTeamId ?? "away",
    home: { name: overrides.home ?? "Home", flag: flag("mx") },
    away: { name: overrides.away ?? "Away", flag: flag("za") },
    lineupIntel: overrides.lineupIntel,
    matchFacts: overrides.matchFacts,
  };
}
