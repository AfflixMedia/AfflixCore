import { useState, FormEvent } from 'react';
import { Card, Form, Button, Row, Col, Table, Modal, Badge } from 'react-bootstrap';
import { CustomField, CustomFieldType, CustomSection, StandardSectionId } from '../lib/reportSchema';
import RichTextEditor from './RichTextEditor';

const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Short text', number: 'Number', textarea: 'Long text',
  richtext: 'Rich text', date: 'Date', url: 'URL', select: 'Dropdown',
};

export const POSITION_LABELS: Record<StandardSectionId, string> = {
  start: 'At the very top',
  overall: 'After Overall Performance',
  top_creators: 'After Top Creators',
  top_videos: 'After Top Videos',
  video_performance: 'After Video Performance',
  gmv_max: 'After GMV Max',
  product_highlights: 'After Product Highlights',
  shop_health: 'After Shop Health',
  insights: 'After Insights (end)',
};

/* ------------------ Inline render of one custom section ------------------ */

export function CustomSectionInline({
  section, onChange, onEditDef, onRemove,
}: {
  section: CustomSection;
  onChange: (patch: Partial<CustomSection>) => void;
  onEditDef: () => void;
  onRemove: () => void;
}) {
  const addRow = () => {
    const row: Record<string, any> = {};
    section.fields.forEach(f => { row[f.id] = f.type === 'number' ? 0 : ''; });
    onChange({ rows: [...section.rows, row] });
  };
  const updateRow = (i: number, fieldId: string, value: any) => {
    onChange({ rows: section.rows.map((r, idx) => idx === i ? { ...r, [fieldId]: value } : r) });
  };
  const deleteRow = (i: number) => {
    onChange({ rows: section.rows.filter((_, idx) => idx !== i) });
  };

  // Ensure single-entry sections have exactly one row
  if (!section.is_repeater && section.rows.length === 0) {
    const row: Record<string, any> = {};
    section.fields.forEach(f => { row[f.id] = f.type === 'number' ? 0 : ''; });
    setTimeout(() => onChange({ rows: [row] }), 0);
  }

  return (
    <Card className="mb-4">
      <Card.Header className="d-flex justify-content-between align-items-center">
        <div>
          <span className="fw-semibold">{section.name}</span>
          {section.is_repeater && <Badge bg="info" className="ms-2">Repeater</Badge>}
          {section.description && <div className="text-muted small">{section.description}</div>}
        </div>
        <div className="d-flex gap-2">
          {section.is_repeater && (
            <Button size="sm" variant="outline-primary" onClick={addRow}>
              <i className="bi bi-plus-lg me-1" />Add row
            </Button>
          )}
          <Button size="sm" variant="outline-secondary" onClick={onEditDef} title="Edit fields/position">
            <i className="bi bi-pencil" />
          </Button>
          <Button size="sm" variant="outline-danger" onClick={onRemove} title="Delete section">
            <i className="bi bi-trash" />
          </Button>
        </div>
      </Card.Header>
      <Card.Body className={section.is_repeater ? 'p-2' : undefined}>
        {section.is_repeater ? (
          section.rows.length === 0
            ? <p className="text-muted text-center py-3 mb-0 small">No rows yet — click "Add row".</p>
            : <Table size="sm" responsive className="align-middle mb-0">
                <thead>
                  <tr>
                    {section.fields.map(f => <th key={f.id}>{f.label}</th>)}
                    <th style={{ width: 50 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row, i) => (
                    <tr key={i}>
                      {section.fields.map(f => (
                        <td key={f.id}>
                          <FieldInput field={f} value={row[f.id]} onChange={v => updateRow(i, f.id, v)} size="sm" />
                        </td>
                      ))}
                      <td>
                        <Button size="sm" variant="outline-danger" onClick={() => deleteRow(i)}>
                          <i className="bi bi-trash" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
        ) : (
          <Row className="g-3">
            {section.fields.map(f => (
              <Col md={f.type === 'textarea' || f.type === 'richtext' ? 12 : 4} key={f.id}>
                <Form.Label className="small">{f.label}</Form.Label>
                <FieldInput
                  field={f}
                  value={section.rows[0]?.[f.id]}
                  onChange={v => onChange({ rows: [{ ...(section.rows[0] ?? {}), [f.id]: v }] })}
                />
              </Col>
            ))}
          </Row>
        )}
      </Card.Body>
    </Card>
  );
}

/* ------------------ Field input dispatcher ------------------ */

function FieldInput({ field, value, onChange, size }: {
  field: CustomField;
  value: any;
  onChange: (v: any) => void;
  size?: 'sm';
}) {
  const common = { size } as any;
  switch (field.type) {
    case 'number':
      return <Form.Control {...common} type="number" step="0.01" value={value || ''} onChange={e => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />;
    case 'date':
      return <Form.Control {...common} type="date" value={value ?? ''} onChange={e => onChange(e.target.value)} />;
    case 'url':
      return <Form.Control {...common} type="url" placeholder="https://…" value={value ?? ''} onChange={e => onChange(e.target.value)} />;
    case 'textarea':
      return <Form.Control {...common} as="textarea" rows={3} value={value ?? ''} onChange={e => onChange(e.target.value)} />;
    case 'richtext':
      return <RichTextEditor value={value ?? ''} onChange={onChange} />;
    case 'select':
      return (
        <Form.Select {...common} value={value ?? ''} onChange={e => onChange(e.target.value)}>
          <option value="">—</option>
          {(field.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
        </Form.Select>
      );
    case 'text':
    default:
      return <Form.Control {...common} value={value ?? ''} onChange={e => onChange(e.target.value)} />;
  }
}

/* ------------------ Definition modal (add / edit a section) ------------------ */

export function CustomSectionDefModal({
  show, onHide, initial, onSave, isEdit,
}: {
  show: boolean;
  onHide: () => void;
  initial: CustomSection;
  onSave: (s: CustomSection) => void;
  isEdit: boolean;
}) {
  const [draft, setDraft] = useState<CustomSection>(initial);
  // Track the raw text of options per field so commas type freely
  const [optsText, setOptsText] = useState<Record<string, string>>({});

  // Reset state when initial changes (modal reopens with new section)
  if (draft.id !== initial.id || (show && !isEdit && draft !== initial && draft.fields.length === 0 && initial.fields.length === 0 && draft.name !== initial.name)) {
    // intentionally simple: reset on identity change
  }
  // Actually use an effect-like sync via key reset on show+initial.id in parent

  const addField = () => setDraft({ ...draft, fields: [...draft.fields, { id: crypto.randomUUID(), label: '', type: 'text' }] });
  const updField = (i: number, patch: Partial<CustomField>) => {
    const fields = draft.fields.map((f, idx) => idx === i ? { ...f, ...patch } : f);
    setDraft({ ...draft, fields });
  };
  const delField = (i: number) => setDraft({ ...draft, fields: draft.fields.filter((_, idx) => idx !== i) });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.name.trim()) { alert('Section name is required.'); return; }
    if (draft.fields.length === 0) { alert('Add at least one field.'); return; }
    // Finalize options: parse raw text strings now
    const cleanedFields: CustomField[] = draft.fields.map(f => {
      if (f.type !== 'select') return { ...f, options: undefined };
      const text = optsText[f.id] ?? (f.options ?? []).join(', ');
      return { ...f, options: text.split(',').map(s => s.trim()).filter(Boolean) };
    });
    onSave({ ...draft, fields: cleanedFields });
  };

  return (
    <Modal show={show} onHide={onHide} centered size="lg">
      <Form onSubmit={onSubmit}>
        <Modal.Header closeButton>
          <Modal.Title>{isEdit ? 'Edit' : 'Add'} custom section</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Row className="g-3 mb-3">
            <Col md={6}>
              <Form.Label className="small">Section name</Form.Label>
              <Form.Control required placeholder="e.g. Offsite Data" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
            </Col>
            <Col md={6}>
              <Form.Label className="small">Entry mode</Form.Label>
              <Form.Select value={draft.is_repeater ? 'repeater' : 'single'} onChange={e => setDraft({ ...draft, is_repeater: e.target.value === 'repeater' })}>
                <option value="single">Single entry (one set of fields)</option>
                <option value="repeater">Repeater — multiple rows (like a table)</option>
              </Form.Select>
            </Col>
            <Col md={12}>
              <Form.Label className="small">Description (optional)</Form.Label>
              <Form.Control value={draft.description ?? ''} onChange={e => setDraft({ ...draft, description: e.target.value })}
                placeholder="Short helper text for this section" />
            </Col>
            <Col md={12}>
              <Form.Label className="small">Position</Form.Label>
              <Form.Select value={draft.insert_after} onChange={e => setDraft({ ...draft, insert_after: e.target.value as StandardSectionId })}>
                {(Object.keys(POSITION_LABELS) as StandardSectionId[]).map(p => (
                  <option key={p} value={p}>{POSITION_LABELS[p]}</option>
                ))}
              </Form.Select>
              <Form.Text className="text-muted">Where this section will appear in the form and the dashboard.</Form.Text>
            </Col>
          </Row>

          <h6 className="mt-3">Fields</h6>
          <Table size="sm" className="align-middle">
            <thead>
              <tr>
                <th>Label</th>
                <th style={{ width: 170 }}>Type</th>
                <th>Options (for Dropdown — comma separated)</th>
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {draft.fields.map((f, i) => (
                <tr key={f.id}>
                  <td><Form.Control size="sm" required value={f.label} onChange={e => updField(i, { label: e.target.value })} placeholder="e.g. Offsite GMV" /></td>
                  <td>
                    <Form.Select size="sm" value={f.type} onChange={e => updField(i, { type: e.target.value as CustomFieldType })}>
                      {(Object.keys(TYPE_LABELS) as CustomFieldType[]).map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                    </Form.Select>
                  </td>
                  <td>
                    {f.type === 'select' ? (
                      <Form.Control
                        size="sm"
                        value={optsText[f.id] ?? (f.options ?? []).join(', ')}
                        onChange={e => setOptsText({ ...optsText, [f.id]: e.target.value })}
                        placeholder="Good, Fair, Poor"
                      />
                    ) : <span className="text-muted small">—</span>}
                  </td>
                  <td>
                    <Button size="sm" variant="outline-danger" onClick={() => delField(i)}><i className="bi bi-trash" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Button size="sm" variant="outline-primary" onClick={addField}><i className="bi bi-plus-lg me-1" />Add field</Button>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onHide}>Cancel</Button>
          <Button type="submit">Save section</Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}

/* ------------------ Helpers ------------------ */

export function newSection(insertAfter: StandardSectionId = 'insights'): CustomSection {
  return {
    id: crypto.randomUUID(),
    name: '',
    description: '',
    is_repeater: false,
    fields: [],
    rows: [],
    insert_after: insertAfter,
  };
}

export function customSectionsAt(all: CustomSection[], anchor: StandardSectionId): CustomSection[] {
  return all.filter(s => s.insert_after === anchor);
}
