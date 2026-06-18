import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Spinner, Alert, Button, Badge, Card, Row, Col, Form } from 'react-bootstrap';
import { summarizePrograms } from '../../lib/paidCollabSchema';
import ProgramCard from '../../components/paidcollab/ProgramCard';
import PaymentControlsTab from '../../components/paidcollab/PaymentControlsTab';
import { useAuth } from '../../auth/AuthContext';

import { useClientPaidCollabData } from './useClientPaidCollabData';

export default function PaidCollabBrandView() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { profile } = useAuth();
  const isHandler = profile?.role === 'paid_collab_handler';
  const isBob = profile?.role === 'bob';
  const [section, setSection] = useState<'programs' | 'payments'>('programs');

  const { brands: allBrands, programs: allPrograms, creators: allCreators, videos: allVideos, loading, err } = useClientPaidCollabData();

  const brand = useMemo(() => allBrands.find(b => b.id === id) || null, [allBrands, id]);
  const programs = useMemo(() => allPrograms.filter(p => p.brand_id === id), [allPrograms, id]);
  const creators = useMemo(() => allCreators.filter(c => programs.some(p => p.id === c.program_id)), [allCreators, programs]);
  const videos = useMemo(() => allVideos.filter(v => creators.some(c => c.id === v.creator_id)), [allVideos, creators]);

  const [filter, setFilter] = useState<'all' | 'active' | 'ended' | 'pending'>('all');

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
          <p className="text-muted small mb-0">
            {brandActive
              ? 'No programs have been added for this brand yet. Programs are managed in the handler workspace.'
              : 'This brand has no paid collab programs.'}
          </p>
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
    </>
  );
}
