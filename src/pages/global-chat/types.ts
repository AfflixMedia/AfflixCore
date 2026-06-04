// Global Chat — shared types + small presentation helpers.

export interface ChatContact {
  id: string;            // profile / auth user id
  full_name: string | null;
  email: string;
  role: string;
}

export interface Conversation {
  id: string;
  is_group: boolean;
  title: string | null;
  dm_key: string | null;
  created_by: string | null;
  created_at: string;
  last_message_at: string;
}

export interface Participant {
  conversation_id: string;
  user_id: string;
  joined_at: string;
  last_read_at: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  body: string;
  reply_to_id: string | null;
  forwarded_from_id: string | null;
  is_forwarded: boolean;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
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
  lastBody: string | null;
  lastSenderId: string | null;
  lastAt: string | null;
  unread: number;
}

export type ChatFilter = 'all' | 'unread' | 'groups';

// Friendly role labels shown as a small badge next to a person's name.
export const ROLE_LABEL: Record<string, string> = {
  bob: 'Boss',
  apc: 'APC',
  paid_collab_handler: 'Team Lead',
};

// react-bootstrap Badge `bg` per role.
export const ROLE_BADGE: Record<string, string> = {
  bob: 'danger',
  apc: 'primary',
  paid_collab_handler: 'success',
};

export const roleLabel = (role: string | null | undefined): string =>
  (role && ROLE_LABEL[role]) || 'Staff';

export const roleBadge = (role: string | null | undefined): string =>
  (role && ROLE_BADGE[role]) || 'secondary';

export const contactName = (c: ChatContact | null | undefined): string =>
  c ? (c.full_name?.trim() || c.email) : 'Unknown';

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
