import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Button, Card, Modal, Form, Table, Spinner, Alert, Badge, Row, Col } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useNotifications } from '../notifications/NotificationsContext';

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function shiftMonth(yyyymm: string, delta: number) {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function fmtMonth(yyyymm: string) {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

interface Brand { id: string; name: string; client: string; }
interface ApcLite { id: string; email: string; full_name: string | null; }
interface MonthlyReport {
  id: string;
  brand_id: string;
  created_by: string;
  month: string;                    // 'YYYY-MM'
  status: string;
  created_at: string;
}

export default function MonthlyReports() {
  const { profile, user } = useAuth();
  const { notifications } = useNotifications();
  const nav = useNavigate();
  const isBob = profile?.role === 'bob';

  const unreadByReport = useMemo(() => {
    const m = new Map<string, number>();
    notifications.forEach(n => {
      if (n.read_at) return;
      // payload may set report_type='monthly' for monthly notifications; otherwise treat as weekly.
      if (n.payload?.report_type !== 'monthly') return;
      const rid = n.payload?.report_id;
      if (!rid) return;
      m.set(rid, (m.get(rid) ?? 0) + 1);
    });
    return m;
  }, [notifications]);

  const [brands, setBrands] = useState<Brand[]>([]);
  const [apcs, setApcs] = useState<ApcLite[]>([]);
  const [reports, setReports] = useState<MonthlyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // filters
  const [fBrand, setFBrand] = useState('');
  const [fApc, setFApc] = useState('');
  const [fSearch, setFSearch] = useState('');
  const [fMonth, setFMonth] = useState(thisMonth());

  // create modal
  const [show, setShow] = useState(false);
  const [createBrand, setCreateBrand] = useState<Brand | null>(null);
  const [createMonth, setCreateMonth] = useState(thisMonth());
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true); setErr(null);
    const [bRes, rRes, aRes] = await Promise.all([
      supabase.from('brands').select('id,name,client').order('name'),
      supabase.from('monthly_reports').select('*').order('month', { ascending: false }),
      isBob
        ? supabase.from('profiles').select('id,email,full_name').eq('role', 'apc')
        : Promise.resolve({ data: [] as ApcLite[], error: null }),
    ]);
    const e = bRes.error ?? rRes.error ?? (aRes as any).error;
    if (e) { setErr(e.message); setLoading(false); return; }
    setBrands(bRes.data ?? []);
    setApcs(((aRes as any).data ?? []) as ApcLite[]);
    setReports((rRes.data as MonthlyReport[]) ?? []);
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
      if (fMonth && r.month !== fMonth) return false;
      if (fBrand && r.brand_id !== fBrand) return false;
      if (fApc && r.created_by !== fApc) return false;
      if (fSearch) {
        const q = fSearch.toLowerCase();
        const b = brandMap.get(r.brand_id);
        const hay = `${b?.name ?? ''} ${b?.client ?? ''} ${r.month} ${r.status}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [reports, fMonth, fBrand, fApc, fSearch, brandMap]);

  // Bob: matrix of brand x last-12-months submissions
  const monthMatrix = useMemo(() => {
    if (!isBob) return null;
    const months: string[] = [];
    let cur = thisMonth();
    for (let i = 0; i < 12; i++) {
      months.unshift(cur);
      cur = shiftMonth(cur, -1);
    }
    const cell = (brandId: string, month: string) =>
      reports.find(r => r.brand_id === brandId && r.month === month);
    return { months, cell };
  }, [isBob, reports]);

  const openCreate = (b: Brand) => {
    setCreateBrand(b);
    // default to most-recent month that doesn't yet have a report for this brand
    const existing = new Set(reports.filter(r => r.brand_id === b.id).map(r => r.month));
    let m = thisMonth();
    while (existing.has(m)) m = shiftMonth(m, -1);
    setCreateMonth(m);
    setErr(null);
    setShow(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!createBrand || !user) return;
    setSaving(true); setErr(null);
    try {
      const { data: existing } = await supabase.from('monthly_reports')
        .select('id').eq('brand_id', createBrand.id).eq('month', createMonth).maybeSingle();
      if (existing) throw new Error(`A report for ${fmtMonth(createMonth)} already exists for ${createBrand.name}.`);
      const { data: inserted, error } = await supabase.from('monthly_reports').insert({
        brand_id: createBrand.id,
        created_by: user.id,
        month: createMonth,
        status: 'draft',
      }).select('id').single();
      if (error) throw error;
      setShow(false);
      nav(`/reporting/monthly/${(inserted as any).id}/edit`);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const clearFilters = () => { setFBrand(''); setFApc(''); setFSearch(''); setFMonth(thisMonth()); };

  const deleteReport = async (r: MonthlyReport, e: React.MouseEvent) => {
    e.stopPropagation();
    const b = brandMap.get(r.brand_id);
    if (!confirm(`Delete monthly report for ${b?.name ?? 'this brand'} (${fmtMonth(r.month)})? This removes all its data and comments permanently.`)) return;
    const prev = reports;
    setReports(reports.filter(x => x.id !== r.id));
    const { error } = await supabase.from('monthly_reports').delete().eq('id', r.id);
    if (error) { alert(error.message); setReports(prev); }
  };

  return (
    <>
      <h2 className="mb-4">Monthly Reports</h2>

      {/* Filters */}
      <Card className="mb-3">
        <Card.Body>
          <Row className="g-2 align-items-end">
            <Col md={2}>
              <Form.Label className="small mb-1">Month</Form.Label>
              <Form.Control size="sm" type="month" value={fMonth} onChange={e => setFMonth(e.target.value)} />
            </Col>
            <Col md={3}>
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
              <Button size="sm" variant="outline-secondary" className="w-100" onClick={clearFilters}>Clear</Button>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {/* Bob: brand × last-12-months submission matrix */}
      {isBob && monthMatrix && brands.length > 0 && (
        <Card className="mb-3">
          <Card.Header className="fw-semibold">
            Submissions over the last 12 months
            <small className="text-muted ms-2">click a cell to view the report</small>
          </Card.Header>
          <Card.Body className="p-0">
            <Table size="sm" responsive className="mb-0 align-middle text-center">
              <thead>
                <tr>
                  <th className="text-start" style={{minWidth:160}}>Brand</th>
                  {monthMatrix.months.map(m => {
                    const [, mm] = m.split('-');
                    return <th key={m} title={fmtMonth(m)}>{new Date(+m.split('-')[0], +mm - 1, 1).toLocaleString(undefined, { month: 'short' })}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {brands.map(b => (
                  <tr key={b.id}>
                    <td className="text-start fw-semibold">{b.name}</td>
                    {monthMatrix.months.map(m => {
                      const r = monthMatrix.cell(b.id, m);
                      return (
                        <td key={m} style={{cursor: r ? 'pointer' : 'default'}}
                          onClick={() => r && nav(`/reporting/monthly/${r.id}`)}>
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
                ? 'No monthly reports yet. Create your first one below.'
                : 'No reports match the current filters.'}
            </p>
          ) : (
            <Table hover responsive className="align-middle mb-0">
              <thead>
                <tr>
                  <th>Brand</th>
                  <th>Client</th>
                  {isBob && <th>Created by</th>}
                  <th>Month</th>
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
                      onClick={() => nav(`/reporting/monthly/${r.id}`)}>
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
                      <td>{fmtMonth(r.month)}</td>
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

      {/* Brand picker */}
      <Card>
        <Card.Body>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h5 className="mb-0">Create a new monthly report</h5>
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
                const last = reports
                  .filter(r => r.brand_id === b.id)
                  .map(r => r.month)
                  .sort()
                  .pop();
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
                          ? 'No reports yet — pick a month'
                          : `Last: ${last ? fmtMonth(last) : '—'}`}
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
            <Modal.Title>New monthly report — {createBrand?.name}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            <Form.Group>
              <Form.Label>Month</Form.Label>
              <Form.Control type="month" required value={createMonth}
                onChange={e => setCreateMonth(e.target.value)} />
              <Form.Text className="text-muted">
                The report will cover <strong>{fmtMonth(createMonth)}</strong>.
                If a previous month's report exists for this brand, "Last Month" data will be auto-pulled into the new one.
              </Form.Text>
            </Form.Group>
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
