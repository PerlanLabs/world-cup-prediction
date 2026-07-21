const LINEUP_POLICY = "official_and_expected_only";

export function getLineupIntelForMatch(match) {
  const official = normalizeLineupSource(match?.lineups?.official, {
    label: "官方首发",
    sourceType: "official",
    emptyStatus: "not_released",
    emptyConfidence: "pending",
    emptyNote: "官方首发暂未发布；发布后以 FIFA 官方比赛中心或官方赛事数据为准。",
  });
  const expected = normalizeLineupSource(match?.lineups?.expected, {
    label: "预计首发",
    sourceType: "expected",
    emptyStatus: "not_ready",
    emptyConfidence: "pending",
    emptyNote: "预计首发待人工审核；不接付费数据，也不展示无来源猜测。",
  });

  return {
    policy: LINEUP_POLICY,
    appliesToModel: false,
    displayMode: getDisplayMode(official, expected),
    official,
    expected,
  };
}

function normalizeLineupSource(source, defaults) {
  const home = normalizeTeamLineup(source?.home);
  const away = normalizeTeamLineup(source?.away);
  const hasData = hasTeamLineupData(home) || hasTeamLineupData(away);
  const status = source?.status ?? (hasData ? "available" : defaults.emptyStatus);

  return {
    label: source?.label ?? defaults.label,
    sourceType: source?.sourceType ?? defaults.sourceType,
    status,
    confidence: source?.confidence ?? (status === "available" ? "confirmed" : defaults.emptyConfidence),
    sourceId: source?.sourceId ?? null,
    sourceUrl: source?.sourceUrl ?? null,
    retrievedAt: source?.retrievedAt ?? null,
    reviewedAt: source?.reviewedAt ?? null,
    note: source?.note ?? defaults.emptyNote,
    home,
    away,
  };
}

function normalizeTeamLineup(lineup) {
  return {
    formation: toNullableString(lineup?.formation),
    starters: normalizePlayers(lineup?.starters),
    substitutes: normalizePlayers(lineup?.substitutes),
    unavailable: normalizePlayers(lineup?.unavailable),
  };
}

function normalizePlayers(players) {
  if (!Array.isArray(players)) return [];
  return players
    .map((player) => ({
      name: toNullableString(player?.name ?? player?.playerName) ?? "未知球员",
      position: toNullableString(player?.position),
      shirtNumber: toNullableString(player?.shirtNumber ?? player?.number),
      note: toNullableString(player?.note),
    }))
    .filter((player) => player.name);
}

function hasTeamLineupData(lineup) {
  return Boolean(
    lineup.formation ||
    lineup.starters.length > 0 ||
    lineup.substitutes.length > 0 ||
    lineup.unavailable.length > 0,
  );
}

function getDisplayMode(official, expected) {
  if (official.status === "available") return "official";
  if (expected.status === "available") return "expected";
  return "pending";
}

function toNullableString(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}
