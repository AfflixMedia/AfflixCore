// Right pane: conversation header, scrollable message stream with day
// separators, and the composer. Pure presentation — data + realtime live in
// the GlobalChat page.
import { useEffect, useMemo, useRef } from 'react';
import { Badge, Spinner } from 'react-bootstrap';
import Avatar from '../../components/Avatar';
import MessageBubble from './MessageBubble';
import MessageComposer from './MessageComposer';
import type { ChatContact, ChatMessage, ConversationView } from './types';
import { dayLabel, roleLabel, roleBadge } from './types';

interface Props {
  view: ConversationView | null;
  messages: ChatMessage[];
  loading: boolean;
  myId: string;
  directory: Map<string, ChatContact>;
  replyTo: ChatMessage | null;
  onReply: (m: ChatMessage | null) => void;
  onForward: (m: ChatMessage) => void;
  onSend: (body: string) => void | Promise<void>;
  onBack: () => void;        // mobile: back to list
}

export default function ChatPanel({
  view, messages, loading, myId, directory, replyTo, onReply, onForward, onSend, onBack,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Map id -> message for resolving reply quotes.
  const msgById = useMemo(() => {
    const m = new Map<string, ChatMessage>();
    messages.forEach(x => m.set(x.id, x));
    return m;
  }, [messages]);

  // Stick to bottom on new messages / conversation change.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, view?.conversation.id]);

  if (!view) {
    return (
      <div className="ac-chat-panel ac-chat-empty">
        <div className="text-center text-muted">
          <i className="bi bi-chat-dots" style={{ fontSize: '3rem', opacity: .4 }} />
          <p className="mt-3 mb-0">Select a chat to start messaging</p>
        </div>
      </div>
    );
  }

  const isGroup = view.conversation.is_group;

  return (
    <div className="ac-chat-panel">
      <div className="ac-chat-header">
        <button type="button" className="ac-chat-back" onClick={onBack} title="Back">
          <i className="bi bi-arrow-left" />
        </button>
        <Avatar name={view.title} variant={isGroup ? 'dark' : 'brand'} />
        <div className="min-w-0">
          <div className="d-flex align-items-center gap-2">
            <span className="fw-semibold text-truncate">{view.title}</span>
            {!isGroup && view.otherUser && (
              <Badge bg={roleBadge(view.otherUser.role)} className="ac-role-badge">
                {roleLabel(view.otherUser.role)}
              </Badge>
            )}
          </div>
          {!isGroup && view.otherUser && (
            <div className="text-muted small text-truncate">{view.otherUser.email}</div>
          )}
        </div>
      </div>

      <div className="ac-chat-stream" ref={scrollRef}>
        {loading ? (
          <div className="text-center py-5"><Spinner animation="border" size="sm" /></div>
        ) : messages.length === 0 ? (
          <div className="text-center text-muted py-5">No messages yet. Say hello 👋</div>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const showDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
            const replyTarget = m.reply_to_id ? (msgById.get(m.reply_to_id) ?? null) : null;
            return (
              <div key={m.id}>
                {showDay && <div className="ac-day-sep"><span>{dayLabel(m.created_at)}</span></div>}
                <MessageBubble
                  message={m}
                  mine={m.sender_id === myId}
                  isGroup={isGroup}
                  sender={m.sender_id ? directory.get(m.sender_id) ?? null : null}
                  replyTo={replyTarget}
                  replyToSender={replyTarget?.sender_id ? directory.get(replyTarget.sender_id) ?? null : null}
                  onReply={onReply}
                  onForward={onForward}
                />
              </div>
            );
          })
        )}
      </div>

      <MessageComposer
        key={view.conversation.id}
        replyTo={replyTo}
        replyToSender={replyTo?.sender_id ? directory.get(replyTo.sender_id) ?? null : null}
        onCancelReply={() => onReply(null)}
        onSend={onSend}
      />
    </div>
  );
}
