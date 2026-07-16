// Global Chat — shared types + small presentation helpers.

export interface ChatContact {
  id: string;            // profile / auth user id
  full_name: string | null;
  email: string;
  role: string;
  avatar_url?: string | null;
  is_superbob?: boolean; // role 'bob' + flag → badge shows "Super Boss"
}

export interface Conversation {
  id: string;
  is_group: boolean;
  is_announcement: boolean;
  title: string | null;
  dm_key: string | null;
  created_by: string | null;
  created_at: string;
  last_message_at: string;
  bookmarks_members_can_edit: boolean;
  brand_id: string | null;   // set = auto-managed brand group (roster follows brand access)
}

export interface Participant {
  conversation_id: string;
  user_id: string;
  joined_at: string;
  last_read_at: string;
  last_delivered_at: string | null; // null = not yet delivered to this member
  is_admin: boolean;
  left_at: string | null;       // null = active member; set = archived (left/removed)
  history_from: string | null;  // null = full history; set = visible from this time on
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  body: string;
  reply_to_id: string | null;
  forwarded_from_id: string | null;
  is_forwarded: boolean;
  mentions: string[] | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
}

/** A membership activity-log row, rendered inline as a system line. */
export interface ChatEvent {
  id: string;
  conversation_id: string;
  actor_id: string | null;
  target_id: string | null;
  action: 'created' | 'added' | 'joined' | 'left' | 'removed' | 'promoted' | 'demoted';
  created_at: string;
}

/** One person's emoji acknowledgement on a message. */
export interface ChatReaction {
  message_id: string;
  conversation_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

/** A saved link in a conversation's Bookmarks tab. */
export interface ChatBookmark {
  id: string;
  conversation_id: string;
  title: string;
  url: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** A brand product taggable from the composer ("/" popup, brand groups).
    NB: `brand_products` has no price column (dropped in 20260514) — the
    catalog carries commissions instead. */
export interface ChatTagProduct {
  id: string;
  name: string;
  standard_commission: number | null;
}

/** A brand task taggable from the composer ("/" popup, brand groups). */
export interface ChatTagTask {
  id: string;
  title: string;
  status: string;
}

/** Per-conversation rollup from the chat_overview() RPC. */
export interface ConversationOverview {
  conversation_id: string;
  last_body: string | null;
  last_sender_id: string | null;
  last_at: string | null;
  unread: number;
}

/** View-model the conversation list renders. */
export interface ConversationView {
  conversation: Conversation;
  title: string;
  otherUser: ChatContact | null;   // null for groups
  members: ChatContact[];          // resolved members (groups/announcement)
  iAmAdmin: boolean;               // current user is creator or group admin
  isCreator: boolean;              // current user created this conversation
  archived: boolean;               // current user left / was removed (read-only)
  canEditBookmarks: boolean;       // current user may add/edit the Bookmarks tab
  lastBody: string | null;
  lastSenderId: string | null;
  lastAt: string | null;
  lastReceipt: Receipt | null;     // tick state of my last message (null if not mine)
  unread: number;
}

export type ChatFilter = 'all' | 'unread' | 'groups' | 'brands' | 'archived';

// Friendly role labels shown as a small badge next to a person's name.
export const ROLE_LABEL: Record<string, string> = {
  bob: 'Boss',
  team_lead: 'Team Lead',
  apc: 'APC',
  ads_manager: 'Ads Manager',
  paid_collab_handler: 'PCL',
};

// react-bootstrap Badge `bg` per role.
export const ROLE_BADGE: Record<string, string> = {
  bob: 'danger',
  team_lead: 'warning',
  apc: 'primary',
  ads_manager: 'info',
  paid_collab_handler: 'success',
};

export const roleLabel = (role: string | null | undefined, isSuperbob = false): string =>
  role === 'bob' && isSuperbob ? 'Super Boss' : (role && ROLE_LABEL[role]) || 'Staff';

export const roleBadge = (role: string | null | undefined): string =>
  (role && ROLE_BADGE[role]) || 'secondary';

export const contactName = (c: ChatContact | null | undefined): string =>
  c ? (c.full_name?.trim() || c.email) : 'Unknown';

// Fixed acknowledgement set for announcement messages. Each emoji carries a
// defined meaning shown in the info legend / tooltips.
// `unified` is the emoji-picker-react codepoint id, used to render the Apple-style glyph.
export const ACK_REACTIONS: { emoji: string; unified: string; label: string; meaning: string }[] = [
  { emoji: '✅', unified: '2705',     label: 'Acknowledged', meaning: 'Seen and understood' },
  { emoji: '👍', unified: '1f44d',    label: 'Will do',      meaning: 'Agree — I’ll take care of it' },
  { emoji: '👀', unified: '1f440',    label: 'Reviewing',    meaning: 'Looking into it now' },
  { emoji: '🙋', unified: '1f64b',    label: 'Question',     meaning: 'I have a question / need clarification' },
  { emoji: '❤️', unified: '2764-fe0f', label: 'Appreciated',  meaning: 'Thank you / appreciated' },
];
export const ackMeaning = (emoji: string): string =>
  ACK_REACTIONS.find(r => r.emoji === emoji)?.label ?? '';
/** emoji-picker-react `unified` codepoint for an ack emoji (for Apple-style rendering). */
export const ackUnified = (emoji: string): string | undefined =>
  ACK_REACTIONS.find(r => r.emoji === emoji)?.unified;

/** Human-readable system line for a membership-log event. */
export function eventText(
  ev: ChatEvent,
  nameOf: (id: string | null) => string,
): string {
  const actor = nameOf(ev.actor_id);
  const target = nameOf(ev.target_id);
  const selfAct = ev.actor_id && ev.actor_id === ev.target_id;
  switch (ev.action) {
    case 'created':  return `${actor} created the group`;
    case 'added':    return `${actor} added ${target}`;
    case 'joined':   return `${target} joined`;
    case 'left':     return `${target} left`;
    case 'removed':  return selfAct ? `${target} left` : `${actor} removed ${target}`;
    case 'promoted': return `${actor} made ${target} an admin`;
    case 'demoted':  return `${actor} removed ${target} as admin`;
    default:         return '';
  }
}

/** WhatsApp-style relative time for the conversation list. */
export function shortTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const diffDays = (now.getTime() - d.getTime()) / 86400000;
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Clock time for a single message bubble. */
export function messageTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Date + clock time for the message-info receipt rows. */
export function receiptTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${time}`;
}

// ---- Read receipts (WhatsApp-style ticks) -------------------------------
// 'sent'      → stored on the server, not yet confirmed delivered (single tick)
// 'delivered' → reached every recipient's device           (double grey tick)
// 'read'      → opened by every recipient                   (double blue tick)
export type Receipt = 'sent' | 'delivered' | 'read';

/** One recipient's delivery/read state for a single message. */
export interface MemberReceipt {
  contact: ChatContact;
  delivered: boolean;
  read: boolean;
  deliveredAt: string | null;
  readAt: string | null;
}

const atLeast = (ts: string | null | undefined, t: number): boolean =>
  !!ts && new Date(ts).getTime() >= t;

/** Per-recipient delivery/read breakdown for a message (info modal). */
export function messageReceipts(
  messageAt: string,
  recipients: ChatContact[],
  partOf: (userId: string) => Participant | undefined,
): MemberReceipt[] {
  const t = new Date(messageAt).getTime();
  return recipients.map(c => {
    const p = partOf(c.id);
    const read = atLeast(p?.last_read_at, t);
    // Reading implies the device received it, even if last_delivered_at lags.
    const delivered = read || atLeast(p?.last_delivered_at, t);
    return {
      contact: c,
      delivered,
      read,
      deliveredAt: p?.last_delivered_at ?? null,
      readAt: read ? (p?.last_read_at ?? null) : null,
    };
  });
}

/** Roll a per-recipient breakdown up to a single tick state. */
export function rollupReceipt(rs: MemberReceipt[]): Receipt {
  if (rs.length === 0) return 'sent';
  if (rs.every(r => r.read)) return 'read';
  if (rs.every(r => r.delivered)) return 'delivered';
  return 'sent';
}

/** Day separator label (Today / Yesterday / date) for the message stream. */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}
