import { useMemo, useState } from 'react';
import { Card, Form, Button, Alert, Spinner } from 'react-bootstrap';
import Avatar from '../Avatar';

export interface ProgramThreadComment {
  id: string;
  program_id: string;
  creator_id?: string | null;
  share_link_id?: string | null;
  author_type: 'client' | 'staff';
  author_name: string;
  body: string;
  parent_id: string | null;
  created_at: string;
}

interface Props {
  comments: ProgramThreadComment[];
  /** Public client view: user types name; Staff view: name is fixed. */
  mode: 'public' | 'staff';
  /** Staff: the signed-in user's display name. Public: optional default. */
  currentAuthorName?: string;
  defaultPublicName?: string;
  /** Whether the client/staff is allowed to post (e.g., locked when brand inactive). */
  canPost?: boolean;
  /** Async — must throw on failure so we can surface the error. */
  onAdd: (body: string, authorName: string, parentId?: string) => Promise<void>;
}

/**
 * Conversation thread on a paid collab program. Public clients use it on the
 * share link view; staff use it inside the program tracker.
 */
export default function ProgramThreadPanel({
  comments, mode, currentAuthorName, defaultPublicName,
  canPost = true, onAdd,
}: Props) {
  const [name, setName] = useState(currentAuthorName || defaultPublicName || '');
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<ProgramThreadComment | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Group: parents first, then nested replies.
  const tree = useMemo(() => {
    const parents = comments.filter(c => !c.parent_id);
    const repliesByParent = new Map<string, ProgramThreadComment[]>();
    for (const c of comments) {
      if (!c.parent_id) continue;
      const arr = repliesByParent.get(c.parent_id) ?? [];
      arr.push(c);
      repliesByParent.set(c.parent_id, arr);
    }
    return parents
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map(p => ({
        comment: p,
        replies: (repliesByParent.get(p.id) ?? [])
          .sort((a, b) => a.created_at.localeCompare(b.created_at)),
      }));
  }, [comments]);

  const submit = async () => {
    setErr(null);
    const finalName = mode === 'staff' ? (currentAuthorName || 'Staff') : name.trim();
    const finalBody = body.trim();
    if (!finalName) { setErr('Please enter your name first.'); return; }
    if (!finalBody) { setErr('Type a message before sending.'); return; }
    setBusy(true);
    try {
      await onAdd(finalBody, finalName, replyTo?.id);
      setBody('');
      setReplyTo(null);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to send');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="shadow-sm">
      <Card.Header className="d-flex justify-content-between align-items-center">
        <div>
          <span className="fw-semibold">
            <i className="bi bi-chat-left-text me-2" />
            Conversation
          </span>
          {comments.length > 0 && (
            <span className="text-muted small ms-2">
              {comments.length} message{comments.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      </Card.Header>
      <Card.Body>
        {tree.length === 0 ? (
          <div className="text-center text-muted py-3 small">
            <i className="bi bi-chat-square fs-1 d-block mb-2 opacity-50" />
            No messages yet — start the conversation below.
          </div>
        ) : (
          <div className="d-flex flex-column gap-3 mb-3">
            {tree.map(({ comment: c, replies }) => (
              <div key={c.id}>
                <ThreadRow c={c} canReply={canPost} onReply={() => setReplyTo(c)} />
                {replies.length > 0 && (
                  <div className="ms-4 mt-2 d-flex flex-column gap-2 ps-2"
                       style={{ borderLeft: '2px solid #e9ecef' }}>
                    {replies.map(r => (
                      <ThreadRow key={r.id} c={r} canReply={false} onReply={() => {}} compact />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {canPost ? (
          <div className="border-top pt-3">
            {err && <Alert variant="danger" className="py-2 small">{err}</Alert>}
            {replyTo && (
              <div className="d-flex align-items-center gap-2 mb-2 small">
                <i className="bi bi-reply text-muted" />
                <span className="text-muted">Replying to <strong>{replyTo.author_name}</strong></span>
                <button type="button" className="btn btn-link btn-sm p-0 ms-auto"
                        onClick={() => setReplyTo(null)}>
                  Cancel
                </button>
              </div>
            )}
            {mode === 'public' && (
              <Form.Group className="mb-2">
                <Form.Control size="sm" placeholder="Your name"
                  value={name} onChange={e => setName(e.target.value)} disabled={busy} />
              </Form.Group>
            )}
            <Form.Control as="textarea" rows={3}
              placeholder={replyTo ? `Reply to ${replyTo.author_name}…` : 'Type your message…'}
              value={body} onChange={e => setBody(e.target.value)} disabled={busy} />
            <div className="d-flex justify-content-end mt-2">
              <Button size="sm" onClick={submit} disabled={busy || !body.trim() || (mode === 'public' && !name.trim())}>
                {busy ? <Spinner size="sm" animation="border" /> : (
                  <>
                    <i className="bi bi-send me-1" />
                    {replyTo ? 'Send reply' : 'Send message'}
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <div className="border-top pt-3 text-muted small text-center">
            <i className="bi bi-lock me-1" />
            Comments are currently locked for this program.
          </div>
        )}
      </Card.Body>
    </Card>
  );
}

function ThreadRow({ c, canReply, onReply, compact }: {
  c: ProgramThreadComment;
  canReply: boolean;
  onReply: () => void;
  compact?: boolean;
}) {
  const isClient = c.author_type === 'client';
  return (
    <div className="d-flex gap-2 align-items-start">
      <Avatar name={c.author_name} size={compact ? 'sm' : 'md'} />
      <div className="flex-grow-1 min-w-0">
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <strong>{c.author_name}</strong>
          <span className={`badge ${isClient ? 'bg-info' : 'bg-secondary'}`} style={{ fontSize: '.65rem' }}>
            {isClient ? 'Client' : 'Staff'}
          </span>
          <span className="text-muted small">
            {new Date(c.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </span>
        </div>
        <div className="small mt-1" style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
        {canReply && (
          <button type="button" className="btn btn-link btn-sm p-0 mt-1" onClick={onReply}>
            <i className="bi bi-reply me-1" />Reply
          </button>
        )}
      </div>
    </div>
  );
}
