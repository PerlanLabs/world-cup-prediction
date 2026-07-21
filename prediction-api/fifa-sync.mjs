const FIFA_COMPETITION_ID = "17";
const FIFA_SEASON_ID = "285023";
const FIFA_SOURCE_ID = "fifa-api-world-cup-2026-calendar";
const FIFA_FIXTURE_FROM = "2026-06-01";
const FIFA_FIXTURE_TO = "2026-07-31";
const HONG_KONG_TIME_ZONE = "Asia/Hong_Kong";
const FLAG_IMAGE_CODES = new Map([
  ["ALG", "dz"],
  ["ARG", "ar"],
  ["AUS", "au"],
  ["AUT", "at"],
  ["BEL", "be"],
  ["BIH", "ba"],
  ["BRA", "br"],
  ["CAN", "ca"],
  ["CIV", "ci"],
  ["COD", "cd"],
  ["COL", "co"],
  ["CPV", "cv"],
  ["CRO", "hr"],
  ["CUW", "cw"],
  ["CZE", "cz"],
  ["ECU", "ec"],
  ["EGY", "eg"],
  ["ENG", "gb-eng"],
  ["ESP", "es"],
  ["FRA", "fr"],
  ["GER", "de"],
  ["GHA", "gh"],
  ["HAI", "ht"],
  ["IRN", "ir"],
  ["IRQ", "iq"],
  ["JOR", "jo"],
  ["JPN", "jp"],
  ["KOR", "kr"],
  ["KSA", "sa"],
  ["MAR", "ma"],
  ["MEX", "mx"],
  ["NED", "nl"],
  ["NOR", "no"],
  ["NZL", "nz"],
  ["PAN", "pa"],
  ["PAR", "py"],
  ["POR", "pt"],
  ["QAT", "qa"],
  ["RSA", "za"],
  ["SCO", "gb-sct"],
  ["SEN", "sn"],
  ["SUI", "ch"],
  ["SWE", "se"],
  ["TUN", "tn"],
  ["TUR", "tr"],
  ["URU", "uy"],
  ["USA", "us"],
  ["UZB", "uz"],
]);

const MODEL_SLUG_OVERRIDES = new Map([
  ["AUT", "austria"],
  ["COD", "dr-congo"],
  ["CPV", "cape-verde"],
  ["CUW", "curacao"],
  ["IRQ", "iraq"],
  ["NOR", "norway"],
  ["SWE", "sweden"],
  ["TUR", "turkey"],
  ["UZB", "uzbekistan"],
]);

const FIFA_TEAM_MAP = new Map([
  ["ALG", team("ALG", "algeria", "algeria", "阿尔及利亚")],
  ["ARG", team("ARG", "argentina", "argentina", "阿根廷")],
  ["AUS", team("AUS", "australia", "australia", "澳大利亚")],
  ["AUT", team("AUT", "austria", null, "奥地利")],
  ["BEL", team("BEL", "belgium", "belgium", "比利时")],
  ["BIH", team("BIH", "bosnia-and-herzegovina", "bosnia-and-herzegovina", "波黑")],
  ["BRA", team("BRA", "brazil", "brazil", "巴西")],
  ["CAN", team("CAN", "canada", "canada", "加拿大")],
  ["CIV", team("CIV", "ivory-coast", "ivory-coast", "科特迪瓦")],
  ["COD", team("COD", "congo-dr", null, "刚果民主共和国")],
  ["COL", team("COL", "colombia", "colombia", "哥伦比亚")],
  ["CPV", team("CPV", "cabo-verde", null, "佛得角")],
  ["CRO", team("CRO", "croatia", "croatia", "克罗地亚")],
  ["CUW", team("CUW", "curacao", null, "库拉索")],
  ["CZE", team("CZE", "czech-republic", "czech-republic", "捷克")],
  ["ECU", team("ECU", "ecuador", "ecuador", "厄瓜多尔")],
  ["EGY", team("EGY", "egypt", "egypt", "埃及")],
  ["ENG", team("ENG", "england", "england", "英格兰")],
  ["ESP", team("ESP", "spain", "spain", "西班牙")],
  ["FRA", team("FRA", "france", "france", "法国")],
  ["GER", team("GER", "germany", "germany", "德国")],
  ["GHA", team("GHA", "ghana", "ghana", "加纳")],
  ["HAI", team("HAI", "haiti", "haiti", "海地")],
  ["IRN", team("IRN", "iran", "iran", "伊朗")],
  ["IRQ", team("IRQ", "iraq", null, "伊拉克")],
  ["JOR", team("JOR", "jordan", "jordan", "约旦")],
  ["JPN", team("JPN", "japan", "japan", "日本")],
  ["KOR", team("KOR", "south-korea", "south-korea", "韩国")],
  ["KSA", team("KSA", "saudi-arabia", "saudi-arabia", "沙特阿拉伯")],
  ["MAR", team("MAR", "morocco", "morocco", "摩洛哥")],
  ["MEX", team("MEX", "mexico", "mexico", "墨西哥")],
  ["NED", team("NED", "netherlands", "netherlands", "荷兰")],
  ["NOR", team("NOR", "norway", null, "挪威")],
  ["NZL", team("NZL", "new-zealand", "new-zealand", "新西兰")],
  ["PAN", team("PAN", "panama", "panama", "巴拿马")],
  ["PAR", team("PAR", "paraguay", "paraguay", "巴拉圭")],
  ["POR", team("POR", "portugal", "portugal", "葡萄牙")],
  ["QAT", team("QAT", "qatar", "qatar", "卡塔尔")],
  ["RSA", team("RSA", "south-africa", "south-africa", "南非")],
  ["SCO", team("SCO", "scotland", "scotland", "苏格兰")],
  ["SEN", team("SEN", "senegal", "senegal", "塞内加尔")],
  ["SUI", team("SUI", "switzerland", "switzerland", "瑞士")],
  ["SWE", team("SWE", "sweden", null, "瑞典")],
  ["TUN", team("TUN", "tunisia", "tunisia", "突尼斯")],
  ["TUR", team("TUR", "turkiye", null, "土耳其")],
  ["URU", team("URU", "uruguay", "uruguay", "乌拉圭")],
  ["USA", team("USA", "usa", "usa", "美国")],
  ["UZB", team("UZB", "uzbekistan", null, "乌兹别克斯坦")],
]);

export function getFifaCodeForTeamId(teamId) {
  for (const [code, teamValue] of FIFA_TEAM_MAP.entries()) {
    if (teamValue.id === teamId) return code;
  }
  return null;
}

export function buildFifaFixturesUrl(options = {}) {
  const params = new URLSearchParams({
    language: options.language ?? "en",
    count: String(options.count ?? 200),
    idCompetition: options.idCompetition ?? FIFA_COMPETITION_ID,
    idSeason: options.idSeason ?? FIFA_SEASON_ID,
    from: options.from ?? FIFA_FIXTURE_FROM,
    to: options.to ?? FIFA_FIXTURE_TO,
  });

  return `https://api.fifa.com/api/v3/calendar/matches?${params.toString()}`;
}

export async function fetchFifaFixtures(options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = options.url ?? buildFifaFixturesUrl(options);
  const response = await fetchImpl(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "world-cup-prediction-local-sync/0.1",
    },
  });

  if (!response.ok) {
    const error = new Error(`FIFA fixture sync failed with HTTP ${response.status}.`);
    error.status = response.status;
    error.code = "source_fetch_failed";
    throw error;
  }

  const payload = await response.json();
  if (!Array.isArray(payload.Results)) {
    const error = new Error("FIFA fixture sync response did not include Results array.");
    error.status = 502;
    error.code = "source_shape_changed";
    throw error;
  }

  return {
    url,
    fetchedAt: options.fetchedAt ?? new Date().toISOString(),
    rawCount: payload.Results.length,
    continuationToken: payload.ContinuationToken ?? null,
    fixtures: payload.Results.map(normalizeFifaFixture).filter(Boolean),
  };
}

export function applyFifaFixturesToStore(store, syncPayload, options = {}) {
  const imported = [];
  const skipped = [];
  const importedPredictable = [];
  const importedModelUnsupported = [];
  const mode = options.mode ?? "mapped";

  const nextStore = structuredClone(store);
  for (const fixture of syncPayload.fixtures) {
    if (!fixture.homeTeam || !fixture.awayTeam) {
      skipped.push({ idMatch: fixture.idMatch, reason: "unmapped_team", home: fixture.homeCode, away: fixture.awayCode });
      continue;
    }

    const predictable = isPredictableFixture(fixture);

    if (mode === "predictable" && !predictable) {
      skipped.push({
        idMatch: fixture.idMatch,
        reason: "unsupported_model_team",
        home: fixture.homeCode,
        away: fixture.awayCode,
      });
      continue;
    }

    const match = toBackendMatch(fixture, nextStore.matches);
    upsertById(nextStore.teams, fixture.homeTeam);
    upsertById(nextStore.teams, fixture.awayTeam);
    upsertById(nextStore.matches, match);
    imported.push(match.id);
    if (predictable) {
      importedPredictable.push(match.id);
    } else {
      importedModelUnsupported.push(match.id);
    }
  }

  upsertById(nextStore.sources, buildFifaSource(syncPayload, {
    imported,
    skipped,
    importedPredictable,
    importedModelUnsupported,
  }));

  return {
    store: nextStore,
    summary: {
      sourceId: FIFA_SOURCE_ID,
      sourceUrl: syncPayload.url,
      fetchedAt: syncPayload.fetchedAt,
      rawCount: syncPayload.rawCount,
      normalizedCount: syncPayload.fixtures.length,
      importedCount: imported.length,
      predictableImportedCount: importedPredictable.length,
      modelUnsupportedImportedCount: importedModelUnsupported.length,
      skippedCount: skipped.length,
      importedMatchIds: imported,
      predictableMatchIds: importedPredictable,
      modelUnsupportedMatchIds: importedModelUnsupported,
      skipped,
      mode,
    },
  };
}

export function normalizeFifaFixture(raw) {
  if (!raw?.IdMatch || !raw.Home || !raw.Away || !raw.Date) return null;

  const homeCode = raw.Home.Abbreviation ?? raw.Home.IdCountry;
  const awayCode = raw.Away.Abbreviation ?? raw.Away.IdCountry;
  const homeTeam = FIFA_TEAM_MAP.get(homeCode) ?? null;
  const awayTeam = FIFA_TEAM_MAP.get(awayCode) ?? null;
  const hongKongDate = getZonedDateParts(raw.Date, HONG_KONG_TIME_ZONE);
  const homeScore = toNullableNumber(raw.HomeTeamScore ?? raw.Home.Score);
  const awayScore = toNullableNumber(raw.AwayTeamScore ?? raw.Away.Score);

  return {
    idMatch: String(raw.IdMatch),
    matchNumber: raw.MatchNumber ?? null,
    idCompetition: String(raw.IdCompetition ?? FIFA_COMPETITION_ID),
    idSeason: String(raw.IdSeason ?? FIFA_SEASON_ID),
    idStage: raw.IdStage ? String(raw.IdStage) : null,
    idGroup: raw.IdGroup ? String(raw.IdGroup) : null,
    rawDate: raw.Date,
    rawLocalDate: raw.LocalDate ?? null,
    date: hongKongDate.date,
    dateLabel: `${hongKongDate.month}月${hongKongDate.day}日`,
    kickoffSort: hongKongDate.time,
    kickoffLocal: `${hongKongDate.date}T${hongKongDate.time}:00+08:00`,
    homeCode,
    awayCode,
    homeTeam,
    awayTeam,
    predictable: Boolean(homeTeam?.modelSlug && awayTeam?.modelSlug),
    homeScore,
    awayScore,
    matchStatus: raw.MatchStatus ?? null,
    resultType: raw.ResultType ?? null,
    status: getFixtureStatus(raw, homeScore, awayScore),
    stageName: getLocalizedDescription(raw.StageName) ?? "First Stage",
    groupName: getLocalizedDescription(raw.GroupName) ?? "",
    stadiumName: getLocalizedDescription(raw.Stadium?.Name) ?? "",
    cityName: getLocalizedDescription(raw.Stadium?.CityName) ?? "",
  };
}

function toBackendMatch(fixture, existingMatches) {
  const existing = findExistingMatch(fixture, existingMatches);
  const isOpeningMatch = fixture.matchNumber === 1;

  return {
    ...(existing ?? {}),
    id: existing?.id ?? `${fixture.homeTeam.id}-${fixture.awayTeam.id}`,
    date: fixture.date,
    dateLabel: fixture.dateLabel,
    kickoffSort: fixture.kickoffSort,
    kickoffLocal: fixture.kickoffLocal,
    competition: "世界杯",
    group: isOpeningMatch ? "世界杯 开幕战" : toGroupLabel(fixture.groupName),
    stage: "group",
    status: isOpeningMatch && fixture.status === "未开赛" ? "开幕战" : fixture.status,
    watch: existing?.watch ?? false,
    homeTeamId: fixture.homeTeam.id,
    awayTeamId: fixture.awayTeam.id,
    modelHome: fixture.homeTeam.modelSlug,
    modelAway: fixture.awayTeam.modelSlug,
    modelVenue: getModelVenue(fixture),
    predictionStatus: getPredictionStatus(fixture),
    score: {
      home: fixture.homeScore,
      away: fixture.awayScore,
    },
    official: {
      sourceId: FIFA_SOURCE_ID,
      idMatch: fixture.idMatch,
      matchNumber: fixture.matchNumber,
      idCompetition: fixture.idCompetition,
      idSeason: fixture.idSeason,
      idStage: fixture.idStage,
      idGroup: fixture.idGroup,
      matchStatus: fixture.matchStatus,
      resultType: fixture.resultType,
      dateUtc: fixture.rawDate,
      localDateHost: fixture.rawLocalDate,
      stadiumName: fixture.stadiumName,
      cityName: fixture.cityName,
      homeCode: fixture.homeCode,
      awayCode: fixture.awayCode,
    },
    ui: {
      ...(existing?.ui ?? {}),
      homeForm: existing?.ui?.homeForm ?? "赛前信息更新中",
      awayForm: existing?.ui?.awayForm ?? "赛前信息更新中",
      narrative: existing?.ui?.narrative ?? "赛程来自 FIFA 官方数据源，赛前变量将继续补充。",
    },
  };
}

function buildFifaSource(syncPayload, summary) {
  return {
    id: FIFA_SOURCE_ID,
    name: "FIFA API calendar matches",
    url: syncPayload.url,
    retrievedAt: syncPayload.fetchedAt,
    tier: 1,
    notes: "Official FIFA calendar API used for 2026 World Cup fixture and result sync.",
    lastSync: {
      fetchedAt: syncPayload.fetchedAt,
      rawCount: syncPayload.rawCount,
      normalizedCount: syncPayload.fixtures.length,
      importedCount: summary.imported.length,
      predictableImportedCount: summary.importedPredictable.length,
      modelUnsupportedImportedCount: summary.importedModelUnsupported.length,
      skippedCount: summary.skipped.length,
    },
  };
}

function findExistingMatch(fixture, matches) {
  return matches.find((match) => match.official?.idMatch === fixture.idMatch)
    ?? matches.find((match) => (
      match.homeTeamId === fixture.homeTeam.id &&
      match.awayTeamId === fixture.awayTeam.id
    ));
}

function upsertById(items, item) {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) {
    items[index] = { ...items[index], ...item };
    return;
  }
  items.push(item);
}

function getModelVenue(fixture) {
  if (fixture.homeCode === "MEX" || fixture.homeCode === "CAN" || fixture.homeCode === "USA") return "home";
  if (fixture.awayCode === "MEX" || fixture.awayCode === "CAN" || fixture.awayCode === "USA") return "away";
  return "neutral";
}

function getPredictionStatus(fixture) {
  if (isPredictableFixture(fixture)) {
    return {
      available: true,
      reason: "model_supported",
    };
  }

  return {
    available: false,
    reason: "unsupported_model_team",
    unsupportedTeams: [fixture.homeTeam, fixture.awayTeam]
      .filter((team) => !team.modelSlug)
      .map((team) => team.id),
  };
}

function isPredictableFixture(fixture) {
  return Boolean(fixture.homeTeam?.modelSlug && fixture.awayTeam?.modelSlug);
}

function getFixtureStatus(raw, homeScore, awayScore) {
  if (homeScore != null && awayScore != null) return "已完赛";
  if ([3, 4, 5, 6, 7, 8, 9].includes(Number(raw.MatchStatus))) return "进行中";
  return "未开赛";
}

function toGroupLabel(groupName) {
  const match = groupName.match(/^Group\s+([A-Z])$/i);
  if (match) return `世界杯 ${match[1].toUpperCase()}组`;
  return groupName ? `世界杯 ${groupName}` : "世界杯 小组赛";
}

function getLocalizedDescription(value, locale = "en-GB") {
  if (!Array.isArray(value)) return null;
  return value.find((item) => item.Locale === locale)?.Description ?? value[0]?.Description ?? null;
}

function getZonedDateParts(value, timeZone) {
  const date = new Date(value);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    month: String(Number(parts.month)),
    day: String(Number(parts.day)),
    time: `${parts.hour}:${parts.minute}`,
  };
}

function toNullableNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function team(code, id, modelSlug, name) {
  const flagCode = FLAG_IMAGE_CODES.get(code) ?? code.toLowerCase();
  return {
    id,
    slug: id,
    modelSlug: modelSlug ?? MODEL_SLUG_OVERRIDES.get(code) ?? null,
    name,
    flagCode,
    flagUrl: `https://flagcdn.com/w80/${flagCode}.png`,
    fifaFlagUrl: `https://api.fifa.com/api/v3/picture/flags-sq-4/${code}`,
    fifaCode: code,
  };
}
