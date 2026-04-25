import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Button, Card, Modal, Form, Table, Spinner, Alert, Badge, Row, Col } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useNotifications } from '../notifications/NotificationsContext';
import { addDays, formatRange, fromISO, toISO } from '../lib/dates';

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

interface Brand { id: string; name: string; client: string; }
interface ApcLite { id: string; email: string; full_name: string | null; }
interface BrandSetting { brand_id: string; weekly_anchor: string | null; }
interface Report {
  id: string;
  brand_id: string;
  created_by: string;
  week_start: string;
  week_end: string;
  week_number: number;
  status: string;
  created_at: string;
}

export default function WeeklyReports() {
  const { profile, user } = useAuth();
  const { notifications } = useNotifications();
  const nav = useNavigate();
  const isBob = profile?.role === 'bob';

  // Build: reportId -> count of unread notifications
  const unreadByReport = useMemo(() => {
    const m = new Map<string, number>();
    notifications.forEach(n => {
      if (n.read_at) return;
      const rid = n.payload?.report_id;
      if (!rid) return;
      m.set(rid, (m.get(rid) ?? 0) + 1);
    });
    return m;
  }, [notifications]);

  const [brands, setBrands] = useState<Brand[]>([]);
  const [apcs, setApcs] = useState<ApcLite[]>([]);
  const [settings, setSettings] = useState<Record<string, string | null>>({});
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // filters
  const [fBrand, setFBrand] = useState('');
  const [fApc, setFApc] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [fSearch, setFSearch] = useState('');
  const [fMonth, setFMonth] = useState(currentMonth());

  // create modal
  const [show, setShow] = useState(false);
  const [createBrand, setCreateBrand] = useState<Brand | null>(null);
  const [anchorPick, setAnchorPick] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true); setErr(null);
    const [bRes, sRes, rRes, aRes] = await Promise.all([
      supabase.from('brands').select('id,name,client').order('name'),
      supabase.from('brand_report_settings').select('brand_id,weekly_anchor'),
      supabase.from('weekly_reports').select('*').order('week_start', { ascending: false }),
      isBob
        ? supabase.from('profiles').select('id,email,full_name').eq('role', 'apc')
        : Promise.resolve({ data: [] as ApcLite[], error: null }),
    ]);
    const e = bRes.error ?? sRes.error ?? rRes.error ?? (aRes as any).error;
    if (e) { setErr(e.message); setLoading(false); return; }
    setBrands(bRes.data ?? []);
    setApcs(((aRes as any).data ?? []) as ApcLite[]);
    const sMap: Record<string, string | null> = {};
    (sRes.data ?? []).forEach((s: BrandSetting) => { sMap[s.brand_id] = s.weekly_anchor; });
    setSettings(sMap);
    setReports((rRes.data as Report[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [isBob]);

  const brandMap = useMemo(() => {
    const m = new Map<string, Brand>();
    brands.forEach(b => m.set(b.id, b));
    return m;
  }, [brands]);

  const apcMap = useMemo(() => {
    const m = new Map<string, ApcLite>();
    apcs.forEach(a => m.set(a.id, a));
    return m;
  }, [apcs]);

  const filteredReports = useMemo(() => {
    return reports.filter(r => {
      if (isBob && fMonth) {
        const ym = r.week_start.slice(0, 7);
        if (ym !== fMonth) return false;
      }
      if (fBrand && r.brand_id !== fBrand) return false;
      if (fApc && r.created_by !== fApc) return false;
      if (fFrom && r.week_start < fFrom) return false;
      if (fTo && r.week_end > fTo) return false;
      if (fSearch) {
        const q = fSearch.toLowerCase();
        const b = brandMap.get(r.brand_id);
        const hay = `${b?.name ?? ''} ${b?.client ?? ''} ${r.week_start} ${r.week_end} ${r.status}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [reports, isBob, fMonth, fBrand, fApc, fFrom, fTo, fSearch, brandMap]);

  // Bob: matrix of brand x week-of-month
  const monthMatrix = useMemo(() => {
    if (!isBob || !fMonth) return null;
    const [y, m] = fMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const last  = new Date(y, m, 0);
    const weeks: { start: string; end: string; label: string }[] = [];
    // weekly slots within month — we don't know each brand's anchor day so use Mon-Sun fallback
    let cur = new Date(first);
    while (cur <= last) {
      const start = toISO(cur);
      const endD = new Date(cur); endD.setDate(endD.getDate() + 6);
      const end = toISO(endD);
      weeks.push({ start, end, label: `${cur.getDate()}–${endD.getDate() > last.getDate() ? last.getDate() : endD.getDate()}` });
      cur.setDate(cur.getDate() + 7);
    }
    const submitted = reports.filter(r => r.week_start.slice(0,7) === fMonth);
    const cell = (brandId: string, w: { start: string; end: string }) => {
      return submitted.find(r => r.brand_id === brandId && r.week_start <= w.end && r.week_end >= w.start);
    };
    return { weeks, cell };
  }, [isBob, fMonth, reports]);

  const nextWindowFor = (brandId: string): { start: string; end: string; week_number: number } | null => {
    const anchor = settings[brandId];
    if (!anchor) return null;
    const existing = new Set(reports.filter(r => r.brand_id === brandId).map(r => r.week_start));
    let start = anchor;
    let week_number = 1;
    while (existing.has(start)) {
      start = addDays(start, 7);
      week_number++;
    }
    return { start, end: addDays(start, 6), week_number };
  };

  const openCreate = (b: Brand) => {
    setCreateBrand(b);
    // Prefill with existing anchor (if any) so a re-pick is easy
    setAnchorPick(settings[b.id] ?? '');
    setErr(null);
    setShow(true);
  };

  const hasExistingReports = (brandId: string) =>
    reports.some(r => r.brand_id === brandId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!createBrand || !user) return;
    setSaving(true); setErr(null);
    try {
      const firstTime = !hasExistingReports(createBrand.id);
      let anchor = settings[createBrand.id];
      if (firstTime) {
        if (!anchorPick) throw new Error('Please choose an anchor date.');
        anchor = anchorPick;
        const { error } = await supabase.from('brand_report_settings')
          .upsert({ brand_id: createBrand.id, weekly_anchor: anchor });
        if (error) throw error;
        setSettings(prev => ({ ...prev, [createBrand.id]: anchor! }));
      } else if (!anchor) {
        throw new Error('No anchor set for this brand.');
      }
      // earliest-gap-first: skip any weeks that already have a report
      const existing = new Set(reports.filter(r => r.brand_id === createBrand.id).map(r => r.week_start));
      let start = anchor!;
      let week_number = 1;
      while (existing.has(start)) {
        start = addDays(start, 7);
        week_number++;
      }
      const end = addDays(start, 6);
      const { data: inserted, error } = await supabase.from('weekly_reports').insert({
        brand_id: createBrand.id,
        created_by: user.id,
        week_start: start,
        week_end: end,
        week_number,
        status: 'draft',
      }).select('id').single();
      if (error) throw error;
      setShow(false);
      nav(`/reporting/weekly/${(inserted as any).id}/edit`);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const clearFilters = () => { setFBrand(''); setFApc(''); setFFrom(''); setFTo(''); setFSearch(''); setFMonth(currentMonth()); };

  const deleteReport = async (r: Report, e: React.MouseEvent) => {
    e.stopPropagation();
    const b = brandMap.get(r.brand_id);
    if (!confirm(`Delete report for ${b?.name ?? 'this brand'} (Week #${r.week_number}, ${formatRange(r.week_start, r.week_end)})? This removes all its data and comments permanently.`)) return;
    const prev = reports;
    setReports(reports.filter(x => x.id !== r.id));
    const { error } = await supabase.from('weekly_reports').delete().eq('id', r.id);
    if (error) { alert(error.message); setReports(prev); }
  };

  return (
    <>
      <h2 className="mb-4">Weekly Reports</h2>

      {/* Filters */}
      <Card className="mb-3">
        <Card.Body>
          <Row className="g-2 align-items-end">
            {isBob && (
              <Col md={2}>
                <Form.Label className="small mb-1">Month</Form.Label>
                <Form.Control size="sm" type="month" value={fMonth} onChange={e => setFMonth(e.target.value)} />
              </Col>
            )}
            <Col md={isBob ? 2 : 3}>
              <Form.Label className="small mb-1">Search</Form.Label>
              <Form.Control size="sm" placeholder="Brand, client, status…" value={fSearch} onChange={e => setFSearch(e.target.value)} />
            </Col>
            <Col md={2}>
              <Form.Label className="small mb-1">Brand</Form.Label>
              <Form.Select size="sm" value={fBrand} onChange={e => setFBrand(e.target.value)}>
                <option value="">All</option>
                {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Form.Select>
            </Col>
            {isBob && (
              <Col md={2}>
                <Form.Label className="small mb-1">APC</Form.Label>
                <Form.Select size="sm" value={fApc} onChange={e => setFApc(e.target.value)}>
                  <option value="">All</option>
                  {apcs.map(a => <option key={a.id} value={a.id}>{a.full_name || a.email}</option>)}
                </Form.Select>
              </Col>
            )}
            <Col md={2}>
              <Form.Label className="small mb-1">Week from</Form.Label>
              <Form.Control type="date" size="sm" value={fFrom} onChange={e => setFFrom(e.target.value)} />
            </Col>
            <Col md={isBob ? 1 : 2}>
              <Form.Label className="small mb-1">Week to</Form.Label>
              <Form.Control type="date" size="sm" value={fTo} onChange={e => setFTo(e.target.value)} />
            </Col>
            <Col md={1}>
              <Button size="sm" variant="outline-secondary" className="w-100" onClick={clearFilters}>Clear</Button>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {/* Bob: month submission matrix */}
      {isBob && monthMatrix && brands.length > 0 && (
        <Card className="mb-3">
          <Card.Header className="fw-semibold">
            Submissions for {new Date(fMonth + '-01').toLocaleString(undefined, { month: 'long', year: 'numeric' })}
            <small className="text-muted ms-2">click a cell to view the report</small>
          </Card.Header>
          <Card.Body className="p-0">
            <Table size="sm" responsive className="mb-0 align-middle text-center">
              <thead>
                <tr>
                  <th className="text-start" style={{minWidth:160}}>Brand</th>
                  {monthMatrix.weeks.map(w => (
                    <th key={w.start}>{w.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {brands.map(b => (
                  <tr key={b.id}>
                    <td className="text-start fw-semibold">{b.name}</td>
                    {monthMatrix.weeks.map(w => {
                      const r = monthMatrix.cell(b.id, w);
                      return (
                        <td key={w.start} style={{cursor: r ? 'pointer' : 'default'}}
                          onClick={() => r && nav(`/reporting/weekly/${r.id}`)}>
                          {r
                            ? <Badge bg={r.status === 'submitted' ? 'success' : 'secondary'}>
                                <i className={`bi ${r.status === 'submitted' ? 'bi-check-lg' : 'bi-clock'}`} />
                              </Badge>
                            : <span className="text-muted">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card.Body>
        </Card>
      )}

      {/* Reports table */}
      <Card className="mb-4">
        <Card.Body>
          {loading ? (
            <div className="text-center py-4"><Spinner animation="border" /></div>
          ) : err ? (
            <Alert variant="danger">{err}</Alert>
          ) : filteredReports.length === 0 ? (
            <p className="text-muted text-center mb-0 py-4">
              {reports.length === 0
                ? 'No reports yet. Create your first one below.'
                : 'No reports match the current filters.'}
            </p>
          ) : (
            <Table hover responsive className="align-middle mb-0">
              <thead>
                <tr>
                  <th>Brand</th>
                  <th>Client</th>
                  {isBob && <th>Created by</th>}
                  <th>Week</th>
                  <th>Period</th>
                  <th>Status</th>
                  <th>Created</th>
                  {isBob && <th style={{ width: 60 }}></th>}
                </tr>
              </thead>
              <tbody>
                {filteredReports.map(r => {
                  const b = brandMap.get(r.brand_id);
                  const a = apcMap.get(r.created_by);
                  const newCount = unreadByReport.get(r.id) ?? 0;
                  return (
                    <tr key={r.id} style={{ cursor: 'pointer', background: newCount > 0 ? 'rgba(37,99,235,.04)' : undefined }}
                      onClick={() => nav(`/reporting/weekly/${r.id}`)}>
                      <td className="fw-semibold">
                        {b?.name ?? '—'}
                        {newCount > 0 && (
                          <Badge bg="danger" pill className="ms-2" title={`${newCount} new client feedback`}>
                            <i className="bi bi-chat-left-text me-1" />{newCount} new
                          </Badge>
                        )}
                      </td>
                      <td>{b?.client ?? '—'}</td>
                      {isBob && <td>{a?.full_name || a?.email || (r.created_by === user?.id ? 'You' : '—')}</td>}
                      <td>#{r.week_number}</td>
                      <td>{formatRange(r.week_start, r.week_end)}</td>
                      <td><Badge bg={r.status === 'draft' ? 'secondary' : 'success'}>{r.status}</Badge></td>
                      <td><small className="text-muted">{new Date(r.created_at).toLocaleDateString()}</small></td>
                      {isBob && (
                        <td className="text-end">
                          <Button size="sm" variant="outline-danger" onClick={(e) => deleteReport(r, e)} title="Delete report">
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

      {/* Brand picker — APC sees their brands; Bob sees all */}
      <Card>
        <Card.Body>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h5 className="mb-0">Create a new report</h5>
            <small className="text-muted">Click a brand to start</small>
          </div>
          {loading ? (
            <Spinner animation="border" size="sm" />
          ) : brands.length === 0 ? (
            <p className="text-muted mb-0">
              {isBob ? 'No brands yet.' : 'No brands assigned to you.'}
            </p>
          ) : (
            <Row className="g-2">
              {brands.map(b => {
                const existingCount = reports.filter(r => r.brand_id === b.id).length;
                const next = nextWindowFor(b.id);
                return (
                  <Col md={4} lg={3} key={b.id}>
                    <Button
                      variant="outline-primary"
                      className="w-100 text-start py-2"
                      onClick={() => openCreate(b)}
                    >
                      <div className="fw-semibold">{b.name}</div>
                      <small className="text-muted d-block">
                        {existingCount === 0
                          ? 'No reports yet — pick anchor'
                          : next ? `Next: ${formatRange(next.start, next.end)}` : 'No anchor'}
                      </small>
                    </Button>
                  </Col>
                );
              })}
            </Row>
          )}
        </Card.Body>
      </Card>

      {/* Create modal */}
      <Modal show={show} onHide={() => setShow(false)} centered>
        <Form onSubmit={submit}>
          <Modal.Header closeButton>
            <Modal.Title>New report — {createBrand?.name}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            {createBrand && !hasExistingReports(createBrand.id) ? (
              <>
                <Alert variant="info">
                  {settings[createBrand.id]
                    ? <>No reports exist for <strong>{createBrand.name}</strong>. Confirm or re-pick the anchor date — your weekly cycle will start from here.</>
                    : <>You have not created any report for <strong>{createBrand.name}</strong> yet. Please choose an anchor date — your weekly cycle will start from this date.</>}
                </Alert>
                <Form.Group>
                  <Form.Label>Anchor date</Form.Label>
                  <Form.Control type="date" required value={anchorPick}
                    onChange={e => setAnchorPick(e.target.value)} />
                  {anchorPick && (
                    <Form.Text className="text-muted">
                      First report will cover <strong>{formatRange(anchorPick, addDays(anchorPick, 6))}</strong>.
                    </Form.Text>
                  )}
                </Form.Group>
              </>
            ) : createBrand && (() => {
              const next = nextWindowFor(createBrand.id)!;
              return (
                <Alert variant="info" className="mb-0">
                  Next report (Week #{next.week_number}) will cover<br />
                  <strong>{formatRange(next.start, next.end)}</strong>.
                </Alert>
              );
            })()}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create report'}</Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
}
