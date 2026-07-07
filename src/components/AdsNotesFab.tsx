import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import * as store from '../pages/handler-collab/store';
import { AllNotesDrawer as AllNotesDrawerImpl } from '../pages/handler-collab/NotesBoard';
import '../pages/handler-collab/handlerCollab.css';

// NotesBoard.tsx is @ts-nocheck, so its exports infer `never[]` prop types; treat as any.
const AllNotesDrawer = AllNotesDrawerImpl as any;

/* Floating notes button — mounted app-wide (Layout). Two audiences:
   - Ads Manager (everywhere): their own Keep-style notes in the owner-scoped
     `handler_notes` table (same board as the Paid Collab handler workspace).
   - Super Boss (Brands pages only): sees + edits ALL Ads Managers' notes
     (RLS policy "handler_notes superbob ads all"); each note shows an
     owner chip. He can also add notes — those are owned by him ("My note"
     chip) and listed alongside the Ads Managers'. */

function thisMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function AdsNotesFab() {
  const { profile } = useAuth();
  const location = useLocation();
  const isAdsManager = profile?.role === 'ads_manager';
  // Super Boss only (not regular Bobs), and only while on the Brands pages.
  const isBossView = !!profile?.is_superbob && profile?.role === 'bob'
    && location.pathname.startsWith('/brands');
  const active = isAdsManager || isBossView;

  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);

  const reload = useCallback(async () => {
    try {
      if (isAdsManager) { setNotes(await store.loadNotes()); return; }
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
  }, [isAdsManager, profile?.id]);

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
    if (!isAdsManager) return;
    const tick = () => { store.fireDueNoteReminders().then(c => { if (c > 0) reload(); }).catch(() => {}); };
    tick();
    const iv = setInterval(tick, 60000);
    return () => clearInterval(iv);
  }, [isAdsManager, reload]);

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

  if (!active) return null;

  const brandById = Object.fromEntries(brands.map(b => [b.id, b]));
  const due = notes.filter(n =>
    !n.archived && n.reminder_at && !n.reminder_done && new Date(n.reminder_at) <= new Date()).length;

  // display:contents keeps the .pc-app font/token context (for the pc-* drawer)
  // without painting the full-screen .pc-app background box.
  return (
    <div className="pc-app" style={{ display: 'contents' }}>
      <button className="pc-notesfab" onClick={() => setOpen(true)}
        title={isBossView ? 'Ads Manager notes' : 'Notes'} aria-label="Open notes">
        <i className="bi bi-journal-text" />
        {due > 0 && <span className="pc-notesfab-badge">{due}</span>}
      </button>
      {open && (
        <AllNotesDrawer notes={notes} brands={brands} brandById={brandById} month={thisMonthKey()}
          title={isBossView ? 'Ads Manager notes' : 'All notes'}
          onClose={() => setOpen(false)} onChanged={reload} />
      )}
    </div>
  );
}
