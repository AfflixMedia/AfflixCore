import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Spinner, Alert, Form, InputGroup, Badge, Row, Col } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import {
  PaidProgram, PaidCreator, PaidVideo, summarizePrograms, fmtNumber,
} from '../../lib/paidCollabSchema';
import { useClientPaidCollabData, Brand, isPaidCollabPendingVisible } from './useClientPaidCollabData';
import { useAuth } from '../../auth/AuthContext';
import FilterPill from './FilterPill';
import './portalTables.css';

const PCT_GRADIENTS = [
  'linear-gradient(135deg,#6366F1,#8B5CF6)', 'linear-gradient(135deg,#EC4899,#F43F5E)',
  'linear-gradient(135deg,#14B8A6,#06B6D4)', 'linear-gradient(135deg,#F59E0B,#EF4444)',
  'linear-gradient(135deg,#10B981,#059669)', 'linear-gradient(135deg,#3B82F6,#2563EB)',
  'linear-gradient(135deg,#8B5CF6,#EC4899)',
];
const pctGradient = (name: string) => (name ? PCT_GRADIENTS[name.charCodeAt(0) % PCT_GRADIENTS.length] : PCT_GRADIENTS[0]);
const pctInitials = (name: string) =>
  (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
const pctChevron = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
);

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
  const nav = useNavigate();
  const { profile } = useAuth();
  // Handler sees every pending creator; client only sees pending toggled visible.
  const revealPending = profile?.role === 'paid_collab_handler';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Role-aware payment-pending count per program (overrides the legacy summary count,
  // which ignores pending_visible_to_client).
  const pendingByProgram = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of creators) {
      if (isPaidCollabPendingVisible(c, revealPending)) {
        m.set(c.program_id, (m.get(c.program_id) ?? 0) + 1);
      }
    }
    return m;
  }, [creators, revealPending]);

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
        paymentPending  += pendingByProgram.get(p.id) ?? 0;
      }
      return { brand: b, activePrograms, endedPrograms, totalCreators, videosLive, videosPipeline, paymentPending };
    });
  }, [brands, programs, creators, videos, pendingByProgram]);

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
          <div className="pct-pills">
            <FilterPill label="Brands" value={brands.length} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
            <FilterPill label="Active programs" value={overviews.reduce((s, o) => s + o.activePrograms, 0)} tone="green"
              active={statusFilter === 'has_active'} onClick={() => setStatusFilter(f => f === 'has_active' ? 'all' : 'has_active')} />
            {totalPending > 0 && (
              <FilterPill label="Payments pending" value={totalPending} tone="orange"
                active={statusFilter === 'has_pending'} onClick={() => setStatusFilter(f => f === 'has_pending' ? 'all' : 'has_pending')} />
            )}
          </div>

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
            <div className="pct pct--brands">
              <div className="pct-head">
                <div className="pct-num">#</div>
                <div>Brand</div>
                <div className="pct-num">Programs</div>
                <div className="pct-num">Creators</div>
                <div className="pct-num">Pipeline / Live</div>
                <div>Status</div>
                <div />
              </div>
              {filtered.map((o, i) => {
                const isClosed = o.brand.client_status === 'closed';
                const totalProgs = o.activePrograms + o.endedPrograms;
                // Client → new Programs page filtered to this brand; handler keeps the
                // brand view (it has their Payments controls tab).
                const go = () => nav(
                  revealPending
                    ? `/paid-collab/brands/${o.brand.id}`
                    : `/paid-collab/programs?brand=${o.brand.id}`,
                );
                const status = (
                  <div className="pct-statuscell">
                    {isClosed
                      ? <span className="pct-pill-s closed"><i className="bi bi-archive" />Closed</span>
                      : o.activePrograms > 0
                        ? <span className="pct-pill-s active"><span className="dot" />{o.activePrograms} active</span>
                        : <span className="pct-pill-s ended"><span className="dot" />No active</span>}
                    {o.paymentPending > 0 && <span className="pct-tag pend"><i className="bi bi-cash-stack" />{o.paymentPending} pending</span>}
                  </div>
                );
                return (
                  <div className={`pct-row ${o.paymentPending > 0 ? 'pending' : ''}`} key={o.brand.id}
                    role="button" tabIndex={0} onClick={go} onKeyDown={e => { if (e.key === 'Enter') go(); }}>
                    <div className="pct-cell pct-num"><span className="pct-idx">#{i + 1}</span></div>
                    <div className="pct-cell">
                      <div className="pct-id">
                        <span className="pct-ava" style={{ background: pctGradient(o.brand.name) }}>{pctInitials(o.brand.name)}</span>
                        <div className="pct-idtext">
                          <div className="pct-name">{o.brand.name}</div>
                          <div className="pct-sub">{o.brand.client || '—'}</div>
                        </div>
                      </div>
                    </div>
                    <div className="pct-cell pct-num"><span className="pct-big">{fmtNumber(totalProgs)}</span></div>
                    <div className="pct-cell pct-num"><span className="pct-big">{fmtNumber(o.totalCreators)}</span></div>
                    <div className="pct-cell pct-num"><span className="pct-pl"><span className="pipe">{fmtNumber(o.videosPipeline)}</span><span className="sep">/</span><span className="live">{fmtNumber(o.videosLive)}</span></span></div>
                    <div className="pct-cell">{status}</div>
                    <div className="pct-cell pct-chev">{pctChevron}</div>

                    {/* mobile card */}
                    <div className="pct-mc">
                      <div className="pct-mc-head">
                        <span className="pct-ava" style={{ background: pctGradient(o.brand.name) }}>{pctInitials(o.brand.name)}</span>
                        <div className="pct-mc-idblock">
                          <div className="pct-mc-name">{o.brand.name}</div>
                          <div className="pct-mc-sub">{o.brand.client || '—'}</div>
                        </div>
                        <span className="pct-mc-chev">{pctChevron}</span>
                      </div>
                      <div className="pct-mc-stats">
                        <div className="pct-mc-stat"><b>{fmtNumber(totalProgs)}</b><span>Programs</span></div>
                        <div className="pct-mc-stat"><b>{fmtNumber(o.totalCreators)}</b><span>Creators</span></div>
                        <div className="pct-mc-stat"><b>{fmtNumber(o.videosPipeline)}/{fmtNumber(o.videosLive)}</b><span>Pipe/Live</span></div>
                      </div>
                      <div className="pct-mc-foot">{status}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}
