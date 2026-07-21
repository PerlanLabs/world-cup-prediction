const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

export function assertValidStore(store) {
  const report = analyzeStore(store);
  if (report.errorCount === 0) return store;

  const firstIssue = report.issues.find((issue) => issue.severity === "error");
  const error = new Error(firstIssue?.message ?? "Invalid backend store.");
  error.code = "invalid_store";
  error.validation = report;
  throw error;
}

export function analyzeStore(store, options = {}) {
  const issues = [];
  const add = (severity, code, message, path = "") => {
    issues.push({ severity, code, message, path });
  };

  if (!store || typeof store !== "object" || Array.isArray(store)) {
    add("error", "store_not_object", "Backend store must be a JSON object.");
    return buildReport(store, issues);
  }

  const arrays = ["sources", "teams", "matches", "predictions", "modelRuns"];
  for (const key of arrays) {
    if (!Array.isArray(store[key])) {
      add("error", "missing_array", `Store field ${key} must be an array.`, key);
    }
  }

  if (issues.some((issue) => issue.severity === "error")) {
    return buildReport(store, issues);
  }

  validateUniqueIds(store.sources, "sources", add);
  validateUniqueIds(store.teams, "teams", add);
  validateUniqueIds(store.matches, "matches", add);
  validateUniqueIds(store.predictions, "predictions", add);
  validateUniqueIds(store.modelRuns, "modelRuns", add);

  const teamIds = new Set(store.teams.map((team) => team.id));
  const matchIds = new Set(store.matches.map((match) => match.id));
  const predictionIds = new Set(store.predictions.map((prediction) => prediction.id));
  const modelTeams = options.modelTeams ? new Set(options.modelTeams) : null;

  store.sources.forEach((source, index) => validateSource(source, index, add));
  store.teams.forEach((team, index) => validateTeam(team, index, add));
  store.matches.forEach((match, index) => validateMatch(match, index, teamIds, modelTeams, add));
  store.predictions.forEach((prediction, index) => validatePrediction(prediction, index, matchIds, add));
  store.modelRuns.forEach((run, index) => validateModelRun(run, index, matchIds, predictionIds, add));

  for (const match of store.matches) {
    const hasPrediction = store.predictions.some((prediction) => prediction.matchId === match.id);
    if (!hasPrediction && isPredictionAvailable(match)) {
      add("warning", "missing_prediction", `Match ${match.id} does not have a prediction snapshot yet.`, `matches.${match.id}`);
    }
    const hasFrozenPrediction = store.predictions.some(
      (prediction) => prediction.matchId === match.id && prediction.audit?.freezeType === "pre_match_final",
    );
    if (hasFinalScore(match) && isPredictionAvailable(match) && !hasFrozenPrediction) {
      add(
        "warning",
        "missing_frozen_prediction",
        `Completed match ${match.id} does not have a frozen pre-match prediction snapshot.`,
        `matches.${match.id}`,
      );
    }
  }

  return buildReport(store, issues);
}

function validateSource(source, index, add) {
  const path = `sources[${index}]`;
  requireString(source.id, `${path}.id`, add);
  requireString(source.name, `${path}.name`, add);
  requireString(source.retrievedAt, `${path}.retrievedAt`, add);

  if (source.tier != null && !Number.isInteger(source.tier)) {
    add("warning", "source_tier_not_integer", `Source ${source.id} tier should be an integer.`, `${path}.tier`);
  }
}

function validateTeam(team, index, add) {
  const path = `teams[${index}]`;
  requireString(team.id, `${path}.id`, add);
  requireString(team.slug, `${path}.slug`, add);
  requireString(team.name, `${path}.name`, add);
  requireString(team.flagCode, `${path}.flagCode`, add);
}

function validateMatch(match, index, teamIds, modelTeams, add) {
  const path = `matches[${index}]`;
  requireString(match.id, `${path}.id`, add);
  requireString(match.date, `${path}.date`, add);
  requireString(match.kickoffSort, `${path}.kickoffSort`, add);
  requireString(match.homeTeamId, `${path}.homeTeamId`, add);
  requireString(match.awayTeamId, `${path}.awayTeamId`, add);

  if (isPredictionAvailable(match)) {
    requireString(match.modelHome, `${path}.modelHome`, add);
    requireString(match.modelAway, `${path}.modelAway`, add);
  } else if (!match.predictionStatus?.reason) {
    add("error", "missing_prediction_status_reason", `Match ${match.id} is not predictable but has no reason.`, `${path}.predictionStatus`);
  }

  if (typeof match.date === "string" && !DATE_PATTERN.test(match.date)) {
    add("error", "invalid_match_date", `Match ${match.id} has invalid date ${match.date}.`, `${path}.date`);
  }
  if (typeof match.kickoffSort === "string" && !TIME_PATTERN.test(match.kickoffSort)) {
    add("error", "invalid_kickoff_sort", `Match ${match.id} has invalid kickoffSort ${match.kickoffSort}.`, `${path}.kickoffSort`);
  }
  if (match.homeTeamId && !teamIds.has(match.homeTeamId)) {
    add("error", "unknown_home_team", `Match ${match.id} references unknown homeTeamId ${match.homeTeamId}.`, `${path}.homeTeamId`);
  }
  if (match.awayTeamId && !teamIds.has(match.awayTeamId)) {
    add("error", "unknown_away_team", `Match ${match.id} references unknown awayTeamId ${match.awayTeamId}.`, `${path}.awayTeamId`);
  }
  if (match.homeTeamId && match.homeTeamId === match.awayTeamId) {
    add("error", "same_teams", `Match ${match.id} has the same home and away team.`, path);
  }
  if (modelTeams && isPredictionAvailable(match) && match.modelHome && !modelTeams.has(match.modelHome)) {
    add("error", "unknown_model_home", `Match ${match.id} uses unknown modelHome ${match.modelHome}.`, `${path}.modelHome`);
  }
  if (modelTeams && isPredictionAvailable(match) && match.modelAway && !modelTeams.has(match.modelAway)) {
    add("error", "unknown_model_away", `Match ${match.id} uses unknown modelAway ${match.modelAway}.`, `${path}.modelAway`);
  }
  validateLineups(match.lineups, path, add);
}

function validateLineups(lineups, matchPath, add) {
  if (lineups == null) return;
  if (typeof lineups !== "object" || Array.isArray(lineups)) {
    add("error", "invalid_lineups", `${matchPath}.lineups must be an object.`, `${matchPath}.lineups`);
    return;
  }

  validateLineupSource(lineups.official, "official", `${matchPath}.lineups.official`, add);
  validateLineupSource(lineups.expected, "expected", `${matchPath}.lineups.expected`, add);
}

function validateLineupSource(source, expectedType, path, add) {
  if (source == null) return;
  if (typeof source !== "object" || Array.isArray(source)) {
    add("error", "invalid_lineup_source", `${path} must be an object.`, path);
    return;
  }
  if (source.sourceType && source.sourceType !== expectedType) {
    add("error", "invalid_lineup_source_type", `${path}.sourceType must be ${expectedType}.`, `${path}.sourceType`);
  }
  if (source.status === "available") {
    requireString(source.sourceId, `${path}.sourceId`, add);
    requireString(source.retrievedAt, `${path}.retrievedAt`, add);
    if (expectedType === "expected") {
      requireString(source.reviewedAt, `${path}.reviewedAt`, add);
    }
  }
  validateLineupTeam(source.home, `${path}.home`, add);
  validateLineupTeam(source.away, `${path}.away`, add);
}

function validateLineupTeam(lineup, path, add) {
  if (lineup == null) return;
  if (typeof lineup !== "object" || Array.isArray(lineup)) {
    add("error", "invalid_lineup_team", `${path} must be an object.`, path);
    return;
  }
  validatePlayerArray(lineup.starters, `${path}.starters`, add);
  validatePlayerArray(lineup.substitutes, `${path}.substitutes`, add);
  validatePlayerArray(lineup.unavailable, `${path}.unavailable`, add);
}

function validatePlayerArray(players, path, add) {
  if (players == null) return;
  if (!Array.isArray(players)) {
    add("error", "invalid_lineup_players", `${path} must be an array.`, path);
    return;
  }
  players.forEach((player, index) => {
    requireString(player?.name, `${path}[${index}].name`, add);
  });
}

function validatePrediction(prediction, index, matchIds, add) {
  const path = `predictions[${index}]`;
  requireString(prediction.id, `${path}.id`, add);
  requireString(prediction.matchId, `${path}.matchId`, add);
  requireString(prediction.runId, `${path}.runId`, add);
  requireString(prediction.generatedAt, `${path}.generatedAt`, add);

  if (prediction.matchId && !matchIds.has(prediction.matchId)) {
    add("error", "unknown_prediction_match", `Prediction ${prediction.id} references unknown matchId ${prediction.matchId}.`, `${path}.matchId`);
  }
  if (!prediction.probabilityPercent) {
    add("error", "missing_probability_percent", `Prediction ${prediction.id} is missing probabilityPercent.`, `${path}.probabilityPercent`);
  }
}

function validateModelRun(run, index, matchIds, predictionIds, add) {
  const path = `modelRuns[${index}]`;
  requireString(run.id, `${path}.id`, add);
  requireString(run.generatedAt, `${path}.generatedAt`, add);

  if (!Array.isArray(run.matchIds)) {
    add("error", "missing_run_match_ids", `Model run ${run.id} must include matchIds.`, `${path}.matchIds`);
  } else {
    run.matchIds.forEach((matchId) => {
      if (!matchIds.has(matchId)) {
        add("error", "unknown_run_match", `Model run ${run.id} references unknown matchId ${matchId}.`, `${path}.matchIds`);
      }
    });
  }

  if (!Array.isArray(run.predictionIds)) {
    add("error", "missing_run_prediction_ids", `Model run ${run.id} must include predictionIds.`, `${path}.predictionIds`);
  } else {
    run.predictionIds.forEach((predictionId) => {
      if (!predictionIds.has(predictionId)) {
        add("warning", "unknown_run_prediction", `Model run ${run.id} references missing predictionId ${predictionId}.`, `${path}.predictionIds`);
      }
    });
  }
}

function validateUniqueIds(items, key, add) {
  const seen = new Set();
  items.forEach((item, index) => {
    if (!item?.id) return;
    if (seen.has(item.id)) {
      add("error", "duplicate_id", `Duplicate ${key} id ${item.id}.`, `${key}[${index}].id`);
    }
    seen.add(item.id);
  });
}

function requireString(value, path, add) {
  if (typeof value !== "string" || !value.trim()) {
    add("error", "missing_string", `${path} must be a non-empty string.`, path);
  }
}

function isPredictionAvailable(match) {
  return match.predictionStatus?.available !== false;
}

function hasFinalScore(match) {
  return match?.score?.home != null && match?.score?.away != null;
}

function buildReport(store, issues) {
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;

  return {
    ok: errorCount === 0,
    errorCount,
    warningCount,
    checkedAt: new Date().toISOString(),
    schemaVersion: store?.schemaVersion ?? null,
    counts: {
      sources: Array.isArray(store?.sources) ? store.sources.length : 0,
      teams: Array.isArray(store?.teams) ? store.teams.length : 0,
      matches: Array.isArray(store?.matches) ? store.matches.length : 0,
      predictions: Array.isArray(store?.predictions) ? store.predictions.length : 0,
      modelRuns: Array.isArray(store?.modelRuns) ? store.modelRuns.length : 0,
    },
    issues,
  };
}
