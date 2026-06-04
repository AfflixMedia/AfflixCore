// A single message bubble with hover actions (Reply, Forward) and quoted
// reply / forwarded labels. Outgoing messages align right, incoming left.
import type { ChatContact, ChatMessage } from './types';
import { messageTime, contactName } from './types';
import { renderMessageHtml, toPlainText } from './messageFormat';

interface Props {
  message: ChatMessage;
  mine: boolean;
  isGroup: boolean;
  sender: ChatContact | null;          // resolved sender (for group + names)
  replyTo: ChatMessage | null;         // resolved replied-to message, if loaded
  replyToSender: ChatContact | null;
  onReply: (m: ChatMessage) => void;
  onForward: (m: ChatMessage) => void;
}

export default function MessageBubble({
  message, mine, isGroup, sender, replyTo, replyToSender, onReply, onForward,
}: Props) {
  return (
    <div className={`ac-msg-row ${mine ? 'mine' : ''}`}>
      <div className={`ac-msg-bubble ${mine ? 'mine' : ''}`}>
        {isGroup && !mine && (
          <div className="ac-msg-sender">{contactName(sender)}</div>
        )}

        {message.is_forwarded && (
          <div className="ac-msg-forwarded"><i className="bi bi-forward me-1" />Forwarded</div>
        )}

        {message.reply_to_id && (
          <div className="ac-msg-quote">
            <div className="ac-msg-quote-name">
              {replyTo ? contactName(replyToSender) : 'Reply'}
            </div>
            <div className="ac-msg-quote-body text-truncate">
              {replyTo ? toPlainText(replyTo.body) : 'Original message'}
            </div>
          </div>
        )}

        <div className="ac-msg-text" dangerouslySetInnerHTML={{ __html: renderMessageHtml(message.body) }} />
        <div className="ac-msg-meta">{messageTime(message.created_at)}</div>

        <div className="ac-msg-actions">
          <button type="button" title="Reply" onClick={() => onReply(message)}>
            <i className="bi bi-reply-fill" />
          </button>
          <button type="button" title="Forward" onClick={() => onForward(message)}>
            <i className="bi bi-forward-fill" />
          </button>
        </div>
      </div>
    </div>
  );
}
