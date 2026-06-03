import { FormEvent, useState } from 'react';
import { Card, Form, Button, Modal, Alert, Badge } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import { ProgramNote, NoteKind, NOTE_KIND_META, todayISO } from '../../lib/paidCollabSchema';

interface Props {
  programId: string;
  notes: ProgramNote[];
  canEdit: boolean;
  onChange: (next: ProgramNote[]) => void;
}

const KIND_KEYS: NoteKind[] = ['note', 'delay', 'pause', 'milestone', 'budget_suggestion', 'first_live'];

const blankForm = () => ({
  kind: 'note' as NoteKind,
  title: '',
  body: '',
  occurred_on: todayISO(),
  pin_to_chart: true,
});

export default function NotesPanel({ programId, notes, canEdit, onChange }: Props) {
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<ProgramNote | null>(null);
  const [form, setForm] = useState(blankForm());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const openAdd = () => {
    setEditing(null);
    setForm(blankForm());
    setErr(null);
    setShow(true);
  };

  const openEdit = (n: ProgramNote) => {
    setEditing(n);
    setForm({
      kind: n.kind,
      title: n.title,
      body: n.body ?? '',
      occurred_on: n.occurred_on ?? todayISO(),
      pin_to_chart: n.pin_to_chart,
    });
    setErr(null);
    setShow(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      if (editing) {
        const { data, error } = await supabase.from('paid_program_notes')
          .update({
            kind: form.kind,
            title: form.title.trim(),
            body: form.body.trim() || null,
            occurred_on: form.occurred_on || null,
            pin_to_chart: form.pin_to_chart,
          })
          .eq('id', editing.id)
          .select('*').single();
        if (error) throw error;
        onChange(notes.map(n => n.id === editing.id ? (data as ProgramNote) : n));
      } else {
        const { data, error } = await supabase.from('paid_program_notes')
          .insert({
            program_id: programId,
            kind: form.kind,
            title: form.title.trim(),
            body: form.body.trim() || null,
            occurred_on: form.occurred_on || null,
            pin_to_chart: form.pin_to_chart,
          })
          .select('*').single();
        if (error) throw error;
        onChange([...notes, data as ProgramNote]);
      }
      setShow(false);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to save note');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (n: ProgramNote) => {
    if (!confirm(`Delete this ${NOTE_KIND_META[n.kind].label.toLowerCase()}?`)) return;
    const { error } = await supabase.from('paid_program_notes').delete().eq('id', n.id);
    if (error) { alert(error.message); return; }
    onChange(notes.filter(x => x.id !== n.id));
  };

  const sorted = [...notes].sort((a, b) =>
    (b.occurred_on ?? b.created_at).localeCompare(a.occurred_on ?? a.created_at)
  );

  return (
    <Card className="h-100">
      <Card.Body>
        <div className="d-flex align-items-center justify-content-between mb-3">
          <h6 className="mb-0">Notes & milestones</h6>
          {canEdit && (
            <Button size="sm" onClick={openAdd}>
              <i className="bi bi-plus-lg me-1" /> Add note
            </Button>
          )}
        </div>

        {sorted.length === 0 ? (
          <div className="text-muted text-center py-4 small">
            No notes yet. Add delays, milestones, or budget suggestions — pinned ones show on the cumulative chart.
          </div>
        ) : (
          <div className="d-flex flex-column gap-2" style={{ maxHeight: 480, overflowY: 'auto' }}>
            {sorted.map(n => {
              const meta = NOTE_KIND_META[n.kind];
              return (
                <div key={n.id} className="border rounded p-2 d-flex gap-2 align-items-start">
                  <div
                    className="d-flex align-items-center justify-content-center rounded text-white flex-shrink-0"
                    style={{ width: 36, height: 36, backgroundColor: meta.color }}
                    title={meta.label}
                  >
                    <i className={`bi ${meta.icon}`} />
                  </div>
                  <div className="flex-grow-1 min-w-0">
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                      <strong className="text-truncate">{n.title}</strong>
                      {n.pin_to_chart && (
                        <Badge bg="light" text="dark" className="border" title="Pinned on the cumulative chart">
                          <i className="bi bi-pin-angle-fill me-1" />pinned
                        </Badge>
                      )}
                    </div>
                    <div className="text-muted small">
                      {meta.label}
                      {n.occurred_on && <> · {new Date(n.occurred_on + 'T00:00:00').toLocaleDateString()}</>}
                    </div>
                    {n.body && <div className="small mt-1" style={{ whiteSpace: 'pre-wrap' }}>{n.body}</div>}
                  </div>
                  {canEdit && (
                    <div className="d-flex flex-column gap-1">
                      <button className="btn btn-sm btn-link p-0 text-muted" onClick={() => openEdit(n)} title="Edit">
                        <i className="bi bi-pencil" />
                      </button>
                      <button className="btn btn-sm btn-link p-0 text-danger" onClick={() => remove(n)} title="Delete">
                        <i className="bi bi-trash" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card.Body>

      <Modal show={show} onHide={() => setShow(false)} centered>
        <Form onSubmit={submit}>
          <Modal.Header closeButton>
            <Modal.Title>{editing ? 'Edit note' : 'Add note'}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {err && <Alert variant="danger">{err}</Alert>}
            <Form.Group className="mb-3">
              <Form.Label>Kind</Form.Label>
              <div className="d-flex flex-wrap gap-2">
                {KIND_KEYS.map(k => {
                  const meta = NOTE_KIND_META[k];
                  const active = form.kind === k;
                  return (
                    <button
                      type="button"
                      key={k}
                      onClick={() => setForm(f => ({ ...f, kind: k }))}
                      className="btn btn-sm d-flex align-items-center gap-1"
                      style={{
                        backgroundColor: active ? meta.color : 'transparent',
                        color: active ? '#fff' : meta.color,
                        border: `1px solid ${meta.color}`,
                      }}
                    >
                      <i className={`bi ${meta.icon}`} /> {meta.label}
                    </button>
                  );
                })}
              </div>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Title</Form.Label>
              <Form.Control
                required
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Creator Sarah delayed shipping"
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Details (optional)</Form.Label>
              <Form.Control
                as="textarea" rows={3}
                value={form.body}
                onChange={e => setForm({ ...form, body: e.target.value })}
              />
            </Form.Group>
            <div className="row g-2">
              <Form.Group className="col-7">
                <Form.Label>When did this happen?</Form.Label>
                <Form.Control
                  type="date"
                  value={form.occurred_on}
                  onChange={e => setForm({ ...form, occurred_on: e.target.value })}
                />
              </Form.Group>
              <Form.Group className="col-5 d-flex align-items-end pb-2">
                <Form.Check
                  type="switch"
                  id="pin-to-chart"
                  label="Pin to chart"
                  checked={form.pin_to_chart}
                  onChange={e => setForm({ ...form, pin_to_chart: e.target.checked })}
                />
              </Form.Group>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShow(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={busy || !form.title.trim()}>{busy ? 'Saving…' : 'Save'}</Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </Card>
  );
}
