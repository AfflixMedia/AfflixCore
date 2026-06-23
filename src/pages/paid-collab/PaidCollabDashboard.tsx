import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, Spinner, Alert, Row, Col, Button, Badge } from 'react-bootstrap';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, Legend, LabelList,
} from 'recharts';
import { useAuth } from '../../auth/AuthContext';
import {
  programDisplayName, fmtMoney, fmtNumber,
  PaidProgram, PaidCreator, PaidVideo, PaidCreatorPerformance
} from '../../lib/paidCollabSchema';
import { useClientPaidCollabData, Brand, isPaidCollabPendingVisible } from './useClientPaidCollabData';
import Avatar from '../../components/Avatar';
import ProgramProgress from '../../components/paidcollab/ProgramProgress';
import './dashboard.css';

export default function PaidCollabDashboard() {
  const { profile } = useAuth();
  const nav = useNavigate();
  // Client only sees a creator's "Payment Pending" once the handler toggles it visible;
  // the handler (if ever on this view) sees all pending. Mirrors the Brands/Programs pages.
  const revealPending = profile?.role === 'paid_collab_handler';

  const { brands, programs, creators, videos, performance, loading, err } = useClientPaidCollabData();

  const brandById = useMemo(() => {
    const m = new Map<string, Brand>();
    for (const b of brands) m.set(b.id, b);
    return m;
  }, [brands]);
  const programById = useMemo(() => {
    const m = new Map<string, PaidProgram>();
    for (const p of programs) m.set(p.id, p);
    return m;
  }, [programs]);
  const creatorById = useMemo(() => {
    const m = new Map<string, PaidCreator>();
    for (const c of creators) m.set(c.id, c);
    return m;
  }, [creators]);
  // Every video counts as live.
  const liveByCreator = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of videos) {
      m.set(v.creator_id, (m.get(v.creator_id) ?? 0) + 1);
    }
    return m;
  }, [videos]);
  // Pipeline per creator = agreed videos not yet delivered.
  const pipelineByCreator = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of creators) {
      if (c.status === 'dropped') continue;
      m.set(c.id, Math.max(0, (c.agreed_videos || 0) - (liveByCreator.get(c.id) ?? 0)));
    }
    return m;
  }, [creators, liveByCreator]);
  // GMV per creator = sum of WEEKLY performance entries (monthly excluded).
  const gmvByCreator = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of performance) {
      if (p.period_type !== 'weekly') continue;
      m.set(p.creator_id, (m.get(p.creator_id) ?? 0) + Number(p.gmv || 0));
    }
    return m;
  }, [performance]);

  const kpis = useMemo(() => {
    const activePrograms = programs.filter(p => !p.ended_at).length;
    const endedPrograms = programs.length - activePrograms;
    const live = videos.length;
    const pipeline = [...pipelineByCreator.values()].reduce((s, n) => s + n, 0);
    const totalGmv = [...gmvByCreator.values()].reduce((s, v) => s + v, 0);
    const spent = creators.reduce((s, c) => s + Number(c.fee || 0), 0);
    const paymentPending = creators.filter(c =>
      isPaidCollabPendingVisible(c, revealPending)).length;
    return {
      brands: brands.length,
      activePrograms,
      endedPrograms,
      creators: creators.length,
      live,
      pipeline,
      totalGmv,
      spent,
      paymentPending,
    };
  }, [brands, programs, creators, videos, liveByCreator, pipelineByCreator, gmvByCreator, revealPending]);

  // Currency assumption: use first program's currency, default USD.
  const currency = useMemo(
    () => programs.find(p => p.currency)?.currency || 'USD',
    [programs],
  );

  // Weekly trend of videos posted (last 12 weeks)
  const weeklyData = useMemo(() => {
    const now = new Date();
    const weeks: { label: string; weekStart: Date; live: number; added: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const start = new Date(now);
      start.setDate(start.getDate() - i * 7);
      start.setHours(0, 0, 0, 0);
      weeks.push({
        label: start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        weekStart: start,
        live: 0,
        added: 0,
      });
    }
    for (const v of videos) {
      if (v.posted_on && v.status === 'live') {
        const posted = new Date(v.posted_on + 'T00:00:00');
        for (let i = weeks.length - 1; i >= 0; i--) {
          const wEnd = new Date(weeks[i].weekStart);
          wEnd.setDate(wEnd.getDate() + 7);
          if (posted >= weeks[i].weekStart && posted < wEnd) {
            weeks[i].live += 1;
            break;
          }
        }
      }
      const created = new Date(v.created_at);
      for (let i = weeks.length - 1; i >= 0; i--) {
        const wEnd = new Date(weeks[i].weekStart);
        wEnd.setDate(wEnd.getDate() + 7);
        if (created >= weeks[i].weekStart && created < wEnd) {
          weeks[i].added += 1;
          break;
        }
      }
    }
    return weeks;
  }, [videos]);

  // Top brands by GMV
  const topBrandsData = useMemo(() => {
    const byBrand = new Map<string, { brand: Brand; gmv: number; live: number; pipeline: number; creators: number }>();
    for (const b of brands) {
      byBrand.set(b.id, { brand: b, gmv: 0, live: 0, pipeline: 0, creators: 0 });
    }
    for (const c of creators) {
      const prog = programById.get(c.program_id);
      if (!prog) continue;
      const entry = byBrand.get(prog.brand_id);
      if (!entry) continue;
      entry.gmv += gmvByCreator.get(c.id) ?? 0;
      entry.creators += 1;
      entry.live += liveByCreator.get(c.id) ?? 0;
      entry.pipeline += pipelineByCreator.get(c.id) ?? 0;
    }
    return [...byBrand.values()]
      .filter(b => b.creators > 0 || b.gmv > 0)
      .sort((a, b) => b.gmv - a.gmv)
      .slice(0, 8);
  }, [brands, creators, videos, programById, liveByCreator, pipelineByCreator, gmvByCreator]);

  // Pipeline vs live per top-5 brands (chart data)
  const pipelineLiveByBrand = useMemo(() =>
    topBrandsData.slice(0, 5).map(b => ({
      name: b.brand.name.length > 16 ? b.brand.name.slice(0, 16) + '…' : b.brand.name,
      Pipeline: b.pipeline,
      Live: b.live,
    })),
  [topBrandsData]);

  // Recent activity: last 5 creators + last 5 videos
  const recentCreators = useMemo(() =>
    [...creators]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 5),
    [creators],
  );
  const recentLiveVideos = useMemo(() =>
    videos
      .filter(v => v.status === 'live' && v.posted_on)
      .sort((a, b) => (b.posted_on ?? '').localeCompare(a.posted_on ?? ''))
      .slice(0, 5),
    [videos],
  );

  // Payment pending creators (for the call-to-action panel)
  const pendingCreators = useMemo(() =>
    creators
      .filter(c => isPaidCollabPendingVisible(c, revealPending))
      .slice(0, 6),
    [creators, revealPending],
  );

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const firstName = useMemo(() => {
    const n = profile?.full_name || profile?.email || '';
    return n.split(' ')[0]?.split('@')[0] || 'there';
  }, [profile]);

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;

  return (
    <div className="pcd">
      {/* Hero header */}
      <div className="pcd-hero">
        <div className="pcd-hero-inner">
          <div>
            <div className="pcd-hero-date">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div>
            <h2 className="pcd-hero-title">{greeting}, {firstName}</h2>
            <div className="pcd-hero-sub">Here's what's happening across your {kpis.brands} brand{kpis.brands === 1 ? '' : 's'}.</div>
          </div>
          {kpis.paymentPending > 0 && (
            <div className="pcd-hero-cta">
              <span className="pcd-hero-cta-ico"><i className="bi bi-cash-stack" /></span>
              <div>
                <div className="pcd-hero-cta-big">{kpis.paymentPending} payment{kpis.paymentPending === 1 ? '' : 's'} pending</div>
                <div className="pcd-hero-cta-small">Action needed</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* KPI tiles */}
      <div className="pcd-kpis">
        <KpiCard icon="bi-shop"            color="#0d6efd" label="Brands"          value={fmtNumber(kpis.brands)} />
        <KpiCard icon="bi-rocket-takeoff"  color="#e8862e" label="Active programs" value={fmtNumber(kpis.activePrograms)} sub={`${kpis.endedPrograms} ended`} />
        <KpiCard icon="bi-people-fill"     color="#6610f2" label="Creators"        value={fmtNumber(kpis.creators)} />
        <KpiCard icon="bi-broadcast"       color="#198754" label="Live videos"     value={fmtNumber(kpis.live)} sub={`${kpis.pipeline} in pipeline`} />
        <KpiCard icon="bi-cash-coin"       color="#20c997" label="Total GMV"       value={fmtMoney(kpis.totalGmv, currency)} />
        <KpiCard icon="bi-cash-stack"      color="#fd7e14" label="Spent on fees"   value={fmtMoney(kpis.spent, currency)} />
      </div>

      {/* Payment-pending panel + recent activity */}
      <Row className="g-3 mb-4">
        {kpis.paymentPending > 0 ? (
          <Col lg={6}>
            <Card className="h-100 shadow-sm ac-payment-pending-card">
              <Card.Body>
                <div className="d-flex justify-content-between align-items-start mb-2">
                  <div>
                    <div className="text-muted small text-uppercase" style={{ letterSpacing: '.5px', fontSize: '.7rem' }}>
                      Needs your attention
                    </div>
                    <h5 className="mb-0 d-flex align-items-center gap-2">
                      <span className="ac-payment-pending-badge d-inline-flex align-items-center justify-content-center rounded-circle text-white"
                            style={{ width: 32, height: 32, backgroundColor: '#e8862e' }}>
                        <i className="bi bi-cash-stack" />
                      </span>
                      Payments pending
                    </h5>
                  </div>
                  <Badge bg="" style={{ backgroundColor: '#e8862e' }}>{kpis.paymentPending}</Badge>
                </div>
                <div className="text-muted small mb-3">
                  These creators have delivered all agreed videos but haven't been marked as paid yet.
                </div>
                <div className="d-flex flex-column gap-2">
                  {pendingCreators.map(c => {
                    const prog = programById.get(c.program_id);
                    const b = prog ? brandById.get(prog.brand_id) : null;
                    const live = liveByCreator.get(c.id) ?? 0;
                    return (
                      <div key={c.id} className="d-flex gap-2 align-items-center p-2 rounded border"
                           role="button" onClick={() => prog && nav(`/paid-collab/programs/${prog.id}`)}
                           style={{ cursor: 'pointer', backgroundColor: '#fff' }}>
                        <Avatar name={c.name} size="md" />
                        <div className="flex-grow-1 min-w-0">
                          <div className="fw-semibold text-truncate">{c.name}</div>
                          <div className="text-muted small text-truncate">
                            {b?.name ?? '—'} · {prog ? programDisplayName(prog) : '—'}
                          </div>
                        </div>
                        <Badge bg="success">{live}/{c.agreed_videos}</Badge>
                      </div>
                    );
                  })}
                </div>
                <Button as={Link as any} to="/paid-collab/creators?payment=pending" variant="link" className="ps-0 mt-2">
                  View all payment-pending creators <i className="bi bi-arrow-right ms-1" />
                </Button>
              </Card.Body>
            </Card>
          </Col>
        ) : (
          <Col lg={6}>
            <Card className="h-100 shadow-sm">
              <Card.Body className="d-flex flex-column justify-content-center align-items-center text-center py-5">
                <div className="rounded-circle d-flex align-items-center justify-content-center mb-3"
                     style={{ width: 64, height: 64, background: 'rgba(25, 135, 84, 0.1)' }}>
                  <i className="bi bi-check2-circle text-success" style={{ fontSize: '2rem' }} />
                </div>
                <h5 className="mb-1">All caught up</h5>
                <p className="text-muted mb-0 small">No payments are pending right now.</p>
              </Card.Body>
            </Card>
          </Col>
        )}

        {/* Recent activity */}
        <Col lg={6}>
          <Card className="h-100 shadow-sm">
            <Card.Body>
              <div className="text-muted small text-uppercase mb-2" style={{ letterSpacing: '.5px', fontSize: '.7rem' }}>
                Recently posted (live)
              </div>
              {recentLiveVideos.length === 0 ? (
                <div className="text-center text-muted py-4 small">
                  <i className="bi bi-collection-play fs-1 d-block mb-2 opacity-50" />
                  No live videos yet.
                </div>
              ) : (
                <div className="d-flex flex-column gap-2">
                  {recentLiveVideos.map(v => {
                    const cr = creatorById.get(v.creator_id);
                    const prog = cr ? programById.get(cr.program_id) : null;
                    const b = prog ? brandById.get(prog.brand_id) : null;
                    return (
                      <div key={v.id} className="d-flex gap-2 align-items-center p-2 rounded border"
                           role="button" onClick={() => prog && nav(`/paid-collab/programs/${prog.id}`)}
                           style={{ cursor: 'pointer' }}>
                        <div className="d-flex align-items-center justify-content-center rounded text-white flex-shrink-0"
                             style={{ width: 36, height: 36, backgroundColor: '#198754' }}>
                          <i className="bi bi-broadcast" />
                        </div>
                        <div className="flex-grow-1 min-w-0">
                          <div className="fw-semibold text-truncate">
                            {cr?.name ?? '—'}
                            <span className="text-muted ms-2 small">— {b?.name ?? '—'}</span>
                          </div>
                          <div className="text-muted small text-truncate">
                            {v.tiktok_url
                              ? <><i className="bi bi-tiktok me-1" />{v.tiktok_url}</>
                              : <span className="fst-italic">No URL</span>}
                          </div>
                        </div>
                        <Badge bg="light" text="dark" className="border">
                          {v.posted_on && new Date(v.posted_on + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
              <Button as={Link as any} to="/paid-collab/videos" variant="link" className="ps-0 mt-2">
                View all videos <i className="bi bi-arrow-right ms-1" />
              </Button>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Charts row */}
      <Row className="g-3 mb-4">
        <Col lg={7}>
          <Card className="h-100 shadow-sm">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-baseline mb-2">
                <h6 className="mb-0">Activity — last 12 weeks</h6>
                <span className="text-muted small">Videos added & gone live per week</span>
              </div>
              <div style={{ height: 280 }}>
                <ResponsiveContainer>
                  <AreaChart data={weeklyData} margin={{ top: 10, right: 20, left: -8, bottom: 0 }}>
                    <defs>
                      <linearGradient id="addedGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"  stopColor="#e8862e" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#e8862e" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="liveGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%"  stopColor="#198754" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#198754" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" vertical={false} />
                    <XAxis dataKey="label" stroke="#6c757d" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="#6c757d" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e9ecef' }} />
                    <Legend />
                    <Area type="monotone" dataKey="added" name="Added" stroke="#e8862e" strokeWidth={2.5}
                      fill="url(#addedGrad)" dot={{ r: 2, fill: '#e8862e' }} />
                    <Area type="monotone" dataKey="live"  name="Went live" stroke="#198754" strokeWidth={2.5}
                      fill="url(#liveGrad)" dot={{ r: 2, fill: '#198754' }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card.Body>
          </Card>
        </Col>
        <Col lg={5}>
          <Card className="h-100 shadow-sm">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-baseline mb-2">
                <h6 className="mb-0">Top 5 brands — pipeline vs live</h6>
              </div>
              {pipelineLiveByBrand.length === 0 ? (
                <div className="text-center text-muted py-5">
                  <i className="bi bi-bar-chart-fill fs-1 d-block mb-2 opacity-50" />
                  Add creators and videos to see brand activity.
                </div>
              ) : (
                <div style={{ height: 280 }}>
                  <ResponsiveContainer>
                    <BarChart data={pipelineLiveByBrand} margin={{ top: 20, right: 20, left: -8, bottom: 0 }}>
                      <defs>
                        <linearGradient id="pipelineGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"  stopColor="#fd7e14" stopOpacity={1} />
                          <stop offset="100%" stopColor="#f5a960" stopOpacity={0.7} />
                        </linearGradient>
                        <linearGradient id="liveBarGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"  stopColor="#198754" stopOpacity={1} />
                          <stop offset="100%" stopColor="#60c98b" stopOpacity={0.7} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" vertical={false} />
                      <XAxis dataKey="name" stroke="#6c757d" fontSize={11} tickLine={false} axisLine={false} angle={-15} textAnchor="end" height={60} />
                      <YAxis stroke="#6c757d" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e9ecef' }} />
                      <Legend />
                      <Bar dataKey="Pipeline" fill="url(#pipelineGrad)" radius={[6, 6, 0, 0]} barSize={22}>
                        <LabelList dataKey="Pipeline" position="top" fill="#2c2c2c" fontSize={10} fontWeight={600} />
                      </Bar>
                      <Bar dataKey="Live" fill="url(#liveBarGrad)" radius={[6, 6, 0, 0]} barSize={22}>
                        <LabelList dataKey="Live" position="top" fill="#2c2c2c" fontSize={10} fontWeight={600} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Program performance — videos + weekly/monthly GMV */}
      {creators.length > 0 && (
        <div className="mb-4">
          <ProgramProgress creators={creators} videos={videos} currency={currency} />
        </div>
      )}

      {/* Top brands + recent creators */}
      <Row className="g-3 mb-4">
        <Col lg={7}>
          <Card className="shadow-sm h-100">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-baseline mb-3">
                <h6 className="mb-0">Top brands by GMV</h6>
                <Link to="/paid-collab/brands" className="small">View all brands <i className="bi bi-arrow-right ms-1" /></Link>
              </div>
              {topBrandsData.length === 0 ? (
                <div className="text-center text-muted py-4 small">
                  No brand activity yet.
                </div>
              ) : (
                <Row className="g-2">
                  {topBrandsData.map((tb, idx) => (
                    <Col md={6} key={tb.brand.id}>
                      <div className="d-flex gap-2 align-items-center p-2 rounded border h-100"
                           role="button"
                           onClick={() => nav(`/paid-collab/brands/${tb.brand.id}`)}
                           style={{ cursor: 'pointer' }}>
                        <div className="d-flex align-items-center justify-content-center rounded-circle fw-bold text-white flex-shrink-0"
                             style={{ width: 32, height: 32, backgroundColor: idx === 0 ? '#e8862e' : idx < 3 ? '#0d6efd' : '#6c757d' }}>
                          {idx + 1}
                        </div>
                        <div className="flex-grow-1 min-w-0">
                          <div className="fw-semibold text-truncate">{tb.brand.name}</div>
                          <div className="text-muted small d-flex gap-2 flex-wrap">
                            <span>{tb.creators} creator{tb.creators === 1 ? '' : 's'}</span>
                            <span>·</span>
                            <span>{tb.live} live</span>
                          </div>
                        </div>
                        <div className="text-end">
                          <div className="fw-bold" style={{ color: '#198754' }}>{fmtMoney(tb.gmv, currency)}</div>
                        </div>
                      </div>
                    </Col>
                  ))}
                </Row>
              )}
            </Card.Body>
          </Card>
        </Col>
        <Col lg={5}>
          <Card className="shadow-sm h-100">
            <Card.Body>
              <div className="d-flex justify-content-between align-items-baseline mb-3">
                <h6 className="mb-0">Recently added creators</h6>
                <Link to="/paid-collab/creators" className="small">View all <i className="bi bi-arrow-right ms-1" /></Link>
              </div>
              {recentCreators.length === 0 ? (
                <div className="text-center text-muted py-4 small">
                  <i className="bi bi-people fs-1 d-block mb-2 opacity-50" />
                  No creators yet.
                </div>
              ) : (
                <div className="d-flex flex-column gap-2">
                  {recentCreators.map(c => {
                    const prog = programById.get(c.program_id);
                    const b = prog ? brandById.get(prog.brand_id) : null;
                    return (
                      <div key={c.id} className="d-flex gap-2 align-items-center p-2 rounded border"
                           role="button" onClick={() => prog && nav(`/paid-collab/programs/${prog.id}`)}
                           style={{ cursor: 'pointer' }}>
                        <Avatar name={c.name} size="md" />
                        <div className="flex-grow-1 min-w-0">
                          <div className="fw-semibold text-truncate">{c.name}</div>
                          <div className="text-muted small text-truncate">
                            {b?.name ?? '—'} · {prog ? programDisplayName(prog) : '—'}
                          </div>
                        </div>
                        <Badge bg="light" text="dark" className="border">
                          {new Date(c.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Quick-jump tiles */}
      <div className="pcd-jumps">
        <QuickJump to="/paid-collab/brands"   icon="bi-shop"             title="Brands"   count={kpis.brands}          color="#0d6efd" />
        <QuickJump to="/paid-collab/programs" icon="bi-collection"       title="Programs" count={programs.length}      color="#e8862e" />
        <QuickJump to="/paid-collab/creators" icon="bi-people"           title="Creators" count={kpis.creators}        color="#6610f2" />
        <QuickJump to="/paid-collab/videos"   icon="bi-collection-play"  title="Videos"   count={videos.length}        color="#198754" />
      </div>
    </div>
  );
}

// =====================================================================
// Gradient KPI tile
// =====================================================================
function KpiCard({ icon, color, label, value, sub }: {
  icon: string; color: string; label: string; value: string; sub?: string;
}) {
  return (
    <div className="pcd-kpi" style={{ ['--c' as any]: color }}>
      <div className="pcd-kpi-ico" style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}>
        <i className={`bi ${icon}`} />
      </div>
      <div className="pcd-kpi-l">{label}</div>
      <div className="pcd-kpi-v">{value}</div>
      {sub && <div className="pcd-kpi-sub">{sub}</div>}
    </div>
  );
}

// =====================================================================
// Big "go to section" tile at the bottom
// =====================================================================
function QuickJump({ to, icon, title, count, color }: {
  to: string; icon: string; title: string; count: number; color: string;
}) {
  return (
    <Link to={to} className="pcd-jump">
      <span className="pcd-jump-ico" style={{ background: `linear-gradient(135deg, ${color}, ${color}aa)` }}>
        <i className={`bi ${icon}`} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="pcd-jump-l">{title}</div>
        <div className="d-flex align-items-baseline gap-2">
          <span className="pcd-jump-v">{fmtNumber(count)}</span>
          <span className="text-muted small">total</span>
        </div>
      </div>
      <i className="bi bi-arrow-right text-muted fs-4" />
    </Link>
  );
}
