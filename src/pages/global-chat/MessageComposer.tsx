// Bottom composer: reply preview, formatting bar, emoji picker, growing
// textarea, send button. Enter sends; Shift+Enter makes a new line. When list
// mode is on, Enter keeps adding bullets until you turn it off (the Send button
// sends). List mode resets per conversation (the parent re-keys this component).
import { useEffect, useRef, useState } from 'react';
import EmojiPicker from './EmojiPicker';
import type { ChatContact, ChatMessage } from './types';
import { contactName } from './types';
import { toPlainText } from './messageFormat';

const BULLET = '- ';

// What actually gets sent: drop empty bullet lines, then trim.
function cleanOutgoing(s: string): string {
  return s
    .split('\n')
    .filter(l => l.trim() !== '-' && l.trim() !== '*')
    .join('\n')
    .trim();
}

interface Props {
  disabled?: boolean;
  replyTo: ChatMessage | null;
  replyToSender: ChatContact | null;
  onCancelReply: () => void;
  onSend: (body: string) => void | Promise<void>;
}

export default function MessageComposer({
  disabled, replyTo, replyToSender, onCancelReply, onSend,
}: Props) {
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [listMode, setListMode] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const emojiWrapRef = useRef<HTMLDivElement>(null);

  // Auto-grow the textarea up to a cap.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, [text]);

  // Focus the box when a reply is started.
  useEffect(() => { if (replyTo) taRef.current?.focus(); }, [replyTo]);

  // Close the emoji popover on outside click.
  useEffect(() => {
    if (!showEmoji) return;
    const onDoc = (e: MouseEvent) => {
      if (emojiWrapRef.current && !emojiWrapRef.current.contains(e.target as Node)) {
        setShowEmoji(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [showEmoji]);

  const submit = async () => {
    const body = cleanOutgoing(text);
    if (!body || disabled) return;
    setShowEmoji(false);
    // Keep list mode going after sending (until the user turns it off).
    setText(listMode ? BULLET : '');
    if (listMode) {
      requestAnimationFrame(() => {
        taRef.current?.focus();
        taRef.current?.setSelectionRange(BULLET.length, BULLET.length);
      });
    }
    await onSend(body);
  };

  const insertEmoji = (emoji: string) => {
    const ta = taRef.current;
    if (!ta) { setText(t => t + emoji); return; }
    const start = ta.selectionStart ?? text.length;
    const end = ta.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + emoji.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  // Wrap the current selection with markdown tokens (bold / italic / etc).
  const surround = (token: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? text.length;
    const end = ta.selectionEnd ?? text.length;
    const sel = text.slice(start, end) || 'text';
    const next = text.slice(0, start) + token + sel + token + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + token.length, start + token.length + sel.length);
    });
  };

  // Toggle "list mode". While on, every new line stays a bullet (see onKeyDown)
  // until the user turns it off. Turning it on bullets the current line.
  const toggleList = () => {
    const ta = taRef.current;
    if (listMode) {
      setListMode(false);
      // clear a lone empty bullet so the box isn't left with a stray "- "
      if (text.trim() === '-' || text.trim() === '*') setText('');
      requestAnimationFrame(() => ta?.focus());
      return;
    }
    setListMode(true);
    const start = ta?.selectionStart ?? text.length;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const nl = text.indexOf('\n', lineStart);
    const line = text.slice(lineStart, nl === -1 ? text.length : nl);
    if (/^\s*[-*]\s+/.test(line)) { requestAnimationFrame(() => ta?.focus()); return; }
    const next = text.slice(0, lineStart) + BULLET + text.slice(lineStart);
    setText(next === '' ? BULLET : next);
    requestAnimationFrame(() => {
      ta?.focus();
      const pos = lineStart + BULLET.length + line.length;
      ta?.setSelectionRange(pos, pos);
    });
  };

  // Insert a markdown link [label](url), prompting for the URL.
  const addLink = () => {
    const ta = taRef.current;
    const start = ta?.selectionStart ?? text.length;
    const end = ta?.selectionEnd ?? text.length;
    const label = text.slice(start, end) || 'link';
    const url = window.prompt('Link URL', 'https://')?.trim();
    if (!url) return;
    const md = `[${label}](${url})`;
    const next = text.slice(0, start) + md + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      ta?.focus();
      const pos = start + md.length;
      ta?.setSelectionRange(pos, pos);
    });
  };

  return (
    <div className="ac-composer">
      {replyTo && (
        <div className="ac-reply-preview">
          <div className="ac-reply-preview-bar" />
          <div className="flex-grow-1 min-w-0">
            <div className="ac-reply-preview-name">{contactName(replyToSender)}</div>
            <div className="ac-reply-preview-body text-truncate">{toPlainText(replyTo.body)}</div>
          </div>
          <button type="button" className="ac-reply-cancel" onClick={onCancelReply} title="Cancel reply">
            <i className="bi bi-x-lg" />
          </button>
        </div>
      )}

      <div className="ac-format-bar">
        <button type="button" title="Bold (**text**)" disabled={disabled} onClick={() => surround('**')}>
          <i className="bi bi-type-bold" />
        </button>
        <button type="button" title="Italic (_text_)" disabled={disabled} onClick={() => surround('_')}>
          <i className="bi bi-type-italic" />
        </button>
        <button type="button" title="Strikethrough (~~text~~)" disabled={disabled} onClick={() => surround('~~')}>
          <i className="bi bi-type-strikethrough" />
        </button>
        <button
          type="button"
          title={listMode ? 'List on — click to turn off' : 'Bulleted list'}
          className={listMode ? 'active' : ''}
          disabled={disabled}
          onClick={toggleList}
        >
          <i className="bi bi-list-ul" />
        </button>
        <button type="button" title="Insert link" disabled={disabled} onClick={addLink}>
          <i className="bi bi-link-45deg" />
        </button>
      </div>

      <div className="ac-composer-row">
        <div ref={emojiWrapRef} className="ac-emoji-wrap">
          <button
            type="button"
            className="ac-composer-icon"
            title="Emoji"
            disabled={disabled}
            onClick={() => setShowEmoji(s => !s)}
          >
            <i className="bi bi-emoji-smile" />
          </button>
          {showEmoji && (
            <div className="ac-emoji-pop">
              <EmojiPicker onPick={insertEmoji} />
            </div>
          )}
        </div>

        <textarea
          ref={taRef}
          className="ac-composer-input"
          rows={1}
          placeholder={disabled ? 'Select a chat to start messaging' : 'Type a message'}
          value={text}
          disabled={disabled}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (listMode) {
                // Continue the list on a new line instead of sending.
                const ta = e.currentTarget;
                const start = ta.selectionStart;
                const end = ta.selectionEnd;
                const insert = `\n${BULLET}`;
                const next = text.slice(0, start) + insert + text.slice(end);
                setText(next);
                requestAnimationFrame(() => {
                  ta.focus();
                  const pos = start + insert.length;
                  ta.setSelectionRange(pos, pos);
                });
              } else {
                submit();
              }
            }
          }}
        />

        <button
          type="button"
          className="ac-composer-send"
          title="Send"
          disabled={disabled || !cleanOutgoing(text)}
          onClick={submit}
        >
          <i className="bi bi-send-fill" />
        </button>
      </div>
    </div>
  );
}
