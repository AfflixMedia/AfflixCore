// Bottom composer: reply preview, formatting bar, emoji picker, @-mention
// autocomplete, "/" tag autocomplete (conversation bookmarks → clickable
// links; brand groups also tag the brand's Products + Tasks as clickable
// links to the Products page / the task's detail popup), growing textarea,
// send button. Enter sends; Shift+Enter makes a new
// line. List mode keeps adding bullets until turned off. Announcement
// channels render read-only for non-admins. Resets per conversation
// (re-keyed). ChatPanel holds a ref to insert @mentions from the header's
// members dropdown (insertMention).
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Badge } from 'react-bootstrap';
import Avatar from '../../components/Avatar';
import EmojiPicker from './EmojiPicker';
import type { ChatAttachment, ChatBookmark, ChatContact, ChatMessage, ChatTagProduct, ChatTagTask } from './types';
import { contactName, roleLabel, roleBadge, attachmentLabel, attachmentFileIcon, fmtBytes } from './types';
import { toPlainText } from './messageFormat';
import { resourceIcon } from '../../lib/resourceIcon';

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

// One "/" popup entry: a bookmark link, a brand product, or a brand task.
type TagKind = 'resource' | 'product' | 'task';
type SlashItem =
  | { kind: 'resource'; key: string; r: ChatBookmark }
  | { kind: 'product'; key: string; p: ChatTagProduct }
  | { kind: 'task'; key: string; t: ChatTagTask };
const SLASH_HEAD: Record<TagKind, { icon: string; label: string }> = {
  resource: { icon: 'bi-link-45deg', label: 'Tag a resource' },
  product: { icon: 'bi-box-seam', label: 'Tag a product' },
  task: { icon: 'bi-check2-square', label: 'Tag a task' },
};
// Shown when an icon-opened popup has nothing to list (or the query filters
// everything out) — so the button always gives visible feedback.
const SLASH_EMPTY: Record<TagKind, string> = {
  resource: 'No bookmarks in this chat yet.',
  product: 'No products in this brand’s catalog yet.',
  task: 'No open tasks for this brand (you only see tasks you’re on).',
};

// One taggable row (bookmark / product / task) — shared by the "@" and "/"
// popups so both triggers offer the same items.
function TagRow({ it, onPick }: { it: SlashItem; onPick: (it: SlashItem) => void }) {
  if (it.kind === 'resource') {
    const ic = resourceIcon(it.r.url);
    return (
      <button type="button" className="ac-mention-item" onClick={() => onPick(it)}>
        <i className={`bi ${ic.icon} ac-slash-icon`} style={{ color: ic.color }} />
        <span className="min-w-0 flex-grow-1">
          <span className="fw-semibold text-truncate d-block">{it.r.title}</span>
          <span className="text-muted text-truncate d-block" style={{ fontSize: '.72rem' }}>{it.r.url}</span>
        </span>
      </button>
    );
  }
  if (it.kind === 'product') {
    return (
      <button type="button" className="ac-mention-item" onClick={() => onPick(it)}>
        <i className="bi bi-box-seam ac-slash-icon" style={{ color: '#e8862e' }} />
        <span className="min-w-0 flex-grow-1">
          <span className="fw-semibold text-truncate d-block">{it.p.name}</span>
          {it.p.standard_commission != null && (
            <span className="text-muted text-truncate d-block" style={{ fontSize: '.72rem' }}>
              {Number(it.p.standard_commission)}% commission
            </span>
          )}
        </span>
      </button>
    );
  }
  return (
    <button type="button" className="ac-mention-item" onClick={() => onPick(it)}>
      <i className="bi bi-check2-square ac-slash-icon" style={{ color: '#3b82f6' }} />
      <span className="min-w-0 flex-grow-1">
        <span className="fw-semibold text-truncate d-block">{it.t.title}</span>
        <span className="text-muted text-truncate d-block" style={{ fontSize: '.72rem' }}>
          {it.t.status === 'in_progress' ? 'In progress' : it.t.status === 'in_review' ? 'In review' : 'Not started'}
        </span>
      </span>
    </button>
  );
}

export interface MessageComposerHandle {
  /** Insert "@Name " at the caret (used by the header members dropdown). */
  insertMention: (name: string) => void;
  /** Insert a clickable product tag at the caret (from the Products popup). */
  insertProductTag: (name: string) => void;
  /** Attach a file as if picked via the paperclip (drag & drop / paste). */
  attachFile: (file: File) => void;
}

interface Props {
  disabled?: boolean;
  readOnly?: boolean;
  readOnlyNote?: string;
  readOnlyIcon?: string;          // bootstrap-icon class for the read-only banner
  mentionables?: ChatContact[];   // members that can be @-mentioned (groups)
  resources?: ChatBookmark[];     // conversation bookmarks, taggable via "/"
  products?: ChatTagProduct[];    // brand groups: the brand's products, taggable via "/"
  tasks?: ChatTagTask[];          // brand groups: the brand's open tasks, taggable via "/"
  brandId?: string | null;        // brand group → show tag buttons + link products to the brand
  replyTo: ChatMessage | null;
  replyToSender: ChatContact | null;
  onCancelReply: () => void;
  onSend: (body: string, mentions: string[], attachment?: ChatAttachment | null) => void | Promise<void>;
  /** Upload a picked image/video to Google Drive (provided by GlobalChat);
   *  absent → no attach button. */
  uploadFile?: (file: File, onProgress: (pct: number) => void) => Promise<ChatAttachment>;
}

// One picked image/video being uploaded to Drive (or ready to send).
interface PendingAttachment {
  file: File;
  previewUrl: string | null;   // object URL for image thumbnails
  progress: number;            // 0–100 while PUTting to Drive
  attachment: ChatAttachment | null;  // set once finalized → ready to send
  error: string | null;
}

const MessageComposer = forwardRef<MessageComposerHandle, Props>(function MessageComposer({
  disabled, readOnly, readOnlyNote, readOnlyIcon,
  mentionables = [], resources = [], products = [], tasks = [], brandId,
  replyTo, replyToSender, onCancelReply, onSend, uploadFile,
}: Props, ref) {
  const brandGroup = !!brandId;
  const [text, setText] = useState('');
  const [pending, setPending] = useState<PendingAttachment | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Skip stale async upload results after the pending chip was dismissed
  // (or replaced by another pick).
  const pendingSeqRef = useRef(0);
  const [showEmoji, setShowEmoji] = useState(false);
  const [listMode, setListMode] = useState<ListMode>(null);
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [slash, setSlash] = useState<{ start: number; query: string } | null>(null);
  // Set when the popup was opened from an icon button — narrows the "/" list
  // to that kind. Cleared with the popup.
  const [slashKind, setSlashKind] = useState<TagKind | null>(null);
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

  const closeSlash = () => { setSlash(null); setSlashKind(null); };

  // ---- Image/video attachment (uploaded to Google Drive on pick) ----------
  const dropPending = () => {
    pendingSeqRef.current += 1;                 // ignore in-flight results
    setPending(prev => {
      if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
    if (fileRef.current) fileRef.current.value = '';
  };

  const pickFile = async (file: File) => {
    if (!uploadFile) return;
    dropPending();
    const seq = ++pendingSeqRef.current;
    const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
    setPending({ file, previewUrl, progress: 0, attachment: null, error: null });
    try {
      const attachment = await uploadFile(file, pct => {
        if (pendingSeqRef.current !== seq) return;
        setPending(p => (p ? { ...p, progress: pct } : p));
      });
      if (pendingSeqRef.current !== seq) return;
      setPending(p => (p ? { ...p, progress: 100, attachment } : p));
    } catch (e) {
      if (pendingSeqRef.current !== seq) return;
      setPending(p => (p ? { ...p, error: (e as Error).message } : p));
    }
  };

  const uploading = !!pending && !pending.attachment && !pending.error;

  // Mention suggestions for the active "@query".
  const suggestions = useMemo(() => {
    if (!mention || mentionables.length === 0) return [];
    const q = mention.query.toLowerCase();
    return mentionables
      .filter(c => contactName(c).toLowerCase().includes(q))
      .slice(0, 6);
  }, [mention, mentionables]);

  // The "@" popup also offers the brand's products + tasks (people first) —
  // "mention a product" is the natural gesture, so both triggers work.
  const mentionTags = useMemo<SlashItem[]>(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    const out: SlashItem[] = [];
    products
      .filter(p => p.name.toLowerCase().includes(q))
      .slice(0, 4)
      .forEach(p => out.push({ kind: 'product', key: `p-${p.id}`, p }));
    tasks
      .filter(t => t.title.toLowerCase().includes(q))
      .slice(0, 4)
      .forEach(t => out.push({ kind: 'task', key: `t-${t.id}`, t }));
    return out;
  }, [mention, products, tasks]);

  // "/query" suggestions — bookmarks + (brand groups) products + tasks,
  // grouped per kind. Products and tasks come FIRST (brand groups always have
  // a long synced-bookmarks list that would otherwise push them below the
  // fold). An icon-opened popup / a filter chip narrows to one kind.
  const slashSuggestions = useMemo<SlashItem[]>(() => {
    if (!slash) return [];
    const q = slash.query.toLowerCase();
    const cap = slashKind ? 12 : 4;
    const out: SlashItem[] = [];
    if (!slashKind || slashKind === 'product') {
      products
        .filter(p => p.name.toLowerCase().includes(q))
        .slice(0, cap)
        .forEach(p => out.push({ kind: 'product', key: `p-${p.id}`, p }));
    }
    if (!slashKind || slashKind === 'task') {
      tasks
        .filter(t => t.title.toLowerCase().includes(q))
        .slice(0, cap)
        .forEach(t => out.push({ kind: 'task', key: `t-${t.id}`, t }));
    }
    if (!slashKind || slashKind === 'resource') {
      resources
        .filter(r => r.title.toLowerCase().includes(q) || r.url.toLowerCase().includes(q))
        .slice(0, cap)
        .forEach(r => out.push({ kind: 'resource', key: `r-${r.id}`, r }));
    }
    return out;
  }, [slash, slashKind, resources, products, tasks]);

  // Which kinds the "/" popup can offer at all — drives the filter chips.
  const slashKinds = useMemo<TagKind[]>(() => {
    const ks: TagKind[] = [];
    if (brandGroup || products.length > 0) ks.push('product');
    if (brandGroup || tasks.length > 0) ks.push('task');
    if (resources.length > 0) ks.push('resource');
    return ks;
  }, [brandGroup, products.length, tasks.length, resources.length]);

  const taggables = resources.length + products.length + tasks.length;

  // Detect an "@query" (mention) or "/query" (tag) immediately before the caret.
  const detectMention = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    if (mentionables.length > 0) {
      const m = /(?:^|\s)@([\p{L}\p{N} ]{0,25})$/u.exec(before);
      setMention(m ? { start: caret - m[1].length - 1, query: m[1] } : null);
    } else setMention(null);
    if (taggables > 0) {
      const s = /(?:^|\s)\/([\p{L}\p{N} \-_.]{0,30})$/u.exec(before);
      if (s) setSlash({ start: caret - s[1].length - 1, query: s[1] });
      else closeSlash();
    } else closeSlash();
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
  };

  // Insert `raw` at the caret (space-padded when needed), close both popups,
  // and place the caret after it. Shared by the ref methods below.
  const insertAtCaret = (raw: string) => {
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? text.length;
    const before = text.slice(0, caret);
    const needsSpace = before.length > 0 && !/\s$/.test(before);
    const insert = (needsSpace ? ' ' : '') + raw;
    setText(before + insert + text.slice(caret));
    setMention(null); closeSlash();
    requestAnimationFrame(() => {
      ta?.focus();
      const pos = caret + insert.length;
      ta?.setSelectionRange(pos, pos);
    });
  };

  // A product tag: a clickable markdown link to the brand's Products page when
  // we know the brand, else a plain bold chip. (Link labels can't contain the
  // markdown bracket chars, so strip them from the name.)
  const productInsert = (name: string): string => {
    const label = `📦 ${name.replace(/[[\]]/g, '')}`;
    return brandId
      ? `[${label}](${window.location.origin}/brands/${brandId}?tab=products) `
      : `**${label}** `;
  };

  // Header members dropdown → "@Name "; Products popup → clickable product
  // tag; ChatPanel's drop zone → attach the dragged file.
  useImperativeHandle(ref, () => ({
    insertMention(name: string) { insertAtCaret(`@${name} `); },
    insertProductTag(name: string) { insertAtCaret(productInsert(name)); },
    attachFile(file: File) { pickFile(file); },
  }));

  // Replace everything from the trigger char up to the caret with `insert`,
  // close both popups, and put the caret after the inserted text.
  const replaceTrigger = (start: number, insert: string) => {
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? text.length;
    setText(text.slice(0, start) + insert + text.slice(caret));
    setMention(null);
    closeSlash();
    requestAnimationFrame(() => {
      ta?.focus();
      const pos = start + insert.length;
      ta?.setSelectionRange(pos, pos);
    });
  };

  // A task tag: a clickable markdown link that opens that exact task's detail
  // popup on the Tasks page (/tasks?t=<id>, consumed there).
  const taskInsert = (t: ChatTagTask): string =>
    `[✅ ${t.title.replace(/[[\]]/g, '')}](${window.location.origin}/tasks?t=${t.id}) `;

  // What a picked tag inserts: bookmark / product / task all become clickable
  // links (product → the brand's Products page, task → its detail popup).
  const tagInsertText = (it: SlashItem): string =>
    it.kind === 'resource'
      ? `[${it.r.title}](${it.r.url}) `
      : it.kind === 'product'
        ? productInsert(it.p.name)
        : taskInsert(it.t);

  const pickMention = (c: ChatContact) => {
    if (mention) replaceTrigger(mention.start, `@${contactName(c)} `);
  };
  const pickMentionTag = (it: SlashItem) => {
    if (mention) replaceTrigger(mention.start, tagInsertText(it));
  };
  const pickSlash = (it: SlashItem) => {
    if (slash) replaceTrigger(slash.start, tagInsertText(it));
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
    const attachment = pending?.attachment ?? null;
    if ((!body && !attachment) || uploading || disabled || readOnly) return;
    const mentions = collectMentions(body);
    setShowEmoji(false);
    setMention(null);
    closeSlash();
    const marker = listMode === 'ol' ? '1. ' : listMode === 'ul' ? BULLET : '';
    setText(marker);
    if (listMode) {
      requestAnimationFrame(() => {
        taRef.current?.focus();
        taRef.current?.setSelectionRange(marker.length, marker.length);
      });
    }
    dropPending();
    await onSend(body, mentions, attachment);
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
            <div className="ac-reply-preview-body text-truncate">
              {toPlainText(replyTo.body) || attachmentLabel(replyTo.attachment)}
            </div>
          </div>
          <button type="button" className="ac-reply-cancel" onClick={onCancelReply} title="Cancel reply">
            <i className="bi bi-x-lg" />
          </button>
        </div>
      )}

      {pending && (
        <div className="ac-attach-preview">
          {pending.previewUrl ? (
            <img className="ac-attach-thumb" src={pending.previewUrl} alt="" />
          ) : (
            <span className="ac-attach-thumb ac-attach-thumb-icon">
              <i className={`bi ${pending.file.type.startsWith('video/') ? 'bi-camera-video' : attachmentFileIcon(pending.file.name)}`} />
            </span>
          )}
          <div className="flex-grow-1 min-w-0">
            <div className="ac-attach-name text-truncate">{pending.file.name}</div>
            {pending.error ? (
              <div className="ac-attach-status text-danger">{pending.error}</div>
            ) : pending.attachment ? (
              <div className="ac-attach-status">
                <i className="bi bi-check-circle-fill me-1" />
                {fmtBytes(pending.file.size)} — ready to send
              </div>
            ) : (
              <>
                <div className="ac-attach-status">Uploading… {pending.progress}%</div>
                <div className="ac-attach-bar"><span style={{ width: `${pending.progress}%` }} /></div>
              </>
            )}
          </div>
          <button type="button" className="ac-reply-cancel" title="Remove attachment" onClick={dropPending}>
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
        {mention && (suggestions.length > 0 || mentionTags.length > 0) && (
          <div className="ac-mention-pop">
            {suggestions.length > 0 && mentionTags.length > 0 && (
              <div className="ac-slash-head"><i className="bi bi-people me-1" />People</div>
            )}
            {suggestions.map(c => (
              <button key={c.id} type="button" className="ac-mention-item" onClick={() => pickMention(c)}>
                <Avatar name={contactName(c)} src={c.avatar_url} size="sm" />
                <span className="fw-semibold text-truncate flex-grow-1">{contactName(c)}</span>
                <Badge bg={roleBadge(c.role)} className="ac-role-badge">{roleLabel(c.role, c.is_superbob)}</Badge>
              </button>
            ))}
            {mentionTags.map((it, i) => {
              const firstOfKind = i === 0 || mentionTags[i - 1].kind !== it.kind;
              return (
                <div key={it.key}>
                  {firstOfKind && (
                    <div className="ac-slash-head">
                      <i className={`bi ${SLASH_HEAD[it.kind].icon} me-1`} />{SLASH_HEAD[it.kind].label}
                    </div>
                  )}
                  <TagRow it={it} onPick={pickMentionTag} />
                </div>
              );
            })}
          </div>
        )}

        {slash && slashKinds.length > 0 && (
          <div className="ac-mention-pop ac-slash-pop">
            {/* Kind filter chips — pinned so products/tasks are one click away
                even when the bookmark list is long. */}
            {slashKinds.length > 1 && (
              <div className="ac-slash-tabs">
                <button type="button" className={!slashKind ? 'on' : ''}
                  onMouseDown={e => e.preventDefault()} onClick={() => setSlashKind(null)}>
                  All
                </button>
                {slashKinds.map(k => (
                  <button key={k} type="button" className={slashKind === k ? 'on' : ''}
                    onMouseDown={e => e.preventDefault()} onClick={() => setSlashKind(k)}>
                    <i className={`bi ${SLASH_HEAD[k].icon} me-1`} />
                    {k === 'resource' ? 'Resources' : k === 'product' ? 'Products' : 'Tasks'}
                  </button>
                ))}
              </div>
            )}
            {slashSuggestions.length === 0 && (
              slashKind ? (
                <>
                  <div className="ac-slash-head">
                    <i className={`bi ${SLASH_HEAD[slashKind].icon} me-1`} />{SLASH_HEAD[slashKind].label}
                  </div>
                  <div className="ac-slash-empty">{slash.query ? 'No matches.' : SLASH_EMPTY[slashKind]}</div>
                </>
              ) : (
                <div className="ac-slash-empty">No matches.</div>
              )
            )}
            {slashSuggestions.map((it, i) => {
              const firstOfKind = i === 0 || slashSuggestions[i - 1].kind !== it.kind;
              const head = SLASH_HEAD[it.kind];
              return (
                <div key={it.key}>
                  {firstOfKind && (
                    <div className="ac-slash-head">
                      <i className={`bi ${head.icon} me-1`} />{head.label}
                    </div>
                  )}
                  <TagRow it={it} onPick={pickSlash} />
                </div>
              );
            })}
          </div>
        )}

        {uploadFile && (
          <>
            <input
              ref={fileRef}
              type="file"
              className="d-none"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) pickFile(f);
              }}
            />
            <button
              type="button"
              className="ac-composer-icon"
              title="Attach a file"
              disabled={disabled || uploading}
              onClick={() => fileRef.current?.click()}
            >
              <i className="bi bi-paperclip" />
            </button>
          </>
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
          onPaste={e => {
            // Pasting a screenshot / copied file attaches it like the 📎 pick.
            if (!uploadFile) return;
            const f = e.clipboardData?.files?.[0];
            if (f) { e.preventDefault(); pickFile(f); }
          }}
          onKeyDown={e => {
            if ((e.ctrlKey || e.metaKey) && !e.altKey) {
              const k = e.key.toLowerCase();
              if (k === 'b') { e.preventDefault(); surround('**'); return; }
              if (k === 'i') { e.preventDefault(); surround('_'); return; }
            }
            if (e.key === 'Escape' && (mention || slash)) { setMention(null); closeSlash(); return; }
            if (e.key === 'Enter' && !e.shiftKey) {
              if (mention && (suggestions.length > 0 || mentionTags.length > 0)) {
                e.preventDefault();
                if (suggestions.length > 0) pickMention(suggestions[0]); else pickMentionTag(mentionTags[0]);
                return;
              }
              if (slash && slashSuggestions.length > 0) { e.preventDefault(); pickSlash(slashSuggestions[0]); return; }
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

        <button
          type="button"
          className="ac-composer-send"
          title={uploading ? 'Uploading…' : 'Send'}
          disabled={disabled || uploading || (!cleanOutgoing(text) && !pending?.attachment)}
          onClick={submit}
        >
          <i className="bi bi-send-fill" />
        </button>
      </div>
    </div>
  );
});

export default MessageComposer;
