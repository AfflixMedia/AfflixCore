// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../lib/supabase';
import * as store from './store';
import { useAuth } from '../../auth/AuthContext';
import './handlerCollab.css';

const storeMode = 'supabase';

/* ════════════════════════════════════════════════════════════
   PAID COLLABORATIONS — standalone CRUD dashboard (/collabs)
   Its OWN project: own Supabase (or localStorage), own tables.
   Fully isolated from the creatorsxbrands app.
════════════════════════════════════════════════════════════ */

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#6366F1,#8B5CF6)',
  'linear-gradient(135deg,#EC4899,#F43F5E)',
  'linear-gradient(135deg,#14B8A6,#06B6D4)',
  'linear-gradient(135deg,#F59E0B,#EF4444)',
  'linear-gradient(135deg,#10B981,#059669)',
  'linear-gradient(135deg,#3B82F6,#2563EB)',
  'linear-gradient(135deg,#8B5CF6,#EC4899)',
];

/* ── helpers ── */
function fmt$(n) { return `$${Math.round(n || 0).toLocaleString()}`; }
function getGradient(name) {
  if (!name) return AVATAR_GRADIENTS[0];
  return AVATAR_GRADIENTS[name.charCodeAt(0) % AVATAR_GRADIENTS.length];
}
function initial(name) { const s = (name || '').trim(); return s ? s[0].toUpperCase() : '?'; }
function tiktokHandle(raw) {
  if (!raw) return '';
  const t = String(raw).trim().replace(/\/$/, '');
  if (t.startsWith('http')) { const last = t.split('/').pop() || ''; return last.startsWith('@') ? last : `@${last}`; }
  return t.startsWith('@') ? t : `@${t}`;
}
function tiktokUrl(raw) {
  if (!raw) return null;
  const t = String(raw).trim();
  if (t.startsWith('http')) return t;
  return `https://www.tiktok.com/${tiktokHandle(t)}`;
}
// Turn a PayPal payout value into an openable link when it's a link/paypal.me
// (a full URL, a www./paypal.me/ form). Plain emails stay as text (return null).
function paypalUrl(raw) {
  if (!raw) return null;
  const t = String(raw).trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^(www\.|paypal\.me\/|paypal\.com\/)/i.test(t)) return `https://${t.replace(/^\/+/, '')}`;
  return null;
}
function monthKey(dateStr) { return dateStr ? String(dateStr).slice(0, 7) : ''; }
function monthLabel(key) {
  if (!key) return '—';
  const [y, m] = key.split('-');
  return `${MONTHS[parseInt(m, 10) - 1] || '?'} ${y}`;
}
function thisMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function addMonth(key, delta) {
  let [y, m] = key.split('-').map(Number);
  m += delta;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return `${y}-${String(m).padStart(2, '0')}`;
}
function monthRange(start, end) {
  if (!start) return [];
  if (!end || start > end) return [start];
  const out = []; let m = start, g = 0;
  while (m <= end && g++ < 240) { out.push(m); m = addMonth(m, 1); }
  return out;
}
function monthShort(key) {
  if (!key) return '—';
  const [y, m] = key.split('-');
  return `${MONTHS[parseInt(m, 10) - 1] || '?'} '${String(y).slice(2)}`;
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function defaultDateForMonth(mKey) {
  return mKey === thisMonthKey() ? todayISO() : `${mKey}-15`;
}
function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}
// Status flow: starts at "Videos in Progress" → auto "Payment Pending" once all videos
// are added → user marks "Paid" from the inline dropdown after sending payment.
const STATUS_OPTIONS = [
  { value: 'videos_in_progress', label: 'Videos in Progress', cls: 'progress' },
  { value: 'pending', label: 'Payment Pending', cls: 'pending' },
  { value: 'paid', label: 'Payment Sent', cls: 'sent' },
];
const DEFAULT_STATUS = 'videos_in_progress';
function deriveStatus(c) {
  return STATUS_OPTIONS.find(s => s.value === c.payment_status) || STATUS_OPTIONS[0];
}
// Drilldown groups creators by payment status in this top→bottom order.
const STATUS_GROUP_ORDER = ['pending', 'videos_in_progress', 'paid'];
function focusProductList(bm) {
  const raw = bm?.focus_product_url || '';
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(p => (typeof p === 'string' ? { name: '', url: p } : { name: p.name || '', url: p.url || '' })).filter(p => p.url || p.name);
  } catch {}
  // legacy: newline-separated URLs (before product names were added)
  return raw.split(/\n+/).map(s => s.trim()).filter(Boolean).map(url => ({ name: '', url }));
}
function creatorProducts(c) {
  let raw = c?.products;
  if (!raw) return [];
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { return raw.trim() ? [{ name: raw.trim(), url: '' }] : []; } }
  if (!Array.isArray(raw)) return [];
  return raw.map(p => (typeof p === 'string' ? { name: p, url: '' } : { name: p.name || '', url: p.url || '' })).filter(p => p.name || p.url);
}
const prodKey = p => (p.name || p.url || '').toLowerCase().trim();
function tiktokAccounts(raw) {
  if (!raw) return [];
  return String(raw).split(/[\n,]+/).map(s => s.trim()).filter(Boolean).map(h => ({ handle: tiktokHandle(h), url: tiktokUrl(h) }));
}
const isValidUrl = s => !!s && (s.startsWith('http://') || s.startsWith('https://'));
const isValidAdCode = s => !s || (s.startsWith('#') && s.endsWith('='));
function scrollTop() { try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {} }
function copyText(t) {
  try { if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(t); return; } } catch {}
  try { const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); } catch {}
}

/* ════════════════════════════════════════════════════════════
   Root + optional passcode gate
════════════════════════════════════════════════════════════ */
// initialBrandId / initialMonth deep-link the workspace straight into a program's
// (brand + month) editable drilldown — used by the handler's Programs → program route.
export default function HandlerCollabApp({ initialBrandId = null, initialMonth = null }: { initialBrandId?: string | null; initialMonth?: string | null } = {}) {
  useEffect(() => {
    document.title = 'Paid Collaborations';
    // Lock to light mode regardless of OS dark setting.
    const root = document.documentElement;
    root.style.colorScheme = 'light';
    root.removeAttribute('data-theme');
    try { document.body.style.background = '#FAFAFA'; } catch {}
  }, []);

  return <Dashboard initialBrandId={initialBrandId} initialMonth={initialMonth} />;
}

function PasscodeGate({ onUnlock }) {
  const [pw, setPw] = useState('');
  const [shake, setShake] = useState(false);
  function submit(e) {
    e.preventDefault();
    if (pw === COLLABS_PASSCODE) { onUnlock(); return; }
    setShake(true); setTimeout(() => setShake(false), 500);
  }
  return (
    <div className="pc-app">
      <div className="pc-login">
        <form className={`pc-login-card ${shake ? 'pc-shake' : ''}`} onSubmit={submit}>
          <div className="pc-login-logo">◎</div>
          <h2>Paid Collaborations</h2>
          <p>Enter passcode to continue</p>
          <input className="pc-input" type="password" placeholder="Passcode" value={pw}
            onChange={e => setPw(e.target.value)} autoFocus />
          <button className="pc-btn pc-btn-primary" type="submit">Unlock</button>
        </form>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Dashboard
════════════════════════════════════════════════════════════ */
function Dashboard({ initialBrandId = null, initialMonth = null }) {
  const [brands, setBrands] = useState([]);
  const [brandMonths, setBrandMonths] = useState([]);
  const [creators, setCreators] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const { user } = useAuth();

  const [month, setMonth] = useState(initialMonth || thisMonthKey());
  const [tab, setTab] = useState('brands'); // brands | creators | reporting
  const [drillId, setDrillId] = useState(initialBrandId || null);
  const [search, setSearch] = useState('');
  const [brandEditor, setBrandEditor] = useState(null);   // { mode:'add'|'edit', brand? }
  const [creatorEditor, setCreatorEditor] = useState(null); // { mode, brandId, creator? }
  const [notesBrand, setNotesBrand] = useState(null);     // { id, name }
  const [confirmDel, setConfirmDel] = useState(null);     // { message, onYes }
  const [undo, setUndo] = useState(null);                 // { label, restore, commit }
  const undoRef = useRef(null);
  const undoTimer = useRef(null);

  // auto-heal: fill missing shared info (phone/email/category/etc.) across same-named creators
  const reconcileShared = useCallback(async (list) => {
    const FIELDS = ['phone', 'email', 'category', 'paypal', 'zelle', 'tiktok_handle'];
    const byName = {};
    list.forEach(c => { const k = (c.name || '').trim().toLowerCase(); if (!k) return; (byName[k] = byName[k] || []).push(c); });
    const updates = [];
    Object.values(byName).forEach(group => {
      if (group.length < 2) return;
      const merged = {};
      FIELDS.forEach(f => { const v = group.map(c => c[f]).find(x => x && String(x).trim()); if (v) merged[f] = v; });
      group.forEach(c => {
        const patch = {};
        FIELDS.forEach(f => { if (merged[f] && !(c[f] && String(c[f]).trim())) patch[f] = merged[f]; });
        if (Object.keys(patch).length) updates.push({ id: c.id, patch });
      });
    });
    if (!updates.length) return;
    setCreators(prev => prev.map(c => { const u = updates.find(x => x.id === c.id); return u ? { ...c, ...u.patch } : c; }));
    for (const u of updates) { try { await store.updateCreator(u.id, u.patch); } catch {} }
  }, []);

  const reload = useCallback(async () => {
    try {
      const data = await store.loadAll();
      const allClients = await store.getClients().catch(() => []);
      setBrands(data.brands); setBrandMonths(data.brandMonths); setCreators(data.creators);
      setClients(allClients);
      setErr('');
      reconcileShared(data.creators);
    } catch (e) {
      setErr(e.message || 'Failed to load');
    }
  }, [reconcileShared]);

  useEffect(() => { (async () => { setLoading(true); await reload(); setLoading(false); })(); }, [reload]);

  /* lookups */
  const brandById = useMemo(() => { const m = {}; brands.forEach(b => { m[b.id] = b; }); return m; }, [brands]);
  const bmByKey = useMemo(() => { const m = {}; brandMonths.forEach(x => { m[`${x.brand_id}|${x.month}`] = x; }); return m; }, [brandMonths]);

  // ── keep in sync with the database (teammates / other devices) ──
  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = !!(brandEditor || creatorEditor || confirmDel); }, [brandEditor, creatorEditor, confirmDel]);
  useEffect(() => {
    if (storeMode !== 'supabase') return;
    const iv = setInterval(() => { if (!busyRef.current && !undoRef.current) reload(); }, 22000);
    return () => clearInterval(iv);
  }, [reload]);

  // instant two-way sync via Supabase Realtime (external API edits, teammates, other
  // devices reflect here immediately). Falls back to the 22s poll above if Realtime
  // isn't enabled on the tables. Reload is debounced and paused while editing.
  useEffect(() => {
    if (storeMode !== 'supabase' || !supabase) return;
    let t = null;
    const ping = () => { if (busyRef.current || undoRef.current) return; clearTimeout(t); t = setTimeout(() => reload(), 350); };
    const ch = supabase
      .channel('pc-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'handler_collab_creators' }, ping)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'paid_collab_handler_brands' }, ping)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'handler_collab_brand_months' }, ping)
      .subscribe();
    return () => { clearTimeout(t); try { supabase.removeChannel(ch); } catch {} };
  }, [reload]);

  /* brand rows for selected month */
  const brandRows = useMemo(() => {
    const agg = {}; // brand_id -> metrics
    creators.forEach(c => {
      if (monthKey(c.onboarded_on) !== month) return;
      if (!agg[c.brand_id]) agg[c.brand_id] = { creators: 0, allocated: 0, paid: 0, videos: 0, delivered: 0 };
      const a = agg[c.brand_id];
      a.creators += 1;
      a.allocated += Number(c.amount) || 0;
      a.videos += parseInt(c.videos_count, 10) || 0;
      if (c.payment_status === 'paid') a.paid += Number(c.amount) || 0;
      if (Array.isArray(c.video_codes)) a.delivered += c.video_codes.filter(v => v?.video).length;
    });

    let rows = brands.map(b => {
      const a = agg[b.id] || { creators: 0, allocated: 0, paid: 0, videos: 0, delivered: 0 };
      const bmRow = bmByKey[`${b.id}|${month}`];
      const bm = bmRow || {};
      const budget = Number(bm.budget) || 0;
      return {
        id: b.id, brand: b.name, ...a, bm, budget,
        // Current & future months: every assigned brand auto-appears with zero stats
        // (no manual "add to month" needed). Past months: only brands that actually had
        // data (creators or a saved budget) — keeps history clean.
        show: month >= thisMonthKey() || a.creators > 0 || !!bmRow,
        remaining: budget - a.allocated,
        usage: budget > 0 ? (a.allocated / budget) * 100 : 0,
        costPerVideo: a.videos > 0 ? a.allocated / a.videos : 0,
      };
    }).filter(r => r.show);

    if (search.trim()) { const q = search.trim().toLowerCase(); rows = rows.filter(r => r.brand.toLowerCase().includes(q)); }
    rows.sort((x, y) => y.allocated - x.allocated || x.brand.localeCompare(y.brand));
    return rows;
  }, [brands, creators, bmByKey, month, search]);

  const totals = useMemo(() => brandRows.reduce((t, r) => ({
    budget: t.budget + r.budget, allocated: t.allocated + r.allocated, paid: t.paid + r.paid,
    remaining: t.remaining + r.remaining, videos: t.videos + r.videos, creators: t.creators + r.creators,
    delivered: t.delivered + r.delivered,
  }), { budget: 0, allocated: 0, paid: 0, remaining: 0, videos: 0, creators: 0, delivered: 0 }), [brandRows]);

  // Assigned brands (public.brands, paid-collab scope) not yet active in this month —
  // the handler "adds" one of these to the month rather than creating a new brand.
  const assignableBrands = useMemo(() => {
    const active = new Set(brandRows.map(r => r.id));
    return brands.filter(b => !active.has(b.id));
  }, [brands, brandRows]);

  // directory of known creators (across all brands/months) for auto-fill when re-adding
  const creatorDirectory = useMemo(() => {
    const map = {};
    creators.forEach(c => {
      const key = (c.name || '').trim().toLowerCase();
      if (!key) return;
      const score = (c.tiktok_handle ? 1 : 0) + (c.paypal ? 1 : 0) + (c.zelle ? 1 : 0) + (c.phone ? 1 : 0) + (c.email ? 1 : 0);
      const prev = map[key];
      const prevScore = prev ? prev._score : -1;
      if (!prev || score > prevScore) map[key] = { name: c.name, tiktok_handle: c.tiktok_handle || '', paypal: c.paypal || '', zelle: c.zelle || '', phone: c.phone || '', email: c.email || '', category: c.category || '', _score: score };
    });
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name));
  }, [creators]);

  const categories = useMemo(() => [...new Set(creators.map(c => (c.category || '').trim()).filter(Boolean))].sort(), [creators]);

  // products already on the creator-editor's brand (aggregated across all its months, deduped)
  const creatorEditorProducts = useMemo(() => {
    if (!creatorEditor) return [];
    const seen = new Set(), out = [];
    brandMonths.filter(m => m.brand_id === creatorEditor.brandId).forEach(m => focusProductList(m).forEach(p => {
      const k = prodKey(p);
      if (k && !seen.has(k)) { seen.add(k); out.push(p); }
    }));
    return out;
  }, [creatorEditor, brandMonths]);

  // Creators tab — EVERY creator (per brand, every month), each tagged with its month
  const allCreatorsList = useMemo(() => creators
    .map(c => ({ ...c, _brandName: brandById[c.brand_id]?.name || '—', _monthKey: monthKey(c.onboarded_on) }))
    // month groups newest-first; within a month, most-recently-onboarded on top (then newest record), not alphabetical
    .sort((a, b) => String(b._monthKey).localeCompare(String(a._monthKey))
      || String(b.onboarded_on || '').localeCompare(String(a.onboarded_on || ''))
      || String(b.created_at || '').localeCompare(String(a.created_at || ''))),
    [creators, brandById]);

  const drillRow = brandRows.find(r => r.id === drillId) || null;
  const drillBrand = brandById[drillId] || null;
  const drillCreators = useMemo(() => {
    if (!drillId) return [];
    return creators
      .filter(c => c.brand_id === drillId && monthKey(c.onboarded_on) === month)
      .sort((a, b) => String(b.onboarded_on || '').localeCompare(String(a.onboarded_on || '')));
  }, [creators, drillId, month]);

  /* ── mutations ── */
  async function saveBrandBudget(mode, brandRef, patch) {
    try {
      // Brands come from public.brands now: in "add" mode the handler picks one of
      // their assigned brands (patch.brand_id); in "edit" mode it's the existing brand.
      const brandId = mode === 'add' ? patch.brand_id : brandRef.id;
      if (!brandId) throw new Error('Pick a brand');
      await store.upsertBrandMonth(brandId, month, patch);
      await reload();
      setBrandEditor(null);
    } catch (e) { alert(`Couldn't save brand: ${e.message}`); }
  }
  // ── deferred delete with Undo (commits to DB only after the undo window) ──
  function scheduleUndo(payload) {
    if (undoTimer.current) { clearTimeout(undoTimer.current); undoTimer.current = null; }
    if (undoRef.current) undoRef.current.commit();   // commit the previous pending one
    undoRef.current = payload;
    setUndo(payload);
    undoTimer.current = setTimeout(() => { payload.commit(); undoRef.current = null; setUndo(null); undoTimer.current = null; }, 6000);
  }
  function doUndo() {
    if (!undoRef.current) return;
    if (undoTimer.current) { clearTimeout(undoTimer.current); undoTimer.current = null; }
    undoRef.current.restore();
    undoRef.current = null;
    setUndo(null);
  }
  useEffect(() => {
    const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && undoRef.current) { e.preventDefault(); doUndo(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // shared identity (same person across brands/months) — propagate to siblings
  async function propagateShared(name, shared, exceptId) {
    const key = (name || '').trim().toLowerCase();
    if (!key) return;
    const sibs = creators.filter(c => (c.name || '').trim().toLowerCase() === key && c.id !== exceptId);
    for (const s of sibs) {
      const patch = {};
      Object.entries(shared).forEach(([k, v]) => { if (v && s[k] !== v) patch[k] = v; });
      if (Object.keys(patch).length) { try { await store.updateCreator(s.id, patch); } catch {} }
    }
  }
  async function saveCreator(mode, data) {
    try {
      let savedId = data.id;
      if (mode === 'add') { const row = await store.addCreator(data); savedId = row?.id; }
      else await store.updateCreator(data.id, {
        name: data.name, tiktok_handle: data.tiktok_handle, amount: Number(data.amount) || 0,
        videos_count: parseInt(data.videos_count, 10) || 0, zelle: data.zelle, paypal: data.paypal,
        phone: data.phone, email: data.email, category: data.category,
        onboarded_on: data.onboarded_on,
        products: Array.isArray(data.products) ? data.products : [],
      });
      // keep the same creator's contact/identity in sync everywhere they appear
      await propagateShared(data.name, {
        tiktok_handle: data.tiktok_handle, paypal: data.paypal, zelle: data.zelle,
        phone: data.phone, email: data.email, category: data.category,
      }, savedId);
      await reload();
      setCreatorEditor(null);
    } catch (e) { alert(`Couldn't save creator: ${e.message}`); }
  }
  function removeCreator(id) {
    const c = creators.find(x => x.id === id);
    if (!c) return;
    setConfirmDel({
      message: `Delete creator “${c.name}”?`,
      onYes: () => {
        setConfirmDel(null);
        setCreators(prev => prev.filter(x => x.id !== id));
        scheduleUndo({
          label: `Deleted “${c.name}”`,
          restore: () => setCreators(prev => (prev.some(x => x.id === c.id) ? prev : [...prev, c])),
          commit: () => store.deleteCreator(id).catch(() => reload()),
        });
      },
    });
  }
  // optimistic — used by the inline video/ad-code editor
  const patchCreatorLocal = useCallback((id, patch) => {
    setCreators(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
  }, []);
  // per-creator monthly GMV / Ad Spent (Performance tab) — optimistic + persist
  const saveCreatorMonthly = useCallback((id, monthly) => {
    patchCreatorLocal(id, { monthly });
    store.updateCreator(id, { monthly }).catch(() => reload());
  }, [patchCreatorLocal, reload]);
  // notes (per brand, per month) — optimistic + persist
  const saveNotes = useCallback((brandId, notesText) => {
    setBrandMonths(prev => {
      const i = prev.findIndex(x => x.brand_id === brandId && x.month === month);
      if (i >= 0) { const next = [...prev]; next[i] = { ...next[i], notes: notesText }; return next; }
      return [...prev, { id: 'tmp-' + brandId, brand_id: brandId, month, notes: notesText, budget: 0, content_guide_url: '', focus_product_url: '' }];
    });
    store.upsertBrandMonth(brandId, month, { notes: notesText }).catch(() => reload());
  }, [month, reload]);
  // inline status dropdown
  const setCreatorStatus = useCallback(async (id, payment_status) => {
    patchCreatorLocal(id, { payment_status });
    try { await store.updateCreator(id, { payment_status }); }
    catch (e) { alert(`Couldn't update status: ${e.message}`); reload(); }
  }, [patchCreatorLocal, reload]);
  // Toggle whether a "Payment Pending" creator's status is visible to the client.
  const setCreatorPendingVisible = useCallback(async (id, visible) => {
    patchCreatorLocal(id, { pending_visible_to_client: visible });
    try { await store.updateCreator(id, { pending_visible_to_client: visible }); }
    catch (e) { alert(`Couldn't update visibility: ${e.message}`); reload(); }
  }, [patchCreatorLocal, reload]);

  return (
    <div className="pc-app">
      <div className="pc-shell">
        <header className="pc-header">
          <div className="pc-brand">
            <span className="pc-brand-logo"><img src="/afflix-logo-dark.png" alt="Afflix Media" /></span>
            <span className="pc-brand-tagline">Paid Collaborations</span>
          </div>
          <div className="pc-monthnav">
            <button className="pc-mn-arrow" aria-label="Previous month" onClick={() => { setMonth(addMonth(month, -1)); setDrillId(null); }}>‹</button>
            <label className="pc-monthpicker" title="Pick a month">
              <span className="pc-monthpicker-ico">📅</span>
              <input type="month" value={month} onChange={e => { if (e.target.value) { setMonth(e.target.value); setDrillId(null); } }} />
            </label>
            <button className="pc-mn-arrow" aria-label="Next month" onClick={() => { setMonth(addMonth(month, 1)); setDrillId(null); }}>›</button>
          </div>
        </header>

        {storeMode === 'local' && (
          <div className="pc-banner">
            <span>💾</span>
            <span>Running in <b>local mode</b> — data is saved only in this browser. To share with your team, connect a new Supabase project in <code>src/collabs/config.js</code> (run <code>collabs-schema.sql</code> first).</span>
          </div>
        )}
        {err && <div className="pc-banner" style={{ background: 'var(--pc-error-bg)', color: 'var(--pc-error-fg)' }}><span>⚠️</span><span>{err}</span></div>}

        <div className="pc-tabs">
          {[{ id: 'brands', label: 'Brands' }, { id: 'creators', label: 'Creators' }, { id: 'performance', label: 'Performance' }, { id: 'reporting', label: 'Reporting' }].map(t => (
            <button key={t.id} className={`pc-tab ${tab === t.id ? 'active' : ''}`} onClick={() => { setTab(t.id); setDrillId(null); }}>{t.label}</button>
          ))}
        </div>

        {loading ? <div className="pc-spinner" /> : (
          tab === 'creators' ? (
            <CreatorsView rows={allCreatorsList}
              onEdit={(c) => setCreatorEditor({ mode: 'edit', brandId: c.brand_id, creator: c })}
              onSetStatus={setCreatorStatus} onToggleVisible={setCreatorPendingVisible} />
          ) : tab === 'performance' ? (
            <PerformanceView brands={brands} creators={creators} brandById={brandById} onSaveMonthly={saveCreatorMonthly} />
          ) : tab === 'reporting' ? (
            <ReportingView />
          ) : (
            drillId && drillBrand
              ? <Drilldown
                  brand={drillBrand} row={drillRow} month={month} creators={drillCreators}
                  onBack={() => { setDrillId(null); scrollTop(); }}
                  onAddCreator={() => setCreatorEditor({ mode: 'add', brandId: drillId })}
                  onEditCreator={(c) => setCreatorEditor({ mode: 'edit', brandId: drillId, creator: c })}
                  onDeleteCreator={removeCreator}
                  onEditBudget={() => setBrandEditor({ mode: 'edit', brand: { id: drillId, name: drillBrand.name } })}
                  onNotes={() => setNotesBrand({ id: drillId, name: drillBrand.name })}
                  notesText={(bmByKey[`${drillId}|${month}`] || {}).notes || ''}
                  patchCreatorLocal={patchCreatorLocal}
                  onSetStatus={setCreatorStatus}
                  onToggleVisible={setCreatorPendingVisible}
                />
              : <BrandLevel
                  rows={brandRows} totals={totals} month={month}
                  search={search} setSearch={setSearch}
                  onOpen={(id) => { setDrillId(id); scrollTop(); }}
                  onEditBudget={(r) => setBrandEditor({ mode: 'edit', brand: brands.find(b => b.id === r.id) || { id: r.id, name: r.brand } })}
                  onAddBrand={() => setBrandEditor({ mode: 'add', brand: { id: null, name: '' } })}
                  onNotes={(r) => setNotesBrand({ id: r.id, name: r.brand })}
                />
          )
        )}
      </div>

      {brandEditor && (
        <BrandEditor
          editor={brandEditor} month={month} bm={brandEditor.brand?.id ? (bmByKey[`${brandEditor.brand.id}|${month}`] || {}) : {}}
          assignableBrands={assignableBrands}
          onClose={() => setBrandEditor(null)}
          onSave={(patch) => saveBrandBudget(brandEditor.mode, brandEditor.brand, patch)}
        />
      )}
      {creatorEditor && (
        <CreatorEditor
          editor={creatorEditor} month={month} directory={creatorDirectory} categories={categories}
          brandProducts={creatorEditorProducts}
          onClose={() => setCreatorEditor(null)}
          onSave={(data) => saveCreator(creatorEditor.mode, data)}
        />
      )}
      {notesBrand && (
        <NotesDrawer brand={notesBrand.name} month={month}
          notes={(bmByKey[`${notesBrand.id}|${month}`] || {}).notes || ''}
          onClose={() => setNotesBrand(null)}
          onSave={(text) => saveNotes(notesBrand.id, text)} />
      )}
      {confirmDel && <ConfirmModal message={confirmDel.message} onYes={confirmDel.onYes} onCancel={() => setConfirmDel(null)} />}
      {undo && <UndoToast label={undo.label} onUndo={doUndo} />}
    </div>
  );
}

function NotesDrawer({ brand, month, notes, onClose, onSave }) {
  const [text, setText] = useState(notes || '');
  const [saveState, setSaveState] = useState('idle');
  const debounce = useRef(null);
  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);
  function change(v) {
    setText(v);
    setSaveState('saving');
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      onSave(v); setSaveState('saved');
      setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 1600);
    }, 600);
  }
  return (
    <div className="pc-drawer-overlay" onClick={onClose}>
      <aside className="pc-drawer" onClick={e => e.stopPropagation()}>
        <div className="pc-drawer-head">
          <div className="pc-drawer-head-l">
            <span className="pc-ava" style={{ background: getGradient(brand), width: 40, height: 40, fontSize: 18, borderRadius: 12 }}>{initial(brand)}</span>
            <div>
              <div className="pc-drawer-title">{brand}</div>
              <div className="pc-drawer-sub">Notes · {monthLabel(month)}</div>
            </div>
          </div>
          <button className="pc-iconbtn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="pc-drawer-body">
          <textarea className="pc-notes-area" autoFocus value={text} onChange={e => change(e.target.value)}
            placeholder="Write notes about this brand & month…&#10;&#10;• Deliverables / scope&#10;• Follow-ups & reminders&#10;• Issues, shipping, approvals" />
        </div>
        <div className="pc-drawer-foot">
          <span className="pc-drawer-hint">Saves automatically</span>
          <span className={`pc-savestate ${saveState === 'saved' ? 'saved' : ''}`}>{saveState === 'saving' ? '⟳ Saving…' : saveState === 'saved' ? '✓ Saved' : ''}</span>
        </div>
      </aside>
    </div>
  );
}

function ConfirmModal({ message, onYes, onCancel }) {
  return (
    <div className="pc-overlay" onClick={onCancel}>
      <div className="pc-modal pc-modal-confirm" onClick={e => e.stopPropagation()}>
        <div className="pc-confirm-ico">🗑️</div>
        <h3>Delete?</h3>
        <div className="pc-modal-sub">{message}<br />You'll be able to undo for a few seconds.</div>
        <div className="pc-modal-actions">
          <button className="pc-btn pc-btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="pc-btn pc-btn-danger" onClick={onYes}>Delete</button>
        </div>
      </div>
    </div>
  );
}

function UndoToast({ label, onUndo }) {
  return (
    <div className="pc-undo">
      <span className="pc-undo-label">{label}</span>
      <button className="pc-undo-btn" onClick={onUndo}>↩ Undo</button>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Brand-level table
════════════════════════════════════════════════════════════ */
function BrandLevel({ rows, totals, month, search, setSearch, onOpen, onEditBudget, onAddBrand, onNotes }) {
  const collected = totals.allocated > 0 ? Math.round((totals.paid / totals.allocated) * 100) : 0;
  return (
    <>
      <div className="pc-kpis pc-kpis-5">
        <Kpi label="Total Budget" color="#1259C3" value={fmt$(totals.budget)} sub={`${rows.length} brand${rows.length === 1 ? '' : 's'} · ${monthLabel(month)}`} />
        <Kpi label="Allocated" color="#8B5CF6" value={fmt$(totals.allocated)} sub={`${totals.creators} creators`} />
        <Kpi label="Paid" color="#2E7D32" value={fmt$(totals.paid)} sub={`${collected}% paid out`} />
        <Kpi label="Remaining" color={totals.remaining < 0 ? '#C62828' : '#E65100'} value={fmt$(totals.remaining)} sub={totals.remaining < 0 ? 'over budget' : 'budget left'} />
        <Kpi label="Videos" color="#0EA5E9" value={`${totals.delivered}/${totals.videos}`} sub={`${totals.videos > 0 ? Math.round((totals.delivered / totals.videos) * 100) : 0}% completed`} />
      </div>

      <div className="pc-toolbar">
        <input className="pc-search" placeholder="Search brands…" value={search} onChange={e => setSearch(e.target.value)} />
        <button className="pc-btn pc-btn-primary" onClick={onAddBrand}>+ Brand</button>
      </div>

      {rows.length === 0 ? (
        <div className="pc-card"><div className="pc-empty">
          <div className="pc-empty-icon">🗂️</div>
          <h3>No collaborations in {monthLabel(month)}</h3>
          <p>Add a brand with its budget to get started, or pick another month.</p>
          <button className="pc-btn pc-btn-primary" style={{ marginTop: 16 }} onClick={onAddBrand}>+ Add brand</button>
        </div></div>
      ) : (
        <div className="pc-card pc-list">
          <div className="pc-bt-head">
            <div>Brand</div><div className="pc-num">Budget</div><div className="pc-num">Allocated</div>
            <div className="pc-num">Paid</div><div className="pc-num">Remaining</div><div className="pc-num">Usage</div>
            <div className="pc-num">Videos</div><div className="pc-num">Creators</div><div className="pc-num">Cost/Vid</div>
            <div />
          </div>
          {rows.map(r => <BrandRow key={r.id} r={r} onOpen={() => onOpen(r.id)} onEditBudget={() => onEditBudget(r)} onNotes={() => onNotes(r)} />)}
          <div className="pc-bt-row is-total">
            <div className="pc-brandcell"><span style={{ marginLeft: 4 }}>Totals</span></div>
            <div className="pc-cell pc-num" data-label="Budget">{fmt$(totals.budget)}</div>
            <div className="pc-cell pc-num" data-label="Allocated">{fmt$(totals.allocated)}</div>
            <div className="pc-cell pc-num" data-label="Paid">{fmt$(totals.paid)}</div>
            <div className="pc-cell pc-num" data-label="Remaining" style={totals.remaining < 0 ? { color: 'var(--pc-error-fg)' } : null}>{fmt$(totals.remaining)}</div>
            <div className="pc-cell pc-num" data-label="Usage">{totals.budget > 0 ? Math.round((totals.allocated / totals.budget) * 100) + '%' : '—'}</div>
            <div className="pc-cell pc-num" data-label="Videos">{totals.videos}</div>
            <div className="pc-cell pc-num" data-label="Creators">{totals.creators}</div>
            <div className="pc-cell pc-num pc-cell-hide-mobile" data-label="Cost/Vid">—</div>
            <div className="pc-cell-hide-mobile" />
          </div>
        </div>
      )}
    </>
  );
}

function Kpi({ label, value, sub, color }) {
  return (
    <div className="pc-kpi">
      <div className="pc-kpi-label"><span className="pc-kpi-dot" style={{ background: color }} />{label}</div>
      <div className="pc-kpi-value">{value}</div>
      <div className="pc-kpi-sub">{sub}</div>
    </div>
  );
}

function BrandRow({ r, onOpen, onEditBudget, onNotes }) {
  // Usage bar color: below 50% red, 50%+ blue, fully used (100%+) green.
  const usageColor = r.usage >= 100 ? 'var(--pc-success-fg)' : r.usage >= 50 ? 'var(--pc-info-fg)' : 'var(--pc-error-fg)';
  function edit(e) { e.stopPropagation(); onEditBudget(); }
  function notes(e) { e.stopPropagation(); onNotes(); }
  const hasNotes = !!(r.bm.notes && r.bm.notes.trim());
  return (
    <div className="pc-bt-row" onClick={onOpen} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}>
      <div className="pc-brandcell">
        <span className="pc-ava" style={{ background: getGradient(r.brand) }}>{initial(r.brand)}</span>
        <div style={{ minWidth: 0 }}>
          <div className="pc-brandname">{r.brand}</div>
          <div className="pc-brandsub">{r.creators} creator{r.creators === 1 ? '' : 's'} · {r.delivered}/{r.videos} delivered</div>
        </div>
        <button className={`pc-note-btn ${hasNotes ? 'has' : ''}`} onClick={notes} title={hasNotes ? 'View / edit notes' : 'Add notes'} aria-label="Notes">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>
        </button>
      </div>
      <div className="pc-cell pc-budget-cell" data-label="Budget">
        <button className={`pc-budget-btn ${r.budget ? '' : 'empty'}`} onClick={edit} title="Edit budget">{r.budget ? fmt$(r.budget) : '+ set'}</button>
      </div>
      <div className="pc-cell pc-num" data-label="Allocated"><span className="pc-money">{fmt$(r.allocated)}</span></div>
      <div className="pc-cell pc-num" data-label="Paid"><span className="pc-money">{fmt$(r.paid)}</span></div>
      <div className="pc-cell pc-num" data-label="Remaining"><span className={`pc-money ${r.budget && r.remaining < 0 ? 'neg' : (r.budget ? '' : 'muted')}`}>{r.budget ? fmt$(r.remaining) : '—'}</span></div>
      <div className="pc-cell pc-num" data-label="Usage">
        {r.budget ? (
          <div className="pc-usage">
            <span className="pc-usage-pct" style={{ color: usageColor }}>{Math.round(r.usage)}%</span>
            <div className="pc-usage-track"><div className="pc-usage-fill" style={{ width: Math.min(r.usage, 100) + '%', background: usageColor }} /></div>
          </div>
        ) : <span className="pc-money muted">—</span>}
      </div>
      <div className="pc-cell pc-num" data-label="Videos">{r.videos}</div>
      <div className="pc-cell pc-num" data-label="Creators">{r.creators}</div>
      <div className="pc-cell pc-num" data-label="Cost/Vid"><span className={`pc-money ${r.costPerVideo ? 'pc-cost' : 'muted'}`}>{r.costPerVideo ? fmt$(r.costPerVideo) : '—'}</span></div>
      <div className="pc-chev pc-cell-hide-mobile">›</div>

      {/* ── purpose-built mobile card ── */}
      <div className="pc-mc">
        <div className="pc-mc-head">
          <span className="pc-ava" style={{ background: getGradient(r.brand) }}>{initial(r.brand)}</span>
          <div className="pc-mc-idblock">
            <div className="pc-mc-name">{r.brand}</div>
            <div className="pc-mc-subline">{r.creators} creator{r.creators === 1 ? '' : 's'} · {r.delivered}/{r.videos} delivered</div>
          </div>
          <button className={`pc-note-btn ${hasNotes ? 'has' : ''}`} onClick={notes} aria-label="Notes">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>
          </button>
        </div>
        {r.budget ? (
          <div className="pc-mc-usage">
            <div className="pc-usage-track"><div className="pc-usage-fill" style={{ width: Math.min(r.usage, 100) + '%', background: usageColor }} /></div>
            <span className="pc-mc-usage-pct" style={{ color: usageColor }}>{Math.round(r.usage)}% used</span>
          </div>
        ) : null}
        <div className="pc-mc-stats pc-mc-stats-3">
          <button className="pc-mc-stat pc-mc-stat-btn" onClick={edit}><b>{r.budget ? fmt$(r.budget) : '+ set'}</b><span>Budget</span></button>
          <div className="pc-mc-stat"><b>{fmt$(r.allocated)}</b><span>Allocated</span></div>
          <div className="pc-mc-stat"><b className={r.budget && r.remaining < 0 ? 'pc-red' : ''}>{r.budget ? fmt$(r.remaining) : '—'}</b><span>Remaining</span></div>
          <div className="pc-mc-stat"><b>{fmt$(r.paid)}</b><span>Paid</span></div>
          <div className="pc-mc-stat"><b>{r.videos}</b><span>Videos</span></div>
          <div className="pc-mc-stat"><b className={r.costPerVideo ? 'pc-red' : ''}>{r.costPerVideo ? fmt$(r.costPerVideo) : '—'}</b><span>Cost / Vid</span></div>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Drilldown
════════════════════════════════════════════════════════════ */
function Drilldown({ brand, row, month, creators, onBack, onAddCreator, onEditCreator, onDeleteCreator, onEditBudget, onDeleteBrand, onNotes, notesText, patchCreatorLocal, onSetStatus, onToggleVisible }) {
  const [openId, setOpenId] = useState(null);
  const bm = row?.bm || {};
  const products = focusProductList(bm);
  const notesHas = !!(notesText && notesText.trim());
  // group creators by payment status — Payment Pending → Videos in Progress → Payment Sent,
  // each introduced by a labelled divider. The # index runs continuously top-to-bottom.
  const statusGroups = useMemo(() => {
    let n = 0;
    return STATUS_GROUP_ORDER
      .map(val => {
        const opt = STATUS_OPTIONS.find(s => s.value === val);
        const items = creators.filter(c => deriveStatus(c).value === val).map(c => ({ c, idx: ++n }));
        return { opt, items };
      })
      .filter(g => g.items.length > 0);
  }, [creators]);
  return (
    <>
      <button className="pc-back" onClick={onBack}>‹ All brands</button>
      <div className="pc-dd-head">
        <span className="pc-ava" style={{ background: getGradient(brand.name) }}>{initial(brand.name)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="pc-dd-title">{brand.name}</h2>
          <div className="pc-dd-sub">{monthLabel(month)}</div>
          <div className="pc-dd-links">
            {bm.content_guide_url
              ? <a className="pc-link-chip set" href={bm.content_guide_url} target="_blank" rel="noopener noreferrer">Content guide ↗</a>
              : <button className="pc-link-chip" onClick={onEditBudget}>+ Content guide</button>}
            {products.length > 0
              ? products.map((p, i) => <a key={i} className="pc-link-chip pc-chip-orange" href={p.url || undefined} target="_blank" rel="noopener noreferrer">{p.name || `Focus product ${i + 1}`} ↗</a>)
              : <button className="pc-link-chip" onClick={onEditBudget}>+ Focus product</button>}
          </div>
        </div>
        <div className="pc-dd-actions">
          <button className={`pc-btn pc-btn-sm ${notesHas ? 'pc-btn-accentlight' : 'pc-btn-ghost'}`} onClick={onNotes}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 2 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg>
            Notes{notesHas ? ' •' : ''}
          </button>
          <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={onEditBudget}>Edit budget</button>
          <button className="pc-btn pc-btn-primary pc-btn-sm" onClick={onAddCreator}>+ Creator</button>
        </div>
      </div>

      {row && (
        <div className="pc-kpis pc-kpis-5">
          <Kpi label="Budget" color="#1259C3" value={row.budget ? fmt$(row.budget) : '—'} sub={row.budget ? `${Math.round(row.usage)}% used` : 'not set'} />
          <Kpi label="Allocated" color="#8B5CF6" value={fmt$(row.allocated)} sub={`${row.creators} creator${row.creators === 1 ? '' : 's'}`} />
          <Kpi label="Paid" color="#2E7D32" value={fmt$(row.paid)} sub={`${row.allocated > 0 ? Math.round((row.paid / row.allocated) * 100) : 0}% paid out`} />
          <Kpi label="Videos" color="#0EA5E9" value={`${row.delivered}/${row.videos}`} sub={`${row.videos > 0 ? Math.round((row.delivered / row.videos) * 100) : 0}% completed`} />
          <Kpi label="Cost / Video" color="#E65100" value={row.costPerVideo ? fmt$(row.costPerVideo) : '—'} sub="per delivered video" />
        </div>
      )}

      {creators.length === 0 ? (
        <div className="pc-card"><div className="pc-empty">
          <div className="pc-empty-icon">👤</div><h3>No creators in {monthLabel(month)}</h3>
          <p>Onboard a creator for this brand & month.</p>
          <button className="pc-btn pc-btn-primary" style={{ marginTop: 16 }} onClick={onAddCreator}>+ Add creator</button>
        </div></div>
      ) : (
        <div className="pc-card pc-list">
          <div className="pc-ct-head">
            <div className="pc-num">#</div><div>Completed on</div><div>Name</div><div>TikTok</div><div className="pc-num">Amount</div>
            <div className="pc-num">Videos</div><div>Payout</div><div>Status</div><div className="pc-num">Content</div>
          </div>
          {statusGroups.map(g => (
            <React.Fragment key={g.opt.value}>
              <div className={`pc-ct-group ${g.opt.cls}`}>
                <span className="pc-ct-group-label">
                  <span className={`pc-statusdot ${g.opt.cls}`} />{g.opt.label}
                  <span className="pc-ct-group-count">{g.items.length}</span>
                </span>
              </div>
              {g.items.map(({ c, idx }) => (
                <CreatorRow key={c.id} c={c} idx={idx} open={openId === c.id}
                  onToggle={() => setOpenId(openId === c.id ? null : c.id)}
                  onEdit={() => onEditCreator(c)} onDelete={() => onDeleteCreator(c.id)}
                  patchCreatorLocal={patchCreatorLocal} onSetStatus={onSetStatus} onToggleVisible={onToggleVisible} />
              ))}
            </React.Fragment>
          ))}
        </div>
      )}
    </>
  );
}

function CreatorRow({ c, idx, open, onToggle, onEdit, onDelete, patchCreatorLocal, onSetStatus, onToggleVisible }) {
  const accounts = tiktokAccounts(c.tiktok_handle);
  const filled = Array.isArray(c.video_codes) ? c.video_codes.filter(v => v?.video).length : 0;
  const rowRef = useRef(null);
  useEffect(() => {
    if (open && rowRef.current?.scrollIntoView) {
      try { rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {}
    }
  }, [open]);
  return (
    <>
      <div ref={rowRef} className={`pc-ct-row ${open ? 'open' : ''}`} onClick={onToggle} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onToggle(); }}>
        <div className="pc-cell pc-num pc-idxcell" data-label="#"><span className="pc-idx">#{idx}</span></div>
        <div className="pc-cell" data-label="Completed on">{c.completed_on ? fmtDate(c.completed_on) : <span className="pc-handle">—</span>}</div>
        <div className="pc-cell" data-label="Name"><span className="pc-cname">{c.name}</span></div>
        <div className="pc-cell" data-label="TikTok">
          {accounts.length > 0
            ? <span className="pc-tiktok"><a className="pc-handle" href={accounts[0].url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{accounts[0].handle}</a>{accounts.length > 1 && <span className="pc-more" title={accounts.slice(1).map(a => a.handle).join(', ')}>+{accounts.length - 1}</span>}</span>
            : <span className="pc-handle">—</span>}
        </div>
        <div className="pc-cell pc-num" data-label="Amount"><span className="pc-money">{fmt$(c.amount)}</span></div>
        <div className="pc-cell pc-num" data-label="Videos">{c.videos_count || '—'}</div>
        <div className="pc-cell" data-label="Payout"><PayoutCell paypal={c.paypal} zelle={c.zelle} /></div>
        <div className="pc-cell" data-label="Status">
          <StatusDropdown value={c.payment_status} onChange={v => onSetStatus(c.id, v)} />
          <PendingVisibilityToggle c={c} onToggleVisible={onToggleVisible} />
        </div>
        <div className="pc-cell pc-num" data-label="Content"><span className="pc-content-cell">{filled > 0 ? <b>{filled}</b> : ''} {open ? '▴' : '▾'}</span></div>

        {/* ── purpose-built mobile card ── */}
        <div className="pc-mc">
          <div className="pc-mc-head">
            <div className="pc-mc-idblock">
              <div className="pc-mc-name">{c.name}</div>
              <div className="pc-mc-subline">
                {accounts[0]
                  ? <a className="pc-mc-handle" href={accounts[0].url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{accounts[0].handle}</a>
                  : <span className="pc-mc-muted">no TikTok</span>}
                {accounts.length > 1 && <span className="pc-more">+{accounts.length - 1}</span>}
              </div>
            </div>
            <span className={`pc-mc-chev ${open ? 'open' : ''}`} aria-hidden>▾</span>
          </div>
          <div className="pc-mc-stats pc-mc-stats-3">
            <div className="pc-mc-stat"><b>{fmt$(c.amount)}</b><span>Deal</span></div>
            <div className="pc-mc-stat"><b>{c.videos_count || '—'}</b><span>Videos</span></div>
            <div className="pc-mc-stat"><b className={filled ? 'pc-green' : ''}>{filled}/{c.videos_count || filled || 0}</b><span>Delivered</span></div>
          </div>
          <div className="pc-mc-foot">
            <StatusDropdown value={c.payment_status} onChange={v => onSetStatus(c.id, v)} />
            <PendingVisibilityToggle c={c} onToggleVisible={onToggleVisible} />
            {(c.paypal || c.zelle) && <span className="pc-mc-footmeta"><PayoutCell paypal={c.paypal} zelle={c.zelle} /></span>}
          </div>
        </div>
      </div>
      {open && <CreatorExpand c={c} onEdit={onEdit} onDelete={onDelete} patchCreatorLocal={patchCreatorLocal} />}
    </>
  );
}

function PayoutCell({ paypal, zelle }) {
  if (!paypal && !zelle) return <span className="pc-handle">—</span>;
  const ppUrl = paypalUrl(paypal);
  return (
    <div className="pc-payout">
      {paypal && (
        ppUrl ? (
          <a className="pc-payline pc-paylink" href={ppUrl} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()} title={`PayPal: ${paypal}`} aria-label={`Open PayPal link: ${paypal}`}>
            <span className="pc-paytag pp">PP</span>
            <span className="pc-paylink-arrow" aria-hidden>↗</span>
          </a>
        ) : (
          <span className="pc-payline" title={`PayPal: ${paypal}`}>
            <span className="pc-paytag pp">PP</span>
            <span className="pc-payval">{paypal}</span>
          </span>
        )
      )}
      {zelle && <span className="pc-payline" title={`Zelle: ${zelle}`}><span className="pc-paytag zl">Z</span><span className="pc-payval">{zelle}</span></span>}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Creators tab — every creator (per brand) for the month
════════════════════════════════════════════════════════════ */
function CreatorsView({ rows, onEdit, onSetStatus, onToggleVisible }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(() => new Set());
  const [copied, setCopied] = useState('');
  const filtered = q.trim()
    ? rows.filter(c => `${c.name} ${c._brandName} ${c.category} ${c.tiktok_handle} ${c.email} ${c.phone}`.toLowerCase().includes(q.trim().toLowerCase()))
    : rows;
  const groups = [];
  filtered.forEach(c => {
    const last = groups[groups.length - 1];
    if (last && last.key === c._monthKey) last.items.push(c);
    else groups.push({ key: c._monthKey, items: [c] });
  });
  const allSelected = filtered.length > 0 && filtered.every(c => sel.has(c.id));
  function toggle(id) { setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function toggleAll() { setSel(prev => { const n = new Set(prev); if (allSelected) filtered.forEach(c => n.delete(c.id)); else filtered.forEach(c => n.add(c.id)); return n; }); }
  function flash(k) { setCopied(k); setTimeout(() => setCopied(x => (x === k ? '' : x)), 1800); }
  function selectedUsernames() {
    const seen = new Set(), out = [];
    rows.filter(c => sel.has(c.id)).forEach(c => tiktokAccounts(c.tiktok_handle).forEach(a => {
      const u = a.handle.replace(/^@/, '').trim(); const k = u.toLowerCase();
      if (u && !seen.has(k)) { seen.add(k); out.push(u); }
    }));
    return out;
  }
  function copyUsernames() { const u = selectedUsernames(); if (u.length) { copyText(u.join('\n')); flash('u'); } }
  async function exportXlsx() {
    const data = rows.filter(c => sel.has(c.id)).map(c => {
      const amount = Number(c.amount) || 0; const videos = parseInt(c.videos_count, 10) || 0;
      return {
        Name: c.name || '',
        Usernames: tiktokAccounts(c.tiktok_handle).map(a => a.handle.replace(/^@/, '')).join(', '),
        Phone: c.phone || '', Email: c.email || '', Category: c.category || '', Brand: c._brandName || '',
        'Deal ($)': amount, Videos: videos, 'Rate / Video ($)': videos > 0 ? Math.round(amount / videos) : '',
        Status: deriveStatus(c).label, Onboarded: c.onboarded_on || '',
      };
    });
    if (!data.length) return;
    try {
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.json_to_sheet(data);
      ws['!cols'] = [{ wch: 18 }, { wch: 22 }, { wch: 16 }, { wch: 22 }, { wch: 14 }, { wch: 16 }, { wch: 10 }, { wch: 8 }, { wch: 14 }, { wch: 18 }, { wch: 12 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Creators');
      XLSX.writeFile(wb, 'afflix-creators.xlsx');
      flash('x');
    } catch (e) { alert('Export failed: ' + e.message); }
  }
  const unameCount = selectedUsernames().length;
  const uniqueCreators = new Set(rows.map(c => (c.name || '').trim().toLowerCase()).filter(Boolean)).size;
  const totalDeals = rows.length;
  return (
    <>
      {rows.length > 0 && (
        <div className="pc-mini-pills">
          <div className="pc-mini-pill"><span className="pc-mini-pill-l">Unique Creators</span><span className="pc-mini-pill-v">{uniqueCreators}</span></div>
          <div className="pc-mini-pill"><span className="pc-mini-pill-l">Total Deals</span><span className="pc-mini-pill-v">{totalDeals}</span></div>
        </div>
      )}
      <div className="pc-toolbar">
        <input className="pc-search" placeholder="Search creators, brands, categories…" value={q} onChange={e => setQ(e.target.value)} />
        <span className="pc-count-pill">{filtered.length} creator{filtered.length === 1 ? '' : 's'} · all months</span>
      </div>
      {filtered.length === 0 ? (
        <div className="pc-card"><div className="pc-empty">
          <div className="pc-empty-icon">👥</div><h3>No creators yet</h3>
          <p>Creators you onboard inside brands show up here automatically.</p>
        </div></div>
      ) : (
        <div className="pc-card pc-list" style={{ paddingBottom: sel.size ? 8 : 0 }}>
          <div className="pc-cv-head">
            <div className="pc-cv-check"><input type="checkbox" className="pc-check" checked={allSelected} onChange={toggleAll} title="Select all" /></div>
            <div className="pc-num">#</div><div>Name</div><div>Contact</div><div>TikTok</div><div>Category</div>
            <div>Brand</div><div>Onboarded</div><div className="pc-num">Deal</div><div className="pc-num">Rate/Vid</div><div>Status</div>
          </div>
          {groups.map(g => (
            <React.Fragment key={g.key}>
              <div className="pc-cv-monthhead"><span>{monthLabel(g.key)}</span><span className="pc-cv-monthcount">{g.items.length}</span></div>
              {g.items.map((c, i) => <CreatorGlobalRow key={c.id} c={c} idx={i + 1} onEdit={() => onEdit(c)} onSetStatus={onSetStatus} onToggleVisible={onToggleVisible} selected={sel.has(c.id)} onToggleSelect={() => toggle(c.id)} />)}
            </React.Fragment>
          ))}
        </div>
      )}
      {sel.size > 0 && (
        <div className="pc-bulkbar">
          <span className="pc-bulk-count">{sel.size} selected</span>
          <button className="pc-bulk-btn primary" onClick={copyUsernames}>{copied === 'u' ? 'Copied!' : `Copy username${unameCount === 1 ? '' : 's'}`}</button>
          <button className="pc-bulk-btn" onClick={exportXlsx}>{copied === 'x' ? 'Exported!' : 'Export'}</button>
          <button className="pc-bulk-x" onClick={() => setSel(new Set())} title="Clear selection">✕</button>
        </div>
      )}
    </>
  );
}

function CreatorGlobalRow({ c, idx, onEdit, onSetStatus, onToggleVisible, selected, onToggleSelect }) {
  const accounts = tiktokAccounts(c.tiktok_handle);
  const amount = Number(c.amount) || 0;
  const videos = parseInt(c.videos_count, 10) || 0;
  const avg = videos > 0 ? amount / videos : 0;
  const contact = c.phone || c.email || '';
  return (
    <div className={`pc-cv-row ${selected ? 'sel' : ''}`} onClick={onEdit} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onEdit(); }}>
      <div className="pc-cell pc-cv-check" data-label="" onClick={e => e.stopPropagation()}><input type="checkbox" className="pc-check" checked={selected} onChange={onToggleSelect} /></div>
      <div className="pc-cell pc-num pc-idxcell" data-label="#"><span className="pc-idx">#{idx}</span></div>
      <div className="pc-cell" data-label="Name"><span className="pc-cname">{c.name}</span></div>
      <div className="pc-cell" data-label="Contact"><span className="pc-handle" title={[c.phone, c.email].filter(Boolean).join('  ·  ')}>{contact || '—'}</span></div>
      <div className="pc-cell" data-label="TikTok">
        {accounts.length > 0
          ? <span className="pc-tiktok"><a className="pc-handle" href={accounts[0].url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{accounts[0].handle}</a>{accounts.length > 1 && <span className="pc-more" title={accounts.slice(1).map(a => a.handle).join(', ')}>+{accounts.length - 1}</span>}</span>
          : <span className="pc-handle">—</span>}
      </div>
      <div className="pc-cell" data-label="Category">{c.category ? <span className="pc-cat" title={c.category}>{c.category}</span> : <span className="pc-handle">—</span>}</div>
      <div className="pc-cell" data-label="Brand"><span className="pc-brandtag">{c._brandName}</span></div>
      <div className="pc-cell" data-label="Onboarded"><span className="pc-handle">{c.onboarded_on ? fmtDate(c.onboarded_on) : '—'}</span></div>
      <div className="pc-cell pc-num" data-label="Deal"><span className="pc-dealwrap"><span className="pc-money">{fmt$(amount)}</span>{videos > 0 && <span className="pc-deal-vid"> · {videos}v</span>}</span></div>
      <div className="pc-cell pc-num" data-label="Rate/Vid"><span className="pc-money">{avg ? fmt$(avg) : '—'}</span></div>
      <div className="pc-cell" data-label="Status">
        <StatusDropdown value={c.payment_status} onChange={v => onSetStatus(c.id, v)} />
        <PendingVisibilityToggle c={c} onToggleVisible={onToggleVisible} />
      </div>

      {/* ── purpose-built mobile card ── */}
      <div className="pc-mc">
        <div className="pc-mc-head">
          <div className="pc-mc-idblock">
            <div className="pc-mc-name">{c.name}</div>
            <div className="pc-mc-subline">
              {accounts[0]
                ? <a className="pc-mc-handle" href={accounts[0].url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{accounts[0].handle}</a>
                : <span className="pc-mc-muted">no TikTok</span>}
              {accounts.length > 1 && <span className="pc-more">+{accounts.length - 1}</span>}
              <span className="pc-mc-dot">·</span>
              <span className="pc-mc-brand">{c._brandName}</span>
            </div>
          </div>
          <label className="pc-mc-checkwrap" onClick={e => e.stopPropagation()}>
            <input type="checkbox" className="pc-check" checked={selected} onChange={onToggleSelect} />
          </label>
        </div>
        <div className="pc-mc-stats pc-mc-stats-3">
          <div className="pc-mc-stat"><b>{fmt$(amount)}</b><span>Deal</span></div>
          <div className="pc-mc-stat"><b>{videos || '—'}</b><span>Videos</span></div>
          <div className="pc-mc-stat"><b>{avg ? fmt$(avg) : '—'}</b><span>Rate / Vid</span></div>
        </div>
        <div className="pc-mc-foot">
          <StatusDropdown value={c.payment_status} onChange={v => onSetStatus(c.id, v)} />
          <PendingVisibilityToggle c={c} onToggleVisible={onToggleVisible} />
          <div className="pc-mc-footmeta">
            {c.category ? <span className="pc-cat">{c.category}</span> : null}
            {c.onboarded_on && <span className="pc-mc-muted">{fmtDate(c.onboarded_on)}</span>}
          </div>
        </div>
        {contact && <div className="pc-mc-contact">{contact}</div>}
      </div>
    </div>
  );
}

function ReportingView() {
  return (
    <div className="pc-card"><div className="pc-empty pc-empty-lg">
      <div className="pc-empty-icon">📊</div>
      <h3>Reporting</h3>
      <p>This section is under process right now.</p>
      <span className="pc-soon-pill">Coming soon</span>
    </div></div>
  );
}

/* ════════════════════════════════════════════════════════════
   Performance tab — brand → per-creator monthly GMV / Ad Spend matrix
════════════════════════════════════════════════════════════ */
function sumMonthly(c, field) {
  const m = c.monthly || {};
  let t = 0;
  Object.keys(m).forEach(k => { if (/^\d{4}-\d{2}$/.test(k)) t += Number(m[k]?.[field]) || 0; });
  return t;
}

function PerformanceView({ brands, creators, brandById, onSaveMonthly }) {
  const [bId, setBId] = useState(null);
  const byBrand = useMemo(() => {
    const m = {};
    creators.forEach(c => { (m[c.brand_id] = m[c.brand_id] || []).push(c); });
    return m;
  }, [creators]);
  if (bId && brandById[bId]) {
    return <BrandMatrix brand={brandById[bId]} creators={byBrand[bId] || []} onBack={() => setBId(null)} onSaveMonthly={onSaveMonthly} />;
  }
  return <PerfBrandList brands={brands} byBrand={byBrand} onOpen={setBId} />;
}

function PerfBrandList({ brands, byBrand, onOpen }) {
  const [q, setQ] = useState('');
  let rows = brands.map(b => {
    const cs = byBrand[b.id] || [];
    const names = new Set(cs.map(c => (c.name || '').trim().toLowerCase()).filter(Boolean));
    let gmv = 0, ad = 0, l30 = 0;
    cs.forEach(c => { gmv += sumMonthly(c, 'gmv'); ad += sumMonthly(c, 'adSpent'); l30 += Number((c.monthly || {}).l30) || 0; });
    return { id: b.id, name: b.name, creators: names.size, gmv, ad, l30 };
  }).filter(r => r.creators > 0 || r.gmv > 0);
  if (q.trim()) rows = rows.filter(r => r.name.toLowerCase().includes(q.trim().toLowerCase()));
  rows.sort((a, b) => b.gmv - a.gmv || a.name.localeCompare(b.name));
  return (
    <>
      <div className="pc-toolbar">
        <input className="pc-search" placeholder="Search brands…" value={q} onChange={e => setQ(e.target.value)} />
        <span className="pc-count-pill">{rows.length} brand{rows.length === 1 ? '' : 's'} · GMV tracking</span>
      </div>
      {rows.length === 0 ? (
        <div className="pc-card"><div className="pc-empty"><div className="pc-empty-icon">📈</div><h3>No brands yet</h3><p>Onboard creators under a brand to track GMV here.</p></div></div>
      ) : (
        <div className="pc-card pc-list">
          <div className="pc-pf-head">
            <div className="pc-num">#</div><div>Brand</div><div className="pc-num">Creators</div><div className="pc-num">L30 GMV</div><div className="pc-num">Total GMV</div><div className="pc-num">Total Ad</div><div />
          </div>
          {rows.map((r, i) => (
            <div className="pc-pf-row" key={r.id} onClick={() => onOpen(r.id)} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpen(r.id); }}>
              <div className="pc-cell pc-num pc-idxcell" data-label="#"><span className="pc-idx">#{i + 1}</span></div>
              <div className="pc-cell" data-label="Brand"><span className="pc-pf-brand"><span className="pc-ava" style={{ background: getGradient(r.name), width: 30, height: 30, fontSize: 13 }}>{initial(r.name)}</span>{r.name}</span></div>
              <div className="pc-cell pc-num" data-label="Creators">{r.creators}</div>
              <div className="pc-cell pc-num" data-label="L30 GMV"><span className="pc-money">{fmt$(r.l30)}</span></div>
              <div className="pc-cell pc-num" data-label="Total GMV"><span className="pc-money">{fmt$(r.gmv)}</span></div>
              <div className="pc-cell pc-num" data-label="Total Ad"><span className="pc-money">{fmt$(r.ad)}</span></div>
              <div className="pc-chev pc-cell-hide-mobile">›</div>

              {/* ── purpose-built mobile card ── */}
              <div className="pc-mc">
                <div className="pc-mc-head">
                  <span className="pc-ava" style={{ background: getGradient(r.name) }}>{initial(r.name)}</span>
                  <div className="pc-mc-idblock">
                    <div className="pc-mc-name">{r.name}</div>
                    <div className="pc-mc-subline">{r.creators} creator{r.creators === 1 ? '' : 's'}</div>
                  </div>
                  <span className="pc-mc-chev">›</span>
                </div>
                <div className="pc-mc-stats pc-mc-stats-3">
                  <div className="pc-mc-stat"><b className="pc-mx-l30h">{fmt$(r.l30)}</b><span>L30 GMV</span></div>
                  <div className="pc-mc-stat"><b>{fmt$(r.gmv)}</b><span>Total GMV</span></div>
                  <div className="pc-mc-stat"><b>{fmt$(r.ad)}</b><span>Total Ad</span></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function BrandMatrix({ brand, creators, onBack, onSaveMonthly }) {
  const canon = useMemo(() => {
    const m = {};
    creators.forEach(c => {
      const k = (c.name || '').trim().toLowerCase(); if (!k) return;
      if (!m[k] || String(c.onboarded_on || '9999') < String(m[k].onboarded_on || '9999')) m[k] = c;
    });
    return Object.values(m).sort((a, b) => a.name.localeCompare(b.name));
  }, [creators]);
  const start = useMemo(() => {
    const ms = creators.map(c => monthKey(c.onboarded_on)).filter(Boolean).sort();
    return ms[0] || thisMonthKey();
  }, [creators]);
  const months = useMemo(() => monthRange(start, addMonth(thisMonthKey(), -1)), [start]);
  const tpl = `160px 110px 88px ${months.map(() => '74px 74px').join(' ')} 84px 96px 96px`;

  function commit(c, m, field, raw) {
    const num = raw === '' ? undefined : (Number(raw) || 0);
    const cur = c.monthly || {};
    const cell = { ...(cur[m] || {}) };
    if (!num) delete cell[field]; else cell[field] = num;
    const next = { ...cur, [m]: cell };
    if (cell.gmv == null && cell.adSpent == null) delete next[m];
    onSaveMonthly(c.id, next);
  }
  function commitL30(c, raw) {
    const num = raw === '' ? undefined : (Number(raw) || 0);
    const next = { ...(c.monthly || {}) };
    if (!num) delete next.l30; else next.l30 = num;
    onSaveMonthly(c.id, next);
  }

  let grandGmv = 0, grandAd = 0;
  canon.forEach(c => { grandGmv += sumMonthly(c, 'gmv'); grandAd += sumMonthly(c, 'adSpent'); });
  const roas = grandAd > 0 ? (grandGmv / grandAd) : 0;
  // total videos a creator has made for THIS brand (delivered video_codes, across all their deals)
  const videosByName = {};
  creators.forEach(c => {
    const k = (c.name || '').trim().toLowerCase();
    const d = Array.isArray(c.video_codes) ? c.video_codes.filter(v => v?.video).length : 0;
    videosByName[k] = (videosByName[k] || 0) + d;
  });
  const grandVideos = Object.values(videosByName).reduce((a, b) => a + b, 0);

  return (
    <>
      <button className="pc-back" onClick={onBack}>‹ All brands</button>
      <div className="pc-dd-head">
        <span className="pc-ava" style={{ background: getGradient(brand.name) }}>{initial(brand.name)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="pc-dd-title">{brand.name}</h2>
          <div className="pc-dd-sub">Performance · {canon.length} creator{canon.length === 1 ? '' : 's'} · {months.length} month{months.length === 1 ? '' : 's'} tracked</div>
        </div>
      </div>
      {canon.length === 0 ? (
        <div className="pc-card"><div className="pc-empty"><div className="pc-empty-icon">👤</div><h3>No creators for this brand</h3></div></div>
      ) : (
        <>
          <div className="pc-pf-stats">
            <div className="pc-pf-stat"><div className="pc-pf-stat-l">Total GMV for us</div><div className="pc-pf-stat-v pc-green">{fmt$(grandGmv)}</div></div>
            <div className="pc-pf-stat"><div className="pc-pf-stat-l">Total Ads Spent</div><div className="pc-pf-stat-v pc-red">{fmt$(grandAd)}</div></div>
            <div className="pc-pf-stat"><div className="pc-pf-stat-l">ROAS</div><div className="pc-pf-stat-v">{roas ? roas.toFixed(2) + 'x' : '—'}</div></div>
            <div className="pc-pf-stat"><div className="pc-pf-stat-l">Total Videos</div><div className="pc-pf-stat-v">{grandVideos}</div></div>
          </div>
          <div className="pc-card">
            <div className="pc-matrix-wrap">
              <div className="pc-mx">
                <div className="pc-mx-head" style={{ gridTemplateColumns: tpl }}>
                  <div className="pc-mxh">Name</div>
                  <div className="pc-mxh">Username</div>
                  <div className="pc-mxh pc-mxh-c pc-mx-l30h">L30 GMV</div>
                  {months.map(m => (
                    <div key={m} className="pc-mxh-month" style={{ gridColumn: 'span 2' }}>
                      <span className="pc-mxh-mname">{monthShort(m)}</span>
                      <span className="pc-mxh-sub"><span>GMV</span><span>Ad</span></span>
                    </div>
                  ))}
                  <div className="pc-mxh pc-mxh-c">Total Videos</div>
                  <div className="pc-mxh pc-mxh-c pc-green">Total GMV for us</div>
                  <div className="pc-mxh pc-mxh-c pc-red">Total Ads Spent</div>
                </div>
                {canon.map(c => {
                  const mm = c.monthly || {};
                  return (
                    <div className="pc-mx-row" key={c.id} style={{ gridTemplateColumns: tpl }}>
                      <div className="pc-mx-name" title={c.name}>{c.name}</div>
                      <div className="pc-mx-user">{tiktokAccounts(c.tiktok_handle)[0]?.handle || '—'}</div>
                      <MatrixCell value={mm.l30} l30 onCommit={v => commitL30(c, v)} />
                      {months.map(m => (
                        <React.Fragment key={m}>
                          <MatrixCell value={(mm[m] || {}).gmv} onCommit={v => commit(c, m, 'gmv', v)} />
                          <MatrixCell value={(mm[m] || {}).adSpent} ad onCommit={v => commit(c, m, 'adSpent', v)} />
                        </React.Fragment>
                      ))}
                      <div className="pc-mx-num strong">{videosByName[(c.name || '').trim().toLowerCase()] || 0}</div>
                      <div className="pc-mx-num strong pc-green">{fmt$(sumMonthly(c, 'gmv'))}</div>
                      <div className="pc-mx-num strong pc-red">{fmt$(sumMonthly(c, 'adSpent'))}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function MatrixCell({ value, onCommit, ad, l30 }) {
  const [v, setV] = useState(value == null ? '' : String(value));
  useEffect(() => { setV(value == null ? '' : String(value)); }, [value]);
  return (
    <input className={`pc-mx-input ${ad ? 'ad' : ''} ${l30 ? 'l30' : ''}`} type="number" inputMode="numeric" placeholder="–"
      value={v} onChange={e => setV(e.target.value)} onBlur={() => onCommit(v)} onClick={e => e.stopPropagation()} />
  );
}

// Shown only while a creator is "Payment Pending". Off (default) = the client/Bob
// read views mask the status as "Videos in Progress"; on = client sees "Payment Pending".
function PendingVisibilityToggle({ c, onToggleVisible }) {
  if (c.payment_status !== 'pending' || !onToggleVisible) return null;
  const on = !!c.pending_visible_to_client;
  return (
    <button
      type="button"
      className={`pc-badge pc-visbtn ${on ? 'on' : ''}`}
      onClick={e => { e.stopPropagation(); onToggleVisible(c.id, !on); }}
      title={on
        ? 'Client can see “Payment Pending”. Click to hide it.'
        : 'Hidden from client. Click to show “Payment Pending”.'}
      aria-pressed={on}
    >
      <i className={`bi ${on ? 'bi-eye-fill' : 'bi-eye-slash'}`} />
      <span className="pc-visbtn-txt">{on ? 'Visible to client' : 'Hidden from client'}</span>
    </button>
  );
}

function StatusDropdown({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const cur = deriveStatus({ payment_status: value });
  function toggle(e) {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const menuW = Math.max(r.width, 184);
      // keep the portal menu inside the viewport (it would overflow off the right edge on mobile)
      const left = Math.max(10, Math.min(r.left, window.innerWidth - menuW - 10));
      const top = (r.bottom + 6 + 150 > window.innerHeight && r.top - 6 - 150 > 0) ? r.top - 6 : r.bottom + 6;
      setPos({ left, top, width: r.width, flip: top < r.top });
    }
    setOpen(o => !o);
  }
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const t = setTimeout(() => document.addEventListener('click', close), 0);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { clearTimeout(t); document.removeEventListener('click', close); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [open]);
  return (
    <>
      <button ref={btnRef} className={`pc-badge ${cur.cls} pc-badge-btn`} onClick={toggle} title="Change status">
        <span className="dot" />{cur.label}<span className="pc-bcaret">▾</span>
      </button>
      {open && pos && createPortal(
        <div className="pc-statusmenu" style={{ left: pos.left, top: pos.top, minWidth: Math.max(pos.width, 184), transform: pos.flip ? 'translateY(-100%)' : 'none' }} onClick={e => e.stopPropagation()}>
          {STATUS_OPTIONS.map(s => (
            <button key={s.value} className={`pc-statusopt ${s.value === (value || DEFAULT_STATUS) ? 'active' : ''}`}
              onClick={() => { onChange(s.value); setOpen(false); }}>
              <span className={`pc-statusdot ${s.cls}`} />{s.label}
            </button>
          ))}
        </div>, document.body)}
    </>
  );
}

/* ════════════════════════════════════════════════════════════
   Creator expand — videos + ad codes
════════════════════════════════════════════════════════════ */
function CreatorExpand({ c, onEdit, onDelete, patchCreatorLocal }) {
  const committed = parseInt(c.videos_count, 10) || 0;
  const rowCount = Math.max(committed || 1, Array.isArray(c.video_codes) ? c.video_codes.length : 0, 1);
  const [codes, setCodes] = useState(() => {
    const existing = Array.isArray(c.video_codes) ? c.video_codes : [];
    return Array.from({ length: rowCount }, (_, i) => ({ video: existing[i]?.video || '', adCode: existing[i]?.adCode || '', auth: !!existing[i]?.auth }));
  });
  const [saveState, setSaveState] = useState('idle');
  const [copiedIdx, setCopiedIdx] = useState(-1);
  const debounce = useRef(null);
  const latest = useRef(codes);
  const dirty = useRef(false);
  const saving = useRef(false);
  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);

  // Re-sync from the source row when it changes underneath us (reload / external edit),
  // but never while the user has unsaved edits or a save is in flight.
  useEffect(() => {
    if (dirty.current || saving.current) return;
    const existing = Array.isArray(c.video_codes) ? c.video_codes : [];
    const rc = Math.max(committed || 1, existing.length, 1);
    const synced = Array.from({ length: rc }, (_, i) => ({ video: existing[i]?.video || '', adCode: existing[i]?.adCode || '', auth: !!existing[i]?.auth }));
    setCodes(synced);
    latest.current = synced;
  }, [c.video_codes]); // eslint-disable-line react-hooks/exhaustive-deps

  async function persist(next) {
    dirty.current = false;
    saving.current = true;
    setSaveState('saving');
    const patch = { video_codes: next };
    // once every video row has a URL: stamp completed-on date + advance Videos in Progress → Payment Pending
    const allFilled = next.length > 0 && next.every(r => (r.video || '').trim());
    if (allFilled) {
      if (c.payment_status === 'videos_in_progress') patch.payment_status = 'pending';
      if (!c.completed_on) patch.completed_on = todayISO();
    }
    patchCreatorLocal(c.id, patch);
    try { await store.updateCreator(c.id, patch); saving.current = false; setSaveState('saved'); setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 1800); }
    catch (e) { saving.current = false; setSaveState('idle'); alert(`Couldn't save: ${e.message}`); }
  }
  function change(idx, field, value) {
    dirty.current = true;
    setCodes(prev => {
      const next = prev.map((row, i) => (i === idx ? { ...row, [field]: value } : row));
      latest.current = next;
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => persist(next), 700);
      return next;
    });
  }
  function flush() { if (!dirty.current) return; if (debounce.current) { clearTimeout(debounce.current); debounce.current = null; } persist(latest.current); }
  // ad-code authorization toggle (manual) — persists immediately, no debounce
  function toggleAuth(idx) {
    dirty.current = true;
    setCodes(prev => {
      const next = prev.map((row, i) => (i === idx ? { ...row, auth: !row.auth } : row));
      latest.current = next;
      if (debounce.current) { clearTimeout(debounce.current); debounce.current = null; }
      persist(next);
      return next;
    });
  }

  const filledCount = codes.filter(v => isValidUrl(v.video)).length;
  const total = codes.length;
  const pct = total ? filledCount / total : 0;
  const complete = total > 0 && filledCount === total;
  const adCount = codes.filter(v => (v.adCode || '').trim()).length;
  const authCount = codes.filter(v => v.auth).length;
  const allAuth = adCount > 0 && authCount === adCount;
  const initials = (c.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
  const accounts = tiktokAccounts(c.tiktok_handle);
  const prodList = creatorProducts(c);
  const RING = 2 * Math.PI * 19; // ring circumference (r = 19)
  function copyCode(i, code) { copyText(code); setCopiedIdx(i); setTimeout(() => setCopiedIdx(x => (x === i ? -1 : x)), 1400); }
  return (
    <div className="pc-expand" onClick={e => e.stopPropagation()}>
      <div className="pc-vx">
        <div className="pc-vx-head">
          <div className="pc-vx-title">
            <span className="pc-vx-mono">{initials}</span>
            <div className="pc-vx-titletext">
              <div className="pc-vx-h">Videos &amp; Ad Codes</div>
              <div className="pc-vx-sub">{c.name}{accounts[0] ? <> · <span className="pc-vx-sub-h">{accounts[0].handle}</span></> : ''}</div>
            </div>
          </div>
          <div className="pc-vx-actions">
            <span className={`pc-savestate ${saveState === 'saved' ? 'saved' : ''}`}>{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Saved' : ''}</span>
            {adCount > 0 && (
              <span className={`pc-vx-authtally ${allAuth ? 'done' : ''}`} title="Ad codes authorised">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                {authCount}/{adCount} authorised
              </span>
            )}
            <div className={`pc-vx-ring ${complete ? 'full' : ''}`} role="img" aria-label={`${filledCount} of ${total} videos added`}>
              <svg viewBox="0 0 46 46" width="48" height="48">
                <circle className="pc-vx-ring-track" cx="23" cy="23" r="19" />
                <circle className="pc-vx-ring-fill" cx="23" cy="23" r="19" strokeDasharray={RING} strokeDashoffset={RING * (1 - pct)} transform="rotate(-90 23 23)" />
              </svg>
              <span className="pc-vx-ring-txt"><b>{filledCount}</b><i>/{total}</i></span>
            </div>
            <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={onEdit}>Edit</button>
            <button className="pc-link-danger" onClick={onDelete}>Delete</button>
          </div>
        </div>
        {prodList.length > 0 && (
          <div className="pc-vx-prods">
            <span className="pc-vx-prods-l">Promoting</span>
            {prodList.map((p, i) => (p.url
              ? <a key={i} className="pc-vx-prod" href={p.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} title={p.url}><span className="pc-vx-prod-dot" />{p.name || 'Product'}<span className="pc-vx-prod-go">↗</span></a>
              : <span key={i} className="pc-vx-prod" title={p.name}><span className="pc-vx-prod-dot" />{p.name}</span>))}
          </div>
        )}
        <div className="pc-vx-collabels">
          <span />
          <span>Video</span>
          <span>Ad code</span>
          <span className="pc-vx-cl-auth">Authorised</span>
          <span />
        </div>
        <div className="pc-vx-list">
          {codes.map((row, i) => {
            const vOk = isValidUrl(row.video);
            return (
              <div className={`pc-vx-row ${vOk ? 'done' : ''}`} key={i}>
                <span className="pc-vx-num">{vOk
                  ? <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  : i + 1}</span>
                <label className={`pc-vx-inp ${row.video && !vOk ? 'bad' : ''}`}>
                  <span className="pc-vx-inp-ico"><svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11"><path d="M8 5v14l11-7z" /></svg></span>
                  <input placeholder="Paste TikTok video URL" value={row.video} onChange={e => change(i, 'video', e.target.value)} onBlur={flush} />
                </label>
                <label className={`pc-vx-inp pc-vx-inp-ad ${row.adCode && !isValidAdCode(row.adCode) ? 'bad' : ''}`}>
                  <span className="pc-vx-inp-ico">#</span>
                  <input placeholder="ad code" value={row.adCode} onChange={e => change(i, 'adCode', e.target.value)} onBlur={flush} />
                  {row.adCode ? (
                    <button type="button" className={`pc-vx-copy ${copiedIdx === i ? 'ok' : ''}`} title="Copy ad code" onClick={e => { e.preventDefault(); copyCode(i, row.adCode); }}>
                      {copiedIdx === i
                        ? <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                        : <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>}
                    </button>
                  ) : null}
                </label>
                <button type="button" className={`pc-vx-auth ${row.auth ? 'on' : ''}`} role="checkbox" aria-checked={row.auth}
                  title={row.auth ? 'Ad code authorised — click to unmark' : 'Mark ad code authorised'} onClick={() => toggleAuth(i)}>
                  {row.auth && <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                </button>
                <a className="pc-vx-open" href={vOk ? row.video : undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!vOk} title="Open video">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M9 7h8v8" /></svg>
                </a>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Brand editor (create/edit brand + month budget + links)
════════════════════════════════════════════════════════════ */
function BrandEditor({ editor, month, bm, assignableBrands = [], onClose, onSave }) {
  const isAdd = editor.mode === 'add';
  const [pickId, setPickId] = useState('');
  const [budget, setBudget] = useState(bm.budget != null ? String(bm.budget || '') : '');
  const [guide, setGuide] = useState(bm.content_guide_url || '');
  const [products, setProducts] = useState(() => { const r = focusProductList(bm); return r.length ? r : [{ name: '', url: '' }]; });

  function save() {
    if (isAdd && !pickId) return;
    const list = products.map(p => ({ name: (p.name || '').trim(), url: (p.url || '').trim() })).filter(p => p.url || p.name);
    onSave({
      brand_id: isAdd ? pickId : editor.brand.id,
      budget: budget === '' ? 0 : Number(budget) || 0,
      content_guide_url: guide.trim(),
      focus_product_url: list.length ? JSON.stringify(list) : '',
    });
  }
  return (
    <div className="pc-overlay" onClick={onClose}>
      <div className="pc-modal" onClick={e => e.stopPropagation()}>
        <h3>{isAdd ? 'Add brand to this month' : `${editor.brand.name}`}</h3>
        <div className="pc-modal-sub">{monthLabel(month)} · budget & links</div>
        {isAdd && (
          <div className="pc-field">
            <label>Brand</label>
            {assignableBrands.length === 0 ? (
              <div className="pc-modal-sub" style={{ marginTop: 4 }}>All your assigned brands are already in this month. Brands are assigned to you by your manager.</div>
            ) : (
              <select className="pc-input" value={pickId} onChange={e => setPickId(e.target.value)} autoFocus>
                <option value="">-- Pick an assigned brand --</option>
                {assignableBrands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
          </div>
        )}
        <div className="pc-field"><label>Budget ($)</label>
          <input className="pc-input" type="number" inputMode="numeric" placeholder="e.g. 2000" value={budget} onChange={e => setBudget(e.target.value)} autoFocus={!isAdd} /></div>
        <div className="pc-field"><label>Content guide link</label><input className="pc-input" placeholder="https://…" value={guide} onChange={e => setGuide(e.target.value)} /></div>
        <div className="pc-field">
          <label>Focus product(s)</label>
          {products.map((p, i) => (
            <div className="pc-prodrow" key={i}>
              <input className="pc-input pc-prod-name" placeholder="Product name" value={p.name}
                onChange={e => setProducts(prev => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input className="pc-input" placeholder="https://…  (TikTok product link)" value={p.url}
                onChange={e => setProducts(prev => prev.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              {products.length > 1 && <button type="button" className="pc-multix" title="Remove"
                onClick={() => setProducts(prev => prev.filter((_, j) => j !== i))}>×</button>}
            </div>
          ))}
          <button type="button" className="pc-btn pc-btn-ghost pc-btn-sm" style={{ marginTop: 2 }}
            onClick={() => setProducts(prev => [...prev, { name: '', url: '' }])}>+ Add another product</button>
        </div>
        <div className="pc-modal-actions">
          <button className="pc-btn pc-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="pc-btn pc-btn-primary" onClick={save} disabled={isAdd && !pickId}>Save</button>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Creator editor (add/edit a deal)
════════════════════════════════════════════════════════════ */
function CreatorEditor({ editor, month, directory = [], categories = [], brandProducts = [], onClose, onSave }) {
  const c = editor.creator || {};
  const isAdd = editor.mode === 'add';
  const [f, setF] = useState({
    name: c.name || '',
    phone: c.phone || '', email: c.email || '', category: c.category || '',
    amount: c.amount != null ? String(c.amount || '') : '', videos_count: c.videos_count != null ? String(c.videos_count || '') : '',
    paypal: c.paypal || '', zelle: c.zelle || '',
    onboarded_on: c.onboarded_on || defaultDateForMonth(month),
  });
  const [tiktoks, setTiktoks] = useState(() => {
    const arr = String(c.tiktok_handle || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    return arr.length ? arr : [''];
  });
  // product(s) the creator promotes — prefill existing; on add with exactly one brand product, default-select it
  const [prods, setProds] = useState(() => {
    const existing = creatorProducts(c);
    if (existing.length) return existing;
    if (isAdd && brandProducts.length === 1) return [{ name: brandProducts[0].name || '', url: brandProducts[0].url || '' }];
    return [];
  });
  const [prodInput, setProdInput] = useState('');
  const hasProd = p => prods.some(x => prodKey(x) === prodKey(p));
  const toggleProd = p => setProds(prev => prev.some(x => prodKey(x) === prodKey(p)) ? prev.filter(x => prodKey(x) !== prodKey(p)) : [...prev, { name: p.name || '', url: p.url || '' }]);
  const removeProd = idx => setProds(prev => prev.filter((_, j) => j !== idx));
  function addCustomProd() {
    const name = prodInput.trim();
    if (!name) return;
    if (!prods.some(x => (x.name || '').toLowerCase().trim() === name.toLowerCase())) {
      const match = brandProducts.find(bp => (bp.name || '').toLowerCase().trim() === name.toLowerCase());
      setProds(prev => [...prev, { name, url: match?.url || '' }]);
    }
    setProdInput('');
  }
  const pickableProducts = brandProducts.filter(p => !hasProd(p));
  const [showSug, setShowSug] = useState(false);
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  const matches = useMemo(() => {
    const q = f.name.trim().toLowerCase();
    if (!q) return [];
    return directory.filter(d => d.name.toLowerCase().includes(q) && d.name.toLowerCase() !== q).slice(0, 6);
  }, [f.name, directory]);
  function pick(d) {
    setF(prev => ({ ...prev, name: d.name, paypal: d.paypal || prev.paypal, zelle: d.zelle || prev.zelle, phone: d.phone || prev.phone, email: d.email || prev.email, category: d.category || prev.category }));
    const arr = String(d.tiktok_handle || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    setTiktoks(arr.length ? arr : ['']);
    setShowSug(false);
  }
  function save() {
    if (!f.name.trim()) return;
    const tiktok_handle = tiktoks.map(s => s.trim()).filter(Boolean).join('\n');
    const products = prods.map(p => ({ name: (p.name || '').trim(), url: (p.url || '').trim() })).filter(p => p.name || p.url);
    onSave({ ...(isAdd ? { brand_id: editor.brandId } : { id: c.id }), ...f, tiktok_handle, products });
  }
  return (
    <div className="pc-overlay" onClick={onClose}>
      <div className="pc-modal pc-modal-scroll" onClick={e => e.stopPropagation()}>
        <h3>{isAdd ? 'Onboard creator' : 'Edit creator'}</h3>
        <div className="pc-modal-sub">{monthLabel(monthKey(f.onboarded_on) || month)}</div>
        <div className="pc-modal-body">
        <div className="pc-field" style={{ position: 'relative' }}>
          <label>Name</label>
          <input className="pc-input" placeholder="Creator name" value={f.name} autoFocus
            onChange={e => { set('name', e.target.value); setShowSug(true); }}
            onFocus={() => setShowSug(true)}
            onBlur={() => setTimeout(() => setShowSug(false), 150)} />
          {isAdd && showSug && matches.length > 0 && (
            <div className="pc-suggest">
              <div className="pc-suggest-head">Already worked with — tap to auto-fill</div>
              {matches.map((d, i) => (
                <button type="button" key={i} className="pc-suggest-item" onClick={() => pick(d)}>
                  <span className="pc-suggest-name">{d.name}</span>
                  <span className="pc-suggest-meta">{tiktokAccounts(d.tiktok_handle).map(a => a.handle).join(' · ') || (d.paypal || d.zelle || '—')}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="pc-field">
          <label>TikTok account(s)</label>
          {tiktoks.map((t, i) => (
            <div className="pc-multirow" key={i}>
              <input className="pc-input" placeholder="@handle or URL" value={t}
                onChange={e => setTiktoks(prev => prev.map((x, j) => (j === i ? e.target.value : x)))} />
              {tiktoks.length > 1 && <button type="button" className="pc-multix" title="Remove"
                onClick={() => setTiktoks(prev => prev.filter((_, j) => j !== i))}>×</button>}
            </div>
          ))}
          <button type="button" className="pc-btn pc-btn-ghost pc-btn-sm" style={{ marginTop: 2 }}
            onClick={() => setTiktoks(prev => [...prev, ''])}>+ Add another account</button>
        </div>
        <div className="pc-field2">
          <div className="pc-field"><label>Number</label><input className="pc-input" placeholder="phone" value={f.phone} onChange={e => set('phone', e.target.value)} /></div>
          <div className="pc-field"><label>Email</label><input className="pc-input" placeholder="email" value={f.email} onChange={e => set('email', e.target.value)} /></div>
        </div>
        <div className="pc-field"><label>Category</label>
          <input className="pc-input" list="pc-catlist" placeholder="e.g. Beauty · Tech · Fitness" value={f.category} onChange={e => set('category', e.target.value)} />
          <datalist id="pc-catlist">{categories.map(cat => <option key={cat} value={cat} />)}</datalist>
        </div>
        <div className="pc-field">
          <label>Promoting product{prods.length === 1 ? '' : '(s)'}</label>
          <div className="pc-prodbox">
            {prods.length > 0 && (
              <div className="pc-prodchips">
                {prods.map((p, i) => (
                  <span className="pc-prodchip sel" key={i} title={p.url || p.name}>
                    <span className="pc-prodchip-dot" />
                    <span className="pc-prodchip-name">{p.name || p.url}</span>
                    <button type="button" className="pc-prodchip-x" onClick={() => removeProd(i)} title="Remove">×</button>
                  </span>
                ))}
              </div>
            )}
            {pickableProducts.length > 0 && (
              <div className="pc-prodpick">
                <span className="pc-prodpick-l">From this brand</span>
                <div className="pc-prodchips">
                  {pickableProducts.map((p, i) => (
                    <button type="button" className="pc-prodchip add" key={i} onClick={() => toggleProd(p)} title={p.url || p.name}>+ {p.name || p.url}</button>
                  ))}
                </div>
              </div>
            )}
            <div className="pc-multirow">
              <input className="pc-input" placeholder="Product name" value={prodInput}
                onChange={e => setProdInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomProd(); } }} />
              <button type="button" className="pc-prodadd" onClick={addCustomProd} title="Add product" disabled={!prodInput.trim()}>+</button>
            </div>
          </div>
        </div>
        <div className="pc-field2">
          <div className="pc-field"><label>Amount ($)</label><input className="pc-input" type="number" inputMode="numeric" placeholder="200" value={f.amount} onChange={e => set('amount', e.target.value)} /></div>
          <div className="pc-field"><label>Videos</label><input className="pc-input" type="number" inputMode="numeric" placeholder="5" value={f.videos_count} onChange={e => set('videos_count', e.target.value)} /></div>
        </div>
        <div className="pc-field"><label>Onboarded on</label><input className="pc-input" type="date" value={f.onboarded_on} onChange={e => set('onboarded_on', e.target.value)} /></div>
        <div className="pc-field2">
          <div className="pc-field"><label>PayPal</label><input className="pc-input" placeholder="email" value={f.paypal} onChange={e => set('paypal', e.target.value)} /></div>
          <div className="pc-field"><label>Zelle</label><input className="pc-input" placeholder="email / phone" value={f.zelle} onChange={e => set('zelle', e.target.value)} /></div>
        </div>
        </div>
        <div className="pc-modal-actions">
          <button className="pc-btn pc-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="pc-btn pc-btn-primary" onClick={save} disabled={!f.name.trim()}>{isAdd ? 'Add' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
