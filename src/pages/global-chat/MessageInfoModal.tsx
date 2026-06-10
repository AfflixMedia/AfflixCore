// "Message info" — WhatsApp-style receipt breakdown for one of my own messages.
// Shows when it was sent, and (per recipient) who has read it, who it merely
// reached, and who it's still pending for, each with a timestamp. For a 1:1 DM
// this collapses to a single recipient.
import { Modal } from 'react-bootstrap';
import Avatar from '../../components/Avatar';
import type { ChatMessage, MemberReceipt } from './types';
import { contactName, messageTime, receiptTime } from './types';
import { toPlainText } from './messageFormat';

interface Props {
  message: ChatMessage | null;
  receipts: MemberReceipt[];   // one per recipient (excludes me)
  isGroup: boolean;            // group or announcement → show counts + rosters
  onClose: () => void;
}

function Row({ r, state }: { r: MemberReceipt; state: 'read' | 'delivered' | 'pending' }) {
  const when = state === 'read' ? r.readAt : state === 'delivered' ? r.deliveredAt : null;
  return (
    <div className="ac-info-row">
      <Avatar name={contactName(r.contact)} variant="brand" size="sm" />
      <span className="ac-info-name text-truncate">{contactName(r.contact)}</span>
      <span className="ac-info-when ms-auto">{when ? receiptTime(when) : ''}</span>
    </div>
  );
}

export default function MessageInfoModal({ message, receipts, isGroup, onClose }: Props) {
  if (!message) return null;

  const read = receipts.filter(r => r.read);
  const delivered = receipts.filter(r => r.delivered && !r.read);
  const pending = receipts.filter(r => !r.delivered);

  return (
    <Modal show onHide={onClose} centered>
      <Modal.Header closeButton>
        <Modal.Title className="h6 mb-0">Message info</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="ac-info-preview">
          <div className="ac-info-preview-body">
            {message.deleted_at ? <em>This message was deleted</em> : toPlainText(message.body)}
          </div>
          <div className="ac-info-preview-meta">Sent {receiptTime(message.created_at) || messageTime(message.created_at)}</div>
        </div>

        <Section
          icon="bi-check2-all"
          tone="read"
          title={isGroup ? `Read by ${read.length} of ${receipts.length}` : 'Read'}
          empty="No one has read this yet."
          rows={read}
          state="read"
        />
        <Section
          icon="bi-check2-all"
          tone="delivered"
          title={isGroup ? `Delivered to ${delivered.length}` : 'Delivered'}
          empty=""
          rows={delivered}
          state="delivered"
          hideWhenEmpty
        />
        <Section
          icon="bi-check2"
          tone="pending"
          title={isGroup ? `Pending for ${pending.length}` : 'Pending'}
          empty=""
          rows={pending}
          state="pending"
          hideWhenEmpty
        />
      </Modal.Body>
    </Modal>
  );
}

function Section({
  icon, tone, title, empty, rows, state, hideWhenEmpty,
}: {
  icon: string;
  tone: 'read' | 'delivered' | 'pending';
  title: string;
  empty: string;
  rows: MemberReceipt[];
  state: 'read' | 'delivered' | 'pending';
  hideWhenEmpty?: boolean;
}) {
  if (hideWhenEmpty && rows.length === 0) return null;
  return (
    <div className="ac-info-section">
      <div className={`ac-info-section-head ${tone}`}>
        <i className={`bi ${icon}`} /> {title}
      </div>
      {rows.length === 0
        ? <div className="text-muted small ps-1">{empty}</div>
        : rows.map(r => <Row key={r.contact.id} r={r} state={state} />)}
    </div>
  );
}
