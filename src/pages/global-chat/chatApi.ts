// Global Chat — Supabase data layer. All writes go through RLS-protected
// tables / SECURITY DEFINER RPCs; the server assigns message timestamps.

import { supabase } from '../../lib/supabase';
import type {
  ChatContact, Conversation, Participant, ChatMessage, ConversationOverview,
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

/** Messages for one conversation, oldest → newest (capped). */
export async function fetchMessages(conversationId: string, limit = 200): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  // Fetched newest-first for the limit, then flipped to chronological order.
  return ((data as ChatMessage[]) ?? []).slice().reverse();
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
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as ChatMessage;
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
