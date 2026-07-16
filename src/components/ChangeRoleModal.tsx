import { useEffect, useState } from 'react';
import { Alert, Button, Form, Modal } from 'react-bootstrap';
import { supabase } from '../lib/supabase';

export interface ChangeRoleTarget {
  id: string;
  email: string;
  full_name?: string | null;
  role: string;            // current role — pre-selected in the option list
  brand_count?: number;    // for the APC → Team Lead carry-over copy
  is_internal?: boolean;   // handlers only: current internal/external flag
}

const ROLE_OPTIONS = [
  { value: 'apc', label: 'APC', icon: 'bi-person-workspace', desc: 'Account manager — works the brands Bob or a Team Lead assigns them.' },
  { value: 'team_lead', label: 'Team Lead', icon: 'bi-diagram-3', desc: 'Middle manager — runs their own APCs and the brands you grant them.' },
  { value: 'ads_manager', label: 'Ads Manager', icon: 'bi-badge-ad', desc: 'View-only APC auto-assigned every GMV Max brand. Edits only GMV Max + video authorisation; keeps team Chats & Tasks.' },
  { value: 'paid_collab_handler', label: 'Paid Collab Handler', icon: 'bi-people', desc: 'Runs the paid-collab workspace for the brands you assign them.' },
  { value: 'paid_collab_client', label: 'Paid Collab Client', icon: 'bi-person-badge', desc: 'Client portal only — sees the paid-collab data for their brands.' },
];

/**
 * Bob-only "Change role" modal, shared by the APCs / Team Leads / Ads Managers /
 * Paid Collab Handlers / Paid Collab Clients pages. Calls the change_user_role
 * RPC, which is data-safe: authored rows (reports, comments, chats, notes,
 * tasks) are never touched — only role + brand-assignment bookkeeping changes.
 * APC → Team Lead and Team Lead → APC delegate to the promote/demote RPCs so
 * brands carry over exactly as before.
 */
export default function ChangeRoleModal({ target, onHide, onChanged }: {
  target: ChangeRoleTarget | null;
  onHide: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const [newRole, setNewRole] = useState('apc');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (target) {
      // Pre-select what they already are ('pending' etc. fall back to APC).
      setNewRole(ROLE_OPTIONS.some(o => o.value === target.role) ? target.role : 'apc');
      setInternal(target.is_internal ?? false);
      setErr(null);
    }
  }, [target?.id]);

  const from = target?.role;
  const brandCount = target?.brand_count ?? 0;
  const sameRole = newRole === from;
  const internalChanged = sameRole && newRole === 'paid_collab_handler'
    && internal !== (target?.is_internal ?? false);
  const unchanged = sameRole && !internalChanged;

  const submit = async () => {
    if (!target) return;
    setBusy(true); setErr(null);
    try {
      const { error } = await supabase.rpc('change_user_role', {
        p_user: target.id,
        p_new_role: newRole,
        p_internal: newRole === 'paid_collab_handler' && internal,
      });
      if (error) throw error;
      onHide();
      await onChanged();
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to change role');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal show={!!target} onHide={() => !busy && onHide()} centered>
      <Modal.Header closeButton>
        <Modal.Title>Change role — {target?.full_name || target?.email}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {err && <Alert variant="danger">{err}</Alert>}
        <div className="border rounded p-2 mb-3">
          {ROLE_OPTIONS.map(o => (
            <Form.Check key={o.value} type="radio" name="new-role" id={`role-${o.value}`} className="mb-2"
              checked={newRole === o.value} onChange={() => setNewRole(o.value)}
              label={<>
                <strong><i className={`bi ${o.icon} me-1`} />{o.label}</strong>
                {o.value === from && <span className="ac-chip neutral ms-2">current</span>}
                <div className="text-muted small">{o.desc}</div>
              </>}
            />
          ))}
          {newRole === 'paid_collab_handler' && (
            <Form.Check type="switch" id="role-internal" className="ms-4 mt-1"
              checked={internal} onChange={e => setInternal(e.target.checked)}
              label={<><strong>Internal handler</strong> <span className="text-muted small">— keeps team Chats &amp; Tasks, scoped to their assigned brands</span></>}
            />
          )}
        </div>
        {unchanged ? (
          <p className="small text-muted mb-0">
            This is their current role — pick a different one to change it.
          </p>
        ) : internalChanged ? (
          <p className="small text-muted mb-0">
            {internal
              ? <>Switches them to an <strong>internal</strong> handler — they gain team Chats &amp; Tasks, scoped to their assigned brands.</>
              : <>Switches them to an <strong>external</strong> handler — they lose the team Chats &amp; Tasks pages (paid-collab workspace only).</>}
          </p>
        ) : (
        <ul className="small text-muted mb-0">
          {from === 'apc' && newRole === 'team_lead' ? (
            <li>
              {brandCount > 0
                ? `Carries over ${brandCount} brand assignment${brandCount === 1 ? '' : 's'} as their Team Lead set.`
                : 'They have no brands assigned yet.'}
            </li>
          ) : from === 'team_lead' && newRole === 'apc' ? (
            <li>Their APCs detach to no team (keeping their brands); their own non-delegated brands come back as their APC brands.</li>
          ) : (
            <li>Their current brand assignments are removed — brand chat groups update automatically (they keep read-only history in the chat Archive tab).</li>
          )}
          <li><strong>Nothing is deleted:</strong> reports, comments, chat history, notes and tasks stay on their account. Tasks assigned to them remain theirs; tasks they created stay visible to the assignees.</li>
          {newRole === 'ads_manager' && (
            <li>They are auto-assigned every GMV Max brand and keep team Chats &amp; Tasks (view-only elsewhere).</li>
          )}
          {newRole === 'paid_collab_handler' && (
            internal
              ? <li>Assign their brands afterwards on the Paid Collab Handlers page.</li>
              : <li>As an <strong>external</strong> handler they lose the team Chats &amp; Tasks pages — paid-collab workspace only. Assign their brands on the Paid Collab Handlers page.</li>
          )}
          {newRole === 'paid_collab_client' && (
            <li>They only see the client paid-collab portal — no team Chats or Tasks pages. Assign their brands on the Paid Collab Clients page.</li>
          )}
          {newRole === 'apc' && from !== 'team_lead' && (
            <li>Assign their brands afterwards from the APCs or Brands page.</li>
          )}
        </ul>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={busy}>Cancel</Button>
        <Button variant="primary" disabled={busy || unchanged} onClick={submit}>
          {busy ? 'Changing…' : 'Change role'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
