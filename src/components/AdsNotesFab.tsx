import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import * as store from '../pages/handler-collab/store';
import { AllNotesDrawer as AllNotesDrawerImpl } from '../pages/handler-collab/NotesBoard';
import '../pages/handler-collab/handlerCollab.css';

// NotesBoard.tsx is @ts-nocheck, so its exports infer `never[]` prop types; treat as any.
const AllNotesDrawer = AllNotesDrawerImpl as any;

/* Floating notes button — mounted app-wide (Layout). Two loading modes:
   - Normal (Ads Manager everywhere; Bob / Team Lead / APC own-notes mode): the
     viewer's OWN notes + notes SHARED with them, via list_visible_notes(). Cards
     are tinted by the sharer's role; own notes are white. Internal staff can
     share their own notes with role groups (+ Everyone / a specific team for the
     Super Boss). On a Brand Detail page the drawer pins to THAT brand.
   - Super Boss oversight (Brand Detail, GMV Max tab ONLY): every Ads Manager's
     notes + his own (owner chip per note) via the "superbob ads all" policy —
     this is management, not the sharing path. He can add + edit them here. */

function thisMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// "/brands/<uuid>" → the brand id (Brand Detail page), else null.
export function brandDetailId(pathname: string): string | null {
  const m = pathname.match(/^\/brands\/([0-9a-fA-F-]{36})\/?$/);
  return m ? m[1] : null;
}

/* Drag-to-place for the floating fabs (notes + brand chat). Pointer-based:
   press-and-drag moves the button anywhere in the window (clamped to the
   viewport), the drop position persists per-fab in localStorage as
   right/bottom offsets (so the default corner anchoring survives resizes),
   and a plain click still opens the fab — a real drag suppresses the click. */
type FabPos = { right: number; bottom: number };

export function useDraggableFab(storageKey: string) {
  const [pos, setPos] = useState<FabPos | null>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as FabPos) : null;
    } catch { return null; }
  });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; startY: number; right: number; bottom: number; moved: boolean; el: HTMLElement } | null>(null);
  const suppressClick = useRef(false);

  const clamp = (right: number, bottom: number, el: HTMLElement): FabPos => ({
    right: Math.min(Math.max(right, 8), Math.max(8, window.innerWidth - el.offsetWidth - 8)),
    bottom: Math.min(Math.max(bottom, 8), Math.max(8, window.innerHeight - el.offsetHeight - 8)),
  });

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    drag.current = {
      startX: e.clientX, startY: e.clientY,
      right: window.innerWidth - rect.right,
      bottom: window.innerHeight - rect.bottom,
      moved: false, el,
    };
    el.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX, dy = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.abs(dx) + Math.abs(dy) < 6) return; // dead zone: keep taps as clicks
      d.moved = true;
      setDragging(true);
    }
    setPos(clamp(d.right - dx, d.bottom - dy, d.el));
  };
  const endDrag = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    if (!d.moved) return;
    suppressClick.current = true;
    const p = clamp(d.right - (e.clientX - d.startX), d.bottom - (e.clientY - d.startY), d.el);
    setPos(p);
    try { localStorage.setItem(storageKey, JSON.stringify(p)); } catch { /* ignore */ }
  };
  const onClickCapture = (e: ReactMouseEvent<HTMLElement>) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const style: CSSProperties | undefined = pos
    ? { right: pos.right, bottom: pos.bottom, ...(dragging ? { transition: 'none' } : null) }
    : undefined;
  return {
    style,
    handlers: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, onClickCapture },
  };
}

export default function AdsNotesFab() {
  const { profile } = useAuth();
  const location = useLocation();
  const fabDrag = useDraggableFab('ac_fab_pos_notes');
  const isAdsManager = profile?.role === 'ads_manager';

  const brandId = brandDetailId(location.pathname);
  const tab = new URLSearchParams(location.search).get('tab');
  // Super Boss only (not regular Bobs), and ONLY on a brand's GMV Max tab.
  const isBossView = !!profile?.is_superbob && profile?.role === 'bob'
    && !!brandId && tab === 'gmv-max';
  // Bob / Team Lead / APC: personal own-notes mode (boss view wins where both apply).
  const isOwnView = !isBossView && ['bob', 'team_lead', 'apc'].includes(profile?.role ?? '');
  const active = isAdsManager || isBossView || isOwnView;

  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);
  const [teamLeads, setTeamLeads] = useState<any[]>([]);
  const [labelCatalog, setLabelCatalog] = useState<any[]>([]);

  const reload = useCallback(async () => {
    try {
      if (isBossView) {
        // Super Boss oversight (GMV-Max tab): every ads_manager's notes PLUS his
        // own — coloured by the owner's role. This is NOT the sharing path.
        const { data: mgrs, error: mErr } = await supabase
          .from('profiles').select('id, full_name, email, role, is_superbob').eq('role', 'ads_manager');
        if (mErr) throw mErr;
        const list = (mgrs as any[]) ?? [];
        const meta: Record<string, any> = {};
        list.forEach(m => { meta[m.id] = { name: m.full_name || m.email || 'Ads Manager', role: m.role, super: !!m.is_superbob }; });
        const ownerIds = list.map(m => m.id);
        if (profile?.id) { ownerIds.push(profile.id); meta[profile.id] = { name: 'My note', role: profile.role, super: !!profile.is_superbob }; }
        if (!ownerIds.length) { setNotes([]); return; }
        const { data, error } = await supabase.from('handler_notes').select('*')
          .in('owner_id', ownerIds)
          .order('pinned', { ascending: false })
          .order('updated_at', { ascending: false });
        if (error) throw error;
        setNotes(((data as any[]) ?? []).map(n => ({
          ...n,
          owner_name: meta[n.owner_id]?.name,
          owner_role: meta[n.owner_id]?.role,
          owner_is_superbob: meta[n.owner_id]?.super,
          is_owner: n.owner_id === profile?.id,
        })));
        return;
      }
      // Everyone else (ads_manager / bob / team_lead / apc): own + shared-to-me,
      // with owner role/name folded in by list_visible_notes.
      setNotes(await store.loadVisibleNotes());
    } catch { /* ignore */ }
  }, [isBossView, profile?.id, profile?.role, profile?.is_superbob]);

  const reloadLabels = useCallback(async () => {
    if (!profile?.id) return;
    try { setLabelCatalog(await store.loadNoteLabels(profile.id)); } catch { /* ignore */ }
  }, [profile?.id]);
  const onCreateLabel = useCallback(async (name: string) => {
    try { await store.upsertNoteLabel(name); reloadLabels(); } catch { /* ignore */ }
  }, [reloadLabels]);

  // Initial load: notes + brands + label catalogue (+ team leads for Super Boss).
  useEffect(() => {
    if (!active) { setOpen(false); return; }
    reload();
    reloadLabels();
    supabase.from('brands').select('id,name').order('name')
      .then(({ data }) => setBrands((data as any[]) ?? []));
    if (profile?.is_superbob) {
      supabase.from('profiles').select('id, full_name, email').eq('role', 'team_lead').order('full_name')
        .then(({ data }) => setTeamLeads(((data as any[]) ?? []).map(p => ({ id: p.id, name: p.full_name || p.email || 'Team Lead' }))));
    }
  }, [active, reload, reloadLabels, profile?.is_superbob]);

  // Fire due reminders in-app (like the handler workspace) so they surface even
  // without pg_cron, and refresh the badge when any fire. Owners only.
  useEffect(() => {
    if (!isAdsManager && !isOwnView) return;
    const tick = () => { store.fireDueNoteReminders().then(c => { if (c > 0) reload(); }).catch(() => {}); };
    tick();
    const iv = setInterval(tick, 60000);
    return () => clearInterval(iv);
  }, [isAdsManager, isOwnView, reload]);

  // Live sync across tabs/devices.
  useEffect(() => {
    if (!active || !supabase) return;
    let t: any = null;
    const ping = () => { clearTimeout(t); t = setTimeout(reload, 300); };
    const ch = supabase.channel('ads-notes-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'handler_notes' }, ping)
      .subscribe();
    return () => { clearTimeout(t); try { supabase.removeChannel(ch); } catch {} };
  }, [active, reload]);

  const brandById = useMemo(
    () => Object.fromEntries(brands.map(b => [b.id, b])), [brands]);

  // On a Brand Detail page the drawer pins to that brand (both audiences).
  const fixedBrand = useMemo(
    () => (brandId ? { id: brandId, name: brandById[brandId]?.name || 'This brand' } : null),
    [brandId, brandById]);

  if (!active) return null;

  const inScope = (n: any) => !fixedBrand || n.brand_id === fixedBrand.id;
  const due = notes.filter(n =>
    !n.archived && inScope(n)
    && n.reminder_at && !n.reminder_done && new Date(n.reminder_at) <= new Date()).length;

  // Own notes editable; shared-in notes read-only. Super Boss oversight also
  // edits ads_manager notes (his GMV-Max tab), but the editor suppresses the
  // Share section on notes he doesn't own.
  const canEditNote = (n: any) => isBossView || (n?.is_owner ?? (!n?.owner_id || n.owner_id === profile?.id));

  const title = fixedBrand
    ? `${fixedBrand.name} — notes`
    : isBossView ? 'Ads Manager notes' : isOwnView ? 'My notes' : 'All notes';

  // display:contents keeps the .pc-app font/token context (for the pc-* drawer)
  // without painting the full-screen .pc-app background box.
  return (
    <div className="pc-app" style={{ display: 'contents' }}>
      <button className="pc-notesfab" style={fabDrag.style} {...fabDrag.handlers}
        onClick={() => setOpen(true)}
        title={isBossView ? 'Ads Manager notes' : 'Notes'} aria-label="Open notes">
        <i className="bi bi-journal-text" />
        {due > 0 && <span className="pc-notesfab-badge">{due}</span>}
      </button>
      {open && (
        <AllNotesDrawer notes={notes} brands={brands} brandById={brandById} month={thisMonthKey()}
          title={title} fixedBrand={fixedBrand} canEditNote={canEditNote}
          viewerRole={profile?.role} viewerIsSuperbob={!!profile?.is_superbob}
          teamLeads={teamLeads} labelCatalog={labelCatalog} onCreateLabel={onCreateLabel}
          onClose={() => setOpen(false)} onChanged={reload} />
      )}
    </div>
  );
}
