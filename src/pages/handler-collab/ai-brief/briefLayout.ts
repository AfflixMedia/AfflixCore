import {
  parseBriefDoc, bodyHasVideoMarkers, bodyHasDoDont, bodyHasAngles, type BriefSection,
} from './briefDoc';

/* ════════════════════════════════════════════════════════════
   Brief → structured layout.

   The brief is stored as one Markdown document, but the reading page renders
   it as typed sections — brand intro, product, reference-video cards, hooks,
   text overlays, content-angle cards, do / don't. This module turns the raw
   Markdown into that structure so the view (BriefDocView) is pure rendering.

   Everything is INFERRED from the Markdown (headings + shape), so a generated,
   hand-written or imported brief all resolve to the same layout without anyone
   tagging sections by hand. Anything unrecognised falls back to prose, so
   content is never dropped.
════════════════════════════════════════════════════════════ */

/** Sections whose bullets are lines a creator says or types, not prose. */
const COPYABLE = /\b(hook|overlay|caption|script line|one-liner|cta|call to action)/i;
const OVERLAY = /\b(overlay|caption)/i;
const VIDEO = /\breference|\bvideo/i;
const ANGLE = /\bangle/i;
const DO = /^do(?:'?s)?\b/i;
const DONT = /^(don'?ts?|dont)\b/i;

export const stripNumber = (s: string) => s.replace(/^\s*\d+[.)]\s*/, '').trim();

export const slugify = (s: string, i: number) =>
  `s${i + 1}-${s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 22)}`;

export const plainText = (s: string) =>
  s.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|\*|`/g, '').replace(/\s+/g, ' ').trim();

export const tiktokHandle = (url: string) => url.match(/@([\w.-]+)/)?.[1] ?? '';
export const shortUrl = (url: string) =>
  tiktokHandle(url) ? `@${tiktokHandle(url)}` : url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '');

const IMG_LINE = /^!\[[^\]]*\]\(([^)\s]+)\)$/;
const urlIn = (line: string) =>
  line.match(/\((https?:[^)\s]+)\)/)?.[1] ?? line.match(/https?:\/\/\S+/)?.[0] ?? '';

/* ── types ─────────────────────────────────────────────────── */

export interface RefCard { imgRef: string; tag: string; title: string; bullets: string[]; link: string }
export interface AngleLine { label: string; text: string }
export interface AngleCard { label: string; focus: string; lines: AngleLine[] }
export interface RuleColumn { label: string; negative: boolean; items: string[] }
export interface AlsoLink { label: string; url: string }

export type SectionView =
  | { id: string; num: number; heading: string; kind: 'prose'; md: string }
  | { id: string; num: number; heading: string; kind: 'videos'; intro: string; cards: RefCard[]; also: AlsoLink[] }
  | { id: string; num: number; heading: string; kind: 'lines'; intro: string; items: string[]; compact: boolean }
  | { id: string; num: number; heading: string; kind: 'angles'; intro: string; angles: AngleCard[] }
  | { id: string; num: number; heading: string; kind: 'rules'; columns: RuleColumn[] };

export interface BriefView {
  title: string;
  heroLedeMd: string;
  heroImageRef: string | null;
  sections: SectionView[];
}

/* ── reference videos ──────────────────────────────────────── */

/** Headline + trimmed bullets, inferred from the first bullet of a card. */
function cardTitle(bullets: string[], n: number): { title: string; bullets: string[] } {
  const rest = bullets.slice();
  const first = rest[0] ? plainText(rest[0]) : '';

  const quote = first.match(/["“]([^"”]{4,90})["”]/);
  if (quote) {
    const tail = plainText(first.replace(quote[0], '')).replace(/^\s*[:,;]\s*|\s*[:,;]\s*$/g, '');
    if (tail.length >= 12) rest[0] = tail; else rest.shift();
    return { title: `“${quote[1]}”`, bullets: rest };
  }
  const pref = first.match(/^([^:]{2,40}):\s+(.{4,})$/);
  if (pref) { rest.shift(); const t = pref[2].trim(); return { title: t.charAt(0).toUpperCase() + t.slice(1), bullets: rest }; }
  if (first) { rest.shift(); return { title: first, bullets: rest }; }
  return { title: `Video ${n}`, bullets: rest };
}

/**
 * Recognises the repeating `[screenshot] → **Video #N** → bullets → link`
 * shape and lifts it into cards. The screenshot may sit above the marker (the
 * .docx shape) or after it. Returns null on < 2 cards → caller renders prose.
 */
function videoLayout(section: BriefSection): { intro: string; cards: RefCard[]; also: AlsoLink[] } | null {
  const lines = section.blocks.map(b => b.md).join('\n\n').split('\n');
  const cards: { imgRef: string; bullets: string[]; link: string }[] = [];
  const also: AlsoLink[] = [];
  const introLines: string[] = [];
  let cur: { imgRef: string; bullets: string[]; link: string } | null = null;
  let pendingImg = '';
  let inAlso = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const img = line.match(IMG_LINE);
    if (img) {
      if (cur && !cur.imgRef && !inAlso) cur.imgRef = img[1]; else pendingImg = img[1];
      continue;
    }
    if (/^\*\*\s*video\b[^*]*\*\*:?$/i.test(line)) {
      cur = { imgRef: pendingImg, bullets: [], link: '' };
      cards.push(cur); pendingImg = '';
      continue;
    }
    if (cards.length && /^[*_][^*_].*[*_]:?$/.test(line)) { inAlso = true; continue; }

    const bullet = line.match(/^[-*+]\s+(.*)$/);
    const url = urlIn(line);
    if (inAlso) {
      const u = url || (bullet && urlIn(bullet[1]));
      if (u) {
        const label = plainText((bullet ? bullet[1] : line).split(/\[|\(?https?:/)[0]).replace(/:$/, '');
        also.push({ label: label || shortUrl(u), url: u });
      }
      continue;
    }
    if (bullet) { if (cur) cur.bullets.push(bullet[1].trim()); else introLines.push(line); continue; }
    if (cur && url) { if (!cur.link) cur.link = url; continue; }
    if (!cur) introLines.push(line); else cur.bullets.push(line.replace(/^\*\*|\*\*$/g, '').trim());
  }
  if (pendingImg) { const bare = cards.find(c => !c.imgRef); if (bare) bare.imgRef = pendingImg; }

  const usable = cards.filter(c => c.imgRef || c.link || c.bullets.length);
  if (usable.length < 2) return null;

  return {
    intro: introLines.join('\n'),
    also,
    cards: usable.map((c, i) => {
      const { title, bullets } = cardTitle(c.bullets, i + 1);
      const handle = tiktokHandle(c.link);
      return { imgRef: c.imgRef, link: c.link, bullets, title, tag: `Video ${String(i + 1).padStart(2, '0')}${handle ? ` · @${handle}` : ''}` };
    }),
  };
}

/* ── content angles ────────────────────────────────────────── */

function angleLayout(section: BriefSection): { intro: string; angles: AngleCard[] } | null {
  const md = section.blocks.map(b => b.md).join('\n\n');
  const parts = md.split(/^###\s+/m);
  const intro = parts[0].trim();
  const angles: AngleCard[] = [];

  for (const part of parts.slice(1)) {
    const nl = part.indexOf('\n');
    const label = plainText(nl === -1 ? part : part.slice(0, nl)).replace(/^angle\s*\d+\s*[:.\-]?\s*/i, '');
    const body = nl === -1 ? '' : part.slice(nl + 1);
    let focus = '';
    const lines: AngleLine[] = [];
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const f = line.match(/^\*?\*?focus:?\*?\*?\s*(.*)$/i);
      if (f && !focus && !/^[-*+]\s/.test(line)) { focus = plainText(f[1]); continue; }
      const bullet = line.match(/^[-*+]\s+(.*)$/);
      const txt = bullet ? bullet[1].trim() : line;
      const lab = txt.match(/^\*\*([^*]{2,44}):?\*\*:?\s*(.*)$/);
      if (lab) lines.push({ label: plainText(lab[1]), text: lab[2].trim() });
      else lines.push({ label: '', text: txt });
    }
    if (label || focus || lines.length) angles.push({ label: label || `Angle ${angles.length + 1}`, focus, lines });
  }
  if (angles.length < 2) return null;
  return { intro, angles };
}

/* ── do / don't ────────────────────────────────────────────── */

function rulesLayout(section: BriefSection): RuleColumn[] | null {
  const md = section.blocks.map(b => b.md).join('\n\n');
  const cols = md.split(/^###\s+/m).slice(1).map(p => {
    const nl = p.indexOf('\n');
    const label = plainText(nl === -1 ? p : p.slice(0, nl));
    const items = (nl === -1 ? '' : p.slice(nl + 1)).split('\n')
      .map(l => l.match(/^[-*+]\s+(.*)$/)?.[1]?.trim()).filter((x): x is string => !!x);
    return { label, items };
  });
  // Find one Do column and one Don't column among the subheads (order-agnostic;
  // tolerates a stray heading, since the AI/import may vary).
  const doCol = cols.find(c => DONT.test(c.label) ? false : DO.test(c.label));
  const dontCol = cols.find(c => DONT.test(c.label));
  if (!doCol || !dontCol) return null;
  return [{ ...doCol, negative: false }, { ...dontCol, negative: true }];
}

/* ── copy lines (hooks / overlays) ─────────────────────────── */

function lineLayout(section: BriefSection): { intro: string; items: string[] } {
  const md = section.blocks.map(b => b.md).join('\n');
  const intro: string[] = [];
  const items: string[] = [];
  for (const raw of md.split('\n')) {
    const bullet = raw.match(/^[-*+]\s+(.*)$/);
    if (bullet) items.push(bullet[1].trim());
    else if (raw.trim() && !/^#{1,6}\s/.test(raw)) intro.push(raw);
  }
  return { intro: intro.join('\n'), items };
}

function analyzeSection(section: BriefSection, i: number, heading: string): SectionView {
  const base = { id: slugify(heading, i), num: i + 1, heading };
  // Type comes from the markers inside the section OR its heading keyword — so a
  // differently-named doc still maps to the right layout (bodyHas* live in
  // briefDoc, shared with the editor).
  const md = section.blocks.map(b => b.md).join('\n\n');

  const headRules = DO.test(heading) || DONT.test(heading) || /do.?s?\s*(&|and|\/)\s*don/i.test(heading);
  if (headRules || bodyHasDoDont(md)) {
    const cols = rulesLayout(section);
    if (cols) return { ...base, kind: 'rules', columns: cols };
  }
  if (VIDEO.test(heading) || bodyHasVideoMarkers(md)) {
    const v = videoLayout(section);
    if (v) return { ...base, kind: 'videos', ...v };
  }
  if (ANGLE.test(heading) || bodyHasAngles(md)) {
    const a = angleLayout(section);
    if (a) return { ...base, kind: 'angles', ...a };
  }
  if (COPYABLE.test(heading)) {
    const { intro, items } = lineLayout(section);
    if (items.length) return { ...base, kind: 'lines', intro, items, compact: OVERLAY.test(heading) };
  }
  return { ...base, kind: 'prose', md };
}

/** How many sections resolved to a structured kind (cards/lines/rules). Used
    to VERIFY an AI-normalised import: if it parses worse than the raw import,
    the raw version wins. */
export function structuredSectionCount(markdown: string): number {
  return analyzeBrief(markdown, '').sections.filter(s => s.kind !== 'prose').length;
}

/** True when a section has no real content — only scaffolding. The reading
    page (share + preview) hides these; the editor still shows them to fill. */
export function isEmptySection(s: SectionView): boolean {
  switch (s.kind) {
    case 'prose': return !s.md.trim();
    case 'videos': return !s.cards.length && !s.intro.trim() && !s.also.length;
    case 'lines': return !s.items.length && !s.intro.trim();
    case 'angles': return !s.angles.length && !s.intro.trim();
    case 'rules': return s.columns.every(c => !c.items.length);
  }
}

/**
 * Appends EMPTY scaffolds for any canonical brief section the document lacks
 * (brand intro, product intro, reference videos, hooks, text overlays, content
 * angles, do/don't) so the editor always offers the full spine to fill in.
 *
 * Deliberately deterministic — no AI adds these, so nothing can be invented:
 * the scaffolds carry a heading (and the Do/Don't markers) and zero content,
 * and the reading page hides them until they hold something.
 */
export function ensureCanonicalSections(markdown: string): string {
  const v = analyzeBrief(markdown, '');
  const kinds = new Set(v.sections.map(s => s.kind));
  const heads = v.sections.map(s => s.heading.toLowerCase());
  const hasHead = (re: RegExp) => heads.some(h => re.test(h));

  const add: string[] = [];
  if (!hasHead(/brand|about|philosoph|essential|intro|snapshot|company/)) add.push('## Brand Intro\n');
  if (!hasHead(/product/)) add.push('## Product Intro\n');
  if (!kinds.has('videos')) add.push('## Reference Videos\n');
  if (!hasHead(/hook/) && !v.sections.some(s => s.kind === 'lines' && !s.compact)) add.push('## Hooks\n');
  if (!hasHead(/overlay|caption/)) add.push('## Text Overlays\n');
  if (!kinds.has('angles') && !hasHead(/angle/)) add.push('## Content Angles\n');
  if (!kinds.has('rules')) add.push("## Do's and Don'ts\n\n### Do\n\n### Don't\n");

  if (!add.length) return markdown;
  return markdown.trimEnd() + '\n\n' + add.join('\n');
}

export function analyzeBrief(markdown: string, fallbackTitle: string): BriefView {
  const doc = parseBriefDoc(markdown);
  const preamble = doc.sections.find(s => !s.heading.trim());
  const named = doc.sections.filter(s => s.heading.trim());

  // Lift a leading cover image out of the opening block: it belongs in the
  // hero's image slot, not inline in the lede text.
  let heroLedeMd = preamble ? preamble.blocks.map(b => b.md).join('\n\n') : '';
  let heroImageRef: string | null = null;
  const cover = heroLedeMd.match(/^\s*!\[[^\]]*\]\(([^)\s]+)\)\s*/);
  if (cover) { heroImageRef = cover[1]; heroLedeMd = heroLedeMd.slice(cover[0].length); }

  return {
    title: doc.title || fallbackTitle,
    heroLedeMd,
    heroImageRef,
    sections: named.map((s, i) => analyzeSection(s, i, stripNumber(s.heading))),
  };
}
