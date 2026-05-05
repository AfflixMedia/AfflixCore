import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Spinner, Alert, Badge, Button } from 'react-bootstrap';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { useNotifications } from '../notifications/NotificationsContext';
import { addDays, formatRange, formatHuman } from '../lib/dates';
import { WeeklyReportContent, normalizeContent } from '../lib/reportSchema';
import ReportDashboard, { TrendPoint, ApprovalDecisionView } from '../components/ReportDashboard';
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
  const [decisions, setDecisions] = useState<ApprovalDecisionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  const exportPdf = async () => {
    const el = exportRef.current;
    if (!el || !report || !brand) return;
    setExporting(true);
    document.body.classList.add('ac-pdf-capturing');
    // Render at a fixed wide width so layout is consistent across viewports.
    // The PDF page size is then sized to match the actual rendered content,
    // so nothing can be cropped no matter how wide a custom section grows.
    const prevWidth = el.style.width;
    const captureWidth = 1280;
    el.style.width = `${captureWidth}px`;

    // Let recharts and any responsive containers reflow to the new width.
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));

    try {
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        windowWidth: captureWidth,
        width: captureWidth,
        scrollX: 0,
        scrollY: 0,
      });

      // Convert captured pixels → mm (96dpi reference). canvas dims are 2× from scale.
      const PX_TO_MM = 25.4 / 96;
      const contentWidthMm = (canvas.width / 2) * PX_TO_MM;
      const contentHeightMm = (canvas.height / 2) * PX_TO_MM;
      const margin = 8;
      const pageWidth = contentWidthMm + margin * 2;
      const pageHeight = contentHeightMm + margin * 2;

      // Single-page PDF whose page format exactly matches the captured content.
      // Page grows to fit content of any size — no horizontal cropping ever.
      const pdf = new jsPDF({
        unit: 'mm',
        format: [pageWidth, pageHeight],
        orientation: pageWidth > pageHeight ? 'landscape' : 'portrait',
      });

      pdf.addImage(
        canvas.toDataURL('image/jpeg', 0.96),
        'JPEG',
        margin, margin,
        contentWidthMm, contentHeightMm,
      );
      pdf.save(`${brand.name.replace(/\s+/g, '_')}-Week-${report.week_number}.pdf`);
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
      const { data: dec } = await supabase.from('report_approval_decisions')
        .select('id,decision,comment,decided_by_name,decided_at,share_link_id,report_share_links(label)')
        .eq('report_id', r.id).order('decided_at', { ascending: false });
      setDecisions(((dec as any[]) ?? []).map(d => ({
        id: d.id,
        decision: d.decision,
        comment: d.comment,
        decided_by_name: d.decided_by_name,
        decided_at: d.decided_at,
        share_link_label: d.report_share_links?.label ?? null,
      })));
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

  const addComment = async (section: CommentSection, body: string, _authorName: string, parentId?: string) => {
    // We ignore the passed-in author name — the edge function uses the
    // caller's profile name, so it's tamper-proof.
    if (!report) return;
    const { data, error } = await supabase.functions.invoke('post-staff-comment', {
      body: { report_id: report.id, section, body, parent_id: parentId ?? null },
    });
    if (error) throw error;
    if ((data as any)?.error) throw new Error((data as any).error);
    setComments(prev => [...prev, (data as any).comment as Comment]);
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
          approvalDecisions={decisions}
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
