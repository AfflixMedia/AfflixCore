// Forward a message to another person. Lists internal staff; picking one
// forwards the selected message into that DM (creating it if needed).
import { useMemo, useState } from 'react';
import { Modal, Form, Badge, InputGroup } from 'react-bootstrap';
import Avatar from '../../components/Avatar';
import type { ChatContact, ChatMessage } from './types';
import { contactName, roleLabel, roleBadge } from './types';
import { toPlainText } from './messageFormat';

interface Props {
  show: boolean;
  message: ChatMessage | null;
  contacts: ChatContact[];
  onForward: (contact: ChatContact) => void | Promise<void>;
  onClose: () => void;
}

export default function ForwardModal({ show, message, contacts, onForward, onClose }: Props) {
  const [q, setQ] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const sorted = [...contacts].sort((a, b) => contactName(a).localeCompare(contactName(b)));
    if (!needle) return sorted;
    return sorted.filter(c => `${contactName(c)} ${c.email}`.toLowerCase().includes(needle));
  }, [contacts, q]);

  const handlePick = async (c: ChatContact) => {
    setBusyId(c.id);
    try { await onForward(c); } finally { setBusyId(null); }
  };

  return (
    <Modal show={show} onHide={onClose} centered>
      <Modal.Header closeButton>
        <Modal.Title><i className="bi bi-forward me-2" />Forward message</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {message && (
          <div className="ac-forward-preview mb-3">
            <i className="bi bi-quote me-1 text-muted" />
            <span className="text-truncate">{toPlainText(message.body)}</span>
          </div>
        )}
        <InputGroup className="mb-3">
          <InputGroup.Text><i className="bi bi-search" /></InputGroup.Text>
          <Form.Control
            autoFocus
            placeholder="Forward to…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </InputGroup>
        <div className="ac-contact-list">
          {filtered.map(c => (
            <button
              key={c.id}
              type="button"
              className="ac-contact-row"
              disabled={busyId !== null}
              onClick={() => handlePick(c)}
            >
              <Avatar name={contactName(c)} src={c.avatar_url} />
              <div className="flex-grow-1 min-w-0 text-start">
                <div className="d-flex align-items-center gap-2">
                  <span className="fw-semibold text-truncate">{contactName(c)}</span>
                  <Badge bg={roleBadge(c.role)} className="ac-role-badge">{roleLabel(c.role, c.is_superbob)}</Badge>
                </div>
              </div>
              {busyId === c.id
                ? <span className="spinner-border spinner-border-sm text-muted" />
                : <i className="bi bi-send text-muted" />}
            </button>
          ))}
        </div>
      </Modal.Body>
    </Modal>
  );
}
