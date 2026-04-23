import { useState, FormEvent } from 'react';
import { Card, Form, Button, Row, Col, Table, Modal, Badge } from 'react-bootstrap';
import { CustomField, CustomFieldType, CustomSection } from '../lib/reportSchema';
import RichTextEditor from './RichTextEditor';

const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Short text', number: 'Number', textarea: 'Long text',
  richtext: 'Rich text', date: 'Date', url: 'URL', select: 'Dropdown',
};

export function CustomSectionsEditor({
  sections, onChange,
}: {
  sections: CustomSection[];
  onChange: (sections: CustomSection[]) => void;
}) {
  const [showDef, setShowDef] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CustomSection>(newSection());

  const openAdd = () => { setEditingId(null); setDraft(newSection()); setShowDef(true); };
  const openEdit = (s: CustomSection) => { setEditingId(s.id); setDraft({ ...s, fields: [...s.fields] }); setShowDef(true); };

  const saveDefinition = () => {
    if (!draft.name.trim()) return alert('Section name is required.');
    if (draft.fields.length === 0) return alert('Add at least one field.');
    if (editingId) {
      onChange(sections.map(s => s.id === editingId ? draft : s));
    } else {
      onChange([...sections, draft]);
    }
    setShowDef(false);
  };

  const removeSection = (id: string) => {
    if (confirm('Delete this custom section and all its data?')) {
      onChange(sections.filter(s => s.id !== id));
    }
  };

  const updateSectionData = (id: string, patch: Partial<CustomSection>) => {
    onChange(sections.map(s => s.id === id ? { ...s, ...patch } : s));
  };

  return (
    <>
      <Card className="mb-4">
        <Card.Header className="d-flex justify-content-between align-items-center">
          <span className="fw-semibold"><i className="bi bi-plus-square me-1" /> Custom Sections</span>
          <Button size="sm" onClick={openAdd}><i className="bi bi-plus-lg me-1" />Add section</Button>
        </Card.Header>
        <Card.Body>
          {sections.length === 0
            ? <p className="text-muted small mb-0 text-center py-2">No custom sections. Add one to capture anything not covered by the standard sections above.</p>
            : sections.map(s => (
                <CustomSectionCard
                  key={s.id}
                  section={s}
                  onEditDef={() => openEdit(s)}
                  onRemove={() => removeSection(s.id)}
                  onChange={(patch) => updateSectionData(s.id, patch)}
                />
              ))}
        </Card.Body>
      </Card>

      <DefinitionModal
        show={showDef}
        onHide={() => setShowDef(false)}
        draft={draft}
        setDraft={setDraft}
        onSave={saveDefinition}
        isEdit={!!editingId}
      />
    </>
  );
}

function CustomSectionCard({
  section, onEditDef, onRemove, onChange,
}: {
  section: CustomSection;
  onEditDef: () => void;
  onRemove: () => void;
  onChange: (patch: Partial<CustomSection>) => void;
}) {
  const addRow = () => {
    const row: Record<string, any> = {};
    section.fields.forEach(f => { row[f.id] = f.type === 'number' ? 0 : ''; });
    onChange({ rows: [...section.rows, row] });
  };
  const updateRow = (i: number, fieldId: string, value: any) => {
    const rows = section.rows.map((r, idx) => idx === i ? { ...r, [fieldId]: value } : r);
    onChange({ rows });
  };
  const deleteRow = (i: number) => {
    onChange({ rows: section.rows.filter((_, idx) => idx !== i) });
  };

  // Ensure at least one row for single-entry sections
  if (!section.is_repeater && section.rows.length === 0) {
    const row: Record<string, any> = {};
    section.fields.forEach(f => { row[f.id] = f.type === 'number' ? 0 : ''; });
    // update state lazily
    setTimeout(() => onChange({ rows: [row] }), 0);
  }

  return (
    <Card className="mb-3" style={{ borderLeft: '4px solid #7c3aed' }}>
      <Card.Header className="bg-white d-flex justify-content-between align-items-center">
        <div>
          <span className="fw-semibold">{section.name}</span>
          {section.is_repeater && <Badge bg="info" className="ms-2">Repeater</Badge>}
          {section.description && <div className="text-muted small">{section.description}</div>}
        </div>
        <div className="d-flex gap-2">
          <Button size="sm" variant="outline-secondary" onClick={onEditDef} title="Edit fields">
            <i className="bi bi-pencil" />
          </Button>
          <Button size="sm" variant="outline-danger" onClick={onRemove} title="Delete section">
            <i className="bi bi-trash" />
          </Button>
        </div>
      </Card.Header>
      <Card.Body>
        {section.is_repeater ? (
          <>
            <Table size="sm" responsive className="align-middle mb-2">
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
            <Button size="sm" variant="outline-primary" onClick={addRow}>
              <i className="bi bi-plus-lg me-1" /> Add row
            </Button>
          </>
        ) : (
          <Row className="g-3">
            {section.fields.map(f => (
              <Col md={f.type === 'textarea' || f.type === 'richtext' ? 12 : 4} key={f.id}>
                <Form.Label className="small">{f.label}</Form.Label>
                <FieldInput
                  field={f}
                  value={section.rows[0]?.[f.id]}
                  onChange={v => {
                    const newRow = { ...(section.rows[0] ?? {}), [f.id]: v };
                    onChange({ rows: [newRow] });
                  }}
                />
              </Col>
            ))}
          </Row>
        )}
      </Card.Body>
    </Card>
  );
}

function FieldInput({ field, value, onChange, size }: {
  field: CustomField;
  value: any;
  onChange: (v: any) => void;
  size?: 'sm';
}) {
  const common = { size, value: value ?? '' } as any;
  switch (field.type) {
    case 'number':
      return <Form.Control {...common} type="number" step="0.01" value={value || ''} onChange={e => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />;
    case 'date':
      return <Form.Control {...common} type="date" onChange={e => onChange(e.target.value)} />;
    case 'url':
      return <Form.Control {...common} type="url" placeholder="https://…" onChange={e => onChange(e.target.value)} />;
    case 'textarea':
      return <Form.Control {...common} as="textarea" rows={3} onChange={e => onChange(e.target.value)} />;
    case 'richtext':
      return <RichTextEditor value={value ?? ''} onChange={onChange} />;
    case 'select':
      return (
        <Form.Select {...common} onChange={e => onChange(e.target.value)}>
          <option value="">—</option>
          {(field.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
        </Form.Select>
      );
    case 'text':
    default:
      return <Form.Control {...common} onChange={e => onChange(e.target.value)} />;
  }
}

function DefinitionModal({
  show, onHide, draft, setDraft, onSave, isEdit,
}: {
  show: boolean; onHide: () => void;
  draft: CustomSection; setDraft: (s: CustomSection) => void;
  onSave: () => void; isEdit: boolean;
}) {
  const addField = () => setDraft({ ...draft, fields: [...draft.fields, { id: crypto.randomUUID(), label: '', type: 'text' }] });
  const updField = (i: number, patch: Partial<CustomField>) => {
    const fields = draft.fields.map((f, idx) => idx === i ? { ...f, ...patch } : f);
    setDraft({ ...draft, fields });
  };
  const delField = (i: number) => setDraft({ ...draft, fields: draft.fields.filter((_, idx) => idx !== i) });

  const onSubmit = (e: FormEvent) => { e.preventDefault(); onSave(); };

  return (
    <Modal show={show} onHide={onHide} centered size="lg">
      <Form onSubmit={onSubmit}>
        <Modal.Header closeButton>
          <Modal.Title>{isEdit ? 'Edit' : 'Add'} custom section</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Row className="g-3 mb-3">
            <Col md={7}>
              <Form.Label className="small">Section name</Form.Label>
              <Form.Control required placeholder="e.g. Offsite Data" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
            </Col>
            <Col md={5}>
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
                      <Form.Control size="sm" value={(f.options ?? []).join(', ')}
                        onChange={e => updField(i, { options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                        placeholder="Good, Fair, Poor" />
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

function newSection(): CustomSection {
  return {
    id: crypto.randomUUID(),
    name: '',
    description: '',
    is_repeater: false,
    fields: [],
    rows: [],
  };
}
