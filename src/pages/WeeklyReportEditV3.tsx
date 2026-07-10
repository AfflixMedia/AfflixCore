import { useEffect, useState, FormEvent, Fragment } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, Form, Button, Spinner, Alert, Badge, Offcanvas } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { formatRange } from '../lib/dates';
import {
  WeeklyReportContentV3, emptyContentV3, normalizeContentV3, numOrNull,
  WEEKLY_SECTIONS_V3, SECTION_BY_ID_V3, SectionDefV3, emptyRow,
} from '../lib/reportSchemaV3';
import { ScalarSectionBodyV3, TableSectionBodyV3 } from '../components/report/SectionBodyV3';
import SectionComments, { Comment, CommentSection } from '../components/SectionComments';
import { useAuth } from '../auth/AuthContext';
import RichTextEditor from '../components/RichTextEditor';

interface ReportRow {
  id: string; brand_id: string; week_start: string; week_end: string;
  week_number: number; status: string; content: any;
}
interface Brand { id: string; name: string; client: string; client_status: string | null; }
type Msg = { kind: 'success' | 'warning' | 'danger'; text: string } | null;

export default function WeeklyReportEditV3() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { profile } = useAuth();
  const [report, setReport] = useState<ReportRow | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [c, setC] = useState<WeeklyReportContentV3>(emptyContentV3());
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [feedbackSection, setFeedbackSection] = useState<CommentSection | null>(null);

  // Auto-fetch UI state (one per AUTO section).
  const [fetchingSampling, setFetchingSampling] = useState(false);
  const [samplingMsg, setSamplingMsg] = useState<Msg>(null);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [productsMsg, setProductsMsg] = useState<Msg>(null);
  const [fetchingGmv, setFetchingGmv] = useState(false);
  const [gmvMsg, setGmvMsg] = useState<Msg>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('weekly_reports').select('*').eq('id', id).single();
      if (error) { setErr(error.message); setLoading(false); return; }
      const r = data as ReportRow;
      setReport(r);
      setC(normalizeContentV3(r.content));
      const { data: bd } = await supabase.from('brands').select('id,name,client,client_status').eq('id', r.brand_id).single();
      setBrand(bd as Brand);
      const { data: cm } = await supabase.from('report_comments')
        .select('*').eq('report_id', r.id).order('created_at', { ascending: true });
      setComments((cm as Comment[]) ?? []);
      setLoading(false);
    })();
  }, [id]);

  // ----- generic section setters --------------------------------------------
  const setSec = (sectionId: string, key: string, v: any) =>
    setC(prev => ({ ...prev, [sectionId]: { ...(prev as any)[sectionId], [key]: v } }));
  const addRow = (def: SectionDefV3) =>
    setC(prev => ({ ...prev, [def.id]: [...((prev as any)[def.id] as any[]), emptyRow(def)] }));
  const setCell = (sectionId: string, i: number, key: string, v: any) =>
    setC(prev => {
      const arr = [...((prev as any)[sectionId] as any[])];
      arr[i] = { ...arr[i], [key]: v };
      return { ...prev, [sectionId]: arr };
    });
  const delRow = (sectionId: string, i: number) =>
    setC(prev => {
      const arr = [...((prev as any)[sectionId] as any[])];
      arr.splice(i, 1);
      return { ...prev, [sectionId]: arr };
    });

  // ----- §1 Sampling & Videos — pull from the brand's Sample-Seeding page ----
  const fetchSamplingFromBrand = async () => {
    if (!report) return;
    setFetchingSampling(true); setSamplingMsg(null);
    const label = formatRange(report.week_start, report.week_end);
    const { data, error } = await supabase
      .from('brand_samples_daily')
      .select('entry_date,new_videos,others_count,product_counts')
      .eq('brand_id', report.brand_id)
      .gte('entry_date', report.week_start)
      .lte('entry_date', report.week_end);
    setFetchingSampling(false);
    if (error) { setSamplingMsg({ kind: 'danger', text: error.message }); return; }
    const rows = (data as any[]) ?? [];
    if (rows.length === 0) {
      setSamplingMsg({ kind: 'warning', text: `No Sample-Seeding entries for ${label} on this brand. Fill them on the brand's Sample Seeding tab, or enter the numbers manually.` });
      return;
    }
    const approved = rows.reduce((s, d) =>
      s + Object.values(d.product_counts ?? {}).reduce((a: number, v: any) => a + (Number(v) || 0), 0)
        + (Number(d.others_count) || 0), 0);
    const videos = rows.reduce((s, d) => s + (Number(d.new_videos) || 0), 0);
    setC(prev => ({ ...prev, sampling: { ...prev.sampling, samples_approved: approved, new_videos_posted: videos } }));
    setSamplingMsg({ kind: 'success', text: `Pulled ${approved} approved sample${approved === 1 ? '' : 's'} and ${videos} new video${videos === 1 ? '' : 's'} for ${label}. Don't forget to save.` });
  };

  // ----- §3 Product Analytics — load the brand's product catalogue into rows --
  const loadProductsIntoAnalytics = async () => {
    if (!report) return;
    setLoadingProducts(true); setProductsMsg(null);
    const { data, error } = await supabase
      .from('brand_products').select('id,name,external_product_id')
      .eq('brand_id', report.brand_id).order('name');
    setLoadingProducts(false);
    if (error) { setProductsMsg({ kind: 'danger', text: error.message }); return; }
    const prods = (data as any[]) ?? [];
    if (prods.length === 0) {
      setProductsMsg({ kind: 'warning', text: 'No products found for this brand. Add them on the brand’s Products tab, or add rows manually.' });
      return;
    }
    setC(prev => {
      // Preserve any metrics already typed, matched by product name.
      const existing = new Map((prev.product_analytics as any[]).map(r => [String(r.product ?? ''), r]));
      const base = emptyRow(SECTION_BY_ID_V3.product_analytics);
      const rows = prods.map(p => ({
        ...base,
        ...(existing.get(String(p.name)) ?? {}),
        product: String(p.name ?? ''),
        product_id: String(p.external_product_id ?? ''),
      }));
      return { ...prev, product_analytics: rows };
    });
    setProductsMsg({ kind: 'success', text: `Loaded ${prods.length} product${prods.length === 1 ? '' : 's'}. Fill each row’s metrics, then save.` });
  };

  // ----- §12 GMV Max — pull per-product ad spend from the brand's GMV Max page.
  //  Same week match as v2 (exact week_start, else overlap), aggregated per
  //  product with an "Other Products" catch-all row sorted last.
  const fetchGmvMaxProduct = async () => {
    if (!report) return;
    setFetchingGmv(true); setGmvMsg(null);
    let label = formatRange(report.week_start, report.week_end);
    const { data: exact, error } = await supabase
      .from('brand_gmv_max_weekly').select('id')
      .eq('brand_id', report.brand_id).eq('week_start', report.week_start);
    if (error) { setFetchingGmv(false); setGmvMsg({ kind: 'danger', text: error.message }); return; }
    let weeklyIds = ((exact as any[]) ?? []).map(r => r.id);
    if (weeklyIds.length === 0) {
      const { data: overlap } = await supabase
        .from('brand_gmv_max_weekly').select('id')
        .eq('brand_id', report.brand_id)
        .lte('week_start', report.week_end).gte('week_end', report.week_start);
      weeklyIds = ((overlap as any[]) ?? []).map(r => r.id);
      if (weeklyIds.length > 0) label += ` (${weeklyIds.length} GMV Max week${weeklyIds.length === 1 ? '' : 's'})`;
    }
    if (weeklyIds.length === 0) {
      setFetchingGmv(false);
      setGmvMsg({ kind: 'warning', text: `No GMV Max entry exists for ${label} on this brand. Add it on the brand's GMV Max tab, or enter rows manually.` });
      return;
    }
    const [{ data: kids }, { data: prods }] = await Promise.all([
      supabase.from('brand_gmv_max_weekly_products').select('*').in('weekly_id', weeklyIds),
      supabase.from('brand_products').select('id,name,external_product_id').eq('brand_id', report.brand_id),
    ]);
    setFetchingGmv(false);
    const childRows = (kids as any[]) ?? [];
    if (childRows.length === 0) {
      setGmvMsg({ kind: 'warning', text: `No product-level GMV Max data for ${label} on this brand. Open the brand's GMV Max tab and fill the product breakdown, or enter rows manually.` });
      return;
    }
    const prodById = new Map(((prods as any[]) ?? []).map(p => [p.id, p]));
    const agg = new Map<string, { product: string; product_id: string; cost: number; orders: number; gmv: number }>();
    for (const r of childRows) {
      const key = r.is_other ? '__other__' : String(r.product_id ?? '__unknown__');
      const prod = r.is_other ? null : prodById.get(r.product_id);
      const name = r.is_other ? 'Other Products' : (prod?.name ?? 'Unknown product');
      const extId = r.is_other ? '' : String(prod?.external_product_id ?? '');
      const cur = agg.get(key) ?? { product: name, product_id: extId, cost: 0, orders: 0, gmv: 0 };
      cur.cost   += Number(r.ad_spend) || 0;
      cur.orders += Number(r.orders) || 0;
      cur.gmv    += Number(r.gmv) || 0;
      agg.set(key, cur);
    }
    const rows = Array.from(agg.values())
      .sort((a, b) =>
        a.product === 'Other Products' ? 1 : b.product === 'Other Products' ? -1 : a.product.localeCompare(b.product))
      .map(a => ({
        product: a.product,
        product_id: a.product_id,
        cost: numOrNull(a.cost),
        sku_orders: numOrNull(a.orders),
        gross_revenue: numOrNull(a.gmv),
      }));
    setC(prev => ({ ...prev, gmv_max: rows }));
    setGmvMsg({ kind: 'success', text: `Pulled ${rows.length} product row${rows.length === 1 ? '' : 's'} from GMV Max for ${label}. Don't forget to save.` });
  };

  // ----- comments -----------------------------------------------------------
  const addComment = async (section: CommentSection, body: string, _authorName: string, parentId?: string) => {
    if (!report) return;
    const { data, error } = await supabase.functions.invoke('post-staff-comment', {
      body: { report_id: report.id, section, body, parent_id: parentId ?? null },
    });
    if (error) throw error;
    if ((data as any)?.error) throw new Error((data as any).error);
    setComments(prev => [...prev, (data as any).comment as Comment]);
  };

  const submit = async (e: FormEvent, status: 'draft' | 'submitted') => {
    e.preventDefault();
    if (brand?.client_status === 'closed') {
      setErr(`${brand.name} is inactive — reactivate the brand before saving changes.`);
      return;
    }
    setSaving(true); setErr(null);
    const update: Record<string, any> = { content: c, status };
    if (c.approval?.enabled) update.is_shared = true;
    const { error } = await supabase.from('weekly_reports').update(update).eq('id', id);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    nav(`/reporting/weekly/${id}`);
  };

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err && !report) return <Alert variant="danger">{err}</Alert>;
  if (!report || !brand) return null;

  const brandInactive = brand.client_status === 'closed';
  const feedbackCount = (section: CommentSection) => comments.filter(x => x.section === section).length;

  const FeedbackButton = ({ section }: { section: CommentSection }) => {
    const n = feedbackCount(section);
    if (n === 0) return null;
    return (
      <Button size="sm" variant="outline-primary" className="ms-2 d-inline-flex align-items-center gap-1"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFeedbackSection(section); }}
        title="View client feedback">
        <i className="bi bi-chat-left-text" /><Badge bg="primary" pill>{n}</Badge>
      </Button>
    );
  };

  const AutoFetchBar = ({ label, busy, onClick, msg, onClose }: {
    label: string; busy: boolean; onClick: () => void; msg: Msg; onClose: () => void;
  }) => (
    <>
      <div className="d-flex justify-content-end mb-2">
        <Button size="sm" variant="outline-info" disabled={busy} onClick={onClick}>
          <i className="bi bi-cloud-download me-1" />{busy ? 'Fetching…' : label}
        </Button>
      </div>
      {msg && (
        <Alert variant={msg.kind} className="py-2 small mb-3" onClose={onClose} dismissible>{msg.text}</Alert>
      )}
    </>
  );

  const renderSectionBody = (def: SectionDefV3) => {
    if (def.special === 'sampling') {
      return (
        <>
          <AutoFetchBar label="Auto-fill from Sample Seeding" busy={fetchingSampling}
            onClick={fetchSamplingFromBrand} msg={samplingMsg} onClose={() => setSamplingMsg(null)} />
          <ScalarSectionBodyV3 def={def} data={(c as any)[def.id]} onField={(k, v) => setSec(def.id, k, v)} />
        </>
      );
    }
    if (def.special === 'product_catalog') {
      return (
        <>
          <AutoFetchBar label="Load products" busy={loadingProducts}
            onClick={loadProductsIntoAnalytics} msg={productsMsg} onClose={() => setProductsMsg(null)} />
          <TableSectionBodyV3 def={def} rows={(c as any)[def.id]}
            onCell={(i, k, v) => setCell(def.id, i, k, v)} onAddRow={() => addRow(def)} onDelRow={(i) => delRow(def.id, i)} />
        </>
      );
    }
    if (def.special === 'gmv_max_product') {
      return (
        <>
          <AutoFetchBar label="Pull from GMV Max" busy={fetchingGmv}
            onClick={fetchGmvMaxProduct} msg={gmvMsg} onClose={() => setGmvMsg(null)} />
          <TableSectionBodyV3 def={def} rows={(c as any)[def.id]}
            onCell={(i, k, v) => setCell(def.id, i, k, v)} onAddRow={() => addRow(def)} onDelRow={(i) => delRow(def.id, i)} />
        </>
      );
    }
    if (def.kind === 'scalar') {
      return <ScalarSectionBodyV3 def={def} data={(c as any)[def.id]} onField={(k, v) => setSec(def.id, k, v)} />;
    }
    return (
      <TableSectionBodyV3 def={def} rows={(c as any)[def.id]} fixed={def.kind === 'fixed'}
        onCell={(i, k, v) => setCell(def.id, i, k, v)} onAddRow={() => addRow(def)} onDelRow={(i) => delRow(def.id, i)} />
    );
  };

  return (
    <div className="ac-themed">
      {brandInactive && (
        <Alert variant="warning" className="d-flex align-items-center gap-2">
          <i className="bi bi-lock-fill" />
          <div><strong>{brand.name} is inactive.</strong>{' '}You can review the data but Save is disabled until the brand is reactivated.</div>
        </Alert>
      )}
      <div className="d-flex justify-content-between align-items-start mb-4 flex-wrap gap-2">
        <div>
          <h2 className="mb-1">{brand.name} <small className="text-muted fs-6">— {brand.client}</small></h2>
          <div className="text-muted">
            Week #{report.week_number} · {formatRange(report.week_start, report.week_end)}
            <Badge bg={report.status === 'draft' ? 'secondary' : 'success'} className="ms-2">{report.status}</Badge>
            <Badge bg="dark" className="ms-2">New format</Badge>
          </div>
        </div>
        <div className="d-flex gap-2 flex-wrap">
          <Button variant="outline-secondary" onClick={() => nav('/reporting/weekly')}>Cancel</Button>
          <Button variant="outline-primary" disabled={saving || brandInactive} onClick={(e) => submit(e as any, 'draft')}>Save draft</Button>
          <Button variant="primary" disabled={saving || brandInactive} onClick={(e) => submit(e as any, 'submitted')}>{saving ? 'Saving…' : 'Save & view dashboard'}</Button>
        </div>
      </div>

      {err && <Alert variant="danger">{err}</Alert>}

      {WEEKLY_SECTIONS_V3.map(def => (
        <Fragment key={def.id}>
          <Card className="mb-4" data-section={def.id}>
            <Card.Header>
              <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                <span className="fw-semibold">{def.num}. {def.title}</span>
                <FeedbackButton section={def.id as CommentSection} />
              </div>
            </Card.Header>
            <Card.Body>
              {def.blurb && <p className="text-muted small mb-3">{def.blurb}</p>}
              {renderSectionBody(def)}
            </Card.Body>
          </Card>
        </Fragment>
      ))}

      {/* Insights — single rich-text block */}
      <Card className="mb-4" data-section="insights">
        <Card.Header>
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <span className="fw-semibold">Insights</span>
            <FeedbackButton section={'insights' as CommentSection} />
          </div>
        </Card.Header>
        <Card.Body>
          <Form.Text className="text-muted d-block mb-2">
            Write your insights for this week. Use the <strong>Divider</strong> button to separate topics.
          </Form.Text>
          <RichTextEditor
            value={c.insights.summary}
            onChange={html => setC(prev => ({ ...prev, insights: { summary: html } }))}
            placeholder="Write your insights for this week…"
            minHeight={240}
          />
        </Card.Body>
      </Card>

      {/* Approval Needed (optional) */}
      <Card className="mb-4">
        <Card.Header className="d-flex justify-content-between align-items-center">
          <span className="fw-semibold"><i className="bi bi-shield-check me-2 text-warning" />Approval Needed / Action Items</span>
          <Form.Check type="switch" id="approval-needed-toggle"
            checked={!!c.approval?.enabled}
            onChange={e => setC(prev => ({ ...prev, approval: { ...prev.approval, enabled: e.target.checked } }))}
            label={c.approval?.enabled ? 'On — client will see approval prompt' : 'Off'} />
        </Card.Header>
        {c.approval?.enabled && (
          <Card.Body>
            <Form.Text className="text-muted d-block mb-2">
              The client will see this content in a prompt before viewing the report. They can approve, request changes, and add a comment.
            </Form.Text>
            <RichTextEditor
              value={c.approval?.content ?? ''}
              onChange={html => setC(prev => ({ ...prev, approval: { ...prev.approval, content: html } }))}
              placeholder="Describe what needs the client's approval this week…"
              minHeight={180}
            />
          </Card.Body>
        )}
      </Card>

      <Offcanvas show={!!feedbackSection} onHide={() => setFeedbackSection(null)} placement="end" style={{ width: 480 }}>
        <Offcanvas.Header closeButton>
          <Offcanvas.Title><i className="bi bi-chat-left-text me-2" />Client feedback</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {feedbackSection && (
            <SectionComments
              section={feedbackSection} sectionLabel={feedbackSection}
              comments={comments} mode="authed"
              currentAuthorName={profile?.full_name || profile?.email || 'User'}
              onAdd={(b, n, parentId) => addComment(feedbackSection, b, n, parentId)}
            />
          )}
        </Offcanvas.Body>
      </Offcanvas>

      <div className="d-flex justify-content-end gap-2 mb-4">
        <Button variant="outline-secondary" onClick={() => nav('/reporting/weekly')}>Cancel</Button>
        <Button variant="outline-primary" disabled={saving || brandInactive} onClick={(e) => submit(e as any, 'draft')}>Save draft</Button>
        <Button variant="primary" disabled={saving || brandInactive} onClick={(e) => submit(e as any, 'submitted')}>{saving ? 'Saving…' : 'Save & view dashboard'}</Button>
      </div>
    </div>
  );
}
