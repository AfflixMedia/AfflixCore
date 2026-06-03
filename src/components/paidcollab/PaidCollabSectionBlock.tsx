import { useEffect, useMemo, useState } from 'react';
import { Spinner, Alert, Badge } from 'react-bootstrap';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, LabelList,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import {
  PaidCreator, PaidVideo, PaidCreatorPerformance,
  fmtMoney, fmtNumber,
} from '../../lib/paidCollabSchema';
import { addDays, fromISO } from '../../lib/dates';

/** All paid-collab data available to a dashboard (used on shared links where
 *  the anon viewer can't query Supabase directly). */
export interface PaidCollabPrefetch {
  programs: { id: string; name: string | null; currency?: string }[];
  creators: PaidCreator[];
  videos: PaidVideo[];
  performance: PaidCreatorPerformance[];
}

interface Props {
  programId: string;
  /** When provided (shared link), data is sliced from here instead of queried. */
  prefetched?: PaidCollabPrefetch;
  /** When true, add a week-over-week GMV trend comparison. */
  compare?: boolean;
  /** Optional specific week (period_start) — scopes GMV/items to that week. */
  week?: string | null;
  /** When provided, shows a "View full program" button (shared client view). */
  onOpenProgram?: (programId: string) => void;
}

function weekShort(start: string) {
  const e = addDays(start, 6);
  return `${fromISO(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}–${fromISO(e).toLocaleDateString(undefined, { day: 'numeric' })}`;
}

interface Resolved {
  programName: string;
  currency: string;
  creators: PaidCreator[];
  videos: PaidVideo[];
  performance: PaidCreatorPerformance[];
}

/**
 * Live paid-collab block rendered inside a report's "Paid Collab" custom
 * section. Shows the linked program's auto-calculated performance.
 */
export default function PaidCollabSectionBlock({ programId, prefetched, compare, week, onOpenProgram }: Props) {
  const [data, setData] = useState<Resolved | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setErr(null);
      if (prefetched) {
        const prog = prefetched.programs.find(p => p.id === programId);
        const creators = prefetched.creators.filter(c => c.program_id === programId);
        const cids = new Set(creators.map(c => c.id));
        const videos = prefetched.videos.filter(v => cids.has(v.creator_id));
        const performance = prefetched.performance.filter(p => cids.has(p.creator_id));
        if (!cancelled) {
          setData({
            programName: prog?.name || 'Paid collab program',
            currency: prog?.currency || 'USD',
            creators, videos, performance,
          });
          setLoading(false);
        }
        return;
      }
      // Authed context — query directly.
      const { data: prog, error: pErr } = await supabase
        .from('paid_creator_programs').select('id,name,currency').eq('id', programId).maybeSingle();
      if (pErr || !prog) {
        if (!cancelled) { setErr('Linked program is unavailable.'); setLoading(false); }
        return;
      }
      const { data: cRows } = await supabase
        .from('paid_creators').select('*').eq('program_id', programId);
      const creators = (cRows ?? []) as PaidCreator[];
      let videos: PaidVideo[] = [];
      let performance: PaidCreatorPerformance[] = [];
      if (creators.length > 0) {
        const cids = creators.map(c => c.id);
        const [{ data: vRows }, { data: perfRows }] = await Promise.all([
          supabase.from('paid_creator_videos').select('*').in('creator_id', cids),
          supabase.from('paid_creator_performance').select('*').in('creator_id', cids),
        ]);
        videos = (vRows ?? []) as PaidVideo[];
        performance = (perfRows ?? []) as PaidCreatorPerformance[];
      }
      if (!cancelled) {
        setData({
          programName: (prog as any).name || 'Paid collab program',
          currency: (prog as any).currency || 'USD',
          creators, videos, performance,
        });
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [programId, prefetched]);

  const summary = useMemo(() => {
    if (!data) return null;
    // Every video is live; pipeline = agreed videos not yet delivered.
    const live = data.videos.length;
    const countByCreator = new Map<string, number>();
    data.videos.forEach(v => countByCreator.set(v.creator_id, (countByCreator.get(v.creator_id) ?? 0) + 1));
    const pipeline = data.creators
      .filter(c => c.status !== 'dropped')
      .reduce((s, c) => s + Math.max(0, (c.agreed_videos || 0) - (countByCreator.get(c.id) ?? 0)), 0);
    // GMV / items = sum of weekly creator-performance entries — scoped to the
    // chosen week when one is selected, otherwise all weeks.
    const weekly = data.performance.filter(p =>
      p.period_type === 'weekly' && (!week || p.period_start === week));
    const gmv = weekly.reduce((s, p) => s + Number(p.gmv || 0), 0);
    const items = weekly.reduce((s, p) => s + Number(p.items_sold || 0), 0);
    // Per-creator latest weekly entry
    const perCreator = data.creators.map(c => {
      const cWeekly = weekly
        .filter(p => p.creator_id === c.id)
        .sort((a, b) => b.period_start.localeCompare(a.period_start));
      const cMonthly = data.performance
        .filter(p => p.creator_id === c.id && p.period_type === 'monthly')
        .sort((a, b) => b.period_start.localeCompare(a.period_start));
      const cGmv = cWeekly.reduce((s, p) => s + Number(p.gmv || 0), 0);
      const cItems = cWeekly.reduce((s, p) => s + Number(p.items_sold || 0), 0);
      const cVideos = data.videos.filter(v => v.creator_id === c.id).length;
      const cLive = cVideos;
      return { creator: c, gmv: cGmv, items: cItems, live: cLive, videos: cVideos,
        weeklyCount: cWeekly.length, monthlyCount: cMonthly.length };
    });
    return { live, pipeline, total: data.videos.length, gmv, items, perCreator };
  }, [data, week]);

  // Full week-by-week GMV series (used for comparison + trend chart).
  const allWeeks = useMemo(() => {
    if (!data) return [] as { start: string; label: string; GMV: number }[];
    const byWeek = new Map<string, number>();
    data.performance
      .filter(p => p.period_type === 'weekly')
      .forEach(p => byWeek.set(p.period_start, (byWeek.get(p.period_start) ?? 0) + Number(p.gmv || 0)));
    return [...byWeek.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([start, gmv]) => ({ start, label: weekShort(start), GMV: Math.round(gmv) }));
  }, [data]);

  if (loading) return <div className="text-center py-3"><Spinner animation="border" size="sm" /></div>;
  if (err) return <Alert variant="warning" className="py-2 mb-0">{err}</Alert>;
  if (!data || !summary) return null;

  const weeklyTrend = allWeeks.slice(-8);
  // For a chosen week, compare it against the immediately-preceding week.
  const selIdx = week ? allWeeks.findIndex(w => w.start === week) : -1;
  const selWeek = selIdx >= 0 ? allWeeks[selIdx] : null;
  const beforeSel = selIdx > 0 ? allWeeks[selIdx - 1] : null;
  // For "overall" mode, compare the latest two weeks.
  const lastWeek = weeklyTrend[weeklyTrend.length - 1];
  const prevWeek = weeklyTrend[weeklyTrend.length - 2];
  const wowDelta = lastWeek && prevWeek ? lastWeek.GMV - prevWeek.GMV : null;

  return (
    <div>
      <div className="d-flex align-items-center gap-2 mb-3 flex-wrap">
        <Badge bg="primary"><i className="bi bi-people me-1" />Paid Collab</Badge>
        <span className="fw-semibold">{data.programName}</span>
        {week
          ? <Badge bg="light" text="dark" className="border"><i className="bi bi-calendar-week me-1" />Week of {weekShort(week)}</Badge>
          : <span className="text-muted small">· live data</span>}
        {onOpenProgram && (
          <button
            type="button"
            className="btn btn-sm btn-outline-primary ms-auto"
            onClick={() => onOpenProgram(programId)}
          >
            View full program <i className="bi bi-arrow-right ms-1" />
          </button>
        )}
      </div>

      {/* Auto-calculated summary tiles */}
      <div className="d-flex flex-wrap gap-2 mb-3">
        <div className="bm-tile bm-tile-success" style={{ flex: '1 1 130px', padding: 12 }}>
          <div className="bm-tile-label">{week ? 'Week GMV' : 'Overall GMV'}</div>
          <div className="bm-tile-value" style={{ fontSize: '1.2rem' }}>{fmtMoney(summary.gmv, data.currency)}</div>
        </div>
        <div className="bm-tile" style={{ flex: '1 1 130px', padding: 12 }}>
          <div className="bm-tile-label">Items sold</div>
          <div className="bm-tile-value" style={{ fontSize: '1.2rem' }}>{fmtNumber(summary.items)}</div>
        </div>
        <div className="bm-tile" style={{ flex: '1 1 130px', padding: 12 }}>
          <div className="bm-tile-label">Videos live</div>
          <div className="bm-tile-value" style={{ fontSize: '1.2rem' }}>{fmtNumber(summary.live)}</div>
          <div className="bm-tile-sub text-muted">{summary.pipeline} in pipeline</div>
        </div>
        <div className="bm-tile" style={{ flex: '1 1 130px', padding: 12 }}>
          <div className="bm-tile-label">Creators</div>
          <div className="bm-tile-value" style={{ fontSize: '1.2rem' }}>{fmtNumber(data.creators.length)}</div>
        </div>
      </div>

      {/* Per-creator breakdown */}
      {summary.perCreator.length > 0 && (
        <div className="table-responsive">
          <table className="table table-sm align-middle mb-0">
            <thead className="small text-uppercase text-muted">
              <tr>
                <th>Creator</th>
                <th>Videos</th>
                <th>Live</th>
                <th>GMV</th>
                <th>Items</th>
              </tr>
            </thead>
            <tbody>
              {summary.perCreator.map(r => (
                <tr key={r.creator.id}>
                  <td className="fw-semibold">{r.creator.name}</td>
                  <td>{fmtNumber(r.videos)}</td>
                  <td>{fmtNumber(r.live)}</td>
                  <td><span className="text-success fw-semibold">{fmtMoney(r.gmv, data.currency)}</span></td>
                  <td>{fmtNumber(r.items)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Week-over-week GMV comparison */}
      {compare && (
        <div className="mt-4">
          <div className="fw-semibold small text-uppercase text-muted mb-2" style={{ letterSpacing: '.4px' }}>
            <i className="bi bi-bar-chart-line me-1" />
            {week ? 'Selected week vs previous' : 'Week-over-week GMV'}
          </div>
          {week ? (
            !selWeek ? (
              <p className="text-muted small mb-0">No performance for the selected week yet.</p>
            ) : (() => {
              const cur = selWeek.GMV;
              const prev = beforeSel ? beforeSel.GMV : null;
              const pct = (prev !== null && prev !== 0) ? ((cur - prev) / prev) * 100 : null;
              return (
                <div className="d-flex flex-wrap gap-2">
                  <div className="bm-tile bm-tile-success" style={{ flex: '1 1 150px', padding: 14 }}>
                    <div className="bm-tile-label">{selWeek.label}</div>
                    <div className="bm-tile-value" style={{ fontSize: '1.3rem' }}>{fmtMoney(cur, data.currency)}</div>
                    <div className="bm-tile-sub">selected week</div>
                  </div>
                  <div className="bm-tile" style={{ flex: '1 1 150px', padding: 14 }}>
                    <div className="bm-tile-label">{beforeSel ? beforeSel.label : 'Previous week'}</div>
                    <div className="bm-tile-value" style={{ fontSize: '1.3rem' }}>
                      {prev !== null ? fmtMoney(prev, data.currency) : '—'}
                    </div>
                    <div className="bm-tile-sub text-muted">previous week</div>
                  </div>
                  {pct !== null && (
                    <div className="bm-tile" style={{ flex: '1 1 150px', padding: 14 }}>
                      <div className="bm-tile-label">Growth</div>
                      <div className="bm-tile-value" style={{ fontSize: '1.3rem', color: pct >= 0 ? '#15803d' : '#b91c1c' }}>
                        {pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
                      </div>
                      <div className="bm-tile-sub text-muted">vs previous week</div>
                    </div>
                  )}
                </div>
              );
            })()
          ) : weeklyTrend.length === 0 ? (
            <p className="text-muted small mb-0">No weekly performance recorded yet to compare.</p>
          ) : (
            <>
              {wowDelta !== null && (
                <div className="mb-2 small">
                  Latest week <strong>{lastWeek!.label}</strong>:{' '}
                  <span className="text-success fw-semibold">{fmtMoney(lastWeek!.GMV, data.currency)}</span>
                  {' '}
                  <span className={wowDelta >= 0 ? 'text-success' : 'text-danger'}>
                    ({wowDelta >= 0 ? '▲' : '▼'} {fmtMoney(Math.abs(wowDelta), data.currency)} vs previous week)
                  </span>
                </div>
              )}
              <div style={{ height: 220 }}>
                <ResponsiveContainer>
                  <BarChart data={weeklyTrend} margin={{ top: 18, right: 12, left: -8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" vertical={false} />
                    <XAxis dataKey="label" stroke="#6c757d" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis stroke="#6c757d" fontSize={11} tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, border: '1px solid #e9ecef' }}
                      formatter={(v: any) => fmtMoney(Number(v), data.currency)}
                    />
                    <Bar dataKey="GMV" fill="#e8862e" radius={[6, 6, 0, 0]} barSize={28}>
                      <LabelList dataKey="GMV" position="top" fontSize={10} fontWeight={600}
                        formatter={(v: any) => fmtMoney(Number(v), data.currency)} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
