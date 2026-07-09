// Brand-group chat extras: a slim strip under the chat header showing the
// brand's current-month sample-seeding progress, plus quick popups for
// Samples (read-only Samples-tab summary, latest 3 months), the brand's
// Products catalog, and the latest 3 months of weekly/monthly reports
// (click-through to the report). Staff-only (bob / team_lead / apc) —
// internal paid-collab handlers in the group have no RLS access to these
// tables, so the strip self-hides for them.
import { useEffect, useMemo, useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, Button, Table, Spinner, Alert, Badge, Row, Col, Form } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthContext';
import { toISO } from '../../lib/dates';
import type { BrandProduct } from '../../lib/paidCollabSchema';
import {
  SampleProduct, DailyEntry, currentMonth, monthLabel, daysInMonth, recentMonths,
  isWeekend, sumValues, productGoalFor, GoalProgressTile, ProductProgressBar,
} from '../brand/BrandSamplesTab';

const pctColor = (pct: number) =>
  pct >= 100 ? '#198754' : pct >= 75 ? '#e8862e' : pct >= 40 ? '#fd7e14' : '#dc3545';

const fmtUsd = (v: number) =>
  `$${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function monthBounds(yyyymm: string): { first: string; last: string } {
  const [y, m] = yyyymm.split('-').map(Number);
  return { first: `${yyyymm}-01`, last: toISO(new Date(y, m, 0)) };
}

// Footer action that closes the popup and navigates to the matching Brand
// Detail tab (replaces the plain "Close" — the ✕ in the header still closes).
function MoveToButton({ brandId, tab, label, onClose }: {
  brandId: string; tab: string; label: string; onClose: () => void;
}) {
  const navigate = useNavigate();
  return (
    <Button
      variant="primary"
      onClick={() => { onClose(); navigate(`/brands/${brandId}?tab=${tab}`); }}
    >
      Move to {label} <i className="bi bi-arrow-right ms-1" />
    </Button>
  );
}

// Circular progress ring with the percentage in the centre (e.g. "82%").
// Sized to line up with the 38px header icon buttons.
function CircularProgress({ pct, color, label, size = 36, stroke = 3.5 }: {
  pct: number; color: string; label?: string; size?: number; stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, pct)) / 100) * circ;
  const mid = size / 2;
  const text = label ?? `${pct}%`;
  return (
    <svg className="ac-brandbar-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={mid} cy={mid} r={r} fill="none" stroke="rgba(0,0,0,.1)" strokeWidth={stroke} />
      <circle
        cx={mid} cy={mid} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={`${dash} ${circ}`}
        transform={`rotate(-90 ${mid} ${mid})`}
        style={{ transition: 'stroke-dasharray .4s ease' }}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle"
        style={{ fontSize: size * (text.length > 3 ? 0.26 : 0.3), fontWeight: 700, fill: color }}>
        {text}
      </text>
    </svg>
  );
}

const approvedOf = (rows: Pick<DailyEntry, 'product_counts' | 'others_count'>[]) =>
  rows.reduce((s, d) => s + sumValues(d.product_counts ?? {}) + (d.others_count ?? 0), 0);

type BarModal = 'samples' | 'products' | 'reports' | 'gmv' | 'tasks' | null;

export default function BrandChatBar({ brandId, brandName }: { brandId: string; brandName: string }) {
  const { profile } = useAuth();
  const [modal, setModal] = useState<BarModal>(null);
  const [summary, setSummary] = useState<{ approved: number; goal: number } | null>(null);
  const [gmv, setGmv] = useState<{ adSpend: number; budget: number } | null>(null);
  const [openTasks, setOpenTasks] = useState(0);
  // Bumped after a task is created/updated in the popup so the dot count refreshes.
  const [taskTick, setTaskTick] = useState(0);

  // Roles with RLS read access to brand_samples_* / brand_products / the report
  // tables + the /reporting routes. Internal handlers stay excluded (no such reads).
  const isStaff = !!profile && ['bob', 'team_lead', 'apc', 'ads_manager'].includes(profile.role);

  // Current-month seeding rollup for the strip.
  useEffect(() => {
    if (!isStaff) return;
    let on = true;
    setSummary(null);
    setGmv(null);
    (async () => {
      const month = currentMonth();
      const { first, last } = monthBounds(month);
      const [gRes, dRes, mRes, wRes] = await Promise.all([
        supabase.from('brand_samples_periods')
          .select('total_goal').eq('brand_id', brandId).eq('month', month).maybeSingle(),
        supabase.from('brand_samples_daily')
          .select('product_counts, others_count').eq('brand_id', brandId)
          .gte('entry_date', first).lte('entry_date', last),
        supabase.from('brand_gmv_max_monthly')
          .select('allocated_budget').eq('brand_id', brandId).eq('month', month).maybeSingle(),
        // Weeks overlapping the current month (matches the GMV Max tab total).
        supabase.from('brand_gmv_max_weekly')
          .select('ad_spend').eq('brand_id', brandId)
          .lte('week_start', last).gte('week_end', first),
      ]);
      if (!on) return;
      if (!gRes.error && !dRes.error) {
        setSummary({
          approved: approvedOf((dRes.data ?? []) as DailyEntry[]),
          goal: (gRes.data as any)?.total_goal ?? 0,
        });
      }
      if (!mRes.error && !wRes.error) {
        const adSpend = ((wRes.data ?? []) as { ad_spend: number }[])
          .reduce((s, w) => s + (Number(w.ad_spend) || 0), 0);
        setGmv({ adSpend, budget: (mRes.data as any)?.allocated_budget ?? 0 });
      }
    })();
    return () => { on = false; };
  }, [brandId, isStaff]);

  // Pending (not-done) task count for this brand → red dot on the Tasks button.
  // RLS scopes what each role sees; the shared `tasks` table keeps this in sync
  // with the Tasks page both ways. Realtime keeps the dot live.
  useEffect(() => {
    if (!isStaff) return;
    let on = true;
    const loadCount = async () => {
      const { count } = await supabase.from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('brand_id', brandId).neq('status', 'done');
      if (on) setOpenTasks(count ?? 0);
    };
    loadCount();
    const ch = supabase.channel(`brandbar-tasks:${brandId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `brand_id=eq.${brandId}` }, loadCount)
      .subscribe();
    return () => { on = false; supabase.removeChannel(ch); };
  }, [brandId, isStaff, taskTick]);

  if (!isStaff) return null;

  const pct = summary && summary.goal > 0
    ? Math.min(100, Math.round((summary.approved / summary.goal) * 100))
    : 0;
  const color = pctColor(pct);

  const adColor = '#0d6efd';
  const budgetPct = gmv && gmv.budget > 0
    ? Math.min(100, Math.round((gmv.adSpend / gmv.budget) * 100))
    : 0;

  return (
    <>
      <div className="ac-brandbar-chat">
        <button
          type="button"
          className="ac-brandbar-progress"
          title="Sample seeding this month — click for details"
          onClick={() => setModal('samples')}
        >
          <CircularProgress pct={pct} color={color} />
          <span className="ac-brandbar-stat">
            <i className="bi bi-box-seam ac-brandbar-mi" style={{ color }} />
            <span className="ac-brandbar-sub">
              {summary
                ? (summary.goal > 0 ? `${summary.approved}/${summary.goal}` : `${summary.approved} approved`)
                : '…'}
            </span>
          </span>
        </button>
        <button
          type="button"
          className="ac-brandbar-progress"
          title="GMV Max ad spend this month — click for details"
          onClick={() => setModal('gmv')}
        >
          <CircularProgress pct={budgetPct} color={adColor} label={gmv && gmv.budget > 0 ? undefined : '$'} />
          <span className="ac-brandbar-stat">
            <i className="bi bi-cash-coin ac-brandbar-mi" style={{ color: adColor }} />
            <span className="ac-brandbar-sub">{gmv ? fmtUsd(gmv.adSpend) : '…'}</span>
          </span>
        </button>
        <button type="button" className="ac-brandbar-btn" title="Products" onClick={() => setModal('products')}>
          <i className="bi bi-tags" />
        </button>
        <button type="button" className="ac-brandbar-btn" title="Reports" onClick={() => setModal('reports')}>
          <i className="bi bi-file-earmark-bar-graph" />
        </button>
        <button
          type="button"
          className="ac-brandbar-btn"
          title={openTasks > 0 ? `${openTasks} pending task${openTasks === 1 ? '' : 's'}` : 'Tasks'}
          onClick={() => setModal('tasks')}
        >
          <i className="bi bi-check2-square" />
          {openTasks > 0 && <span className="ac-brandbar-dot" />}
        </button>
      </div>

      {modal === 'samples' && (
        <SamplesModal brandId={brandId} brandName={brandName} onClose={() => setModal(null)} />
      )}
      {modal === 'products' && (
        <ProductsModal brandId={brandId} brandName={brandName} onClose={() => setModal(null)} />
      )}
      {modal === 'reports' && (
        <ReportsModal brandId={brandId} brandName={brandName} onClose={() => setModal(null)} />
      )}
      {modal === 'gmv' && (
        <GmvModal brandId={brandId} brandName={brandName} onClose={() => setModal(null)} />
      )}
      {modal === 'tasks' && (
        <TasksModal
          brandId={brandId}
          brandName={brandName}
          onClose={() => setModal(null)}
          onChanged={() => setTaskTick(t => t + 1)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Samples popup — the Samples tab's summary (month buttons → goal + KPI tiles
// → tracked products), read-only.
// ---------------------------------------------------------------------------

// Compact KPI tile sized for the modal's narrow 3-up row (the Samples tab's
// full-size KpiTile icon box overwhelms the numbers at this width).
function MiniKpi({ icon, color, label, value }: { icon: string; color: string; label: string; value: string }) {
  return (
    <div className="p-2 rounded h-100 text-center" style={{
      background: `linear-gradient(135deg, ${color}1a 0%, ${color}0d 100%)`,
      border: `1px solid ${color}33`,
    }}>
      <div className="small text-muted text-truncate" style={{ fontSize: '.72rem' }}>
        <i className={`bi ${icon} me-1`} style={{ color, fontSize: '.8rem' }} />
        {label}
      </div>
      <div className="fw-bold" style={{ fontSize: '1rem', color: '#2c2c2c' }}>{value}</div>
    </div>
  );
}

function SamplesModal({ brandId, brandName, onClose }: { brandId: string; brandName: string; onClose: () => void }) {
  const [month, setMonth] = useState(currentMonth());
  const [products, setProducts] = useState<SampleProduct[]>([]);
  const [days, setDays] = useState<DailyEntry[]>([]);
  const [goal, setGoal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    setLoading(true); setErr(null);
    (async () => {
      const { first, last } = monthBounds(month);
      const [pRes, gRes, dRes] = await Promise.all([
        supabase.from('brand_samples_products')
          .select('*').eq('brand_id', brandId).order('sort_order').order('created_at'),
        supabase.from('brand_samples_periods')
          .select('total_goal').eq('brand_id', brandId).eq('month', month).maybeSingle(),
        supabase.from('brand_samples_daily')
          .select('*').eq('brand_id', brandId)
          .gte('entry_date', first).lte('entry_date', last).order('entry_date'),
      ]);
      if (!on) return;
      const bad = pRes.error ?? gRes.error ?? dRes.error;
      if (bad) { setErr(bad.message); setLoading(false); return; }
      setProducts((pRes.data ?? []) as SampleProduct[]);
      setGoal((gRes.data as any)?.total_goal ?? 0);
      setDays(((dRes.data ?? []) as any[]).map(r => ({ ...r, product_counts: r.product_counts ?? {} })) as DailyEntry[]);
      setLoading(false);
    })();
    return () => { on = false; };
  }, [brandId, month]);

  const totalApproved = useMemo(() => approvedOf(days), [days]);
  const totalNewVideos = useMemo(() => days.reduce((s, d) => s + (d.new_videos ?? 0), 0), [days]);
  const avgSps = useMemo(() => {
    const xs = days.filter(d => !isWeekend(d.entry_date)).map(d => d.daily_sps).filter((n): n is number => n != null);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  }, [days]);
  const daysWithEntry = useMemo(() =>
    days.filter(d => d.id || sumValues(d.product_counts) > 0 || d.others_count > 0 || d.new_videos != null).length,
  [days]);
  const perProductTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const d of days) {
      for (const [pid, c] of Object.entries(d.product_counts)) totals[pid] = (totals[pid] ?? 0) + (c ?? 0);
    }
    return totals;
  }, [days]);
  const goalPct = goal > 0 ? Math.min(100, Math.round((totalApproved / goal) * 100)) : 0;

  return (
    <Modal show onHide={onClose} centered size="lg" scrollable>
      <Modal.Header closeButton>
        <Modal.Title>
          <i className="bi bi-box-seam me-2" />
          Sample Seeding — {brandName}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
          <div className="btn-group" role="group" aria-label="Choose month">
            {recentMonths(3).map(m => (
              <Button
                key={m}
                size="sm"
                variant={m === month ? 'primary' : 'outline-secondary'}
                onClick={() => setMonth(m)}
              >
                {new Date(Number(m.split('-')[0]), Number(m.split('-')[1]) - 1, 1)
                  .toLocaleString('en-US', { month: 'short', year: '2-digit' })}
              </Button>
            ))}
          </div>
          <div className="text-muted small">{monthLabel(month)}</div>
        </div>

        {loading ? (
          <div className="text-center py-5"><Spinner animation="border" /></div>
        ) : err ? (
          <Alert variant="danger">{err}</Alert>
        ) : (
          <>
            <Row className="g-2">
              <Col xs={12}>
                <GoalProgressTile approved={totalApproved} goal={goal} pct={goalPct} />
              </Col>
              <Col xs={4}>
                <MiniKpi icon="bi-camera-video" color="#0d6efd" label="New Videos" value={totalNewVideos.toLocaleString()} />
              </Col>
              <Col xs={4}>
                <MiniKpi icon="bi-graph-up" color="#20c997" label="Avg SPS" value={avgSps == null ? '—' : avgSps.toFixed(2)} />
              </Col>
              <Col xs={4}>
                <MiniKpi icon="bi-calendar-check" color="#6610f2" label="Days Entered" value={`${daysWithEntry} / ${daysInMonth(month).length}`} />
              </Col>
            </Row>

            <div className="fw-semibold mt-4 mb-2">Tracked Products</div>
            {products.length === 0 ? (
              <p className="text-muted text-center py-3 mb-0">No products tracked yet.</p>
            ) : (
              <Table size="sm" responsive className="align-middle mb-0">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th>Product</th>
                    <th className="text-end">Goal</th>
                    <th className="text-end">Approved</th>
                    <th style={{ minWidth: 200 }}>Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p, i) => {
                    const approved = perProductTotals[p.id] ?? 0;
                    const pGoal = productGoalFor(p, month) ?? 0;
                    const pct = pGoal > 0 ? Math.min(100, Math.round((approved / pGoal) * 100)) : null;
                    return (
                      <tr key={p.id}>
                        <td className="text-muted small">{i + 1}</td>
                        <td className="fw-semibold">
                          {p.name}
                          {p.external_product_id && (
                            <div className="text-muted small" style={{ fontFamily: 'monospace', fontWeight: 400 }}>
                              {p.external_product_id}
                            </div>
                          )}
                        </td>
                        <td className="text-end">{pGoal > 0 ? pGoal : <span className="text-muted">—</span>}</td>
                        <td className="text-end">{approved}</td>
                        <td>
                          {pct == null
                            ? <span className="text-muted small">No goal</span>
                            : <ProductProgressBar pct={pct} approved={approved} goal={pGoal} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <MoveToButton brandId={brandId} tab="samples" label="Sample Seeding" onClose={onClose} />
      </Modal.Footer>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Products popup — read-only view of the brand's product catalog.
// ---------------------------------------------------------------------------

function ProductsModal({ brandId, brandName, onClose }: { brandId: string; brandName: string; onClose: () => void }) {
  const [products, setProducts] = useState<BrandProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    (async () => {
      const { data, error } = await supabase
        .from('brand_products').select('*').eq('brand_id', brandId).order('name');
      if (!on) return;
      if (error) setErr(error.message);
      else setProducts((data as BrandProduct[]) ?? []);
      setLoading(false);
    })();
    return () => { on = false; };
  }, [brandId]);

  return (
    <Modal show onHide={onClose} centered size="lg" scrollable>
      <Modal.Header closeButton>
        <Modal.Title>
          <i className="bi bi-tags me-2" />
          Products — {brandName}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="p-0">
        {loading ? (
          <div className="text-center py-5"><Spinner animation="border" /></div>
        ) : err ? (
          <div className="p-3"><Alert variant="danger" className="mb-0">{err}</Alert></div>
        ) : products.length === 0 ? (
          <p className="text-muted text-center py-4 mb-0">No products yet for this brand.</p>
        ) : (
          <Table responsive size="sm" className="align-middle mb-0">
            <thead>
              <tr>
                <th>Name</th>
                <th>Product ID</th>
                <th>TikTok link</th>
                <th>Standard %</th>
                <th>Shop ads %</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => (
                <tr key={p.id}>
                  <td className="fw-semibold">{p.name}</td>
                  <td className="text-muted small" style={{ fontFamily: 'monospace' }}>
                    {p.external_product_id || '—'}
                  </td>
                  <td className="small">
                    {p.tiktok_link
                      ? <a href={p.tiktok_link} target="_blank" rel="noreferrer">
                          <i className="bi bi-tiktok me-1" />Open
                        </a>
                      : <span className="text-muted">—</span>}
                  </td>
                  <td className="small">{Number(p.standard_commission ?? 0)}%</td>
                  <td className="small">
                    {p.shop_ads_commission_not_set
                      ? <span className="text-muted">Not set</span>
                      : `${Number(p.shop_ads_commission ?? 0)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Modal.Body>
      <Modal.Footer>
        <MoveToButton brandId={brandId} tab="products" label="Products" onClose={onClose} />
      </Modal.Footer>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// GMV Max popup — read-only view of the brand's GMV Max ad spend for the
// latest 3 months: budget + spend + GMV + ROI KPIs and a weekly breakdown.
// ---------------------------------------------------------------------------

interface GmvWeek {
  week_start: string; week_end: string;
  ad_spend: number; roi: number; orders: number; gmv: number;
}

function GmvModal({ brandId, brandName, onClose }: { brandId: string; brandName: string; onClose: () => void }) {
  const [month, setMonth] = useState(currentMonth());
  const [budget, setBudget] = useState(0);
  const [weeks, setWeeks] = useState<GmvWeek[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    setLoading(true); setErr(null);
    (async () => {
      const { first, last } = monthBounds(month);
      const [mRes, wRes] = await Promise.all([
        supabase.from('brand_gmv_max_monthly')
          .select('allocated_budget').eq('brand_id', brandId).eq('month', month).maybeSingle(),
        supabase.from('brand_gmv_max_weekly')
          .select('week_start, week_end, ad_spend, roi, orders, gmv').eq('brand_id', brandId)
          .lte('week_start', last).gte('week_end', first).order('week_start', { ascending: true }),
      ]);
      if (!on) return;
      const bad = mRes.error ?? wRes.error;
      if (bad) { setErr(bad.message); setLoading(false); return; }
      setBudget((mRes.data as any)?.allocated_budget ?? 0);
      setWeeks((wRes.data ?? []) as GmvWeek[]);
      setLoading(false);
    })();
    return () => { on = false; };
  }, [brandId, month]);

  const totalSpend = useMemo(() => weeks.reduce((s, w) => s + (Number(w.ad_spend) || 0), 0), [weeks]);
  const totalGmv = useMemo(() => weeks.reduce((s, w) => s + (Number(w.gmv) || 0), 0), [weeks]);
  const totalOrders = useMemo(() => weeks.reduce((s, w) => s + (Number(w.orders) || 0), 0), [weeks]);
  const roi = totalSpend > 0 ? totalGmv / totalSpend : 0;
  const budgetPct = budget > 0 ? Math.min(100, Math.round((totalSpend / budget) * 100)) : 0;

  return (
    <Modal show onHide={onClose} centered size="lg" scrollable>
      <Modal.Header closeButton>
        <Modal.Title>
          <i className="bi bi-cash-coin me-2" />
          GMV Max — {brandName}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
          <div className="btn-group" role="group" aria-label="Choose month">
            {recentMonths(3).map(m => (
              <Button
                key={m}
                size="sm"
                variant={m === month ? 'primary' : 'outline-secondary'}
                onClick={() => setMonth(m)}
              >
                {new Date(Number(m.split('-')[0]), Number(m.split('-')[1]) - 1, 1)
                  .toLocaleString('en-US', { month: 'short', year: '2-digit' })}
              </Button>
            ))}
          </div>
          <div className="text-muted small">{monthLabel(month)}</div>
        </div>

        {loading ? (
          <div className="text-center py-5"><Spinner animation="border" /></div>
        ) : err ? (
          <Alert variant="danger">{err}</Alert>
        ) : (
          <>
            <Row className="g-2">
              <Col xs={6} md={3}>
                <MiniKpi icon="bi-wallet2" color="#6610f2" label="Budget" value={budget > 0 ? fmtUsd(budget) : '—'} />
              </Col>
              <Col xs={6} md={3}>
                <MiniKpi icon="bi-cash-coin" color="#0d6efd" label="Ad Spend" value={fmtUsd(totalSpend)} />
              </Col>
              <Col xs={6} md={3}>
                <MiniKpi icon="bi-graph-up-arrow" color="#198754" label="GMV" value={fmtUsd(totalGmv)} />
              </Col>
              <Col xs={6} md={3}>
                <MiniKpi icon="bi-bullseye" color="#e8862e" label="ROI" value={`${roi.toFixed(2)}x`} />
              </Col>
            </Row>

            {budget > 0 && (
              <div className="mt-3">
                <div className="d-flex justify-content-between small text-muted mb-1">
                  <span>Budget used</span>
                  <span>{fmtUsd(totalSpend)} / {fmtUsd(budget)} · {budgetPct}%</span>
                </div>
                <div className="ac-brandbar-track-chat" style={{ width: '100%', height: 8 }}>
                  <div className="ac-brandbar-fill" style={{
                    width: `${budgetPct}%`,
                    background: `linear-gradient(90deg, ${pctColor(budgetPct)} 0%, ${pctColor(budgetPct)}cc 100%)`,
                  }} />
                </div>
              </div>
            )}

            <div className="fw-semibold mt-4 mb-2">Weekly breakdown</div>
            {weeks.length === 0 ? (
              <p className="text-muted text-center py-3 mb-0">No GMV Max weeks for {monthLabel(month)}.</p>
            ) : (
              <Table size="sm" responsive className="align-middle mb-0">
                <thead>
                  <tr>
                    <th>Week</th>
                    <th className="text-end">Ad Spend</th>
                    <th className="text-end">GMV</th>
                    <th className="text-end">ROI</th>
                    <th className="text-end">Orders</th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((w, i) => (
                    <tr key={i}>
                      <td className="fw-semibold">{shortDate(w.week_start)} – {shortDate(w.week_end)}</td>
                      <td className="text-end">{fmtUsd(w.ad_spend)}</td>
                      <td className="text-end">{fmtUsd(w.gmv)}</td>
                      <td className="text-end">{(Number(w.roi) || 0).toFixed(2)}x</td>
                      <td className="text-end">{Number(w.orders) || 0}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="fw-semibold border-top">
                    <td>Total</td>
                    <td className="text-end">{fmtUsd(totalSpend)}</td>
                    <td className="text-end">{fmtUsd(totalGmv)}</td>
                    <td className="text-end">{roi.toFixed(2)}x</td>
                    <td className="text-end">{totalOrders}</td>
                  </tr>
                </tfoot>
              </Table>
            )}
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <MoveToButton brandId={brandId} tab="gmv-max" label="GMV Max" onClose={onClose} />
      </Modal.Footer>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Reports popup — the brand's weekly + monthly reports from the latest 3
// months; clicking one opens the report view.
// ---------------------------------------------------------------------------

interface WeeklyRow { id: string; week_start: string; week_end: string; week_number: number; status: string; }
interface MonthlyRow { id: string; month: string; status: string; }

const shortDate = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function ReportsModal({ brandId, brandName, onClose }: { brandId: string; brandName: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [weekly, setWeekly] = useState<WeeklyRow[]>([]);
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    (async () => {
      const windowMonth = recentMonths(3)[0];      // oldest of the latest 3 months
      const [wRes, mRes] = await Promise.all([
        supabase.from('weekly_reports')
          .select('id, week_start, week_end, week_number, status')
          .eq('brand_id', brandId).gte('week_start', `${windowMonth}-01`)
          .order('week_start', { ascending: false }),
        supabase.from('monthly_reports')
          .select('id, month, status')
          .eq('brand_id', brandId).gte('month', windowMonth)
          .order('month', { ascending: false }),
      ]);
      if (!on) return;
      const bad = wRes.error ?? mRes.error;
      if (bad) { setErr(bad.message); setLoading(false); return; }
      setWeekly((wRes.data ?? []) as WeeklyRow[]);
      setMonthly((mRes.data ?? []) as MonthlyRow[]);
      setLoading(false);
    })();
    return () => { on = false; };
  }, [brandId]);

  const statusBadge = (status: string) => (
    <Badge bg={status === 'submitted' ? 'success' : 'secondary'} className="text-uppercase" style={{ fontSize: '0.65rem' }}>
      {status}
    </Badge>
  );

  const openReport = (kind: 'weekly' | 'monthly', id: string) => {
    onClose();
    navigate(`/reporting/${kind}/${id}`);
  };

  return (
    <Modal show onHide={onClose} centered scrollable>
      <Modal.Header closeButton>
        <Modal.Title>
          <i className="bi bi-file-earmark-bar-graph me-2" />
          Recent Reports — {brandName}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {loading ? (
          <div className="text-center py-5"><Spinner animation="border" /></div>
        ) : err ? (
          <Alert variant="danger" className="mb-0">{err}</Alert>
        ) : weekly.length === 0 && monthly.length === 0 ? (
          <p className="text-muted text-center py-4 mb-0">
            No reports for this brand in the last 3 months.
          </p>
        ) : (
          <>
            <div className="fw-semibold small text-muted text-uppercase mb-2" style={{ letterSpacing: '.4px' }}>
              Weekly
            </div>
            {weekly.length === 0 ? (
              <p className="text-muted small mb-3">No weekly reports in the last 3 months.</p>
            ) : (
              <div className="list-group mb-3">
                {weekly.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    className="list-group-item list-group-item-action d-flex align-items-center justify-content-between gap-2"
                    onClick={() => openReport('weekly', r.id)}
                  >
                    <span>
                      <i className="bi bi-calendar-week me-2 text-muted" />
                      Week {r.week_number}
                      <span className="text-muted ms-2 small">{shortDate(r.week_start)} – {shortDate(r.week_end)}</span>
                    </span>
                    {statusBadge(r.status)}
                  </button>
                ))}
              </div>
            )}

            <div className="fw-semibold small text-muted text-uppercase mb-2" style={{ letterSpacing: '.4px' }}>
              Monthly
            </div>
            {monthly.length === 0 ? (
              <p className="text-muted small mb-0">No monthly reports in the last 3 months.</p>
            ) : (
              <div className="list-group">
                {monthly.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    className="list-group-item list-group-item-action d-flex align-items-center justify-content-between gap-2"
                    onClick={() => openReport('monthly', r.id)}
                  >
                    <span>
                      <i className="bi bi-calendar-month me-2 text-muted" />
                      {monthLabel(r.month)}
                    </span>
                    {statusBadge(r.status)}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <MoveToButton brandId={brandId} tab="reporting" label="Reporting" onClose={onClose} />
      </Modal.Footer>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Tasks popup — brand-scoped tasks from the shared `tasks` table, so they stay
// two-way in sync with the /tasks page. Lists the brand's tasks and lets the
// user create/assign one to a role-appropriate (RLS-safe) person.
// ---------------------------------------------------------------------------

type TaskStatus = 'open' | 'in_progress' | 'in_review' | 'done';
type TaskPriority = 'low' | 'mid' | 'high';
interface BrandTask {
  id: string; created_by: string | null; assignee_id: string;
  title: string; description: string | null; status: TaskStatus;
  priority: TaskPriority; due_date: string | null; created_at: string;
}
interface PersonLite { id: string; full_name: string | null; email: string; avatar_url?: string | null; }

const TASK_STATUS_META: Record<TaskStatus, { label: string; icon: string; bg: string; fg: string }> = {
  open:        { label: 'Not started', icon: 'bi-circle',          bg: '#eef0f4', fg: '#5b6270' },
  in_progress: { label: 'In progress', icon: 'bi-hourglass-split', bg: '#fff3d6', fg: '#a16207' },
  in_review:   { label: 'In review',   icon: 'bi-send-check',      bg: '#ede9fe', fg: '#6d28d9' },
  done:        { label: 'Completed',   icon: 'bi-check2-circle',   bg: '#dcfce7', fg: '#15803d' },
};
const TASK_PRIO_COLOR: Record<TaskPriority, string> = { high: '#dc3545', mid: '#e8862e', low: '#0d6efd' };
const personName = (p?: PersonLite) => (p ? (p.full_name || p.email) : 'Unknown');

function TasksModal({ brandId, brandName, onClose, onChanged }: {
  brandId: string; brandName: string; onClose: () => void; onChanged: () => void;
}) {
  const { profile, user } = useAuth();
  const navigate = useNavigate();
  const myId = user?.id ?? '';
  const role = profile?.role ?? '';
  const isBob = role === 'bob';
  const isSuperBob = isBob && !!profile?.is_superbob;
  const isTeamLead = role === 'team_lead';
  const isApcLike = role === 'apc' || role === 'ads_manager';

  const [tasks, setTasks] = useState<BrandTask[]>([]);
  const [people, setPeople] = useState<Map<string, PersonLite>>(new Map());
  const [assignees, setAssignees] = useState<PersonLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [assignee, setAssignee] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('mid');
  const [due, setDue] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true); setErr(null);
    const tRes = await supabase.from('tasks')
      .select('id, created_by, assignee_id, title, description, status, priority, due_date, created_at')
      .eq('brand_id', brandId)
      .order('status').order('created_at', { ascending: false });
    if (tRes.error) { setErr(tRes.error.message); setLoading(false); return; }
    const ts = (tRes.data as BrandTask[]) ?? [];
    setTasks(ts);

    // Assignable people, per role — only the caller's RLS-allowed insert targets:
    //  • Bob        → the brand's APC + Team Lead + every Bob (incl. self)
    //  • Team Lead  → the brand's APC (an APC they own)
    //  • APC / Ads  → upward: their Team Lead + every Bob
    const brandApc = (isBob || isTeamLead)
      ? (await supabase.from('apc_brands').select('apc_id').eq('brand_id', brandId).maybeSingle()).data?.apc_id ?? null
      : null;
    const brandTl = isBob
      ? (await supabase.from('team_lead_brands').select('team_lead_id').eq('brand_id', brandId).maybeSingle()).data?.team_lead_id ?? null
      : (isApcLike ? (profile?.team_lead_id ?? null) : null);
    const wantBobs = isBob || isApcLike;
    const bobRows = wantBobs
      ? ((await supabase.from('profiles').select('id,full_name,email,avatar_url').eq('role', 'bob').order('full_name')).data as PersonLite[] ?? [])
      : [];

    const extraIds = [brandApc, brandTl].filter(Boolean) as string[];
    const extraRows = extraIds.length
      ? ((await supabase.from('profiles').select('id,full_name,email,avatar_url').in('id', extraIds)).data as PersonLite[] ?? [])
      : [];
    const byId = new Map<string, PersonLite>();
    extraRows.forEach(p => byId.set(p.id, p));
    bobRows.forEach(p => byId.set(p.id, p));

    const list: PersonLite[] = [];
    const push = (id: string | null) => { if (id && byId.has(id)) list.push(byId.get(id)!); };
    if (isBob) { push(brandApc); push(brandTl); bobRows.forEach(b => list.push(b)); }
    else if (isTeamLead) { push(brandApc); }
    else if (isApcLike) { push(brandTl); bobRows.forEach(b => list.push(b)); }
    const seen = new Set<string>();
    const uniq = list.filter(p => (seen.has(p.id) ? false : (seen.add(p.id), true)));
    setAssignees(uniq);
    setAssignee(prev => prev || (uniq[0]?.id ?? ''));

    const nameMap = new Map<string, PersonLite>(uniq.map(p => [p.id, p]));
    const nameIds = Array.from(new Set(ts.flatMap(t => [t.assignee_id, t.created_by]).filter(Boolean) as string[]));
    const missing = nameIds.filter(id => !nameMap.has(id));
    if (missing.length) {
      const { data } = await supabase.from('profiles').select('id,full_name,email,avatar_url').in('id', missing);
      (data as PersonLite[] ?? []).forEach(p => nameMap.set(p.id, p));
    }
    setPeople(nameMap);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [brandId]);

  const createTask = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !assignee) return;
    setSaving(true); setErr(null);
    const { error } = await supabase.from('tasks').insert({
      created_by: myId, assignee_id: assignee, brand_id: brandId,
      title: title.trim(), description: desc.trim() || null,
      priority, due_date: due || null,
    });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setTitle(''); setDesc(''); setDue(''); setPriority('mid');
    onChanged();
    load();
  };

  // The app-wide rule: only the assignee changes a task's status — and tasks
  // assigned by someone else end at "Submit for review" (only the assigner
  // completes them via Accept). Exceptions: a Bob assignee completes directly
  // (no upward review for the boss; Super Boss = full control), and
  // self-created tasks keep the direct done step.
  const cycleStatus = async (t: BrandTask) => {
    const order: TaskStatus[] =
      (isBob || !(t.created_by && t.created_by !== t.assignee_id))
        ? ['open', 'in_progress', 'done']
        : ['open', 'in_progress', 'in_review'];
    const next = order[(order.indexOf(t.status) + 1) % order.length];
    const completed_at = next === 'done' ? new Date().toISOString() : null;
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, status: next } : x));
    const { error } = await supabase.from('tasks').update({ status: next, completed_at }).eq('id', t.id);
    if (error) { setErr(error.message); load(); } else onChanged();
  };

  // Assigner's decision on an in-review task (mirrors the Tasks page).
  const decideReview = async (t: BrandTask, accept: boolean) => {
    let review_note: string | null = null;
    if (!accept) {
      const note = prompt('Optional note for the assignee (why is it going back?):');
      if (note === null) return;
      review_note = note.trim() || null;
    }
    const status: TaskStatus = accept ? 'done' : 'in_progress';
    const completed_at = accept ? new Date().toISOString() : null;
    setTasks(prev => prev.map(x => x.id === t.id ? { ...x, status } : x));
    const { error } = await supabase.from('tasks')
      .update({ status, completed_at, review_note }).eq('id', t.id);
    if (error) { setErr(error.message); load(); } else onChanged();
  };

  const openList = tasks.filter(t => t.status !== 'done');
  const doneList = tasks.filter(t => t.status === 'done');

  return (
    <Modal show onHide={onClose} centered size="lg" scrollable>
      <Modal.Header closeButton>
        <Modal.Title><i className="bi bi-check2-square me-2" />Tasks — {brandName}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {assignees.length > 0 ? (
          <Form onSubmit={createTask} className="ac-bt-form mb-3">
            <Form.Control
              className="mb-2" placeholder="New task title…"
              value={title} onChange={e => setTitle(e.target.value)} />
            <Form.Control
              className="mb-2" as="textarea" rows={2} placeholder="Details (optional)…"
              value={desc} onChange={e => setDesc(e.target.value)} />
            <Row className="g-2">
              <Col xs={12} md={4}>
                <Form.Select value={assignee} onChange={e => setAssignee(e.target.value)} aria-label="Assign to">
                  {assignees.map(p => (
                    <option key={p.id} value={p.id}>{personName(p)}{p.id === myId ? ' (me)' : ''}</option>
                  ))}
                </Form.Select>
              </Col>
              <Col xs={6} md={3}>
                <Form.Select value={priority} onChange={e => setPriority(e.target.value as TaskPriority)} aria-label="Priority">
                  <option value="high">High priority</option>
                  <option value="mid">Medium priority</option>
                  <option value="low">Low priority</option>
                </Form.Select>
              </Col>
              <Col xs={6} md={3}>
                <Form.Control type="date" value={due} onChange={e => setDue(e.target.value)} aria-label="Due date" />
              </Col>
              <Col xs={12} md={2} className="d-grid">
                <Button type="submit" disabled={!title.trim() || saving}>{saving ? '…' : 'Add'}</Button>
              </Col>
            </Row>
          </Form>
        ) : (
          <Alert variant="light" className="border small mb-3 py-2">
            No assignable people for this brand from here.
          </Alert>
        )}

        {err && <Alert variant="danger" className="py-2">{err}</Alert>}

        {loading ? (
          <div className="text-center py-4"><Spinner animation="border" /></div>
        ) : tasks.length === 0 ? (
          <p className="text-muted text-center py-3 mb-0">No tasks for this brand yet.</p>
        ) : (
          <>
            {openList.map(t => (
              <TaskRow key={t.id} t={t} people={people} canSet={t.assignee_id === myId || isSuperBob}
                canReview={t.status === 'in_review' && (t.created_by === myId || isBob)}
                onCycle={() => cycleStatus(t)} onDecide={a => decideReview(t, a)} />
            ))}
            {doneList.length > 0 && (
              <>
                <div className="text-muted small text-uppercase mt-3 mb-2" style={{ letterSpacing: '.4px' }}>Completed</div>
                {doneList.map(t => (
                  <TaskRow key={t.id} t={t} people={people} canSet={t.assignee_id === myId || isSuperBob}
                    canReview={false}
                    onCycle={() => cycleStatus(t)} onDecide={a => decideReview(t, a)} />
                ))}
              </>
            )}
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onClose}>Close</Button>
        <Button variant="primary" onClick={() => { onClose(); navigate('/tasks'); }}>
          Open Tasks page <i className="bi bi-arrow-right ms-1" />
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

function TaskRow({ t, people, canSet, canReview, onCycle, onDecide }: {
  t: BrandTask; people: Map<string, PersonLite>; canSet: boolean; canReview: boolean;
  onCycle: () => void; onDecide: (accept: boolean) => void;
}) {
  const sm = TASK_STATUS_META[t.status];
  const dueLabel = t.due_date
    ? new Date(t.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : null;
  return (
    <div className="ac-bt-row" style={{ borderLeft: `3px solid ${TASK_PRIO_COLOR[t.priority]}` }}>
      <div className="flex-grow-1" style={{ minWidth: 0 }}>
        <div className="fw-semibold">{t.title}</div>
        {t.description && <div className="text-muted small">{t.description}</div>}
        <div className="text-muted small d-flex gap-3 flex-wrap mt-1">
          <span><i className="bi bi-person me-1" />{personName(people.get(t.assignee_id))}</span>
          {dueLabel && <span><i className="bi bi-calendar3 me-1" />{dueLabel}</span>}
        </div>
      </div>
      {canReview && (
        <div className="ac-review-actions">
          <button type="button" className="ac-review-btn accept" title="Accept — mark completed" onClick={() => onDecide(true)}>
            <i className="bi bi-check-lg" />Accept
          </button>
          <button type="button" className="ac-review-btn reject" title="Send back to the assignee" onClick={() => onDecide(false)}>
            <i className="bi bi-arrow-counterclockwise" />Reject
          </button>
        </div>
      )}
      <button
        type="button"
        className="ac-bt-status"
        disabled={!canSet}
        title={canSet
          ? (t.status === 'in_progress' && t.created_by && t.created_by !== t.assignee_id
              ? 'Click to submit for review' : 'Click to change status')
          : sm.label}
        style={{ background: sm.bg, color: sm.fg, cursor: canSet ? 'pointer' : 'default' }}
        onClick={canSet ? onCycle : undefined}
      >
        <i className={`bi ${sm.icon} me-1`} />{sm.label}
      </button>
    </div>
  );
}
