import DOMPurify from 'dompurify';
// Just a URL string — importing it does not pull pdf.js into the main bundle.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { htmlToMarkdown, unresolvedSrc, driveRefFromSrc } from './briefDoc';

/* ════════════════════════════════════════════════════════════
   Bring an existing brief into the editor.

   Not every brief starts with the generator — most agencies already have one
   in a Google Doc, a Word file, or a PDF. This turns those into the same
   Markdown the generator produces, so an imported brief is editable, saveable
   and shareable exactly like a generated one.

   Heavy parsers (mammoth for .docx, pdf.js for .pdf) are imported lazily so
   they only ship to browsers that actually import a file.
════════════════════════════════════════════════════════════ */

export const IMPORT_ACCEPT = '.docx,.md,.markdown,.txt,.html,.htm,.pdf';

const extOf = (name: string) => (name.split('.').pop() || '').toLowerCase();

/** Plain text → Markdown: keep the text, promote obvious headings. */
function textToMarkdown(raw: string): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const next = lines[i + 1]?.trim() ?? '';
    const isShort = line.trim().length > 0 && line.trim().length <= 70;
    const alreadyMd = /^(#{1,6}\s|[-*+]\s|\d+[.)]\s|\||>)/.test(line.trim());

    // A short line followed by a blank one, in Title Case or ALL CAPS, is how
    // pasted docs mark their sections once the formatting is gone.
    if (!alreadyMd && isShort && !next && /^[A-Z0-9]/.test(line.trim())
        && !/[.!?]$/.test(line.trim())) {
      out.push(`## ${line.trim()}`);
      continue;
    }
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Uploads one image pulled out of a document, returning its `drive:<id>`
 * marker (or null to drop the image). Supplied by the caller so this module
 * stays free of Supabase/Drive plumbing.
 */
export interface ImportImageUploader {
  (file: File, index: number, total: number): Promise<string | null>;
}

export interface ImportOptions {
  uploadImage?: ImportImageUploader;
  /** Progress line for the UI ("Uploading image 3 of 9"). */
  onProgress?: (message: string) => void;
}

async function docxToMarkdown(file: File, opts: ImportOptions): Promise<string> {
  const mammoth = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();

  // Word's Title/Subtitle styles have no HTML equivalent, so mammoth drops them
  // to plain paragraphs and the brief loses its own title. Mapping them without
  // `:fresh` also merges consecutive title paragraphs into one element, which is
  // how a two-line title is written in Word.
  const styleMap = [
    "p[style-name='Title'] => h1.brief-title",
    "p[style-name='Subtitle'] => p.brief-subtitle",
  ];

  // Pass 1: keep every image inline as a data URI and remember the order. They
  // are uploaded afterwards, because mammoth's image handler cannot report
  // progress and a 6MB doc can hold a dozen of them.
  const pending: { dataUrl: string; contentType: string }[] = [];
  const { value } = await mammoth.convertToHtml({ arrayBuffer }, {
    styleMap,
    convertImage: mammoth.images.imgElement(async image => {
      const base64 = await image.read('base64');
      const contentType = image.contentType || 'image/png';
      const dataUrl = `data:${contentType};base64,${base64}`;
      pending.push({ dataUrl, contentType });
      return { src: dataUrl };
    }),
  });

  const html = await uploadEmbeddedImages(value, pending, file.name, opts);
  return htmlFragmentToMarkdown(html);
}

/**
 * Replaces the data-URI images in a converted document with Drive markers.
 *
 * Keeping megabytes of base64 in the brief body is not an option — the text
 * lives in Postgres and is re-fetched on every render — so each image is
 * uploaded and reduced to a `drive:<id>` reference, exactly like an image
 * added inside the editor. Without an uploader the images are dropped rather
 * than inlined, and the caller says so.
 */
async function uploadEmbeddedImages(
  html: string,
  pending: { dataUrl: string; contentType: string }[],
  docName: string,
  opts: ImportOptions,
): Promise<string> {
  if (!pending.length) return html;
  if (!opts.uploadImage) {
    return html.replace(/<img\b[^>]*src="data:[^"]*"[^>]*>/g, '');
  }

  const base = docName.replace(/\.[^.]+$/, '').slice(0, 40) || 'brief';
  const seen = new Map<string, string>();          // data URI → src, dedupes repeats
  let out = html;
  let done = 0;

  for (const img of pending) {
    done++;
    if (seen.has(img.dataUrl)) continue;
    opts.onProgress?.(`Uploading image ${done} of ${pending.length}`);
    let replacement = '';
    try {
      const ext = (img.contentType.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
      // fetch() decodes a data: URI for us — no manual base64 handling.
      const blob = await (await fetch(img.dataUrl)).blob();
      const file = new File([blob], `${base}-${done}.${ext}`, { type: img.contentType });
      const ref = await opts.uploadImage(file, done, pending.length);
      if (ref) replacement = unresolvedSrc(ref.replace(/^drive:/, ''));
    } catch { /* one bad image must not fail the whole import */ }
    seen.set(img.dataUrl, replacement);
    // Split/join rather than a regex: a base64 URI is full of regex metacharacters.
    out = out.split(img.dataUrl).join(replacement);
  }

  // Anything that failed to upload leaves an empty src — drop those <img> tags.
  return out.replace(/<img\b[^>]*src=""[^>]*>/g, '');
}

/**
 * Pulls the document's own title out of the body, if it has one.
 *
 * Any image sitting in the title block (a cover logo, usually) is lifted out
 * first — the title becomes plain text, so an image left inside it would be
 * deleted along with the element.
 */
function extractTitle(root: HTMLElement): string {
  const keepImages = (node: Element) => {
    for (const img of Array.from(node.querySelectorAll('img'))) {
      const p = node.ownerDocument.createElement('p');
      p.appendChild(img);
      node.parentNode?.insertBefore(p, node);
    }
  };

  const styled = root.querySelector('h1.brief-title');
  if (styled) {
    const t = (styled.textContent || '').replace(/\s+/g, ' ').trim();
    keepImages(styled);
    styled.remove();
    return t;
  }
  // No Title style: a lone heading before any other text is still the title.
  const first = Array.from(root.children).find(el => (el.textContent || '').trim() || el.querySelector('img'));
  if (first && /^H[12]$/.test(first.tagName) && root.querySelectorAll('h1,h2,h3').length > 1) {
    const t = (first.textContent || '').replace(/\s+/g, ' ').trim();
    keepImages(first);
    first.remove();
    return t;
  }
  return '';
}

/**
 * Word documents use tables for layout as often as for data — the reference-video
 * strip in a typical brief is a two-column table holding a screenshot and a
 * bullet list. Markdown tables can only hold inline text, so a table with block
 * content is unpacked into the flow instead of being crushed into one row.
 */
function flattenLayoutTables(root: HTMLElement) {
  for (const table of Array.from(root.querySelectorAll('table'))) {
    const cells = Array.from(table.querySelectorAll('td,th'));
    const isLayout = cells.some(c =>
      c.querySelector('img,ul,ol,h1,h2,h3,h4,h5,h6') || c.querySelectorAll('p').length > 1);
    if (!isLayout) continue;

    const frag = table.ownerDocument.createDocumentFragment();
    for (const row of Array.from(table.querySelectorAll('tr'))) {
      for (const cell of Array.from(row.children)) {
        while (cell.firstChild) frag.appendChild(cell.firstChild);
      }
    }
    table.replaceWith(frag);
  }
}

/**
 * Re-levels headings so the document's top level becomes "##".
 *
 * Sections in a brief are "##" headings — that is what the editor turns into
 * cards and what the shared page turns into numbered sections. Word documents
 * usually start at Heading 1, so without this every section would arrive as a
 * document title and the whole brief would land in one block.
 */
function normalizeHeadings(root: HTMLElement) {
  const headings = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6'));
  if (!headings.length) return;
  const levels = headings.map(h => Number(h.tagName[1]));
  const shift = 2 - Math.min(...levels);
  if (!shift) return;

  for (const h of headings) {
    const level = Math.min(6, Math.max(2, Number(h.tagName[1]) + shift));
    const next = h.ownerDocument.createElement(`h${level}`);
    next.innerHTML = h.innerHTML;
    h.replaceWith(next);
  }
}

function htmlFragmentToMarkdown(html: string): string {
  // Same sanitize rule as everywhere else: nothing unsanitized is ever parsed
  // out of a file the user supplied.
  const clean = DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] });
  const doc = new DOMParser().parseFromString(`<div>${clean}</div>`, 'text/html');
  const root = doc.body.firstElementChild as HTMLElement;
  const title = extractTitle(root);
  flattenLayoutTables(root);
  normalizeHeadings(root);
  // driveRefFromSrc turns the parked upload URLs back into `drive:<id>`
  // markers — the ONLY image form the renderer and the share endpoint sign.
  const md = htmlToMarkdown(root.innerHTML, driveRefFromSrc, 1);
  return title ? `# ${title}\n\n${md}` : md;
}

async function pdfToMarkdown(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

  const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Group items into visual lines by their y position — a PDF has no line
    // breaks of its own, only positioned runs of text.
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const it of content.items as any[]) {
      if (typeof it.str !== 'string' || !it.str.trim()) continue;
      const key = Math.round(it.transform[5] / 3) * 3;   // tolerate sub-pixel drift
      let row = rows.get(key);
      if (!row) { row = []; rows.set(key, row); }
      row.push({ x: it.transform[4], s: it.str });
    }
    const lines = Array.from(rows.entries())
      .sort((a, b) => b[0] - a[0])                    // PDF y grows upward
      .map(([, items]) => items.sort((a, b) => a.x - b.x).map(i => i.s).join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    pages.push(lines.join('\n'));
  }
  return textToMarkdown(pages.join('\n\n'));
}

/**
 * Reads a document and returns Markdown ready for the editor.
 * Throws a message worth showing the user on an unsupported format.
 */
export async function importDocument(file: File, opts: ImportOptions = {}): Promise<string> {
  const ext = extOf(file.name);
  switch (ext) {
    case 'docx': return docxToMarkdown(file, opts);
    case 'md': case 'markdown': return (await file.text()).trim();
    case 'txt': return textToMarkdown(await file.text());
    case 'html': case 'htm': return htmlFragmentToMarkdown(await file.text());
    case 'pdf': return pdfToMarkdown(file);
    case 'doc':
      throw new Error('Old .doc files are not supported — open it and save as .docx, then import that.');
    case 'gdoc':
      throw new Error('Google Docs: use File → Download → Microsoft Word (.docx) and import that file.');
    default:
      throw new Error(`Cannot read a .${ext || '?'} file. Use .docx, .pdf, .md, .txt or .html.`);
  }
}

/** Pasted content: HTML from the clipboard when present, otherwise plain text. */
export function pastedToMarkdown(text: string, html?: string): string {
  if (html && /<\/?(p|div|h[1-6]|ul|ol|li|table)\b/i.test(html)) return htmlFragmentToMarkdown(html);
  return textToMarkdown(text);
}

/** The scaffold behind "Start blank" — the section spine of an Afflix brief. */
export function blankBriefMarkdown(brandName: string): string {
  const brand = brandName.trim() || 'Brand';
  return [
    `# ${brand} TikTok Shop UGC Content Brief`,
    '',
    '## Brand snapshot',
    'What the brand is, who it is for, and the tone creators should match.',
    '',
    '## Products & offers',
    '- Hero product and why it sells',
    '- Price, bundles or promos to mention',
    '',
    '## Audience',
    'Who is buying, and what they care about.',
    '',
    '## Hooks & angles',
    '| Hook | Angle | Why it works |',
    '| --- | --- | --- |',
    '|  |  |  |',
    '',
    '## Video structure',
    '1. Hook (0–3s)',
    '2. Problem',
    '3. Product in use',
    '4. Proof',
    '5. Call to action',
    '',
    '## Do & don\'t',
    '- Do:',
    '- Don\'t:',
    '',
    '## Deliverables',
    'Number of videos, formats, deadline and where to send them.',
    '',
  ].join('\n');
}
