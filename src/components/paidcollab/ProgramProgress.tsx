import { useEffect, useMemo, useState } from 'react';
import { Card, Spinner, Alert } from 'react-bootstrap';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, LabelList,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import {
  PaidCreator, PaidVideo, PaidCreatorPerformance, PerformancePeriod,
  BrandCreatorAggregate, creatorIdentityKey,
  fmtMoney, fmtNumber,
} from '../../lib/paidCollabSchema';
import { addDays, fromISO } from '../../lib/dates';

interface Props {
  creators: PaidCreator[];
  videos: PaidVideo[];
  currency: string;
  // When provided, skip the Supabase fetch and render from these rows instead
  // (used by the public/share view, which has no Supabase auth).
  entries?: PaidCreatorPerformance[];
  /** Brand-wide aggregate — when provided, per-creator stats sum across every
   *  program of the same brand for the same creator (matched by handle/name). */
  brandAgg?: BrandCreatorAggregate;
}

function weekShort(start: string) {
  const e = addDays(start, 6);
  return `${fromISO(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}–${fromISO(e).toLocaleDateString(undefined, { day: 'numeric' })}`;
}
function monthShort(start: string) {
  const [y, m] = start.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'short', year: '2-digit' });
}

export default function ProgramProgress({ creators, videos, currency, entries: providedEntries, brandAgg }: Props) {
  const videoStats = useMemo(() => {
    // Every video is live; pipeline = agreed videos not yet delivered.
    const countByCreator = new Map<string, number>();
    videos.forEach(v => countByCreator.set(v.creator_id, (countByCreator.get(v.creator_id) ?? 0) + 1));
    const pipeline = creators
      .filter(c => c.status !== 'dropped')
      .reduce((s, c) => s + Math.max(0, (c.agreed_videos || 0) - (countByCreator.get(c.id) ?? 0)), 0);
    return { total: videos.length, live: videos.length, pipeline };
  }, [videos, creators]);

  const [tab, setTab] = useState<PerformancePeriod>('weekly');
  const [fetchedEntries, setFetchedEntries] = useState<PaidCreatorPerformance[]>([]);
  const [loading, setLoading] = useState(!providedEntries);
  const [err, setErr] = useState<string | null>(null);

  const creatorIds = useMemo(() => creators.map(c => c.id), [creators]);
  const creatorIdSet = useMemo(() => new Set(creatorIds), [creatorIds]);

  useEffect(() => {
    if (providedEntries) { setLoading(false); return; }
    (async () => {
      if (creatorIds.length === 0) { setFetchedEntries([]); setLoading(false); return; }
      setLoading(true); setErr(null);
      const { data, error } = await supabase
        .from('paid_creator_performance')
        .select('*')
        .in('creator_id', creatorIds);
      if (error) { setErr(error.message); setLoading(false); return; }
      setFetchedEntries(((data ?? []) as any[]).map(r => ({
        ...r,
        gmv: Number(r.gmv ?? 0),
        items_sold: Number(r.items_sold ?? 0),
        period_start: typeof r.period_start === 'string' ? r.period_start.slice(0, 10) : r.period_start,
      })));
      setLoading(false);
    })();
    // re-run when the set of creators changes
  }, [creatorIds.join(','), providedEntries]);

  // Brand-wide aggregation: when brandAgg is provided, pull every performance
  // row in the brand belonging to the same creator (identity = handle/name),
  // across every program of THAT brand. Falls back to program-scoped entries
  // when brandAgg isn't available (e.g. the public/share view).
  const entries = useMemo(() => {
    if (brandAgg) {
      const result: PaidCreatorPerformance[] = [];
      const seenIdentity = new Set<string>();
      for (const c of creators) {
        const key = creatorIdentityKey(c);
        if (seenIdentity.has(key)) continue; // dedupe if 2 program rows share identity
        seenIdentity.add(key);
        result.push(...(brandAgg.perfByIdentity.get(key) ?? []));
      }
      return result;
    }
    const src = providedEntries ?? fetchedEntries;
    return src.filter(e => creatorIdSet.has(e.creator_id));
  }, [brandAgg, creators, providedEntries, fetchedEntries, creatorIdSet]);

  const list = useMemo(() => entries.filter(e => e.period_type === tab), [entries, tab]);

  // Per-program creator → identity, used to find every creator_id in the brand
  // that maps to "the same person" as a given program creator.
  const idsForIdentity = useMemo(() => {
    const m = new Map<string, Set<string>>();
    if (brandAgg) {
      for (const [key, cs] of brandAgg.creatorsByIdentity) {
        m.set(key, new Set(cs.map(c => c.id)));
      }
    }
    return m;
  }, [brandAgg]);

  // Aggregate GMV + items by period for the chart.
  const chartData = useMemo(() => {
    const byPeriod = new Map<string, { gmv: number; items: number }>();
    for (const e of list) {
      const cur = byPeriod.get(e.period_start) ?? { gmv: 0, items: 0 };
      cur.gmv += e.gmv;
      cur.items += e.items_sold;
      byPeriod.set(e.period_start, cur);
    }
    return [...byPeriod.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([start, v]) => ({
        label: tab === 'weekly' ? weekShort(start) : monthShort(start),
        GMV: Math.round(v.gmv),
        items: v.items,
      }));
  }, [list, tab]);

  // All distinct period_starts (sorted ascending) — used for the previous/next nav.
  const periods = useMemo(() => {
    const set = new Set(list.map(e => e.period_start));
    return [...set].sort();
  }, [list]);

  // Currently-selected period (defaults to most recent, follows the data when tab flips).
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  useEffect(() => {
    if (periods.length === 0) { setSelectedPeriod(null); return; }
    if (!selectedPeriod || !periods.includes(selectedPeriod)) {
      setSelectedPeriod(periods[periods.length - 1]);
    }
  }, [periods.join(',')]);

  const selectedIdx = selectedPeriod ? periods.indexOf(selectedPeriod) : -1;
  const canPrev = selectedIdx > 0;
  const canNext = selectedIdx >= 0 && selectedIdx < periods.length - 1;
  const gotoPrev = () => { if (canPrev) setSelectedPeriod(periods[selectedIdx - 1]); };
  const gotoNext = () => { if (canNext) setSelectedPeriod(periods[selectedIdx + 1]); };

  // Per-creator row for the SELECTED period (with the previous period for
  // trend). When brandAgg is in play, sum across every creator_id in the brand
  // that shares this creator's identity (handle/name match) — so cross-program
  // performance shows up on each program's view.
  const perCreator = useMemo(() => {
    if (!selectedPeriod) return [];
    const prevPeriod = selectedIdx > 0 ? periods[selectedIdx - 1] : null;
    const sumFor = (c: PaidCreator, period: string) => {
      const matchIds = brandAgg
        ? (idsForIdentity.get(creatorIdentityKey(c)) ?? new Set<string>([c.id]))
        : new Set<string>([c.id]);
      const xs = list.filter(e => matchIds.has(e.creator_id) && e.period_start === period);
      if (xs.length === 0) return null;
      return {
        gmv: xs.reduce((s, e) => s + (Number(e.gmv) || 0), 0),
        items_sold: xs.reduce((s, e) => s + (Number(e.items_sold) || 0), 0),
        period_start: period,
      };
    };
    // Dedupe by identity — if two creators in this program share identity,
    // they'd otherwise produce identical rows.
    const seen = new Set<string>();
    const rows: { creator: PaidCreator; current: { gmv: number; items_sold: number; period_start: string }; prev: { gmv: number } | null }[] = [];
    for (const c of creators) {
      const key = creatorIdentityKey(c);
      if (seen.has(key)) continue;
      seen.add(key);
      const cur = sumFor(c, selectedPeriod);
      if (!cur) continue;
      const prev = prevPeriod ? sumFor(c, prevPeriod) : null;
      rows.push({ creator: c, current: cur, prev: prev ? { gmv: prev.gmv } : null });
    }
    return rows;
  }, [creators, list, selectedPeriod, selectedIdx, periods, brandAgg, idsForIdentity]);

  // Search + sort state for the table.
  const [search, setSearch] = useState('');
  type SortKey = 'creator' | 'gmv' | 'items' | 'trend';
  type SortDir = 'asc' | 'desc';
  const [sortKey, setSortKey] = useState<SortKey>('gmv');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const setSort = (k: SortKey) => {
    if (k === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir(k === 'creator' ? 'asc' : 'desc'); }
  };

  const filteredSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? perCreator.filter(r =>
          r.creator.name.toLowerCase().includes(q) ||
          (r.creator.handle ?? '').toLowerCase().includes(q))
      : perCreator;
    const sign = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'creator') return sign * a.creator.name.localeCompare(b.creator.name);
      if (sortKey === 'gmv')     return sign * ((a.current!.gmv) - (b.current!.gmv));
      if (sortKey === 'items')   return sign * ((a.current!.items_sold) - (b.current!.items_sold));
      // trend = current - prev
      const da = a.current!.gmv - (a.prev?.gmv ?? a.current!.gmv);
      const db = b.current!.gmv - (b.prev?.gmv ?? b.current!.gmv);
      return sign * (da - db);
    });
  }, [perCreator, search, sortKey, sortDir]);

  const totalGmv = useMemo(() => list.reduce((s, e) => s + e.gmv, 0), [list]);
  const totalItems = useMemo(() => list.reduce((s, e) => s + e.items_sold, 0), [list]);

  const selectedPeriodLabel = selectedPeriod
    ? (tab === 'weekly' ? weekShort(selectedPeriod) : monthShort(selectedPeriod))
    : '—';

  return (
    <Card className="shadow-sm">
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
          <h6 className="mb-0 fw-bold">
            <i className="bi bi-graph-up-arrow me-2 text-primary" />
            Program performance
          </h6>
          <div className="wr-tabs" style={{ marginBottom: 0 }}>
            <button className={`wr-tab ${tab === 'weekly' ? 'is-active' : ''}`} onClick={() => setTab('weekly')}>
              Weekly
            </button>
            <button className={`wr-tab ${tab === 'monthly' ? 'is-active' : ''}`} onClick={() => setTab('monthly')}>
              Monthly
            </button>
          </div>
        </div>

        {/* Auto-calculated program totals — videos + overall GMV */}
        <div className="pp-tiles mb-3">
          <div className="pp-tile pp-tile-blue">
            <div className="pp-tile-label">Videos</div>
            <div className="pp-tile-value">{fmtNumber(videoStats.total)}</div>
            <div className="pp-tile-sub">
              <i className="bi bi-broadcast text-success me-1" />{videoStats.live} live
              <span className="mx-1">·</span>
              <i className="bi bi-hourglass-split text-warning me-1" />{videoStats.pipeline} pipeline
            </div>
          </div>
          <div className="pp-tile pp-tile-orange">
            <div className="pp-tile-label">Overall GMV</div>
            <div className="pp-tile-value">{fmtMoney(totalGmv, currency)}</div>
            <div className="pp-tile-sub">from {tab} performance</div>
          </div>
          <div className="pp-tile pp-tile-green">
            <div className="pp-tile-label">Items sold</div>
            <div className="pp-tile-value">{fmtNumber(totalItems)}</div>
            <div className="pp-tile-sub">from {tab} performance</div>
          </div>
          <div className="pp-tile pp-tile-purple">
            <div className="pp-tile-label">Creators</div>
            <div className="pp-tile-value">{fmtNumber(creators.length)}</div>
            <div className="pp-tile-sub">in this program</div>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-4"><Spinner animation="border" size="sm" /></div>
        ) : err ? (
          <Alert variant="danger" className="py-2 mb-0">{err}</Alert>
        ) : list.length === 0 ? (
          <div className="text-muted text-center py-4 small">
            <i className="bi bi-bar-chart fs-3 d-block mb-2 opacity-50" />
            No {tab} performance recorded yet. Use the <strong>Performance</strong> button on a creator card to add some.
          </div>
        ) : (
          <>
            {/* GMV trend chart */}
            <div style={{ height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={chartData} margin={{ top: 18, right: 12, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="perfGmvGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#198754" stopOpacity={1} />
                      <stop offset="100%" stopColor="#60c98b" stopOpacity={0.7} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" vertical={false} />
                  <XAxis dataKey="label" stroke="#6c757d" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#6c757d" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: '1px solid #e9ecef' }}
                    formatter={(val: any, name: any) => name === 'GMV' ? fmtMoney(Number(val), currency) : val}
                  />
                  <Bar dataKey="GMV" fill="url(#perfGmvGrad)" radius={[6, 6, 0, 0]} barSize={28}>
                    <LabelList dataKey="GMV" position="top" fontSize={10} fontWeight={600}
                      formatter={(v: any) => fmtMoney(Number(v), currency)} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Per-creator data — navigable / searchable / sortable */}
            <div className="mt-4">
              <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
                {/* Week / month navigator */}
                <div className="d-inline-flex align-items-center border rounded">
                  <button type="button"
                    className="btn btn-sm btn-link text-decoration-none px-2"
                    disabled={!canPrev}
                    onClick={gotoPrev}
                    title={tab === 'weekly' ? 'Previous week' : 'Previous month'}>
                    <i className="bi bi-chevron-left" />
                  </button>
                  <div className="px-2 small fw-bold" style={{ minWidth: 110, textAlign: 'center' }}>
                    {selectedPeriodLabel}
                  </div>
                  <button type="button"
                    className="btn btn-sm btn-link text-decoration-none px-2"
                    disabled={!canNext}
                    onClick={gotoNext}
                    title={tab === 'weekly' ? 'Next week' : 'Next month'}>
                    <i className="bi bi-chevron-right" />
                  </button>
                </div>
                <small className="text-muted">
                  {periods.length > 0 && selectedIdx >= 0
                    ? `${selectedIdx + 1} / ${periods.length}`
                    : ''}
                </small>
                {/* Search */}
                <div className="ms-auto" style={{ minWidth: 220, flex: '0 1 280px' }}>
                  <div className="input-group input-group-sm">
                    <span className="input-group-text"><i className="bi bi-search" /></span>
                    <input
                      className="form-control"
                      placeholder="Search creator…"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                    />
                    {search && (
                      <button type="button" className="btn btn-outline-secondary"
                        onClick={() => setSearch('')}>
                        <i className="bi bi-x-lg" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {filteredSorted.length === 0 ? (
                <div className="text-muted text-center py-4 small">
                  {perCreator.length === 0
                    ? `No performance recorded for ${selectedPeriodLabel}.`
                    : 'No creators match your search.'}
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm align-middle mb-0 pp-sortable-table">
                    <thead className="small text-uppercase text-muted fw-bold">
                      <tr>
                        <SortableTh label="Creator" k="creator" sortKey={sortKey} sortDir={sortDir} onClick={setSort} />
                        <th>{tab === 'weekly' ? 'Week' : 'Month'}</th>
                        <SortableTh label="GMV" k="gmv" sortKey={sortKey} sortDir={sortDir} onClick={setSort} align="end" />
                        <SortableTh label="Items" k="items" sortKey={sortKey} sortDir={sortDir} onClick={setSort} align="end" />
                        <SortableTh label="Trend" k="trend" sortKey={sortKey} sortDir={sortDir} onClick={setSort} align="end" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSorted.map(({ creator, current, prev }) => {
                        const periodLabel = tab === 'weekly'
                          ? weekShort(current!.period_start)
                          : monthShort(current!.period_start);
                        const delta = prev ? current!.gmv - prev.gmv : null;
                        return (
                          <tr key={creator.id}>
                            <td className="fw-semibold">{creator.name}</td>
                            <td className="text-muted small">{periodLabel}</td>
                            <td className="text-end"><span className="text-success fw-semibold">{fmtMoney(current!.gmv, currency)}</span></td>
                            <td className="text-end">{fmtNumber(current!.items_sold)}</td>
                            <td className="text-end">
                              {delta === null ? (
                                <span className="text-muted small">—</span>
                              ) : delta >= 0 ? (
                                <span className="text-success small">
                                  <i className="bi bi-arrow-up-short" />{fmtMoney(Math.abs(delta), currency)}
                                </span>
                              ) : (
                                <span className="text-danger small">
                                  <i className="bi bi-arrow-down-short" />{fmtMoney(Math.abs(delta), currency)}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </Card.Body>
    </Card>
  );
}

function SortableTh<K extends string>({
  label, k, sortKey, sortDir, onClick, align,
}: {
  label: string;
  k: K;
  sortKey: K;
  sortDir: 'asc' | 'desc';
  onClick: (k: K) => void;
  align?: 'end';
}) {
  const active = sortKey === k;
  return (
    <th
      role="button"
      onClick={() => onClick(k)}
      className={`user-select-none ${align === 'end' ? 'text-end' : ''}`}
      style={{ cursor: 'pointer' }}
    >
      <span>{label}</span>
      <i className={`bi ms-1 ${active
        ? (sortDir === 'asc' ? 'bi-caret-up-fill' : 'bi-caret-down-fill')
        : 'bi-caret-down opacity-25'}`} />
    </th>
  );
}
