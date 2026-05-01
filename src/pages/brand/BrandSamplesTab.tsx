import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Card, Form, Button, Row, Col, Table, Modal, Spinner, Alert, Badge, ProgressBar } from 'react-bootstrap';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Legend,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import { toISO } from '../../lib/dates';
import NumberInput from '../../components/NumberInput';

interface SampleProduct {
  id: string;
  brand_id: string;
  external_product_id: string | null;
  name: string;
  monthly_goal: number | null;
  sort_order: number;
}
interface DailyEntry {
  id?: string;
  brand_id: string;
  entry_date: string;
  new_videos: number | null;
  daily_sps: number | null;
  reason_of_drop: string | null;
  others_count: number;
  product_counts: Record<string, number>;
}
interface WeeklyGmv {
  brand_id: string;
  month: string;
  week_index: number;
  affiliate_gmv: number | null;
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(yyyymm: string) {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}
function daysInMonth(yyyymm: string): string[] {
  const [y, m] = yyyymm.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const out: string[] = [];
  for (let d = 1; d <= last; d++) out.push(toISO(new Date(y, m - 1, d)));
  return out;
}
function weekIndexFor(dayOfMonth: number): number {
  return Math.min(5, Math.floor((dayOfMonth - 1) / 7) + 1);
}
function weekRangeLabel(yyyymm: string, idx: number): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const start = (idx - 1) * 7 + 1;
  const end = Math.min(idx * 7, last);
  if (start > last) return '';
  const monthName = new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short' });
  return `${monthName} ${start}–${end}`;
}
const sumValues = (m: Record<string, number>) =>
  Object.values(m).reduce((s, v) => s + (v ?? 0), 0);

export default function BrandSamplesTab({ brandId, canEdit }: { brandId: string; canEdit: boolean }) {
  const [month, setMonth] = useState<string>(currentMonth());
  const [products, setProducts] = useState<SampleProduct[]>([]);
  const [periodGoal, setPeriodGoal] = useState<number>(0);
  const [days, setDays] = useState<DailyEntry[]>([]);
  const [weekly, setWeekly] = useState<WeeklyGmv[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [savingGoal, setSavingGoal] = useState(false);

  const allDates = useMemo(() => daysInMonth(month), [month]);
  const weekIndices = useMemo(() => {
    const last = new Date(Number(month.split('-')[0]), Number(month.split('-')[1]), 0).getDate();
    return Array.from({ length: Math.ceil(last / 7) }, (_, i) => i + 1);
  }, [month]);

  const dayByDate = useMemo(() => {
    const m = new Map<string, DailyEntry>();
    for (const d of days) m.set(d.entry_date, d);
    return m;
  }, [days]);

  // Stats
  const totalApproved = useMemo(() =>
    days.reduce((s, d) => s + sumValues(d.product_counts) + (d.others_count ?? 0), 0),
  [days]);
  const totalNewVideos = useMemo(() =>
    days.reduce((s, d) => s + (d.new_videos ?? 0), 0),
  [days]);
  const avgSps = useMemo(() => {
    const xs = days.map(d => d.daily_sps).filter((n): n is number => n != null);
    if (xs.length === 0) return null;
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  }, [days]);
  const daysWithEntry = useMemo(() =>
    days.filter(d => d.id || sumValues(d.product_counts) > 0 || d.others_count > 0 || d.new_videos != null).length,
  [days]);

  // Per-product totals this month
  const perProductTotals = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const d of days) {
      for (const [pid, c] of Object.entries(d.product_counts)) {
        totals[pid] = (totals[pid] ?? 0) + (c ?? 0);
      }
    }
    return totals;
  }, [days]);

  const dailyChartData = useMemo(() =>
    allDates.map(date => {
      const d = dayByDate.get(date);
      const total = d ? sumValues(d.product_counts) + (d.others_count ?? 0) : 0;
      return { label: date.slice(8), Approved: total };
    }),
  [allDates, dayByDate]);

  const productChartData = useMemo(() =>
    products.map(p => ({
      name: p.name.length > 18 ? p.name.slice(0, 18) + '…' : p.name,
      Approved: perProductTotals[p.id] ?? 0,
      Goal: p.monthly_goal ?? 0,
    })),
  [products, perProductTotals]);

  const dropReasons = useMemo(() =>
    days
      .filter(d => d.reason_of_drop && d.reason_of_drop.trim().length > 0)
      .sort((a, b) => a.entry_date.localeCompare(b.entry_date)),
  [days]);

  // Load
  const load = async () => {
    setLoading(true); setErr(null);
    const monthFirst = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const monthLast = toISO(new Date(y, m, 0));
    const [pRes, gRes, dRes, wRes] = await Promise.all([
      supabase.from('brand_samples_products').select('*').eq('brand_id', brandId).order('sort_order').order('created_at'),
      supabase.from('brand_samples_periods').select('*').eq('brand_id', brandId).eq('month', month).maybeSingle(),
      supabase.from('brand_samples_daily').select('*').eq('brand_id', brandId)
        .gte('entry_date', monthFirst).lte('entry_date', monthLast).order('entry_date'),
      supabase.from('brand_samples_weekly_gmv').select('*').eq('brand_id', brandId).eq('month', month),
    ]);
    if (pRes.error) { setErr(pRes.error.message); setLoading(false); return; }
    if (gRes.error && !gRes.error.message?.includes('No rows')) {
      setErr(gRes.error.message); setLoading(false); return;
    }
    if (dRes.error) { setErr(dRes.error.message); setLoading(false); return; }
    if (wRes.error) { setErr(wRes.error.message); setLoading(false); return; }

    setProducts((pRes.data ?? []) as SampleProduct[]);
    setPeriodGoal((gRes.data as any)?.total_goal ?? 0);
    setDays(((dRes.data ?? []) as any[]).map(r => ({
      ...r,
      product_counts: r.product_counts ?? {},
    })) as DailyEntry[]);
    setWeekly((wRes.data ?? []) as WeeklyGmv[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [brandId, month]);

  // Save monthly goal
  const saveGoal = async () => {
    setSavingGoal(true); setErr(null);
    const { error } = await supabase.from('brand_samples_periods')
      .upsert({ brand_id: brandId, month, total_goal: periodGoal }, { onConflict: 'brand_id,month' });
    setSavingGoal(false);
    if (error) setErr(error.message);
  };

  // Products manager
  const [productModal, setProductModal] = useState(false);
  const emptyProduct = (): SampleProduct => ({
    id: '', brand_id: brandId, external_product_id: '', name: '', monthly_goal: null, sort_order: products.length,
  });
  const [productDraft, setProductDraft] = useState<SampleProduct>(emptyProduct());
  const [productEditing, setProductEditing] = useState<SampleProduct | null>(null);

  const openAddProduct = () => { setProductEditing(null); setProductDraft(emptyProduct()); setProductModal(true); };
  const openEditProduct = (p: SampleProduct) => { setProductEditing(p); setProductDraft({ ...p }); setProductModal(true); };
  const submitProduct = async (e: FormEvent) => {
    e.preventDefault();
    const payload: any = {
      brand_id: brandId,
      external_product_id: productDraft.external_product_id?.trim() || null,
      name: productDraft.name.trim(),
      monthly_goal: productDraft.monthly_goal ?? null,
      sort_order: productDraft.sort_order ?? 0,
    };
    const res = productEditing
      ? await supabase.from('brand_samples_products').update(payload).eq('id', productEditing.id)
      : await supabase.from('brand_samples_products').insert(payload);
    if (res.error) { setErr(res.error.message); return; }
    setProductModal(false);
    load();
  };
  const removeProduct = async (p: SampleProduct) => {
    if (!confirm(`Remove "${p.name}" from tracked products? Historical daily counts for this product will remain in past entries.`)) return;
    const { error } = await supabase.from('brand_samples_products').delete().eq('id', p.id);
    if (error) { alert(error.message); return; }
    load();
  };

  // Daily entry editor
  const [dayModal, setDayModal] = useState(false);
  const [dayDraft, setDayDraft] = useState<DailyEntry | null>(null);
  const openEditDay = (date: string) => {
    const existing = dayByDate.get(date);
    setDayDraft(existing
      ? { ...existing, product_counts: { ...existing.product_counts } }
      : {
          brand_id: brandId, entry_date: date,
          new_videos: null, daily_sps: null, reason_of_drop: '',
          others_count: 0, product_counts: {},
        });
    setDayModal(true);
  };
  const dayDraftTotal = dayDraft
    ? sumValues(dayDraft.product_counts) + (dayDraft.others_count ?? 0)
    : 0;
  const submitDay = async (e: FormEvent) => {
    e.preventDefault();
    if (!dayDraft) return;
    const payload: any = {
      brand_id: brandId,
      entry_date: dayDraft.entry_date,
      new_videos: dayDraft.new_videos,
      daily_sps: dayDraft.daily_sps,
      reason_of_drop: dayDraft.reason_of_drop?.trim() || null,
      others_count: dayDraft.others_count ?? 0,
      product_counts: dayDraft.product_counts ?? {},
    };
    const { error } = await supabase.from('brand_samples_daily')
      .upsert(payload, { onConflict: 'brand_id,entry_date' });
    if (error) { setErr(error.message); return; }
    setDayModal(false);
    load();
  };
  const deleteDay = async () => {
    if (!dayDraft?.id) { setDayModal(false); return; }
    if (!confirm(`Clear all entries for ${dayDraft.entry_date}?`)) return;
    const { error } = await supabase.from('brand_samples_daily').delete().eq('id', dayDraft.id);
    if (error) { alert(error.message); return; }
    setDayModal(false);
    load();
  };

  // Weekly GMV inline edit
  const setWeeklyGmv = async (idx: number, val: number) => {
    const { error } = await supabase.from('brand_samples_weekly_gmv')
      .upsert({ brand_id: brandId, month, week_index: idx, affiliate_gmv: val },
              { onConflict: 'brand_id,month,week_index' });
    if (error) { alert(error.message); return; }
    setWeekly(prev => {
      const next = prev.filter(w => w.week_index !== idx);
      next.push({ brand_id: brandId, month, week_index: idx, affiliate_gmv: val });
      return next.sort((a, b) => a.week_index - b.week_index);
    });
  };

  const weeklyAvgSps = (idx: number): number | null => {
    const start = (idx - 1) * 7 + 1;
    const end = idx * 7;
    const xs = days
      .filter(d => {
        const day = Number(d.entry_date.slice(8));
        return day >= start && day <= end && d.daily_sps != null;
      })
      .map(d => d.daily_sps as number);
    if (xs.length === 0) return null;
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  };

  const goalPct = periodGoal > 0 ? Math.min(100, Math.round((totalApproved / periodGoal) * 100)) : 0;

  return (
    <>
      {/* Header: month + monthly goal */}
      <Card className="mb-3">
        <Card.Body>
          <Row className="g-3 align-items-end">
            <Col md={3}>
              <Form.Label className="small">Month</Form.Label>
              <Form.Control type="month" value={month} onChange={e => setMonth(e.target.value)} />
            </Col>
            <Col md={3}>
              <Form.Label className="small">Total monthly goal</Form.Label>
              <NumberInput disabled={!canEdit} value={periodGoal} onChange={n => setPeriodGoal(n)} />
            </Col>
            <Col md={3}>
              <Button className="w-100" disabled={!canEdit || savingGoal} onClick={saveGoal}>
                {savingGoal ? 'Saving…' : 'Save monthly goal'}
              </Button>
            </Col>
            <Col md={3} className="text-md-end">
              <div className="text-muted small">{monthLabel(month)}</div>
            </Col>
          </Row>

          <Row className="g-3 mt-1">
            <Col md={6}>
              <div className="p-3 rounded h-100" style={{ background: '#f8fafc', border: '1px solid #e5e7eb' }}>
                <div className="ac-label">Goal progress</div>
                <div className="d-flex align-items-baseline gap-2 mt-1">
                  <span className="fs-4 fw-bold">{totalApproved.toLocaleString()}</span>
                  <span className="text-muted">/ {periodGoal.toLocaleString()}</span>
                  <Badge bg={goalPct >= 100 ? 'success' : goalPct >= 75 ? 'warning' : 'secondary'} className="ms-1">
                    {goalPct}%
                  </Badge>
                </div>
                <ProgressBar
                  now={goalPct}
                  variant={goalPct >= 100 ? 'success' : 'warning'}
                  className="mt-2"
                  style={{ height: 8 }}
                />
              </div>
            </Col>
            <Col md={2}><MiniStat label="New videos" value={totalNewVideos.toLocaleString()} /></Col>
            <Col md={2}><MiniStat label="Avg SPS" value={avgSps == null ? '—' : avgSps.toFixed(2)} /></Col>
            <Col md={2}><MiniStat label="Days entered" value={`${daysWithEntry} / ${allDates.length}`} /></Col>
          </Row>
        </Card.Body>
      </Card>

      {/* Tracked products */}
      <Card className="mb-3">
        <Card.Header className="d-flex justify-content-between align-items-center">
          <span className="fw-semibold">Tracked products</span>
          {canEdit && (
            <Button size="sm" onClick={openAddProduct}>
              <i className="bi bi-plus-lg me-1" /> Add product
            </Button>
          )}
        </Card.Header>
        <Card.Body className="p-0">
          {loading ? <div className="text-center py-4"><Spinner animation="border" /></div>
            : err ? <div className="p-3"><Alert variant="danger">{err}</Alert></div>
            : products.length === 0 ? (
              <p className="text-muted text-center py-4 mb-0">No products tracked yet.</p>
            ) : (
              <Table size="sm" responsive className="align-middle mb-0">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th>Product</th>
                    <th>Product ID</th>
                    <th className="text-end">Goal</th>
                    <th className="text-end">Approved</th>
                    <th>Progress</th>
                    {canEdit && <th style={{ width: 100 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {products.map((p, i) => {
                    const approved = perProductTotals[p.id] ?? 0;
                    const goal = p.monthly_goal ?? 0;
                    const pct = goal > 0 ? Math.min(100, Math.round((approved / goal) * 100)) : null;
                    return (
                      <tr key={p.id}>
                        <td className="text-muted small">{i + 1}</td>
                        <td className="fw-semibold">{p.name}</td>
                        <td className="small text-muted" style={{ fontFamily: 'monospace' }}>
                          {p.external_product_id || '—'}
                        </td>
                        <td className="text-end">{goal > 0 ? goal : <span className="text-muted">—</span>}</td>
                        <td className="text-end">{approved}</td>
                        <td style={{ minWidth: 160 }}>
                          {pct == null
                            ? <span className="text-muted small">No goal</span>
                            : <ProgressBar now={pct} variant={pct >= 100 ? 'success' : 'warning'} style={{ height: 6 }} />}
                        </td>
                        {canEdit && (
                          <td className="text-end">
                            <Button size="sm" variant="outline-primary" className="me-1" onClick={() => openEditProduct(p)}>
                              <i className="bi bi-pencil" />
                            </Button>
                            <Button size="sm" variant="outline-danger" onClick={() => removeProduct(p)}>
                              <i className="bi bi-trash" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
        </Card.Body>
      </Card>

      {/* Daily entries */}
      <Card className="mb-3">
        <Card.Header>
          <span className="fw-semibold">Daily entries</span>
          <small className="text-muted ms-2">Click any day to add or edit its sample approvals.</small>
        </Card.Header>
        <Card.Body className="p-0">
          <Table size="sm" responsive hover className="align-middle mb-0">
            <thead>
              <tr>
                <th>Date</th>
                <th className="text-end">New videos</th>
                <th className="text-end">Approved</th>
                <th className="text-end">SPS</th>
                <th>Reason of drop</th>
                <th>Top products</th>
                {canEdit && <th style={{ width: 60 }}></th>}
              </tr>
            </thead>
            <tbody>
              {allDates.map(date => {
                const d = dayByDate.get(date);
                const total = d ? sumValues(d.product_counts) + (d.others_count ?? 0) : 0;
                const top = d ? Object.entries(d.product_counts)
                  .filter(([, c]) => c > 0)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 3)
                  .map(([pid, c]) => ({ name: products.find(p => p.id === pid)?.name ?? '?', c })) : [];
                const dayNum = Number(date.slice(8));
                return (
                  <tr key={date} role={canEdit ? 'button' : undefined}
                      onClick={() => canEdit && openEditDay(date)}
                      style={{ cursor: canEdit ? 'pointer' : 'default' }}>
                    <td className="fw-semibold">
                      {new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' })}
                      <small className="text-muted ms-2">W{weekIndexFor(dayNum)}</small>
                    </td>
                    <td className="text-end">{d?.new_videos ?? <span className="text-muted">—</span>}</td>
                    <td className="text-end fw-semibold">{total > 0 ? total : <span className="text-muted fw-normal">—</span>}</td>
                    <td className="text-end">{d?.daily_sps != null ? d.daily_sps.toFixed(1) : <span className="text-muted">—</span>}</td>
                    <td className="small text-muted" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d?.reason_of_drop || ''}
                    </td>
                    <td className="small text-muted">
                      {top.length === 0 ? '' : top.map(t => `${t.name}: ${t.c}`).join(', ')}
                      {d && d.others_count > 0 && (top.length > 0 ? `, Others: ${d.others_count}` : `Others: ${d.others_count}`)}
                    </td>
                    {canEdit && (
                      <td className="text-end">
                        <i className="bi bi-pencil text-muted" />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card.Body>
      </Card>

      {/* Weekly GMV + charts row */}
      <Row className="g-3 mb-3">
        <Col lg={5}>
          <Card className="h-100">
            <Card.Header><span className="fw-semibold">Weekly summary</span></Card.Header>
            <Card.Body className="p-0">
              <Table size="sm" className="align-middle mb-0">
                <thead>
                  <tr>
                    <th>Week</th>
                    <th className="text-end">Avg SPS</th>
                    <th className="text-end">Affiliate GMV</th>
                  </tr>
                </thead>
                <tbody>
                  {weekIndices.map(idx => {
                    const range = weekRangeLabel(month, idx);
                    if (!range) return null;
                    const sps = weeklyAvgSps(idx);
                    const gmvRow = weekly.find(w => w.week_index === idx);
                    return (
                      <tr key={idx}>
                        <td className="fw-semibold">{range}</td>
                        <td className="text-end">{sps == null ? <span className="text-muted">—</span> : sps.toFixed(2)}</td>
                        <td className="text-end" style={{ minWidth: 160 }}>
                          {canEdit ? (
                            <NumberInput
                              step="0.01"
                              value={gmvRow?.affiliate_gmv ?? 0}
                              onChange={n => setWeeklyGmv(idx, n)}
                              size="sm"
                            />
                          ) : (
                            gmvRow?.affiliate_gmv != null ? `$${gmvRow.affiliate_gmv.toLocaleString()}` : '—'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>

        <Col lg={7}>
          <Card className="h-100">
            <Card.Header><span className="fw-semibold">Daily approvals</span></Card.Header>
            <Card.Body style={{ height: 280 }}>
              <ResponsiveContainer>
                <LineChart data={dailyChartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="Approved" stroke="#e8862e" strokeWidth={3} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {productChartData.length > 0 && (
        <Card className="mb-3">
          <Card.Header><span className="fw-semibold">Per-product totals vs goal</span></Card.Header>
          <Card.Body style={{ height: 320 }}>
            <ResponsiveContainer>
              <BarChart data={productChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" interval={0} angle={-20} textAnchor="end" height={80} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="Approved" fill="#e8862e" radius={[6,6,0,0]} />
                <Bar dataKey="Goal"     fill="#6e6e80" radius={[6,6,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card.Body>
        </Card>
      )}

      {dropReasons.length > 0 && (
        <Card className="mb-3">
          <Card.Header><span className="fw-semibold">Drop reasons this month</span></Card.Header>
          <Card.Body>
            <ul className="mb-0 small">
              {dropReasons.map(d => (
                <li key={d.entry_date}>
                  <strong>{new Date(d.entry_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}:</strong>{' '}
                  {d.reason_of_drop}
                </li>
              ))}
            </ul>
          </Card.Body>
        </Card>
      )}

      {/* Product editor modal */}
      <Modal show={productModal} onHide={() => setProductModal(false)} centered>
        <Form onSubmit={submitProduct}>
          <Modal.Header closeButton>
            <Modal.Title>{productEditing ? 'Edit product' : 'Add product'}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Row className="g-3">
              <Col md={12}>
                <Form.Label className="small">Product name *</Form.Label>
                <Form.Control required value={productDraft.name}
                  onChange={e => setProductDraft({ ...productDraft, name: e.target.value })} />
              </Col>
              <Col md={12}>
                <Form.Label className="small">External product ID <span className="text-muted">(optional)</span></Form.Label>
                <Form.Control value={productDraft.external_product_id ?? ''}
                  onChange={e => setProductDraft({ ...productDraft, external_product_id: e.target.value })}
                  placeholder="e.g. 1729401883758137709"
                  style={{ fontFamily: 'monospace' }} />
              </Col>
              <Col md={6}>
                <Form.Label className="small">Monthly goal <span className="text-muted">(blank = no goal)</span></Form.Label>
                <NumberInput value={productDraft.monthly_goal ?? 0}
                  onChange={n => setProductDraft({ ...productDraft, monthly_goal: n || null })} />
              </Col>
              <Col md={6}>
                <Form.Label className="small">Sort order</Form.Label>
                <NumberInput value={productDraft.sort_order}
                  onChange={n => setProductDraft({ ...productDraft, sort_order: n })} />
              </Col>
            </Row>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setProductModal(false)}>Cancel</Button>
            <Button type="submit" disabled={!productDraft.name.trim()}>
              {productEditing ? 'Save' : 'Add product'}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>

      {/* Daily entry modal */}
      <Modal show={dayModal} onHide={() => setDayModal(false)} centered size="lg">
        {dayDraft && (
          <Form onSubmit={submitDay}>
            <Modal.Header closeButton>
              <Modal.Title>
                {new Date(dayDraft.entry_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <Row className="g-3">
                <Col md={4}>
                  <Form.Label className="small">New videos</Form.Label>
                  <NumberInput value={dayDraft.new_videos ?? 0}
                    onChange={n => setDayDraft({ ...dayDraft, new_videos: n })} />
                </Col>
                <Col md={4}>
                  <Form.Label className="small">Daily SPS</Form.Label>
                  <NumberInput step="0.1" value={dayDraft.daily_sps ?? 0}
                    onChange={n => setDayDraft({ ...dayDraft, daily_sps: n })} />
                </Col>
                <Col md={4}>
                  <Form.Label className="small">Total approved <small className="text-muted">(auto)</small></Form.Label>
                  <Form.Control disabled value={dayDraftTotal} />
                </Col>
                <Col md={12}>
                  <Form.Label className="small">Reason of drop <span className="text-muted">(optional)</span></Form.Label>
                  <Form.Control as="textarea" rows={2}
                    value={dayDraft.reason_of_drop ?? ''}
                    onChange={e => setDayDraft({ ...dayDraft, reason_of_drop: e.target.value })} />
                </Col>

                <Col md={12}>
                  <hr className="my-2" />
                  <div className="fw-semibold mb-2">Per-product approvals</div>
                  {products.length === 0 ? (
                    <Alert variant="info" className="mb-0 py-2">
                      Add tracked products above to record per-product breakdowns.
                    </Alert>
                  ) : (
                    <Row className="g-2">
                      {products.map(p => (
                        <Col md={6} key={p.id}>
                          <div className="d-flex align-items-center gap-2">
                            <div className="flex-grow-1 small text-truncate" title={p.name}>{p.name}</div>
                            <div style={{ width: 110 }}>
                              <NumberInput
                                size="sm"
                                value={dayDraft.product_counts[p.id] ?? 0}
                                onChange={n => setDayDraft({
                                  ...dayDraft,
                                  product_counts: { ...dayDraft.product_counts, [p.id]: n },
                                })}
                              />
                            </div>
                          </div>
                        </Col>
                      ))}
                      <Col md={6}>
                        <div className="d-flex align-items-center gap-2">
                          <div className="flex-grow-1 small fst-italic">Others</div>
                          <div style={{ width: 110 }}>
                            <NumberInput
                              size="sm"
                              value={dayDraft.others_count ?? 0}
                              onChange={n => setDayDraft({ ...dayDraft, others_count: n })}
                            />
                          </div>
                        </div>
                      </Col>
                    </Row>
                  )}
                </Col>
              </Row>
            </Modal.Body>
            <Modal.Footer className="d-flex justify-content-between">
              <div>
                {dayDraft.id && (
                  <Button variant="outline-danger" onClick={deleteDay}>
                    <i className="bi bi-trash me-1" /> Clear day
                  </Button>
                )}
              </div>
              <div className="d-flex gap-2">
                <Button variant="secondary" onClick={() => setDayModal(false)}>Cancel</Button>
                <Button type="submit">Save</Button>
              </div>
            </Modal.Footer>
          </Form>
        )}
      </Modal>
    </>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded h-100" style={{ background: '#f8fafc', border: '1px solid #e5e7eb' }}>
      <div className="ac-label">{label}</div>
      <div className="fs-5 fw-semibold mt-1">{value}</div>
    </div>
  );
}
