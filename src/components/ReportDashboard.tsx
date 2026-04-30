import { useEffect, useState } from 'react';
import { Card, Row, Col, Table, Alert, Badge, Offcanvas, Button } from 'react-bootstrap';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  LineChart, Line, RadialBarChart, RadialBar, PolarAngleAxis,
} from 'recharts';
import { WeeklyReportContent, ListingQuality, CustomSection, CustomField, StandardSectionId } from '../lib/reportSchema';
import DOMPurify from 'dompurify';
import SectionComments, { Comment, CommentSection } from './SectionComments';

export interface TrendPoint { label: string; GMV: number; 'Affiliate GMV': number; }

export interface CommentsConfig {
  mode: 'authed' | 'public';
  comments: Comment[];
  currentAuthorName?: string;
  defaultPublicName?: string;
  onAdd: (section: CommentSection, body: string, authorName: string, parentId?: string) => Promise<void>;
}

export default function ReportDashboard({
  c, p, trendData, hasPrev, commentsConfig, prevTopVideos, openSectionOnLoad, highlightCommentId,
}: {
  c: WeeklyReportContent;
  p: WeeklyReportContent | null;
  trendData: TrendPoint[];
  hasPrev: boolean;
  commentsConfig?: CommentsConfig;
  prevTopVideos?: WeeklyReportContent['top_videos'];
  /** When set, opens the feedback offcanvas for that section on mount and scrolls to it. */
  openSectionOnLoad?: CommentSection | null;
  /** When set, highlights and scrolls to that comment id inside the offcanvas. */
  highlightCommentId?: string | null;
}) {
  const o = c.overall, po = p?.overall;
  const vp = c.video_performance, pvp = p?.video_performance;
  const gm = c.gmv_max, pgm = p?.gmv_max;
  const sh = c.shop_health;

  const compareData = [
    { metric: 'Total GMV',     'This Week': o.total_gmv,      'Last Week': po?.total_gmv ?? 0 },
    { metric: 'Affiliate GMV', 'This Week': o.affiliate_gmv,  'Last Week': po?.affiliate_gmv ?? 0 },
    { metric: 'Orders',        'This Week': o.orders,         'Last Week': po?.orders ?? 0 },
    { metric: 'Samples',       'This Week': o.samples_approved,'Last Week': po?.samples_approved ?? 0 },
    { metric: 'Videos',        'This Week': vp.total_videos_posted, 'Last Week': pvp?.total_videos_posted ?? 0 },
  ];

  const sps = sh.shop_performance_score ?? 0;
  const spsData = [{ name: 'SPS', value: sps > 0 ? (sps / 5) * 100 : 0, fill: spsColor(sps) }];

  const [feedbackSection, setFeedbackSection] = useState<CommentSection | null>(null);

  useEffect(() => {
    if (!openSectionOnLoad) return;
    setFeedbackSection(openSectionOnLoad);
    // Scroll the section card into view if we tagged it with a data-section attribute
    setTimeout(() => {
      const el = document.querySelector(`[data-section="${CSS.escape(openSectionOnLoad)}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, [openSectionOnLoad]);

  const sectionFeedbackCount = (section: CommentSection) =>
    (commentsConfig?.comments ?? []).filter(c => c.section === section).length;

  const standardLabelFor: Record<string, string> = {
    overall: 'Overall Performance',
    top_creators: 'Top Creators',
    top_videos: 'Top Videos',
    video_performance: 'Video Performance',
    gmv_max: 'GMV Max',
    product_highlights: 'Product Highlights',
    shop_health: 'Shop Health',
    insights: 'Insights',
  };

  const customSectionFor = (section: CommentSection): CustomSection | null => {
    if (!section.startsWith('cs:')) return null;
    const id = section.slice(3);
    return c.custom_sections.find(s => s.id === id) ?? null;
  };
  const labelFor = (section: CommentSection): string => {
    const cs = customSectionFor(section);
    if (cs) return cs.name || 'Custom Section';
    return standardLabelFor[section] ?? section;
  };

  const FeedbackIcon = ({ section }: { section: CommentSection }) => {
    if (!commentsConfig) return null;
    const n = sectionFeedbackCount(section);
    // Authed: only show when feedback exists. Public: always show (clients can comment).
    if (commentsConfig.mode === 'authed' && n === 0) return null;
    return (
      <Button size="sm" variant="outline-primary" className="ms-2 d-inline-flex align-items-center gap-1"
        onClick={() => setFeedbackSection(section)}
        title={commentsConfig.mode === 'authed' ? 'View client feedback' : 'View / add comments'}>
        <i className="bi bi-chat-left-text" />
        {n > 0 && <Badge bg="primary" pill>{n}</Badge>}
      </Button>
    );
  };

  const SectionHeader = ({ title, section }: { title: string; section: CommentSection }) => (
    <div className="d-flex justify-content-between align-items-center w-100">
      <span className="fw-semibold">{title}</span>
      <FeedbackIcon section={section} />
    </div>
  );

  const renderCustomAt = (anchor: StandardSectionId) =>
    (c.custom_sections ?? []).filter(s => s.insert_after === anchor).map(s => (
      <CustomSectionView
        key={s.id}
        section={s}
        feedbackSlot={<FeedbackIcon section={`cs:${s.id}`} />}
      />
    ));

  return (
    <div className="ac-themed">
      {!hasPrev && <Alert variant="warning" className="py-2">No previous week — single-week view (no comparison).</Alert>}

      {renderCustomAt('start')}

      <Offcanvas show={!!feedbackSection} onHide={() => setFeedbackSection(null)} placement="end" style={{ width: 480 }}>
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>
            <i className="bi bi-chat-left-text me-2" />
            {commentsConfig?.mode === 'authed' ? 'Client feedback' : 'Comments'}
            {feedbackSection && <small className="text-muted ms-2 fw-normal">— {labelFor(feedbackSection)}</small>}
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {feedbackSection && commentsConfig && (
            <SectionComments
              section={feedbackSection}
              sectionLabel={labelFor(feedbackSection)}
              comments={commentsConfig.comments}
              mode={commentsConfig.mode}
              currentAuthorName={commentsConfig.currentAuthorName}
              defaultPublicName={commentsConfig.defaultPublicName}
              onAdd={(b, n, parentId) => commentsConfig.onAdd(feedbackSection, b, n, parentId)}
              highlightCommentId={highlightCommentId ?? undefined}
            />
          )}
        </Offcanvas.Body>
      </Offcanvas>

      {/* KPI cards */}
      <Row className="g-3 mb-4">
        <KpiCard label="Total GMV"       value={`$${o.total_gmv.toLocaleString()}`}      prev={po?.total_gmv}      cur={o.total_gmv} money />
        <KpiCard label="Affiliate GMV"   value={`$${o.affiliate_gmv.toLocaleString()}`}  prev={po?.affiliate_gmv}  cur={o.affiliate_gmv} money />
        <KpiCard label="Orders"          value={o.orders.toLocaleString()}               prev={po?.orders}         cur={o.orders} />
        <KpiCard label="Samples Approved"value={o.samples_approved.toLocaleString()}     prev={po?.samples_approved} cur={o.samples_approved} sub={o.samples_approved_note} />
        <KpiCard label="Pending Collabs" value={o.pending_collabs.toLocaleString()}      prev={po?.pending_collabs} cur={o.pending_collabs} />
        <KpiCard
          label="Ad Spend"
          value={o.ad_spend_not_started ? 'Not started' : `$${o.ad_spend.toLocaleString()}`}
          prev={po?.ad_spend_not_started ? undefined : po?.ad_spend}
          cur={o.ad_spend_not_started ? 0 : o.ad_spend}
          money
          sub={o.ad_spend_target}
        />
      </Row>

      {/* Comparison + SPS radial */}
      <Row className="g-3 mb-4" data-section="overall">
        <Col lg={8}>
          <Card className="h-100">
            <Card.Header><SectionHeader title="Week-over-week comparison" section="overall" /></Card.Header>
            <Card.Body style={{ height: 340 }}>
              <ResponsiveContainer>
                <BarChart data={compareData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="metric" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="This Week" fill="#e8862e" radius={[6,6,0,0]} />
                  <Bar dataKey="Last Week" fill="#6e6e80" radius={[6,6,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card.Body>
          </Card>
        </Col>
        <Col lg={4}>
          <Card className="h-100">
            <Card.Header><SectionHeader title="Shop Performance Score" section="shop_health" /></Card.Header>
            <Card.Body style={{ height: 340, position: 'relative' }}>
              {sh.shop_performance_score == null ? (
                <div className="d-flex align-items-center justify-content-center h-100 text-muted">
                  <div className="text-center">
                    <i className="bi bi-hourglass-split" style={{ fontSize: '2rem' }} />
                    <div className="mt-2">Not yet assigned</div>
                  </div>
                </div>
              ) : (
                <>
                  <ResponsiveContainer>
                    <RadialBarChart innerRadius="70%" outerRadius="100%" data={spsData} startAngle={90} endAngle={-270}>
                      <PolarAngleAxis type="number" domain={[0,100]} tick={false} />
                      <RadialBar background dataKey="value" cornerRadius={20} />
                    </RadialBarChart>
                  </ResponsiveContainer>
                  <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, transform: 'translateY(-50%)', textAlign: 'center', pointerEvents: 'none' }}>
                    <div className="fs-1 fw-bold">{sps.toFixed(1)}</div>
                    <div className="text-muted small">out of 5.0</div>
                  </div>
                </>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {trendData.length > 1 && (
        <Card className="mb-4">
          <Card.Header><SectionHeader title={`GMV trend (last ${trendData.length} weeks)`} section="overall" /></Card.Header>
          <Card.Body style={{ height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="GMV" stroke="#e8862e" strokeWidth={3} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="Affiliate GMV" stroke="#ffbe76" strokeWidth={3} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </Card.Body>
        </Card>
      )}

      {renderCustomAt('overall')}

      {/* Top Creators */}
      <Card className="mb-3" data-section="top_creators">
        <Card.Header><SectionHeader title="Top Creators" section="top_creators" /></Card.Header>
        <Card.Body className="p-0">
          {c.top_creators.length === 0 ? <p className="text-muted text-center py-3 mb-0 small">No creators</p> : (
            <Table size="sm" className="mb-0 align-middle">
              <thead><tr>
                <th>Creator</th><th className="text-end">Videos</th><th className="text-end">Items sold</th><th className="text-end">GMV</th>
              </tr></thead>
              <tbody>
                {c.top_creators.map((r, i) => (
                  <tr key={i}>
                    <td className="fw-semibold">
                      {r.name ? (
                        <a href={tiktokLink(r.name)} target="_blank" rel="noreferrer" title="Open creator on TikTok">
                          {r.name}
                        </a>
                      ) : '—'}
                    </td>
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
      {renderCustomAt('top_creators')}

      {/* Top Videos: this + last side by side */}
      <Row className="g-3 mb-3" data-section="top_videos">
        <Col lg={6}>
          <Card className="h-100">
            <Card.Header><SectionHeader title="Top Videos — This Week" section="top_videos" /></Card.Header>
            <Card.Body className="p-0">
              <VideosTable rows={c.top_videos} />
            </Card.Body>
          </Card>
        </Col>
        <Col lg={6}>
          <Card className="h-100">
            <Card.Header><SectionHeader title="Top Videos — Last Week" section="top_videos" /></Card.Header>
            <Card.Body className="p-0">
              <VideosTable rows={prevTopVideos ?? []} />
            </Card.Body>
          </Card>
        </Col>
      </Row>
      {renderCustomAt('top_videos')}

      {/* Video Performance */}
      <Card className="mb-3" data-section="video_performance">
        <Card.Header><SectionHeader title="Video Performance" section="video_performance" /></Card.Header>
        <Card.Body>
          <Row className="g-3">
            <MiniStat label="Total Videos" cur={vp.total_videos_posted} prev={pvp?.total_videos_posted} />
            <MiniStat label="Video Views" cur={vp.video_views} prev={pvp?.video_views} />
            <MiniStat label="CTR" cur={vp.ctr} prev={pvp?.ctr} suffix="%" />
            <MiniStat label="CTOR" cur={vp.ctor} prev={pvp?.ctor} suffix="%" />
          </Row>
        </Card.Body>
      </Card>
      {renderCustomAt('video_performance')}

      {/* GMV Max */}
      <Card className="mb-3" data-section="gmv_max">
        <Card.Header><SectionHeader title="Overall GMV Max Performance" section="gmv_max" /></Card.Header>
        <Card.Body>
          {gm.not_yet_started ? (
            <Alert variant="secondary" className="mb-0">Not yet started.</Alert>
          ) : (
            <Row className="g-3">
              <MiniStat label="Ad Spend" cur={gm.ad_spend} prev={pgm?.not_yet_started ? undefined : pgm?.ad_spend} money />
              <MiniStat label="ROI"      cur={gm.roi}      prev={pgm?.not_yet_started ? undefined : pgm?.roi} dec />
              <MiniStat label="Orders"   cur={gm.orders}   prev={pgm?.not_yet_started ? undefined : pgm?.orders} />
              <MiniStat label="CPO"      cur={gm.cpo}      prev={pgm?.not_yet_started ? undefined : pgm?.cpo} money />
              <MiniStat label="GMV"      cur={gm.gmv}      prev={pgm?.not_yet_started ? undefined : pgm?.gmv} money />
              {gm.notes && <Col md={12}><small className="text-muted">{gm.notes}</small></Col>}
            </Row>
          )}
        </Card.Body>
      </Card>
      {renderCustomAt('gmv_max')}

      {/* Product Highlights */}
      <Card className="mb-3" data-section="product_highlights">
        <Card.Header><SectionHeader title="Product Highlights" section="product_highlights" /></Card.Header>
        <Card.Body className="p-0">
          {c.product_highlights.length === 0 ? <p className="text-muted text-center py-3 mb-0 small">No products</p> : (
            <Table size="sm" responsive className="mb-0 align-middle">
              <thead><tr>
                <th>Product</th>
                <th className="text-end">Total Units</th>
                <th className="text-end">Affiliate Units</th>
                <th className="text-end">Total GMV</th>
                <th className="text-end">Videos</th>
                <th>Listing Quality</th>
              </tr></thead>
              <tbody>
                {c.product_highlights.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <div className="fw-semibold">{r.product_name || '—'}</div>
                      {r.product_id && <small className="text-muted">{r.product_id}</small>}
                    </td>
                    <td className="text-end">{r.total_units_sold}</td>
                    <td className="text-end">{r.affiliate_units_sold}</td>
                    <td className="text-end">${r.total_gmv.toLocaleString()}</td>
                    <td className="text-end">{r.videos_posted}</td>
                    <td><QualityBadge q={r.listing_quality} /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
      {renderCustomAt('product_highlights')}

      {/* Shop Health */}
      <Card className="mb-3" data-section="shop_health">
        <Card.Header><SectionHeader title="Shop Health" section="shop_health" /></Card.Header>
        <Card.Body>
          <Row className="g-3">
            <RatingCell label="Shop Performance" value={sh.shop_performance_score} />
            <RatingCell label="Product Satisfaction" value={sh.product_satisfaction_rating} />
            <RatingCell label="Fulfillment" value={sh.fulfillment_rating} />
            <RatingCell label="Customer Service" value={sh.customer_service_rating} />
            <StatusCell label="Dispatching on time" value={sh.dispatching_on_time} />
            <StatusCell label="Replying within 24h" value={sh.replying_within_24h} />
            <FlagCell label="Warnings this week" on={sh.warnings_received} />
            <FlagCell label="Violations this week" on={sh.violations_received} />
          </Row>
        </Card.Body>
      </Card>
      {renderCustomAt('shop_health')}

      {/* Insights */}
      {c.insights.summary && c.insights.summary.replace(/<[^>]*>/g,'').trim().length > 0 && (
        <Card className="mb-3" data-section="insights">
          <Card.Header><SectionHeader title="Insights" section="insights" /></Card.Header>
          <Card.Body>
            <div className="ac-rte-view" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(c.insights.summary) }} />
          </Card.Body>
        </Card>
      )}
      {renderCustomAt('insights')}

      {/* Custom Sections */}
    </div>
  );
}

function CustomSectionView({ section, feedbackSlot }: { section: CustomSection; feedbackSlot?: React.ReactNode }) {
  const isTable = section.is_repeater;
  const hasContent = isTable ? (section.fields.length > 0) : (section.body && section.body.replace(/<[^>]*>/g, '').trim().length > 0);
  if (!hasContent) return null;
  return (
    <Card className="mb-3" data-section={`cs:${section.id}`}>
      <Card.Header className="d-flex justify-content-between align-items-center">
        <span className="fw-semibold">{section.name || 'Custom Section'}</span>
        {feedbackSlot}
      </Card.Header>
      <Card.Body>
        {section.description && <p className="text-muted small mb-3">{section.description}</p>}
        {isTable ? (
          section.rows.length === 0 ? <p className="text-muted small mb-0">No data</p> : (
            <Table size="sm" responsive className="mb-0 align-middle">
              <thead><tr>{section.fields.map(f => <th key={f.id}>{f.label}</th>)}</tr></thead>
              <tbody>
                {section.rows.map((row, i) => (
                  <tr key={i}>
                    {section.fields.map(f => <td key={f.id}>{renderValue(f, row[f.id])}</td>)}
                  </tr>
                ))}
              </tbody>
            </Table>
          )
        ) : (
          <div className="ac-rte-view" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(section.body) }} />
        )}
      </Card.Body>
    </Card>
  );
}

function renderValue(field: CustomField, value: any) {
  if (value == null || value === '') return <span className="text-muted">—</span>;
  switch (field.type) {
    case 'number': return Number(value).toLocaleString();
    case 'url':    return <a href={String(value)} target="_blank" rel="noreferrer">{String(value)}</a>;
    case 'richtext':
    case 'textarea': return <div className="ac-rte-view" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(String(value)) }} />;
    case 'date': return new Date(String(value)).toLocaleDateString();
    default: return String(value);
  }
}

function VideosTable({ rows }: { rows: WeeklyReportContent['top_videos'] }) {
  if (!rows || rows.length === 0) return <p className="text-muted text-center py-3 mb-0 small">No data</p>;
  return (
    <Table size="sm" className="mb-0 align-middle">
      <thead><tr>
        <th>Creator</th><th className="text-end">Items sold</th><th className="text-end">GMV</th>
      </tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td className="fw-semibold">
              {r.video_url ? <a href={r.video_url} target="_blank" rel="noreferrer">{r.creator_name}</a> : r.creator_name}
            </td>
            <td className="text-end">{r.items_sold}</td>
            <td className="text-end">${r.gmv.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function tiktokLink(handle: string): string {
  const clean = handle.trim().replace(/^@+/, '').replace(/\s+/g, '');
  return `https://www.tiktok.com/@${encodeURIComponent(clean)}`;
}

function spsColor(v: number) {
  if (v >= 4.5) return '#10b981';   // success
  if (v >= 3.5) return '#e8862e';   // brand orange (afflixmedia.com)
  if (v > 0)    return '#ef4444';   // warning
  return '#cbd5e1';
}

function KpiCard({ label, value, prev, cur, money, dec, sub }: {
  label: string; value: string; prev?: number; cur: number;
  money?: boolean; dec?: boolean; sub?: string;
}) {
  return (
    <Col md={4} lg={2}>
      <Card className="h-100 shadow-sm" style={{ borderLeft: '4px solid #e8862e' }}>
        <Card.Body className="py-3">
          <div className="ac-label">{label}</div>
          <div className="fs-4 fw-bold mt-1">{value}</div>
          <Delta cur={cur} prev={prev} money={money} dec={dec} />
          {sub && <small className="text-muted d-block mt-1">{sub}</small>}
        </Card.Body>
      </Card>
    </Col>
  );
}

function MiniStat({ label, cur, prev, money, dec, suffix }: {
  label: string; cur: number; prev?: number; money?: boolean; dec?: boolean; suffix?: string;
}) {
  const fmt = (n: number) =>
    money ? `$${n.toLocaleString()}`
    : dec ? n.toFixed(2)
    : suffix ? `${n.toFixed(2)}${suffix}`
    : n.toLocaleString();
  return (
    <Col md={3}>
      <div className="p-3 rounded" style={{ background: '#f8fafc', border: '1px solid #e5e7eb' }}>
        <div className="ac-label">{label}</div>
        <div className="fs-5 fw-semibold mt-1">{fmt(cur)}</div>
        <Delta cur={cur} prev={prev} money={money} dec={dec} />
      </div>
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

function QualityBadge({ q }: { q: ListingQuality }) {
  if (!q) return <span className="text-muted small">—</span>;
  const map: Record<string, { bg: string; label: string }> = {
    excellent: { bg: 'success',  label: 'Excellent' },
    good:      { bg: 'success',  label: 'Good' },
    fair:      { bg: 'warning',  label: 'Fair' },
    poor:      { bg: 'danger',   label: 'Poor' },
  };
  const m = map[q];
  return <Badge bg={m.bg} text={m.bg === 'warning' ? 'dark' : undefined}>{m.label}</Badge>;
}

function RatingCell({ label, value }: { label: string; value: number | null }) {
  return (
    <Col md={3}>
      <div className="p-3 rounded h-100" style={{ background: '#f8fafc', border: '1px solid #e5e7eb' }}>
        <div className="ac-mini-label">{label}</div>
        {value == null
          ? <div className="text-muted small mt-1">Not yet rated</div>
          : <div className="fs-4 fw-bold mt-1" style={{ color: spsColor(value) }}>{value.toFixed(1)}<small className="text-muted fs-6 ms-1">/5</small></div>}
      </div>
    </Col>
  );
}

function StatusCell({ label, value }: { label: string; value: 'yes' | 'no' | 'not_rated' }) {
  const map = {
    yes: { bg: 'success', text: 'Yes', icon: 'bi-check-circle' },
    no:  { bg: 'danger',  text: 'No',  icon: 'bi-x-circle' },
    not_rated: { bg: 'secondary', text: 'Not rated', icon: 'bi-dash-circle' },
  };
  const m = map[value];
  return (
    <Col md={3}>
      <div className="p-3 rounded h-100" style={{ background: '#f8fafc', border: '1px solid #e5e7eb' }}>
        <div className="ac-mini-label">{label}</div>
        <div className="mt-1">
          <Badge bg={m.bg} className="fs-6"><i className={`bi ${m.icon} me-1`} />{m.text}</Badge>
        </div>
      </div>
    </Col>
  );
}

function FlagCell({ label, on }: { label: string; on: boolean }) {
  return (
    <Col md={3}>
      <div className="p-3 rounded h-100" style={{ background: '#f8fafc', border: '1px solid #e5e7eb' }}>
        <div className="ac-mini-label">{label}</div>
        <div className="mt-1">
          <Badge bg={on ? 'danger' : 'success'} className="fs-6">
            <i className={`bi ${on ? 'bi-exclamation-triangle' : 'bi-check-circle'} me-1`} />{on ? 'Yes' : 'No'}
          </Badge>
        </div>
      </div>
    </Col>
  );
}
