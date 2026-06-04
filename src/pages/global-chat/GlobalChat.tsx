// Global Chat — WhatsApp-style internal messaging. Left: conversation list.
// Right: active chat. Realtime keeps everything live across concurrent users;
// message order/time come from the server so simultaneous sends never overlap.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Spinner } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../auth/AuthContext';
import { useNotifications } from '../../notifications/NotificationsContext';
import ConversationList from './ConversationList';
import ChatPanel from './ChatPanel';
import NewChatModal from './NewChatModal';
import ForwardModal from './ForwardModal';
import {
  listContacts, listConversations, listParticipants, fetchOverview,
  fetchMessages, getOrCreateDm, sendMessage, markConversationRead,
} from './chatApi';
import type {
  ChatContact, Conversation, Participant, ChatMessage, ConversationOverview, ConversationView,
} from './types';
import { contactName } from './types';

export default function GlobalChat() {
  const { user, profile } = useAuth();
  const { markReadByConversation } = useNotifications();
  const myId = user?.id ?? '';

  const [params, setParams] = useSearchParams();
  const activeId = params.get('c');

  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [overview, setOverview] = useState<Map<string, ConversationOverview>>(new Map());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [forwardMsg, setForwardMsg] = useState<ChatMessage | null>(null);
  const [showNewChat, setShowNewChat] = useState(false);

  const activeIdRef = useRef<string | null>(activeId);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  // Keep the (non-memoized) notification helper in a ref so the realtime
  // subscription and openConversation don't resubscribe/refetch every render.
  const markReadRef = useRef(markReadByConversation);
  useEffect(() => { markReadRef.current = markReadByConversation; }, [markReadByConversation]);

  // ---- Directory: every internal user we may need to name (contacts + me) ----
  const directory = useMemo(() => {
    const m = new Map<string, ChatContact>();
    contacts.forEach(c => m.set(c.id, c));
    if (myId && profile) {
      m.set(myId, { id: myId, full_name: profile.full_name, email: profile.email, role: profile.role });
    }
    return m;
  }, [contacts, myId, profile]);

  // ---- Build the conversation view-models the UI renders ----
  const views: ConversationView[] = useMemo(() => {
    const partsByConv = new Map<string, Participant[]>();
    participants.forEach(p => {
      const arr = partsByConv.get(p.conversation_id) ?? [];
      arr.push(p);
      partsByConv.set(p.conversation_id, arr);
    });
    const list = conversations.map(conv => {
      const ov = overview.get(conv.id);
      let title = conv.title?.trim() || 'Group';
      let otherUser: ChatContact | null = null;
      if (!conv.is_group) {
        const others = (partsByConv.get(conv.id) ?? []).filter(p => p.user_id !== myId);
        otherUser = others[0] ? directory.get(others[0].user_id) ?? null : null;
        title = contactName(otherUser);
      }
      return {
        conversation: conv,
        title,
        otherUser,
        lastBody: ov?.last_body ?? null,
        lastSenderId: ov?.last_sender_id ?? null,
        lastAt: ov?.last_at ?? conv.last_message_at,
        unread: ov?.unread ?? 0,
      } as ConversationView;
    });
    list.sort((a, b) => new Date(b.lastAt ?? 0).getTime() - new Date(a.lastAt ?? 0).getTime());
    return list;
  }, [conversations, participants, overview, directory, myId]);

  const activeView = useMemo(
    () => views.find(v => v.conversation.id === activeId) ?? null,
    [views, activeId],
  );

  // ---- Data loaders ----
  const refreshOverview = useCallback(async () => {
    try {
      const ov = await fetchOverview();
      setOverview(new Map(ov.map(o => [o.conversation_id, o])));
    } catch { /* non-fatal */ }
  }, []);

  const reloadConversations = useCallback(async () => {
    const [convs, parts] = await Promise.all([listConversations(), listParticipants()]);
    setConversations(convs);
    setParticipants(parts);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [cs, convs, parts, ov] = await Promise.all([
        listContacts(), listConversations(), listParticipants(), fetchOverview(),
      ]);
      setContacts(cs);
      setConversations(convs);
      setParticipants(parts);
      setOverview(new Map(ov.map(o => [o.conversation_id, o])));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (myId) loadAll(); }, [myId, loadAll]);

  // ---- Load the active conversation's messages + mark it read ----
  const openConversation = useCallback(async (conversationId: string | null) => {
    if (!conversationId) { setMessages([]); return; }
    setMessagesLoading(true);
    setReplyTo(null);
    try {
      const msgs = await fetchMessages(conversationId);
      setMessages(msgs);
      if (myId) {
        await markConversationRead(conversationId, myId);
        setOverview(prev => {
          const next = new Map(prev);
          const o = next.get(conversationId);
          if (o) next.set(conversationId, { ...o, unread: 0 });
          return next;
        });
        markReadRef.current(conversationId);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setMessagesLoading(false);
    }
  }, [myId]);

  useEffect(() => { openConversation(activeId); }, [activeId, openConversation]);

  // ---- Realtime: new messages + being added to conversations ----
  useEffect(() => {
    if (!myId) return;
    const channel = supabase.channel(`global-chat:${myId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const m = payload.new as ChatMessage;
          if (m.conversation_id === activeIdRef.current) {
            setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m]);
            if (m.sender_id !== myId) {
              markConversationRead(m.conversation_id, myId).catch(() => {});
              markReadRef.current(m.conversation_id);
            }
          }
          refreshOverview();
        })
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_participants', filter: `user_id=eq.${myId}` },
        () => { reloadConversations().then(refreshOverview); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [myId, refreshOverview, reloadConversations]);

  // ---- Actions ----
  const selectConversation = (conversationId: string) => {
    params.set('c', conversationId);
    setParams(params, { replace: true });
  };

  const clearActive = () => {
    params.delete('c');
    setParams(params, { replace: true });
  };

  const startChatWith = async (contact: ChatContact) => {
    setShowNewChat(false);
    try {
      const convId = await getOrCreateDm(contact.id);
      await reloadConversations();
      await refreshOverview();
      selectConversation(convId);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleSend = async (body: string) => {
    if (!activeId || !myId) return;
    const reply = replyTo;
    setReplyTo(null);
    try {
      const saved = await sendMessage({
        conversationId: activeId,
        senderId: myId,
        body,
        replyToId: reply?.id ?? null,
      });
      setMessages(prev => prev.some(x => x.id === saved.id) ? prev : [...prev, saved]);
      refreshOverview();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const handleForward = async (contact: ChatContact) => {
    const msg = forwardMsg;
    if (!msg || !myId) return;
    try {
      const convId = await getOrCreateDm(contact.id);
      await sendMessage({
        conversationId: convId,
        senderId: myId,
        body: msg.body,
        isForwarded: true,
        forwardedFromId: msg.id,
      });
      await reloadConversations();
      await refreshOverview();
      setForwardMsg(null);
      selectConversation(convId);
    } catch (e) {
      setErr((e as Error).message);
      setForwardMsg(null);
    }
  };

  if (loading) {
    return <div className="text-center py-5"><Spinner animation="border" /></div>;
  }

  return (
    <div className={`ac-chat-shell ${activeId ? 'has-active' : ''}`}>
      {err && <Alert variant="danger" className="m-2 mb-0" onClose={() => setErr(null)} dismissible>{err}</Alert>}
      <div className="ac-chat-grid">
        <ConversationList
          views={views}
          activeId={activeId}
          myId={myId}
          onSelect={selectConversation}
          onStartChat={() => setShowNewChat(true)}
        />
        <ChatPanel
          view={activeView}
          messages={messages}
          loading={messagesLoading}
          myId={myId}
          directory={directory}
          replyTo={replyTo}
          onReply={setReplyTo}
          onForward={(m) => setForwardMsg(m)}
          onSend={handleSend}
          onBack={clearActive}
        />
      </div>

      <NewChatModal
        show={showNewChat}
        contacts={contacts}
        loading={loading}
        onPick={startChatWith}
        onClose={() => setShowNewChat(false)}
      />
      <ForwardModal
        show={!!forwardMsg}
        message={forwardMsg}
        contacts={contacts}
        onForward={handleForward}
        onClose={() => setForwardMsg(null)}
      />
    </div>
  );
}
