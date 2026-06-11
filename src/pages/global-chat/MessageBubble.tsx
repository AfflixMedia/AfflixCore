// A single message bubble with hover actions (Reply, Forward, Acknowledge,
// Delete), quoted reply / forwarded labels, a deleted tombstone, and — on
// announcement messages — emoji acknowledgements with a meaning legend and a
// visible list of who reacted. Outgoing messages align right, incoming left.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Emoji, EmojiStyle } from 'emoji-picker-react';
import type { ChatContact, ChatMessage, ChatReaction, Receipt } from './types';
import { messageTime, contactName, ACK_REACTIONS, ackMeaning, ackUnified } from './types';
import { renderMessageHtml, toPlainText } from './messageFormat';

// Apple-style ack glyph; falls back to the raw emoji char if not in the ack set.
function AckEmoji({ emoji, size = 18 }: { emoji: string; size?: number }) {
  const unified = ackUnified(emoji);
  return unified
    ? <Emoji unified={unified} emojiStyle={EmojiStyle.APPLE} size={size} lazyLoad />
    : <span>{emoji}</span>;
}

interface Props {
  message: ChatMessage;
  mine: boolean;
  isGroup: boolean;
  sender: ChatContact | null;          // resolved sender (for group + names)
  mentionNames: string[];              // display names to highlight as @mentions
  replyTo: ChatMessage | null;         // resolved replied-to message, if loaded
  replyToSender: ChatContact | null;
  canReply: boolean;                   // hidden in announcements for non-posters
  ackMode: boolean;                    // announcement message → acknowledge UI
  reactions: ChatReaction[];           // reactions on this message
  myReaction: string | null;           // my current emoji on this message
  reactorName: (id: string) => string; // resolve a reactor's display name
  receipt: Receipt | null;             // tick state for my own messages (else null)
  onReact: (emoji: string) => void;
  onReply: (m: ChatMessage) => void;
  onForward: (m: ChatMessage) => void;
  onDelete: (m: ChatMessage) => void;
  onInfo: (m: ChatMessage) => void;
}

// Single tick (sent) vs double tick (delivered/read); blue when read.
function Ticks({ receipt }: { receipt: Receipt }) {
  const title = receipt === 'read' ? 'Read' : receipt === 'delivered' ? 'Delivered' : 'Sent';
  return (
    <span className={`ac-ticks ${receipt}`} title={title}>
      <i className={`bi ${receipt === 'sent' ? 'bi-check2' : 'bi-check2-all'}`} />
    </span>
  );
}

export default function MessageBubble({
  message, mine, isGroup, sender, mentionNames, replyTo, replyToSender,
  canReply, ackMode, reactions, myReaction, reactorName, receipt,
  onReact, onReply, onForward, onDelete, onInfo,
}: Props) {
  const [showPicker, setShowPicker] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [ackSide, setAckSide] = useState<'left' | 'right'>('left');
  const ackWrapRef = useRef<HTMLDivElement>(null);
  const ackBtnRef = useRef<HTMLButtonElement>(null);
  const deleted = !!message.deleted_at;

  // Choose which way the acknowledge popup opens so it never spills out of the
  // message panel (e.g. into the contact list on left-aligned bubbles).
  const toggleAck = () => {
    if (!showPicker) {
      const btn = ackBtnRef.current;
      let side: 'left' | 'right' = 'left';   // default: anchored right, opens leftward
      if (btn) {
        const rect = btn.getBoundingClientRect();
        const panel = btn.closest('.ac-chat-panel') as HTMLElement | null;
        const b = panel?.getBoundingClientRect();
        const leftBound = (b?.left ?? 0) + 8;
        const rightBound = (b?.right ?? window.innerWidth) - 8;
        const POP = 248;
        const fitsLeft = rect.right - POP >= leftBound;
        const fitsRight = rect.left + POP <= rightBound;
        if (fitsLeft) side = 'left';
        else if (fitsRight) side = 'right';
        else side = (rect.right - leftBound) >= (rightBound - rect.left) ? 'left' : 'right';
      }
      setAckSide(side);
    }
    setShowPicker(s => !s);
  };

  useEffect(() => {
    if (!showPicker) return;
    const onDoc = (e: MouseEvent) => {
      if (ackWrapRef.current && !ackWrapRef.current.contains(e.target as Node)) {
        setShowPicker(false); setShowInfo(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [showPicker]);

  // Group reactions by emoji → reactor names, for the summary chips.
  const summary = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of reactions) {
      const arr = map.get(r.emoji) ?? [];
      arr.push(reactorName(r.user_id));
      map.set(r.emoji, arr);
    }
    return Array.from(map.entries());
  }, [reactions, reactorName]);

  if (deleted) {
    return (
      <div className={`ac-msg-row ${mine ? 'mine' : ''}`}>
        <div className={`ac-msg-bubble ${mine ? 'mine' : ''} ac-msg-deleted`}>
          <span className="ac-msg-text"><i className="bi bi-slash-circle me-1" />This message was deleted</span>
          <div className="ac-msg-meta">
            {messageTime(message.created_at)}
            {mine && receipt && <Ticks receipt={receipt} />}
          </div>
          <div className="ac-msg-actions">
            <button type="button" title="Remove for me" onClick={() => onDelete(message)}>
              <i className="bi bi-eye-slash" />
            </button>
          </div>
        </div>
      </div>
    );
  }

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
              {replyTo ? (replyTo.deleted_at ? 'Deleted message' : toPlainText(replyTo.body)) : 'Original message'}
            </div>
          </div>
        )}

        <div className="ac-msg-text" dangerouslySetInnerHTML={{ __html: renderMessageHtml(message.body, mentionNames) }} />
        <div className="ac-msg-meta">
          {messageTime(message.created_at)}
          {mine && receipt && <Ticks receipt={receipt} />}
        </div>

        {/* Acknowledgement summary (who reacted with what). */}
        {summary.length > 0 && (
          <div className="ac-msg-reactions">
            {summary.map(([emoji, names]) => (
              <button
                key={emoji}
                type="button"
                className={`ac-react-chip ${myReaction === emoji ? 'mine' : ''}`}
                title={`${ackMeaning(emoji) || 'Reacted'} — ${names.join(', ')}`}
                onClick={() => ackMode && onReact(emoji)}
              >
                <AckEmoji emoji={emoji} size={16} /><span className="ac-react-count">{names.length}</span>
              </button>
            ))}
          </div>
        )}

        <div className={`ac-msg-actions ${showPicker ? 'show' : ''}`}>
          {canReply && (
            <button type="button" title="Reply" onClick={() => onReply(message)}>
              <i className="bi bi-reply-fill" />
            </button>
          )}
          {ackMode && (
            <div ref={ackWrapRef} className="ac-ack-wrap">
              <button ref={ackBtnRef} type="button" title="Acknowledge" onClick={toggleAck}>
                <i className="bi bi-emoji-smile" />
              </button>
              {showPicker && (
                <div className={`ac-ack-pop ${ackSide === 'right' ? 'ac-ack-pop-right' : ''}`}>
                  <div className="ac-ack-emojis">
                    {ACK_REACTIONS.map(r => (
                      <button
                        key={r.emoji}
                        type="button"
                        className={myReaction === r.emoji ? 'active' : ''}
                        title={`${r.label} — ${r.meaning}`}
                        onClick={() => { onReact(r.emoji); setShowPicker(false); setShowInfo(false); }}
                      ><AckEmoji emoji={r.emoji} size={20} /></button>
                    ))}
                    <button type="button" className="ac-ack-info" title="What do these mean?"
                      onClick={() => setShowInfo(s => !s)}><i className="bi bi-info-circle" /></button>
                  </div>
                  {showInfo && (
                    <div className="ac-ack-legend">
                      {ACK_REACTIONS.map(r => (
                        <div key={r.emoji} className="ac-ack-legend-row">
                          <span className="ac-ack-legend-emoji"><AckEmoji emoji={r.emoji} size={18} /></span>
                          <span><b>{r.label}</b> — {r.meaning}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <button type="button" title="Forward" onClick={() => onForward(message)}>
            <i className="bi bi-forward-fill" />
          </button>
          {mine && (
            <button type="button" title="Message info" onClick={() => onInfo(message)}>
              <i className="bi bi-info-circle" />
            </button>
          )}
          <button type="button" title="Delete" onClick={() => onDelete(message)}>
            <i className="bi bi-trash" />
          </button>
        </div>
      </div>
    </div>
  );
}
