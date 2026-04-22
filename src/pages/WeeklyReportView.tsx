import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Spinner, Alert, Badge, Button } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { addDays, formatRange, formatHuman } from '../lib/dates';
import { WeeklyReportContent, emptyContent } from '../lib/reportSchema';
import ReportDashboard, { TrendPoint } from '../components/ReportDashboard';

interface ReportRow {
  id: string; brand_id: string; week_start: string; week_end: string;
  week_number: number; status: string; content: WeeklyReportContent;
}
interface Brand { id: string; name: string; client: string; }

export default function WeeklyReportView() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [report, setReport] = useState<ReportRow | null>(null);
  const [prev, setPrev] = useState<ReportRow | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [trend, setTrend] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: cur, error } = await supabase.from('weekly_reports').select('*').eq('id', id).single();
      if (error) { setErr(error.message); setLoading(false); return; }
      const r = cur as ReportRow;
      setReport(r);
      const { data: bd } = await supabase.from('brands').select('id,name,client').eq('id', r.brand_id).single();
      setBrand(bd as Brand);
      const prevEnd = addDays(r.week_start, -1);
      const { data: pv } = await supabase.from('weekly_reports')
        .select('*').eq('brand_id', r.brand_id).eq('week_end', prevEnd).maybeSingle();
      setPrev(pv as ReportRow | null);
      const { data: tr } = await supabase.from('weekly_reports')
        .select('*').eq('brand_id', r.brand_id)
        .lte('week_start', r.week_start).order('week_start', { ascending: true }).limit(8);
      setTrend((tr as ReportRow[]) ?? []);
      setLoading(false);
    })();
  }, [id]);

  const c = useMemo<WeeklyReportContent>(() => normalize(report?.content), [report]);
  const p = useMemo<WeeklyReportContent | null>(() => prev ? normalize(prev.content) : null, [prev]);
  const trendData: TrendPoint[] = useMemo(() => trend.map(t => ({
    label: formatHuman(t.week_start).slice(0, 6),
    GMV: t.content?.overall?.gmv ?? 0,
    'Affiliate GMV': t.content?.overall?.affiliate_gmv ?? 0,
  })), [trend]);

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err || !report || !brand) return <Alert variant="danger">{err ?? 'Not found'}</Alert>;

  return (
    <>
      <div className="d-flex justify-content-between align-items-start mb-4 flex-wrap gap-2">
        <div>
          <div className="text-muted small">{brand.client}</div>
          <h2 className="mb-1">{brand.name} <span className="text-muted fs-6">— Week #{report.week_number}</span></h2>
          <div className="text-muted">
            {formatRange(report.week_start, report.week_end)}
            <Badge bg={report.status === 'draft' ? 'secondary' : 'success'} className="ms-2">{report.status}</Badge>
          </div>
        </div>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" onClick={() => nav('/reporting/weekly')}>← Back</Button>
          <Button variant="primary" onClick={() => nav(`/reporting/weekly/${id}/edit`)}>
            <i className="bi bi-pencil me-1" /> Edit data
          </Button>
        </div>
      </div>

      <ReportDashboard c={c} p={p} trendData={trendData} hasPrev={!!prev} />
    </>
  );
}

function normalize(content: any): WeeklyReportContent {
  const merged = { ...emptyContent(), ...(content ?? {}) };
  merged.overall  = { ...emptyContent().overall,  ...(content?.overall ?? {}) };
  merged.insights = { ...emptyContent().insights, ...(content?.insights ?? {}) };
  return merged;
}
