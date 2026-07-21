import React from "react";
import {
  ArrowClockwise,
  ChartBar,
  CheckCircle,
  Database,
  ShieldWarning,
  WarningCircle,
} from "@phosphor-icons/react";
import { fetchPolymarketBacktest } from "./modelClient.js";

const STATUS_LABELS = {
  provisional_keep: "留出集待验证",
  market_model_conflict: "市场与模型冲突",
  clv_only_review: "仅CLV支持",
  outcome_only_review: "仅赛果支持",
  result_only_review: "仅赛果复核",
  mixed_review: "证据混合",
  downgrade: "降级",
  insufficient_sample: "样本不足",
  insufficient_trade_sample: "交易样本不足",
};

const SIGNAL_LABELS = {
  favorite_tail_strengthening: "热门方两球胜尾部增强",
  broad_favorite_strengthening: "热门方整体增强",
  two_goal_concentration: "热门方净胜两球集中",
  broad_blowout_tail_expansion: "热门方大胜尾部扩张",
  home_scoring_drives_over: "热门方进球驱动大球",
  away_scoring_supports_over: "弱势方进球支撑大球",
  moderate_total_concentration: "总进球集中在三球",
  broad_total_tail_expansion: "总进球高位尾部扩张",
};

export function MarketBacktestView() {
  const [report, setReport] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setReport(await fetchPolymarketBacktest());
    } catch (loadError) {
      setReport(null);
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const signalRows = React.useMemo(() => {
    const rows = report?.bySignal ?? [];
    return rows.filter((row) => statusFilter === "all" || row.status === statusFilter);
  }, [report, statusFilter]);

  if (loading) {
    return <section className="movement-page"><div className="movement-loading"><ArrowClockwise className="is-spinning" size={22} />读取冻结回测报告</div></section>;
  }

  if (error || !report) {
    return (
      <section className="movement-page">
        <div className="movement-error"><WarningCircle size={20} />{error || "回测报告不存在"}</div>
        <button className="movement-refresh-button" type="button" onClick={() => void load()}><ArrowClockwise size={18} />重新读取</button>
      </section>
    );
  }

  const overall = report.overall ?? {};
  const sample = report.sample ?? {};
  const status = overall.status ?? "mixed_review";

  return (
    <section className="movement-page backtest-page" aria-label="Polymarket 走势信号回测">
      <header className="movement-heading">
        <div>
          <p className="eyebrow">Polymarket Signal Review</p>
          <h2>走势信号回测</h2>
          <p>赛前固定合约价格、官方90分钟赛果与冻结基础模型的逐场复核。</p>
        </div>
        <div className="movement-source-state"><Database size={18} /><span>冻结报告 {formatDateTime(report.generatedAt)}</span></div>
      </header>

      <section className={`backtest-verdict is-${statusTone(status)}`}>
        <ShieldWarning size={24} />
        <div>
          <strong>{STATUS_LABELS[status] ?? status}</strong>
          <span>{verdictCopy(status)}</span>
        </div>
        <b>{sample.qualityEligibleMatchCount ?? 0}场可用</b>
      </section>

      <div className="movement-metrics backtest-metrics">
        <BacktestMetric label="完整生命周期" value={`${sample.matchCount ?? 0}场`} note={`可用 ${sample.qualityEligibleMatchCount ?? 0} · 阻断 ${sample.blockedMatchCount ?? 0}`} />
        <BacktestMetric label="去重首次头寸" value={overall.uniquePositionCount ?? 0} note={`原始触发 ${sample.primarySignalCount ?? 0}`} />
        <BacktestMetric label="平均CLV" value={formatPp(overall.uniquePositionAverageClvPp)} note={formatRate(overall.uniquePositionPositiveClvRate, "正CLV")} tone={toneForNumber(overall.uniquePositionAverageClvPp)} />
        <BacktestMetric label="固定成本后ROI" value={formatPercent(overall.uniquePositionSimulatedRoi)} note={`净收益 ${formatUnits(overall.uniquePositionRealizedPnl)}`} tone={toneForNumber(overall.uniquePositionSimulatedRoi)} />
        <BacktestMetric label="模型平均EV" value={formatPercent(overall.uniquePositionAverageModelEvPerUnit)} note="冻结基础模型" tone={toneForNumber(overall.uniquePositionAverageModelEvPerUnit)} />
        <BacktestMetric label="最大回撤" value={formatDrawdown(overall.uniquePositionMaxDrawdown)} note="每头寸1u" tone="warn" />
      </div>

      <section className="backtest-methodology">
        <CheckCircle size={19} />
        <span>每场每个直接盘口只取首次触发；固定手续费假设3%；合成区间只统计命中与模型差，不计算可执行ROI；未使用赛中价格。</span>
      </section>

      <ResearchPolicy policy={report.researchPolicy} />

      <section className="movement-band">
        <div className="movement-band-heading">
          <div><h3>信号表现</h3><span>判定依据为独立比赛数、去重CLV、成本后ROI、模型EV与回撤。</span></div>
          <label className="backtest-filter">
            <span>结论</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">全部</option>
              {[...new Set((report.bySignal ?? []).map((row) => row.status))].map((value) => (
                <option value={value} key={value}>{STATUS_LABELS[value] ?? value}</option>
              ))}
            </select>
          </label>
        </div>
        <BacktestTable rows={signalRows} />
      </section>

      <div className="backtest-two-column">
        <section className="movement-band">
          <div className="movement-band-heading"><div><h3>形成窗口</h3><span>同一规则在不同决策时间的表现。</span></div></div>
          <WindowTable rows={report.byWindow ?? []} />
        </section>
        <section className="movement-band">
          <div className="movement-band-heading"><div><h3>阈值敏感性</h3><span>宽松、基准、严格三档仅作稳定性检查。</span></div></div>
          <SensitivityTable rows={report.thresholdSensitivity ?? []} />
        </section>
      </div>

      <section className="movement-band">
        <div className="movement-band-heading"><div><h3>逐场审计</h3><span>事件身份、赛果、质量状态与信号数量。</span></div></div>
        <MatchAuditTable rows={report.matches ?? []} />
      </section>
    </section>
  );
}

function BacktestMetric({ label, value, note, tone = "" }) {
  return <div className={`movement-metric ${tone ? `is-${tone}` : ""}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function ResearchPolicy({ policy = {} }) {
  const candidates = policy.candidateForHoldout ?? [];
  const downgraded = policy.downgradedSignals ?? [];
  return (
    <section className="backtest-policy">
      <div><CheckCircle size={18} /><span>获准进入投注权重</span><strong>{policy.approvedForRecommendationWeight?.length ?? 0}</strong></div>
      <div><ChartBar size={18} /><span>下一批留出候选</span><strong>{candidates.length ? candidates.map(signalLabel).join("、") : "暂无"}</strong></div>
      <div><WarningCircle size={18} /><span>当前降级</span><strong>{downgraded.length ? downgraded.map(signalLabel).join("、") : "暂无"}</strong></div>
    </section>
  );
}

function BacktestTable({ rows }) {
  return (
    <div className="backtest-table-wrap">
      <table className="backtest-table">
        <thead><tr><th>信号</th><th>比赛</th><th>首次头寸</th><th>命中</th><th>CLV</th><th>ROI</th><th>模型EV</th><th>回撤</th><th>判定</th></tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.key}>
            <td><strong>{signalLabel(row.key)}</strong><small>{row.key}</small></td>
            <td>{row.matchCount}</td>
            <td>{row.uniquePositionCount}</td>
            <td>{formatPercent(row.hitRate)}</td>
            <MetricCell value={row.uniquePositionAverageClvPp} formatter={formatPp} />
            <MetricCell value={row.uniquePositionSimulatedRoi} formatter={formatPercent} />
            <MetricCell value={row.uniquePositionAverageModelEvPerUnit} formatter={formatPercent} />
            <td>{formatDrawdown(row.uniquePositionMaxDrawdown)}</td>
            <td><StatusPill status={row.status} /></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function WindowTable({ rows }) {
  return (
    <div className="backtest-table-wrap">
      <table className="backtest-table is-compact">
        <thead><tr><th>窗口</th><th>比赛</th><th>CLV</th><th>ROI</th><th>判定</th></tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.key}>
            <td><strong>{windowLabel(row.key)}</strong></td><td>{row.matchCount}</td>
            <MetricCell value={row.uniquePositionAverageClvPp} formatter={formatPp} />
            <MetricCell value={row.uniquePositionSimulatedRoi} formatter={formatPercent} />
            <td><StatusPill status={row.status} /></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function SensitivityTable({ rows }) {
  return (
    <div className="backtest-table-wrap">
      <table className="backtest-table is-compact">
        <thead><tr><th>档位</th><th>信号</th><th>CLV</th><th>ROI</th><th>回撤</th></tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.key}>
            <td><strong>{profileLabel(row.key)}</strong><small>{row.thresholdScale}x</small></td>
            <td>{row.signalCount}</td>
            <MetricCell value={row.averageClvPp} formatter={formatPp} />
            <MetricCell value={row.simulatedRoi} formatter={formatPercent} />
            <td>{formatDrawdown(row.maxDrawdown)}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function MatchAuditTable({ rows }) {
  return (
    <div className="backtest-table-wrap">
      <table className="backtest-table match-audit-table">
        <thead><tr><th>比赛</th><th>Event slug</th><th>90分钟比分</th><th>质量</th><th>信号</th><th>模型快照</th></tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.matchId}>
            <td><strong>{row.home} vs {row.away}</strong><small>{formatDateTime(row.kickoffTime)}</small></td>
            <td className="backtest-slug">{row.eventSlug}</td>
            <td>{row.score.home}-{row.score.away}</td>
            <td><QualityPill readiness={row.quality?.readiness} /></td>
            <td>{row.signalCount}</td>
            <td><small>{row.prediction?.freezeType ?? "未冻结"}</small></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function MetricCell({ value, formatter }) {
  return <td className={Number(value) > 0 ? "is-positive" : Number(value) < 0 ? "is-negative" : ""}>{formatter(value)}</td>;
}

function StatusPill({ status }) {
  return <span className={`backtest-status is-${statusTone(status)}`}>{STATUS_LABELS[status] ?? status}</span>;
}

function QualityPill({ readiness }) {
  const label = readiness === "ready" ? "通过" : readiness === "blocked" ? "阻断" : "逐窗复核";
  return <span className={`backtest-status is-${readiness === "blocked" ? "bad" : readiness === "ready" ? "good" : "review"}`}>{label}</span>;
}

function signalLabel(code) {
  if (SIGNAL_LABELS[code]) return SIGNAL_LABELS[code];
  return code.startsWith("late_acceleration_") ? `临场加速 · ${code.replace("late_acceleration_", "").replaceAll("_", " ")}` : code;
}

function verdictCopy(status) {
  if (status === "market_model_conflict") return "价格延续与赛果收益暂时为正，但基础模型认为入场价格偏贵；不可直接升级为投注规则。";
  if (status === "provisional_keep") return "探索样本同时支持CLV、ROI与模型EV，仍需独立留出样本确认。";
  if (status === "downgrade") return "当前样本未提供可持续支持，暂不进入投注建议权重。";
  return "证据尚未形成一致方向，继续保留为观察信号。";
}

function statusTone(status) {
  if (status === "provisional_keep") return "good";
  if (["downgrade"].includes(status)) return "bad";
  if (["market_model_conflict", "clv_only_review", "outcome_only_review"].includes(status)) return "conflict";
  return "review";
}

function windowLabel(value) {
  return ({ h72: "开盘至72h", h24: "72h至24h", h6: "24h至6h", h1: "6h至1h", close: "最后1h" })[value] ?? value;
}

function profileLabel(value) {
  return ({ lenient: "宽松", baseline: "基准", strict: "严格" })[value] ?? value;
}

function toneForNumber(value) {
  return Number(value) > 0 ? "good" : Number(value) < 0 ? "warn" : "";
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%` : "-";
}

function formatPp(value) {
  return Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}pp` : "-";
}

function formatUnits(value) {
  return Number.isFinite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}u` : "-";
}

function formatDrawdown(value) {
  return Number.isFinite(value) ? `-${Math.abs(value).toFixed(2)}u` : "-";
}

function formatRate(value, label) {
  return Number.isFinite(value) ? `${label} ${(value * 100).toFixed(1)}%` : `${label} -`;
}

function formatDateTime(value) {
  const date = new Date(value ?? "");
  if (Number.isNaN(date.getTime())) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date);
}
