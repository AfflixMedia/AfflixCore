// Global Chat — Supabase data layer. All writes go through RLS-protected
// tables / SECURITY DEFINER RPCs; the server assigns message timestamps.

import { supabase } from '../../lib/supabase';
import type {
  ChatContact, Conversation, Participant, ChatMessage, ConversationOverview,
  ChatEvent, ChatReaction, ChatBookmark, ChatAttachment,
} from './types';

/** Internal-staff directory (excludes the caller). */
export async function listContacts(): Promise<ChatContact[]> {
  const { data, error } = await supabase.rpc('chat_list_contacts');
  if (error) throw error;
  return (data as ChatContact[]) ?? [];
}

/** Every conversation the caller is a member of (RLS-scoped). */
export async function listConversations(): Promise<Conversation[]> {
  const { data, error } = await supabase
    .from('chat_conversations')
    .select('*')
    .order('last_message_at', { ascending: false });
  if (error) throw error;
  return (data as Conversation[]) ?? [];
}

/** Participants across the caller's conversations (RLS-scoped). */
export async function listParticipants(): Promise<Participant[]> {
  const { data, error } = await supabase.from('chat_participants').select('*');
  if (error) throw error;
  return (data as Participant[]) ?? [];
}

/** Last message + unread count per conversation, in a single round trip. */
export async function fetchOverview(): Promise<ConversationOverview[]> {
  const { data, error } = await supabase.rpc('chat_overview');
  if (error) throw error;
  return ((data as any[]) ?? []).map(r => ({
    conversation_id: r.conversation_id,
    last_body: r.last_body ?? null,
    last_sender_id: r.last_sender_id ?? null,
    last_at: r.last_at ?? null,
    unread: Number(r.unread ?? 0),
  }));
}

/** A window of messages, oldest → newest, plus whether older ones remain.
 *  `before` pages backwards: pass the oldest loaded message's created_at. */
export async function fetchMessages(
  conversationId: string,
  opts: { before?: string; limit?: number } = {},
): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
  const limit = opts.limit ?? 30;
  let query = supabase
    .from('chat_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (opts.before) query = query.lt('created_at', opts.before);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data as ChatMessage[]) ?? [];
  // Fetched newest-first for the page, then flipped to chronological order.
  return { messages: rows.slice().reverse(), hasMore: rows.length === limit };
}

/** Find or create the 1:1 DM with another internal user; returns its id. */
export async function getOrCreateDm(otherUserId: string): Promise<string> {
  const { data, error } = await supabase.rpc('chat_get_or_create_dm', { other_user: otherUserId });
  if (error) throw error;
  return data as string;
}

/** Send a message. The DB assigns created_at; the inserted row is returned. */
export async function sendMessage(params: {
  conversationId: string;
  senderId: string;
  body: string;
  replyToId?: string | null;
  forwardedFromId?: string | null;
  isForwarded?: boolean;
  mentions?: string[] | null;
  attachment?: ChatAttachment | null;   // Drive-hosted image/video
}): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      conversation_id: params.conversationId,
      sender_id: params.senderId,
      body: params.body,
      reply_to_id: params.replyToId ?? null,
      forwarded_from_id: params.forwardedFromId ?? null,
      is_forwarded: params.isForwarded ?? false,
      mentions: params.mentions && params.mentions.length ? params.mentions : null,
      attachment: params.attachment ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as ChatMessage;
}

// ---- Groups ----
export async function createGroup(title: string, memberIds: string[]): Promise<string> {
  const { data, error } = await supabase.rpc('chat_create_group', { p_title: title, p_members: memberIds });
  if (error) throw error;
  return data as string;
}
export async function addMember(
  conversationId: string, userId: string, showHistory = true,
): Promise<void> {
  const { error } = await supabase.rpc('chat_add_member', {
    p_conv: conversationId, p_user: userId, p_show_history: showHistory,
  });
  if (error) throw error;
}
export async function removeMember(conversationId: string, userId: string): Promise<void> {
  const { error } = await supabase.rpc('chat_remove_member', { p_conv: conversationId, p_user: userId });
  if (error) throw error;
}
export async function setMemberAdmin(conversationId: string, userId: string, isAdmin: boolean): Promise<void> {
  const { error } = await supabase.rpc('chat_set_admin', { p_conv: conversationId, p_user: userId, p_is_admin: isAdmin });
  if (error) throw error;
}
export async function renameConversation(conversationId: string, title: string): Promise<void> {
  const { error } = await supabase.rpc('chat_rename', { p_conv: conversationId, p_title: title });
  if (error) throw error;
}

// ---- Announcement channel ----
export async function getOrCreateAnnouncement(): Promise<string> {
  const { data, error } = await supabase.rpc('chat_get_or_create_announcement');
  if (error) throw error;
  return data as string;
}
/** Lazily record the current user's membership of the announcement (read state). */
export async function ensureAnnouncementMembership(conversationId: string, userId: string): Promise<void> {
  await supabase.from('chat_participants').upsert(
    { conversation_id: conversationId, user_id: userId },
    { onConflict: 'conversation_id,user_id', ignoreDuplicates: true },
  );
}

/** Mark every conversation the caller can see as delivered-to-me (now).
 *  Drives the sender's double-tick; call on load + on each incoming message. */
export async function markDelivered(): Promise<void> {
  const { error } = await supabase.rpc('chat_mark_delivered');
  if (error) throw error;
}

/** Mark a conversation read up to now for the current user. */
export async function markConversationRead(conversationId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('chat_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);
  if (error) throw error;
}

// ---- Membership activity log (system lines) ----
export async function fetchEvents(conversationId: string): Promise<ChatEvent[]> {
  const { data, error } = await supabase
    .from('chat_membership_log')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as ChatEvent[]) ?? [];
}

/** Leave a group: soft-leave (keeps a read-only archived view; logged as "left"). */
export async function leaveConversation(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc('chat_leave_group', { p_conv: conversationId });
  if (error) throw error;
}

// ---- Delete message ----
/** Delete for everyone — tombstones the sender's own message. */
export async function deleteForEveryone(messageId: string): Promise<void> {
  const { error } = await supabase.rpc('chat_delete_message', { p_msg: messageId });
  if (error) throw error;
}
/** Delete for me — hide a message from my own view only. */
export async function hideForMe(messageId: string, conversationId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('chat_message_hidden')
    .upsert({ message_id: messageId, conversation_id: conversationId, user_id: userId },
            { onConflict: 'message_id,user_id', ignoreDuplicates: true });
  if (error) throw error;
}
/** Message ids the current user has hidden in one conversation. */
export async function fetchHidden(conversationId: string, userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('chat_message_hidden')
    .select('message_id')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);
  if (error) throw error;
  return ((data as { message_id: string }[]) ?? []).map(r => r.message_id);
}

// ---- Acknowledgement reactions ----
export async function fetchReactions(conversationId: string): Promise<ChatReaction[]> {
  const { data, error } = await supabase
    .from('chat_message_reactions')
    .select('*')
    .eq('conversation_id', conversationId);
  if (error) throw error;
  return (data as ChatReaction[]) ?? [];
}
/** Set my reaction on a message (one per message; upsert replaces). */
export async function setReaction(
  messageId: string, conversationId: string, userId: string, emoji: string,
): Promise<void> {
  const { error } = await supabase
    .from('chat_message_reactions')
    .upsert({ message_id: messageId, conversation_id: conversationId, user_id: userId, emoji },
            { onConflict: 'message_id,user_id' });
  if (error) throw error;
}
/** Remove my reaction from a message. */
export async function clearReaction(messageId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('chat_message_reactions')
    .delete()
    .eq('message_id', messageId)
    .eq('user_id', userId);
  if (error) throw error;
}

// ---- Bookmarks ----
export async function fetchBookmarks(conversationId: string): Promise<ChatBookmark[]> {
  const { data, error } = await supabase
    .from('chat_bookmarks')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as ChatBookmark[]) ?? [];
}
export async function addBookmark(
  conversationId: string, title: string, url: string, userId: string,
): Promise<ChatBookmark> {
  const { data, error } = await supabase
    .from('chat_bookmarks')
    .insert({ conversation_id: conversationId, title, url, created_by: userId })
    .select('*')
    .single();
  if (error) throw error;
  return data as ChatBookmark;
}
export async function updateBookmark(id: string, title: string, url: string): Promise<void> {
  const { error } = await supabase
    .from('chat_bookmarks')
    .update({ title, url, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}
export async function deleteBookmark(id: string): Promise<void> {
  const { error } = await supabase.from('chat_bookmarks').delete().eq('id', id);
  if (error) throw error;
}
/** Admin toggle: let regular group members manage bookmarks too. */
export async function setBookmarkAccess(conversationId: string, open: boolean): Promise<void> {
  const { error } = await supabase
    .from('chat_conversations')
    .update({ bookmarks_members_can_edit: open })
    .eq('id', conversationId);
  if (error) throw error;
}
