// "Start a chat" — WhatsApp-style contact picker. Lists internal staff with a
// role badge next to each name and a search box; picking one opens a DM.
import { useMemo, useState } from 'react';
import { Modal, Form, Spinner, Badge, InputGroup, Button } from 'react-bootstrap';
import Avatar from '../../components/Avatar';
import type { ChatContact } from './types';
import { contactName, roleLabel, roleBadge } from './types';

interface Props {
  show: boolean;
  contacts: ChatContact[];
  loading: boolean;
  onPick: (contact: ChatContact) => void;
  onClose: () => void;
}

export default function NewChatModal({ show, contacts, loading, onPick, onClose }: Props) {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const sorted = [...contacts].sort((a, b) =>
      contactName(a).localeCompare(contactName(b)));
    if (!needle) return sorted;
    return sorted.filter(c =>
      `${contactName(c)} ${c.email} ${roleLabel(c.role)}`.toLowerCase().includes(needle));
  }, [contacts, q]);

  return (
    <Modal show={show} onHide={onClose} centered>
      <Modal.Header closeButton>
        <Modal.Title><i className="bi bi-chat-dots me-2" />Start a chat</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <InputGroup className="mb-3">
          <InputGroup.Text><i className="bi bi-search" /></InputGroup.Text>
          <Form.Control
            autoFocus
            placeholder="Search people by name, email, or role…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          {q && (
            <Button variant="outline-secondary" onClick={() => setQ('')}>
              <i className="bi bi-x-lg" />
            </Button>
          )}
        </InputGroup>

        {loading ? (
          <div className="text-center py-4"><Spinner animation="border" /></div>
        ) : filtered.length === 0 ? (
          <p className="text-muted text-center py-3 mb-0">No people found.</p>
        ) : (
          <div className="ac-contact-list">
            {filtered.map(c => (
              <button
                key={c.id}
                type="button"
                className="ac-contact-row"
                onClick={() => onPick(c)}
              >
                <Avatar name={contactName(c)} />
                <div className="flex-grow-1 min-w-0 text-start">
                  <div className="d-flex align-items-center gap-2">
                    <span className="fw-semibold text-truncate">{contactName(c)}</span>
                    <Badge bg={roleBadge(c.role)} className="ac-role-badge">{roleLabel(c.role)}</Badge>
                  </div>
                  <div className="text-muted small text-truncate">{c.email}</div>
                </div>
                <i className="bi bi-chevron-right text-muted" />
              </button>
            ))}
          </div>
        )}
      </Modal.Body>
    </Modal>
  );
}
