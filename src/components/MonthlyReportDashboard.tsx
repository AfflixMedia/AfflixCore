import { useEffect, useState } from 'react';
import { Card, Row, Col, Table, Badge, Offcanvas, Button, Form, Alert } from 'react-bootstrap';
import DOMPurify from 'dompurify';
import { MonthlyReportContent, ThisLast } from '../lib/monthlyReportSchema';
import SectionComments, { Comment, CommentSection } from './SectionComments';
import { CommentsConfig, ApprovalDecisionView, ApprovalActionConfig } from './ReportDashboard';

const SECTION_LABELS: Record<string, string> = {
  total_sales: 'Total Sales',
  kpis: "KPI's",
  gmv_breakdown: 'GMV Breakdown',
  top_creators: 'Top Creators',
  top_videos: 'Top Videos',
  video_performance: 'Video Performance',
  creators_performance: 'Creators Performance',
  product_analytics: 'Product Analytics',
  customers: 'Customers',
  strategy_insights: 'Strategy & Insights',
  discounting: 'Discounting',
  gmv_max_ads: 'GMV Max Ads',
  paid_collabs: 'Paid Collabs',
  ai_content: 'AI Content',
  strategy_moving_forward: 'Strategy Moving Forward',
  approval: 'Approval Needed',
};

export default function MonthlyReportDashboard({
  c, monthLabel, brandName, clientName, commentsConfig, approvalAction, approvalDecisions,
  openSectionOnLoad, highlightCommentId,
}: {
  c: MonthlyReportContent;
  monthLabel: string;
  brandName: string;
  clientName?: string | null;
  commentsConfig?: CommentsConfig;
  approvalAction?: ApprovalActionConfig;
  approvalDecisions?: ApprovalDecisionView[];
  openSectionOnLoad?: CommentSection | null;
  highlightCommentId?: string | null;
}) {
  const [feedbackSection, setFeedbackSection] = useState<CommentSection | null>(null);

  useEffect(() => {
    if (!openSectionOnLoad) return;
    setFeedbackSection(openSectionOnLoad);
    setTimeout(() => {
      const el = document.querySelector(`[data-section="${CSS.escape(openSectionOnLoad)}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, [openSectionOnLoad]);

  const sectionFeedbackCount = (s: CommentSection) =>
    (commentsConfig?.comments ?? []).filter(c => c.section === s).length;

  const labelFor = (s: CommentSection): string => {
    if (s.startsWith('cs:')) {
      const id = s.slice(3);
      const cs = c.custom_sections.find(x => x.id === id);
      return cs?.name || 'Custom Section';
    }
    return SECTION_LABELS[s] ?? s;
  };

  const FeedbackIcon = ({ section }: { section: CommentSection }) => {
    if (!commentsConfig) return null;
    const n = sectionFeedbackCount(section);
    if (commentsConfig.mode === 'authed' && n === 0 && section !== 'approval') return null;
    return (
      <Button size="sm" variant="outline-primary" className="ms-2 d-inline-flex align-items-center gap-1"
        onClick={() => setFeedbackSection(section)}
        title={commentsConfig.mode === 'authed' ? 'View / add staff notes' : 'View / add comments'}>
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

  const renderCustomAt = (anchor: string) =>
    c.custom_sections.filter(s => (s.insert_after as unknown as string) === anchor).map(s => (
      <Card className="mb-3" data-section={`cs:${s.id}`} key={s.id}>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <span className="fw-semibold">{s.name || 'Custom Section'}</span>
          <FeedbackIcon section={`cs:${s.id}`} />
        </Card.Header>
        <Card.Body>
          {s.description && <p className="text-muted small mb-3">{s.description}</p>}
          {s.is_repeater ? (
            s.rows.length === 0 ? <p className="text-muted small mb-0">No data</p> : (
              <Table size="sm" responsive className="mb-0 align-middle">
                <thead><tr>{s.fields.map(f => <th key={f.id}>{f.label}</th>)}</tr></thead>
                <tbody>
                  {s.rows.map((row, i) => (
                    <tr key={i}>{s.fields.map(f => <td key={f.id}>{String(row[f.id] ?? '—')}</td>)}</tr>
                  ))}
                </tbody>
              </Table>
            )
          ) : (
            <div className="ac-rte-view" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(s.body) }} />
          )}
        </Card.Body>
      </Card>
    ));

  return (
    <div className="ac-themed">
      <div className="d-flex align-items-start gap-3 mb-4 flex-wrap">
        <div className="flex-grow-1 min-w-0">
          {clientName && <div className="text-muted small">{clientName}</div>}
          <h2 className="mb-1">{brandName} <span className="text-muted fs-6">— {monthLabel}</span></h2>
        </div>
      </div>

      <Offcanvas show={!!feedbackSection} onHide={() => setFeedbackSection(null)} placement="end" style={{ width: 480 }}>
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>
            <i className="bi bi-chat-left-text me-2" />
            {commentsConfig?.mode === 'authed' ? 'Notes / feedback' : 'Comments'}
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

      {renderCustomAt('start')}

      {/* Total Sales */}
      <Card className="mb-3" data-section="total_sales">
        <Card.Header><SectionHeader title="Total Sales" section="total_sales" /></Card.Header>
        <Card.Body>
          <ul className="mb-2">
            <li><strong>MONTH:</strong> ${c.total_sales.month.toLocaleString()}</li>
            <li><strong>All time:</strong> ${c.total_sales.all_time.toLocaleString()}{c.total_sales.all_time_period_label ? ` → ${c.total_sales.all_time_period_label}` : ''}</li>
          </ul>
          {c.total_sales.image_url && <ImageBlock url={c.total_sales.image_url} alt="Total Sales screenshot" />}
        </Card.Body>
      </Card>
      {renderCustomAt('total_sales')}

      <TLSection title="KPIs" anchor="kpis" SectionHeader={SectionHeader} headers={["Metric","This Month","Last Month"]} rows={[
        ['Samples Approved', c.kpis.samples_approved],
        ['New Affiliate Posts', c.kpis.new_affiliate_posts],
        ['Completed Collabs', c.kpis.completed_collabs],
        ['Content Pending', c.kpis.content_pending],
        ['Total Orders', c.kpis.total_orders],
      ]} />
      {renderCustomAt('kpis')}

      <TLSection title="GMV Breakdown" anchor="gmv_breakdown" SectionHeader={SectionHeader} money headers={["GMV","This Month","Last Month"]} rows={[
        ['Affiliate GMV', c.gmv_breakdown.affiliate_gmv],
        ['Organic GMV', c.gmv_breakdown.organic_gmv],
        ['LIVE GMV', c.gmv_breakdown.live_gmv],
        ['Video GMV', c.gmv_breakdown.video_gmv],
        ['Product Card GMV', c.gmv_breakdown.product_card_gmv],
      ]} />
      {renderCustomAt('gmv_breakdown')}

      {/* Top Creators */}
      <Card className="mb-3" data-section="top_creators">
        <Card.Header><SectionHeader title="Top Creators" section="top_creators" /></Card.Header>
        <Card.Body>
          <Row className="g-3">
            <Col lg={6}>
              <h6 className="text-muted small mb-2 text-uppercase" style={{ letterSpacing: '.5px' }}>This Month</h6>
              <CreatorsTable rows={c.top_creators_this} />
            </Col>
            <Col lg={6}>
              <h6 className="text-muted small mb-2 text-uppercase" style={{ letterSpacing: '.5px' }}>Last Month</h6>
              <CreatorsTable rows={c.top_creators_last} />
            </Col>
          </Row>
        </Card.Body>
      </Card>
      {renderCustomAt('top_creators')}

      {/* Top Videos */}
      <Card className="mb-3" data-section="top_videos">
        <Card.Header><SectionHeader title="Top Videos" section="top_videos" /></Card.Header>
        <Card.Body>
          <Row className="g-3">
            <Col lg={6}>
              <h6 className="text-muted small mb-2 text-uppercase" style={{ letterSpacing: '.5px' }}>This Month</h6>
              <VideosTable rows={c.top_videos_this} />
            </Col>
            <Col lg={6}>
              <h6 className="text-muted small mb-2 text-uppercase" style={{ letterSpacing: '.5px' }}>Last Month</h6>
              <VideosTable rows={c.top_videos_last} />
            </Col>
          </Row>
        </Card.Body>
      </Card>
      {renderCustomAt('top_videos')}

      <TLSection title="Video Performance" anchor="video_performance" SectionHeader={SectionHeader} headers={["Metric","This Month","Last Month"]} rows={[
        ['Product Impressions', c.video_performance.product_impressions],
        ['Product Clicks', c.video_performance.product_clicks],
        ['Video Views', c.video_performance.video_views],
        ['CTR', c.video_performance.ctr, '%'],
        ['CTOR', c.video_performance.ctor, '%'],
        ['SKU Orders', c.video_performance.sku_orders],
        ['GMV', c.video_performance.gmv, '$'],
        ['Videos with 1M+ Views', c.video_performance.videos_1m_views],
        ['Videos with 100k+ Views', c.video_performance.videos_100k_views],
        ['Videos with 10k+ Views', c.video_performance.videos_10k_views],
        ['Videos with $1000+ GMV', c.video_performance.videos_1k_gmv],
        ['Videos with $100+ GMV', c.video_performance.videos_100_gmv],
        ['No. of New Videos Posted', c.video_performance.new_videos_posted],
      ]} />
      {renderCustomAt('video_performance')}

      <TLSection title="Creators Performance" anchor="creators_performance" SectionHeader={SectionHeader} headers={["Metric","This Month","Last Month"]} rows={[
        ['Creators who posted 1+ videos', c.creators_performance.posted_1plus],
        ['Creators who posted 3+ videos', c.creators_performance.posted_3plus],
        ['Creators who posted 10+ videos', c.creators_performance.posted_10plus],
        ['Creators who generated $1k+ GMV', c.creators_performance.generated_1k_plus],
        ['Creators who generated $100+ GMV', c.creators_performance.generated_100_plus],
      ]} />
      {renderCustomAt('creators_performance')}

      {/* Product Analytics */}
      <Card className="mb-3" data-section="product_analytics">
        <Card.Header><SectionHeader title="Product Analytics" section="product_analytics" /></Card.Header>
        <Card.Body className="p-0">
          {c.product_analytics.length === 0 ? <p className="text-muted text-center py-3 mb-0 small">No products tracked.</p> : (
            <Table size="sm" responsive className="mb-0 align-middle">
              <thead><tr>
                <th>Product (ID + Name)</th>
                <th className="text-end">Units Sold</th>
                <th className="text-end">GMV</th>
                <th className="text-end">Samples Approved</th>
                <th>Notes</th>
              </tr></thead>
              <tbody>
                {c.product_analytics.map((r, i) => (
                  <tr key={i}>
                    <td>
                      {r.product_id && <div className="small text-muted" style={{ fontFamily: 'monospace' }}>{r.product_id}</div>}
                      <div className="fw-semibold">{r.product_name || '—'}</div>
                    </td>
                    <td className="text-end">{r.units_sold.toLocaleString()}</td>
                    <td className="text-end">${r.gmv.toLocaleString()}</td>
                    <td className="text-end">{r.samples_approved.toLocaleString()}</td>
                    <td className="small text-muted">{r.notes}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
      {renderCustomAt('product_analytics')}

      <TLSection title="Customers" anchor="customers" SectionHeader={SectionHeader} headers={["Metric","This Month","Last Month"]} rows={[
        ['Aware Customers', c.customers.aware_customers],
        ['New Customers', c.customers.new_customers],
        ['Potential New Customers', c.customers.potential_new_customers],
        ['Converted Customers', c.customers.converted_customers],
      ]} extraRows={[
        { label: 'CRM Messages Sent', this: c.customers.crm_messages_sent_this, last: c.customers.crm_messages_sent_last },
      ]} />
      {renderCustomAt('customers')}

      {/* Six rich-text + image sections */}
      {(['strategy_insights','discounting','gmv_max_ads','paid_collabs','ai_content','strategy_moving_forward'] as const).map(sec => {
        const v = c[sec];
        const empty = (!v.body || v.body.replace(/<[^>]*>/g, '').trim().length === 0) && !v.image_url;
        if (empty) return null;
        return (
          <div key={sec}>
            <Card className="mb-3" data-section={sec}>
              <Card.Header><SectionHeader title={SECTION_LABELS[sec]} section={sec} /></Card.Header>
              <Card.Body>
                {v.body && <div className="ac-rte-view" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(v.body) }} />}
                {v.image_url && <div className="mt-3"><ImageBlock url={v.image_url} alt={SECTION_LABELS[sec]} /></div>}
              </Card.Body>
            </Card>
            {renderCustomAt(sec)}
          </div>
        );
      })}

      {/* Approval Needed */}
      {c.approval?.enabled && (
        <Card className="mb-3" data-section="approval" border="warning">
          <Card.Header className="d-flex justify-content-between align-items-center" style={{ background: '#fff8ef' }}>
            <span className="fw-semibold">
              <i className="bi bi-shield-check me-2 text-warning" />
              Approval Needed
            </span>
            <div className="d-flex align-items-center gap-2">
              {approvalDecisions && approvalDecisions.length > 0 && (
                <Badge bg="success" pill>
                  {approvalDecisions.length} decision{approvalDecisions.length === 1 ? '' : 's'}
                </Badge>
              )}
              <FeedbackIcon section="approval" />
            </div>
          </Card.Header>
          <Card.Body>
            <div className="ac-rte-view ac-approval-content" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(c.approval.content) }} />
            {commentsConfig?.mode === 'public' && approvalAction && <PublicApprovalForm action={approvalAction} />}
            {commentsConfig?.mode === 'authed' && (
              <div className="mt-3">
                <h6 className="text-muted mb-2 small text-uppercase" style={{ letterSpacing: '.5px' }}>Client decisions</h6>
                {(!approvalDecisions || approvalDecisions.length === 0) ? (
                  <p className="text-muted small mb-0">No client has decided yet.</p>
                ) : (
                  <Table size="sm" className="mb-0 align-middle">
                    <thead><tr><th>Decision</th><th>Client</th><th>When</th><th>Comment</th></tr></thead>
                    <tbody>
                      {approvalDecisions.map(d => (
                        <tr key={d.id}>
                          <td>
                            <Badge bg={d.decision === 'approved' ? 'success' : 'warning'} text={d.decision === 'approved' ? undefined : 'dark'}>
                              <i className={`bi ${d.decision === 'approved' ? 'bi-check-circle' : 'bi-arrow-repeat'} me-1`} />
                              {d.decision === 'approved' ? 'Approved' : 'Changes requested'}
                            </Badge>
                          </td>
                          <td><div className="fw-semibold">{d.decided_by_name}</div>{d.share_link_label && <small className="text-muted">{d.share_link_label}</small>}</td>
                          <td className="text-muted small">{new Date(d.decided_at).toLocaleString()}</td>
                          <td className="small">{d.comment || <span className="text-muted">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </div>
            )}
          </Card.Body>
        </Card>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// helpers

function ImageBlock({ url, alt }: { url: string; alt: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="d-inline-block">
      <img src={url} alt={alt} style={{ maxWidth: '100%', maxHeight: 480, borderRadius: 8, border: '1px solid #e5e7eb' }} />
    </a>
  );
}

function CreatorsTable({ rows }: { rows: { username: string; gmv: number }[] }) {
  if (rows.length === 0) return <p className="text-muted small mb-0">No data</p>;
  return (
    <Table size="sm" className="mb-0 align-middle">
      <thead><tr><th>Username</th><th className="text-end">GMV Generated</th></tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={i}><td className="fw-semibold">{r.username || '—'}</td><td className="text-end">${r.gmv.toLocaleString()}</td></tr>
      ))}</tbody>
    </Table>
  );
}

function VideosTable({ rows }: { rows: { username: string; video_url: string; gmv: number }[] }) {
  if (rows.length === 0) return <p className="text-muted small mb-0">No data</p>;
  return (
    <Table size="sm" className="mb-0 align-middle">
      <thead><tr><th>Video</th><th className="text-end">GMV Generated</th></tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={i}>
          <td className="fw-semibold">
            {r.video_url ? <a href={r.video_url} target="_blank" rel="noreferrer">{r.username || r.video_url}</a> : (r.username || '—')}
          </td>
          <td className="text-end">${r.gmv.toLocaleString()}</td>
        </tr>
      ))}</tbody>
    </Table>
  );
}

function fmtTL(value: number, suffix?: string): string {
  if (suffix === '$') return `$${value.toLocaleString()}`;
  if (suffix === '%') return `${value.toFixed(2)}%`;
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toLocaleString();
}

function TLSection({
  title, anchor, SectionHeader, headers, rows, extraRows, money,
}: {
  title: string;
  anchor: string;
  SectionHeader: (props: { title: string; section: CommentSection }) => JSX.Element;
  headers: [string, string, string];
  rows: Array<[string, ThisLast] | [string, ThisLast, '$' | '%']>;
  extraRows?: { label: string; this: string; last: string }[];
  money?: boolean;
}) {
  return (
    <Card className="mb-3" data-section={anchor}>
      <Card.Header><SectionHeader title={title} section={anchor} /></Card.Header>
      <Card.Body className="p-0">
        <Table size="sm" responsive className="mb-0 align-middle">
          <thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map(([label, val, suf], i) => {
              const sfx = suf ?? (money ? '$' : undefined);
              return (
                <tr key={i}>
                  <td>{label}</td>
                  <td>{fmtTL(val.this, sfx)}</td>
                  <td>{fmtTL(val.last, sfx)}</td>
                </tr>
              );
            })}
            {extraRows?.map((r, i) => (
              <tr key={`e${i}`}>
                <td>{r.label}</td>
                <td>{r.this || <span className="text-muted">—</span>}</td>
                <td>{r.last || <span className="text-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card.Body>
    </Card>
  );
}

function PublicApprovalForm({ action }: { action: ApprovalActionConfig }) {
  const { myDecision, defaultName, onSubmit } = action;
  const [name, setName] = useState(defaultName);
  const [choice, setChoice] = useState<'approved' | 'changes_requested' | null>(myDecision?.decision ?? null);
  const [comment, setComment] = useState(myDecision?.comment ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    setChoice(myDecision?.decision ?? null);
    setComment(myDecision?.comment ?? '');
    setName(prev => prev || defaultName);
    setJustSaved(false);
  }, [myDecision, defaultName]);

  const submit = async () => {
    setErr(null);
    if (!choice) { setErr('Pick Approve or Request changes first.'); return; }
    if (!name.trim()) { setErr('Enter your name so we can credit your decision.'); return; }
    setSubmitting(true);
    try {
      await onSubmit(choice, comment.trim(), name.trim());
      setJustSaved(true);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-4 pt-3 border-top">
      {myDecision && (
        <Alert variant={myDecision.decision === 'approved' ? 'success' : 'warning'} className="py-2 small mb-3">
          <strong>Your previous decision:</strong>{' '}
          {myDecision.decision === 'approved' ? 'Approved' : 'Changes requested'}
          {' '}by {myDecision.decided_by_name} on {new Date(myDecision.decided_at).toLocaleDateString()}.
          {myDecision.comment && <div className="mt-1 fst-italic">"{myDecision.comment}"</div>}
        </Alert>
      )}
      <div className="fw-semibold small text-uppercase text-muted mb-2" style={{ letterSpacing: '.5px' }}>
        {myDecision ? 'Update your decision' : 'Submit your decision'}
      </div>
      {err && <Alert variant="danger" className="py-2 small mb-2">{err}</Alert>}
      {justSaved && !err && <Alert variant="success" className="py-2 small mb-2">Saved. Thank you.</Alert>}
      <Form.Group className="mb-2">
        <Form.Label className="small mb-1">Your name</Form.Label>
        <Form.Control size="sm" value={name} onChange={e => setName(e.target.value)} disabled={submitting} />
      </Form.Group>
      <div className="d-flex gap-2 flex-wrap mb-2">
        <Button size="sm" variant={choice === 'approved' ? 'success' : 'outline-success'}
          onClick={() => setChoice('approved')} disabled={submitting}>
          <i className="bi bi-check-circle me-1" /> Approve
        </Button>
        <Button size="sm" variant={choice === 'changes_requested' ? 'warning' : 'outline-warning'}
          onClick={() => setChoice('changes_requested')} disabled={submitting}>
          <i className="bi bi-arrow-repeat me-1" /> Request changes
        </Button>
      </div>
      <Form.Control as="textarea" rows={2} placeholder="Comment (optional)"
        value={comment} onChange={e => setComment(e.target.value)} disabled={submitting} />
      <div className="d-flex justify-content-end mt-2">
        <Button size="sm" onClick={submit} disabled={submitting || !choice || !name.trim()}>
          {submitting ? 'Submitting…' : myDecision ? 'Update decision' : 'Submit decision'}
        </Button>
      </div>
    </div>
  );
}
