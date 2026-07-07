import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import NotesBoardImpl from './handler-collab/NotesBoard';
import './handler-collab/handlerCollab.css';

// NotesBoard.tsx is @ts-nocheck, so its props infer `never[]`; treat as any.
const NotesBoard = NotesBoardImpl as any;

/* Ads Manager notes board — the full Google-Keep-style board (label/brand rail,
   pinned sections, reminders), reusing the Paid Collab handler's NotesBoard.
   Notes are owner-scoped in `handler_notes`, so each Ads Manager sees only
   their own. Also reachable from anywhere via the floating button (AdsNotesFab). */

function thisMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function AdsManagerNotes() {
  const [brands, setBrands] = useState<any[]>([]);

  useEffect(() => {
    supabase.from('brands').select('id,name').order('name')
      .then(({ data }) => setBrands((data as any[]) ?? []));
  }, []);

  const brandById = Object.fromEntries(brands.map(b => [b.id, b]));

  return (
    <div className="pc-app" style={{ minHeight: 'auto', background: 'transparent' }}>
      <NotesBoard brands={brands} brandById={brandById} month={thisMonthKey()} />
    </div>
  );
}
