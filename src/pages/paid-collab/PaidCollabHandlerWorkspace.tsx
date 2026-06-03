import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Card, Spinner, Alert, Row, Col, Button, Modal, Form, Badge, Table,
} from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthContext';
import {
  PaidProgram, PaidCreator, PaidVideo, BrandProduct, VideoStatus, CreatorStatus,
  isCreatorPaymentPending, programDisplayName, fmtNumber, fmtMoney, todayISO,
} from '../../lib/paidCollabSchema';
import NumberInput from '../../components/NumberInput';

interface Brand { id: string; name: string; client_status: string | null; }

type QuickKind = 'program' | 'creator' | 'video' | 'note' | null;

export default function PaidCollabHandlerWorkspace() {
  const { profile } = useAuth();
  const nav = useNavigate();

  const [brands, setBrands] = useState<Brand[]>([]);
  const [programs, setPrograms] = useState<PaidProgram[]>([]);
  const [creators, setCreators] = useState<PaidCreator[]>([]);
  const [videos, setVideos] = useState<PaidVideo[]>([]);
  const [products, setProducts] = useState<BrandProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [quickAdd, setQuickAdd] = useState<QuickKind>(null);
  const [quickAddPrefill, setQuickAddPrefill] = useState<{ programId?: string }>({});

  const load = async () => {
    setLoading(true); setErr(null);
    const [{ data: bRows }, { data: pRows }, { data: cRows }, { data: vRows }, { data: prodRows }] = await Promise.all([
      supabase.from('brands').select('id,name,client_status').order('name'),
      supabase.from('paid_creator_programs').select('*').order('created_at', { ascending: false }),
      supabase.from('paid_creators').select('*'),
      supabase.from('paid_creator_videos').select('*').order('created_at', { ascending: false }),
      supabase.from('brand_products').select('*'),
    ]);
    setBrands((bRows as Brand[]) ?? []);
    setPrograms((pRows as PaidProgram[]) ?? []);
    setCreators((cRows as PaidCreator[]) ?? []);
    setVideos((vRows as PaidVideo[]) ?? []);
    setProducts((prodRows as BrandProduct[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

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

  // Every video counts as live; pipeline = agreed videos not yet delivered.
  const liveByCreator = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of videos) {
      m.set(v.creator_id, (m.get(v.creator_id) ?? 0) + 1);
    }
    return m;
  }, [videos]);
  const pipelineByCreator = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of creators) {
      if (c.status === 'dropped') continue;
      m.set(c.id, Math.max(0, (c.agreed_videos || 0) - (liveByCreator.get(c.id) ?? 0)));
    }
    return m;
  }, [creators, liveByCreator]);

  const kpis = useMemo(() => {
    const activePrograms = programs.filter(p => !p.ended_at).length;
    const paymentPending = creators.filter(c =>
      isCreatorPaymentPending(c, liveByCreator.get(c.id) ?? 0, programById.get(c.program_id))).length;
    return {
      brands: brands.length,
      activePrograms,
      creators: creators.length,
      live: videos.length,
      pipeline: [...pipelineByCreator.values()].reduce((s, n) => s + n, 0),
      paymentPending,
    };
  }, [brands, programs, creators, videos, liveByCreator, pipelineByCreator]);

  // Active programs with per-program creator + video counts
  const activeProgramRows = useMemo(() => {
    return programs
      .filter(p => !p.ended_at)
      .map(p => {
        const cs = creators.filter(c => c.program_id === p.id);
        const live = cs.reduce((s, c) => s + (liveByCreator.get(c.id) ?? 0), 0);
        const pipeline = cs.reduce((s, c) => s + (pipelineByCreator.get(c.id) ?? 0), 0);
        return { program: p, brand: brandById.get(p.brand_id), creators: cs.length, live, pipeline };
      })
      .sort((a, b) => (b.program.created_at).localeCompare(a.program.created_at));
  }, [programs, creators, brandById, liveByCreator, pipelineByCreator]);

  const recentVideos = useMemo(() => videos.slice(0, 12), [videos]);

  const firstName = useMemo(() => {
    const n = profile?.full_name || profile?.email || '';
    return n.split(' ')[0]?.split('@')[0] || 'there';
  }, [profile]);

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;

  return (
    <>
      {/* Hero */}
      <div className="rounded shadow-sm mb-4 p-4"
        style={{ background: 'linear-gradient(135deg, #141620 0%, #232638 60%, #2c2f44 100%)', color: '#fff' }}>
        <div className="d-flex justify-content-between align-items-start flex-wrap gap-3">
          <div>
            <div className="opacity-75 small mb-1">
              {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </div>
            <h2 className="mb-1" style={{ fontFamily: 'Sora, sans-serif', fontWeight: 600, color: '#fff' }}>
              Hi {firstName} — your operations workspace
            </h2>
            <div className="opacity-75">
              Add creators, log videos, and keep {kpis.activePrograms} program{kpis.activePrograms === 1 ? '' : 's'} moving.
            </div>
          </div>
          {kpis.paymentPending > 0 && (
            <Link to="/paid-collab/creators" className="text-decoration-none">
              <div className="ac-payment-pending-badge d-inline-flex align-items-center gap-2 px-3 py-2 rounded"
                style={{ backgroundColor: '#e8862e', color: '#fff' }}>
                <i className="bi bi-cash-stack fs-5" />
                <div>
                  <div style={{ fontWeight: 700, lineHeight: 1 }}>
                    {kpis.paymentPending} payment{kpis.paymentPending === 1 ? '' : 's'} pending
                  </div>
                  <div className="opacity-75" style={{ fontSize: '.75rem' }}>Review creators</div>
                </div>
              </div>
            </Link>
          )}
        </div>
      </div>

      {/* Compact stats */}
      <Row className="g-3 mb-4">
        <MiniKpi icon="bi-shop"            color="#0d6efd" label="Brands"           value={fmtNumber(kpis.brands)} />
        <MiniKpi icon="bi-rocket-takeoff"  color="#e8862e" label="Active programs"  value={fmtNumber(kpis.activePrograms)} />
        <MiniKpi icon="bi-people"          color="#6610f2" label="Creators"         value={fmtNumber(kpis.creators)} />
        <MiniKpi icon="bi-hourglass-split" color="#fd7e14" label="Pipeline"         value={fmtNumber(kpis.pipeline)} />
        <MiniKpi icon="bi-broadcast"       color="#198754" label="Live"             value={fmtNumber(kpis.live)} />
        <MiniKpi icon="bi-cash-stack"      color="#dc3545" label="Payments pending" value={fmtNumber(kpis.paymentPending)} />
      </Row>

      {/* Quick add row */}
      <Card className="shadow-sm mb-4" style={{ borderLeft: '4px solid #e8862e' }}>
        <Card.Body>
          <div className="d-flex justify-content-between align-items-start flex-wrap gap-3 mb-3">
            <div>
              <div className="text-muted small text-uppercase" style={{ letterSpacing: '.5px', fontSize: '.7rem' }}>
                Quick add
              </div>
              <h5 className="mb-0">Add data without leaving this page</h5>
              <div className="text-muted small">Pick brand & program once, fill in the fields, save. Repeat.</div>
            </div>
          </div>
          <div className="d-flex gap-2 flex-wrap">
            <Button size="lg" variant="primary" onClick={() => setQuickAdd('video')} className="flex-grow-1">
              <i className="bi bi-collection-play me-2" /> Add Video
            </Button>
            <Button size="lg" variant="outline-primary" onClick={() => setQuickAdd('creator')} className="flex-grow-1">
              <i className="bi bi-person-plus me-2" /> Add Creator
            </Button>
            <Button size="lg" variant="outline-warning" onClick={() => setQuickAdd('program')} className="flex-grow-1">
              <i className="bi bi-rocket-takeoff me-2" /> Add Program
            </Button>
            <Button size="lg" variant="outline-secondary" onClick={() => setQuickAdd('note')} className="flex-grow-1">
              <i className="bi bi-sticky me-2" /> Add Note
            </Button>
          </div>
        </Card.Body>
      </Card>

      {/* Active programs table */}
      <Card className="shadow-sm mb-4">
        <Card.Header className="d-flex justify-content-between align-items-center">
          <div>
            <span className="fw-semibold">Active programs</span>
            <small className="text-muted ms-2">Click a row to open · use the buttons to add fast</small>
          </div>
          <Link to="/paid-collab/programs" className="small">All programs <i className="bi bi-arrow-right ms-1" /></Link>
        </Card.Header>
        <Card.Body className="p-0">
          {activeProgramRows.length === 0 ? (
            <p className="text-muted text-center py-4 mb-0">
              No active programs yet. Use <strong>+ Add Program</strong> above to start one.
            </p>
          ) : (
            <Table hover responsive className="align-middle mb-0">
              <thead>
                <tr>
                  <th>Program</th>
                  <th>Brand</th>
                  <th className="text-end">Creators</th>
                  <th className="text-end">Pipeline</th>
                  <th className="text-end">Live</th>
                  <th style={{ width: 220 }}></th>
                </tr>
              </thead>
              <tbody>
                {activeProgramRows.map(r => (
                  <tr key={r.program.id} role="button"
                      onClick={() => nav(`/paid-collab/programs/${r.program.id}`)}
                      style={{ cursor: 'pointer' }}>
                    <td className="fw-semibold">{programDisplayName(r.program)}</td>
                    <td>{r.brand?.name ?? '—'}</td>
                    <td className="text-end">{r.creators}</td>
                    <td className="text-end">
                      <Badge bg="warning" text="dark">{r.pipeline}</Badge>
                    </td>
                    <td className="text-end">
                      <Badge bg="success">{r.live}</Badge>
                    </td>
                    <td className="text-end" onClick={e => e.stopPropagation()}>
                      <Button size="sm" variant="outline-primary" className="me-1"
                        onClick={() => { setQuickAddPrefill({ programId: r.program.id }); setQuickAdd('creator'); }}>
                        <i className="bi bi-person-plus me-1" />Creator
                      </Button>
                      <Button size="sm" variant="primary"
                        onClick={() => { setQuickAddPrefill({ programId: r.program.id }); setQuickAdd('video'); }}>
                        <i className="bi bi-collection-play me-1" />Video
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      {/* Recent videos */}
      <Card className="shadow-sm mb-4">
        <Card.Header className="d-flex justify-content-between align-items-center">
          <span className="fw-semibold">Recent videos</span>
          <Link to="/paid-collab/videos" className="small">All videos <i className="bi bi-arrow-right ms-1" /></Link>
        </Card.Header>
        <Card.Body className="p-0">
          {recentVideos.length === 0 ? (
            <p className="text-muted text-center py-4 mb-0">No videos logged yet.</p>
          ) : (
            <Table hover responsive className="align-middle mb-0">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Creator</th>
                  <th>Program</th>
                  <th>TikTok URL</th>
                  <th>Posted</th>
                </tr>
              </thead>
              <tbody>
                {recentVideos.map(v => {
                  const cr = creatorById.get(v.creator_id);
                  const prog = cr ? programById.get(cr.program_id) : null;
                  return (
                    <tr key={v.id} role="button"
                        onClick={() => prog && nav(`/paid-collab/programs/${prog.id}`)}
                        style={{ cursor: 'pointer' }}>
                      <td>
                        <Badge bg="success">
                          <i className="bi bi-broadcast me-1" />Live
                        </Badge>
                      </td>
                      <td className="fw-semibold">{cr?.name ?? '—'}</td>
                      <td>{prog ? programDisplayName(prog) : '—'}</td>
                      <td className="text-truncate" style={{ maxWidth: 280 }}>
                        {v.tiktok_url
                          ? <a href={v.tiktok_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
                              <i className="bi bi-tiktok me-1" />{v.tiktok_url}
                            </a>
                          : <span className="text-muted fst-italic">No URL</span>}
                      </td>
                      <td className="small text-muted">
                        {v.posted_on
                          ? new Date(v.posted_on + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      {/* Quick-add modals */}
      <QuickAddProgramModal
        show={quickAdd === 'program'}
        brands={brands.filter(b => b.client_status !== 'closed')}
        onClose={() => { setQuickAdd(null); setQuickAddPrefill({}); }}
        onSaved={(p) => { setPrograms(prev => [p, ...prev]); setQuickAdd(null); setQuickAddPrefill({}); }}
      />
      <QuickAddCreatorModal
        show={quickAdd === 'creator'}
        brands={brands.filter(b => b.client_status !== 'closed')}
        programs={programs.filter(p => !p.ended_at)}
        prefillProgramId={quickAddPrefill.programId}
        onClose={() => { setQuickAdd(null); setQuickAddPrefill({}); }}
        onSaved={(c) => { setCreators(prev => [...prev, c]); setQuickAdd(null); setQuickAddPrefill({}); }}
      />
      <QuickAddVideoModal
        show={quickAdd === 'video'}
        brands={brands.filter(b => b.client_status !== 'closed')}
        programs={programs.filter(p => !p.ended_at)}
        creators={creators}
        products={products}
        prefillProgramId={quickAddPrefill.programId}
        onClose={() => { setQuickAdd(null); setQuickAddPrefill({}); }}
        onSaved={(v) => { setVideos(prev => [v, ...prev]); setQuickAdd(null); setQuickAddPrefill({}); }}
      />
      <QuickAddNoteModal
        show={quickAdd === 'note'}
        brands={brands.filter(b => b.client_status !== 'closed')}
        programs={programs.filter(p => !p.ended_at)}
        prefillProgramId={quickAddPrefill.programId}
        onClose={() => { setQuickAdd(null); setQuickAddPrefill({}); }}
        onSaved={() => { setQuickAdd(null); setQuickAddPrefill({}); }}
      />
    </>
  );
}

function MiniKpi({ icon, color, label, value }: { icon: string; color: string; label: string; value: string }) {
  return (
    <Col xs={6} md={4} lg={2}>
      <Card className="h-100 shadow-sm" style={{ borderTop: `3px solid ${color}` }}>
        <Card.Body className="d-flex align-items-center gap-2 py-3">
          <div className="d-flex align-items-center justify-content-center rounded text-white flex-shrink-0"
            style={{
              width: 38, height: 38,
              background: `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)`,
            }}>
            <i className={`bi ${icon}`} />
          </div>
          <div className="min-w-0">
            <div className="text-muted text-truncate" style={{ fontSize: '.7rem' }}>{label}</div>
            <div className="fw-bold" style={{ fontSize: '1.1rem' }}>{value}</div>
          </div>
        </Card.Body>
      </Card>
    </Col>
  );
}

// =====================================================================
// Quick-add modals — designed for high-velocity data entry by a handler.
// Each modal: brand → program → ...fields → Save. After save, parent
// reloads via onSaved callback and closes the modal.
// =====================================================================

// ---------------------------------------------------------------
// Add Program modal
// ---------------------------------------------------------------

interface QPProgProps {
  show: boolean;
  brands: Brand[];
  onClose: () => void;
  onSaved: (p: PaidProgram) => void;
}
function QuickAddProgramModal({ show, brands, onClose, onSaved }: QPProgProps) {
  const [brandId, setBrandId] = useState('');
  const [name, setName] = useState('');
  const [launch, setLaunch] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!show) return;
    setBrandId(brands[0]?.id ?? '');
    setName('');
    setLaunch(todayISO());
    setErr(null);
  }, [show, brands]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const { data, error } = await supabase.from('paid_creator_programs')
        .insert({
          brand_id: brandId,
          name: name.trim() || null,
          launch_date: launch || todayISO(),
          total_budget: 0,
          currency: 'USD',
        })
        .select('*').single();
      if (error) throw error;
      onSaved(data as PaidProgram);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show={show} onHide={onClose} centered scrollable>
      <Form onSubmit={submit}>
        <Modal.Header closeButton>
          <Modal.Title><i className="bi bi-rocket-takeoff me-2" />Add program</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {err && <Alert variant="danger" className="py-2">{err}</Alert>}
          <Form.Group className="mb-3">
            <Form.Label className="small fw-semibold">Brand *</Form.Label>
            <Form.Select required value={brandId} onChange={e => setBrandId(e.target.value)}>
              <option value="">— Pick a brand —</option>
              {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Form.Select>
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label className="small fw-semibold">Program name *</Form.Label>
            <Form.Control required value={name}
              placeholder="e.g. Summer 2026 Launch"
              onChange={e => setName(e.target.value)} />
          </Form.Group>
          <Form.Group>
            <Form.Label className="small fw-semibold">Launch date</Form.Label>
            <Form.Control type="date" value={launch} onChange={e => setLaunch(e.target.value)} />
            <Form.Text className="text-muted">You can edit budget, products, and other details inside the program.</Form.Text>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy || !brandId || !name.trim()}>
            {busy ? 'Saving…' : 'Create program'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

// ---------------------------------------------------------------
// Add Creator modal
// ---------------------------------------------------------------

const CREATOR_STATUSES: CreatorStatus[] = ['active', 'paused', 'done', 'dropped'];

interface QPCreatorProps {
  show: boolean;
  brands: Brand[];
  programs: PaidProgram[];
  prefillProgramId?: string;
  onClose: () => void;
  onSaved: (c: PaidCreator) => void;
}
function QuickAddCreatorModal({ show, brands, programs, prefillProgramId, onClose, onSaved }: QPCreatorProps) {
  const [brandId, setBrandId] = useState('');
  const [programId, setProgramId] = useState('');
  const [form, setForm] = useState({
    name: '', handle: '', fee: 0, agreed_videos: 0,
    onboard_date: todayISO(), status: 'active' as CreatorStatus, notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!show) return;
    if (prefillProgramId) {
      const pp = programs.find(p => p.id === prefillProgramId);
      setBrandId(pp?.brand_id ?? '');
      setProgramId(prefillProgramId);
    } else {
      setBrandId(brands[0]?.id ?? '');
      setProgramId('');
    }
    setForm({
      name: '', handle: '', fee: 0, agreed_videos: 0,
      onboard_date: todayISO(), status: 'active', notes: '',
    });
    setErr(null);
  }, [show, brands, programs, prefillProgramId]);

  const programOptions = useMemo(
    () => programs.filter(p => p.brand_id === brandId),
    [programs, brandId],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const { data, error } = await supabase.from('paid_creators').insert({
        program_id: programId,
        name: form.name.trim(),
        handle: form.handle.trim() || null,
        fee: Number(form.fee) || 0,
        agreed_videos: Number(form.agreed_videos) || 0,
        onboard_date: form.onboard_date || null,
        status: form.status,
        notes: form.notes.trim() || null,
      }).select('*').single();
      if (error) throw error;
      onSaved(data as PaidCreator);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show={show} onHide={onClose} centered scrollable size="lg">
      <Form onSubmit={submit}>
        <Modal.Header closeButton>
          <Modal.Title><i className="bi bi-person-plus me-2" />Add creator</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {err && <Alert variant="danger" className="py-2">{err}</Alert>}
          <div className="row g-2">
            <Form.Group className="col-md-6 mb-2">
              <Form.Label className="small fw-semibold">Brand *</Form.Label>
              <Form.Select required value={brandId}
                onChange={e => { setBrandId(e.target.value); setProgramId(''); }}>
                <option value="">— Pick a brand —</option>
                {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Form.Select>
            </Form.Group>
            <Form.Group className="col-md-6 mb-2">
              <Form.Label className="small fw-semibold">Program *</Form.Label>
              <Form.Select required value={programId} onChange={e => setProgramId(e.target.value)} disabled={!brandId}>
                <option value="">— Pick a program —</option>
                {programOptions.map(p => (
                  <option key={p.id} value={p.id}>{programDisplayName(p)}</option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="col-md-7 mb-2">
              <Form.Label className="small fw-semibold">Name *</Form.Label>
              <Form.Control required value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })} />
            </Form.Group>
            <Form.Group className="col-md-5 mb-2">
              <Form.Label className="small fw-semibold">TikTok handle</Form.Label>
              <Form.Control value={form.handle} placeholder="@username"
                onChange={e => setForm({ ...form, handle: e.target.value })} />
            </Form.Group>
            <Form.Group className="col-md-4 mb-2">
              <Form.Label className="small fw-semibold">Fee (USD)</Form.Label>
              <NumberInput min={0} step="any" value={form.fee}
                onChange={n => setForm({ ...form, fee: n })} />
            </Form.Group>
            <Form.Group className="col-md-4 mb-2">
              <Form.Label className="small fw-semibold">Agreed videos</Form.Label>
              <NumberInput min={0} value={form.agreed_videos}
                onChange={n => setForm({ ...form, agreed_videos: n })} />
            </Form.Group>
            <Form.Group className="col-md-4 mb-2">
              <Form.Label className="small fw-semibold">Status</Form.Label>
              <Form.Select value={form.status} onChange={e => setForm({ ...form, status: e.target.value as CreatorStatus })}>
                {CREATOR_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </Form.Select>
            </Form.Group>
            <Form.Group className="col-12 mb-2">
              <Form.Label className="small fw-semibold">Onboard date</Form.Label>
              <Form.Control type="date" value={form.onboard_date}
                onChange={e => setForm({ ...form, onboard_date: e.target.value })} />
            </Form.Group>
            <Form.Group className="col-12 mb-2">
              <Form.Label className="small fw-semibold">Notes</Form.Label>
              <Form.Control as="textarea" rows={2} value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })} />
            </Form.Group>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy || !brandId || !programId || !form.name.trim()}>
            {busy ? 'Saving…' : 'Add creator'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

// ---------------------------------------------------------------
// Add Video modal
// ---------------------------------------------------------------

interface QPVideoProps {
  show: boolean;
  brands: Brand[];
  programs: PaidProgram[];
  creators: PaidCreator[];
  products: BrandProduct[];
  prefillProgramId?: string;
  onClose: () => void;
  onSaved: (v: PaidVideo) => void;
}
function QuickAddVideoModal({
  show, brands, programs, creators, products, prefillProgramId, onClose, onSaved,
}: QPVideoProps) {
  const [brandId, setBrandId] = useState('');
  const [programId, setProgramId] = useState('');
  const [creatorId, setCreatorId] = useState('');
  const [productId, setProductId] = useState('');
  const [form, setForm] = useState({
    tiktok_url: '', posted_on: '', notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Programs scoped to selected brand
  const programOptions = useMemo(
    () => programs.filter(p => p.brand_id === brandId),
    [programs, brandId],
  );
  // Creators scoped to selected program
  const creatorOptions = useMemo(
    () => creators.filter(c => c.program_id === programId),
    [creators, programId],
  );

  // Products attached to the selected program (via paid_program_products)
  const [programProductIds, setProgramProductIds] = useState<string[]>([]);
  useEffect(() => {
    (async () => {
      if (!programId) { setProgramProductIds([]); return; }
      const { data } = await supabase.from('paid_program_products')
        .select('product_id').eq('program_id', programId);
      setProgramProductIds(((data ?? []) as { product_id: string }[]).map(r => r.product_id));
    })();
  }, [programId]);
  const productOptions = useMemo(
    () => products.filter(p => programProductIds.includes(p.id)),
    [products, programProductIds],
  );

  useEffect(() => {
    if (!show) return;
    if (prefillProgramId) {
      const pp = programs.find(p => p.id === prefillProgramId);
      setBrandId(pp?.brand_id ?? '');
      setProgramId(prefillProgramId);
    } else {
      setBrandId(brands[0]?.id ?? '');
      setProgramId('');
    }
    setCreatorId('');
    setProductId('');
    setForm({ tiktok_url: '', posted_on: '', notes: '' });
    setErr(null);
  }, [show, brands, programs, prefillProgramId]);

  // Auto-pick the only product if there's just one
  useEffect(() => {
    if (productOptions.length === 1) setProductId(productOptions[0].id);
  }, [productOptions]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!productId) { setErr('Pick which product this video was created for.'); return; }
    setBusy(true); setErr(null);
    try {
      const { data, error } = await supabase.from('paid_creator_videos').insert({
        creator_id: creatorId,
        product_id: productId,
        tiktok_url: form.tiktok_url.trim() || null,
        status: 'live' as VideoStatus,
        posted_on: form.posted_on || todayISO(),
        notes: form.notes.trim() || null,
      }).select('*').single();
      if (error) throw error;
      onSaved(data as PaidVideo);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show={show} onHide={onClose} centered scrollable size="lg">
      <Form onSubmit={submit}>
        <Modal.Header closeButton>
          <Modal.Title><i className="bi bi-collection-play me-2" />Add video</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {err && <Alert variant="danger" className="py-2">{err}</Alert>}
          <div className="row g-2">
            <Form.Group className="col-md-4 mb-2">
              <Form.Label className="small fw-semibold">Brand *</Form.Label>
              <Form.Select required value={brandId}
                onChange={e => { setBrandId(e.target.value); setProgramId(''); setCreatorId(''); setProductId(''); }}>
                <option value="">— Pick —</option>
                {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Form.Select>
            </Form.Group>
            <Form.Group className="col-md-4 mb-2">
              <Form.Label className="small fw-semibold">Program *</Form.Label>
              <Form.Select required value={programId} disabled={!brandId}
                onChange={e => { setProgramId(e.target.value); setCreatorId(''); setProductId(''); }}>
                <option value="">— Pick —</option>
                {programOptions.map(p => <option key={p.id} value={p.id}>{programDisplayName(p)}</option>)}
              </Form.Select>
            </Form.Group>
            <Form.Group className="col-md-4 mb-2">
              <Form.Label className="small fw-semibold">Creator *</Form.Label>
              <Form.Select required value={creatorId} disabled={!programId}
                onChange={e => setCreatorId(e.target.value)}>
                <option value="">— Pick —</option>
                {creatorOptions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Form.Select>
            </Form.Group>
            <Form.Group className="col-12 mb-2">
              <Form.Label className="small fw-semibold">Product *</Form.Label>
              <Form.Select required value={productId} disabled={!programId}
                onChange={e => setProductId(e.target.value)}>
                <option value="">— Pick a product —</option>
                {productOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Form.Select>
              {programId && productOptions.length === 0 && (
                <Form.Text className="text-warning">
                  No products attached to this program. Open the program and add some.
                </Form.Text>
              )}
            </Form.Group>
            <Form.Group className="col-12 mb-2">
              <Form.Label className="small fw-semibold">TikTok URL</Form.Label>
              <Form.Control type="url" value={form.tiktok_url}
                placeholder="https://www.tiktok.com/@user/video/…"
                onChange={e => setForm({ ...form, tiktok_url: e.target.value })} />
            </Form.Group>
            <Form.Group className="col-12 mb-2">
              <Form.Label className="small fw-semibold">Posted on</Form.Label>
              <Form.Control type="date" value={form.posted_on}
                onChange={e => setForm({ ...form, posted_on: e.target.value })} />
              <Form.Text className="text-muted">Added videos count as live — defaults to today.</Form.Text>
            </Form.Group>
            <Form.Group className="col-12 mb-2">
              <Form.Label className="small fw-semibold">Notes</Form.Label>
              <Form.Control as="textarea" rows={2} value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })} />
            </Form.Group>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy || !brandId || !programId || !creatorId || !productId}>
            {busy ? 'Saving…' : 'Add video'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

// ---------------------------------------------------------------
// Add Note modal
// ---------------------------------------------------------------

interface QPNoteProps {
  show: boolean;
  brands: Brand[];
  programs: PaidProgram[];
  prefillProgramId?: string;
  onClose: () => void;
  onSaved: () => void;
}
function QuickAddNoteModal({ show, brands, programs, prefillProgramId, onClose, onSaved }: QPNoteProps) {
  const [brandId, setBrandId] = useState('');
  const [programId, setProgramId] = useState('');
  const [kind, setKind] = useState<'note' | 'delay' | 'pause' | 'milestone' | 'budget_suggestion' | 'first_live'>('note');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [occurredOn, setOccurredOn] = useState(todayISO());
  const [pin, setPin] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!show) return;
    if (prefillProgramId) {
      const pp = programs.find(p => p.id === prefillProgramId);
      setBrandId(pp?.brand_id ?? '');
      setProgramId(prefillProgramId);
    } else {
      setBrandId(brands[0]?.id ?? '');
      setProgramId('');
    }
    setKind('note'); setTitle(''); setBody(''); setOccurredOn(todayISO()); setPin(true);
    setErr(null);
  }, [show, brands, programs, prefillProgramId]);

  const programOptions = useMemo(
    () => programs.filter(p => p.brand_id === brandId),
    [programs, brandId],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const { error } = await supabase.from('paid_program_notes').insert({
        program_id: programId,
        kind,
        title: title.trim(),
        body: body.trim() || null,
        occurred_on: occurredOn || null,
        pin_to_chart: pin,
      });
      if (error) throw error;
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show={show} onHide={onClose} centered scrollable>
      <Form onSubmit={submit}>
        <Modal.Header closeButton>
          <Modal.Title><i className="bi bi-sticky me-2" />Add note</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {err && <Alert variant="danger" className="py-2">{err}</Alert>}
          <Form.Group className="mb-2">
            <Form.Label className="small fw-semibold">Brand *</Form.Label>
            <Form.Select required value={brandId}
              onChange={e => { setBrandId(e.target.value); setProgramId(''); }}>
              <option value="">— Pick —</option>
              {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Form.Select>
          </Form.Group>
          <Form.Group className="mb-2">
            <Form.Label className="small fw-semibold">Program *</Form.Label>
            <Form.Select required value={programId} disabled={!brandId}
              onChange={e => setProgramId(e.target.value)}>
              <option value="">— Pick —</option>
              {programOptions.map(p => <option key={p.id} value={p.id}>{programDisplayName(p)}</option>)}
            </Form.Select>
          </Form.Group>
          <Form.Group className="mb-2">
            <Form.Label className="small fw-semibold">Kind</Form.Label>
            <Form.Select value={kind} onChange={e => setKind(e.target.value as any)}>
              <option value="note">Note</option>
              <option value="delay">Delay</option>
              <option value="pause">Pause</option>
              <option value="milestone">Milestone</option>
              <option value="budget_suggestion">Budget suggestion</option>
              <option value="first_live">First content live</option>
            </Form.Select>
          </Form.Group>
          <Form.Group className="mb-2">
            <Form.Label className="small fw-semibold">Title *</Form.Label>
            <Form.Control required value={title} onChange={e => setTitle(e.target.value)} />
          </Form.Group>
          <Form.Group className="mb-2">
            <Form.Label className="small fw-semibold">Details</Form.Label>
            <Form.Control as="textarea" rows={3} value={body} onChange={e => setBody(e.target.value)} />
          </Form.Group>
          <div className="row g-2">
            <Form.Group className="col-7 mb-2">
              <Form.Label className="small fw-semibold">Occurred on</Form.Label>
              <Form.Control type="date" value={occurredOn} onChange={e => setOccurredOn(e.target.value)} />
            </Form.Group>
            <Form.Group className="col-5 mb-2 d-flex align-items-end pb-2">
              <Form.Check type="switch" id="qa-note-pin" label="Pin to chart"
                checked={pin} onChange={e => setPin(e.target.checked)} />
            </Form.Group>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy || !brandId || !programId || !title.trim()}>
            {busy ? 'Saving…' : 'Add note'}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
