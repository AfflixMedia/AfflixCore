import { useEffect, useState, FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, Form, Button, Row, Col, Table, Spinner, Alert, Badge, Modal, Offcanvas } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { formatRange } from '../lib/dates';
import {
  WeeklyReportContent, emptyContent, normalizeContent,
  emptyTopCreator, emptyTopVideo, emptyProduct,
  ListingQuality, YesNoNA,
} from '../lib/reportSchema';
import SectionComments, { Comment, CommentSection } from '../components/SectionComments';
import { useAuth } from '../auth/AuthContext';
import RichTextEditor from '../components/RichTextEditor';
import { CustomSectionInline, CustomSectionDefModal, customSectionsAt, newSection } from '../components/CustomSectionEditor';
import { CustomSection, StandardSectionId } from '../lib/reportSchema';

const SECTION_LABELS: Record<string, string> = {
  overall: 'Overall Performance',
  top_creators: 'Top Creators',
  top_videos: 'Top Videos',
  video_performance: 'Video Performance',
  gmv_max: 'GMV Max',
  product_highlights: 'Product Highlights',
  shop_health: 'Shop Health',
  insights: 'Insights',
};

interface ReportRow {
  id: string; brand_id: string; week_start: string; week_end: string;
  week_number: number; status: string; content: any;
}
interface Brand { id: string; name: string; client: string; }

export default function WeeklyReportEdit() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { profile } = useAuth();
  const [report, setReport] = useState<ReportRow | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [c, setC] = useState<WeeklyReportContent>(emptyContent());
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [showComments, setShowComments] = useState(false);
  const [priorReports, setPriorReports] = useState<ReportRow[]>([]);
  const [selectedPriorId, setSelectedPriorId] = useState<string>('');
  const [priorComments, setPriorComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);

  const [csModalOpen, setCsModalOpen] = useState(false);
  const [csDraft, setCsDraft] = useState<CustomSection>(newSection());
  const [csIsEdit, setCsIsEdit] = useState(false);

  const [feedbackSection, setFeedbackSection] = useState<CommentSection | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('weekly_reports').select('*').eq('id', id).single();
      if (error) { setErr(error.message); setLoading(false); return; }
      const r = data as ReportRow;
      setReport(r);
      setC(normalizeContent(r.content));
      const { data: bd } = await supabase.from('brands').select('id,name,client').eq('id', r.brand_id).single();
      setBrand(bd as Brand);
      const { data: priors } = await supabase.from('weekly_reports')
        .select('*').eq('brand_id', r.brand_id).lt('week_start', r.week_start)
        .order('week_start', { ascending: false }).limit(12);
      setPriorReports((priors as ReportRow[]) ?? []);
      if (priors && priors.length > 0) setSelectedPriorId((priors[0] as any).id);
      const { data: cm } = await supabase.from('report_comments')
        .select('*').eq('report_id', r.id).order('created_at', { ascending: true });
      setComments((cm as Comment[]) ?? []);
      setLoading(false);
    })();
  }, [id]);

  const addComment = async (section: CommentSection, body: string, authorName: string, parentId?: string) => {
    if (!report || !profile) return;
    const { data, error } = await supabase.from('report_comments').insert({
      report_id: report.id,
      section,
      author_type: profile.role === 'bob' ? 'bob' : 'apc',
      author_name: authorName,
      body,
      parent_id: parentId ?? null,
    }).select().single();
    if (error) throw error;
    setComments(prev => [...prev, data as Comment]);
  };
  const delComment = async (cid: string) => {
    const prevState = comments;
    setComments(comments.filter(x => x.id !== cid));
    const { error } = await supabase.from('report_comments').delete().eq('id', cid);
    if (error) { alert(error.message); setComments(prevState); }
  };

  const o = c.overall;
  const vp = c.video_performance;
  const gm = c.gmv_max;
  const sh = c.shop_health;

  const setOverall = (k: keyof typeof o, v: any) => setC({ ...c, overall: { ...o, [k]: v } });
  const setVP = (k: keyof typeof vp, v: any) => setC({ ...c, video_performance: { ...vp, [k]: v } });
  const setGM = (k: keyof typeof gm, v: any) => setC({ ...c, gmv_max: { ...gm, [k]: v } });
  const setSH = (k: keyof typeof sh, v: any) => setC({ ...c, shop_health: { ...sh, [k]: v } });

  const num = (v: string) => v === '' ? 0 : Number(v);
  const numOrNull = (v: string) => v === '' ? null : Number(v);

  const updRow = <T,>(key: 'top_creators' | 'top_videos' | 'product_highlights', i: number, patch: Partial<T>) => {
    const arr = [...(c[key] as any[])];
    arr[i] = { ...arr[i], ...patch };
    setC({ ...c, [key]: arr });
  };
  const addRow = (key: 'top_creators' | 'top_videos' | 'product_highlights', factory: () => any) =>
    setC({ ...c, [key]: [...(c[key] as any[]), factory()] });
  const delRow = (key: 'top_creators' | 'top_videos' | 'product_highlights', i: number) => {
    const arr = [...(c[key] as any[])];
    arr.splice(i, 1);
    setC({ ...c, [key]: arr });
  };

  const submit = async (e: FormEvent, status: 'draft' | 'submitted') => {
    e.preventDefault();
    setSaving(true); setErr(null);
    const { error } = await supabase.from('weekly_reports')
      .update({ content: c, status }).eq('id', id);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    nav(`/reporting/weekly/${id}`);
  };

  const openCommentsModal = async () => {
    setShowComments(true);
    if (!selectedPriorId) return;
    await loadPriorComments(selectedPriorId);
  };
  const loadPriorComments = async (priorId: string) => {
    setLoadingComments(true);
    const { data } = await supabase.from('report_comments')
      .select('*').eq('report_id', priorId).order('created_at', { ascending: true });
    setPriorComments((data as Comment[]) ?? []);
    setLoadingComments(false);
  };

  const pullInComment = async (cm: Comment) => {
    if (!report || !profile) return;
    const priorLabel = priorReports.find(p => p.id === cm.report_id);
    const origDate = new Date(cm.created_at).toLocaleDateString();
    const quoted = cm.body.split('\n').map(l => `> ${l}`).join('\n');
    const body = `📌 Referenced from ${priorLabel ? `Week #${priorLabel.week_number}` : 'prior report'} — ${cm.author_name} (${origDate}):\n${quoted}`;
    try {
      await addComment(cm.section as CommentSection, body, profile.full_name || profile.email || 'User');
      setShowComments(false);
    } catch (e: any) {
      alert(e?.message ?? 'Failed to pull comment');
    }
  };

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err && !report) return <Alert variant="danger">{err}</Alert>;
  if (!report || !brand) return null;

  const sectionFeedbackCount = (section: CommentSection) =>
    comments.filter(c => c.section === section).length;

  const FeedbackButton = ({ section }: { section: CommentSection }) => {
    const n = sectionFeedbackCount(section);
    if (n === 0) return null;
    return (
      <Button size="sm" variant="outline-primary" className="ms-2 d-inline-flex align-items-center gap-1"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFeedbackSection(section); }}
        title="View client feedback">
        <i className="bi bi-chat-left-text" />
        <Badge bg="primary" pill>{n}</Badge>
      </Button>
    );
  };

  // Wrap a header label so it sits at left and the feedback icon at right
  const HeaderWithFeedback = ({ title, section, extra }: { title: string; section: CommentSection; extra?: React.ReactNode }) => (
    <div className="d-flex justify-content-between align-items-center">
      <span className="fw-semibold">{title}</span>
      <div className="d-flex align-items-center gap-2">
        {extra}
        <FeedbackButton section={section} />
      </div>
    </div>
  );

  // Custom section management
  const openAddCustom = () => { setCsDraft(newSection('insights')); setCsIsEdit(false); setCsModalOpen(true); };
  const openEditCustom = (s: CustomSection) => { setCsDraft({ ...s, fields: s.fields.map(f => ({ ...f })) }); setCsIsEdit(true); setCsModalOpen(true); };
  const saveCustomDef = (s: CustomSection) => {
    if (csIsEdit) setC({ ...c, custom_sections: c.custom_sections.map(x => x.id === s.id ? s : x) });
    else setC({ ...c, custom_sections: [...c.custom_sections, s] });
    setCsModalOpen(false);
  };
  const removeCustom = (id: string) => {
    if (!confirm('Delete this custom section and all its data?')) return;
    setC({ ...c, custom_sections: c.custom_sections.filter(s => s.id !== id) });
  };
  const updateCustomData = (id: string, patch: Partial<CustomSection>) => {
    setC({ ...c, custom_sections: c.custom_sections.map(s => s.id === id ? { ...s, ...patch } : s) });
  };

  const renderCustomAt = (anchor: StandardSectionId) =>
    customSectionsAt(c.custom_sections, anchor).map(s => (
      <CustomSectionInline
        key={s.id}
        section={s}
        onChange={(patch) => updateCustomData(s.id, patch)}
        onEditDef={() => openEditCustom(s)}
        onRemove={() => removeCustom(s.id)}
      />
    ));

  return (
    <>
      <div className="d-flex justify-content-between align-items-start mb-4 flex-wrap gap-2">
        <div>
          <h2 className="mb-1">{brand.name} <small className="text-muted fs-6">— {brand.client}</small></h2>
          <div className="text-muted">
            Week #{report.week_number} · {formatRange(report.week_start, report.week_end)}
            <Badge bg={report.status === 'draft' ? 'secondary' : 'success'} className="ms-2">{report.status}</Badge>
          </div>
        </div>
        <div className="d-flex gap-2 flex-wrap">
          {priorReports.length > 0 && (
            <Button variant="outline-info" onClick={openCommentsModal}>
              <i className="bi bi-chat-left-text me-1" /> Load previous comments
            </Button>
          )}
          <Button variant="outline-success" onClick={openAddCustom}>
            <i className="bi bi-plus-square me-1" /> Add custom section
          </Button>
          <Button variant="outline-secondary" onClick={() => nav('/reporting/weekly')}>Cancel</Button>
          <Button variant="outline-primary" disabled={saving} onClick={(e) => submit(e as any, 'draft')}>Save draft</Button>
          <Button variant="primary" disabled={saving} onClick={(e) => submit(e as any, 'submitted')}>{saving ? 'Saving…' : 'Save & view dashboard'}</Button>
        </div>
      </div>

      {err && <Alert variant="danger">{err}</Alert>}

      {renderCustomAt('start')}

      {/* Overall Performance */}
      <Card className="mb-4">
        <Card.Header><HeaderWithFeedback title="Overall Performance" section="overall" /></Card.Header>
        <Card.Body>
          <Row className="g-3">
            <Col md={3}><Form.Label className="small">Total GMV ($)</Form.Label>
              <Form.Control type="number" step="0.01" value={o.total_gmv || ''} onChange={e => setOverall('total_gmv', num(e.target.value))} /></Col>
            <Col md={3}><Form.Label className="small">Affiliate GMV ($)</Form.Label>
              <Form.Control type="number" step="0.01" value={o.affiliate_gmv || ''} onChange={e => setOverall('affiliate_gmv', num(e.target.value))} /></Col>
            <Col md={3}><Form.Label className="small">Orders</Form.Label>
              <Form.Control type="number" value={o.orders || ''} onChange={e => setOverall('orders', num(e.target.value))} /></Col>
            <Col md={3}><Form.Label className="small">Pending Collabs</Form.Label>
              <Form.Control type="number" value={o.pending_collabs || ''} onChange={e => setOverall('pending_collabs', num(e.target.value))} /></Col>

            <Col md={3}><Form.Label className="small">Samples Approved</Form.Label>
              <Form.Control type="number" value={o.samples_approved || ''} onChange={e => setOverall('samples_approved', num(e.target.value))} /></Col>
            <Col md={6}><Form.Label className="small">Samples note (e.g. MTD Approved: 38)</Form.Label>
              <Form.Control value={o.samples_approved_note} onChange={e => setOverall('samples_approved_note', e.target.value)} /></Col>

            <Col md={12}><hr className="my-0" /></Col>
            <Col md={4}>
              <Form.Check type="switch" id="ad-spend-not-started"
                label="Ad Spend — not yet started"
                checked={o.ad_spend_not_started}
                onChange={e => setOverall('ad_spend_not_started', e.target.checked)} />
            </Col>
            {!o.ad_spend_not_started && (
              <Col md={4}><Form.Label className="small">Ad Spend ($)</Form.Label>
                <Form.Control type="number" step="0.01" value={o.ad_spend || ''} onChange={e => setOverall('ad_spend', num(e.target.value))} /></Col>
            )}
            <Col md={o.ad_spend_not_started ? 8 : 4}>
              <Form.Label className="small">Target (e.g. "Target: $5,000")</Form.Label>
              <Form.Control value={o.ad_spend_target} onChange={e => setOverall('ad_spend_target', e.target.value)} />
            </Col>
          </Row>
        </Card.Body>
      </Card>
      {renderCustomAt('overall')}

      {/* Top Creators */}
      <Section title="Top Creators" onAdd={() => addRow('top_creators', emptyTopCreator)} empty={c.top_creators.length === 0} headerRight={<FeedbackButton section="top_creators" />}>
        <Table size="sm" className="mb-0 align-middle">
          <thead><tr>
            <th>Creator Name</th>
            <th style={{width:130}}>Videos Posted</th>
            <th style={{width:110}}>Items Sold</th>
            <th style={{width:140}}>GMV Generated ($)</th>
            <th>Notes</th>
            <th style={{width:50}}></th>
          </tr></thead>
          <tbody>
            {c.top_creators.map((r, i) => (
              <tr key={i}>
                <td><Form.Control size="sm" value={r.name} onChange={e => updRow('top_creators', i, { name: e.target.value })} /></td>
                <td><Form.Control size="sm" type="number" value={r.videos || ''} onChange={e => updRow('top_creators', i, { videos: num(e.target.value) })} /></td>
                <td><Form.Control size="sm" type="number" value={r.items_sold || ''} onChange={e => updRow('top_creators', i, { items_sold: num(e.target.value) })} /></td>
                <td><Form.Control size="sm" type="number" step="0.01" value={r.gmv || ''} onChange={e => updRow('top_creators', i, { gmv: num(e.target.value) })} /></td>
                <td><Form.Control size="sm" value={r.notes} onChange={e => updRow('top_creators', i, { notes: e.target.value })} /></td>
                <td><Button size="sm" variant="outline-danger" onClick={() => delRow('top_creators', i)}><i className="bi bi-trash" /></Button></td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>
      {renderCustomAt('top_creators')}

      {/* Top Videos — current week only; last week auto-shown in dashboard */}
      <Section title="Top Videos (this week)" onAdd={() => addRow('top_videos', emptyTopVideo)} empty={c.top_videos.length === 0} headerRight={<FeedbackButton section="top_videos" />}>
        <Table size="sm" className="mb-0 align-middle">
          <thead><tr>
            <th>Creator Name</th>
            <th>Video URL</th>
            <th style={{width:110}}>Items Sold</th>
            <th style={{width:140}}>GMV Generated ($)</th>
            <th style={{width:50}}></th>
          </tr></thead>
          <tbody>
            {c.top_videos.map((r, i) => (
              <tr key={i}>
                <td><Form.Control size="sm" value={r.creator_name} onChange={e => updRow('top_videos', i, { creator_name: e.target.value })} /></td>
                <td><Form.Control size="sm" placeholder="https://…" value={r.video_url} onChange={e => updRow('top_videos', i, { video_url: e.target.value })} /></td>
                <td><Form.Control size="sm" type="number" value={r.items_sold || ''} onChange={e => updRow('top_videos', i, { items_sold: num(e.target.value) })} /></td>
                <td><Form.Control size="sm" type="number" step="0.01" value={r.gmv || ''} onChange={e => updRow('top_videos', i, { gmv: num(e.target.value) })} /></td>
                <td><Button size="sm" variant="outline-danger" onClick={() => delRow('top_videos', i)}><i className="bi bi-trash" /></Button></td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>
      {renderCustomAt('top_videos')}

      {/* Video Performance */}
      <Card className="mb-4">
        <Card.Header><HeaderWithFeedback title="Video Performance" section="video_performance" /></Card.Header>
        <Card.Body>
          <Row className="g-3">
            <Col md={3}><Form.Label className="small">Total Videos Posted</Form.Label>
              <Form.Control type="number" value={vp.total_videos_posted || ''} onChange={e => setVP('total_videos_posted', num(e.target.value))} /></Col>
            <Col md={3}><Form.Label className="small">Video Views</Form.Label>
              <Form.Control type="number" value={vp.video_views || ''} onChange={e => setVP('video_views', num(e.target.value))} /></Col>
            <Col md={3}><Form.Label className="small">CTR (%)</Form.Label>
              <Form.Control type="number" step="0.01" value={vp.ctr || ''} onChange={e => setVP('ctr', num(e.target.value))} /></Col>
            <Col md={3}><Form.Label className="small">CTOR (%)</Form.Label>
              <Form.Control type="number" step="0.01" value={vp.ctor || ''} onChange={e => setVP('ctor', num(e.target.value))} /></Col>
          </Row>
        </Card.Body>
      </Card>
      {renderCustomAt('video_performance')}

      {/* GMV Max */}
      <Card className="mb-4">
        <Card.Header><HeaderWithFeedback title="Overall GMV Max Performance" section="gmv_max" /></Card.Header>
        <Card.Body>
          <Row className="g-3">
            <Col md={3}>
              <Form.Check type="switch" id="gm-not-started"
                label="Not yet started"
                checked={gm.not_yet_started}
                onChange={e => setGM('not_yet_started', e.target.checked)} />
            </Col>
            {!gm.not_yet_started && (
              <>
                <Col md={3}><Form.Label className="small">Ad Spend ($)</Form.Label>
                  <Form.Control type="number" step="0.01" value={gm.ad_spend || ''} onChange={e => setGM('ad_spend', num(e.target.value))} /></Col>
                <Col md={3}><Form.Label className="small">ROI</Form.Label>
                  <Form.Control type="number" step="0.01" value={gm.roi || ''} onChange={e => setGM('roi', num(e.target.value))} /></Col>
                <Col md={3}><Form.Label className="small">Orders</Form.Label>
                  <Form.Control type="number" value={gm.orders || ''} onChange={e => setGM('orders', num(e.target.value))} /></Col>
                <Col md={3}><Form.Label className="small">CPO ($)</Form.Label>
                  <Form.Control type="number" step="0.01" value={gm.cpo || ''} onChange={e => setGM('cpo', num(e.target.value))} /></Col>
                <Col md={3}><Form.Label className="small">GMV ($)</Form.Label>
                  <Form.Control type="number" step="0.01" value={gm.gmv || ''} onChange={e => setGM('gmv', num(e.target.value))} /></Col>
                <Col md={6}><Form.Label className="small">Notes</Form.Label>
                  <Form.Control value={gm.notes} onChange={e => setGM('notes', e.target.value)} /></Col>
              </>
            )}
          </Row>
        </Card.Body>
      </Card>
      {renderCustomAt('gmv_max')}

      {/* Product Highlights */}
      <Section title="Product Highlights" onAdd={() => addRow('product_highlights', emptyProduct)} empty={c.product_highlights.length === 0} headerRight={<FeedbackButton section="product_highlights" />}>
        <Table size="sm" className="mb-0 align-middle">
          <thead><tr>
            <th>Product Name</th>
            <th style={{width:180}}>Product ID</th>
            <th style={{width:110}}>Total Units</th>
            <th style={{width:120}}>Affiliate Units</th>
            <th style={{width:140}}>Total GMV ($)</th>
            <th style={{width:120}}>Videos Posted</th>
            <th style={{width:140}}>Listing Quality</th>
            <th style={{width:50}}></th>
          </tr></thead>
          <tbody>
            {c.product_highlights.map((r, i) => (
              <tr key={i}>
                <td><Form.Control size="sm" value={r.product_name} onChange={e => updRow('product_highlights', i, { product_name: e.target.value })} /></td>
                <td><Form.Control size="sm" value={r.product_id} onChange={e => updRow('product_highlights', i, { product_id: e.target.value })} /></td>
                <td><Form.Control size="sm" type="number" value={r.total_units_sold || ''} onChange={e => updRow('product_highlights', i, { total_units_sold: num(e.target.value) })} /></td>
                <td><Form.Control size="sm" type="number" value={r.affiliate_units_sold || ''} onChange={e => updRow('product_highlights', i, { affiliate_units_sold: num(e.target.value) })} /></td>
                <td><Form.Control size="sm" type="number" step="0.01" value={r.total_gmv || ''} onChange={e => updRow('product_highlights', i, { total_gmv: num(e.target.value) })} /></td>
                <td><Form.Control size="sm" type="number" value={r.videos_posted || ''} onChange={e => updRow('product_highlights', i, { videos_posted: num(e.target.value) })} /></td>
                <td>
                  <Form.Select size="sm" value={r.listing_quality}
                    onChange={e => updRow('product_highlights', i, { listing_quality: e.target.value as ListingQuality })}>
                    <option value="">—</option>
                    <option value="excellent">Excellent</option>
                    <option value="good">Good</option>
                    <option value="fair">Fair</option>
                    <option value="poor">Poor</option>
                  </Form.Select>
                </td>
                <td><Button size="sm" variant="outline-danger" onClick={() => delRow('product_highlights', i)}><i className="bi bi-trash" /></Button></td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>
      {renderCustomAt('product_highlights')}

      {/* Shop Health */}
      <Card className="mb-4">
        <Card.Header><HeaderWithFeedback title="Shop Health" section="shop_health" /></Card.Header>
        <Card.Body>
          <Row className="g-3">
            <Col md={3}><Form.Label className="small">Shop Performance Score (out of 5)</Form.Label>
              <Form.Control type="number" step="0.1" min={0} max={5} placeholder="Not yet assigned"
                value={sh.shop_performance_score ?? ''} onChange={e => setSH('shop_performance_score', numOrNull(e.target.value))} /></Col>
            <Col md={3}><Form.Label className="small">Product Satisfaction (out of 5)</Form.Label>
              <Form.Control type="number" step="0.1" min={0} max={5} placeholder="Not yet rated"
                value={sh.product_satisfaction_rating ?? ''} onChange={e => setSH('product_satisfaction_rating', numOrNull(e.target.value))} /></Col>
            <Col md={3}><Form.Label className="small">Fulfillment & Logistics (out of 5)</Form.Label>
              <Form.Control type="number" step="0.1" min={0} max={5} placeholder="Not yet rated"
                value={sh.fulfillment_rating ?? ''} onChange={e => setSH('fulfillment_rating', numOrNull(e.target.value))} /></Col>
            <Col md={3}><Form.Label className="small">Customer Service (out of 5)</Form.Label>
              <Form.Control type="number" step="0.1" min={0} max={5} placeholder="Not yet rated"
                value={sh.customer_service_rating ?? ''} onChange={e => setSH('customer_service_rating', numOrNull(e.target.value))} /></Col>

            <Col md={3}><Form.Label className="small">Dispatching on time?</Form.Label>
              <Form.Select value={sh.dispatching_on_time} onChange={e => setSH('dispatching_on_time', e.target.value as YesNoNA)}>
                <option value="not_rated">Not rated</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Form.Select>
            </Col>
            <Col md={3}><Form.Label className="small">Replying within 24h?</Form.Label>
              <Form.Select value={sh.replying_within_24h} onChange={e => setSH('replying_within_24h', e.target.value as YesNoNA)}>
                <option value="not_rated">Not rated</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Form.Select>
            </Col>
            <Col md={3} className="d-flex align-items-end">
              <Form.Check type="switch" id="sh-warn" label="Warnings this week"
                checked={sh.warnings_received} onChange={e => setSH('warnings_received', e.target.checked)} />
            </Col>
            <Col md={3} className="d-flex align-items-end">
              <Form.Check type="switch" id="sh-viol" label="Violations this week"
                checked={sh.violations_received} onChange={e => setSH('violations_received', e.target.checked)} />
            </Col>
          </Row>
        </Card.Body>
      </Card>
      {renderCustomAt('shop_health')}

      {/* Insights */}
      <Card className="mb-4">
        <Card.Header><HeaderWithFeedback title="Insights" section="insights" /></Card.Header>
        <Card.Body>
          <RichTextEditor
            value={c.insights.summary}
            onChange={html => setC({ ...c, insights: { summary: html } })}
            placeholder="Write your insights for this week…"
            minHeight={220}
          />
        </Card.Body>
      </Card>
      {renderCustomAt('insights')}

      <CustomSectionDefModal
        show={csModalOpen}
        onHide={() => setCsModalOpen(false)}
        initial={csDraft}
        onSave={saveCustomDef}
        isEdit={csIsEdit}
        key={csDraft.id}
      />

      <Offcanvas show={!!feedbackSection} onHide={() => setFeedbackSection(null)} placement="end" style={{ width: 480 }}>
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>
            <i className="bi bi-chat-left-text me-2" />
            Client feedback
            {feedbackSection && <small className="text-muted ms-2 fw-normal">— {SECTION_LABELS[feedbackSection]}</small>}
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {feedbackSection && (
            <SectionComments
              section={feedbackSection}
              comments={comments}
              mode="authed"
              currentAuthorName={profile?.full_name || profile?.email || 'User'}
              onAdd={(b, n, parentId) => addComment(feedbackSection, b, n, parentId)}
              onDelete={delComment}
            />
          )}
        </Offcanvas.Body>
      </Offcanvas>

      <div className="d-flex justify-content-end gap-2 mb-4">
        <Button variant="outline-secondary" onClick={() => nav('/reporting/weekly')}>Cancel</Button>
        <Button variant="outline-primary" disabled={saving} onClick={(e) => submit(e as any, 'draft')}>Save draft</Button>
        <Button variant="primary" disabled={saving} onClick={(e) => submit(e as any, 'submitted')}>{saving ? 'Saving…' : 'Save & view dashboard'}</Button>
      </div>

      <Modal show={showComments} onHide={() => setShowComments(false)} centered size="lg" scrollable>
        <Modal.Header closeButton>
          <Modal.Title>Previous comments — reference</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {priorReports.length === 0 ? (
            <p className="text-muted mb-0">No previous reports for this brand.</p>
          ) : (
            <>
              <Form.Group className="mb-3">
                <Form.Label className="small">Choose a report</Form.Label>
                <Form.Select value={selectedPriorId} onChange={e => { setSelectedPriorId(e.target.value); loadPriorComments(e.target.value); }}>
                  {priorReports.map(p => (
                    <option key={p.id} value={p.id}>
                      Week #{p.week_number} — {formatRange(p.week_start, p.week_end)}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
              {loadingComments ? (
                <div className="text-center py-4"><Spinner animation="border" size="sm" /></div>
              ) : priorComments.length === 0 ? (
                <p className="text-muted text-center py-3 mb-0">No comments on this report.</p>
              ) : (
                Object.keys(SECTION_LABELS).map(section => {
                  const sc = priorComments.filter(x => x.section === section);
                  if (sc.length === 0) return null;
                  return (
                    <div key={section} className="mb-3">
                      <h6 className="text-muted">{SECTION_LABELS[section]}</h6>
                      {sc.map(cm => (
                        <div key={cm.id} className="p-2 mb-2 rounded small" style={{ background: '#f8fafc', border: '1px solid #e5e7eb' }}>
                          <div className="d-flex align-items-center gap-2 mb-1">
                            <strong>{cm.author_name}</strong>
                            <Badge bg={cm.author_type === 'client' ? 'info' : cm.author_type === 'bob' ? 'warning' : 'success'} text={cm.author_type === 'bob' ? 'dark' : undefined}>
                              {cm.author_type === 'client' ? 'Client' : cm.author_type === 'bob' ? 'Bob' : 'APC'}
                            </Badge>
                            <span className="text-muted">{new Date(cm.created_at).toLocaleDateString()}</span>
                            <Button size="sm" variant="outline-primary" className="ms-auto py-0 px-2" style={{ fontSize: '.75rem' }}
                              onClick={() => pullInComment(cm)} title="Copy this comment into the current report for reference">
                              <i className="bi bi-pin-angle me-1" /> Pull into this report
                            </Button>
                          </div>
                          <div style={{ whiteSpace: 'pre-wrap' }}>{cm.body}</div>
                        </div>
                      ))}
                    </div>
                  );
                })
              )}
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowComments(false)}>Close</Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}

function Section({ title, onAdd, empty, children, headerRight }: { title: string; onAdd: () => void; empty: boolean; children: React.ReactNode; headerRight?: React.ReactNode }) {
  return (
    <Card className="mb-4">
      <Card.Header className="d-flex justify-content-between align-items-center">
        <span className="fw-semibold">{title}</span>
        <div className="d-flex align-items-center gap-2">
          <Button size="sm" onClick={onAdd}><i className="bi bi-plus-lg me-1" />Add row</Button>
          {headerRight}
        </div>
      </Card.Header>
      <Card.Body className="p-2">
        {empty ? <p className="text-muted text-center mb-0 py-3 small">No rows yet — click "Add row".</p> : children}
      </Card.Body>
    </Card>
  );
}
