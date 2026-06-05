// Right pane: conversation header, scrollable message stream (day separators +
// "unread messages" divider), a floating scroll-to-bottom button, and the
// composer. Data + realtime live in the GlobalChat page.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  unreadAnchorId: string | null;   // first unread message id at open time
  replyTo: ChatMessage | null;
  onReply: (m: ChatMessage | null) => void;
  onForward: (m: ChatMessage) => void;
  onSend: (body: string) => void | Promise<void>;
  onBack: () => void;        // mobile: back to list
}

export default function ChatPanel({
  view, messages, loading, myId, directory, unreadAnchorId,
  replyTo, onReply, onForward, onSend, onBack,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  // Which conversation we've already positioned; how many messages we'd seen.
  const positionedConvRef = useRef<string | null>(null);
  const prevCountRef = useRef(0);

  const convId = view?.conversation.id ?? null;

  // Map id -> message for resolving reply quotes.
  const msgById = useMemo(() => {
    const m = new Map<string, ChatMessage>();
    messages.forEach(x => m.set(x.id, x));
    return m;
  }, [messages]);

  const isNearBottom = () => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const scrollToBottom = (smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  // Initial position when a conversation's messages first load: jump to the
  // "unread messages" divider if there is one, otherwise straight to the bottom.
  // A ResizeObserver re-applies it as the flex container settles its height, so
  // it can't get stuck at the top when scrollHeight isn't final on first paint.
  useLayoutEffect(() => {
    if (!convId || loading) return;
    const el = scrollRef.current;
    if (!el) return;
    positionedConvRef.current = convId;
    prevCountRef.current = messages.length;

    let settled = false;
    const place = () => {
      const sep = el.querySelector('[data-unread-sep]') as HTMLElement | null;
      if (sep) el.scrollTop = Math.max(0, sep.offsetTop - 12); // first unread
      else el.scrollTop = el.scrollHeight;                     // latest message
    };

    place();                                   // synchronous, pre-paint (no flash)
    const raf = requestAnimationFrame(place);
    const t1 = setTimeout(() => { place(); setShowScrollBtn(!isNearBottom()); }, 80);
    const t2 = setTimeout(() => { place(); setShowScrollBtn(!isNearBottom()); settled = true; }, 280);
    // Re-place whenever the stream's size changes during the settle window.
    const ro = new ResizeObserver(() => { if (!settled) place(); });
    ro.observe(el);

    return () => { cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2); ro.disconnect(); };
  }, [convId, loading, unreadAnchorId]);

  // New messages after the initial load. Always follow your own sent message to
  // the bottom; for incoming messages, follow only if already near the bottom,
  // otherwise reveal the scroll-to-bottom button.
  useEffect(() => {
    if (!convId || positionedConvRef.current !== convId) return;
    const grew = messages.length > prevCountRef.current;
    prevCountRef.current = messages.length;
    if (!grew) return;
    const mine = messages[messages.length - 1]?.sender_id === myId;
    if (mine || isNearBottom()) scrollToBottom(true);
    else setShowScrollBtn(true);
  }, [messages.length, convId, myId]);

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

      <div className="ac-stream-wrap">
        <div className="ac-chat-stream" ref={scrollRef} onScroll={() => setShowScrollBtn(!isNearBottom())}>
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
                <div key={m.id} data-mid={m.id}>
                  {showDay && <div className="ac-day-sep"><span>{dayLabel(m.created_at)}</span></div>}
                  {m.id === unreadAnchorId && (
                    <div className="ac-unread-sep" data-unread-sep><span>Unread messages</span></div>
                  )}
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

        {showScrollBtn && (
          <button
            type="button"
            className="ac-scroll-bottom-btn"
            title="Scroll to latest"
            onClick={() => scrollToBottom(true)}
          >
            <i className="bi bi-chevron-down" />
          </button>
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
