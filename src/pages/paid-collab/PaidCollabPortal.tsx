import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Spinner, Alert, Form, InputGroup, Badge, Row, Col } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import {
  PaidProgram, PaidCreator, PaidVideo, summarizePrograms, fmtNumber,
} from '../../lib/paidCollabSchema';
import { useClientPaidCollabData, Brand } from './useClientPaidCollabData';

interface BrandOverview {
  brand: Brand;
  activePrograms: number;
  endedPrograms: number;
  totalCreators: number;
  videosLive: number;
  videosPipeline: number;
  paymentPending: number;
}

type StatusFilter = 'all' | 'has_pending' | 'has_active' | 'closed';

export default function PaidCollabPortal() {
  const { brands, programs, creators, videos, loading, err } = useClientPaidCollabData();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const overviews = useMemo<BrandOverview[]>(() => {
    const summaries = summarizePrograms(programs, creators, videos);
    const programsByBrand = new Map<string, PaidProgram[]>();
    for (const p of programs) {
      const arr = programsByBrand.get(p.brand_id) ?? [];
      arr.push(p);
      programsByBrand.set(p.brand_id, arr);
    }
    return brands.map(b => {
      const bp = programsByBrand.get(b.id) ?? [];
      let activePrograms = 0, endedPrograms = 0, totalCreators = 0;
      let videosLive = 0, videosPipeline = 0, paymentPending = 0;
      for (const p of bp) {
        const s = summaries.get(p.id);
        if (!s) continue;
        if (p.ended_at) endedPrograms += 1; else activePrograms += 1;
        totalCreators   += s.creatorCount;
        videosLive      += s.videosLive;
        videosPipeline  += s.videosPipeline;
        paymentPending  += s.paymentPending;
      }
      return { brand: b, activePrograms, endedPrograms, totalCreators, videosLive, videosPipeline, paymentPending };
    });
  }, [brands, programs, creators, videos]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return overviews.filter(o => {
      if (q) {
        const hay = `${o.brand.name} ${o.brand.client}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter === 'has_pending' && o.paymentPending === 0) return false;
      if (statusFilter === 'has_active' && o.activePrograms === 0) return false;
      if (statusFilter === 'closed' && o.brand.client_status !== 'closed') return false;
      return true;
    });
  }, [overviews, search, statusFilter]);

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;

  const totalPending = overviews.reduce((s, o) => s + o.paymentPending, 0);

  return (
    <>
      <div className="ac-page-header">
        <div className="d-flex align-items-center gap-3 flex-wrap">
          <h2 className="mb-0">Brands</h2>
          {totalPending > 0 && (
            <span className="ac-payment-pending-badge d-inline-flex align-items-center gap-2 px-2 py-1 rounded"
                  style={{ backgroundColor: '#e8862e', color: '#fff' }}>
              <i className="bi bi-cash-stack" />
              <strong>{totalPending} payment{totalPending === 1 ? '' : 's'} pending</strong>
            </span>
          )}
        </div>
      </div>

      {brands.length === 0 ? (
        <Card>
          <Card.Body>
            <div className="ac-empty">
              <div className="ac-empty-icon"><i className="bi bi-shop" /></div>
              <h5>No brands assigned yet</h5>
              <p>Your account hasn't been assigned to any brands. Reach out to your contact at Afflix Media.</p>
            </div>
          </Card.Body>
        </Card>
      ) : (
        <>
          {/* Search + filter */}
          <Card className="mb-3">
            <Card.Body className="py-2">
              <Row className="g-2 align-items-center">
                <Col md>
                  <InputGroup size="sm">
                    <InputGroup.Text><i className="bi bi-search" /></InputGroup.Text>
                    <Form.Control
                      placeholder="Search brands or clients…"
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
                  <Form.Select size="sm" value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value as StatusFilter)}>
                    <option value="all">All brands</option>
                    <option value="has_active">With active programs</option>
                    <option value="has_pending">With payments pending</option>
                    <option value="closed">Closed brands</option>
                  </Form.Select>
                </Col>
              </Row>
            </Card.Body>
          </Card>

          {filtered.length === 0 ? (
            <Card body className="text-muted text-center py-4">
              No brands match your search.
            </Card>
          ) : (
            <Row className="g-3">
              {filtered.map(o => {
                const isClosed = o.brand.client_status === 'closed';
                const accent = o.paymentPending > 0 ? '#e8862e' : (o.activePrograms > 0 ? '#198754' : '#6c757d');
                return (
                  <Col md={6} lg={4} key={o.brand.id}>
                    <Link to={`/paid-collab/brands/${o.brand.id}`}
                      className="text-decoration-none text-reset">
                      <Card
                        className={`h-100 shadow-sm ${o.paymentPending > 0 ? 'ac-payment-pending-card' : ''}`}
                        style={{
                          cursor: 'pointer',
                          borderLeft: `4px solid ${accent}`,
                          transition: 'transform .15s, box-shadow .15s',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; }}
                      >
                        <Card.Body className="d-flex flex-column">
                          <div className="d-flex align-items-start justify-content-between gap-2 mb-2">
                            <div className="flex-grow-1 min-w-0">
                              <div className="text-muted small">{o.brand.client}</div>
                              <div className="fs-5 fw-semibold text-truncate">{o.brand.name}</div>
                            </div>
                            <div className="d-flex flex-column align-items-end gap-1">
                              {isClosed && <Badge bg="dark"><i className="bi bi-archive me-1" />Closed</Badge>}
                              {o.activePrograms > 0
                                ? <Badge bg="success">{o.activePrograms} active</Badge>
                                : <Badge bg="secondary">No active</Badge>}
                            </div>
                          </div>

                          {o.paymentPending > 0 && (
                            <div className="ac-payment-pending-badge mb-2 d-inline-flex align-items-center gap-2 px-2 py-1 rounded align-self-start"
                                 style={{ backgroundColor: '#e8862e', color: '#fff', fontSize: '.8rem' }}>
                              <i className="bi bi-cash-stack" />
                              <strong>{o.paymentPending} payment{o.paymentPending === 1 ? '' : 's'} pending</strong>
                            </div>
                          )}

                          <div className="row g-2 mt-auto small">
                            <div className="col-4">
                              <div className="text-muted" style={{ fontSize: '.7rem' }}>Programs</div>
                              <div className="fw-bold">{fmtNumber(o.activePrograms + o.endedPrograms)}</div>
                            </div>
                            <div className="col-4">
                              <div className="text-muted" style={{ fontSize: '.7rem' }}>Creators</div>
                              <div className="fw-bold">{fmtNumber(o.totalCreators)}</div>
                            </div>
                            <div className="col-4">
                              <div className="text-muted" style={{ fontSize: '.7rem' }}>Pipeline / Live</div>
                              <div className="fw-bold">
                                <span style={{ color: '#fd7e14' }}>{fmtNumber(o.videosPipeline)}</span>
                                <span className="text-muted mx-1">/</span>
                                <span style={{ color: '#198754' }}>{fmtNumber(o.videosLive)}</span>
                              </div>
                            </div>
                          </div>
                        </Card.Body>
                      </Card>
                    </Link>
                  </Col>
                );
              })}
            </Row>
          )}
        </>
      )}
    </>
  );
}
