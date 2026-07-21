import { dirname } from "node:path";
import { getStore } from "./store.mjs";
import { syncOfficialFixtures, syncOfficialMatchFacts } from "./backend-service.mjs";
import {
  scanAcceptedBetFiles,
  settleAcceptedBets,
  writeAggregateReports,
  writeSettlementOutputs,
} from "./pnl-core.mjs";
import { readFileSync } from "node:fs";

const TEAM_EQUIVALENTS = buildTeamEquivalents([
  ["bosnia-herzegovina", "bosnia-and-herzegovina"],
  ["cote-divoire", "ivory-coast"],
  ["czechia", "czech-republic"],
  ["united-states", "usa"],
  ["turkiye", "turkey"],
  ["dr-congo", "congo-dr"],
]);

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

try {
  const sync = args.skipSync ? null : await syncOfficialResults(args);
  const store = getStore();
  const matchesById = new Map(store.matches.map((match) => [match.id, match]));
  const acceptedFiles = scanAcceptedBetFiles(args.root);
  const settled = [];

  for (const file of acceptedFiles) {
    const accepted = JSON.parse(readFileSync(file, "utf8"));
    if (args.matchIds.length > 0 && !args.matchIds.includes(accepted.match.id)) continue;
    const match = findMatchRecord(accepted.match, store.matches, matchesById);
    const settlement = settleAcceptedBets(accepted, match);
    writeSettlementOutputs(dirname(file), accepted, settlement);
    settled.push({
      matchId: accepted.match.id,
      match: accepted.match.displayName,
      status: settlement.status,
      netPnl: settlement.netPnl ?? null,
      finalScore: settlement.finalScore ?? null,
    });
  }

  const aggregate = writeAggregateReports(args.root);
  const payload = {
    ok: true,
    sync,
    checkedCount: settled.length,
    settled,
    aggregate,
  };

  if (args.json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`P&L settlement completed. Checked ${settled.length} match(es).`);
    for (const item of settled) {
      const score = item.finalScore ? ` ${item.finalScore.home}-${item.finalScore.away}` : "";
      const pnl = item.netPnl == null ? "" : ` ${item.netPnl >= 0 ? "+" : ""}${item.netPnl}u`;
      console.log(`- ${item.match}:${score} ${item.status}${pnl}`);
    }
  }
} catch (error) {
  const payload = {
    ok: false,
    error: {
      code: error.code ?? "pnl_settle_failed",
      message: error.message,
    },
  };
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
}

function findMatchRecord(acceptedMatch, matches, matchesById) {
  const stored = acceptedMatch.storeMatchId ? matchesById.get(acceptedMatch.storeMatchId) : null;
  if (stored) {
    if (
      sameTeam(stored.homeTeamId, acceptedMatch.homeSlug) &&
      sameTeam(stored.awayTeamId, acceptedMatch.awaySlug)
    ) return stored;
    if (
      sameTeam(stored.homeTeamId, acceptedMatch.awaySlug) &&
      sameTeam(stored.awayTeamId, acceptedMatch.homeSlug)
    ) return flipMatchRecord(stored, acceptedMatch);
    return stored;
  }

  const exact = matchesById.get(acceptedMatch.id);
  if (exact) return exact;

  const direct = matches.find((match) => (
    sameTeam(match.homeTeamId, acceptedMatch.homeSlug) &&
    sameTeam(match.awayTeamId, acceptedMatch.awaySlug)
  ));
  if (direct) return direct;

  const reversed = matches.find((match) => (
    sameTeam(match.homeTeamId, acceptedMatch.awaySlug) &&
    sameTeam(match.awayTeamId, acceptedMatch.homeSlug)
  ));
  if (!reversed) return null;
  return flipMatchRecord(reversed, acceptedMatch);
}

function flipMatchRecord(match, acceptedMatch) {
  return {
    ...match,
    id: acceptedMatch.id,
    homeTeamId: acceptedMatch.homeSlug,
    awayTeamId: acceptedMatch.awaySlug,
    score: flipScore(match.score),
    matchFacts: match.matchFacts ? {
      ...match.matchFacts,
      score: flipScore(match.matchFacts.score),
    } : match.matchFacts,
  };
}

function flipScore(score) {
  if (!score) return score;
  return {
    home: score.away,
    away: score.home,
  };
}

function sameTeam(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const leftSet = TEAM_EQUIVALENTS.get(left) ?? new Set([left]);
  const rightSet = TEAM_EQUIVALENTS.get(right) ?? new Set([right]);
  return [...leftSet].some((item) => rightSet.has(item));
}

function buildTeamEquivalents(groups) {
  const map = new Map();
  for (const group of groups) {
    const set = new Set(group);
    for (const item of group) map.set(item, set);
  }
  return map;
}

async function syncOfficialResults(args) {
  const fixtureSync = await syncOfficialFixtures({
    mode: args.fixtureMode,
    language: args.language,
  });
  const syncMatchIds = resolveSyncMatchIds(args.matchIds, getStore().matches);
  const factsSync = await syncOfficialMatchFacts({
    matchIds: syncMatchIds.length > 0 ? syncMatchIds : undefined,
    mode: args.factsMode,
    language: args.language,
  });
  return {
    fixtureSync: {
      importedCount: fixtureSync.importedCount,
      skippedCount: fixtureSync.skippedCount,
      fetchedAt: fixtureSync.fetchedAt,
    },
    factsSync: {
      importedCount: factsSync.importedCount,
      skippedCount: factsSync.skippedCount,
      selectedCount: factsSync.selection?.selectedCount,
    },
  };
}

function resolveSyncMatchIds(matchIds, matches) {
  if (!matchIds.length) return [];
  return matchIds.map((matchId) => resolveSyncMatchId(matchId, matches));
}

function resolveSyncMatchId(matchId, matches) {
  if (matches.some((match) => match.id === matchId)) return matchId;
  for (const match of matches) {
    for (const homeAlias of teamAliases(match.homeTeamId)) {
      for (const awayAlias of teamAliases(match.awayTeamId)) {
        if (`${homeAlias}-${awayAlias}` === matchId) return match.id;
      }
    }
  }
  return matchId;
}

function teamAliases(teamId) {
  return TEAM_EQUIVALENTS.get(teamId) ?? new Set([teamId]);
}

function parseArgs(argv) {
  const parsed = {
    root: "盈亏分析",
    matchIds: [],
    fixtureMode: "mapped",
    factsMode: "completed",
    language: undefined,
    skipSync: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      parsed.root = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--match-id") {
      parsed.matchIds.push(requireValue(argv, index, arg));
      index += 1;
    } else if (arg === "--fixture-mode") {
      parsed.fixtureMode = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--facts-mode") {
      parsed.factsMode = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--language") {
      parsed.language = requireValue(argv, index, arg);
      index += 1;
    } else if (arg === "--skip-sync") {
      parsed.skipSync = true;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--help" || arg === "-h") {
      parsed.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!["mapped", "supported", "predictable"].includes(parsed.fixtureMode)) {
    throw new Error("--fixture-mode must be mapped, supported, or predictable.");
  }
  if (!["completed", "all"].includes(parsed.factsMode)) {
    throw new Error("--facts-mode must be completed or all.");
  }
  return parsed;
}

function requireValue(argv, index, arg) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
  return value;
}

function printHelp() {
  console.log(`Usage: node prediction-api/pnl-settle.mjs [options]

Options:
  --skip-sync              Do not fetch FIFA updates before settlement.
  --match-id <id>          Settle one local match id. Can be repeated.
  --fixture-mode <mode>    FIFA fixture import mode. Defaults to mapped.
  --facts-mode <mode>      Match facts sync mode. Defaults to completed.
  --language <code>        FIFA API language. Defaults to en.
  --root <path>            P&L folder. Defaults to 盈亏分析.
  --json                   Print machine-readable JSON.
  --help                   Show this help.
`);
}
