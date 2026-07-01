// Bookmarks tab — Slack-style saved links for a conversation. Who can add/edit
// is decided by the caller (DM: both; group: admins, or members when opened;
// announcement: Bob only). Everyone with access to the chat can view + click.
// Brand groups are two-way synced with the brand's Resources tab.
import { useEffect, useMemo, useState } from 'react';
import { Modal, Form, Button, InputGroup, Spinner, Alert } from 'react-bootstrap';
import type { ChatBookmark } from './types';
import { resourceIcon } from '../../lib/resourceIcon';
import { copyWithToast } from '../../lib/copyToast';

interface Props {
  show: boolean;
  title: string;                    // conversation title (for the header)
  bookmarks: ChatBookmark[];
  canEdit: boolean;
  isGroup: boolean;
  isGroupAdmin: boolean;            // show the "members can edit" toggle
  membersCanEdit: boolean;
  brandGroup?: boolean;             // bookmarks mirror the brand's Resources tab
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

function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

export default function BookmarksModal(p: Props) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!p.show) { setTitle(''); setUrl(''); setEditId(null); setConfirmId(null); setQ(''); setErr(null); }
  }, [p.show]);

  const sorted = useMemo(
    () => [...p.bookmarks].sort((a, b) => a.title.localeCompare(b.title)),
    [p.bookmarks]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return sorted;
    return sorted.filter(b => `${b.title} ${b.url}`.toLowerCase().includes(needle));
  }, [sorted, q]);

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

  const startEdit = (b: ChatBookmark) => { setEditId(b.id); setConfirmId(null); setTitle(b.title); setUrl(b.url); };
  const cancelEdit = () => { setEditId(null); setTitle(''); setUrl(''); };

  return (
    <Modal show={p.show} onHide={p.onClose} centered dialogClassName="ac-bm-modal">
      <Modal.Header closeButton className="ac-bm-head">
        <div className="d-flex align-items-center gap-3 min-w-0">
          <span className="ac-bm-head-icon"><i className="bi bi-bookmark-star-fill" /></span>
          <div className="min-w-0">
            <div className="ac-bm-head-title">
              Bookmarks
              {!p.loading && <span className="ac-bm-count">{p.bookmarks.length}</span>}
            </div>
            <div className="ac-bm-head-sub text-truncate">{p.title}</div>
          </div>
        </div>
      </Modal.Header>
      <Modal.Body className="ac-bm-body">
        {p.brandGroup && (
          <div className="ac-bm-sync" role="note">
            <i className="bi bi-arrow-repeat" />
            <span>Two-way synced with this brand&rsquo;s <strong>Resources</strong> tab — changes here update the brand page too.</span>
          </div>
        )}

        {err && <Alert variant="danger" className="py-2 small" onClose={() => setErr(null)} dismissible>{err}</Alert>}

        {sorted.length > 4 && (
          <InputGroup size="sm" className="ac-bm-search">
            <InputGroup.Text><i className="bi bi-search" /></InputGroup.Text>
            <Form.Control placeholder="Search bookmarks…" value={q} onChange={e => setQ(e.target.value)} />
          </InputGroup>
        )}

        {p.loading ? (
          <div className="text-center py-4"><Spinner animation="border" size="sm" /></div>
        ) : shown.length === 0 ? (
          <div className="ac-bm-empty">
            <span className="ac-bm-empty-icon"><i className="bi bi-bookmark" /></span>
            {sorted.length === 0 ? (
              <>
                <div className="fw-semibold">No bookmarks yet</div>
                {p.canEdit && <div className="text-muted small">Save a useful link below — the whole chat can reach it here.</div>}
              </>
            ) : (
              <div className="text-muted small">Nothing matches “{q.trim()}”.</div>
            )}
          </div>
        ) : (
          <div className="ac-bm-list">
            {shown.map(b => {
              const meta = resourceIcon(b.url);
              const editing = editId === b.id;
              return (
                <div key={b.id} className={`ac-bm-row ${editing ? 'editing' : ''}`}>
                  <span
                    className="ac-bm-chip"
                    style={{ color: meta.color, background: `color-mix(in srgb, ${meta.color} 12%, transparent)` }}
                    title={meta.label}
                  >
                    <i className={`bi ${meta.icon}`} />
                  </span>
                  <a href={b.url} target="_blank" rel="noopener noreferrer nofollow" className="ac-bm-main" title={b.url}>
                    <span className="ac-bm-title text-truncate">{b.title}</span>
                    <span className="ac-bm-domain text-truncate">{domainOf(b.url)}</span>
                  </a>
                  {confirmId === b.id ? (
                    <div className="ac-bm-confirm">
                      <span>Delete?</span>
                      <button type="button" className="ac-bm-act danger" title="Confirm delete" disabled={busy}
                        onClick={() => run(async () => { await p.onDelete(b.id); setConfirmId(null); })}>
                        <i className="bi bi-check-lg" />
                      </button>
                      <button type="button" className="ac-bm-act" title="Keep bookmark" disabled={busy}
                        onClick={() => setConfirmId(null)}>
                        <i className="bi bi-x-lg" />
                      </button>
                    </div>
                  ) : (
                    <div className="ac-bm-actions">
                      <button type="button" className="ac-bm-act" title="Copy link"
                        onClick={() => copyWithToast(b.url, 'Link')}>
                        <i className="bi bi-copy" />
                      </button>
                      <a className="ac-bm-act" href={b.url} target="_blank" rel="noopener noreferrer nofollow" title="Open link">
                        <i className="bi bi-box-arrow-up-right" />
                      </a>
                      {p.canEdit && (
                        <>
                          <button type="button" className="ac-bm-act" title="Edit" disabled={busy}
                            onClick={() => startEdit(b)}>
                            <i className="bi bi-pencil" />
                          </button>
                          <button type="button" className="ac-bm-act danger" title="Delete" disabled={busy}
                            onClick={() => setConfirmId(b.id)}>
                            <i className="bi bi-trash" />
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {p.canEdit ? (
          <div className="ac-bm-composer">
            <div className="ac-bm-composer-title">
              <i className={`bi ${editId ? 'bi-pencil-square' : 'bi-plus-circle'} me-1`} />
              {editId ? 'Edit bookmark' : 'Add a bookmark'}
            </div>
            <Form.Control className="mb-2" placeholder="Name (e.g. Brand sheet)" value={title}
              disabled={busy} onChange={e => setTitle(e.target.value)} />
            <InputGroup>
              <InputGroup.Text><i className="bi bi-link-45deg" /></InputGroup.Text>
              <Form.Control placeholder="https://…" value={url} disabled={busy}
                onChange={e => setUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
            </InputGroup>
            <div className="d-flex align-items-center gap-2 mt-2">
              {p.isGroupAdmin && (
                <Form.Check
                  type="switch"
                  id="bm-members-edit"
                  className="ac-bm-access small mb-0"
                  label="Members can edit"
                  title="Let group members add & edit bookmarks"
                  checked={p.membersCanEdit}
                  disabled={busy}
                  onChange={e => run(() => p.onToggleAccess(e.target.checked))}
                />
              )}
              <div className="ms-auto d-flex gap-2">
                {editId && <Button variant="outline-secondary" size="sm" disabled={busy} onClick={cancelEdit}>Cancel</Button>}
                <Button size="sm" disabled={busy || !title.trim() || !url.trim()} onClick={submit}>
                  {busy ? <Spinner size="sm" animation="border" /> : editId ? 'Save changes' : (<><i className="bi bi-plus-lg me-1" />Add bookmark</>)}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-muted small mt-3 mb-0"><i className="bi bi-eye me-1" />You have view-only access to bookmarks here.</p>
        )}
      </Modal.Body>
    </Modal>
  );
}
