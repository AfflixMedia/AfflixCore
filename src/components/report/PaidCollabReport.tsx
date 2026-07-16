import { Form } from 'react-bootstrap';
import type { HandlerCreator } from '../../pages/handler-collab/store';
import {
  CreatorListHeadRO, CreatorStatusGroupsRO, Kpi,
  clientStatus, isPendingVisible, monthKey, monthLabel, fmt$, STATUS,
} from '../../pages/paid-collab/handlerCollabReadonly';
import type { PaidCollabData } from '../../lib/reportSchemaV3';
import RichTextEditor from '../RichTextEditor';
import { sanitizeRich } from '../../lib/sanitize';

// A creator's "program month" is the month they were onboarded (handler-collab has
// no program row — a program is the brand+month pair).
const creatorMonth = (c: HandlerCreator) => monthKey(c.onboarded_on);

function monthsOf(creators: HandlerCreator[]): string[] {
  const s = new Set<string>();
  creators.forEach(c => { const m = creatorMonth(c); if (m) s.add(m); });
  return [...s].sort().reverse();
}

// Apply the report's month + pending-only filters to the live roster.
function filterCreators(creators: HandlerCreator[], data: PaidCollabData): HandlerCreator[] {
  let out = data.month ? creators.filter(c => creatorMonth(c) === data.month) : creators;
  if (data.pending_only) out = out.filter(isPendingVisible);
  return out;
}

// ── Dashboard view (staff + client). onMarkPaid present ⇒ client can settle a
//    pending payout (reuses the shared CreatorRowRO "mark as paid" panel). ─────
export function PaidCollabViz({ data, creators, onMarkPaid, isClient }: {
  data: PaidCollabData;
  creators: HandlerCreator[];
  onMarkPaid?: (creatorId: string, confirmed: boolean) => Promise<void> | void;
  isClient: boolean;
}) {
  const shown = filterCreators(creators, data);
  const introHtml = sanitizeRich(data.intro);
  const hasIntro = introHtml.replace(/<[^>]*>/g, '').trim().length > 0;

  if (shown.length === 0) {
    return (
      <div className="v3-paidcollab">
        {hasIntro && <div className="s14-card mb-3"><div className="ac-rte-view" dangerouslySetInnerHTML={{ __html: introHtml }} /></div>}
        <div className="s14-empty">
          No paid-collab creators to show{data.month ? ` for ${monthLabel(data.month)}` : ''}
          {data.pending_only ? ' (payment-pending only)' : ''}.
        </div>
      </div>
    );
  }

  const totalPayout = shown.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const pendingCount = shown.filter(isPendingVisible).length;
  const paidCount = shown.filter(c => clientStatus(c) === 'paid').length;
  const confirmedCount = shown.filter(c => !!c.client_paid_confirmed_at).length;
  // Notes the account manager wrote about specific creators shown here.
  const noted = shown.filter(c => (data.notes?.[c.id] ?? '').trim().length > 0);

  return (
    <div className="v3-paidcollab">
      {hasIntro && (
        <div className="s14-card mb-3"><div className="ac-rte-view" dangerouslySetInnerHTML={{ __html: introHtml }} /></div>
      )}

      <div className="pc-kpis mb-3">
        <Kpi label="Creators" color="#6366F1" value={String(shown.length)} sub={data.month ? monthLabel(data.month) : 'all months'} />
        <Kpi label="Payment pending" color="#E8862E" value={String(pendingCount)} sub={confirmedCount > 0 ? `${confirmedCount} marked paid by you` : 'awaiting payout'} />
        <Kpi label="Total payout" color="#0EA5E9" value={fmt$(totalPayout)} sub="across shown creators" />
        <Kpi label="Payment sent" color="#198754" value={String(paidCount)} sub="finalised by the team" />
      </div>

      <div className="pc-card pc-list">
        <CreatorListHeadRO />
        <CreatorStatusGroupsRO creators={shown} onConfirmPaid={isClient ? onMarkPaid : undefined} />
      </div>

      {noted.length > 0 && (
        <div className="s14-card mt-3">
          <div className="s14-kpi-label mb-2">Notes from your account manager</div>
          <div className="v3-pc-notes">
            {noted.map(c => (
              <div className="v3-pc-note" key={c.id}>
                <span className="v3-pc-note-who">
                  <span className={`pc-statusdot ${(STATUS[clientStatus(c)] || STATUS.videos_in_progress).cls}`} />
                  {c.name}
                </span>
                <span className="v3-pc-note-body">{data.notes[c.id]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Editor body (staff). Toggle + month/program picker + pending filter + intro
//    rich text + a per-creator note field for each creator that will be shown. ──
export function PaidCollabEditorBody({ data, creators, onChange }: {
  data: PaidCollabData;
  creators: HandlerCreator[];
  onChange: (patch: Partial<PaidCollabData>) => void;
}) {
  const months = monthsOf(creators);
  const shown = filterCreators(creators, data);
  const setNote = (id: string, text: string) => onChange({ notes: { ...(data.notes ?? {}), [id]: text } });

  return (
    <div className="v3-pc-editor">
      <Form.Check
        type="switch"
        id="pc-enabled"
        className="fw-semibold mb-1"
        label="Include Paid Collaborations in this report"
        checked={data.enabled}
        onChange={e => onChange({ enabled: e.target.checked })}
      />
      <Form.Text className="text-muted d-block mb-3">
        Shows the brand's paid-collab creators live from the workspace (status stays current), highlights
        payment-pending payouts, and lets the client mark them as paid from the shared report.
      </Form.Text>

      {data.enabled && (
        <>
          <div className="row g-3 align-items-end mb-3">
            <div className="col-sm-5">
              <Form.Label className="small fw-semibold">Program (month)</Form.Label>
              <Form.Select value={data.month ?? ''} onChange={e => onChange({ month: e.target.value || null })}>
                <option value="">All months</option>
                {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </Form.Select>
            </div>
            <div className="col-sm-7">
              <Form.Check
                type="checkbox"
                id="pc-pending-only"
                label="Show only payment-pending creators"
                checked={data.pending_only}
                onChange={e => onChange({ pending_only: e.target.checked })}
              />
            </div>
          </div>

          <Form.Label className="small fw-semibold">Note for the client (optional)</Form.Label>
          <RichTextEditor
            value={data.intro}
            onChange={html => onChange({ intro: html })}
            placeholder="e.g. Two payouts are ready to process this week — please settle via PayPal and mark them paid below."
            minHeight={140}
          />

          <div className="small fw-semibold text-muted mt-3 mb-2">
            {creators.length === 0
              ? 'No paid-collab creators for this brand yet.'
              : `${shown.length} creator${shown.length === 1 ? '' : 's'} will appear in the report`}
            {creators.length === 0 && <span className="fw-normal"> — add them in Brand → Paid Collab.</span>}
          </div>
          {shown.map(c => {
            const st = STATUS[clientStatus(c)] || STATUS.videos_in_progress;
            return (
              <div className="v3-pc-erow" key={c.id}>
                <div className="v3-pc-erow-head">
                  <span className="fw-semibold">{c.name}</span>
                  <span className={`pc-badge ${st.cls}`}><span className="dot" />{st.label}</span>
                  <span className="text-muted small ms-auto">{fmt$(Number(c.amount) || 0)}</span>
                </div>
                <Form.Control
                  size="sm"
                  placeholder="Note about this creator (optional) — shown to the client"
                  value={data.notes?.[c.id] ?? ''}
                  onChange={e => setNote(c.id, e.target.value)}
                />
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
