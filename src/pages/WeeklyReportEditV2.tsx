import { useEffect, useMemo, useState, FormEvent, Fragment } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, Form, Button, Spinner, Alert, Badge, Modal, Offcanvas, Dropdown } from 'react-bootstrap';
import { supabase } from '../lib/supabase';
import { formatRange } from '../lib/dates';
import {
  WeeklyReportContentV2, emptyContentV2, normalizeContentV2, numOrNull,
  WEEKLY_SECTIONS, SECTION_LABELS, SectionDef, emptyRow,
  CustomSection, CustomField, CustomFieldType, StandardSectionIdV2,
} from '../lib/reportSchemaV2';
import { ScalarSectionBody, TableSectionBody } from '../components/report/SectionBody';
import SectionComments, { Comment, CommentSection } from '../components/SectionComments';
import { useAuth } from '../auth/AuthContext';
import RichTextEditor from '../components/RichTextEditor';
import { CustomSectionInline, CustomSectionDefModal, customSectionsAt, newSection, AddSectionMenu } from '../components/CustomSectionEditor';

// Standard-section render order (for placing a custom section above/below one).
const WEEKLY_STD_ORDER: StandardSectionIdV2[] = ['start', ...WEEKLY_SECTIONS.map(s => s.id), 'insights'];

// Anchor id -> label map for the custom-section Position picker (v2 sections).
const V2_POSITIONS: Record<string, string> = {
  start: 'At the very top',
  ...Object.fromEntries(WEEKLY_SECTIONS.map(s => [s.id, `After ${s.num}. ${s.title}`])),
  insights: 'After Insights (end)',
};
type ClickedSection =
  | { type: 'standard'; id: StandardSectionIdV2 }
  | { type: 'custom'; section: CustomSection };

interface ReportRow {
  id: string; brand_id: string; week_start: string; week_end: string;
  week_number: number; status: string; content: any;
}
interface Brand { id: string; name: string; client: string; client_status: string | null; }

export default function WeeklyReportEdit() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { profile } = useAuth();
  const [report, setReport] = useState<ReportRow | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [c, setC] = useState<WeeklyReportContentV2>(emptyContentV2());
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [showComments, setShowComments] = useState(false);
  const [priorReports, setPriorReports] = useState<ReportRow[]>([]);
  const [pcPrograms, setPcPrograms] = useState<{ id: string; name: string | null; ended_at: string | null }[]>([]);
  const [selectedPriorId, setSelectedPriorId] = useState<string>('');
  const [priorComments, setPriorComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);

  const [csModalOpen, setCsModalOpen] = useState(false);
  const [csDraft, setCsDraft] = useState<CustomSection>(newSection());
  const [csIsEdit, setCsIsEdit] = useState(false);
  const [csTargetIndex, setCsTargetIndex] = useState<number | null>(null);

  const [feedbackSection, setFeedbackSection] = useState<CommentSection | null>(null);

  const [fetchingGmv, setFetchingGmv] = useState(false);
  const [gmvFetchMsg, setGmvFetchMsg] = useState<{ kind: 'success' | 'warning' | 'danger'; text: string } | null>(null);

  interface PresetRow {
    id: string; name: string; payload: any;
    kind: 'custom' | 'standard'; section_id: string | null;
    created_by: string | null; created_at: string;
  }
  const [presets, setPresets] = useState<PresetRow[]>([]);
  const [presetSavingId, setPresetSavingId] = useState<string | null>(null);
  const [presetMsg, setPresetMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!presetMsg) return;
    const t = setTimeout(() => setPresetMsg(null), 3500);
    return () => clearTimeout(t);
  }, [presetMsg]);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('weekly_reports').select('*').eq('id', id).single();
      if (error) { setErr(error.message); setLoading(false); return; }
      const r = data as ReportRow;
      setReport(r);
      setC(normalizeContentV2(r.content));
      const { data: bd } = await supabase.from('brands').select('id,name,client,client_status').eq('id', r.brand_id).single();
      setBrand(bd as Brand);
      const { data: pcp } = await supabase.from('paid_creator_programs')
        .select('id,name,ended_at').eq('brand_id', r.brand_id)
        .order('launch_date', { ascending: false });
      setPcPrograms((pcp as any[]) ?? []);
      const { data: priors } = await supabase.from('weekly_reports')
        .select('*').eq('brand_id', r.brand_id).lt('week_start', r.week_start)
        .order('week_start', { ascending: false }).limit(12);
      setPriorReports((priors as ReportRow[]) ?? []);
      if (priors && priors.length > 0) setSelectedPriorId((priors[0] as any).id);
      const { data: cm } = await supabase.from('report_comments')
        .select('*').eq('report_id', r.id).order('created_at', { ascending: true });
      setComments((cm as Comment[]) ?? []);
      const { data: pr } = await supabase.from('section_presets')
        .select('id,name,payload,kind,section_id,created_by,created_at').order('created_at', { ascending: false });
      setPresets(((pr as any[]) ?? []).map(p => ({
        ...p, kind: p.kind ?? 'custom', section_id: p.section_id ?? null,
      })) as PresetRow[]);
      setLoading(false);
    })();
  }, [id]);

  // ----- preset helpers (custom + standard) ---------------------------------
  const addCustomFromPreset = (preset: PresetRow) => {
    const p = preset.payload ?? {};
    const cs: CustomSection = {
      id: crypto.randomUUID(),
      name: String(p.name ?? preset.name ?? ''),
      description: String(p.description ?? ''),
      is_repeater: !!p.is_repeater,
      body: '',
      fields: Array.isArray(p.fields) ? p.fields.map((f: any) => ({
        id: crypto.randomUUID(), label: String(f.label ?? ''),
        type: f.type ?? 'text', options: Array.isArray(f.options) ? f.options : undefined,
      })) : [],
      rows: [],
      insert_after: p.insert_after ?? 'insights',
    };
    setC(prev => ({ ...prev, custom_sections: [...prev.custom_sections, cs] }));
    setPresetMsg(`Added "${cs.name}" from preset.`);
  };

  const addPresetSectionBelow = (clicked: CustomSection, preset: PresetRow) => {
    const p = preset.payload ?? {};
    const cs: CustomSection = {
      ...newSection(clicked.insert_after),
      name: String(p.name ?? preset.name ?? ''),
      description: String(p.description ?? ''),
      is_repeater: !!p.is_repeater,
      fields: Array.isArray(p.fields) ? p.fields.map((f: any): CustomField => ({
        id: crypto.randomUUID(), label: String(f.label ?? ''),
        type: (['text', 'number', 'textarea', 'richtext', 'date', 'url', 'select'].includes(f.type) ? f.type : 'text') as CustomFieldType,
        options: Array.isArray(f.options) ? f.options : undefined,
      })) : [],
      rows: [],
    };
    setC(prev => {
      const arr = [...prev.custom_sections];
      const idx = arr.findIndex(x => x.id === clicked.id);
      arr.splice(idx === -1 ? arr.length : idx + 1, 0, cs);
      return { ...prev, custom_sections: arr };
    });
    setPresetMsg(`Added "${cs.name || preset.name}" from preset below the section.`);
  };

  const saveSectionAsPreset = async (s: CustomSection) => {
    const name = window.prompt('Save this section as a preset. Name:', s.name || 'Untitled section');
    if (!name) return;
    setPresetSavingId(s.id);
    const payload = {
      name: s.name, description: s.description, is_repeater: s.is_repeater,
      insert_after: s.insert_after, fields: s.fields.map(f => ({ label: f.label, type: f.type, options: f.options })),
    };
    const { data, error } = await supabase.from('section_presets')
      .insert({ name: name.trim(), payload, created_by: profile?.id ?? null }).select().single();
    setPresetSavingId(null);
    if (error) { alert(error.message); return; }
    setPresets(prev => [data as PresetRow, ...prev]);
    setPresetMsg(`Saved preset "${(data as PresetRow).name}".`);
  };

  const removePreset = async (p: PresetRow) => {
    if (!confirm(`Delete preset "${p.name}" from the shared library?`)) return;
    const prev = presets;
    setPresets(presets.filter(x => x.id !== p.id));
    const { error } = await supabase.from('section_presets').delete().eq('id', p.id);
    if (error) { alert(error.message); setPresets(prev); }
  };

  const customPresets: PresetRow[] = useMemo(() => presets.filter(p => p.kind === 'custom'), [presets]);
  const standardPresetsFor = (sectionId: string): PresetRow[] =>
    presets.filter(p => p.kind === 'standard' && p.section_id === sectionId);

  const applyStandardPreset = (sectionId: string, data: any) => {
    setC(prev => ({ ...prev, [sectionId]: data }));
    setPresetMsg(`Loaded preset into ${SECTION_LABELS[sectionId] ?? sectionId}.`);
  };

  const saveStandardPreset = async (sectionId: string) => {
    const sectionLabel = SECTION_LABELS[sectionId] ?? sectionId;
    const name = window.prompt(`Save "${sectionLabel}" as a preset. Name:`, `${brand?.name ?? ''} — ${sectionLabel}`.trim());
    if (!name) return;
    const data = (c as any)[sectionId];
    if (data == null) return;
    const { data: row, error } = await supabase.from('section_presets')
      .insert({ name: name.trim(), kind: 'standard', section_id: sectionId, payload: { data }, created_by: profile?.id ?? null })
      .select().single();
    if (error) { alert(error.message); return; }
    setPresets(prev => [row as PresetRow, ...prev]);
    setPresetMsg(`Saved preset "${(row as PresetRow).name}".`);
  };

  const addComment = async (section: CommentSection, body: string, _authorName: string, parentId?: string) => {
    if (!report) return;
    const { data, error } = await supabase.functions.invoke('post-staff-comment', {
      body: { report_id: report.id, section, body, parent_id: parentId ?? null },
    });
    if (error) throw error;
    if ((data as any)?.error) throw new Error((data as any).error);
    setComments(prev => [...prev, (data as any).comment as Comment]);
  };

  // ----- generic section setters --------------------------------------------
  const setSec = (sectionId: string, key: string, v: any) =>
    setC(prev => ({ ...prev, [sectionId]: { ...(prev as any)[sectionId], [key]: v } }));
  const addRow = (def: SectionDef) =>
    setC(prev => ({ ...prev, [def.id]: [...((prev as any)[def.id] as any[]), emptyRow(def)] }));
  const setCell = (sectionId: string, i: number, key: string, v: any) =>
    setC(prev => {
      const arr = [...((prev as any)[sectionId] as any[])];
      arr[i] = { ...arr[i], [key]: v };
      return { ...prev, [sectionId]: arr };
    });
  const delRow = (sectionId: string, i: number) =>
    setC(prev => {
      const arr = [...((prev as any)[sectionId] as any[])];
      arr.splice(i, 1);
      return { ...prev, [sectionId]: arr };
    });

  // ----- GMV Max auto-fill for section 11.1 ---------------------------------
  const fetchGmvMaxFromBrand = async () => {
    if (!report) return;
    setFetchingGmv(true); setGmvFetchMsg(null);
    // Exact week match first (weekly reports line up 1:1 with GMV Max weeks).
    const { data: exact, error } = await supabase
      .from('brand_gmv_max_weekly').select('*')
      .eq('brand_id', report.brand_id).eq('week_start', report.week_start).maybeSingle();
    if (error) { setFetchingGmv(false); setGmvFetchMsg({ kind: 'danger', text: error.message }); return; }

    let adSpend: number | null = null, orders: number | null = null, gmv: number | null = null;
    let label = formatRange(report.week_start, report.week_end);
    if (exact) {
      adSpend = numOrNull((exact as any).ad_spend);
      orders = numOrNull((exact as any).orders);
      gmv = numOrNull((exact as any).gmv);
    } else {
      // Fall back to summing any GMV Max weeks overlapping this report's window
      // (covers bi-weekly windows that span two GMV Max weeks).
      const { data: overlap } = await supabase
        .from('brand_gmv_max_weekly').select('ad_spend,orders,gmv')
        .eq('brand_id', report.brand_id)
        .lte('week_start', report.week_end).gte('week_end', report.week_start);
      const rows = (overlap as any[]) ?? [];
      if (rows.length === 0) {
        setFetchingGmv(false);
        setGmvFetchMsg({ kind: 'warning', text: `No GMV Max entry exists for ${label} on this brand. Add it on the brand's GMV Max tab, or enter the numbers manually.` });
        return;
      }
      adSpend = rows.reduce((s, r) => s + (Number(r.ad_spend) || 0), 0);
      orders = rows.reduce((s, r) => s + (Number(r.orders) || 0), 0);
      gmv = rows.reduce((s, r) => s + (Number(r.gmv) || 0), 0);
      label += ` (${rows.length} GMV Max week${rows.length === 1 ? '' : 's'})`;
    }
    setFetchingGmv(false);
    setC(prev => ({
      ...prev,
      ad_overall: { ...prev.ad_overall, not_started: false, ad_spend: adSpend, total_orders_paid: orders, gmv_generated: gmv },
    }));
    setGmvFetchMsg({ kind: 'success', text: `Pulled GMV Max for ${label}. Don't forget to save.` });
  };

  const submit = async (e: FormEvent, status: 'draft' | 'submitted') => {
    e.preventDefault();
    if (brand?.client_status === 'closed') {
      setErr(`${brand.name} is inactive — reactivate the brand before saving changes.`);
      return;
    }
    setSaving(true); setErr(null);
    const update: Record<string, any> = { content: c, status };
    if (c.approval?.enabled) update.is_shared = true;
    const { error } = await supabase.from('weekly_reports').update(update).eq('id', id);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    nav(`/reporting/weekly/${id}`);
  };

  const openCommentsModal = async () => {
    setShowComments(true);
    if (!selectedPriorId) return;
    await loadPriorComments(selectedPriorId);
  };
  const loadPriorComments = async (priorId: string) => {
    setLoadingComments(true);
    const { data } = await supabase.from('report_comments')
      .select('*').eq('report_id', priorId).order('created_at', { ascending: true });
    setPriorComments((data as Comment[]) ?? []);
    setLoadingComments(false);
  };
  const pullInComment = async (cm: Comment) => {
    if (!report || !profile) return;
    const priorLabel = priorReports.find(p => p.id === cm.report_id);
    const origDate = new Date(cm.created_at).toLocaleDateString();
    const quoted = cm.body.split('\n').map(l => `> ${l}`).join('\n');
    const body = `📌 Referenced from ${priorLabel ? `Week #${priorLabel.week_number}` : 'prior report'} — ${cm.author_name} (${origDate}):\n${quoted}`;
    try {
      await addComment(cm.section as CommentSection, body, profile.full_name || profile.email || 'User');
      setShowComments(false);
    } catch (e: any) { alert(e?.message ?? 'Failed to pull comment'); }
  };

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err && !report) return <Alert variant="danger">{err}</Alert>;
  if (!report || !brand) return null;

  const brandInactive = brand.client_status === 'closed';
  const sectionFeedbackCount = (section: CommentSection) => comments.filter(c => c.section === section).length;

  const FeedbackButton = ({ section }: { section: CommentSection }) => {
    const n = sectionFeedbackCount(section);
    if (n === 0) return null;
    return (
      <Button size="sm" variant="outline-primary" className="ms-2 d-inline-flex align-items-center gap-1"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setFeedbackSection(section); }}
        title="View client feedback">
        <i className="bi bi-chat-left-text" /><Badge bg="primary" pill>{n}</Badge>
      </Button>
    );
  };

  const StdPresetMenu = ({ sectionId }: { sectionId: string }) => {
    const list = standardPresetsFor(sectionId);
    return (
      <Dropdown align="end" onClick={(e) => e.stopPropagation()}>
        <Dropdown.Toggle size="sm" variant="outline-info" title="Save / load section preset">
          <i className="bi bi-bookmark" />
          {list.length > 0 && <Badge bg="info" pill className="ms-1">{list.length}</Badge>}
        </Dropdown.Toggle>
        <Dropdown.Menu style={{ minWidth: 260, maxHeight: 320, overflowY: 'auto' }}>
          <Dropdown.Item as="button" onClick={() => saveStandardPreset(sectionId)}>
            <i className="bi bi-bookmark-plus me-2" /> Save current as preset
          </Dropdown.Item>
          {list.length > 0 && <Dropdown.Divider />}
          {list.map(p => (
            <div key={p.id} className="d-flex align-items-center px-2 py-1" style={{ gap: 4 }}>
              <Dropdown.Item as="button" className="flex-grow-1 px-2 py-1"
                onClick={() => applyStandardPreset(sectionId, p.payload?.data)}>
                <div className="fw-semibold small">{p.name}</div>
                <small className="text-muted">{new Date(p.created_at).toLocaleDateString()}</small>
              </Dropdown.Item>
              {(p.created_by === profile?.id || profile?.role === 'bob') && (
                <Button size="sm" variant="link" className="text-danger p-0 px-2"
                  onClick={(e) => { e.stopPropagation(); e.preventDefault(); removePreset(p); }} title="Delete preset">
                  <i className="bi bi-trash" />
                </Button>
              )}
            </div>
          ))}
        </Dropdown.Menu>
      </Dropdown>
    );
  };

  const HeaderWithFeedback = ({ title, section, extra, sectionId }: {
    title: string; section: CommentSection; extra?: React.ReactNode; sectionId?: string;
  }) => (
    <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
      <span className="fw-semibold">{title}</span>
      <div className="d-flex align-items-center gap-2">
        {extra}
        {sectionId && <StdPresetMenu sectionId={sectionId} />}
        <AddSectionMenu onPick={(pl) => openAddSectionRelative({ type: 'standard', id: section as StandardSectionIdV2 }, pl)} />
        <FeedbackButton section={section} />
      </div>
    </div>
  );

  // ----- custom section management ------------------------------------------
  const openAddCustom = () => { setCsDraft(newSection('insights')); setCsIsEdit(false); setCsTargetIndex(null); setCsModalOpen(true); };
  const openEditCustom = (s: CustomSection) => { setCsDraft({ ...s, fields: s.fields.map(f => ({ ...f })) }); setCsIsEdit(true); setCsModalOpen(true); };

  const openAddSectionRelative = (clicked: ClickedSection, placement: 'above' | 'below') => {
    const cs = c.custom_sections;
    let anchor: string;
    let index: number;
    if (clicked.type === 'custom') {
      anchor = clicked.section.insert_after;
      const idx = cs.findIndex(s => s.id === clicked.section.id);
      index = placement === 'below' ? idx + 1 : Math.max(0, idx);
    } else if (placement === 'below') {
      anchor = clicked.id;
      const firstIdx = cs.findIndex(s => s.insert_after === anchor);
      index = firstIdx === -1 ? cs.length : firstIdx;
    } else {
      const stdIdx = WEEKLY_STD_ORDER.indexOf(clicked.id);
      anchor = stdIdx > 0 ? WEEKLY_STD_ORDER[stdIdx - 1] : 'start';
      let lastIdx = -1;
      cs.forEach((s, i) => { if (s.insert_after === anchor) lastIdx = i; });
      index = lastIdx === -1 ? cs.length : lastIdx + 1;
    }
    setCsDraft(newSection(anchor));
    setCsIsEdit(false);
    setCsTargetIndex(index);
    setCsModalOpen(true);
  };

  const saveCustomDef = (s: CustomSection) => {
    if (csIsEdit) {
      setC(prev => ({ ...prev, custom_sections: prev.custom_sections.map(x => x.id === s.id ? s : x) }));
    } else {
      setC(prev => {
        const arr = [...prev.custom_sections];
        if (csTargetIndex != null) arr.splice(Math.min(csTargetIndex, arr.length), 0, s);
        else arr.push(s);
        return { ...prev, custom_sections: arr };
      });
    }
    setCsModalOpen(false);
    setCsTargetIndex(null);
  };
  const removeCustom = (id: string) => {
    if (!confirm('Delete this custom section and all its data?')) return;
    setC(prev => ({ ...prev, custom_sections: prev.custom_sections.filter(s => s.id !== id) }));
  };
  const updateCustomData = (id: string, patch: Partial<CustomSection>) => {
    setC(prev => ({ ...prev, custom_sections: prev.custom_sections.map(s => s.id === id ? { ...s, ...patch } : s) }));
  };

  const renderCustomAt = (anchor: StandardSectionIdV2) =>
    customSectionsAt(c.custom_sections, anchor).map(s => (
      <CustomSectionInline
        key={s.id}
        section={s}
        paidCollabPrograms={pcPrograms}
        onChange={(patch) => updateCustomData(s.id, patch)}
        onEditDef={() => openEditCustom(s)}
        onRemove={() => removeCustom(s.id)}
        onAddSection={(placement) => openAddSectionRelative({ type: 'custom', section: s }, placement)}
        headerExtra={
          <>
            <Dropdown>
              <Dropdown.Toggle size="sm" variant="outline-info" title="Add a saved preset as a new section">
                <i className="bi bi-bookmark" />
              </Dropdown.Toggle>
              <Dropdown.Menu align="end" style={{ minWidth: 240 }}>
                <Dropdown.Header>Add preset as a new section below</Dropdown.Header>
                {customPresets.length === 0 ? (
                  <Dropdown.ItemText className="text-muted small">No saved presets yet.</Dropdown.ItemText>
                ) : customPresets.map(p => (
                  <Dropdown.Item key={p.id} as="button" onClick={() => addPresetSectionBelow(s, p)}>
                    <i className="bi bi-box-arrow-in-down me-2" />{p.name}
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown>
            <Button size="sm" variant="outline-info" disabled={presetSavingId === s.id}
              onClick={() => saveSectionAsPreset(s)} title="Save this section as a reusable preset">
              <i className="bi bi-bookmark-plus" />
            </Button>
            <FeedbackButton section={`cs:${s.id}` as CommentSection} />
          </>
        }
      />
    ));

  const customSectionLabel = (section: CommentSection): string | undefined => {
    if (!section.startsWith('cs:')) return undefined;
    const id = section.slice(3);
    return c.custom_sections.find(s => s.id === id)?.name;
  };
  const labelForFeedback = (section: CommentSection): string =>
    customSectionLabel(section) ?? SECTION_LABELS[section] ?? section;

  // ----- per-section body ----------------------------------------------------
  const renderSectionBody = (def: SectionDef) => {
    if (def.special === 'gmv_max') {
      const ao = c.ad_overall;
      const notStarted = !!ao.not_started;
      return (
        <>
          {gmvFetchMsg && (
            <Alert variant={gmvFetchMsg.kind} className="py-2 small mb-3" onClose={() => setGmvFetchMsg(null)} dismissible>
              {gmvFetchMsg.text}
            </Alert>
          )}
          <div className="d-flex flex-wrap gap-4 mb-3">
            <Form.Check type="switch" id="ao-not-started" label="No paid ads this period"
              checked={notStarted} onChange={e => setSec('ad_overall', 'not_started', e.target.checked)} />
            <Form.Check type="switch" id="ao-auto-fill" label="Auto-fill from GMV Max on this brand"
              checked={!!ao.auto_fill} disabled={notStarted}
              onChange={e => { setSec('ad_overall', 'auto_fill', e.target.checked); if (e.target.checked) fetchGmvMaxFromBrand(); }} />
          </div>
          {!notStarted && (
            <ScalarSectionBody def={def} data={ao} onField={(k, v) => setSec('ad_overall', k, v)} />
          )}
        </>
      );
    }
    if (def.kind === 'scalar') {
      return <ScalarSectionBody def={def} data={(c as any)[def.id]} onField={(k, v) => setSec(def.id, k, v)} />;
    }
    // table / fixed
    return (
      <TableSectionBody
        def={def}
        rows={(c as any)[def.id]}
        fixed={def.kind === 'fixed'}
        onCell={(i, k, v) => setCell(def.id, i, k, v)}
        onAddRow={() => addRow(def)}
        onDelRow={(i) => delRow(def.id, i)}
      />
    );
  };

  return (
    <div className="ac-themed">
      {brandInactive && (
        <Alert variant="warning" className="d-flex align-items-center gap-2">
          <i className="bi bi-lock-fill" />
          <div><strong>{brand.name} is inactive.</strong>{' '}You can review the data but Save is disabled until the brand is reactivated.</div>
        </Alert>
      )}
      <div className="d-flex justify-content-between align-items-start mb-4 flex-wrap gap-2">
        <div>
          <h2 className="mb-1">{brand.name} <small className="text-muted fs-6">— {brand.client}</small></h2>
          <div className="text-muted">
            Week #{report.week_number} · {formatRange(report.week_start, report.week_end)}
            <Badge bg={report.status === 'draft' ? 'secondary' : 'success'} className="ms-2">{report.status}</Badge>
          </div>
        </div>
        <div className="d-flex gap-2 flex-wrap">
          {priorReports.length > 0 && (
            <Button variant="outline-info" onClick={openCommentsModal}>
              <i className="bi bi-chat-left-text me-1" /> Load previous comments
            </Button>
          )}
          <Dropdown>
            <Dropdown.Toggle variant="outline-info" title="Insert a saved custom-section preset">
              <i className="bi bi-bookmark me-1" /> Add from preset
              {customPresets.length > 0 && <Badge bg="info" pill className="ms-1">{customPresets.length}</Badge>}
            </Dropdown.Toggle>
            <Dropdown.Menu align="end" style={{ minWidth: 280, maxHeight: 320, overflowY: 'auto' }}>
              {customPresets.length === 0 ? (
                <Dropdown.ItemText className="text-muted small">No saved custom-section presets yet.</Dropdown.ItemText>
              ) : customPresets.map(p => (
                <div key={p.id} className="d-flex align-items-center px-2 py-1" style={{ gap: 4 }}>
                  <Dropdown.Item as="button" className="flex-grow-1 px-2 py-1" onClick={() => addCustomFromPreset(p)}>
                    <div className="fw-semibold">{p.name}</div>
                    <small className="text-muted">
                      {p.payload?.is_repeater ? 'Table' : 'Long text'} · {p.payload?.fields?.length ?? 0} field{(p.payload?.fields?.length ?? 0) === 1 ? '' : 's'}
                    </small>
                  </Dropdown.Item>
                  {(p.created_by === profile?.id || profile?.role === 'bob') && (
                    <Button size="sm" variant="link" className="text-danger p-0 px-2"
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); removePreset(p); }} title="Delete preset">
                      <i className="bi bi-trash" />
                    </Button>
                  )}
                </div>
              ))}
            </Dropdown.Menu>
          </Dropdown>
          <Button variant="outline-success" onClick={openAddCustom}>
            <i className="bi bi-plus-square me-1" /> Add custom section
          </Button>
          <Button variant="outline-secondary" onClick={() => nav('/reporting/weekly')}>Cancel</Button>
          <Button variant="outline-primary" disabled={saving || brandInactive} onClick={(e) => submit(e as any, 'draft')}>Save draft</Button>
          <Button variant="primary" disabled={saving || brandInactive} onClick={(e) => submit(e as any, 'submitted')}>{saving ? 'Saving…' : 'Save & view dashboard'}</Button>
        </div>
      </div>

      {err && <Alert variant="danger">{err}</Alert>}
      {presetMsg && <Alert variant="info" className="py-2 small" dismissible onClose={() => setPresetMsg(null)}>{presetMsg}</Alert>}

      {renderCustomAt('start')}

      {/* All 14 standard sections, registry-driven */}
      {WEEKLY_SECTIONS.map(def => (
        <Fragment key={def.id}>
          <Card className="mb-4" data-section={def.id}>
            <Card.Header>
              <HeaderWithFeedback title={`${def.num}. ${def.title}`} section={def.id} sectionId={def.id} />
            </Card.Header>
            <Card.Body>
              {def.blurb && <p className="text-muted small mb-3">{def.blurb}</p>}
              {renderSectionBody(def)}
            </Card.Body>
          </Card>
          {renderCustomAt(def.id)}
        </Fragment>
      ))}

      {/* Insights — single advanced rich-text block (dividers built in) */}
      <Card className="mb-4" data-section="insights">
        <Card.Header><HeaderWithFeedback title="Insights" section="insights" sectionId="insights" /></Card.Header>
        <Card.Body>
          <Form.Text className="text-muted d-block mb-2">
            Write all your insights here. Use the <strong>Divider</strong> button to separate topics — pick its thickness, colour and style.
          </Form.Text>
          <RichTextEditor
            value={c.insights.summary}
            onChange={html => setC(prev => ({ ...prev, insights: { summary: html } }))}
            placeholder="Write your insights for this week…"
            minHeight={240}
          />
        </Card.Body>
      </Card>
      {renderCustomAt('insights')}

      {/* Approval Needed (optional) */}
      <Card className="mb-4">
        <Card.Header className="d-flex justify-content-between align-items-center">
          <span className="fw-semibold"><i className="bi bi-shield-check me-2 text-warning" />Approval Needed / Action Items</span>
          <Form.Check type="switch" id="approval-needed-toggle"
            checked={!!c.approval?.enabled}
            onChange={e => setC(prev => ({ ...prev, approval: { ...prev.approval, enabled: e.target.checked } }))}
            label={c.approval?.enabled ? 'On — client will see approval prompt' : 'Off'} />
        </Card.Header>
        {c.approval?.enabled && (
          <Card.Body>
            <Form.Text className="text-muted d-block mb-2">
              The client will see this content in a prompt before viewing the report. They can approve, request changes, and add a comment.
            </Form.Text>
            <RichTextEditor
              value={c.approval?.content ?? ''}
              onChange={html => setC(prev => ({ ...prev, approval: { ...prev.approval, content: html } }))}
              placeholder="Describe what needs the client's approval this week…"
              minHeight={180}
            />
            <div className="mt-3 row g-2 align-items-end">
              <Form.Group className="col-md-5">
                <Form.Label className="small fw-semibold">Auto-popup expires at <span className="text-muted">(optional)</span></Form.Label>
                <Form.Control type="datetime-local"
                  value={c.approval?.expires_at ? c.approval.expires_at.slice(0, 16) : ''}
                  onChange={e => setC(prev => ({
                    ...prev,
                    approval: { ...prev.approval, expires_at: e.target.value ? new Date(e.target.value).toISOString() : null },
                  }))} />
              </Form.Group>
              <div className="col-md-7">
                <Form.Text className="text-muted">
                  After this date the popup stops auto-opening — but the client can still view the Approval Needed / Action Items card, submit a decision, and reply in the thread. Leave empty for no expiry.
                </Form.Text>
              </div>
            </div>
          </Card.Body>
        )}
      </Card>

      <CustomSectionDefModal
        show={csModalOpen} onHide={() => setCsModalOpen(false)} initial={csDraft}
        onSave={saveCustomDef} isEdit={csIsEdit} positions={V2_POSITIONS}
        hidePosition={!csIsEdit && csTargetIndex != null} key={csDraft.id}
      />

      <Offcanvas show={!!feedbackSection} onHide={() => setFeedbackSection(null)} placement="end" style={{ width: 480 }}>
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>
            <i className="bi bi-chat-left-text me-2" />Client feedback
            {feedbackSection && <small className="text-muted ms-2 fw-normal">— {labelForFeedback(feedbackSection)}</small>}
          </Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body>
          {feedbackSection && (
            <SectionComments
              section={feedbackSection} sectionLabel={labelForFeedback(feedbackSection)}
              comments={comments} mode="authed"
              currentAuthorName={profile?.full_name || profile?.email || 'User'}
              onAdd={(b, n, parentId) => addComment(feedbackSection, b, n, parentId)}
            />
          )}
        </Offcanvas.Body>
      </Offcanvas>

      <div className="d-flex justify-content-end gap-2 mb-4">
        <Button variant="outline-secondary" onClick={() => nav('/reporting/weekly')}>Cancel</Button>
        <Button variant="outline-primary" disabled={saving || brandInactive} onClick={(e) => submit(e as any, 'draft')}>Save draft</Button>
        <Button variant="primary" disabled={saving || brandInactive} onClick={(e) => submit(e as any, 'submitted')}>{saving ? 'Saving…' : 'Save & view dashboard'}</Button>
      </div>

      <Modal show={showComments} onHide={() => setShowComments(false)} centered size="lg" scrollable>
        <Modal.Header closeButton><Modal.Title>Previous comments — reference</Modal.Title></Modal.Header>
        <Modal.Body>
          {priorReports.length === 0 ? (
            <p className="text-muted mb-0">No previous reports for this brand.</p>
          ) : (
            <>
              <Form.Group className="mb-3">
                <Form.Label className="small">Choose a report</Form.Label>
                <Form.Select value={selectedPriorId} onChange={e => { setSelectedPriorId(e.target.value); loadPriorComments(e.target.value); }}>
                  {priorReports.map(p => (
                    <option key={p.id} value={p.id}>Week #{p.week_number} — {formatRange(p.week_start, p.week_end)}</option>
                  ))}
                </Form.Select>
              </Form.Group>
              {loadingComments ? (
                <div className="text-center py-4"><Spinner animation="border" size="sm" /></div>
              ) : priorComments.length === 0 ? (
                <p className="text-muted text-center py-3 mb-0">No comments on this report.</p>
              ) : (
                Object.keys(SECTION_LABELS).map(section => {
                  const sc = priorComments.filter(x => x.section === section);
                  if (sc.length === 0) return null;
                  return (
                    <div key={section} className="mb-3">
                      <h6 className="text-muted">{SECTION_LABELS[section]}</h6>
                      {sc.map(cm => (
                        <div key={cm.id} className="p-2 mb-2 rounded small" style={{ background: '#f8fafc', border: '1px solid #e5e7eb' }}>
                          <div className="d-flex align-items-center gap-2 mb-1">
                            <strong>{cm.author_name}</strong>
                            <Badge bg={cm.author_type === 'client' ? 'info' : cm.author_type === 'bob' ? 'warning' : 'success'} text={cm.author_type === 'bob' ? 'dark' : undefined}>
                              {cm.author_type === 'client' ? 'Client' : cm.author_type === 'bob' ? 'Bob' : 'APC'}
                            </Badge>
                            <span className="text-muted">{new Date(cm.created_at).toLocaleDateString()}</span>
                            <Button size="sm" variant="outline-primary" className="ms-auto py-0 px-2" style={{ fontSize: '.75rem' }}
                              onClick={() => pullInComment(cm)} title="Copy this comment into the current report for reference">
                              <i className="bi bi-pin-angle me-1" /> Pull into this report
                            </Button>
                          </div>
                          <div style={{ whiteSpace: 'pre-wrap' }}>{cm.body}</div>
                        </div>
                      ))}
                    </div>
                  );
                })
              )}
            </>
          )}
        </Modal.Body>
        <Modal.Footer><Button variant="secondary" onClick={() => setShowComments(false)}>Close</Button></Modal.Footer>
      </Modal>
    </div>
  );
}
