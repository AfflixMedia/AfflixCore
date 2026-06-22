import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Spinner, Alert, Button, Badge, Card, Row, Col, Form } from 'react-bootstrap';
import {
  summarizePrograms, programDisplayName, programPeriodLabel, isProgramEnded,
  fmtMoney, fmtNumber,
} from '../../lib/paidCollabSchema';
import PaymentControlsTab from '../../components/paidcollab/PaymentControlsTab';
import { useAuth } from '../../auth/AuthContext';

import { useClientPaidCollabData, isPaidCollabPendingVisible } from './useClientPaidCollabData';
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
  // Handler/Bob see every pending creator; client only sees pending toggled visible.
  const revealPending = isHandler || isBob;

  const summaries = useMemo(
    () => summarizePrograms(programs, creators, videos),
    [programs, creators, videos],
  );

  // Role-aware payment-pending count per program (overrides the legacy summary count).
  const pendingByProgram = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of creators) {
      if (isPaidCollabPendingVisible(c, revealPending)) {
        m.set(c.program_id, (m.get(c.program_id) ?? 0) + 1);
      }
    }
    return m;
  }, [creators, revealPending]);

  const filteredPrograms = useMemo(() => {
    return programs.filter(p => {
      if (filter === 'active' && p.ended_at) return false;
      if (filter === 'ended' && !p.ended_at) return false;
      if (filter === 'pending' && (pendingByProgram.get(p.id) ?? 0) === 0) return false;
      return true;
    });
  }, [programs, filter, pendingByProgram]);

  const brandActive = brand?.client_status !== 'closed';

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;
  if (!brand) return null;

  const activeCount = programs.filter(p => !p.ended_at).length;
  const endedCount = programs.length - activeCount;
  const pendingCount = [...pendingByProgram.values()].reduce((a, b) => a + b, 0);

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
      <div className="d-flex flex-wrap align-items-center gap-3 mb-3">
        <div className="pct-pills mb-0">
          <FilterPill label="Active" value={activeCount} tone="green" active={filter === 'active'} onClick={() => setFilter(f => f === 'active' ? 'all' : 'active')} />
          <FilterPill label="Ended" value={endedCount} tone="grey" active={filter === 'ended'} onClick={() => setFilter(f => f === 'ended' ? 'all' : 'ended')} />
          {pendingCount > 0 && (
            <FilterPill label="Payments pending" value={pendingCount} tone="orange" active={filter === 'pending'} onClick={() => setFilter(f => f === 'pending' ? 'all' : 'pending')} />
          )}
        </div>
        <Form.Select size="sm" value={filter} onChange={e => setFilter(e.target.value as any)} style={{ width: 200, marginLeft: 'auto' }}>
          <option value="all">All programs</option>
          <option value="active">Active only</option>
          <option value="ended">Ended only</option>
          <option value="pending">Payments pending</option>
        </Form.Select>
      </div>

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
        <div className="pct pct--programs">
          <div className="pct-head">
            <div className="pct-num">#</div>
            <div>Program</div>
            <div className="pct-num">Creators</div>
            <div className="pct-num">Pipeline / Live</div>
            <div className="pct-num">Spent</div>
            <div>Status</div>
            <div />
          </div>
          {filteredPrograms.map((p, i) => {
            const s = summaries.get(p.id);
            if (!s) return null;
            const ended = isProgramEnded(p);
            const cur = p.currency || 'USD';
            const pend = pendingByProgram.get(p.id) ?? 0;
            const go = () => nav(`/paid-collab/programs/${p.id}`);
            const status = (
              <div className="pct-statuscell">
                {ended
                  ? <span className="pct-pill-s ended"><span className="dot" />Ended</span>
                  : <span className="pct-pill-s active"><span className="dot" />Active</span>}
                {pend > 0 && <span className="pct-tag pend"><i className="bi bi-cash-stack" />{pend} pending</span>}
                {s.allVideosPosted && pend === 0 && !ended && <span className="pct-tag posted"><i className="bi bi-check2-circle" />All posted</span>}
              </div>
            );
            return (
              <div className={`pct-row ${pend > 0 ? 'pending' : ''}`} key={p.id}
                role="button" tabIndex={0} onClick={go} onKeyDown={e => { if (e.key === 'Enter') go(); }}>
                <div className="pct-cell pct-num"><span className="pct-idx">#{i + 1}</span></div>
                <div className="pct-cell">
                  <div className="pct-id">
                    <span className="pct-ava" style={{ background: pctGradient(programDisplayName(p)) }}>{pctInitials(programDisplayName(p))}</span>
                    <div className="pct-idtext">
                      <div className="pct-name">{programDisplayName(p)}</div>
                      <div className="pct-sub">{programPeriodLabel(p)}</div>
                    </div>
                  </div>
                </div>
                <div className="pct-cell pct-num"><span className="pct-big">{fmtNumber(s.creatorCount)}</span></div>
                <div className="pct-cell pct-num"><span className="pct-pl"><span className="pipe">{fmtNumber(s.videosPipeline)}</span><span className="sep">/</span><span className="live">{fmtNumber(s.videosLive)}</span></span></div>
                <div className="pct-cell pct-num"><span className="pct-money">{fmtMoney(s.spent, cur)}<span className="of"> / {fmtMoney(Number(p.total_budget || 0), cur)}</span></span></div>
                <div className="pct-cell">{status}</div>
                <div className="pct-cell pct-chev">{pctChevron}</div>

                {/* mobile card */}
                <div className="pct-mc">
                  <div className="pct-mc-head">
                    <span className="pct-ava" style={{ background: pctGradient(programDisplayName(p)) }}>{pctInitials(programDisplayName(p))}</span>
                    <div className="pct-mc-idblock">
                      <div className="pct-mc-name">{programDisplayName(p)}</div>
                      <div className="pct-mc-sub">{programPeriodLabel(p)}</div>
                    </div>
                    <span className="pct-mc-chev">{pctChevron}</span>
                  </div>
                  <div className="pct-mc-stats">
                    <div className="pct-mc-stat"><b>{fmtNumber(s.creatorCount)}</b><span>Creators</span></div>
                    <div className="pct-mc-stat"><b>{fmtNumber(s.videosPipeline)}/{fmtNumber(s.videosLive)}</b><span>Pipe/Live</span></div>
                    <div className="pct-mc-stat"><b>{fmtMoney(s.spent, cur)}</b><span>Spent</span></div>
                  </div>
                  <div className="pct-mc-foot">{status}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      </>)}
    </>
  );
}
