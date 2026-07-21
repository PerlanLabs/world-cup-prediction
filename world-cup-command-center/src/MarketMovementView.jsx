import React from "react";
import {
  ArrowsClockwise,
  ChartLineUp,
  Database,
  MagnifyingGlass,
  ShieldCheck,
  WarningCircle,
} from "@phosphor-icons/react";

import {
  fetchPolymarketMovement,
  fetchPolymarketMovementEvents,
  refreshPolymarketMovement,
} from "./modelClient.js";

export function MarketMovementView() {
  const [events, setEvents] = React.useState([]);
  const [selectedSlug, setSelectedSlug] = React.useState("");
  const [slugInput, setSlugInput] = React.useState("");
  const [snapshot, setSnapshot] = React.useState(null);
  const [selectedToken, setSelectedToken] = React.useState("");
  const [category, setCategory] = React.useState("all");
  const [query, setQuery] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState("");

  const loadSnapshot = React.useCallback(async (eventSlug) => {
    if (!eventSlug) {
      setSnapshot(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const next = await fetchPolymarketMovement(eventSlug);
      setSnapshot(next);
      setSelectedToken(next.rows?.[0]?.tokenId ?? next.assistantView?.movements?.[0]?.tokenId ?? "");
      setCategory("all");
    } catch (loadError) {
      setSnapshot(null);
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadEvents = React.useCallback(async (preferredSlug = "") => {
    const records = await fetchPolymarketMovementEvents();
    setEvents(records);
    const nextSlug = preferredSlug || records[0]?.eventSlug || "";
    if (nextSlug) {
      setSelectedSlug(nextSlug);
      setSlugInput(nextSlug);
    }
    return nextSlug;
  }, []);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const slug = await loadEvents();
        if (active && slug) await loadSnapshot(slug);
        else if (active) setLoading(false);
      } catch (loadError) {
        if (active) {
          setError(loadError.message);
          setLoading(false);
        }
      }
    })();
    return () => { active = false; };
  }, [loadEvents, loadSnapshot]);

  async function handleSelectEvent(eventSlug) {
    setSelectedSlug(eventSlug);
    setSlugInput(eventSlug);
    await loadSnapshot(eventSlug);
  }

  async function handleRefresh() {
    const eventSlug = slugInput.trim();
    if (!eventSlug) {
      setError("请输入准确的 Polymarket event slug。");
      return;
    }
    setRefreshing(true);
    setError("");
    try {
      const next = await refreshPolymarketMovement(eventSlug);
      setSnapshot(next);
      setSelectedSlug(eventSlug);
      setSelectedToken(next.rows?.[0]?.tokenId ?? "");
      await loadEvents(eventSlug);
    } catch (refreshError) {
      setError(refreshError.message);
    } finally {
      setRefreshing(false);
    }
  }

  const quality = snapshot?.dataQuality ?? snapshot?.assistantView ?? null;
  const checks = quality?.checks ?? {};
  const rows = React.useMemo(() => snapshot?.rows ?? snapshot?.assistantView?.movements ?? [], [snapshot]);
  const categories = React.useMemo(
    () => [...new Set(rows.map((row) => row.category).filter(Boolean))].sort(),
    [rows],
  );
  const visibleRows = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows
      .filter((row) => category === "all" || row.category === category)
      .filter((row) => !normalizedQuery || [row.selection, row.question, row.marketSlug]
        .some((value) => String(value ?? "").toLowerCase().includes(normalizedQuery)))
      .sort((a, b) => Math.abs(movementSignal(b).value ?? 0) - Math.abs(movementSignal(a).value ?? 0));
  }, [rows, category, query]);
  const selectedRow = rows.find((row) => String(row.tokenId) === String(selectedToken)) ?? visibleRows[0] ?? null;
  const coverageRows = snapshot?.categoryCoverage ?? snapshot?.assistantView?.categoryCoverage ?? [];
  const marketStructure = snapshot?.marketStructure ?? snapshot?.assistantView?.marketStructure ?? null;

  return (
    <section className="movement-page" aria-label="Polymarket 盘口走势">
      <MovementHeader />
      <MovementControls
        events={events}
        selectedSlug={selectedSlug}
        slugInput={slugInput}
        refreshing={refreshing}
        onSelect={handleSelectEvent}
        onSlugChange={setSlugInput}
        onRefresh={handleRefresh}
      />

      {error ? <div className="movement-error" role="alert"><WarningCircle size={19} />{error}</div> : null}
      {loading ? <MovementLoading /> : null}

      {!loading && snapshot ? (
        <>
          <QualityBanner
            quality={quality}
            generatedAt={snapshot.generatedAt}
            cutoffTime={snapshot.input?.cutoffTime}
            historyMode={snapshot.input?.historyMode}
          />
          <MovementMetrics checks={checks} snapshot={snapshot} rows={rows} coverageRows={coverageRows} />
          <MarketStructureSection structure={marketStructure} />
          <MovementMarketSection
            categories={categories}
            category={category}
            query={query}
            visibleRows={visibleRows}
            selectedRow={selectedRow}
            onCategoryChange={setCategory}
            onQueryChange={setQuery}
            onSelectToken={setSelectedToken}
          />
          <CoverageSection rows={coverageRows} />
          <QualityIssues quality={quality} />
        </>
      ) : null}
    </section>
  );
}

function MovementHeader() {
  return (
    <div className="movement-heading">
      <div>
        <p className="eyebrow">Polymarket Movement</p>
        <h2>盘口走势工作台</h2>
        <p>完整市场目录、固定合约结构与历史价格分层展示；质量未通过时不进入投注判断。</p>
      </div>
      <div className="movement-source-state"><Database size={18} /><span>只读 CLOB 历史</span></div>
    </div>
  );
}

function MovementControls({ events, selectedSlug, slugInput, refreshing, onSelect, onSlugChange, onRefresh }) {
  return (
    <div className="movement-controls">
      <label>
        <span>已保存比赛</span>
        <select value={selectedSlug} onChange={(event) => void onSelect(event.target.value)}>
          {events.length
            ? events.map((event) => <option value={event.eventSlug} key={event.eventSlug}>{event.title}</option>)
            : <option value="">暂无快照</option>}
        </select>
      </label>
      <label className="movement-slug-input">
        <span>Event slug</span>
        <input value={slugInput} onChange={(event) => onSlugChange(event.target.value)} placeholder="fifwc-fra-mar-2026-07-09" />
      </label>
      <button className="movement-refresh-button" type="button" onClick={() => void onRefresh()} disabled={refreshing}>
        <ArrowsClockwise size={18} className={refreshing ? "is-spinning" : ""} />
        {refreshing ? "抓取历史中" : "抓取并刷新"}
      </button>
    </div>
  );
}

function QualityBanner({ quality, generatedAt, cutoffTime, historyMode }) {
  const readiness = quality?.readiness ?? "review";
  const copy = readiness === "ready"
    ? "质量检查通过，可用于赛前盘口变化分析。"
    : readiness === "blocked"
      ? "存在阻断性数据问题，本快照不能直接用于投注判断。"
      : "数据可浏览，但存在需要人工复核的限制。";
  return (
    <div className={`movement-quality-banner is-${readiness}`}>
      {readiness === "ready" ? <ShieldCheck size={22} /> : <WarningCircle size={22} />}
      <div>
        <strong>{copy}</strong>
        <span>{historyMode === "lifecycle" ? "最早可得价至封盘" : "固定回看窗口"} · 生成 {formatDateTime(generatedAt)} · 赛前截止 {formatDateTime(cutoffTime)}</span>
      </div>
      <b>{readinessLabel(readiness)}</b>
    </div>
  );
}

function MovementMetrics({ checks, snapshot, rows, coverageRows }) {
  return (
    <div className="movement-metrics">
      <Metric label="发现市场" value={checks.discoveredMarketCount ?? snapshot.discovery?.marketCount ?? "-"} note="PaperTrader完整目录" />
      <Metric label="市场分类" value={snapshot.discovery?.categoryCount ?? coverageRows.length ?? "-"} note="包含未抓历史分类" />
      <Metric
        label="历史范围"
        value={checks.requestedHistoryMarketCount ?? rows.length}
        note={`${snapshot.input?.historyMode === "lifecycle" ? "完整生命周期" : `${snapshot.input?.lookbackDays ?? 7}天窗口`} · 符合范围 ${checks.eligibleHistoryMarketCount ?? rows.length}`}
      />
      <Metric label="历史可用" value={checks.historyAvailableCount ?? rows.filter((row) => row.status === "available").length} note={formatCoverage(checks.historyCoverageRate)} />
      <Metric label="异常复核" value={checks.anomalyReviewCount ?? 0} note={`陈旧 ${checks.staleHistoryCount ?? 0} · 稀疏 ${checks.sparseHistoryCount ?? 0}`} tone={(checks.anomalyReviewCount ?? 0) > 0 ? "warn" : "good"} />
    </div>
  );
}

function Metric({ label, value, note, tone = "" }) {
  return <div className={`movement-metric ${tone ? `is-${tone}` : ""}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function MovementMarketSection({ categories, category, query, visibleRows, selectedRow, onCategoryChange, onQueryChange, onSelectToken }) {
  return (
    <section className="movement-band">
      <div className="movement-band-heading">
        <div><h3>单个合约走势</h3><span>按24小时、6小时、1小时依次判断；全期变化只作补充。</span></div>
        <div className="movement-filters">
          <label>
            <span>分类</span>
            <select value={category} onChange={(event) => onCategoryChange(event.target.value)}>
              <option value="all">全部直接盘口</option>
              {categories.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="movement-search">
            <MagnifyingGlass size={17} />
            <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索盘口" />
          </label>
        </div>
      </div>
      <div className="movement-split">
        <div className="movement-table-wrap">
          <table className="movement-table">
            <thead><tr><th>盘口</th><th>分类</th><th>临场</th><th>全期</th><th>7d</th><th>72h</th><th>24h</th><th>6h</th><th>1h</th><th>质量</th></tr></thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr
                  className={String(row.tokenId) === String(selectedRow?.tokenId) ? "is-selected" : ""}
                  key={`${row.marketSlug}-${row.tokenId}`}
                  onClick={() => onSelectToken(String(row.tokenId))}
                >
                  <td><strong>{row.selection ?? row.question}</strong><small>{row.outcome}</small></td>
                  <td>{row.category}</td>
                  <td>{formatPrice(row.movement?.preKickoff?.price)}</td>
                  <MovementCell value={row.movement?.change?.percentagePoints} />
                  <MovementCell value={row.movement?.windows?.d7?.percentagePoints} />
                  <MovementCell value={row.movement?.windows?.h72?.percentagePoints} />
                  <MovementCell value={row.movement?.windows?.h24?.percentagePoints} />
                  <MovementCell value={row.movement?.windows?.h6?.percentagePoints} />
                  <MovementCell value={row.movement?.windows?.h1?.percentagePoints} />
                  <td><QualityPill quality={row.movement?.quality} status={row.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <MovementDetail row={selectedRow} />
      </div>
    </section>
  );
}

function MarketStructureSection({ structure }) {
  if (!structure) return null;
  const close = structure.stageStructures?.close ?? {};
  const teams = structure.teams ?? {};
  const favoriteSide = teams.favoriteSide === "away" ? "away" : "home";
  const underdogSide = favoriteSide === "home" ? "away" : "home";
  const favoriteWin = close.moneyline?.normalized?.[favoriteSide];
  const favoriteBy2 = close.margin?.[`${favoriteSide}WinBy2Plus`];
  const favoriteBy3 = close.margin?.[`${favoriteSide}WinBy3Plus`];
  const favoriteGoals = close.teamGoals?.[favoriteSide] ?? {};
  const underdogGoals = close.teamGoals?.[underdogSide] ?? {};
  const stages = structure.stages ?? [];
  const keyMarkets = structure.keyMarkets ?? [];
  const signals = structure.signals ?? [];
  const quality = structure.quality ?? {};

  return (
    <section className="movement-band market-structure" aria-label="Polymarket 固定合约市场结构">
      <div className="movement-band-heading structure-heading">
        <div>
          <h3>固定合约市场结构</h3>
          <span>各档位固定不变，只比较价格；下方中心与分布均由相关合约推导，不是实际存在的“主盘”。</span>
        </div>
        <span className={`structure-readiness is-${quality.readiness ?? "review"}`}>
          {structureReadinessLabel(quality.readiness)} · 关键合约 {quality.availableKeyMarketCount ?? 0}/{quality.expectedKeyMarketCount ?? keyMarkets.length}
        </span>
      </div>

      <div className="structure-summary-grid">
        <StructureMetric label={`${teams.favorite ?? "热门方"} 90分钟胜`} value={formatProbability(favoriteWin)} note="三项归一化封盘概率" />
        <StructureMetric label={`${teams.favorite ?? "热门方"} 净胜2+`} value={formatProbability(favoriteBy2)} note={`净胜3+ ${formatProbability(favoriteBy3)}`} />
        <StructureMetric label="全场进球中位数" value={formatNumber(close.totalGoals?.medianGoals)} note={`截尾均值 ${formatNumber(close.totalGoals?.truncatedExpectedGoals, 2)}`} />
        <StructureMetric label="全场 O2.5" value={formatProbability(close.totalGoals?.over2_5)} note={`O3.5 ${formatProbability(close.totalGoals?.over3_5)}`} />
        <StructureMetric
          label={`${teams.favorite ?? "热门方"} O1.5`}
          value={formatProbability(favoriteGoals.over1_5)}
          note={`${teams.underdog ?? "弱势方"} O0.5 ${formatProbability(underdogGoals.points?.find((point) => point.threshold === 1)?.probability)}`}
        />
        <StructureMetric label="BTTS Yes" value={formatProbability(close.bttsYes)} note="封盘固定合约价格" />
      </div>

      <div className="structure-analysis-grid">
        <div className="structure-signal-list">
          <div className="structure-subheading"><strong>联动信号</strong><span>跨市场只使用可共同覆盖的最长窗口</span></div>
          {signals.map((signal) => (
            <article className="structure-signal" key={signal.code}>
              <div className="structure-signal-label"><span>{signal.label}</span><b>{stageWindowLabel(signal.basis)}</b></div>
              <div>
                <strong>{signal.fact}</strong>
                {signal.evidence?.length ? <p>{signal.evidence.join(" · ")}</p> : null}
                <small>{signal.interpretation}</small>
              </div>
            </article>
          ))}
        </div>

        <div className="structure-distributions">
          <div className="structure-subheading"><strong>封盘推导分布</strong><span>固定合约价格经单调一致性校正</span></div>
          <DistributionBars
            title="总进球"
            items={(close.totalGoals?.masses ?? []).slice(0, 7).map((item) => ({ label: `${item.goals}球`, value: item.probability }))}
          />
          <DistributionBars
            title={`${teams.home ?? "主队"} 净胜球`}
            items={(close.margin?.masses ?? []).filter((item) => item.margin >= -2 && item.margin <= 4).map((item) => ({
              label: item.margin > 0 ? `+${item.margin}` : String(item.margin),
              value: item.probability,
            }))}
          />
        </div>
      </div>

      <div className="structure-contract-table-wrap">
        <table className="structure-contract-table">
          <thead>
            <tr><th>固定合约</th>{stages.map((stage) => <th key={stage.key}>{stage.label}</th>)}<th>共同窗口变化</th></tr>
          </thead>
          <tbody>
            {keyMarkets.map((market) => {
              const shared = preferredSharedChange(market.changes);
              return (
                <tr key={market.key}>
                  <td><strong>{market.label}</strong><small>{market.category}</small></td>
                  {stages.map((stage) => <td key={stage.key}>{formatProbability(market.prices?.[stage.key]?.price)}</td>)}
                  <td className={(shared?.percentagePoints ?? 0) > 0 ? "is-up" : (shared?.percentagePoints ?? 0) < 0 ? "is-down" : "is-flat"}>
                    {shared ? `${stageWindowLabel(shared.key)} ${formatMovement(shared.percentagePoints)}` : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <StructureQualityNote quality={quality} />
    </section>
  );
}

function StructureMetric({ label, value, note }) {
  return <div className="structure-metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function DistributionBars({ title, items }) {
  const max = Math.max(0.01, ...items.map((item) => Number(item.value) || 0));
  return (
    <div className="structure-distribution">
      <strong>{title}</strong>
      <div className="structure-bars">
        {items.map((item) => (
          <div className="structure-bar-item" key={item.label}>
            <span>{item.label}</span>
            <i><b style={{ width: `${Math.max(2, ((Number(item.value) || 0) / max) * 100)}%` }} /></i>
            <em>{formatProbability(item.value)}</em>
          </div>
        ))}
      </div>
    </div>
  );
}

function StructureQualityNote({ quality }) {
  const issues = quality.issues ?? [];
  return (
    <div className={`structure-quality-note is-${quality.readiness ?? "review"}`}>
      {quality.readiness === "ready" ? <ShieldCheck size={18} /> : <WarningCircle size={18} />}
      <div>
        <strong>{quality.readiness === "ready" ? "结构数据通过自动检查" : "结构结论需要结合质量提示复核"}</strong>
        <span>
          {issues.length
            ? issues.map((issue) => structureIssueLabel(issue)).join(" · ")
            : "关键合约完整，累计概率曲线未发现显著冲突。"}
        </span>
      </div>
    </div>
  );
}

function CoverageSection({ rows }) {
  return (
    <section className="movement-band">
      <div className="movement-band-heading"><div><h3>分类覆盖审计</h3><span>未抓历史不等于漏盘；每个分类必须说明处理状态。</span></div></div>
      <div className="movement-coverage-grid">
        {rows.map((row) => (
          <div className="movement-coverage-row" key={row.category}>
            <div><strong>{row.category}</strong><span>{row.family ?? "未归组"}</span></div>
            <span>发现 {row.discoveredCount}</span>
            <span>跟踪 {row.trackedCount}</span>
            <span>可用 {row.historyAvailableCount}</span>
            <b className={row.decision === "tracked" ? "is-good" : "is-muted"}>{row.decision === "tracked" ? "已跟踪" : "仅目录"}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

function MovementCell({ value }) {
  const className = Number(value) > 0 ? "is-up" : Number(value) < 0 ? "is-down" : "is-flat";
  return <td className={className}>{formatMovement(value)}</td>;
}

function QualityPill({ quality, status }) {
  const state = quality?.analysisStatus ?? quality?.status ?? status ?? "unknown";
  const label = state === "usable" ? "可用" : state === "review" ? "复核" : state === "stale" ? "陈旧" : state === "sparse" ? "稀疏" : "缺失";
  return <span className={`movement-quality-pill is-${state}`}>{label}</span>;
}

function MovementDetail({ row }) {
  if (!row) return <aside className="movement-detail"><p>选择一个盘口查看详情。</p></aside>;
  const points = Array.isArray(row.history) ? row.history : [];
  const signal = movementSignal(row);
  const opening = row.openingCoverage ?? {};
  return (
    <aside className="movement-detail">
      <div className="movement-detail-title">
        <ChartLineUp size={20} />
        <div><strong>{row.selection ?? row.question}</strong><span>{row.category} · {row.outcome}</span></div>
      </div>
      <PriceChart points={points} />
      <div className="movement-detail-stats">
        <span>首次<strong>{formatPrice(row.movement?.firstObserved?.price)}</strong></span>
        <span>临场<strong>{formatPrice(row.movement?.preKickoff?.price)}</strong></span>
        <span>全生命周期<strong className={(row.movement?.change?.percentagePoints ?? 0) >= 0 ? "is-up" : "is-down"}>{formatMovement(row.movement?.change?.percentagePoints)}</strong></span>
        <span>{signal.label}<strong className={(signal.value ?? 0) >= 0 ? "is-up" : "is-down"}>{formatMovement(signal.value)}</strong></span>
        <span>价格区间<strong>{formatMovement(row.movement?.rangePercentagePoints, false)}</strong></span>
        <span>初盘覆盖<strong>{openingStatusLabel(opening.status)}</strong></span>
      </div>
      <div className="movement-detail-meta">
        <span>历史点 {row.movement?.pointCount ?? points.length}</span>
        <span>最早记录 {formatDateTime(opening.firstObservedTime)}</span>
        <span>流动性 {formatCompact(row.liquidity)}</span>
        <span>成交量 {formatCompact(row.volume)}</span>
      </div>
      <p className="movement-token">Token {shortToken(row.tokenId)}</p>
      <p className="movement-interpretation">价格上涨只表示该结果的市场支持增强，不单独证明诱盘、内幕或最终赛果。</p>
    </aside>
  );
}

function PriceChart({ points }) {
  if (points.length < 2) return <div className="movement-chart-empty">当前快照未保存原始历史点，刷新后可查看曲线。</div>;
  const width = 700;
  const height = 220;
  const padding = 20;
  const minTime = points[0].timestamp;
  const maxTime = points.at(-1).timestamp;
  const prices = points.map((point) => point.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const timeRange = Math.max(1, maxTime - minTime);
  const priceRange = Math.max(0.01, maxPrice - minPrice);
  const polyline = points.map((point) => {
    const x = padding + ((point.timestamp - minTime) / timeRange) * (width - padding * 2);
    const y = height - padding - ((point.price - minPrice) / priceRange) * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <div className="movement-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="盘口价格历史走势">
        {[0.25, 0.5, 0.75].map((ratio) => <line key={ratio} x1={padding} x2={width - padding} y1={height * ratio} y2={height * ratio} />)}
        <polyline points={polyline} />
      </svg>
      <span className="chart-high">{formatPrice(maxPrice)}</span>
      <span className="chart-low">{formatPrice(minPrice)}</span>
    </div>
  );
}

function QualityIssues({ quality }) {
  const issues = quality?.issues ?? [];
  const limitations = quality?.limitations ?? [];
  return (
    <section className="movement-band movement-quality-notes">
      <div>
        <h3>质量问题</h3>
        {issues.length ? issues.map((item) => (
          <p key={item.code}><b className={`severity-${item.severity}`}>{item.severity}</b><strong>{item.code}</strong><span>{item.message} ({item.count})</span></p>
        )) : <p><ShieldCheck size={17} /><span>当前自动检查没有发现阻断问题。</span></p>}
      </div>
      <div><h3>使用限制</h3>{limitations.map((item) => <p key={item}><span>{item}</span></p>)}</div>
    </section>
  );
}

function MovementLoading() {
  return <div className="movement-loading"><ArrowsClockwise size={22} className="is-spinning" /><span>正在读取盘口目录和历史快照</span></div>;
}

function movementSignal(row) {
  for (const [label, value] of [
    ["24小时", row.movement?.windows?.h24?.percentagePoints],
    ["6小时", row.movement?.windows?.h6?.percentagePoints],
    ["全期", row.movement?.change?.percentagePoints],
  ]) {
    if (Number.isFinite(value)) return { label, value };
  }
  return { label: "无变化", value: null };
}

function preferredSharedChange(changes = {}) {
  for (const key of ["d7", "h72", "h24", "h6", "h1", "full"]) {
    if (Number.isFinite(changes[key]?.percentagePoints)) return { key, ...changes[key] };
  }
  return null;
}

function stageWindowLabel(value) {
  return ({ d7: "7天", h72: "72小时", h24: "24小时", h6: "6小时", h1: "1小时", full: "全期" })[value] ?? "窗口不足";
}

function readinessLabel(value) {
  return value === "ready" ? "可分析" : value === "blocked" ? "已阻断" : "需复核";
}

function structureReadinessLabel(value) {
  return value === "ready" ? "结构可用" : value === "blocked" ? "结构阻断" : "结构需复核";
}

function structureIssueLabel(issue) {
  if (issue.code === "asynchronous_opening_snapshot") {
    return `合约异步上线，最早记录相差 ${formatNumber(Number(issue.count) / 86400, 1)} 天`;
  }
  if (issue.code === "large_curve_consistency_adjustment") return `累计概率曲线存在 ${issue.count ?? 0} 处冲突`;
  if (issue.code === "insufficient_key_markets") return `缺少 ${issue.count ?? 0} 个关键合约`;
  return issue.code ?? "未分类质量问题";
}

function openingStatusLabel(value) {
  if (value === "near_market_creation") return "接近市场创建";
  if (value === "late_first_observation") return "仅最早可得价";
  if (value === "unknown_market_origin") return "创建时间未知";
  return "待检查";
}

function formatPrice(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}c` : "-";
}

function formatProbability(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "-";
}

function formatNumber(value, digits = 0) {
  return Number.isFinite(value) ? Number(value).toFixed(digits) : "-";
}

function formatMovement(value, sign = true) {
  if (!Number.isFinite(value)) return "-";
  return `${sign && value > 0 ? "+" : ""}${value.toFixed(2)}pp`;
}

function formatCoverage(value) {
  return Number.isFinite(value) ? `覆盖 ${(value * 100).toFixed(1)}%` : "覆盖待检查";
}

function formatCompact(value) {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatDateTime(value) {
  const date = new Date(value ?? "");
  if (Number.isNaN(date.getTime())) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}

function shortToken(value) {
  const token = String(value ?? "");
  return token.length > 18 ? `${token.slice(0, 9)}…${token.slice(-7)}` : token || "-";
}
