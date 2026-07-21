const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const SCHEDULE_SOURCE = {
  label: "FIFA 官方赛程页",
  url: "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/match-schedule-fixtures-results-teams-stadiums",
  retrievedAt: "2026-06-09",
};

export function getScheduleState(matches, now = new Date()) {
  const todayIso = toLocalDateISO(now);
  const sortedMatches = sortMatches(matches);
  const todayMatches = sortedMatches.filter((match) => match.date === todayIso);
  const firstMatch = sortedMatches[0];
  const daysUntilFirst = firstMatch ? diffDays(todayIso, firstMatch.date) : 0;

  if (todayMatches.length > 0) {
    return {
      mode: "matchday",
      todayIso,
      todayLabel: formatDateLong(todayIso),
      panelTitle: "今日赛程",
      panelSubtitle: `${formatDateLong(todayIso)} · ${todayMatches.length} 场`,
      noticeTitle: "今天有世界杯比赛",
      noticeCopy: "当前列表已按比赛日期筛选，赛前信息会在临近开赛时更新。",
      defaultMatchId: todayMatches[0].id,
    };
  }

  if (firstMatch && daysUntilFirst > 0) {
    return {
      mode: "preTournament",
      todayIso,
      todayLabel: formatDateLong(todayIso),
      panelTitle: "开赛前瞻",
      panelSubtitle: `${formatDateLong(todayIso)} · 距开幕战 ${daysUntilFirst} 天`,
      noticeTitle: "世界杯尚未开始",
      noticeCopy: `今天没有世界杯比赛。当前展示开幕阶段赛程，首场为 ${firstMatch.dateLabel} ${firstMatch.home.name} vs ${firstMatch.away.name}。`,
      defaultMatchId: firstMatch.id,
    };
  }

  return {
    mode: "noMatchday",
    todayIso,
    todayLabel: formatDateLong(todayIso),
    panelTitle: "赛程预览",
      panelSubtitle: `${formatDateLong(todayIso)} · 今日无赛程`,
      noticeTitle: "今日无赛程",
      noticeCopy: "当前展示下一批比赛，赛前信息会在临近开赛时更新。",
    defaultMatchId: firstMatch?.id,
  };
}

export function getVisibleScheduleMatches(matches, filter, state) {
  const sortedMatches = sortMatches(matches);

  if (filter === "today") {
    return sortedMatches.filter((match) => match.date === state.todayIso);
  }
  if (filter === "watch") {
    return sortedMatches.filter((match) => match.watch);
  }

  return sortedMatches;
}

export function sortMatches(matches) {
  return [...matches].sort((a, b) => {
    const dateSort = a.date.localeCompare(b.date);
    if (dateSort !== 0) return dateSort;
    return a.kickoffSort.localeCompare(b.kickoffSort);
  });
}

function toLocalDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function diffDays(fromIso, toIso) {
  return Math.round((dateToUtcMs(toIso) - dateToUtcMs(fromIso)) / MS_PER_DAY);
}

function dateToUtcMs(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function formatDateLong(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}
