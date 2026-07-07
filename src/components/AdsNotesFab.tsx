import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import * as store from '../pages/handler-collab/store';
import { AllNotesDrawer as AllNotesDrawerImpl } from '../pages/handler-collab/NotesBoard';
import '../pages/handler-collab/handlerCollab.css';

// NotesBoard.tsx is @ts-nocheck, so its exports infer `never[]` prop types; treat as any.
const AllNotesDrawer = AllNotesDrawerImpl as any;

/* Floating notes button for the Ads Manager — mounted app-wide (Layout) so the
   Keep-style notes drawer is reachable from any page. Notes live in the same
   owner-scoped `handler_notes` table as the Paid Collab handler board, so an
   Ads Manager only ever sees their own notes. */

function thisMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function AdsNotesFab() {
  const { profile } = useAuth();
  const isAdsManager = profile?.role === 'ads_manager';

  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<any[]>([]);
  const [brands, setBrands] = useState<any[]>([]);

  const reload = useCallback(async () => {
    try { setNotes(await store.loadNotes()); } catch { /* ignore */ }
  }, []);

  // Initial load: notes + the Ads Manager's brands (for the brand link/chips).
  useEffect(() => {
    if (!isAdsManager) return;
    reload();
    supabase.from('brands').select('id,name').order('name')
      .then(({ data }) => setBrands((data as any[]) ?? []));
  }, [isAdsManager, reload]);

  // Fire due reminders in-app (like the handler workspace) so they surface even
  // without pg_cron, and refresh the badge when any fire.
  useEffect(() => {
    if (!isAdsManager) return;
    const tick = () => { store.fireDueNoteReminders().then(c => { if (c > 0) reload(); }).catch(() => {}); };
    tick();
    const iv = setInterval(tick, 60000);
    return () => clearInterval(iv);
  }, [isAdsManager, reload]);

  // Live sync across tabs/devices.
  useEffect(() => {
    if (!isAdsManager || !supabase) return;
    let t: any = null;
    const ping = () => { clearTimeout(t); t = setTimeout(reload, 300); };
    const ch = supabase.channel('ads-notes-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'handler_notes' }, ping)
      .subscribe();
    return () => { clearTimeout(t); try { supabase.removeChannel(ch); } catch {} };
  }, [isAdsManager, reload]);

  if (!isAdsManager) return null;

  const brandById = Object.fromEntries(brands.map(b => [b.id, b]));
  const due = notes.filter(n =>
    !n.archived && n.reminder_at && !n.reminder_done && new Date(n.reminder_at) <= new Date()).length;

  // display:contents keeps the .pc-app font/token context (for the pc-* drawer)
  // without painting the full-screen .pc-app background box.
  return (
    <div className="pc-app" style={{ display: 'contents' }}>
      <button className="pc-notesfab" onClick={() => setOpen(true)} title="Notes" aria-label="Open notes">
        <i className="bi bi-journal-text" />
        {due > 0 && <span className="pc-notesfab-badge">{due}</span>}
      </button>
      {open && (
        <AllNotesDrawer notes={notes} brands={brands} brandById={brandById} month={thisMonthKey()}
          onClose={() => setOpen(false)} onChanged={reload} />
      )}
    </div>
  );
}
