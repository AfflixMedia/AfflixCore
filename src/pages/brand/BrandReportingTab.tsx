import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Table, Spinner, Alert, Badge, Form, Button } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import { formatRange } from '../../lib/dates';

interface Brand {
  id: string;
  name: string;
  share_enabled: boolean;
}
interface Report {
  id: string;
  brand_id: string;
  week_start: string;
  week_end: string;
  week_number: number;
  status: string;
  is_shared: boolean;
  created_at: string;
}

export default function BrandReportingTab({
  brand, isBob, onShareEnabledChanged,
}: {
  brand: Brand;
  isBob: boolean;
  onShareEnabledChanged: (next: boolean) => void;
}) {
  const nav = useNavigate();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [savingShare, setSavingShare] = useState(false);

  const load = async () => {
    setLoading(true); setErr(null);
    const { data, error } = await supabase.from('weekly_reports')
      .select('id,brand_id,week_start,week_end,week_number,status,is_shared,created_at')
      .eq('brand_id', brand.id)
      .order('week_start', { ascending: false });
    if (error) setErr(error.message);
    else setReports((data as Report[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [brand.id]);

  const toggleBrandShare = async (next: boolean) => {
    setSavingShare(true);
    const { error } = await supabase.from('brands')
      .update({ share_enabled: next }).eq('id', brand.id);
    setSavingShare(false);
    if (error) { alert(error.message); return; }
    onShareEnabledChanged(next);
  };

  const toggleReportShare = async (r: Report, next: boolean) => {
    const prev = reports;
    setReports(reports.map(x => x.id === r.id ? { ...x, is_shared: next } : x));
    const { error } = await supabase.from('weekly_reports')
      .update({ is_shared: next }).eq('id', r.id);
    if (error) {
      alert(error.message);
      setReports(prev);
    }
  };

  return (
    <>
      <Card className="mb-3">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-start flex-wrap gap-2">
            <div>
              <div className="fw-semibold">Client sharing for {brand.name}</div>
              <div className="text-muted small">
                Master switch — when off, this brand can't be added to any client share link.
                When on, also pick which weeks are shareable below.
              </div>
            </div>
            <Form.Check
              type="switch"
              id="brand-share-master"
              disabled={!isBob || savingShare}
              checked={!!brand.share_enabled}
              onChange={e => toggleBrandShare(e.target.checked)}
              label={brand.share_enabled ? 'Sharing enabled' : 'Sharing disabled'}
            />
          </div>
        </Card.Body>
      </Card>

      <Card>
        <Card.Body className="p-0">
          {loading ? <div className="text-center py-4"><Spinner animation="border" /></div>
            : err ? <div className="p-3"><Alert variant="danger">{err}</Alert></div>
            : reports.length === 0 ? (
              <p className="text-muted text-center py-4 mb-0">
                No weekly reports yet for {brand.name}. Create one from the Reporting menu.
              </p>
            ) : (
              <Table hover responsive className="align-middle mb-0">
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>Period</th>
                    <th>Status</th>
                    <th>Created</th>
                    {isBob && <th className="text-end" style={{ width: 200 }}>Share with client</th>}
                    <th style={{ width: 60 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map(r => (
                    <tr key={r.id} style={{ cursor: 'pointer' }}
                      onClick={() => nav(`/reporting/weekly/${r.id}`)}>
                      <td className="fw-semibold">#{r.week_number}</td>
                      <td>{formatRange(r.week_start, r.week_end)}</td>
                      <td><Badge bg={r.status === 'draft' ? 'secondary' : 'success'}>{r.status}</Badge></td>
                      <td><small className="text-muted">{new Date(r.created_at).toLocaleDateString()}</small></td>
                      {isBob && (
                        <td className="text-end" onClick={e => e.stopPropagation()}>
                          {!brand.share_enabled ? (
                            <span className="text-muted small">enable master switch</span>
                          ) : (
                            <Form.Check
                              type="switch"
                              id={`r-share-${r.id}`}
                              checked={r.is_shared}
                              onChange={e => toggleReportShare(r, e.target.checked)}
                              label={r.is_shared ? 'Shareable' : 'Not shared'}
                            />
                          )}
                        </td>
                      )}
                      <td className="text-end">
                        <Button size="sm" variant="outline-primary" onClick={e => { e.stopPropagation(); nav(`/reporting/weekly/${r.id}`); }}>
                          <i className="bi bi-eye" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
        </Card.Body>
      </Card>
    </>
  );
}
