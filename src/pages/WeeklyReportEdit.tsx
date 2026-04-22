import { useEffect, useState, FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, Form, Button, Row, Col, Table, Spinner, Alert, Badge } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { formatRange } from '../lib/dates';
import {
  WeeklyReportContent, emptyContent,
  emptyTopCreator, emptyTopVideo, emptyGmvMax, emptyProduct,
} from '../lib/reportSchema';

interface ReportRow {
  id: string; brand_id: string; week_start: string; week_end: string;
  week_number: number; status: string; content: WeeklyReportContent;
}
interface Brand { id: string; name: string; client: string; }

export default function WeeklyReportEdit() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [report, setReport] = useState<ReportRow | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [c, setC] = useState<WeeklyReportContent>(emptyContent());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('weekly_reports').select('*').eq('id', id).single();
      if (error) { setErr(error.message); setLoading(false); return; }
      const r = data as ReportRow;
      setReport(r);
      const merged = { ...emptyContent(), ...(r.content ?? {}) };
      merged.overall = { ...emptyContent().overall, ...(r.content?.overall ?? {}) };
      merged.insights = { ...emptyContent().insights, ...(r.content?.insights ?? {}) };
      setC(merged);
      const { data: bd } = await supabase.from('brands').select('id,name,client').eq('id', r.brand_id).single();
      setBrand(bd as Brand);
      setLoading(false);
    })();
  }, [id]);

  const setOverall = (k: keyof typeof c.overall, v: any) => setC({ ...c, overall: { ...c.overall, [k]: v } });
  const num = (v: string) => v === '' ? 0 : Number(v);

  // dynamic row helpers
  const updRow = <T,>(key: keyof WeeklyReportContent, i: number, patch: Partial<T>) => {
    const arr = [...(c[key] as any[])];
    arr[i] = { ...arr[i], ...patch };
    setC({ ...c, [key]: arr });
  };
  const addRow = (key: keyof WeeklyReportContent, factory: () => any) =>
    setC({ ...c, [key]: [...(c[key] as any[]), factory()] });
  const delRow = (key: keyof WeeklyReportContent, i: number) => {
    const arr = [...(c[key] as any[])];
    arr.splice(i, 1);
    setC({ ...c, [key]: arr });
  };

  const submit = async (e: FormEvent, status: 'draft' | 'submitted') => {
    e.preventDefault();
    setSaving(true); setErr(null);
    const content: WeeklyReportContent = c;
    const { error } = await supabase.from('weekly_reports')
      .update({ content, status }).eq('id', id);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    nav(`/reporting/weekly/${id}`);
  };

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err && !report) return <Alert variant="danger">{err}</Alert>;
  if (!report || !brand) return null;

  const o = c.overall;

  return (
    <Form onSubmit={(e) => submit(e, 'submitted')}>
      <div className="d-flex justify-content-between align-items-start mb-4">
        <div>
          <h2 className="mb-1">{brand.name} <small className="text-muted fs-6">— {brand.client}</small></h2>
          <div className="text-muted">
            Week #{report.week_number} · {formatRange(report.week_start, report.week_end)}
            <Badge bg={report.status === 'draft' ? 'secondary' : 'success'} className="ms-2">{report.status}</Badge>
          </div>
        </div>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" onClick={() => nav('/reporting/weekly')}>Cancel</Button>
          <Button variant="outline-primary" disabled={saving} onClick={(e) => submit(e as any, 'draft')}>Save draft</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save & view dashboard'}</Button>
        </div>
      </div>

      {err && <Alert variant="danger">{err}</Alert>}

      {/* Overall */}
      <Card className="mb-4">
        <Card.Header className="fw-semibold">Overall Performance</Card.Header>
        <Card.Body>
          <Row className="g-3">
            <Col md={3}><Form.Label className="small">GMV ($)</Form.Label>
              <Form.Control type="number" step="0.01" value={o.gmv || ''} onChange={e => setOverall('gmv', num(e.target.value))} /></Col>
            <Col md={3}><Form.Label className="small">Affiliate GMV ($)</Form.Label>
              <Form.Control type="number" step="0.01" value={o.affiliate_gmv || ''} onChange={e => setOverall('affiliate_gmv', num(e.target.value))} /></Col>
            <Col md={3}><Form.Label className="small">Orders</Form.Label>
              <Form.Control type="number" value={o.orders || ''} onChange={e => setOverall('orders', num(e.target.value))} /></Col>
            <Col md={3}><Form.Label className="small">ROI</Form.Label>
              <Form.Control type="number" step="0.01" value={o.roi || ''} onChange={e => setOverall('roi', num(e.target.value))} /></Col>

            <Col md={3}><Form.Label className="small">Samples Approved</Form.Label>
              <Form.Control type="number" value={o.samples_approved || ''} onChange={e => setOverall('samples_approved', num(e.target.value))} /></Col>
            <Col md={3}><Form.Label className="small">Samples note (e.g. MTD: 854)</Form.Label>
              <Form.Control value={o.samples_approved_note} onChange={e => setOverall('samples_approved_note', e.target.value)} /></Col>
            <Col md={3}><Form.Label className="small">Shop Performance Score</Form.Label>
              <Form.Control type="number" step="0.1" value={o.sps || ''} onChange={e => setOverall('sps', num(e.target.value))} /></Col>
            <Col md={3}><Form.Label className="small">Videos Posted</Form.Label>
              <Form.Control type="number" value={o.videos_posted || ''} onChange={e => setOverall('videos_posted', num(e.target.value))} /></Col>

            <Col md={3}><Form.Label className="small">Total Videos note</Form.Label>
              <Form.Control value={o.videos_total_note} onChange={e => setOverall('videos_total_note', e.target.value)} /></Col>
          </Row>
        </Card.Body>
      </Card>

      {/* Top Creators */}
      <DynamicSection
        title="Top Creators"
        onAdd={() => addRow('top_creators', emptyTopCreator)}
        empty={c.top_creators.length === 0}
      >
        <Table size="sm" className="mb-0 align-middle">
          <thead><tr>
            <th>Creator Name</th><th style={{width:110}}>Videos</th><th style={{width:110}}>Items Sold</th>
            <th style={{width:140}}>GMV ($)</th><th>Notes</th><th style={{width:50}}></th>
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
      </DynamicSection>

      {/* Top Videos */}
      <DynamicSection
        title="Top Videos"
        onAdd={() => addRow('top_videos', emptyTopVideo)}
        empty={c.top_videos.length === 0}
      >
        <Table size="sm" className="mb-0 align-middle">
          <thead><tr>
            <th>Creator</th><th>Video URL</th><th style={{width:100}}>Items</th><th style={{width:130}}>GMV ($)</th>
            <th style={{width:110}}>Views</th><th style={{width:120}}>Clicks</th><th>Notes</th><th style={{width:50}}></th>
          </tr></thead>
          <tbody>
            {c.top_videos.map((r, i) => (
              <tr key={i}>
                <td><Form.Control size="sm" value={r.creator_name} onChange={e => updRow('top_videos', i, { creator_name: e.target.value })} /></td>
                <td><Form.Control size="sm" placeholder="https://…" value={r.video_url} onChange={e => updRow('top_videos', i, { video_url: e.target.value })} /></td>
                <td><Form.Control size="sm" type="number" value={r.items_sold || ''} onChange={e => updRow('top_videos', i, { items_sold: num(e.target.value) })} /></td>
                <td><Form.Control size="sm" type="number" step="0.01" value={r.gmv || ''} onChange={e => updRow('top_videos', i, { gmv: num(e.target.value) })} /></td>
                <td><Form.Control size="sm" type="number" value={r.views || ''} onChange={e => updRow('top_videos', i, { views: num(e.target.value) })} /></td>
                <td><Form.Control size="sm" type="number" value={r.product_clicks || ''} onChange={e => updRow('top_videos', i, { product_clicks: num(e.target.value) })} /></td>
                <td><Form.Control size="sm" value={r.notes} onChange={e => updRow('top_videos', i, { notes: e.target.value })} /></td>
                <td><Button size="sm" variant="outline-danger" onClick={() => delRow('top_videos', i)}><i className="bi bi-trash" /></Button></td>
              </tr>
            ))}
          </tbody>
        </Table>
      </DynamicSection>

      {/* GMV Max */}
      <DynamicSection
        title="GMV Max Campaigns"
        onAdd={() => addRow('gmv_max', emptyGmvMax)}
        empty={c.gmv_max.length === 0}
      >
        <Table size="sm" className="mb-0 align-middle">
          <thead><tr>
            <th>Campaign</th><th style={{width:130}}>Spend ($)</th><th style={{width:90}}>ROI</th>
            <th style={{width:110}}>Orders</th><th style={{width:110}}>CPO ($)</th><th style={{width:140}}>GMV ($)</th>
            <th>Notes</th><th style={{width:50}}></th>
          </tr></thead>
          <tbody>
            {c.gmv_max.map((r, i) => (
              <tr key={i}>
                <td><Form.Control size="sm" value={r.campaign} onChange={e => updRow('gmv_max', i, { campaign: e.target.value })} /></td>
                <td><Form.Control size="sm" type="number" step="0.01" value={r.spend || ''} onChange={e => updRow('gmv_max', i, { spend: num(e.target.value) })} /></td>
                <td><Form.Control size="sm" type="number" step="0.01" value={r.roi || ''} onChange={e => updRow('gmv_max', i, { roi: num(e.target.value) })} /></td>
                <td><Form.Control size="sm" type="number" value={r.orders || ''} onChange={e => updRow('gmv_max', i, { orders: num(e.target.value) })} /></td>
                <td><Form.Control size="sm" type="number" step="0.01" value={r.cpo || ''} onChange={e => updRow('gmv_max', i, { cpo: num(e.target.value) })} /></td>
                <td><Form.Control size="sm" type="number" step="0.01" value={r.gmv || ''} onChange={e => updRow('gmv_max', i, { gmv: num(e.target.value) })} /></td>
                <td><Form.Control size="sm" value={r.notes} onChange={e => updRow('gmv_max', i, { notes: e.target.value })} /></td>
                <td><Button size="sm" variant="outline-danger" onClick={() => delRow('gmv_max', i)}><i className="bi bi-trash" /></Button></td>
              </tr>
            ))}
          </tbody>
        </Table>
      </DynamicSection>

      {/* Product Highlights */}
      <DynamicSection
        title="Product Highlights"
        onAdd={() => addRow('product_highlights', emptyProduct)}
        empty={c.product_highlights.length === 0}
      >
        <Table size="sm" className="mb-0 align-middle">
          <thead><tr>
            <th style={{width:200}}>Product ID</th><th>Product Name</th><th style={{width:110}}>Units</th>
            <th style={{width:140}}>GMV ($)</th><th style={{width:120}}>New Videos</th><th>Notes</th><th style={{width:50}}></th>
          </tr></thead>
          <tbody>
            {c.product_highlights.map((r, i) => (
              <tr key={i}>
                <td><Form.Control size="sm" value={r.product_id} onChange={e => updRow('product_highlights', i, { product_id: e.target.value })} /></td>
                <td><Form.Control size="sm" value={r.product_name} onChange={e => updRow('product_highlights', i, { product_name: e.target.value })} /></td>
                <td><Form.Control size="sm" type="number" value={r.units_sold || ''} onChange={e => updRow('product_highlights', i, { units_sold: num(e.target.value) })} /></td>
                <td><Form.Control size="sm" type="number" step="0.01" value={r.gmv || ''} onChange={e => updRow('product_highlights', i, { gmv: num(e.target.value) })} /></td>
                <td><Form.Control size="sm" type="number" value={r.new_videos || ''} onChange={e => updRow('product_highlights', i, { new_videos: num(e.target.value) })} /></td>
                <td><Form.Control size="sm" value={r.notes} onChange={e => updRow('product_highlights', i, { notes: e.target.value })} /></td>
                <td><Button size="sm" variant="outline-danger" onClick={() => delRow('product_highlights', i)}><i className="bi bi-trash" /></Button></td>
              </tr>
            ))}
          </tbody>
        </Table>
      </DynamicSection>

      {/* Insights */}
      <Card className="mb-4">
        <Card.Header className="fw-semibold">Insights</Card.Header>
        <Card.Body>
          <Form.Control as="textarea" rows={8} placeholder="Write your insights for this week…"
            value={c.insights.summary}
            onChange={e => setC({ ...c, insights: { ...c.insights, summary: e.target.value } })} />
        </Card.Body>
      </Card>

      <div className="d-flex justify-content-end gap-2 mb-4">
        <Button variant="outline-secondary" onClick={() => nav('/reporting/weekly')}>Cancel</Button>
        <Button variant="outline-primary" disabled={saving} onClick={(e) => submit(e as any, 'draft')}>Save draft</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save & view dashboard'}</Button>
      </div>
    </Form>
  );
}

function DynamicSection({ title, onAdd, empty, children }: { title: string; onAdd: () => void; empty: boolean; children: React.ReactNode }) {
  return (
    <Card className="mb-4">
      <Card.Header className="d-flex justify-content-between align-items-center">
        <span className="fw-semibold">{title}</span>
        <Button size="sm" onClick={onAdd}><i className="bi bi-plus-lg me-1" />Add row</Button>
      </Card.Header>
      <Card.Body className="p-2">
        {empty
          ? <p className="text-muted text-center mb-0 py-3 small">No rows yet — click "Add row".</p>
          : children}
      </Card.Body>
    </Card>
  );
}
