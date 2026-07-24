// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  ResponsiveContainer, PieChart, Pie, Cell, LabelList,
} from 'recharts';
import { supabase } from '../../lib/supabase';
import { uploadSignature, svgToPngDataUrl } from '../../lib/imageUpload';
import { currencySymbol, setReportCurrency } from '../../lib/currency';
import * as store from './store';
import { useAuth } from '../../auth/AuthContext';
import { PayChip, PayoutDetail } from '../paid-collab/handlerCollabReadonly';
import PaidCollabComments from '../../components/paidcollab/PaidCollabComments';
import NotesBoard, { BrandNotesDrawer, CreatorNotesDrawer, AllNotesDrawer, NoteEditor } from './NotesBoard';
import ContentBriefView from './ai-brief/ContentBriefView';
import { useDraggableFab } from '../../components/AdsNotesFab';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import './handlerCollab.css';

const storeMode = 'supabase';

/* ════════════════════════════════════════════════════════════
   PAID COLLABORATIONS — standalone CRUD dashboard (/collabs)
   Its OWN project: own Supabase (or localStorage), own tables.
   Fully isolated from the creatorsxbrands app.
════════════════════════════════════════════════════════════ */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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
// Whole-number money in the active currency. Single-brand views set the symbol
// once per render via setReportCurrency(brand.currency); multi-brand views set
// the "uniform" currency (or pass an explicit `code`). See lib/currency.ts.
function fmt$(n, code) { return `${currencySymbol(code)}${Math.round(n || 0).toLocaleString()}`; }
function fmtNum(n) { return Math.round(n || 0).toLocaleString(); }
// The shared currency for a set of brands: their common one if uniform, else USD
// (mixing region currencies in one total is meaningless, so fall back to $).
function uniformCurrency(brands) {
  const codes = new Set((brands || []).map(b => (b && b.currency) || 'USD'));
  return codes.size === 1 ? [...codes][0] : 'USD';
}
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

/* ── week date helpers (all YYYY-MM-DD strings, local-time) ── */
function isoDate(x) {
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
function addDaysISO(key, n) { const d = new Date(key + 'T00:00:00'); d.setDate(d.getDate() + n); return isoDate(d); }
// Compact range for a header: "Jun 9–15" (same month) or "Jun 29 – Jul 5".
function rangeShort(startISO, endISO) {
  const s = new Date(startISO + 'T00:00:00'), e = new Date(endISO + 'T00:00:00');
  const sMon = s.toLocaleDateString('en-US', { month: 'short' });
  const eMon = e.toLocaleDateString('en-US', { month: 'short' });
  return sMon === eMon ? `${sMon} ${s.getDate()}–${e.getDate()}` : `${sMon} ${s.getDate()} – ${eMon} ${e.getDate()}`;
}
// Full range for the tooltip: "Jun 9 – Jun 15".
function rangeLong(startISO, endISO) {
  const f = (k) => new Date(k + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${f(startISO)} – ${f(endISO)}`;
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
// Status flow: starts at "Follow-up Required" (zero posted videos) → auto "Videos in
// Progress" when the first video lands → back to "Follow-up Required" if no new video
// for 1 week (server sweep) → auto "Payment Pending" once all videos are added →
// user marks "Paid" from the inline dropdown after sending payment. The zero-video /
// first-video / stall rules live in the DB (trigger + handler_collab_apply_follow_ups).
const STATUS_OPTIONS = [
  { value: 'videos_in_progress', label: 'Videos in Progress', cls: 'progress' },
  { value: 'follow_up', label: 'Follow-up Required', cls: 'followup' },
  { value: 'pending', label: 'Payment Pending', cls: 'pending' },
  { value: 'paid', label: 'Payment Sent', cls: 'sent' },
];
const DEFAULT_STATUS = 'videos_in_progress';
function deriveStatus(c) {
  return STATUS_OPTIONS.find(s => s.value === c.payment_status) || STATUS_OPTIONS[0];
}
// Drilldown groups creators by payment status in this top→bottom order.
const STATUS_GROUP_ORDER = ['pending', 'follow_up', 'videos_in_progress', 'paid'];
function focusProductList(bm) {
  const raw = bm?.focus_product_url || '';
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map(p => (typeof p === 'string' ? { name: '', url: p } : { name: p.name || '', url: p.url || '' })).filter(p => p.url || p.name);
  } catch { }
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
function scrollTop() { try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { } }
function copyText(t) {
  try { if (navigator.clipboard?.writeText) { navigator.clipboard.writeText(t); return; } } catch { }
  try { const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); } catch { }
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
    try { document.body.style.background = '#FAFAFA'; } catch { }
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
  // Lightweight notes list (own Keep-style notes) — only used for the Notes tab's
  // due-reminder badge; the full board manages its own copy in NotesBoard.
  const [notes, setNotes] = useState([]);
  // Contract signing links (one per creator deal) — drives the Contract column's
  // signing-link button state (none / active / deactivated / signed).
  const [contractLinks, setContractLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const { user, profile } = useAuth();
  // AI Content Brief access — granted per handler by the Super Boss
  // (profiles.ai_brief_enabled, migration 20260826090000). Mirrors the
  // can_use_ai_brief() DB helper, which is the authority for any write.
  const canUseAiBrief = !!profile && (
    (profile.role === 'paid_collab_handler' && !!profile.ai_brief_enabled)
    || (profile.role === 'bob' && !!profile.is_superbob)
  );

  const [month, setMonth] = useState(initialMonth || thisMonthKey());
  const [tab, setTab] = useState('brands'); // brands | creators | reporting
  // Per-brand weekly-report weeks (brand_id -> [{ start, end }]). The weekly
  // Performance view shows exactly these weeks as columns.
  const [reportWeeks, setReportWeeks] = useState({});
  // Per-brand weekly anchor (brand_id -> week-1 start date) for the "create next
  // weekly report" flow.
  const [reportAnchors, setReportAnchors] = useState({});
  // Paid-collab comments + the discussion drawer ({brandId, tt, tk, highlight}|null).
  const [comments, setComments] = useState([]);
  const [commentDrawer, setCommentDrawer] = useState(null);
  // Activity log (Logs tab) — brand-scoped audit rows (status changes, payments,
  // client confirmations, creator add/remove) shared by every handler of the brand.
  const [logs, setLogs] = useState([]);

  // Custom brand ordering (drag-and-drop), persisted per handler in the database
  // (handler_collab_brand_order) so it follows the account across devices. It's a saved
  // sequence of brand ids; the brand list sorts by it (unordered fall to the bottom in the
  // default order). Reordering merges the moved subset back, keeping brands not currently
  // visible in their existing slots. Loaded in reload().
  const [brandOrder, setBrandOrder] = useState([]);
  const reorderBrands = useCallback((newVisibleIds) => {
    setBrandOrder(prev => {
      const visible = new Set(newVisibleIds);
      const base = prev.slice();
      newVisibleIds.forEach(id => { if (!base.includes(id)) base.push(id); });
      let i = 0;
      const merged = base.map(id => (visible.has(id) ? newVisibleIds[i++] : id));
      if (user?.id) store.saveBrandOrder(user.id, merged).catch(e => console.warn('Save brand order failed', e));
      return merged;
    });
  }, [user]);
  const [drillId, setDrillId] = useState(initialBrandId || null);
  const [search, setSearch] = useState('');
  const [brandEditor, setBrandEditor] = useState(null);   // { mode:'add'|'edit', brand? }
  const [creatorEditor, setCreatorEditor] = useState(null); // { mode, brandId, creator? }
  const [notesBrand, setNotesBrand] = useState(null);     // { id, name } — quick month note drawer
  const [keepBrand, setKeepBrand] = useState(null);       // { id, name } — Keep-notes list drawer
  const [keepCreator, setKeepCreator] = useState(null);   // { id, key, name, handle, brandId, brandName } — creator Keep-notes drawer
  const [allNotesOpen, setAllNotesOpen] = useState(false); // global notes drawer (floating button)
  const notesFabDrag = useDraggableFab('ac_fab_pos_notes'); // drag-to-place the floating notes button
  const [openNote, setOpenNote] = useState(null);          // a single note opened directly (deep link)
  const [pendingNoteId, setPendingNoteId] = useState(null); // ?note=<id> waiting for notes to load
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
    for (const u of updates) { try { await store.updateCreator(u.id, u.patch); } catch { } }
  }, []);

  const reload = useCallback(async () => {
    try {
      const data = await store.loadAll();
      const allClients = await store.getClients().catch(() => []);
      setBrands(data.brands); setBrandMonths(data.brandMonths); setCreators(data.creators);
      setClients(allClients);
      setErr('');
      reconcileShared(data.creators);
      // Saved drag order (per handler, cross-device). Keep current order on a fetch error.
      const order = await store.loadBrandOrder().catch(() => null);
      if (order) setBrandOrder(order);
      // Per-brand weekly-report weeks + anchors (for the weekly Performance view). Best-effort.
      const ids = data.brands.map(b => b.id);
      const rw = await store.loadBrandReportWeeks(ids).catch(() => null);
      if (rw) setReportWeeks(rw);
      const an = await store.loadBrandReportAnchors(ids).catch(() => null);
      if (an) setReportAnchors(an);
      const cm = await store.loadComments(ids).catch(() => null);
      if (cm) setComments(cm);
      const lg = await store.loadActivityLogs(ids).catch(() => null);
      if (lg) setLogs(lg);
      const cl = await store.loadContractLinks(ids).catch(() => null);
      if (cl) setContractLinks(cl);
      const nts = await store.loadNotes().catch(() => null);
      if (nts) setNotes(nts);
    } catch (e) {
      setErr(e.message || 'Failed to load');
    }
  }, [reconcileShared]);

  useEffect(() => { (async () => { setLoading(true); await reload(); setLoading(false); })(); }, [reload]);

  // Fire due note reminders workspace-wide (any tab): converts due reminders into
  // notifications (in-app + browser via NotificationsContext). Runs on load + every
  // minute; reloads so badges/counts refresh when something fired.
  useEffect(() => {
    const tick = () => { store.fireDueNoteReminders().then(c => { if (c > 0) reload(); }).catch(() => { }); };
    tick();
    const iv = setInterval(tick, 60000);
    return () => clearInterval(iv);
  }, [reload]);

  /* lookups */
  const brandById = useMemo(() => { const m = {}; brands.forEach(b => { m[b.id] = b; }); return m; }, [brands]);
  const bmByKey = useMemo(() => { const m = {}; brandMonths.forEach(x => { m[`${x.brand_id}|${x.month}`] = x; }); return m; }, [brandMonths]);
  // Due reminders (overdue, not dismissed/archived) → Notes tab badge.
  const dueReminderCount = useMemo(() => {
    const now = Date.now();
    return notes.filter(n => n.reminder_at && !n.reminder_done && !n.archived && new Date(n.reminder_at).getTime() <= now).length;
  }, [notes]);
  // Per-brand Keep-note counts (for the brand-row notes indicator).
  const noteCountByBrand = useMemo(() => {
    const m = {};
    notes.forEach(n => { if (n.brand_id && !n.archived) m[n.brand_id] = (m[n.brand_id] || 0) + 1; });
    return m;
  }, [notes]);
  // Per-creator Keep-note counts (for the journal icon next to a creator's name).
  // A note links ONE deal row, but the icon aggregates by creator identity within
  // the brand (store.creatorNoteKey), so notes follow the creator across months.
  const creatorNoteKeyById = useMemo(() => {
    const m = {};
    creators.forEach(c => { m[c.id] = store.creatorNoteKey(c); });
    return m;
  }, [creators]);
  const noteCountByCreatorKey = useMemo(() => {
    const m = {};
    notes.forEach(n => {
      if (n.archived || !n.creator_id) return;
      const k = creatorNoteKeyById[n.creator_id];
      if (k) m[k] = (m[k] || 0) + 1;
    });
    return m;
  }, [notes, creatorNoteKeyById]);
  const creatorNoteCount = useCallback(
    (c) => noteCountByCreatorKey[creatorNoteKeyById[c.id]] || 0,
    [noteCountByCreatorKey, creatorNoteKeyById]);
  const openCreatorNotes = useCallback((c) => setKeepCreator({
    id: c.id, key: creatorNoteKeyById[c.id] || store.creatorNoteKey(c),
    name: c.name, handle: tiktokAccounts(c.tiktok_handle)[0]?.handle || '',
    brandId: c.brand_id, brandName: brandById[c.brand_id]?.name || '',
  }), [creatorNoteKeyById, brandById]);

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'handler_notes' }, ping)
      .subscribe();
    return () => { clearTimeout(t); try { supabase.removeChannel(ch); } catch { } };
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
    // Custom drag order first (brands present in brandOrder, in that sequence); the rest
    // fall to the bottom in the default allocated-desc order.
    const oIdx = (id) => { const i = brandOrder.indexOf(id); return i === -1 ? Infinity : i; };
    rows.sort((x, y) => {
      const ox = oIdx(x.id), oy = oIdx(y.id);
      if (ox !== oy) return ox - oy;
      return y.allocated - x.allocated || x.brand.localeCompare(y.brand);
    });
    return rows;
  }, [brands, creators, bmByKey, month, search, brandOrder]);

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
    .map(c => ({ ...c, _brandName: brandById[c.brand_id]?.name || '—', _brandCurrency: brandById[c.brand_id]?.currency || 'USD', _monthKey: monthKey(c.onboarded_on) }))
    // month groups newest-first; within a month, most-recently-onboarded on top (then newest record), not alphabetical
    .sort((a, b) => String(b._monthKey).localeCompare(String(a._monthKey))
      || String(b.onboarded_on || '').localeCompare(String(a.onboarded_on || ''))
      || String(b.created_at || '').localeCompare(String(a.created_at || ''))),
    [creators, brandById]);

  const drillRow = brandRows.find(r => r.id === drillId) || null;
  const drillBrand = brandById[drillId] || null;
  // Money symbol for this render: the drilled-in brand's currency, else the
  // handler's uniform currency (multi-brand overview/aggregate tabs). Sub-views
  // that pick their own brand internally (BrandMatrix, ReportingView, PerfBrandList)
  // re-set this at their own render.
  setReportCurrency(drillId && drillBrand ? drillBrand.currency : uniformCurrency(brands));
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
      if (Object.keys(patch).length) { try { await store.updateCreator(s.id, patch); } catch { } }
    }
  }
  async function saveCreator(mode, data) {
    try {
      let savedId = data.id;
      if (mode === 'add') { const row = await store.addCreator(data); savedId = row?.id; }
      else {
        const newCount = parseInt(data.videos_count, 10) || 0;
        const patch = {
          name: data.name, tiktok_handle: data.tiktok_handle, amount: Number(data.amount) || 0,
          videos_count: newCount, zelle: data.zelle, paypal: data.paypal,
          phone: data.phone, email: data.email, category: data.category,
          onboarded_on: data.onboarded_on,
          // contract_url is legacy (manually pasted links, pre e-signing) — the
          // editor no longer touches it, so it is deliberately left untouched here.
          // blank = automatic deadline rule in the contract PDF
          deliverable_days: data.deliverable_days ? parseInt(data.deliverable_days, 10) || null : null,
          products: Array.isArray(data.products) ? data.products : [],
        };
        // lowering the video count drops the extra video-link / ad-code rows
        const existing = creators.find(x => x.id === data.id);
        if (existing && Array.isArray(existing.video_codes) && newCount < existing.video_codes.length) {
          patch.video_codes = existing.video_codes.slice(0, newCount);
        }
        await store.updateCreator(data.id, patch);
      }
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
  // Contract signing links, keyed by creator, + a local patch so the row button
  // updates the moment the modal creates / toggles / records a signature.
  const contractLinkByCreator = useMemo(() => {
    const m = {};
    contractLinks.forEach(l => { m[l.creator_id] = l; });
    return m;
  }, [contractLinks]);
  const contractLinkFor = useCallback((c) => contractLinkByCreator[c.id] || null, [contractLinkByCreator]);
  const onContractLinkChange = useCallback((row) => {
    if (!row) return;
    setContractLinks(prev => (prev.some(l => l.id === row.id)
      ? prev.map(l => (l.id === row.id ? { ...l, ...row } : l))
      : [...prev, row]));
  }, []);

  const patchCreatorLocal = useCallback((id, patch) => {
    setCreators(prev => prev.map(c => (c.id === id ? { ...c, ...patch } : c)));
  }, []);
  // per-creator monthly GMV / Ad Spent (Performance tab) — optimistic + persist
  const saveCreatorMonthly = useCallback((id, monthly) => {
    patchCreatorLocal(id, { monthly });
    store.updateCreator(id, { monthly }).catch(() => reload());
  }, [patchCreatorLocal, reload]);

  // Create the next weekly report for a brand (mirrors the APC/Bob flow). The next
  // week auto-continues from the brand's anchor + existing reports; on the very
  // first report `firstAnchor` (a date) seeds the brand's weekly anchor. After
  // creating, jump the workspace to that week's month so the new column shows.
  const createWeeklyReport = useCallback(async (brandId, firstAnchor) => {
    if (!user?.id) return;
    const existingArr = (reportWeeks[brandId] || []).map(w => w.start);
    const existing = new Set(existingArr);
    let anchor = reportAnchors[brandId]
      || (existingArr.length ? existingArr.slice().sort()[0] : null)
      || firstAnchor || null;
    if (!anchor) { alert('Pick an anchor (week-1 start) date first.'); return; }
    // First report ever → persist the anchor so the brand's weekly reports use it too.
    if (firstAnchor && !reportAnchors[brandId] && existingArr.length === 0) {
      try { await store.setBrandWeeklyAnchor(brandId, firstAnchor); }
      catch (e) { alert(`Couldn't set anchor: ${e.message}`); return; }
      setReportAnchors(prev => ({ ...prev, [brandId]: firstAnchor }));
      anchor = firstAnchor;
    }
    // Walk from the anchor to the first un-created week (fills gaps), like AfflixCore.
    let start = anchor, wn = 1;
    while (existing.has(start)) { start = addDaysISO(start, 7); wn++; }
    const end = addDaysISO(start, 6);
    try { await store.createWeeklyReport(brandId, user.id, start, end, wn); }
    catch (e) { alert(`Couldn't create weekly report: ${e.message}`); return; }
    await reload();
    setMonth(start.slice(0, 7));
  }, [reportWeeks, reportAnchors, user, reload]);

  // Post a comment as the signed-in handler (optimistic).
  const handlerName = profile?.full_name || profile?.email || user?.email || 'Handler';
  const addPaidComment = useCallback(async (brandId, tt, tk, body, authorName, parentId) => {
    if (!user?.id) throw new Error('Not signed in');
    const row = await store.addComment({
      brandId, targetType: tt, targetKey: tk || '', authorId: user.id,
      authorType: profile?.role === 'bob' ? 'bob' : profile?.role === 'apc' ? 'apc' : 'handler',
      authorName: authorName || handlerName, body, parentId: parentId || null,
    });
    setComments(prev => [...prev, row]);
  }, [user, profile, handlerName]);
  const openComments = useCallback((brandId, tt = 'brand', tk = '', highlight = null) =>
    setCommentDrawer({ brandId, tt, tk, highlight }), []);
  // Threads whose latest message is from the client → the handler still owes a reply.
  const needsReplyCount = useMemo(() => {
    const last = {};
    comments.forEach(c => { const k = `${c.brand_id}|${c.target_type}|${c.target_key}`; if (!last[k] || c.created_at > last[k].created_at) last[k] = c; });
    return Object.values(last).filter((c) => c.author_type === 'client').length;
  }, [comments]);

  // Notification click-through:
  //  • /paid-collab?brand=&pay=1[&month=]  → open the brand's workspace drilldown
  //    (client "marked paid" — handler cross-checks + updates status here)
  //  • /paid-collab?brand=&tt=&tk=&pcc=    → open the discussion thread drawer
  const deepLinked = useRef(false);
  useEffect(() => {
    if (loading || deepLinked.current) return;
    deepLinked.current = true;
    const sp = new URLSearchParams(window.location.search);
    const noteId = sp.get('note');
    if (noteId) setPendingNoteId(noteId); // opened once the notes list is in state
    const b = sp.get('brand');
    if (!b) return;
    if (sp.get('pay') === '1') {
      const m = sp.get('month');
      if (m && /^\d{4}-\d{2}$/.test(m)) setMonth(m);
      setTab('brands');
      setDrillId(b);
      scrollTop();
    } else {
      setCommentDrawer({ brandId: b, tt: sp.get('tt') || 'brand', tk: sp.get('tk') || '', highlight: sp.get('pcc') || null });
    }
  }, [loading]);

  // Open the note from a ?note=<id> deep link (e.g. a reminder notification) once
  // the notes list has loaded; if it's missing locally, fetch it directly.
  useEffect(() => {
    if (!pendingNoteId) return;
    const local = notes.find(n => n.id === pendingNoteId);
    if (local) { setOpenNote(local); setPendingNoteId(null); return; }
    let cancelled = false;
    store.loadNotes()
      .then(list => { if (cancelled) return; const n = (list || []).find(x => x.id === pendingNoteId); if (n) setOpenNote(n); })
      .finally(() => { if (!cancelled) setPendingNoteId(null); });
    return () => { cancelled = true; };
  }, [pendingNoteId, notes]);

  // Persist / delete for a directly-opened note (deep link), kept in sync with the workspace.
  const persistOpenNote = useCallback(async (payload) => {
    const { id, ...rest } = payload;
    if (id) { try { await store.updateNote(id, rest); } catch (e) { setErr(e.message || 'Save failed'); } reload(); return id; }
    try { const row = await store.createNote(rest); reload(); return row.id; }
    catch (e) { setErr(e.message || 'Save failed'); return null; }
  }, [reload]);
  const deleteOpenNote = useCallback(async (n) => {
    if (!window.confirm('Delete this note?')) return;
    try { await store.deleteNote(n.id); } catch { }
    setOpenNote(null); reload();
  }, [reload]);
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
  // Contract template modal (representative name + signature for the PDFs)
  const [contractTplOpen, setContractTplOpen] = useState(false);

  return (
    <div className="pc-app">
      <div className="pc-shell">
        <header className="pc-header">
          <div className="pc-brand">
            <span className="pc-brand-logo"><img src="/afflix-logo-dark.png" alt="Afflix Media" /></span>
            <span className="pc-brand-tagline">Paid Collaborations</span>
          </div>
          <div className="pc-monthnav">
            <button className="pc-mn-arrow pc-tpl-btn" title="Contract template — your representative name & signature on contract PDFs"
              aria-label="Contract template settings" onClick={() => setContractTplOpen(true)}>
              <i className="bi bi-vector-pen" />
            </button>
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
          {[{ id: 'brands', label: 'Brands' }, { id: 'creators', label: 'Creators' }, { id: 'performance', label: 'Performance' }, { id: 'reporting', label: 'Internal Reporting' }, { id: 'discussions', label: 'Discussions' }, { id: 'logs', label: 'Logs' }, { id: 'notes', label: 'Notes' },
            // AI Content Brief — only for handlers the Super Boss granted access
            // (profiles.ai_brief_enabled, migration 20260826090000). Super Boss
            // sees it too so he can check the feature himself.
            ...(canUseAiBrief ? [{ id: 'brief', label: 'AI Content Brief' }] : []),
          ].map(t => (
            <button key={t.id} className={`pc-tab ${tab === t.id ? 'active' : ''}`} onClick={() => { setTab(t.id); setDrillId(null); }}>
              {t.label}
              {t.id === 'discussions' && needsReplyCount > 0 && <span className="pc-tab-badge">{needsReplyCount}</span>}
              {t.id === 'notes' && dueReminderCount > 0 && <span className="pc-tab-badge">{dueReminderCount}</span>}
            </button>
          ))}
        </div>

        {loading ? <div className="pc-spinner" /> : (
          tab === 'creators' ? (
            <CreatorsView rows={allCreatorsList}
              onEdit={(c) => setCreatorEditor({ mode: 'edit', brandId: c.brand_id, creator: c })}
              onSetStatus={setCreatorStatus} onToggleVisible={setCreatorPendingVisible}
              contractLinkFor={contractLinkFor} onContractLinkChange={onContractLinkChange}
              creatorNoteCount={creatorNoteCount} onCreatorNotes={openCreatorNotes} />
          ) : tab === 'performance' ? (
            <PerformanceView brands={brands} creators={creators} brandById={brandById} month={month} reportWeeks={reportWeeks} reportAnchors={reportAnchors} onCreateWeek={createWeeklyReport} onSaveMonthly={saveCreatorMonthly} />
          ) : tab === 'reporting' ? (
            <ReportingView brands={brands} brandById={brandById} creators={creators} month={month} comments={comments} onOpenComments={openComments} />
          ) : tab === 'discussions' ? (
            <DiscussionsView comments={comments} brandById={brandById} creators={creators} onOpen={openComments} />
          ) : tab === 'logs' ? (
            <LogsView logs={logs} brandById={brandById} />
          ) : tab === 'notes' ? (
            <NotesBoard brands={brands} brandById={brandById} creators={creators} month={month} />
          ) : (tab === 'brief' && canUseAiBrief) ? (
            // Falls through to the Brands view if access is revoked mid-session.
            <ContentBriefView brands={brands} month={month} />
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
                  contractLinkFor={contractLinkFor} onContractLinkChange={onContractLinkChange}
                commentCount={comments.filter(c => c.brand_id === drillId).length}
                onComments={() => openComments(drillId, 'brand', '')}
                creatorNoteCount={creatorNoteCount} onCreatorNotes={openCreatorNotes}
              />
              : <BrandLevel
                rows={brandRows} totals={totals} month={month}
                search={search} setSearch={setSearch}
                onOpen={(id) => { setDrillId(id); scrollTop(); }}
                onEditBudget={(r) => setBrandEditor({ mode: 'edit', brand: brands.find(b => b.id === r.id) || { id: r.id, name: r.brand } })}
                onAddBrand={() => setBrandEditor({ mode: 'add', brand: { id: null, name: '' } })}
                onNotes={(r) => setNotesBrand({ id: r.id, name: r.brand })}
                noteCounts={noteCountByBrand}
                onBrandNotes={(r) => setKeepBrand({ id: r.id, name: r.brand })}
                onReorder={reorderBrands}
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
      {keepBrand && (
        <BrandNotesDrawer brandId={keepBrand.id} brandName={keepBrand.name}
          brands={brands} brandById={brandById} creators={creators} month={month}
          notes={notes.filter(n => n.brand_id === keepBrand.id)}
          onClose={() => setKeepBrand(null)} onChanged={reload} />
      )}
      {keepCreator && (
        <CreatorNotesDrawer creator={keepCreator}
          brands={brands} brandById={brandById} creators={creators} month={month}
          notes={notes.filter(n => n.creator_id && creatorNoteKeyById[n.creator_id] === keepCreator.key)}
          onClose={() => setKeepCreator(null)} onChanged={reload} />
      )}
      {/* global notes — reachable from anywhere in the workspace */}
      <button className="pc-notesfab" style={notesFabDrag.style} {...notesFabDrag.handlers}
        onClick={() => setAllNotesOpen(true)} title="Notes" aria-label="Open notes">
        <i className="bi bi-journal-text" />
        {dueReminderCount > 0 && <span className="pc-notesfab-badge">{dueReminderCount}</span>}
      </button>
      {allNotesOpen && (
        <AllNotesDrawer notes={notes} brands={brands} brandById={brandById} creators={creators} month={month}
          onClose={() => setAllNotesOpen(false)} onChanged={reload} />
      )}
      {openNote && (
        <NoteEditor editor={{ mode: 'edit', note: openNote }} brands={brands} brandById={brandById} creators={creators} month={month}
          overlayClass="pc-overlay-top"
          onClose={() => setOpenNote(null)} onPersist={persistOpenNote}
          onDelete={() => deleteOpenNote(openNote)} />
      )}
      {contractTplOpen && <ContractTemplateModal onClose={() => setContractTplOpen(false)} />}
      {confirmDel && <ConfirmModal message={confirmDel.message} onYes={confirmDel.onYes} onCancel={() => setConfirmDel(null)} />}
      {undo && <UndoToast label={undo.label} onUndo={doUndo} />}
      {commentDrawer && brandById[commentDrawer.brandId] && (
        <CommentsDrawer
          brand={{ id: commentDrawer.brandId, name: brandById[commentDrawer.brandId].name }}
          comments={comments} creators={creators} brandMonths={brandMonths}
          currentName={handlerName} initial={commentDrawer}
          onAdd={addPaidComment} onClose={() => setCommentDrawer(null)}
        />
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Logs tab — brand-scoped activity feed (handler_collab_activity_log):
   who changed a creator's payment status (incl. payments sent + the
   automatic sweep), client "marked payment as done", creator add/remove.
   Every handler assigned to the brand sees the same rows.
════════════════════════════════════════════════════════════ */
const LOG_KINDS = [
  { id: 'all', label: 'All' },
  { id: 'payments', label: 'Payments' },
  { id: 'status', label: 'Status changes' },
  { id: 'client', label: 'Client confirmations' },
  { id: 'roster', label: 'Added / removed' },
];
function logKind(l) {
  if (l.action === 'status_change') return l.new_status === 'paid' ? 'payments' : 'status';
  if (l.action === 'client_paid_marked' || l.action === 'client_paid_unmarked') return 'client';
  return 'roster';
}
const LOG_ICON = {
  payments: { icon: 'bi-cash-coin', cls: 'pay' },
  status: { icon: 'bi-arrow-repeat', cls: 'status' },
  client: { icon: 'bi-patch-check', cls: 'client' },
  roster: { icon: 'bi-person-plus', cls: 'roster' },
};
const logStatusOpt = (v) => STATUS_OPTIONS.find(s => s.value === v) || null;

function LogStatusPill({ value }) {
  const opt = logStatusOpt(value);
  return <span className={`pc-log-st ${opt ? opt.cls : ''}`}>{opt ? opt.label : (value || '—')}</span>;
}

function logDayKey(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function logDayLabel(key) {
  const today = logDayKey(new Date().toISOString());
  const yd = new Date(); yd.setDate(yd.getDate() - 1);
  if (key === today) return 'Today';
  if (key === logDayKey(yd.toISOString())) return 'Yesterday';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
const logTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

// One log row → a readable sentence. Bold = people/creators; status pills for transitions.
function LogText({ l }) {
  const actor = l.actor_name || 'Someone';
  const creator = <b>{l.creator_name || 'a creator'}</b>;
  if (l.action === 'status_change') {
    const arrow = <span className="pc-log-arrow"><LogStatusPill value={l.old_status} /><i className="bi bi-arrow-right" /><LogStatusPill value={l.new_status} /></span>;
    if (l.auto) return <>Automatic status update — {creator} {arrow}</>;
    if (l.new_status === 'paid') return <><b>{actor}</b> marked {creator}&apos;s payment as sent {arrow}</>;
    return <><b>{actor}</b> changed {creator}&apos;s status {arrow}</>;
  }
  if (l.action === 'client_paid_marked') return <><b>{actor}</b> (client) marked {creator}&apos;s payment as done</>;
  if (l.action === 'client_paid_unmarked') return <><b>{actor}</b> removed the &quot;payment done&quot; mark on {creator}</>;
  if (l.action === 'creator_added') {
    return <><b>{actor}</b> added creator {creator} {l.new_status ? <LogStatusPill value={l.new_status} /> : null}</>;
  }
  if (l.action === 'creator_removed') return <><b>{actor}</b> removed creator {creator}</>;
  return <>{creator}</>;
}

function LogsView({ logs, brandById }) {
  const [brandFilter, setBrandFilter] = useState('all');
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');

  const brandOptions = useMemo(() => {
    const ids = [...new Set(logs.map(l => l.brand_id))];
    return ids
      .map(id => ({ id, name: brandById[id]?.name || 'Unknown brand' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [logs, brandById]);

  const filtered = useMemo(() => logs.filter(l => {
    if (brandFilter !== 'all' && l.brand_id !== brandFilter) return false;
    if (kind !== 'all' && logKind(l) !== kind) return false;
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      const hay = `${l.creator_name} ${l.actor_name} ${brandById[l.brand_id]?.name || ''}`.toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  }), [logs, brandFilter, kind, q, brandById]);

  // rows arrive newest-first from the store; group them by (local) day
  const groups = useMemo(() => {
    const m = new Map();
    filtered.forEach(l => {
      const k = logDayKey(l.created_at);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(l);
    });
    return [...m.entries()];
  }, [filtered]);

  if (!logs.length) {
    return (
      <div className="pc-card">
        <div className="pc-empty pc-empty-lg">
          <div className="pc-empty-icon">🕘</div>
          <h3>No activity yet</h3>
          <p>Payment-status changes, payments sent, client payment confirmations and creator add/removals across your brands will show up here — including changes made by other handlers of the same brand.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="pc-logs-toolbar">
        <div className="pc-logs-kind">
          {LOG_KINDS.map(k => (
            <button key={k.id} className={`pc-logs-kbtn ${kind === k.id ? 'active' : ''}`} onClick={() => setKind(k.id)}>{k.label}</button>
          ))}
        </div>
        <select className="pc-input pc-logs-brand" value={brandFilter} onChange={e => setBrandFilter(e.target.value)} aria-label="Filter by brand">
          <option value="all">All brands</option>
          {brandOptions.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input className="pc-search pc-logs-search" placeholder="Search creator, person or brand…" value={q} onChange={e => setQ(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <div className="pc-card"><div className="pc-empty"><div className="pc-empty-icon">🔍</div><h3>Nothing matches</h3><p>No log entries match the current filters.</p></div></div>
      ) : groups.map(([day, rows]) => (
        <div className="pc-card pc-log-day" key={day}>
          <div className="pc-log-day-head">{logDayLabel(day)}<span className="pc-log-day-count">{rows.length}</span></div>
          {rows.map(l => {
            const k = logKind(l);
            const ic = l.action === 'creator_removed' ? { icon: 'bi-person-dash', cls: 'roster' } : LOG_ICON[k];
            return (
              <div className="pc-log-row" key={l.id}>
                <span className={`pc-log-ico ${ic.cls}`}><i className={`bi ${ic.icon}`} /></span>
                <div className="pc-log-body">
                  <div className="pc-log-text"><LogText l={l} /></div>
                  <div className="pc-log-meta">
                    <span className="pc-log-brand">{brandById[l.brand_id]?.name || 'Unknown brand'}</span>
                    {l.month && <span className="pc-log-month">{l.month}</span>}
                    <span className="pc-log-time">{logTime(l.created_at)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

/* ════════════════════════════════════════════════════════════
   Discussions tab — every comment thread across all brands, grouped by level,
   with a "reply needed" flag (latest message is from the client). Click a thread
   to open its discussion drawer (latest comment highlighted).
════════════════════════════════════════════════════════════ */
const DV_LEVELS = [
  { id: 'all', label: 'All' }, { id: 'brand', label: 'Brand' }, { id: 'program', label: 'Program' },
  { id: 'week', label: 'Week' }, { id: 'creator', label: 'Creator' }, { id: 'insights', label: 'Insights' }, { id: 'kpi', label: 'KPI' },
];
function dvShortDate(iso) {
  const d = new Date(iso); const s = (Date.now() - d.getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function DiscussionsView({ comments, brandById, creators, onOpen }) {
  const [lvl, setLvl] = useState('all');
  const threads = useMemo(() => {
    const map = new Map();
    comments.forEach(c => {
      const k = `${c.brand_id}|${c.target_type}|${c.target_key}`;
      let t = map.get(k);
      if (!t) { t = { key: k, brand_id: c.brand_id, tt: c.target_type, tk: c.target_key, items: [] }; map.set(k, t); }
      t.items.push(c);
    });
    return [...map.values()].map(t => {
      const sorted = t.items.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      const last = sorted[sorted.length - 1];
      return { ...t, count: t.items.length, last, needsReply: last.author_type === 'client' };
    }).sort((a, b) => (Number(b.needsReply) - Number(a.needsReply)) || String(b.last.created_at).localeCompare(String(a.last.created_at)));
  }, [comments]);
  const counts = useMemo(() => { const c = { all: threads.length }; threads.forEach(t => { c[t.tt] = (c[t.tt] || 0) + 1; }); return c; }, [threads]);
  const shown = lvl === 'all' ? threads : threads.filter(t => t.tt === lvl);

  const targetLabel = (t) => t.tt === 'brand' ? 'Whole brand' : t.tt === 'insights' ? 'Insights'
    : t.tt === 'kpi' ? `KPI · ${CD_KPIS.find(k => k.id === t.tk)?.label ?? t.tk}`
      : t.tt === 'program' ? `Program · ${monthLabel(t.tk)}`
        : t.tt === 'week' ? `Week · ${rangeShort(t.tk, addDaysISO(t.tk, 6))}`
          : `Creator · ${creators.find(c => c.id === t.tk)?.name ?? t.tk}`;

  if (threads.length === 0) {
    return <div className="pc-card"><div className="pc-empty pc-empty-lg"><div className="pc-empty-icon">💬</div><h3>No discussions yet</h3><p>Comments from clients and your replies show up here, grouped by level. You'll get a notification when a client comments.</p></div></div>;
  }
  return (
    <div>
      <div className="pc-rd-weeks" style={{ marginBottom: 14 }}>
        {DV_LEVELS.filter(l => l.id === 'all' || counts[l.id]).map(l => (
          <button key={l.id} className={`pc-rd-week ${lvl === l.id ? 'active' : ''}`} onClick={() => setLvl(l.id)}>
            {l.label}{counts[l.id] ? <span className="pc-rd-week-n" style={{ marginLeft: 5 }}>{counts[l.id]}</span> : null}
          </button>
        ))}
      </div>
      <div className="pc-card" style={{ padding: 6 }}>
        {shown.map(t => {
          const name = brandById[t.brand_id]?.name || 'Brand';
          return (
            <button key={t.key} className="pc-disc-row" onClick={() => onOpen(t.brand_id, t.tt, t.tk, t.last.id)}>
              <span className="pc-ava" style={{ background: getGradient(name), width: 34, height: 34, fontSize: 14, borderRadius: 10, flex: '0 0 auto' }}>{initial(name)}</span>
              <div className="pc-disc-main">
                <div className="pc-disc-top">
                  <span className="pc-disc-brand">{name}</span>
                  <span className="pc-disc-tag">{targetLabel(t)}</span>
                </div>
                <div className="pc-disc-prev"><b>{t.last.author_name}:</b> {t.last.body}</div>
              </div>
              <div className="pc-disc-right">
                {t.needsReply && <span className="pc-rd-pill pend">Reply needed</span>}
                <span className="pcc-count">{t.count}</span>
                <span className="pc-disc-time">{dvShortDate(t.last.created_at)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Discussion drawer — handler-side comment threads for one brand at any level
   (brand / insights / kpi / program / week / creator). Opened from a brand's
   "Discussion" button or a notification click-through (pre-scoped + highlight).
════════════════════════════════════════════════════════════ */
const CD_KPIS = [
  { id: 'active_creators', label: 'Active creators' }, { id: 'videos_posted', label: 'Videos posted' },
  { id: 'pipeline', label: 'In pipeline' }, { id: 'pending_payments', label: 'Pending payments' }, { id: 'gmv', label: 'GMV generated' },
];
const CD_TYPES = [
  { id: 'brand', label: 'Brand' }, { id: 'insights', label: 'Insights' }, { id: 'kpi', label: 'KPI' },
  { id: 'program', label: 'Program' }, { id: 'week', label: 'Week' }, { id: 'creator', label: 'Creator' },
];
function CommentsDrawer({ brand, comments, creators, brandMonths, currentName, initial, onAdd, onClose }) {
  const [tt, setTt] = useState(initial.tt || 'brand');
  const [tk, setTk] = useState(initial.tk || '');
  const bComments = useMemo(() => comments.filter(c => c.brand_id === brand.id), [comments, brand.id]);
  const brandCreators = useMemo(() => creators.filter(c => c.brand_id === brand.id), [creators, brand.id]);
  const months = useMemo(() => {
    const set = new Set();
    brandMonths.filter(m => m.brand_id === brand.id).forEach(m => set.add(m.month));
    brandCreators.forEach(c => { const k = monthKey(c.onboarded_on); if (k) set.add(k); });
    return [...set].sort().reverse();
  }, [brandMonths, brandCreators, brand.id]);
  const weeks = useMemo(() => {
    const set = new Set();
    brandCreators.forEach(c => Object.keys((c.monthly || {}).weeks || {}).forEach(k => set.add(k)));
    return [...set].sort();
  }, [brandCreators]);

  const needsKey = tt === 'kpi' || tt === 'program' || tt === 'week' || tt === 'creator';
  const keyOptions = tt === 'kpi' ? CD_KPIS.map(k => ({ value: k.id, label: k.label }))
    : tt === 'program' ? months.map(m => ({ value: m, label: monthLabel(m) }))
      : tt === 'week' ? weeks.map(w => ({ value: w, label: rangeShort(w, addDaysISO(w, 6)) }))
        : tt === 'creator' ? brandCreators.map(c => ({ value: c.id, label: c.name })) : [];

  function pickType(nt) {
    setTt(nt);
    if (nt === 'brand' || nt === 'insights') { setTk(''); return; }
    const opts = nt === 'kpi' ? CD_KPIS.map(k => k.id)
      : nt === 'program' ? months : nt === 'week' ? weeks : brandCreators.map(c => c.id);
    setTk(opts[0] || '');
  }

  const title = tt === 'brand' ? `Whole brand · ${brand.name}`
    : tt === 'insights' ? 'Insights'
      : tt === 'kpi' ? `KPI · ${CD_KPIS.find(k => k.id === tk)?.label ?? ''}`
        : tt === 'program' ? `Program · ${tk ? monthLabel(tk) : ''}`
          : tt === 'week' ? `Week · ${tk ? rangeShort(tk, addDaysISO(tk, 6)) : ''}`
            : `Creator · ${brandCreators.find(c => c.id === tk)?.name ?? ''}`;

  // Existing threads (grouped) for quick navigation.
  const threads = useMemo(() => {
    const m = new Map();
    bComments.forEach(c => { const k = `${c.target_type}|${c.target_key}`; m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].map(([k, n]) => { const [t, key] = k.split('|'); return { t, key, n }; });
  }, [bComments]);
  const threadLabel = (t, key) => t === 'brand' ? 'Brand' : t === 'insights' ? 'Insights'
    : t === 'kpi' ? `KPI · ${CD_KPIS.find(x => x.id === key)?.label ?? key}`
      : t === 'program' ? `Program · ${monthLabel(key)}`
        : t === 'week' ? `Week · ${rangeShort(key, addDaysISO(key, 6))}`
          : `Creator · ${brandCreators.find(c => c.id === key)?.name ?? key}`;

  return (
    <div className="pc-drawer-overlay" onClick={onClose}>
      <aside className="pc-drawer" onClick={e => e.stopPropagation()} style={{ maxWidth: 580 }}>
        <div className="pc-drawer-head">
          <div className="pc-drawer-head-l">
            <span className="pc-ava" style={{ background: getGradient(brand.name), width: 40, height: 40, fontSize: 18, borderRadius: 12 }}>{initial.iconInitial || brand.name[0]?.toUpperCase()}</span>
            <div>
              <div className="pc-drawer-title">{brand.name}</div>
              <div className="pc-drawer-sub">Discussion</div>
            </div>
          </div>
          <button className="pc-iconbtn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="pc-drawer-body">
          <div className="pc-rd-weeks" style={{ marginBottom: 10 }}>
            {CD_TYPES.map(t => (
              <button key={t.id} className={`pc-rd-week ${tt === t.id ? 'active' : ''}`} onClick={() => pickType(t.id)}>{t.label}</button>
            ))}
          </div>
          {needsKey && (
            <select className="pcc-input" style={{ marginBottom: 10 }} value={tk} onChange={e => setTk(e.target.value)}>
              <option value="">Select…</option>
              {keyOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
          {(!needsKey || tk) ? (
            <PaidCollabComments
              comments={bComments} targetType={tt} targetKey={tk} title={title}
              mode="authed" currentAuthorName={currentName}
              onAdd={(body, name, parentId) => onAdd(brand.id, tt, tk, body, name, parentId)}
              highlightCommentId={initial.highlight} defaultOpen
            />
          ) : <div className="pcc-empty" style={{ padding: 12 }}>Pick a {tt} to view its discussion.</div>}

          {threads.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--pc-text-2)', marginBottom: 8 }}>All threads</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {threads.map(th => (
                  <button key={`${th.t}|${th.key}`} className="pc-cd-thread" onClick={() => { setTt(th.t); setTk(th.key); }}>
                    <span>{threadLabel(th.t, th.key)}</span><span className="pcc-count">{th.n}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>
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
function BrandLevel({ rows, totals, month, search, setSearch, onOpen, onEditBudget, onAddBrand, onNotes, noteCounts = {}, onBrandNotes, onReorder }) {
  const collected = totals.allocated > 0 ? Math.round((totals.paid / totals.allocated) * 100) : 0;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  function handleDragEnd(e) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = rows.map(r => r.id);
    const oldI = ids.indexOf(active.id), newI = ids.indexOf(over.id);
    if (oldI < 0 || newI < 0) return;
    onReorder && onReorder(arrayMove(ids, oldI, newI));
  }
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
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={rows.map(r => r.id)} strategy={verticalListSortingStrategy}>
              {rows.map(r => <BrandRow key={r.id} r={r} onOpen={() => onOpen(r.id)} onEditBudget={() => onEditBudget(r)} onNotes={() => onNotes(r)} noteCount={noteCounts[r.id] || 0} onBrandNotes={() => onBrandNotes && onBrandNotes(r)} />)}
            </SortableContext>
          </DndContext>
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

const DragGrip = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="9" cy="6" r="1.7" /><circle cx="15" cy="6" r="1.7" /><circle cx="9" cy="12" r="1.7" /><circle cx="15" cy="12" r="1.7" /><circle cx="9" cy="18" r="1.7" /><circle cx="15" cy="18" r="1.7" /></svg>
);

function BrandRow({ r, onOpen, onEditBudget, onNotes, noteCount = 0, onBrandNotes }) {
  // Usage bar color: below 80% red, 80%+ green.
  const usageColor = r.usage >= 80 ? 'var(--pc-success-fg)' : 'var(--pc-error-fg)';
  function edit(e) { e.stopPropagation(); onEditBudget(); }
  function keepNotes(e) { e.stopPropagation(); onBrandNotes && onBrandNotes(); }
  const keepBtn = (
    <button className={`pc-keepnote-btn ${noteCount > 0 ? 'has' : ''}`} onClick={keepNotes}
      title={noteCount > 0 ? `${noteCount} brand note${noteCount === 1 ? '' : 's'}` : 'Brand notes'} aria-label="Brand notes">
      <i className="bi bi-journal-text" />
      {noteCount > 0 && <span className="pc-keepnote-count">{noteCount}</span>}
    </button>
  );
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: r.id });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 50 : undefined, position: isDragging ? 'relative' : undefined };
  const handle = (
    <button type="button" className="pc-drag" {...attributes} {...listeners}
      onClick={e => e.stopPropagation()} title="Drag to reorder" aria-label="Drag to reorder">{DragGrip}</button>
  );
  return (
    <div ref={setNodeRef} style={style} className={`pc-bt-row ${isDragging ? 'is-dragging' : ''}`} onClick={onOpen} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}>
      <div className="pc-brandcell">
        {handle}
        <span className="pc-ava" style={{ background: getGradient(r.brand) }}>{initial(r.brand)}</span>
        <div style={{ minWidth: 0 }}>
          <div className="pc-brandname">{r.brand}</div>
          <div className="pc-brandsub">{r.creators} creator{r.creators === 1 ? '' : 's'} · {r.delivered}/{r.videos} delivered</div>
        </div>
        {keepBtn}
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
          {handle}
          <span className="pc-ava" style={{ background: getGradient(r.brand) }}>{initial(r.brand)}</span>
          <div className="pc-mc-idblock">
            <div className="pc-mc-name">{r.brand}</div>
            <div className="pc-mc-subline">{r.creators} creator{r.creators === 1 ? '' : 's'} · {r.delivered}/{r.videos} delivered</div>
          </div>
          {keepBtn}
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

// Contract column: one button — the creator's signing link. Everything the old
// PDF / paste-link icons did now lives in its modal (download the PDF, copy the
// link, activate/deactivate, see who signed), and the signed copy is served from
// /sign/<token> instead of a manually pasted Drive URL.
function ContractActions({ c, buildPayload = null, link = null, onLinkChange = null }) {
  const [shareOpen, setShareOpen] = useState(false);
  const signState = link?.signed_at ? 'signed' : link ? (link.active ? 'sent' : 'off') : '';
  if (!buildPayload) return null;
  return (
    <span className="pc-contract-actions">
      <button type="button" className={`pc-contract-btn pc-signlink ${signState}`}
        title={link?.signed_at ? `Signed by ${link.signer_name || 'the creator'}` : link ? 'Contract & signing link' : 'Create the contract signing link'}
        aria-label="Contract signing link"
        onClick={e => { e.stopPropagation(); setShareOpen(true); }}>
        <i className={`bi ${link?.signed_at ? 'bi-patch-check-fill' : 'bi-vector-pen'}`} />
      </button>
      {shareOpen && (
        <ContractShareModal c={c} buildPayload={buildPayload} initialLink={link}
          onChange={onLinkChange} onClose={() => setShareOpen(false)} />
      )}
    </span>
  );
}

/* ════════════════════════════════════════════════════════════
   Contract signing link — auto-generated per creator deal.
   The handler shares /sign/<token> with the creator, who reads the exact
   contract snapshot and signs once (name + drawn/uploaded signature). The
   signature freezes server-side; the handler gets a notification and can
   deactivate / reactivate the link at any time.
════════════════════════════════════════════════════════════ */
function ContractShareModal({ c, buildPayload, initialLink, onChange, onClose }) {
  const [link, setLink] = useState(initialLink && initialLink.token ? initialLink : null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  // §2 deliverable window (days after sample delivery). Blank = automatic rule.
  // Editable here so the handler can set it while generating the contract; saved
  // on the deal and re-snapshotted into the link the creator signs.
  const [days, setDays] = useState(c.deliverable_days != null ? String(c.deliverable_days) : '');
  const autoDays = (parseInt(c.videos_count, 10) || 0) < 6 ? 10 : 14;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Refresh the snapshot the creator will sign from the current deal —
        // unless it is already signed, in which case nothing may change.
        const payload = await buildPayload();
        const row = await store.upsertContractLink(c.id, c.brand_id, payload);
        if (!alive) return;
        setLink(row);
        onChange?.(row);
      } catch (e) {
        if (alive) setErr(e.message || 'Could not create the signing link');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);

  const url = link ? `${window.location.origin}/sign/${link.token}` : '';

  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { }
  }

  async function toggleActive() {
    if (!link) return;
    setBusy(true); setErr('');
    try {
      await store.setContractLinkActive(link.id, !link.active);
      const row = { ...link, active: !link.active };
      setLink(row); onChange?.(row);
    } catch (e) { setErr(e.message || 'Could not update the link'); }
    setBusy(false);
  }

  // Save the deadline on the deal and rebuild the snapshot the creator signs.
  async function saveDays() {
    const val = days.trim() ? parseInt(days, 10) || null : null;
    setBusy(true); setErr('');
    try {
      await store.updateCreator(c.id, { deliverable_days: val });
      c.deliverable_days = val; // keep the open row in sync until the next reload
      const payload = { ...(await buildPayload()), deliverableDays: val };
      const row = await store.upsertContractLink(c.id, c.brand_id, payload);
      setLink(row); onChange?.(row);
    } catch (e) { setErr(e.message || 'Could not save the deadline'); }
    setBusy(false);
  }

  // Download the agreement — the executed copy once signed (the list query omits
  // the signature blob, so refetch the full row), otherwise the blank one.
  async function download() {
    setBusy(true); setErr('');
    try {
      const { downloadCreatorContract } = await import('./contractPdf');
      if (link?.signed_at) {
        const full = await store.getContractLink(c.id);
        await downloadCreatorContract({
          ...(full?.payload || {}),
          creatorSignatureDataUrl: full?.signer_signature || null,
          creatorSignedName: full?.signer_name || '',
          creatorSignedAt: full?.signed_at || null,
        });
      } else {
        await downloadCreatorContract(link?.payload || await buildPayload());
      }
    } catch (e) { setErr(e.message || 'Could not build the PDF'); }
    setBusy(false);
  }

  return createPortal(
    <div className="pc-overlay" onClick={onClose}>
      <div className="pc-modal" onClick={e => e.stopPropagation()}>
        <h3>Contract signing link</h3>
        <div className="pc-modal-sub">{c.name} — the creator signs online, no account needed</div>
        {loading ? <div className="pc-spinner" /> : (
          <div className="pc-modal-body">
            {link?.signed_at ? (
              <div className="pc-signed-box">
                <i className="bi bi-patch-check-fill" />
                <div>
                  <b>Signed by {link.signer_name || 'the creator'}</b>
                  <div className="pc-signed-sub">{new Date(link.signed_at).toLocaleString()}</div>
                </div>
              </div>
            ) : (
              <div className={`pc-signstate ${link?.active ? 'on' : 'off'}`}>
                <i className={`bi ${link?.active ? 'bi-broadcast' : 'bi-slash-circle'}`} />
                {link?.active ? 'Link is active — waiting for the creator to sign' : 'Link is deactivated — the creator can no longer open it'}
              </div>
            )}

            {!link?.signed_at && (
              <div className="pc-field">
                <label>Deliverable deadline (days after sample delivery)</label>
                <div className="pc-linkrow">
                  <input className="pc-input" type="number" min="1" inputMode="numeric"
                    placeholder={`auto — ${autoDays} days`} value={days} onChange={e => setDays(e.target.value)} />
                  <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={saveDays} disabled={busy}>Save</button>
                </div>
                <div className="pc-sig-hint">Contract §2. Leave blank for the automatic rule ({autoDays} days for this deal).</div>
              </div>
            )}

            <div className="pc-field">
              <label>Shareable link</label>
              <div className="pc-linkrow">
                <input className="pc-input" readOnly value={url} onFocus={e => e.target.select()} />
                <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
                <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={() => window.open(url, '_blank')}>Open</button>
              </div>
              <div className="pc-sig-hint">Send this to {c.name || 'the creator'}. They read the agreement, sign once and download their copy — the signature can never be changed afterwards.</div>
            </div>

            {err && <div className="pc-formerr">{err}</div>}
          </div>
        )}
        <div className="pc-modal-actions">
          {link && (
            <button className="pc-btn pc-btn-ghost" onClick={toggleActive} disabled={busy}>
              {link.active ? 'Deactivate link' : 'Activate link'}
            </button>
          )}
          <button className="pc-btn pc-btn-ghost" onClick={download} disabled={busy || loading}>
            {link?.signed_at ? 'Download signed PDF' : 'Download PDF'}
          </button>
          <button className="pc-btn pc-btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Handler's contract-template settings (rep name + signature) for the PDF.
// Fetched fresh per download — always current, no plumbing through row props.
// Failures degrade to an unsigned contract rather than blocking the download.
async function contractTemplatePayload() {
  try {
    const s = await store.getContractSettings();
    if (!s) return {};
    let signatureDataUrl = null;
    if (s.signature_url) {
      try {
        const blob = await (await fetch(s.signature_url)).blob();
        signatureDataUrl = await new Promise((res) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.onerror = () => res(null);
          fr.readAsDataURL(blob);
        });
      } catch { }
    }
    return { repName: s.rep_name || '', signatureDataUrl };
  } catch { return {}; }
}

// Contract column — fill the standard agreement template from the deal row.
// Featured products: the creator's own list, else the month's focus products
// (passed by the Drilldown; the Creators tab has no brand-month in scope).
// Product page links + the month's content guide ride along as clickable
// reference links when set.
async function contractPayloadFor(c, brandName, opts = {}) {
  const own = creatorProducts(c);
  const focus = opts.focusProducts || [];
  const prodNames = own.map(p => p.name).filter(Boolean);
  // Links follow the same priority as the names; fall back to the month's
  // focus-product links when the chosen list carries none.
  let productLinks = (own.length ? own : focus).filter(p => isValidUrl(p.url));
  if (!productLinks.length) productLinks = focus.filter(p => isValidUrl(p.url));
  const accounts = tiktokAccounts(c.tiktok_handle);
  return {
    ...(await contractTemplatePayload()),
    brandName: brandName || 'Brand',
    creatorName: c.name || '',
    username: accounts[0] ? accounts[0].handle.replace(/^@/, '') : (c.name || ''),
    amount: Number(c.amount) || 0,
    currency: opts.currency || 'USD',
    videosCount: parseInt(c.videos_count, 10) || 0,
    deliverableDays: c.deliverable_days || null,
    effectiveDate: c.onboarded_on || null,
    productNames: prodNames.length ? prodNames : focus.map(p => p.name).filter(Boolean),
    productLinks,
    contentGuideUrl: isValidUrl(opts.contentGuideUrl) ? opts.contentGuideUrl : null,
  };
}

/* ════════════════════════════════════════════════════════════
   Drilldown
════════════════════════════════════════════════════════════ */
function Drilldown({ brand, row, month, creators, onBack, onAddCreator, onEditCreator, onDeleteCreator, onEditBudget, onDeleteBrand, onNotes, notesText, patchCreatorLocal, onSetStatus, onToggleVisible, contractLinkFor, onContractLinkChange, commentCount, onComments, creatorNoteCount, onCreatorNotes }) {
  setReportCurrency(brand && brand.currency); // single brand → its money symbol
  const [openId, setOpenId] = useState(null);
  const bm = row?.bm || {};
  const products = focusProductList(bm);
  const notesHas = !!(notesText && notesText.trim());
  // group creators by payment status — Payment Pending → Follow-up Required → Videos in Progress → Payment Sent,
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
          {onComments && (
            <button className="pc-disc-btn" style={{ height: 34 }} onClick={onComments} title="Open discussion for this brand">
              <i className="bi bi-chat-left-text" />Discussion
              {commentCount > 0 && <span className="pc-disc-badge">{commentCount}</span>}
            </button>
          )}
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
            <div className="pc-num">Videos</div><div>Payout</div><div>Status</div><div>Contract</div><div className="pc-num">Content</div>
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
                  patchCreatorLocal={patchCreatorLocal} onSetStatus={onSetStatus} onToggleVisible={onToggleVisible}
                  noteCount={creatorNoteCount ? creatorNoteCount(c) : 0}
                  onNotes={onCreatorNotes ? () => onCreatorNotes(c) : null}
                  buildContractPayload={() => contractPayloadFor(c, brand.name, { focusProducts: products, contentGuideUrl: bm.content_guide_url, currency: brand.currency })}
                  contractLink={contractLinkFor ? contractLinkFor(c) : null}
                  onContractLinkChange={onContractLinkChange} />
              ))}
            </React.Fragment>
          ))}
        </div>
      )}
    </>
  );
}

function CreatorRow({ c, idx, open, onToggle, onEdit, onDelete, patchCreatorLocal, onSetStatus, onToggleVisible, noteCount = 0, onNotes = null, buildContractPayload = null, contractLink = null, onContractLinkChange = null }) {
  const accounts = tiktokAccounts(c.tiktok_handle);
  const filled = Array.isArray(c.video_codes) ? c.video_codes.filter(v => v?.video).length : 0;
  const contractBtn = <ContractActions c={c} buildPayload={buildContractPayload} link={contractLink} onLinkChange={onContractLinkChange} />;
  const keepBtn = onNotes ? (
    <button className={`pc-keepnote-btn pc-keepnote-mini ${noteCount > 0 ? 'has' : ''}`}
      onClick={e => { e.stopPropagation(); onNotes(); }}
      title={noteCount > 0 ? `${noteCount} creator note${noteCount === 1 ? '' : 's'}` : 'Creator notes'} aria-label="Creator notes">
      <i className="bi bi-journal-text" />
      {noteCount > 0 && <span className="pc-keepnote-count">{noteCount}</span>}
    </button>
  ) : null;
  const rowRef = useRef(null);
  useEffect(() => {
    if (open && rowRef.current?.scrollIntoView) {
      try { rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch { }
    }
  }, [open]);
  return (
    <>
      <div ref={rowRef} className={`pc-ct-row ${open ? 'open' : ''}`} onClick={onToggle} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onToggle(); }}>
        <div className="pc-cell pc-num pc-idxcell" data-label="#"><span className="pc-idx">#{idx}</span></div>
        <div className="pc-cell" data-label="Completed on">{c.completed_on ? fmtDate(c.completed_on) : <span className="pc-handle">—</span>}</div>
        <div className="pc-cell" data-label="Name"><span className="pc-cname">{c.name}</span>{keepBtn}</div>
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
          <ClientPaidBadge c={c} />
        </div>
        <div className="pc-cell pc-contract-cell" data-label="Contract">{contractBtn}</div>
        <div className="pc-cell pc-num" data-label="Content"><span className="pc-content-cell">{filled > 0 ? <b>{filled}</b> : ''} {open ? '▴' : '▾'}</span></div>

        {/* ── purpose-built mobile card ── */}
        <div className="pc-mc">
          <div className="pc-mc-head">
            <div className="pc-mc-idblock">
              <div className="pc-mc-name">{c.name}{keepBtn}</div>
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
            <ClientPaidBadge c={c} />
            {contractBtn}
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
  return (
    <div className="pc-payout">
      {paypal && <PayChip kind="pp" value={paypal} />}
      {zelle && <PayChip kind="zl" value={zelle} />}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   Creators tab — every creator (per brand) for the month
════════════════════════════════════════════════════════════ */
function CreatorsView({ rows, onEdit, onSetStatus, onToggleVisible, contractLinkFor, onContractLinkChange, creatorNoteCount, onCreatorNotes }) {
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
        <div className="pc-card pc-list pc-cv-list" style={{ paddingBottom: sel.size ? 8 : 0 }}>
          <div className="pc-cv-head">
            <div className="pc-cv-check"><input type="checkbox" className="pc-check" checked={allSelected} onChange={toggleAll} title="Select all" /></div>
            <div className="pc-num pc-idxcell">#</div><div>Name</div><div>Category</div>
            <div>Brand</div><div className="pc-num">Deal</div><div className="pc-num">Rate/Vid</div><div>Status</div><div>Contract</div>
          </div>
          {groups.map(g => (
            <React.Fragment key={g.key}>
              <div className="pc-cv-monthhead"><span>{monthLabel(g.key)}</span><span className="pc-cv-monthcount">{g.items.length}</span></div>
              {g.items.map((c, i) => <CreatorGlobalRow key={c.id} c={c} idx={i + 1} onEdit={() => onEdit(c)} onSetStatus={onSetStatus} onToggleVisible={onToggleVisible} selected={sel.has(c.id)} onToggleSelect={() => toggle(c.id)}
                noteCount={creatorNoteCount ? creatorNoteCount(c) : 0} onNotes={onCreatorNotes ? () => onCreatorNotes(c) : null}
                buildContractPayload={() => contractPayloadFor(c, c._brandName, { currency: c._brandCurrency })}
                contractLink={contractLinkFor ? contractLinkFor(c) : null}
                onContractLinkChange={onContractLinkChange} />)}
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

function CreatorGlobalRow({ c, idx, onEdit, onSetStatus, onToggleVisible, selected, onToggleSelect, noteCount = 0, onNotes = null, buildContractPayload = null, contractLink = null, onContractLinkChange = null }) {
  const accounts = tiktokAccounts(c.tiktok_handle);
  const contractBtn = <ContractActions c={c} buildPayload={buildContractPayload} link={contractLink} onLinkChange={onContractLinkChange} />;
  const keepBtn = onNotes ? (
    <button className={`pc-keepnote-btn pc-keepnote-mini ${noteCount > 0 ? 'has' : ''}`}
      onClick={e => { e.stopPropagation(); onNotes(); }}
      title={noteCount > 0 ? `${noteCount} creator note${noteCount === 1 ? '' : 's'}` : 'Creator notes'} aria-label="Creator notes">
      <i className="bi bi-journal-text" />
      {noteCount > 0 && <span className="pc-keepnote-count">{noteCount}</span>}
    </button>
  ) : null;
  const amount = Number(c.amount) || 0;
  const videos = parseInt(c.videos_count, 10) || 0;
  const delivered = Array.isArray(c.video_codes) ? c.video_codes.filter(v => v?.video && String(v.video).trim()).length : 0;
  const avg = videos > 0 ? amount / videos : 0;
  const contact = c.phone || c.email || '';
  return (
    <div className={`pc-cv-row ${selected ? 'sel' : ''}`} onClick={onEdit} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onEdit(); }}>
      <div className="pc-cell pc-cv-check" data-label="" onClick={e => e.stopPropagation()}><input type="checkbox" className="pc-check" checked={selected} onChange={onToggleSelect} /></div>
      <div className="pc-cell pc-num pc-idxcell" data-label="#"><span className="pc-idx">#{idx}</span></div>
      <div className="pc-cell pc-cv-namecell" data-label="Name">
        <span className="pc-cname">{c.name}{keepBtn}</span>
        {accounts.length > 0 && (
          <span className="pc-tiktok pc-cv-sub">
            <a className="pc-handle" href={accounts[0].url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>{accounts[0].handle}</a>
            {accounts.length > 1 && <span className="pc-more" title={accounts.slice(1).map(a => a.handle).join(', ')}>+{accounts.length - 1}</span>}
          </span>
        )}
        {contact && <span className="pc-cv-sub" title={[c.phone, c.email].filter(Boolean).join('  ·  ')}>{contact}</span>}
      </div>
      <div className="pc-cell" data-label="Category">{c.category ? <span className="pc-cat" title={c.category}>{c.category}</span> : <span className="pc-handle">—</span>}</div>
      <div className="pc-cell pc-cv-brandcell" data-label="Brand">
        <span className="pc-brandtag">{c._brandName}</span>
        {c.onboarded_on && <span className="pc-cv-sub">Onboarded {fmtDate(c.onboarded_on)}</span>}
      </div>
      <div className="pc-cell pc-num pc-cv-dealcell" data-label="Deal">
        <span className="pc-money">{fmt$(amount)}</span>
        {videos > 0 && <span className="pc-cv-sub">{delivered}/{videos} video{videos === 1 ? '' : 's'}</span>}
      </div>
      <div className="pc-cell pc-num" data-label="Rate/Vid"><span className="pc-money">{avg ? fmt$(avg) : '—'}</span></div>
      <div className="pc-cell" data-label="Status">
        <StatusDropdown value={c.payment_status} onChange={v => onSetStatus(c.id, v)} />
        <PendingVisibilityToggle c={c} onToggleVisible={onToggleVisible} />
      </div>
      <div className="pc-cell pc-contract-cell" data-label="Contract">{contractBtn}</div>

      {/* ── purpose-built mobile card ── */}
      <div className="pc-mc">
        <div className="pc-mc-head">
          <div className="pc-mc-idblock">
            <div className="pc-mc-name">{c.name}{keepBtn}</div>
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
          {contractBtn}
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

/* ════════════════════════════════════════════════════════════
   Internal Reporting — data-dense dashboard (KPIs + charts + insights)
   across all of the handler's brands, with a Monthly / Weekly lens.
════════════════════════════════════════════════════════════ */
const RD_STATUS = {
  videos_in_progress: { label: 'In progress', cls: 'prog', color: '#1259C3' },
  follow_up: { label: 'Follow-up', cls: 'fup', color: '#C62828' },
  pending: { label: 'Pending pay', cls: 'pend', color: '#E8862E' },
  paid: { label: 'Paid', cls: 'paid', color: '#198754' },
};
const rdDelivered = (c) => Array.isArray(c.video_codes) ? c.video_codes.filter(v => v?.video && String(v.video).trim()).length : 0;
const rdAgreed = (c) => Number(c.videos_count) || 0;
const rdUnauthCodes = (c) => (Array.isArray(c.video_codes) ? c.video_codes : []).filter(v => (v?.adCode || '').trim() && !v?.auth).length;

function ReportingView({ brands, brandById, creators, month, comments = [], onOpenComments }) {
  const [mode, setMode] = useState('weekly'); // monthly | weekly
  const [approvalsOpen, setApprovalsOpen] = useState(false);
  const [weekSel, setWeekSel] = useState(null); // null = all weeks of the month
  const [brandSel, setBrandSel] = useState(''); // '' = all brands, else brand_id
  const isWeekly = mode === 'weekly';
  setReportCurrency(brandSel ? (brandById[brandSel] && brandById[brandSel].currency) : uniformCurrency(brands));
  const brandCommentCount = brandSel ? comments.filter(c => c.brand_id === brandSel).length : 0;

  // Everything below is computed over the chosen brand scope (all brands by default).
  const scoped = useMemo(() => brandSel ? creators.filter(c => c.brand_id === brandSel) : creators, [creators, brandSel]);
  const selBrandName = brandSel ? (brandById[brandSel]?.name || 'Brand') : null;

  // Distinct week-starts that have data in the selected month (within the brand scope).
  const monthWeekKeys = useMemo(() => {
    const set = new Set();
    scoped.forEach(c => { const w = (c.monthly || {}).weeks || {}; Object.keys(w).forEach(k => { if (k.slice(0, 7) === month) set.add(k); }); });
    return [...set].sort();
  }, [scoped, month]);
  // Selected week is only honoured if it exists in this month (auto-resets on month change).
  const activeWeek = isWeekly && weekSel && monthWeekKeys.includes(weekSel) ? weekSel : null;

  const periodGmv = (c) => {
    const mm = c.monthly || {};
    if (isWeekly) {
      const w = mm.weeks || {};
      if (activeWeek) return Number(w[activeWeek]?.gmv) || 0;
      return Object.keys(w).filter(k => k.slice(0, 7) === month).reduce((t, k) => t + (Number(w[k]?.gmv) || 0), 0);
    }
    return Number(mm[month]?.gmv) || 0;
  };
  const periodAd = (c) => {
    const mm = c.monthly || {};
    if (isWeekly) {
      const w = mm.weeks || {};
      if (activeWeek) return Number(w[activeWeek]?.adSpent) || 0;
      return Object.keys(w).filter(k => k.slice(0, 7) === month).reduce((t, k) => t + (Number(w[k]?.adSpent) || 0), 0);
    }
    return Number(mm[month]?.adSpent) || 0;
  };

  const kpis = useMemo(() => {
    const active = scoped.filter(c => c.payment_status !== 'paid').length;
    const posted = scoped.reduce((t, c) => t + rdDelivered(c), 0);
    const pipeline = scoped.reduce((t, c) => t + Math.max(0, rdAgreed(c) - rdDelivered(c)), 0);
    const pendingList = scoped.filter(c => c.payment_status === 'pending');
    const pendingAmt = pendingList.reduce((t, c) => t + (Number(c.amount) || 0), 0);
    const gmv = scoped.reduce((t, c) => t + periodGmv(c), 0);
    const ad = scoped.reduce((t, c) => t + periodAd(c), 0);
    return { active, posted, pipeline, pendingCount: pendingList.length, pendingAmt, gmv, ad, roas: ad > 0 ? gmv / ad : 0 };
  }, [scoped, month, isWeekly, activeWeek]);

  const trend = useMemo(() => {
    if (isWeekly) {
      const set = new Set();
      scoped.forEach(c => { const w = (c.monthly || {}).weeks || {}; Object.keys(w).forEach(k => { if (k.slice(0, 7) === month) set.add(k); }); });
      return [...set].sort().map(k => {
        let gmv = 0, ad = 0;
        scoped.forEach(c => { const cell = ((c.monthly || {}).weeks || {})[k]; if (cell) { gmv += Number(cell.gmv) || 0; ad += Number(cell.adSpent) || 0; } });
        return { label: rangeShort(k, addDaysISO(k, 6)), gmv, ad };
      });
    }
    const out = [];
    for (let i = 5; i >= 0; i--) {
      const mk = addMonth(month, -i);
      let gmv = 0, ad = 0;
      scoped.forEach(c => { const cell = (c.monthly || {})[mk]; if (cell) { gmv += Number(cell.gmv) || 0; ad += Number(cell.adSpent) || 0; } });
      out.push({ label: monthShort(mk), gmv, ad });
    }
    return out;
  }, [scoped, month, isWeekly]);

  const topCreators = useMemo(() =>
    scoped.map(c => ({ name: c.name || '—', gmv: periodGmv(c) }))
      .filter(x => x.gmv > 0).sort((a, b) => b.gmv - a.gmv).slice(0, 6)
      .map(x => ({ name: x.name.length > 16 ? x.name.slice(0, 16) + '…' : x.name, gmv: x.gmv })),
    [scoped, month, isWeekly, activeWeek]);

  const payMix = useMemo(() => {
    const m = { videos_in_progress: 0, follow_up: 0, pending: 0, paid: 0 };
    scoped.forEach(c => { m[c.payment_status] = (m[c.payment_status] || 0) + 1; });
    return Object.keys(RD_STATUS).map(k => ({ name: RD_STATUS[k].label, value: m[k] || 0, color: RD_STATUS[k].color })).filter(s => s.value > 0);
  }, [scoped]);

  const creatorRows = useMemo(() =>
    scoped.map(c => ({ c, del: rdDelivered(c), ag: rdAgreed(c), gmv: periodGmv(c) }))
      .sort((a, b) => b.gmv - a.gmv || b.del - a.del).slice(0, 12),
    [scoped, month, isWeekly, activeWeek]);

  const approvals = useMemo(() => {
    const pays = scoped.filter(c => c.payment_status === 'pending').map(c => ({ c, amount: Number(c.amount) || 0 }));
    const auths = scoped.map(c => ({ c, n: rdUnauthCodes(c) })).filter(x => x.n > 0);
    return { pays, auths, total: pays.length + auths.length };
  }, [scoped]);

  const insights = useMemo(() => {
    const list = [];
    const top = [...scoped].map(c => ({ c, gmv: periodGmv(c) })).sort((a, b) => b.gmv - a.gmv)[0];
    if (top && top.gmv > 0) list.push({ tone: 'good', icon: 'bi-trophy-fill', text: <><b>{top.c.name}</b> leads with <b>{fmt$(top.gmv)}</b> GMV {isWeekly ? 'this month (weekly)' : `in ${monthLabel(month)}`}.</> });
    if (kpis.ad > 0) list.push({ tone: kpis.roas >= 1 ? 'good' : 'warn', icon: 'bi-graph-up-arrow', text: <>Blended ROAS <b>{kpis.roas.toFixed(2)}x</b> on {fmt$(kpis.ad)} ad spend.</> });
    if (kpis.pendingCount > 0) list.push({ tone: 'warn', icon: 'bi-cash-stack', text: <><b>{fmt$(kpis.pendingAmt)}</b> pending across <b>{kpis.pendingCount}</b> creator{kpis.pendingCount === 1 ? '' : 's'} — awaiting payout.</> });
    if (kpis.pipeline > 0) list.push({ tone: 'info', icon: 'bi-hourglass-split', text: <><b>{kpis.pipeline}</b> video{kpis.pipeline === 1 ? '' : 's'} still in pipeline across <b>{kpis.active}</b> active creator{kpis.active === 1 ? '' : 's'}.</> });
    if (!isWeekly) {
      const cur = trend[trend.length - 1]?.gmv || 0;
      const prev = trend[trend.length - 2]?.gmv || 0;
      if (prev > 0) { const pct = Math.round(((cur - prev) / prev) * 100); list.push({ tone: pct >= 0 ? 'good' : 'warn', icon: pct >= 0 ? 'bi-arrow-up-right' : 'bi-arrow-down-right', text: <>GMV is <b>{pct >= 0 ? 'up' : 'down'} {Math.abs(pct)}%</b> vs the previous month.</> }); }
    }
    if (approvals.auths.length > 0) { const n = approvals.auths.reduce((t, x) => t + x.n, 0); list.push({ tone: 'warn', icon: 'bi-shield-exclamation', text: <><b>{n}</b> ad code{n === 1 ? '' : 's'} awaiting authorisation.</> }); }
    return list.slice(0, 5);
  }, [scoped, kpis, trend, approvals, month, isWeekly, activeWeek]);

  const moneyTip = (v) => fmt$(Number(v) || 0);
  // When the chart has only one populated period (a single week/month of data), a
  // line/area is invisible — so render bigger dots and value labels instead.
  const fewPoints = trend.filter(t => (t.gmv || 0) || (t.ad || 0)).length <= 1;
  const lblMoney = (v) => (Number(v) > 0 ? fmt$(v) : '');

  if (!creators.length) {
    return (
      <div className="pc-card"><div className="pc-empty pc-empty-lg">
        <div className="pc-empty-icon">📊</div>
        <h3>Nothing to report yet</h3>
        <p>Onboard creators and log their GMV in the Performance tab — your reporting dashboard builds itself from there.</p>
      </div></div>
    );
  }

  return (
    <div className="pc-rd">
      {/* header */}
      <div className="pc-rd-top">
        <div>
          <h2 className="pc-rd-title">Internal Reporting</h2>
          <div className="pc-rd-sub">
            {isWeekly
              ? <>Weekly view · {activeWeek ? <b>{rangeShort(activeWeek, addDaysISO(activeWeek, 6))}</b> : 'all weeks'} · {monthLabel(month)} · {selBrandName || `${brands.length} brand${brands.length === 1 ? '' : 's'}`}</>
              : <>Monthly view · {monthLabel(month)} · {selBrandName || `${brands.length} brand${brands.length === 1 ? '' : 's'}`}</>}
          </div>
        </div>
        <div className="pc-rd-actions">
          <label className="pc-rd-brand">
            <i className="bi bi-shop" />
            <select value={brandSel} onChange={e => { setBrandSel(e.target.value); setWeekSel(null); }}>
              <option value="">All brands</option>
              {[...brands].sort((a, b) => a.name.localeCompare(b.name)).map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </label>
          {brandSel && onOpenComments && (
            <button className="pc-disc-btn" onClick={() => onOpenComments(brandSel, 'brand', '')} title="Open discussion for this brand">
              <i className="bi bi-chat-left-text" />Discussion
              {brandCommentCount > 0 && <span className="pc-disc-badge">{brandCommentCount}</span>}
            </button>
          )}
          <button className={`pc-rd-appr ${approvals.total ? 'has' : ''}`} onClick={() => setApprovalsOpen(true)}
            title="Items that need action">
            <i className="bi bi-clipboard-check" />
            Actions Needed
            <span className="pc-rd-appr-badge">{approvals.total}</span>
          </button>
          <PerfModeToggle mode={mode} setMode={setMode} />
        </div>
      </div>

      {/* week selector (weekly mode) — which week's stats am I viewing */}
      {isWeekly && (
        <div className="pc-rd-weeks">
          <span className="pc-rd-weeks-l"><i className="bi bi-calendar3" /> Week</span>
          <button className={`pc-rd-week ${!activeWeek ? 'active' : ''}`} onClick={() => setWeekSel(null)}>All weeks</button>
          {monthWeekKeys.length === 0 ? (
            <span className="pc-rd-weeks-none">No weekly data in {monthLabel(month)} yet</span>
          ) : monthWeekKeys.map((k, i) => (
            <button key={k} className={`pc-rd-week ${activeWeek === k ? 'active' : ''}`} onClick={() => setWeekSel(k)}
              title={rangeLong(k, addDaysISO(k, 6))}>
              <span className="pc-rd-week-n">W{i + 1}</span>{rangeShort(k, addDaysISO(k, 6))}
            </button>
          ))}
        </div>
      )}

      {/* KPI tiles */}
      <div className="pc-rd-kpis">
        <RKpi icon="bi-people-fill" color="#6610F2" label="Active creators" value={fmtNum(kpis.active)} sub={`${scoped.length} total`} />
        <RKpi icon="bi-collection-play-fill" color="#198754" label="Videos posted" value={fmtNum(kpis.posted)} sub="delivered" />
        <RKpi icon="bi-hourglass-split" color="#0DCAF0" label="In pipeline" value={fmtNum(kpis.pipeline)} sub="to deliver" />
        <RKpi icon="bi-cash-stack" color="#E8862E" label="Pending payments" value={fmt$(kpis.pendingAmt)} sub={`${kpis.pendingCount} creator${kpis.pendingCount === 1 ? '' : 's'}`} />
        <RKpi icon="bi-graph-up-arrow" color="#1259C3" label="GMV generated" value={fmt$(kpis.gmv)} sub={kpis.ad > 0 ? `${kpis.roas.toFixed(2)}x ROAS` : (isWeekly ? (activeWeek ? rangeShort(activeWeek, addDaysISO(activeWeek, 6)) : 'all weeks') : monthLabel(month))} />
      </div>

      {/* charts */}
      <div className="pc-rd-charts">
        <div className="pc-rd-card">
          <div className="pc-rd-card-h">
            <span className="pc-rd-card-t">GMV vs Ad spend</span>
            <span className="pc-rd-card-s">{isWeekly ? `weeks of ${monthLabel(month)}` : 'last 6 months'}</span>
          </div>
          {trend.some(t => t.gmv || t.ad) ? (
            <div style={{ height: 250 }}>
              <ResponsiveContainer>
                <AreaChart data={trend} margin={{ top: 8, right: 12, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rdGmv" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1259C3" stopOpacity={0.45} /><stop offset="100%" stopColor="#1259C3" stopOpacity={0} /></linearGradient>
                    <linearGradient id="rdAd" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#E8862E" stopOpacity={0.4} /><stop offset="100%" stopColor="#E8862E" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eceef1" vertical={false} />
                  <XAxis dataKey="label" stroke="#8b93a1" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#8b93a1" fontSize={11} tickLine={false} axisLine={false} width={48} tickFormatter={(v) => v >= 1000 ? `${Math.round(v / 1000)}k` : v} />
                  <Tooltip formatter={moneyTip} contentStyle={{ borderRadius: 10, border: '1px solid #e9ecef', fontSize: 12 }} />
                  <Area type="monotone" dataKey="gmv" name="GMV" stroke="#1259C3" strokeWidth={2.5} fill="url(#rdGmv)"
                    dot={{ r: fewPoints ? 5 : 3, strokeWidth: 0, fill: '#1259C3' }} activeDot={{ r: 6 }}>
                    {fewPoints && <LabelList dataKey="gmv" position="top" offset={12} formatter={lblMoney} style={{ fontSize: 11, fontWeight: 800, fill: '#1259C3' }} />}
                  </Area>
                  <Area type="monotone" dataKey="ad" name="Ad spend" stroke="#E8862E" strokeWidth={2.5} fill="url(#rdAd)"
                    dot={{ r: fewPoints ? 5 : 3, strokeWidth: 0, fill: '#E8862E' }} activeDot={{ r: 6 }}>
                    {fewPoints && <LabelList dataKey="ad" position="bottom" offset={12} formatter={lblMoney} style={{ fontSize: 11, fontWeight: 800, fill: '#E8862E' }} />}
                  </Area>
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : <div className="pc-rd-chart-empty">No GMV logged for this period yet.</div>}
          <div className="pc-rd-legend"><span className="pc-rd-leg"><i style={{ background: '#1259C3' }} />GMV</span><span className="pc-rd-leg"><i style={{ background: '#E8862E' }} />Ad spend</span></div>
        </div>

        <div className="pc-rd-card">
          <div className="pc-rd-card-h"><span className="pc-rd-card-t">Creator payment mix</span></div>
          {payMix.length ? (
            <div style={{ height: 250 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={payMix} dataKey="value" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={2} stroke="none">
                    {payMix.map((s, i) => <Cell key={i} fill={s.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e9ecef', fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : <div className="pc-rd-chart-empty">No creators yet.</div>}
          <div className="pc-rd-legend">
            {payMix.map((s, i) => <span className="pc-rd-leg" key={i}><i style={{ background: s.color }} />{s.name} · {s.value}</span>)}
          </div>
        </div>
      </div>

      {/* lower: creators list + insights */}
      <div className="pc-rd-lower">
        <div className="pc-rd-card">
          <div className="pc-rd-card-h">
            <span className="pc-rd-card-t">Creators &amp; videos</span>
            <span className="pc-rd-card-s">top {creatorRows.length} by GMV</span>
          </div>
          <div className="pc-rd-clist">
            <div className="pc-rd-crow pc-rd-crh">
              <span>Creator</span><span>Videos</span><span className="pc-rd-r">GMV</span><span className="pc-rd-r">Status</span>
            </div>
            {creatorRows.map(({ c, del, ag, gmv }) => {
              const pct = ag > 0 ? Math.min(100, Math.round((del / ag) * 100)) : (del > 0 ? 100 : 0);
              const st = RD_STATUS[c.payment_status] || RD_STATUS.videos_in_progress;
              const b = brandById[c.brand_id];
              return (
                <div className="pc-rd-crow" key={c.id}>
                  <span className="pc-rd-cname">
                    <span className="pc-rd-ava" style={{ background: getGradient(c.name) }}>{initial(c.name)}</span>
                    <span style={{ minWidth: 0 }}>
                      <span className="pc-rd-cn">{c.name}</span>
                      <span className="pc-rd-cb">{b?.name || '—'}</span>
                    </span>
                  </span>
                  <span className="pc-rd-vid">
                    <span className="pc-rd-vid-top">{del}<i>/{ag || del || 0}</i></span>
                    <span className="pc-rd-track"><span className="pc-rd-fill" style={{ width: pct + '%', background: st.color }} /></span>
                  </span>
                  <span className="pc-rd-r pc-rd-gmv">{gmv > 0 ? fmt$(gmv) : '—'}</span>
                  <span className="pc-rd-r"><span className={`pc-rd-pill ${st.cls}`}>{st.label}</span></span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="pc-rd-card">
          <div className="pc-rd-card-h"><span className="pc-rd-card-t">Insights</span></div>
          {insights.length ? (
            <div className="pc-rd-ins">
              {insights.map((ins, i) => (
                <div className={`pc-rd-in ${ins.tone}`} key={i}>
                  <span className="pc-rd-in-ic"><i className={`bi ${ins.icon}`} /></span>
                  <span className="pc-rd-in-txt">{ins.text}</span>
                </div>
              ))}
            </div>
          ) : <div className="pc-rd-chart-empty">No insights yet.</div>}
        </div>
      </div>

      {approvalsOpen && (
        <div className="pc-overlay" onClick={() => setApprovalsOpen(false)}>
          <div className="pc-modal pc-appr-modal" onClick={e => e.stopPropagation()}>
            <div className="pc-appr-head">
              <h3>Actions Needed</h3>
              <button className="pc-iconbtn" onClick={() => setApprovalsOpen(false)} aria-label="Close">✕</button>
            </div>
            {approvals.total === 0 ? (
              <div className="pc-empty"><div className="pc-empty-icon">✅</div><h3>All clear</h3><p>Nothing needs your action right now.</p></div>
            ) : (
              <div className="pc-appr-list">
                {approvals.pays.length > 0 && <div className="pc-appr-group">Payments to release ({approvals.pays.length})</div>}
                {approvals.pays.map(({ c, amount }) => (
                  <div className="pc-appr-item" key={'p' + c.id}>
                    <span className="pc-rd-ava" style={{ background: getGradient(c.name) }}>{initial(c.name)}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="pc-rd-cn">{c.name}</span>
                      <span className="pc-rd-cb">{brandById[c.brand_id]?.name || '—'}</span>
                    </span>
                    <span className="pc-appr-amt">{fmt$(amount)}</span>
                    <span className="pc-rd-pill pend">Pay</span>
                  </div>
                ))}
                {approvals.auths.length > 0 && <div className="pc-appr-group">Ad codes to authorise ({approvals.auths.length})</div>}
                {approvals.auths.map(({ c, n }) => (
                  <div className="pc-appr-item" key={'a' + c.id}>
                    <span className="pc-rd-ava" style={{ background: getGradient(c.name) }}>{initial(c.name)}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="pc-rd-cn">{c.name}</span>
                      <span className="pc-rd-cb">{brandById[c.brand_id]?.name || '—'}</span>
                    </span>
                    <span className="pc-appr-amt">{n} code{n === 1 ? '' : 's'}</span>
                    <span className="pc-rd-pill prog">Authorise</span>
                  </div>
                ))}
              </div>
            )}
            <div className="pc-modal-actions" style={{ marginTop: 14 }}>
              <button className="pc-btn pc-btn-primary" onClick={() => setApprovalsOpen(false)}>Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RKpi({ icon, color, label, value, sub }) {
  return (
    <div className="pc-rk" style={{ ['--rk']: color }}>
      <span className="pc-rk-ic" style={{ background: `${color}1a`, color }}><i className={`bi ${icon}`} /></span>
      <div className="pc-rk-body">
        <div className="pc-rk-label">{label}</div>
        <div className="pc-rk-value">{value}</div>
        {sub && <div className="pc-rk-sub">{sub}</div>}
      </div>
    </div>
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
// Weekly entries live in a nested `monthly.weeks` map (key = week-start YYYY-MM-DD)
// so they never collide with the YYYY-MM monthly keys or the top-level `l30` value.
function sumWeekly(c, field) {
  const w = (c.monthly || {}).weeks || {};
  let t = 0;
  Object.keys(w).forEach(k => { t += Number(w[k]?.[field]) || 0; });
  return t;
}

// Monthly | Weekly segmented toggle, shared by the brand list and the matrix.
function PerfModeToggle({ mode, setMode }) {
  return (
    <div className="pc-seg" role="tablist" aria-label="Performance period">
      <button type="button" role="tab" aria-selected={mode === 'monthly'}
        className={`pc-seg-btn ${mode === 'monthly' ? 'active' : ''}`} onClick={() => setMode('monthly')}>Monthly</button>
      <button type="button" role="tab" aria-selected={mode === 'weekly'}
        className={`pc-seg-btn ${mode === 'weekly' ? 'active' : ''}`} onClick={() => setMode('weekly')}>Weekly</button>
    </div>
  );
}

function PerformanceView({ brands, creators, brandById, month, reportWeeks, reportAnchors, onCreateWeek, onSaveMonthly }) {
  const [bId, setBId] = useState(null);
  // Period granularity for GMV / Ad tracking — persisted across the drilldown.
  const [mode, setMode] = useState('weekly'); // 'monthly' | 'weekly'
  const byBrand = useMemo(() => {
    const m = {};
    creators.forEach(c => { (m[c.brand_id] = m[c.brand_id] || []).push(c); });
    return m;
  }, [creators]);
  if (bId && brandById[bId]) {
    return <BrandMatrix brand={brandById[bId]} creators={byBrand[bId] || []} mode={mode} setMode={setMode}
      month={month} brandReportWeeks={(reportWeeks || {})[bId] || []} brandAnchor={(reportAnchors || {})[bId] || null}
      onCreateWeek={onCreateWeek} onBack={() => setBId(null)} onSaveMonthly={onSaveMonthly} />;
  }
  return <PerfBrandList brands={brands} byBrand={byBrand} mode={mode} setMode={setMode} onOpen={setBId} />;
}

function PerfBrandList({ brands, byBrand, mode, setMode, onOpen }) {
  setReportCurrency(uniformCurrency(brands)); // multi-brand list → common currency or $
  const [q, setQ] = useState('');
  const sumFn = mode === 'weekly' ? sumWeekly : sumMonthly;
  let rows = brands.map(b => {
    const cs = byBrand[b.id] || [];
    const names = new Set(cs.map(c => (c.name || '').trim().toLowerCase()).filter(Boolean));
    let gmv = 0, ad = 0, l30 = 0;
    cs.forEach(c => { gmv += sumFn(c, 'gmv'); ad += sumFn(c, 'adSpent'); l30 += Number((c.monthly || {}).l30) || 0; });
    return { id: b.id, name: b.name, creators: names.size, gmv, ad, l30 };
  }).filter(r => r.creators > 0 || r.gmv > 0);
  if (q.trim()) rows = rows.filter(r => r.name.toLowerCase().includes(q.trim().toLowerCase()));
  rows.sort((a, b) => b.gmv - a.gmv || a.name.localeCompare(b.name));
  return (
    <>
      <div className="pc-toolbar">
        <input className="pc-search" placeholder="Search brands…" value={q} onChange={e => setQ(e.target.value)} />
        <PerfModeToggle mode={mode} setMode={setMode} />
        <span className="pc-count-pill">{rows.length} brand{rows.length === 1 ? '' : 's'} · {mode === 'weekly' ? 'weekly' : 'monthly'} GMV</span>
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

function BrandMatrix({ brand, creators, mode, setMode, month, brandReportWeeks, brandAnchor, onCreateWeek, onBack, onSaveMonthly, monthNav = null }) {
  setReportCurrency(brand && brand.currency); // single brand → its money symbol
  const isWeekly = mode === 'weekly';
  const [creating, setCreating] = useState(false);
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
  // Build normalized period columns: { key, label, title }. Monthly = every month
  // since onboarding; weekly = ONLY the weeks that exist in this brand's weekly
  // reports (week_start..week_end), filtered to the selected month (a report belongs
  // to the month of its week_start, matching the reporting system).
  const periods = useMemo(() => {
    if (isWeekly) {
      return (brandReportWeeks || [])
        .filter(w => String(w.start).slice(0, 7) === month)
        .map(w => ({ key: w.start, end: w.end, label: rangeShort(w.start, w.end), title: rangeLong(w.start, w.end) }));
    }
    return months.map(m => ({ key: m, end: null, label: monthShort(m), title: monthShort(m) }));
  }, [isWeekly, brandReportWeeks, month, months]);
  const weeklyEmpty = isWeekly && periods.length === 0;
  const periodNoun = isWeekly ? 'week' : 'month';

  // "Create next weekly report" — anchor + existing weeks define the next window.
  const effectiveAnchor = brandAnchor
    || ((brandReportWeeks || []).length ? brandReportWeeks.map(w => w.start).slice().sort()[0] : null);
  const nextWindow = useMemo(() => {
    if (!effectiveAnchor) return null;
    const existing = new Set((brandReportWeeks || []).map(w => w.start));
    let start = effectiveAnchor, wn = 1;
    while (existing.has(start)) { start = addDaysISO(start, 7); wn++; }
    return { start, end: addDaysISO(start, 6), week_number: wn };
  }, [effectiveAnchor, brandReportWeeks]);
  const firstTime = isWeekly && (brandReportWeeks || []).length === 0 && !effectiveAnchor;
  async function createNext() {
    setCreating(true);
    try { await onCreateWeek(brand.id); } finally { setCreating(false); }
  }
  // Weekly headers show a start–end range, so give those columns a touch more width.
  const colW = isWeekly ? '84px' : '74px';
  const tpl = `160px 110px 88px ${periods.map(() => `${colW} ${colW}`).join(' ')} 84px 96px 96px`;

  // ── monthly cell read/write (YYYY-MM keys on the jsonb root) ──
  function commitMonth(c, m, field, raw) {
    const num = raw === '' ? undefined : (Number(raw) || 0);
    const cur = c.monthly || {};
    const cell = { ...(cur[m] || {}) };
    if (!num) delete cell[field]; else cell[field] = num;
    const next = { ...cur, [m]: cell };
    if (cell.gmv == null && cell.adSpent == null) delete next[m];
    onSaveMonthly(c.id, next);
  }
  // ── weekly cell read/write (nested under monthly.weeks, keyed by cadence week-start) ──
  function commitWeek(c, wk, field, raw) {
    const num = raw === '' ? undefined : (Number(raw) || 0);
    const cur = c.monthly || {};
    const wks = { ...(cur.weeks || {}) };
    const cell = { ...(wks[wk] || {}) };
    if (!num) delete cell[field]; else cell[field] = num;
    if (cell.gmv == null && cell.adSpent == null) delete wks[wk]; else wks[wk] = cell;
    const next = { ...cur, weeks: wks };
    if (Object.keys(wks).length === 0) delete next.weeks;
    onSaveMonthly(c.id, next);
  }
  const readCell = (c, key, field) => isWeekly
    ? ((c.monthly || {}).weeks || {})[key]?.[field]
    : (c.monthly || {})[key]?.[field];
  const commitCell = (c, key, field, v) => isWeekly ? commitWeek(c, key, field, v) : commitMonth(c, key, field, v);
  // A period is locked (read-only) if it ends before the creator was onboarded —
  // i.e. only the onboarding period and everything after it is editable.
  const isLocked = (c, p) => {
    const onb = c.onboarded_on;
    if (!onb) return false;
    if (isWeekly) return (p.end || addDaysISO(p.key, 6)) < onb;  // whole week before onboarding
    return p.key < monthKey(onb);                                 // month before onboarding month
  };

  function commitL30(c, raw) {
    const num = raw === '' ? undefined : (Number(raw) || 0);
    const next = { ...(c.monthly || {}) };
    if (!num) delete next.l30; else next.l30 = num;
    onSaveMonthly(c.id, next);
  }

  // Totals: monthly sums every month; weekly sums only the visible month's weeks.
  const weekKeys = periods.map(p => p.key);
  const sumFn = isWeekly
    ? (c, field) => { const w = (c.monthly || {}).weeks || {}; return weekKeys.reduce((t, k) => t + (Number(w[k]?.[field]) || 0), 0); }
    : (c, field) => sumMonthly(c, field);
  let grandGmv = 0, grandAd = 0;
  canon.forEach(c => { grandGmv += sumFn(c, 'gmv'); grandAd += sumFn(c, 'adSpent'); });
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
      {onBack && <button className="pc-back" onClick={onBack}>‹ All brands</button>}
      <div className="pc-dd-head">
        <span className="pc-ava" style={{ background: getGradient(brand.name) }}>{initial(brand.name)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="pc-dd-title">{brand.name}</h2>
          <div className="pc-dd-sub">Performance · {canon.length} creator{canon.length === 1 ? '' : 's'}{isWeekly
            ? ` · ${monthLabel(month)} · ${periods.length} weekly report${periods.length === 1 ? '' : 's'}`
            : ` · ${periods.length} ${periodNoun}${periods.length === 1 ? '' : 's'} tracked`}</div>
        </div>
        <div className="pc-dd-actions">
          {monthNav}
          {isWeekly && nextWindow && (
            <button className="pc-btn pc-btn-primary pc-btn-sm" disabled={creating} onClick={createNext}
              title={`Create the next weekly report (${rangeLong(nextWindow.start, nextWindow.end)})`}>
              {creating ? 'Creating…' : `+ Week ${nextWindow.week_number} · ${rangeShort(nextWindow.start, nextWindow.end)}`}
            </button>
          )}
          <PerfModeToggle mode={mode} setMode={setMode} />
        </div>
      </div>
      {firstTime ? (
        <FirstReportPanel brand={brand} onCreate={(date) => onCreateWeek(brand.id, date)} />
      ) : weeklyEmpty ? (
        <div className="pc-card"><div className="pc-empty"><div className="pc-empty-icon">📅</div>
          <h3>No weekly reports for {monthLabel(month)}</h3>
          <p>Weekly performance columns mirror this brand's weekly reports.{nextWindow ? ` The next report is ${rangeLong(nextWindow.start, nextWindow.end)} — create it to start logging.` : ''}</p>
          {nextWindow && <button className="pc-btn pc-btn-primary" disabled={creating} onClick={createNext} style={{ marginTop: 6 }}>{creating ? 'Creating…' : `+ Create Week ${nextWindow.week_number} (${rangeShort(nextWindow.start, nextWindow.end)})`}</button>}
        </div></div>
      ) : canon.length === 0 ? (
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
                  {periods.map(p => (
                    <div key={p.key} className="pc-mxh-month" style={{ gridColumn: 'span 2' }} title={p.title}>
                      <span className="pc-mxh-mname">{p.label}</span>
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
                      {periods.map(p => {
                        const locked = isLocked(c, p);
                        return (
                          <React.Fragment key={p.key}>
                            <MatrixCell value={readCell(c, p.key, 'gmv')} locked={locked} onCommit={v => commitCell(c, p.key, 'gmv', v)} />
                            <MatrixCell value={readCell(c, p.key, 'adSpent')} ad locked={locked} onCommit={v => commitCell(c, p.key, 'adSpent', v)} />
                          </React.Fragment>
                        );
                      })}
                      <div className="pc-mx-num strong">{videosByName[(c.name || '').trim().toLowerCase()] || 0}</div>
                      <div className="pc-mx-num strong pc-green">{fmt$(sumFn(c, 'gmv'))}</div>
                      <div className="pc-mx-num strong pc-red">{fmt$(sumFn(c, 'adSpent'))}</div>
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

/* ════════════════════════════════════════════════════════════
   Brand Performance pane — the Performance matrix for ONE brand, reused outside the
   handler workspace (Brand Detail → Paid Collab tab) so Bob / assigned APCs can view
   AND edit GMV (monthly or weekly) exactly like the handler does. It loads its own
   creators + weekly-report weeks/anchor for the brand and writes the `monthly` jsonb
   via store.setCreatorMonthly (a SECURITY DEFINER RPC → APCs can write too). Editing
   is gated by `canEdit`; the host only mounts this when the viewer may edit.
════════════════════════════════════════════════════════════ */
export function BrandPerformancePane({ brandId, brandName, canEdit = false, currency = null }: any) {
  const { user } = useAuth();
  const [creators, setCreators] = useState([]);
  const [month, setMonth] = useState(thisMonthKey());
  const [mode, setMode] = useState('weekly'); // 'monthly' | 'weekly'
  const [reportWeeks, setReportWeeks] = useState([]); // [{ start, end }]
  const [anchor, setAnchor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('handler_collab_creators').select('*').eq('brand_id', brandId);
      if (error) throw error;
      setCreators(data || []);
      const rw = await store.loadBrandReportWeeks([brandId]).catch(() => ({}));
      setReportWeeks(rw[brandId] || []);
      const an = await store.loadBrandReportAnchors([brandId]).catch(() => ({}));
      setAnchor(an[brandId] || null);
      setErr('');
    } catch (e) {
      setErr(e.message || 'Failed to load performance');
    } finally {
      setLoading(false);
    }
  }, [brandId]);
  useEffect(() => { setLoading(true); load(); }, [load]);

  // Save a creator's monthly/weekly GMV map (optimistic, persist via the RPC).
  const saveMonthly = useCallback((id, monthly) => {
    if (!canEdit) return;
    setCreators(prev => prev.map(c => (c.id === id ? { ...c, monthly } : c)));
    store.setCreatorMonthly(id, monthly).catch(e => { alert(`Couldn't save: ${e.message}`); load(); });
  }, [canEdit, load]);

  // Create the next weekly report for this brand (mirrors the workspace flow). On the
  // very first report, firstAnchor seeds the brand's weekly anchor.
  const createWeek = useCallback(async (bId, firstAnchor) => {
    if (!user?.id) return;
    const existingArr = (reportWeeks || []).map(w => w.start);
    const existing = new Set(existingArr);
    let a = anchor || (existingArr.length ? existingArr.slice().sort()[0] : null) || firstAnchor || null;
    if (!a) { alert('Pick an anchor (week-1 start) date first.'); return; }
    if (firstAnchor && !anchor && existingArr.length === 0) {
      try { await store.setBrandWeeklyAnchor(bId, firstAnchor); }
      catch (e) { alert(`Couldn't set anchor: ${e.message}`); return; }
      setAnchor(firstAnchor); a = firstAnchor;
    }
    let start = a, wn = 1;
    while (existing.has(start)) { start = addDaysISO(start, 7); wn++; }
    const end = addDaysISO(start, 6);
    try { await store.createWeeklyReport(bId, user.id, start, end, wn); }
    catch (e) { alert(`Couldn't create weekly report: ${e.message}`); return; }
    await load();
    setMonth(start.slice(0, 7));
  }, [reportWeeks, anchor, user, load]);

  if (loading) return <div className="pc-app" style={{ minHeight: 0, background: 'transparent' }}><div className="pc-spinner" /></div>;

  // Only the weekly view is month-scoped (which weeks show); give it a compact month nav.
  const monthNav = mode === 'weekly' ? (
    <div className="pc-monthnav">
      <button className="pc-mn-arrow" aria-label="Previous month" onClick={() => setMonth(addMonth(month, -1))}>‹</button>
      <label className="pc-monthpicker" title="Pick a month">
        <span className="pc-monthpicker-ico">📅</span>
        <input type="month" value={month} onChange={e => { if (e.target.value) setMonth(e.target.value); }} />
      </label>
      <button className="pc-mn-arrow" aria-label="Next month" onClick={() => setMonth(addMonth(month, 1))}>›</button>
    </div>
  ) : null;

  return (
    <div className="pc-app" style={{ minHeight: 0, background: 'transparent' }}>
      {err && <div className="pc-banner" style={{ background: 'var(--pc-error-bg)', color: 'var(--pc-error-fg)' }}><span>⚠️</span><span>{err}</span></div>}
      <BrandMatrix
        brand={{ id: brandId, name: brandName, currency }}
        creators={creators}
        mode={mode} setMode={setMode}
        month={month}
        brandReportWeeks={reportWeeks}
        brandAnchor={anchor}
        onCreateWeek={createWeek}
        onSaveMonthly={saveMonthly}
        monthNav={monthNav}
      />
    </div>
  );
}

// First-time weekly setup: the brand has no weekly reports/anchor yet. Pick week-1's
// start date → creates the first weekly report and seeds the brand's weekly anchor.
function FirstReportPanel({ brand, onCreate }) {
  const [d, setD] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() { if (!d) return; setBusy(true); try { await onCreate(d); } finally { setBusy(false); } }
  return (
    <div className="pc-card"><div className="pc-empty">
      <div className="pc-empty-icon">📅</div>
      <h3>No weekly reports yet</h3>
      <p>Pick the start date of <b>week 1</b> for <b>{brand.name}</b>. New weeks then auto-continue from here, and this date becomes the brand's weekly-report anchor.</p>
      <div className="pc-anchor-row">
        <input type="date" className="pc-input" value={d} onChange={e => setD(e.target.value)} />
        <button className="pc-btn pc-btn-primary" disabled={!d || busy} onClick={go}>{busy ? 'Creating…' : 'Create first weekly report'}</button>
      </div>
      {d && <div className="pc-anchor-hint">Week 1: <b>{rangeLong(d, addDaysISO(d, 6))}</b></div>}
    </div></div>
  );
}

function MatrixCell({ value, onCommit, ad, l30, locked }) {
  const [v, setV] = useState(value == null ? '' : String(value));
  useEffect(() => { setV(value == null ? '' : String(value)); }, [value]);
  // Periods before the creator's onboarding are read-only — show the value (if any),
  // otherwise a muted lock, and never accept input.
  if (locked) {
    return (
      <div className={`pc-mx-input pc-mx-locked ${ad ? 'ad' : ''}`}
        title="Before this creator was onboarded" aria-disabled="true" onClick={e => e.stopPropagation()}>
        {value == null || value === '' ? (
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
        ) : String(value)}
      </div>
    );
  }
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

// Read-only chip shown once a share-link client has marked this creator's payment
// as done. Soft signal for the handler to cross-check, then set "Payment Sent".
function ClientPaidBadge({ c }) {
  if (!c.client_paid_confirmed_at || c.payment_status === 'paid') return null;
  const who = c.client_paid_confirmed_name ? ` by ${c.client_paid_confirmed_name}` : '';
  return (
    <span className="pc-badge pc-clientpaid" title={`Client marked this payment as done${who}. Cross-check, then set Payment Sent.`}>
      <i className="bi bi-cash-coin" />
      <span className="pc-clientpaid-txt">Client marked paid</span>
    </span>
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
    // once every video row has a URL: stamp completed-on date + advance Videos in Progress / Follow-up → Payment Pending
    const allFilled = next.length > 0 && next.every(r => (r.video || '').trim());
    if (allFilled) {
      if (c.payment_status === 'videos_in_progress' || c.payment_status === 'follow_up') patch.payment_status = 'pending';
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
        {(c.paypal || c.zelle) && (
          <div className="pc-vx-payouts">
            {c.paypal && <PayoutDetail kind="pp" value={c.paypal} />}
            {c.zelle && <PayoutDetail kind="zl" value={c.zelle} />}
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
    // Contract §2 completion window (days after sample delivery); blank = auto.
    deliverable_days: c.deliverable_days != null ? String(c.deliverable_days) : '',
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
          <div className="pc-field2">
            <div className="pc-field"><label>Onboarded on</label><input className="pc-input" type="date" value={f.onboarded_on} onChange={e => set('onboarded_on', e.target.value)} /></div>
            <div className="pc-field">
              <label>Deliverable deadline (days)</label>
              <input className="pc-input" type="number" inputMode="numeric" min="1"
                placeholder={`auto — ${(parseInt(f.videos_count, 10) || 0) < 6 ? 10 : 14} days`}
                value={f.deliverable_days} onChange={e => set('deliverable_days', e.target.value)} />
              <div className="pc-sig-hint">Contract §2 — days after the sample is delivered. Leave blank for the automatic rule.</div>
            </div>
          </div>
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

/* ════════════════════════════════════════════════════════════
   Contract template — per-handler signature block settings.
   Only the Brand Representative name + signature are configurable;
   the agreement wording stays code-generated (see contractPdf.ts).
════════════════════════════════════════════════════════════ */
function ContractTemplateModal({ onClose }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [repName, setRepName] = useState('');
  const [savedSigUrl, setSavedSigUrl] = useState('');   // already stored in the DB
  const [pendingSig, setPendingSig] = useState(null);   // uploaded SVG → PNG data URL, not yet saved
  const [removeSig, setRemoveSig] = useState(false);
  const [padDirty, setPadDirty] = useState(false);      // something drawn on the pad
  const padRef = useRef(null);
  const drawing = useRef(false);

  useEffect(() => {
    let alive = true;
    store.getContractSettings()
      .then(s => { if (!alive) return; setRepName(s?.rep_name || ''); setSavedSigUrl(s?.signature_url || ''); })
      .catch(e => { if (alive) setErr(e.message || 'Could not load settings'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  function padPos(e) {
    const c = padRef.current, r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  }
  function padDown(e) {
    e.preventDefault();
    const c = padRef.current;
    try { c.setPointerCapture(e.pointerId); } catch { }
    const ctx = c.getContext('2d');
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1B2430';
    const p = padPos(e);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.1, p.y); ctx.stroke();
    drawing.current = true;
    setPadDirty(true); setPendingSig(null); setRemoveSig(false);
  }
  function padMove(e) {
    if (!drawing.current) return;
    const ctx = padRef.current.getContext('2d');
    const p = padPos(e);
    ctx.lineTo(p.x, p.y); ctx.stroke();
  }
  function padUp() { drawing.current = false; }
  function clearPad() {
    const c = padRef.current;
    if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
    setPadDirty(false);
  }

  async function onUploadSvg(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await svgToPngDataUrl(file);
      setPendingSig(dataUrl); setRemoveSig(false); clearPad();
    } catch (ex) { setErr(`Could not read that SVG: ${ex.message || ''}`); }
  }

  // Priority: uploaded SVG > pad drawing > existing (unless removed).
  const previewSig = pendingSig || (!padDirty && !removeSig && savedSigUrl) || null;

  async function save() {
    setSaving(true); setErr('');
    try {
      let signature_url = removeSig ? '' : savedSigUrl;
      let dataUrl = pendingSig;
      if (!dataUrl && padDirty && padRef.current) dataUrl = padRef.current.toDataURL('image/png');
      if (dataUrl) {
        const blob = await (await fetch(dataUrl)).blob();
        const { data: u } = await supabase.auth.getUser();
        if (!u?.user?.id) throw new Error('Not signed in');
        signature_url = await uploadSignature(u.user.id, blob);
      }
      await store.saveContractSettings({ rep_name: repName.trim(), signature_url });
      onClose();
    } catch (ex) {
      setErr(ex.message || 'Save failed');
      setSaving(false);
    }
  }

  return (
    <div className="pc-overlay" onClick={onClose}>
      <div className="pc-modal pc-modal-scroll" onClick={e => e.stopPropagation()}>
        <h3>Contract template</h3>
        <div className="pc-modal-sub">Signature block on every contract PDF you download</div>
        {loading ? <div className="pc-spinner" /> : (
          <div className="pc-modal-body">
            <div className="pc-field">
              <label>Representative name</label>
              <input className="pc-input" placeholder="Who signs on behalf of the brand" value={repName} onChange={e => setRepName(e.target.value)} />
            </div>
            <div className="pc-field">
              <label>Signature</label>
              {previewSig && (
                <div className="pc-sig-preview">
                  <img src={previewSig} alt="Saved signature" />
                  <span className="pc-sig-preview-l">{pendingSig ? 'New signature (not saved yet)' : 'Current signature'}</span>
                  <button type="button" className="pc-multix" title="Remove signature"
                    onClick={() => { setPendingSig(null); setRemoveSig(true); }}>×</button>
                </div>
              )}
              <canvas ref={padRef} className="pc-sigpad" width={560} height={170}
                onPointerDown={padDown} onPointerMove={padMove} onPointerUp={padUp} onPointerLeave={padUp} />
              <div className="pc-sig-actions">
                <span className="pc-sig-hint">Draw above with mouse / finger, or</span>
                <label
                  className="pc-btn pc-btn-ghost pc-btn-sm"
                  style={{
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    outline: '1px solid #b2b2b2'
                  }}
                >
                  Upload SVG
                  <input type="file" accept=".svg,image/svg+xml" style={{ display: 'none' }} onChange={onUploadSvg} />
                </label>

                {padDirty && <button type="button" className="pc-btn pc-btn-ghost pc-btn-sm" onClick={clearPad}>Clear drawing</button>}
              </div>
            </div>
            <div className="pc-tplprev">
              <div className="pc-tplprev-h">Preview — Brand Representative block</div>
              <div><b>Brand:</b> <span className="pc-handle">(brand on the deal)</span></div>
              {repName.trim() && <div><b>Representative:</b> {repName.trim()}</div>}
              <div className="pc-tplprev-sig"><b>Signature:</b> {padDirty
                ? <span className="pc-handle">your drawing above</span>
                : previewSig ? <img src={previewSig} alt="" /> : <span className="pc-handle">____________</span>}</div>
              <div><b>Date:</b> <span className="pc-handle">auto (onboarding date)</span></div>
            </div>
            {err && <div className="pc-formerr">{err}</div>}
          </div>
        )}
        <div className="pc-modal-actions">
          <button className="pc-btn pc-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="pc-btn pc-btn-primary" onClick={save} disabled={loading || saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
