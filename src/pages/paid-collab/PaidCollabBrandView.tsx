import { useEffect, useMemo, useState, FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Spinner, Alert, Button, Badge, Card, Row, Col, Modal, Form } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import {
  PaidProgram, PaidCreator, PaidVideo, summarizePrograms, todayISO,
} from '../../lib/paidCollabSchema';
import ProgramCard from '../../components/paidcollab/ProgramCard';
import PaymentControlsTab from '../../components/paidcollab/PaymentControlsTab';
import { useAuth } from '../../auth/AuthContext';

interface Brand { id: string; name: string; client: string; client_status: string | null; }

export default function PaidCollabBrandView() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { profile } = useAuth();
  const isHandler = profile?.role === 'paid_collab_handler';
  const isBob = profile?.role === 'bob';
  const [section, setSection] = useState<'programs' | 'payments'>('programs');
  const [brand, setBrand] = useState<Brand | null>(null);
  const [programs, setPrograms] = useState<PaidProgram[]>([]);
  const [creators, setCreators] = useState<PaidCreator[]>([]);
  const [videos, setVideos] = useState<PaidVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [filter, setFilter] = useState<'all' | 'active' | 'ended' | 'pending'>('all');

  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLaunch, setNewLaunch] = useState(todayISO());
  const [newBusy, setNewBusy] = useState(false);
  const [newErr, setNewErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setErr(null);
    const { data: b, error: bErr } = await supabase
      .from('brands').select('id,name,client,client_status').eq('id', id).maybeSingle();
    if (bErr) { setErr(bErr.message); setLoading(false); return; }
    if (!b) { setErr('Brand not found or you do not have access.'); setLoading(false); return; }
    setBrand(b as Brand);

    const { data: pRows, error: pErr } = await supabase
      .from('paid_creator_programs').select('*').eq('brand_id', id)
      .order('ended_at', { ascending: true, nullsFirst: true })
      .order('launch_date', { ascending: false });
    if (pErr) { setErr(pErr.message); setLoading(false); return; }
    const progs = (pRows as PaidProgram[]) ?? [];
    setPrograms(progs);
    if (progs.length === 0) { setCreators([]); setVideos([]); setLoading(false); return; }

    const progIds = progs.map(p => p.id);
    const { data: cRows, error: cErr } = await supabase
      .from('paid_creators').select('*').in('program_id', progIds);
    if (cErr) { setErr(cErr.message); setLoading(false); return; }
    const cs = (cRows as PaidCreator[]) ?? [];
    setCreators(cs);
    if (cs.length === 0) { setVideos([]); setLoading(false); return; }
    const creatorIds = cs.map(c => c.id);
    const { data: vRows, error: vErr } = await supabase
      .from('paid_creator_videos').select('*').in('creator_id', creatorIds);
    if (vErr) { setErr(vErr.message); setLoading(false); return; }
    setVideos((vRows as PaidVideo[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id]);

  const summaries = useMemo(
    () => summarizePrograms(programs, creators, videos),
    [programs, creators, videos],
  );

  const filteredPrograms = useMemo(() => {
    return programs.filter(p => {
      const s = summaries.get(p.id);
      if (filter === 'active' && p.ended_at) return false;
      if (filter === 'ended' && !p.ended_at) return false;
      if (filter === 'pending' && (s?.paymentPending ?? 0) === 0) return false;
      return true;
    });
  }, [programs, summaries, filter]);

  const brandActive = brand?.client_status !== 'closed';

  const createProgram = async (e: FormEvent) => {
    e.preventDefault();
    setNewBusy(true); setNewErr(null);
    try {
      const { data, error } = await supabase.from('paid_creator_programs')
        .insert({
          brand_id: id,
          name: newName.trim() || null,
          launch_date: newLaunch || todayISO(),
          total_budget: 0,
          currency: 'USD',
        })
        .select('*').single();
      if (error) throw error;
      const p = data as PaidProgram;
      setPrograms(prev => [p, ...prev]);
      setShowNew(false);
      setNewName('');
      setNewLaunch(todayISO());
      nav(`/paid-collab/programs/${p.id}`);
    } catch (e: any) {
      setNewErr(e?.message ?? 'Failed to create program');
    } finally {
      setNewBusy(false);
    }
  };

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;
  if (!brand) return null;

  const activeCount = programs.filter(p => !p.ended_at).length;
  const endedCount = programs.length - activeCount;
  const pendingCount = [...summaries.values()].reduce((s, x) => s + x.paymentPending, 0);

  return (
    <>
      <div className="d-flex align-items-center gap-2 mb-3">
        <Button size="sm" variant="outline-secondary" onClick={() => nav(-1)} title="Back">
          <i className="bi bi-arrow-left" />
        </Button>
        <div className="flex-grow-1">
          <h2 className="mb-0 d-flex align-items-center gap-2 flex-wrap">
            {brand.name}
            {!brandActive && (
              <Badge bg="dark" className="fs-6"><i className="bi bi-archive me-1" />Inactive</Badge>
            )}
          </h2>
          <div className="text-muted small">{brand.client}</div>
        </div>
        {brandActive && (
          <Button onClick={() => setShowNew(true)}>
            <i className="bi bi-plus-lg me-1" /> New program
          </Button>
        )}
      </div>

      {!brandActive && (
        <Alert variant="warning" className="d-flex align-items-center gap-2">
          <i className="bi bi-lock-fill" />
          <div>
            <strong>This brand is currently inactive.</strong>{' '}
            Existing programs are read-only.
          </div>
        </Alert>
      )}

      {/* Section switcher — Payment-popup controls are gated to Bob + Handler. */}
      {(isBob || isHandler) && (
        <div className="wr-tabs mb-3">
          <button className={`wr-tab ${section === 'programs' ? 'is-active' : ''}`} onClick={() => setSection('programs')}>
            <i className="bi bi-collection me-1" />Programs
          </button>
          <button className={`wr-tab ${section === 'payments' ? 'is-active' : ''}`} onClick={() => setSection('payments')}>
            <i className="bi bi-cash-stack me-1" />Payments
          </button>
        </div>
      )}

      {section === 'payments' && (isBob || isHandler) ? (
        <PaymentControlsTab brandId={brand.id} brandName={brand.name} canEdit={brandActive} />
      ) : (<>
      {/* Quick stats + filter */}
      <Card className="mb-3">
        <Card.Body className="d-flex flex-wrap align-items-center gap-3">
          <div className="d-flex gap-3 flex-grow-1">
            <div>
              <div className="text-muted small">Active</div>
              <div className="fs-4 fw-bold text-success">{activeCount}</div>
            </div>
            <div>
              <div className="text-muted small">Ended</div>
              <div className="fs-4 fw-bold text-secondary">{endedCount}</div>
            </div>
            {pendingCount > 0 && (
              <div>
                <div className="text-muted small">Payments pending</div>
                <div className="fs-4 fw-bold" style={{ color: '#e8862e' }}>{pendingCount}</div>
              </div>
            )}
          </div>
          <Form.Select size="sm" value={filter} onChange={e => setFilter(e.target.value as any)} style={{ width: 200 }}>
            <option value="all">All programs</option>
            <option value="active">Active only</option>
            <option value="ended">Ended only</option>
            <option value="pending">Payments pending</option>
          </Form.Select>
        </Card.Body>
      </Card>

      {programs.length === 0 ? (
        <Card body className="text-center py-5">
          <div style={{ fontSize: '2.5rem' }} className="mb-2 text-primary"><i className="bi bi-rocket-takeoff" /></div>
          <h5 className="mb-1">No programs yet for {brand.name}</h5>
          <p className="text-muted small mb-3">
            {brandActive
              ? 'Start the first program to track creators, videos, and milestones.'
              : 'This brand has no paid collab programs.'}
          </p>
          {brandActive && (
            <div>
              <Button onClick={() => setShowNew(true)}>
                <i className="bi bi-plus-lg me-1" /> New program
              </Button>
            </div>
          )}
        </Card>
      ) : filteredPrograms.length === 0 ? (
        <Card body className="text-muted text-center">
          No programs match this filter.
        </Card>
      ) : (
        <Row className="g-3">
          {filteredPrograms.map(p => {
            const s = summaries.get(p.id);
            if (!s) return null;
            return (
              <Col md={6} lg={4} key={p.id}>
                <ProgramCard
                  summary={s}
                  onClick={() => nav(`/paid-collab/programs/${p.id}`)}
                />
              </Col>
            );
          })}
        </Row>
      )}
      </>)}

      <Modal show={showNew} onHide={() => setShowNew(false)} centered>
        <Form onSubmit={createProgram}>
          <Modal.Header closeButton>
            <Modal.Title>New program for {brand.name}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {newErr && <Alert variant="danger" className="py-2">{newErr}</Alert>}
            <Form.Group className="mb-3">
              <Form.Label className="small fw-semibold">Program name *</Form.Label>
              <Form.Control
                required
                value={newName}
                placeholder="e.g. Summer 2026 Launch"
                onChange={e => setNewName(e.target.value)}
                autoFocus
              />
            </Form.Group>
            <Form.Group>
              <Form.Label className="small fw-semibold">Launch date</Form.Label>
              <Form.Control
                type="date"
                value={newLaunch}
                onChange={e => setNewLaunch(e.target.value)}
              />
              <Form.Text className="text-muted">
                You can edit budget, products, and other details inside the program.
              </Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowNew(false)} disabled={newBusy}>Cancel</Button>
            <Button type="submit" disabled={newBusy || !newName.trim()}>
              {newBusy ? 'Creating…' : 'Create program'}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
}
