// Chat media uploads → GOOGLE DRIVE (not Supabase Storage).
//
// The `chat-drive-upload` edge function (company Google account's OAuth
// refresh token) opens a resumable Drive upload session scoped to our chat
// uploads folder; the browser PUTs the bytes DIRECTLY to googleapis.com (so
// big videos never pass through Supabase), then the function makes the file
// link-viewable and returns the attachment payload stored on
// chat_messages.attachment.
import { supabase } from '../../lib/supabase';
import { fnError } from '../../lib/functionError';
import type { ChatAttachment } from './types';

export async function uploadChatFile(
  conversationId: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<ChatAttachment> {
  // 1. Open the Drive resumable session (membership checked server-side).
  const { data: created, error: createErr } = await supabase.functions.invoke('chat-drive-upload', {
    body: {
      action: 'create',
      conversation_id: conversationId,
      name: file.name,
      mime: file.type,
      size: file.size,
      origin: window.location.origin,
    },
  });
  if (createErr) throw await fnError(createErr);
  const uploadUrl: string = created?.upload_url;
  if (!uploadUrl) throw new Error('Drive upload could not be started.');

  // 2. PUT the bytes straight to Google, with upload progress.
  const fileId = await new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const res = JSON.parse(xhr.responseText);
          if (res?.id) { resolve(String(res.id)); return; }
        } catch { /* fall through */ }
        reject(new Error('Drive upload finished but returned no file id.'));
      } else {
        reject(new Error(`Drive upload failed (HTTP ${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error('Drive upload failed — check your connection.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    xhr.send(file);
  });

  // 3. Publish (anyone-with-link viewer) + get the stored attachment payload.
  const { data: fin, error: finErr } = await supabase.functions.invoke('chat-drive-upload', {
    body: { action: 'finalize', conversation_id: conversationId, file_id: fileId },
  });
  if (finErr) throw await fnError(finErr);
  const attachment: ChatAttachment | undefined = fin?.attachment;
  if (!attachment) throw new Error('Drive upload could not be finalized.');
  return attachment;
}

/** Short-lived signed streaming URLs for the given attachments (files are
 *  PRIVATE on Drive — the server checks the caller's login + membership of
 *  this conversation, then signs URLs for ~6h). Returns driveId → URL. */
export async function signAttachmentUrls(
  conversationId: string,
  driveIds: string[],
): Promise<Record<string, string>> {
  if (driveIds.length === 0) return {};
  const { data, error } = await supabase.functions.invoke('chat-drive-upload', {
    body: { action: 'sign', conversation_id: conversationId, drive_ids: driveIds },
  });
  if (error) throw await fnError(error);
  return (data?.urls ?? {}) as Record<string, string>;
}
