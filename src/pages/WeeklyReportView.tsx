import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Spinner, Alert, Badge, Button } from 'react-bootstrap';
import html2pdf from 'html2pdf.js';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useNotifications } from '../notifications/NotificationsContext';
import { addDays, formatRange, formatHuman } from '../lib/dates';
import { WeeklyReportContent, normalizeContent } from '../lib/reportSchema';
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
  const [params] = useSearchParams();
  const openSection = params.get('section') as CommentSection | null;
  const highlightCommentId = params.get('comment');
  const { profile } = useAuth();
  const { notifications, markRead } = useNotifications();
  const [report, setReport] = useState<ReportRow | null>(null);
  const [prev, setPrev] = useState<ReportRow | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [trend, setTrend] = useState<ReportRow[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  const exportPdf = async () => {
    const el = exportRef.current;
    if (!el || !report || !brand) return;
    setExporting(true);
    document.body.classList.add('ac-pdf-capturing');
    // The capture target is rendered at a fixed wide width so Bootstrap's grid
    // lays out properly regardless of the user's screen width.
    const prevWidth = el.style.width;
    el.style.width = '1280px';
    try {
      const opts: any = {
        margin: [8, 8, 8, 8],
        filename: `${brand.name.replace(/\s+/g, '_')}-Week-${report.week_number}.pdf`,
        image: { type: 'jpeg', quality: 0.96 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          windowWidth: 1280,
          scrollX: 0,
          scrollY: 0,
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
      };
      await html2pdf().from(el).set(opts).save();
    } finally {
      el.style.width = prevWidth;
      document.body.classList.remove('ac-pdf-capturing');
      setExporting(false);
    }
  };

  useEffect(() => {
    // Mark all unread notifications for this report as read
    notifications.forEach(n => {
      if (!n.read_at && n.payload?.report_id === id) markRead(n.id);
    });
  }, [id, notifications, markRead]);

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

  const c = useMemo<WeeklyReportContent>(() => normalizeContent(report?.content), [report]);
  const p = useMemo<WeeklyReportContent | null>(() => prev ? normalizeContent(prev.content) : null, [prev]);
  const trendData: TrendPoint[] = useMemo(() => trend.map(t => {
    const n = normalizeContent(t.content);
    return {
      label: formatHuman(t.week_start).slice(0, 6),
      GMV: n.overall.total_gmv,
      'Affiliate GMV': n.overall.affiliate_gmv,
    };
  }), [trend]);

  const addComment = async (section: CommentSection, body: string, authorName: string, parentId?: string) => {
    if (!report || !profile) return;
    const { data, error } = await supabase.from('report_comments').insert({
      report_id: report.id,
      section,
      author_type: profile.role === 'bob' ? 'bob' : 'apc',
      author_name: authorName,
      body,
      parent_id: parentId ?? null,
    }).select().single();
    if (error) throw error;
    setComments(prev => [...prev, data as Comment]);
  };


  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err || !report || !brand) return <Alert variant="danger">{err ?? 'Not found'}</Alert>;

  return (
    <>
      <div className="d-flex align-items-start gap-3 mb-3 flex-wrap">
        <button type="button" className="ac-back-btn" onClick={() => nav('/reporting/weekly')}>
          <i className="bi bi-arrow-left" /> Back
        </button>
        <div className="flex-grow-1" />
        <div className="d-flex gap-2 flex-wrap">
          <Button variant="outline-secondary" onClick={exportPdf} disabled={exporting} title="Download a PDF copy of the dashboard">
            <i className="bi bi-printer me-1" /> {exporting ? 'Building PDF…' : 'Export PDF'}
          </Button>
          <Button variant="primary" onClick={() => nav(`/reporting/weekly/${id}/edit`)}>
            <i className="bi bi-pencil me-1" /> Edit data
          </Button>
          {profile?.role === 'bob' && (
            <Button variant="outline-danger" onClick={async () => {
              if (!confirm(`Delete this report permanently?`)) return;
              const { error } = await supabase.from('weekly_reports').delete().eq('id', report!.id);
              if (error) { alert(error.message); return; }
              nav('/reporting/weekly');
            }}>
              <i className="bi bi-trash me-1" /> Delete
            </Button>
          )}
        </div>
      </div>

      <div ref={exportRef} className="ac-report-export-area">
        <div className="d-flex align-items-start gap-3 mb-4 flex-wrap">
          <div className="flex-grow-1 min-w-0">
            <div className="text-muted small">{brand.client}</div>
            <h2 className="mb-1">{brand.name} <span className="text-muted fs-6">— Week #{report.week_number}</span></h2>
            <div className="text-muted">
              {formatRange(report.week_start, report.week_end)}
              <Badge bg={report.status === 'draft' ? 'secondary' : 'success'} className="ms-2">{report.status}</Badge>
            </div>
          </div>
        </div>

        <ReportDashboard
          c={c}
          p={p}
          trendData={trendData}
          hasPrev={!!prev}
          prevTopVideos={p?.top_videos}
          openSectionOnLoad={openSection}
          highlightCommentId={highlightCommentId}
          commentsConfig={{
            mode: 'authed',
            comments,
            currentAuthorName: profile?.full_name || profile?.email || 'User',
            onAdd: addComment,
          }}
        />
      </div>
    </>
  );
}
