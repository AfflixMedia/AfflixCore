// Bottom composer: reply preview, formatting bar, emoji picker, @-mention
// autocomplete, growing textarea, send button. Enter sends; Shift+Enter makes a
// new line. List mode keeps adding bullets until turned off. Announcement
// channels render read-only for non-admins. Resets per conversation (re-keyed).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from 'react-bootstrap';
import Avatar from '../../components/Avatar';
import EmojiPicker from './EmojiPicker';
import type { ChatContact, ChatMessage } from './types';
import { contactName, roleLabel, roleBadge } from './types';
import { toPlainText } from './messageFormat';

const BULLET = '- ';
type ListMode = 'ul' | 'ol' | null;

function cleanOutgoing(s: string): string {
  // Drop empty list markers ("-", "*", "1.") left behind by list mode.
  return s.split('\n')
    .filter(l => {
      const t = l.trim();
      return t !== '-' && t !== '*' && !/^\d+\.$/.test(t);
    })
    .join('\n').trim();
}
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Props {
  disabled?: boolean;
  readOnly?: boolean;
  readOnlyNote?: string;
  readOnlyIcon?: string;          // bootstrap-icon class for the read-only banner
  mentionables?: ChatContact[];   // members that can be @-mentioned (groups)
  replyTo: ChatMessage | null;
  replyToSender: ChatContact | null;
  onCancelReply: () => void;
  onSend: (body: string, mentions: string[]) => void | Promise<void>;
}

export default function MessageComposer({
  disabled, readOnly, readOnlyNote, readOnlyIcon, mentionables = [],
  replyTo, replyToSender, onCancelReply, onSend,
}: Props) {
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [listMode, setListMode] = useState<ListMode>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const emojiWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, [text]);

  useEffect(() => { if (replyTo) taRef.current?.focus(); }, [replyTo]);

  useEffect(() => {
    if (!showEmoji) return;
    const onDoc = (e: MouseEvent) => {
      if (emojiWrapRef.current && !emojiWrapRef.current.contains(e.target as Node)) setShowEmoji(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [showEmoji]);

  // Mention suggestions for the active "@query".
  const suggestions = useMemo(() => {
    if (!mention || mentionables.length === 0) return [];
    const q = mention.query.toLowerCase();
    return mentionables
      .filter(c => contactName(c).toLowerCase().includes(q))
      .slice(0, 6);
  }, [mention, mentionables]);

  // Detect an "@query" immediately before the caret.
  const detectMention = (value: string, caret: number) => {
    if (mentionables.length === 0) { setMention(null); return; }
    const before = value.slice(0, caret);
    const m = /(?:^|\s)@([\p{L}\p{N} ]{0,25})$/u.exec(before);
    if (m) setMention({ start: caret - m[1].length - 1, query: m[1] });
    else setMention(null);
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
  };

  const pickMention = (c: ChatContact) => {
    if (!mention) return;
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? text.length;
    const insert = `@${contactName(c)} `;
    const next = text.slice(0, mention.start) + insert + text.slice(caret);
    setText(next);
    setMention(null);
    requestAnimationFrame(() => {
      ta?.focus();
      const pos = mention.start + insert.length;
      ta?.setSelectionRange(pos, pos);
    });
  };

  // Resolve which mentionables were actually @-tagged in the final text.
  const collectMentions = (body: string): string[] => {
    const ids: string[] = [];
    for (const c of mentionables) {
      const re = new RegExp('@' + escapeRegExp(contactName(c)) + '(?![\\p{L}\\p{N}])', 'u');
      if (re.test(body)) ids.push(c.id);
    }
    return Array.from(new Set(ids));
  };

  const submit = async () => {
    const body = cleanOutgoing(text);
    if (!body || disabled || readOnly) return;
    const mentions = collectMentions(body);
    setShowEmoji(false);
    setMention(null);
    const marker = listMode === 'ol' ? '1. ' : listMode === 'ul' ? BULLET : '';
    setText(marker);
    if (listMode) {
      requestAnimationFrame(() => {
        taRef.current?.focus();
        taRef.current?.setSelectionRange(marker.length, marker.length);
      });
    }
    await onSend(body, mentions);
  };

  const insertEmoji = (emoji: string) => {
    const ta = taRef.current;
    if (!ta) { setText(t => t + emoji); return; }
    const start = ta.selectionStart ?? text.length;
    const end = ta.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    requestAnimationFrame(() => { ta.focus(); const p = start + emoji.length; ta.setSelectionRange(p, p); });
  };

  const surround = (token: string) => {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? text.length;
    const end = ta.selectionEnd ?? text.length;
    const sel = text.slice(start, end) || 'text';
    setText(text.slice(0, start) + token + sel + token + text.slice(end));
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(start + token.length, start + token.length + sel.length); });
  };

  const toggleList = (mode: 'ul' | 'ol') => {
    const ta = taRef.current;
    if (listMode === mode) {                     // turn this list off
      setListMode(null);
      const t = text.trim();
      if (t === '-' || t === '*' || /^\d+\.$/.test(t)) setText('');
      requestAnimationFrame(() => ta?.focus());
      return;
    }
    setListMode(mode);
    const marker = mode === 'ol' ? '1. ' : BULLET;
    const start = ta?.selectionStart ?? text.length;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const nl = text.indexOf('\n', lineStart);
    const line = text.slice(lineStart, nl === -1 ? text.length : nl);
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) { requestAnimationFrame(() => ta?.focus()); return; }
    const next = text.slice(0, lineStart) + marker + text.slice(lineStart);
    setText(next === '' ? marker : next);
    requestAnimationFrame(() => {
      ta?.focus();
      const pos = lineStart + marker.length + line.length;
      ta?.setSelectionRange(pos, pos);
    });
  };

  const addLink = () => {
    const ta = taRef.current;
    const start = ta?.selectionStart ?? text.length;
    const end = ta?.selectionEnd ?? text.length;
    const label = text.slice(start, end) || 'link';
    const url = window.prompt('Link URL', 'https://')?.trim();
    if (!url) return;
    const md = `[${label}](${url})`;
    setText(text.slice(0, start) + md + text.slice(end));
    requestAnimationFrame(() => { ta?.focus(); const p = start + md.length; ta?.setSelectionRange(p, p); });
  };

  if (readOnly) {
    return (
      <div className="ac-composer ac-composer-readonly">
        <i className={`bi ${readOnlyIcon ?? 'bi-megaphone'} me-2`} />
        {readOnlyNote ?? 'Only admins can post here.'}
      </div>
    );
  }

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
        <button type="button" title="Bold (Ctrl+B)" disabled={disabled} onClick={() => surround('**')}><i className="bi bi-type-bold" /></button>
        <button type="button" title="Italic (Ctrl+I)" disabled={disabled} onClick={() => surround('_')}><i className="bi bi-type-italic" /></button>
        <button type="button" title="Strikethrough (~~text~~)" disabled={disabled} onClick={() => surround('~~')}><i className="bi bi-type-strikethrough" /></button>
        <button type="button" title={listMode === 'ul' ? 'Bullet list on — click to turn off' : 'Bulleted list'} className={listMode === 'ul' ? 'active' : ''} disabled={disabled} onClick={() => toggleList('ul')}><i className="bi bi-list-ul" /></button>
        <button type="button" title={listMode === 'ol' ? 'Numbered list on — click to turn off' : 'Numbered list'} className={listMode === 'ol' ? 'active' : ''} disabled={disabled} onClick={() => toggleList('ol')}><i className="bi bi-list-ol" /></button>
        <button type="button" title="Insert link" disabled={disabled} onClick={addLink}><i className="bi bi-link-45deg" /></button>
      </div>

      <div className="ac-composer-row">
        {suggestions.length > 0 && (
          <div className="ac-mention-pop">
            {suggestions.map(c => (
              <button key={c.id} type="button" className="ac-mention-item" onClick={() => pickMention(c)}>
                <Avatar name={contactName(c)} size="sm" />
                <span className="fw-semibold text-truncate flex-grow-1">{contactName(c)}</span>
                <Badge bg={roleBadge(c.role)} className="ac-role-badge">{roleLabel(c.role)}</Badge>
              </button>
            ))}
          </div>
        )}

        <div ref={emojiWrapRef} className="ac-emoji-wrap">
          <button type="button" className="ac-composer-icon" title="Emoji" disabled={disabled} onClick={() => setShowEmoji(s => !s)}>
            <i className="bi bi-emoji-smile" />
          </button>
          {showEmoji && <div className="ac-emoji-pop"><EmojiPicker onPick={insertEmoji} /></div>}
        </div>

        <textarea
          ref={taRef}
          className="ac-composer-input"
          rows={1}
          placeholder={disabled ? 'Select a chat to start messaging' : 'Type a message'}
          value={text}
          disabled={disabled}
          onChange={onChange}
          onClick={e => detectMention(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
          onKeyDown={e => {
            if ((e.ctrlKey || e.metaKey) && !e.altKey) {
              const k = e.key.toLowerCase();
              if (k === 'b') { e.preventDefault(); surround('**'); return; }
              if (k === 'i') { e.preventDefault(); surround('_'); return; }
            }
            if (e.key === 'Escape' && mention) { setMention(null); return; }
            if (e.key === 'Enter' && !e.shiftKey) {
              if (mention && suggestions.length > 0) { e.preventDefault(); pickMention(suggestions[0]); return; }
              e.preventDefault();
              if (listMode) {
                const ta = e.currentTarget;
                const start = ta.selectionStart;
                const end = ta.selectionEnd;
                let insert: string;
                if (listMode === 'ol') {
                  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
                  const m = /^\s*(\d+)\./.exec(text.slice(lineStart, start));
                  insert = `\n${(m ? parseInt(m[1], 10) : 0) + 1}. `;
                } else {
                  insert = `\n${BULLET}`;
                }
                const next = text.slice(0, start) + insert + text.slice(end);
                setText(next);
                requestAnimationFrame(() => { ta.focus(); const p = start + insert.length; ta.setSelectionRange(p, p); });
              } else {
                submit();
              }
            }
          }}
        />

        <button type="button" className="ac-composer-send" title="Send" disabled={disabled || !cleanOutgoing(text)} onClick={submit}>
          <i className="bi bi-send-fill" />
        </button>
      </div>
    </div>
  );
}
