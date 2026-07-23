import DOMPurify from 'dompurify';

/* ════════════════════════════════════════════════════════════
   Minimal Markdown → sanitized HTML for the generated brief.

   Deliberately small: the brief only ever uses headings, bullets, ordered
   lists, bold/italic, links, tables, blockquotes and rules (the system prompt
   pins the output format). Avoids adding a Markdown dependency for one view.

   Output always goes through DOMPurify — same rule as the rest of the app for
   any rendered HTML.
════════════════════════════════════════════════════════════ */

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Resolves a stored image reference to a src the browser can load.
 *
 * Brief images live on Google Drive and are stored in the Markdown as a stable
 * `drive:<fileId>` marker, never a signed URL (those expire in 6h, which would
 * break every shared brief overnight). The caller passes a map of freshly
 * minted streaming URLs, re-signed on each render.
 */
export type ImageResolver = (ref: string) => string | undefined;

/**
 * Drive id carried by an image reference, in either stored form: the canonical
 * `drive:<id>` marker, or the `https://afflix.invalid/brief-image#<id>` URL the
 * editor/import pipeline parks ids in while they move through HTML. The URL
 * form should never reach storage, but briefs saved before that rule was
 * enforced still carry it — recognising both keeps them rendering.
 */
export function driveIdOf(raw: string): string | null {
  const m = raw.match(/^(?:drive:|https:\/\/afflix\.invalid\/brief-image#)([\w-]{10,})$/);
  return m ? m[1] : null;
}

function resolveSrc(raw: string, resolve?: ImageResolver): string | null {
  const id = driveIdOf(raw);
  if (id) {
    const url = resolve?.(id);
    return url ?? null;          // not signed yet: caller renders a placeholder
  }
  return /^https?:/i.test(raw) ? raw : null;
}

/** Inline: `code`, images, **bold**, *italic*, [label](url). Escapes first. */
function inline(src: string, resolve?: ImageResolver): string {
  let s = esc(src);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Images BEFORE links — `![alt](src)` would otherwise match the link rule
  // and render as a stray "!" plus an anchor.
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, raw) => {
    const url = resolveSrc(raw, resolve);
    if (!url) return `<span class="pc-aib-imgmissing" title="Image loading">🖼️ ${alt || 'image'}</span>`;
    return `<img class="pc-aib-img" src="${url}" alt="${alt}" loading="lazy" />`;
  });

  // Links after images so underscores inside URLs survive.
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => {
    const safe = /^(https?:|mailto:)/i.test(url) ? url : '#';
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return s;
}

/** Every `drive:<id>` referenced by a brief (body, logo, …). */
export function extractDriveIds(...fields: (string | null | undefined)[]): string[] {
  const found = new Set<string>();
  for (const f of fields) {
    if (!f) continue;
    for (const m of f.matchAll(/(?:drive:|afflix\.invalid\/brief-image#)([\w-]{10,})/g)) found.add(m[1]);
  }
  return Array.from(found);
}

const splitRow = (line: string) =>
  line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());

const isDivider = (line: string) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');

export function renderBriefMarkdown(md: string, resolve?: ImageResolver): string {
  const lines = (md || '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  const I = (s: string) => inline(s, resolve);
  let i = 0;

  // Open list state: null | 'ul' | 'ol'
  let list: 'ul' | 'ol' | null = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  while (i < lines.length) {
    const line = lines[i];

    // ── table ──
    if (/^\s*\|/.test(line) && i + 1 < lines.length && isDivider(lines[i + 1])) {
      closeList();
      const head = splitRow(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { body.push(splitRow(lines[i])); i++; }
      out.push('<div class="pc-aib-tablewrap"><table>');
      out.push(`<thead><tr>${head.map(c => `<th>${I(c)}</th>`).join('')}</tr></thead>`);
      out.push(`<tbody>${body.map(r => `<tr>${r.map(c => `<td>${I(c)}</td>`).join('')}</tr>`).join('')}</tbody>`);
      out.push('</table></div>');
      continue;
    }

    // ── blank ──
    if (!line.trim()) { closeList(); i++; continue; }

    // ── rule ──
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { closeList(); out.push('<hr />'); i++; continue; }

    // ── heading ──
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      const lvl = h[1].length;
      out.push(`<h${lvl}>${I(h[2].trim())}</h${lvl}>`);
      i++; continue;
    }

    // ── blockquote (consecutive lines) ──
    if (/^\s*>\s?/.test(line)) {
      closeList();
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${buf.map(b => I(b)).join('<br />')}</blockquote>`);
      continue;
    }

    // ── bullet ──
    const li = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (li) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${I(li[2])}</li>`);
      i++; continue;
    }

    // ── ordered ──
    const oli = line.match(/^(\s*)\d+[.)]\s+(.*)$/);
    if (oli) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${I(oli[2])}</li>`);
      i++; continue;
    }

    // ── paragraph ──
    closeList();
    out.push(`<p>${I(line.trim())}</p>`);
    i++;
  }
  closeList();

  return DOMPurify.sanitize(out.join('\n'), { ADD_ATTR: ['target', 'rel', 'loading'] });
}
