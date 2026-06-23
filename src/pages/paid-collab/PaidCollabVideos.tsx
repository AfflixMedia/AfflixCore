import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Spinner, Alert, Form, InputGroup, Row, Col, Badge, Button } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import {
  PaidProgram, PaidCreator, PaidVideo, BrandProduct,
  programDisplayName,
} from '../../lib/paidCollabSchema';

import { useClientPaidCollabData, Brand } from './useClientPaidCollabData';
import './portalTables.css';

type UrlFilter = 'all' | 'with_url' | 'no_url';

const PCT_GRADIENTS = [
  'linear-gradient(135deg,#6366F1,#8B5CF6)', 'linear-gradient(135deg,#EC4899,#F43F5E)',
  'linear-gradient(135deg,#14B8A6,#06B6D4)', 'linear-gradient(135deg,#F59E0B,#EF4444)',
  'linear-gradient(135deg,#10B981,#059669)', 'linear-gradient(135deg,#3B82F6,#2563EB)',
  'linear-gradient(135deg,#8B5CF6,#EC4899)',
];
const pctGradient = (name: string) => (name ? PCT_GRADIENTS[name.charCodeAt(0) % PCT_GRADIENTS.length] : PCT_GRADIENTS[0]);
const pctInitials = (name: string) =>
  (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
function pctCopy(t: string) {
  try { if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(t); return; } } catch { /* ignore */ }
  try { const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); } catch { /* ignore */ }
}

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

      <div className="pct-pills">
        <div className="pct-pill pct-pill--static"><span className="pct-pill-l">Total</span><span className="pct-pill-v">{videos.length}</span></div>
        <div className="pct-pill pct-pill--static"><span className="pct-pill-l">In pipeline</span><span className="pct-pill-v orange">{totalPipeline}</span></div>
        <div className="pct-pill pct-pill--static"><span className="pct-pill-l">Live</span><span className="pct-pill-v green">{totalLive}</span></div>
      </div>

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
        <div className="pct pct--videos">
          <div className="pct-head">
            <div className="pct-num">#</div>
            <div>Video</div>
            <div>Creator</div>
            <div>Brand · Program</div>
            <div>Ad code</div>
            <div />
          </div>
          {filtered.map((v, i) => {
            const cr = creatorById.get(v.creator_id);
            const prog = cr ? programById.get(cr.program_id) : null;
            const b = prog ? brandById.get(prog.brand_id) : null;
            const adCode = (v as any).ad_code as string | null;
            const authorised = !!(v as any).ad_code_authorized;
            // Broadcast icon colour reflects ad-code authorisation: green when
            // authorised, orange otherwise.
            const iconBg = authorised ? '#198754' : '#fd7e14';
            const posted = v.posted_on ? new Date(v.posted_on + 'T00:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) : null;
            return (
              <div className="pct-row" key={v.id}>
                <div className="pct-cell pct-num"><span className="pct-idx">#{i + 1}</span></div>
                <div className="pct-cell">
                  <div className="pct-id">
                    <span className="pct-ava" style={{ background: iconBg, borderRadius: 11 }} title={authorised ? 'Ad code authorised' : 'Ad code not authorised'}><i className="bi bi-broadcast" /></span>
                    <div className="pct-idtext">
                      <div className="pct-name">
                        {v.tiktok_url
                          ? <a className="pct-vlink" href={v.tiktok_url} target="_blank" rel="noreferrer" title={v.tiktok_url}><i className="bi bi-tiktok" /><span>{v.tiktok_url}</span></a>
                          : <span className="pct-muted">No TikTok URL yet</span>}
                      </div>
                      <div className="pct-sub"><span className="pct-live"><span className="dot" />Live</span>{posted && <> · {posted}</>}{authorised && <> · <i className="bi bi-shield-check" style={{ color: '#198754' }} /> auth</>}</div>
                    </div>
                  </div>
                </div>
                <div className="pct-cell">
                  <div className="pct-id">
                    <span className="pct-ava" style={{ background: pctGradient(cr?.name || '?'), width: 30, height: 30, fontSize: 12, borderRadius: 9 }}>{pctInitials(cr?.name || '?')}</span>
                    <div className="pct-idtext">
                      <div className="pct-name">{cr?.name ?? '—'}</div>
                      {cr?.handle && <div className="pct-sub">@{cr.handle.replace(/^@/, '')}</div>}
                    </div>
                  </div>
                </div>
                <div className="pct-cell">
                  <div className="pct-idtext">
                    <div className="pct-name">{b?.name ?? '—'}</div>
                    <div className="pct-sub">{prog ? programDisplayName(prog) : '—'}</div>
                  </div>
                </div>
                <div className="pct-cell">
                  {adCode
                    ? <div className="pct-code"><code title={adCode}>{adCode}</code><button type="button" className="pct-copy" title="Copy ad code" onClick={() => pctCopy(adCode)}><i className="bi bi-clipboard" /></button></div>
                    : <span className="pct-muted">—</span>}
                </div>
                <div className="pct-cell pct-num">
                  {prog && (
                    <a className="pct-open" title="Open the program" onClick={e => { e.preventDefault(); nav(`/paid-collab/programs/${prog.id}`); }} href={`/paid-collab/programs/${prog.id}`}>
                      <i className="bi bi-box-arrow-up-right" />
                    </a>
                  )}
                </div>

                {/* mobile card */}
                <div className="pct-mc">
                  <div className="pct-mc-head">
                    <span className="pct-ava" style={{ background: iconBg, borderRadius: 11 }} title={authorised ? 'Ad code authorised' : 'Ad code not authorised'}><i className="bi bi-broadcast" /></span>
                    <div className="pct-mc-idblock">
                      <div className="pct-mc-name">
                        {v.tiktok_url
                          ? <a className="pct-vlink" href={v.tiktok_url} target="_blank" rel="noreferrer"><i className="bi bi-tiktok" /><span>{v.tiktok_url}</span></a>
                          : <span className="pct-muted">No TikTok URL</span>}
                      </div>
                      <div className="pct-mc-sub">{cr?.name ?? '—'}{cr?.handle ? ` · @${cr.handle.replace(/^@/, '')}` : ''} · {b?.name ?? '—'}</div>
                    </div>
                    {prog && (
                      <a className="pct-open" title="Open program" onClick={e => { e.preventDefault(); nav(`/paid-collab/programs/${prog.id}`); }} href={`/paid-collab/programs/${prog.id}`}>
                        <i className="bi bi-box-arrow-up-right" />
                      </a>
                    )}
                  </div>
                  {adCode && (
                    <div className="pct-mc-foot pct-code"><code title={adCode}>{adCode}</code><button type="button" className="pct-copy" title="Copy ad code" onClick={() => pctCopy(adCode)}><i className="bi bi-clipboard" /></button></div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
