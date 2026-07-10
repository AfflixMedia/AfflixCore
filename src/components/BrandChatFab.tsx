import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import { brandDetailId } from './AdsNotesFab';
import '../pages/handler-collab/handlerCollab.css';

/* Floating chat button — Brand Detail pages only. Jumps straight into the
   brand's auto-managed chat group (`chat_conversations.brand_id`). Rendered
   for every chat-capable role; the conversation lookup is RLS-scoped
   (`is_chat_viewer`), so non-members of the brand group simply get no row
   and the button stays hidden. Stacks above the notes fab when both show. */

export default function BrandChatFab() {
  const { profile } = useAuth();
  const location = useLocation();
  const nav = useNavigate();

  const brandId = brandDetailId(location.pathname);
  const role = profile?.role ?? '';
  const chatRole = ['bob', 'team_lead', 'apc', 'ads_manager'].includes(role);

  const [convId, setConvId] = useState<string | null>(null);

  useEffect(() => {
    setConvId(null);
    if (!brandId || !chatRole) return;
    let alive = true;
    supabase.from('chat_conversations').select('id')
      .eq('brand_id', brandId).maybeSingle()
      .then(({ data }) => { if (alive) setConvId((data as any)?.id ?? null); });
    return () => { alive = false; };
  }, [brandId, chatRole]);

  if (!brandId || !chatRole || !convId) return null;

  // The notes fab now shows app-wide for every chat-capable role (Ads Manager
  // board, Super Boss GMV-Max oversight, own-notes mode for bob/team_lead/apc),
  // so the chat fab always stacks above it here.
  return (
    <div className="pc-app" style={{ display: 'contents' }}>
      <button
        className="pc-notesfab pc-chatfab pc-fab-up"
        title="Open brand chat" aria-label="Open brand chat"
        onClick={() => nav(`/chats?c=${convId}`)}>
        <i className="bi bi-chat-dots" />
      </button>
    </div>
  );
}
