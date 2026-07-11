import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Spinner, Alert, Badge, Button } from 'react-bootstrap';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { supabase } from '../lib/supabase';
import { fnError } from '../lib/functionError';
import { useAuth } from '../auth/AuthContext';
import { useNotifications } from '../notifications/NotificationsContext';
import { addDays, formatRange, formatHuman, formatWeekShort } from '../lib/dates';
import { normalizeContent } from '../lib/reportSchema';
import { normalizeContentV2 } from '../lib/reportSchemaV2';
import { normalizeContentV3 } from '../lib/reportSchemaV3';
import ReportDashboard, { TrendPoint, ApprovalDecisionView } from '../components/ReportDashboard';
import ReportDashboardV2 from '../components/ReportDashboardV2';
import ReportDashboardV3 from '../components/ReportDashboardV3';
import { ChronoPoint } from '../components/report/ChronologyChart';

/** Pull §2 chronology metrics from a report's content (v2 or legacy shape). */
function chronoFromContent(content: any): Omit<ChronoPoint, 'label'> {
  const c = content ?? {};
  const sn = c.snapshot ?? {}, act = c.activity ?? {}, gp = c.gmv_performance ?? {};
  const sa = c.shop_analytics ?? {}, ov = c.overall ?? {}, vp = c.video_performance ?? {};
  const num = (v: any): number | null => {
    if (v == null || v === '') return null;
    const n = Number(v); return Number.isFinite(n) ? n : null;
  };
  const total_gmv = num(sn.total_gmv ?? gp.total_gmv ?? sa.gmv ?? ov.total_gmv);
  const orders = num(sn.orders ?? sa.orders ?? ov.orders);
  const aov = num(sn.aov ?? sa.aov) ?? (total_gmv != null && orders ? total_gmv / orders : null);
  return {
    samples: num(act.samples_approved ?? ov.samples_approved),
    videos: num(act.new_videos_posted ?? sn.new_videos_posted ?? vp.total_videos_posted),
    lives: num(act.live_streams),
    total_gmv, orders, aov,
  };
}
import CanvasRenderer from '../components/canvas/CanvasRenderer';
import {
  CanvasSchema, parseTemplateRow, buildMetricBagFromReportContent,
} from '../lib/reportingCanvas';
import { Comment, CommentSection } from '../components/SectionComments';
import ReportReviewBar, { ReviewState, ReviewStatus } from '../components/ReportReviewBar';

interface ReportRow {
  id: string; brand_id: string; week_start: string; week_end: string;
  week_number: number; status: string; content: any;
  template_id?: string | null;
  review_status?: ReviewStatus; reviewed_at?: string | null; review_note?: string | null;
}
interface Brand { id: string; name: string; client: string; client_status: string | null; }

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
  // Optional canvas template overlay — populated when the report has template_id.
  const [templateSchema, setTemplateSchema] = useState<CanvasSchema | null>(null);
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
      const { data: bd } = await supabase.from('brands').select('id,name,client,client_status').eq('id', r.brand_id).single();
      setBrand(bd as Brand);
      if (r.template_id) {
        const { data: tpl } = await supabase
          .from('report_templates').select('*').eq('id', r.template_id).maybeSingle();
        if (tpl) setTemplateSchema(parseTemplateRow(tpl).schema_json);
      } else {
        setTemplateSchema(null);
      }
      const prevEnd = addDays(r.week_start, -1);
      const { data: pv } = await supabase.from('weekly_reports')
        .select('*').eq('brand_id', r.brand_id).eq('week_end', prevEnd).maybeSingle();
      setPrev(pv as ReportRow | null);
      // The 8 most recent weeks up to and including this report (newest-first
      // from the query, reversed to oldest-first for the trend chart).
      const { data: tr } = await supabase.from('weekly_reports')
        .select('*').eq('brand_id', r.brand_id)
        .lte('week_start', r.week_start).order('week_start', { ascending: false }).limit(8);
      setTrend(((tr as ReportRow[]) ?? []).slice().reverse());
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

  // Reports carry content.format_version: 'v3' (12-section) or 'v2' (14-section);
  // anything else renders on the original classic dashboard.
  const fv = (report?.content as any)?.format_version;
  const fmt: 'classic' | 'v2' | 'v3' = fv === 'v3' ? 'v3' : fv === 'v2' ? 'v2' : 'classic';
  const c = useMemo<any>(() => fmt === 'v3' ? normalizeContentV3(report?.content) : fmt === 'v2' ? normalizeContentV2(report?.content) : normalizeContent(report?.content), [report, fmt]);
  const p = useMemo<any>(() => !prev ? null : (fmt === 'v3' ? normalizeContentV3(prev.content) : fmt === 'v2' ? normalizeContentV2(prev.content) : normalizeContent(prev.content)), [prev, fmt]);
  // GMV trend reads the raw content for every format, so a brand whose history
  // mixes classic + v2 + v3 reports still charts correctly.
  const trendData: TrendPoint[] = useMemo(() => trend.map(t => {
    const cn: any = t.content ?? {};
    const gmv = cn?.snapshot?.total_gmv ?? cn?.gmv_performance?.total_gmv ?? cn?.overall?.total_gmv;
    const aff = cn?.snapshot?.affiliate_gmv ?? cn?.gmv_performance?.affiliate_gmv ?? cn?.overall?.affiliate_gmv ?? cn?.affiliate?.affiliate_gmv;
    return {
      label: formatWeekShort(t.week_start, t.week_end),
      GMV: Number(gmv) || 0,
      'Affiliate GMV': Number(aff) || 0,
    };
  }), [trend]);
  // §2 Weekly Chronology — auto-built from each week's §1/§3 data (no manual entry).
  const chronologyData: ChronoPoint[] = useMemo(() => trend.map(t => ({
    label: formatWeekShort(t.week_start, t.week_end),
    ...chronoFromContent(t.content),
  })), [trend]);
  // v3 week-over-week combo series (bars = orders, line = GMV) across all formats.
  const wowData = useMemo(() => trend.map(t => {
    const cn: any = t.content ?? {};
    const gmv = cn?.overall?.total_gmv ?? cn?.snapshot?.total_gmv ?? cn?.gmv_performance?.total_gmv;
    const orders = cn?.overall?.orders ?? cn?.snapshot?.orders ?? cn?.shop_analytics?.orders;
    return { label: formatWeekShort(t.week_start, t.week_end), gmv: Number(gmv) || 0, orders: Number(orders) || 0 };
  }), [trend]);

  const addComment = async (section: CommentSection, body: string, _authorName: string, parentId?: string) => {
    // We ignore the passed-in author name — the edge function uses the
    // caller's profile name, so it's tamper-proof.
    if (!report) return;
    const { data, error } = await supabase.functions.invoke('post-staff-comment', {
      body: { report_id: report.id, section, body, parent_id: parentId ?? null },
    });
    if (error) throw await fnError(error);
    if ((data as any)?.error) throw new Error((data as any).error);
    setComments(prev => [...prev, (data as any).comment as Comment]);
  };


  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err || !report || !brand) return <Alert variant="danger">{err ?? 'Not found'}</Alert>;

  const brandActive = brand.client_status !== 'closed';

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
          {brandActive && profile?.role !== 'ads_manager' && (
            <Button variant="primary" onClick={() => nav(`/reporting/weekly/${id}/edit`)}>
              <i className="bi bi-pencil me-1" /> Edit data
            </Button>
          )}
          {profile?.role === 'bob' && brandActive && (
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

      <ReportReviewBar
        kind="weekly"
        reportId={report.id}
        brandId={report.brand_id}
        review={{ status: report.review_status ?? 'none', reviewed_at: report.reviewed_at, review_note: report.review_note }}
        onChanged={(next) => setReport(r => r ? { ...r, review_status: next.status, reviewed_at: next.reviewed_at, review_note: next.review_note } : r)}
        disabled={!brandActive}
      />

      {!brandActive && (
        <Alert variant="warning" className="d-flex align-items-center gap-2">
          <i className="bi bi-lock-fill" />
          <div>
            <strong>{brand.name} is inactive.</strong>{' '}
            This report is read-only — reactivate the brand to edit or delete it.
          </div>
        </Alert>
      )}

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

        {templateSchema && (
          <div className="mb-4">
            <div className="d-flex align-items-center gap-2 mb-2">
              <Badge bg="warning" text="dark">
                <i className="bi bi-easel2 me-1" />Canvas template
              </Badge>
              <small className="text-muted">Rendered above the standard dashboard for this report.</small>
            </div>
            <CanvasRenderer
              schema={templateSchema}
              metricBag={{
                current: buildMetricBagFromReportContent(c),
                previous: prev ? buildMetricBagFromReportContent(p) : {},
              }}
            />
            <hr className="my-4" />
          </div>
        )}

        {fmt === 'v3' ? (
          <ReportDashboardV3
            c={c}
            p={p}
            wow={wowData}
            trendData={trendData}
            hasPrev={!!prev}
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
        ) : fmt === 'v2' ? (
          <ReportDashboardV2
            c={c}
            p={p}
            trendData={trendData}
            chronologyData={chronologyData}
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
        ) : (
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
        )}
      </div>
    </>
  );
}
