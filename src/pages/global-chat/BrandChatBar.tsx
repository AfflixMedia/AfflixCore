// Brand-group chat extras: a slim strip under the chat header showing the
// brand's current-month sample-seeding progress, plus quick popups for
// Samples (read-only Samples-tab summary, latest 3 months), the brand's
// Products catalog, and the latest 3 months of weekly/monthly reports
// (click-through to the report). Staff-only (bob / team_lead / apc) —
// internal paid-collab handlers in the group have no RLS access to these
// tables, so the strip self-hides for them.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, Button, Table, Spinner, Alert, Badge, Row, Col } from 'react-bootstrap';
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

// Circular progress ring with the percentage in the centre.
function CircularProgress({ pct, color, label, size = 40, stroke = 4 }: {
  pct: number; color: string; label?: string; size?: number; stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (Math.max(0, Math.min(100, pct)) / 100) * circ;
  const mid = size / 2;
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
        style={{ fontSize: size * 0.3, fontWeight: 700, fill: color }}>
        {label ?? pct}
      </text>
    </svg>
  );
}

const approvedOf = (rows: Pick<DailyEntry, 'product_counts' | 'others_count'>[]) =>
  rows.reduce((s, d) => s + sumValues(d.product_counts ?? {}) + (d.others_count ?? 0), 0);

type BarModal = 'samples' | 'products' | 'reports' | 'gmv' | null;

export default function BrandChatBar({ brandId, brandName }: { brandId: string; brandName: string }) {
  const { profile } = useAuth();
  const [modal, setModal] = useState<BarModal>(null);
  const [summary, setSummary] = useState<{ approved: number; goal: number } | null>(null);
  const [gmv, setGmv] = useState<{ adSpend: number; budget: number } | null>(null);

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
