// WhatsApp-style delete chooser: "Delete for me" hides the message from your own
// view; "Delete for everyone" tombstones your own message for all participants.
import { useState } from 'react';
import { Modal, Button, Spinner } from 'react-bootstrap';
import type { ChatMessage } from './types';
import { toPlainText } from './messageFormat';

interface Props {
  message: ChatMessage | null;
  canDeleteForEveryone: boolean;       // mine && not already tombstoned
  onForMe: () => Promise<void>;
  onForEveryone: () => Promise<void>;
  onClose: () => void;
}

export default function DeleteMessageModal({ message, canDeleteForEveryone, onForMe, onForEveryone, onClose }: Props) {
  const [busy, setBusy] = useState<'me' | 'all' | null>(null);
  if (!message) return null;

  const run = async (which: 'me' | 'all', fn: () => Promise<void>) => {
    setBusy(which);
    try { await fn(); } finally { setBusy(null); }
  };

  const preview = toPlainText(message.body) || (message.deleted_at ? 'This message was deleted' : '');

  return (
    <Modal show onHide={onClose} centered size="sm">
      <Modal.Header closeButton><Modal.Title className="h6 mb-0">Delete message?</Modal.Title></Modal.Header>
      <Modal.Body>
        {preview && <div className="ac-delete-preview text-truncate mb-3">{preview}</div>}
        <div className="d-grid gap-2">
          {canDeleteForEveryone && (
            <Button variant="danger" disabled={busy !== null} onClick={() => run('all', onForEveryone)}>
              {busy === 'all' ? <Spinner size="sm" animation="border" /> : <><i className="bi bi-trash me-1" />Delete for everyone</>}
            </Button>
          )}
          <Button variant="outline-secondary" disabled={busy !== null} onClick={() => run('me', onForMe)}>
            {busy === 'me' ? <Spinner size="sm" animation="border" /> : <><i className="bi bi-eye-slash me-1" />Delete for me</>}
          </Button>
          <Button variant="link" className="text-muted" disabled={busy !== null} onClick={onClose}>Cancel</Button>
        </div>
      </Modal.Body>
    </Modal>
  );
}
