// Group create + manage modal, plus a read-only announcement-settings view.
//  * create:       name + pick members.
//  * manage:       rename, add/remove members, (creator) promote/demote admins,
//                  and leave the group.
//  * announcement: Bob-only roster of everyone who has access (role-based).
import { useMemo, useState } from 'react';
import { Modal, Form, Button, Badge, InputGroup, Spinner } from 'react-bootstrap';
import Avatar from '../../components/Avatar';
import type { ChatContact, Conversation } from './types';
import { contactName, roleLabel, roleBadge } from './types';

export interface GroupMember { contact: ChatContact; isAdmin: boolean; }

interface Props {
  show: boolean;
  mode: 'create' | 'manage' | 'announcement';
  contacts: ChatContact[];          // all internal staff (for adding)
  allStaff: ChatContact[];          // every internal staff incl. me (announcement roster)
  conversation: Conversation | null;
  members: GroupMember[];           // current members (manage mode)
  creatorId: string | null;
  myId: string;
  canManage: boolean;               // current user is creator or admin
  isCreator: boolean;
  onCreate: (title: string, memberIds: string[]) => Promise<void>;
  onRename: (title: string) => Promise<void>;
  onAdd: (userId: string, showHistory: boolean) => Promise<void>;
  onRemove: (userId: string) => Promise<void>;
  onSetAdmin: (userId: string, isAdmin: boolean) => Promise<void>;
  onLeave: () => Promise<void>;
  onClose: () => void;
}

export default function GroupModal(p: Props) {
  const [title, setTitle] = useState(p.conversation?.title ?? '');
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [showHistory, setShowHistory] = useState(true);   // new members see prior chat

  const memberIds = useMemo(() => new Set(p.members.map(m => m.contact.id)), [p.members]);
  const sorted = useMemo(
    () => [...p.contacts].sort((a, b) => contactName(a).localeCompare(contactName(b))),
    [p.contacts]);
  const addable = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sorted.filter(c => !memberIds.has(c.id)
      && (!needle || contactName(c).toLowerCase().includes(needle)));
  }, [sorted, memberIds, q]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  // ----- Announcement settings (Bob only) -----
  if (p.mode === 'announcement') {
    const roster = [...p.allStaff].sort((a, b) => contactName(a).localeCompare(contactName(b)));
    const filtered = roster.filter(c => {
      const needle = q.trim().toLowerCase();
      return !needle || `${contactName(c)} ${c.email} ${roleLabel(c.role)}`.toLowerCase().includes(needle);
    });
    return (
      <Modal show={p.show} onHide={p.onClose} centered>
        <Modal.Header closeButton>
          <Modal.Title><i className="bi bi-megaphone-fill me-2 text-warning" />Announcement settings</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted small mb-2">
            <i className="bi bi-info-circle me-1" />
            Every internal staff member (Boss, Team Leads, APCs, PCLs) automatically has access —
            new people are added the moment their profile is created. Only the Boss can post.
          </p>
          <Form.Label>Members with access <Badge bg="secondary" pill>{roster.length}</Badge></Form.Label>
          <InputGroup size="sm" className="mb-2">
            <InputGroup.Text><i className="bi bi-search" /></InputGroup.Text>
            <Form.Control placeholder="Search people…" value={q} onChange={e => setQ(e.target.value)} />
          </InputGroup>
          <div className="ac-contact-list">
            {filtered.map(c => (
              <div key={c.id} className="ac-contact-row" style={{ cursor: 'default' }}>
                <Avatar name={contactName(c)} />
                <div className="flex-grow-1 min-w-0">
                  <div className="d-flex align-items-center gap-2">
                    <span className="fw-semibold text-truncate">{contactName(c)}{c.id === p.myId && ' (you)'}</span>
                    <Badge bg={roleBadge(c.role)} className="ac-role-badge">{roleLabel(c.role)}</Badge>
                    {c.role === 'bob' && <Badge bg="dark" className="ac-role-badge">Can post</Badge>}
                  </div>
                  <div className="text-muted small text-truncate">{c.email}</div>
                </div>
              </div>
            ))}
          </div>
        </Modal.Body>
      </Modal>
    );
  }

  // ----- Create mode -----
  if (p.mode === 'create') {
    const toggle = (id: string) =>
      setPicked(a => a.includes(id) ? a.filter(x => x !== id) : [...a, id]);
    const create = () => run(async () => { await p.onCreate(title, picked); });
    return (
      <Modal show={p.show} onHide={p.onClose} centered>
        <Modal.Header closeButton><Modal.Title><i className="bi bi-people-fill me-2" />New group</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-3">
            <Form.Label>Group name</Form.Label>
            <Form.Control autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Ops Team" />
          </Form.Group>
          <Form.Label>Add members {picked.length > 0 && <Badge bg="info" pill>{picked.length}</Badge>}</Form.Label>
          <InputGroup size="sm" className="mb-2">
            <InputGroup.Text><i className="bi bi-search" /></InputGroup.Text>
            <Form.Control placeholder="Search people…" value={q} onChange={e => setQ(e.target.value)} />
          </InputGroup>
          <div className="ac-contact-list">
            {addable.map(c => (
              <button key={c.id} type="button" className="ac-contact-row" onClick={() => toggle(c.id)}>
                <Avatar name={contactName(c)} />
                <div className="flex-grow-1 min-w-0 text-start">
                  <div className="d-flex align-items-center gap-2">
                    <span className="fw-semibold text-truncate">{contactName(c)}</span>
                    <Badge bg={roleBadge(c.role)} className="ac-role-badge">{roleLabel(c.role)}</Badge>
                  </div>
                </div>
                <i className={`bi ${picked.includes(c.id) ? 'bi-check-square-fill text-primary' : 'bi-square'}`} />
              </button>
            ))}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={p.onClose} disabled={busy}>Cancel</Button>
          <Button onClick={create} disabled={busy || !title.trim() || picked.length === 0}>
            {busy ? <Spinner size="sm" animation="border" /> : 'Create group'}
          </Button>
        </Modal.Footer>
      </Modal>
    );
  }

  // ----- Manage mode -----
  return (
    <Modal show={p.show} onHide={p.onClose} centered>
      <Modal.Header closeButton><Modal.Title><i className="bi bi-gear me-2" />Group info</Modal.Title></Modal.Header>
      <Modal.Body>
        <Form.Group className="mb-3">
          <Form.Label>Group name</Form.Label>
          <InputGroup>
            <Form.Control value={title} disabled={!p.canManage} onChange={e => setTitle(e.target.value)} />
            {p.canManage && (
              <Button variant="outline-primary" disabled={busy || !title.trim() || title === (p.conversation?.title ?? '')}
                onClick={() => run(() => p.onRename(title))}>
                <i className="bi bi-check-lg" />
              </Button>
            )}
          </InputGroup>
        </Form.Group>

        <Form.Label>Members <Badge bg="secondary" pill>{p.members.length}</Badge></Form.Label>
        <div className="ac-contact-list mb-3">
          {p.members.map(({ contact: c, isAdmin }) => {
            const isCreatorRow = c.id === p.creatorId;
            return (
              <div key={c.id} className="ac-contact-row" style={{ cursor: 'default' }}>
                <Avatar name={contactName(c)} />
                <div className="flex-grow-1 min-w-0">
                  <div className="d-flex align-items-center gap-2">
                    <span className="fw-semibold text-truncate">{contactName(c)}{c.id === p.myId && ' (you)'}</span>
                    <Badge bg={roleBadge(c.role)} className="ac-role-badge">{roleLabel(c.role)}</Badge>
                    {isCreatorRow ? <Badge bg="dark" className="ac-role-badge">Creator</Badge>
                      : isAdmin ? <Badge bg="warning" text="dark" className="ac-role-badge">Admin</Badge> : null}
                  </div>
                </div>
                {p.canManage && !isCreatorRow && c.id !== p.myId && (
                  <div className="d-flex gap-1" onClick={e => e.stopPropagation()}>
                    {p.isCreator && (
                      <Button size="sm" variant="link" className="p-0 text-muted" title={isAdmin ? 'Remove admin' : 'Make admin'}
                        disabled={busy} onClick={() => run(() => p.onSetAdmin(c.id, !isAdmin))}>
                        <i className={`bi ${isAdmin ? 'bi-star-fill text-warning' : 'bi-star'}`} />
                      </Button>
                    )}
                    <Button size="sm" variant="link" className="p-0 text-danger" title="Remove from group"
                      disabled={busy} onClick={() => run(() => p.onRemove(c.id))}>
                      <i className="bi bi-x-circle" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {p.canManage && (
          <>
            <Form.Label>Add member</Form.Label>
            <InputGroup size="sm" className="mb-2">
              <InputGroup.Text><i className="bi bi-search" /></InputGroup.Text>
              <Form.Control placeholder="Search people…" value={q} onChange={e => setQ(e.target.value)} />
            </InputGroup>
            <Form.Check
              type="switch"
              id="ac-add-show-history"
              className="small mb-2"
              checked={showHistory}
              onChange={e => setShowHistory(e.target.checked)}
              label="Let new members see previous chat history"
            />
            <div className="ac-contact-list mb-3">
              {addable.map(c => (
                <button key={c.id} type="button" className="ac-contact-row" disabled={busy}
                  onClick={() => run(() => p.onAdd(c.id, showHistory))}>
                  <Avatar name={contactName(c)} />
                  <div className="flex-grow-1 min-w-0 text-start">
                    <span className="fw-semibold text-truncate">{contactName(c)}</span>
                  </div>
                  <i className="bi bi-plus-circle text-primary" />
                </button>
              ))}
            </div>
          </>
        )}

        {/* Leave group — available to every member. */}
        {confirmLeave ? (
          <div className="ac-leave-confirm">
            <span className="small">Leave this group? You’ll stop receiving its messages.</span>
            <div className="d-flex gap-2 mt-2">
              <Button size="sm" variant="outline-secondary" disabled={busy} onClick={() => setConfirmLeave(false)}>Cancel</Button>
              <Button size="sm" variant="danger" disabled={busy} onClick={() => run(p.onLeave)}>
                {busy ? <Spinner size="sm" animation="border" /> : 'Leave group'}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline-danger" size="sm" className="w-100" disabled={busy}
            onClick={() => setConfirmLeave(true)}>
            <i className="bi bi-box-arrow-right me-1" />Leave group
          </Button>
        )}
      </Modal.Body>
    </Modal>
  );
}
