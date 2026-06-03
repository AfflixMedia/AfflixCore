import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Spinner, Alert, Form, InputGroup, Row, Col } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import {
  PaidProgram, PaidCreator, PaidVideo, summarizePrograms, programDisplayName,
} from '../../lib/paidCollabSchema';
import ProgramCard from '../../components/paidcollab/ProgramCard';

interface Brand { id: string; name: string; client: string; client_status: string | null; }

type StatusFilter =
  | 'all'
  | 'active'
  | 'ended'
  | 'all_posted'        // every active creator has hit their agreed-videos count
  | 'payment_pending';  // at least one creator awaiting payment

export default function PaidCollabPrograms() {
  const nav = useNavigate();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [programs, setPrograms] = useState<PaidProgram[]>([]);
  const [creators, setCreators] = useState<PaidCreator[]>([]);
  const [videos, setVideos] = useState<PaidVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [brandFilter, setBrandFilter] = useState<string>('');

  useEffect(() => {
    (async () => {
      setLoading(true); setErr(null);
      const { data: bRows, error: bErr } = await supabase
        .from('brands').select('id,name,client,client_status').order('name');
      if (bErr) { setErr(bErr.message); setLoading(false); return; }
      const bs = (bRows as Brand[]) ?? [];
      setBrands(bs);

      const { data: pRows, error: pErr } = await supabase
        .from('paid_creator_programs').select('*')
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
    })();
  }, []);

  const brandById = useMemo(() => {
    const m = new Map<string, Brand>();
    for (const b of brands) m.set(b.id, b);
    return m;
  }, [brands]);

  const summaries = useMemo(
    () => summarizePrograms(programs, creators, videos),
    [programs, creators, videos],
  );

  const filteredPrograms = useMemo(() => {
    const q = search.trim().toLowerCase();
    return programs.filter(p => {
      const s = summaries.get(p.id);
      const b = brandById.get(p.brand_id);
      if (brandFilter && p.brand_id !== brandFilter) return false;
      if (statusFilter === 'active' && p.ended_at) return false;
      if (statusFilter === 'ended' && !p.ended_at) return false;
      if (statusFilter === 'all_posted' && !(s?.allVideosPosted)) return false;
      if (statusFilter === 'payment_pending' && (s?.paymentPending ?? 0) === 0) return false;
      if (q) {
        const hay = `${programDisplayName(p)} ${b?.name ?? ''} ${b?.client ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [programs, summaries, brandById, search, statusFilter, brandFilter]);

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;

  const totalActive = programs.filter(p => !p.ended_at).length;
  const totalEnded = programs.length - totalActive;
  const totalPending = [...summaries.values()].reduce((s, x) => s + x.paymentPending, 0);

  return (
    <>
      <div className="ac-page-header">
        <h2 className="mb-0">Programs</h2>
      </div>

      <Card className="mb-3">
        <Card.Body className="d-flex flex-wrap align-items-center gap-3">
          <div className="d-flex gap-3 flex-grow-1 flex-wrap">
            <div>
              <div className="text-muted small">Total</div>
              <div className="fs-4 fw-bold">{programs.length}</div>
            </div>
            <div>
              <div className="text-muted small">Active</div>
              <div className="fs-4 fw-bold text-success">{totalActive}</div>
            </div>
            <div>
              <div className="text-muted small">Ended</div>
              <div className="fs-4 fw-bold text-secondary">{totalEnded}</div>
            </div>
            {totalPending > 0 && (
              <div>
                <div className="text-muted small">Payments pending</div>
                <div className="fs-4 fw-bold" style={{ color: '#e8862e' }}>{totalPending}</div>
              </div>
            )}
          </div>
        </Card.Body>
      </Card>

      <Card className="mb-3">
        <Card.Body className="py-2">
          <Row className="g-2 align-items-center">
            <Col md>
              <InputGroup size="sm">
                <InputGroup.Text><i className="bi bi-search" /></InputGroup.Text>
                <Form.Control
                  placeholder="Search by program or brand…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                {search && (
                  <button className="btn btn-outline-secondary btn-sm" type="button" onClick={() => setSearch('')}>
                    <i className="bi bi-x-lg" />
                  </button>
                )}
              </InputGroup>
            </Col>
            <Col md="auto">
              <Form.Select size="sm" value={brandFilter} onChange={e => setBrandFilter(e.target.value)}>
                <option value="">All brands</option>
                {brands.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Form.Select>
            </Col>
            <Col md="auto">
              <Form.Select size="sm" value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as StatusFilter)}>
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="ended">Ended</option>
                <option value="all_posted">All videos posted</option>
                <option value="payment_pending">Payment pending</option>
              </Form.Select>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {programs.length === 0 ? (
        <Card body className="text-center py-5">
          <div style={{ fontSize: '2.5rem' }} className="mb-2 text-primary"><i className="bi bi-rocket-takeoff" /></div>
          <h5 className="mb-1">No programs yet</h5>
          <p className="text-muted small mb-0">
            Start a new program from any of your assigned brands.
          </p>
        </Card>
      ) : filteredPrograms.length === 0 ? (
        <Card body className="text-muted text-center">
          No programs match your filters.
        </Card>
      ) : (
        <Row className="g-3">
          {filteredPrograms.map(p => {
            const s = summaries.get(p.id);
            if (!s) return null;
            const b = brandById.get(p.brand_id);
            return (
              <Col md={6} lg={4} key={p.id}>
                <ProgramCard
                  summary={s}
                  brandName={b?.name}
                  onClick={() => nav(`/paid-collab/programs/${p.id}`)}
                />
              </Col>
            );
          })}
        </Row>
      )}
    </>
  );
}
