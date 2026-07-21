import assert from "node:assert/strict";
import test from "node:test";

import { calculateRecentFormMetrics, getRecentFormsForMatch } from "./team-form.mjs";

test("recent form includes completed synced fixtures before the target kickoff", () => {
  const store = {
    matches: [
      {
        id: "usa-paraguay",
        date: "2026-06-13",
        kickoffSort: "09:00",
        kickoffLocal: "2026-06-13T09:00:00+08:00",
        competition: "世界杯",
        modelHome: "usa",
        modelAway: "paraguay",
        modelVenue: "home",
        score: { home: 2, away: 0 },
      },
      {
        id: "usa-ghana",
        date: "2026-06-16",
        kickoffSort: "09:00",
        kickoffLocal: "2026-06-16T09:00:00+08:00",
        competition: "世界杯",
        modelHome: "usa",
        modelAway: "ghana",
        modelVenue: "home",
        score: { home: null, away: null },
      },
    ],
  };

  const forms = getRecentFormsForMatch(store.matches[1], store);

  assert.equal(forms.home.matches, 5);
  assert.equal(forms.home.sample[0].source, "fifa_synced_results");
  assert.equal(forms.home.sample[0].goalsFor, 2);
  assert.equal(forms.home.sample[0].goalsAgainst, 0);
  assert.equal(forms.home.sample[0].result, "W");
  assert.ok(forms.home.metrics.attack > 0);
  assert.ok(forms.home.metrics.defense > 0);
  assert.ok(forms.home.metrics.stability > 0);
  assert.ok(forms.matchup.metrics.attack > 0);
});

test("recent form excludes the target match itself", () => {
  const target = {
    id: "mexico-south-africa",
    date: "2026-06-12",
    kickoffSort: "03:00",
    kickoffLocal: "2026-06-12T03:00:00+08:00",
    competition: "世界杯",
    modelHome: "mexico",
    modelAway: "south-africa",
    modelVenue: "home",
    score: { home: 1, away: 0 },
  };
  const forms = getRecentFormsForMatch(target, { matches: [target] });

  assert.equal(forms.home.matches, 5);
  assert.notEqual(forms.home.sample[0].id, "store:mexico-south-africa:home");
});

test("recent-form metrics reward attack, defense, and stable results", () => {
  const strong = calculateRecentFormMetrics({
    matches: 5,
    wins: 4,
    draws: 1,
    losses: 0,
    goalsFor: 12,
    goalsAgainst: 2,
    scoringMatches: 5,
    cleanSheets: 3,
  });
  const weak = calculateRecentFormMetrics({
    matches: 5,
    wins: 0,
    draws: 1,
    losses: 4,
    goalsFor: 2,
    goalsAgainst: 12,
    scoringMatches: 2,
    cleanSheets: 0,
  });

  assert.ok(strong.attack > weak.attack);
  assert.ok(strong.defense > weak.defense);
  assert.ok(strong.stability > weak.stability);
  assert.ok(strong.attack <= 100);
  assert.ok(strong.defense <= 100);
  assert.ok(strong.stability <= 100);
});
