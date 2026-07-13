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
import type { MessageComposerHandle } from './MessageComposer';
import NewChatModal from './NewChatModal';
import ForwardModal from './ForwardModal';
import GroupModal, { GroupMember } from './GroupModal';
import BookmarksModal from './BookmarksModal';
import DeleteMessageModal from './DeleteMessageModal';
import ContactModal from './ContactModal';
import {
  listContacts, listConversations, listParticipants, fetchOverview,
  fetchMessages, getOrCreateDm, sendMessage, markConversationRead, markDelivered,
  createGroup, addMember, removeMember, setMemberAdmin, renameConversation,
  getOrCreateAnnouncement, ensureAnnouncementMembership,
  fetchEvents, leaveConversation, deleteForEveryone, hideForMe, fetchHidden,
  fetchReactions, setReaction, clearReaction,
  fetchBookmarks, addBookmark, updateBookmark, deleteBookmark, setBookmarkAccess,
} from './chatApi';
import type {
  ChatContact, Conversation, Participant, ChatMessage, ConversationOverview, ConversationView,
  ChatEvent, ChatReaction, ChatBookmark, Receipt,
} from './types';
import { contactName, messageReceipts, rollupReceipt } from './types';

export default function GlobalChat() {
  const { user, profile } = useAuth();
  const { markReadByConversation } = useNotifications();
  const myId = user?.id ?? '';
  const isBob = profile?.role === 'bob';

  const [params, setParams] = useSearchParams();
  const activeId = params.get('c');

  const [contacts, setContacts] = useState<ChatContact[]>([]);
  // brand_id → owning Team Lead id (drives the Brands "by Team Lead" sub-filter).
  const [brandLeads, setBrandLeads] = useState<Map<string, string>>(new Map());
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [overview, setOverview] = useState<Map<string, ConversationOverview>>(new Map());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [reactions, setReactions] = useState<ChatReaction[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [forwardMsg, setForwardMsg] = useState<ChatMessage | null>(null);
  const [deleteMsg, setDeleteMsg] = useState<ChatMessage | null>(null);
  const [showNewChat, setShowNewChat] = useState(false);
  const [groupModal, setGroupModal] = useState<{ mode: 'create' | 'manage' | 'announcement' } | null>(null);
  // Bookmarks tab.
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [bookmarks, setBookmarks] = useState<ChatBookmark[]>([]);
  const [bookmarksLoading, setBookmarksLoading] = useState(false);
  // First unread message id at open time — drives the "Unread messages" divider.
  const [unreadAnchorId, setUnreadAnchorId] = useState<string | null>(null);
  // Contact card opened by clicking a @mention.
  const [contactCard, setContactCard] = useState<ChatContact | null>(null);
  // Handle into the active conversation's composer — the header members
  // dropdown, Group-info modal, and contact card use it to insert @mentions.
  const composerRef = useRef<MessageComposerHandle>(null);

  const activeIdRef = useRef<string | null>(activeId);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  // Keep the (non-memoized) notification helper in a ref so the realtime
  // subscription and openConversation don't resubscribe/refetch every render.
  const markReadRef = useRef(markReadByConversation);
  useEffect(() => { markReadRef.current = markReadByConversation; }, [markReadByConversation]);

  // Live snapshot of participants so openConversation can read the previous
  // last_read_at (the unread boundary) without re-running when it changes.
  const participantsRef = useRef(participants);
  useEffect(() => { participantsRef.current = participants; }, [participants]);

  // Mark a conversation read everywhere: DB, local participant row, unread
  // badge, and the notification bell. Used on open and on live incoming msgs.
  const markRead = useCallback(async (conversationId: string) => {
    if (!myId) return;
    try { await markConversationRead(conversationId, myId); } catch { /* non-fatal */ }
    const ts = new Date().toISOString();
    setParticipants(prev => {
      // Update my row — or add it, since the announcement creates its row lazily
      // on open and the local copy wouldn't have it yet.
      if (prev.some(p => p.conversation_id === conversationId && p.user_id === myId)) {
        return prev.map(p =>
          (p.conversation_id === conversationId && p.user_id === myId) ? { ...p, last_read_at: ts } : p);
      }
      return [...prev, {
        conversation_id: conversationId, user_id: myId, joined_at: ts, last_read_at: ts,
        last_delivered_at: ts, is_admin: false, left_at: null, history_from: null,
      }];
    });
    setOverview(prev => {
      const next = new Map(prev);
      const o = next.get(conversationId);
      if (o) next.set(conversationId, { ...o, unread: 0 });
      return next;
    });
    markReadRef.current(conversationId);
  }, [myId]);

  // ---- Directory: every internal user we may need to name (contacts + me) ----
  const directory = useMemo(() => {
    const m = new Map<string, ChatContact>();
    contacts.forEach(c => m.set(c.id, c));
    if (myId && profile) {
      m.set(myId, { id: myId, full_name: profile.full_name, email: profile.email, role: profile.role, avatar_url: profile.avatar_url });
    }
    return m;
  }, [contacts, myId, profile]);

  // Every internal staff member (contacts excludes me → add me back). Used for
  // the announcement roster + member count, which are role-based not row-based.
  const allStaff = useMemo<ChatContact[]>(() => {
    const arr = [...contacts];
    if (myId && profile) arr.push({ id: myId, full_name: profile.full_name, email: profile.email, role: profile.role, avatar_url: profile.avatar_url });
    return arr;
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
      const parts = partsByConv.get(conv.id) ?? [];
      const activeParts = parts.filter(p => !p.left_at);
      const members = activeParts
        .map(p => directory.get(p.user_id))
        .filter((c): c is ChatContact => !!c);
      const archived = !!parts.find(p => p.user_id === myId)?.left_at;
      // Tick state for my own last message (shown in the list preview). Skipped
      // for the announcement — its roster is role-based, not row-based.
      let lastReceipt: Receipt | null = null;
      if (ov?.last_sender_id === myId && ov?.last_at && !conv.is_announcement) {
        const partByUser = new Map(activeParts.map(p => [p.user_id, p]));
        const recips = activeParts
          .map(p => directory.get(p.user_id))
          .filter((c): c is ChatContact => !!c && c.id !== myId);
        lastReceipt = rollupReceipt(messageReceipts(ov.last_at, recips, id => partByUser.get(id)));
      }
      const isCreator = !archived && conv.created_by === myId;
      const iAmAdmin = !archived
        && (isCreator || activeParts.some(p => p.user_id === myId && p.is_admin));
      const canEditBookmarks = archived
        ? false
        : conv.is_announcement
          ? isBob
          : conv.is_group
            ? (iAmAdmin || conv.bookmarks_members_can_edit)
            : true;   // 1:1 DM — either participant
      let title: string;
      let otherUser: ChatContact | null = null;
      if (conv.is_announcement) {
        title = conv.title?.trim() || 'Announcements';
      } else if (conv.is_group) {
        title = conv.title?.trim() || 'Group';
      } else {
        const other = parts.find(p => p.user_id !== myId);
        otherUser = other ? directory.get(other.user_id) ?? null : null;
        title = contactName(otherUser);
      }
      return {
        conversation: conv,
        title,
        otherUser,
        members,
        iAmAdmin,
        isCreator,
        archived,
        canEditBookmarks,
        lastBody: ov?.last_body ?? null,
        lastSenderId: ov?.last_sender_id ?? null,
        lastAt: ov?.last_at ?? conv.last_message_at,
        lastReceipt,
        unread: ov?.unread ?? 0,
      } as ConversationView;
    });
    list.sort((a, b) => new Date(b.lastAt ?? 0).getTime() - new Date(a.lastAt ?? 0).getTime());
    return list;
  }, [conversations, participants, overview, directory, myId, isBob]);

  // brand_id → owning Team Lead as a resolved contact (Team Leads are staff, so
  // they're already in the directory). Feeds the Brands sub-filter chips.
  const brandLeadByBrand = useMemo(() => {
    const m = new Map<string, ChatContact>();
    brandLeads.forEach((leadId, brandId) => {
      const c = directory.get(leadId);
      if (c) m.set(brandId, c);
    });
    return m;
  }, [brandLeads, directory]);

  const activeView = useMemo(
    () => views.find(v => v.conversation.id === activeId) ?? null,
    [views, activeId],
  );

  // Read/delivery state per member of the active conversation → drives ticks.
  const activeParticipantsByUser = useMemo(() => {
    const m = new Map<string, Participant>();
    participants.forEach(p => { if (p.conversation_id === activeId) m.set(p.user_id, p); });
    return m;
  }, [participants, activeId]);

  // Messages I've hidden ("delete for me") are filtered out of my own view.
  const visibleMessages = useMemo(
    () => messages.filter(m => !hiddenIds.has(m.id)),
    [messages, hiddenIds]);

  // Reactions grouped per message for the panel.
  const reactionsByMsg = useMemo(() => {
    const m = new Map<string, ChatReaction[]>();
    reactions.forEach(r => { const a = m.get(r.message_id) ?? []; a.push(r); m.set(r.message_id, a); });
    return m;
  }, [reactions]);

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

  const reloadReactions = useCallback(async (cid: string) => {
    try { setReactions(await fetchReactions(cid)); } catch { /* non-fatal */ }
  }, []);
  const reloadEvents = useCallback(async (cid: string) => {
    try { setEvents(await fetchEvents(cid)); } catch { /* non-fatal */ }
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
      // Tell senders their messages reached me (double tick), then reflect my
      // own newly-bumped rows (incl. a lazily-created announcement row) locally.
      markDelivered().then(() => listParticipants().then(setParticipants)).catch(() => { /* non-fatal */ });
      // Brand → Team Lead ownership (RLS: Bob sees all, a Team Lead only their own)
      // — powers the Brands filter's "by Team Lead" sub-strip.
      supabase.from('team_lead_brands').select('brand_id, team_lead_id')
        .then(({ data }) => setBrandLeads(
          new Map(((data ?? []) as { brand_id: string; team_lead_id: string }[])
            .map(r => [r.brand_id, r.team_lead_id]))))
        .then(undefined, () => { /* non-fatal */ });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (myId) loadAll(); }, [myId, loadAll]);

  // ---- Load the active conversation's messages + events + reactions + hidden,
  //      compute the unread anchor, then mark it read ----
  const openConversation = useCallback(async (conversationId: string | null) => {
    if (!conversationId) {
      setMessages([]); setEvents([]); setReactions([]); setHiddenIds(new Set());
      setUnreadAnchorId(null); setHasMoreOlder(false); setBookmarks([]);
      return;
    }
    setMessagesLoading(true);
    setReplyTo(null);
    // Bookmarks feed the composer's "/" resource tags (brand groups: synced
    // with the brand's Resources). Non-fatal, loads alongside the messages.
    setBookmarks([]);
    fetchBookmarks(conversationId).then(setBookmarks).catch(() => { /* non-fatal */ });
    try {
      // Capture the read boundary BEFORE marking read, so we can place the
      // "Unread messages" divider at the first message we hadn't seen.
      const myRow = participantsRef.current.find(
        p => p.conversation_id === conversationId && p.user_id === myId);
      // No participant row only happens for the announcement (readable without
      // membership). Create one lazily so the read state persists — otherwise
      // markConversationRead updates nothing and the unread badge never clears.
      // Treat prior announcements as unread (epoch) for the divider on first open.
      if (!myRow) {
        try { await ensureAnnouncementMembership(conversationId, myId); } catch { /* non-fatal */ }
      }
      const boundary = myRow?.last_read_at ?? '1970-01-01T00:00:00.000Z';
      const [page, evs, rxns, hidden] = await Promise.all([
        fetchMessages(conversationId, { limit: 40 }),
        fetchEvents(conversationId),
        fetchReactions(conversationId),
        fetchHidden(conversationId, myId),
      ]);
      const msgs = page.messages;
      const anchor = msgs.find(m => m.sender_id !== myId
          && new Date(m.created_at).getTime() > new Date(boundary).getTime())?.id ?? null;
      setMessages(msgs);
      setHasMoreOlder(page.hasMore);
      setEvents(evs);
      setReactions(rxns);
      setHiddenIds(new Set(hidden));
      setUnreadAnchorId(anchor);
      await markRead(conversationId);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setMessagesLoading(false);
    }
  }, [myId, markRead]);

  useEffect(() => { openConversation(activeId); }, [activeId, openConversation]);

  // ---- Windowed history: load an older page when the user scrolls to the top ----
  const loadOlder = useCallback(async () => {
    const cid = activeIdRef.current;
    if (!cid) return;
    const oldest = messages[0]?.created_at;
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const page = await fetchMessages(cid, { before: oldest, limit: 30 });
      if (page.messages.length) {
        setMessages(prev => {
          const known = new Set(prev.map(m => m.id));
          return [...page.messages.filter(m => !known.has(m.id)), ...prev];
        });
      }
      setHasMoreOlder(page.hasMore);
    } catch { /* non-fatal */ }
    finally { setLoadingOlder(false); }
  }, [messages]);

  // ---- Realtime: new/updated messages, reactions, membership ----
  useEffect(() => {
    if (!myId) return;
    const channel = supabase.channel(`global-chat:${myId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const m = payload.new as ChatMessage;
          // Confirm delivery back to the sender (double tick) for any chat I'm in.
          if (m.sender_id !== myId) markDelivered().catch(() => { /* non-fatal */ });
          if (m.conversation_id === activeIdRef.current) {
            setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m]);
            if (m.sender_id !== myId) markRead(m.conversation_id);
          }
          refreshOverview();
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chat_messages' },
        (payload) => {
          const m = payload.new as ChatMessage;
          if (m.conversation_id === activeIdRef.current) {
            setMessages(prev => prev.map(x => x.id === m.id ? m : x));
          }
          refreshOverview();
        })
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'chat_message_reactions' },
        (payload) => {
          const cid = (payload.new as any)?.conversation_id ?? null;
          if (activeIdRef.current && (cid === null || cid === activeIdRef.current)) {
            reloadReactions(activeIdRef.current);
          }
        })
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_membership_log' },
        (payload) => {
          const row = payload.new as ChatEvent;
          if (row.conversation_id === activeIdRef.current) reloadEvents(activeIdRef.current);
        })
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_participants', filter: `user_id=eq.${myId}` },
        () => { reloadConversations().then(refreshOverview); })
      .on('postgres_changes',
        // My own row changed (auto-promoted to admin, removed → archived, re-added)
        // → refresh my view + unread/preview.
        { event: 'UPDATE', schema: 'public', table: 'chat_participants', filter: `user_id=eq.${myId}` },
        () => { reloadConversations().then(refreshOverview); })
      .on('postgres_changes',
        // Other members' read/delivery rows changed → patch locally so my ticks
        // (and the list preview tick) update live. RLS only delivers rows in my
        // own conversations. My own row is handled by the filtered handlers above.
        { event: '*', schema: 'public', table: 'chat_participants' },
        (payload) => {
          const row = (payload.new ?? null) as Participant | null;
          if (!row || !row.user_id || row.user_id === myId) return;
          setParticipants(prev => {
            const i = prev.findIndex(p =>
              p.conversation_id === row.conversation_id && p.user_id === row.user_id);
            if (i === -1) return [...prev, row];
            const next = prev.slice(); next[i] = row; return next;
          });
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [myId, refreshOverview, reloadConversations, markRead, reloadReactions, reloadEvents]);

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

  const handleSend = async (body: string, mentions: string[]) => {
    if (!activeId || !myId) return;
    const reply = replyTo;
    setReplyTo(null);
    try {
      const saved = await sendMessage({
        conversationId: activeId,
        senderId: myId,
        body,
        replyToId: reply?.id ?? null,
        mentions,
      });
      setMessages(prev => prev.some(x => x.id === saved.id) ? prev : [...prev, saved]);
      refreshOverview();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  // ---- Acknowledgement reactions ----
  const handleReact = async (messageId: string, emoji: string) => {
    if (!activeId || !myId) return;
    const mineNow = reactions.find(r => r.message_id === messageId && r.user_id === myId)?.emoji ?? null;
    try {
      if (mineNow === emoji) {
        setReactions(prev => prev.filter(r => !(r.message_id === messageId && r.user_id === myId)));
        await clearReaction(messageId, myId);
      } else {
        setReactions(prev => [
          ...prev.filter(r => !(r.message_id === messageId && r.user_id === myId)),
          { message_id: messageId, conversation_id: activeId, user_id: myId, emoji, created_at: new Date().toISOString() },
        ]);
        await setReaction(messageId, activeId, myId, emoji);
      }
      reloadReactions(activeId);
    } catch (e) {
      setErr((e as Error).message);
      reloadReactions(activeId);
    }
  };

  // ---- Delete message ----
  const doDeleteForMe = async () => {
    const msg = deleteMsg;
    if (!msg || !activeId || !myId) return;
    try {
      await hideForMe(msg.id, activeId, myId);
      setHiddenIds(prev => { const next = new Set(prev); next.add(msg.id); return next; });
    } catch (e) { setErr((e as Error).message); }
    finally { setDeleteMsg(null); }
  };
  const doDeleteForEveryone = async () => {
    const msg = deleteMsg;
    if (!msg) return;
    try {
      await deleteForEveryone(msg.id);
      setMessages(prev => prev.map(m => m.id === msg.id
        ? { ...m, deleted_at: new Date().toISOString(), body: '', mentions: null } : m));
      refreshOverview();
    } catch (e) { setErr((e as Error).message); }
    finally { setDeleteMsg(null); }
  };

  // ---- Group + announcement actions ----
  const handleCreateGroup = async (title: string, memberIds: string[]) => {
    try {
      const convId = await createGroup(title, memberIds);
      setGroupModal(null);
      await reloadConversations();
      await refreshOverview();
      selectConversation(convId);
    } catch (e) { setErr((e as Error).message); }
  };

  const groupOp = async (fn: () => Promise<void>) => {
    try { await fn(); await reloadConversations(); await refreshOverview(); }
    catch (e) { setErr((e as Error).message); }
  };

  const handleLeave = async () => {
    if (!activeId || !myId) return;
    try {
      await leaveConversation(activeId);
      setGroupModal(null);
      clearActive();
      await reloadConversations();
      await refreshOverview();
    } catch (e) { setErr((e as Error).message); }
  };

  const openAnnouncement = async () => {
    try {
      let convId: string | null = conversations.find(c => c.is_announcement)?.id ?? null;
      if (!convId && isBob) convId = await getOrCreateAnnouncement();
      if (!convId) { setErr('No announcement channel yet — ask the admin to start it.'); return; }
      if (myId) await ensureAnnouncementMembership(convId, myId);
      await reloadConversations();
      await refreshOverview();
      selectConversation(convId);
    } catch (e) { setErr((e as Error).message); }
  };

  // ---- Bookmarks ----
  const reloadBookmarks = useCallback(async () => {
    if (!activeIdRef.current) return;
    try { setBookmarks(await fetchBookmarks(activeIdRef.current)); } catch { /* non-fatal */ }
  }, []);
  const openBookmarks = async () => {
    if (!activeId) return;
    setShowBookmarks(true); setBookmarksLoading(true);
    try { setBookmarks(await fetchBookmarks(activeId)); }
    catch (e) { setErr((e as Error).message); }
    finally { setBookmarksLoading(false); }
  };
  const bookmarkOp = async (fn: () => Promise<void>) => {
    try { await fn(); await reloadBookmarks(); }
    catch (e) { setErr((e as Error).message); }
  };
  const toggleBookmarkAccess = async (open: boolean) => {
    if (!activeId) return;
    try { await setBookmarkAccess(activeId, open); await reloadConversations(); }
    catch (e) { setErr((e as Error).message); }
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

  const isAnnouncementActive = !!activeView?.conversation.is_announcement;
  const isGroupActive = !!activeView?.conversation.is_group && !isAnnouncementActive;
  const canPostActive = !activeView?.archived && (!isAnnouncementActive || isBob);
  // Insert "@Name " into the active composer (members dropdown / modals).
  const mentionContact = (c: ChatContact) => composerRef.current?.insertMention(contactName(c));

  return (
    <div className={`ac-chat-shell ${activeId ? 'has-active' : ''}`}>
      {err && <Alert variant="danger" className="m-2 mb-0" onClose={() => setErr(null)} dismissible>{err}</Alert>}
      <div className="ac-chat-grid">
        <ConversationList
          views={views}
          activeId={activeId}
          myId={myId}
          brandLeadByBrand={brandLeadByBrand}
          onSelect={selectConversation}
          onStartChat={() => setShowNewChat(true)}
          onOpenAnnouncement={openAnnouncement}
        />
        <ChatPanel
          view={activeView}
          messages={visibleMessages}
          events={events}
          loading={messagesLoading}
          hasMoreOlder={hasMoreOlder}
          loadingOlder={loadingOlder}
          onLoadOlder={loadOlder}
          myId={myId}
          directory={directory}
          unreadAnchorId={unreadAnchorId}
          participantsByUser={activeParticipantsByUser}
          // The announcement roster is role-based (all internal staff), not the
          // lazily-created participant rows — so @-mentions can target anyone.
          members={isAnnouncementActive ? allStaff : (activeView?.members ?? [])}
          announcementCount={allStaff.length}
          canPost={!activeView?.archived && (!(activeView?.conversation.is_announcement) || isBob)}
          reactionsByMsg={reactionsByMsg}
          resources={bookmarks}
          composerRef={composerRef}
          onReact={handleReact}
          onOpenContact={(userId) => {
            const c = directory.get(userId);
            if (c) setContactCard(c);
          }}
          onOpenGroup={() => setGroupModal({ mode: 'manage' })}
          onOpenSettings={() => setGroupModal({ mode: 'announcement' })}
          onOpenBookmarks={openBookmarks}
          replyTo={replyTo}
          onReply={setReplyTo}
          onForward={(m) => setForwardMsg(m)}
          onDelete={(m) => setDeleteMsg(m)}
          onSend={handleSend}
          onBack={clearActive}
        />
      </div>

      <NewChatModal
        show={showNewChat}
        contacts={contacts}
        loading={loading}
        onPick={startChatWith}
        onNewGroup={() => { setShowNewChat(false); setGroupModal({ mode: 'create' }); }}
        onClose={() => setShowNewChat(false)}
      />
      <ForwardModal
        show={!!forwardMsg}
        message={forwardMsg}
        contacts={contacts}
        onForward={handleForward}
        onClose={() => setForwardMsg(null)}
      />
      {groupModal && (
        <GroupModal
          show
          mode={groupModal.mode}
          contacts={contacts}
          allStaff={allStaff}
          conversation={groupModal.mode === 'create' ? null : (activeView?.conversation ?? null)}
          members={
            groupModal.mode === 'manage'
              ? participants
                  .filter(p => p.conversation_id === activeId && !p.left_at)
                  .map(p => ({ contact: directory.get(p.user_id), isAdmin: p.is_admin }))
                  .filter((m): m is GroupMember => !!m.contact)
              : []
          }
          creatorId={activeView?.conversation.created_by ?? null}
          myId={myId}
          canManage={activeView?.iAmAdmin ?? false}
          isCreator={activeView?.isCreator ?? false}
          onCreate={handleCreateGroup}
          onRename={(t) => groupOp(() => renameConversation(activeId!, t))}
          onAdd={(uid, showHistory) => groupOp(() => addMember(activeId!, uid, showHistory))}
          onRemove={(uid) => groupOp(() => removeMember(activeId!, uid))}
          onSetAdmin={(uid, a) => groupOp(() => setMemberAdmin(activeId!, uid, a))}
          onLeave={handleLeave}
          onMention={groupModal.mode !== 'create' && canPostActive
            ? (c) => { setGroupModal(null); mentionContact(c); }
            : undefined}
          onClose={() => setGroupModal(null)}
        />
      )}
      {showBookmarks && activeView && (
        <BookmarksModal
          show
          title={activeView.title}
          bookmarks={bookmarks}
          canEdit={activeView.canEditBookmarks}
          isGroup={isGroupActive}
          isGroupAdmin={isGroupActive && activeView.iAmAdmin}
          membersCanEdit={activeView.conversation.bookmarks_members_can_edit}
          brandGroup={!!activeView.conversation.brand_id}
          loading={bookmarksLoading}
          onAdd={(t, u) => bookmarkOp(() => addBookmark(activeId!, t, u, myId).then(() => undefined))}
          onUpdate={(id, t, u) => bookmarkOp(() => updateBookmark(id, t, u))}
          onDelete={(id) => bookmarkOp(() => deleteBookmark(id))}
          onToggleAccess={toggleBookmarkAccess}
          onClose={() => setShowBookmarks(false)}
        />
      )}
      <ContactModal
        contact={contactCard}
        isSelf={contactCard?.id === myId}
        onMessage={(c) => { setContactCard(null); startChatWith(c); }}
        onMention={(isGroupActive || isAnnouncementActive) && canPostActive
          ? (c) => { setContactCard(null); mentionContact(c); }
          : undefined}
        onClose={() => setContactCard(null)}
      />
      <DeleteMessageModal
        message={deleteMsg}
        canDeleteForEveryone={!!deleteMsg && deleteMsg.sender_id === myId && !deleteMsg.deleted_at}
        onForMe={doDeleteForMe}
        onForEveryone={doDeleteForEveryone}
        onClose={() => setDeleteMsg(null)}
      />
    </div>
  );
}
