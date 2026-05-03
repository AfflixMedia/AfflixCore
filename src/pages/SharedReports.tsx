import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Spinner, Alert, Form, Row, Col, Badge, Button, Tab, Nav, Offcanvas } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { addDays, formatRange, formatHuman, fromISO } from '../lib/dates';
import { WeeklyReportContent, normalizeContent } from '../lib/reportSchema';
import ReportDashboard, { TrendPoint, ApprovalDecisionView } from '../components/ReportDashboard';
import { Comment, CommentSection } from '../components/SectionComments';
import { resourceIcon } from '../lib/resourceIcon';
import ResourceComments, { ResourceComment } from '../components/ResourceComments';
import ApprovalsModal, { PendingApprovalReport } from '../components/share/ApprovalsModal';
import MonthPickerModal from '../components/share/MonthPickerModal';

interface ApprovalDecisionRow {
  id: string;
  report_id: string;
  share_link_id: string;
  decision: 'approved' | 'changes_requested';
  comment: string | null;
  decided_by_name: string;
  decided_at: string;
}

interface Brand { id: string; name: string; client: string | null; client_id: string | null; }
interface Report {
  id: string; brand_id: string; week_start: string; week_end: string;
  week_number: number; status: string; content: WeeklyReportContent;
}
interface SharedResource { id: string; name: string; url: string; description: string | null; scope: string; brand_id: string | null; }

export default function SharedReports() {
  const { token } = useParams<{ token: string }>();
  const [client, setClient] = useState<{ id: string; name: string } | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [resources, setResources] = useState<SharedResource[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [resourceComments, setResourceComments] = useState<ResourceComment[]>([]);
  const [feedbackResource, setFeedbackResource] = useState<SharedResource | null>(null);
  const [publicName, setPublicName] = useState<string>(localStorage.getItem('ac_public_name') ?? '');
  const [label, setLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [activeBrandId, setActiveBrandId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'reporting' | 'resources'>('reporting');
  const [month, setMonth] = useState(currentMonth());
  const [openId, setOpenId] = useState<string | null>(null);
  const [includeReports, setIncludeReports] = useState(true);
  const [includeResources, setIncludeResources] = useState(true);
  const [linkMode, setLinkMode] = useState<'brand' | 'general'>('brand');
  const [decisions, setDecisions] = useState<ApprovalDecisionRow[]>([]);
  const [showApprovals, setShowApprovals] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true); setErr(null);
      try {
        const { data, error } = await supabase.functions.invoke('get-shared-reports', {
          body: { token },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
        setClient(data.client);
        setBrands(data.brands);
        setReports(data.reports);
        setResources(data.resources ?? []);
        setComments(data.comments ?? []);
        setResourceComments(data.resource_comments ?? []);
        setDecisions(data.approval_decisions ?? []);
        setLabel(data.label);
        const ir = data.include_reports !== false;
        const ix = data.include_resources !== false;
        setIncludeReports(ir);
        setIncludeResources(ix);
        const mode: 'brand' | 'general' = data.link_mode === 'general' ? 'general' : 'brand';
        setLinkMode(mode);
        // If reports are excluded, default landing tab to resources
        if (!ir && ix) setActiveTab('resources');
        if (data.brands?.length > 0) setActiveBrandId(data.brands[0].id);

        // Brand-mode entry flow: approvals popup first (if any pending), then month picker.
        if (mode === 'brand' && ir) {
          const decidedIds = new Set<string>((data.approval_decisions ?? []).map((d: any) => d.report_id));
          const pendingCount = (data.reports ?? []).filter((r: any) =>
            r.content?.approval?.enabled === true && !decidedIds.has(r.id)
          ).length;
          if (pendingCount > 0) setShowApprovals(true);
          else setShowMonthPicker(true);
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
          label: formatHuman(t.week_start).slice(0, 6),
          GMV: n.overall.total_gmv,
          'Affiliate GMV': n.overall.affiliate_gmv,
        };
      });
  }, [openReport, reports]);

  const clientName = client?.name ?? 'Client';
  if (loading) return <PublicShell clientName={clientName}><div className="text-center py-5"><Spinner animation="border" /></div></PublicShell>;
  if (err) return <PublicShell clientName={clientName}><Alert variant="danger">{err}</Alert></PublicShell>;

  const addComment = async (section: CommentSection, body: string, authorName: string, parentId?: string) => {
    if (!openReport) return;
    const { data, error } = await supabase.functions.invoke('post-shared-comment', {
      body: { token, report_id: openReport.id, section, author_name: authorName, body, parent_id: parentId },
    });
    if (error) throw error;
    if ((data as any)?.error) throw new Error((data as any).error);
    setComments(prev => [...prev, (data as any).comment as Comment]);
    setPublicName(authorName);
  };

  const reportComments = openReport ? comments.filter(c => c.report_id === openReport.id) : [];

  const decidedIds = useMemo(() => new Set(decisions.map(d => d.report_id)), [decisions]);
  const pendingApprovals: PendingApprovalReport[] = useMemo(() => {
    return reports
      .filter(r => r.content?.approval?.enabled === true && !decidedIds.has(r.id))
      .map(r => {
        const b = brands.find(x => x.id === r.brand_id);
        return {
          id: r.id,
          brand_id: r.brand_id,
          brand_name: b?.name ?? 'Brand',
          week_number: r.week_number,
          week_start: r.week_start,
          week_end: r.week_end,
          content: normalizeContent(r.content),
        };
      });
  }, [reports, brands, decidedIds]);

  const monthsWithData = useMemo(() =>
    new Set<string>(reports.map(r => r.week_start.slice(0, 7))),
  [reports]);

  const submitApprovals = async (
    items: { report_id: string; decision: 'approved' | 'changes_requested'; comment: string; decided_by_name: string }[]
  ) => {
    for (const it of items) {
      const { data, error } = await supabase.functions.invoke('post-approval-decision', {
        body: { token, ...it },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const inserted = (data as any).decision;
      setDecisions(prev => {
        const filtered = prev.filter(d => d.report_id !== inserted.report_id);
        return [...filtered, inserted];
      });
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
    if (error) throw error;
    if ((data as any)?.error) throw new Error((data as any).error);
    setResourceComments(prev => [...prev, (data as any).comment as ResourceComment]);
    setPublicName(authorName);
  };
  const resourceCommentCount = (rid: string) => resourceComments.filter(c => c.resource_id === rid).length;

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
          approvalDecisions={decisions
            .filter(d => d.report_id === openReport.id)
            .map(d => ({
              id: d.id, decision: d.decision, comment: d.comment,
              decided_by_name: d.decided_by_name, decided_at: d.decided_at,
            }))}
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

  const brandReportCount = (brandId: string) => reports.filter(r => r.brand_id === brandId).length;
  const brandResourceCount = (brandId: string) =>
    resources.filter(r => (r.scope === 'brand' && r.brand_id === brandId) || r.scope === 'general').length;

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
                  background: active ? 'linear-gradient(135deg, #2563eb, #7c3aed)' : 'white',
                  color: active ? 'white' : '#111827',
                  border: active ? 'none' : '1px solid #e5e7eb',
                  borderRadius: 12,
                  padding: '12px 20px',
                  minWidth: 180,
                  textAlign: 'left',
                  cursor: 'pointer',
                  boxShadow: active ? '0 8px 20px rgba(37,99,235,.25)' : 'none',
                  transition: 'all .15s',
                }}
              >
                <div className="small" style={{ opacity: active ? .8 : .55, fontSize: '.7rem', letterSpacing: '.5px' }}>BRAND</div>
                <div className="fw-semibold" style={{ fontSize: '1.05rem' }}>{b.name}</div>
                <div className="small mt-1" style={{ opacity: active ? .85 : .6 }}>
                  {brandReportCount(b.id)} report{brandReportCount(b.id) !== 1 ? 's' : ''} · {brandResourceCount(b.id)} resource{brandResourceCount(b.id) !== 1 ? 's' : ''}
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
                      <i className="bi bi-bar-chart-line" /> Reporting
                      <Badge bg="secondary">{brandReports.length}</Badge>
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
              </Nav>
            </Card.Header>
            <Card.Body>
              <Tab.Content>
                <Tab.Pane eventKey="reporting">
                  <div className="d-flex justify-content-between align-items-end mb-3 flex-wrap gap-2">
                    <div>
                      <h5 className="mb-0">{activeBrand.name} — Reports</h5>
                      <small className="text-muted">{monthFiltered.length} report{monthFiltered.length !== 1 ? 's' : ''} in {fmtMonthLabel(month)}</small>
                    </div>
                    <div className="d-flex gap-2 align-items-end">
                      <Button size="sm" variant="outline-primary" onClick={() => setShowMonthPicker(true)}>
                        <i className="bi bi-calendar3 me-1" /> Change month
                      </Button>
                    </div>
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
                                {approvalEnabled && (
                                  <div className="mt-2">
                                    {dec ? (
                                      <Badge bg={dec.decision === 'approved' ? 'success' : 'warning'}
                                             text={dec.decision === 'approved' ? undefined : 'dark'}>
                                        <i className={`bi ${dec.decision === 'approved' ? 'bi-check-circle' : 'bi-arrow-repeat'} me-1`} />
                                        {dec.decision === 'approved' ? 'Approved' : 'Changes requested'}
                                      </Badge>
                                    ) : (
                                      <Badge bg="warning" text="dark">
                                        <i className="bi bi-shield-exclamation me-1" /> Approval requested
                                      </Badge>
                                    )}
                                  </div>
                                )}
                              </Card.Body>
                            </Card>
                          </Col>
                        );
                      })}
                    </Row>
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
        pending={pendingApprovals}
        defaultName={publicName}
        onClose={() => {
          setShowApprovals(false);
          setShowMonthPicker(true);
        }}
        onSubmit={submitApprovals}
      />
      <MonthPickerModal
        show={showMonthPicker}
        monthsWithData={monthsWithData}
        selectedMonth={month}
        onPick={(m) => { setMonth(m); setShowMonthPicker(false); }}
        onClose={() => setShowMonthPicker(false)}
      />
    </PublicShell>
  );
}

function fmtMonthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
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

