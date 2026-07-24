import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import NotesBoardImpl from './handler-collab/NotesBoard';
import './handler-collab/handlerCollab.css';

// NotesBoard.tsx is @ts-nocheck, so its props infer `never[]`; treat as any.
const NotesBoard = NotesBoardImpl as any;

/* My Notes — personal Google-Keep-style board for Bob / Team Lead / APC
   (route /my-notes), reusing the Paid Collab handler's NotesBoard. Same
   concept as the Ads Manager board (/notes, AdsManagerNotes.tsx — untouched)
   but ALWAYS owner-only: notes are owner-scoped in `handler_notes`, and Bob's
   read-all RLS would otherwise pull everyone's notes onto his personal board.
   Also reachable from anywhere via the floating button (AdsNotesFab, own-notes
   mode), which fires due reminders in-app. */

function thisMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function MyNotes() {
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
