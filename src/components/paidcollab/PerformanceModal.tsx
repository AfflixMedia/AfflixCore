import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Modal, Button, Form, Alert, Spinner, Badge } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import { PerformancePeriod, fmtMoney, fmtNumber } from '../../lib/paidCollabSchema';
import { addDays, fromISO, toISO } from '../../lib/dates';
import NumberInput from '../NumberInput';

// Generic performance entry — works for both creator and video performance.
interface PerfEntry {
  id: string;
  /** creator_id (or video_id) on the row — needed when siblings are shown. */
  entity_id: string;
  period_type: PerformancePeriod;
  period_start: string;
  gmv: number;
  items_sold: number;
  notes: string | null;
}

interface Props {
  /** Display name for the modal title (creator or video label). */
  entityLabel: string;
  /** 'paid_creator_performance' | 'paid_video_performance' */
  perfTable: 'paid_creator_performance' | 'paid_video_performance';
  /** FK column on the perf table — 'creator_id' | 'video_id' */
  fkColumn: 'creator_id' | 'video_id';
  /** The creator/video row id we're editing FROM. New entries are inserted
   *  with this entityId; viewing pulls from siblingEntityIds when set. */
  entityId: string;
  /**
   * All entity_ids that should appear in the listing. For creators this is
   * every brand row that shares the same identity (handle/name); the result
   * is a merged cross-program view. Defaults to [entityId] when unset.
   */
  siblingEntityIds?: string[];
  /** Optional creator_id → program label map. When provided AND siblings span
   *  more than one program, a Program column is added to the table. */
  programLabelByEntityId?: Map<string, string>;
  /** Table that holds weekly_perf_anchor for this entity. */
  anchorTable: 'paid_creators' | 'paid_creator_videos';
  /** Current weekly anchor (or null). */
  anchorValue: string | null;
  currency: string;
  canEdit: boolean;
  onClose: () => void;
  onAnchorSet: (anchor: string) => void;
}

function weekLabel(start: string) {
  const end = addDays(start, 6);
  const s = fromISO(start), e = fromISO(end);
  return `${s.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${e.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
function monthLabel(start: string) {
  const [y, m] = start.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}
function currentMonthYm() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function PerformanceModal({
  entityLabel, perfTable, fkColumn, entityId, siblingEntityIds, programLabelByEntityId,
  anchorTable, anchorValue,
  currency, canEdit, onClose, onAnchorSet,
}: Props) {
  // Which IDs to fetch performance for. Always includes entityId; siblings are
  // the other brand rows that share this creator's identity.
  const fetchIds = useMemo(() => {
    const s = new Set<string>([entityId]);
    (siblingEntityIds ?? []).forEach(id => s.add(id));
    return [...s];
  }, [entityId, siblingEntityIds]);
  const [tab, setTab] = useState<PerformancePeriod>('weekly');
  const [entries, setEntries] = useState<PerfEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<string | null>(anchorValue);

  const [editing, setEditing] = useState<PerfEntry | null>(null);
  const [adding, setAdding] = useState(false);
  const [fAnchor, setFAnchor] = useState('');
  const [fMonth, setFMonth] = useState('');
  const [fGmv, setFGmv] = useState(0);
  const [fItems, setFItems] = useState(0);
  const [fNotes, setFNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true); setErr(null);
      const { data, error } = await supabase
        .from(perfTable)
        .select('*')
        .in(fkColumn, fetchIds)
        .order('period_start', { ascending: false });
      if (error) { setErr(error.message); setLoading(false); return; }
      setEntries(((data ?? []) as any[]).map(r => ({
        id: r.id,
        entity_id: r[fkColumn],
        period_type: r.period_type,
        gmv: Number(r.gmv ?? 0),
        items_sold: Number(r.items_sold ?? 0),
        notes: r.notes ?? null,
        period_start: typeof r.period_start === 'string' ? r.period_start.slice(0, 10) : r.period_start,
      })));
      setLoading(false);
    })();
  }, [perfTable, fkColumn, fetchIds.join(',')]);

  const weekly = useMemo(() => entries.filter(e => e.period_type === 'weekly'), [entries]);
  const monthly = useMemo(() => entries.filter(e => e.period_type === 'monthly'), [entries]);
  const list = tab === 'weekly' ? weekly : monthly;
  // Show the Program column only when entries span more than one program
  // (i.e. the same creator was recorded across multiple programs in the brand).
  const showProgramColumn = useMemo(() => {
    if (!programLabelByEntityId || fetchIds.length <= 1) return false;
    const seen = new Set(entries.map(e => e.entity_id));
    return seen.size > 1;
  }, [entries, programLabelByEntityId, fetchIds.length]);

  const nextWeekStart = useMemo(() => {
    if (!anchor) return null;
    const taken = new Set(weekly.map(w => w.period_start));
    let start = anchor;
    while (taken.has(start)) start = addDays(start, 7);
    return start;
  }, [anchor, weekly]);

  const openAdd = () => {
    setEditing(null);
    setFGmv(0); setFItems(0); setFNotes(''); setFormErr(null);
    if (tab === 'weekly') setFAnchor(anchor ?? toISO(new Date()));
    else setFMonth(currentMonthYm());
    setAdding(true);
  };
  const openEdit = (e: PerfEntry) => {
    setEditing(e);
    setFGmv(Number(e.gmv) || 0);
    setFItems(Number(e.items_sold) || 0);
    setFNotes(e.notes ?? '');
    setFormErr(null);
    setAdding(true);
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true); setFormErr(null);
    try {
      if (editing) {
        const { data, error } = await supabase.from(perfTable)
          .update({ gmv: fGmv, items_sold: fItems, notes: fNotes.trim() || null })
          .eq('id', editing.id).select('*').single();
        if (error) throw error;
        const d = data as any;
        setEntries(prev => prev.map(x => x.id === editing.id
          ? { ...x, gmv: Number(d.gmv), items_sold: Number(d.items_sold), notes: d.notes ?? null }
          : x));
      } else {
        let periodStart: string;
        let setAnchorTo: string | null = null;
        if (tab === 'weekly') {
          if (!anchor) {
            if (!fAnchor) throw new Error('Pick the anchor date for the first week.');
            periodStart = fAnchor;
            setAnchorTo = fAnchor;
          } else {
            periodStart = nextWeekStart!;
          }
        } else {
          if (!fMonth) throw new Error('Pick a month.');
          periodStart = `${fMonth}-01`;
          if (monthly.some(m => m.period_start === periodStart)) {
            throw new Error('A performance entry for that month already exists.');
          }
        }
        const { data, error } = await supabase.from(perfTable)
          .insert({
            [fkColumn]: entityId,
            period_type: tab,
            period_start: periodStart,
            gmv: fGmv,
            items_sold: fItems,
            notes: fNotes.trim() || null,
          })
          .select('*').single();
        if (error) throw error;
        const d = data as any;
        setEntries(prev => [{
          id: d.id,
          entity_id: d[fkColumn],
          period_type: d.period_type,
          gmv: Number(d.gmv),
          items_sold: Number(d.items_sold),
          notes: d.notes ?? null,
          period_start: typeof d.period_start === 'string' ? d.period_start.slice(0, 10) : d.period_start,
        }, ...prev]);
        if (setAnchorTo) {
          const { error: aErr } = await supabase.from(anchorTable)
            .update({ weekly_perf_anchor: setAnchorTo }).eq('id', entityId);
          if (aErr) throw aErr;
          setAnchor(setAnchorTo);
          onAnchorSet(setAnchorTo);
        }
      }
      setAdding(false);
    } catch (e: any) {
      setFormErr(e?.message ?? 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (e: PerfEntry) => {
    const label = e.period_type === 'weekly' ? weekLabel(e.period_start) : monthLabel(e.period_start);
    if (!confirm(`Delete the ${e.period_type} entry for ${label}?`)) return;
    const { error } = await supabase.from(perfTable).delete().eq('id', e.id);
    if (error) { alert(error.message); return; }
    setEntries(prev => prev.filter(x => x.id !== e.id));
  };

  const periodLabel = (e: PerfEntry) =>
    e.period_type === 'weekly' ? weekLabel(e.period_start) : monthLabel(e.period_start);

  return (
    <Modal show onHide={onClose} centered size="lg" scrollable>
      <Modal.Header closeButton>
        <Modal.Title>
          <i className="bi bi-graph-up-arrow me-2 text-primary" />
          {entityLabel} — performance
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="wr-tabs mb-3">
          <button className={`wr-tab ${tab === 'weekly' ? 'is-active' : ''}`}
            onClick={() => { setTab('weekly'); setAdding(false); }}>
            <i className="bi bi-calendar-week me-1" /> Weekly
            <span className="wr-tab-count">{weekly.length}</span>
          </button>
          <button className={`wr-tab ${tab === 'monthly' ? 'is-active' : ''}`}
            onClick={() => { setTab('monthly'); setAdding(false); }}>
            <i className="bi bi-calendar-month me-1" /> Monthly
            <span className="wr-tab-count">{monthly.length}</span>
          </button>
        </div>

        {loading ? (
          <div className="text-center py-4"><Spinner animation="border" /></div>
        ) : err ? (
          <Alert variant="danger">{err}</Alert>
        ) : adding && canEdit ? (
          <Form onSubmit={submit}>
            {formErr && <Alert variant="danger">{formErr}</Alert>}
            {!editing && tab === 'weekly' && !anchor && (
              <Form.Group className="mb-2">
                <Form.Label>Anchor date <small className="text-muted fw-normal">— start of the first tracked week</small></Form.Label>
                <Form.Control type="date" value={fAnchor} onChange={e => setFAnchor(e.target.value)} required />
                {fAnchor && (
                  <Form.Text className="text-muted">
                    First week covers <strong>{weekLabel(fAnchor)}</strong>. Future weeks advance automatically by 7 days.
                  </Form.Text>
                )}
              </Form.Group>
            )}
            {!editing && tab === 'weekly' && anchor && (
              <Alert variant="info" className="py-2">
                <i className="bi bi-calendar-week me-1" />
                Recording week <strong>{weekLabel(nextWeekStart!)}</strong> (auto-advanced from the anchor).
              </Alert>
            )}
            {!editing && tab === 'monthly' && (
              <Form.Group className="mb-2">
                <Form.Label>Month</Form.Label>
                <Form.Control type="month" value={fMonth} onChange={e => setFMonth(e.target.value)} required />
              </Form.Group>
            )}
            {editing && (
              <Alert variant="info" className="py-2">
                Editing <strong>{periodLabel(editing)}</strong>
              </Alert>
            )}
            <div className="row g-2">
              <Form.Group className="col-md-6 mb-2">
                <Form.Label>GMV ({currency})</Form.Label>
                <NumberInput min={0} step="0.01" value={fGmv} onChange={setFGmv} />
              </Form.Group>
              <Form.Group className="col-md-6 mb-2">
                <Form.Label>Items sold</Form.Label>
                <NumberInput min={0} value={fItems} onChange={setFItems} />
              </Form.Group>
            </div>
            <Form.Group className="mb-2">
              <Form.Label>Notes <small className="text-muted fw-normal">(optional)</small></Form.Label>
              <Form.Control as="textarea" rows={2} value={fNotes} onChange={e => setFNotes(e.target.value)} />
            </Form.Group>
            <div className="d-flex justify-content-end gap-2 mt-3">
              <Button variant="secondary" onClick={() => setAdding(false)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Saving…' : (editing ? 'Save' : 'Add entry')}
              </Button>
            </div>
          </Form>
        ) : (
          <>
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="text-muted small">
                {list.length} {tab} {list.length === 1 ? 'entry' : 'entries'}
              </div>
              {canEdit && (
                <Button size="sm" onClick={openAdd}>
                  <i className="bi bi-plus-lg me-1" />
                  Add {tab === 'weekly' ? 'week' : 'month'}
                </Button>
              )}
            </div>
            {list.length === 0 ? (
              <div className="text-muted text-center py-4 small">
                No {tab} performance recorded yet.
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table table-hover align-middle mb-0">
                  <thead className="small text-uppercase text-muted">
                    <tr>
                      <th>{tab === 'weekly' ? 'Week' : 'Month'}</th>
                      {showProgramColumn && <th>Program</th>}
                      <th>GMV</th>
                      <th>Items sold</th>
                      <th>Notes</th>
                      {canEdit && <th className="text-end"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {list.map(e => (
                      <tr key={e.id}>
                        <td className="fw-semibold">{periodLabel(e)}</td>
                        {showProgramColumn && (
                          <td className="small">
                            <Badge bg="light" text="dark" className="border">
                              <i className="bi bi-collection me-1" />
                              {programLabelByEntityId?.get(e.entity_id) ?? '—'}
                            </Badge>
                          </td>
                        )}
                        <td><span className="text-success fw-semibold">{fmtMoney(e.gmv, currency)}</span></td>
                        <td>{fmtNumber(e.items_sold)}</td>
                        <td className="text-muted small" style={{ maxWidth: 220 }}>
                          <div className="text-truncate" title={e.notes ?? ''}>{e.notes ?? '—'}</div>
                        </td>
                        {canEdit && (
                          <td className="text-end">
                            <Button size="sm" variant="outline-secondary" onClick={() => openEdit(e)} title="Edit">
                              <i className="bi bi-pencil" />
                            </Button>
                            <Button size="sm" variant="outline-danger" className="ms-1" onClick={() => remove(e)} title="Delete">
                              <i className="bi bi-trash" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {tab === 'weekly' && anchor && (
              <div className="text-muted small mt-2">
                <i className="bi bi-info-circle me-1" />
                Week anchor: <Badge bg="light" text="dark" className="border">{weekLabel(anchor)}</Badge>
                {' '}— new weeks advance 7 days automatically.
              </div>
            )}
          </>
        )}
      </Modal.Body>
      {!adding && (
        <Modal.Footer>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </Modal.Footer>
      )}
    </Modal>
  );
}
