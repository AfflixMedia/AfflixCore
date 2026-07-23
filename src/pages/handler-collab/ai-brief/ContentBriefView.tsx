import React from 'react';
import {
  generateBrief, listBriefs, createBrief, updateBrief, deleteBrief,
  shareUrl, uploadBriefImage, signBriefImages, normalizeBriefStructure, type SavedBrief,
} from './briefApi';
import { renderBriefMarkdown, extractDriveIds } from './markdown';
import BriefEditor from './BriefEditor';
import BriefDocView from './BriefDocView';
import { importDocument, pastedToMarkdown, blankBriefMarkdown, IMPORT_ACCEPT } from './briefImport';
import { structuredSectionCount, ensureCanonicalSections } from './briefLayout';
import './aiBrief.css';

/* ════════════════════════════════════════════════════════════
   AI CONTENT BRIEF — shared view.

   Two entry points, one component:
     · handler    → tab inside /paid-collab (gated on profiles.ai_brief_enabled)
     · Super Boss → /content-brief standalone page

   Flow: fill inputs → Claude streams the brief (edge function holds the API
   key) → it auto-saves to content_briefs → edit it in place → publish a
   read-only /brief/:token link for the creator or client.
════════════════════════════════════════════════════════════ */

interface Brand { id: string; name: string; client?: string; }

interface Props {
  brands: Brand[];
  month: string;
}

function parseLinks(raw: string): string[] {
  return raw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
}

function fmtWhen(iso: string) {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export default function ContentBriefView({ brands, month }: Props) {
  // ── inputs ──
  const [brandId, setBrandId] = React.useState('');
  const [brandName, setBrandName] = React.useState('');
  const [websiteUrl, setWebsiteUrl] = React.useState('');
  const [logoUrl, setLogoUrl] = React.useState('');
  const [productLinks, setProductLinks] = React.useState('');
  const [videoLinks, setVideoLinks] = React.useState('');
  const [competitors, setCompetitors] = React.useState('');
  const [sellingPriority, setSellingPriority] = React.useState('');
  const [complianceNotes, setComplianceNotes] = React.useState('');
  const [pricingNotes, setPricingNotes] = React.useState('');
  const [extraNotes, setExtraNotes] = React.useState('');
  const [advanced, setAdvanced] = React.useState(false);
  const [setupOpen, setSetupOpen] = React.useState(true);

  // ── brief ──
  const [brief, setBrief] = React.useState('');
  const [current, setCurrent] = React.useState<SavedBrief | null>(null);
  const [saved, setSaved] = React.useState<SavedBrief[]>([]);
  const [dirty, setDirty] = React.useState(false);
  // preview = read-only render · edit = topic-wise GUI editor · markdown = raw source
  const [mode, setMode] = React.useState<'preview' | 'edit' | 'markdown'>('preview');

  // ── ui ──
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState('');
  const [importing, setImporting] = React.useState(false);
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [pasteText, setPasteText] = React.useState('');
  /** Clipboard HTML, when the paste carried it — keeps headings and tables. */
  const pasteHtml = React.useRef('');

  // Drive image URLs, keyed by drive id. Signed URLs expire (6h), so we hold
  // them in state per session and re-sign whenever new ids appear in the brief.
  const [imgUrls, setImgUrls] = React.useState<Record<string, string>>({});
  const [uploading, setUploading] = React.useState<'logo' | 'body' | null>(null);
  const [uploadPct, setUploadPct] = React.useState(0);

  const abortRef = React.useRef<AbortController | null>(null);
  const outRef = React.useRef<HTMLDivElement | null>(null);
  const stickRef = React.useRef(true);
  const logoInputRef = React.useRef<HTMLInputElement | null>(null);
  const bodyInputRef = React.useRef<HTMLInputElement | null>(null);
  const pickInputRef = React.useRef<HTMLInputElement | null>(null);
  const importInputRef = React.useRef<HTMLInputElement | null>(null);
  const editorRef = React.useRef<HTMLTextAreaElement | null>(null);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2000); };

  // Load the caller's saved briefs once (RLS scopes them).
  React.useEffect(() => {
    let off = false;
    listBriefs().then(rows => { if (!off) setSaved(rows); })
      .catch(e => { if (!off) setErr(e.message); });
    return () => { off = true; };
  }, []);

  const pickBrand = (id: string) => {
    setBrandId(id);
    const b = brands.find(x => x.id === id);
    if (b) setBrandName(b.name);
  };

  // Sign any Drive image referenced by the brief or logo that we don't have a
  // URL for yet. Runs whenever either changes, so a freshly uploaded or
  // AI-referenced image resolves without a reload.
  React.useEffect(() => {
    const ids = extractDriveIds(brief, logoUrl);
    const missing = ids.filter(id => !imgUrls[id]);
    if (!missing.length) return;
    let off = false;
    signBriefImages(missing)
      .then(urls => { if (!off && Object.keys(urls).length) setImgUrls(prev => ({ ...prev, ...urls })); })
      .catch(() => { /* placeholder stays until the next attempt */ });
    return () => { off = true; };
  }, [brief, logoUrl, imgUrls]);

  const resolveImg = React.useCallback((id: string) => imgUrls[id], [imgUrls]);

  /**
   * Uploads to Drive and returns both the `drive:<id>` marker to store and the
   * signed URL to display right now (state lands a tick later).
   */
  const upload = async (file: File, where: 'logo' | 'body') => {
    setUploading(where); setUploadPct(0); setErr(null);
    try {
      const img = await uploadBriefImage(file, setUploadPct);
      const urls = await signBriefImages([img.drive_id]);
      setImgUrls(prev => ({ ...prev, ...urls }));
      return { ref: `drive:${img.drive_id}`, url: urls[img.drive_id] ?? '' };
    } catch (e) {
      setErr((e as Error).message);
      return null;
    } finally { setUploading(null); setUploadPct(0); }
  };

  const onLogoFile = async (file?: File) => {
    if (!file) return;
    const up = await upload(file, 'logo');
    if (!up) return;
    const ref = up.ref;
    setLogoUrl(ref);
    // Persist straight away when editing a saved brief, so the logo is not
    // lost if the tab closes before the next Save.
    if (current) {
      try {
        const row = await updateBrief(current.id, { logo_url: ref });
        setCurrent(row);
        setSaved(prev => prev.map(b => b.id === row.id ? row : b));
      } catch (e) { setErr((e as Error).message); }
    }
    flash('Logo uploaded');
  };

  /** Inserts an uploaded image into the brief at the caret. */
  const onBodyImage = async (file?: File) => {
    if (!file) return;
    const up = await upload(file, 'body');
    if (!up) return;
    const ref = up.ref;
    const alt = file.name.replace(/\.[^.]+$/, '');
    const snippet = `\n\n![${alt}](${ref})\n\n`;
    const el = editorRef.current;
    if (el && mode === 'markdown') {
      const at = el.selectionStart ?? brief.length;
      setBrief(brief.slice(0, at) + snippet + brief.slice(at));
    } else {
      setBrief(prev => prev + snippet);
    }
    setDirty(true);
    flash('Image added to the brief');
  };

  /**
   * Promise-shaped picker for the GUI editor's image button: it opens the file
   * dialog, waits for the Drive upload, and hands back a src Quill can embed.
   * The stored Markdown keeps the `drive:<id>` marker — `refFor` below maps the
   * signed URL back on the way out, so links never expire in saved text.
   */
  const pickResolve = React.useRef<((src: string | null) => void) | null>(null);
  const pickImage = React.useCallback(() => new Promise<string | null>(resolve => {
    pickResolve.current = resolve;
    pickInputRef.current?.click();
  }), []);

  const onPickedImage = async (file?: File) => {
    const done = pickResolve.current;
    pickResolve.current = null;
    if (!file) { done?.(null); return; }
    const up = await upload(file, 'body');
    done?.(up?.url || null);
    if (up) flash('Image added');
  };

  const refFor = React.useCallback((src: string) => {
    if (!src) return '';
    if (src.startsWith('drive:')) return src;
    const hit = Object.entries(imgUrls).find(([, url]) => url === src);
    return hit ? `drive:${hit[0]}` : src;
  }, [imgUrls]);

  // Follow the stream unless the reader scrolled up.
  React.useEffect(() => {
    const el = outRef.current;
    if (el && busy && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [brief, busy]);

  const onOutScroll = () => {
    const el = outRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const canGenerate = !!brandName.trim() && !busy;

  const run = async () => {
    if (!canGenerate) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    stickRef.current = true;
    setBusy(true); setErr(null); setBrief(''); setCurrent(null);
    setDirty(false); setMode('preview'); setStatus('Starting');

    const inputs = {
      brandName: brandName.trim(),
      websiteUrl: websiteUrl.trim() || undefined,
      logoUrl: logoUrl.trim() || undefined,
      productLinks: parseLinks(productLinks),
      videoLinks: parseLinks(videoLinks),
      competitors: competitors.trim() || undefined,
      sellingPriority: sellingPriority.trim() || undefined,
      complianceNotes: complianceNotes.trim() || undefined,
      pricingNotes: pricingNotes.trim() || undefined,
      extraNotes: extraNotes.trim() || undefined,
      month,
    };

    let text = '';
    try {
      await generateBrief(inputs, {
        onText: chunk => { text += chunk; setBrief(prev => prev + chunk); },
        onStatus: setStatus,
        signal: ctrl.signal,
      });
      setStatus('');

      // Persist immediately so a generated brief is never lost to a refresh.
      if (text.trim()) {
        try {
          const row = await createBrief({
            brand_id: brandId || null,
            brand_name: brandName.trim(),
            month,
            website_url: websiteUrl.trim() || null,
            logo_url: logoUrl.trim() || null,
            title: `${brandName.trim()} TikTok Shop UGC Content Brief`,
            body: text,
            inputs,
          });
          setCurrent(row);
          setSaved(prev => [row, ...prev]);
          setSetupOpen(false);
        } catch (e) {
          setErr(`Brief generated but could not be saved: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      setErr((e as Error).message);
      setStatus('');
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const stop = () => { abortRef.current?.abort(); setBusy(false); setStatus(''); };

  /* ── starting without the generator ──
     A brief does not have to come from Claude: you can start from the blank
     section spine, import a doc you already wrote, or paste it in. All three
     land in the same saved row, so they edit, save and share identically. */

  const startWith = async (md: string, note: string) => {
    if (!brandName.trim()) {
      setErr('Add a brand name first — it names the brief and files it under a brand.');
      setSetupOpen(true);
      return;
    }
    const titleLine = md.match(/^#\s+(.+)$/m)?.[1]?.trim();
    setErr(null);
    setBrief(md); setCurrent(null); setDirty(false);
    setMode('edit'); setSetupOpen(false);
    try {
      const row = await createBrief({
        brand_id: brandId || null,
        brand_name: brandName.trim(),
        month,
        website_url: websiteUrl.trim() || null,
        logo_url: logoUrl.trim() || null,
        title: titleLine || `${brandName.trim()} TikTok Shop UGC Content Brief`,
        body: md,
        inputs: { brandName: brandName.trim(), month, source: note },
      });
      setCurrent(row);
      setSaved(prev => [row, ...prev]);
      flash(note);
    } catch (e) {
      // The text is on screen either way — say so rather than lose the import.
      setErr(`Could not save the brief: ${(e as Error).message}. Your text is still here — press Save once the connection is back.`);
      setDirty(true);
    }
  };

  const onImportFile = async (file?: File) => {
    if (!file) return;
    setImporting(true); setErr(null); setStatus('Reading the document');
    try {
      const md = await importDocument(file, {
        // Images inside the document go to Drive like any other brief image —
        // the body keeps a `drive:<id>` marker, never megabytes of base64.
        uploadImage: async (img) => {
          const up = await uploadBriefImage(img);
          const urls = await signBriefImages([up.drive_id]);
          setImgUrls(prev => ({ ...prev, ...urls }));
          return `drive:${up.drive_id}`;
        },
        onProgress: setStatus,
      });
      if (!md.trim()) throw new Error('That file had no readable text in it.');
      // AI restructures the imported doc into the canonical section shape so
      // the video/angle/do-don't layout renders correctly whatever the source
      // looked like. It only reshapes STRUCTURE — a server guard rejects any
      // content change and returns the raw import, so this never alters copy.
      setStatus('Structuring the brief');
      const { markdown, ai } = await structureImport(md);
      await startWith(markdown, ai ? `Imported & structured ${file.name}` : `Imported ${file.name}`);
    } catch (e) { setErr((e as Error).message); }
    finally { setImporting(false); setStatus(''); }
  };

  /**
   * Import post-processing: AI-normalise, VERIFY the result actually lays out
   * at least as well as the raw import (structured-section count — if the AI
   * made things worse we keep the raw version), then append empty scaffolds
   * for any canonical section the brief lacks so the editor offers the full
   * spine (brand/product/videos/hooks/overlays/angles/do-don't). Scaffolds are
   * added deterministically — never by the AI — and stay hidden on the reading
   * page until filled.
   */
  const structureImport = async (raw: string): Promise<{ markdown: string; ai: boolean }> => {
    const { markdown: normalized, ai } = await normalizeBriefStructure(raw);
    const useAi = ai && structuredSectionCount(normalized) >= structuredSectionCount(raw);
    return { markdown: ensureCanonicalSections(useAi ? normalized : raw), ai: useAi };
  };

  const usePastedText = async () => {
    const md = pastedToMarkdown(pasteText, pasteHtml.current);
    if (!md.trim()) return;
    setPasteOpen(false); setPasteText(''); pasteHtml.current = '';
    setImporting(true); setStatus('Structuring the brief');
    try {
      // Same AI restructuring + verify + scaffold pipeline as doc import.
      const { markdown, ai } = await structureImport(md);
      await startWith(markdown, ai ? 'Brief added & structured' : 'Brief added from pasted text');
    } finally { setImporting(false); setStatus(''); }
  };

  const onEdit = (v: string) => { setBrief(v); setDirty(true); };

  const save = async () => {
    if (!current || !dirty) return;
    setSaving(true); setErr(null);
    try {
      // Logo rides along so a pasted URL or Drive upload persists with the text.
      const row = await updateBrief(current.id, {
        body: brief,
        logo_url: logoUrl.trim() || null,
      });
      setCurrent(row);
      setSaved(prev => prev.map(b => b.id === row.id ? row : b));
      setDirty(false);
      flash('Saved');
    } catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  };

  const toggleShare = async () => {
    if (!current) return;
    setSaving(true); setErr(null);
    try {
      // Save pending edits first, so a link is never published showing stale text.
      if (dirty) { await updateBrief(current.id, { body: brief }); setDirty(false); }
      const row = await updateBrief(current.id, { share_enabled: !current.share_enabled });
      setCurrent(row);
      setSaved(prev => prev.map(b => b.id === row.id ? row : b));
      flash(row.share_enabled ? 'Share link is live' : 'Sharing turned off');
    } catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  };

  const copyLink = async () => {
    if (!current) return;
    try { await navigator.clipboard.writeText(shareUrl(current.share_token)); flash('Link copied'); }
    catch { setErr('Could not copy the link.'); }
  };

  const copyMd = async () => {
    try { await navigator.clipboard.writeText(brief); flash('Markdown copied'); }
    catch { setErr('Could not copy to the clipboard.'); }
  };

  const open = (b: SavedBrief) => {
    setCurrent(b); setBrief(b.body); setDirty(false);
    setBrandName(b.brand_name); setBrandId(b.brand_id ?? '');
    setWebsiteUrl(b.website_url ?? ''); setLogoUrl(b.logo_url ?? '');
    setMode('preview'); setSetupOpen(false); setErr(null);
  };

  const remove = async (b: SavedBrief) => {
    if (!window.confirm(`Delete the brief for ${b.brand_name}? This cannot be undone, and any shared link stops working.`)) return;
    try {
      await deleteBrief(b.id);
      setSaved(prev => prev.filter(x => x.id !== b.id));
      if (current?.id === b.id) { setCurrent(null); setBrief(''); setDirty(false); setSetupOpen(true); }
      flash('Deleted');
    } catch (e) { setErr((e as Error).message); }
  };

  const startNew = () => {
    setCurrent(null); setBrief(''); setDirty(false); setSetupOpen(true); setErr(null);
  };

  const html = React.useMemo(
    () => (brief ? renderBriefMarkdown(brief, resolveImg) : ''),
    [brief, resolveImg],
  );

  // A Drive logo resolves through the signed-URL map; a pasted URL is used as-is.
  const logoSrc = React.useMemo(() => {
    const v = logoUrl.trim();
    if (!v) return '';
    if (v.startsWith('drive:')) return imgUrls[v.slice(6)] ?? '';
    return v;
  }, [logoUrl, imgUrls]);

  return (
    <div className="pc-aib">
      <div className="pc-aib-head">
        <div className="pc-aib-title">
          <span className="pc-aib-ico"><i className="bi bi-stars" /></span>
          <div>
            <h2>AI Content Brief</h2>
            <p>Generate a creator-ready TikTok Shop UGC brief, edit it, then share a read-only link.</p>
          </div>
        </div>
        <span className="pc-aib-month" title="Brief is generated for this month">
          <i className="bi bi-calendar3" /> {month}
        </span>
      </div>

      {err && (
        <div className="pc-aib-alert">
          <i className="bi bi-exclamation-triangle-fill" />
          <span>{err}</span>
          <button onClick={() => setErr(null)} aria-label="Dismiss"><i className="bi bi-x-lg" /></button>
        </div>
      )}

      {/* ── saved briefs ── */}
      {saved.length > 0 && (
        <div className="pc-aib-saved">
          <span className="pc-aib-savedlab"><i className="bi bi-clock-history" /> Saved</span>
          <div className="pc-aib-savedrow">
            {saved.map(b => (
              <div key={b.id} className={`pc-aib-chip ${current?.id === b.id ? 'active' : ''}`}>
                <button className="pc-aib-chipmain" onClick={() => open(b)} title={`Updated ${fmtWhen(b.updated_at)}`}>
                  {b.share_enabled && <i className="bi bi-globe2 pc-aib-chipshare" title="Shared" />}
                  <span>{b.brand_name}</span>
                  {b.month && <em>{b.month}</em>}
                </button>
                <button className="pc-aib-chipdel" onClick={() => remove(b)} title="Delete" aria-label="Delete brief">
                  <i className="bi bi-x" />
                </button>
              </div>
            ))}
          </div>
          {(current || brief) && (
            <button className="pc-aib-new" onClick={startNew}><i className="bi bi-plus-lg" /> New</button>
          )}
        </div>
      )}

      {/* ── setup ── */}
      <div className="pc-aib-card pc-aib-card--wide">
        <button className="pc-aib-setuphead" onClick={() => setSetupOpen(o => !o)} aria-expanded={setupOpen}>
          <h3 className="pc-aib-cardhead"><i className="bi bi-sliders" /> Inputs</h3>
          <span className="pc-aib-setuptoggle">
            {!setupOpen && brandName && <em>{brandName}</em>}
            <i className={`bi bi-chevron-${setupOpen ? 'up' : 'down'}`} />
          </span>
        </button>

        {setupOpen && (
          <div className="pc-aib-grid">
            <div className="pc-aib-col">
              <h4 className="pc-aib-sub">Brand</h4>
              {brands.length > 0 && (
                <label className="pc-aib-field">
                  <span>Pick a brand <em>(fills the name)</em></span>
                  <select value={brandId} onChange={e => pickBrand(e.target.value)} disabled={busy}>
                    <option value="">Select…</option>
                    {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </label>
              )}
              <label className="pc-aib-field">
                <span>Brand name <em>(required)</em></span>
                <input value={brandName} onChange={e => setBrandName(e.target.value)}
                  disabled={busy} placeholder="e.g. Glow Theory" />
              </label>
              <label className="pc-aib-field">
                <span>Website URL</span>
                <input value={websiteUrl} onChange={e => setWebsiteUrl(e.target.value)}
                  disabled={busy} placeholder="https://brand.com" />
              </label>
              <div className="pc-aib-field">
                <span>Logo</span>
                <div className="pc-aib-logorow">
                  <input value={logoUrl} onChange={e => setLogoUrl(e.target.value)}
                    disabled={busy || uploading === 'logo'}
                    placeholder="Paste a URL, or upload" />
                  <button type="button" className="pc-aib-upbtn"
                    disabled={busy || uploading === 'logo'}
                    onClick={() => logoInputRef.current?.click()}
                    title="Upload a logo (stored on Drive)">
                    <i className={`bi bi-${uploading === 'logo' ? 'hourglass-split' : 'upload'}`} />
                    {uploading === 'logo' ? `${uploadPct}%` : 'Upload'}
                  </button>
                  {/* Hidden picker: the styled button above is the control. */}
                  <input ref={logoInputRef} type="file" accept="image/*" hidden
                    onChange={e => { onLogoFile(e.target.files?.[0]); e.target.value = ''; }} />
                </div>
                {logoUrl.startsWith('drive:') && (
                  <em className="pc-aib-storenote"><i className="bi bi-hdd-network" /> Stored on Drive</em>
                )}
              </div>
              {logoSrc && (
                <div className="pc-aib-logo">
                  <img src={logoSrc} alt=""
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  <button type="button" className="pc-aib-logoclear"
                    onClick={() => setLogoUrl('')} title="Remove logo">
                    <i className="bi bi-x-lg" />
                  </button>
                </div>
              )}
            </div>

            <div className="pc-aib-col">
              <h4 className="pc-aib-sub">Links</h4>
              <label className="pc-aib-field">
                <span>Product / TikTok Shop links <em>(one per line)</em></span>
                <textarea rows={4} value={productLinks} onChange={e => setProductLinks(e.target.value)}
                  disabled={busy} placeholder={'https://shop.tiktok.com/...\nhttps://brand.com/products/...'} />
              </label>
              <label className="pc-aib-field">
                <span>Reference video links <em>(high-GMV, one per line)</em></span>
                <textarea rows={4} value={videoLinks} onChange={e => setVideoLinks(e.target.value)}
                  disabled={busy} placeholder={'https://www.tiktok.com/@creator/video/...'} />
              </label>
              <p className="pc-aib-hint">
                Leave videos blank and the best-selling competitor formats get researched instead.
              </p>
            </div>

            <div className="pc-aib-col">
              <h4 className="pc-aib-sub">Direction</h4>
              <label className="pc-aib-field">
                <span>Selling priority <em>(what to lead with)</em></span>
                <input value={sellingPriority} onChange={e => setSellingPriority(e.target.value)}
                  disabled={busy} placeholder="e.g. lead with price, then clean ingredients" />
              </label>

              <button type="button" className="pc-aib-more" onClick={() => setAdvanced(a => !a)}>
                <i className={`bi bi-chevron-${advanced ? 'down' : 'right'}`} />
                {advanced ? 'Fewer options' : 'More options'}
              </button>

              {advanced && (
                <>
                  <label className="pc-aib-field">
                    <span>Competitors</span>
                    <input value={competitors} onChange={e => setCompetitors(e.target.value)}
                      disabled={busy} placeholder="Names or @accounts" />
                  </label>
                  <label className="pc-aib-field">
                    <span>Compliance limits / banned claims</span>
                    <textarea rows={2} value={complianceNotes} onChange={e => setComplianceNotes(e.target.value)}
                      disabled={busy} placeholder="Anything legal has told you not to say" />
                  </label>
                  <label className="pc-aib-field">
                    <span>Pricing / offers to push</span>
                    <textarea rows={2} value={pricingNotes} onChange={e => setPricingNotes(e.target.value)}
                      disabled={busy} placeholder="Hero SKU, bundles, launch pricing" />
                  </label>
                  <label className="pc-aib-field">
                    <span>Additional notes</span>
                    <textarea rows={3} value={extraNotes} onChange={e => setExtraNotes(e.target.value)}
                      disabled={busy} placeholder="Founder notes, audience, tone tweaks…" />
                  </label>
                </>
              )}

              <div className="pc-aib-actions">
                {busy ? (
                  <button className="pc-aib-generate pc-aib-generate--stop" onClick={stop}>
                    <i className="bi bi-stop-circle" /> Stop
                  </button>
                ) : (
                  <button className="pc-aib-generate" disabled={!canGenerate} onClick={run}>
                    <i className="bi bi-stars" /> {brief ? 'Generate new' : 'Generate brief'}
                  </button>
                )}
              </div>
              {(busy || importing) && status && (
                <p className="pc-aib-status"><span className="pc-aib-dot" /> {status}…</p>
              )}

              {/* ── without the generator ── */}
              <div className="pc-aib-alt">
                <span className="pc-aib-altsep">or build it yourself</span>
                <div className="pc-aib-altrow">
                  <button type="button" disabled={busy}
                    onClick={() => startWith(blankBriefMarkdown(brandName), 'Blank brief created')}
                    title="Start from an empty brief with the usual sections">
                    <i className="bi bi-file-earmark-plus" /> Start blank
                  </button>
                  <button type="button" disabled={busy || importing}
                    onClick={() => importInputRef.current?.click()}
                    title="Import a brief you already have">
                    <i className={`bi bi-${importing ? 'hourglass-split' : 'file-earmark-arrow-up'}`} />
                    {importing ? 'Reading…' : 'Import a doc'}
                  </button>
                  <button type="button" disabled={busy} onClick={() => setPasteOpen(o => !o)}
                    title="Paste an existing brief">
                    <i className="bi bi-clipboard-plus" /> Paste
                  </button>
                </div>
                {pasteOpen && (
                  <div className="pc-aib-paste">
                    <textarea rows={6} value={pasteText} autoFocus
                      placeholder="Paste your brief here — copying straight out of Google Docs or Word keeps the headings, lists and tables."
                      onChange={e => setPasteText(e.target.value)}
                      onPaste={e => { pasteHtml.current = e.clipboardData.getData('text/html') || ''; }} />
                    <div className="pc-aib-pasteacts">
                      <button type="button" onClick={() => { setPasteOpen(false); setPasteText(''); pasteHtml.current = ''; }}>
                        Cancel
                      </button>
                      <button type="button" className="primary" disabled={!pasteText.trim()} onClick={usePastedText}>
                        <i className="bi bi-check2" /> Use this text
                      </button>
                    </div>
                  </div>
                )}
                <p className="pc-aib-hint">
                  Import .docx, .pdf, .md, .txt or .html — it becomes an editable, shareable brief just like a generated one.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── editor / preview ── */}
      <section className="pc-aib-card pc-aib-card--wide">
        <div className="pc-aib-outhead">
          <h3 className="pc-aib-cardhead">
            <i className="bi bi-file-earmark-text" /> Brief
            {dirty && <span className="pc-aib-dirty" title="Unsaved changes">Unsaved</span>}
          </h3>

          {!!brief && (
            <div className="pc-aib-outactions">
              <div className="pc-aib-modes" role="tablist">
                <button className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}
                  role="tab" aria-selected={mode === 'preview'}>
                  <i className="bi bi-eye" /> Preview
                </button>
                <button className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}
                  role="tab" aria-selected={mode === 'edit'}>
                  <i className="bi bi-pencil" /> Edit
                </button>
                <button className={mode === 'markdown' ? 'active' : ''} onClick={() => setMode('markdown')}
                  role="tab" aria-selected={mode === 'markdown'} title="Raw Markdown source">
                  <i className="bi bi-code-slash" /> Markdown
                </button>
              </div>
              {/* Images go to Drive; only the drive:<id> marker enters the text.
                  In the GUI editor each block has its own image button instead. */}
              {mode !== 'edit' && (
                <button onClick={() => bodyInputRef.current?.click()}
                  disabled={uploading === 'body'}
                  title="Upload an image into the brief (stored on Drive)">
                  <i className={`bi bi-${uploading === 'body' ? 'hourglass-split' : 'image'}`} />
                  {uploading === 'body' ? `${uploadPct}%` : 'Add image'}
                </button>
              )}
              <input ref={bodyInputRef} type="file" accept="image/*" hidden
                onChange={e => { onBodyImage(e.target.files?.[0]); e.target.value = ''; }} />
              <input ref={pickInputRef} type="file" accept="image/*" hidden
                onChange={e => { onPickedImage(e.target.files?.[0]); e.target.value = ''; }} />
              {current && (
                <button onClick={save} disabled={!dirty || saving}>
                  <i className={`bi bi-${saving ? 'hourglass-split' : 'check2'}`} /> Save
                </button>
              )}
              <button onClick={copyMd} title="Copy the Markdown">
                <i className="bi bi-clipboard" /> Copy
              </button>
            </div>
          )}
        </div>

        {/* share bar */}
        {current && (
          <div className={`pc-aib-share ${current.share_enabled ? 'on' : ''}`}>
            <i className={`bi bi-${current.share_enabled ? 'globe2' : 'lock'}`} />
            <div className="pc-aib-sharemain">
              <b>{current.share_enabled ? 'Shared publicly' : 'Private'}</b>
              {current.share_enabled ? (
                <a href={shareUrl(current.share_token)} target="_blank" rel="noopener noreferrer">
                  {shareUrl(current.share_token)}
                </a>
              ) : (
                <span>Publish a read-only page anyone with the link can open, no account needed.</span>
              )}
            </div>
            {current.share_enabled && (
              <button className="pc-aib-sharebtn" onClick={copyLink}>
                <i className="bi bi-clipboard" /> Copy link
              </button>
            )}
            <button className="pc-aib-sharebtn primary" onClick={toggleShare} disabled={saving}>
              <i className={`bi bi-${current.share_enabled ? 'x-lg' : 'share'}`} />
              {current.share_enabled ? 'Stop sharing' : 'Share'}
            </button>
          </div>
        )}

        {!brief && !busy ? (
          <div className="pc-aib-empty pc-aib-empty--tall">
            <i className="bi bi-stars" />
            <p>No brief yet.</p>
            <span>
              Add a brand name, then generate one with AI — or skip the AI and start blank,
              import a .docx / .pdf, or paste what you already wrote.
            </span>
            <div className="pc-aib-emptyacts">
              <button type="button"
                onClick={() => startWith(blankBriefMarkdown(brandName), 'Blank brief created')}>
                <i className="bi bi-file-earmark-plus" /> Start blank
              </button>
              <button type="button" disabled={importing} onClick={() => importInputRef.current?.click()}>
                <i className={`bi bi-${importing ? 'hourglass-split' : 'file-earmark-arrow-up'}`} />
                {importing ? 'Reading…' : 'Import a doc'}
              </button>
            </div>
          </div>
        ) : mode === 'edit' ? (
          <BriefEditor
            value={brief}
            onChange={onEdit}
            resolveImg={resolveImg}
            refFor={refFor}
            uploadImage={pickImage}
          />
        ) : mode === 'markdown' ? (
          <textarea ref={editorRef} className="pc-aib-editor" value={brief}
            onChange={e => onEdit(e.target.value)}
            spellCheck placeholder="The brief, in Markdown…" />
        ) : busy ? (
          // While the brief is still streaming in, show the raw text as it
          // arrives — re-parsing the structured layout on every chunk would jank.
          <div className="pc-aib-out" ref={outRef} onScroll={onOutScroll}>
            {brief
              ? <div className="pc-aib-md" dangerouslySetInnerHTML={{ __html: html }} />
              : <div className="pc-aib-waiting"><span className="pc-aib-dot" /> {status || 'Working'}…</div>}
            {brief && <span className="pc-aib-caret" />}
          </div>
        ) : (
          // The finished brief renders in the same Ember Clay layout the share
          // link uses, so Preview is a true preview of what the creator sees.
          <div className="pc-aib-preview">
            <BriefDocView
              variant="preview"
              brandName={brandName.trim() || 'Brand'}
              month={month}
              fallbackTitle={`${brandName.trim() || 'Brand'} Creator Brief`}
              body={brief}
              logoSrc={logoSrc}
              resolveImage={resolveImg}
            />
          </div>
        )}
      </section>

      {/* Lives at the root: the Import button exists both in the Inputs card and
          in the empty state, and the card can be collapsed. */}
      <input ref={importInputRef} type="file" accept={IMPORT_ACCEPT} hidden
        onChange={e => { onImportFile(e.target.files?.[0]); e.target.value = ''; }} />

      {toast && <div className="pc-aib-toast"><i className="bi bi-check2-circle" /> {toast}</div>}
    </div>
  );
}
