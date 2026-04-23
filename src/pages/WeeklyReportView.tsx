import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Spinner, Alert, Badge, Button } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { addDays, formatRange, formatHuman } from '../lib/dates';
import { WeeklyReportContent, emptyContent } from '../lib/reportSchema';
import ReportDashboard, { TrendPoint } from '../components/ReportDashboard';
import { Comment, CommentSection } from '../components/SectionComments';

interface ReportRow {
  id: string; brand_id: string; week_start: string; week_end: string;
  week_number: number; status: string; content: WeeklyReportContent;
}
interface Brand { id: string; name: string; client: string; }

export default function WeeklyReportView() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { profile } = useAuth();
  const [report, setReport] = useState<ReportRow | null>(null);
  const [prev, setPrev] = useState<ReportRow | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [trend, setTrend] = useState<ReportRow[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
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
      const { data: cm } = await supabase.from('report_comments')
        .select('*').eq('report_id', r.id).order('created_at', { ascending: true });
      setComments((cm as Comment[]) ?? []);
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

  const addComment = async (section: CommentSection, body: string, authorName: string) => {
    if (!report || !profile) return;
    const { data, error } = await supabase.from('report_comments').insert({
      report_id: report.id,
      section,
      author_type: profile.role === 'bob' ? 'bob' : 'apc',
      author_name: authorName,
      body,
    }).select().single();
    if (error) throw error;
    setComments(prev => [...prev, data as Comment]);
  };

  const delComment = async (cid: string) => {
    const prevState = comments;
    setComments(comments.filter(x => x.id !== cid));
    const { error } = await supabase.from('report_comments').delete().eq('id', cid);
    if (error) { alert(error.message); setComments(prevState); }
  };

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

      <ReportDashboard
        c={c}
        p={p}
        trendData={trendData}
        hasPrev={!!prev}
        commentsConfig={{
          mode: 'authed',
          comments,
          currentAuthorName: profile?.full_name || profile?.email || 'User',
          onAdd: addComment,
          onDelete: delComment,
        }}
      />
    </>
  );
}

function normalize(content: any): WeeklyReportContent {
  const merged = { ...emptyContent(), ...(content ?? {}) };
  merged.overall  = { ...emptyContent().overall,  ...(content?.overall ?? {}) };
  merged.insights = { ...emptyContent().insights, ...(content?.insights ?? {}) };
  return merged;
}
