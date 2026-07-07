// @ts-nocheck
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import DOMPurify from 'dompurify';
import { supabase } from '../../lib/supabase';
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

// Keep-style soft palette. `bg` is the card fill; the chip on the editor uses the same.
const NOTE_COLORS = [
  { key: 'default', bg: '#FFFFFF', label: 'Default' },
  { key: 'red',     bg: '#FCE8E6', label: 'Coral' },
  { key: 'orange',  bg: '#FEEFC3', label: 'Sand' },
  { key: 'yellow',  bg: '#FFF8C4', label: 'Sun' },
  { key: 'green',   bg: '#E6F4EA', label: 'Sage' },
  { key: 'teal',    bg: '#E0F2F1', label: 'Mint' },
  { key: 'blue',    bg: '#E8F0FE', label: 'Sky' },
  { key: 'purple',  bg: '#F3E8FD', label: 'Lilac' },
  { key: 'pink',    bg: '#FCE4EC', label: 'Blossom' },
  { key: 'gray',    bg: '#F1F3F4', label: 'Storm' },
];
const colorBg = (key) => (NOTE_COLORS.find(c => c.key === key) || NOTE_COLORS[0]).bg;

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

export default function NotesBoard({ brands = [], brandById = {}, month }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState({ kind: 'all' }); // {kind, value?}
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState(null); // null | { mode, note }
  const busyRef = useRef(false);

  const reload = useCallback(async () => {
    try { setNotes(await store.loadNotes()); setErr(''); }
    catch (e) { setErr(e.message || 'Failed to load notes'); }
  }, []);

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
  const brandGroups = useMemo(() => {
    const m = {};
    live.forEach(n => { if (n.brand_id) m[n.brand_id] = (m[n.brand_id] || 0) + 1; });
    return Object.entries(m)
      .map(([id, count]) => ({ id, count, name: brandById[id]?.name || 'Brand' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [live, brandById]);
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
      case 'brand': list = list.filter(n => !n.archived && n.brand_id === filter.value); break;
      case 'program': list = list.filter(n => !n.archived && n.month === filter.value); break;
      case 'label': list = list.filter(n => !n.archived && (n.labels || []).includes(filter.value)); break;
      default: list = list.filter(n => !n.archived);
    }
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(n =>
      (n.title || '').toLowerCase().includes(q) ||
      htmlToText(n.body).toLowerCase().includes(q) ||
      (n.labels || []).some(l => l.toLowerCase().includes(q)));
    // pinned first, then by sort key
    const key = filter.kind === 'reminders'
      ? (n) => new Date(n.reminder_at).getTime()
      : (n) => -new Date(n.updated_at).getTime();
    return [...list].sort((a, b) => (b.pinned - a.pinned) || (key(a) - key(b)));
  }, [notes, filter, search]);

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

        {brandGroups.length > 0 && <div className="pc-nside-head">Brands</div>}
        {brandGroups.map(g => (
          <SideItem key={g.id} active={isF('brand', g.id)} icon="bi-shop" label={g.name} count={g.count}
            onClick={() => setFilter({ kind: 'brand', value: g.id })} />
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
            note: { color: 'default', labels: [], brand_id: null, month: month || null },
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
              {pinned.map(n => <NoteCard key={n.id} n={n} brandById={brandById}
                onOpen={() => setEditor({ mode: 'edit', note: n })} onPin={() => togglePin(n)}
                onArchive={() => setArchived(n, true)} onDelete={() => removeNote(n)} onDone={() => doneReminder(n)} />)}
            </div>
            {pinned.length > 0 && others.length > 0 && filter.kind === 'all' && <div className="pc-nsection">Others</div>}
            <div className="pc-ngrid">
              {others.map(n => <NoteCard key={n.id} n={n} brandById={brandById}
                onOpen={() => setEditor({ mode: 'edit', note: n })} onPin={() => togglePin(n)}
                onArchive={() => setArchived(n, !n.archived)} onDelete={() => removeNote(n)} onDone={() => doneReminder(n)} />)}
            </div>
          </>
        )}
      </div>

      {editor && (
        <NoteEditor editor={editor} brands={brands} brandById={brandById} month={month}
          onClose={() => setEditor(null)} onPersist={persistNote}
          onDelete={editor.mode === 'edit' ? () => { setEditor(null); removeNote(editor.note); } : null} />
      )}
    </div>
  );
}

function stripId(d) { const { id, ...rest } = d; return rest; }

/* ── one card ── */
function NoteCard({ n, brandById, onOpen, onPin, onArchive, onDelete, onDone }) {
  const overdue = n.reminder_at && !n.reminder_done && new Date(n.reminder_at) <= new Date();
  const brandName = n.brand_id ? brandById[n.brand_id]?.name : null;
  return (
    <div className="pc-ncard" style={{ background: colorBg(n.color) }} onClick={onOpen}>
      <button className={`pc-npin ${n.pinned ? 'on' : ''}`} title={n.pinned ? 'Unpin' : 'Pin'}
        onClick={e => { e.stopPropagation(); onPin(); }}><i className={`bi ${n.pinned ? 'bi-pin-angle-fill' : 'bi-pin-angle'}`} /></button>
      {n.title && <div className="pc-ntitle">{n.title}</div>}
      {htmlToText(n.body) && <div className="pc-nbody ac-rte-view"
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(n.body) }} />}

      {(n.reminder_at || brandName || n.month || (n.labels || []).length > 0) && (
        <div className="pc-nchips">
          {n.reminder_at && !n.reminder_done && (
            <button className={`pc-nchip pc-nchip-rem ${overdue ? 'due' : ''}`} title="Mark reminder done"
              onClick={e => { e.stopPropagation(); onDone(); }}>
              <i className="bi bi-alarm" /> {reminderLabel(n.reminder_at)}
            </button>
          )}
          {brandName && <span className="pc-nchip pc-nchip-brand"><i className="bi bi-shop" /> {brandName}</span>}
          {n.month && <span className="pc-nchip pc-nchip-prog"><i className="bi bi-calendar3" /> {monthLabel(n.month)}</span>}
          {(n.labels || []).map(l => <span key={l} className="pc-nchip"><i className="bi bi-tag" /> {l}</span>)}
        </div>
      )}

      <div className="pc-ncard-actions" onClick={e => e.stopPropagation()}>
        <button title={n.archived ? 'Unarchive' : 'Archive'} onClick={onArchive}><i className={`bi ${n.archived ? 'bi-arrow-counterclockwise' : 'bi-archive'}`} /></button>
        <button className="pc-ndel" title="Delete" onClick={onDelete}><i className="bi bi-trash" /></button>
      </div>
    </div>
  );
}

/* ── create / edit composer (auto-saves, Google Keep-style) ── */
export function NoteEditor({ editor, brands, brandById, month, onClose, onPersist, onDelete, overlayClass = '' }) {
  const src = editor.note || {};
  const [f, setF] = useState({
    title: src.title || '',
    body: src.body || '',
    color: src.color || 'default',
    brand_id: src.brand_id || '',
    month: src.month || '',
    labels: src.labels || [],
    pinned: !!src.pinned,
  });
  const [reminderInput, setReminderInput] = useState(toLocalInput(src.reminder_at));
  const [labelInput, setLabelInput] = useState('');
  const [status, setStatus] = useState(''); // '' | 'saving' | 'saved'
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

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
    month: f.month || null,
    labels: f.labels,
    pinned: f.pinned,
    reminder_at: fromLocalInput(reminderInput),
  });

  const flush = useCallback(async () => {
    const payload = buildPayload();
    if (!payload.title && !htmlToText(payload.body)) return; // never persist a blank note
    if (savingRef.current) { dirtyRef.current = true; return; }
    savingRef.current = true;
    setStatus('saving');
    const newId = await onPersist(payload);
    if (newId && !idRef.current) idRef.current = newId;
    savingRef.current = false;
    setStatus('saved');
    if (dirtyRef.current) { dirtyRef.current = false; flush(); }
  }, [f, reminderInput, onPersist]);

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

  function addLabel(raw) {
    const v = (raw ?? labelInput).trim().replace(/^#/, '');
    if (v && !f.labels.includes(v)) set('labels', [...f.labels, v]);
    setLabelInput('');
  }

  return (
    <div className={`pc-overlay ${overlayClass}`} onClick={close}>
      <div className="pc-modal pc-modal-scroll pc-note-modal" onClick={e => e.stopPropagation()}
        style={{ background: colorBg(f.color) }}>
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

        <div className="pc-nrow">
          <div className="pc-field"><label>Brand</label>
            <select className="pc-input" value={f.brand_id} onChange={e => set('brand_id', e.target.value)}>
              <option value="">— None —</option>
              {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="pc-field"><label>Program (month)</label>
            <input className="pc-input" type="month" value={f.month}
              onChange={e => set('month', e.target.value)} />
          </div>
        </div>

        <div className="pc-field"><label>Reminder</label>
          <div className="pc-nrem-row">
            <input className="pc-input" type="datetime-local" value={reminderInput}
              onChange={e => { setReminderInput(e.target.value); if (e.target.value) requestNotificationPermission(); }} />
            {reminderInput && <button className="pc-btn pc-btn-ghost pc-btn-sm" onClick={() => setReminderInput('')}>Clear</button>}
          </div>
          <div className="pc-nrem-hint">Shows a browser + in-app notification when due. Allow notifications when prompted.</div>
        </div>

        {/* color swatches */}
        <div className="pc-nswatches">
          {NOTE_COLORS.map(c => (
            <button key={c.key} title={c.label}
              className={`pc-nswatch ${f.color === c.key ? 'on' : ''}`}
              style={{ background: c.bg }} onClick={() => set('color', c.key)} />
          ))}
        </div>
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
export function BrandNotesDrawer({ brandId, brandName, brands, brandById, month, notes = [], onClose, onChanged }) {
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
                    <button key={n.id} className="pc-bnitem" style={{ background: colorBg(n.color) }} onClick={() => setEditor({ mode: 'edit', note: n })}>
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
        <NoteEditor editor={editor} brands={brands} brandById={brandById} month={month}
          overlayClass="pc-overlay-top"
          onClose={() => setEditor(null)} onPersist={persist}
          onDelete={editor.mode === 'edit' ? () => { setEditor(null); remove(editor.note); } : null} />
      )}
    </>
  );
}

/* ── All-notes drawer ──
   Global, searchable list of every note — opened from the floating notes button
   so any note is reachable from anywhere in the handler workspace. Also reused
   by the Super Boss "Ads Manager notes" view (canCreate=false, notes carry an
   injected owner_name shown as a chip). Includes a brand-wise filter. */
export function AllNotesDrawer({ notes = [], brands, brandById, month, onClose, onChanged, canCreate = true, title = 'All notes' }) {
  const [list, setList] = useState(() => notes.filter(n => !n.archived));
  const [editor, setEditor] = useState(null);
  const [search, setSearch] = useState('');
  const [brandFilter, setBrandFilter] = useState('all'); // 'all' | 'none' | <brand_id>
  useEffect(() => { setList(notes.filter(n => !n.archived)); }, [notes]);

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
      (n.brand_id && (brandById[n.brand_id]?.name || '').toLowerCase().includes(q)));
    return [...l].sort((a, b) => (b.pinned - a.pinned) || (new Date(b.updated_at) - new Date(a.updated_at)));
  }, [list, search, brandFilter, brandById]);

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
              <button className="pc-btn pc-btn-primary pc-btn-sm" onClick={() => setEditor({ mode: 'add', note: { color: 'default', labels: [], brand_id: null, month: month || null } })}>
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
            {brandOptions.length > 0 && (
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
                  return (
                    <button key={n.id} className="pc-bnitem" style={{ background: colorBg(n.color) }} onClick={() => setEditor({ mode: 'edit', note: n })}>
                      {n.pinned && <i className="bi bi-pin-angle-fill pc-bnpin" />}
                      {n.title && <div className="pc-bntitle">{n.title}</div>}
                      {text && <div className="pc-bnsnippet">{text}</div>}
                      {(n.owner_name || brandName || n.reminder_at || n.month || (n.labels || []).length > 0) && (
                        <div className="pc-nchips">
                          {n.owner_name && <span className="pc-nchip"><i className="bi bi-person-badge" /> {n.owner_name}</span>}
                          {n.reminder_at && !n.reminder_done && <span className={`pc-nchip pc-nchip-rem ${overdue ? 'due' : ''}`}><i className="bi bi-alarm" /> {reminderLabel(n.reminder_at)}</span>}
                          {brandName && <span className="pc-nchip pc-nchip-brand"><i className="bi bi-shop" /> {brandName}</span>}
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
        <NoteEditor editor={editor} brands={brands} brandById={brandById} month={month}
          overlayClass="pc-overlay-top"
          onClose={() => setEditor(null)} onPersist={persist}
          onDelete={editor.mode === 'edit' ? () => { setEditor(null); remove(editor.note); } : null} />
      )}
    </>
  );
}
