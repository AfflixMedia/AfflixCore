import React from 'react';
import type { ImageResolver } from './markdown';
import { driveIdOf } from './markdown';

/* ════════════════════════════════════════════════════════════
   Structured editors for the brief's special section types.

   Some sections are not free prose — they have a fixed shape the reading page
   renders as cards. Editing them as raw Markdown blocks is error-prone, so each
   gets a purpose-built form:

     · Reference videos → up to 3 video cards, each with Image / Description /
       Link fields.
     · Content angles   → up to 3 angle cards (title, focus, labelled lines).
     · Do / Don't       → two separate list panels.

   Each editor parses the section's Markdown in, and serializes Markdown out in
   exactly the shape briefLayout re-parses for the share page — so storage and
   the reading layout are unchanged. If a section's content doesn't fit the
   shape, `structuredKind` returns null and BriefEditor falls back to the
   generic block editor, so nothing is ever lost.
════════════════════════════════════════════════════════════ */

const MAX_VIDEOS = 3;
const MAX_ANGLES = 3;

const IMG_LINE = /^!\[[^\]]*\]\(([^)\s]+)\)$/;
const urlIn = (line: string) =>
  line.match(/\((https?:[^)\s]+)\)/)?.[1] ?? line.match(/https?:\/\/\S+/)?.[0] ?? '';

interface SharedProps {
  resolveImg: ImageResolver;
  /** src (signed URL) → stored ref (`drive:<id>`), for images just uploaded. */
  refFor: (src: string) => string;
  /** Opens the picker, uploads, returns a displayable src (signed URL). */
  uploadImage?: () => Promise<string | null>;
}

/** Which structured editor a section wants, or null for generic blocks. */
export function structuredKind(heading: string, md: string): 'videos' | 'angles' | 'rules' | null {
  const h = heading.toLowerCase();
  if (/\breference|\bvideo/.test(h)) return parseVideos(md).videos.length || !md.trim() ? 'videos' : null;
  if (/\bangle/.test(h)) return parseAngles(md).angles.length || !md.trim() ? 'angles' : null;
  if (/do.?s?\s*(&|and|\/)\s*don|^do\b|^don'?t\b/.test(h)) {
    const r = parseRules(md);
    return r ? 'rules' : null;
  }
  return null;
}

/* ── image control shared by video cards ─────────────────────── */

function ImageField({ imgRef, onChange, resolveImg, refFor, uploadImage }:
  { imgRef: string; onChange: (ref: string) => void } & SharedProps) {
  const [busy, setBusy] = React.useState(false);
  const src = React.useMemo(() => {
    if (!imgRef) return '';
    const id = driveIdOf(imgRef);
    return id ? (resolveImg(id) ?? '') : imgRef;
  }, [imgRef, resolveImg]);

  const upload = async () => {
    if (!uploadImage) return;
    setBusy(true);
    try { const s = await uploadImage(); if (s) onChange(refFor(s)); }
    finally { setBusy(false); }
  };

  return (
    <div className="pc-aib-vimg">
      {src ? (
        <div className="pc-aib-vimg-has">
          <img src={src} alt="" onError={e => { (e.target as HTMLImageElement).style.opacity = '.3'; }} />
          <div className="pc-aib-vimg-acts">
            <button type="button" onClick={upload} disabled={busy}>
              <i className={`bi bi-${busy ? 'hourglass-split' : 'arrow-repeat'}`} /> Replace
            </button>
            <button type="button" className="danger" onClick={() => onChange('')}>
              <i className="bi bi-trash3" /> Remove
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="pc-aib-vimg-drop" onClick={upload} disabled={busy || !uploadImage}>
          <i className={`bi bi-${busy ? 'hourglass-split' : 'image'}`} />
          <span>{busy ? 'Uploading…' : 'Upload screenshot'}</span>
        </button>
      )}
    </div>
  );
}

/* ── reference videos ────────────────────────────────────────── */

interface VideoItem { imgRef: string; desc: string; link: string }
interface VideosData { intro: string; videos: VideoItem[]; also: { label: string; url: string }[] }

export function parseVideos(md: string): VideosData {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const videos: VideoItem[] = [];
  const also: { label: string; url: string }[] = [];
  const introLines: string[] = [];
  let cur: VideoItem | null = null;
  let pendingImg = '';
  let inAlso = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const img = line.match(IMG_LINE);
    if (img) { if (cur && !cur.imgRef && !inAlso) cur.imgRef = img[1]; else pendingImg = img[1]; continue; }
    if (/^\*\*\s*video\b[^*]*\*\*:?$/i.test(line)) { cur = { imgRef: pendingImg, desc: '', link: '' }; videos.push(cur); pendingImg = ''; continue; }
    if (videos.length && /^[*_][^*_].*[*_]:?$/.test(line)) { inAlso = true; continue; }

    const bullet = line.match(/^[-*+]\s+(.*)$/);
    const url = urlIn(line);
    if (inAlso) {
      const u = url || (bullet && urlIn(bullet[1]));
      if (u) { const label = (bullet ? bullet[1] : line).split(/\[|\(?https?:/)[0].replace(/\*\*/g, '').replace(/[:*]\s*$/, '').trim(); also.push({ label, url: u }); }
      continue;
    }
    if (bullet) { if (cur) cur.desc += (cur.desc ? '\n' : '') + bullet[1].trim(); else introLines.push(line); continue; }
    if (cur && url && !cur.link) { cur.link = url; continue; }
    if (!cur) introLines.push(line);
    else cur.desc += (cur.desc ? '\n' : '') + line.replace(/^\*\*|\*\*$/g, '').trim();
  }
  if (pendingImg) { const bare = videos.find(v => !v.imgRef); if (bare) bare.imgRef = pendingImg; }
  return { intro: introLines.join('\n'), videos, also };
}

export function serializeVideos(d: VideosData): string {
  const out: string[] = [];
  if (d.intro.trim()) out.push(d.intro.trim());
  d.videos.forEach((v, i) => {
    if (v.imgRef) out.push(`![](${v.imgRef})`);
    out.push(`**Video #${i + 1}**`);
    const desc = v.desc.split('\n').map(l => l.trim()).filter(Boolean);
    if (desc.length) out.push(desc.map(l => `- ${l}`).join('\n'));
    if (v.link.trim()) out.push(`**Format Example:** ${v.link.trim()}`);
  });
  if (d.also.some(a => a.url.trim())) {
    out.push('*Also study:*');
    out.push(d.also.filter(a => a.url.trim()).map(a => a.label.trim() ? `- **${a.label.trim()}:** ${a.url.trim()}` : `- ${a.url.trim()}`).join('\n'));
  }
  return out.join('\n\n');
}

export function VideosSectionEditor({ md, onChange, ...shared }:
  { md: string; onChange: (md: string) => void } & SharedProps) {
  const data = React.useMemo(() => parseVideos(md), [md]);
  const push = (d: VideosData) => onChange(serializeVideos(d));
  const patchVideo = (i: number, patch: Partial<VideoItem>) =>
    push({ ...data, videos: data.videos.map((v, j) => j === i ? { ...v, ...patch } : v) });

  return (
    <div className="pc-aib-struct">
      <label className="pc-aib-sfield">
        <span>Intro <em>(optional)</em></span>
        <textarea rows={2} value={data.intro} onChange={e => push({ ...data, intro: e.target.value })}
          placeholder="One line above the video cards, e.g. “Steal the structure, not the words.”" />
      </label>

      {data.videos.map((v, i) => (
        <div className="pc-aib-vcard" key={i}>
          <div className="pc-aib-vcard-h">
            <b><i className="bi bi-camera-video" /> Video {i + 1}</b>
            <div className="pc-aib-vcard-acts">
              <button type="button" onClick={() => { if (i > 0) push({ ...data, videos: swap(data.videos, i, i - 1) }); }} disabled={i === 0} title="Move up"><i className="bi bi-arrow-up" /></button>
              <button type="button" onClick={() => { if (i < data.videos.length - 1) push({ ...data, videos: swap(data.videos, i, i + 1) }); }} disabled={i === data.videos.length - 1} title="Move down"><i className="bi bi-arrow-down" /></button>
              <button type="button" className="danger" onClick={() => push({ ...data, videos: data.videos.filter((_, j) => j !== i) })} title="Remove video"><i className="bi bi-trash3" /></button>
            </div>
          </div>
          <div className="pc-aib-vgrid">
            <div className="pc-aib-sfield">
              <span>Screenshot</span>
              <ImageField imgRef={v.imgRef} onChange={ref => patchVideo(i, { imgRef: ref })} {...shared} />
            </div>
            <div className="pc-aib-vgrid-r">
              <label className="pc-aib-sfield">
                <span>Description <em>(one point per line)</em></span>
                <textarea rows={4} value={v.desc} onChange={e => patchVideo(i, { desc: e.target.value })}
                  placeholder={'What to steal from this video —\none point per line'} />
              </label>
              <label className="pc-aib-sfield">
                <span>Video link</span>
                <input value={v.link} onChange={e => patchVideo(i, { link: e.target.value })}
                  placeholder="https://www.tiktok.com/@creator/video/…" />
              </label>
            </div>
          </div>
        </div>
      ))}

      {data.videos.length < MAX_VIDEOS ? (
        <button type="button" className="pc-aib-saddbtn"
          onClick={() => push({ ...data, videos: [...data.videos, { imgRef: '', desc: '', link: '' }] })}>
          <i className="bi bi-plus-lg" /> Add video <em>({data.videos.length}/{MAX_VIDEOS})</em>
        </button>
      ) : (
        <p className="pc-aib-smax"><i className="bi bi-info-circle" /> Maximum {MAX_VIDEOS} reference videos.</p>
      )}

      <AlsoEditor also={data.also} onChange={also => push({ ...data, also })} />
    </div>
  );
}

function AlsoEditor({ also, onChange }: { also: { label: string; url: string }[]; onChange: (a: { label: string; url: string }[]) => void }) {
  return (
    <div className="pc-aib-also">
      <span className="pc-aib-slabel">Also study <em>(optional links)</em></span>
      {also.map((a, i) => (
        <div className="pc-aib-alsorow" key={i}>
          <input value={a.label} placeholder="Label" onChange={e => onChange(also.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
          <input value={a.url} placeholder="https://…" onChange={e => onChange(also.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} />
          <button type="button" className="danger" onClick={() => onChange(also.filter((_, j) => j !== i))} title="Remove"><i className="bi bi-x-lg" /></button>
        </div>
      ))}
      <button type="button" className="pc-aib-saddlink" onClick={() => onChange([...also, { label: '', url: '' }])}>
        <i className="bi bi-plus-lg" /> Add link
      </button>
    </div>
  );
}

/* ── content angles ──────────────────────────────────────────── */

interface AngleLineItem { label: string; text: string }
interface AngleItem { title: string; focus: string; lines: AngleLineItem[] }
interface AnglesData { intro: string; angles: AngleItem[] }

export function parseAngles(md: string): AnglesData {
  const parts = md.replace(/\r\n/g, '\n').split(/^###\s+/m);
  const intro = parts[0].trim();
  const angles: AngleItem[] = [];
  for (const part of parts.slice(1)) {
    const nl = part.indexOf('\n');
    const title = (nl === -1 ? part : part.slice(0, nl)).replace(/\*\*/g, '').trim();
    const body = nl === -1 ? '' : part.slice(nl + 1);
    let focus = '';
    const lines: AngleLineItem[] = [];
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const f = line.match(/^\*?\*?focus:?\*?\*?\s*(.*)$/i);
      if (f && !focus && !/^[-*+]\s/.test(line)) { focus = f[1].replace(/\*\*/g, '').trim(); continue; }
      const bullet = line.match(/^[-*+]\s+(.*)$/);
      const txt = bullet ? bullet[1].trim() : line;
      const lab = txt.match(/^\*\*([^*]{2,44}):?\*\*:?\s*(.*)$/);
      if (lab) lines.push({ label: lab[1].trim(), text: lab[2].trim() });
      else lines.push({ label: '', text: txt.replace(/^\*\*|\*\*$/g, '') });
    }
    angles.push({ title, focus, lines });
  }
  return { intro, angles };
}

export function serializeAngles(d: AnglesData): string {
  const out: string[] = [];
  if (d.intro.trim()) out.push(d.intro.trim());
  d.angles.forEach((a, i) => {
    out.push(`### ${a.title.trim() || `Angle ${i + 1}`}`);
    if (a.focus.trim()) out.push(`**Focus:** ${a.focus.trim()}`);
    const lines = a.lines.filter(l => l.text.trim());
    if (lines.length) out.push(lines.map(l => l.label.trim() ? `- **${l.label.trim()}:** ${l.text.trim()}` : `- ${l.text.trim()}`).join('\n'));
  });
  return out.join('\n\n');
}

export function AnglesSectionEditor({ md, onChange }: { md: string; onChange: (md: string) => void }) {
  const data = React.useMemo(() => parseAngles(md), [md]);
  const push = (d: AnglesData) => onChange(serializeAngles(d));
  const patch = (i: number, p: Partial<AngleItem>) => push({ ...data, angles: data.angles.map((a, j) => j === i ? { ...a, ...p } : a) });

  return (
    <div className="pc-aib-struct">
      <label className="pc-aib-sfield">
        <span>Intro <em>(optional)</em></span>
        <textarea rows={2} value={data.intro} onChange={e => push({ ...data, intro: e.target.value })}
          placeholder="One line above the angle cards (optional)." />
      </label>

      {data.angles.map((a, i) => (
        <div className="pc-aib-acard" key={i}>
          <div className="pc-aib-vcard-h">
            <b><span className="pc-aib-anum">{i + 1}</span> Angle {i + 1}</b>
            <div className="pc-aib-vcard-acts">
              <button type="button" onClick={() => { if (i > 0) push({ ...data, angles: swap(data.angles, i, i - 1) }); }} disabled={i === 0} title="Move up"><i className="bi bi-arrow-up" /></button>
              <button type="button" onClick={() => { if (i < data.angles.length - 1) push({ ...data, angles: swap(data.angles, i, i + 1) }); }} disabled={i === data.angles.length - 1} title="Move down"><i className="bi bi-arrow-down" /></button>
              <button type="button" className="danger" onClick={() => push({ ...data, angles: data.angles.filter((_, j) => j !== i) })} title="Remove angle"><i className="bi bi-trash3" /></button>
            </div>
          </div>
          <label className="pc-aib-sfield">
            <span>Title</span>
            <input value={a.title} onChange={e => patch(i, { title: e.target.value })} placeholder="e.g. First With Magtein (the premium story)" />
          </label>
          <label className="pc-aib-sfield">
            <span>Focus <em>(the through-line)</em></span>
            <textarea rows={2} value={a.focus} onChange={e => patch(i, { focus: e.target.value })} placeholder="What this angle leads with and why." />
          </label>
          <span className="pc-aib-slabel">Lines <em>(each is tap-to-copy on the brief)</em></span>
          {a.lines.map((l, li) => (
            <div className="pc-aib-linerow" key={li}>
              <input className="pc-aib-linelab" value={l.label} placeholder="Label" onChange={e => patch(i, { lines: a.lines.map((x, j) => j === li ? { ...x, label: e.target.value } : x) })} />
              <textarea rows={1} className="pc-aib-linetxt" value={l.text} placeholder="The line the creator says…" onChange={e => patch(i, { lines: a.lines.map((x, j) => j === li ? { ...x, text: e.target.value } : x) })} />
              <button type="button" className="danger" onClick={() => patch(i, { lines: a.lines.filter((_, j) => j !== li) })} title="Remove line"><i className="bi bi-x-lg" /></button>
            </div>
          ))}
          <button type="button" className="pc-aib-saddlink" onClick={() => patch(i, { lines: [...a.lines, { label: '', text: '' }] })}>
            <i className="bi bi-plus-lg" /> Add line
          </button>
        </div>
      ))}

      {data.angles.length < MAX_ANGLES ? (
        <button type="button" className="pc-aib-saddbtn"
          onClick={() => push({ ...data, angles: [...data.angles, { title: '', focus: '', lines: [{ label: '', text: '' }] }] })}>
          <i className="bi bi-plus-lg" /> Add angle <em>({data.angles.length}/{MAX_ANGLES})</em>
        </button>
      ) : (
        <p className="pc-aib-smax"><i className="bi bi-info-circle" /> Maximum {MAX_ANGLES} content angles.</p>
      )}
    </div>
  );
}

/* ── do / don't (two separate panels) ────────────────────────── */

interface RulesData { doItems: string[]; dontItems: string[] }

export function parseRules(md: string): RulesData | null {
  const parts = md.replace(/\r\n/g, '\n').split(/^###\s+/m).slice(1);
  let doItems: string[] | null = null;
  let dontItems: string[] | null = null;
  for (const p of parts) {
    const nl = p.indexOf('\n');
    const label = (nl === -1 ? p : p.slice(0, nl)).replace(/\*\*/g, '').trim();
    const items = (nl === -1 ? '' : p.slice(nl + 1)).split('\n')
      .map(l => l.match(/^[-*+]\s+(.*)$/)?.[1]?.trim()).filter((x): x is string => !!x);
    if (/^don'?t/i.test(label)) dontItems = items;
    else if (/^do/i.test(label)) doItems = items;
  }
  if (doItems === null && dontItems === null) return null;
  return { doItems: doItems ?? [], dontItems: dontItems ?? [] };
}

export function serializeRules(d: RulesData): string {
  const block = (label: string, items: string[]) =>
    [`### ${label}`, ...(items.filter(Boolean).length ? [items.filter(i => i.trim()).map(i => `- ${i.trim()}`).join('\n')] : [])].join('\n\n');
  return [block('Do', d.doItems), block("Don't", d.dontItems)].join('\n\n');
}

export function RulesSectionEditor({ md, onChange }: { md: string; onChange: (md: string) => void }) {
  const data = React.useMemo(() => parseRules(md) ?? { doItems: [], dontItems: [] }, [md]);
  const push = (d: RulesData) => onChange(serializeRules(d));

  const Panel = ({ negative, items, onItems }: { negative: boolean; items: string[]; onItems: (v: string[]) => void }) => (
    <div className={`pc-aib-rulep ${negative ? 'no' : ''}`}>
      <div className="pc-aib-rulep-h">
        <span className="pc-aib-rulep-ico"><i className={`bi bi-${negative ? 'x-lg' : 'check-lg'}`} /></span>
        <b>{negative ? "Don't" : 'Do'}</b>
      </div>
      {items.map((it, i) => (
        <div className="pc-aib-linerow" key={i}>
          <textarea rows={1} className="pc-aib-linetxt" value={it}
            placeholder={negative ? 'Something to avoid…' : 'Something to do…'}
            onChange={e => onItems(items.map((x, j) => j === i ? e.target.value : x))} />
          <button type="button" className="danger" onClick={() => onItems(items.filter((_, j) => j !== i))} title="Remove"><i className="bi bi-x-lg" /></button>
        </div>
      ))}
      <button type="button" className="pc-aib-saddlink" onClick={() => onItems([...items, ''])}>
        <i className="bi bi-plus-lg" /> Add {negative ? "don't" : 'do'}
      </button>
    </div>
  );

  return (
    <div className="pc-aib-struct pc-aib-rules2">
      <Panel negative={false} items={data.doItems} onItems={v => push({ ...data, doItems: v })} />
      <Panel negative items={data.dontItems} onItems={v => push({ ...data, dontItems: v })} />
    </div>
  );
}

/* ── util ── */
function swap<T>(arr: T[], i: number, j: number): T[] { const a = arr.slice(); [a[i], a[j]] = [a[j], a[i]]; return a; }
