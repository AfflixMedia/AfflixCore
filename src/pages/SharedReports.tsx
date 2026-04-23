import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Spinner, Alert, Form, Row, Col, Badge, Button, Tab, Nav } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { addDays, formatRange, formatHuman, fromISO } from '../lib/dates';
import { WeeklyReportContent, emptyContent } from '../lib/reportSchema';
import ReportDashboard, { TrendPoint } from '../components/ReportDashboard';
import { Comment, CommentSection } from '../components/SectionComments';
import { resourceIcon } from '../lib/resourceIcon';

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
  const [label, setLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [activeBrandId, setActiveBrandId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'reporting' | 'resources'>('reporting');
  const [month, setMonth] = useState(currentMonth());
  const [openId, setOpenId] = useState<string | null>(null);

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
        setLabel(data.label);
        if (data.brands?.length > 0) setActiveBrandId(data.brands[0].id);
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
      .map(t => ({
        label: formatHuman(t.week_start).slice(0, 6),
        GMV: t.content?.overall?.gmv ?? 0,
        'Affiliate GMV': t.content?.overall?.affiliate_gmv ?? 0,
      }));
  }, [openReport, reports]);

  const clientName = client?.name ?? 'Client';
  if (loading) return <PublicShell clientName={clientName}><div className="text-center py-5"><Spinner animation="border" /></div></PublicShell>;
  if (err) return <PublicShell clientName={clientName}><Alert variant="danger">{err}</Alert></PublicShell>;

  const addComment = async (section: CommentSection, body: string, authorName: string) => {
    if (!openReport) return;
    const { data, error } = await supabase.functions.invoke('post-shared-comment', {
      body: { token, report_id: openReport.id, section, author_name: authorName, body },
    });
    if (error) throw error;
    if ((data as any)?.error) throw new Error((data as any).error);
    setComments(prev => [...prev, (data as any).comment as Comment]);
  };

  const reportComments = openReport ? comments.filter(c => c.report_id === openReport.id) : [];

  // Report detail view
  if (openReport && activeBrand) {
    return (
      <PublicShell clientName={clientName}>
        <div className="d-flex justify-content-between align-items-start mb-4 flex-wrap gap-2">
          <div>
            <div className="text-muted small">{activeBrand.name}</div>
            <h4 className="mb-0">Week #{openReport.week_number} — {formatRange(openReport.week_start, openReport.week_end)}</h4>
          </div>
          <Button variant="outline-secondary" onClick={() => setOpenId(null)}>← Back</Button>
        </div>
        <ReportDashboard
          c={normalize(openReport.content)}
          p={prevReport ? normalize(prevReport.content) : null}
          trendData={trendData}
          hasPrev={!!prevReport}
          commentsConfig={{
            mode: 'public',
            comments: reportComments,
            defaultPublicName: localStorage.getItem('ac_public_name') ?? '',
            onAdd: addComment,
          }}
        />
      </PublicShell>
    );
  }

  const brandReportCount = (brandId: string) => reports.filter(r => r.brand_id === brandId).length;
  const brandResourceCount = (brandId: string) =>
    resources.filter(r => (r.scope === 'brand' && r.brand_id === brandId) || r.scope === 'general').length;

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
                <Nav.Item>
                  <Nav.Link eventKey="reporting" className="d-flex align-items-center gap-2 px-3">
                    <i className="bi bi-bar-chart-line" /> Reporting
                    <Badge bg="secondary">{brandReports.length}</Badge>
                  </Nav.Link>
                </Nav.Item>
                <Nav.Item>
                  <Nav.Link eventKey="resources" className="d-flex align-items-center gap-2 px-3">
                    <i className="bi bi-folder2" /> Resources
                    <Badge bg="secondary">{brandResources.length}</Badge>
                  </Nav.Link>
                </Nav.Item>
              </Nav>
            </Card.Header>
            <Card.Body>
              <Tab.Content>
                <Tab.Pane eventKey="reporting">
                  <div className="d-flex justify-content-between align-items-end mb-3 flex-wrap gap-2">
                    <div>
                      <h5 className="mb-0">{activeBrand.name} — Reports</h5>
                      <small className="text-muted">{monthFiltered.length} report{monthFiltered.length !== 1 ? 's' : ''} in selected month</small>
                    </div>
                    <div>
                      <Form.Label className="small mb-1 text-muted">Month</Form.Label>
                      <Form.Control size="sm" type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ minWidth: 170 }} />
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
                      {monthFiltered.map(r => (
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
                            </Card.Body>
                          </Card>
                        </Col>
                      ))}
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
                        return (
                          <Col md={6} lg={4} key={r.id}>
                            <a href={r.url} target="_blank" rel="noreferrer"
                              className="d-flex align-items-center gap-3 p-3 rounded text-decoration-none text-dark h-100"
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
                              <i className="bi bi-arrow-up-right-square text-muted" style={{ fontSize: '1.1rem' }} />
                            </a>
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
    </PublicShell>
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

function normalize(content: any): WeeklyReportContent {
  const merged = { ...emptyContent(), ...(content ?? {}) };
  merged.overall  = { ...emptyContent().overall,  ...(content?.overall ?? {}) };
  merged.insights = { ...emptyContent().insights, ...(content?.insights ?? {}) };
  return merged;
}
