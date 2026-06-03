import { useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceDot, LabelList,
} from 'recharts';
import { Card } from 'react-bootstrap';
import {
  PaidVideo, ProgramNote, NOTE_KIND_META, monthKey, monthLabel,
} from '../../lib/paidCollabSchema';

// =====================================================================
// Cumulative pipeline + live videos over time, with note pins
// =====================================================================

interface CumulativeProps {
  videos: PaidVideo[];
  notes: ProgramNote[];
  launchDate: string | null;
}

interface CumulativePoint {
  date: string;        // YYYY-MM-DD
  ts: number;          // epoch ms — used as numeric x-axis
  pipeline: number;    // cumulative count of videos added
  live: number;        // cumulative count of videos posted live
}

function buildCumulative(videos: PaidVideo[], launchDate: string | null): CumulativePoint[] {
  // Collect every date that changes either series, plus launch date and today.
  const dates = new Set<string>();
  if (launchDate) dates.add(launchDate);
  dates.add(new Date().toISOString().slice(0, 10));
  videos.forEach(v => {
    dates.add(v.created_at.slice(0, 10));
    if (v.posted_on) dates.add(v.posted_on);
  });
  const sorted = [...dates].filter(Boolean).sort();
  return sorted.map(d => {
    const cutoff = new Date(d + 'T23:59:59').getTime();
    let pipeline = 0;
    let live = 0;
    for (const v of videos) {
      const created = new Date(v.created_at).getTime();
      if (created <= cutoff) pipeline += 1;
      if (v.status === 'live' && v.posted_on) {
        const posted = new Date(v.posted_on + 'T00:00:00').getTime();
        if (posted <= cutoff) live += 1;
      }
    }
    return { date: d, ts: new Date(d + 'T00:00:00').getTime(), pipeline, live };
  });
}

const fmtTick = (ts: number) =>
  new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function CumulativeChart({ videos, notes, launchDate }: CumulativeProps) {
  const data = useMemo(() => buildCumulative(videos, launchDate), [videos, launchDate]);
  const max = Math.max(1, ...data.map(d => d.pipeline));

  // Notes pinned to chart: snap each pin to the nearest data point on/after occurred_on
  const pins = useMemo(() => {
    return notes
      .filter(n => n.pin_to_chart && n.occurred_on)
      .map(n => {
        const ts = new Date(n.occurred_on! + 'T00:00:00').getTime();
        const meta = NOTE_KIND_META[n.kind];
        // Place pin near top of chart so it doesn't overlap lines
        return { ts, y: max, color: meta.color, kind: n.kind, title: n.title };
      });
  }, [notes, max]);

  if (data.length === 0) {
    return (
      <Card className="h-100">
        <Card.Body className="text-muted text-center py-5">
          <i className="bi bi-graph-up fs-1 d-block mb-2 opacity-50" />
          Add videos to see the cumulative chart.
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card className="h-100">
      <Card.Body>
        <div className="d-flex align-items-baseline justify-content-between mb-2">
          <h6 className="mb-0">Cumulative videos in pipeline</h6>
          <span className="text-muted small">Pins = notes & milestones</span>
        </div>
        <div style={{ width: '100%', height: 300 }}>
          <ResponsiveContainer>
            <LineChart data={data} margin={{ top: 16, right: 24, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
              <XAxis
                dataKey="ts"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={fmtTick}
                stroke="#6c757d"
                fontSize={11}
              />
              <YAxis allowDecimals={false} stroke="#6c757d" fontSize={11} />
              <Tooltip
                labelFormatter={(v: any) => fmtTick(Number(v))}
                formatter={(v: any, name: string) => [v, name]}
              />
              <Legend />
              <Line
                type="monotone" dataKey="pipeline" name="Pipeline (cumulative)"
                stroke="#e8862e" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }}
              />
              <Line
                type="monotone" dataKey="live" name="Live (cumulative)"
                stroke="#198754" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }}
              />
              {pins.map((p, i) => (
                <ReferenceDot
                  key={i}
                  x={p.ts}
                  y={p.y}
                  r={6}
                  fill={p.color}
                  stroke="#fff"
                  strokeWidth={2}
                  ifOverflow="extendDomain"
                  label={{
                    value: p.title.length > 24 ? p.title.slice(0, 24) + '…' : p.title,
                    position: 'top',
                    fill: p.color,
                    fontSize: 10,
                    fontWeight: 600,
                  }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        {pins.length > 0 && (
          <div className="d-flex flex-wrap gap-2 mt-2">
            {pins.map((p, i) => (
              <span key={i} className="badge" style={{ backgroundColor: p.color }}>
                <i className={`bi ${NOTE_KIND_META[p.kind as keyof typeof NOTE_KIND_META].icon} me-1`} />
                {p.title}
              </span>
            ))}
          </div>
        )}
      </Card.Body>
    </Card>
  );
}

// =====================================================================
// Monthly stacked bar — videos added vs went live, per month
// =====================================================================

interface MonthlyStackedProps {
  videos: PaidVideo[];
}

interface MonthlyPoint { month: string; label: string; added: number; live: number; }

function buildMonthly(videos: PaidVideo[]): MonthlyPoint[] {
  const map = new Map<string, MonthlyPoint>();
  const get = (k: string) => {
    let p = map.get(k);
    if (!p) { p = { month: k, label: monthLabel(k), added: 0, live: 0 }; map.set(k, p); }
    return p;
  };
  for (const v of videos) {
    get(monthKey(v.created_at.slice(0, 10))).added += 1;
    if (v.status === 'live' && v.posted_on) {
      get(monthKey(v.posted_on)).live += 1;
    }
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function MonthlyStackedChart({ videos }: MonthlyStackedProps) {
  const data = useMemo(() => buildMonthly(videos), [videos]);

  // Headline totals across the displayed range — gives the chart a clear "story".
  const totals = useMemo(() => {
    return data.reduce((acc, d) => {
      acc.added += d.added;
      acc.live  += d.live;
      return acc;
    }, { added: 0, live: 0 });
  }, [data]);
  const maxVal = useMemo(
    () => Math.max(1, ...data.flatMap(d => [d.added, d.live])),
    [data],
  );

  if (data.length === 0) {
    return (
      <Card className="h-100">
        <Card.Body className="text-muted text-center py-5">
          <i className="bi bi-bar-chart-fill fs-1 d-block mb-2 opacity-50" />
          Monthly breakdown appears once videos are added.
        </Card.Body>
      </Card>
    );
  }
  return (
    <Card className="h-100 shadow-sm border-0">
      <Card.Body>
        {/* Header: title + at-a-glance KPIs + legend swatches */}
        <div className="d-flex justify-content-between align-items-start mb-3 flex-wrap gap-2">
          <div>
            <h6 className="mb-1 fw-bold">Monthly activity</h6>
            <div className="text-muted small">Videos added vs went live, per month</div>
          </div>
          <div className="d-flex gap-3">
            <div className="text-end">
              <div className="text-muted" style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.5px' }}>Added</div>
              <div className="fw-bold" style={{ color: '#e8862e', fontSize: '1.15rem' }}>{totals.added}</div>
            </div>
            <div className="text-end">
              <div className="text-muted" style={{ fontSize: '.7rem', textTransform: 'uppercase', letterSpacing: '.5px' }}>Live</div>
              <div className="fw-bold" style={{ color: '#198754', fontSize: '1.15rem' }}>{totals.live}</div>
            </div>
          </div>
        </div>

        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={data}
              margin={{ top: 24, right: 16, bottom: 4, left: -8 }}
              barCategoryGap="22%">
              <defs>
                <linearGradient id="ma-added" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e3b" stopOpacity={1} />
                  <stop offset="100%" stopColor="#e8862e" stopOpacity={.85} />
                </linearGradient>
                <linearGradient id="ma-live" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={1} />
                  <stop offset="100%" stopColor="#198754" stopOpacity={.85} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef0f3" vertical={false} />
              <XAxis dataKey="label" stroke="#6c757d" fontSize={12}
                tickLine={false} axisLine={false} dy={6} />
              <YAxis allowDecimals={false} stroke="#6c757d" fontSize={11}
                tickLine={false} axisLine={false}
                domain={[0, Math.ceil(maxVal * 1.2)]} />
              <Tooltip
                cursor={{ fill: 'rgba(232,134,46,.06)' }}
                contentStyle={{
                  borderRadius: 10,
                  border: '1px solid #e9ecef',
                  boxShadow: '0 8px 24px rgba(20,22,32,.08)',
                  padding: '8px 12px',
                  fontSize: '.85rem',
                }}
                labelStyle={{ fontWeight: 700, marginBottom: 4 }}
                formatter={(v: any, name: any) => [v, name]}
              />
              <Bar dataKey="added" name="Added"
                fill="url(#ma-added)" radius={[8, 8, 0, 0]} maxBarSize={48}>
                <LabelList dataKey="added" position="top"
                  fontSize={11} fontWeight={700} fill="#e8862e" />
              </Bar>
              <Bar dataKey="live" name="Went live"
                fill="url(#ma-live)" radius={[8, 8, 0, 0]} maxBarSize={48}>
                <LabelList dataKey="live" position="top"
                  fontSize={11} fontWeight={700} fill="#198754" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Inline legend with colored dots — clearer than the default. */}
        <div className="d-flex gap-3 mt-2 small">
          <span className="d-inline-flex align-items-center gap-1">
            <span style={{ width: 10, height: 10, borderRadius: 3, background: '#e8862e', display: 'inline-block' }} />
            <span className="text-muted">Added</span>
          </span>
          <span className="d-inline-flex align-items-center gap-1">
            <span style={{ width: 10, height: 10, borderRadius: 3, background: '#198754', display: 'inline-block' }} />
            <span className="text-muted">Went live</span>
          </span>
        </div>
      </Card.Body>
    </Card>
  );
}
