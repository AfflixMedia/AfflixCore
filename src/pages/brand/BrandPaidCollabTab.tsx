import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Card, Button, Spinner, Alert, Row, Col, Modal, Form, Badge } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import {
  PaidProgram, PaidCreator, PaidVideo, summarizePrograms, todayISO,
} from '../../lib/paidCollabSchema';
import PaidCollabTracker from '../../components/paidcollab/PaidCollabTracker';
import ProgramCard from '../../components/paidcollab/ProgramCard';

interface Props {
  brandId: string;
  brandName: string;
  canEdit: boolean;
}

export default function BrandPaidCollabTab({ brandId, brandName, canEdit }: Props) {
  const [programs, setPrograms] = useState<PaidProgram[]>([]);
  const [creators, setCreators] = useState<PaidCreator[]>([]);
  const [videos, setVideos] = useState<PaidVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selectedProgramId, setSelectedProgramId] = useState<string | null>(null);

  // New program modal
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLaunch, setNewLaunch] = useState(todayISO());
  const [newBusy, setNewBusy] = useState(false);
  const [newErr, setNewErr] = useState<string | null>(null);

  const [filter, setFilter] = useState<'all' | 'active' | 'ended'>('all');

  const load = async () => {
    setLoading(true); setErr(null);
    const { data: progRows, error: pErr } = await supabase
      .from('paid_creator_programs').select('*').eq('brand_id', brandId)
      .order('ended_at', { ascending: true, nullsFirst: true })
      .order('launch_date', { ascending: false });
    if (pErr) { setErr(pErr.message); setLoading(false); return; }
    const progs = (progRows as PaidProgram[]) ?? [];
    setPrograms(progs);
    if (progs.length === 0) {
      setCreators([]); setVideos([]); setLoading(false); return;
    }
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

  useEffect(() => { load(); }, [brandId]);

  const summaries = useMemo(
    () => summarizePrograms(programs, creators, videos),
    [programs, creators, videos],
  );

  const filteredPrograms = useMemo(() => {
    if (filter === 'all') return programs;
    if (filter === 'active') return programs.filter(p => !p.ended_at);
    return programs.filter(p => !!p.ended_at);
  }, [programs, filter]);

  const createProgram = async (e: FormEvent) => {
    e.preventDefault();
    setNewBusy(true); setNewErr(null);
    try {
      const { data, error } = await supabase.from('paid_creator_programs')
        .insert({
          brand_id: brandId,
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
      // Land the user inside the new program so they can fill it in.
      setSelectedProgramId(p.id);
    } catch (e: any) {
      setNewErr(e?.message ?? 'Failed to create program');
    } finally {
      setNewBusy(false);
    }
  };

  // Tracker drill-down view
  if (selectedProgramId) {
    return (
      <div>
        <Button variant="outline-secondary" size="sm" className="mb-3"
                onClick={() => { setSelectedProgramId(null); load(); }}>
          <i className="bi bi-arrow-left me-1" /> Back to {brandName} programs
        </Button>
        <PaidCollabTracker
          programId={selectedProgramId}
          canEdit={canEdit}
          showBrand={false}
          onDeleted={() => { setSelectedProgramId(null); load(); }}
          onProgramChange={() => load()}
        />
      </div>
    );
  }

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;

  const activeCount = programs.filter(p => !p.ended_at).length;
  const endedCount = programs.length - activeCount;

  return (
    <>
      <Card className="mb-3">
        <Card.Body className="d-flex flex-wrap align-items-center justify-content-between gap-3">
          <div>
            <h5 className="mb-0">Paid Collab Programs</h5>
            <div className="text-muted small">
              {activeCount} active · {endedCount} ended
            </div>
          </div>
          <div className="d-flex gap-2 flex-wrap align-items-center">
            <Form.Select size="sm" value={filter} onChange={e => setFilter(e.target.value as any)} style={{ width: 140 }}>
              <option value="all">All programs</option>
              <option value="active">Active only</option>
              <option value="ended">Ended only</option>
            </Form.Select>
            {canEdit && (
              <Button size="sm" onClick={() => setShowNew(true)}>
                <i className="bi bi-plus-lg me-1" /> New program
              </Button>
            )}
          </div>
        </Card.Body>
      </Card>

      {programs.length === 0 ? (
        <Card body className="text-center py-5">
          <div style={{ fontSize: '2.5rem' }} className="mb-2 text-primary"><i className="bi bi-rocket-takeoff" /></div>
          <h5 className="mb-1">No paid creator programs yet for {brandName}</h5>
          <p className="text-muted small mb-3">
            {canEdit
              ? 'Start the first program to track creators, videos, and milestones.'
              : 'No paid creator programs have been started for this brand yet.'}
          </p>
          {canEdit && (
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
                  onClick={() => setSelectedProgramId(p.id)}
                />
              </Col>
            );
          })}
        </Row>
      )}

      <Modal show={showNew} onHide={() => setShowNew(false)} centered>
        <Form onSubmit={createProgram}>
          <Modal.Header closeButton>
            <Modal.Title>New program for {brandName}</Modal.Title>
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
                You can edit budget, products, and other details once the program is created.
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
