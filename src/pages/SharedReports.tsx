import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Spinner, Alert, Form, Row, Col, Badge, Button, Tab, Nav, Offcanvas, Modal } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { fnError } from '../lib/functionError';
import { addDays, formatRange, formatHuman, formatWeekShort, fromISO } from '../lib/dates';
import { WeeklyReportContent, normalizeContent } from '../lib/reportSchema';
import { MonthlyReportContent, normalizeMonthlyContent } from '../lib/monthlyReportSchema';
import ReportDashboard, { TrendPoint, ApprovalDecisionView } from '../components/ReportDashboard';
import MonthlyReportDashboard from '../components/MonthlyReportDashboard';
import SectionComments, { Comment, CommentSection } from '../components/SectionComments';
import { resourceIcon } from '../lib/resourceIcon';
import ResourceComments, { ResourceComment } from '../components/ResourceComments';
import ApprovalsModal, { PendingApprovalReport } from '../components/share/ApprovalsModal';
// import MonthPickerModal from '../components/share/MonthPickerModal'; // disabled — see MonthQuickPicks
import LatestReportsModal from '../components/share/LatestReportsModal';
import ProgramThreadPanel, { ProgramThreadComment } from '../components/paidcollab/ProgramThreadPanel';
import {
  PaidProgram, PaidCreator, PaidVideo as PaidVideoRow, BrandProduct as BrandProductRow,
  PaidCreatorPerformance, ProgramNote, isCreatorPaymentPending,
  BrandCreatorAggregate, buildBrandCreatorAggregate, aggBrandGmv, aggBrandItems,
  summarizePrograms, programDisplayName, programPeriodLabel, isProgramEnded,
  fmtMoney as fmtMoneyPC, fmtNumber as fmtNumberPC,
} from '../lib/paidCollabSchema';
import ProgramCard from '../components/paidcollab/ProgramCard';
import ProgramProgress from '../components/paidcollab/ProgramProgress';
import { CumulativeChart, MonthlyStackedChart } from '../components/paidcollab/Charts';
import Avatar from '../components/Avatar';
import SharedHandlerCollabPane from '../components/share/SharedHandlerCollabPane';
import { isPendingVisible } from './paid-collab/handlerCollabReadonly';
import type { HandlerBrandMonth, HandlerCreator } from './handler-collab/store';

interface ApprovalDecisionRow {
  id: string;
  report_id: string;
  report_type: 'weekly' | 'monthly';
  share_link_id: string;
  decision: 'approved' | 'changes_requested';
  comment: string | null;
  decided_by_name: string;
  decided_at: string;
}

interface Brand { id: string; name: string; client: string | null; client_id: string | null; payment_popup_default?: 'auto' | 'force_hide' | 'force_show'; }
interface Report {
  id: string; brand_id: string; week_start: string; week_end: string;
  week_number: number; status: string; content: WeeklyReportContent;
}
interface MonthlyReport {
  id: string; brand_id: string; month: string;
  status: string; content: MonthlyReportContent;
}
interface SharedResource { id: string; name: string; url: string; description: string | null; scope: string; brand_id: string | null; }

export default function SharedReports() {
  const { token } = useParams<{ token: string }>();
  const [client, setClient] = useState<{ id: string; name: string } | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [monthlyReports, setMonthlyReports] = useState<MonthlyReport[]>([]);
  const [resources, setResources] = useState<SharedResource[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [resourceComments, setResourceComments] = useState<ResourceComment[]>([]);
  const [feedbackResource, setFeedbackResource] = useState<SharedResource | null>(null);
  const [publicName, setPublicName] = useState<string>(localStorage.getItem('ac_public_name') ?? '');
  const [label, setLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [activeBrandId, setActiveBrandId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'reporting' | 'monthly' | 'approved' | 'resources' | 'paid-collab' | 'new-paid-collab'>('reporting');
  const [month, setMonth] = useState(currentMonth());
  const [openId, setOpenId] = useState<string | null>(null);
  const [openMonthlyId, setOpenMonthlyId] = useState<string | null>(null);
  const [includeReports, setIncludeReports] = useState(true);
  const [includeMonthlyReports, setIncludeMonthlyReports] = useState(false);
  const [includeResources, setIncludeResources] = useState(true);
  const [includePaidCollab, setIncludePaidCollab] = useState(false);

  // Paid Collab state (loaded only when the link opts in).
  const [pcPrograms, setPcPrograms] = useState<PaidProgram[]>([]);
  const [pcCreators, setPcCreators] = useState<PaidCreator[]>([]);
  const [pcVideos, setPcVideos] = useState<PaidVideoRow[]>([]);
  const [pcProducts, setPcProducts] = useState<BrandProductRow[]>([]);
  const [pcProgramProducts, setPcProgramProducts] = useState<{ program_id: string; product_id: string }[]>([]);
  const [pcThreads, setPcThreads] = useState<ProgramThreadComment[]>([]);
  const [pcPerformance, setPcPerformance] = useState<PaidCreatorPerformance[]>([]);
  const [pcNotes, setPcNotes] = useState<ProgramNote[]>([]);
  // New handler-collab data (current Paid Collab model) for the "New Paid Collab" tab.
  const [pcMonths, setPcMonths] = useState<HandlerBrandMonth[]>([]);
  const [pcHandlerCreators, setPcHandlerCreators] = useState<HandlerCreator[]>([]);
  const [pcComments, setPcComments] = useState<any[]>([]);
  const [openProgramId, setOpenProgramId] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState<'brand' | 'general'>('brand');
  const [decisions, setDecisions] = useState<ApprovalDecisionRow[]>([]);
  // Every link's decisions on this link's reports — feeds the "Approved"
  // history tab so approvals made via an older/rotated link still show.
  const [allDecisions, setAllDecisions] = useState<ApprovalDecisionRow[]>([]);
  const [showApprovals, setShowApprovals] = useState(false);
  const [singleApprovalId, setSingleApprovalId] = useState<string | null>(null);
  const [singleApprovalType, setSingleApprovalType] = useState<'weekly' | 'monthly'>('weekly');
  const [pickerAfterApprovals, setPickerAfterApprovals] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  // Replaces the legacy month picker as the initial landing prompt — shows the
  // 3 most-recent reports so the client can jump straight in or close to browse.
  const [showLatestReports, setShowLatestReports] = useState(false);
  // Standalone approval-thread offcanvas — lets the client open a report's
  // conversation thread from the share landing cards without going into the
  // full dashboard. Each report has its own thread (filtered by report_id).
  const [threadFor, setThreadFor] = useState<{
    reportId: string; reportType: 'weekly' | 'monthly';
    brandName: string; periodLabel: string;
  } | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true); setErr(null);
      try {
        const { data, error } = await supabase.functions.invoke('get-shared-reports', {
          body: { token },
        });
        if (error) throw await fnError(error);
        if ((data as any)?.error) throw new Error((data as any).error);
        setClient(data.client);
        setBrands(data.brands);
        setReports(data.reports);
        setMonthlyReports(data.monthly_reports ?? []);
        setResources(data.resources ?? []);
        setComments(data.comments ?? []);
        setResourceComments(data.resource_comments ?? []);
        setDecisions(data.approval_decisions ?? []);
        // Fallback to the per-link list if the edge fn hasn't been redeployed
        // with approval_decisions_all yet.
        setAllDecisions(data.approval_decisions_all ?? data.approval_decisions ?? []);
        setLabel(data.label);
        const ir = data.include_reports !== false;
        const im = data.include_monthly_reports === true;
        const ix = data.include_resources !== false;
        const ipc = data.include_paid_collab === true;
        setIncludeReports(ir);
        setIncludeMonthlyReports(im);
        setIncludeResources(ix);
        setIncludePaidCollab(ipc);
        setPcPrograms((data.paid_collab_programs ?? []) as PaidProgram[]);
        setPcCreators((data.paid_collab_creators ?? []) as PaidCreator[]);
        setPcVideos((data.paid_collab_videos ?? []) as PaidVideoRow[]);
        setPcProducts((data.paid_collab_products ?? []) as BrandProductRow[]);
        setPcProgramProducts((data.paid_collab_program_products ?? []) as any[]);
        setPcThreads((data.paid_collab_threads ?? []) as ProgramThreadComment[]);
        setPcPerformance((data.paid_collab_performance ?? []) as PaidCreatorPerformance[]);
        setPcNotes((data.paid_collab_program_notes ?? []) as ProgramNote[]);
        setPcMonths((data.handler_months ?? []) as HandlerBrandMonth[]);
        setPcHandlerCreators((data.handler_creators ?? []) as HandlerCreator[]);
        setPcComments((data.paid_collab_comments ?? []) as any[]);
        const mode: 'brand' | 'general' = data.link_mode === 'general' ? 'general' : 'brand';
        setLinkMode(mode);
        // Default landing tab — first enabled section
        if (ir) setActiveTab('reporting');
        else if (im) setActiveTab('monthly');
        else if (ix) setActiveTab('resources');
        else if (ipc) setActiveTab('new-paid-collab');
        if (data.brands?.length > 0) setActiveBrandId(data.brands[0].id);

        // Brand-mode entry flow: approvals popup first (if any pending across
        // weekly OR monthly), then the welcome popup (latest reports + any pending
        // Paid Collab payments). The welcome popup also shows on PC-only links.
        if (mode === 'brand') {
          const decisionsList: ApprovalDecisionRow[] = data.approval_decisions ?? [];
          const decidedKey = (rt: 'weekly' | 'monthly', rid: string) => `${rt}:${rid}`;
          const decided = new Set<string>(decisionsList.map(d => decidedKey(d.report_type, d.report_id)));
          const now = Date.now();
          // Auto-popup-eligible: approval enabled, not decided yet, and (no
          // expiry OR expiry is in the future). Expired approvals are still
          // viewable on the dashboard — they just don't auto-prompt.
          const isAutoPromptEligible = (r: any) => {
            const a = r.content?.approval;
            if (!a?.enabled) return false;
            if (a.expires_at && new Date(a.expires_at).getTime() < now) return false;
            return true;
          };
          const weeklyPending = ir
            ? (data.reports ?? []).filter((r: any) =>
                isAutoPromptEligible(r) && !decided.has(decidedKey('weekly', r.id))
              ).length : 0;
          const monthlyPending = im
            ? (data.monthly_reports ?? []).filter((r: any) =>
                isAutoPromptEligible(r) && !decided.has(decidedKey('monthly', r.id))
              ).length : 0;
          const pcPaymentsPending = ipc
            ? (data.handler_creators ?? []).filter((c: any) => isPendingVisible(c)).length : 0;
          if ((ir || im) && weeklyPending + monthlyPending > 0) {
            setShowApprovals(true);
            setPickerAfterApprovals(true);
          } else if (ir || im || pcPaymentsPending > 0) {
            setShowLatestReports(true);
          }
        }
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to load');
      }
      setLoading(false);
    })();
  }, [token]);

  const activeBrand = useMemo(() => brands.find(b => b.id === activeBrandId) ?? null, [brands, activeBrandId]);

  const brandReports = useMemo(() => {
    return reports.filter(r => r.brand_id === activeBrandId);
  }, [reports, activeBrandId]);

  const monthFiltered = useMemo(() => {
    if (month === 'all') return brandReports;
    return brandReports.filter(r => r.week_start.slice(0, 7) === month);
  }, [brandReports, month]);

  const brandResources = useMemo(() => {
    // brand-specific + general for the public
    return resources.filter(r =>
      (r.scope === 'brand' && r.brand_id === activeBrandId) || r.scope === 'general'
    );
  }, [resources, activeBrandId]);

  const openReport = useMemo(() => reports.find(r => r.id === openId) ?? null, [reports, openId]);
  const prevReport = useMemo(() => {
    if (!openReport) return null;
    const prevEnd = addDays(openReport.week_start, -1);
    return reports.find(r => r.brand_id === openReport.brand_id && r.week_end === prevEnd) ?? null;
  }, [openReport, reports]);
  const trendData: TrendPoint[] = useMemo(() => {
    if (!openReport) return [];
    return reports
      .filter(r => r.brand_id === openReport.brand_id && r.week_start <= openReport.week_start)
      .sort((a, b) => a.week_start.localeCompare(b.week_start))
      .slice(-8)
      .map(t => {
        const n = normalizeContent(t.content);
        return {
          label: formatWeekShort(t.week_start, t.week_end),
          GMV: n.overall.total_gmv,
          'Affiliate GMV': n.overall.affiliate_gmv,
        };
      });
  }, [openReport, reports]);

  // Decisions are keyed by (report_type, report_id) so a weekly + monthly report
  // never accidentally share state.
  const decidedSet = useMemo(
    () => new Set(decisions.map(d => `${d.report_type}:${d.report_id}`)),
    [decisions],
  );
  const fmtMonth = (yyyymm: string) => {
    const [y, m] = yyyymm.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
  };
  const weeklyToPending = (r: Report): PendingApprovalReport => {
    const b = brands.find(x => x.id === r.brand_id);
    return {
      id: r.id,
      report_type: 'weekly',
      brand_id: r.brand_id,
      brand_name: b?.name ?? 'Brand',
      period_label: `Week #${r.week_number} — ${formatRange(r.week_start, r.week_end)}`,
      approval_html: normalizeContent(r.content).approval?.content ?? '',
    };
  };
  const monthlyToPending = (r: MonthlyReport): PendingApprovalReport => {
    const b = brands.find(x => x.id === r.brand_id);
    return {
      id: r.id,
      report_type: 'monthly',
      brand_id: r.brand_id,
      brand_name: b?.name ?? 'Brand',
      period_label: fmtMonth(r.month),
      approval_html: normalizeMonthlyContent(r.content).approval?.content ?? '',
    };
  };
  const pendingApprovals: PendingApprovalReport[] = useMemo(() => {
    const now = Date.now();
    const stillAutoPromptable = (a: any) => {
      if (a?.enabled !== true) return false;
      if (a.expires_at && new Date(a.expires_at).getTime() < now) return false;
      return true;
    };
    const w = reports
      .filter(r => stillAutoPromptable(r.content?.approval) && !decidedSet.has(`weekly:${r.id}`))
      .map(weeklyToPending);
    const m = monthlyReports
      .filter(r => stillAutoPromptable(r.content?.approval) && !decidedSet.has(`monthly:${r.id}`))
      .map(monthlyToPending);
    return [...w, ...m];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports, monthlyReports, brands, decidedSet]);
  // For the badge → popup flow we may pass a single (possibly already-decided) report.
  const modalPending: PendingApprovalReport[] = useMemo(() => {
    if (singleApprovalId) {
      if (singleApprovalType === 'monthly') {
        const one = monthlyReports.find(r => r.id === singleApprovalId);
        return one ? [monthlyToPending(one)] : [];
      }
      const one = reports.find(r => r.id === singleApprovalId);
      return one ? [weeklyToPending(one)] : [];
    }
    return pendingApprovals;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [singleApprovalId, singleApprovalType, reports, monthlyReports, pendingApprovals]);
  const existingDecisionsMap = useMemo(() => {
    const map: Record<string, { decision: 'approved' | 'changes_requested'; comment: string | null; decided_by_name: string; decided_at: string }> = {};
    for (const d of decisions) {
      map[d.report_id] = {
        decision: d.decision,
        comment: d.comment,
        decided_by_name: d.decided_by_name,
        decided_at: d.decided_at,
      };
    }
    return map;
  }, [decisions]);
  const monthsWithData = useMemo(() => {
    const s = new Set<string>(reports.map(r => r.week_start.slice(0, 7)));
    monthlyReports.forEach(r => s.add(r.month));
    return s;
  }, [reports, monthlyReports]);

  // "Approved" tab — this brand's approved-report history, newest decision
  // first. Uses allDecisions (every link's decisions) so history survives link
  // rotation. Each row joins the decision to its (still-shared) report so the
  // row can open it; decisions whose report is no longer on the link are skipped.
  const approvedForBrand = useMemo(() => {
    const rows: {
      decision: ApprovalDecisionRow;
      reportType: 'weekly' | 'monthly';
      reportId: string;
      periodLabel: string;
      monthKey: string;
    }[] = [];
    for (const d of allDecisions) {
      if (d.decision !== 'approved') continue;
      if (d.report_type === 'monthly') {
        const r = monthlyReports.find(x => x.id === d.report_id);
        if (!r || r.brand_id !== activeBrandId) continue;
        rows.push({
          decision: d, reportType: 'monthly', reportId: r.id,
          periodLabel: fmtMonthLabel(r.month), monthKey: r.month,
        });
      } else {
        const r = reports.find(x => x.id === d.report_id);
        if (!r || r.brand_id !== activeBrandId) continue;
        rows.push({
          decision: d, reportType: 'weekly', reportId: r.id,
          periodLabel: `Week #${r.week_number} — ${formatRange(r.week_start, r.week_end)}`,
          monthKey: r.week_start.slice(0, 7),
        });
      }
    }
    rows.sort((a, b) => b.decision.decided_at.localeCompare(a.decision.decided_at));
    return rows;
  }, [allDecisions, reports, monthlyReports, activeBrandId]);

  const clientName = client?.name ?? 'Client';
  if (loading) return <PublicShell clientName={clientName}><div className="text-center py-5"><Spinner animation="border" /></div></PublicShell>;
  if (err) return <PublicShell clientName={clientName}><Alert variant="danger">{err}</Alert></PublicShell>;

  // Low-level: post a comment to a specific (report, section). Used by both
  // the in-dashboard threads and the standalone thread offcanvas on the cards.
  const postComment = async (
    reportType: 'weekly' | 'monthly', reportId: string,
    section: CommentSection, body: string, authorName: string, parentId?: string,
  ) => {
    const { data, error } = await supabase.functions.invoke('post-shared-comment', {
      body: { token, report_id: reportId, report_type: reportType, section, author_name: authorName, body, parent_id: parentId },
    });
    if (error) throw await fnError(error);
    if ((data as any)?.error) throw new Error((data as any).error);
    setComments(prev => [...prev, (data as any).comment as Comment]);
    setPublicName(authorName);
  };

  const addComment = async (
    section: CommentSection, body: string, authorName: string, parentId?: string,
    reportType: 'weekly' | 'monthly' = 'weekly',
  ) => {
    const reportId = reportType === 'monthly' ? openMonthlyId : (openReport?.id ?? null);
    if (!reportId) return;
    await postComment(reportType, reportId, section, body, authorName, parentId);
  };

  // Count approval-section comments per report so the "Thread (N)" badge on
  // each card shows live counts. Comments include the mirrored decision rows.
  const approvalThreadCount = (reportId: string, reportType: 'weekly' | 'monthly') =>
    comments.filter(c =>
      c.report_id === reportId &&
      ((reportType === 'monthly' ? c.report_type === 'monthly' : c.report_type !== 'monthly')) &&
      c.section === 'approval'
    ).length;

  // Comments to show inside the standalone thread offcanvas.
  const threadComments: Comment[] = threadFor
    ? comments.filter(c =>
        c.report_id === threadFor.reportId &&
        ((threadFor.reportType === 'monthly' ? c.report_type === 'monthly' : c.report_type !== 'monthly')) &&
        c.section === 'approval'
      )
    : [];

  const onThreadAdd = async (body: string, name: string, parentId?: string) => {
    if (!threadFor) return;
    await postComment(threadFor.reportType, threadFor.reportId, 'approval', body, name, parentId);
  };

  const reportComments = openReport ? comments.filter(c => c.report_id === openReport.id && c.report_type !== 'monthly') : [];
  const openMonthly = openMonthlyId ? monthlyReports.find(r => r.id === openMonthlyId) ?? null : null;
  const monthlyReportComments = openMonthly ? comments.filter(c => c.report_id === openMonthly.id && c.report_type === 'monthly') : [];

  const submitApprovals = async (
    items: { report_id: string; report_type: 'weekly' | 'monthly'; decision: 'approved' | 'changes_requested'; comment: string; decided_by_name: string }[]
  ) => {
    for (const it of items) {
      const { data, error } = await supabase.functions.invoke('post-approval-decision', {
        body: { token, ...it },
      });
      if (error) throw await fnError(error);
      if ((data as any)?.error) throw new Error((data as any).error);
      const inserted = (data as any).decision;
      setDecisions(prev => {
        const filtered = prev.filter(d => !(d.report_id === inserted.report_id && d.report_type === inserted.report_type));
        return [...filtered, inserted];
      });
      // Keep the "Approved" history tab in sync (decision rows are unique by
      // id, so a plain de-dup append is enough here).
      setAllDecisions(prev => prev.some(d => d.id === inserted.id) ? prev : [...prev, inserted]);
      // The edge function also mirrors the decision into report_comments so the
      // approval section's offcanvas thread shows it. Push it into local state.
      const mirrorComment = (data as any).comment;
      if (mirrorComment?.id) {
        setComments(prev => prev.some(c => c.id === mirrorComment.id) ? prev : [...prev, mirrorComment as Comment]);
      }
    }
    if (items[0]?.decided_by_name) {
      setPublicName(items[0].decided_by_name);
      localStorage.setItem('ac_public_name', items[0].decided_by_name);
    }
  };

  const addResourceComment = async (body: string, authorName: string, parentId?: string) => {
    if (!feedbackResource) return;
    const { data, error } = await supabase.functions.invoke('post-shared-resource-comment', {
      body: { token, resource_id: feedbackResource.id, author_name: authorName, body, parent_id: parentId },
    });
    if (error) throw await fnError(error);
    if ((data as any)?.error) throw new Error((data as any).error);
    setResourceComments(prev => [...prev, (data as any).comment as ResourceComment]);
    setPublicName(authorName);
  };
  const resourceCommentCount = (rid: string) => resourceComments.filter(c => c.resource_id === rid).length;

  // Paid-collab comment (public client) — posts via edge function, appends locally.
  const addPaidCollabComment = async (
    brandId: string, targetType: string, targetKey: string,
    body: string, authorName: string, parentId?: string,
  ) => {
    const { data, error } = await supabase.functions.invoke('post-shared-paidcollab-comment', {
      body: { token, brand_id: brandId, target_type: targetType, target_key: targetKey, author_name: authorName, body, parent_id: parentId ?? null },
    });
    if (error) throw await fnError(error);
    if ((data as any)?.error) throw new Error((data as any).error);
    setPcComments(prev => [...prev, (data as any).comment]);
    setPublicName(authorName);
  };

  // Client flags that they processed a creator's payment (PayPal). Soft flag +
  // notifies the team; does NOT change the real payment_status.
  const confirmPaidCollabPayment = async (creatorId: string, confirmed: boolean) => {
    const brandId = pcHandlerCreators.find(c => c.id === creatorId)?.brand_id;
    const { data, error } = await supabase.functions.invoke('post-shared-paidcollab-paid', {
      body: { token, brand_id: brandId, creator_id: creatorId, confirmed, author_name: publicName || null },
    });
    if (error) throw await fnError(error);
    if ((data as any)?.error) throw new Error((data as any).error);
    const updated = (data as any).creator as HandlerCreator;
    setPcHandlerCreators(prev => prev.map(c => (c.id === creatorId ? { ...c, ...updated } : c)));
  };

  // Report detail view
  if (openReport && activeBrand) {
    // Reports for this brand are sorted desc by week_start (newest first).
    const sameBrand = reports.filter(r => r.brand_id === activeBrand.id);
    const idx = sameBrand.findIndex(r => r.id === openReport.id);
    const newer = idx > 0 ? sameBrand[idx - 1] : null;          // index-1 is more recent
    const older = idx >= 0 && idx < sameBrand.length - 1 ? sameBrand[idx + 1] : null;
    return (
      <PublicShell clientName={clientName}>
        <div className="d-flex align-items-start gap-3 mb-4 flex-wrap">
          <button type="button" className="ac-back-btn" onClick={() => setOpenId(null)}>
            <i className="bi bi-arrow-left" /> Back
          </button>
          <div className="flex-grow-1 min-w-0">
            <div className="text-muted small">{activeBrand.name}</div>
            <h4 className="mb-0">Week #{openReport.week_number} — {formatRange(openReport.week_start, openReport.week_end)}</h4>
          </div>
        </div>
        <ReportDashboard
          c={normalizeContent(openReport.content)}
          p={prevReport ? normalizeContent(prevReport.content) : null}
          trendData={trendData}
          hasPrev={!!prevReport}
          prevTopVideos={prevReport ? normalizeContent(prevReport.content).top_videos : undefined}
          paidCollab={{ programs: pcPrograms, creators: pcCreators, videos: pcVideos, performance: pcPerformance }}
          onOpenPaidCollabProgram={(pid) => {
            setOpenId(null);
            setOpenMonthlyId(null);
            setActiveTab('paid-collab');
            setOpenProgramId(pid);
            window.scrollTo({ top: 0 });
          }}
          approvalAction={openReport.content?.approval?.enabled ? {
            myDecision: (() => {
              const d = decisions.find(x => x.report_id === openReport.id && x.report_type !== 'monthly');
              return d ? {
                id: d.id, decision: d.decision, comment: d.comment,
                decided_by_name: d.decided_by_name, decided_at: d.decided_at,
              } : null;
            })(),
            defaultName: publicName,
            onSubmit: async (choice, comment, name) => {
              await submitApprovals([{
                report_id: openReport.id,
                report_type: 'weekly',
                decision: choice,
                comment,
                decided_by_name: name,
              }]);
            },
          } : undefined}
          commentsConfig={{
            mode: 'public',
            comments: reportComments,
            defaultPublicName: publicName,
            onAdd: addComment,
          }}
        />
        <div className="ac-report-nav">
          <button
            type="button"
            className="ac-nav-arrow-btn"
            onClick={() => older && setOpenId(older.id)}
            disabled={!older}
          >
            <i className="bi bi-arrow-left" />
            <span className="ac-nav-arrow-label">
              <span className="ac-nav-arrow-hint">Previous</span>
              <span>{older ? `Week #${older.week_number}` : 'No earlier report'}</span>
            </span>
          </button>
          <button
            type="button"
            className="ac-nav-arrow-btn"
            onClick={() => newer && setOpenId(newer.id)}
            disabled={!newer}
          >
            <span className="ac-nav-arrow-label" style={{ alignItems: 'flex-end' }}>
              <span className="ac-nav-arrow-hint">Next</span>
              <span>{newer ? `Week #${newer.week_number}` : 'No later report'}</span>
            </span>
            <i className="bi bi-arrow-right" />
          </button>
        </div>
      </PublicShell>
    );
  }

  // Monthly report detail view
  if (openMonthly && activeBrand) {
    const sameBrandM = monthlyReports.filter(r => r.brand_id === activeBrand.id)
      .sort((a, b) => b.month.localeCompare(a.month));    // newest first
    const idxM = sameBrandM.findIndex(r => r.id === openMonthly.id);
    const newerM = idxM > 0 ? sameBrandM[idxM - 1] : null;
    const olderM = idxM >= 0 && idxM < sameBrandM.length - 1 ? sameBrandM[idxM + 1] : null;
    const fmtMonthLabel = (yyyymm: string) => {
      const [y, m] = yyyymm.split('-').map(Number);
      return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
    };
    return (
      <PublicShell clientName={clientName}>
        <div className="d-flex align-items-start gap-3 mb-4 flex-wrap">
          <button type="button" className="ac-back-btn" onClick={() => setOpenMonthlyId(null)}>
            <i className="bi bi-arrow-left" /> Back
          </button>
          <div className="flex-grow-1 min-w-0">
            <div className="text-muted small">{activeBrand.name}</div>
            <h4 className="mb-0">{fmtMonthLabel(openMonthly.month)} <Badge bg="info" className="ms-2">Monthly</Badge></h4>
          </div>
        </div>
        <MonthlyReportDashboard
          c={normalizeMonthlyContent(openMonthly.content)}
          paidCollab={{ programs: pcPrograms, creators: pcCreators, videos: pcVideos, performance: pcPerformance }}
          onOpenPaidCollabProgram={(pid) => {
            setOpenId(null);
            setOpenMonthlyId(null);
            setActiveTab('paid-collab');
            setOpenProgramId(pid);
            window.scrollTo({ top: 0 });
          }}
          p={(() => {
            const [y, mm] = openMonthly.month.split('-').map(Number);
            const prevYM = `${new Date(y, mm - 2, 1).getFullYear()}-${String(new Date(y, mm - 2, 1).getMonth() + 1).padStart(2, '0')}`;
            const pr = monthlyReports.find(r => r.brand_id === openMonthly.brand_id && r.month === prevYM);
            return pr ? normalizeMonthlyContent(pr.content) : null;
          })()}
          hasPrev={(() => {
            const [y, mm] = openMonthly.month.split('-').map(Number);
            const prevYM = `${new Date(y, mm - 2, 1).getFullYear()}-${String(new Date(y, mm - 2, 1).getMonth() + 1).padStart(2, '0')}`;
            return monthlyReports.some(r => r.brand_id === openMonthly.brand_id && r.month === prevYM);
          })()}
          trendData={(() => {
            const sameBrand = monthlyReports
              .filter(r => r.brand_id === openMonthly.brand_id && r.month <= openMonthly.month)
              .sort((a, b) => a.month.localeCompare(b.month))
              .slice(-8);
            return sameBrand.map(t => {
              const n = normalizeMonthlyContent(t.content);
              const [y, mm] = t.month.split('-').map(Number);
              return {
                label: new Date(y, mm - 1, 1).toLocaleString(undefined, { month: 'short' }),
                'Total Sales':   n.total_sales.month,
                'Affiliate GMV': n.gmv_breakdown.affiliate_gmv.this,
              };
            });
          })()}
          monthLabel={fmtMonthLabel(openMonthly.month)}
          brandName={activeBrand.name}
          clientName={activeBrand.client}
          approvalDecisions={decisions
            .filter(d => d.report_id === openMonthly.id && d.report_type === 'monthly')
            .map(d => ({
              id: d.id, decision: d.decision, comment: d.comment,
              decided_by_name: d.decided_by_name, decided_at: d.decided_at,
            }))}
          approvalAction={openMonthly.content?.approval?.enabled ? {
            myDecision: (() => {
              const d = decisions.find(x => x.report_id === openMonthly.id && x.report_type === 'monthly');
              return d ? {
                id: d.id, decision: d.decision, comment: d.comment,
                decided_by_name: d.decided_by_name, decided_at: d.decided_at,
              } : null;
            })(),
            defaultName: publicName,
            onSubmit: async (choice, comment, name) => {
              await submitApprovals([{
                report_id: openMonthly.id,
                report_type: 'monthly',
                decision: choice,
                comment,
                decided_by_name: name,
              }]);
            },
          } : undefined}
          commentsConfig={{
            mode: 'public',
            comments: monthlyReportComments,
            defaultPublicName: publicName,
            onAdd: (section, body, name, parentId) => addComment(section, body, name, parentId, 'monthly'),
          }}
        />
        <div className="ac-report-nav">
          <button
            type="button"
            className="ac-nav-arrow-btn"
            onClick={() => olderM && setOpenMonthlyId(olderM.id)}
            disabled={!olderM}
          >
            <i className="bi bi-arrow-left" />
            <span className="ac-nav-arrow-label">
              <span className="ac-nav-arrow-hint">Previous</span>
              <span>{olderM ? fmtMonthLabel(olderM.month) : 'No earlier month'}</span>
            </span>
          </button>
          <button
            type="button"
            className="ac-nav-arrow-btn"
            onClick={() => newerM && setOpenMonthlyId(newerM.id)}
            disabled={!newerM}
          >
            <span className="ac-nav-arrow-label" style={{ alignItems: 'flex-end' }}>
              <span className="ac-nav-arrow-hint">Next</span>
              <span>{newerM ? fmtMonthLabel(newerM.month) : 'No later month'}</span>
            </span>
            <i className="bi bi-arrow-right" />
          </button>
        </div>
      </PublicShell>
    );
  }

  const brandReportCount = (brandId: string) => reports.filter(r => r.brand_id === brandId).length;
  const brandMonthlyCount = (brandId: string) => monthlyReports.filter(r => r.brand_id === brandId).length;
  const brandResourceCount = (brandId: string) =>
    resources.filter(r => (r.scope === 'brand' && r.brand_id === brandId) || r.scope === 'general').length;
  // Paid Collab: program (month) count + count of creators with a payment still pending.
  const brandPcCount = (brandId: string) => pcMonths.filter(m => m.brand_id === brandId).length;
  const brandPcPending = (brandId: string) =>
    pcHandlerCreators.filter(c => c.brand_id === brandId && isPendingVisible(c)).length;

  // Brands (with PC enabled) that have at least one pending payment — drives the
  // welcome-popup alert + lets the client jump straight to that brand's Paid Collab tab.
  // Plain compute (not a hook) — this sits after the loading/err early returns.
  const pcPendingByBrand = (includePaidCollab ? brands : []).map(b => ({
    brandId: b.id, brandName: b.name,
    count: pcHandlerCreators.filter(c => c.brand_id === b.id && isPendingVisible(c)).length,
  })).filter(x => x.count > 0);

  // General-mode: a flat shared-files page (no brand tiles, no tabs).
  if (linkMode === 'general') {
    return (
      <PublicShell clientName={clientName}>
        {label && <div className="text-muted small mb-3">{label}</div>}
        <Card className="shadow-sm border-0">
          <Card.Header className="bg-white border-0 pt-3 pb-2">
            <h5 className="mb-0">
              <i className="bi bi-folder2-open me-2" /> Shared files
              <Badge bg="secondary" className="ms-2">{resources.length}</Badge>
            </h5>
            <small className="text-muted">Click a file to open it. Use Comment to leave feedback.</small>
          </Card.Header>
          <Card.Body>
            {resources.length === 0 ? (
              <div className="text-center py-5 text-muted">
                <i className="bi bi-folder-x" style={{ fontSize: '2rem' }} /><br />
                Nothing shared on this link yet.
              </div>
            ) : (
              <Row className="g-3">
                {resources.map(r => {
                  const ic = resourceIcon(r.url);
                  const cmtCount = resourceCommentCount(r.id);
                  return (
                    <Col md={6} lg={4} key={r.id}>
                      <div
                        className="d-flex flex-column gap-2 p-3 rounded h-100"
                        style={{ background: 'white', border: '1px solid #e5e7eb' }}
                      >
                        <div className="d-flex align-items-center gap-3">
                          <div style={{
                            width: 44, height: 44, borderRadius: 10,
                            background: `${ic.color}15`,
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0,
                          }}>
                            <i className={`bi ${ic.icon}`} style={{ color: ic.color, fontSize: '1.3rem' }} />
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="fw-semibold text-truncate">{r.name}</div>
                            <small className="text-muted">{ic.label}</small>
                            {r.description && (
                              <small className="text-muted d-block mt-1 text-truncate">{r.description}</small>
                            )}
                          </div>
                        </div>
                        <div className="d-flex justify-content-between align-items-center mt-1">
                          <a href={r.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline-primary">
                            Open <i className="bi bi-box-arrow-up-right ms-1" />
                          </a>
                          <Button size="sm" variant="outline-info" onClick={() => setFeedbackResource(r)}>
                            <i className="bi bi-chat-left-text me-1" />
                            {cmtCount > 0 ? `${cmtCount} comment${cmtCount === 1 ? '' : 's'}` : 'Comment'}
                          </Button>
                        </div>
                      </div>
                    </Col>
                  );
                })}
              </Row>
            )}
          </Card.Body>
        </Card>

        <Offcanvas show={!!feedbackResource} onHide={() => setFeedbackResource(null)} placement="end" style={{ width: 480 }}>
          <Offcanvas.Header closeButton>
            <Offcanvas.Title>
              <i className="bi bi-chat-left-text me-2" />
              Comments
              {feedbackResource && <small className="text-muted ms-2 fw-normal">— {feedbackResource.name}</small>}
            </Offcanvas.Title>
          </Offcanvas.Header>
          <Offcanvas.Body>
            {feedbackResource && (
              <ResourceComments
                resourceId={feedbackResource.id}
                resourceName={feedbackResource.name}
                comments={resourceComments}
                mode="public"
                defaultPublicName={publicName}
                onAdd={addResourceComment}
              />
            )}
          </Offcanvas.Body>
        </Offcanvas>
      </PublicShell>
    );
  }

  return (
    <PublicShell clientName={clientName}>
      {label && <div className="text-muted small mb-3">{label}</div>}

      {/* Brand tiles */}
      <div className="mb-4">
        <div className="d-flex align-items-center gap-2 mb-2 flex-wrap">
          {brands.map(b => {
            const active = b.id === activeBrandId;
            return (
              <button
                key={b.id}
                onClick={() => { setActiveBrandId(b.id); setOpenId(null); }}
                className="border-0"
                style={{
                  position: 'relative',
                  background: active ? 'linear-gradient(135deg, #2563eb, #7c3aed)' : 'white',
                  color: active ? 'white' : '#111827',
                  border: active ? 'none' : '1px solid #e5e7eb',
                  borderRadius: 12,
                  padding: '12px 18px',
                  width: 248,
                  height: 104,
                  overflow: 'visible',
                  textAlign: 'left',
                  cursor: 'pointer',
                  boxShadow: active ? '0 8px 20px rgba(37,99,235,.25)' : 'none',
                  transition: 'all .15s',
                }}
              >
                {includePaidCollab && brandPcPending(b.id) > 0 && (
                  <span
                    title={`${brandPcPending(b.id)} payment${brandPcPending(b.id) === 1 ? '' : 's'} pending`}
                    style={{
                      position: 'absolute', top: -8, right: -8,
                      minWidth: 22, height: 22, padding: '0 6px',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      borderRadius: 999, background: '#DC2626', color: '#fff',
                      fontSize: '.72rem', fontWeight: 800, lineHeight: 1,
                      border: '2px solid #fff', boxShadow: '0 2px 6px rgba(220,38,38,.45)',
                    }}
                  >
                    {brandPcPending(b.id)}
                  </span>
                )}
                <div className="small" style={{ opacity: active ? .8 : .55, fontSize: '.7rem', letterSpacing: '.5px' }}>BRAND</div>
                <div className="fw-semibold text-truncate" style={{ fontSize: '1.05rem', maxWidth: '100%' }}>{b.name}</div>
                <div className="small mt-1" style={{ opacity: active ? .85 : .6, fontSize: '.78rem', lineHeight: 1.3 }}>
                  {includeReports && <>{brandReportCount(b.id)} weekly · </>}
                  {includeMonthlyReports && <>{brandMonthlyCount(b.id)} monthly · </>}
                  {brandResourceCount(b.id)} resource{brandResourceCount(b.id) !== 1 ? 's' : ''}
                  {includePaidCollab && <> · {brandPcCount(b.id)} PC</>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {activeBrand && (
        <Tab.Container activeKey={activeTab} onSelect={k => setActiveTab((k as any) ?? 'reporting')}>
          <Card className="shadow-sm border-0">
            <Card.Header className="bg-white border-0 pt-3 pb-0">
              <Nav variant="tabs" className="border-0">
                {includeReports && (
                  <Nav.Item>
                    <Nav.Link eventKey="reporting" className="d-flex align-items-center gap-2 px-3">
                      <i className="bi bi-bar-chart-line" /> Weekly
                      <Badge bg="secondary">{brandReports.length}</Badge>
                    </Nav.Link>
                  </Nav.Item>
                )}
                {includeMonthlyReports && (
                  <Nav.Item>
                    <Nav.Link eventKey="monthly" className="d-flex align-items-center gap-2 px-3">
                      <i className="bi bi-calendar-month" /> Monthly
                      <Badge bg="secondary">{monthlyReports.filter(r => r.brand_id === activeBrandId).length}</Badge>
                    </Nav.Link>
                  </Nav.Item>
                )}
                {(includeReports || includeMonthlyReports) && (
                  <Nav.Item>
                    <Nav.Link eventKey="approved" className="d-flex align-items-center gap-2 px-3">
                      <i className="bi bi-check2-circle" /> Approved
                      <Badge bg="success">{approvedForBrand.length}</Badge>
                    </Nav.Link>
                  </Nav.Item>
                )}
                {includeResources && (
                  <Nav.Item>
                    <Nav.Link eventKey="resources" className="d-flex align-items-center gap-2 px-3">
                      <i className="bi bi-folder2" /> Resources
                      <Badge bg="secondary">{brandResources.length}</Badge>
                    </Nav.Link>
                  </Nav.Item>
                )}
                {includePaidCollab && (
                  <Nav.Item>
                    <Nav.Link eventKey="new-paid-collab" className="d-flex align-items-center gap-2 px-3 position-relative">
                      <i className="bi bi-people" /> Paid Collab
                      <Badge bg="secondary">{pcMonths.filter(m => m.brand_id === activeBrandId).length}</Badge>
                      {brandPcPending(activeBrandId) > 0 && (
                        <Badge bg="danger" pill title={`${brandPcPending(activeBrandId)} payment${brandPcPending(activeBrandId) === 1 ? '' : 's'} pending`}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', display: 'inline-block', marginRight: 4, verticalAlign: 'middle' }} />
                          {brandPcPending(activeBrandId)}
                        </Badge>
                      )}
                    </Nav.Link>
                  </Nav.Item>
                )}
              </Nav>
            </Card.Header>
            <Card.Body>
              <Tab.Content>
                <Tab.Pane eventKey="reporting">
                  <div className="d-flex justify-content-between align-items-end mb-3 flex-wrap gap-2">
                    <div>
                      <h5 className="mb-0">{activeBrand.name} — Reports</h5>
                      <small className="text-muted">{monthFiltered.length} report{monthFiltered.length !== 1 ? 's' : ''} {month === 'all' ? '— all months' : `in ${fmtMonthLabel(month)}`}</small>
                    </div>
                    <MonthQuickPicks month={month} setMonth={setMonth} monthsWithData={monthsWithData} />
                  </div>

                  {brandReports.length === 0 ? (
                    <div className="text-center py-5 text-muted">
                      <i className="bi bi-inbox" style={{ fontSize: '2rem' }} /><br />
                      No reports shared for this brand yet.
                    </div>
                  ) : monthFiltered.length === 0 ? (
                    <div className="text-center py-4 text-muted">No reports in this month. Try a different month.</div>
                  ) : (
                    <Row className="g-3">
                      {monthFiltered.map(r => {
                        const dec = decisions.find(d => d.report_id === r.id);
                        const approvalEnabled = !!r.content?.approval?.enabled;
                        return (
                          <Col md={6} lg={4} key={r.id}>
                            <Card
                              className="h-100 shadow-sm report-card"
                              style={{ cursor: 'pointer', borderLeft: '4px solid #2563eb', transition: 'transform .15s, box-shadow .15s' }}
                              onClick={() => setOpenId(r.id)}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 24px rgba(0,0,0,.08)'; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = ''; }}
                            >
                              <Card.Body>
                                <div className="d-flex justify-content-between align-items-start">
                                  <div className="text-muted small text-uppercase" style={{ letterSpacing: '.5px', fontSize: '.7rem' }}>Week</div>
                                  <Badge bg="primary" pill>#{r.week_number}</Badge>
                                </div>
                                <div className="fs-5 fw-semibold mt-1">{formatRange(r.week_start, r.week_end)}</div>
                                <div className="text-muted small mt-2">
                                  <i className="bi bi-calendar3 me-1" /> Click to view dashboard
                                </div>
                                {approvalEnabled && (() => {
                                  const tn = approvalThreadCount(r.id, 'weekly');
                                  return (
                                    <div className="mt-2 d-flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                                      {dec ? (
                                        <Button size="sm" variant={dec.decision === 'approved' ? 'success' : 'warning'}
                                                onClick={() => { setSingleApprovalId(r.id); setSingleApprovalType('weekly'); setShowApprovals(true); }}
                                                title="View your decision">
                                          <i className={`bi ${dec.decision === 'approved' ? 'bi-check-circle' : 'bi-arrow-repeat'} me-1`} />
                                          {dec.decision === 'approved' ? 'Approved' : 'Changes requested'}
                                        </Button>
                                      ) : (
                                        <Button size="sm" variant="warning"
                                                onClick={() => { setSingleApprovalId(r.id); setSingleApprovalType('weekly'); setShowApprovals(true); }}
                                                title="Open the approval request">
                                          <i className="bi bi-shield-exclamation me-1" /> Approval requested
                                        </Button>
                                      )}
                                      <Button size="sm" variant="outline-primary"
                                              onClick={() => setThreadFor({
                                                reportId: r.id, reportType: 'weekly',
                                                brandName: activeBrand.name,
                                                periodLabel: `Week #${r.week_number} — ${formatRange(r.week_start, r.week_end)}`,
                                              })}
                                              title="Open the conversation thread for this approval">
                                        <i className="bi bi-chat-left-text me-1" />
                                        Thread{tn > 0 ? ` (${tn})` : ''}
                                      </Button>
                                    </div>
                                  );
                                })()}
                              </Card.Body>
                            </Card>
                          </Col>
                        );
                      })}
                    </Row>
                  )}
                </Tab.Pane>

                <Tab.Pane eventKey="monthly">
                  {(() => {
                    const brandMonthly = monthlyReports
                      .filter(r => r.brand_id === activeBrandId)
                      .sort((a, b) => b.month.localeCompare(a.month));
                    const monthFilteredMonthly = month === 'all' ? brandMonthly : brandMonthly.filter(r => r.month === month);
                    const fmtMonthLabel = (yyyymm: string) => {
                      const [y, m] = yyyymm.split('-').map(Number);
                      return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
                    };
                    return (
                      <>
                        <div className="d-flex justify-content-between align-items-end mb-3 flex-wrap gap-2">
                          <div>
                            <h5 className="mb-0">{activeBrand.name} — Monthly Reports</h5>
                            <small className="text-muted">{monthFilteredMonthly.length} report{monthFilteredMonthly.length !== 1 ? 's' : ''} {month === 'all' ? '— all months' : `in ${fmtMonthLabel(month)}`}</small>
                          </div>
                          <MonthQuickPicks month={month} setMonth={setMonth} monthsWithData={monthsWithData} />
                        </div>
                        {brandMonthly.length === 0 ? (
                          <div className="text-center py-5 text-muted">
                            <i className="bi bi-inbox" style={{ fontSize: '2rem' }} /><br />
                            No monthly reports shared for this brand yet.
                          </div>
                        ) : monthFilteredMonthly.length === 0 ? (
                          <div className="text-center py-4 text-muted">
                            {month === 'all' ? 'No monthly reports shared yet.' : `No monthly report for ${fmtMonthLabel(month)}. Try a different month.`}
                          </div>
                        ) : (
                          <Row className="g-3">
                            {monthFilteredMonthly.map(r => {
                              const dec = decisions.find(d => d.report_id === r.id && d.report_type === 'monthly');
                              const approvalEnabled = !!r.content?.approval?.enabled;
                              return (
                                <Col md={6} lg={4} key={r.id}>
                                  <Card
                                    className="h-100 shadow-sm report-card"
                                    style={{ cursor: 'pointer', borderLeft: '4px solid #14b8a6', transition: 'transform .15s, box-shadow .15s' }}
                                    onClick={() => setOpenMonthlyId(r.id)}
                                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 24px rgba(0,0,0,.08)'; }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = ''; }}
                                  >
                                    <Card.Body>
                                      <div className="d-flex justify-content-between align-items-start">
                                        <div className="text-muted small text-uppercase" style={{ letterSpacing: '.5px', fontSize: '.7rem' }}>Month</div>
                                        <Badge bg="info" pill>Monthly</Badge>
                                      </div>
                                      <div className="fs-5 fw-semibold mt-1">{fmtMonthLabel(r.month)}</div>
                                      <div className="text-muted small mt-2">
                                        <i className="bi bi-calendar3 me-1" /> Click to view dashboard
                                      </div>
                                      {approvalEnabled && (() => {
                                        const tn = approvalThreadCount(r.id, 'monthly');
                                        return (
                                          <div className="mt-2 d-flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                                            {dec ? (
                                              <Button size="sm" variant={dec.decision === 'approved' ? 'success' : 'warning'}
                                                      onClick={() => { setSingleApprovalId(r.id); setSingleApprovalType('monthly'); setShowApprovals(true); }}
                                                      title="View your decision">
                                                <i className={`bi ${dec.decision === 'approved' ? 'bi-check-circle' : 'bi-arrow-repeat'} me-1`} />
                                                {dec.decision === 'approved' ? 'Approved' : 'Changes requested'}
                                              </Button>
                                            ) : (
                                              <Button size="sm" variant="warning"
                                                      onClick={() => { setSingleApprovalId(r.id); setSingleApprovalType('monthly'); setShowApprovals(true); }}
                                                      title="Open the approval request">
                                                <i className="bi bi-shield-exclamation me-1" /> Approval requested
                                              </Button>
                                            )}
                                            <Button size="sm" variant="outline-primary"
                                                    onClick={() => setThreadFor({
                                                      reportId: r.id, reportType: 'monthly',
                                                      brandName: activeBrand.name,
                                                      periodLabel: fmtMonthLabel(r.month),
                                                    })}
                                                    title="Open the conversation thread for this approval">
                                              <i className="bi bi-chat-left-text me-1" />
                                              Thread{tn > 0 ? ` (${tn})` : ''}
                                            </Button>
                                          </div>
                                        );
                                      })()}
                                    </Card.Body>
                                  </Card>
                                </Col>
                              );
                            })}
                          </Row>
                        )}
                      </>
                    );
                  })()}
                </Tab.Pane>

                <Tab.Pane eventKey="approved">
                  <div className="mb-3">
                    <h5 className="mb-0">{activeBrand.name} — Approved Reports</h5>
                    <small className="text-muted">
                      {approvedForBrand.length} approved report{approvedForBrand.length !== 1 ? 's' : ''} — click a row to open the report
                    </small>
                  </div>
                  {approvedForBrand.length === 0 ? (
                    <div className="text-center py-5 text-muted">
                      <i className="bi bi-clipboard-check" style={{ fontSize: '2rem' }} /><br />
                      Nothing approved yet. Reports you approve will show up here.
                    </div>
                  ) : (
                    <div className="d-flex flex-column gap-2">
                      {approvedForBrand.map(({ decision: d, reportType, reportId, periodLabel, monthKey }) => (
                        <div
                          key={d.id}
                          role="button"
                          tabIndex={0}
                          title="Open this report"
                          className="d-flex align-items-center gap-3 p-3 rounded"
                          style={{
                            background: 'white', border: '1px solid #e5e7eb',
                            borderLeft: '4px solid #198754', cursor: 'pointer',
                            transition: 'transform .15s, box-shadow .15s',
                          }}
                          onClick={() => {
                            setMonth(monthKey);
                            if (reportType === 'monthly') { setOpenMonthlyId(reportId); setOpenId(null); }
                            else { setOpenId(reportId); setOpenMonthlyId(null); }
                            window.scrollTo({ top: 0 });
                          }}
                          onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLElement).click(); }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 24px rgba(0,0,0,.08)'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = ''; }}
                        >
                          <div style={{
                            width: 44, height: 44, borderRadius: 10, background: '#19875415',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                          }}>
                            <i className="bi bi-check-circle-fill" style={{ color: '#198754', fontSize: '1.3rem' }} />
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="d-flex align-items-center gap-2 flex-wrap">
                              <span className="fw-semibold">{periodLabel}</span>
                              <Badge bg={reportType === 'weekly' ? 'primary' : 'info'} pill>
                                {reportType === 'weekly' ? 'Weekly' : 'Monthly'}
                              </Badge>
                            </div>
                            <small className="text-muted d-block mt-1">
                              <i className="bi bi-person-check me-1" />
                              Approved by {d.decided_by_name} · {fmtDecidedAt(d.decided_at)}
                            </small>
                            {d.comment && (
                              <small className="text-muted d-block mt-1 text-truncate fst-italic">
                                “{d.comment}”
                              </small>
                            )}
                          </div>
                          {(() => {
                            const threadCount = approvalThreadCount(reportId, reportType);
                            return (
                              <Button
                                size="sm"
                                variant="outline-success"
                                title="View the conversation for this report"
                                onClick={e => {
                                  e.stopPropagation();
                                  setThreadFor({
                                    reportId, reportType,
                                    brandName: activeBrand.name, periodLabel,
                                  });
                                }}
                              >
                                <i className="bi bi-chat-left-text me-1" /> Conversation
                                {threadCount > 0 && <Badge bg="success" pill className="ms-1">{threadCount}</Badge>}
                              </Button>
                            );
                          })()}
                          <i className="bi bi-chevron-right text-muted" />
                        </div>
                      ))}
                    </div>
                  )}
                </Tab.Pane>

                <Tab.Pane eventKey="resources">
                  <div className="d-flex justify-content-between align-items-end mb-3">
                    <div>
                      <h5 className="mb-0">{activeBrand.name} — Resources</h5>
                      <small className="text-muted">Includes shared general resources</small>
                    </div>
                  </div>
                  {brandResources.length === 0 ? (
                    <div className="text-center py-5 text-muted">
                      <i className="bi bi-folder-x" style={{ fontSize: '2rem' }} /><br />
                      No resources shared for this brand.
                    </div>
                  ) : (
                    <Row className="g-3">
                      {brandResources.map(r => {
                        const ic = resourceIcon(r.url);
                        const cmtCount = resourceCommentCount(r.id);
                        return (
                          <Col md={6} lg={4} key={r.id}>
                            <div
                              className="d-flex flex-column gap-2 p-3 rounded h-100"
                              style={{
                                background: 'white',
                                border: '1px solid #e5e7eb',
                                transition: 'transform .15s, box-shadow .15s, border-color .15s',
                              }}
                              onMouseEnter={e => {
                                const el = e.currentTarget as HTMLElement;
                                el.style.transform = 'translateY(-2px)';
                                el.style.boxShadow = '0 10px 25px rgba(0,0,0,.08)';
                                el.style.borderColor = ic.color;
                              }}
                              onMouseLeave={e => {
                                const el = e.currentTarget as HTMLElement;
                                el.style.transform = '';
                                el.style.boxShadow = '';
                                el.style.borderColor = '#e5e7eb';
                              }}
                            >
                              <div className="d-flex align-items-center gap-3">
                                <div style={{
                                  width: 44, height: 44, borderRadius: 10,
                                  background: `${ic.color}15`,
                                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                  flexShrink: 0,
                                }}>
                                  <i className={`bi ${ic.icon}`} style={{ color: ic.color, fontSize: '1.3rem' }} />
                                </div>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div className="fw-semibold text-truncate">{r.name}</div>
                                  <div className="d-flex align-items-center gap-2 mt-1">
                                    <small className="text-muted">{ic.label}</small>
                                    {r.scope === 'general' && <><span className="text-muted">·</span><small className="text-muted">General</small></>}
                                  </div>
                                  {r.description && (
                                    <small className="text-muted d-block mt-1 text-truncate">{r.description}</small>
                                  )}
                                </div>
                              </div>
                              <div className="d-flex justify-content-between align-items-center mt-1">
                                <a href={r.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline-primary">
                                  Open <i className="bi bi-box-arrow-up-right ms-1" />
                                </a>
                                <Button size="sm" variant="outline-info" onClick={() => setFeedbackResource(r)}
                                  title={cmtCount > 0 ? `${cmtCount} comment${cmtCount === 1 ? '' : 's'}` : 'Add a comment'}>
                                  <i className="bi bi-chat-left-text me-1" />
                                  {cmtCount > 0 ? `${cmtCount} comment${cmtCount === 1 ? '' : 's'}` : 'Comment'}
                                </Button>
                              </div>
                            </div>
                          </Col>
                        );
                      })}
                    </Row>
                  )}
                </Tab.Pane>

                <Tab.Pane eventKey="new-paid-collab">
                  <SharedHandlerCollabPane
                    brand={activeBrand}
                    months={pcMonths}
                    creators={pcHandlerCreators}
                    comments={pcComments}
                    publicName={publicName}
                    onAddComment={addPaidCollabComment}
                    onConfirmPaid={confirmPaidCollabPayment}
                  />
                </Tab.Pane>
              </Tab.Content>
            </Card.Body>
          </Card>
        </Tab.Container>
      )}

      <Offcanvas show={!!feedbackResource} onHide={() => setFeedbackResource(null)} placement="end" style={{ width: 480 }}>
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>
            <i className="bi bi-chat-left-text me-2" />
            Comments
            {feedbackResource && <small className="text-muted ms-2 fw-normal">— {feedbackResource.name}</small>}
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {feedbackResource && (
            <ResourceComments
              resourceId={feedbackResource.id}
              resourceName={feedbackResource.name}
              comments={resourceComments}
              mode="public"
              defaultPublicName={publicName}
              onAdd={addResourceComment}
            />
          )}
        </Offcanvas.Body>
      </Offcanvas>

      <ApprovalsModal
        show={showApprovals}
        pending={modalPending}
        defaultName={publicName}
        existingDecisions={existingDecisionsMap}
        onClose={() => {
          setShowApprovals(false);
          setSingleApprovalId(null);
          if (pickerAfterApprovals) {
            setPickerAfterApprovals(false);
            setShowLatestReports(true);
          }
        }}
        onSubmit={submitApprovals}
      />
      {/* Month picker popup disabled — replaced by inline MonthQuickPicks
          (latest 2 months + All). Kept here for later re-use.
      <MonthPickerModal
        show={showMonthPicker}
        monthsWithData={monthsWithData}
        selectedMonth={month}
        onPick={(m) => { setMonth(m); setShowMonthPicker(false); }}
        onClose={() => setShowMonthPicker(false)}
      />
      */}
      <LatestReportsModal
        show={showLatestReports}
        brands={brands}
        weeklyReports={reports}
        monthlyReports={monthlyReports}
        onPickWeekly={(r) => {
          // Sync filter month to the report's month so its card is visible
          // when the dashboard renders behind it.
          const ym = (r.week_start || '').slice(0, 7);
          if (ym) setMonth(ym);
          setActiveBrandId(r.brand_id);
          setActiveTab('reporting');
          setOpenId(r.id);
          setOpenMonthlyId(null);
          setShowLatestReports(false);
        }}
        onPickMonthly={(r) => {
          if (r.month) setMonth(r.month);
          setActiveBrandId(r.brand_id);
          setActiveTab('monthly');
          setOpenMonthlyId(r.id);
          setOpenId(null);
          setShowLatestReports(false);
        }}
        pcPending={pcPendingByBrand}
        onPickPaidCollab={(brandId) => {
          setActiveBrandId(brandId);
          setActiveTab('new-paid-collab');
          setOpenId(null);
          setOpenMonthlyId(null);
          setShowLatestReports(false);
        }}
        onClose={() => setShowLatestReports(false)}
      />

      {/* Standalone approval-thread offcanvas — opened from the report cards
          (and equivalent to the "Open thread" button inside the dashboard). */}
      <Offcanvas show={!!threadFor} onHide={() => setThreadFor(null)} placement="end" style={{ width: 480 }}>
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>
            <i className="bi bi-chat-left-text me-2" />
            Approval thread
            {threadFor && (
              <div className="small text-muted fw-normal mt-1">
                {threadFor.brandName} — {threadFor.periodLabel}
              </div>
            )}
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {threadFor && (
            <SectionComments
              section="approval"
              sectionLabel="Approval Needed / Action Items"
              comments={threadComments}
              mode="public"
              defaultPublicName={publicName}
              onAdd={onThreadAdd}
            />
          )}
        </Offcanvas.Body>
      </Offcanvas>
    </PublicShell>
  );
}

function fmtMonthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

// Approval timestamps carry a time-of-day, so show date + time.
function fmtDecidedAt(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

// Inline quick-pick for the 3 most-recent months — replaces the "Change month"
// button so clients can jump straight to a month's reports without the popup.
// (The MonthPickerModal is still mounted for later re-use.)
function MonthQuickPicks({ month, setMonth, monthsWithData }: {
  month: string;
  setMonth: (m: string) => void;
  monthsWithData: Set<string>;
}) {
  const shift = (yyyymm: string, delta: number): string => {
    const [y, m] = yyyymm.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };
  const fmtShort = (yyyymm: string): string => {
    const [y, m] = yyyymm.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' });
  };
  const cur = currentMonth();
  const picks = [shift(cur, 0), shift(cur, -1)];
  return (
    <div className="d-flex gap-2 align-items-center flex-wrap">
      {picks.map(ym => {
        const active = ym === month;
        const has = monthsWithData.has(ym);
        return (
          <Button
            key={ym}
            size="sm"
            variant={active ? 'primary' : 'outline-primary'}
            onClick={() => setMonth(ym)}
            title={has ? `${fmtShort(ym)} — reports available` : `${fmtShort(ym)} — no reports`}
          >
            <i className="bi bi-calendar3 me-1" />
            {fmtShort(ym)}
            {has && <span className="ms-1" style={{ color: active ? '#fff' : '#198754' }}>●</span>}
          </Button>
        );
      })}
      <Button
        size="sm"
        variant={month === 'all' ? 'primary' : 'outline-primary'}
        onClick={() => setMonth('all')}
        title="Show all reports across every month"
      >
        <i className="bi bi-collection me-1" /> All
      </Button>
    </div>
  );
}

// [LEGACY — UNUSED] SharedPaidCollabPane — the OLD "Paid Collab" share tab.
// Renders the legacy `paid_creator_*` model (programs → creators → videos +
// comment thread). The old "Paid Collab" tab was removed from the share view;
// the link now shows only the current handler-collab "Paid Collab" tab
// (SharedHandlerCollabPane). This component is no longer mounted anywhere —
// kept here for reference / in case the legacy view is ever re-enabled.
// =====================================================================

interface SharedPCPProps {
  token: string;
  activeBrand: Brand;
  programs: PaidProgram[];
  creators: PaidCreator[];
  videos: PaidVideoRow[];
  products: BrandProductRow[];
  programProducts: { program_id: string; product_id: string }[];
  threads: ProgramThreadComment[];
  performance: PaidCreatorPerformance[];
  notes: ProgramNote[];
  publicName: string;
  openProgramId: string | null;
  setOpenProgramId: (id: string | null) => void;
  onThreadAdded: (c: ProgramThreadComment) => void;
  onNameChange: (n: string) => void;
}

type PCSection = 'overview' | 'programs' | 'creators' | 'videos';

function SharedPaidCollabPane({
  token, activeBrand, programs, creators, videos, products, programProducts,
  threads, performance, notes, publicName, openProgramId, setOpenProgramId, onThreadAdded, onNameChange,
}: SharedPCPProps) {
  // --- all hooks first (no early return before them) ---
  const [section, setSection] = useState<PCSection>('overview');
  const [creatorSearch, setCreatorSearch] = useState('');
  const [videoSearch, setVideoSearch] = useState('');
  const [openCreatorId, setOpenCreatorId] = useState<string | null>(null);

  const brandPrograms = useMemo(
    () => programs.filter(p => p.brand_id === activeBrand.id),
    [programs, activeBrand.id],
  );
  const brandProgramIds = useMemo(() => new Set(brandPrograms.map(p => p.id)), [brandPrograms]);
  const brandCreators = useMemo(
    () => creators.filter(c => brandProgramIds.has(c.program_id)),
    [creators, brandProgramIds],
  );
  const brandCreatorIds = useMemo(() => new Set(brandCreators.map(c => c.id)), [brandCreators]);
  const brandVideos = useMemo(
    () => videos.filter(v => brandCreatorIds.has(v.creator_id)),
    [videos, brandCreatorIds],
  );
  const summaries = useMemo(
    () => summarizePrograms(brandPrograms, brandCreators, brandVideos),
    [brandPrograms, brandCreators, brandVideos],
  );
  const programById = useMemo(() => {
    const m = new Map<string, PaidProgram>();
    brandPrograms.forEach(p => m.set(p.id, p));
    return m;
  }, [brandPrograms]);
  const productById = useMemo(() => {
    const m = new Map<string, BrandProductRow>();
    products.forEach(p => m.set(p.id, p));
    return m;
  }, [products]);
  // Brand-wide aggregate — same creator across multiple programs of the same
  // brand is summed (matched by handle/name).
  const brandAgg = useMemo(
    () => buildBrandCreatorAggregate(brandCreators, performance),
    [brandCreators, performance],
  );
  // GMV per creator_id, but the SUM is brand-wide via identity matching —
  // so two program rows for the same person both show the same merged value.
  const gmvByCreator = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of brandCreators) m.set(c.id, aggBrandGmv(c, brandAgg, 'weekly'));
    return m;
  }, [brandCreators, brandAgg]);
  // Every video counts as live; pipeline = agreed videos not yet delivered.
  const videoCountByCreator = useMemo(() => {
    const m = new Map<string, number>();
    brandVideos.forEach(v => m.set(v.creator_id, (m.get(v.creator_id) ?? 0) + 1));
    return m;
  }, [brandVideos]);
  const liveByCreator = videoCountByCreator;
  const pipelineByCreatorPane = useMemo(() => {
    const m = new Map<string, number>();
    brandCreators.forEach(c => {
      if (c.status === 'dropped') return;
      m.set(c.id, Math.max(0, (c.agreed_videos || 0) - (videoCountByCreator.get(c.id) ?? 0)));
    });
    return m;
  }, [brandCreators, videoCountByCreator]);

  const kpis = useMemo(() => {
    const activePrograms = brandPrograms.filter(p => !p.ended_at).length;
    const totalGmv = [...gmvByCreator.values()].reduce((s, v) => s + v, 0);
    const pipeline = [...pipelineByCreatorPane.values()].reduce((s, v) => s + v, 0);
    return {
      programs: brandPrograms.length,
      activePrograms,
      endedPrograms: brandPrograms.length - activePrograms,
      creators: brandCreators.length,
      videos: brandVideos.length,
      live: brandVideos.length,
      pipeline,
      totalGmv,
    };
  }, [brandPrograms, brandCreators, brandVideos, gmvByCreator, pipelineByCreatorPane]);

  const currency = brandPrograms.find(p => p.currency)?.currency || 'USD';

  const filteredCreators = useMemo(() => {
    const q = creatorSearch.trim().toLowerCase();
    if (!q) return brandCreators;
    return brandCreators.filter(c =>
      `${c.name} ${c.handle ?? ''}`.toLowerCase().includes(q));
  }, [brandCreators, creatorSearch]);

  const filteredVideos = useMemo(() => {
    const q = videoSearch.trim().toLowerCase();
    return brandVideos.filter(v => {
      if (!q) return true;
      const cr = brandCreators.find(c => c.id === v.creator_id);
      const prod = v.product_id ? productById.get(v.product_id) : null;
      return `${cr?.name ?? ''} ${prod?.name ?? ''} ${v.tiktok_url ?? ''} ${v.notes ?? ''}`.toLowerCase().includes(q);
    });
  }, [brandVideos, brandCreators, productById, videoSearch]);

  const openProgram = openProgramId ? programs.find(p => p.id === openProgramId) : null;
  const openCreator = openCreatorId ? brandCreators.find(c => c.id === openCreatorId) ?? null : null;

  const postCreatorComment = async (programId: string, creatorId: string, body: string, name: string, parentId?: string) => {
    const { data, error } = await supabase.functions.invoke('post-shared-program-comment', {
      body: { token, program_id: programId, author_name: name, body, parent_id: parentId ?? null, creator_id: creatorId },
    });
    if (error) throw await fnError(error);
    if ((data as any)?.error) throw new Error((data as any).error);
    onThreadAdded((data as any).comment as ProgramThreadComment);
    onNameChange(name);
  };

  // --- single-program drill-down ---
  if (openProgram) {
    return (
      <SharedProgramView
        token={token}
        program={openProgram}
        brand={activeBrand}
        creators={creators.filter(c => c.program_id === openProgram.id)}
        videos={videos.filter(v => creators.some(c => c.program_id === openProgram.id && c.id === v.creator_id))}
        products={products}
        programProducts={programProducts.filter(pp => pp.program_id === openProgram.id)}
        threads={threads.filter(t => t.program_id === openProgram.id)}
        performance={performance}
        brandAgg={brandAgg}
        notes={notes.filter(n => n.program_id === openProgram.id)}
        publicName={publicName}
        onBack={() => setOpenProgramId(null)}
        onThreadAdded={onThreadAdded}
        onNameChange={onNameChange}
      />
    );
  }

  const SECTIONS: { key: PCSection; label: string; icon: string; count?: number }[] = [
    { key: 'overview', label: 'Overview', icon: 'bi-speedometer2' },
    { key: 'programs', label: 'Programs', icon: 'bi-collection', count: brandPrograms.length },
    { key: 'creators', label: 'Creators', icon: 'bi-people', count: brandCreators.length },
    { key: 'videos',   label: 'Videos',   icon: 'bi-collection-play', count: brandVideos.length },
  ];

  return (
    <>
      <div className="mb-3">
        <h5 className="mb-0">{activeBrand.name} — Paid Collab</h5>
        <small className="text-muted">Browse programs, creators and videos for this brand.</small>
      </div>

      {brandPrograms.length === 0 ? (
        <div className="text-center py-5 text-muted">
          <i className="bi bi-people" style={{ fontSize: '2rem' }} /><br />
          No paid collab programs shared for this brand yet.
        </div>
      ) : (
        <>
          {/* Section nav */}
          <div className="wr-tabs mb-3">
            {SECTIONS.map(s => (
              <button key={s.key}
                className={`wr-tab ${section === s.key ? 'is-active' : ''}`}
                onClick={() => setSection(s.key)}>
                <i className={`bi ${s.icon} me-1`} />{s.label}
                {s.count !== undefined && <span className="wr-tab-count">{s.count}</span>}
              </button>
            ))}
          </div>

          {/* Overview */}
          {section === 'overview' && (
            <>
              <Row className="g-3 mb-3">
                <ShareKpi icon="bi-collection"      color="#e8862e" label="Programs"  value={fmtNumberPC(kpis.programs)} sub={`${kpis.activePrograms} active · ${kpis.endedPrograms} ended`} />
                <ShareKpi icon="bi-people-fill"     color="#6610f2" label="Creators"  value={fmtNumberPC(kpis.creators)} />
                <ShareKpi icon="bi-broadcast"       color="#198754" label="Live videos" value={fmtNumberPC(kpis.live)} sub={`${kpis.pipeline} in pipeline`} />
                <ShareKpi icon="bi-cash-coin"       color="#20c997" label="Total GMV" value={fmtMoneyPC(kpis.totalGmv, currency)} />
              </Row>
              <div className="fw-semibold mb-2">Programs</div>
              <Row className="g-3">
                {brandPrograms.map(p => {
                  const s = summaries.get(p.id);
                  if (!s) return null;
                  return (
                    <Col md={6} lg={4} key={p.id}>
                      <ProgramCard summary={s} onClick={() => setOpenProgramId(p.id)} />
                    </Col>
                  );
                })}
              </Row>
            </>
          )}

          {/* Programs */}
          {section === 'programs' && (
            <Row className="g-3">
              {brandPrograms.map(p => {
                const s = summaries.get(p.id);
                if (!s) return null;
                return (
                  <Col md={6} lg={4} key={p.id}>
                    <ProgramCard summary={s} onClick={() => setOpenProgramId(p.id)} />
                  </Col>
                );
              })}
            </Row>
          )}

          {/* Creators */}
          {section === 'creators' && (
            <>
              <Form.Control
                className="mb-3"
                placeholder="Search creators by name or handle…"
                value={creatorSearch}
                onChange={e => setCreatorSearch(e.target.value)}
              />
              {filteredCreators.length === 0 ? (
                <p className="text-muted text-center py-4">No creators match.</p>
              ) : (
                <Row className="g-3">
                  {filteredCreators.map(cr => {
                    const prog = programById.get(cr.program_id);
                    const liveN = liveByCreator.get(cr.id) ?? 0;
                    const pending = isCreatorPaymentPending(cr, liveN, prog, activeBrand);
                    return (
                      <Col md={6} lg={4} key={cr.id}>
                        <Card className={`h-100 ac-share-creator-card ${pending ? 'ac-payment-pending-card' : ''}`} role="button"
                          onClick={() => setOpenCreatorId(cr.id)}
                          title="View this creator's videos & conversation">
                          <Card.Body>
                            {pending && (
                              <div className="mb-2">
                                <Badge bg="" className="ac-payment-pending-badge w-100 justify-content-center py-2"
                                  style={{ backgroundColor: '#e8862e', color: '#fff', fontSize: '.8rem' }}>
                                  <i className="bi bi-cash-stack" />
                                  Payment pending
                                </Badge>
                              </div>
                            )}
                            <div className="d-flex gap-2 align-items-start">
                              <Avatar name={cr.name} size="md" />
                              <div className="flex-grow-1 min-w-0">
                                <div className="fw-semibold text-truncate">{cr.name}</div>
                                {cr.handle && (
                                  <div className="text-muted small text-truncate">
                                    <i className="bi bi-at" />{cr.handle.replace(/^@/, '')}
                                  </div>
                                )}
                                <div className="text-muted small text-truncate">
                                  {prog ? programDisplayName(prog) : '—'}
                                </div>
                              </div>
                              {cr.paid_out && (
                                <Badge bg="success" className="ms-1" title="Paid">
                                  <i className="bi bi-check-circle-fill" />
                                </Badge>
                              )}
                            </div>
                            <div className="d-flex gap-3 mt-3 small">
                              <div>
                                <div className="text-muted" style={{ fontSize: '.65rem' }}>GMV</div>
                                <div className="fw-bold text-success">{fmtMoneyPC(gmvByCreator.get(cr.id) ?? 0, currency)}</div>
                              </div>
                              <div>
                                <div className="text-muted" style={{ fontSize: '.65rem' }}>Videos</div>
                                <div className="fw-bold">{fmtNumberPC(videoCountByCreator.get(cr.id) ?? 0)}</div>
                              </div>
                              <div>
                                <div className="text-muted" style={{ fontSize: '.65rem' }}>Live</div>
                                <div className="fw-bold">{fmtNumberPC(liveN)}</div>
                              </div>
                            </div>
                            <CreatorCopyExtras notes={cr.notes} paypal={cr.paypal_email ?? null} />
                          </Card.Body>
                        </Card>
                      </Col>
                    );
                  })}
                </Row>
              )}
            </>
          )}

          {/* Videos */}
          {section === 'videos' && (
            <>
              <div className="mb-3">
                <Form.Control
                  placeholder="Search videos by creator, product, URL…"
                  value={videoSearch}
                  onChange={e => setVideoSearch(e.target.value)}
                />
              </div>
              {filteredVideos.length === 0 ? (
                <p className="text-muted text-center py-4">No videos match.</p>
              ) : (
                <div className="d-flex flex-column gap-2">
                  {filteredVideos.map(v => {
                    const cr = brandCreators.find(c => c.id === v.creator_id);
                    const prod = v.product_id ? productById.get(v.product_id) : null;
                    return (
                      <div key={v.id} className="border rounded p-2 d-flex gap-2 align-items-start">
                        <div className="d-flex align-items-center justify-content-center rounded text-white flex-shrink-0"
                             style={{ width: 36, height: 36, backgroundColor: '#198754' }}>
                          <i className="bi bi-broadcast" />
                        </div>
                        <div className="flex-grow-1 min-w-0">
                          <div className="d-flex align-items-center gap-2 flex-wrap">
                            <Badge bg="success">Live</Badge>
                            {prod && <Badge bg="primary"><i className="bi bi-tag-fill me-1" />{prod.name}</Badge>}
                            <span className="fw-semibold small">{cr?.name ?? '—'}</span>
                            {v.posted_on && (
                              <Badge bg="light" text="dark" className="border">
                                <i className="bi bi-calendar me-1" />{new Date(v.posted_on + 'T00:00:00').toLocaleDateString()}
                              </Badge>
                            )}
                            {v.ad_code && (
                              v.ad_code_authorized ? (
                                <Badge bg="success" title="Ad code authorized">
                                  <i className="bi bi-shield-check me-1" />Authorized
                                </Badge>
                              ) : (
                                <Badge bg="light" text="dark" className="border" title="Ad code not authorized yet">
                                  <i className="bi bi-shield-exclamation me-1" />Not authorized
                                </Badge>
                              )
                            )}
                          </div>
                          {v.tiktok_url
                            ? <div className="mt-1">
                                <a href={v.tiktok_url} target="_blank" rel="noreferrer" className="small text-truncate d-inline-block" style={{ maxWidth: '100%' }}>
                                  <i className="bi bi-tiktok me-1" />{v.tiktok_url}
                                </a>
                              </div>
                            : <div className="text-muted small fst-italic mt-1">No URL yet</div>}
                          {v.notes && <div className="small mt-1 text-muted" style={{ whiteSpace: 'pre-wrap' }}>{v.notes}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Creator detail modal */}
      {openCreator && (
        <SharedCreatorModal
          creator={openCreator}
          videos={brandVideos.filter(v => v.creator_id === openCreator.id)}
          productById={productById}
          comments={threads.filter(t => t.creator_id === openCreator.id)}
          performance={performance.filter(p => p.creator_id === openCreator.id)}
          currency={programById.get(openCreator.program_id)?.currency || 'USD'}
          publicName={publicName}
          onClose={() => setOpenCreatorId(null)}
          onPost={(body, name, parentId) =>
            postCreatorComment(openCreator.program_id, openCreator.id, body, name, parentId)}
        />
      )}
    </>
  );
}

// =====================================================================
// SharedProgramView — read-only single-program view + thread.
// =====================================================================

interface SharedProgramViewProps {
  token: string;
  program: PaidProgram;
  brand: Brand;
  creators: PaidCreator[];
  videos: PaidVideoRow[];
  products: BrandProductRow[];
  programProducts: { program_id: string; product_id: string }[];
  threads: ProgramThreadComment[];
  performance: PaidCreatorPerformance[];
  brandAgg: BrandCreatorAggregate;
  notes: ProgramNote[];
  publicName: string;
  onBack: () => void;
  onThreadAdded: (c: ProgramThreadComment) => void;
  onNameChange: (n: string) => void;
}

function SharedProgramView({
  token, program, brand, creators, videos, products, programProducts,
  threads, performance, brandAgg, notes, publicName, onBack, onThreadAdded, onNameChange,
}: SharedProgramViewProps) {
  const c = program.currency || 'USD';
  const ended = isProgramEnded(program);
  const threadRef = useRef<HTMLDivElement>(null);
  const productById = useMemo(() => {
    const m = new Map<string, BrandProductRow>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);
  const programProductIds = useMemo(
    () => new Set(programProducts.map(pp => pp.product_id)),
    [programProducts],
  );
  const programProductsList = useMemo(
    () => products.filter(p => programProductIds.has(p.id)),
    [products, programProductIds],
  );
  // Every video counts as live; pipeline = agreed videos not yet delivered.
  const liveByCreator = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of videos) m.set(v.creator_id, (m.get(v.creator_id) ?? 0) + 1);
    return m;
  }, [videos]);
  const pipelineByCreator = useMemo(() => {
    const m = new Map<string, number>();
    for (const cr of creators) {
      if (cr.status === 'dropped') continue;
      m.set(cr.id, Math.max(0, (cr.agreed_videos || 0) - (liveByCreator.get(cr.id) ?? 0)));
    }
    return m;
  }, [creators, liveByCreator]);

  // Brand-wide weekly GMV / items per creator — when the same person is in
  // multiple programs of this brand, their stats are merged.
  const weeklyByCreator = useMemo(() => {
    const gmv = new Map<string, number>();
    const items = new Map<string, number>();
    for (const cr of creators) {
      gmv.set(cr.id, aggBrandGmv(cr, brandAgg, 'weekly'));
      items.set(cr.id, aggBrandItems(cr, brandAgg, 'weekly'));
    }
    return { gmv, items };
  }, [creators, brandAgg]);

  // Aggregates for KPI tiles
  const totalLive = videos.length;
  const totalPipeline = [...pipelineByCreator.values()].reduce((s, n) => s + n, 0);
  const spent = creators.reduce((s, x) => s + Number(x.fee || 0), 0);
  const totalGmv = [...weeklyByCreator.gmv.values()].reduce((s, v) => s + v, 0);
  const totalItems = [...weeklyByCreator.items.values()].reduce((s, v) => s + v, 0);
  const daysRunning = (() => {
    if (!program.launch_date) return 0;
    const end = program.ended_at ? new Date(program.ended_at) : new Date();
    const start = new Date(program.launch_date + 'T00:00:00');
    return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));
  })();

  const postComment = async (body: string, name: string, parentId?: string, creatorId?: string) => {
    const { data, error } = await supabase.functions.invoke('post-shared-program-comment', {
      body: {
        token, program_id: program.id, author_name: name, body,
        parent_id: parentId ?? null, creator_id: creatorId ?? null,
      },
    });
    if (error) throw await fnError(error);
    if ((data as any)?.error) throw new Error((data as any).error);
    onThreadAdded((data as any).comment as ProgramThreadComment);
    onNameChange(name);
  };

  // Comments split: program-level (global) vs per-creator.
  const programThreads = useMemo(() => threads.filter(t => !t.creator_id), [threads]);
  const threadCountByCreator = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of threads) {
      if (t.creator_id) m.set(t.creator_id, (m.get(t.creator_id) ?? 0) + 1);
    }
    return m;
  }, [threads]);
  const videoCountByCreator = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of videos) m.set(v.creator_id, (m.get(v.creator_id) ?? 0) + 1);
    return m;
  }, [videos]);

  const [openCreator, setOpenCreator] = useState<PaidCreator | null>(null);
  const [copiedProductId, setCopiedProductId] = useState<string | null>(null);
  const copyProductLink = (id: string, link: string) => {
    navigator.clipboard.writeText(link).then(() => {
      setCopiedProductId(id);
      setTimeout(() => setCopiedProductId(prev => (prev === id ? null : prev)), 1500);
    }).catch(() => {/* clipboard unavailable */});
  };

  const scrollToThread = () =>
    threadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <>
      {/* Hero header */}
      <div className="rounded shadow-sm mb-4 p-4"
           style={{ background: 'linear-gradient(135deg, #141620 0%, #232638 60%, #2c2f44 100%)', color: '#fff' }}>
        <div className="d-flex align-items-start gap-3 flex-wrap">
          <Button size="sm" variant="light" onClick={onBack} title="Back to programs">
            <i className="bi bi-arrow-left" />
          </Button>
          <div className="flex-grow-1 min-w-0">
            <div className="opacity-75 small">{brand.name}</div>
            <div className="d-flex align-items-center gap-2 flex-wrap mt-1">
              <h3 className="mb-0" style={{ fontFamily: 'Sora, sans-serif', fontWeight: 600, color: '#fff' }}>
                {programDisplayName(program)}
              </h3>
              {ended
                ? <Badge bg="secondary"><i className="bi bi-flag-fill me-1" />Ended</Badge>
                : <Badge bg="success"><i className="bi bi-broadcast me-1" />Active</Badge>}
              <Button
                size="sm"
                onClick={scrollToThread}
                className="ms-2"
                style={{ backgroundColor: '#fff', color: '#0d6efd', border: 'none', fontWeight: 600 }}
                title="Jump to conversation thread"
              >
                <i className="bi bi-chat-left-text me-1" />
                Thread{threads.length > 0 ? ` (${threads.length})` : ''}
              </Button>
            </div>
            <div className="opacity-75 small mt-1">
              <i className="bi bi-calendar-range me-1" />{programPeriodLabel(program)}
              <span className="mx-2">·</span>
              {daysRunning} day{daysRunning === 1 ? '' : 's'}
            </div>
          </div>
        </div>
      </div>

      {/* KPI tiles */}
      <Row className="g-3 mb-4">
        <ShareKpi icon="bi-cash-coin"        color="#20c997" label="Total GMV"        value={fmtMoneyPC(totalGmv, c)} />
        <ShareKpi icon="bi-bag-check"        color="#0d6efd" label="Items sold"       value={fmtNumberPC(totalItems)} />
        <ShareKpi icon="bi-cash-stack"       color="#6610f2" label="Spent on fees"
                  value={fmtMoneyPC(spent, c)}
                  sub={`of ${fmtMoneyPC(Number(program.total_budget || 0), c)}`} />
        <ShareKpi icon="bi-people-fill"      color="#0d6efd" label="Creators"         value={fmtNumberPC(creators.length)} />
        <ShareKpi icon="bi-hourglass-split"  color="#fd7e14" label="Videos in pipeline" value={fmtNumberPC(totalPipeline)} />
        <ShareKpi icon="bi-broadcast"        color="#198754" label="Live videos"      value={fmtNumberPC(totalLive)} />
        <ShareKpi icon="bi-calendar-event"   color="#e8862e" label={ended ? 'Days ran' : 'Days running'} value={fmtNumberPC(daysRunning)} />
      </Row>

      {program.notes && (
        <Card className="shadow-sm mb-3">
          <Card.Body>
            <div className="text-muted small text-uppercase mb-1" style={{ letterSpacing: '.5px', fontSize: '.7rem' }}>Program notes</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{program.notes}</div>
          </Card.Body>
        </Card>
      )}

      {/* Pipeline + monthly activity charts — same as the staff view. */}
      {videos.length > 0 && (
        <Row className="g-3 mb-3">
          <Col lg={7}>
            <CumulativeChart videos={videos} notes={notes} launchDate={program.launch_date ?? null} />
          </Col>
          <Col lg={5}>
            <MonthlyStackedChart videos={videos} />
          </Col>
        </Row>
      )}

      {/* Program performance — same chart + per-creator table as the staff view. */}
      {creators.length > 0 && (
        <div className="mb-3">
          <ProgramProgress creators={creators} videos={videos} currency={c} entries={performance} brandAgg={brandAgg} />
        </div>
      )}

      {/* Products attached */}
      {programProductsList.length > 0 && (
        <Card className="shadow-sm mb-3">
          <Card.Header className="ac-section-card-header">
            <i className="bi bi-bag-check me-2" />Products in this program
            <span className="ac-section-card-count">{programProductsList.length}</span>
          </Card.Header>
          <Card.Body>
            <div className="d-flex flex-wrap gap-2">
              {programProductsList.map(p => (
                <div key={p.id} className="ac-product-pill">
                  <span className="ac-product-pill-name">
                    <i className="bi bi-tag-fill me-2" />{p.name}
                  </span>
                  {p.tiktok_link && (
                    <>
                      <a href={p.tiktok_link} target="_blank" rel="noreferrer"
                         className="ac-product-pill-btn ac-product-pill-open"
                         title="Open on TikTok">
                        <i className="bi bi-tiktok me-1" />Open
                      </a>
                      <button type="button"
                        className="ac-product-pill-btn ac-product-pill-copy"
                        onClick={() => copyProductLink(p.id, p.tiktok_link!)}
                        title="Copy link">
                        {copiedProductId === p.id ? (
                          <><i className="bi bi-check-lg me-1" />Copied</>
                        ) : (
                          <><i className="bi bi-clipboard me-1" />Copy</>
                        )}
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </Card.Body>
        </Card>
      )}

      {/* Creators subsection */}
      <ShareSubsectionHeader icon="bi-people-fill" title="Creators" count={creators.length} />
      <Card className="shadow-sm mb-3">
        <Card.Body>
          {creators.length === 0 ? (
            <div className="text-muted text-center py-4 small">No creators yet.</div>
          ) : (
            <Row className="g-3">
              {creators.map(cr => {
                const live = liveByCreator.get(cr.id) ?? 0;
                const pipeline = pipelineByCreator.get(cr.id) ?? 0;
                const pct = cr.agreed_videos > 0 ? Math.min(100, Math.round((live / cr.agreed_videos) * 100)) : 0;
                const vCount = videoCountByCreator.get(cr.id) ?? 0;
                const tCount = threadCountByCreator.get(cr.id) ?? 0;
                const pending = isCreatorPaymentPending(cr, live, program, brand);
                return (
                  <Col md={6} lg={4} key={cr.id}>
                    <Card className={`h-100 ac-share-creator-card ${pending ? 'ac-payment-pending-card' : ''}`} role="button"
                      onClick={() => setOpenCreator(cr)}
                      title="View this creator's videos & conversation">
                      <Card.Body className="d-flex flex-column">
                        {pending && (
                          <div className="mb-2">
                            <Badge bg="" className="ac-payment-pending-badge w-100 justify-content-center py-2"
                              style={{ backgroundColor: '#e8862e', color: '#fff', fontSize: '.8rem' }}>
                              <i className="bi bi-cash-stack" />
                              Payment pending
                            </Badge>
                          </div>
                        )}
                        <div className="d-flex gap-2 align-items-start">
                          <Avatar name={cr.name} size="md" />
                          <div className="flex-grow-1 min-w-0">
                            <div className="fw-semibold text-truncate">{cr.name}</div>
                            {cr.handle && (
                              <div className="text-muted small text-truncate">
                                <i className="bi bi-at" />{cr.handle.replace(/^@/, '')}
                              </div>
                            )}
                          </div>
                          {cr.paid_out && <Badge bg="success" className="ms-1" title="Paid"><i className="bi bi-check-circle-fill" /></Badge>}
                        </div>
                        {cr.agreed_videos > 0 && (
                          <div className="mt-3">
                            <div className="d-flex justify-content-between small">
                              <span className="text-muted">Live progress</span>
                              <span>{live}/{cr.agreed_videos}</span>
                            </div>
                            <div className="progress" style={{ height: 6 }}>
                              <div className="progress-bar" style={{ width: `${pct}%`, backgroundColor: '#e8862e' }} />
                            </div>
                          </div>
                        )}
                        <div className="mt-2 d-flex gap-2 flex-wrap small">
                          <Badge bg="warning" text="dark">
                            <i className="bi bi-hourglass-split me-1" />{pipeline} pipeline
                          </Badge>
                          <Badge bg="success">
                            <i className="bi bi-broadcast me-1" />{live} live
                          </Badge>
                        </div>
                        <div className="mt-2 small">
                          <div className="text-center p-2 rounded" style={{ background: 'rgba(32, 201, 151, 0.1)' }}>
                            <div className="text-muted" style={{ fontSize: '.65rem' }}>GMV</div>
                            <div className="fw-bold" style={{ color: '#198754' }}>
                              {fmtMoneyPC(weeklyByCreator.gmv.get(cr.id) ?? 0, c)}
                            </div>
                          </div>
                        </div>
                        <CreatorCopyExtras notes={cr.notes} paypal={cr.paypal_email ?? null} />
                        <div className="mt-auto pt-3 border-top d-flex align-items-center gap-2 small text-muted">
                          <span><i className="bi bi-collection-play me-1" />{vCount} video{vCount === 1 ? '' : 's'}</span>
                          <span>·</span>
                          <span><i className="bi bi-chat-left-text me-1" />{tCount} message{tCount === 1 ? '' : 's'}</span>
                          <span className="ms-auto text-primary fw-semibold">
                            View <i className="bi bi-arrow-right" />
                          </span>
                        </div>
                      </Card.Body>
                    </Card>
                  </Col>
                );
              })}
            </Row>
          )}
        </Card.Body>
      </Card>

      {/* Program-level conversation thread */}
      <ShareSubsectionHeader icon="bi-chat-left-text" title="Program conversation" count={programThreads.length} />
      <div ref={threadRef} style={{ scrollMarginTop: 16 }}>
        <ProgramThreadPanel
          comments={programThreads}
          mode="public"
          defaultPublicName={publicName}
          canPost
          onAdd={(body, name, parentId) => postComment(body, name, parentId)}
        />
      </div>

      {/* Per-creator detail modal — videos + creator-level thread */}
      {openCreator && (
        <SharedCreatorModal
          creator={openCreator}
          videos={videos.filter(v => v.creator_id === openCreator.id)}
          productById={productById}
          comments={threads.filter(t => t.creator_id === openCreator.id)}
          performance={performance.filter(p => p.creator_id === openCreator.id)}
          currency={c}
          publicName={publicName}
          onClose={() => setOpenCreator(null)}
          onPost={(body, name, parentId) => postComment(body, name, parentId, openCreator.id)}
        />
      )}
    </>
  );
}

// =====================================================================
// SharedCreatorModal — a creator's videos + their own conversation thread.
// =====================================================================

function SharedCreatorModal({
  creator, videos, productById, comments, performance, currency, publicName, onClose, onPost,
}: {
  creator: PaidCreator;
  videos: PaidVideoRow[];
  productById: Map<string, BrandProductRow>;
  comments: ProgramThreadComment[];
  performance: PaidCreatorPerformance[];
  currency: string;
  publicName: string;
  onClose: () => void;
  onPost: (body: string, name: string, parentId?: string) => Promise<void>;
}) {
  type Section = 'videos' | 'creator-perf' | 'conversation';
  const [section, setSection] = useState<Section>('videos');
  const [perfTab, setPerfTab] = useState<'weekly' | 'monthly'>('weekly');

  const sorted = useMemo(() =>
    [...videos].sort((a, b) =>
      (b.posted_on ?? b.created_at).localeCompare(a.posted_on ?? a.created_at)),
    [videos]);

  const periodLabel = (type: 'weekly' | 'monthly', start: string) => {
    if (type === 'monthly') {
      const [y, m] = start.split('-').map(Number);
      return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'short', year: 'numeric' });
    }
    const s = fromISO(start);
    const e = addDays(start, 6);
    return `${s.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}–${fromISO(e).toLocaleDateString(undefined, { day: 'numeric' })}`;
  };
  const creatorPerfList = useMemo(() =>
    performance.filter(p => p.period_type === perfTab)
      .sort((a, b) => b.period_start.localeCompare(a.period_start)),
    [performance, perfTab]);

  const SECTIONS: { key: Section; label: string; icon: string; count?: number }[] = [
    { key: 'videos',       label: 'Videos',             icon: 'bi-collection-play', count: videos.length },
    { key: 'creator-perf', label: 'Creator performance', icon: 'bi-graph-up-arrow' },
    { key: 'conversation', label: 'Conversation',        icon: 'bi-chat-left-text', count: comments.length },
  ];

  return (
    <Modal show onHide={onClose} centered size="lg" scrollable>
      <Modal.Header closeButton>
        <Modal.Title>
          <i className="bi bi-person-video2 me-2 text-primary" />
          {creator.name}
          {creator.handle && <span className="text-muted ms-2 small">@{creator.handle.replace(/^@/, '')}</span>}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {/* Top-level section switcher */}
        <div className="wr-tabs mb-3">
          {SECTIONS.map(s => (
            <button key={s.key}
              className={`wr-tab ${section === s.key ? 'is-active' : ''}`}
              onClick={() => setSection(s.key)}>
              <i className={`bi ${s.icon} me-1`} />{s.label}
              {s.count !== undefined && <span className="wr-tab-count">{s.count}</span>}
            </button>
          ))}
        </div>

        {/* Videos */}
        {section === 'videos' && (
          sorted.length === 0 ? (
            <p className="text-muted small">No videos for this creator yet.</p>
          ) : (
            <div className="d-flex flex-column gap-2">
              {sorted.map(v => {
                const prod = v.product_id ? productById.get(v.product_id) : null;
                return (
                  <div key={v.id} className="border rounded p-2 d-flex gap-2 align-items-start">
                    <div className="d-flex align-items-center justify-content-center rounded text-white flex-shrink-0"
                         style={{ width: 36, height: 36, backgroundColor: '#198754' }}>
                      <i className="bi bi-broadcast" />
                    </div>
                    <div className="flex-grow-1 min-w-0">
                      <div className="d-flex align-items-center gap-2 flex-wrap">
                        <Badge bg="success">Live</Badge>
                        {prod && <Badge bg="primary"><i className="bi bi-tag-fill me-1" />{prod.name}</Badge>}
                        {v.posted_on && (
                          <Badge bg="light" text="dark" className="border">
                            <i className="bi bi-calendar me-1" />{new Date(v.posted_on + 'T00:00:00').toLocaleDateString()}
                          </Badge>
                        )}
                        {v.ad_code && (
                          v.ad_code_authorized ? (
                            <Badge bg="success" title="Ad code authorized">
                              <i className="bi bi-shield-check me-1" />Authorized
                            </Badge>
                          ) : (
                            <Badge bg="light" text="dark" className="border" title="Ad code not authorized yet">
                              <i className="bi bi-shield-exclamation me-1" />Not authorized
                            </Badge>
                          )
                        )}
                      </div>
                      {v.tiktok_url
                        ? <div className="mt-1">
                            <a href={v.tiktok_url} target="_blank" rel="noreferrer" className="small text-truncate d-inline-block" style={{ maxWidth: '100%' }}>
                              <i className="bi bi-tiktok me-1" />{v.tiktok_url}
                            </a>
                          </div>
                        : <div className="text-muted small fst-italic mt-1">No URL yet</div>}
                      {v.notes && <div className="small mt-1 text-muted" style={{ whiteSpace: 'pre-wrap' }}>{v.notes}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* Creator performance */}
        {section === 'creator-perf' && (
          <>
            <div className="wr-tabs mb-2" style={{ marginBottom: 0 }}>
              <button className={`wr-tab ${perfTab === 'weekly' ? 'is-active' : ''}`} onClick={() => setPerfTab('weekly')}>
                Weekly <span className="wr-tab-count">{performance.filter(p => p.period_type === 'weekly').length}</span>
              </button>
              <button className={`wr-tab ${perfTab === 'monthly' ? 'is-active' : ''}`} onClick={() => setPerfTab('monthly')}>
                Monthly <span className="wr-tab-count">{performance.filter(p => p.period_type === 'monthly').length}</span>
              </button>
            </div>
            {creatorPerfList.length === 0 ? (
              <p className="text-muted small mt-2">No {perfTab} performance recorded yet.</p>
            ) : (
              <div className="table-responsive mt-2">
                <table className="table table-sm align-middle mb-0">
                  <thead className="small text-uppercase text-muted">
                    <tr>
                      <th>{perfTab === 'weekly' ? 'Week' : 'Month'}</th>
                      <th>GMV</th>
                      <th>Items sold</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creatorPerfList.map(p => (
                      <tr key={p.id}>
                        <td className="fw-semibold">{periodLabel(p.period_type, p.period_start)}</td>
                        <td><span className="text-success fw-semibold">{fmtMoneyPC(p.gmv, currency)}</span></td>
                        <td>{fmtNumberPC(p.items_sold)}</td>
                        <td className="text-muted small" style={{ maxWidth: 220 }}>
                          <div className="text-truncate" title={p.notes ?? ''}>{p.notes ?? '—'}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Conversation */}
        {section === 'conversation' && (
          <>
            <div className="text-muted small mb-2">
              Messages here are specific to {creator.name} — the program team will see and reply.
            </div>
            <ProgramThreadPanel
              comments={comments}
              mode="public"
              defaultPublicName={publicName}
              canPost
              onAdd={onPost}
            />
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </Modal.Footer>
    </Modal>
  );
}

// Compact KPI tile for the shared program view (similar visual rhythm to the
// client dashboard).
function ShareKpi({ icon, color, label, value, sub }: {
  icon: string; color: string; label: string; value: string; sub?: string;
}) {
  return (
    <Col xs={6} md={3} xl={2}>
      <Card className="h-100 shadow-sm" style={{ borderTop: `3px solid ${color}` }}>
        <Card.Body className="d-flex align-items-center gap-2 py-3">
          <div className="d-flex align-items-center justify-content-center rounded text-white flex-shrink-0"
               style={{
                 width: 40, height: 40,
                 background: `linear-gradient(135deg, ${color} 0%, ${color}cc 100%)`,
               }}>
            <i className={`bi ${icon}`} style={{ fontSize: '1.1rem' }} />
          </div>
          <div className="min-w-0">
            <div className="text-muted text-truncate" style={{ fontSize: '.7rem' }}>{label}</div>
            <div className="fw-bold" style={{ fontSize: '1.05rem', color: '#1f2937' }}>{value}</div>
            {sub && <div className="text-muted" style={{ fontSize: '.65rem' }}>{sub}</div>}
          </div>
        </Card.Body>
      </Card>
    </Col>
  );
}

function ShareSubsectionHeader({ icon, title, count }: { icon: string; title: string; count: number }) {
  return (
    <div className="d-flex align-items-center gap-2 mt-4 mb-2 px-1">
      <i className={`bi ${icon}`} style={{ color: '#e8862e', fontSize: '1.1rem' }} />
      <h5 className="mb-0" style={{ fontFamily: 'Sora, sans-serif', fontWeight: 600 }}>{title}</h5>
      <Badge bg="secondary" pill>{count}</Badge>
    </div>
  );
}

// Copyable notes + PayPal on a shared-view creator card. Clicks are stopped
// from bubbling so they don't open the creator detail modal.
function CreatorCopyExtras({ notes, paypal }: { notes: string | null; paypal: string | null }) {
  const [copied, setCopied] = useState<'notes' | 'paypal' | null>(null);
  const copy = (e: React.MouseEvent, key: 'notes' | 'paypal', text: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(c => (c === key ? null : c)), 1500);
    }).catch(() => {/* clipboard unavailable */});
  };
  if (!notes && !paypal) return null;
  return (
    <div className="mt-2 d-flex flex-column gap-1">
      {notes && (
        <div
          className="ac-creator-copy"
          role="button"
          title="Click to copy notes"
          onClick={(e) => copy(e, 'notes', notes)}
        >
          <div className="small text-muted" style={{ whiteSpace: 'pre-wrap' }}>{notes}</div>
          <div className="ac-creator-copy-hint">
            <i className={`bi ${copied === 'notes' ? 'bi-check-lg text-success' : 'bi-clipboard'} me-1`} />
            {copied === 'notes' ? 'Copied to clipboard' : 'Click to copy notes'}
          </div>
        </div>
      )}
      {paypal && (
        <div className="d-flex align-items-center gap-1 small bg-light rounded px-2 py-1">
          <i className="bi bi-paypal text-primary flex-shrink-0" />
          <span className="fw-semibold text-truncate" title={paypal}>{paypal}</span>
          <button
            type="button"
            className="btn btn-sm btn-link p-0 ms-auto flex-shrink-0 text-decoration-none"
            title="Copy PayPal email"
            onClick={(e) => copy(e, 'paypal', paypal)}
          >
            <i className={`bi ${copied === 'paypal' ? 'bi-check-lg text-success' : 'bi-clipboard'}`} />
            <span className="ms-1">{copied === 'paypal' ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      )}
    </div>
  );
}

function PublicShell({ children, clientName }: { children: React.ReactNode; clientName: string }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f5f6fa' }}>
      <div style={{ background: '#111827', color: 'white', padding: '14px 24px' }}>
        <strong>Afflix Core</strong>
        <span className="opacity-75 mx-2">— Reporting</span>
        <span className="opacity-75">|</span>
        <span className="ms-2 fw-semibold">{clientName}</span>
      </div>
      <div className="container-fluid py-4" style={{ maxWidth: 1400 }}>{children}</div>
    </div>
  );
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

