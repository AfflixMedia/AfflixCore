import { useState, FormEvent } from 'react';
import { Card, Form, Button, Alert, Badge } from 'react-bootstrap';

export type CommentSection = 'overall' | 'top_creators' | 'top_videos' | 'gmv_max' | 'product_highlights' | 'insights';

export interface Comment {
  id: string;
  report_id: string;
  section: CommentSection;
  author_type: 'client' | 'apc' | 'bob';
  author_name: string;
  body: string;
  created_at: string;
}

export interface SectionCommentsProps {
  section: CommentSection;
  comments: Comment[];
  mode: 'authed' | 'public';
  currentAuthorName?: string;            // authed mode
  defaultPublicName?: string;             // public mode (persisted in localStorage)
  onAdd: (body: string, authorName: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

const SECTION_LABELS: Record<CommentSection, string> = {
  overall: 'Overall Performance',
  top_creators: 'Top Creators',
  top_videos: 'Top Videos',
  gmv_max: 'GMV Max Campaigns',
  product_highlights: 'Product Highlights',
  insights: 'Insights',
};

export default function SectionComments(props: SectionCommentsProps) {
  const { section, comments, mode, currentAuthorName, defaultPublicName, onAdd, onDelete } = props;
  const [body, setBody] = useState('');
  const [name, setName] = useState(defaultPublicName ?? '');
  const [open, setOpen] = useState(comments.length > 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const sectionComments = comments.filter(c => c.section === section);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true); setErr(null);
    try {
      const authorName = mode === 'authed' ? (currentAuthorName ?? 'User') : name.trim();
      if (mode === 'public' && !authorName) { setErr('Please enter your name'); setBusy(false); return; }
      await onAdd(body.trim(), authorName);
      if (mode === 'public') localStorage.setItem('ac_public_name', authorName);
      setBody('');
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to post');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-4 border-0" style={{ background: '#f8fafc' }}>
      <Card.Body className="py-3">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="btn btn-link p-0 text-decoration-none d-flex align-items-center gap-2 w-100 text-start"
          style={{ color: '#334155' }}
        >
          <i className={`bi bi-chat-left-text`} />
          <span className="fw-semibold">Comments on {SECTION_LABELS[section]}</span>
          {sectionComments.length > 0 && <Badge bg="primary" pill>{sectionComments.length}</Badge>}
          <i className={`bi bi-chevron-${open ? 'up' : 'down'} ms-auto text-muted`} />
        </button>

        {open && (
          <div className="mt-3">
            {sectionComments.length > 0 && (
              <div className="mb-3">
                {sectionComments.map(c => (
                  <div key={c.id} className="p-3 mb-2 rounded" style={{ background: 'white', border: '1px solid #e5e7eb' }}>
                    <div className="d-flex justify-content-between align-items-start mb-1">
                      <div className="d-flex align-items-center gap-2">
                        <span className="fw-semibold">{c.author_name}</span>
                        <Badge bg={c.author_type === 'client' ? 'info' : c.author_type === 'bob' ? 'warning' : 'success'} text={c.author_type === 'bob' ? 'dark' : undefined}>
                          {c.author_type === 'client' ? 'Client' : c.author_type === 'bob' ? 'Bob' : 'APC'}
                        </Badge>
                        <small className="text-muted">{formatTime(c.created_at)}</small>
                      </div>
                      {onDelete && mode === 'authed' && (
                        <button type="button" className="btn btn-sm btn-link text-danger p-0"
                          onClick={() => { if (confirm('Delete this comment?')) onDelete(c.id); }}>
                          <i className="bi bi-trash" />
                        </button>
                      )}
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>
                  </div>
                ))}
              </div>
            )}

            <Form onSubmit={submit}>
              {err && <Alert variant="danger" className="py-2 mb-2 small">{err}</Alert>}
              {mode === 'public' && (
                <Form.Control
                  size="sm"
                  className="mb-2"
                  placeholder="Your name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                />
              )}
              <Form.Control
                as="textarea"
                rows={2}
                placeholder={`Add a comment on ${SECTION_LABELS[section]}…`}
                value={body}
                onChange={e => setBody(e.target.value)}
                required
              />
              <div className="text-end mt-2">
                <Button type="submit" size="sm" disabled={busy || !body.trim()}>
                  <i className="bi bi-send me-1" />
                  {busy ? 'Posting…' : 'Post comment'}
                </Button>
              </div>
            </Form>
          </div>
        )}
      </Card.Body>
    </Card>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
