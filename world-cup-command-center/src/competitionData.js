export function buildMatchDays(matches = []) {
  const byDate = new Map();

  for (const match of sortMatches(matches)) {
    const date = match.date ?? "unknown";
    const day = byDate.get(date) ?? {
      date,
      label: match.dateLabel ?? formatShortDate(date),
      weekday: formatWeekday(date),
      matches: [],
      completed: 0,
      pending: 0,
    };

    day.matches.push(match);
    if (isCompletedMatch(match)) {
      day.completed += 1;
    } else {
      day.pending += 1;
    }
    byDate.set(date, day);
  }

  return Array.from(byDate.values()).map((day) => ({
    ...day,
    count: day.matches.length,
  }));
}

export function buildGroupStandings(matches = []) {
  const teamGroupLookup = buildTeamGroupLookup(matches);
  const groups = new Map();

  for (const match of matches) {
    const groupName = groupForMatch(match, teamGroupLookup);
    if (!groups.has(groupName)) groups.set(groupName, new Map());
    const groupRows = groups.get(groupName);
    const homeKey = teamKey(match, "home");
    const awayKey = teamKey(match, "away");
    const home = ensureStandingRow(groupRows, homeKey, match.home);
    const away = ensureStandingRow(groupRows, awayKey, match.away);

    if (!isCompletedMatch(match) || !hasFinalScore(match.score)) continue;

    const homeGoals = Number(match.score.home);
    const awayGoals = Number(match.score.away);
    home.played += 1;
    away.played += 1;
    home.gf += homeGoals;
    home.ga += awayGoals;
    away.gf += awayGoals;
    away.ga += homeGoals;

    if (homeGoals > awayGoals) {
      home.wins += 1;
      away.losses += 1;
      home.points += 3;
    } else if (homeGoals < awayGoals) {
      away.wins += 1;
      home.losses += 1;
      away.points += 3;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
    }
  }

  return Array.from(groups.entries())
    .map(([group, rows]) => ({
      group,
      rows: Array.from(rows.values())
        .map((row) => ({ ...row, gd: row.gf - row.ga }))
        .sort(compareStandingRows),
    }))
    .sort((a, b) => a.group.localeCompare(b.group, "zh-Hans-CN"));
}

export function getMatchDataSummary(matches = []) {
  return matches.reduce(
    (summary, match) => {
      summary.total += 1;
      if (isCompletedMatch(match)) {
        summary.completed += 1;
        if (hasFinalScore(match.score)) {
          summary.goals += Number(match.score.home) + Number(match.score.away);
        }
      } else {
        summary.upcoming += 1;
      }

      if (hasLineupData(match.lineupIntel?.official)) summary.officialLineups += 1;
      if (hasLineupData(match.lineupIntel?.expected)) summary.expectedLineups += 1;
      return summary;
    },
    {
      total: 0,
      completed: 0,
      upcoming: 0,
      goals: 0,
      officialLineups: 0,
      expectedLineups: 0,
    },
  );
}

export function buildPlayerLeaderboards(matches = []) {
  const scorers = new Map();
  const assists = new Map();

  for (const match of matches) {
    const events = Array.isArray(match.matchFacts?.events) ? match.matchFacts.events : [];
    for (const event of events) {
      if (event.type !== "goal") continue;
      const team = event.side === "away" ? match.away : match.home;
      upsertPlayerStat(scorers, {
        playerId: event.playerId,
        playerName: event.playerName,
        team,
        minute: event.minute,
        matchId: match.id,
      });
      if (event.assistPlayerName) {
        upsertPlayerStat(assists, {
          playerId: event.assistPlayerId,
          playerName: event.assistPlayerName,
          team,
          minute: event.minute,
          matchId: match.id,
        });
      }
    }
  }

  return {
    scorers: sortPlayerStats(scorers),
    assists: sortPlayerStats(assists),
  };
}

export function sortMatches(matches = []) {
  return [...matches].sort((a, b) => {
    const dateSort = String(a.date ?? "").localeCompare(String(b.date ?? ""));
    if (dateSort !== 0) return dateSort;
    return String(a.kickoffSort ?? a.time ?? "").localeCompare(String(b.kickoffSort ?? b.time ?? ""));
  });
}

function upsertPlayerStat(map, item) {
  const key = item.playerId ?? `${item.playerName}-${item.team?.name}`;
  const row = map.get(key) ?? {
    key,
    playerName: item.playerName ?? "未知球员",
    team: item.team,
    count: 0,
    minutes: [],
    matches: new Set(),
  };
  row.count += 1;
  if (item.minute) row.minutes.push(item.minute);
  if (item.matchId) row.matches.add(item.matchId);
  map.set(key, row);
}

function sortPlayerStats(map) {
  return Array.from(map.values())
    .map((row) => ({
      ...row,
      matches: row.matches.size,
    }))
    .sort((a, b) => b.count - a.count || a.playerName.localeCompare(b.playerName, "zh-Hans-CN"));
}

export function isCompletedMatch(match) {
  return Boolean(match?.isCompleted) || (match?.status === "已完赛" && hasFinalScore(match?.score));
}

function buildTeamGroupLookup(matches) {
  const lookup = new Map();

  for (const match of matches) {
    if (!isGroupLabel(match.group)) continue;
    lookup.set(teamKey(match, "home"), match.group);
    lookup.set(teamKey(match, "away"), match.group);
    if (match.home?.name) lookup.set(match.home.name, match.group);
    if (match.away?.name) lookup.set(match.away.name, match.group);
  }

  return lookup;
}

function groupForMatch(match, lookup) {
  if (isGroupLabel(match.group)) return match.group;
  return (
    lookup.get(teamKey(match, "home")) ??
    lookup.get(teamKey(match, "away")) ??
    lookup.get(match.home?.name) ??
    lookup.get(match.away?.name) ??
    match.group ??
    "未分组"
  );
}

function isGroupLabel(label) {
  return typeof label === "string" && /[A-H]组/.test(label);
}

function ensureStandingRow(rows, key, team = {}) {
  if (!rows.has(key)) {
    rows.set(key, {
      key,
      team: {
        id: team.id ?? key,
        name: team.name ?? key,
        flag: team.flag,
      },
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      gf: 0,
      ga: 0,
      gd: 0,
      points: 0,
    });
  }

  return rows.get(key);
}

function compareStandingRows(a, b) {
  return (
    b.points - a.points ||
    b.gd - a.gd ||
    b.gf - a.gf ||
    a.team.name.localeCompare(b.team.name, "zh-Hans-CN")
  );
}

function teamKey(match, side) {
  return match?.[`${side}TeamId`] ?? match?.[side]?.id ?? match?.[side]?.name ?? `${side}-unknown`;
}

function hasFinalScore(score = {}) {
  return score?.home != null && score?.away != null;
}

function hasLineupData(source) {
  if (!source) return false;
  return (
    source.status === "available" ||
    hasTeamLineupData(source.home) ||
    hasTeamLineupData(source.away)
  );
}

function hasTeamLineupData(team) {
  return Boolean(
    team?.starters?.length ||
      team?.substitutes?.length ||
      team?.unavailable?.length ||
      team?.formation,
  );
}

function formatShortDate(date) {
  if (!date || date === "unknown") return "日期待定";
  const [, month, day] = date.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

function formatWeekday(date) {
  if (!date || date === "unknown") return "";
  const weekday = new Intl.DateTimeFormat("zh-Hans-CN", { weekday: "short", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
  return weekday.replace("周", "周");
}
