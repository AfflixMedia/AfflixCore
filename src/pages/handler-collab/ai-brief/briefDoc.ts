/* ════════════════════════════════════════════════════════════
   Brief document model — the bridge between the stored Markdown and the
   topic-wise GUI editor.

   The brief is STORED as Markdown (the generator writes it, the share page and
   the preview render it). Editing it as raw Markdown is unpleasant, so this
   module parses that text into a small structure the editor can drive:

       doc = title + sections[]            ("## Heading" starts a section)
       section = heading + blocks[]
       block   = rich text  (edited with Quill)
               | table      (edited as a grid)

   Tables get their own block kind because Quill silently drops <table>, and a
   brief's hook/angle tables are the part people most want to tweak.

   Round-trip rule: parse → edit → serialize must not lose content, so anything
   we cannot model stays inside a text block as-is.
════════════════════════════════════════════════════════════ */

/**
 * Stand-in src for a Drive image that has no signed URL in hand.
 *
 * Images are stored as a `drive:<id>` marker, but "drive:" is not a protocol a
 * browser (or DOMPurify) will accept as an <img src>. Parking the id inside a
 * real https URL carries it safely through sanitizing, Quill and mammoth, and
 * `driveRefFromSrc` turns it back into the marker on the way to storage.
 */
export const UNRESOLVED_IMG = 'https://afflix.invalid/brief-image#';

export const unresolvedSrc = (driveId: string) => `${UNRESOLVED_IMG}${driveId}`;

export function driveRefFromSrc(src: string): string {
  if (src.startsWith(UNRESOLVED_IMG)) return `drive:${src.slice(UNRESOLVED_IMG.length)}`;
  return src;
}

export interface BriefBlock {
  id: string;
  kind: 'text' | 'table';
  md: string;
}

export interface BriefSection {
  id: string;
  /** Heading text without the leading "##". Empty = content above the first heading. */
  heading: string;
  blocks: BriefBlock[];
}

export interface BriefDoc {
  /** The leading "# Title" line, if the brief has one. */
  title: string;
  sections: BriefSection[];
}

let seq = 0;
const uid = (p: string) => `${p}${++seq}-${Math.random().toString(36).slice(2, 7)}`;

export const newTextBlock = (md = ''): BriefBlock => ({ id: uid('b'), kind: 'text', md });
export const newTableBlock = (): BriefBlock => ({
  id: uid('b'),
  kind: 'table',
  md: '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |',
});
export const newSection = (heading = 'New section'): BriefSection => ({
  id: uid('s'), heading, blocks: [newTextBlock('')],
});

const isTableDivider = (line: string) =>
  /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');

/** A "**Video #N**" marker line — how briefs delimit their reference videos. */
export const isVideoMarker = (line: string) => /^\*\*\s*video\b[^*]*\*\*:?\s*$/i.test(line.trim());

/** A "### Angle N: …" subheading — how briefs delimit content angles. */
export const isAngleMarker = (line: string) => /^###\s+/.test(line.trim());

/**
 * Label for a block, for the editor's block bar:
 *   · a "**Video #N**" run → "Video #1"
 *   · a "### Angle N: …" run → "Angle 1: …"
 *   · else null (plain text).
 * The screenshot travels above its video marker, so a leading standalone image
 * is skipped when looking.
 */
export function videoBlockLabel(md: string): string | null {
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (!line || /^!\[[^\]]*\]\([^)\s]+\)$/.test(line)) continue;
    if (isAngleMarker(line)) return line.replace(/^###\s+/, '').replace(/\*\*/g, '').trim();
    return isVideoMarker(line) ? line.replace(/\*\*/g, '').replace(/:$/, '').trim() : null;
  }
  return null;
}

type SplitKind = 'none' | 'videos' | 'angles';

/**
 * Splits a section's Markdown into alternating text / table blocks.
 *
 * `split` gives the editor one block per repeated unit so each is separately
 * movable / deletable:
 *   · 'videos' — each "**Video #N**" run (its screenshot travels with it; a
 *     trailing italic "*Also study…*" line starts a fresh block).
 *   · 'angles' — each "### Angle N" subheading run.
 * Purely editing granularity — serialization re-joins blocks with blank lines,
 * so the stored Markdown is identical either way.
 */
function blocksFromMarkdown(md: string, split: SplitKind = 'none'): BriefBlock[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const blocks: BriefBlock[] = [];
  let buf: string[] = [];

  const flushText = () => {
    const t = buf.join('\n').trim();
    if (t) blocks.push(newTextBlock(t));
    buf = [];
  };

  const isImageLine = (l: string) => /^!\[[^\]]*\]\([^)\s]+\)$/.test(l.trim());

  /** Flushes the buffer, carrying a directly-preceding standalone image over. */
  const splitHere = () => {
    const carried: string[] = [];
    let end = buf.length;
    while (end > 0 && !buf[end - 1].trim()) end--;
    if (end > 0 && isImageLine(buf[end - 1])) { carried.push(buf[end - 1]); end--; }
    buf = buf.slice(0, end);
    flushText();
    buf = carried;
  };

  for (let i = 0; i < lines.length; i++) {
    if (/^\s*\|/.test(lines[i]) && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      flushText();
      const rows: string[] = [lines[i], lines[i + 1]];
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      i--;                                   // the for-loop increments again
      blocks.push({ id: uid('b'), kind: 'table', md: rows.join('\n') });
      continue;
    }
    if (split === 'videos' && buf.some(l => l.trim())) {
      if (isVideoMarker(lines[i])) splitHere();
      // An italic-only line after a video run ("*Also study…*") closes the
      // last video and starts the trailing-links block.
      else if (/^[*_][^*_].*[*_]:?\s*$/.test(lines[i].trim()) && buf.some(isVideoMarker)) flushText();
    } else if (split === 'angles' && isAngleMarker(lines[i]) && buf.some(l => l.trim())) {
      flushText();
    }
    buf.push(lines[i]);
  }
  flushText();
  return blocks;
}

export function parseBriefDoc(md: string): BriefDoc {
  const lines = (md || '').replace(/\r\n/g, '\n').split('\n');
  let title = '';
  let i = 0;

  // A leading "# Title" (after any blank lines) becomes the document title.
  while (i < lines.length && !lines[i].trim()) i++;
  const h1 = lines[i]?.match(/^#\s+(.*)$/);
  if (h1) { title = h1[1].trim(); i++; }

  const sections: BriefSection[] = [];
  let heading = '';
  let buf: string[] = [];

  const push = () => {
    const body = buf.join('\n').trim();
    if (heading || body) {
      // Video and angle sections split per unit, so the editor gets one card
      // per video / per angle instead of one long text block.
      const split: SplitKind =
        /\breference|\bvideo/i.test(heading) ? 'videos' :
        /\bangle/i.test(heading) ? 'angles' : 'none';
      sections.push({ id: uid('s'), heading, blocks: blocksFromMarkdown(body, split) });
    }
    buf = [];
  };

  for (; i < lines.length; i++) {
    const h = lines[i].match(/^##\s+(.*)$/);
    if (h) { push(); heading = h[1].trim(); continue; }
    buf.push(lines[i]);
  }
  push();

  if (!sections.length) sections.push({ id: uid('s'), heading: '', blocks: [newTextBlock('')] });
  return { title, sections };
}

export function serializeBriefDoc(doc: BriefDoc): string {
  const parts: string[] = [];
  if (doc.title.trim()) parts.push(`# ${doc.title.trim()}`);
  for (const s of doc.sections) {
    if (s.heading.trim()) parts.push(`## ${s.heading.trim()}`);
    for (const b of s.blocks) {
      const t = b.md.trim();
      if (t) parts.push(t);
    }
  }
  return parts.join('\n\n') + '\n';
}

/* ── tables ────────────────────────────────────────────────── */

export interface TableData { head: string[]; rows: string[][] }

const splitRow = (line: string) =>
  line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());

export function parseTable(md: string): TableData {
  const lines = md.split('\n').filter(l => l.trim());
  const head = lines.length ? splitRow(lines[0]) : ['Column 1'];
  const rows = lines.slice(2).map(l => {
    const cells = splitRow(l);
    // Ragged rows happen in generated Markdown; pad so the grid stays square.
    while (cells.length < head.length) cells.push('');
    return cells.slice(0, head.length);
  });
  return { head, rows: rows.length ? rows : [head.map(() => '')] };
}

export function tableToMarkdown(t: TableData): string {
  const cell = (c: string) => c.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
  const out = [
    `| ${t.head.map(cell).join(' | ')} |`,
    `| ${t.head.map(() => '---').join(' | ')} |`,
    ...t.rows.map(r => `| ${r.map(cell).join(' | ')} |`),
  ];
  return out.join('\n');
}

/* ── HTML → Markdown ───────────────────────────────────────── */

/**
 * Turns the rich editor's HTML back into the Markdown we store.
 *
 * `refFor` maps an <img> src back to the stable reference kept in the text —
 * brief images render from short-lived signed Drive URLs, so writing the src
 * straight back would bake in a link that dies within hours.
 */
export function htmlToMarkdown(
  html: string,
  refFor?: (src: string) => string,
  /**
   * Shallowest heading level allowed. Editing a block defaults to 3, because
   * "#"/"##" belong to the document title and section cards — a heading typed
   * inside a block must not silently become a new section. Importing a
   * document passes 1 so its own structure survives.
   */
  minHeading = 3,
): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) return '';

  const esc = (s: string) => s.replace(/\s+/g, ' ');

  /**
   * Wraps inline content in its Markdown markers, keeping any surrounding
   * space OUTSIDE them. Word ends bold runs with the trailing space included
   * ("<strong>Format Example: </strong>"), and `**Format Example: **` is not
   * valid emphasis — the space would be eaten and the words would collide with
   * whatever follows.
   */
  const wrap = (raw: string, mark: string) => {
    const t = raw.trim();
    if (!t) return raw.trim() === raw ? '' : ' ';
    const lead = raw.slice(0, raw.length - raw.trimStart().length);
    const trail = raw.slice(raw.trimEnd().length);
    return `${lead}${mark}${t}${mark}${trail}`;
  };

  const inline = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return esc(node.textContent || '');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as HTMLElement;
    const kids = () => Array.from(el.childNodes).map(inline).join('');
    switch (el.tagName) {
      case 'BR': return '\n';
      case 'IMG': {
        const src = el.getAttribute('src') || '';
        const ref = refFor?.(src) || src;
        return ref ? `![${el.getAttribute('alt') || ''}](${ref})` : '';
      }
      case 'A': {
        const href = el.getAttribute('href') || '';
        const label = kids().trim();
        return href ? `[${label || href}](${href})` : label;
      }
      // The brief renderer has no underline; bold is the closest surviving weight.
      case 'STRONG': case 'B': case 'U': return wrap(kids(), '**');
      case 'EM': case 'I': return wrap(kids(), '*');
      case 'CODE': return wrap(kids(), '`');
      default: return kids();
    }
  };

  const indentOf = (el: HTMLElement) => {
    const m = el.className.match(/ql-indent-(\d+)/);
    return m ? Number(m[1]) : 0;
  };

  const out: string[] = [];
  const walk = (el: HTMLElement) => {
    for (const child of Array.from(el.children) as HTMLElement[]) {
      const tag = child.tagName;

      const h = tag.match(/^H([1-6])$/);
      if (h) {
        // Word headings are usually bold as well as styled; "## **Hooks**"
        // would render the markers as literal text on the shared page.
        const t = inline(child).trim().replace(/^\*\*([^*]+)\*\*$/, '$1');
        if (t) out.push(`${'#'.repeat(Math.max(minHeading, Number(h[1])))} ${t}`);
        continue;
      }

      if (tag === 'UL' || tag === 'OL') {
        let n = 1;
        for (const li of Array.from(child.children) as HTMLElement[]) {
          if (li.tagName !== 'LI') continue;
          // Quill 2 renders every list as <ol> and marks the kind per item.
          const kind = li.getAttribute('data-list')
            ?? (tag === 'OL' ? 'ordered' : 'bullet');
          const pad = '  '.repeat(indentOf(li));
          const text = inline(li).replace(/\n/g, ' ').trim();
          out.push(kind === 'ordered' ? `${pad}${n++}. ${text}` : `${pad}- ${text}`);
        }
        out.push('');
        continue;
      }

      if (tag === 'BLOCKQUOTE') {
        const t = inline(child).trim();
        if (t) out.push(t.split('\n').map(l => `> ${l}`).join('\n'), '');
        continue;
      }

      if (tag === 'HR') { out.push('---', ''); continue; }

      // Tables never come from Quill (it has no table format) — they arrive
      // from an imported .docx or pasted HTML.
      if (tag === 'TABLE') {
        const rows = Array.from(child.querySelectorAll('tr'));
        if (!rows.length) continue;
        const cells = (tr: Element) =>
          Array.from(tr.children).map(td => inline(td).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim());
        const head = cells(rows[0]);
        out.push(`| ${head.join(' | ')} |`);
        out.push(`| ${head.map(() => '---').join(' | ')} |`);
        for (const tr of rows.slice(1)) {
          const r = cells(tr);
          while (r.length < head.length) r.push('');
          out.push(`| ${r.slice(0, head.length).join(' | ')} |`);
        }
        out.push('');
        continue;
      }

      if (tag === 'PRE') {
        const t = (child.textContent || '').trim();
        if (t) out.push(t.split('\n').map(l => `    ${l}`).join('\n'), '');
        continue;
      }

      if (tag === 'DIV' && child.children.length && !inline(child).trim()) {
        walk(child);                          // wrapper with no text of its own
        continue;
      }

      // P and anything else: one paragraph, blank-line separated.
      const t = inline(child).trim();
      if (t) out.push(t.split('\n').filter(Boolean).join('\n'), '');
      else if (tag === 'P') out.push('');
    }
  };
  walk(root);

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
