import { useEffect, useState } from 'react';
import { Card, Row, Col, Table, Alert, Badge, Offcanvas, Button, Form } from 'react-bootstrap';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import {
  WeeklyReportContentV3, WEEKLY_SECTIONS_V3, SECTION_BY_ID_V3, SectionDefV3, SectionField,
  ScalarData, RowData, fieldValue, formatValue,
} from '../lib/reportSchemaV3';
import { sanitizeRich } from '../lib/sanitize';
import DashSidebar, { DashNavItem } from './report/DashSidebar';
import SectionComments, { Comment, CommentSection } from './SectionComments';
// Reuse the v2 custom-section renderer (identical CustomSection model) + the
// shared prop-shape interfaces so the view / share pages hand the same objects
// to whichever renderer they pick.
import { CustomSectionView } from './ReportDashboardV2';
import type { TrendPoint, CommentsConfig, ApprovalDecisionView, ApprovalActionConfig } from './ReportDashboardV2';

// Sections the client sees on the shared report (staff see everything). The
// internal GMV Max ad-spend, product-traffic and raw traffic-analysis sections
// stay staff-only. (Provisional — the client layout can be refined later.)
const CLIENT_SECTIONS = new Set<string>([
  'overall', 'product_analytics', 'channel_analytics', 'offsite',
  'affiliate', 'top_creators', 'top_videos', 'top_lives',
]);

// Headline scorecard shown at the top for everyone: [sectionId, fieldKey].
const HERO_FIELDS: [string, string][] = [
  ['overall', 'total_gmv'], ['overall', 'orders'], ['overall', 'live_gmv'],
  ['overall', 'video_gmv'], ['affiliate', 'affiliate_gmv'],
  ['sampling', 'samples_approved'], ['sampling', 'new_videos_posted'],
  ['overall', 'shop_performance_score'],
];

const NAV_ICON: Record<string, string> = {
  overview: 'bi-grid-1x2-fill', overall: 'bi-graph-up-arrow', product_analytics: 'bi-box-seam',
  channel_analytics: 'bi-collection-play-fill', offsite: 'bi-box-arrow-up-right',
  affiliate: 'bi-people-fill', top_creators: 'bi-trophy-fill', top_videos: 'bi-play-btn-fill',
  top_lives: 'bi-broadcast',
};

export default function ReportDashboardV3({
  c, p, trendData, hasPrev, commentsConfig, openSectionOnLoad, highlightCommentId,
  approvalDecisions, approvalAction, audience = 'staff', reportMeta,
}: {
  c: WeeklyReportContentV3;
  p: WeeklyReportContentV3 | null;
  trendData: TrendPoint[];
  hasPrev: boolean;
  reportMeta?: { title: string; period: string; compare?: string };
  commentsConfig?: CommentsConfig;
  openSectionOnLoad?: CommentSection | null;
  highlightCommentId?: string | null;
  approvalDecisions?: ApprovalDecisionView[];
  approvalAction?: ApprovalActionConfig;
  audience?: 'staff' | 'client';
}) {
  const isClient = audience === 'client';
  const [feedbackSection, setFeedbackSection] = useState<CommentSection | null>(null);
  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('ac_dash_nav') === '1'; } catch { return false; }
  });
  const toggleNav = () => setNavCollapsed(v => {
    const n = !v; try { localStorage.setItem('ac_dash_nav', n ? '1' : '0'); } catch { /* ignore */ }
    return n;
  });

  const sectionHasData = (def: SectionDefV3): boolean => {
    const data = (c as any)[def.id];
    if (def.kind === 'scalar') return def.fields.some(f => !f.auto && (data?.[f.key] != null));
    return Array.isArray(data) && data.length > 0;
  };

  const clientSections = WEEKLY_SECTIONS_V3.filter(d => CLIENT_SECTIONS.has(d.id));
  const navItems: DashNavItem[] = [{ id: 'overview', label: 'Overview', icon: NAV_ICON.overview }];
  for (const d of clientSections) {
    if (sectionHasData(d)) navItems.push({ id: d.id, label: d.title.split(' — ')[0], icon: NAV_ICON[d.id] ?? 'bi-dot' });
  }
  const insightsText = c.insights?.summary?.replace(/<[^>]*>/g, '').trim();
  if (insightsText) navItems.push({ id: 'insights', label: 'Insights', icon: 'bi-lightbulb-fill' });
  if (c.approval?.enabled) navItems.push({ id: 'approval', label: 'Approval', icon: 'bi-shield-check' });

  useEffect(() => {
    if (!openSectionOnLoad) return;
    setFeedbackSection(openSectionOnLoad);
    setTimeout(() => {
      const el = document.querySelector(`[data-section="${CSS.escape(openSectionOnLoad)}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, [openSectionOnLoad]);

  const sectionFeedbackCount = (section: CommentSection) =>
    (commentsConfig?.comments ?? []).filter(x => x.section === section).length;

  const customSectionFor = (section: CommentSection) => {
    if (!section.startsWith('cs:')) return null;
    const csid = section.slice(3);
    return (c.custom_sections ?? []).find(s => s.id === csid) ?? null;
  };
  const labelFor = (section: CommentSection): string => {
    const cs = customSectionFor(section);
    if (cs) return cs.name || 'Custom Section';
    if (section === 'approval') return 'Approval Needed / Action Items';
    if (section === 'insights') return 'Insights';
    const def = SECTION_BY_ID_V3[section];
    return def ? `${def.num}. ${def.title}` : section;
  };

  // Custom sections are anchored after a standard section id (or 'start' /
  // 'insights'); staff see them, the client share view hides them.
  const renderCustomAt = (anchor: string) =>
    isClient ? null : (c.custom_sections ?? []).filter(s => s.insert_after === anchor).map(s => (
      <CustomSectionView
        key={s.id}
        section={s}
        prevSection={(p?.custom_sections ?? []).find(ps => ps.id === s.id) ?? null}
        feedbackSlot={<FeedbackIcon section={`cs:${s.id}` as CommentSection} />}
      />
    ));

  const FeedbackIcon = ({ section }: { section: CommentSection }) => {
    if (!commentsConfig) return null;
    const n = sectionFeedbackCount(section);
    if (commentsConfig.mode === 'authed' && n === 0 && section !== 'approval') return null;
    const isPublicApproval = commentsConfig.mode === 'public' && section === 'approval';
    if (isPublicApproval) {
      return (
        <Button size="sm" className="ms-2 fw-semibold"
          style={{ backgroundColor: '#fff', color: '#0d6efd', borderColor: '#0d6efd', whiteSpace: 'nowrap' }}
          onClick={() => setFeedbackSection(section)} title="Open the conversation thread">
          <i className="bi bi-chat-left-text me-1" />{n > 0 ? `Thread (${n})` : 'Open thread'}
        </Button>
      );
    }
    return (
      <Button size="sm" variant="outline-primary" className="ms-2 d-inline-flex align-items-center gap-1"
        onClick={() => setFeedbackSection(section)}
        title={commentsConfig.mode === 'authed' ? 'View / add staff notes' : 'View / add comments'}>
        <i className="bi bi-chat-left-text" />{n > 0 && <Badge bg="primary" pill>{n}</Badge>}
      </Button>
    );
  };

  const SectionCard = ({ def, children }: { def: SectionDefV3; children: React.ReactNode }) => (
    <Card className="mb-3" data-section={def.id}>
      <Card.Header>
        <div className="d-flex justify-content-between align-items-center w-100">
          <span className="fw-semibold"><span className="text-muted me-1">{def.num}.</span>{def.title}</span>
          <FeedbackIcon section={def.id as CommentSection} />
        </div>
      </Card.Header>
      <Card.Body>
        {def.blurb && <p className="text-muted small mb-3">{def.blurb}</p>}
        {children}
      </Card.Body>
    </Card>
  );

  // ---- headline scorecard ---------------------------------------------------
  const HeroBlock = () => (
    <div data-section="overview" className="s14-section">
      <div className="s14-title">
        <span className="s14-title-accent" style={{ background: '#e8862e' }} />
        <div className="flex-grow-1">
          <div className="s14-title-text">This Week at a Glance</div>
          <div className="s14-title-sub">{hasPrev ? 'Headline numbers vs the previous week' : 'Headline numbers'}</div>
        </div>
      </div>
      <div className="ac-bento">
        {HERO_FIELDS.map(([sid, key]) => {
          const def = SECTION_BY_ID_V3[sid];
          const f = def?.fields.find(x => x.key === key);
          if (!f) return null;
          const cur = fieldValue(f, (c as any)[sid]);
          const prev = p ? fieldValue(f, (p as any)[sid]) : null;
          return <KpiTile key={`${sid}.${key}`} label={f.label} value={formatValue(f.format, cur)} f={f} cur={cur} prev={prev} />;
        })}
      </div>
      {trendData.length > 1 && (
        <div className="s14-card mt-3">
          <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
            <div className="s14-kpi-label">GMV by week · last {trendData.length} weeks</div>
            <div className="d-flex gap-3">
              <span className="ac-legend-dot" style={{ '--c': '#e8862e' } as any}>GMV</span>
              <span className="ac-legend-dot" style={{ '--c': '#f5b06a' } as any}>Affiliate GMV</span>
            </div>
          </div>
          <div style={{ height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={trendData} margin={{ top: 10, right: 12, bottom: 4, left: 4 }} barGap={8} barCategoryGap="32%">
                <defs>
                  <linearGradient id="gmvBar3" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f2a35a" /><stop offset="100%" stopColor="#e8862e" />
                  </linearGradient>
                  <linearGradient id="affBar3" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ffd6ac" /><stop offset="100%" stopColor="#f5b06a" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#8a93a6' }} tickLine={false} axisLine={{ stroke: '#eadfd6' }} />
                <YAxis tick={{ fontSize: 12, fill: '#8a93a6' }} tickLine={false} axisLine={false} width={58} tickFormatter={(v: number) => formatValue('currency', v, { compact: true })} />
                <Tooltip cursor={{ fill: 'rgba(232,134,46,.07)' }}
                  contentStyle={{ borderRadius: 12, border: '1px solid #eef0f4', boxShadow: '0 10px 28px rgba(16,24,40,.12)', fontSize: 13 }}
                  formatter={(v: any, n: any) => [formatValue('currency', Number(v)), n]} />
                <Bar dataKey="GMV" fill="url(#gmvBar3)" radius={[8, 8, 0, 0]} maxBarSize={56} />
                <Bar dataKey="Affiliate GMV" fill="url(#affBar3)" radius={[8, 8, 0, 0]} maxBarSize={56} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );

  // ---- per-section renderer -------------------------------------------------
  const renderSection = (def: SectionDefV3) => {
    const data = (c as any)[def.id];
    const prev = p ? (p as any)[def.id] : null;

    // §6 Channel Analytics — Video vs LIVE attributed-GMV bars + table.
    if (def.id === 'channel_analytics') {
      const rows = (data as RowData[]) ?? [];
      const chart = rows.map(r => ({ channel: String(r.channel ?? ''), 'Attributed GMV': numv(r.attributed_gmv) }));
      const hasBars = chart.some(r => r['Attributed GMV'] > 0);
      return (
        <SectionCard def={def}>
          {hasBars && (
            <div style={{ height: 200 }} className="mb-3">
              <ResponsiveContainer>
                <BarChart data={chart} margin={{ top: 8, right: 16, bottom: 4, left: 4 }} barCategoryGap="40%">
                  <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="channel" tick={{ fontSize: 12, fill: '#8a93a6' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#8a93a6' }} width={58} tickLine={false} axisLine={false}
                    tickFormatter={(v: number) => formatValue('currency', v, { compact: true })} />
                  <Tooltip formatter={(v: any) => formatValue('currency', Number(v))} />
                  <Bar dataKey="Attributed GMV" fill="#e8862e" radius={[8, 8, 0, 0]} maxBarSize={72} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <DashTable def={def} rows={rows} prevRows={(prev as RowData[]) ?? []} matchKey="channel" />
        </SectionCard>
      );
    }

    if (def.kind === 'scalar') {
      return <SectionCard def={def}><StatGrid def={def} data={data} prev={prev} /></SectionCard>;
    }
    return (
      <SectionCard def={def}>
        <DashTable def={def} rows={(data as RowData[]) ?? []} prevRows={(prev as RowData[]) ?? []} matchKey={tableMatchKey(def)} />
      </SectionCard>
    );
  };

  const sectionsToRender = isClient ? clientSections : WEEKLY_SECTIONS_V3;

  return (
    <div className={isClient ? 'ac-themed dash-shell' : 'ac-themed'}>
      {isClient && <DashSidebar items={navItems} collapsed={navCollapsed} onToggle={toggleNav} />}
      <div className={isClient ? `dash-client ${navCollapsed ? 'nav-collapsed' : ''}` : ''}>
        {isClient && reportMeta && (
          <div className="dash-report-head ac-fade">
            <div>
              <h1 className="dash-report-title">{reportMeta.title}</h1>
              <div className="dash-report-period"><i className="bi bi-calendar3" />{reportMeta.period}</div>
            </div>
            {reportMeta.compare && (
              <div className="dash-report-pill"><i className="bi bi-arrow-left-right" />{reportMeta.compare}</div>
            )}
          </div>
        )}
        {!hasPrev && !isClient && <Alert variant="warning" className="py-2">No previous period — single-period view (no comparison).</Alert>}

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
                section={feedbackSection} sectionLabel={labelFor(feedbackSection)}
                comments={commentsConfig.comments} mode={commentsConfig.mode}
                currentAuthorName={commentsConfig.currentAuthorName} defaultPublicName={commentsConfig.defaultPublicName}
                onAdd={(b, n, parentId) => commentsConfig.onAdd(feedbackSection, b, n, parentId)}
                highlightCommentId={highlightCommentId ?? undefined}
              />
            )}
          </Offcanvas.Body>
        </Offcanvas>

        <HeroBlock />

        {renderCustomAt('start')}

        {sectionsToRender.map(def => (
          <div key={def.id}>
            {renderSection(def)}
            {renderCustomAt(def.id)}
          </div>
        ))}

        {/* Insights */}
        {c.insights.summary && c.insights.summary.replace(/<[^>]*>/g, '').trim().length > 0 && (
          <Card className="mb-3" data-section="insights">
            <Card.Header>
              <div className="d-flex justify-content-between align-items-center w-100">
                <span className="fw-semibold">Insights</span><FeedbackIcon section="insights" />
              </div>
            </Card.Header>
            <Card.Body>
              <div className="ac-rte-view" dangerouslySetInnerHTML={{ __html: sanitizeRich(c.insights.summary) }} />
            </Card.Body>
          </Card>
        )}
        {renderCustomAt('insights')}

        {/* Approval Needed */}
        {c.approval?.enabled && (() => {
          const expiresAt = c.approval?.expires_at ?? null;
          const expired = !!expiresAt && new Date(expiresAt).getTime() < Date.now();
          return (
            <Card className="mb-3" data-section="approval" border="warning">
              <Card.Header className="d-flex justify-content-between align-items-center" style={{ background: '#fff8ef' }}>
                <span className="fw-semibold">
                  <i className="bi bi-shield-check me-2 text-warning" />Approval Needed / Action Items
                  {expired && <Badge bg="secondary" className="ms-2"><i className="bi bi-clock-history me-1" />Auto-popup expired</Badge>}
                </span>
                <div className="d-flex align-items-center gap-2">
                  {approvalDecisions && approvalDecisions.length > 0 && (
                    <Badge bg="success" pill>{approvalDecisions.length} decision{approvalDecisions.length === 1 ? '' : 's'}</Badge>
                  )}
                  <FeedbackIcon section="approval" />
                </div>
              </Card.Header>
              <Card.Body>
                <div className="ac-rte-view ac-approval-content" dangerouslySetInnerHTML={{ __html: sanitizeRich(c.approval.content) }} />
                {commentsConfig?.mode === 'public' && approvalAction && <ApprovalActionInline action={approvalAction} />}
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
          );
        })()}
      </div>
    </div>
  );
}

// ===== shared little pieces ==================================================

function numv(v: any): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function tableMatchKey(def: SectionDefV3): string | undefined {
  if (def.fields.some(f => f.key === 'product_id')) return 'product_id';
  if (def.fields.some(f => f.key === 'channel')) return 'channel';
  if (def.fields.some(f => f.key === 'username')) return 'username';
  if (def.fields.some(f => f.key === 'live_id')) return 'live_id';
  return undefined;
}

function StatGrid({ def, data, prev, cols }: {
  def: SectionDefV3; data: ScalarData; prev: ScalarData | null; cols?: number;
}) {
  return (
    <Row className="g-3">
      {def.fields.map(f => {
        if (f.format === 'bool') return null;
        const cur = fieldValue(f, data);
        const pv = prev ? fieldValue(f, prev) : null;
        return (
          <Col md={cols ?? f.col ?? 3} key={f.key}>
            <KpiTile label={f.label} value={formatValue(f.format, cur)} f={f} cur={cur} prev={pv} />
          </Col>
        );
      })}
    </Row>
  );
}

function DashTable({ def, rows, prevRows, matchKey }: {
  def: SectionDefV3; rows: RowData[]; prevRows?: RowData[]; matchKey?: string;
}) {
  if (!rows || rows.length === 0) return <p className="text-muted text-center py-3 mb-0 small">No rows.</p>;
  const findPrev = (row: RowData): RowData | undefined =>
    matchKey && prevRows ? prevRows.find(r => String(r[matchKey] ?? '') !== '' && r[matchKey] === row[matchKey]) : undefined;
  return (
    <Table responsive className="mb-0 align-middle dash-table">
      <thead><tr>
        {def.fields.map(f => (
          <th key={f.key} className={isTextCol(f) ? '' : 'text-end'} style={{ whiteSpace: 'nowrap' }}>{f.label}</th>
        ))}
      </tr></thead>
      <tbody>
        {rows.map((row, i) => {
          const prev = findPrev(row);
          return (
            <tr key={i}>
              {def.fields.map(f => (
                <td key={f.key} className={isTextCol(f) ? '' : 'text-end'} style={{ whiteSpace: 'nowrap' }}>
                  <Cellv f={f} row={row} prev={prev} />
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function isTextCol(f: SectionField) { return f.format === 'text' || f.format === 'url'; }

function Cellv({ f, row, prev }: { f: SectionField; row: RowData; prev?: RowData }) {
  if (f.format === 'url') {
    const v = String(row[f.key] ?? '');
    return v ? <a href={v} target="_blank" rel="noreferrer">link</a> : <span className="text-muted">—</span>;
  }
  if (f.format === 'text') {
    const v = String(row[f.key] ?? '');
    return v ? <span className="fw-semibold">{v}</span> : <span className="text-muted">—</span>;
  }
  const cur = fieldValue(f, row);
  const pv = prev ? fieldValue(f, prev) : null;
  return (
    <>
      <div>{formatValue(f.format, cur)}</div>
      {f.comparable !== false && <DeltaV f={f} cur={cur} prev={pv} inline />}
    </>
  );
}

function fmtPct(pct: number): string {
  const a = Math.abs(pct);
  const body = a >= 1000 ? `${(a / 1000).toFixed(1).replace(/\.0$/, '')}k` : a.toFixed(1);
  return pct < 0 ? `-${body}` : body;
}

function DeltaV({ f, cur, prev, inline }: {
  f: SectionField; cur: number | null; prev: number | null; inline?: boolean;
}) {
  if (cur == null || prev == null) {
    return inline ? null : <small className="text-muted">—</small>;
  }
  const diff = cur - prev;
  if (diff === 0) return inline ? <small className="text-muted">±0</small> : <small className="text-muted">no change</small>;
  const pct = prev === 0 ? 100 : (diff / Math.abs(prev)) * 100;
  const good = f.lowerIsBetter ? diff < 0 : diff > 0;
  const color = good ? 'text-success' : 'text-danger';
  const icon = diff >= 0 ? 'bi-arrow-up-right' : 'bi-arrow-down-right';
  const abs = formatValue(f.format === 'percent' || f.format === 'ratio' ? 'decimal' : f.format, Math.abs(diff));
  const newBadge = prev === 0;
  return (
    <small className={`${color} ${inline ? 'd-block' : ''}`} title={`${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`}>
      <i className={`bi ${icon}`} /> {abs}{newBadge ? ' (new)' : ` (${pct >= 0 ? '+' : ''}${fmtPct(pct)}%)`}
    </small>
  );
}

function DeltaPill({ f, cur, prev }: { f: SectionField; cur: number | null; prev: number | null }) {
  if (cur == null || prev == null) return null;
  const diff = cur - prev;
  if (diff === 0) return <span className="ac-pill ac-pill-flat">±0%</span>;
  const pct = prev === 0 ? 100 : (diff / Math.abs(prev)) * 100;
  const good = f.lowerIsBetter ? diff < 0 : diff > 0;
  return (
    <span className={`ac-pill ${good ? 'ac-pill-up' : 'ac-pill-down'}`} title={`${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`}>
      <i className={`bi ${diff >= 0 ? 'bi-arrow-up-short' : 'bi-arrow-down-short'}`} />
      {prev === 0 ? 'new' : `${pct >= 0 ? '+' : ''}${fmtPct(pct)}%`}
    </span>
  );
}

function KpiTile({ label, value, f, cur, prev }: {
  label: string; value: string; f: SectionField; cur: number | null; prev: number | null;
}) {
  return (
    <div className="ac-kpi h-100">
      <div className="ac-kpi-label">{label}</div>
      <div className="ac-kpi-value">{value}</div>
      <div className="ac-kpi-foot"><DeltaPill f={f} cur={cur} prev={prev} /></div>
    </div>
  );
}

// ===== Approval inline form (client share view) =============================
function ApprovalActionInline({ action }: { action: ApprovalActionConfig }) {
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
    try { await onSubmit(choice, comment.trim(), name.trim()); setJustSaved(true); }
    catch (e: any) { setErr(e?.message ?? 'Failed to submit'); }
    finally { setSubmitting(false); }
  };

  if (myDecision) {
    return (
      <div className="mt-4 pt-3 border-top">
        <Alert variant={myDecision.decision === 'approved' ? 'success' : 'warning'} className="py-2 mb-3">
          <div className="d-flex align-items-center gap-2 mb-1">
            <i className={`bi ${myDecision.decision === 'approved' ? 'bi-check-circle-fill' : 'bi-arrow-repeat'}`} />
            <strong>You {myDecision.decision === 'approved' ? 'approved' : 'requested changes on'} this report.</strong>
          </div>
          <div className="small">Recorded by <strong>{myDecision.decided_by_name}</strong> on {new Date(myDecision.decided_at).toLocaleString()}.</div>
          {myDecision.comment && (
            <blockquote className="mb-0 mt-2 small ps-2" style={{ borderLeft: '3px solid rgba(0,0,0,.15)', whiteSpace: 'pre-wrap' }}>{myDecision.comment}</blockquote>
          )}
        </Alert>
      </div>
    );
  }

  return (
    <div className="mt-4 pt-3 border-top">
      <div className="fw-semibold small text-uppercase text-muted mb-2" style={{ letterSpacing: '.5px' }}>Submit your decision</div>
      {err && <Alert variant="danger" className="py-2 small mb-2">{err}</Alert>}
      {justSaved && !err && <Alert variant="success" className="py-2 small mb-2">Saved. Thank you.</Alert>}
      <Form.Group className="mb-2">
        <Form.Label className="small mb-1">Your name</Form.Label>
        <Form.Control size="sm" value={name} onChange={e => setName(e.target.value)} disabled={submitting} />
      </Form.Group>
      <div className="d-flex gap-2 flex-wrap mb-2">
        <Button size="sm" variant={choice === 'approved' ? 'success' : 'outline-success'} onClick={() => setChoice('approved')} disabled={submitting}>
          <i className="bi bi-check-circle me-1" /> Approve
        </Button>
        <Button size="sm" variant={choice === 'changes_requested' ? 'warning' : 'outline-warning'} onClick={() => setChoice('changes_requested')} disabled={submitting}>
          <i className="bi bi-arrow-repeat me-1" /> Request changes
        </Button>
      </div>
      <Form.Control as="textarea" rows={2}
        placeholder="Comment (optional) — your decision is final once submitted, but the thread stays open."
        value={comment} onChange={e => setComment(e.target.value)} disabled={submitting} />
      <div className="d-flex justify-content-end mt-2">
        <Button size="sm" onClick={submit} disabled={submitting || !choice || !name.trim()}>{submitting ? 'Submitting…' : 'Submit decision'}</Button>
      </div>
    </div>
  );
}
