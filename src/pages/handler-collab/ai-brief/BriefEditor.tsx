import React from 'react';
import BriefRichText from './BriefRichText';
import { renderBriefMarkdown, type ImageResolver } from './markdown';
import {
  parseBriefDoc, serializeBriefDoc, htmlToMarkdown, unresolvedSrc, driveRefFromSrc, videoBlockLabel,
  parseTable, tableToMarkdown, newSection, newTextBlock, newTableBlock,
  type BriefDoc, type BriefSection, type BriefBlock, type TableData,
} from './briefDoc';
import {
  structuredKind, VideosSectionEditor, AnglesSectionEditor, RulesSectionEditor,
} from './briefSectionEditors';

/* ════════════════════════════════════════════════════════════
   Topic-wise GUI editor for a generated brief.

   The brief is one Markdown document, but nobody wants to edit Markdown — so
   it is shown as a stack of collapsible SECTION cards (one per "##" topic).
   Open a section and its content becomes rich-text blocks you type into
   normally, plus grid editors for any Markdown tables.

   Everything is converted back to Markdown on every keystroke, so the stored
   body, the preview, and the shared page never diverge from what is on screen.
════════════════════════════════════════════════════════════ */

interface Props {
  /** The brief, as Markdown. */
  value: string;
  onChange: (md: string) => void;
  /** Resolves a `drive:<id>` marker to a signed URL for display. */
  resolveImg: ImageResolver;
  /** Maps an <img> src back to the stable `drive:<id>` marker for storage. */
  refFor: (src: string) => string;
  /** Picks + uploads an image, returning the src to embed. */
  uploadImage?: () => Promise<string | null>;
}

export default function BriefEditor({ value, onChange, resolveImg, refFor, uploadImage }: Props) {
  const [doc, setDoc] = React.useState<BriefDoc>(() => parseBriefDoc(value));
  const [openId, setOpenId] = React.useState<string>('');

  // Markdown we last handed to the parent. Anything different arriving in
  // `value` came from elsewhere (a fresh generation, opening a saved brief,
  // the raw Markdown tab) and has to be re-parsed.
  const emitted = React.useRef(value);

  React.useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    setDoc(parseBriefDoc(value));
    setHtml({});
  }, [value]);

  /** Live HTML per text block, so typing is not fed back through Markdown. */
  const [html, setHtml] = React.useState<Record<string, string>>({});

  // An image whose signed URL has not arrived yet still has to render as a real
  // <img>: the text placeholder the renderer would emit converts back to
  // Markdown on the first keystroke, silently deleting the image.
  const resolve = React.useCallback<ImageResolver>(
    id => resolveImg(id) ?? unresolvedSrc(id), [resolveImg]);

  const refBack = React.useCallback((src: string) => {
    const ref = driveRefFromSrc(src);
    return ref.startsWith('drive:') ? ref : refFor(src);
  }, [refFor]);

  const apply = (next: BriefDoc) => {
    setDoc(next);
    const md = serializeBriefDoc(next);
    emitted.current = md;
    onChange(md);
  };

  const patchSection = (id: string, fn: (s: BriefSection) => BriefSection) =>
    apply({ ...doc, sections: doc.sections.map(s => (s.id === id ? fn(s) : s)) });

  const patchBlock = (sid: string, bid: string, fn: (b: BriefBlock) => BriefBlock) =>
    patchSection(sid, s => ({ ...s, blocks: s.blocks.map(b => (b.id === bid ? fn(b) : b)) }));

  // A structured section editor owns the whole section body: collapse it back
  // to a single block. parseBriefDoc re-splits on next open; the editor re-joins.
  const setSectionBody = (sid: string, md: string) => {
    setHtml({});
    patchSection(sid, s => ({ ...s, blocks: [newTextBlock(md)] }));
  };

  const moveSection = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= doc.sections.length) return;
    const next = doc.sections.slice();
    [next[i], next[j]] = [next[j], next[i]];
    apply({ ...doc, sections: next });
  };

  const removeSection = (s: BriefSection) => {
    if (!window.confirm(`Remove the "${s.heading || 'untitled'}" section? Its content is deleted with it.`)) return;
    apply({ ...doc, sections: doc.sections.filter(x => x.id !== s.id) });
  };

  const addSection = (afterIdx: number) => {
    const s = newSection('');
    const next = doc.sections.slice();
    next.splice(afterIdx + 1, 0, s);
    apply({ ...doc, sections: next });
    setOpenId(s.id);
  };

  const addBlock = (sid: string, kind: 'text' | 'table') =>
    patchSection(sid, s => ({ ...s, blocks: [...s.blocks, kind === 'text' ? newTextBlock('') : newTableBlock()] }));

  const removeBlock = (sid: string, bid: string) =>
    patchSection(sid, s => ({ ...s, blocks: s.blocks.filter(b => b.id !== bid) }));

  const moveBlock = (sid: string, i: number, dir: -1 | 1) =>
    patchSection(sid, s => {
      const j = i + dir;
      if (j < 0 || j >= s.blocks.length) return s;
      const blocks = s.blocks.slice();
      [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
      return { ...s, blocks };
    });

  /** Markdown → HTML once per block, then the editor owns the HTML. */
  // Quill has no <hr> format and would drop rules on the first keystroke, so a
  // rule is shown as its Markdown "---" line — which renders back as a rule.
  const htmlFor = (b: BriefBlock) =>
    html[b.id] ?? renderBriefMarkdown(b.md, resolve).replace(/<hr\s*\/?>/g, '<p>---</p>');

  const onBlockHtml = (sid: string, b: BriefBlock, next: string) => {
    setHtml(prev => ({ ...prev, [b.id]: next }));
    patchBlock(sid, b.id, x => ({ ...x, md: htmlToMarkdown(next, refBack) }));
  };

  return (
    <div className="pc-aib-doc">
      <label className="pc-aib-doctitle">
        <span>Brief title</span>
        <input
          value={doc.title}
          onChange={e => apply({ ...doc, title: e.target.value })}
          placeholder="e.g. Glow Theory — TikTok Shop UGC Content Brief"
        />
      </label>

      {doc.sections.map((s, i) => {
        const open = openId === s.id;
        return (
          <section key={s.id} className={`pc-aib-sec ${open ? 'open' : ''}`}>
            <div className="pc-aib-sechead">
              <button
                type="button" className="pc-aib-secfold"
                onClick={() => setOpenId(open ? '' : s.id)}
                aria-expanded={open} title={open ? 'Collapse' : 'Edit this section'}
              >
                <i className={`bi bi-chevron-${open ? 'down' : 'right'}`} />
              </button>
              <input
                className="pc-aib-sectitle" value={s.heading}
                onChange={e => patchSection(s.id, x => ({ ...x, heading: e.target.value }))}
                onFocus={() => setOpenId(s.id)}
                placeholder="Section heading"
              />
              <span className="pc-aib-secmeta">{s.blocks.length} block{s.blocks.length === 1 ? '' : 's'}</span>
              <div className="pc-aib-secacts">
                <button type="button" onClick={() => moveSection(i, -1)} disabled={i === 0} title="Move up">
                  <i className="bi bi-arrow-up" />
                </button>
                <button type="button" onClick={() => moveSection(i, 1)} disabled={i === doc.sections.length - 1} title="Move down">
                  <i className="bi bi-arrow-down" />
                </button>
                <button type="button" onClick={() => removeSection(s)} title="Delete section" className="danger">
                  <i className="bi bi-trash3" />
                </button>
              </div>
            </div>

            {open ? (
              <div className="pc-aib-secbody">
                {(() => {
                  // Special section types get a purpose-built form instead of raw
                  // Markdown blocks: reference videos (image/description/link ×3),
                  // content angles (×3), and Do / Don't as two separate panels.
                  const joined = s.blocks.map(b => b.md).join('\n\n');
                  const kind = structuredKind(s.heading, joined);
                  if (kind === 'videos') return (
                    <VideosSectionEditor md={joined} onChange={md => setSectionBody(s.id, md)}
                      resolveImg={resolveImg} refFor={refFor} uploadImage={uploadImage} />
                  );
                  if (kind === 'angles') return (
                    <AnglesSectionEditor md={joined} onChange={md => setSectionBody(s.id, md)} />
                  );
                  if (kind === 'rules') return (
                    <RulesSectionEditor md={joined} onChange={md => setSectionBody(s.id, md)} />
                  );
                  return (<>
                {s.blocks.map((b, bi) => {
                  const video = b.kind === 'text' ? videoBlockLabel(b.md) : null;
                  return (
                  <div key={b.id} className="pc-aib-blk">
                    <div className="pc-aib-blkbar">
                      <span>
                        <i className={`bi bi-${b.kind === 'table' ? 'table' : video ? 'camera-video' : 'text-left'}`} />
                        {' '}{b.kind === 'table' ? 'Table' : video ?? 'Text'}
                      </span>
                      <div className="pc-aib-blkacts">
                        <button type="button" onClick={() => moveBlock(s.id, bi, -1)} disabled={bi === 0} title="Move up">
                          <i className="bi bi-arrow-up" />
                        </button>
                        <button type="button" onClick={() => moveBlock(s.id, bi, 1)} disabled={bi === s.blocks.length - 1} title="Move down">
                          <i className="bi bi-arrow-down" />
                        </button>
                        <button type="button" className="danger" onClick={() => removeBlock(s.id, b.id)} title="Delete block">
                          <i className="bi bi-x-lg" />
                        </button>
                      </div>
                    </div>
                    {b.kind === 'table' ? (
                      <TableEditor
                        md={b.md}
                        onChange={md => patchBlock(s.id, b.id, x => ({ ...x, md }))}
                      />
                    ) : (
                      <BriefRichText
                        value={htmlFor(b)}
                        onChange={next => onBlockHtml(s.id, b, next)}
                        onImage={uploadImage}
                        placeholder="Write this part of the brief…"
                      />
                    )}
                  </div>
                  );
                })}

                <div className="pc-aib-secadd">
                  <button type="button" onClick={() => addBlock(s.id, 'text')}>
                    <i className="bi bi-plus-lg" /> Text
                  </button>
                  <button type="button" onClick={() => addBlock(s.id, 'table')}>
                    <i className="bi bi-table" /> Table
                  </button>
                </div>
                  </>);
                })()}
              </div>
            ) : (
              <button type="button" className="pc-aib-secpeek" onClick={() => setOpenId(s.id)}>
                <div
                  className="pc-aib-md"
                  dangerouslySetInnerHTML={{
                    __html: renderBriefMarkdown(
                      s.blocks.map(b => b.md).join('\n\n').slice(0, 900), resolveImg,
                    ),
                  }}
                />
              </button>
            )}

            <button type="button" className="pc-aib-secinsert" onClick={() => addSection(i)}>
              <i className="bi bi-plus-lg" /> Add section here
            </button>
          </section>
        );
      })}
    </div>
  );
}

/* ── table grid ────────────────────────────────────────────── */

function TableEditor({ md, onChange }: { md: string; onChange: (md: string) => void }) {
  const t = React.useMemo<TableData>(() => parseTable(md), [md]);
  const push = (next: TableData) => onChange(tableToMarkdown(next));

  const setHead = (c: number, v: string) =>
    push({ ...t, head: t.head.map((h, i) => (i === c ? v : h)) });

  const setCell = (r: number, c: number, v: string) =>
    push({ ...t, rows: t.rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)) });

  const addRow = () => push({ ...t, rows: [...t.rows, t.head.map(() => '')] });
  const delRow = (r: number) => push({ ...t, rows: t.rows.filter((_, i) => i !== r) });
  const addCol = () => push({ head: [...t.head, `Column ${t.head.length + 1}`], rows: t.rows.map(r => [...r, '']) });
  const delCol = (c: number) =>
    push({ head: t.head.filter((_, i) => i !== c), rows: t.rows.map(r => r.filter((_, i) => i !== c)) });

  return (
    <div className="pc-aib-tbl">
      <div className="pc-aib-tblscroll">
        <table>
          <thead>
            <tr>
              {t.head.map((h, c) => (
                <th key={c}>
                  <input value={h} onChange={e => setHead(c, e.target.value)} placeholder={`Column ${c + 1}`} />
                  <button type="button" onClick={() => delCol(c)} disabled={t.head.length < 2} title="Delete column">
                    <i className="bi bi-x" />
                  </button>
                </th>
              ))}
              <th className="pc-aib-tblgutter" />
            </tr>
          </thead>
          <tbody>
            {t.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c}>
                    <textarea rows={1} value={cell} onChange={e => setCell(r, c, e.target.value)} />
                  </td>
                ))}
                <td className="pc-aib-tblgutter">
                  <button type="button" onClick={() => delRow(r)} disabled={t.rows.length < 2} title="Delete row">
                    <i className="bi bi-trash3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pc-aib-tblacts">
        <button type="button" onClick={addRow}><i className="bi bi-plus-lg" /> Row</button>
        <button type="button" onClick={addCol}><i className="bi bi-plus-lg" /> Column</button>
      </div>
    </div>
  );
}
