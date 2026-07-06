// Lightweight, safe message formatting (WhatsApp/Slack-style markdown).
//
//   **bold**   _italic_   ~~strike~~   `code`
//   - bullet / * bullet      1. numbered
//   [label](https://url)     bare http(s):// and www. links auto-link
//
// Input is plain text stored in chat_messages.body. We escape first, convert a
// small markdown subset to HTML, then DOMPurify-sanitize as a backstop. Links
// open safely in a new tab. No global DOMPurify hooks (so report rendering
// elsewhere is unaffected).
import DOMPurify from 'dompurify';

const LINK_ATTR = 'target="_blank" rel="noopener noreferrer nofollow"';
// Control-char sentinel for stashing links/code — can't occur in real messages.
const SENT = String.fromCharCode(0);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A mention to highlight: the tagged user's id + display name. */
export interface MentionRef { id: string; name: string; }

function inline(input: string, mentions: MentionRef[] = []): string {
  const stash: string[] = [];
  const put = (html: string) => `${SENT}${stash.push(html) - 1}${SENT}`;

  let s = input;
  // Stash @mentions, code spans and links first so emphasis rules don't corrupt
  // them (e.g. underscores inside a URL must not become italic). Mentions carry
  // the user id (data-uid) so the bubble can open the person on click.
  for (const m of mentions) {
    const esc = escapeHtml(m.name);        // input is already HTML-escaped
    if (!esc) continue;
    s = s.replace(new RegExp('@' + escapeRegExp(esc), 'g'),
      () => put(`<span class="ac-mention" data-uid="${escapeHtml(m.id)}" role="button" tabindex="0">@${esc}</span>`));
  }
  s = s.replace(/`([^`]+)`/g, (_m, c) => put(`<code>${c}</code>`));
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, url) =>
    put(`<a href="${url}" ${LINK_ATTR}>${label}</a>`));
  s = s.replace(/((?:https?:\/\/|www\.)[^\s<]+)/g, (m) => {
    const href = m.startsWith('www.') ? `http://${m}` : m;
    return put(`<a href="${href}" ${LINK_ATTR}>${m}</a>`);
  });

  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/_([^_\n]+)_/g, '<em>$1</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  return s.replace(new RegExp(`${SENT}(\\d+)${SENT}`, 'g'), (_m, i) => stash[Number(i)] ?? '');
}

/** Render a chat message body to sanitized HTML. `mentions` are the tagged
 *  users (id + display name) to highlight as clickable @mentions. */
export function renderMessageHtml(body: string, mentions: MentionRef[] = []): string {
  const lines = escapeHtml(body ?? '').split('\n');
  const out: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let prevText = false;

  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };

  for (const line of lines) {
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ul) {
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
      out.push(`<li>${inline(ul[1], mentions)}</li>`);
      prevText = false;
    } else if (ol) {
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
      out.push(`<li>${inline(ol[1], mentions)}</li>`);
      prevText = false;
    } else {
      closeList();
      if (prevText) out.push('<br>');
      out.push(inline(line, mentions));
      prevText = true;
    }
  }
  closeList();

  return DOMPurify.sanitize(out.join(''), {
    ALLOWED_TAGS: ['a', 'strong', 'em', 'del', 'code', 'ul', 'ol', 'li', 'br', 'span'],
    ADD_ATTR: ['target', 'rel', 'class', 'data-uid', 'role', 'tabindex'],
  });
}

/** Strip markdown to plain text — for previews, reply quotes, and forwards. */
export function toPlainText(body: string): string {
  return (body ?? '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/\s*\n+\s*/g, ' ')
    .trim();
}
