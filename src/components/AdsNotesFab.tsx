import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import * as store from '../pages/handler-collab/store';
import { AllNotesDrawer as AllNotesDrawerImpl } from '../pages/handler-collab/NotesBoard';
import '../pages/handler-collab/handlerCollab.css';

// NotesBoard.tsx is @ts-nocheck, so its exports infer `never[]` prop types; treat as any.
const AllNotesDrawer = AllNotesDrawerImpl as any;

/* Floating notes button — mounted app-wide (Layout). Three audiences:
   - Ads Manager (everywhere): their own Keep-style notes in the owner-scoped
     `handler_notes` table + notes a Super Boss shared with them (read-only,
     policy "handler_notes ads read shared"). On a Brand Detail page the
     drawer pins to THAT brand: only its notes, new notes pre-linked to it.
   - Super Boss (Brand Detail, GMV Max tab ONLY): that brand's Ads Manager
     notes + his own (owner chip per note). He can add notes (auto-linked to
     the brand) and share his own with Ads Managers ("Share with Ads
     Managers" toggle → `shared_with_ads`).
   - Bob / Team Lead / APC (everywhere, own-notes mode): their OWN notes only
     — the floating counterpart of the /my-notes board. Loads owner-scoped
     (Bob's read-all RLS would otherwise include everyone's notes) and pins
     to the brand on Brand Detail pages like the Ads Manager view. */

function thisMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// "/brands/<uuid>" → the brand id (Brand Detail page), else null.
export function brandDetailId(pathname: string): string | null {
  const m = pathname.match(/^\/brands\/([0-9a-fA-F-]{36})\/?$/);
  return m ? m[1] : null;
}

// True once the window has been scrolled — the floating fabs stay hidden at
// the top of the page and fade in on scroll (shared with BrandChatFab).
export function usePageScrolled(threshold = 8): boolean {
  const [scrolled, setScrolled] = useState(() => window.scrollY > threshold);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return scrolled;
}

export default function AdsNotesFab() {
  const { profile } = useAuth();
  const location = useLocation();
  const scrolled = usePageScrolled();
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

  const reload = useCallback(async () => {
    try {
      if (isOwnView) {
        // Own notes only — Bob's read-all RLS would otherwise include everyone's.
        setNotes(profile?.id ? await store.loadNotes(profile.id) : []);
        return;
      }
      if (isAdsManager) {
        // Own notes + shared Super Boss notes (read-only). Tag foreign notes
        // with the sharer's name so the drawer shows who they came from.
        const list = await store.loadNotes();
        const foreign = [...new Set(list.map(n => n.owner_id)
          .filter(oid => oid && oid !== profile?.id))];
        let nameById: Record<string, string> = {};
        if (foreign.length) {
          const { data } = await supabase.from('profiles')
            .select('id, full_name, email').in('id', foreign);
          nameById = Object.fromEntries(((data as any[]) ?? [])
            .map(p => [p.id, p.full_name || p.email || 'Super Boss']));
        }
        setNotes(list.map(n => n.owner_id === profile?.id
          ? n : { ...n, owner_name: nameById[n.owner_id] || 'Super Boss' }));
        return;
      }
      // Super Boss: every ads_manager's notes (tagged with the owner's name)
      // PLUS his own notes (he can create new ones — owned by him).
      const { data: mgrs, error: mErr } = await supabase
        .from('profiles').select('id, full_name, email').eq('role', 'ads_manager');
      if (mErr) throw mErr;
      const list = (mgrs as any[]) ?? [];
      const nameById: Record<string, string> = Object.fromEntries(
        list.map(m => [m.id, m.full_name || m.email || 'Ads Manager']));
      const ownerIds = list.map(m => m.id);
      if (profile?.id) { ownerIds.push(profile.id); nameById[profile.id] = 'My note'; }
      if (!ownerIds.length) { setNotes([]); return; }
      const { data, error } = await supabase.from('handler_notes').select('*')
        .in('owner_id', ownerIds)
        .order('pinned', { ascending: false })
        .order('updated_at', { ascending: false });
      if (error) throw error;
      setNotes(((data as any[]) ?? []).map(n => ({ ...n, owner_name: nameById[n.owner_id] })));
    } catch { /* ignore */ }
  }, [isAdsManager, isOwnView, profile?.id]);

  // Initial load: notes + brands (for the brand link/chips + brand-wise filter).
  useEffect(() => {
    if (!active) { setOpen(false); return; }
    reload();
    supabase.from('brands').select('id,name').order('name')
      .then(({ data }) => setBrands((data as any[]) ?? []));
  }, [active, reload]);

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

  const canEditNote = (n: any) => isBossView || !n?.owner_id || n.owner_id === profile?.id;
  // Only the Super Boss shares, and only his OWN notes (new notes have no owner yet).
  const canShareNote = (n: any) => isBossView && (!n?.owner_id || n.owner_id === profile?.id);

  const title = fixedBrand
    ? `${fixedBrand.name} — notes`
    : isBossView ? 'Ads Manager notes' : isOwnView ? 'My notes' : 'All notes';

  // display:contents keeps the .pc-app font/token context (for the pc-* drawer)
  // without painting the full-screen .pc-app background box.
  return (
    <div className="pc-app" style={{ display: 'contents' }}>
      <button className={`pc-notesfab${scrolled ? '' : ' pc-fab-hidden'}`} onClick={() => setOpen(true)}
        title={isBossView ? 'Ads Manager notes' : 'Notes'} aria-label="Open notes">
        <i className="bi bi-journal-text" />
        {due > 0 && <span className="pc-notesfab-badge">{due}</span>}
      </button>
      {open && (
        <AllNotesDrawer notes={notes} brands={brands} brandById={brandById} month={thisMonthKey()}
          title={title} fixedBrand={fixedBrand}
          canEditNote={canEditNote} canShareNote={canShareNote}
          onClose={() => setOpen(false)} onChanged={reload} />
      )}
    </div>
  );
}
