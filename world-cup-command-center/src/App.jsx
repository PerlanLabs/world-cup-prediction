import React from "react";
import {
  UserCircle,
  ArrowClockwise,
  ArrowsClockwise,
  ArrowsLeftRight,
  Article,
  Bell,
  Brain,
  Calendar,
  CalendarBlank,
  CalendarDots,
  CaretUp,
  ChartBar,
  ChartLineUp,
  ChatCircleText,
  CheckCircle,
  CloudSun,
  ClockCounterClockwise,
  Database,
  Gauge,
  GearSix,
  House,
  Info,
  Lightning,
  Medal,
  Question,
  Robot,
  RocketLaunch,
  Shield,
  ShieldCheck,
  SoccerBall,
  Sparkle,
  Speedometer,
  Strategy,
  Trophy,
  UsersThree,
  X,
  XCircle,
} from "@phosphor-icons/react";
import { fetchDashboardMatches, fetchModelTrackRecord, fetchPolymarketAccount, mergeModelPrediction } from "./modelClient.js";
import { buildGroupStandings, buildMatchDays, buildPlayerLeaderboards, getMatchDataSummary, isCompletedMatch } from "./competitionData.js";
import { getScheduleState, getVisibleScheduleMatches } from "./scheduleState.js";
import { buildStrategyAnalysis } from "./strategyAnalysis.js";
import { MarketMovementView } from "./MarketMovementView.jsx";
import { MarketBacktestView } from "./MarketBacktestView.jsx";

export function App() {
  const matchPanelRef = React.useRef(null);
  const intelPanelRef = React.useRef(null);
  const [selectedId, setSelectedId] = React.useState("mexico-south-africa");
  const [activeView, setActiveView] = React.useState("command");
  const [calendarDate, setCalendarDate] = React.useState(null);
  const [tab, setTab] = React.useState("overview");
  const [filter, setFilter] = React.useState("all");
  const [compareOpen, setCompareOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [lastRefresh, setLastRefresh] = React.useState(() => formatClock(new Date()));
  const [noticeOn, setNoticeOn] = React.useState(true);
  const [matches, setMatches] = React.useState(fallbackMatches);
  const [polymarketAddress, setPolymarketAddress] = React.useState(() =>
    typeof window === "undefined" ? "" : window.localStorage?.getItem("polymarketMonitorAddress") ?? "",
  );
  const [polymarketAccount, setPolymarketAccount] = React.useState(null);
  const [polymarketAccountLoading, setPolymarketAccountLoading] = React.useState(false);
  const [polymarketAccountError, setPolymarketAccountError] = React.useState("");
  const [modelTrackRecord, setModelTrackRecord] = React.useState(null);
  const [modelTrackRecordError, setModelTrackRecordError] = React.useState("");

  const loadDashboard = React.useCallback(async () => {
    try {
      const apiMatches = await fetchDashboardMatches();
      setMatches(apiMatches.map(toUiMatch));
    } catch {
      setMatches(fallbackMatches);
    }
  }, []);

  React.useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const loadModelTrackRecord = React.useCallback(async () => {
    try {
      setModelTrackRecord(await fetchModelTrackRecord());
      setModelTrackRecordError("");
    } catch (error) {
      setModelTrackRecord(null);
      setModelTrackRecordError(error.message);
    }
  }, []);

  React.useEffect(() => {
    void loadModelTrackRecord();
  }, [loadModelTrackRecord]);

  const displayMatches = React.useMemo(
    () => matches.map((match) => mergeModelPrediction(match, match.latestPrediction)),
    [matches],
  );
  const scheduleState = React.useMemo(() => getScheduleState(displayMatches), [displayMatches]);
  const matchDays = React.useMemo(() => buildMatchDays(displayMatches), [displayMatches]);
  const standings = React.useMemo(() => buildGroupStandings(displayMatches), [displayMatches]);
  const playerLeaderboards = React.useMemo(() => buildPlayerLeaderboards(displayMatches), [displayMatches]);
  const dataSummary = React.useMemo(() => getMatchDataSummary(displayMatches), [displayMatches]);
  const selectedCalendarDate = calendarDate ?? scheduleState.todayIso;
  const activeNavItem = appNavItems.find((item) => item.id === activeView) ?? appNavItems[0];

  const selectedMatch = displayMatches.find((match) => match.id === selectedId) ?? displayMatches[0];
  const visibleMatches = getVisibleScheduleMatches(displayMatches, filter, scheduleState);

  function handleRefresh() {
    const now = new Date();
    setLastRefresh(formatClock(now));
    void loadDashboard();
    if (activeView === "portfolio" && polymarketAddress.trim()) {
      void loadPolymarketAccount();
    }
    if (activeView === "reviewCenter") {
      void loadModelTrackRecord();
    }
  }

  async function loadPolymarketAccount() {
    const address = polymarketAddress.trim();
    if (!address) {
      setPolymarketAccountError("请输入 Polymarket 使用的钱包地址。");
      return;
    }

    setPolymarketAccountLoading(true);
    setPolymarketAccountError("");
    try {
      const account = await fetchPolymarketAccount(address, { limit: 100, scenarioMaxGoals: 6 });
      if (typeof window !== "undefined") {
        window.localStorage?.setItem("polymarketMonitorAddress", address);
      }
      setPolymarketAccount(account);
    } catch (error) {
      setPolymarketAccount(null);
      setPolymarketAccountError(error.message);
    } finally {
      setPolymarketAccountLoading(false);
    }
  }

  function openMatch(matchId) {
    setSelectedId(matchId);
    setExpanded(false);
    setActiveView("command");
    requestAnimationFrame(() => {
      matchPanelRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      intelPanelRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      if (window.matchMedia?.("(max-width: 900px)").matches) {
        matchPanelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      } else {
        document.querySelector(".fixture-row.is-selected")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
  }

  return (
    <main className="app-shell">
      <aside className="rail" aria-label="主导航">
        <div className="brand-mark">
          <Icon glyph="emoji_events" className="brand-icon" />
          <div>
            <p>世界杯预测</p>
            <strong>赛事指挥舱</strong>
          </div>
        </div>

        <nav className="nav-stack">
          {appNavItems.map((item) => (
            <button
              className={`nav-item ${activeView === item.id ? "is-active" : ""}`}
              key={item.id}
              type="button"
              onClick={() => setActiveView(item.id)}
            >
              <Icon glyph={item.icon} />
              <span>{item.label}</span>
              {item.badge ? <small>{item.badge}</small> : null}
            </button>
          ))}
        </nav>

        <div className="rail-bottom">
          <button className="ghost-nav" type="button">
            <Icon glyph="help" />
            帮助中心
          </button>
          <button className="ghost-nav" type="button">
            <Icon glyph="chat" />
            反馈建议
          </button>
          <AccountCard user={currentUser} />
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">World Cup Prediction</p>
            <span className="view-kicker">{activeNavItem.label}</span>
            <h1 className="view-heading">{activeNavItem.title}</h1>
            <h1>世界杯预测 · 赛事指挥舱</h1>
          </div>
          <div className="top-actions">
            <span className="freshness">页面刷新：{scheduleState.todayLabel} {lastRefresh}</span>
            <button className="icon-button" type="button" onClick={handleRefresh} title="刷新">
              <Icon glyph="sync" />
              刷新
            </button>
            <button
              className={`icon-button ${noticeOn ? "is-on" : ""}`}
              type="button"
              onClick={() => setNoticeOn((value) => !value)}
              title="通知"
            >
              <Icon glyph="notifications" />
              通知
            </button>
            <button className="icon-button" type="button" title="设置">
              <Icon glyph="settings" />
              设置
            </button>
          </div>
        </header>

        {activeView === "command" ? (
        <div className="dashboard-grid">
          <section className="fixtures-panel" aria-label="赛程">
            <div className="section-heading">
              <div>
                <h2>{scheduleState.panelTitle}</h2>
                <span>{scheduleState.panelSubtitle}</span>
              </div>
              <div className="segmented" aria-label="赛程过滤">
                {filters.map((item) => (
                  <button
                    className={filter === item.id ? "is-active" : ""}
                    key={item.id}
                    type="button"
                    onClick={() => setFilter(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <ScheduleNotice state={scheduleState} />

            <div className="fixture-list">
              {visibleMatches.length > 0 ? visibleMatches.map((match) => (
                <button
                  className={`fixture-row ${match.id === selectedId ? "is-selected" : ""}`}
                  key={match.id}
                  type="button"
                  onClick={() => {
                    openMatch(match.id);
                  }}
                >
                  <div className="fixture-meta">
                    <span>{match.dateLabel}</span>
                    <span>{match.group}</span>
                    <strong className={statusClass(match.status)}>{match.status}</strong>
                  </div>
                  <TeamLine team={match.home} />
                  <span className="versus">VS</span>
                  <TeamLine team={match.away} />
                  <div className="fixture-signal">
                    <span>{match.isCompleted ? "官方赛果" : match.recommendation}</span>
                    <strong>{match.isCompleted ? match.resultScore : match.confidence}</strong>
                  </div>
                </button>
              )) : <EmptyFixtures state={scheduleState} />}
            </div>

            <button className="full-schedule" type="button" onClick={() => setActiveView("calendar")}>
              <Icon glyph="calendar_month" />
              查看完整赛程
            </button>
          </section>

          <section className="match-panel" aria-label="比赛预测详情" ref={matchPanelRef}>
            <div className="match-tabs">
              {matchTabs.map((item) => (
                <button
                  className={tab === item.id ? "is-active" : ""}
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
              <button
                className="compare-button"
                type="button"
                onClick={() => setCompareOpen(true)}
              >
                <Icon glyph="compare_arrows" />
                对比两队
              </button>
            </div>

            <MatchHero match={selectedMatch} />

            {tab === "overview" ? (
              <Overview match={selectedMatch} expanded={expanded} setExpanded={setExpanded} />
            ) : null}
            {tab === "situation" ? <MatchSituation match={selectedMatch} /> : null}
            {tab === "lineup" ? <SelectedLineupIntel match={selectedMatch} /> : null}
            {tab === "intel" ? <Intel match={selectedMatch} /> : null}
            {tab === "review" ? <ReviewPreview match={selectedMatch} /> : null}
            {tab === "strategy" ? <StrategyReference match={selectedMatch} /> : null}
          </section>

          <aside className="intel-panel" aria-label="AI 情报" ref={intelPanelRef}>
            <AiBrief match={selectedMatch} />
            <RecentFormRadar match={selectedMatch} />
            <Confidence match={selectedMatch} />
            <RecentChanges match={selectedMatch} />
          </aside>
        </div>
        ) : null}

        {activeView === "today" ? (
          <TodayScheduleView
            matches={displayMatches}
            summary={dataSummary}
            todayIso={scheduleState.todayIso}
            onOpenMatch={openMatch}
          />
        ) : null}

        {activeView === "calendar" ? (
          <CalendarView
            days={matchDays}
            selectedDate={selectedCalendarDate}
            setSelectedDate={setCalendarDate}
            onOpenMatch={openMatch}
          />
        ) : null}

        {activeView === "data" ? (
          <DataCenterView
            standings={standings}
            playerLeaderboards={playerLeaderboards}
            summary={dataSummary}
            matches={displayMatches}
          />
        ) : null}

        {activeView === "portfolio" ? (
          <PolymarketPortfolioView
            account={polymarketAccount}
            address={polymarketAddress}
            error={polymarketAccountError}
            isLoading={polymarketAccountLoading}
            onAddressChange={setPolymarketAddress}
            onRefresh={loadPolymarketAccount}
          />
        ) : null}

        {activeView === "movement" ? <MarketMovementView /> : null}

        {activeView === "marketBacktest" ? <MarketBacktestView /> : null}

        {activeView === "reviewCenter" ? (
          <ModelTrackRecordView
            error={modelTrackRecordError}
            trackRecord={modelTrackRecord}
          />
        ) : null}

        {["model", "tactics", "teams", "intelCenter"].includes(activeView) ? (
          <CenterPlaceholderView
            viewId={activeView}
            selectedMatch={selectedMatch}
            standings={standings}
            summary={dataSummary}
          />
        ) : null}
      </section>

      {compareOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setCompareOpen(false)}>
          <section
            className="compare-modal"
            aria-modal="true"
            role="dialog"
            aria-label="两队对比"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">Team Compare</p>
                <h2>
                  {selectedMatch.home.name} vs {selectedMatch.away.name}
                </h2>
              </div>
              <button className="icon-only" type="button" onClick={() => setCompareOpen(false)}>
                <Icon glyph="close" />
              </button>
            </div>
            <div className="compare-grid">
              {selectedMatch.compare.map((row) => (
                <div className="compare-row" key={row.label}>
                  <strong>{row.home}</strong>
                  <span>{row.label}</span>
                  <strong>{row.away}</strong>
                </div>
              ))}
            </div>
            <div className="modal-note">
              <Icon glyph="info" />
              预测结果会随赛前信息更新，具体赛果存在不确定性。
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function formatClock(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatDateTimeLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}月${date.getDate()}日 ${formatClock(date)}`;
}

function formatMonitorTime(value) {
  if (!value) return "未读取";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未读取";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatPortfolioMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${number.toFixed(2)}u`;
}

function formatSignedPortfolioMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${number > 0 ? "+" : ""}${number.toFixed(2)}u`;
}

function formatPortfolioPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${(number * 100).toFixed(1)}¢`;
}

function formatPortfolioShares(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return number >= 100 ? number.toFixed(0) : number.toFixed(1);
}

function moneyClass(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "";
  return number > 0 ? "is-positive" : "is-negative";
}

function shortAddress(value) {
  const text = String(value ?? "");
  return text.length > 14 ? `${text.slice(0, 6)}...${text.slice(-4)}` : text || "--";
}

function Icon({ glyph, className = "" }) {
  const Component = iconMap[glyph] ?? Info;
  return <Component className={`icon ${className}`.trim()} aria-hidden="true" weight="duotone" />;
}

function TeamLine({ team }) {
  return (
    <div className="team-line">
      <img src={team.flag} alt={`${team.name} 国旗`} />
      <span>{team.name}</span>
    </div>
  );
}

function AccountCard({ user }) {
  return (
    <div className="account-card">
      <div className="account-avatar" aria-hidden="true">
        {user?.avatar ? <img src={user.avatar} alt="" /> : <Icon glyph="user" />}
      </div>
      <div>
        {user ? (
          <>
            <span>{user.name}</span>
            <strong>{user.id}</strong>
          </>
        ) : (
          <>
            <span>未登录</span>
            <button type="button">登录 / 注册</button>
          </>
        )}
      </div>
    </div>
  );
}

function ScheduleNotice({ state }) {
  return (
    <section className={`schedule-notice ${state.mode}`}>
      <div>
        <strong>{state.noticeTitle}</strong>
        <p>{state.noticeCopy}</p>
      </div>
    </section>
  );
}

function EmptyFixtures({ state }) {
  return (
    <div className="empty-fixtures">
      <Icon glyph="calendar_today" />
      <strong>今天没有世界杯比赛</strong>
      <span>{state.todayLabel}</span>
    </div>
  );
}

function TodayScheduleView({ matches, summary, todayIso, onOpenMatch }) {
  const days = React.useMemo(() => buildMatchDays(matches), [matches]);
  const activeDay =
    days.find((day) => day.date === todayIso) ??
    days.find((day) => day.date > todayIso) ??
    days[0];

  return (
    <section className="page-surface schedule-page" aria-label="今日赛程">
      <div className="page-hero">
        <div>
          <p className="eyebrow">Today</p>
          <h2>{activeDay?.date === todayIso ? "今日赛程" : "下一比赛日"}</h2>
          <span>
            {activeDay ? `${activeDay.label} ${activeDay.weekday} · ${activeDay.count} 场比赛` : "暂无赛程"}
          </span>
        </div>
        <div className="summary-metrics">
          <SummaryMetric label="已完赛" value={summary.completed} />
          <SummaryMetric label="待开赛" value={summary.upcoming} />
          <SummaryMetric label="预计首发" value={summary.expectedLineups} />
        </div>
      </div>

      {activeDay ? (
        <ScheduleRows
          title={`${activeDay.label} 赛程`}
          subtitle={`${activeDay.completed} 场已完赛 · ${activeDay.pending} 场未开赛`}
          matches={activeDay.matches}
          onOpenMatch={onOpenMatch}
        />
      ) : (
        <EmptyDataState title="暂无可展示赛程" copy="当前比赛 feed 没有返回赛程数据。" />
      )}
    </section>
  );
}

function CalendarView({ days, selectedDate, setSelectedDate, onOpenMatch }) {
  const selectedDay = days.find((day) => day.date === selectedDate) ?? days[0];

  return (
    <section className="page-surface calendar-page" aria-label="赛事日历">
      <div className="page-hero">
        <div>
          <p className="eyebrow">Calendar</p>
          <h2>赛事日历</h2>
          <span>按日期浏览全部比赛，完赛比分和待赛预测会在同一条时间线里展示。</span>
        </div>
        <SummaryMetric label="比赛日" value={days.length} />
      </div>

      <div className="date-rail" aria-label="比赛日期">
        {days.map((day) => (
          <button
            className={day.date === selectedDay?.date ? "date-card is-active" : "date-card"}
            key={day.date}
            type="button"
            onClick={() => setSelectedDate(day.date)}
          >
            <strong>{day.label}</strong>
            <span>{day.weekday}</span>
            <small>{day.completed}/{day.count} 已完赛</small>
          </button>
        ))}
      </div>

      {selectedDay ? (
        <ScheduleRows
          title={`${selectedDay.label} ${selectedDay.weekday}`}
          subtitle={`${selectedDay.count} 场比赛`}
          matches={selectedDay.matches}
          onOpenMatch={onOpenMatch}
        />
      ) : (
        <EmptyDataState title="赛事日历待同步" copy="当前没有可分组的比赛日期。" />
      )}
    </section>
  );
}

function DataCenterView({ standings, playerLeaderboards, summary, matches }) {
  const [dataTab, setDataTab] = React.useState("standings");
  const completedRate = summary.total > 0 ? Math.round((summary.completed / summary.total) * 100) : 0;

  return (
    <section className="page-surface data-page" aria-label="数据中心">
      <div className="page-hero">
        <div>
          <p className="eyebrow">Data Center</p>
          <h2>数据中心</h2>
          <span>赛程、比分和积分榜来自当前比赛 feed；球员事件榜单需要后续接入可靠事件源。</span>
        </div>
        <div className="summary-metrics">
          <SummaryMetric label="比赛" value={summary.total} />
          <SummaryMetric label="完赛率" value={`${completedRate}%`} />
          <SummaryMetric label="总进球" value={summary.goals} />
        </div>
      </div>

      <div className="data-tabs" role="tablist" aria-label="数据模块">
        {dataTabs.map((item) => (
          <button
            className={dataTab === item.id ? "is-active" : ""}
            key={item.id}
            type="button"
            onClick={() => setDataTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {dataTab === "standings" ? (
        <div className="standings-grid">
          {standings.map((group) => (
            <StandingGroup group={group} key={group.group} />
          ))}
        </div>
      ) : null}

      {dataTab === "scorers" ? (
        playerLeaderboards.scorers.length > 0 ? (
          <PlayerLeaderboard title="射手榜" metricLabel="进球" rows={playerLeaderboards.scorers} />
        ) : (
          <LeaderboardEmpty
            title="射手榜待接入"
            copy="当前没有官方进球事件，不能根据比分反推射手。同步官方比赛事件后，这里会按球员、球队、进球数排序。"
          />
        )
      ) : null}

      {dataTab === "assists" ? (
        playerLeaderboards.assists.length > 0 ? (
          <PlayerLeaderboard title="助攻榜" metricLabel="助攻" rows={playerLeaderboards.assists} />
        ) : (
          <LeaderboardEmpty
            title="助攻榜待接入"
            copy="当前官方进球事件没有提供助攻球员，不能根据进球反推助攻。拿到官方助攻字段后这里会自动生成。"
          />
        )
      ) : null}

      {dataTab === "coverage" ? (
        <div className="coverage-grid">
          <SummaryMetric label="官方首发" value={summary.officialLineups} />
          <SummaryMetric label="预计首发" value={summary.expectedLineups} />
          <SummaryMetric label="已完赛比分" value={summary.completed} />
          <SummaryMetric label="可选比赛" value={matches.length} />
        </div>
      ) : null}
    </section>
  );
}

function PolymarketPortfolioView({ account, address, error, isLoading, onAddressChange, onRefresh }) {
  const groups = account?.worldCup?.groups ?? [];
  const totals = account?.totals ?? {};
  const dataSources = account?.dataSources ?? {};

  return (
    <section className="page-surface portfolio-page" aria-label="Polymarket 只读账户监控">
      <div className="page-hero portfolio-hero">
        <div>
          <p className="eyebrow">Polymarket Read-only Monitor</p>
          <h2>只读账户监控</h2>
          <span>
            输入公开钱包地址后读取公开持仓、成交和组合市值，并按本地已同步的世界杯盘口做持仓匹配、情景盈亏和赛后复盘。不会连接钱包、不会签名、不会下单。
          </span>
        </div>
        <Icon glyph="shield" />
      </div>

      <form
        className="portfolio-query"
        onSubmit={(event) => {
          event.preventDefault();
          void onRefresh();
        }}
      >
        <label>
          <span>钱包地址</span>
          <input
            autoComplete="off"
            inputMode="text"
            onChange={(event) => onAddressChange(event.target.value)}
            placeholder="0x..."
            value={address}
          />
        </label>
        <button className="model-button" disabled={isLoading} type="submit">
          <Icon glyph={isLoading ? "sync" : "monitoring"} />
          {isLoading ? "刷新中" : "读取账户"}
        </button>
      </form>

      {error ? (
        <div className="portfolio-alert" role="alert">
          <Icon glyph="cancel" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="portfolio-metric-grid">
        <SummaryMetric label="公开持仓" value={totals.openPositionCount ?? "--"} />
        <SummaryMetric label="世界杯匹配" value={totals.matchedWorldCupPositionCount ?? "--"} />
        <SummaryMetric label="未匹配持仓" value={totals.unmatchedOpenPositionCount ?? "--"} />
        <SummaryMetric label="账户当前市值" value={formatPortfolioMoney(totals.openCurrentValue)} />
      </div>

      {account ? (
        <>
          <section className="portfolio-card">
            <div className="portfolio-card-head">
              <div>
                <p className="eyebrow">Snapshot</p>
                <h3>账户快照</h3>
              </div>
              <span>{formatMonitorTime(account.source?.retrievedAt)}</span>
            </div>
            <div className="portfolio-snapshot-grid">
              <div>
                <span>账户地址</span>
                <strong>{shortAddress(account.account?.address)}</strong>
              </div>
              <div>
                <span>公开持仓成本</span>
                <strong>{formatPortfolioMoney(totals.openCost)}</strong>
              </div>
              <div>
                <span>公开持仓浮盈亏</span>
                <strong className={moneyClass(totals.openPnl)}>{formatSignedPortfolioMoney(totals.openPnl)}</strong>
              </div>
              <div>
                <span>世界杯敞口</span>
                <strong>{formatPortfolioMoney(totals.worldCupCost)}</strong>
              </div>
            </div>
          </section>

          <section className="portfolio-card">
            <div className="portfolio-card-head">
              <div>
                <p className="eyebrow">Data Sources</p>
                <h3>读取状态</h3>
              </div>
              <span>只读公开 API</span>
            </div>
            <div className="portfolio-source-grid">
              {Object.entries(dataSources).map(([key, source]) => (
                <div className={source.ok ? "is-ok" : "is-error"} key={key}>
                  <strong>{key}</strong>
                  <span>{source.ok ? `${source.count} 条` : source.error ?? "读取失败"}</span>
                </div>
              ))}
            </div>
          </section>

          {groups.length > 0 ? (
            <div className="portfolio-match-list">
              {groups.map((group) => (
                <PolymarketMatchGroup group={group} key={group.match.id} />
              ))}
            </div>
          ) : (
            <EmptyDataState
              icon="sports_soccer"
              title="还没有匹配到世界杯持仓"
              copy="先同步对应比赛的 Polymarket 盘口，再刷新这个钱包地址；未匹配持仓仍会计入账户总览。"
            />
          )}
        </>
      ) : (
        <EmptyDataState
          icon="user"
          title="等待读取钱包"
          copy="这里不会连接钱包，只读取公开钱包地址对应的 Polymarket 公共数据。"
        />
      )}
    </section>
  );
}

function PolymarketMatchGroup({ group }) {
  const settlement = group.settlement;

  return (
    <section className="portfolio-match-card">
      <div className="portfolio-match-head">
        <div>
          <span>{group.match.date ?? group.match.dateLabel ?? "待定"} · {group.match.status ?? "未开赛"}</span>
          <h3>{group.match.home?.name ?? "Home"} vs {group.match.away?.name ?? "Away"}</h3>
        </div>
        <strong className={moneyClass(group.totals.pnl)}>{formatSignedPortfolioMoney(group.totals.pnl)}</strong>
      </div>

      <div className="portfolio-position-table">
        <div className="portfolio-position-row is-header">
          <span>盘口</span>
          <span>均价</span>
          <span>当前价</span>
          <span>份额</span>
          <span>价值</span>
          <span>盈亏</span>
        </div>
        {group.positions.map((position) => (
          <div className="portfolio-position-row" key={`${position.tokenId}-${position.label}`}>
            <strong>{position.label ?? position.title}</strong>
            <span>{formatPortfolioPrice(position.avgPrice)}</span>
            <span>{formatPortfolioPrice(position.currentPrice)}</span>
            <span>{formatPortfolioShares(position.shares)}</span>
            <span>{formatPortfolioMoney(position.currentValue)}</span>
            <b className={moneyClass(position.pnl)}>{formatSignedPortfolioMoney(position.pnl)}</b>
          </div>
        ))}
      </div>

      {settlement ? (
        <div className="portfolio-settlement">
          <span>当前已知比分 {settlement.score}</span>
          <strong className={moneyClass(settlement.netPnl)}>{formatSignedPortfolioMoney(settlement.netPnl)}</strong>
        </div>
      ) : null}

      <div className="portfolio-scenario-grid">
        <ScenarioList title="最有利比分" scenarios={group.bestScenarios} />
        <ScenarioList title="最不利比分" scenarios={group.worstScenarios} />
      </div>
    </section>
  );
}

function ScenarioList({ title, scenarios }) {
  return (
    <div className="portfolio-scenarios">
      <strong>{title}</strong>
      {scenarios.slice(0, 5).map((scenario) => (
        <div key={`${title}-${scenario.score}`}>
          <span>{scenario.score}</span>
          <b className={moneyClass(scenario.netPnl)}>{formatSignedPortfolioMoney(scenario.netPnl)}</b>
        </div>
      ))}
    </div>
  );
}

function CenterPlaceholderView({ viewId, selectedMatch, standings, summary }) {
  const topTeams = standings.flatMap((group) => group.rows.slice(0, 2)).slice(0, 6);
  const config = centerViewCopy[viewId] ?? centerViewCopy.model;

  return (
    <section className="page-surface center-page" aria-label={config.title}>
      <div className="page-hero">
        <div>
          <p className="eyebrow">{config.eyebrow}</p>
          <h2>{config.title}</h2>
          <span>{config.copy}</span>
        </div>
        <Icon glyph={config.icon} />
      </div>

      <div className="center-grid">
        <article className="center-card">
          <strong>当前可用</strong>
          <ul>
            {config.ready.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
        <article className="center-card">
          <strong>下一步</strong>
          <ul>
            {config.next.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
        <article className="center-card">
          <strong>当前样本</strong>
          <p>
            {selectedMatch.home.name} vs {selectedMatch.away.name} · {selectedMatch.status}
          </p>
          <p>已完赛 {summary.completed} 场，预计首发覆盖 {summary.expectedLineups} 场。</p>
        </article>
      </div>

      {viewId === "teams" && topTeams.length > 0 ? (
        <div className="team-shelf">
          {topTeams.map((row) => (
            <div className="team-mini-card" key={`${row.key}-${row.team.name}`}>
              {row.team.flag ? <img src={row.team.flag} alt="" /> : null}
              <strong>{row.team.name}</strong>
              <span>{row.points} 分 · 净胜 {row.gd}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ModelTrackRecordView({ trackRecord, error }) {
  const summary = trackRecord?.summary ?? {};
  const rows = Array.isArray(trackRecord?.rows) ? trackRecord.rows : [];
  const scoredRows = rows.filter((row) => row.status === "scored");
  const missingRows = rows.filter((row) => row.status === "missing_freeze");
  const displayRows = [...scoredRows].reverse().slice(0, 12);

  return (
    <section className="page-surface track-record-page" aria-label="模型战绩">
      <div className="page-hero">
        <div>
          <p className="eyebrow">Model Track Record</p>
          <h2>模型战绩</h2>
          <span>只用赛前冻结快照评估模型表现，赛后重新校准的预测不会回填到战绩里。</span>
        </div>
        <Icon glyph="history" />
      </div>

      {error ? (
        <div className="portfolio-alert" role="alert">
          <Icon glyph="cancel" />
          <span>{error}</span>
        </div>
      ) : null}

      {trackRecord ? (
        <>
          <div className="summary-metrics track-record-metrics">
            <SummaryMetric label="冻结快照" value={summary.frozenCount ?? 0} />
            <SummaryMetric label="已评分" value={summary.scoredCount ?? 0} />
            <SummaryMetric label="胜平负命中" value={formatTrackPercent(summary.accuracy)} />
            <SummaryMetric label="平均 RPS" value={formatTrackNumber(summary.averageRps)} />
            <SummaryMetric label="比分首选命中" value={formatTrackPercent(summary.exactTopScoreRate)} />
          </div>

          {missingRows.length > 0 ? (
            <div className="track-record-warning">
              <Icon glyph="info" />
              <span>{missingRows.length} 场已完赛比赛缺少赛前冻结快照，暂不计入命中率。</span>
            </div>
          ) : null}

          {displayRows.length > 0 ? (
            <div className="track-record-table">
              <div className="track-record-row is-header">
                <span>比赛</span>
                <span>赛前判断</span>
                <span>赛果</span>
                <span>实际概率</span>
                <span>RPS</span>
                <span>结果</span>
              </div>
              {displayRows.map((row) => (
                <TrackRecordRow row={row} key={row.matchId} />
              ))}
            </div>
          ) : (
            <EmptyDataState
              icon="history"
              title="战绩等待冻结快照"
              copy="下一轮同步会为进入赛前窗口的比赛锁定预测。已完赛但缺少冻结快照的比赛不会被拿来美化命中率。"
            />
          )}
        </>
      ) : (
        <EmptyDataState
          icon="history"
          title="模型战绩读取中"
          copy="后端可用时，这里会展示赛前冻结预测和赛后评分。"
        />
      )}
    </section>
  );
}

function TrackRecordRow({ row }) {
  const prediction = row.frozenPrediction;
  const score = row.score;
  const matchup = `${row.homeTeam?.name ?? row.matchId} vs ${row.awayTeam?.name ?? ""}`;
  const predicted = prediction?.predictedOutcome;
  return (
    <div className="track-record-row">
      <div>
        <strong>{matchup}</strong>
        <small>{formatDateTimeLabel(row.kickoffAt)}</small>
      </div>
      <span>{predicted?.label ?? "--"} {formatTrackPercent(predicted?.probability)}</span>
      <span>{row.finalScore?.line ?? "--"}</span>
      <span>{formatTrackPercent(score?.actualProbability)}</span>
      <span>{formatTrackNumber(score?.rps)}</span>
      <b className={score?.pickedCorrect ? "is-hit" : "is-miss"}>{score?.pickedCorrect ? "命中" : "未中"}</b>
    </div>
  );
}

function ScheduleRows({ title, subtitle, matches, onOpenMatch }) {
  return (
    <section className="schedule-list-panel">
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          <span>{subtitle}</span>
        </div>
      </div>
      <div className="match-timeline">
        {matches.map((match) => (
          <ScheduleRow match={match} key={match.id} onOpenMatch={onOpenMatch} />
        ))}
      </div>
    </section>
  );
}

function ScheduleRow({ match, onOpenMatch }) {
  const completed = isCompletedMatch(match);
  const score = completed && match.score?.home != null && match.score?.away != null
    ? `${match.score.home} - ${match.score.away}`
    : "-";

  return (
    <button
      className={`schedule-row-card ${completed ? "is-completed" : ""}`}
      type="button"
      onClick={() => onOpenMatch(match.id)}
    >
      <div className="schedule-time">
        <strong>{match.kickoffSort ?? match.time}</strong>
        <span>{match.group}</span>
        <small>{match.status}</small>
      </div>
      <div className="schedule-matchup">
        <div className="schedule-team is-home">
          <strong>{match.home.name}</strong>
          <img src={match.home.flag} alt="" />
        </div>
        <div className="schedule-score">
          <strong>{score}</strong>
          <span>{completed ? "官方赛果" : match.recommendation}</span>
        </div>
        <div className="schedule-team">
          <img src={match.away.flag} alt="" />
          <strong>{match.away.name}</strong>
        </div>
      </div>
      <span className="schedule-action">{completed ? "查看复盘" : "查看预测"}</span>
    </button>
  );
}

function StandingGroup({ group }) {
  return (
    <section className="standing-card">
      <div className="standing-head">
        <h3>{group.group}</h3>
        <span>积分榜</span>
      </div>
      <div className="standing-table">
        <div className="standing-row is-header">
          <span>球队</span>
          <span>场</span>
          <span>胜/平/负</span>
          <span>进/失</span>
          <span>分</span>
        </div>
        {group.rows.map((row, index) => (
          <div className="standing-row" key={row.key}>
            <span className="standing-team">
              <b>{index + 1}</b>
              {row.team.flag ? <img src={row.team.flag} alt="" /> : null}
              <strong>{row.team.name}</strong>
            </span>
            <span>{row.played}</span>
            <span>{row.wins}/{row.draws}/{row.losses}</span>
            <span>{row.gf}/{row.ga}</span>
            <strong>{row.points}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function PlayerLeaderboard({ title, metricLabel, rows }) {
  return (
    <section className="leaderboard-card">
      <div className="standing-head">
        <h3>{title}</h3>
        <span>官方事件</span>
      </div>
      <div className="leaderboard-table">
        <div className="leaderboard-row is-header">
          <span>排名</span>
          <span>球员</span>
          <span>球队</span>
          <span>{metricLabel}</span>
        </div>
        {rows.map((row, index) => (
          <div className="leaderboard-row" key={row.key}>
            <strong>{index + 1}</strong>
            <span className="leaderboard-player">
              <b>{row.playerName}</b>
              {row.minutes.length ? <small>{row.minutes.join(" / ")}</small> : null}
            </span>
            <span className="leaderboard-team">
              {row.team?.flag ? <img src={row.team.flag} alt="" /> : null}
              {row.team?.name ?? "未知球队"}
            </span>
            <strong>{row.count}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function SummaryMetric({ label, value }) {
  return (
    <div className="summary-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function LeaderboardEmpty({ title, copy }) {
  return <EmptyDataState title={title} copy={copy} icon="dataset" />;
}

function EmptyDataState({ title, copy, icon = "info" }) {
  return (
    <div className="empty-data-state">
      <Icon glyph={icon} />
      <strong>{title}</strong>
      <p>{copy}</p>
    </div>
  );
}

function MatchHero({ match }) {
  return (
    <div className="match-hero">
      <img className="hero-bg" src="/assets/stadium-command.png" alt="" aria-hidden="true" />
      <div className="hero-content">
        <div className="match-context">
          <span>{match.competition}</span>
          <span>{match.group}</span>
          <strong>{match.status}</strong>
        </div>
        <div className="matchup">
          <TeamCrest team={match.home} />
          {match.isCompleted ? <ResultMark match={match} /> : <span className="vs-mark">VS</span>}
          <TeamCrest team={match.away} />
        </div>
      </div>
    </div>
  );
}

function TeamCrest({ team }) {
  return (
    <div className="team-crest">
      <img src={team.flag} alt={`${team.name} 国旗`} />
      <strong>{team.name}</strong>
      <TeamProfileBadges team={team} />
      <span className="team-form-line">{team.form}</span>
    </div>
  );
}

function TeamProfileBadges({ team }) {
  const ranking = team.profile?.worldRanking;
  const polymarketWinner = team.profile?.marketSignals?.polymarket?.worldCupWinner;
  return (
    <div className="team-profile-badges" aria-label={`${team.name} 球队信息`}>
      <span>{ranking?.rank ? `FIFA #${ranking.rank}` : "FIFA 排名待接入"}</span>
      {polymarketWinner ? <span>{formatPolymarketWinnerBadge(polymarketWinner)}</span> : null}
    </div>
  );
}

function formatPolymarketWinnerBadge(signal) {
  if (signal?.impliedProbabilityPercent == null) return "市场参考待更新";
  return `市场夺冠 ${signal.impliedProbabilityPercent}%`;
}

function ResultMark({ match }) {
  return (
    <div className="result-mark" aria-label={`官方赛果 ${match.resultScore}`}>
      <span>官方赛果</span>
      <strong>{match.resultScore}</strong>
    </div>
  );
}

function ResultSummary({ match }) {
  return (
    <section className="result-summary">
      <div>
        <span>官方赛果</span>
        <strong>{match.resultScore}</strong>
      </div>
      <p>{match.resultLabel}</p>
    </section>
  );
}

function Overview({ match, expanded, setExpanded }) {
  return (
    <div className="analysis-stack">
      {match.isCompleted ? <ResultSummary match={match} /> : null}
      <ProbabilityBar probabilities={match.probabilities} />
      <MarketReference match={match} />

      <section className="score-strip">
        <div className="module-title">
          <h3>比分倾向</h3>
          <Icon glyph="info" />
        </div>
        <div className="score-grid">
          {match.scores.map((score, index) => (
            <button className={index === 0 ? "score-chip is-primary" : "score-chip"} key={score.line} type="button">
              <strong>{score.line}</strong>
              <span>{score.probability}</span>
            </button>
          ))}
        </div>
      </section>

      <AiAnalysisModule match={match} expanded={expanded} setExpanded={setExpanded} />
    </div>
  );
}

function AiAnalysisModule({ match, expanded, setExpanded }) {
  const factors = buildAiFactorTags(match);
  const players = buildPlayersToWatch(match);
  const visiblePlayers = expanded ? players : players.slice(0, 2);
  const analysis = buildAiAnalysisText(match);
  const canExpand = players.length > 2;

  return (
    <section className="ai-analysis-module">
      <div className="ai-insight-grid">
        <article className="ai-insight-card">
          <div className="ai-section-label">KEY FACTORS · 关键因素</div>
          <div className="ai-factor-tags">
            {factors.map((factor) => (
              <span className="ai-factor-chip" key={factor}>{factor}</span>
            ))}
          </div>

          <div className="ai-section-label">PLAYERS TO WATCH · 关键球员</div>
          <div className="watch-list">
            {visiblePlayers.map((player) => (
              <div className="watch-player" key={`${player.team}-${player.name}`}>
                <Icon glyph="workspace_premium" />
                <div>
                  <strong>{player.name} · {player.team}</strong>
                  <span>{player.note}</span>
                </div>
              </div>
            ))}
          </div>

          {canExpand ? (
            <button className="ai-more-button" type="button" onClick={() => setExpanded((value) => !value)}>
              <Icon glyph={expanded ? "keyboard_arrow_up" : "analytics"} />
              {expanded ? "收起关注球员" : "查看更多关注点"}
            </button>
          ) : null}
        </article>

        <article className="ai-reading-card">
          <div className="ai-section-label">AI ANALYSIS · AI 分析</div>
          <div className="ai-reading-body">
            <strong>{analysis.slice(0, 1)}</strong>
            <p>{analysis.slice(1)}</p>
          </div>
          <p className="ai-reading-note">基于模型概率、FIFA 赛程/赛果、近期赛果、首发情报和市场参考生成。仅供分析娱乐，不构成投注建议。</p>
        </article>
      </div>
    </section>
  );
}

function buildAiFactorTags(match) {
  const tags = [];
  const leader = getProbabilityLeader(match);
  const homeRank = match.home.profile?.worldRanking?.rank;
  const awayRank = match.away.profile?.worldRanking?.rank;
  const homeMarket = getPolymarketWinnerSignal(match.home);
  const awayMarket = getPolymarketWinnerSignal(match.away);

  if (match.isCompleted && match.resultScore) {
    tags.push(`官方赛果 ${match.resultScore}`);
  } else if (leader) {
    tags.push(`${leader.label} ${leader.value}%`);
  }

  if (homeRank && awayRank) {
    const rankGap = Math.abs(homeRank - awayRank);
    if (rankGap >= 20) {
      tags.push(`${homeRank < awayRank ? match.home.name : match.away.name}排名优势`);
    } else {
      tags.push("FIFA排名接近");
    }
  }

  const formTag = buildRecentFormTag(match);
  if (formTag) tags.push(formTag);

  const lineupMode = match.lineupIntel?.displayMode;
  if (lineupMode === "official") tags.push("官方首发已确认");
  else if (lineupMode === "expected") tags.push("预计首发可参考");
  else tags.push("首发仍待确认");

  if (match.matchFacts?.statisticsSource) tags.push("技术统计已接入");
  else if (Array.isArray(match.matchFacts?.events) && match.matchFacts.events.length > 0) tags.push("官方事件流已同步");

  if (homeMarket && awayMarket) {
    tags.push(
      homeMarket.impliedProbabilityPercent >= awayMarket.impliedProbabilityPercent
        ? `${match.home.name}市场热度更高`
        : `${match.away.name}市场热度更高`,
    );
  }

  return [...new Set(tags)].slice(0, 5);
}

function buildRecentFormTag(match) {
  const home = match.recentForm?.home;
  const away = match.recentForm?.away;
  if (!home?.matches || !away?.matches) return null;
  if (home.points > away.points) return `${match.home.name}近况占优`;
  if (away.points > home.points) return `${match.away.name}近况占优`;
  return "双方近况接近";
}

function getProbabilityLeader(match) {
  const rows = Array.isArray(match.probabilities) ? match.probabilities.filter((row) => !row.pending) : [];
  if (rows.length === 0) return null;
  const best = [...rows].sort((a, b) => Number(b.value) - Number(a.value))[0];
  const labels = {
    home: `${match.home.name}方向`,
    draw: "平局权重",
    away: `${match.away.name}方向`,
  };
  return {
    ...best,
    value: Number(best.value),
    label: labels[best.type] ?? best.label,
  };
}

function buildPlayersToWatch(match) {
  const eventPlayers = buildEventPlayers(match);
  const lineupPlayers = [
    pickLineupPlayer(match, "home"),
    pickLineupPlayer(match, "away"),
  ].filter(Boolean);
  const fallbackPlayers = [
    { name: "首发待确认", team: match.home.name, note: "官方或预计首发同步后会展示具体球员。" },
    { name: "首发待确认", team: match.away.name, note: "官方或预计首发同步后会展示具体球员。" },
  ];

  return dedupePlayers([...eventPlayers, ...lineupPlayers, ...fallbackPlayers]).slice(0, 4);
}

function buildEventPlayers(match) {
  const events = Array.isArray(match.matchFacts?.events) ? match.matchFacts.events : [];
  return events
    .filter((event) => ["goal", "booking"].includes(event.type) && event.playerName)
    .slice(0, 4)
    .map((event) => {
      const team = event.side === "away" ? match.away.name : match.home.name;
      const note = event.type === "goal"
        ? `${event.minute ?? ""} 进球，已经直接影响比赛走势。`
        : `${event.minute ?? ""} ${event.card === "red" ? "红牌" : "牌面事件"}，影响比赛节奏。`;
      return { name: event.playerName, team, note };
    });
}

function pickLineupPlayer(match, side) {
  const intel = match.lineupIntel ?? {};
  const source = intel.displayMode === "official" ? intel.official : intel.displayMode === "expected" ? intel.expected : null;
  const lineup = source?.[side];
  if (!lineup?.starters?.length) return null;
  const player = (
    lineup.starters.find((item) => item.note?.includes("队长")) ??
    lineup.starters.find((item) => ["FW", "ST", "CF", "WG"].some((key) => item.position?.includes(key))) ??
    lineup.starters.find((item) => item.position?.includes("MF")) ??
    lineup.starters[0]
  );
  const team = side === "home" ? match.home.name : match.away.name;
  return {
    name: player.name,
    team,
    note: `${source.sourceType === "official" ? "官方首发" : "预计首发"} · ${player.position ?? "位置待确认"}${player.note ? ` · ${player.note}` : ""}`,
  };
}

function dedupePlayers(players) {
  const seen = new Set();
  return players.filter((player) => {
    const key = `${player.team}-${player.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildAiAnalysisText(match) {
  const leader = getProbabilityLeader(match);
  const scoreRange = match.scoreRange && match.scoreRange !== "待模型输出" ? `比分倾向集中在 ${match.scoreRange}。` : "";
  const form = buildRecentFormTag(match);
  const lineup = match.lineupIntel?.displayMode === "official"
    ? "官方首发已经确认，阵容信息可信度更高。"
    : match.lineupIntel?.displayMode === "expected"
      ? "当前有预计首发可参考，但仍需等待官方确认。"
      : "首发阵容仍未确认，临场信息会影响后续判断。";

  if (match.isCompleted && match.resultScore) {
    const events = Array.isArray(match.matchFacts?.events) ? match.matchFacts.events : [];
    const goals = events.filter((event) => event.type === "goal").length;
    const cards = events.filter((event) => event.type === "booking").length;
    return `${match.home.name}与${match.away.name}已经完赛，官方比分为 ${match.resultScore}。从事件流看，本场记录了 ${goals} 个进球和 ${cards} 次牌面事件，比赛走势已经从赛前预测转为赛后复盘。${match.aiBrief}`;
  }

  if (leader?.type === "draw") {
    return `这场比赛的平局权重较高，模型没有给出明显单边优势。${scoreRange}${form ? `${form}，` : ""}${lineup}${match.aiBrief}`;
  }

  if (leader) {
    return `${leader.label}是当前模型下的主线，胜率约 ${leader.value}%。${scoreRange}${form ? `${form}，` : ""}${lineup}${match.aiBrief}`;
  }

  return `${lineup}${match.aiBrief}`;
}

function ProbabilityBar({ probabilities }) {
  const pending = probabilities.every((item) => item.pending);

  return (
    <section className="probability-module">
      <div className="module-title">
        <h3>胜平负概率</h3>
        <Icon glyph="info" />
      </div>
      {pending ? (
        <div className="probability-pending">
          <Icon glyph="info" />
          <strong>模型待覆盖</strong>
          <span>该场比赛已同步官方赛程，但基础模型暂未覆盖全部球队。</span>
        </div>
      ) : (
        <div className="probability-bar" aria-label="胜平负概率">
          {probabilities.map((item) => (
            <div
              className={`probability-segment ${item.type}`}
              key={item.type}
              style={{ width: `${item.value}%` }}
            >
              <strong>{item.value}%</strong>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function MarketReference({ match }) {
  const homeSignal = getPolymarketWinnerSignal(match.home);
  const awaySignal = getPolymarketWinnerSignal(match.away);
  const hasSignal = Boolean(homeSignal || awaySignal);

  return (
    <section className="market-reference">
      <div className="module-title">
        <h3>市场参考</h3>
      </div>
      {hasSignal ? (
        <>
          <div className="market-reference-grid">
            <MarketSignalCard team={match.home} signal={homeSignal} />
            <MarketSignalCard team={match.away} signal={awaySignal} />
          </div>
        </>
      ) : (
        <div className="probability-pending">
          <Icon glyph="monitoring" />
          <strong>市场参考待同步</strong>
          <span>运行 Polymarket 只读同步后，这里会展示两队的冠军市场隐含概率。</span>
        </div>
      )}
    </section>
  );
}

function MarketSignalCard({ team, signal }) {
  if (!signal) {
    return (
      <article className="market-signal-card is-empty">
        <div className="market-team">
          <img src={team.flag} alt="" />
          <strong>{team.name}</strong>
        </div>
        <span>暂无市场信号</span>
      </article>
    );
  }

  return (
    <article className="market-signal-card">
      <div className="market-team">
        <img src={team.flag} alt="" />
        <strong>{team.name}</strong>
      </div>
      <div className="market-main">
        <span>夺冠市场概率</span>
        <strong>{formatPercentValue(signal.impliedProbabilityPercent)}</strong>
      </div>
      <div className="market-metrics">
        <span>价格 {formatPriceValue(signal.price)}</span>
        <span>换算 {formatDecimalOdds(signal.decimalOdds)}</span>
        <span>流动性 {formatCompactUsd(signal.liquidity)}</span>
        <span>24h {formatCompactUsd(signal.volume24hr)}</span>
      </div>
    </article>
  );
}

function getPolymarketWinnerSignal(team) {
  return team?.profile?.marketSignals?.polymarket?.worldCupWinner ?? null;
}

function formatPercentValue(value) {
  return value == null ? "待更新" : `${value}%`;
}

function formatTrackPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${(number * 100).toFixed(1)}%`;
}

function formatTrackNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return number.toFixed(3);
}

function formatSignedNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return `${number > 0 ? "+" : ""}${number}`;
}

function formatPriceValue(value) {
  return value == null ? "--" : `$${Number(value).toFixed(3)}`;
}

function formatDecimalOdds(value) {
  return value == null ? "--" : `${Number(value).toFixed(2)}x`;
}

function formatCompactUsd(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  if (number >= 1000000000) return `$${(number / 1000000000).toFixed(1)}B`;
  if (number >= 1000000) return `$${(number / 1000000).toFixed(1)}M`;
  if (number >= 1000) return `$${(number / 1000).toFixed(1)}K`;
  return `$${Math.round(number)}`;
}

function MatchSituation({ match }) {
  const completed = match.isCompleted && match.score?.home != null && match.score?.away != null;
  const recentRows = buildRecentSituationRows(match);
  const officialRows = buildOfficialSituationRows(match);
  const events = Array.isArray(match.matchFacts?.events) ? match.matchFacts.events : [];
  const hasTechnicalStats = officialRows.length > 0;
  const sourceLabel = buildSituationSourceLabel(match, completed, hasTechnicalStats);

  return (
    <section className="detail-view situation-view">
      <div className="module-title">
        <h3>{completed ? "赛况" : "赛前对比"}</h3>
        <span>{sourceLabel}</span>
      </div>

      <div className="situation-scoreboard">
        <TeamLine team={match.home} />
        <div className="situation-score">
          <strong>{completed ? `${match.score.home} - ${match.score.away}` : "VS"}</strong>
          <span>{match.status}</span>
        </div>
        <TeamLine team={match.away} />
      </div>

      {completed && !hasTechnicalStats ? (
        <div className="stats-pending">
          <Icon glyph="dataset" />
          <strong>技术统计待接入</strong>
          <p>控球率、射门、射正、角球、犯规、牌数等需要官方比赛事件或技术统计源。当前不展示推测值。</p>
        </div>
      ) : null}

      {completed && hasTechnicalStats ? (
        <div className="situation-stat-list">
          {officialRows.map((row) => (
            <SituationStatRow row={row} key={row.label} />
          ))}
        </div>
      ) : null}

      {completed && hasTechnicalStats ? <SituationSourceNote facts={match.matchFacts} /> : null}

      {completed && events.length > 0 ? <MatchEventsTimeline match={match} events={events} /> : null}

      {!completed && recentRows.length > 0 ? (
        <div className="situation-stat-list">
          {recentRows.map((row) => (
            <SituationStatRow row={row} key={row.label} />
          ))}
        </div>
      ) : !completed ? (
        <div className="stats-pending">
          <Icon glyph="dataset" />
          <strong>赛前对比待同步</strong>
          <p>这场比赛还没有足够的近期真实赛果窗口，因此不展示对比指标。</p>
        </div>
      ) : null}
    </section>
  );
}

function buildSituationSourceLabel(match, completed, hasTechnicalStats) {
  if (!completed) return "基于真实近期赛果计算";
  if (hasTechnicalStats) {
    const sourceId = match.matchFacts?.statisticsSource?.sourceId;
    return sourceId === "api-football-fixture-statistics"
      ? "官方比分 + API-Football 补充技术统计"
      : "官方比分与补充技术统计已同步";
  }
  return "官方比分已同步，技术统计待接入";
}

function SituationSourceNote({ facts }) {
  const statSource = facts?.statisticsSource;
  const statSourceName = statSource?.sourceId === "api-football-fixture-statistics"
    ? "API-Football 技术统计"
    : "补充技术统计";
  const statTime = formatDateTimeLabel(statSource?.retrievedAt);
  const eventTime = formatDateTimeLabel(facts?.retrievedAt);

  return (
    <p className="situation-source-note">
      技术统计来源：{statSourceName}{statTime ? ` · ${statTime}` : ""}。比分与事件仍以 FIFA 官方数据为准{eventTime ? ` · ${eventTime}` : ""}。
    </p>
  );
}

function SituationStatRow({ row }) {
  const max = Math.max(row.homeValue, row.awayValue, 1);
  const homeWidth = Math.max(4, Math.round((row.homeValue / max) * 100));
  const awayWidth = Math.max(4, Math.round((row.awayValue / max) * 100));

  return (
    <div className="situation-stat-row">
      <strong>{row.homeLabel}</strong>
      <div className="situation-stat-bars">
        <span>{row.label}</span>
        <div>
          <i className="home-bar" style={{ width: `${homeWidth}%` }} />
          <i className="away-bar" style={{ width: `${awayWidth}%` }} />
        </div>
      </div>
      <strong>{row.awayLabel}</strong>
    </div>
  );
}

function MatchEventsTimeline({ match, events }) {
  return (
    <section className="events-timeline">
      <div className="module-title">
        <h3>比赛事件</h3>
        <span>FIFA 官方 live football</span>
      </div>
      <div className="event-list">
        {events.map((event) => (
          <MatchEventRow event={event} match={match} key={event.id} />
        ))}
      </div>
    </section>
  );
}

function MatchEventRow({ event, match }) {
  const team = event.side === "away" ? match.away : match.home;
  const copy = eventCopy(event);
  return (
    <div className={`event-row ${event.side}`}>
      <strong>{event.minute ?? "--"}</strong>
      <span className={`event-dot ${event.type}`} />
      <div>
        <b>{copy.title}</b>
        <span>{team.name} · {copy.detail}</span>
      </div>
    </div>
  );
}

function Variables({ match }) {
  return (
    <section className="detail-view">
      <div className="module-title">
        <h3>变量拆解</h3>
        <span>点击左侧比赛可切换分析对象</span>
      </div>
      <LineupIntel match={match} />
      <div className="attribution-list">
        {match.variables.map((factor) => (
          <div className="attribution-row" key={factor.title}>
            <Icon glyph={factor.icon} />
            <div>
              <strong>{factor.title}</strong>
              <p>{factor.copy}</p>
            </div>
            <b className={factor.impact < 0 ? "is-negative" : ""}>
              {factor.impact > 0 ? "+" : ""}
              {factor.impact}%
            </b>
          </div>
        ))}
      </div>
    </section>
  );
}

function LineupIntel({ match }) {
  const intel = match.lineupIntel ?? normalizeLineupIntel();

  return (
    <section className="lineup-intel">
      <div className="module-title">
        <h3>首发与伤停</h3>
        <span>官方确认 / 赛前预计</span>
      </div>
      <div className="lineup-grid">
        <LineupSource source={intel.official} homeName={match.home.name} awayName={match.away.name} />
        <LineupSource source={intel.expected} homeName={match.home.name} awayName={match.away.name} />
      </div>
    </section>
  );
}

function LineupSource({ source, homeName, awayName }) {
  const hasData = hasLineupSourceData(source);

  return (
    <article className={`lineup-source ${source.status === "available" ? "is-available" : ""}`}>
      <div className="lineup-source-head">
        <strong>{source.label}</strong>
        <span>{lineupStatusLabel(source)}</span>
      </div>
      <p>{lineupSourceCopy(source)}</p>
      {hasData ? (
        <div className="lineup-teams">
          <LineupTeam name={homeName} lineup={source.home} />
          <LineupTeam name={awayName} lineup={source.away} />
        </div>
      ) : (
        <div className="lineup-empty">暂无可展示名单</div>
      )}
    </article>
  );
}

function LineupTeam({ name, lineup }) {
  return (
    <div className="lineup-team">
      <div className="lineup-team-head">
        <strong>{name}</strong>
        <span>{lineup?.formation ?? "阵型待确认"}</span>
      </div>
      <LineupPlayers label="首发" players={lineup?.starters} />
      <LineupPlayers label="替补" players={lineup?.substitutes} />
      <LineupPlayers label="伤停/缺席" players={lineup?.unavailable} />
    </div>
  );
}

function LineupPlayers({ label, players = [] }) {
  if (!players.length) return null;

  return (
    <div className="lineup-player-group">
      <span>{label}</span>
      <ul>
        {players.slice(0, 11).map((player) => (
          <li key={`${label}-${player.name}-${player.shirtNumber ?? ""}`}>
            {formatPlayer(player)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SelectedLineupIntel({ match }) {
  const intel = match.lineupIntel ?? normalizeLineupIntel();
  const selected = selectLineupSource(intel);

  return (
    <section className="detail-view lineup-board-view">
      <div className="module-title">
        <h3>首发阵容</h3>
        <span>官方优先，没有官方时展示赛前预计</span>
      </div>

      {selected ? (
        <>
          <div className={`lineup-source-banner ${selected.kind}`}>
            <div>
              <strong>{selected.source.label}</strong>
              <span>{selected.kind === "official" ? "官方确认" : "赛前预计"}</span>
            </div>
            <p>{lineupSourceCopy(selected.source)}</p>
          </div>

          <PitchLineup match={match} source={selected.source} />

          <div className="lineup-support-grid">
            <CompactLineupList title={`${match.home.name} 替补`} players={selected.source.home?.substitutes} />
            <CompactLineupList title={`${match.away.name} 替补`} players={selected.source.away?.substitutes} />
            <CompactLineupList title={`${match.home.name} 伤停/缺席`} players={selected.source.home?.unavailable} />
            <CompactLineupList title={`${match.away.name} 伤停/缺席`} players={selected.source.away?.unavailable} />
          </div>
        </>
      ) : (
        <div className="stats-pending">
          <Icon glyph="dataset" />
          <strong>阵容待更新</strong>
          <p>当前没有官方首发，也没有通过审核的预计首发。后续同步后会自动显示球场阵型图。</p>
        </div>
      )}
    </section>
  );
}

function PitchLineup({ match, source }) {
  const homeSlots = buildPitchSlots(source.home?.starters, "home");
  const awaySlots = buildPitchSlots(source.away?.starters, "away");

  return (
    <section className="pitch-lineup">
      <div className="pitch-meta home">
        <strong>{source.home?.formation ?? "阵型待定"}</strong>
        <span>{match.home.name}</span>
      </div>
      <div className="pitch-meta away">
        <strong>{source.away?.formation ?? "阵型待定"}</strong>
        <span>{match.away.name}</span>
      </div>
      {[...homeSlots, ...awaySlots].map((slot) => (
        <div
          className={`pitch-player ${slot.side}`}
          key={`${slot.side}-${slot.player.name}-${slot.player.shirtNumber ?? slot.index}`}
          style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
        >
          <span>{slot.player.shirtNumber ?? slot.index + 1}</span>
          <strong>{shortPlayerName(slot.player.name)}</strong>
          <small>{slot.player.position ?? ""}</small>
        </div>
      ))}
    </section>
  );
}

function CompactLineupList({ title, players = [] }) {
  return (
    <article className="compact-lineup-list">
      <strong>{title}</strong>
      {players?.length ? (
        <ul>
          {players.slice(0, 12).map((player) => (
            <li key={`${title}-${player.name}-${player.shirtNumber ?? ""}`}>{formatPlayer(player)}</li>
          ))}
        </ul>
      ) : (
        <span>暂无名单</span>
      )}
    </article>
  );
}

function Intel({ match }) {
  return (
    <section className="detail-view">
      <div className="module-title">
        <h3>情报简报</h3>
        <span>适合录屏讲解</span>
      </div>
      <div className="brief-script">
        {match.script.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      <button className="expand-button" type="button">
        <Icon glyph="auto_awesome" />
        生成 60 秒讲解稿
      </button>
    </section>
  );
}

function ReviewPreview({ match }) {
  return (
    <section className="detail-view">
      <div className="module-title">
        <h3>复盘预览</h3>
        <span>第二阶段上线</span>
      </div>
      <div className="model-table">
        {match.models.map((model) => (
          <div className="model-row" key={model.name}>
            <strong>{model.name}</strong>
            <span>{model.signal}</span>
            <b>{model.metric}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

function StrategyReference({ match }) {
  const strategy = buildStrategyAnalysis(match);

  return (
    <section className="detail-view strategy-view">
      <div className="module-title">
        <h3>模拟策略</h3>
        <span>Polymarket 只读 / 模型概率 / 场景盈亏</span>
      </div>

      <article className={`strategy-summary-card ${strategy.summary.tone}`}>
        <Icon glyph="tactic" />
        <div>
          <strong>{strategy.summary.title}</strong>
          <p>{strategy.summary.copy}</p>
        </div>
      </article>

      {match.marketOdds?.polymarket?.aiAnalysis?.text ? (
        <article className="strategy-ai-card">
          <div className="ai-section-label">AI ANALYSIS · AI 分析</div>
          <p>{match.marketOdds.polymarket.aiAnalysis.text}</p>
          <span>
            DeepSeek · {formatDateTimeLabel(match.marketOdds.polymarket.aiAnalysis.generatedAt)}
          </span>
        </article>
      ) : null}

      {strategy.hasSingleMatchMarkets ? (
        <div className="strategy-board">
          <StrategyMarketBoard strategy={strategy} />
          <StrategyPortfolioBoard strategy={strategy} />
          <StrategyScenarioBoard strategy={strategy} />
        </div>
      ) : (
        <article className="strategy-requirements">
          <div>
            <Icon glyph="monitoring" />
            <strong>单场盘口接入后生成组合</strong>
          </div>
          <p>系统会比较“模型概率”和“市场隐含概率”，再输出价值分层、100u 模拟组合和比分风险推演。</p>
          <ul>
            {strategy.requirements.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      )}

      <p className="strategy-disclaimer">
        这里用于理解模型与市场价格分歧，仅供分析娱乐，不构成投注建议；不要用它绕过任何地区、平台或合规限制。
      </p>
    </section>
  );
}

function StrategyMarketBoard({ strategy }) {
  return (
    <article className="strategy-panel strategy-panel-wide">
      <div className="strategy-panel-head">
        <div>
          <div className="ai-section-label">LIVE MARKET · 盘口判断</div>
          <h4>Polymarket vs 模型</h4>
        </div>
        <span>{strategy.hasDerivativeMarkets ? "含 More Markets 衍生盘" : "仅胜平负主盘"}</span>
      </div>
      <div className="strategy-table strategy-market-table">
        <div className="strategy-table-head">
          <span>盘口</span>
          <span>Polymarket</span>
          <span>模型</span>
          <span>判断</span>
        </div>
        {strategy.marketRows.slice(0, 7).map((row) => (
          <div className="strategy-table-row" key={row.key}>
            <strong>{row.label}</strong>
            <span>{formatPercentValue(row.marketProbability)}</span>
            <span>{formatPercentValue(row.modelProbability)}</span>
            <b className={row.edge >= 0 ? "is-positive" : "is-negative"}>
              {row.edge == null ? row.verdict : `${row.verdict} ${formatSignedNumber(row.edge)}pp`}
            </b>
          </div>
        ))}
      </div>
      <p className="strategy-card-note">
        Polymarket 价格按 Yes 份额换算为市场隐含概率。模型概率来自 Elo + Dixon-Coles 与比分分布推演，不会反向参与盘口定价。
      </p>
    </article>
  );
}

function StrategyPortfolioBoard({ strategy }) {
  const portfolio = strategy.portfolio;
  if (!portfolio || portfolio.status !== "ready") {
    return (
      <article className="strategy-panel">
        <div className="ai-section-label">SIMULATION · 模拟组合</div>
        <h4>{portfolio?.title ?? "暂不生成组合"}</h4>
        <p className="strategy-card-note">{portfolio?.copy ?? "当前盘口不足，无法生成可解释的 100u 组合。"}</p>
      </article>
    );
  }

  return (
    <article className="strategy-panel">
      <div className="strategy-panel-head">
        <div>
          <div className="ai-section-label">SIMULATION · 模拟组合</div>
          <h4>{portfolio.title}</h4>
        </div>
        <span>总计 100u</span>
      </div>
      <div className="strategy-metric-strip">
        <div>
          <span>期望净收益</span>
          <strong className={portfolio.metrics.expectedNet >= 0 ? "is-positive" : "is-negative"}>
            {formatSignedNumber(portfolio.metrics.expectedNet)}u
          </strong>
        </div>
        <div>
          <span>盈利概率</span>
          <strong>{formatPercentValue(portfolio.metrics.profitProbability)}</strong>
        </div>
        <div>
          <span>大亏 50u+</span>
          <strong className="is-negative">{formatPercentValue(portfolio.metrics.bigLossProbability)}</strong>
        </div>
      </div>
      <div className="strategy-combo-table">
        {portfolio.rows.map((row) => (
          <div className="strategy-combo-item" key={row.key}>
            <div>
              <strong>{row.label}</strong>
              <span>市场 {formatPercentValue(row.marketProbability)} · 模型 {formatPercentValue(row.modelProbability)}</span>
            </div>
            <b>{row.units}u</b>
            <em>{row.verdict}</em>
          </div>
        ))}
      </div>
      <p className="strategy-card-note">{portfolio.copy}</p>
    </article>
  );
}

function StrategyScenarioBoard({ strategy }) {
  const portfolio = strategy.portfolio;
  if (!portfolio || portfolio.status !== "ready") return null;

  return (
    <article className="strategy-panel">
      <div className="strategy-panel-head">
        <div>
          <div className="ai-section-label">SCENARIOS · 比分盈亏</div>
          <h4>常见比分净盈亏</h4>
        </div>
        <span>不含手续费/滑点</span>
      </div>
      <div className="strategy-table strategy-score-table">
        <div className="strategy-table-head">
          <span>比分</span>
          <span>模型概率</span>
          <span>净盈亏</span>
        </div>
        {portfolio.scoreRows.map((row) => (
          <div className="strategy-table-row" key={row.line}>
            <strong>{row.line}</strong>
            <span>{formatPercentValue(row.probabilityPercent)}</span>
            <b className={row.net >= 0 ? "is-positive" : "is-negative"}>{formatSignedNumber(row.net)}u</b>
          </div>
        ))}
      </div>
    </article>
  );
}

function AiBrief({ match }) {
  const marketAnalysis = match.marketOdds?.polymarket?.aiAnalysis;
  const modelOnlyAnalysis = match.aiAnalysis?.modelOnly;
  const analysis = marketAnalysis?.text ? marketAnalysis : modelOnlyAnalysis;
  const copy = analysis?.text ?? match.aiBrief;
  const sourceLabel = analysis?.scope === "model_market" ? "模型+市场解读" : "模型解读";

  return (
    <section className="side-card ai-card">
      <div className="side-heading">
        <Icon glyph="smart_toy" className="ai-badge" />
        <h3>AI 智能解读</h3>
      </div>
      <p>{copy}</p>
      {analysis?.generatedAt ? (
        <span className="ai-brief-source">
          DeepSeek · {sourceLabel} · {formatDateTimeLabel(analysis.generatedAt)}
        </span>
      ) : null}
      <div className="brief-outcome">
        <span>推荐比分区间</span>
        <strong>{match.scoreRange}</strong>
      </div>
    </section>
  );
}

function RiskRadar({ match }) {
  return (
    <section className="side-card">
      <div className="side-heading">
        <Icon glyph="radar" />
        <h3>近期表现雷达</h3>
      </div>
      <div className="metric-stack">
        {match.radar.map((metric) => (
          metric.home && metric.away ? (
            <div className="metric-row metric-row-compare" key={metric.label}>
              <span className="metric-label">{metric.label}</span>
              <TeamMetricLine side="home" team={match.home.name} metric={metric.home} />
              <TeamMetricLine side="away" team={match.away.name} metric={metric.away} />
            </div>
          ) : (
            <div className="metric-row" key={metric.label}>
              <div>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </div>
              <div className="mini-bar">
                <i style={{ width: `${metric.value}%` }} />
              </div>
            </div>
          )
        ))}
      </div>
    </section>
  );
}

function RecentFormRadar({ match }) {
  const metrics = Array.isArray(match.radar)
    ? match.radar.filter((metric) => metric?.source === "recentForm" && metric.home && metric.away)
    : [];

  return (
    <section className="side-card">
      <div className="side-heading">
        <Icon glyph="radar" />
        <h3>近期表现</h3>
      </div>
      {metrics.length > 0 ? (
        <div className="metric-stack">
          {metrics.map((metric) => (
            <div className="metric-row metric-row-compare" key={metric.label}>
              <span className="metric-label">{metric.label}</span>
              <TeamMetricLine side="home" team={match.home.name} metric={metric.home} />
              <TeamMetricLine side="away" team={match.away.name} metric={metric.away} />
            </div>
          ))}
        </div>
      ) : (
        <div className="metric-empty">
          <Icon glyph="dataset" />
          <strong>近期表现待同步</strong>
          <span>没有真实赛果窗口时，不展示推测指标。</span>
        </div>
      )}
    </section>
  );
}

function TeamMetricLine({ side, team, metric }) {
  return (
    <div className={`team-metric-line ${side}`}>
      <div>
        <span>{team}</span>
        <strong>{metric.value}</strong>
      </div>
      <small>{metric.detail}</small>
      <div className="mini-bar">
        <i style={{ width: `${metric.value}%` }} />
      </div>
    </div>
  );
}

function Confidence({ match }) {
  return (
    <section className="side-card confidence-card">
      <div className="side-heading">
        <Icon glyph="monitoring" />
        <h3>信心指数</h3>
      </div>
      <div className="confidence-layout">
        <div className="confidence-ring" style={{ "--score": `${match.confidenceScore}%` }}>
          <strong>{match.confidenceScore}</strong>
          <span>100</span>
        </div>
        <p>{match.confidenceCopy}</p>
      </div>
    </section>
  );
}

function RecentChanges({ match }) {
  return (
    <section className="side-card">
      <div className="side-heading">
        <Icon glyph="update" />
        <h3>赛前动态</h3>
      </div>
      <div className="change-list">
        {match.changes.map((change) => (
          <div className="change-row" key={`${change.time}-${change.copy}`}>
            <span>{change.time}</span>
            <p>{change.copy}</p>
            {change.delta ? <strong className={change.direction}>{change.delta}</strong> : <i />}
          </div>
        ))}
      </div>
    </section>
  );
}

function statusClass(status) {
  if (status === "已完赛") return "completed-status";
  if (status === "进行中") return "live-status";
  if (status === "高关注" || status === "开幕战") return "watch-status";
  return "scheduled-status";
}

const navItems = [
  { label: "指挥舱", icon: "home", active: true },
  { label: "今日赛程", icon: "calendar_today" },
  { label: "赛事日历", icon: "event_note" },
  { label: "模型中心", icon: "deployed_code" },
  { label: "数据中心", icon: "bar_chart" },
  { label: "战术库", icon: "tactic" },
  { label: "球队库", icon: "groups" },
  { label: "情报中心", icon: "article" },
  { label: "复盘回测", icon: "history", badge: "即将上线" },
];

const appNavItems = [
  { id: "command", label: "指挥舱", title: "世界杯预测 · 赛事指挥舱", icon: "home" },
  { id: "today", label: "今日赛程", title: "今日赛程", icon: "calendar_today" },
  { id: "calendar", label: "赛事日历", title: "赛事日历", icon: "event_note" },
  { id: "model", label: "模型中心", title: "模型中心", icon: "deployed_code" },
  { id: "data", label: "数据中心", title: "数据中心", icon: "bar_chart" },
  { id: "portfolio", label: "账户监控", title: "Polymarket 只读账户监控", icon: "user" },
  { id: "movement", label: "盘口走势", title: "Polymarket 盘口走势", icon: "monitoring" },
  { id: "marketBacktest", label: "走势回测", title: "Polymarket 走势信号回测", icon: "bar_chart" },
  { id: "tactics", label: "战术库", title: "战术库", icon: "tactic" },
  { id: "teams", label: "球队库", title: "球队库", icon: "groups" },
  { id: "intelCenter", label: "情报中心", title: "情报中心", icon: "article" },
  { id: "reviewCenter", label: "模型战绩", title: "模型战绩", icon: "history" },
];

const filters = [
  { id: "all", label: "全部" },
  { id: "today", label: "今日" },
  { id: "watch", label: "强关注" },
];

const tabs = [
  { id: "overview", label: "总览" },
  { id: "variables", label: "变量" },
  { id: "intel", label: "情报" },
  { id: "review", label: "复盘" },
];

const matchTabs = [
  { id: "overview", label: "总览" },
  { id: "situation", label: "赛况" },
  { id: "lineup", label: "阵容" },
  { id: "intel", label: "情报" },
  { id: "review", label: "复盘" },
  { id: "strategy", label: "策略" },
];

const dataTabs = [
  { id: "standings", label: "积分榜" },
  { id: "scorers", label: "射手榜" },
  { id: "assists", label: "助攻榜" },
  { id: "coverage", label: "数据覆盖" },
];

const centerViewCopy = {
  model: {
    eyebrow: "Model Center",
    title: "模型中心",
    icon: "deployed_code",
    copy: "面向用户展示模型版本、预测覆盖、历史表现和每场预测的输入来源。",
    ready: ["Elo + Dixon-Coles + Monte Carlo 基线输出", "每场预测快照和模型运行记录", "缺数据比赛不显示伪概率"],
    next: ["加入模型版本对比", "展示单场输入特征", "把回测指标做成可浏览图表"],
  },
  tactics: {
    eyebrow: "Tactics",
    title: "战术库",
    icon: "tactic",
    copy: "把比赛变量翻译成用户能读懂的战术侧重点，后续可按球队和阵型沉淀。",
    ready: ["关键变量卡片", "近期表现雷达", "首发/伤停入口"],
    next: ["按球队保存常用阵型", "接入官方阵容后自动更新", "为比赛页生成战术摘要"],
  },
  teams: {
    eyebrow: "Teams",
    title: "球队库",
    icon: "groups",
    copy: "聚合球队赛程、积分、近期状态和模型覆盖，帮助用户从球队维度浏览世界杯。",
    ready: ["从赛程 feed 聚合球队", "积分榜排名", "近五场指标"],
    next: ["球队详情页", "阵容名单", "历史交锋和赛地信息"],
  },
  intelCenter: {
    eyebrow: "Intel",
    title: "情报中心",
    icon: "article",
    copy: "集中展示官方首发、预计首发、伤停和赛前变化，保持官方与预计两种来源分开。",
    ready: ["官方首发槽位", "RotoWire 预计首发槽位", "来源状态说明"],
    next: ["按比赛时间自动提醒", "来源冲突提示", "赛前变化时间线"],
  },
  reviewCenter: {
    eyebrow: "Review",
    title: "复盘回测",
    icon: "history",
    copy: "完赛后对比预测概率、推荐比分和真实比分，帮助用户理解模型表现。",
    ready: ["完赛比分同步", "单场模型快照", "后端回测命令"],
    next: ["预测命中统计", "按小组/球队筛选复盘", "可分享的赛后卡片"],
  },
};

const currentUser = null;

const flag = (code) => `/assets/flags/${code}.png`;

const iconMap = {
  analytics: ChartLineUp,
  article: Article,
  auto_awesome: Sparkle,
  bar_chart: ChartBar,
  calendar_month: CalendarBlank,
  calendar_today: Calendar,
  cancel: XCircle,
  chat: ChatCircleText,
  close: X,
  cloud: CloudSun,
  compare_arrows: ArrowsLeftRight,
  dataset: Database,
  deployed_code: Database,
  emoji_events: Trophy,
  event_note: CalendarDots,
  groups: UsersThree,
  help: Question,
  history: ClockCounterClockwise,
  home: House,
  info: Info,
  keyboard_arrow_up: CaretUp,
  monitoring: Gauge,
  notifications: Bell,
  psychology: Brain,
  radar: Gauge,
  rocket_launch: RocketLaunch,
  settings: GearSix,
  shield: Shield,
  smart_toy: Robot,
  speed: Speedometer,
  sports_soccer: SoccerBall,
  stadium: Medal,
  sync: ArrowsClockwise,
  tactic: Strategy,
  update: ArrowClockwise,
  user: UserCircle,
  verified: CheckCircle,
  bolt: Lightning,
  workspace_premium: Medal,
  height: ShieldCheck,
  sync_alt: ArrowsLeftRight,
};

const fallbackMatches = [
  {
    id: "usa-paraguay",
    date: "2026-06-12",
    dateLabel: "6月12日",
    kickoffSort: "02:00",
    modelHome: "usa",
    modelAway: "paraguay",
    modelVenue: "home",
    time: "6月12日",
    group: "世界杯 小组赛",
    competition: "世界杯",
    status: "未开赛",
    watch: true,
    recommendation: "主队不败",
    confidence: "67",
    confidenceScore: 67,
    confidenceCopy: "基于模型一致性、变量完整性与历史表现综合评估，中等偏高。",
    home: { name: "美国", flag: flag("us"), form: "近5场 3胜1平1负" },
    away: { name: "巴拉圭", flag: flag("py"), form: "近5场 2胜1平2负" },
    probabilities: [
      { label: "胜", value: 52, type: "home" },
      { label: "平", value: 28, type: "draw" },
      { label: "胜", value: 20, type: "away" },
    ],
    scores: [
      { line: "1-0", probability: "15%" },
      { line: "2-1", probability: "14%" },
      { line: "1-1", probability: "13%" },
      { line: "2-0", probability: "11%" },
      { line: "0-1", probability: "9%" },
    ],
    variables: [
      { icon: "stadium", title: "主场优势", copy: "美国本场中立偏主场，压迫转换更主动。", impact: 8 },
      { icon: "verified", title: "近期状态", copy: "美国近5场进攻效率更稳定，失误率下降。", impact: 12 },
      { icon: "cloud", title: "天气场地", copy: "多云 22°C 微风，利于高节奏推进。", impact: 3 },
      { icon: "rocket_launch", title: "反击风险", copy: "巴拉圭反击效率高，边路身后空间需控制。", impact: -9 },
      { icon: "cancel", title: "伤停观察", copy: "双方均有主力缺阵，影响中场连续性。", impact: -6 },
      { icon: "psychology", title: "心理压力", copy: "美国晋级压力中等，开局容易偏谨慎。", impact: -3 },
      { icon: "sports_soccer", title: "定位球威胁", copy: "美国定位球二点控制更强。", impact: 5 },
      { icon: "speed", title: "体能窗口", copy: "巴拉圭后程回追压力更大。", impact: 4 },
    ],
    aiBrief:
      "美国整体实力占优，控球与进攻效率更高，预计将主动掌控节奏。巴拉圭的主要机会来自快速反击与定位球威胁，美国需要警惕身后空间。综合来看，美国小胜概率更大，比分可能集中在 1-0 或 2-1。",
    scoreRange: "1-0 / 2-1",
    radar: [
      { label: "进攻火力", value: 72 },
      { label: "防守稳固", value: 68 },
      { label: "状态稳定", value: 65 },
      { label: "伤病影响", value: 58 },
      { label: "战术执行", value: 70 },
      { label: "临场应变", value: 63 },
    ],
    model: "VibeCoding WorldCup v1.0",
    backtest: "近30天准确率 61.2%",
    changes: [
      { time: "今日", copy: "赛程已确认，赛前信息将持续更新", delta: "", direction: "flat" },
      { time: "赛前", copy: "阵容、天气和首发信息会在确认后同步", delta: "", direction: "flat" },
    ],
    script: [
      "这场比赛美国的优势主要来自中前场推进效率，而不是单纯纸面实力。",
      "巴拉圭如果能把比赛切碎，并在美国边后卫身后制造反击，比赛会进入更胶着的 1 球差区间。",
      "当前模型更偏向美国小胜，但不是大胜局，风险点集中在反击和定位球。",
    ],
    compare: [
      { label: "实力评分", home: "1848", away: "1712" },
      { label: "近5场进球", home: "8", away: "5" },
      { label: "近5场失球", home: "4", away: "6" },
      { label: "定位球威胁", home: "中高", away: "中" },
      { label: "反击效率", home: "中", away: "高" },
    ],
    models: [
      { name: "赔率参考", signal: "美国不败", metric: "历史表现良好" },
      { name: "统计模型", signal: "美国胜", metric: "已启用" },
      { name: "LLM-only", signal: "小比分", metric: "待回测" },
      { name: "Hybrid", signal: "美国小胜", metric: "第二阶段" },
    ],
  },
  {
    id: "mexico-south-africa",
    date: "2026-06-11",
    dateLabel: "6月11日",
    kickoffSort: "01:00",
    modelHome: "mexico",
    modelAway: "south-africa",
    modelVenue: "home",
    time: "6月11日",
    group: "世界杯 开幕战",
    competition: "世界杯",
    status: "开幕战",
    watch: true,
    recommendation: "墨西哥优势",
    confidence: "71",
    confidenceScore: 71,
    confidenceCopy: "墨西哥攻防强度更均衡，但南非反击速度会压低胜率上限。",
    home: { name: "墨西哥", flag: flag("mx"), form: "近5场 4胜0平1负" },
    away: { name: "南非", flag: flag("za"), form: "近5场 2胜2平1负" },
    probabilities: [
      { label: "胜", value: 55, type: "home" },
      { label: "平", value: 27, type: "draw" },
      { label: "胜", value: 18, type: "away" },
    ],
    scores: [
      { line: "2-0", probability: "16%" },
      { line: "1-0", probability: "14%" },
      { line: "2-1", probability: "13%" },
      { line: "1-1", probability: "12%" },
      { line: "3-1", probability: "8%" },
    ],
    variables: [
      { icon: "groups", title: "中场控制", copy: "墨西哥中路出球更稳定。", impact: 10 },
      { icon: "speed", title: "转换速度", copy: "南非反击速度会制造压力。", impact: -7 },
      { icon: "sports_soccer", title: "定位球", copy: "墨西哥高点优势有限。", impact: 2 },
      { icon: "verified", title: "近期状态", copy: "墨西哥连续三场创造高质量机会。", impact: 9 },
      { icon: "cloud", title: "天气场地", copy: "湿度偏高，后程节奏可能下降。", impact: -3 },
      { icon: "shield", title: "防守范围", copy: "墨西哥边路回收更快。", impact: 6 },
    ],
    aiBrief:
      "墨西哥整体结构更成熟，能够通过中场控制逐步压制比赛。南非的机会在于反击第一脚质量，一旦墨西哥率先进球，比赛会明显向 2-0 或 2-1 方向发展。",
    scoreRange: "2-0 / 2-1",
    radar: [
      { label: "进攻火力", value: 74 },
      { label: "防守稳固", value: 69 },
      { label: "状态稳定", value: 72 },
      { label: "伤病影响", value: 44 },
      { label: "战术执行", value: 71 },
      { label: "临场应变", value: 66 },
    ],
    model: "VibeCoding WorldCup v1.0",
    backtest: "近30天准确率 61.2%",
    changes: [
      { time: "今日", copy: "赛程已确认，赛前信息将持续更新", delta: "", direction: "flat" },
      { time: "赛前", copy: "阵容、天气和首发信息会在确认后同步", delta: "", direction: "flat" },
    ],
    script: ["墨西哥赢面更大，但需要尽快取得领先。", "南非会让比赛出现几次高质量反击，风险不低。"],
    compare: [
      { label: "实力评分", home: "1810", away: "1664" },
      { label: "近5场进球", home: "9", away: "6" },
      { label: "近5场失球", home: "3", away: "5" },
      { label: "定位球威胁", home: "中", away: "中" },
      { label: "反击效率", home: "中", away: "高" },
    ],
    models: [
      { name: "赔率参考", signal: "墨西哥胜", metric: "历史表现良好" },
      { name: "统计模型", signal: "墨西哥胜", metric: "已启用" },
      { name: "LLM-only", signal: "主胜", metric: "待回测" },
      { name: "Hybrid", signal: "墨西哥胜", metric: "第二阶段" },
    ],
  },
  {
    id: "canada-bosnia",
    date: "2026-06-12",
    dateLabel: "6月12日",
    kickoffSort: "01:00",
    modelHome: "canada",
    modelAway: "bosnia-and-herzegovina",
    modelVenue: "home",
    time: "6月12日",
    group: "世界杯 小组赛",
    competition: "世界杯",
    status: "未开赛",
    watch: false,
    recommendation: "加拿大方向",
    confidence: "63",
    confidenceScore: 63,
    confidenceCopy: "双方差距有限，加拿大主场因素会抬高模型胜率。",
    home: { name: "加拿大", flag: flag("ca"), form: "近5场 2胜1平2负" },
    away: { name: "波黑", flag: flag("ba"), form: "赛前信息更新中" },
    probabilities: [
      { label: "胜", value: 28, type: "home" },
      { label: "平", value: 30, type: "draw" },
      { label: "胜", value: 42, type: "away" },
    ],
    scores: [
      { line: "1-1", probability: "16%" },
      { line: "1-2", probability: "14%" },
      { line: "0-1", probability: "12%" },
      { line: "2-2", probability: "10%" },
      { line: "2-1", probability: "8%" },
    ],
    variables: [
      { icon: "bolt", title: "边路冲击", copy: "加拿大推进速度很快。", impact: 7 },
      { icon: "workspace_premium", title: "大赛经验", copy: "波黑关键球信息更新中。", impact: -5 },
      { icon: "shield", title: "防线稳定", copy: "加拿大防线回撤间距偏大。", impact: -6 },
      { icon: "verified", title: "近期状态", copy: "近期状态需要接入真实赛前数据。", impact: 0 },
      { icon: "sports_soccer", title: "定位球", copy: "双方定位球质量接近。", impact: 1 },
      { icon: "psychology", title: "心理压力", copy: "加拿大心态更开放。", impact: 3 },
    ],
    aiBrief:
      "加拿大拥有主场因素，整体胜面略高。波黑的阵容和近期状态信息仍在更新中，临近开赛前可能带来判断变化。",
    scoreRange: "1-1 / 1-2",
    radar: [
      { label: "进攻火力", value: 66 },
      { label: "防守稳固", value: 61 },
      { label: "状态稳定", value: 64 },
      { label: "伤病影响", value: 50 },
      { label: "战术执行", value: 62 },
      { label: "临场应变", value: 68 },
    ],
    model: "VibeCoding WorldCup v1.0",
    backtest: "近30天准确率 61.2%",
    changes: [
      { time: "今日", copy: "赛程已确认，赛前信息将持续更新", delta: "", direction: "flat" },
      { time: "赛前", copy: "阵容、天气和首发信息会在确认后同步", delta: "", direction: "flat" },
    ],
    script: ["这场更像高波动比赛。", "阵容和伤停信息确认后，赛前判断可能继续调整。"],
    compare: [
      { label: "实力评分", home: "1698", away: "1832" },
      { label: "近5场进球", home: "7", away: "8" },
      { label: "近5场失球", home: "6", away: "4" },
      { label: "定位球威胁", home: "中", away: "中高" },
      { label: "反击效率", home: "高", away: "中" },
    ],
    models: [
      { name: "赔率参考", signal: "更新中", metric: "更新中" },
      { name: "统计模型", signal: "加拿大方向", metric: "已启用" },
      { name: "LLM-only", signal: "平/客", metric: "待回测" },
      { name: "综合判断", signal: "更新中", metric: "稍后开放" },
    ],
  },
  {
    id: "korea-czechia",
    date: "2026-06-11",
    dateLabel: "6月11日",
    kickoffSort: "04:00",
    modelHome: "south-korea",
    modelAway: "czech-republic",
    modelVenue: "neutral",
    time: "6月11日",
    group: "世界杯 小组赛",
    competition: "世界杯",
    status: "未开赛",
    watch: true,
    recommendation: "小比分",
    confidence: "66",
    confidenceScore: 66,
    confidenceCopy: "双方结构完整，胜负差距不大，小比分倾向更稳定。",
    home: { name: "韩国", flag: flag("kr"), form: "赛前信息更新中" },
    away: { name: "捷克", flag: flag("cz"), form: "赛前信息更新中" },
    probabilities: [
      { label: "胜", value: 38, type: "home" },
      { label: "平", value: 31, type: "draw" },
      { label: "胜", value: 31, type: "away" },
    ],
    scores: [
      { line: "1-1", probability: "17%" },
      { line: "1-0", probability: "13%" },
      { line: "0-1", probability: "12%" },
      { line: "2-1", probability: "10%" },
      { line: "0-0", probability: "9%" },
    ],
    variables: [
      { icon: "sync_alt", title: "攻守转换", copy: "韩国转换速度信息更新中。", impact: 3 },
      { icon: "height", title: "高空球", copy: "捷克高空球信息更新中。", impact: -4 },
      { icon: "shield", title: "防守纪律", copy: "双方防守纪律需接入真实赛前数据。", impact: 0 },
      { icon: "sports_soccer", title: "定位球", copy: "定位球威胁信息更新中。", impact: 0 },
      { icon: "cloud", title: "天气场地", copy: "天气场地信息更新中。", impact: 0 },
      { icon: "verified", title: "近期状态", copy: "双方状态接近。", impact: 1 },
    ],
    aiBrief:
      "这场胜负差距不大。韩国和捷克的阵容、伤停、天气和首发信息仍在更新中，临近开赛前可能带来判断变化。",
    scoreRange: "1-1 / 1-0",
    radar: [
      { label: "进攻火力", value: 64 },
      { label: "防守稳固", value: 70 },
      { label: "状态稳定", value: 67 },
      { label: "伤病影响", value: 42 },
      { label: "战术执行", value: 74 },
      { label: "临场应变", value: 69 },
    ],
    model: "VibeCoding WorldCup v1.0",
    backtest: "近30天准确率 61.2%",
    changes: [
      { time: "今日", copy: "赛程已确认，赛前信息将持续更新", delta: "", direction: "flat" },
      { time: "赛前", copy: "阵容、天气和首发信息会在确认后同步", delta: "", direction: "flat" },
    ],
    script: ["这是典型的小比分模型局。", "韩国和捷克的真实赛前变量还未接入，当前只看基础概率。"],
    compare: [
      { label: "实力评分", home: "1774", away: "1766" },
      { label: "近5场进球", home: "7", away: "7" },
      { label: "近5场失球", home: "4", away: "5" },
      { label: "定位球威胁", home: "中", away: "高" },
      { label: "反击效率", home: "高", away: "中" },
    ],
    models: [
      { name: "赔率参考", signal: "低比分", metric: "历史表现良好" },
      { name: "统计模型", signal: "均势", metric: "已启用" },
      { name: "LLM-only", signal: "平局", metric: "待回测" },
      { name: "Hybrid", signal: "小比分", metric: "第二阶段" },
    ],
  },
];

const fallbackById = new Map(fallbackMatches.map((match) => [match.id, match]));

function toUiMatch(apiMatch) {
  const fallback = fallbackById.get(apiMatch.id) ?? createGenericMatch(apiMatch);
  const homeTeam = apiMatch.homeTeam ?? {};
  const awayTeam = apiMatch.awayTeam ?? {};
  const ui = apiMatch.ui ?? {};
  const recentForm = apiMatch.recentForm ?? {};
  const lineupIntel = normalizeLineupIntel(apiMatch.lineupIntel ?? fallback.lineupIntel);
  const confidence = Number(ui.confidence ?? fallback.confidenceScore ?? fallback.confidence ?? 60);
  const score = normalizeScore(apiMatch.score ?? fallback.score);
  const isCompleted = apiMatch.status === "已完赛" && hasFinalScore(score);

  return {
    ...fallback,
    id: apiMatch.id,
    homeTeamId: apiMatch.homeTeamId ?? fallback.homeTeamId,
    awayTeamId: apiMatch.awayTeamId ?? fallback.awayTeamId,
    date: apiMatch.date ?? fallback.date,
    dateLabel: apiMatch.dateLabel ?? fallback.dateLabel,
    kickoffSort: apiMatch.kickoffSort ?? fallback.kickoffSort,
    time: apiMatch.dateLabel ?? fallback.time,
    group: apiMatch.group ?? fallback.group,
    competition: apiMatch.competition ?? fallback.competition,
    status: apiMatch.status ?? fallback.status,
    watch: Boolean(apiMatch.watch),
    modelHome: apiMatch.modelHome ?? fallback.modelHome,
    modelAway: apiMatch.modelAway ?? fallback.modelAway,
    modelVenue: apiMatch.modelVenue ?? fallback.modelVenue,
    recommendation: ui.recommendation ?? fallback.recommendation,
    confidence: String(confidence),
    confidenceScore: confidence,
    score,
    isCompleted,
    resultScore: hasFinalScore(score) ? `${score.home}-${score.away}` : "待确认",
    resultLabel: buildResultLabel(apiMatch, score),
    home: {
      ...fallback.home,
      id: apiMatch.homeTeamId ?? fallback.home?.id,
      name: homeTeam.name ?? fallback.home.name,
      flag: homeTeam.flagUrl ?? (homeTeam.flagCode ? flag(homeTeam.flagCode) : fallback.home.flag),
      profile: normalizeTeamProfile(homeTeam.profile ?? fallback.home.profile),
      form: formatRecentForm(recentForm.home) ?? ui.homeForm ?? fallback.home.form,
    },
    away: {
      ...fallback.away,
      id: apiMatch.awayTeamId ?? fallback.away?.id,
      name: awayTeam.name ?? fallback.away.name,
      flag: awayTeam.flagUrl ?? (awayTeam.flagCode ? flag(awayTeam.flagCode) : fallback.away.flag),
      profile: normalizeTeamProfile(awayTeam.profile ?? fallback.away.profile),
      form: formatRecentForm(recentForm.away) ?? ui.awayForm ?? fallback.away.form,
    },
    aiBrief: ui.narrative ?? fallback.aiBrief,
    variables: mergeLineupVariable(fallback.variables, lineupIntel),
    compare: mergeRecentFormCompare(fallback.compare, recentForm),
    radar: mergeRecentFormRadar(fallback.radar, recentForm),
    changes: mergeLineupChanges(fallback.changes, lineupIntel),
    models: mergeLineupModels(fallback.models, lineupIntel),
    recentForm,
    lineupIntel,
    matchFacts: apiMatch.matchFacts ?? fallback.matchFacts,
    marketOdds: apiMatch.marketOdds ?? fallback.marketOdds,
    aiAnalysis: apiMatch.aiAnalysis ?? fallback.aiAnalysis,
    predictionStatus: apiMatch.predictionStatus,
    latestPrediction: apiMatch.latestPrediction,
  };
}

function formatRecentForm(form) {
  return form?.matches > 0 ? form.label : null;
}

function normalizeTeamProfile(profile) {
  return {
    ...(profile ?? {}),
    marketValue: profile?.marketValue ?? {
      status: "unavailable",
      reason: "fifa_no_official_market_value",
    },
  };
}

function normalizeScore(score = {}) {
  return {
    home: Number.isFinite(Number(score.home)) ? Number(score.home) : null,
    away: Number.isFinite(Number(score.away)) ? Number(score.away) : null,
  };
}

function hasFinalScore(score) {
  return score.home != null && score.away != null;
}

function buildResultLabel(match, score) {
  if (!hasFinalScore(score)) return "官方比分尚未同步。";
  const homeName = match.homeTeam?.name ?? match.homeTeamId ?? "主队";
  const awayName = match.awayTeam?.name ?? match.awayTeamId ?? "客队";
  if (score.home > score.away) return `${homeName} ${score.home}-${score.away} 战胜 ${awayName}`;
  if (score.home < score.away) return `${awayName} ${score.away}-${score.home} 战胜 ${homeName}`;
  return `${homeName} ${score.home}-${score.away} 战平 ${awayName}`;
}

function normalizeLineupIntel(value = {}) {
  return {
    policy: value.policy ?? "official_and_expected_only",
    appliesToModel: Boolean(value.appliesToModel),
    displayMode: value.displayMode ?? "pending",
    official: normalizeLineupSource(value.official, {
      label: "官方首发",
      sourceType: "official",
      status: "not_released",
      confidence: "pending",
    }),
    expected: normalizeLineupSource(value.expected, {
      label: "预计首发",
      sourceType: "expected",
      status: "not_ready",
      confidence: "pending",
    }),
  };
}

function normalizeLineupSource(value = {}, fallback) {
  return {
    label: value.label ?? fallback.label,
    sourceType: value.sourceType ?? fallback.sourceType,
    status: value.status ?? fallback.status,
    confidence: value.confidence ?? fallback.confidence,
    sourceId: value.sourceId ?? null,
    sourceUrl: value.sourceUrl ?? null,
    retrievedAt: value.retrievedAt ?? null,
    reviewedAt: value.reviewedAt ?? null,
    note: value.note ?? "",
    home: normalizeTeamLineup(value.home),
    away: normalizeTeamLineup(value.away),
  };
}

function ensureArray(value, fallback = []) {
  return Array.isArray(value) ? value : fallback;
}

function normalizeTeamLineup(value = {}) {
  return {
    formation: value.formation ?? null,
    starters: ensureArray(value.starters, []),
    substitutes: ensureArray(value.substitutes, []),
    unavailable: ensureArray(value.unavailable, []),
  };
}

function mergeLineupVariable(variables, lineupIntel) {
  const rows = Array.isArray(variables) ? [...variables] : [];
  const nextRow = {
    icon: "groups",
    title: "首发阵容",
    copy: lineupVariableCopy(lineupIntel),
    impact: 0,
  };
  const index = rows.findIndex((row) => ["伤停观察", "伤停阵容", "首发阵容"].includes(row.title));
  if (index >= 0) {
    rows[index] = nextRow;
    return rows;
  }
  return [...rows, nextRow];
}

function lineupVariableCopy(lineupIntel) {
  if (lineupIntel.displayMode === "official") return "官方首发已确认，预计首发保留为赛前参考。";
  if (lineupIntel.displayMode === "expected") return "官方首发未发布，当前展示预计首发作为赛前参考。";
  return "官方首发未发布，预计首发待来源审核。";
}

function mergeLineupChanges(changes, lineupIntel) {
  const rows = Array.isArray(changes) ? changes.filter((row) => !["首发", "预计"].includes(row.time)) : [];
  return [
    ...rows,
    { time: "首发", copy: lineupStatusCopy(lineupIntel.official), delta: "", direction: "flat" },
    { time: "预计", copy: lineupStatusCopy(lineupIntel.expected), delta: "", direction: "flat" },
  ];
}

function mergeLineupModels(models, lineupIntel) {
  return upsertModelRow(models, {
    name: "阵容情报",
    signal: lineupIntel.displayMode === "official" ? "官方已确认" : lineupIntel.displayMode === "expected" ? "预计可参考" : "等待更新",
    metric: "官方/预计分开展示",
  });
}

function upsertModelRow(models, nextRow) {
  const rows = Array.isArray(models) ? [...models] : [];
  const index = rows.findIndex((row) => row.name === nextRow.name);
  if (index >= 0) {
    rows[index] = { ...rows[index], ...nextRow };
    return rows;
  }
  return [...rows, nextRow];
}

function lineupStatusLabel(source) {
  if (source.sourceType === "official" && source.status === "available") return "官方已确认";
  if (source.sourceType === "official") return "官方未发布";
  if (source.status === "available") return "预计已生成";
  return "预计待审核";
}

function lineupStatusCopy(source) {
  if (source.sourceType === "official" && source.status === "available") return "官方首发已确认";
  if (source.sourceType === "official") return "官方首发未发布";
  if (source.status === "available") return "预计首发已生成";
  return "预计首发待来源审核";
}

function lineupSourceCopy(source) {
  if (source.status === "available") {
    return source.note || (source.sourceType === "official" ? "官方名单已发布。" : "预计名单已通过来源审核。");
  }
  return source.sourceType === "official"
    ? "官方名单发布前不会展示球员姓名。"
    : "预计名单还没有通过来源审核。";
}

function hasLineupSourceData(source) {
  return hasTeamLineupData(source.home) || hasTeamLineupData(source.away);
}

function hasTeamLineupData(lineup) {
  return Boolean(
    lineup?.formation ||
    lineup?.starters?.length ||
    lineup?.substitutes?.length ||
    lineup?.unavailable?.length,
  );
}

function formatPlayer(player) {
  return [
    player.shirtNumber ? `${player.shirtNumber}号` : null,
    player.name,
    player.position,
    player.note,
  ].filter(Boolean).join(" · ");
}

function selectLineupSource(intel) {
  const official = intel?.official;
  const expected = intel?.expected;
  if (official && hasLineupSourceData(official)) return { kind: "official", source: official };
  if (expected && hasLineupSourceData(expected)) return { kind: "expected", source: expected };
  return null;
}

function buildPitchSlots(players = [], side) {
  const starters = Array.isArray(players) ? players.slice(0, 11) : [];
  const rows = groupPlayersByPosition(starters);
  const xMap = side === "home"
    ? { GK: 8, DF: 23, MF: 39, FW: 54 }
    : { GK: 92, DF: 77, MF: 61, FW: 46 };

  return ["GK", "DF", "MF", "FW"].flatMap((line) => {
    const linePlayers = rows[line] ?? [];
    return linePlayers.map((player, index) => ({
      player,
      side,
      index,
      x: xMap[line],
      y: distributeY(index, linePlayers.length),
    }));
  });
}

function groupPlayersByPosition(players) {
  const rows = { GK: [], DF: [], MF: [], FW: [] };
  const unknown = [];

  for (const player of players) {
    const position = String(player.position ?? "").toUpperCase();
    if (position.includes("GK")) rows.GK.push(player);
    else if (position.includes("DF") || position.includes("CB") || position.includes("LB") || position.includes("RB")) rows.DF.push(player);
    else if (position.includes("MF") || position.includes("CM") || position.includes("DM") || position.includes("AM")) rows.MF.push(player);
    else if (position.includes("FW") || position.includes("ST") || position.includes("CF") || position.includes("WG")) rows.FW.push(player);
    else unknown.push(player);
  }

  for (const player of unknown) {
    const target = rows.GK.length === 0 ? "GK" : rows.DF.length <= rows.MF.length ? "DF" : "MF";
    rows[target].push(player);
  }

  return rows;
}

function distributeY(index, total) {
  if (total <= 1) return 50;
  return Math.round(((index + 1) / (total + 1)) * 82 + 9);
}

function shortPlayerName(name = "") {
  const clean = String(name).trim();
  if (!clean) return "待定";
  const parts = clean.split(/\s+/);
  return parts.length > 1 ? parts.at(-1) : clean;
}

function buildOfficialSituationRows(match) {
  const facts = match.matchFacts;
  if (!facts?.statistics) return [];
  return [
    buildSituationMetricRow(facts.statistics.possession, "控球率", { percent: true }),
    buildSituationMetricRow(facts.statistics.totalShots, "射门"),
    buildSituationMetricRow(facts.statistics.shotsOnTarget, "射正"),
    buildSituationMetricRow(facts.statistics.corners, "角球"),
    buildSituationMetricRow(facts.statistics.fouls, "犯规"),
    buildSituationMetricRow(facts.statistics.offsides, "越位"),
    buildSituationMetricRow(facts.statistics.yellowCards, "黄牌"),
    buildSituationMetricRow(facts.statistics.redCards, "红牌"),
    buildSituationMetricRow(facts.statistics.passAccuracy, "传球成功率", { percent: true }),
    buildSituationMetricRow(facts.statistics.passes, "传球"),
    buildSituationMetricRow(facts.statistics.expectedGoals, "预期进球", { decimals: 2 }),
    buildSituationMetricRow(facts.statistics.territorialPossession, "区域控球", { percent: true }),
    buildSituationMetricRow(facts.statistics.territorialThirdPossession, "前场三区", { percent: true }),
  ].filter(Boolean);
}

function buildSituationMetricRow(metric, label, options = {}) {
  if (!metric || metric.home == null || metric.away == null) return null;
  const home = Number(metric.home);
  const away = Number(metric.away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) return null;
  return {
    label,
    homeValue: home,
    awayValue: away,
    homeLabel: formatSituationMetricValue(home, options),
    awayLabel: formatSituationMetricValue(away, options),
  };
}

function formatSituationMetricValue(value, options = {}) {
  const decimals = options.decimals ?? (Number.isInteger(value) ? 0 : 1);
  const rendered = value.toFixed(decimals).replace(/\.0$/, "");
  return options.percent ? `${rendered}%` : rendered;
}

function eventCopy(event) {
  if (event.type === "goal") {
    const assist = event.assistPlayerName ? `助攻 ${event.assistPlayerName}` : "助攻未提供";
    return { title: `进球 · ${event.playerName ?? "未知球员"}`, detail: assist };
  }
  if (event.type === "booking") {
    const cardLabel = event.card === "red" ? "红牌" : event.card === "second_yellow" ? "两黄变红" : "黄牌";
    return { title: `${cardLabel} · ${event.playerName ?? "未知球员"}`, detail: "官方牌事件" };
  }
  if (event.type === "substitution") {
    return {
      title: `换人 · ${event.playerOnName ?? "未知球员"} 上`,
      detail: `${event.playerOffName ?? "未知球员"} 下`,
    };
  }
  return { title: "比赛事件", detail: event.playerName ?? "" };
}

function buildRecentSituationRows(match) {
  const home = match.recentForm?.home;
  const away = match.recentForm?.away;
  if (!home || !away || home.matches === 0 || away.matches === 0) return [];

  const rows = [
    { label: "近况进球", homeValue: home.goalsFor, awayValue: away.goalsFor, homeLabel: home.goalsForLabel, awayLabel: away.goalsForLabel },
    { label: "近况失球", homeValue: home.goalsAgainst, awayValue: away.goalsAgainst, homeLabel: home.goalsAgainstLabel, awayLabel: away.goalsAgainstLabel },
  ];

  if (hasRecentMetrics(home) && hasRecentMetrics(away)) {
    rows.push(
      { label: "进攻火力", homeValue: home.metrics.attack, awayValue: away.metrics.attack, homeLabel: home.metrics.attack, awayLabel: away.metrics.attack },
      { label: "防守稳固", homeValue: home.metrics.defense, awayValue: away.metrics.defense, homeLabel: home.metrics.defense, awayLabel: away.metrics.defense },
      { label: "状态稳定", homeValue: home.metrics.stability, awayValue: away.metrics.stability, homeLabel: home.metrics.stability, awayLabel: away.metrics.stability },
    );
  }

  return rows;
}

function mergeRecentFormCompare(compareRows, recentForm) {
  const rows = Array.isArray(compareRows) ? [...compareRows] : [];
  const home = recentForm?.home;
  const away = recentForm?.away;

  if (!home || !away || home.matches === 0 || away.matches === 0) {
    return rows;
  }

  return upsertCompareRow(
    upsertCompareRow(rows, "近5场进球", home.goalsForLabel, away.goalsForLabel),
    "近5场失球",
    home.goalsAgainstLabel,
    away.goalsAgainstLabel,
  );
}

function mergeRecentFormRadar(radarRows, recentForm) {
  {
    const home = recentForm?.home;
    const away = recentForm?.away;
    if (!hasRecentMetrics(home) || !hasRecentMetrics(away)) return [];
    return [
      { label: "进攻火力", ...buildRadarComparison("attack", home, away) },
      { label: "防守稳固", ...buildRadarComparison("defense", home, away) },
      { label: "状态稳定", ...buildRadarComparison("stability", home, away) },
    ];
  }

  const rows = Array.isArray(radarRows) ? [...radarRows] : [];
  const home = recentForm?.home;
  const away = recentForm?.away;
  if (!hasRecentMetrics(home) || !hasRecentMetrics(away)) return rows;

  return upsertRadarMetric(
    upsertRadarMetric(
      upsertRadarMetric(rows, "进攻火力", buildRadarComparison("attack", home, away)),
      "防守稳固",
      buildRadarComparison("defense", home, away),
    ),
    "状态稳定",
    buildRadarComparison("stability", home, away),
  );
}

function buildRadarComparison(kind, home, away) {
  return {
    value: Math.round((home.metrics[kind] + away.metrics[kind]) / 2),
    source: "recentForm",
    home: {
      value: home.metrics[kind],
      detail: metricDetail(kind, home),
    },
    away: {
      value: away.metrics[kind],
      detail: metricDetail(kind, away),
    },
  };
}

function metricDetail(kind, form) {
  if (kind === "attack") return `近${form.matches}场进${form.goalsFor}球`;
  if (kind === "defense") return `近${form.matches}场失${form.goalsAgainst}球`;
  return `${form.wins}胜${form.draws}平${form.losses}负`;
}

function hasRecentMetrics(form) {
  return form?.matches > 0 &&
    Number.isFinite(form.metrics?.attack) &&
    Number.isFinite(form.metrics?.defense) &&
    Number.isFinite(form.metrics?.stability);
}

function upsertRadarMetric(rows, label, metric) {
  if (!Number.isFinite(metric?.value)) return rows;
  const nextMetric = {
    ...metric,
    value: Math.round(Math.max(0, Math.min(100, metric.value))),
  };
  const index = rows.findIndex((row) => row.label === label);
  if (index >= 0) {
    rows[index] = { ...rows[index], ...nextMetric };
    return rows;
  }
  return [...rows, { label, ...nextMetric }];
}

function upsertCompareRow(rows, label, home, away) {
  const index = rows.findIndex((row) => row.label === label);
  const nextRow = { label, home, away };
  if (index >= 0) {
    rows[index] = { ...rows[index], ...nextRow };
    return rows;
  }
  return [...rows, nextRow];
}

function createGenericMatch(apiMatch) {
  const homeTeam = apiMatch.homeTeam ?? {};
  const awayTeam = apiMatch.awayTeam ?? {};
  const official = apiMatch.official ?? {};
  const venue = [official.stadiumName, official.cityName].filter(Boolean).join(" · ");

  return {
    id: apiMatch.id,
    date: apiMatch.date,
    dateLabel: apiMatch.dateLabel,
    kickoffSort: apiMatch.kickoffSort,
    modelHome: apiMatch.modelHome,
    modelAway: apiMatch.modelAway,
    modelVenue: apiMatch.modelVenue ?? "neutral",
    time: apiMatch.dateLabel,
    group: apiMatch.group ?? "世界杯 小组赛",
    competition: apiMatch.competition ?? "世界杯",
    status: apiMatch.status ?? "未开赛",
    watch: Boolean(apiMatch.watch),
    lineupIntel: normalizeLineupIntel(apiMatch.lineupIntel),
    recommendation: "赛前观察",
    confidence: "60",
    confidenceScore: 60,
    confidenceCopy: "官方赛程已同步，模型会先给出基础概率；阵容、天气、伤停等变量仍需后续接入。",
    home: {
      name: homeTeam.name ?? apiMatch.homeTeamId,
      flag: homeTeam.flagUrl ?? (homeTeam.flagCode ? flag(homeTeam.flagCode) : flag("mx")),
      form: apiMatch.ui?.homeForm ?? "赛前信息更新中",
    },
    away: {
      name: awayTeam.name ?? apiMatch.awayTeamId,
      flag: awayTeam.flagUrl ?? (awayTeam.flagCode ? flag(awayTeam.flagCode) : flag("za")),
      form: apiMatch.ui?.awayForm ?? "赛前信息更新中",
    },
    probabilities: [
      { label: "胜", value: 34, type: "home" },
      { label: "平", value: 32, type: "draw" },
      { label: "胜", value: 34, type: "away" },
    ],
    scores: [
      { line: "1-1", probability: "待模型" },
      { line: "1-0", probability: "待模型" },
      { line: "0-1", probability: "待模型" },
      { line: "2-1", probability: "待模型" },
      { line: "1-2", probability: "待模型" },
    ],
    variables: [
      { icon: "dataset", title: "官方赛程", copy: venue || "赛程来自 FIFA 官方数据源。", impact: 0 },
      { icon: "sports_soccer", title: "基础模型", copy: "当前先使用 Elo + Dixon-Coles 生成赛前概率。", impact: 0 },
      { icon: "cloud", title: "天气场地", copy: "天气与场地变量尚未接入。", impact: 0 },
      { icon: "groups", title: "首发阵容", copy: "官方首发未发布，预计首发待来源审核。", impact: 0 },
      { icon: "verified", title: "近期状态", copy: "近期状态源待补充。", impact: 0 },
      { icon: "psychology", title: "临场信息", copy: "临场变化会在后续版本进入模型输入。", impact: 0 },
    ],
    aiBrief: apiMatch.ui?.narrative ?? "赛程来自 FIFA 官方数据源。当前展示基础模型概率，真实赛前变量会在后续数据源接入后逐步补充。",
    scoreRange: "待模型输出",
    radar: [
      { label: "进攻火力", value: 60 },
      { label: "防守稳固", value: 60 },
      { label: "状态稳定", value: 60 },
      { label: "伤病影响", value: 50 },
      { label: "战术执行", value: 60 },
      { label: "临场应变", value: 60 },
    ],
    model: "Elo + Dixon-Coles",
    backtest: "历史表现待校验",
    changes: [
      { time: "官方", copy: "已接入 FIFA 官方赛程同步", delta: "", direction: "flat" },
      { time: "赛前", copy: "官方首发与预计首发会分开展示", delta: "", direction: "flat" },
    ],
    script: [
      "这场比赛已进入官方赛程同步范围。",
      "当前概率来自基础统计模型，后续会补充官方首发、预计首发、天气和其他赛前变量。",
    ],
    compare: [
      { label: "实力评分", home: "待模型", away: "待模型" },
      { label: "官方比赛编号", home: official.idMatch ?? "-", away: "" },
      { label: "比赛城市", home: official.cityName ?? "-", away: "" },
      { label: "数据源", home: "FIFA", away: "" },
      { label: "首发阵容", home: "官方未发布", away: "预计待审核" },
    ],
    models: [
      { name: "官方赛程", signal: "已同步", metric: official.idMatch ?? "FIFA" },
      { name: "统计模型", signal: "基础概率", metric: "已启用" },
      { name: "阵容情报", signal: "等待更新", metric: "官方/预计分开展示" },
      { name: "综合判断", signal: "待增强", metric: "后续版本" },
    ],
  };
}
