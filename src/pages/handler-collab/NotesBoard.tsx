// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import DOMPurify from 'dompurify';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthContext';
import * as store from './store';
import RichTextEditor from '../../components/RichTextEditor';
import { requestNotificationPermission } from '../../notifications/swSetup';

/* ════════════════════════════════════════════════════════════
   NOTES — Google Keep-style board for the handler workspace.
   Global notes (handler_notes): colored cards, free-form labels,
   optional brand (brand-wise) + program/month (program-wise)
   links, and reminders that fire notifications. The label
   sidebar (left) is the "labels shown aside" filter rail.
════════════════════════════════════════════════════════════ */

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function monthLabel(key) {
  if (!key) return '—';
  const [y, m] = String(key).split('-');
  return `${MONTHS[parseInt(m, 10) - 1] || '?'} ${y}`;
}
function thisMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Role-based card colours (the manual colour picker is gone). A note you OWN is
// white; a note shared WITH you is tinted by the role of whoever shared it
// (owner_role / owner_is_superbob come from list_visible_notes). The legacy
// per-note `color` column is ignored.
const ROLE_COLORS = {
  super_boss:  '#FEEFC3', // sand / gold
  bob:         '#E8F0FE', // sky
  team_lead:   '#E6F4EA', // sage
  apc:         '#F3E8FD', // lilac
  ads_manager: '#E0F2F1', // mint
};
const ROLE_LABEL = {
  super_boss: 'Super Boss', bob: 'Boss', team_lead: 'Team Lead',
  apc: 'APC', ads_manager: 'Ads Manager',
};
const OWN_BG = '#FFFFFF';
const FALLBACK_BG = '#F1F3F4';
// Which role bucket owns this note (super_boss wins over a plain bob owner).
function ownerRoleKey(n) {
  if (n?.owner_is_superbob) return 'super_boss';
  return n?.owner_role || null;
}
function isOwnNote(n, viewerId) {
  return n?.is_owner ?? (!n?.owner_id || (viewerId && n?.owner_id === viewerId));
}
function noteColorBg(n, viewerId) {
  if (isOwnNote(n, viewerId)) return OWN_BG;
  return ROLE_COLORS[ownerRoleKey(n)] || FALLBACK_BG;
}
// The role groups a note can be shared with (also used for the legend).
const ROLE_TARGETS = [
  { role: 'super_boss', label: 'Super Boss' },
  { role: 'bob',        label: 'Boss' },
  { role: 'team_lead',  label: 'Team Leads' },
  { role: 'apc',        label: 'APCs' },
  { role: 'ads_manager', label: 'Ads Managers' },
];
const INTERNAL_ROLES = ['bob', 'team_lead', 'apc', 'ads_manager'];
const shareTokenKey = (t) =>
  t.kind === 'all' ? 'all' : t.kind === 'team' ? `team:${t.team}` : `role:${t.role}`;

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#6366F1,#8B5CF6)', 'linear-gradient(135deg,#EC4899,#F43F5E)',
  'linear-gradient(135deg,#14B8A6,#06B6D4)', 'linear-gradient(135deg,#F59E0B,#EF4444)',
  'linear-gradient(135deg,#10B981,#059669)', 'linear-gradient(135deg,#3B82F6,#2563EB)',
];
const getGradient = (name) => AVATAR_GRADIENTS[(name || '?').charCodeAt(0) % AVATAR_GRADIENTS.length];

// "2026-06-29T14:30" (datetime-local) <-> ISO. Stored as timestamptz (ISO).
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v) { return v ? new Date(v).toISOString() : null; }
// Body is rich text (HTML from Quill). Strip tags for emptiness checks + search.
function htmlToText(html) {
  return (html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}
function reminderLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const opts = sameDay
    ? { hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  return d.toLocaleString(undefined, opts);
}

// The board loads via list_visible_notes() — the signed-in user's OWN notes +
// notes shared WITH them (own + shared, with owner role/name for colouring), so
// Bob's read-all RLS no longer floods it.
// creators: raw handler_collab_creators rows (all months) — enables the
// "creator-wise" note link (select in the editor, chips, sidebar group).
export default function NotesBoard({ brands = [], brandById = {}, creators = [], month }) {
  const { user, profile } = useAuth();
  const viewerId = user?.id;
  const viewerRole = profile?.role;
  const viewerIsSuperbob = !!profile?.is_superbob;
  // A note is editable only by its owner. is_owner comes from list_visible_notes;
  // fall back to the owner_id comparison for rows loaded another way.
  const canEditNote = useCallback(
    (n) => isOwnNote(n, viewerId), [viewerId]);
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState({ kind: 'all' }); // {kind, value?}
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState(null); // null | { mode, note }
  const [labelCatalog, setLabelCatalog] = useState([]); // reusable saved labels (mine)
  const [teamLeads, setTeamLeads] = useState([]);        // for the Super Boss "specific team" share
  const busyRef = useRef(false);

  const reload = useCallback(async () => {
    // own + shared-to-me, with owner role/name for colouring + the shared-by chip.
    try { setNotes(await store.loadVisibleNotes()); setErr(''); }
    catch (e) { setErr(e.message || 'Failed to load notes'); }
  }, []);

  // Reusable label catalogue (mine) + Team Leads (Super Boss share picker).
  const reloadLabels = useCallback(async () => {
    if (!viewerId) return;
    try { setLabelCatalog(await store.loadNoteLabels(viewerId)); } catch { /* ignore */ }
  }, [viewerId]);
  useEffect(() => { reloadLabels(); }, [reloadLabels]);
  useEffect(() => {
    if (!viewerIsSuperbob) return;
    supabase.from('profiles').select('id, full_name, email').eq('role', 'team_lead').order('full_name')
      .then(({ data }) => setTeamLeads((data || []).map(p => ({ id: p.id, name: p.full_name || p.email || 'Team Lead' }))));
  }, [viewerIsSuperbob]);
  const onCreateLabel = useCallback(async (name) => {
    try { await store.upsertNoteLabel(name); reloadLabels(); } catch { /* ignore */ }
  }, [reloadLabels]);

  useEffect(() => { (async () => { setLoading(true); await reload(); setLoading(false); })(); }, [reload]);
  useEffect(() => { busyRef.current = !!editor; }, [editor]);

  // (Due-reminder firing runs workspace-wide in HandlerCollabApp, so it works on
  // any tab — not only while the Notes board is mounted.)

  // Live sync across devices/tabs.
  useEffect(() => {
    if (!supabase) return;
    let t = null;
    const ping = () => { if (busyRef.current) return; clearTimeout(t); t = setTimeout(reload, 300); };
    const ch = supabase.channel('pc-notes-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'handler_notes' }, ping)
      .subscribe();
    return () => { clearTimeout(t); try { supabase.removeChannel(ch); } catch {} };
  }, [reload]);

  /* ── optimistic mutations ── */
  const patchLocal = (id, patch) => setNotes(prev => prev.map(n => n.id === id ? { ...n, ...patch } : n));

  // Auto-save: create-or-update without closing. Returns the (real) note id so the
  // composer can switch from insert to update after the first save.
  const persistNote = useCallback(async (payload) => {
    if (payload.id) {
      patchLocal(payload.id, payload);
      try { await store.updateNote(payload.id, stripId(payload)); }
      catch (e) { setErr(e.message || 'Save failed'); }
      return payload.id;
    }
    try {
      const row = await store.createNote(stripId(payload));
      setNotes(prev => [row, ...prev]);
      return row.id;
    } catch (e) { setErr(e.message || 'Save failed'); return null; }
  }, []);

  const togglePin = useCallback(async (n) => {
    patchLocal(n.id, { pinned: !n.pinned });
    try { await store.updateNote(n.id, { pinned: !n.pinned }); } catch { reload(); }
  }, [reload]);

  const setArchived = useCallback(async (n, archived) => {
    patchLocal(n.id, { archived });
    try { await store.updateNote(n.id, { archived }); reload(); } catch { reload(); }
  }, [reload]);

  const doneReminder = useCallback(async (n) => {
    patchLocal(n.id, { reminder_done: true });
    try { await store.updateNote(n.id, { reminder_done: true }); } catch { reload(); }
  }, [reload]);

  const removeNote = useCallback(async (n) => {
    if (!window.confirm('Delete this note?')) return;
    setNotes(prev => prev.filter(x => x.id !== n.id));
    try { await store.deleteNote(n.id); } catch { reload(); }
  }, [reload]);

  /* ── sidebar groups (built from the notes themselves) ── */
  const live = useMemo(() => notes.filter(n => !n.archived), [notes]);
  // Creator lookups: a note links one deal row, but grouping/filtering follows
  // the creator identity across months within the brand (store.creatorNoteKey).
  const creatorById = useMemo(() => {
    const m = {}; creators.forEach(c => { m[c.id] = c; }); return m;
  }, [creators]);
  const creatorKeyById = useMemo(() => {
    const m = {}; creators.forEach(c => { m[c.id] = store.creatorNoteKey(c); }); return m;
  }, [creators]);
  const brandGroups = useMemo(() => {
    const m = {};
    live.forEach(n => { if (n.brand_id) m[n.brand_id] = (m[n.brand_id] || 0) + 1; });
    return Object.entries(m)
      .map(([id, count]) => ({ id, count, name: brandById[id]?.name || 'Brand' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [live, brandById]);
  const creatorGroups = useMemo(() => {
    const m = {};
    live.forEach(n => {
      const row = n.creator_id ? creatorById[n.creator_id] : null;
      if (!row) return;
      const k = creatorKeyById[n.creator_id];
      if (!m[k]) m[k] = { key: k, count: 0, name: row.name || 'Creator' };
      m[k].count += 1;
    });
    return Object.values(m).sort((a, b) => a.name.localeCompare(b.name));
  }, [live, creatorById, creatorKeyById]);
  const programGroups = useMemo(() => {
    const m = {};
    live.forEach(n => { if (n.month) m[n.month] = (m[n.month] || 0) + 1; });
    return Object.entries(m).map(([k, count]) => ({ key: k, count })).sort((a, b) => b.key.localeCompare(a.key));
  }, [live]);
  const labelGroups = useMemo(() => {
    const m = {};
    live.forEach(n => (n.labels || []).forEach(l => { m[l] = (m[l] || 0) + 1; }));
    return Object.entries(m).map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  }, [live]);
  const reminderCount = useMemo(
    () => live.filter(n => n.reminder_at && !n.reminder_done).length, [live]);

  /* ── apply filter + search ── */
  const visible = useMemo(() => {
    let list = notes;
    switch (filter.kind) {
      case 'archive': list = list.filter(n => n.archived); break;
      case 'reminders': list = list.filter(n => !n.archived && n.reminder_at && !n.reminder_done); break;
      case 'pinned': list = list.filter(n => !n.archived && n.pinned); break;
      case 'shared': list = list.filter(n => !n.archived && !isOwnNote(n, viewerId)); break;
      case 'brand': list = list.filter(n => !n.archived && n.brand_id === filter.value); break;
      case 'creator': list = list.filter(n => !n.archived && n.creator_id && creatorKeyById[n.creator_id] === filter.value); break;
      case 'program': list = list.filter(n => !n.archived && n.month === filter.value); break;
      case 'label': list = list.filter(n => !n.archived && (n.labels || []).includes(filter.value)); break;
      default: list = list.filter(n => !n.archived);
    }
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(n =>
      (n.title || '').toLowerCase().includes(q) ||
      htmlToText(n.body).toLowerCase().includes(q) ||
      (n.labels || []).some(l => l.toLowerCase().includes(q)) ||
      (n.creator_id && (creatorById[n.creator_id]?.name || '').toLowerCase().includes(q)));
    // pinned first, then by sort key
    const key = filter.kind === 'reminders'
      ? (n) => new Date(n.reminder_at).getTime()
      : (n) => -new Date(n.updated_at).getTime();
    return [...list].sort((a, b) => (b.pinned - a.pinned) || (key(a) - key(b)));
  }, [notes, filter, search, creatorById, creatorKeyById, viewerId]);

  const sharedCount = useMemo(() => live.filter(n => !isOwnNote(n, viewerId)).length, [live, viewerId]);

  const pinned = visible.filter(n => n.pinned);
  const others = visible.filter(n => !n.pinned);

  const SideItem = ({ active, icon, label, count, onClick }) => (
    <button className={`pc-nside-item ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="pc-nside-ico"><i className={`bi ${icon}`} /></span>
      <span className="pc-nside-label">{label}</span>
      {count != null && count > 0 && <span className="pc-nside-count">{count}</span>}
    </button>
  );
  const isF = (kind, value) => filter.kind === kind && filter.value === value;

  return (
    <div className="pc-notes">
      {/* ── label sidebar (shown aside) ── */}
      <aside className="pc-nside">
        <SideItem active={filter.kind === 'all'} icon="bi-journal-text" label="All notes" count={live.length}
          onClick={() => setFilter({ kind: 'all' })} />
        <SideItem active={filter.kind === 'reminders'} icon="bi-alarm" label="Reminders" count={reminderCount}
          onClick={() => setFilter({ kind: 'reminders' })} />
        <SideItem active={filter.kind === 'pinned'} icon="bi-pin-angle" label="Pinned"
          onClick={() => setFilter({ kind: 'pinned' })} />
        {sharedCount > 0 && (
          <SideItem active={filter.kind === 'shared'} icon="bi-people" label="Shared with me" count={sharedCount}
            onClick={() => setFilter({ kind: 'shared' })} />
        )}

        {brandGroups.length > 0 && <div className="pc-nside-head">Brands</div>}
        {brandGroups.map(g => (
          <SideItem key={g.id} active={isF('brand', g.id)} icon="bi-shop" label={g.name} count={g.count}
            onClick={() => setFilter({ kind: 'brand', value: g.id })} />
        ))}

        {creatorGroups.length > 0 && <div className="pc-nside-head">Creators</div>}
        {creatorGroups.map(g => (
          <SideItem key={g.key} active={isF('creator', g.key)} icon="bi-person" label={g.name} count={g.count}
            onClick={() => setFilter({ kind: 'creator', value: g.key })} />
        ))}

        {programGroups.length > 0 && <div className="pc-nside-head">Programs</div>}
        {programGroups.map(g => (
          <SideItem key={g.key} active={isF('program', g.key)} icon="bi-calendar3" label={monthLabel(g.key)} count={g.count}
            onClick={() => setFilter({ kind: 'program', value: g.key })} />
        ))}

        {labelGroups.length > 0 && <div className="pc-nside-head">Labels</div>}
        {labelGroups.map(g => (
          <SideItem key={g.name} active={isF('label', g.name)} icon="bi-tag" label={g.name} count={g.count}
            onClick={() => setFilter({ kind: 'label', value: g.name })} />
        ))}

        <div className="pc-nside-head">More</div>
        <SideItem active={filter.kind === 'archive'} icon="bi-archive" label="Archive"
          onClick={() => setFilter({ kind: 'archive' })} />

        {/* colour legend — cards are tinted by who shared them */}
        <div className="pc-nside-head">Colours</div>
        <div className="pc-nlegend">
          <div className="pc-nlegend-row"><span className="pc-nlegend-dot" style={{ background: OWN_BG }} /> Mine</div>
          {ROLE_TARGETS.map(r => (
            <div key={r.role} className="pc-nlegend-row">
              <span className="pc-nlegend-dot" style={{ background: ROLE_COLORS[r.role] }} /> {ROLE_LABEL[r.role]}
            </div>
          ))}
        </div>
      </aside>

      {/* ── board ── */}
      <div className="pc-nmain">
        <div className="pc-nbar">
          <div className="pc-nsearch">
            <i className="bi bi-search" />
            <input placeholder="Search notes…" value={search} onChange={e => setSearch(e.target.value)} />
            {search && <button className="pc-nsearch-x" onClick={() => setSearch('')}>×</button>}
          </div>
          <button className="pc-btn pc-btn-primary" onClick={() => setEditor({
            mode: 'add',
            note: { color: 'default', labels: [], brand_id: null, creator_id: null, month: month || null },
          })}><i className="bi bi-plus-lg" />New note</button>
        </div>

        {err && <div className="pc-banner" style={{ background: 'var(--pc-error-bg)', color: 'var(--pc-error-fg)' }}><span>⚠️</span><span>{err}</span></div>}

        {loading ? <div className="pc-spinner" /> : visible.length === 0 ? (
          <div className="pc-nempty">
            <div className="pc-nempty-ico"><i className="bi bi-journal-text" /></div>
            <div className="pc-nempty-t">No notes here yet</div>
            <div className="pc-nempty-s">Capture reminders, label them by brand or program, and they'll show up in the rail on the left.</div>
          </div>
        ) : (
          <>
            {pinned.length > 0 && others.length > 0 && filter.kind === 'all' && <div className="pc-nsection">Pinned</div>}
            <div className="pc-ngrid">
              {pinned.map(n => <NoteCard key={n.id} n={n} viewerId={viewerId} brandById={brandById} creatorById={creatorById} readOnly={!canEditNote(n)}
                onOpen={() => setEditor({ mode: 'edit', note: n })} onPin={() => togglePin(n)}
                onArchive={() => setArchived(n, true)} onDelete={() => removeNote(n)} onDone={() => doneReminder(n)} />)}
            </div>
            {pinned.length > 0 && others.length > 0 && filter.kind === 'all' && <div className="pc-nsection">Others</div>}
            <div className="pc-ngrid">
              {others.map(n => <NoteCard key={n.id} n={n} viewerId={viewerId} brandById={brandById} creatorById={creatorById} readOnly={!canEditNote(n)}
                onOpen={() => setEditor({ mode: 'edit', note: n })} onPin={() => togglePin(n)}
                onArchive={() => setArchived(n, !n.archived)} onDelete={() => removeNote(n)} onDone={() => doneReminder(n)} />)}
            </div>
          </>
        )}
      </div>

      {editor && (
        <NoteEditor editor={editor} brands={brands} brandById={brandById} creators={creators} month={month}
          viewerId={viewerId} viewerRole={viewerRole} viewerIsSuperbob={viewerIsSuperbob}
          teamLeads={teamLeads} labelCatalog={labelCatalog} onCreateLabel={onCreateLabel}
          onLoadShares={store.loadNoteShares} onSaveShares={store.setNoteShares}
          readOnly={editor.mode === 'edit' && !canEditNote(editor.note)}
          onClose={() => setEditor(null)} onPersist={persistNote}
          onDelete={editor.mode === 'edit' && canEditNote(editor.note) ? () => { setEditor(null); removeNote(editor.note); } : null} />
      )}
    </div>
  );
}

function stripId(d) { const { id, ...rest } = d; return rest; }

// First TikTok handle of a creator row, "@name" form (handles URL / multi-account values).
function creatorHandle(c) {
  const first = String(c?.tiktok_handle || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean)[0] || '';
  const h = first.startsWith('http') ? (first.replace(/\/+$/, '').split('/').pop() || '') : first;
  return h ? (h.startsWith('@') ? h : `@${h}`) : '';
}

/* ── one card ── */
function NoteCard({ n, viewerId, brandById, creatorById = {}, onOpen, onPin, onArchive, onDelete, onDone, readOnly = false }) {
  const overdue = n.reminder_at && !n.reminder_done && new Date(n.reminder_at) <= new Date();
  const brandName = n.brand_id ? brandById[n.brand_id]?.name : null;
  const creatorName = n.creator_id ? creatorById[n.creator_id]?.name : null;
  // Shared-with-me note: chip names who shared it (owner_name / role).
  const sharedBy = readOnly ? (n.owner_name || ROLE_LABEL[ownerRoleKey(n)] || 'Shared') : null;
  return (
    <div className="pc-ncard" style={{ background: noteColorBg(n, viewerId) }} onClick={onOpen}>
      {!readOnly && (
        <button className={`pc-npin ${n.pinned ? 'on' : ''}`} title={n.pinned ? 'Unpin' : 'Pin'}
          onClick={e => { e.stopPropagation(); onPin(); }}><i className={`bi ${n.pinned ? 'bi-pin-angle-fill' : 'bi-pin-angle'}`} /></button>
      )}
      {n.title && <div className="pc-ntitle">{n.title}</div>}
      {htmlToText(n.body) && <div className="pc-nbody ac-rte-view"
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(n.body) }} />}

      {(sharedBy || n.reminder_at || brandName || creatorName || n.month || (n.labels || []).length > 0) && (
        <div className="pc-nchips">
          {sharedBy && <span className="pc-nchip"><i className="bi bi-person-badge" /> {sharedBy}</span>}
          {!readOnly && n.reminder_at && !n.reminder_done && (
            <button className={`pc-nchip pc-nchip-rem ${overdue ? 'due' : ''}`} title="Mark reminder done"
              onClick={e => { e.stopPropagation(); onDone(); }}>
              <i className="bi bi-alarm" /> {reminderLabel(n.reminder_at)}
            </button>
          )}
          {brandName && <span className="pc-nchip pc-nchip-brand"><i className="bi bi-shop" /> {brandName}</span>}
          {creatorName && <span className="pc-nchip pc-nchip-creator"><i className="bi bi-person" /> {creatorName}</span>}
          {n.month && <span className="pc-nchip pc-nchip-prog"><i className="bi bi-calendar3" /> {monthLabel(n.month)}</span>}
          {(n.labels || []).map(l => <span key={l} className="pc-nchip"><i className="bi bi-tag" /> {l}</span>)}
        </div>
      )}

      {!readOnly && (
        <div className="pc-ncard-actions" onClick={e => e.stopPropagation()}>
          <button title={n.archived ? 'Unarchive' : 'Archive'} onClick={onArchive}><i className={`bi ${n.archived ? 'bi-arrow-counterclockwise' : 'bi-archive'}`} /></button>
          <button className="pc-ndel" title="Delete" onClick={onDelete}><i className="bi bi-trash" /></button>
        </div>
      )}
    </div>
  );
}

/* ── create / edit composer (auto-saves, Google Keep-style) ──
   readOnly: view-only rendering (no persistence) — a note shared WITH the viewer
   (they can't write it). Colours are role-based (owner's role), not chosen.
   Sharing: internal staff (bob/team_lead/apc/ads_manager, + Super Boss) get a
   "Share with" section on their own notes — role groups for everyone, plus
   Everyone / a specific team for the Super Boss. onLoadShares/onSaveShares
   persist to handler_note_shares; teamLeads feeds the specific-team picker.
   labelCatalog / onCreateLabel: reusable saved labels (quick-pick + persist).
   lockBrand / lockCreator: those selects disabled (drawer pinned to one). */
export function NoteEditor({ editor, brands, brandById, creators = [], month, onClose, onPersist, onDelete,
  overlayClass = '', readOnly = false, lockBrand = false, lockCreator = false,
  viewerId, viewerRole, viewerIsSuperbob = false, teamLeads = [], labelCatalog = [],
  onCreateLabel, onLoadShares, onSaveShares }) {
  const src = editor.note || {};
  const [f, setF] = useState({
    title: src.title || '',
    body: src.body || '',
    color: src.color || 'default',
    brand_id: src.brand_id || '',
    creator_id: src.creator_id || '',
    month: src.month || '',
    labels: src.labels || [],
    pinned: !!src.pinned,
  });
  const [reminderInput, setReminderInput] = useState(toLocalInput(src.reminder_at));
  const [labelInput, setLabelInput] = useState('');
  const [status, setStatus] = useState(''); // '' | 'saving' | 'saved'
  const [shareTargets, setShareTargets] = useState([]); // NoteShareTarget[]
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  // Only internal staff may share, and only their OWN notes (new, or owned by the
  // viewer) — Super Boss oversight editing someone else's note gets no share UI.
  const isOwnEditing = editor.mode === 'add' || isOwnNote(src, viewerId);
  const canShare = !readOnly && isOwnEditing && INTERNAL_ROLES.includes(viewerRole) && !!onSaveShares;

  // Creator select: one option per creator identity per brand — a creator's
  // deal rows across months collapse into one, keeping the newest row's id.
  const creatorRowById = useMemo(() => {
    const m = {}; creators.forEach(c => { m[c.id] = c; }); return m;
  }, [creators]);
  const creatorOptions = useMemo(() => {
    const byKey = {};
    creators.forEach(c => {
      const k = store.creatorNoteKey(c);
      const prev = byKey[k];
      if (!prev || String(c.onboarded_on || c.created_at || '') > String(prev.onboarded_on || prev.created_at || '')) byKey[k] = c;
    });
    return Object.values(byKey).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [creators]);
  // Scope to the picked brand; keep the current selection visible even when it
  // isn't the identity's newest row (e.g. a note linked from an older month).
  const creatorChoices = useMemo(() => {
    const scoped = f.brand_id ? creatorOptions.filter(c => c.brand_id === f.brand_id) : creatorOptions;
    const sel = f.creator_id ? creatorRowById[f.creator_id] : null;
    return sel && !scoped.some(c => c.id === sel.id) ? [sel, ...scoped] : scoped;
  }, [creatorOptions, creatorRowById, f.brand_id, f.creator_id]);
  const pickCreator = (id) => setF(prev => {
    const row = id ? creatorRowById[id] : null;
    // picking a creator drags their brand along; picking none leaves brand as-is
    return { ...prev, creator_id: id, ...(row?.brand_id && row.brand_id !== prev.brand_id ? { brand_id: row.brand_id } : {}) };
  });
  const pickBrand = (id) => setF(prev => {
    const row = prev.creator_id ? creatorRowById[prev.creator_id] : null;
    // switching to a DIFFERENT brand unlinks a mismatched creator
    return { ...prev, brand_id: id, creator_id: row && id && row.brand_id !== id ? '' : prev.creator_id };
  });

  // Persistence bookkeeping. idRef holds the real id once created so subsequent
  // auto-saves update instead of inserting; the saving/dirty refs serialize writes.
  const idRef = useRef(src.id || null);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const skipNextRef = useRef(true); // don't auto-save on initial mount

  const buildPayload = () => ({
    ...(idRef.current ? { id: idRef.current } : {}),
    title: f.title.trim(),
    body: htmlToText(f.body) ? f.body : '', // drop Quill's empty <p><br></p>
    color: f.color,
    brand_id: f.brand_id || null,
    creator_id: f.creator_id || null,
    month: f.month || null,
    labels: f.labels,
    pinned: f.pinned,
    reminder_at: fromLocalInput(reminderInput),
  });

  const flush = useCallback(async () => {
    if (readOnly) return idRef.current; // view-only: never persist
    const payload = buildPayload();
    if (!payload.title && !htmlToText(payload.body)) return idRef.current; // never persist a blank note
    if (savingRef.current) { dirtyRef.current = true; return idRef.current; }
    savingRef.current = true;
    setStatus('saving');
    const newId = await onPersist(payload);
    if (newId && !idRef.current) idRef.current = newId;
    savingRef.current = false;
    setStatus('saved');
    if (dirtyRef.current) { dirtyRef.current = false; flush(); }
    return idRef.current;
  }, [f, reminderInput, onPersist]);

  // Load the note's current share targets (owner only, existing note).
  useEffect(() => {
    if (!canShare || !idRef.current || !onLoadShares) return;
    let alive = true;
    onLoadShares(idRef.current).then(list => { if (alive) setShareTargets(list || []); }).catch(() => {});
    return () => { alive = false; };
  }, [canShare]); // eslint-disable-line

  const hasTarget = (t) => shareTargets.some(x => shareTokenKey(x) === shareTokenKey(t));
  // Toggle a share target; ensure the note exists first (flush), then persist.
  const toggleTarget = async (t) => {
    const key = shareTokenKey(t);
    const next = hasTarget(t) ? shareTargets.filter(x => shareTokenKey(x) !== key) : [...shareTargets, t];
    setShareTargets(next);
    const id = idRef.current || await flush();
    if (id && onSaveShares) { try { await onSaveShares(id, next); } catch { /* ignore */ } }
  };

  // debounced auto-save on any change
  useEffect(() => {
    if (skipNextRef.current) { skipNextRef.current = false; return; }
    const t = setTimeout(() => flush(), 600);
    return () => clearTimeout(t);
  }, [f, reminderInput]); // eslint-disable-line

  // save-and-close (overlay click, Done, Esc)
  const close = useCallback(() => { flush(); onClose(); }, [flush, onClose]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  // save=true also stores the label in the reusable catalogue (for re-labelling).
  function addLabel(raw, save = true) {
    const v = (raw ?? labelInput).trim().replace(/^#/, '');
    if (v && !f.labels.includes(v)) {
      set('labels', [...f.labels, v]);
      if (save && onCreateLabel) onCreateLabel(v);
    }
    setLabelInput('');
  }

  // View-only: shared boss notes an Ads Manager can read but not write.
  if (readOnly) {
    const brandName = src.brand_id ? brandById?.[src.brand_id]?.name : null;
    const roCreatorName = src.creator_id ? creatorRowById[src.creator_id]?.name : null;
    return (
      <div className={`pc-overlay ${overlayClass}`} onClick={onClose}>
        <div className="pc-modal pc-modal-scroll pc-note-modal" onClick={e => e.stopPropagation()}
          style={{ background: noteColorBg(src, viewerId) }}>
          <div className="pc-modal-body">
            {src.title && <div className="pc-ntitle-in" style={{ pointerEvents: 'none' }}>{src.title}</div>}
            {htmlToText(src.body) && <div className="pc-nbody ac-rte-view" style={{ maxHeight: 'none' }}
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(src.body) }} />}
            {(src.owner_name || brandName || roCreatorName || src.month || (src.labels || []).length > 0) && (
              <div className="pc-nchips" style={{ marginTop: 12 }}>
                {src.owner_name && <span className="pc-nchip"><i className="bi bi-person-badge" /> {src.owner_name}</span>}
                {brandName && <span className="pc-nchip pc-nchip-brand"><i className="bi bi-shop" /> {brandName}</span>}
                {roCreatorName && <span className="pc-nchip pc-nchip-creator"><i className="bi bi-person" /> {roCreatorName}</span>}
                {src.month && <span className="pc-nchip pc-nchip-prog"><i className="bi bi-calendar3" /> {monthLabel(src.month)}</span>}
                {(src.labels || []).map(l => <span key={l} className="pc-nchip"><i className="bi bi-tag" /> {l}</span>)}
              </div>
            )}
          </div>
          <div className="pc-modal-actions">
            <span className="pc-nstatus"><i className="bi bi-eye" /> Shared with you — read-only</span>
            <div style={{ flex: 1 }} />
            <button className="pc-btn pc-btn-primary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  const catalogSuggestions = (labelCatalog || [])
    .filter(l => !f.labels.includes(l.name))
    .slice(0, 12);

  return (
    <div className={`pc-overlay ${overlayClass}`} onClick={close}>
      <div className="pc-modal pc-modal-scroll pc-note-modal" onClick={e => e.stopPropagation()}
        style={{ background: OWN_BG }}>
        <div className="pc-modal-body">
        <input className="pc-ntitle-in" placeholder="Title" value={f.title}
          onChange={e => set('title', e.target.value)} autoFocus />
        <div className="pc-nbody-rte">
          <RichTextEditor value={f.body} onChange={html => set('body', html)}
            placeholder="Take a note…" minHeight={150} />
        </div>

        {/* labels */}
        <div className="pc-nlabels">
          {f.labels.map(l => (
            <span key={l} className="pc-nchip pc-nchip-edit"><i className="bi bi-tag" /> {l}
              <button onClick={() => set('labels', f.labels.filter(x => x !== l))}>×</button>
            </span>
          ))}
          <input className="pc-nlabel-in" placeholder="+ label" value={labelInput}
            onChange={e => setLabelInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addLabel(); } }}
            onBlur={() => labelInput.trim() && addLabel()} />
        </div>
        {catalogSuggestions.length > 0 && (
          <div className="pc-nlabel-pick">
            <span className="pc-nlabel-pick-hd">Saved labels</span>
            {catalogSuggestions.map(l => (
              <button key={l.id} type="button" className="pc-nchip pc-nchip-pick"
                onClick={() => addLabel(l.name, false)}><i className="bi bi-tag" /> {l.name}</button>
            ))}
          </div>
        )}

        <div className="pc-nrow">
          <div className="pc-field"><label>Brand</label>
            <select className="pc-input" value={f.brand_id} disabled={lockBrand}
              onChange={e => pickBrand(e.target.value)}>
              <option value="">— None —</option>
              {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="pc-field"><label>Program (month)</label>
            <input className="pc-input" type="month" value={f.month}
              onChange={e => set('month', e.target.value)} />
          </div>
          {creators.length > 0 && (
            <div className="pc-field"><label>Creator</label>
              <select className="pc-input" value={f.creator_id} disabled={lockCreator}
                onChange={e => pickCreator(e.target.value)}>
                <option value="">— None —</option>
                {creatorChoices.map(c => {
                  const h = creatorHandle(c);
                  const b = !f.brand_id && brandById?.[c.brand_id]?.name;
                  return <option key={c.id} value={c.id}>{c.name}{h ? ` (${h})` : ''}{b ? ` — ${b}` : ''}</option>;
                })}
              </select>
            </div>
          )}
        </div>

        <div className="pc-field"><label>Reminder</label>
          <div className="pc-nrem-row">
            <input className="pc-input" type="datetime-local" value={reminderInput}
              onChange={e => { setReminderInput(e.target.value); if (e.target.value) requestNotificationPermission(); }} />
            {reminderInput && <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={() => setReminderInput('')}>Clear</button>}
          </div>
          <div className="pc-nrem-hint">Shows a browser + in-app notification when due. Allow notifications when prompted.</div>
        </div>

        {/* share with role groups / teams (internal staff, own notes) */}
        {canShare && (
          <div className="pc-nshare">
            <label className="pc-field-label"><i className="bi bi-people" /> Share with</label>
            <div className="pc-nshare-chips">
              {viewerIsSuperbob && (
                <button type="button" className={`pc-nshare-chip ${hasTarget({ kind: 'all' }) ? 'on' : ''}`}
                  onClick={() => toggleTarget({ kind: 'all' })}><i className="bi bi-globe2" /> Everyone</button>
              )}
              {ROLE_TARGETS.map(r => (
                <button key={r.role} type="button"
                  className={`pc-nshare-chip ${hasTarget({ kind: 'role', role: r.role }) ? 'on' : ''}`}
                  onClick={() => toggleTarget({ kind: 'role', role: r.role })}>{r.label}</button>
              ))}
            </div>
            {viewerIsSuperbob && teamLeads.length > 0 && (
              <>
                <label className="pc-field-label" style={{ marginTop: 8 }}><i className="bi bi-diagram-3" /> Or a specific team</label>
                <div className="pc-nshare-chips">
                  {teamLeads.map(tl => (
                    <button key={tl.id} type="button"
                      className={`pc-nshare-chip ${hasTarget({ kind: 'team', team: tl.id }) ? 'on' : ''}`}
                      onClick={() => toggleTarget({ kind: 'team', team: tl.id })}>{tl.name}'s team</button>
                  ))}
                </div>
              </>
            )}
            <div className="pc-nrem-hint">Recipients can view (not edit); the note shows on their board tinted by your role.</div>
          </div>
        )}
        </div>{/* /pc-modal-body */}

        <div className="pc-modal-actions">
          <label className="pc-npin-toggle">
            <input type="checkbox" checked={f.pinned} onChange={e => set('pinned', e.target.checked)} /> Pin
          </label>
          <span className="pc-nstatus">{status === 'saving' ? 'Saving…' : status === 'saved' ? <><i className="bi bi-check2" /> Saved</> : ''}</span>
          <div style={{ flex: 1 }} />
          {onDelete && <button className="pc-btn pc-btn-ghost pc-btn-danger" onClick={onDelete}><i className="bi bi-trash" />Delete</button>}
          <button className="pc-btn pc-btn-primary" onClick={close}>Done</button>
        </div>
      </div>
    </div>
  );
}

/* ── Brand notes drawer ──
   Slide-over listing a single brand's Keep notes (used from the Brands tab,
   next to the brand name). Click a note to open the same auto-saving editor;
   "New" pre-links the note to this brand. */
export function BrandNotesDrawer({ brandId, brandName, brands, brandById, creators = [], month, notes = [], onClose, onChanged }) {
  const { user } = useAuth();
  const [list, setList] = useState(() => notes.filter(n => !n.archived));
  const [editor, setEditor] = useState(null);
  useEffect(() => { setList(notes.filter(n => !n.archived)); }, [notes]);
  const creatorNames = useMemo(() => {
    const m = {}; creators.forEach(c => { m[c.id] = c.name; }); return m;
  }, [creators]);

  const persist = useCallback(async (payload) => {
    if (payload.id) {
      setList(prev => prev.map(n => n.id === payload.id ? { ...n, ...payload } : n));
      try { await store.updateNote(payload.id, stripId(payload)); } catch {}
      onChanged && onChanged();
      return payload.id;
    }
    try {
      const row = await store.createNote(stripId({ ...payload, brand_id: brandId }));
      setList(prev => [row, ...prev]);
      onChanged && onChanged();
      return row.id;
    } catch { return null; }
  }, [brandId, onChanged]);

  const remove = useCallback(async (n) => {
    if (!window.confirm('Delete this note?')) return;
    setList(prev => prev.filter(x => x.id !== n.id));
    try { await store.deleteNote(n.id); } catch {}
    onChanged && onChanged();
  }, [onChanged]);

  const sorted = [...list].sort((a, b) => (b.pinned - a.pinned) || (new Date(b.updated_at) - new Date(a.updated_at)));

  return (
    <>
      <div className="pc-drawer-overlay" onClick={onClose}>
        <aside className="pc-drawer" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
          <div className="pc-drawer-head">
            <div className="pc-drawer-head-l">
              <span className="pc-ava" style={{ background: getGradient(brandName) }}>{(brandName || '?')[0]?.toUpperCase()}</span>
              <div>
                <div className="pc-drawer-title">{brandName}</div>
                <div className="pc-drawer-sub">{sorted.length} note{sorted.length === 1 ? '' : 's'}</div>
              </div>
            </div>
            <button className="pc-btn pc-btn-primary pc-btn-sm" onClick={() => setEditor({ mode: 'add', note: { color: 'default', labels: [], brand_id: brandId, month: month || null } })}>
              <i className="bi bi-plus-lg" />New
            </button>
          </div>
          <div className="pc-drawer-body">
            {sorted.length === 0 ? (
              <div className="pc-nempty" style={{ padding: '46px 10px' }}>
                <div className="pc-nempty-ico"><i className="bi bi-journal-text" /></div>
                <div className="pc-nempty-t">No notes yet</div>
                <div className="pc-nempty-s">Add a note to track reminders, deliverables and follow-ups for {brandName}.</div>
              </div>
            ) : (
              <div className="pc-bnlist">
                {sorted.map(n => {
                  const text = htmlToText(n.body);
                  const overdue = n.reminder_at && !n.reminder_done && new Date(n.reminder_at) <= new Date();
                  return (
                    <button key={n.id} className="pc-bnitem" style={{ background: noteColorBg(n, user?.id) }} onClick={() => setEditor({ mode: 'edit', note: n })}>
                      {n.pinned && <i className="bi bi-pin-angle-fill pc-bnpin" />}
                      {n.title && <div className="pc-bntitle">{n.title}</div>}
                      {text && <div className="pc-bnsnippet">{text}</div>}
                      {(n.reminder_at || n.creator_id || n.month || (n.labels || []).length > 0) && (
                        <div className="pc-nchips">
                          {n.reminder_at && !n.reminder_done && <span className={`pc-nchip pc-nchip-rem ${overdue ? 'due' : ''}`}><i className="bi bi-alarm" /> {reminderLabel(n.reminder_at)}</span>}
                          {n.creator_id && creatorNames[n.creator_id] && <span className="pc-nchip pc-nchip-creator"><i className="bi bi-person" /> {creatorNames[n.creator_id]}</span>}
                          {n.month && <span className="pc-nchip pc-nchip-prog"><i className="bi bi-calendar3" /> {monthLabel(n.month)}</span>}
                          {(n.labels || []).map(l => <span key={l} className="pc-nchip"><i className="bi bi-tag" /> {l}</span>)}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      </div>
      {editor && (
        <NoteEditor editor={editor} brands={brands} brandById={brandById} creators={creators} month={month}
          viewerId={user?.id} overlayClass="pc-overlay-top"
          onClose={() => setEditor(null)} onPersist={persist}
          onDelete={editor.mode === 'edit' ? () => { setEditor(null); remove(editor.note); } : null} />
      )}
    </>
  );
}

/* ── Creator notes drawer ──
   Slide-over listing ONE creator's Keep notes (opened from the journal icon
   next to a creator's name in the Drilldown / Creators tab). The caller passes
   the notes pre-filtered by creator identity (notes follow the creator across
   months within the brand); "New" pre-links this deal row + its brand. */
export function CreatorNotesDrawer({ creator, brands, brandById, creators = [], month, notes = [], onClose, onChanged }) {
  // creator: { id (deal row new notes link to), name, handle, brandId, brandName }
  const { user } = useAuth();
  const [list, setList] = useState(() => notes.filter(n => !n.archived));
  const [editor, setEditor] = useState(null);
  useEffect(() => { setList(notes.filter(n => !n.archived)); }, [notes]);

  const persist = useCallback(async (payload) => {
    if (payload.id) {
      setList(prev => prev.map(n => n.id === payload.id ? { ...n, ...payload } : n));
      try { await store.updateNote(payload.id, stripId(payload)); } catch {}
      onChanged && onChanged();
      return payload.id;
    }
    try {
      const row = await store.createNote(stripId({ ...payload, creator_id: creator.id, brand_id: creator.brandId || payload.brand_id || null }));
      setList(prev => [row, ...prev]);
      onChanged && onChanged();
      return row.id;
    } catch { return null; }
  }, [creator, onChanged]);

  const remove = useCallback(async (n) => {
    if (!window.confirm('Delete this note?')) return;
    setList(prev => prev.filter(x => x.id !== n.id));
    try { await store.deleteNote(n.id); } catch {}
    onChanged && onChanged();
  }, [onChanged]);

  const sorted = [...list].sort((a, b) => (b.pinned - a.pinned) || (new Date(b.updated_at) - new Date(a.updated_at)));

  return (
    <>
      <div className="pc-drawer-overlay" onClick={onClose}>
        <aside className="pc-drawer" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
          <div className="pc-drawer-head">
            <div className="pc-drawer-head-l">
              <span className="pc-ava" style={{ background: getGradient(creator.name) }}>{(creator.name || '?')[0]?.toUpperCase()}</span>
              <div>
                <div className="pc-drawer-title">{creator.name}</div>
                <div className="pc-drawer-sub">
                  {[creator.handle, creator.brandName].filter(Boolean).join(' · ')}
                  {(creator.handle || creator.brandName) ? ' · ' : ''}{sorted.length} note{sorted.length === 1 ? '' : 's'}
                </div>
              </div>
            </div>
            <button className="pc-btn pc-btn-primary pc-btn-sm" onClick={() => setEditor({ mode: 'add', note: { color: 'default', labels: [], brand_id: creator.brandId || null, creator_id: creator.id, month: month || null } })}>
              <i className="bi bi-plus-lg" />New
            </button>
          </div>
          <div className="pc-drawer-body">
            {sorted.length === 0 ? (
              <div className="pc-nempty" style={{ padding: '46px 10px' }}>
                <div className="pc-nempty-ico"><i className="bi bi-journal-text" /></div>
                <div className="pc-nempty-t">No notes yet</div>
                <div className="pc-nempty-s">Add a note to track deals, deliverables and follow-ups for {creator.name}.</div>
              </div>
            ) : (
              <div className="pc-bnlist">
                {sorted.map(n => {
                  const text = htmlToText(n.body);
                  const overdue = n.reminder_at && !n.reminder_done && new Date(n.reminder_at) <= new Date();
                  return (
                    <button key={n.id} className="pc-bnitem" style={{ background: noteColorBg(n, user?.id) }} onClick={() => setEditor({ mode: 'edit', note: n })}>
                      {n.pinned && <i className="bi bi-pin-angle-fill pc-bnpin" />}
                      {n.title && <div className="pc-bntitle">{n.title}</div>}
                      {text && <div className="pc-bnsnippet">{text}</div>}
                      {(n.reminder_at || n.month || (n.labels || []).length > 0) && (
                        <div className="pc-nchips">
                          {n.reminder_at && !n.reminder_done && <span className={`pc-nchip pc-nchip-rem ${overdue ? 'due' : ''}`}><i className="bi bi-alarm" /> {reminderLabel(n.reminder_at)}</span>}
                          {n.month && <span className="pc-nchip pc-nchip-prog"><i className="bi bi-calendar3" /> {monthLabel(n.month)}</span>}
                          {(n.labels || []).map(l => <span key={l} className="pc-nchip"><i className="bi bi-tag" /> {l}</span>)}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      </div>
      {editor && (
        <NoteEditor editor={editor} brands={brands} brandById={brandById} creators={creators} month={month}
          viewerId={user?.id} overlayClass="pc-overlay-top" lockCreator lockBrand
          onClose={() => setEditor(null)} onPersist={persist}
          onDelete={editor.mode === 'edit' ? () => { setEditor(null); remove(editor.note); } : null} />
      )}
    </>
  );
}

/* ── All-notes drawer ──
   Global, searchable list of every note — opened from the floating notes button
   so any note is reachable from anywhere in the handler workspace. Also reused
   by the Super Boss "Ads Manager notes" view (notes carry an injected
   owner_name shown as a chip). Includes a brand-wise filter.
   fixedBrand {id,name}: pin the drawer to ONE brand — only that brand's notes,
   no brand filter, new notes pre-linked (+ brand select locked).
   canEditNote(n): notes failing it open read-only (shared-in notes).
   viewerRole / viewerIsSuperbob / teamLeads: drive the editor's Share section.
   labelCatalog / onCreateLabel: reusable saved labels. */
export function AllNotesDrawer({ notes = [], brands, brandById, creators = [], month, onClose, onChanged,
  canCreate = true, title = 'All notes', fixedBrand = null, canEditNote = () => true,
  viewerRole, viewerIsSuperbob = false, teamLeads = [], labelCatalog = [], onCreateLabel,
  onLoadShares = store.loadNoteShares, onSaveShares = store.setNoteShares }) {
  const { user } = useAuth();
  const scoped = useCallback(
    (arr) => arr.filter(n => !n.archived && (!fixedBrand || n.brand_id === fixedBrand.id)),
    [fixedBrand]);
  const [list, setList] = useState(() => scoped(notes));
  const [editor, setEditor] = useState(null);
  const [search, setSearch] = useState('');
  const [brandFilter, setBrandFilter] = useState('all'); // 'all' | 'none' | <brand_id>
  useEffect(() => { setList(scoped(notes)); }, [notes, scoped]);
  const creatorNames = useMemo(() => {
    const m = {}; creators.forEach(c => { m[c.id] = c.name; }); return m;
  }, [creators]);

  const persist = useCallback(async (payload) => {
    if (payload.id) {
      setList(prev => prev.map(n => n.id === payload.id ? { ...n, ...payload } : n));
      try { await store.updateNote(payload.id, stripId(payload)); } catch {}
      onChanged && onChanged();
      return payload.id;
    }
    try {
      const row = await store.createNote(stripId(payload));
      setList(prev => [row, ...prev]);
      onChanged && onChanged();
      return row.id;
    } catch { return null; }
  }, [onChanged]);

  const remove = useCallback(async (n) => {
    if (!window.confirm('Delete this note?')) return;
    setList(prev => prev.filter(x => x.id !== n.id));
    try { await store.deleteNote(n.id); } catch {}
    onChanged && onChanged();
  }, [onChanged]);

  // Brand-wise filter options, built from the notes themselves (with counts).
  const brandOptions = useMemo(() => {
    const m = {};
    list.forEach(n => { if (n.brand_id) m[n.brand_id] = (m[n.brand_id] || 0) + 1; });
    return Object.entries(m)
      .map(([id, count]) => ({ id, count, name: brandById[id]?.name || 'Brand' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [list, brandById]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let l = list;
    if (brandFilter === 'none') l = l.filter(n => !n.brand_id);
    else if (brandFilter !== 'all') l = l.filter(n => n.brand_id === brandFilter);
    if (q) l = l.filter(n =>
      (n.title || '').toLowerCase().includes(q) ||
      htmlToText(n.body).toLowerCase().includes(q) ||
      (n.labels || []).some(x => x.toLowerCase().includes(q)) ||
      (n.owner_name || '').toLowerCase().includes(q) ||
      (n.creator_id && (creatorNames[n.creator_id] || '').toLowerCase().includes(q)) ||
      (n.brand_id && (brandById[n.brand_id]?.name || '').toLowerCase().includes(q)));
    return [...l].sort((a, b) => (b.pinned - a.pinned) || (new Date(b.updated_at) - new Date(a.updated_at)));
  }, [list, search, brandFilter, brandById, creatorNames]);

  return (
    <>
      <div className="pc-drawer-overlay" onClick={onClose}>
        <aside className="pc-drawer" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
          <div className="pc-drawer-head">
            <div className="pc-drawer-head-l">
              <span className="pc-ava" style={{ background: 'var(--pc-accent)', color: '#fff' }}><i className="bi bi-journal-text" /></span>
              <div>
                <div className="pc-drawer-title">{title}</div>
                <div className="pc-drawer-sub">{list.length} note{list.length === 1 ? '' : 's'}</div>
              </div>
            </div>
            {canCreate && (
              <button className="pc-btn pc-btn-primary pc-btn-sm" onClick={() => setEditor({ mode: 'add', note: { color: 'default', labels: [], brand_id: fixedBrand ? fixedBrand.id : null, month: month || null } })}>
                <i className="bi bi-plus-lg" />New
              </button>
            )}
          </div>
          <div className="pc-drawer-body">
            <div className="pc-nsearch" style={{ marginBottom: 10 }}>
              <i className="bi bi-search" />
              <input placeholder="Search all notes…" value={search} onChange={e => setSearch(e.target.value)} />
              {search && <button className="pc-nsearch-x" onClick={() => setSearch('')}>×</button>}
            </div>
            {!fixedBrand && brandOptions.length > 0 && (
              <select className="pc-input" style={{ marginBottom: 14 }} value={brandFilter}
                onChange={e => setBrandFilter(e.target.value)} aria-label="Filter by brand">
                <option value="all">All brands</option>
                <option value="none">No brand</option>
                {brandOptions.map(b => <option key={b.id} value={b.id}>{b.name} ({b.count})</option>)}
              </select>
            )}
            {visible.length === 0 ? (
              <div className="pc-nempty" style={{ padding: '40px 10px' }}>
                <div className="pc-nempty-ico"><i className="bi bi-journal-text" /></div>
                <div className="pc-nempty-t">{search ? 'No matching notes' : 'No notes yet'}</div>
                <div className="pc-nempty-s">{search ? 'Try a different search.' : 'Create a note to track reminders, deliverables and follow-ups.'}</div>
              </div>
            ) : (
              <div className="pc-bnlist">
                {visible.map(n => {
                  const text = htmlToText(n.body);
                  const overdue = n.reminder_at && !n.reminder_done && new Date(n.reminder_at) <= new Date();
                  const brandName = n.brand_id ? brandById[n.brand_id]?.name : null;
                  const sharedBy = !isOwnNote(n, user?.id) ? (n.owner_name || ROLE_LABEL[ownerRoleKey(n)]) : null;
                  return (
                    <button key={n.id} className="pc-bnitem" style={{ background: noteColorBg(n, user?.id) }} onClick={() => setEditor({ mode: 'edit', note: n })}>
                      {n.pinned && <i className="bi bi-pin-angle-fill pc-bnpin" />}
                      {n.title && <div className="pc-bntitle">{n.title}</div>}
                      {text && <div className="pc-bnsnippet">{text}</div>}
                      {(sharedBy || brandName || n.creator_id || n.reminder_at || n.month || (n.labels || []).length > 0) && (
                        <div className="pc-nchips">
                          {sharedBy && <span className="pc-nchip"><i className="bi bi-person-badge" /> {sharedBy}</span>}
                          {n.reminder_at && !n.reminder_done && <span className={`pc-nchip pc-nchip-rem ${overdue ? 'due' : ''}`}><i className="bi bi-alarm" /> {reminderLabel(n.reminder_at)}</span>}
                          {brandName && <span className="pc-nchip pc-nchip-brand"><i className="bi bi-shop" /> {brandName}</span>}
                          {n.creator_id && creatorNames[n.creator_id] && <span className="pc-nchip pc-nchip-creator"><i className="bi bi-person" /> {creatorNames[n.creator_id]}</span>}
                          {n.month && <span className="pc-nchip pc-nchip-prog"><i className="bi bi-calendar3" /> {monthLabel(n.month)}</span>}
                          {(n.labels || []).map(l => <span key={l} className="pc-nchip"><i className="bi bi-tag" /> {l}</span>)}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>
      </div>
      {editor && (
        <NoteEditor editor={editor} brands={brands} brandById={brandById} creators={creators} month={month}
          overlayClass="pc-overlay-top"
          viewerId={user?.id} viewerRole={viewerRole} viewerIsSuperbob={viewerIsSuperbob}
          teamLeads={teamLeads} labelCatalog={labelCatalog} onCreateLabel={onCreateLabel}
          onLoadShares={onLoadShares} onSaveShares={onSaveShares}
          readOnly={editor.mode === 'edit' && !canEditNote(editor.note)}
          lockBrand={!!fixedBrand}
          onClose={() => setEditor(null)} onPersist={persist}
          onDelete={editor.mode === 'edit' && canEditNote(editor.note) ? () => { setEditor(null); remove(editor.note); } : null} />
      )}
    </>
  );
}
