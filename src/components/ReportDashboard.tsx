import { Card, Row, Col, Table, Alert } from 'react-bootstrap';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  LineChart, Line, RadialBarChart, RadialBar, PolarAngleAxis,
} from 'recharts';
import { WeeklyReportContent } from '../lib/reportSchema';
import SectionComments, { Comment, CommentSection } from './SectionComments';

export interface TrendPoint { label: string; GMV: number; 'Affiliate GMV': number; }

export interface CommentsConfig {
  mode: 'authed' | 'public';
  comments: Comment[];
  currentAuthorName?: string;
  defaultPublicName?: string;
  onAdd: (section: CommentSection, body: string, authorName: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

export default function ReportDashboard({
  c, p, trendData, hasPrev, commentsConfig,
}: {
  c: WeeklyReportContent;
  p: WeeklyReportContent | null;
  trendData: TrendPoint[];
  hasPrev: boolean;
  commentsConfig?: CommentsConfig;
}) {
  const o = c.overall;
  const po = p?.overall;

  const compareData = [
    { metric: 'GMV',           'This Week': o.gmv,            'Last Week': po?.gmv ?? 0 },
    { metric: 'Affiliate GMV', 'This Week': o.affiliate_gmv,  'Last Week': po?.affiliate_gmv ?? 0 },
    { metric: 'Orders',        'This Week': o.orders,         'Last Week': po?.orders ?? 0 },
    { metric: 'Samples',       'This Week': o.samples_approved,'Last Week': po?.samples_approved ?? 0 },
    { metric: 'Videos',        'This Week': o.videos_posted,  'Last Week': po?.videos_posted ?? 0 },
  ];

  const sps = Math.max(0, Math.min(5, o.sps));
  const spsData = [{ name: 'SPS', value: (sps / 5) * 100, fill: spsColor(sps) }];

  const renderComments = (section: CommentSection) => {
    if (!commentsConfig) return null;
    return (
      <SectionComments
        section={section}
        comments={commentsConfig.comments}
        mode={commentsConfig.mode}
        currentAuthorName={commentsConfig.currentAuthorName}
        defaultPublicName={commentsConfig.defaultPublicName}
        onAdd={(body, name) => commentsConfig.onAdd(section, body, name)}
        onDelete={commentsConfig.onDelete}
      />
    );
  };

  return (
    <>
      {!hasPrev && <Alert variant="warning" className="py-2">No previous week — single-week view (no comparison).</Alert>}

      <Row className="g-3 mb-4">
        <KpiCard label="GMV"              value={`$${o.gmv.toLocaleString()}`}           prev={po?.gmv}           cur={o.gmv} money />
        <KpiCard label="Affiliate GMV"    value={`$${o.affiliate_gmv.toLocaleString()}`} prev={po?.affiliate_gmv} cur={o.affiliate_gmv} money />
        <KpiCard label="Orders"           value={o.orders.toLocaleString()}              prev={po?.orders}        cur={o.orders} />
        <KpiCard label="ROI"              value={o.roi.toFixed(2)}                       prev={po?.roi}           cur={o.roi} dec />
        <KpiCard label="Samples Approved" value={o.samples_approved.toLocaleString()}    prev={po?.samples_approved} cur={o.samples_approved} sub={o.samples_approved_note} />
        <KpiCard label="Videos Posted"    value={o.videos_posted.toLocaleString()}       prev={po?.videos_posted} cur={o.videos_posted} sub={o.videos_total_note} />
      </Row>

      <Row className="g-3 mb-4">
        <Col lg={8}>
          <Card className="h-100">
            <Card.Header className="fw-semibold">Week-over-week comparison</Card.Header>
            <Card.Body style={{ height: 340 }}>
              <ResponsiveContainer>
                <BarChart data={compareData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="metric" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="This Week" fill="#2563eb" radius={[6,6,0,0]} />
                  <Bar dataKey="Last Week" fill="#94a3b8" radius={[6,6,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card.Body>
          </Card>
        </Col>
        <Col lg={4}>
          <Card className="h-100">
            <Card.Header className="fw-semibold">Shop Performance Score</Card.Header>
            <Card.Body style={{ height: 340, position: 'relative' }}>
              <ResponsiveContainer>
                <RadialBarChart innerRadius="70%" outerRadius="100%" data={spsData} startAngle={90} endAngle={-270}>
                  <PolarAngleAxis type="number" domain={[0,100]} tick={false} />
                  <RadialBar background dataKey="value" cornerRadius={20} />
                </RadialBarChart>
              </ResponsiveContainer>
              <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, transform: 'translateY(-50%)', textAlign: 'center', pointerEvents: 'none' }}>
                <div className="fs-1 fw-bold">{sps.toFixed(1)}</div>
                <div className="text-muted small">out of 5.0</div>
                {po && <div className="small mt-1"><Delta cur={sps} prev={po.sps} dec /></div>}
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {trendData.length > 1 && (
        <Card className="mb-4">
          <Card.Header className="fw-semibold">GMV trend (last {trendData.length} weeks)</Card.Header>
          <Card.Body style={{ height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="GMV" stroke="#2563eb" strokeWidth={3} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="Affiliate GMV" stroke="#10b981" strokeWidth={3} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </Card.Body>
        </Card>
      )}

      {renderComments('overall')}

      <Row className="g-3 mb-4">
        <Col lg={6}>
          <Card className="h-100">
            <Card.Header className="fw-semibold">Top Creators</Card.Header>
            <Card.Body className="p-0">
              {c.top_creators.length === 0 ? <p className="text-muted text-center py-3 mb-0 small">No data</p> : (
                <Table size="sm" className="mb-0 align-middle">
                  <thead><tr><th>Creator</th><th className="text-end">Videos</th><th className="text-end">Items</th><th className="text-end">GMV</th></tr></thead>
                  <tbody>
                    {c.top_creators.map((r, i) => (
                      <tr key={i}>
                        <td className="fw-semibold">{r.name}</td>
                        <td className="text-end">{r.videos}</td>
                        <td className="text-end">{r.items_sold}</td>
                        <td className="text-end">${r.gmv.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card.Body>
          </Card>
        </Col>
        <Col lg={6}>
          <Card className="h-100">
            <Card.Header className="fw-semibold">Top Videos</Card.Header>
            <Card.Body className="p-0">
              {c.top_videos.length === 0 ? <p className="text-muted text-center py-3 mb-0 small">No data</p> : (
                <Table size="sm" className="mb-0 align-middle">
                  <thead><tr><th>Creator</th><th className="text-end">Items</th><th className="text-end">GMV</th><th className="text-end">Views</th></tr></thead>
                  <tbody>
                    {c.top_videos.map((r, i) => (
                      <tr key={i}>
                        <td className="fw-semibold">
                          {r.video_url ? <a href={r.video_url} target="_blank" rel="noreferrer">{r.creator_name}</a> : r.creator_name}
                        </td>
                        <td className="text-end">{r.items_sold}</td>
                        <td className="text-end">${r.gmv.toLocaleString()}</td>
                        <td className="text-end">{r.views.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row>
        <Col lg={6}>{renderComments('top_creators')}</Col>
        <Col lg={6}>{renderComments('top_videos')}</Col>
      </Row>

      <Row className="g-3 mb-4">
        <Col lg={6}>
          <Card className="h-100">
            <Card.Header className="fw-semibold">GMV Max Campaigns</Card.Header>
            <Card.Body className="p-0">
              {c.gmv_max.length === 0 ? <p className="text-muted text-center py-3 mb-0 small">No data</p> : (
                <Table size="sm" className="mb-0 align-middle">
                  <thead><tr><th>Campaign</th><th className="text-end">Spend</th><th className="text-end">ROI</th><th className="text-end">GMV</th></tr></thead>
                  <tbody>
                    {c.gmv_max.map((r, i) => (
                      <tr key={i}>
                        <td className="fw-semibold">{r.campaign}</td>
                        <td className="text-end">${r.spend.toLocaleString()}</td>
                        <td className="text-end">{r.roi.toFixed(2)}</td>
                        <td className="text-end">${r.gmv.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card.Body>
          </Card>
        </Col>
        <Col lg={6}>
          <Card className="h-100">
            <Card.Header className="fw-semibold">Product Highlights</Card.Header>
            <Card.Body className="p-0">
              {c.product_highlights.length === 0 ? <p className="text-muted text-center py-3 mb-0 small">No data</p> : (
                <Table size="sm" className="mb-0 align-middle">
                  <thead><tr><th>Product</th><th className="text-end">Units</th><th className="text-end">GMV</th><th className="text-end">New Videos</th></tr></thead>
                  <tbody>
                    {c.product_highlights.map((r, i) => (
                      <tr key={i}>
                        <td>
                          <div className="fw-semibold">{r.product_name}</div>
                          <small className="text-muted">{r.product_id}</small>
                        </td>
                        <td className="text-end">{r.units_sold}</td>
                        <td className="text-end">${r.gmv.toLocaleString()}</td>
                        <td className="text-end">{r.new_videos}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row>
        <Col lg={6}>{renderComments('gmv_max')}</Col>
        <Col lg={6}>{renderComments('product_highlights')}</Col>
      </Row>

      {c.insights.summary && (
        <Card className="mb-4">
          <Card.Header className="fw-semibold">Insights</Card.Header>
          <Card.Body>
            <p className="mb-0" style={{whiteSpace:'pre-wrap'}}>{c.insights.summary}</p>
          </Card.Body>
        </Card>
      )}

      {renderComments('insights')}
    </>
  );
}

function spsColor(v: number) {
  if (v >= 4.5) return '#10b981';
  if (v >= 3.5) return '#f59e0b';
  return '#ef4444';
}

function KpiCard({ label, value, prev, cur, money, dec, sub }: {
  label: string; value: string; prev?: number; cur: number;
  money?: boolean; dec?: boolean; sub?: string;
}) {
  return (
    <Col md={4} lg={2}>
      <Card className="h-100 shadow-sm" style={{ borderLeft: '4px solid #2563eb' }}>
        <Card.Body className="py-3">
          <div className="text-muted small text-uppercase" style={{ letterSpacing: '.5px', fontSize: '.7rem' }}>{label}</div>
          <div className="fs-4 fw-bold mt-1">{value}</div>
          <Delta cur={cur} prev={prev} money={money} dec={dec} />
          {sub && <small className="text-muted d-block mt-1">{sub}</small>}
        </Card.Body>
      </Card>
    </Col>
  );
}

function Delta({ cur, prev, money, dec }: { cur: number; prev?: number; money?: boolean; dec?: boolean; }) {
  if (prev == null) return <small className="text-muted">—</small>;
  if (prev === 0 && cur === 0) return <small className="text-muted">no change</small>;
  const diff = cur - prev;
  const pct = prev === 0 ? 100 : (diff / prev) * 100;
  const up = diff >= 0;
  const color = up ? 'text-success' : 'text-danger';
  const icon = up ? 'bi-arrow-up-right' : 'bi-arrow-down-right';
  const fmt = (n: number) => money ? `$${Math.abs(n).toLocaleString()}` : dec ? Math.abs(n).toFixed(2) : Math.abs(n).toLocaleString();
  return (
    <small className={color}>
      <i className={`bi ${icon}`} /> {fmt(diff)} ({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)
    </small>
  );
}
