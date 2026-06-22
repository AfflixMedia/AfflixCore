import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Spinner, Alert, Form, InputGroup, Row, Col } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import {
  PaidProgram, PaidCreator, PaidVideo, summarizePrograms, programDisplayName,
  programPeriodLabel, isProgramEnded, fmtMoney, fmtNumber,
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

type StatusFilter =
  | 'all'
  | 'active'
  | 'ended'
  | 'all_posted'        // every active creator has hit their agreed-videos count
  | 'payment_pending';  // at least one creator awaiting payment

export default function PaidCollabPrograms() {
  const nav = useNavigate();
  const { brands, programs, creators, videos, loading, err } = useClientPaidCollabData();
  const { profile } = useAuth();
  // Handler sees every pending creator; client only sees pending toggled visible.
  const revealPending = profile?.role === 'paid_collab_handler';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [brandFilter, setBrandFilter] = useState<string>('');

  const brandById = useMemo(() => {
    const m = new Map<string, Brand>();
    for (const b of brands) m.set(b.id, b);
    return m;
  }, [brands]);

  const summaries = useMemo(
    () => summarizePrograms(programs, creators, videos),
    [programs, creators, videos],
  );

  // Role-aware payment-pending count per program (overrides summary.paymentPending,
  // which uses the legacy heuristic and ignores pending_visible_to_client).
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
    const q = search.trim().toLowerCase();
    return programs.filter(p => {
      const s = summaries.get(p.id);
      const b = brandById.get(p.brand_id);
      if (brandFilter && p.brand_id !== brandFilter) return false;
      if (statusFilter === 'active' && p.ended_at) return false;
      if (statusFilter === 'ended' && !p.ended_at) return false;
      if (statusFilter === 'all_posted' && !(s?.allVideosPosted)) return false;
      if (statusFilter === 'payment_pending' && (pendingByProgram.get(p.id) ?? 0) === 0) return false;
      if (q) {
        const hay = `${programDisplayName(p)} ${b?.name ?? ''} ${b?.client ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [programs, summaries, brandById, search, statusFilter, brandFilter, pendingByProgram]);

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;

  const totalActive = programs.filter(p => !p.ended_at).length;
  const totalEnded = programs.length - totalActive;
  const totalPending = [...pendingByProgram.values()].reduce((a, b) => a + b, 0);

  return (
    <>
      <div className="ac-page-header">
        <h2 className="mb-0">Programs</h2>
      </div>

      <div className="pct-pills">
        <FilterPill label="Total" value={programs.length} active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
        <FilterPill label="Active" value={totalActive} tone="green" active={statusFilter === 'active'} onClick={() => setStatusFilter(f => f === 'active' ? 'all' : 'active')} />
        <FilterPill label="Ended" value={totalEnded} tone="grey" active={statusFilter === 'ended'} onClick={() => setStatusFilter(f => f === 'ended' ? 'all' : 'ended')} />
        {totalPending > 0 && (
          <FilterPill label="Payments pending" value={totalPending} tone="orange" active={statusFilter === 'payment_pending'} onClick={() => setStatusFilter(f => f === 'payment_pending' ? 'all' : 'payment_pending')} />
        )}
      </div>

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
            const b = brandById.get(p.brand_id);
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
                    <span className="pct-ava" style={{ background: pctGradient(b?.name || programDisplayName(p)) }}>{pctInitials(b?.name || programDisplayName(p))}</span>
                    <div className="pct-idtext">
                      <div className="pct-name">{programDisplayName(p)}</div>
                      <div className="pct-sub">{b?.name ? <>{b.name}<span className="sep"> · </span></> : ''}{programPeriodLabel(p)}</div>
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
                    <span className="pct-ava" style={{ background: pctGradient(b?.name || programDisplayName(p)) }}>{pctInitials(b?.name || programDisplayName(p))}</span>
                    <div className="pct-mc-idblock">
                      <div className="pct-mc-name">{programDisplayName(p)}</div>
                      <div className="pct-mc-sub">{b?.name ? `${b.name} · ` : ''}{programPeriodLabel(p)}</div>
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
    </>
  );
}
