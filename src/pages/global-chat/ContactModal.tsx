// WhatsApp-style contact card, opened by clicking a @mention (or elsewhere a
// person is referenced). Shows the person's details with a "Message" action
// that jumps to (or creates) the DM with them.
import { Modal, Button, Badge } from 'react-bootstrap';
import Avatar from '../../components/Avatar';
import type { ChatContact } from './types';
import { contactName, roleLabel, roleBadge } from './types';

interface Props {
  contact: ChatContact | null;   // null = hidden
  isSelf: boolean;               // my own card → no "Message" button
  onMessage: (contact: ChatContact) => void;
  onMention?: (contact: ChatContact) => void;  // set in groups → "Mention" drops @Name into the composer
  onClose: () => void;
}

export default function ContactModal({ contact, isSelf, onMessage, onMention, onClose }: Props) {
  return (
    <Modal show={!!contact} onHide={onClose} centered size="sm">
      {contact && (
        <>
          <Modal.Body className="text-center pt-4">
            <div className="d-flex justify-content-center mb-3">
              <Avatar name={contactName(contact)} src={contact.avatar_url} size="lg" />
            </div>
            <div className="fw-bold" style={{ fontSize: '1.1rem' }}>
              {contactName(contact)}
              {isSelf && <span className="text-muted fw-normal"> (you)</span>}
            </div>
            <div className="mt-1">
              <Badge bg={roleBadge(contact.role)} className="ac-role-badge">
                {roleLabel(contact.role, contact.is_superbob)}
              </Badge>
            </div>
            <div className="text-muted small mt-2 text-truncate">{contact.email}</div>
          </Modal.Body>
          <Modal.Footer className="justify-content-center border-0 pt-0 pb-4">
            {!isSelf && (
              <Button onClick={() => onMessage(contact)}>
                <i className="bi bi-chat-dots me-1" /> Message
              </Button>
            )}
            {!isSelf && onMention && (
              <Button variant="outline-primary" onClick={() => onMention(contact)}>
                <i className="bi bi-at" /> Mention
              </Button>
            )}
            <Button variant="outline-secondary" onClick={onClose}>Close</Button>
          </Modal.Footer>
        </>
      )}
    </Modal>
  );
}
