// Bookmarks tab — Slack-style saved links for a conversation. Who can add/edit
// is decided by the caller (DM: both; group: admins, or members when opened;
// announcement: Bob only). Everyone with access to the chat can view + click.
import { useEffect, useMemo, useState } from 'react';
import { Modal, Form, Button, InputGroup, Spinner, Alert } from 'react-bootstrap';
import type { ChatBookmark } from './types';

interface Props {
  show: boolean;
  title: string;                    // conversation title (for the header)
  bookmarks: ChatBookmark[];
  canEdit: boolean;
  isGroup: boolean;
  isGroupAdmin: boolean;            // show the "members can edit" toggle
  membersCanEdit: boolean;
  loading: boolean;
  onAdd: (title: string, url: string) => Promise<void>;
  onUpdate: (id: string, title: string, url: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToggleAccess: (open: boolean) => Promise<void>;
  onClose: () => void;
}

// Add a scheme so a bare "example.com" still opens as an external link.
function normalizeUrl(raw: string): string {
  const u = raw.trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (/^mailto:/i.test(u)) return u;
  return `https://${u}`;
}

export default function BookmarksModal(p: Props) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (!p.show) { setTitle(''); setUrl(''); setEditId(null); setErr(null); } }, [p.show]);

  const sorted = useMemo(
    () => [...p.bookmarks].sort((a, b) => a.title.localeCompare(b.title)),
    [p.bookmarks]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const submit = () => {
    const t = title.trim();
    const u = normalizeUrl(url);
    if (!t || !u) return;
    run(async () => {
      if (editId) await p.onUpdate(editId, t, u);
      else await p.onAdd(t, u);
      setTitle(''); setUrl(''); setEditId(null);
    });
  };

  const startEdit = (b: ChatBookmark) => { setEditId(b.id); setTitle(b.title); setUrl(b.url); };
  const cancelEdit = () => { setEditId(null); setTitle(''); setUrl(''); };

  return (
    <Modal show={p.show} onHide={p.onClose} centered>
      <Modal.Header closeButton>
        <Modal.Title><i className="bi bi-bookmark-star me-2" />Bookmarks</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="text-muted small mb-2 text-truncate">{p.title}</div>

        {p.isGroupAdmin && (
          <Form.Check
            type="switch"
            id="bm-members-edit"
            className="mb-3"
            label="Let group members add & edit bookmarks"
            checked={p.membersCanEdit}
            disabled={busy}
            onChange={e => run(() => p.onToggleAccess(e.target.checked))}
          />
        )}

        {err && <Alert variant="danger" className="py-2 small" onClose={() => setErr(null)} dismissible>{err}</Alert>}

        {p.loading ? (
          <div className="text-center py-4"><Spinner animation="border" size="sm" /></div>
        ) : sorted.length === 0 ? (
          <p className="text-muted text-center py-3 mb-0">
            <i className="bi bi-bookmark me-1" />No bookmarks yet.
            {p.canEdit ? ' Add a useful link below.' : ''}
          </p>
        ) : (
          <div className="ac-bookmark-list">
            {sorted.map(b => (
              <div key={b.id} className="ac-bookmark-row">
                <i className="bi bi-link-45deg ac-bookmark-icon" />
                <div className="flex-grow-1 min-w-0">
                  <a href={b.url} target="_blank" rel="noopener noreferrer nofollow"
                     className="ac-bookmark-title text-truncate d-block">{b.title}</a>
                  <a href={b.url} target="_blank" rel="noopener noreferrer nofollow"
                     className="ac-bookmark-url text-truncate d-block">{b.url}</a>
                </div>
                {p.canEdit && (
                  <div className="d-flex gap-1">
                    <Button size="sm" variant="link" className="p-0 text-muted" title="Edit"
                      disabled={busy} onClick={() => startEdit(b)}><i className="bi bi-pencil" /></Button>
                    <Button size="sm" variant="link" className="p-0 text-danger" title="Delete"
                      disabled={busy} onClick={() => run(() => p.onDelete(b.id))}><i className="bi bi-trash" /></Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {p.canEdit ? (
          <div className="ac-bookmark-add mt-3">
            <Form.Label className="small fw-semibold">{editId ? 'Edit bookmark' : 'Add a bookmark'}</Form.Label>
            <Form.Control className="mb-2" placeholder="Name (e.g. Brand sheet)" value={title}
              disabled={busy} onChange={e => setTitle(e.target.value)} />
            <InputGroup>
              <InputGroup.Text><i className="bi bi-link-45deg" /></InputGroup.Text>
              <Form.Control placeholder="https://…" value={url} disabled={busy}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
            </InputGroup>
            <div className="d-flex gap-2 mt-2">
              {editId && <Button variant="outline-secondary" size="sm" disabled={busy} onClick={cancelEdit}>Cancel</Button>}
              <Button size="sm" disabled={busy || !title.trim() || !url.trim()} onClick={submit}>
                {busy ? <Spinner size="sm" animation="border" /> : editId ? 'Save' : (<><i className="bi bi-plus-lg me-1" />Add</>)}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-muted small mt-3 mb-0"><i className="bi bi-eye me-1" />You have view-only access to bookmarks here.</p>
        )}
      </Modal.Body>
    </Modal>
  );
}
