import { useEffect, useState, ReactNode } from 'react';
import { Offcanvas, Button, Badge, Alert, Form } from 'react-bootstrap';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell,
} from 'recharts';
import {
  WeeklyReportContentV3, WEEKLY_SECTIONS_V3, SECTION_BY_ID_V3, SectionDefV3, SectionField,
  ScalarData, RowData, fieldValue, formatValue,
} from '../lib/reportSchemaV3';
import { sanitizeRich } from '../lib/sanitize';
import DashSidebar, { DashNavItem } from './report/DashSidebar';
import SectionComments, { Comment, CommentSection } from './SectionComments';
import { CustomSectionView } from './ReportDashboardV2';
import type { TrendPoint, CommentsConfig, ApprovalDecisionView, ApprovalActionConfig } from './ReportDashboardV2';

/** One point of the week-over-week combo chart (bars = orders, line = GMV). */
export interface WowPoint { label: string; gmv: number; orders: number }

// Sections the internal team sees but the client does not (ad-spend cost).
const CLIENT_HIDE = new Set<string>(['gmv_max']);

// num() preserves "never entered" as null (blank -> "—", no fabricated 0);
// numv() coerces to 0 for sums / chart values where a real number is required.
const num = (v: any): number | null => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const numv = (v: any): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const PIE = ['#e8862e', '#0d6efd', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444'];

function fmtPct(p: number): string {
  const a = Math.abs(p);
  const body = a >= 1000 ? `${(a / 1000).toFixed(1).replace(/\.0$/, '')}k` : a.toFixed(a < 10 ? 1 : 0);
  return p < 0 ? `-${body}` : body;
}

function DeltaPill({ f, cur, prev }: { f: SectionField; cur: number | null; prev: number | null }) {
  if (cur == null || prev == null) return null;
  const diff = cur - prev;
  if (diff === 0) return <span className="ac-pill ac-pill-flat">±0%</span>;
  const p = prev === 0 ? 100 : (diff / Math.abs(prev)) * 100;
  const good = f.lowerIsBetter ? diff < 0 : diff > 0;
  return (
    <span className={`ac-pill ${good ? 'ac-pill-up' : 'ac-pill-down'}`} title={`${p >= 0 ? '+' : ''}${p.toFixed(1)}%`}>
      <i className={`bi ${diff >= 0 ? 'bi-arrow-up-short' : 'bi-arrow-down-short'}`} />
      {prev === 0 ? 'new' : `${p >= 0 ? '+' : ''}${fmtPct(p)}%`}
    </span>
  );
}

function KpiTile({ f, data, prev }: { f: SectionField; data: ScalarData; prev: ScalarData | null }) {
  const cur = fieldValue(f, data);
  const pv = prev ? fieldValue(f, prev) : null;
  return (
    <div className="ac-kpi h-100">
      <div className="ac-kpi-label">{f.label}</div>
      <div className="ac-kpi-value">{formatValue(f.format, cur)}</div>
      <div className="ac-kpi-foot">{f.comparable && <DeltaPill f={f} cur={cur} prev={pv} />}</div>
    </div>
  );
}

function SectionTitle({ title, sub, color = '#e8862e', fb }: { title: string; sub?: string; color?: string; fb?: ReactNode }) {
  return (
    <div className="s14-title">
      <span className="s14-title-accent" style={{ background: color }} />
      <div className="flex-grow-1">
        <div className="s14-title-text">{title}</div>
        {sub && <div className="s14-title-sub">{sub}</div>}
      </div>
      {fb}
    </div>
  );
}

/** Grid of KPI tiles for a scalar section (skips the fields handled elsewhere). */
function TileGrid({ def, data, prev, skip, col }: {
  def: SectionDefV3; data: ScalarData; prev: ScalarData | null; skip?: Set<string>; col?: string;
}) {
  const fields = def.fields.filter(f => f.format !== 'bool' && !(skip?.has(f.key)));
  return (
    <div className="row g-3">
      {fields.map(f => (
        <div className={col ?? 'col-6 col-lg-3'} key={f.key}><KpiTile f={f} data={data} prev={prev} /></div>
      ))}
    </div>
  );
}

// ---- ss2 · Shop Health semicircle gauge ------------------------------------
function spsColor(v: number) { return v >= 4.5 ? '#10b981' : v >= 3.5 ? '#e8862e' : '#ef4444'; }
function spsLabel(v: number) { return v >= 4.5 ? 'Excellent' : v >= 3.5 ? 'Healthy' : 'Needs attention'; }

function ShopHealthGauge({ score, ranking, prevRanking }: {
  score: number | null; ranking: number | null; prevRanking: number | null;
}) {
  const s = score;
  const arc = s == null ? [{ v: 0 }, { v: 5 }] : [{ v: s }, { v: Math.max(0, 5 - s) }];
  const color = s == null ? '#cbd5e1' : spsColor(s);
  const rankDelta = (ranking != null && prevRanking != null) ? prevRanking - ranking : null; // rank up = improvement
  return (
    <div className="s14-card h-100 v3-gauge-card">
      <div className="s14-kpi-label mb-1">Shop Health</div>
      <div className="v3-gauge">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={arc} dataKey="v" startAngle={180} endAngle={0} innerRadius="66%" outerRadius="100%"
              cornerRadius={8} stroke="none" isAnimationActive={false}>
              <Cell fill={color} /><Cell fill="#eceff4" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="v3-gauge-center">
          <div className="v3-gauge-val">{s == null ? '—' : s.toFixed(1)}</div>
          <div className="v3-gauge-cap">{s == null ? 'no score' : `of 5.0 · ${spsLabel(s)}`}</div>
        </div>
        <span className="v3-gauge-end v3-gauge-end-l">0</span>
        <span className="v3-gauge-end v3-gauge-end-r">5</span>
      </div>
      <div className="v3-gauge-pills">
        <span className="v3-pill"><span className="text-muted">Shop rank</span> {ranking == null ? '—' : `#${formatValue('number', ranking)}`}</span>
        {rankDelta != null && rankDelta !== 0 && (
          <span className={`v3-pill ${rankDelta > 0 ? 'v3-pill-up' : 'v3-pill-down'}`}>
            <span className="text-muted">Rank Δ</span> {rankDelta > 0 ? '+' : ''}{rankDelta}
          </span>
        )}
      </div>
    </div>
  );
}

// ---- ss3 · GMV (line) + Orders (bars) combo, up to 8 weeks ------------------
function WowCombo({ data }: { data: WowPoint[] }) {
  if (data.length < 2) return null;
  return (
    <div className="s14-card h-100">
      <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
        <div className="s14-kpi-label">GMV &amp; Orders · last {data.length} weeks</div>
        <div className="d-flex gap-3">
          <span className="ac-legend-dot" style={{ '--c': '#c9ced9' } as any}>Orders</span>
          <span className="ac-legend-dot" style={{ '--c': '#e8862e' } as any}>GMV</span>
        </div>
      </div>
      <div style={{ height: 280 }}>
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 4 }}>
            <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#8a93a6' }} tickLine={false} axisLine={{ stroke: '#eadfd6' }} />
            <YAxis yAxisId="o" tick={{ fontSize: 11, fill: '#b3bac6' }} tickLine={false} axisLine={false} width={40} />
            <YAxis yAxisId="g" orientation="right" tick={{ fontSize: 11, fill: '#b3bac6' }} tickLine={false} axisLine={false}
              width={52} tickFormatter={(v: number) => formatValue('currency', v, { compact: true })} />
            <Tooltip cursor={{ fill: 'rgba(232,134,46,.06)' }}
              contentStyle={{ borderRadius: 12, border: '1px solid #eef0f4', boxShadow: '0 10px 28px rgba(16,24,40,.12)', fontSize: 13 }}
              formatter={(v: any, n: any) => n === 'GMV' ? [formatValue('currency', Number(v)), 'GMV'] : [formatValue('number', Number(v)), 'Orders']} />
            <Bar yAxisId="o" dataKey="orders" name="Orders" fill="#dfe3ea" radius={[6, 6, 0, 0]} maxBarSize={44} />
            <Line yAxisId="g" type="monotone" dataKey="gmv" name="GMV" stroke="#e8862e" strokeWidth={3}
              dot={{ r: 4, fill: '#e8862e', strokeWidth: 0 }} activeDot={{ r: 6 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---- ss1 · vertical conversion funnel --------------------------------------
function Funnel({ stages }: { stages: { label: string; value: number | null; rate?: number | null; rateLabel?: string }[] }) {
  const present = stages.filter(s => s.value != null);
  if (present.length === 0) return <div className="s14-empty">No funnel data yet</div>;
  const max = Math.max(1, ...present.map(s => s.value ?? 0));
  const COLORS = ['#22b6c4', '#3fc3cf', '#7ad3db', '#e11d63'];
  return (
    <div className="v3-funnel">
      {stages.map((s, i) => {
        const w = Math.max(16, ((s.value ?? 0) / max) * 100);
        return (
          <div className="v3-funnel-row" key={s.label}>
            <div className="v3-funnel-stage" style={{ width: `${w}%`, background: COLORS[i] ?? '#7ad3db' }}>
              <div className="v3-funnel-val">{formatValue('number', s.value)}</div>
              <div className="v3-funnel-name">{s.label}</div>
            </div>
            {s.rate != null && (
              <span className="v3-funnel-rate"><i className="bi bi-arrow-return-right" />{s.rate.toFixed(1)}% <span className="text-muted">{s.rateLabel}</span></span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---- attribution donut ------------------------------------------------------
function Donut({ slices, centerLabel }: { slices: { label: string; value: number }[]; centerLabel: string }) {
  const data = slices.filter(s => s.value > 0);
  const total = slices.reduce((a, b) => a + b.value, 0);
  if (data.length === 0) return <div className="s14-empty">No data yet</div>;
  return (
    <div style={{ height: 220, position: 'relative' }}>
      <ResponsiveContainer>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none" cornerRadius={4}>
            {data.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
          </Pie>
          <Tooltip formatter={(v: any, _n: any, e: any) => [formatValue('currency', Number(v)), e?.payload?.label]} />
        </PieChart>
      </ResponsiveContainer>
      <div className="s14-donut-center">
        <div className="s14-donut-total">{formatValue('currency', total, { compact: true })}</div>
        <div className="s14-donut-cap">{centerLabel}</div>
      </div>
    </div>
  );
}

function LegendList({ slices }: { slices: { label: string; value: number }[] }) {
  const total = slices.reduce((a, b) => a + b.value, 0) || 1;
  return (
    <div className="d-flex flex-column gap-2">
      {slices.map((s, i) => {
        const pct = (s.value / total) * 100;
        return (
          <div key={s.label}>
            <div className="d-flex justify-content-between align-items-center mb-1">
              <span className="s14-bar-label"><span className="s14-dot" style={{ background: PIE[i % PIE.length] }} />{s.label}</span>
              <span className="s14-bar-val">{pct.toFixed(1)}%<span className="text-muted ms-2 small">{formatValue('currency', s.value)}</span></span>
            </div>
            <div className="s14-track"><div className="s14-fill" style={{ width: `${Math.min(100, pct)}%`, background: PIE[i % PIE.length] }} /></div>
          </div>
        );
      })}
    </div>
  );
}

// ---- ss4 · product analytics table -----------------------------------------
const AV_BG = ['#fff1e9', '#eef2ff', '#ecfdf5', '#fef3c7', '#fae8ff', '#e0f2fe'];
const AV_FG = ['#c5640f', '#4f46e5', '#0f766e', '#b45309', '#a21caf', '#0369a1'];
function initials(name: string): string {
  const parts = String(name).trim().split(/[\s_.-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '#';
}
function ProductTable({ def, rows, prevRows }: { def: SectionDefV3; rows: RowData[]; prevRows: RowData[] }) {
  if (!rows || rows.length === 0) return <div className="s14-empty">No products yet</div>;
  // product_id is always a string ('' when unset), so fall back to the product
  // name with || and never key on an empty string (that would collide rows).
  const keyOf = (r: RowData) => String(r.product_id || r.product || '');
  const prevById = new Map(prevRows.filter(r => keyOf(r) !== '').map(r => [keyOf(r), r]));
  const cols = def.fields.filter(f => f.key !== 'product' && f.key !== 'product_id');
  const gmvF = def.fields.find(f => f.key === 'total_gmv');
  return (
    <div className="s14-card p-0 v3-prodtable-wrap">
      <div className="table-responsive">
        <table className="table align-middle mb-0 v3-prodtable">
          <thead><tr>
            <th>Product</th>
            {cols.map(f => <th key={f.key} className="text-end">{f.label}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((row, i) => {
              const k = keyOf(row);
              const prev = k ? prevById.get(k) : undefined;
              const name = String(row.product ?? '').trim() || 'Product';
              return (
                <tr key={i}>
                  <td>
                    <div className="d-flex align-items-center gap-2">
                      <span className="v3-prod-av" style={{ background: AV_BG[i % 6], color: AV_FG[i % 6] }}>{initials(name)}</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="v3-prod-name text-truncate">{name}</div>
                        {row.product_id && <div className="v3-prod-id text-truncate">ID {String(row.product_id)}</div>}
                      </div>
                    </div>
                  </td>
                  {cols.map(f => {
                    const cur = fieldValue(f, row);
                    const pv = prev ? fieldValue(f, prev) : null;
                    const showDelta = f.key === (gmvF?.key ?? 'total_gmv');
                    return (
                      <td key={f.key} className="text-end">
                        <div className="v3-prod-val">{formatValue(f.format, cur)}</div>
                        {showDelta && <DeltaInline f={f} cur={cur} prev={pv} />}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function DeltaInline({ f, cur, prev }: { f: SectionField; cur: number | null; prev: number | null }) {
  if (cur == null || prev == null) return null;
  const diff = cur - prev;
  if (diff === 0) return <div className="v3-prod-delta text-muted">±0%</div>;
  const p = prev === 0 ? 100 : (diff / Math.abs(prev)) * 100;
  const good = f.lowerIsBetter ? diff < 0 : diff > 0;
  return (
    <div className={`v3-prod-delta ${good ? 'text-success' : 'text-danger'}`}>
      <i className={`bi ${diff >= 0 ? 'bi-caret-up-fill' : 'bi-caret-down-fill'}`} /> {prev === 0 ? 'new' : `${fmtPct(p)}%`}
    </div>
  );
}

// ---- top creators / videos / lives -----------------------------------------
const MEDAL = ['#f59e0b', '#94a3b8', '#cd7f32'];
function tiktokLink(h: string) { return `https://www.tiktok.com/@${encodeURIComponent(String(h).trim().replace(/^@+/, '').replace(/\s+/g, ''))}`; }

function TopCreators({ rows }: { rows: RowData[] }) {
  const cs = rows.filter(c => String(c.username ?? '').trim() !== '' || num(c.gmv_generated) != null);
  if (cs.length === 0) return <div className="s14-empty">No creators yet</div>;
  return (
    <div className="row g-3">
      {cs.map((c, i) => {
        const handle = String(c.username ?? '').trim().replace(/^@+/, '');
        return (
          <div className="col-sm-6 col-lg-4" key={i}>
            <div className={`s14-card h-100 tp-card ${i === 0 ? 'tp-gold' : ''}`}>
              <div className="d-flex align-items-center gap-2 mb-3">
                <span className="tp-avatar" style={{ background: AV_BG[i % 6], color: AV_FG[i % 6] }}>{handle ? initials(handle) : <i className="bi bi-person" />}</span>
                <div className="flex-grow-1" style={{ minWidth: 0 }}>
                  {handle ? <a className="tp-name" href={tiktokLink(handle)} target="_blank" rel="noreferrer">@{handle}</a> : <span className="tp-name text-muted">—</span>}
                </div>
                <span className="tp-rank" style={{ background: MEDAL[i] ?? '#cbd5e1' }}>{i + 1}</span>
              </div>
              <div className="tp-gmv">{formatValue('currency', num(c.gmv_generated))}</div>
              <div className="tp-sub">GMV generated</div>
              <div className="d-flex gap-3 mt-2 flex-wrap">
                <span className="tp-stat"><strong>{formatValue('number', num(c.items_sold))}</strong> items sold</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TopVideos({ rows }: { rows: RowData[] }) {
  const vs = rows.filter(v => String(v.video_link ?? '').trim() !== '' || String(v.product_promoted ?? '').trim() !== '' || num(v.gmv) != null);
  if (vs.length === 0) return <div className="s14-empty">No videos yet</div>;
  return (
    <div className="row g-3">
      {vs.map((v, i) => {
        const url = String(v.video_link ?? '').trim();
        return (
          <div className="col-sm-6 col-lg-4" key={i}>
            <div className={`s14-card h-100 tp-video ${i === 0 ? 'tp-gold' : ''}`}>
              <a className="tp-thumb" href={url || undefined} target="_blank" rel="noreferrer" style={{ pointerEvents: url ? 'auto' : 'none' }}>
                <span className="tp-rank-badge" style={{ background: MEDAL[i] ?? '#cbd5e1' }}>#{i + 1}</span>
                <i className="bi bi-play-circle-fill tp-play" />
              </a>
              <div className="tp-video-body">
                <div className="tp-product">{String(v.product_promoted ?? '').trim() || 'Product'}</div>
                <div className="tp-gmv">{formatValue('currency', num(v.gmv))}</div>
                <div className="tp-sub">video GMV · {formatValue('number', num(v.items_sold))} items</div>
                {url && <a className="tp-watch mt-2 d-inline-flex align-items-center" href={url} target="_blank" rel="noreferrer"><i className="bi bi-tiktok me-1" />Watch on TikTok</a>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TopLives({ rows }: { rows: RowData[] }) {
  const ls = rows.filter(l => String(l.live_id ?? '').trim() !== '' || String(l.creator ?? '').trim() !== '' || num(l.gmv) != null);
  if (ls.length === 0) return <div className="s14-empty">No LIVE sessions yet</div>;
  return (
    <div className="row g-3">
      {ls.map((l, i) => {
        const creator = String(l.creator ?? '').trim().replace(/^@+/, '');
        return (
          <div className="col-sm-6 col-lg-4" key={i}>
            <div className={`s14-card h-100 tp-card v3-live ${i === 0 ? 'tp-gold' : ''}`}>
              <div className="d-flex align-items-center gap-2 mb-3">
                <span className="v3-live-badge"><i className="bi bi-broadcast" /> LIVE</span>
                <div className="flex-grow-1 text-truncate">
                  {creator ? <a className="tp-name" href={tiktokLink(creator)} target="_blank" rel="noreferrer">@{creator}</a> : <span className="tp-name text-muted">—</span>}
                </div>
                <span className="tp-rank" style={{ background: MEDAL[i] ?? '#cbd5e1' }}>{i + 1}</span>
              </div>
              <div className="tp-gmv">{formatValue('currency', num(l.gmv))}</div>
              <div className="tp-sub">LIVE GMV</div>
              <div className="v3-live-meta mt-2">
                {l.product_sold && <div><i className="bi bi-bag me-1 text-muted" />{String(l.product_sold)}</div>}
                <div className="d-flex gap-3 flex-wrap mt-1">
                  {l.live_duration && <span className="tp-stat"><i className="bi bi-clock me-1" />{String(l.live_duration)}</span>}
                  {l.live_id && <span className="tp-stat text-muted">{String(l.live_id)}</span>}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- §6 · Channel Analytics (Video ∥ LIVE side by side) --------------------
function ChannelPair({ def, rows, prevRows }: { def: SectionDefV3; rows: RowData[]; prevRows: RowData[] }) {
  const metricFields = def.fields.filter(f => f.key !== 'channel');
  const find = (arr: RowData[], ch: string) => arr.find(r => String(r.channel) === ch) ?? {};
  const META: Record<string, { icon: string; color: string; sub: string }> = {
    Video: { icon: 'bi-play-btn-fill', color: '#0d6efd', sub: 'Short-form video' },
    LIVE: { icon: 'bi-broadcast', color: '#e11d63', sub: 'LIVE selling' },
  };
  return (
    <div className="row g-3">
      {(def.fixedRows ?? []).map(ch => {
        const row = find(rows, ch); const prev = find(prevRows, ch);
        const m = META[ch] ?? { icon: 'bi-graph-up', color: '#e8862e', sub: '' };
        return (
          <div className="col-md-6" key={ch}>
            <div className="s14-card h-100 v3-channel" style={{ ['--ch' as any]: m.color }}>
              <div className="d-flex align-items-center gap-2 mb-3">
                <span className="v3-channel-icon" style={{ background: m.color }}><i className={`bi ${m.icon}`} /></span>
                <div><div className="v3-channel-title">{ch}</div><div className="v3-channel-sub">{m.sub}</div></div>
              </div>
              <div className="row g-3">
                {metricFields.map(f => (
                  <div className="col-6" key={f.key}><KpiTile f={f} data={row as ScalarData} prev={prev as ScalarData} /></div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- §12 · GMV Max dashboard ------------------------------------------------
function GmvMaxViz({ rows }: { rows: RowData[] }) {
  if (!rows || rows.length === 0) return <div className="s14-empty">No GMV Max data yet</div>;
  const totCost = rows.reduce((a, r) => a + numv(r.cost), 0);
  const totRev = rows.reduce((a, r) => a + numv(r.gross_revenue), 0);
  const totOrders = rows.reduce((a, r) => a + numv(r.sku_orders), 0);
  const roas = totCost > 0 ? totRev / totCost : null;
  const cpo = totOrders > 0 ? totCost / totOrders : null;
  const chart = rows.map(r => ({ name: String(r.product ?? '').slice(0, 14) || '—', Cost: numv(r.cost), Revenue: numv(r.gross_revenue) }));
  const tiles: { label: string; value: string }[] = [
    { label: 'Total Ad Spend', value: formatValue('currency', totCost) },
    { label: 'Gross Revenue', value: formatValue('currency', totRev) },
    { label: 'Blended ROAS', value: roas == null ? '—' : `${roas.toFixed(2)}x` },
    { label: 'Blended CPO', value: cpo == null ? '—' : formatValue('currency', cpo) },
  ];
  return (
    <div className="row g-3">
      <div className="col-lg-4">
        <div className="row g-3">
          {tiles.map(t => (
            <div className="col-6" key={t.label}>
              <div className="ac-kpi h-100"><div className="ac-kpi-label">{t.label}</div><div className="ac-kpi-value">{t.value}</div></div>
            </div>
          ))}
        </div>
      </div>
      <div className="col-lg-8">
        <div className="s14-card h-100">
          <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
            <div className="s14-kpi-label">Ad spend vs gross revenue by product</div>
            <div className="d-flex gap-3">
              <span className="ac-legend-dot" style={{ '--c': '#c9ced9' } as any}>Cost</span>
              <span className="ac-legend-dot" style={{ '--c': '#10b981' } as any}>Revenue</span>
            </div>
          </div>
          <div style={{ height: 240 }}>
            <ResponsiveContainer>
              <ComposedChart data={chart} margin={{ top: 8, right: 8, bottom: 4, left: 4 }} barGap={4}>
                <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#8a93a6' }} tickLine={false} interval={0} angle={-12} textAnchor="end" height={48} />
                <YAxis tick={{ fontSize: 11, fill: '#b3bac6' }} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => formatValue('currency', v, { compact: true })} />
                <Tooltip formatter={(v: any, n: any) => [formatValue('currency', Number(v)), n]} />
                <Bar dataKey="Cost" fill="#dfe3ea" radius={[6, 6, 0, 0]} maxBarSize={34} />
                <Bar dataKey="Revenue" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={34} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

const NAV_ICON: Record<string, string> = {
  sampling: 'bi-box-seam', overall: 'bi-graph-up-arrow', product_analytics: 'bi-grid-3x3-gap-fill',
  product_traffic: 'bi-signpost-split-fill', traffic_analysis: 'bi-funnel-fill', channel_analytics: 'bi-collection-play-fill',
  offsite: 'bi-box-arrow-up-right', affiliate: 'bi-people-fill', top_creators: 'bi-trophy-fill',
  top_videos: 'bi-play-btn-fill', top_lives: 'bi-broadcast', gmv_max: 'bi-cash-stack',
};
const SECTION_ACCENT: Record<string, string> = {
  sampling: '#e8862e', overall: '#e8862e', product_analytics: '#0d6efd', product_traffic: '#06b6d4',
  traffic_analysis: '#06b6d4', channel_analytics: '#8b5cf6', offsite: '#0ea5e9', affiliate: '#198754',
  top_creators: '#e8862e', top_videos: '#0d6efd', top_lives: '#e11d63', gmv_max: '#8b5cf6',
};

export default function ReportDashboardV3({
  c, p, wow, hasPrev, commentsConfig, openSectionOnLoad, highlightCommentId,
  approvalDecisions, approvalAction, audience = 'staff', reportMeta,
}: {
  c: WeeklyReportContentV3;
  p: WeeklyReportContentV3 | null;
  /** week-over-week series (bars=orders, line=GMV) built by the page. Falls back to trendData GMV. */
  wow?: WowPoint[];
  trendData?: TrendPoint[];
  hasPrev: boolean;
  reportMeta?: { title: string; period: string; compare?: string };
  commentsConfig?: CommentsConfig;
  openSectionOnLoad?: CommentSection | null;
  highlightCommentId?: string | null;
  approvalDecisions?: ApprovalDecisionView[];
  approvalAction?: ApprovalActionConfig;
  audience?: 'staff' | 'client';
}) {
  const isClient = audience === 'client';
  const [feedbackSection, setFeedbackSection] = useState<CommentSection | null>(null);
  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('ac_dash_nav') === '1'; } catch { return false; }
  });
  const toggleNav = () => setNavCollapsed(v => { const n = !v; try { localStorage.setItem('ac_dash_nav', n ? '1' : '0'); } catch { /* ignore */ } return n; });

  const wowData: WowPoint[] = wow ?? [];
  const visibleSections = WEEKLY_SECTIONS_V3.filter(d => !(isClient && CLIENT_HIDE.has(d.id)));

  const sectionHasData = (def: SectionDefV3): boolean => {
    const data = (c as any)[def.id];
    if (def.kind === 'scalar') return def.fields.some(f => !f.auto && data?.[f.key] != null);
    // Fixed sections (channel_analytics) always carry their locked rows, so
    // count them as "has data" only when a real metric was entered.
    if (def.kind === 'fixed') {
      return Array.isArray(data) && data.some((r: any) =>
        def.fields.some(f => f.key !== def.labelKey && !f.auto && r?.[f.key] != null));
    }
    return Array.isArray(data) && data.length > 0;
  };

  const navItems: DashNavItem[] = visibleSections
    .filter(sectionHasData)
    .map(d => ({ id: d.id, label: d.title.split(' — ')[0].replace('GMV Max — Product-Level Ad Spend & Overall', 'GMV Max'), icon: NAV_ICON[d.id] ?? 'bi-dot' }));
  const insightsText = c.insights?.summary?.replace(/<[^>]*>/g, '').trim();
  if (insightsText) navItems.push({ id: 'insights', label: 'Insights', icon: 'bi-lightbulb-fill' });
  if (c.approval?.enabled) navItems.push({ id: 'approval', label: 'Approval', icon: 'bi-shield-check' });

  useEffect(() => {
    if (!openSectionOnLoad) return;
    setFeedbackSection(openSectionOnLoad);
    setTimeout(() => {
      const el = document.querySelector(`[data-section="${CSS.escape(openSectionOnLoad)}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, [openSectionOnLoad]);

  const feedbackCount = (section: CommentSection) => (commentsConfig?.comments ?? []).filter(x => x.section === section).length;
  const customSectionFor = (section: CommentSection) => section.startsWith('cs:') ? ((c.custom_sections ?? []).find(s => s.id === section.slice(3)) ?? null) : null;
  const labelFor = (section: CommentSection): string => {
    const cs = customSectionFor(section);
    if (cs) return cs.name || 'Custom Section';
    if (section === 'approval') return 'Approval Needed / Action Items';
    if (section === 'insights') return 'Insights';
    const def = SECTION_BY_ID_V3[section];
    return def ? `${def.num}. ${def.title}` : section;
  };
  const FeedbackIcon = ({ section }: { section: CommentSection }) => {
    if (!commentsConfig) return null;
    const n = feedbackCount(section);
    if (commentsConfig.mode === 'authed' && n === 0 && section !== 'approval') return null;
    if (commentsConfig.mode === 'public' && section === 'approval') {
      return (
        <Button size="sm" className="ms-2 fw-semibold" style={{ backgroundColor: '#fff', color: '#0d6efd', borderColor: '#0d6efd', whiteSpace: 'nowrap' }}
          onClick={() => setFeedbackSection(section)} title="Open the conversation thread">
          <i className="bi bi-chat-left-text me-1" />{n > 0 ? `Thread (${n})` : 'Open thread'}
        </Button>
      );
    }
    return (
      <Button size="sm" variant="outline-primary" className="ms-2 d-inline-flex align-items-center gap-1"
        onClick={() => setFeedbackSection(section)} title={commentsConfig.mode === 'authed' ? 'View / add staff notes' : 'View / add comments'}>
        <i className="bi bi-chat-left-text" />{n > 0 && <Badge bg="primary" pill>{n}</Badge>}
      </Button>
    );
  };

  const renderCustomAt = (anchor: string) =>
    isClient ? null : (c.custom_sections ?? []).filter(s => s.insert_after === anchor).map(s => (
      <CustomSectionView key={s.id} section={s}
        prevSection={(p?.custom_sections ?? []).find(ps => ps.id === s.id) ?? null}
        feedbackSlot={<FeedbackIcon section={`cs:${s.id}` as CommentSection} />} />
    ));

  // ---- per-section renderer -------------------------------------------------
  const body = (def: SectionDefV3): ReactNode => {
    const data = (c as any)[def.id] as ScalarData;
    const prev = p ? (p as any)[def.id] as ScalarData : null;
    const rows = (c as any)[def.id] as RowData[];
    const prevRows = (p ? (p as any)[def.id] : []) as RowData[];

    switch (def.id) {
      case 'sampling':
        return <TileGrid def={def} data={data} prev={prev} col="col-6 col-lg-6" />;
      case 'overall': {
        const scoreF = def.fields.find(f => f.key === 'shop_performance_score')!;
        return (
          <>
            <TileGrid def={def} data={data} prev={prev} skip={new Set(['shop_performance_score', 'shop_ranking'])} />
            <div className="row g-3 mt-0">
              <div className="col-lg-8">{wowData.length >= 2 ? <WowCombo data={wowData} /> : <div className="s14-card h-100 d-flex align-items-center justify-content-center s14-empty">Week-over-week chart needs at least 2 weekly reports</div>}</div>
              <div className="col-lg-4">
                <ShopHealthGauge score={fieldValue(scoreF, data)} ranking={num(data?.shop_ranking)} prevRanking={prev ? num(prev?.shop_ranking) : null} />
              </div>
            </div>
          </>
        );
      }
      case 'product_analytics':
        return <ProductTable def={def} rows={rows} prevRows={prevRows} />;
      case 'product_traffic': {
        const slices = [
          { label: 'Seller LIVE', value: numv(data?.seller_live_gmv) },
          { label: 'Seller Video', value: numv(data?.seller_video_gmv) },
          { label: 'Creator', value: numv(data?.creator_gmv) },
        ];
        return (
          <div className="row g-3">
            <div className="col-lg-5"><div className="s14-card h-100"><div className="s14-kpi-label mb-2">GMV by traffic source</div><Donut slices={slices} centerLabel="Product GMV" /></div></div>
            <div className="col-lg-7"><TileGrid def={def} data={data} prev={prev} col="col-6 col-lg-4" /></div>
          </div>
        );
      }
      case 'traffic_analysis': {
        const impr = num(data?.impressions), clicks = num(data?.clicks), orders = num(data?.sku_orders);
        const atc = num((c.product_traffic as any)?.atc_count);
        const rate = (a: number | null, b: number | null) => (a != null && b != null && b !== 0) ? (a / b) * 100 : null;
        const stages = [
          { label: 'Product Impressions', value: impr },
          { label: 'Product Clicks', value: clicks, rate: rate(clicks, impr), rateLabel: 'CTR' },
          ...(atc != null ? [{ label: 'Add to Cart', value: atc, rate: rate(atc, clicks), rateLabel: 'ATC rate' }] : []),
          { label: 'SKU Orders', value: orders, rate: rate(orders, atc ?? clicks), rateLabel: atc != null ? 'cart→order' : 'CVR' },
        ];
        return <div className="s14-card"><Funnel stages={stages} /></div>;
      }
      case 'channel_analytics':
        return <ChannelPair def={def} rows={rows} prevRows={prevRows} />;
      case 'offsite': {
        const slices = [
          { label: 'TikTok Shop GMV', value: numv(data?.tiktok_shop_gmv) },
          { label: 'Offsite GMV', value: numv(data?.offsite_gmv) },
        ];
        return (
          <div className="row g-3">
            <div className="col-lg-5"><div className="s14-card h-100"><div className="s14-kpi-label mb-2">Onsite vs offsite GMV</div><Donut slices={slices} centerLabel="Total GMV" /></div></div>
            <div className="col-lg-7"><TileGrid def={def} data={data} prev={prev} col="col-12 col-sm-4" /></div>
          </div>
        );
      }
      case 'affiliate':
        return <TileGrid def={def} data={data} prev={prev} col="col-6 col-lg" />;
      case 'top_creators': return <TopCreators rows={rows} />;
      case 'top_videos': return <TopVideos rows={rows} />;
      case 'top_lives': return <TopLives rows={rows} />;
      case 'gmv_max': return <GmvMaxViz rows={rows} />;
      default:
        return def.kind === 'scalar' ? <TileGrid def={def} data={data} prev={prev} /> : null;
    }
  };

  const inner = (
    <>
      {reportMeta && (
        <div className="dash-report-head ac-fade">
          <div>
            <h1 className="dash-report-title">{reportMeta.title}</h1>
            <div className="dash-report-period"><i className="bi bi-calendar3" />{reportMeta.period}</div>
          </div>
          {reportMeta.compare && <div className="dash-report-pill"><i className="bi bi-arrow-left-right" />{reportMeta.compare}</div>}
        </div>
      )}
      {!hasPrev && !isClient && <Alert variant="warning" className="py-2">No previous period — single-period view (no comparison).</Alert>}

      {renderCustomAt('start')}

      <div className="s14-root">
        {visibleSections.map(def => (
          <div key={def.id}>
            <section className="s14-section" data-section={def.id}>
              <SectionTitle title={`${def.num}. ${def.title.replace(' — Product-Level Ad Spend & Overall', '')}`} sub={def.blurb}
                color={SECTION_ACCENT[def.id]} fb={<FeedbackIcon section={def.id as CommentSection} />} />
              {body(def)}
            </section>
            {renderCustomAt(def.id)}
          </div>
        ))}

        {insightsText && (
          <section className="s14-section" data-section="insights">
            <SectionTitle title="Insights" sub="This week in words" color="#0ea5e9" fb={<FeedbackIcon section="insights" />} />
            <div className="s14-card"><div className="ac-rte-view" dangerouslySetInnerHTML={{ __html: sanitizeRich(c.insights.summary) }} /></div>
          </section>
        )}
        {renderCustomAt('insights')}

        {c.approval?.enabled && (
          <section className="s14-section" data-section="approval">
            <SectionTitle title="Approval Needed / Action Items" color="#f59e0b" fb={<FeedbackIcon section="approval" />} />
            <div className="s14-card v3-approval">
              <div className="ac-rte-view ac-approval-content" dangerouslySetInnerHTML={{ __html: sanitizeRich(c.approval.content) }} />
              {commentsConfig?.mode === 'public' && approvalAction && <ApprovalActionInline action={approvalAction} />}
              {commentsConfig?.mode === 'authed' && approvalDecisions && approvalDecisions.length > 0 && (
                <div className="mt-3">
                  <h6 className="text-muted mb-2 small text-uppercase" style={{ letterSpacing: '.5px' }}>Client decisions</h6>
                  {approvalDecisions.map(d => (
                    <div key={d.id} className="d-flex align-items-center gap-2 small mb-1">
                      <Badge bg={d.decision === 'approved' ? 'success' : 'warning'} text={d.decision === 'approved' ? undefined : 'dark'}>
                        {d.decision === 'approved' ? 'Approved' : 'Changes requested'}
                      </Badge>
                      <strong>{d.decided_by_name}</strong>
                      <span className="text-muted">{new Date(d.decided_at).toLocaleDateString()}</span>
                      {d.comment && <span className="text-muted">— {d.comment}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </>
  );

  return (
    <div className="ac-themed dash-shell">
      <DashSidebar items={navItems} collapsed={navCollapsed} onToggle={toggleNav} />
      <div className={`dash-client ${navCollapsed ? 'nav-collapsed' : ''}`}>
        <Offcanvas show={!!feedbackSection} onHide={() => setFeedbackSection(null)} placement="end" style={{ width: 480 }}>
          <Offcanvas.Header closeButton>
            <Offcanvas.Title><i className="bi bi-chat-left-text me-2" />{commentsConfig?.mode === 'authed' ? 'Client feedback' : 'Comments'}
              {feedbackSection && <small className="text-muted ms-2 fw-normal">— {labelFor(feedbackSection)}</small>}</Offcanvas.Title>
          </Offcanvas.Header>
          <Offcanvas.Body>
            {feedbackSection && commentsConfig && (
              <SectionComments section={feedbackSection} sectionLabel={labelFor(feedbackSection)}
                comments={commentsConfig.comments} mode={commentsConfig.mode}
                currentAuthorName={commentsConfig.currentAuthorName} defaultPublicName={commentsConfig.defaultPublicName}
                onAdd={(b, n, parentId) => commentsConfig.onAdd(feedbackSection, b, n, parentId)}
                highlightCommentId={highlightCommentId ?? undefined} />
            )}
          </Offcanvas.Body>
        </Offcanvas>
        {inner}
      </div>
    </div>
  );
}

// ===== Approval inline form (client share view) =============================
function ApprovalActionInline({ action }: { action: ApprovalActionConfig }) {
  const { myDecision, defaultName, onSubmit } = action;
  const [name, setName] = useState(defaultName);
  const [choice, setChoice] = useState<'approved' | 'changes_requested' | null>(myDecision?.decision ?? null);
  const [comment, setComment] = useState(myDecision?.comment ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    setChoice(myDecision?.decision ?? null); setComment(myDecision?.comment ?? '');
    setName(prev => prev || defaultName); setJustSaved(false);
  }, [myDecision, defaultName]);

  const submit = async () => {
    setErr(null);
    if (!choice) { setErr('Pick Approve or Request changes first.'); return; }
    if (!name.trim()) { setErr('Enter your name so we can credit your decision.'); return; }
    setSubmitting(true);
    try { await onSubmit(choice, comment.trim(), name.trim()); setJustSaved(true); }
    catch (e: any) { setErr(e?.message ?? 'Failed to submit'); }
    finally { setSubmitting(false); }
  };

  if (myDecision) {
    return (
      <div className="mt-4 pt-3 border-top">
        <Alert variant={myDecision.decision === 'approved' ? 'success' : 'warning'} className="py-2 mb-0">
          <strong>You {myDecision.decision === 'approved' ? 'approved' : 'requested changes on'} this report.</strong>
          <div className="small">Recorded by {myDecision.decided_by_name} on {new Date(myDecision.decided_at).toLocaleString()}.</div>
        </Alert>
      </div>
    );
  }
  return (
    <div className="mt-4 pt-3 border-top">
      <div className="fw-semibold small text-uppercase text-muted mb-2" style={{ letterSpacing: '.5px' }}>Submit your decision</div>
      {err && <Alert variant="danger" className="py-2 small mb-2">{err}</Alert>}
      {justSaved && !err && <Alert variant="success" className="py-2 small mb-2">Saved. Thank you.</Alert>}
      <Form.Group className="mb-2"><Form.Label className="small mb-1">Your name</Form.Label>
        <Form.Control size="sm" value={name} onChange={e => setName(e.target.value)} disabled={submitting} /></Form.Group>
      <div className="d-flex gap-2 flex-wrap mb-2">
        <Button size="sm" variant={choice === 'approved' ? 'success' : 'outline-success'} onClick={() => setChoice('approved')} disabled={submitting}><i className="bi bi-check-circle me-1" /> Approve</Button>
        <Button size="sm" variant={choice === 'changes_requested' ? 'warning' : 'outline-warning'} onClick={() => setChoice('changes_requested')} disabled={submitting}><i className="bi bi-arrow-repeat me-1" /> Request changes</Button>
      </div>
      <Form.Control as="textarea" rows={2} placeholder="Comment (optional)" value={comment} onChange={e => setComment(e.target.value)} disabled={submitting} />
      <div className="d-flex justify-content-end mt-2"><Button size="sm" onClick={submit} disabled={submitting || !choice || !name.trim()}>{submitting ? 'Submitting…' : 'Submit decision'}</Button></div>
    </div>
  );
}
