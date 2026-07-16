// Right pane: conversation header (with Bookmarks + group/announcement settings),
// a scrollable message stream (day separators, "unread" divider, inline system
// lines for membership changes), a floating scroll-to-bottom button, and the
// composer. Data + realtime live in the GlobalChat page.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Badge, Spinner } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import Avatar from '../../components/Avatar';
import MessageBubble from './MessageBubble';
import MessageComposer, { MessageComposerHandle } from './MessageComposer';
import MessageInfoModal from './MessageInfoModal';
import BrandChatBar from './BrandChatBar';
import type { ChatAttachment, ChatBookmark, ChatContact, ChatMessage, ChatEvent, ChatReaction, ChatTagProduct, ChatTagTask, ConversationView, Participant } from './types';
import { dayLabel, roleLabel, roleBadge, contactName, eventText, messageReceipts, rollupReceipt } from './types';

interface Props {
  view: ConversationView | null;
  messages: ChatMessage[];
  events: ChatEvent[];             // membership log → inline system lines
  loading: boolean;
  hasMoreOlder: boolean;           // older messages remain to page in
  loadingOlder: boolean;          // an older page is currently loading
  onLoadOlder: () => void;        // fetch + prepend the next older page
  myId: string;
  directory: Map<string, ChatContact>;
  unreadAnchorId: string | null;   // first unread message id at open time
  participantsByUser: Map<string, Participant>;  // active conv: userId → read/delivery state
  attachmentUrls: Map<string, string>;  // driveId → signed streaming URL (private media)
  members: ChatContact[];          // group/announcement members (for @mentions)
  announcementCount: number;       // total internal staff (announcement header)
  canPost: boolean;                // false → announcement read-only for non-admins
  reactionsByMsg: Map<string, ChatReaction[]>;
  resources: ChatBookmark[];       // conversation bookmarks → "/" resource tags
  composerRef: React.RefObject<MessageComposerHandle>;  // insertMention from header/modals
  onReact: (messageId: string, emoji: string) => void;
  onOpenContact: (userId: string) => void;  // clicked a @mention → contact card
  onOpenGroup: () => void;         // open the group manage modal
  onOpenSettings: () => void;      // open announcement settings (Bob)
  onOpenBookmarks: () => void;     // open the Bookmarks tab
  replyTo: ChatMessage | null;
  onReply: (m: ChatMessage | null) => void;
  onForward: (m: ChatMessage) => void;
  onDelete: (m: ChatMessage) => void;
  onSend: (body: string, mentions: string[], attachment?: ChatAttachment | null) => void | Promise<void>;
  /** Upload a picked image/video to Google Drive (from GlobalChat). */
  uploadFile?: (file: File, onProgress: (pct: number) => void) => Promise<ChatAttachment>;
  /** Best-effort delete of an unsent draft upload (from GlobalChat). */
  discardFile?: (a: ChatAttachment) => void;
  onBack: () => void;        // mobile: back to list
}

type Item =
  | { kind: 'msg'; at: string; m: ChatMessage }
  | { kind: 'evt'; at: string; e: ChatEvent };

export default function ChatPanel({
  view, messages, events, loading, hasMoreOlder, loadingOlder, onLoadOlder,
  myId, directory, unreadAnchorId, participantsByUser, attachmentUrls, members, announcementCount,
  canPost, reactionsByMsg, resources, composerRef, onReact, onOpenContact, onOpenGroup,
  onOpenSettings, onOpenBookmarks,
  replyTo, onReply, onForward, onDelete, onSend, uploadFile, discardFile, onBack,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [infoMsg, setInfoMsg] = useState<ChatMessage | null>(null);
  // Header members dropdown (groups/announcement): roster + per-member @ button.
  const [showMembers, setShowMembers] = useState(false);
  const membersWrapRef = useRef<HTMLDivElement>(null);
  // Brand groups: the brand's products + open tasks feed the composer's "@" /
  // "/" tag popups. Fetched HERE off the same view.conversation.brand_id that
  // renders BrandChatBar's (working) Products popup, so the ids can't diverge.
  const brandId = view?.conversation.brand_id ?? null;
  const [products, setProducts] = useState<ChatTagProduct[]>([]);
  const [tasks, setTasks] = useState<ChatTagTask[]>([]);
  useEffect(() => {
    if (!brandId) { setProducts([]); setTasks([]); return; }
    let on = true;
    (async () => {
      const { data: prod, error: pErr } = await supabase
        .from('brand_products').select('id,name,standard_commission')
        .eq('brand_id', brandId).order('name');
      if (pErr) console.warn('[chat] brand products fetch failed:', pErr.message);
      if (on) setProducts((prod ?? []) as ChatTagProduct[]);
      const { data: tk, error: tErr } = await supabase
        .from('tasks').select('id,title,status')
        .eq('brand_id', brandId).neq('status', 'done')
        .order('created_at', { ascending: false }).limit(30);
      if (tErr) console.warn('[chat] brand tasks fetch failed:', tErr.message);
      if (on) setTasks((tk ?? []) as ChatTagTask[]);
    })();
    return () => { on = false; };
  }, [brandId]);
  const positionedConvRef = useRef<string | null>(null);
  const prevCountRef = useRef(0);
  // Pre-prepend scrollHeight, captured when an older page is requested so the
  // viewport can be held steady once the new rows render.
  const prependRestoreRef = useRef<number | null>(null);

  const convId = view?.conversation.id ?? null;

  // Drag & drop a file anywhere on the panel → attach it in the composer.
  // Depth counter survives child enter/leave churn; overlay is pointer-inert
  // so drop always lands on the panel itself.
  const [dragOver, setDragOver] = useState(false);
  const dragDepth = useRef(0);
  const dragHasFiles = (e: React.DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const canDrop = !!view && canPost && !!uploadFile;
  const onDragEnter = (e: React.DragEvent) => {
    if (!canDrop || !dragHasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!canDrop || !dragHasFiles(e)) return;
    e.preventDefault();
  };
  const onDragLeave = () => {
    if (!canDrop) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };
  const onDrop = (e: React.DragEvent) => {
    dragDepth.current = 0;
    setDragOver(false);
    if (!canDrop || !dragHasFiles(e)) return;
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) composerRef.current?.attachFile(file);
  };
  useEffect(() => { dragDepth.current = 0; setDragOver(false); }, [convId]);

  // Members dropdown: close on outside click + when switching conversations.
  useEffect(() => { setShowMembers(false); }, [convId]);
  useEffect(() => {
    if (!showMembers) return;
    const onDoc = (e: MouseEvent) => {
      if (membersWrapRef.current && !membersWrapRef.current.contains(e.target as Node)) setShowMembers(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [showMembers]);

  // Map id -> message for resolving reply quotes.
  const msgById = useMemo(() => {
    const m = new Map<string, ChatMessage>();
    messages.forEach(x => m.set(x.id, x));
    return m;
  }, [messages]);

  // Merge messages + membership events into one chronological timeline.
  const items: Item[] = useMemo(() => {
    const arr: Item[] = [];
    messages.forEach(m => arr.push({ kind: 'msg', at: m.created_at, m }));
    events.forEach(e => arr.push({ kind: 'evt', at: e.created_at, e }));
    arr.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return arr;
  }, [messages, events]);

  const nameOf = (id: string | null) => contactName(id ? directory.get(id) ?? null : null);

  // Recipients of my messages = everyone in the conversation except me. Their
  // read/delivery rows drive the ticks; for the announcement `members` is the
  // role-based staff list, so staff who never opened simply count as pending.
  const recipients = useMemo(
    () => members.filter(c => c.id !== myId), [members, myId]);
  const receiptsFor = (m: ChatMessage) =>
    messageReceipts(m.created_at, recipients, id => participantsByUser.get(id));

  const isNearBottom = () => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const scrollToBottom = (smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  // Initial position when a conversation first loads: jump to the "unread
  // messages" divider if any, else to the bottom. A ResizeObserver re-applies it
  // as the flex container settles, so it can't get stuck at the top.
  useLayoutEffect(() => {
    if (!convId || loading) return;
    const el = scrollRef.current;
    if (!el) return;
    positionedConvRef.current = convId;
    prevCountRef.current = items.length;

    let settled = false;
    const place = () => {
      const sep = el.querySelector('[data-unread-sep]') as HTMLElement | null;
      if (sep) el.scrollTop = Math.max(0, sep.offsetTop - 12);
      else el.scrollTop = el.scrollHeight;
    };

    place();
    const raf = requestAnimationFrame(place);
    const t1 = setTimeout(() => { place(); setShowScrollBtn(!isNearBottom()); }, 80);
    const t2 = setTimeout(() => { place(); setShowScrollBtn(!isNearBottom()); settled = true; }, 280);
    const ro = new ResizeObserver(() => { if (!settled) place(); });
    ro.observe(el);

    return () => { cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2); ro.disconnect(); };
  }, [convId, loading, unreadAnchorId]);

  // When an older page finishes loading, hold the viewport on the same message
  // (offset by however much taller the stream got). Keyed on loadingOlder so it
  // also clears cleanly when a page returned nothing. Runs before the follow
  // effect below and neutralises it so prepends don't yank to the bottom.
  useLayoutEffect(() => {
    if (loadingOlder || prependRestoreRef.current == null) return;
    const el = scrollRef.current;
    if (el) {
      const delta = el.scrollHeight - prependRestoreRef.current;
      if (delta > 0) el.scrollTop = el.scrollTop + delta;
    }
    prependRestoreRef.current = null;
    prevCountRef.current = items.length;
  }, [loadingOlder]);

  // New content after the initial load. Follow your own sent message to the
  // bottom; for incoming content, follow only if already near the bottom.
  useEffect(() => {
    if (!convId || positionedConvRef.current !== convId) return;
    const grew = items.length > prevCountRef.current;
    prevCountRef.current = items.length;
    if (!grew) return;
    const last = items[items.length - 1];
    const mine = last?.kind === 'msg' && last.m.sender_id === myId;
    if (mine || isNearBottom()) scrollToBottom(true);
    else setShowScrollBtn(true);
  }, [items.length, convId, myId]);

  // Scroll handler: toggle the jump-to-latest button and page in older history
  // when the user reaches the top.
  const handleStreamScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setShowScrollBtn(!isNearBottom());
    if (hasMoreOlder && !loadingOlder && prependRestoreRef.current == null && el.scrollTop < 80) {
      prependRestoreRef.current = el.scrollHeight;
      onLoadOlder();
    }
  };

  if (!view) {
    return (
      <div className="ac-chat-panel ac-chat-empty">
        <div className="text-center text-muted">
          <i className="bi bi-chat-dots" style={{ fontSize: '3rem', opacity: .4 }} />
          <p className="mt-3 mb-0">Select a chat to start messaging</p>
        </div>
      </div>
    );
  }

  const isAnnouncement = view.conversation.is_announcement;
  const isGroup = view.conversation.is_group && !isAnnouncement;
  const mentionables = members.filter(c => c.id !== myId);
  const memberCount = isAnnouncement ? announcementCount : members.length;

  return (
    <div
      className="ac-chat-panel"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="ac-chat-drop">
          <div className="ac-chat-drop-inner">
            <i className="bi bi-cloud-arrow-up" />
            <div className="ac-chat-drop-title">Drop to share</div>
            <div className="ac-chat-drop-sub">Photos, videos & documents · sent to “{view.title}”</div>
          </div>
        </div>
      )}
      <div className="ac-chat-header">
        <button type="button" className="ac-chat-back" onClick={onBack} title="Back">
          <i className="bi bi-arrow-left" />
        </button>
        <span className="ac-chat-avatar">
          <Avatar
            name={view.title}
            src={isGroup || isAnnouncement ? undefined : view.otherUser?.avatar_url}
            variant={isGroup || isAnnouncement ? 'dark' : 'brand'}
          />
        </span>
        <div className="min-w-0 flex-grow-1">
          <div className="d-flex align-items-center gap-2">
            {isAnnouncement && <i className="bi bi-megaphone-fill text-warning" />}
            <span className="ac-chat-title fw-semibold text-truncate">{view.title}</span>
            {!isGroup && !isAnnouncement && view.otherUser && (
              <Badge bg={roleBadge(view.otherUser.role)} className="ac-role-badge">
                {roleLabel(view.otherUser.role, view.otherUser.is_superbob)}
              </Badge>
            )}
          </div>
          {!isGroup && !isAnnouncement && view.otherUser && (
            <div className="text-muted small text-truncate">{view.otherUser.email}</div>
          )}
          {(isGroup || isAnnouncement) && (
            <div className="ac-chat-members-wrap" ref={membersWrapRef}>
              <button type="button" className="ac-chat-members-btn"
                aria-expanded={showMembers} title="Show members"
                onClick={() => setShowMembers(s => !s)}>
                <i className="bi bi-people-fill" />
                {memberCount} member{memberCount === 1 ? '' : 's'}
                {isAnnouncement && ' · announcement'}
                <i className={`bi bi-chevron-${showMembers ? 'up' : 'down'}`} />
              </button>
              {showMembers && (
                <div className="ac-members-pop">
                  <div className="ac-members-pop-head">
                    <i className="bi bi-people-fill me-1" />Members
                    <span className="ac-members-pop-n">{memberCount}</span>
                  </div>
                  <div className="ac-members-pop-list">
                    {[...members]
                      .sort((a, b) => (a.id === myId ? -1 : b.id === myId ? 1 : contactName(a).localeCompare(contactName(b))))
                      .map(c => {
                        const self = c.id === myId;
                        return (
                          <div key={c.id} className="ac-member-row">
                            <button type="button" className="ac-member-row-main"
                              title={self ? undefined : 'View contact'}
                              onClick={() => { if (!self) { setShowMembers(false); onOpenContact(c.id); } }}>
                              <Avatar name={contactName(c)} src={c.avatar_url} size="sm" />
                              <span className="ac-member-row-name text-truncate">
                                {self ? 'You' : contactName(c)}
                              </span>
                              <Badge bg={roleBadge(c.role)} className="ac-role-badge">
                                {roleLabel(c.role, c.is_superbob)}
                              </Badge>
                            </button>
                            {!self && canPost && (
                              <button type="button" className="ac-member-mention"
                                title={`Mention ${contactName(c)} in the chat`}
                                aria-label={`Mention ${contactName(c)}`}
                                onClick={() => {
                                  composerRef.current?.insertMention(contactName(c));
                                  setShowMembers(false);
                                }}>
                                <i className="bi bi-at" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        {view.conversation.brand_id && (
          <BrandChatBar brandId={view.conversation.brand_id} brandName={view.title}
            onTagProduct={canPost ? (name) => composerRef.current?.insertProductTag(name) : undefined} />
        )}
        <button type="button" className="ac-chat-action" title="Bookmarks" onClick={onOpenBookmarks}>
          <i className="bi bi-bookmark-star" />
        </button>
        {isGroup && (
          <button type="button" className="ac-chat-action" title="Group info" onClick={onOpenGroup}>
            <i className="bi bi-gear" />
          </button>
        )}
        {isAnnouncement && canPost && (
          <button type="button" className="ac-chat-action" title="Announcement settings" onClick={onOpenSettings}>
            <i className="bi bi-gear" />
          </button>
        )}
      </div>

      <div className="ac-stream-wrap">
        <div className="ac-chat-stream" ref={scrollRef} onScroll={handleStreamScroll}>
          {loading ? (
            <div className="text-center py-5"><Spinner animation="border" size="sm" /></div>
          ) : items.length === 0 ? (
            <div className="text-center text-muted py-5">No messages yet. Say hello 👋</div>
          ) : (
            <>
            {loadingOlder && <div className="text-center py-2"><Spinner animation="border" size="sm" /></div>}
            {items.map((it, i) => {
              const prev = items[i - 1];
              const showDay = !prev || new Date(prev.at).toDateString() !== new Date(it.at).toDateString();
              if (it.kind === 'evt') {
                return (
                  <div key={`e-${it.e.id}`}>
                    {showDay && <div className="ac-day-sep"><span>{dayLabel(it.at)}</span></div>}
                    <div className="ac-sys-line"><span>{eventText(it.e, nameOf)}</span></div>
                  </div>
                );
              }
              const m = it.m;
              const replyTarget = m.reply_to_id ? (msgById.get(m.reply_to_id) ?? null) : null;
              const rxns = reactionsByMsg.get(m.id) ?? [];
              const mine = rxns.find(r => r.user_id === myId)?.emoji ?? null;
              const isMine = m.sender_id === myId;
              const receipt = isMine && !m.deleted_at ? rollupReceipt(receiptsFor(m)) : null;
              return (
                <div key={m.id} data-mid={m.id}>
                  {showDay && <div className="ac-day-sep"><span>{dayLabel(it.at)}</span></div>}
                  {m.id === unreadAnchorId && (
                    <div className="ac-unread-sep" data-unread-sep><span>Unread messages</span></div>
                  )}
                  <MessageBubble
                    message={m}
                    mine={m.sender_id === myId}
                    isGroup={isGroup || isAnnouncement}
                    sender={m.sender_id ? directory.get(m.sender_id) ?? null : null}
                    mentions={(m.mentions ?? []).map(id => ({ id, name: contactName(directory.get(id) ?? null) }))}
                    replyTo={replyTarget}
                    replyToSender={replyTarget?.sender_id ? directory.get(replyTarget.sender_id) ?? null : null}
                    canReply={canPost}
                    ackMode={isAnnouncement}
                    reactions={rxns}
                    myReaction={mine}
                    reactorName={nameOf}
                    receipt={receipt}
                    attachmentSrc={m.attachment ? attachmentUrls.get(m.attachment.drive_id) ?? null : null}
                    onReact={(emoji) => onReact(m.id, emoji)}
                    onReply={onReply}
                    onForward={onForward}
                    onDelete={onDelete}
                    onInfo={setInfoMsg}
                    onMentionClick={onOpenContact}
                  />
                </div>
              );
            })}
            </>
          )}
        </div>

        {showScrollBtn && (
          <button
            type="button"
            className="ac-scroll-bottom-btn"
            title="Scroll to latest"
            onClick={() => scrollToBottom(true)}
          >
            <i className="bi bi-chevron-down" />
          </button>
        )}
      </div>

      <MessageComposer
        key={view.conversation.id}
        ref={composerRef}
        readOnly={!canPost}
        readOnlyNote={
          view.archived ? 'You’re no longer a member of this group — read only.'
            : isAnnouncement ? 'Only the admin can post announcements.'
            : undefined}
        readOnlyIcon={view.archived ? 'bi-archive' : 'bi-megaphone'}
        mentionables={mentionables}
        resources={resources}
        products={products}
        tasks={tasks}
        brandId={view.conversation.brand_id}
        replyTo={replyTo}
        replyToSender={replyTo?.sender_id ? directory.get(replyTo.sender_id) ?? null : null}
        onCancelReply={() => onReply(null)}
        onSend={onSend}
        uploadFile={uploadFile}
        discardFile={discardFile}
      />

      <MessageInfoModal
        message={infoMsg}
        receipts={infoMsg ? receiptsFor(infoMsg) : []}
        isGroup={isGroup || isAnnouncement}
        onClose={() => setInfoMsg(null)}
      />
    </div>
  );
}
