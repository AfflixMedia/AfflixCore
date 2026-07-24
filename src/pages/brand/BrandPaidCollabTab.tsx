import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Spinner, Alert } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import { applyFollowUps, setCreatorVideoAuth } from '../handler-collab/store';
import type { HandlerBrandMonth, HandlerCreator } from '../handler-collab/store';
import { BrandPerformancePane } from '../handler-collab/HandlerCollabApp';
import { copyText, showToast } from '../../lib/copyToast';
import { setReportCurrency } from '../../lib/currency';
import {
  fmt$, monthKey, monthLabel, focusProductList, deliveredCount, isValidUrl, tiktokAccounts, getGradient,
  Kpi, CreatorRowRO, CreatorListHeadRO,
} from '../paid-collab/handlerCollabReadonly';

interface Props {
  brandId: string;
  brandName: string;
  canEdit: boolean;
  /** Brand region currency (USD/GBP/EUR) — money symbol shown throughout the tab. */
  currency?: string | null;
  /** Reports the live count of not-yet-authorised videos (drives the tab-strip dot in BrandDetail). */
  onPendingAuthChange?: (count: number) => void;
}

// A video row counts as "awaiting authorisation" once it has a video link or an
// ad code but no auth flag (empty placeholders skipped). Shared with BrandDetail,
// which uses it to show a dot on the Paid Collab tab itself.
export const isPendingAuthCode = (code: any): boolean =>
  !!code && !code.auth && !!((code.video || '').trim() || (code.adCode || '').trim());

/* ════════════════════════════════════════════════════════════
   Paid Collab tab for THIS brand, styled like the handler Workspace drilldown (pc-*
   via handlerCollab.css). Keyed by public.brands.id, so it works for Bob / APC /
   handler / client via RLS (user_has_brand_access).
   - Overview: read-only summary (budgets/briefs + creator list) of the handler data.
   - Performance: the same editable GMV matrix (monthly/weekly) the handler has, shown
     to staff who may edit (canEdit = Bob or the assigned APC, brand active). Writes go
     through store.setCreatorMonthly (SECURITY DEFINER RPC, so APCs can write too).
   Creator/budget editing still happens in the handler's own workspace.
════════════════════════════════════════════════════════════ */
export default function BrandPaidCollabTab({ brandId, brandName, canEdit, currency, onPendingAuthChange }: Props) {
  // Money symbol for this brand's region — every fmt$ / CreatorRowRO below reads it.
  setReportCurrency(currency);
  const [months, setMonths] = useState<HandlerBrandMonth[]>([]);
  const [creators, setCreators] = useState<HandlerCreator[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // Overview = the read-only summary below; Performance = the editable GMV matrix
  // (monthly/weekly), staff who may edit only (Bob / assigned APC / Team Lead);
  // Authorization = queue of not-yet-authorised videos with bulk actions —
  // available to everyone on this tab (the auth toggle is also the Ads Manager's
  // edit surface; the RPC enforces who may actually write).
  const [view, setView] = useState<'overview' | 'performance' | 'auth'>('overview');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setErr(null);
      // Apply the follow-up / payment-pending status rules server-side before reading
      // (1-week stall sweep — same call the handler workspace makes on load).
      await applyFollowUps();
      const [{ data: mRows, error: mErr }, { data: cRows, error: cErr }, { data: sigRows }] = await Promise.all([
        supabase.from('handler_collab_brand_months').select('*').eq('brand_id', brandId),
        supabase.from('handler_collab_creators').select('*').eq('brand_id', brandId),
        // Contract e-signatures — the read views link to the signed copy.
        supabase.from('handler_contract_signatures')
          .select('creator_id, token, signed_at, signer_name').eq('brand_id', brandId),
      ]);
      if (cancelled) return;
      if (mErr || cErr) { setErr((mErr ?? cErr)!.message); setLoading(false); return; }
      const sigByCreator = new Map((sigRows ?? []).map((s: any) => [s.creator_id, s]));
      setMonths((mRows ?? []) as HandlerBrandMonth[]);
      // This tab is staff-only (Bob/APC/Team Lead/Ads Manager) — terminated deals
      // stay visible here (the "Terminated" badge renders via the STATUS map). Only
      // the client-facing surfaces (portal, share link, report §13) hide them.
      setCreators((cRows ?? []).map((c: any) => ({ ...c, signed_contract: sigByCreator.get(c.id) ?? null })) as HandlerCreator[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [brandId]);

  // Terminated deals are cancelled — excluded from all budget/activity math
  // (mirrors the handler workspace) while still shown in the list below.
  const activeCreators = useMemo(() => creators.filter(c => c.payment_status !== 'terminated'), [creators]);

  const totals = useMemo(() => {
    let budget = 0;
    months.forEach(m => { budget += Number(m.budget) || 0; });
    let allocated = 0, paid = 0, videos = 0, delivered = 0;
    activeCreators.forEach(c => {
      allocated += Number(c.amount) || 0;
      if (c.payment_status === 'paid') paid += Number(c.amount) || 0;
      videos += Number(c.videos_count) || 0;
      delivered += deliveredCount(c);
    });
    return { budget, allocated, paid, videos, delivered };
  }, [months, activeCreators]);

  // Patch one video's auth flag in local state (optimistic UI).
  const applyAuth = useCallback((creatorId: string, index: number, val: boolean) => {
    setCreators(prev => prev.map(c => {
      if (c.id !== creatorId) return c;
      const codes = Array.isArray(c.video_codes) ? c.video_codes.slice() : [];
      if (codes[index]) codes[index] = { ...codes[index], auth: val };
      return { ...c, video_codes: codes };
    }));
  }, []);

  // Toggle a video's "Authorised" flag (APC/Bob). Optimistic; reverts on failure.
  const handleToggleAuth = useCallback(async (creatorId: string, index: number, auth: boolean) => {
    applyAuth(creatorId, index, auth);
    try {
      await setCreatorVideoAuth(creatorId, index, auth);
    } catch (e) {
      applyAuth(creatorId, index, !auth); // revert
      alert(`Couldn't update authorised status: ${(e as Error).message}`);
    }
  }, [applyAuth]);

  // ── Authorization queue: every video row not yet authorised, grouped by creator.
  // A row counts once it has a video link or an ad code (empty placeholders skipped).
  const pendingAuth = useMemo(() => {
    return creators
      .map(c => ({
        creator: c,
        rows: (Array.isArray(c.video_codes) ? c.video_codes : [])
          .map((code, index) => ({ code, index }))
          .filter(r => isPendingAuthCode(r.code)),
      }))
      .filter(g => g.rows.length > 0)
      .sort((a, b) => String(a.creator.name || '').localeCompare(String(b.creator.name || '')));
  }, [creators]);
  const pendingCount = useMemo(() => pendingAuth.reduce((n, g) => n + g.rows.length, 0), [pendingAuth]);

  // Keep BrandDetail's tab-strip dot in sync as videos get authorised in here.
  useEffect(() => {
    if (!loading) onPendingAuthChange?.(pendingCount);
  }, [loading, pendingCount, onPendingAuthChange]);
  const pendingCodes = useMemo(
    () => pendingAuth.flatMap(g => g.rows.map(r => (r.code.adCode || '').trim()).filter(Boolean)),
    [pendingAuth],
  );

  const [authBusy, setAuthBusy] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');
  const copyOneCode = (key: string, code: string) => {
    copyText(code);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(k => (k === key ? '' : k)), 1400);
  };

  // Copy every pending (unauthorised) ad code, one per line.
  const copyAllCodes = useCallback(() => {
    if (!pendingCodes.length) return;
    copyText(pendingCodes.join('\n'));
    showToast(`${pendingCodes.length} ad code${pendingCodes.length === 1 ? '' : 's'} copied`);
  }, [pendingCodes]);

  // Authorise every pending video. Sequential on purpose: two rows of the SAME
  // creator both rewrite the video_codes jsonb, so parallel RPC calls could race.
  const authorizeAll = useCallback(async () => {
    const targets = pendingAuth.flatMap(g => g.rows.map(r => ({ creatorId: g.creator.id, index: r.index })));
    if (!targets.length || authBusy) return;
    if (!window.confirm(`Mark all ${targets.length} video${targets.length === 1 ? '' : 's'} as authorised?`)) return;
    setAuthBusy(true);
    let failed = 0;
    for (const t of targets) {
      try {
        await setCreatorVideoAuth(t.creatorId, t.index, true);
        applyAuth(t.creatorId, t.index, true);
      } catch {
        failed += 1;
      }
    }
    setAuthBusy(false);
    if (failed) alert(`${failed} video${failed === 1 ? '' : 's'} couldn't be updated — please try again.`);
    else showToast(`${targets.length} video${targets.length === 1 ? '' : 's'} authorised`);
  }, [pendingAuth, authBusy, applyAuth]);

  const sortedMonths = useMemo(
    () => [...months].sort((a, b) => String(b.month).localeCompare(String(a.month))),
    [months],
  );

  // Per-month allocated / paid, so each brief row can show the same
  // Budget · Allocated · Paid breakdown the KPI tiles show for the whole brand.
  // Creators belong to the month they were onboarded in (same rule as the list below).
  const monthStats = useMemo(() => {
    const map: Record<string, { allocated: number; paid: number; creators: number }> = {};
    activeCreators.forEach(c => {
      const k = monthKey(c.onboarded_on);
      const s = map[k] || (map[k] = { allocated: 0, paid: 0, creators: 0 });
      const amt = Number(c.amount) || 0;
      s.allocated += amt;
      if (c.payment_status === 'paid') s.paid += amt;
      s.creators += 1;
    });
    return map;
  }, [activeCreators]);

  // Creators grouped by onboarded month (newest first), like the workspace.
  const groups = useMemo(() => {
    const map: Record<string, HandlerCreator[]> = {};
    creators.forEach(c => { const k = monthKey(c.onboarded_on); (map[k] = map[k] || []).push(c); });
    return Object.keys(map).sort((a, b) => b.localeCompare(a)).map(k => ({
      key: k,
      items: map[k].sort((a, b) => String(b.onboarded_on || '').localeCompare(String(a.onboarded_on || ''))),
    }));
  }, [creators]);

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;

  const costPerVideo = totals.videos > 0 ? totals.allocated / totals.videos : 0;

  const overview = (months.length === 0 && creators.length === 0) ? (
    <div className="pc-card"><div className="pc-empty">
      <div className="pc-empty-icon">👥</div>
      <h3>No paid collab data for {brandName}</h3>
      <p>Enable the “Paid Collabs” scope for this brand and assign it to a handler — their workspace data shows here.</p>
    </div></div>
  ) : (
    <>
      <div className="pc-kpis pc-kpis-5">
        <Kpi label="Budget" color="#1259C3" value={fmt$(totals.budget)} sub={`${months.length} month${months.length === 1 ? '' : 's'}`} />
        <Kpi label="Allocated" color="#8B5CF6" value={fmt$(totals.allocated)} sub={`${activeCreators.length} creator${activeCreators.length === 1 ? '' : 's'}`} />
        <Kpi label="Paid" color="#2E7D32" value={fmt$(totals.paid)} sub={`${totals.allocated > 0 ? Math.round((totals.paid / totals.allocated) * 100) : 0}% paid out`} />
        <Kpi label="Videos" color="#0EA5E9" value={`${totals.delivered}/${totals.videos}`} sub={`${totals.videos > 0 ? Math.round((totals.delivered / totals.videos) * 100) : 0}% completed`} />
        <Kpi label="Cost / Video" color="#E65100" value={costPerVideo ? fmt$(costPerVideo) : '—'} sub="per delivered video" />
      </div>

      {sortedMonths.length > 0 && (
        <div className="pc-card pc-mb-card">
          <div className="pc-mb-title">Monthly budgets &amp; briefs</div>
          <div className="pc-mb-grid" role="table" aria-label="Monthly budgets and briefs">
            <div className="pc-mb-head" role="row">
              <span role="columnheader">Month</span>
              <span role="columnheader" className="pc-mb-num">Budget</span>
              <span role="columnheader" className="pc-mb-num">Allocated</span>
              <span role="columnheader" className="pc-mb-num">Paid</span>
              <span role="columnheader" className="pc-mb-num">Left</span>
              <span role="columnheader">Use</span>
              <span role="columnheader">Brief</span>
            </div>
            {sortedMonths.map(m => {
              const products = focusProductList(m.focus_product_url);
              const budget = Number(m.budget) || 0;
              const st = monthStats[String(m.month)] || { allocated: 0, paid: 0, creators: 0 };
              const pct = (n: number) => (budget > 0 ? Math.min(100, Math.round((n / budget) * 100)) : 0);
              const notes = (m.notes || '').trim();
              return (
                <div key={m.id} className="pc-mb-r" role="row">
                  <span className="pc-mb-month" role="cell">
                    {monthLabel(m.month)}
                    {st.creators > 0 && <em>{st.creators}</em>}
                  </span>
                  <span className="pc-mb-num pc-mb-b" role="cell" data-l="Budget">{fmt$(budget)}</span>
                  <span className="pc-mb-num pc-mb-a" role="cell" data-l="Allocated">{fmt$(st.allocated)}</span>
                  <span className="pc-mb-num pc-mb-p" role="cell" data-l="Paid">{fmt$(st.paid)}</span>
                  <span className="pc-mb-num pc-mb-l" role="cell" data-l="Left">{fmt$(Math.max(0, budget - st.allocated))}</span>
                  <span className="pc-mb-usecell" role="cell" data-l="Use">
                    <span className="pc-mb-bar" title={`Allocated ${fmt$(st.allocated)} · Paid ${fmt$(st.paid)} of ${fmt$(budget)}`}>
                      <i className="pc-mb-bar-alloc" style={{ width: `${pct(st.allocated)}%` }} />
                      <i className="pc-mb-bar-paid" style={{ width: `${pct(st.paid)}%` }} />
                    </span>
                    <em>{pct(st.allocated)}%</em>
                  </span>
                  <span className="pc-mb-brief" role="cell">
                    {m.content_guide_url && <a className="pc-link-chip" href={m.content_guide_url} target="_blank" rel="noopener noreferrer" title="Content guide">Guide ↗</a>}
                    {products.map((p, i) => <a key={i} className="pc-link-chip pc-chip-orange" href={p.url || undefined} target="_blank" rel="noopener noreferrer" title={p.name || `Focus product ${i + 1}`}>{p.name || `Product ${i + 1}`} ↗</a>)}
                    {notes && <span className="pc-link-chip pc-mb-note" title={notes}>{notes}</span>}
                    {!m.content_guide_url && !products.length && !notes && <span className="pc-mb-dash">—</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {creators.length === 0 ? (
        <div className="pc-card"><div className="pc-empty">
          <div className="pc-empty-icon">👤</div><h3>No creators yet</h3>
        </div></div>
      ) : (
        <div className="pc-card pc-list">
          <CreatorListHeadRO />
          {groups.map(g => (
            <Fragment key={g.key}>
              <div className="pc-cv-monthhead"><span>{monthLabel(g.key)}</span><span className="pc-cv-monthcount">{g.items.length}</span></div>
              {g.items.map((c, i) => <CreatorRowRO key={c.id} c={c} idx={i + 1} staffView
                onToggleAuth={(vi, a) => handleToggleAuth(c.id, vi, a)} />)}
            </Fragment>
          ))}
        </div>
      )}
    </>
  );

  // Authorization queue pane: all not-yet-authorised videos across creators, with
  // one-click bulk authorise + copy-all-ad-codes. Rows reuse the pc-vx-* look.
  const authPane = (
    <div className="pc-card pc-authq">
      <div className="pc-authq-head">
        <div>
          <div className="pc-authq-title">Videos awaiting authorisation</div>
          <div className="pc-authq-sub">
            {pendingCount > 0
              ? <>{pendingCount} video{pendingCount === 1 ? '' : 's'} across {pendingAuth.length} creator{pendingAuth.length === 1 ? '' : 's'} still unauthorised</>
              : 'Every video with content or an ad code is authorised.'}
          </div>
        </div>
        {pendingCount > 0 && (
          <div className="pc-authq-actions">
            <button type="button" className="pc-btn pc-btn-ghost pc-btn-sm" onClick={copyAllCodes}
              disabled={!pendingCodes.length}
              title={pendingCodes.length ? 'Copy every pending ad code, one per line' : 'No pending video has an ad code yet'}>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
              Copy all codes{pendingCodes.length ? ` (${pendingCodes.length})` : ''}
            </button>
            <button type="button" className="pc-btn pc-btn-primary pc-btn-sm" onClick={authorizeAll} disabled={authBusy}>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              {authBusy ? 'Authorising…' : `Authorise all (${pendingCount})`}
            </button>
          </div>
        )}
      </div>
      {pendingCount === 0 ? (
        <div className="pc-empty">
          <div className="pc-empty-icon">✅</div>
          <h3>All caught up</h3>
          <p>New videos and ad codes added by the handler will show up here for authorisation.</p>
        </div>
      ) : (
        pendingAuth.map(g => {
          const accounts = tiktokAccounts(g.creator.tiktok_handle);
          return (
            <div key={g.creator.id} className="pc-authq-group">
              <div className="pc-authq-creator">
                <span className="pc-authq-ava" style={{ background: getGradient(g.creator.name) }}>
                  {(g.creator.name || '?').trim().charAt(0).toUpperCase() || '?'}
                </span>
                <span className="pc-cname">{g.creator.name}</span>
                {accounts[0] && (
                  <a className="pc-handle" href={accounts[0].url} target="_blank" rel="noopener noreferrer">{accounts[0].handle}</a>
                )}
                <span className="pc-vx-authtally">{g.rows.length} pending</span>
              </div>
              <div className="pc-vx-collabels"><span /><span>Video</span><span>Ad code</span><span className="pc-vx-cl-auth">Authorise</span><span /></div>
              <div className="pc-vx-list">
                {g.rows.map(({ code, index }) => {
                  const vOk = isValidUrl(code.video);
                  const key = `${g.creator.id}:${index}`;
                  return (
                    <div className="pc-vx-row" key={key}>
                      <span className="pc-vx-num">{index + 1}</span>
                      <div className="pc-vx-inp" style={{ alignItems: 'center' }}>
                        <span className="pc-vx-inp-ico"><svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><path d="M8 5v14l11-7z" /></svg></span>
                        {vOk
                          ? <a className="pc-handle pc-vx-val" href={code.video} target="_blank" rel="noopener noreferrer" title={code.video}>{code.video}</a>
                          : <span className="pc-handle pc-vx-val" title={code.video || ''}>{code.video || '—'}</span>}
                      </div>
                      <div className="pc-vx-inp pc-vx-inp-ad" style={{ alignItems: 'center' }}>
                        <span className="pc-vx-inp-ico">#</span>
                        <span className="pc-vx-val" title={code.adCode || ''}>{code.adCode || '—'}</span>
                        {code.adCode ? (
                          <button type="button" className={`pc-vx-copy ${copiedKey === key ? 'ok' : ''}`} title="Copy ad code"
                            onClick={() => copyOneCode(key, code.adCode)}>
                            {copiedKey === key
                              ? <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                              : <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>}
                          </button>
                        ) : null}
                      </div>
                      <button type="button" role="checkbox" aria-checked={false}
                        className="pc-vx-auth pc-vx-auth-edit"
                        title="Mark as authorised" disabled={authBusy}
                        onClick={() => handleToggleAuth(g.creator.id, index, true)} />
                      <a className="pc-vx-open" href={vOk ? code.video : undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!vOk}>
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M9 7h8v8" /></svg>
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <div className="pc-app" style={{ minHeight: 0, background: 'transparent' }}>
      <div className="pc-seg" style={{ marginBottom: 16 }}>
        <button type="button" className={`pc-seg-btn ${view === 'overview' ? 'active' : ''}`} onClick={() => setView('overview')}>Overview</button>
        {canEdit && (
          <button type="button" className={`pc-seg-btn ${view === 'performance' ? 'active' : ''}`} onClick={() => setView('performance')}>Performance</button>
        )}
        <button type="button" className={`pc-seg-btn ${view === 'auth' ? 'active' : ''}`} onClick={() => setView('auth')}>
          Authorization{pendingCount > 0 && <span className="pc-seg-count">{pendingCount}</span>}
        </button>
      </div>
      {view === 'performance' && canEdit
        ? <BrandPerformancePane brandId={brandId} brandName={brandName} canEdit={canEdit} currency={currency} />
        : view === 'auth' ? authPane : overview}
    </div>
  );
}
