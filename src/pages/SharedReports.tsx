import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Spinner, Alert, Form, Row, Col, Badge, Button } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { addDays, formatRange, formatHuman, fromISO } from '../lib/dates';
import { WeeklyReportContent, emptyContent } from '../lib/reportSchema';
import ReportDashboard, { TrendPoint } from '../components/ReportDashboard';

interface Brand { id: string; name: string; client: string | null; client_id: string | null; }
interface Report {
  id: string; brand_id: string; week_start: string; week_end: string;
  week_number: number; status: string; content: WeeklyReportContent;
}

export default function SharedReports() {
  const { token } = useParams<{ token: string }>();
  const [client, setClient] = useState<{ id: string; name: string } | null>(null);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [label, setLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [month, setMonth] = useState(currentMonth());
  const [brandId, setBrandId] = useState('');
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
        setLabel(data.label);
        if (data.brands?.length === 1) setBrandId(data.brands[0].id);
      } catch (e: any) {
        setErr(e?.message ?? 'Failed to load');
      }
      setLoading(false);
    })();
  }, [token]);

  const monthFiltered = useMemo(() => {
    return reports.filter(r => {
      const d = fromISO(r.week_start);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const match = ym === month;
      const brandMatch = brandId ? r.brand_id === brandId : true;
      return match && brandMatch;
    });
  }, [reports, month, brandId]);

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

  const openBrand = openReport ? brands.find(b => b.id === openReport.brand_id) : null;

  return (
    <PublicShell clientName={clientName}>
      {openReport && openBrand ? (
        <>
          <div className="d-flex justify-content-between align-items-start mb-4 flex-wrap gap-2">
            <div>
              <div className="text-muted small">{openBrand.name}</div>
              <h4 className="mb-0">Week #{openReport.week_number} — {formatRange(openReport.week_start, openReport.week_end)}</h4>
            </div>
            <Button variant="outline-secondary" onClick={() => setOpenId(null)}>← Back</Button>
          </div>
          <ReportDashboard
            c={normalize(openReport.content)}
            p={prevReport ? normalize(prevReport.content) : null}
            trendData={trendData}
            hasPrev={!!prevReport}
          />
        </>
      ) : (
        <>
          <div className="d-flex justify-content-end mb-4">
            <div className="d-flex align-items-end gap-2 flex-wrap" style={{ maxWidth: 520 }}>
              <div>
                <Form.Label className="small mb-1 text-muted">Month</Form.Label>
                <Form.Control size="sm" type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ minWidth: 160 }} />
              </div>
              <div>
                <Form.Label className="small mb-1 text-muted">Brand</Form.Label>
                <Form.Select size="sm" value={brandId} onChange={e => setBrandId(e.target.value)} style={{ minWidth: 180 }}>
                  <option value="">All brands</option>
                  {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Form.Select>
              </div>
            </div>
          </div>

          {monthFiltered.length === 0 ? (
            <Card body className="text-center text-muted">No reports for this month.</Card>
          ) : (
            <Row className="g-3">
              {monthFiltered.map(r => {
                const b = brands.find(x => x.id === r.brand_id);
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
                          <div>
                            <div className="text-muted small text-uppercase" style={{ letterSpacing: '.5px', fontSize: '.7rem' }}>Brand</div>
                            <h5 className="mb-2">{b?.name ?? '—'}</h5>
                          </div>
                          <Badge bg="primary" pill>Week #{r.week_number}</Badge>
                        </div>
                        <div className="text-muted small mt-3">
                          <i className="bi bi-calendar3 me-1" /> {formatRange(r.week_start, r.week_end)}
                        </div>
                      </Card.Body>
                    </Card>
                  </Col>
                );
              })}
            </Row>
          )}
        </>
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
