import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Card, Form, Button, Row, Col, Table, Modal, Spinner, Alert } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import { addDays, formatRange, toISO, fromISO } from '../../lib/dates';
import NumberInput from '../../components/NumberInput';

/** Days between two ISO dates (b - a). */
function daysDiff(a: string, b: string): number {
  return Math.round((fromISO(b).getTime() - fromISO(a).getTime()) / 86400000);
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

interface MonthRow {
  id?: string;
  brand_id: string;
  month: string;
  allocated_budget: number;
  spend_to_date: number;
}
interface WeekRow {
  id?: string;
  brand_id: string;
  week_start: string;
  week_end: string;
  ad_spend: number;
  roi: number;
  orders: number;
  cpo: number;
  gmv: number;
  notes: string;
}

const emptyMonth = (brandId: string, month: string): MonthRow => ({
  brand_id: brandId, month, allocated_budget: 0, spend_to_date: 0,
});
const emptyWeek = (brandId: string, week_start: string): WeekRow => ({
  brand_id: brandId, week_start, week_end: addDays(week_start, 6),
  ad_spend: 0, roi: 0, orders: 0, cpo: 0, gmv: 0, notes: '',
});

export default function BrandGmvMaxTab({ brandId, canEdit }: { brandId: string; canEdit: boolean }) {
  const [month, setMonth] = useState<string>(currentMonth());
  const [monthRow, setMonthRow] = useState<MonthRow>(emptyMonth(brandId, month));
  const [weeks, setWeeks] = useState<WeekRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [savingMonth, setSavingMonth] = useState(false);
  // Allocated budget is locked once a month row is saved — click Update to edit.
  const [editBudget, setEditBudget] = useState(false);
  // Weekly-report anchor for this brand — GMV Max weeks sync to this cycle.
  const [anchor, setAnchor] = useState<string | null>(null);
  // Every GMV Max week_start for this brand (used to suggest the next week).
  const [allWeekStarts, setAllWeekStarts] = useState<Set<string>>(new Set());

  // Week editor modal
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<WeekRow | null>(null);
  const [draft, setDraft] = useState<WeekRow>(emptyWeek(brandId, ''));
  const [savingWeek, setSavingWeek] = useState(false);

  const monthRange = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const first = toISO(new Date(y, m - 1, 1));
    const last  = toISO(new Date(y, m, 0));
    return { first, last };
  }, [month]);

  const load = async () => {
    setLoading(true); setErr(null);
    // A week belongs to the month if its [start,end] range OVERLAPS the month —
    // so a week that spans a month boundary shows up in BOTH months.
    const [m, w, anchorRes, allW] = await Promise.all([
      supabase.from('brand_gmv_max_monthly').select('*').eq('brand_id', brandId).eq('month', month).maybeSingle(),
      supabase.from('brand_gmv_max_weekly').select('*').eq('brand_id', brandId)
        .lte('week_start', monthRange.last).gte('week_end', monthRange.first)
        .order('week_start', { ascending: true }),
      supabase.from('brand_report_settings').select('weekly_anchor').eq('brand_id', brandId).maybeSingle(),
      supabase.from('brand_gmv_max_weekly').select('week_start').eq('brand_id', brandId),
    ]);
    if (m.error && !m.error.message?.includes('does not exist')) setErr(m.error.message);
    else if (m.error) setErr('Run schema_brand_detail.sql in Supabase to enable GMV Max.');
    else setMonthRow((m.data as MonthRow) ?? emptyMonth(brandId, month));
    if (w.error && !err) setErr(w.error.message);
    else setWeeks((w.data as WeekRow[]) ?? []);
    setAnchor((anchorRes.data as any)?.weekly_anchor ?? null);
    setAllWeekStarts(new Set(((allW.data as any[]) ?? []).map(r =>
      typeof r.week_start === 'string' ? r.week_start.slice(0, 10) : r.week_start)));
    setEditBudget(false);
    setLoading(false);
  };
  useEffect(() => { load(); }, [brandId, month]);

  const saveMonth = async () => {
    setSavingMonth(true); setErr(null);
    // spend_to_date is auto-calculated from the weekly entries.
    const spendToDate = weeks.reduce((s, w) => s + (w.ad_spend ?? 0), 0);
    const payload = {
      brand_id: brandId,
      month,
      allocated_budget: monthRow.allocated_budget,
      spend_to_date: spendToDate,
    };
    const res = await supabase.from('brand_gmv_max_monthly')
      .upsert(payload, { onConflict: 'brand_id,month' }).select().single();
    setSavingMonth(false);
    if (res.error) { setErr(res.error.message); return; }
    setMonthRow(res.data as MonthRow);
    setEditBudget(false);
  };

  // Next GMV Max week aligned to the weekly-report cycle (anchor + 7n),
  // skipping weeks that already have an entry.
  const nextAnchoredWeek = (): string => {
    if (!anchor) return monthRange.first;
    let s = anchor;
    while (allWeekStarts.has(s)) s = addDays(s, 7);
    return s;
  };

  const openAddWeek = () => {
    setEditing(null);
    setDraft(emptyWeek(brandId, nextAnchoredWeek()));
    setErr(null); setShow(true);
  };
  const openEditWeek = (w: WeekRow) => {
    setEditing(w);
    setDraft({ ...w });
    setErr(null); setShow(true);
  };
  const onWeekStartChange = (s: string) => {
    // GMV Max weeks must line up with the brand's weekly-report cycle so the
    // weekly report can later pull that week's GMV data. Warn on off-cycle dates.
    if (s && anchor && daysDiff(anchor, s) % 7 !== 0) {
      const ok = window.confirm(
        `GMV Max weeks should stay in sync with this brand's weekly report cycle ` +
        `(weeks starting from ${anchor}). Picking an off-cycle date breaks that ` +
        `alignment and the weekly report won't be able to pull this week's data.\n\n` +
        `Use this date anyway?`,
      );
      if (!ok) return;
    }
    setDraft({ ...draft, week_start: s, week_end: s ? addDays(s, 6) : '' });
  };

  const submitWeek = async (e: FormEvent) => {
    e.preventDefault();
    setSavingWeek(true); setErr(null);
    const payload: any = { ...draft };
    delete payload.id;
    const res = editing?.id
      ? await supabase.from('brand_gmv_max_weekly').update(payload).eq('id', editing.id).select().single()
      : await supabase.from('brand_gmv_max_weekly').insert(payload).select().single();
    setSavingWeek(false);
    if (res.error) { setErr(res.error.message); return; }
    setShow(false);
    load();
  };

  const removeWeek = async (w: WeekRow) => {
    if (!w.id) return;
    if (!confirm(`Delete weekly entry for ${formatRange(w.week_start, w.week_end)}?`)) return;
    const prev = weeks;
    setWeeks(weeks.filter(x => x.id !== w.id));
    const { error } = await supabase.from('brand_gmv_max_weekly').delete().eq('id', w.id);
    if (error) { alert(error.message); setWeeks(prev); }
  };

  const totalSpend = weeks.reduce((s, w) => s + (w.ad_spend ?? 0), 0);
  const totalGmv   = weeks.reduce((s, w) => s + (w.gmv ?? 0), 0);
  const remaining  = (monthRow.allocated_budget ?? 0) - totalSpend;
  // Allocated budget is read-only once the month row is saved, until Update.
  const budgetLocked = !!monthRow.id && !editBudget;
  // Period covered by the spend — first week start to last week end.
  const spendPeriod = weeks.length
    ? formatRange(weeks[0].week_start, weeks[weeks.length - 1].week_end)
    : null;

  return (
    <>
      <Card className="mb-3">
        <Card.Body>
          <Row className="g-3 align-items-start">
            <Col md={3}>
              <Form.Label className="fw-bold">Month</Form.Label>
              <Form.Control type="month" value={month} onChange={e => setMonth(e.target.value)} />
            </Col>
            <Col md={3}>
              <Form.Label className="fw-bold">Allocated budget ($)</Form.Label>
              <NumberInput step="0.01" disabled={!canEdit || budgetLocked} value={monthRow.allocated_budget}
                onChange={n => setMonthRow({ ...monthRow, allocated_budget: n })} />
            </Col>
            <Col md={3}>
              <Form.Label className="fw-bold d-flex justify-content-between align-items-baseline">
                <span>Spend to date ($)</span>
                {spendPeriod && <small className="fw-normal text-muted">{spendPeriod}</small>}
              </Form.Label>
              <NumberInput step="0.01" disabled value={totalSpend} onChange={() => {}} />
              <Form.Text className="text-muted">Auto-calculated from weekly entries.</Form.Text>
            </Col>
            <Col md={3} className="d-flex flex-column">
              {/* spacer keeps the button level with the inputs above */}
              <div className="invisible d-none d-md-block" aria-hidden>
                <Form.Label className="fw-bold">&nbsp;</Form.Label>
              </div>
              {budgetLocked ? (
                <Button className="w-100" variant="outline-primary" disabled={!canEdit}
                  onClick={() => setEditBudget(true)}>
                  Update
                </Button>
              ) : (
                <Button className="w-100" disabled={!canEdit || savingMonth} onClick={saveMonth}>
                  {savingMonth ? 'Saving…' : 'Save monthly budget'}
                </Button>
              )}
            </Col>
          </Row>
          <Row className="g-3 mt-1">
            <Col md={3}><MiniStat label="Allocated" value={`$${monthRow.allocated_budget.toLocaleString()}`} /></Col>
            <Col md={3}><MiniStat label="Spend" value={`$${totalSpend.toLocaleString()}`} /></Col>
            <Col md={3}><MiniStat label="Remaining" value={`$${remaining.toLocaleString()}`} variant={remaining < 0 ? 'danger' : 'success'} /></Col>
            <Col md={3}><MiniStat label="GMV (sum of weeks)" value={`$${totalGmv.toLocaleString()}`} /></Col>
          </Row>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <div>
            <span className="fw-semibold">Weekly entries</span>
            <small className="text-muted ms-2">
              Weeks within {month}. Spend total this view: ${totalSpend.toLocaleString()}.
            </small>
          </div>
          {canEdit && (
            <Button size="sm" onClick={openAddWeek}>
              <i className="bi bi-plus-lg me-1" /> Add weekly entry
            </Button>
          )}
        </Card.Header>
        <Card.Body className="p-0">
          {loading ? <div className="text-center py-4"><Spinner animation="border" /></div>
            : err ? <div className="p-3"><Alert variant="danger">{err}</Alert></div>
            : weeks.length === 0 ? (
              <p className="text-muted text-center py-4 mb-0">No weekly entries for this month.</p>
            ) : (
              <Table size="sm" responsive className="align-middle mb-0">
                <thead>
                  <tr>
                    <th>Week start</th>
                    <th>Period</th>
                    <th className="text-end">Ad Spend</th>
                    <th className="text-end">ROI</th>
                    <th className="text-end">Orders</th>
                    <th className="text-end">CPO</th>
                    <th className="text-end">GMV</th>
                    <th>Notes</th>
                    {canEdit && <th style={{ width: 100 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {weeks.map(w => (
                    <tr key={w.id ?? w.week_start}>
                      <td className="fw-semibold">{w.week_start}</td>
                      <td><small className="text-muted">{formatRange(w.week_start, w.week_end)}</small></td>
                      <td className="text-end">${w.ad_spend.toLocaleString()}</td>
                      <td className="text-end">{w.roi.toFixed(2)}</td>
                      <td className="text-end">{w.orders.toLocaleString()}</td>
                      <td className="text-end">${w.cpo.toLocaleString()}</td>
                      <td className="text-end">${w.gmv.toLocaleString()}</td>
                      <td className="small text-muted">{w.notes}</td>
                      {canEdit && (
                        <td className="text-end">
                          <Button size="sm" variant="outline-primary" className="me-1" onClick={() => openEditWeek(w)}>
                            <i className="bi bi-pencil" />
                          </Button>
                          <Button size="sm" variant="outline-danger" onClick={() => removeWeek(w)}>
                            <i className="bi bi-trash" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
        </Card.Body>
      </Card>

      <Modal show={show} onHide={() => setShow(false)} centered size="lg">
        <Form onSubmit={submitWeek}>
          <Modal.Header closeButton>
            <Modal.Title>{editing ? 'Edit' : 'Add'} weekly GMV Max entry</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            <Row className="g-3">
              <Col md={4}>
                <Form.Label className="fw-bold">Week start</Form.Label>
                <Form.Control type="date" required disabled={!!editing}
                  value={draft.week_start} onChange={e => onWeekStartChange(e.target.value)} />
                <Form.Text className="text-muted">
                  {draft.week_start ? `Covers ${formatRange(draft.week_start, draft.week_end)}` : '7-day window starts here.'}
                </Form.Text>
              </Col>
              <Col md={4}>
                <Form.Label className="fw-bold">Ad Spend ($)</Form.Label>
                <NumberInput step="0.01" value={draft.ad_spend} onChange={n => setDraft({ ...draft, ad_spend: n })} />
              </Col>
              <Col md={4}>
                <Form.Label className="fw-bold">ROI</Form.Label>
                <NumberInput step="0.01" value={draft.roi} onChange={n => setDraft({ ...draft, roi: n })} />
              </Col>
              <Col md={4}>
                <Form.Label className="fw-bold">Orders</Form.Label>
                <NumberInput value={draft.orders} onChange={n => setDraft({ ...draft, orders: n })} />
              </Col>
              <Col md={4}>
                <Form.Label className="fw-bold">CPO ($)</Form.Label>
                <NumberInput step="0.01" value={draft.cpo} onChange={n => setDraft({ ...draft, cpo: n })} />
              </Col>
              <Col md={4}>
                <Form.Label className="fw-bold">GMV ($)</Form.Label>
                <NumberInput step="0.01" value={draft.gmv} onChange={n => setDraft({ ...draft, gmv: n })} />
              </Col>
              <Col md={12}>
                <Form.Label className="fw-bold">Notes</Form.Label>
                <Form.Control as="textarea" rows={2}
                  value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} />
              </Col>
            </Row>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={savingWeek}>Cancel</Button>
            <Button type="submit" disabled={savingWeek || !draft.week_start}>
              {savingWeek ? 'Saving…' : (editing ? 'Save' : 'Add entry')}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </>
  );
}

function MiniStat({ label, value, variant }: { label: string; value: string; variant?: 'success' | 'danger' }) {
  return (
    <div className="p-3 rounded h-100" style={{ background: '#f8fafc', border: '1px solid #e5e7eb' }}>
      <div className="text-muted fw-bold text-uppercase" style={{ letterSpacing: '.5px', fontSize: '.8rem' }}>{label}</div>
      <div className={`fs-5 fw-semibold mt-1 ${variant === 'danger' ? 'text-danger' : variant === 'success' ? 'text-success' : ''}`}>{value}</div>
    </div>
  );
}
