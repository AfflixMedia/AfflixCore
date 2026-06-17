import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Spinner, Alert, Form, InputGroup, Row, Col, Badge, Button } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import {
  PaidProgram, PaidCreator, PaidVideo, BrandProduct,
  programDisplayName,
} from '../../lib/paidCollabSchema';

import { useClientPaidCollabData, Brand } from './useClientPaidCollabData';

type UrlFilter = 'all' | 'with_url' | 'no_url';

export default function PaidCollabVideos() {
  const nav = useNavigate();
  const { brands, programs, creators, videos, loading, err } = useClientPaidCollabData();

  const [search, setSearch] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [programFilter, setProgramFilter] = useState('');
  const [urlFilter, setUrlFilter] = useState<UrlFilter>('all');

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
  // Removed productById since products is no longer fetched

  const programOptions = useMemo(() => {
    if (!brandFilter) return programs;
    return programs.filter(p => p.brand_id === brandFilter);
  }, [programs, brandFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return videos.filter(v => {
      const cr = creatorById.get(v.creator_id);
      if (!cr) return false;
      const prog = programById.get(cr.program_id);
      if (!prog) return false;
      const b = brandById.get(prog.brand_id);
      if (brandFilter && prog.brand_id !== brandFilter) return false;
      if (programFilter && prog.id !== programFilter) return false;
      if (urlFilter === 'with_url' && !v.tiktok_url) return false;
      if (urlFilter === 'no_url' && v.tiktok_url) return false;
      if (search) {
        const q = search.toLowerCase();
        const bName = b?.name || '';
        const hay = `${v.tiktok_url ?? ''} ${v.notes ?? ''} ${cr.name} ${cr.handle ?? ''} ${bName} ${programDisplayName(prog)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [videos, creatorById, programById, brandById, brandFilter, programFilter, urlFilter, search]);

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;

  // Every video counts as live; pipeline = agreed videos not yet delivered.
  const totalLive = videos.length;
  const videoCountByCreator = new Map<string, number>();
  videos.forEach(v => videoCountByCreator.set(v.creator_id, (videoCountByCreator.get(v.creator_id) ?? 0) + 1));
  const totalPipeline = creators
    .filter(c => c.status !== 'dropped')
    .reduce((s, c) => s + Math.max(0, (c.agreed_videos || 0) - (videoCountByCreator.get(c.id) ?? 0)), 0);

  return (
    <>
      <div className="ac-page-header">
        <h2 className="mb-0">Videos</h2>
      </div>

      <Card className="mb-3">
        <Card.Body className="d-flex flex-wrap align-items-center gap-3">
          <div>
            <div className="text-muted small">Total</div>
            <div className="fs-4 fw-bold">{videos.length}</div>
          </div>
          <div>
            <div className="text-muted small">In pipeline</div>
            <div className="fs-4 fw-bold" style={{ color: '#fd7e14' }}>{totalPipeline}</div>
          </div>
          <div>
            <div className="text-muted small">Live</div>
            <div className="fs-4 fw-bold" style={{ color: '#198754' }}>{totalLive}</div>
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
                  placeholder="Search by URL, creator, brand, program, product…"
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
              <Form.Select size="sm" value={brandFilter}
                onChange={e => { setBrandFilter(e.target.value); setProgramFilter(''); }}>
                <option value="">All brands</option>
                {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Form.Select>
            </Col>
            <Col md="auto">
              <Form.Select size="sm" value={programFilter}
                onChange={e => setProgramFilter(e.target.value)}>
                <option value="">All programs</option>
                {programOptions.map(p => (
                  <option key={p.id} value={p.id}>{programDisplayName(p)}</option>
                ))}
              </Form.Select>
            </Col>
            <Col md="auto">
              <Form.Select size="sm" value={urlFilter}
                onChange={e => setUrlFilter(e.target.value as UrlFilter)}>
                <option value="all">URL: any</option>
                <option value="with_url">With TikTok URL</option>
                <option value="no_url">Missing URL</option>
              </Form.Select>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {videos.length === 0 ? (
        <Card body className="text-center text-muted py-5">
          <i className="bi bi-collection-play fs-1 d-block mb-2 opacity-50" />
          No videos yet across your brands.
        </Card>
      ) : filtered.length === 0 ? (
        <Card body className="text-muted text-center">
          No videos match your filters.
        </Card>
      ) : (
        <div className="d-flex flex-column gap-2">
          {filtered.map(v => {
            const cr = creatorById.get(v.creator_id);
            const prog = cr ? programById.get(cr.program_id) : null;
            const b = prog ? brandById.get(prog.brand_id) : null;
            const prod = null as any;
            return (
              <Card key={v.id} className="shadow-sm">
                <Card.Body className="d-flex gap-3 align-items-start flex-wrap">
                  <div
                    className="d-flex align-items-center justify-content-center rounded text-white flex-shrink-0"
                    style={{ width: 44, height: 44, backgroundColor: '#198754' }}
                  >
                    <i className="bi bi-broadcast fs-5" />
                  </div>
                  <div className="flex-grow-1 min-w-0">
                    <div className="d-flex align-items-center gap-2 flex-wrap mb-1">
                      <Badge bg="success">Live</Badge>
                      {prod ? (
                        <Badge bg="primary"><i className="bi bi-tag-fill me-1" />{prod.name}</Badge>
                      ) : v.product_id ? (
                        <Badge bg="secondary"><i className="bi bi-tag me-1" />Removed product</Badge>
                      ) : (
                        <Badge bg="light" text="dark" className="border">
                          <i className="bi bi-exclamation-circle me-1" />No product
                        </Badge>
                      )}
                      {v.posted_on && (
                        <Badge bg="light" text="dark" className="border">
                          <i className="bi bi-calendar me-1" />{new Date(v.posted_on + 'T00:00:00').toLocaleDateString()}
                        </Badge>
                      )}
                    </div>
                    <div className="fw-semibold">
                      {v.tiktok_url ? (
                        <a href={v.tiktok_url} target="_blank" rel="noreferrer">
                          <i className="bi bi-tiktok me-1" />
                          <span className="text-truncate" style={{ maxWidth: 480, display: 'inline-block', verticalAlign: 'middle' }}>
                            {v.tiktok_url}
                          </span>
                        </a>
                      ) : (
                        <span className="text-muted fst-italic">No TikTok URL yet</span>
                      )}
                    </div>
                    <div className="small text-muted mt-1">
                      <strong>{cr?.name ?? '—'}</strong>
                      {cr?.handle && <span> · <i className="bi bi-at" />{cr.handle.replace(/^@/, '')}</span>}
                      <span className="mx-2">·</span>
                      {b?.name ?? '—'}
                      <span className="mx-2">·</span>
                      {prog ? programDisplayName(prog) : '—'}
                    </div>
                    {v.notes && (
                      <div className="small mt-1 text-muted" style={{ whiteSpace: 'pre-wrap' }}>
                        {v.notes}
                      </div>
                    )}
                  </div>
                  <div>
                    {prog && (
                      <Button size="sm" variant="outline-primary"
                        onClick={() => nav(`/paid-collab/programs/${prog.id}`)}
                        title="Open the program">
                        <i className="bi bi-box-arrow-up-right" />
                      </Button>
                    )}
                  </div>
                </Card.Body>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
