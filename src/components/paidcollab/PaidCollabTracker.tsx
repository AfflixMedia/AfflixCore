import { useEffect, useMemo, useState, FormEvent } from 'react';
import { Card, Spinner, Alert, Button, Modal, Form, Badge } from 'react-bootstrap';
import { supabase } from '../../lib/supabase';
import {
  PaidProgram, PaidCreator, PaidVideo, PaidCreatorPerformance, ProgramNote, BrandProduct,
  fmtMoney, fmtNumber, daysBetween, todayISO,
  isProgramEnded, programDisplayName, programPeriodLabel,
  buildBrandCreatorAggregate,
} from '../../lib/paidCollabSchema';
import CreatorCards from './CreatorCards';
import ProgramProgress from './ProgramProgress';
import NotesPanel from './NotesPanel';
import { CumulativeChart, MonthlyStackedChart } from './Charts';
import NumberInput from '../NumberInput';
import ProgramThreadPanel, { ProgramThreadComment } from './ProgramThreadPanel';
import { useAuth } from '../../auth/AuthContext';

interface BrandLite { id: string; name: string; payment_popup_default?: 'auto' | 'force_hide' | 'force_show'; }

interface Props {
  programId: string;
  /** Parent-level edit permission (role + brand active). Tracker further
   *  disables editing when the program is ended. */
  canEdit: boolean;
  /** Whether to show the brand name in the tracker header. Useful on the
   *  client portal where the same tracker is reached from multiple paths. */
  showBrand?: boolean;
  /** Called after the program is deleted, so the parent can navigate away. */
  onDeleted?: () => void;
  /** Called after the program is updated/ended/reopened, so list views can
   *  refresh their summaries. */
  onProgramChange?: (p: PaidProgram) => void;
}

export default function PaidCollabTracker({
  programId, canEdit, showBrand = true, onDeleted, onProgramChange,
}: Props) {
  const { profile } = useAuth();
  const [program, setProgram] = useState<PaidProgram | null>(null);
  const [brand, setBrand] = useState<BrandLite | null>(null);
  const [creators, setCreators] = useState<PaidCreator[]>([]);
  const [videos, setVideos] = useState<PaidVideo[]>([]);
  const [notes, setNotes] = useState<ProgramNote[]>([]);
  const [threads, setThreads] = useState<ProgramThreadComment[]>([]);
  const [brandProducts, setBrandProducts] = useState<BrandProduct[]>([]);
  const [programProductIds, setProgramProductIds] = useState<string[]>([]);
  // Brand-wide creator + performance data — used to aggregate a creator's
  // GMV / items across every program they appear in for THIS brand.
  const [brandCreatorsAll, setBrandCreatorsAll] = useState<PaidCreator[]>([]);
  const [brandPerf, setBrandPerf] = useState<PaidCreatorPerformance[]>([]);
  /** Every program in this brand (id → display name) — for the Program column
   *  on the per-creator performance modal when entries span multiple programs. */
  const [brandProgramsAll, setBrandProgramsAll] = useState<PaidProgram[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showMeta, setShowMeta] = useState(false);
  const [endingBusy, setEndingBusy] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true); setErr(null);
      const { data: progRow, error: pErr } = await supabase
        .from('paid_creator_programs').select('*').eq('id', programId).maybeSingle();
      if (pErr) { setErr(pErr.message); setLoading(false); return; }
      if (!progRow) { setErr('Program not found.'); setLoading(false); return; }
      const prog = progRow as PaidProgram;
      setProgram(prog);

      const [
        { data: brandRow },
        { data: cRows, error: cErr },
        { data: nRows, error: nErr },
        { data: ppRows, error: ppErr },
        { data: bpRows, error: bpErr },
        { data: tRows, error: tErr },
      ] = await Promise.all([
        supabase.from('brands').select('id,name,payment_popup_default').eq('id', prog.brand_id).maybeSingle(),
        supabase.from('paid_creators').select('*').eq('program_id', prog.id).order('sort_order'),
        supabase.from('paid_program_notes').select('*').eq('program_id', prog.id).order('created_at', { ascending: false }),
        supabase.from('paid_program_products').select('product_id').eq('program_id', prog.id),
        supabase.from('brand_products').select('*').eq('brand_id', prog.brand_id).order('name'),
        supabase.from('paid_program_threads').select('*').eq('program_id', prog.id).order('created_at', { ascending: true }),
      ]);
      if (cErr || nErr || ppErr || bpErr || tErr) {
        setErr((cErr ?? nErr ?? ppErr ?? bpErr ?? tErr)!.message);
        setLoading(false);
        return;
      }
      setBrand((brandRow as BrandLite) ?? null);
      const creatorsArr = (cRows as PaidCreator[]) ?? [];
      setCreators(creatorsArr);
      setNotes((nRows as ProgramNote[]) ?? []);
      setThreads((tRows as ProgramThreadComment[]) ?? []);
      setProgramProductIds(((ppRows ?? []) as { product_id: string }[]).map(r => r.product_id));
      setBrandProducts((bpRows as BrandProduct[]) ?? []);
      if (creatorsArr.length > 0) {
        const ids = creatorsArr.map(c => c.id);
        const { data: vRows, error: vErr } = await supabase
          .from('paid_creator_videos').select('*').in('creator_id', ids);
        if (vErr) { setErr(vErr.message); setLoading(false); return; }
        setVideos((vRows as PaidVideo[]) ?? []);
      } else {
        setVideos([]);
      }
      await loadBrandAgg(prog.brand_id);
      setLoading(false);
    })();
  }, [programId]);

  // Brand-wide aggregate loader — pulls every creator in this brand (across
  // all of the brand's programs) and their performance rows. Used to sum a
  // creator's GMV across programs when the same person (same handle/name)
  // appears in more than one program for the same brand.
  const loadBrandAgg = async (brandId: string) => {
    const { data: progRows } = await supabase
      .from('paid_creator_programs').select('*').eq('brand_id', brandId);
    const progs = ((progRows ?? []) as PaidProgram[]);
    setBrandProgramsAll(progs);
    const progIds = progs.map(p => p.id);
    if (progIds.length === 0) { setBrandCreatorsAll([]); setBrandPerf([]); return; }
    const { data: brandCs } = await supabase
      .from('paid_creators').select('*').in('program_id', progIds);
    const cs = (brandCs ?? []) as PaidCreator[];
    setBrandCreatorsAll(cs);
    if (cs.length === 0) { setBrandPerf([]); return; }
    const { data: perfRows } = await supabase
      .from('paid_creator_performance').select('*')
      .in('creator_id', cs.map(c => c.id));
    setBrandPerf(((perfRows ?? []) as any[]).map(r => ({
      ...r,
      gmv: Number(r.gmv ?? 0),
      items_sold: Number(r.items_sold ?? 0),
      period_start: typeof r.period_start === 'string' ? r.period_start.slice(0, 10) : r.period_start,
    })) as PaidCreatorPerformance[]);
  };

  // Map creator_id → program label, for the cross-program performance view.
  const programLabelByCreatorId = useMemo(() => {
    const byProgId = new Map<string, string>();
    for (const p of brandProgramsAll) byProgId.set(p.id, programDisplayName(p));
    const m = new Map<string, string>();
    for (const c of brandCreatorsAll) {
      const label = byProgId.get(c.program_id);
      if (label) m.set(c.id, label);
    }
    return m;
  }, [brandProgramsAll, brandCreatorsAll]);

  const brandAgg = useMemo(
    () => buildBrandCreatorAggregate(brandCreatorsAll, brandPerf),
    [brandCreatorsAll, brandPerf],
  );

  // Re-fetch brand aggregate after performance edits (PerformanceModal close,
  // creator add/edit/delete) so cross-program sums stay current.
  const reloadBrandAgg = () => {
    if (program) loadBrandAgg(program.brand_id);
  };

  const programProducts = useMemo(
    () => brandProducts.filter(bp => programProductIds.includes(bp.id)),
    [brandProducts, programProductIds],
  );

  const kpis = useMemo(() => {
    // Every video is live; pipeline = agreed videos not yet delivered.
    const countByCreator = new Map<string, number>();
    videos.forEach(v => countByCreator.set(v.creator_id, (countByCreator.get(v.creator_id) ?? 0) + 1));
    const pipeline = creators
      .filter(c => c.status !== 'dropped')
      .reduce((s, c) => s + Math.max(0, (c.agreed_videos || 0) - (countByCreator.get(c.id) ?? 0)), 0);
    const spent = creators.reduce((s, c) => s + Number(c.fee || 0), 0);
    const days = program?.launch_date ? daysBetween(program.launch_date, program?.ended_at?.slice(0, 10) ?? todayISO()) : 0;
    return {
      creators: creators.length,
      pipeline,
      live: videos.length,
      days,
      spent,
    };
  }, [creators, videos, program]);

  const ended = !!program && isProgramEnded(program);
  // Editing is disabled when the program is ended — regardless of role.
  const canMutate = canEdit && !ended;

  const endProgram = async () => {
    if (!program) return;
    if (!confirm('End this program? Once ended, no creators, videos, or details can be added or edited. You can reopen it later.')) return;
    setEndingBusy(true);
    const { data, error } = await supabase.from('paid_creator_programs')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', program.id)
      .select('*').single();
    setEndingBusy(false);
    if (error) { alert(error.message); return; }
    const updated = data as PaidProgram;
    setProgram(updated);
    onProgramChange?.(updated);
  };

  const reopenProgram = async () => {
    if (!program) return;
    if (!confirm('Reopen this program? You\'ll be able to add more creators and videos.')) return;
    setEndingBusy(true);
    const { data, error } = await supabase.from('paid_creator_programs')
      .update({ ended_at: null })
      .eq('id', program.id)
      .select('*').single();
    setEndingBusy(false);
    if (error) { alert(error.message); return; }
    const updated = data as PaidProgram;
    setProgram(updated);
    onProgramChange?.(updated);
  };

  const deleteProgram = async () => {
    if (!program) return;
    if (!confirm('Delete this program permanently? All creators, videos, and notes will be removed.')) return;
    const { error } = await supabase.from('paid_creator_programs').delete().eq('id', program.id);
    if (error) { alert(error.message); return; }
    onDeleted?.();
  };

  if (loading) return <div className="text-center py-5"><Spinner animation="border" /></div>;
  if (err) return <Alert variant="danger">{err}</Alert>;
  if (!program) return null;

  const c = program.currency || 'USD';
  const budgetUsedPct = program.total_budget > 0
    ? Math.min(100, Math.round((kpis.spent / Number(program.total_budget)) * 100))
    : 0;

  return (
    <div className="d-flex flex-column gap-3">
      {/* Program header */}
      <Card>
        <Card.Body>
          <div className="d-flex flex-wrap align-items-start gap-3 mb-3">
            <div className="flex-grow-1 min-w-0">
              {showBrand && brand && (
                <div className="text-muted small">{brand.name}</div>
              )}
              <h4 className="mb-1 d-flex align-items-center gap-2 flex-wrap">
                <i className="bi bi-rocket-takeoff text-primary" />
                {programDisplayName(program)}
                {ended
                  ? <Badge bg="secondary"><i className="bi bi-flag-fill me-1" />Ended</Badge>
                  : <Badge bg="success"><i className="bi bi-broadcast me-1" />Active</Badge>}
              </h4>
              <div className="text-muted small">
                <i className="bi bi-calendar-range me-1" />{programPeriodLabel(program)}
                <span className="mx-2">·</span>
                {kpis.days} day{kpis.days === 1 ? '' : 's'}
              </div>
            </div>
            {canEdit && (
              <div className="d-flex gap-2 flex-wrap">
                {!ended && (
                  <Button size="sm" variant="outline-secondary" onClick={() => setShowMeta(true)} disabled={endingBusy}>
                    <i className="bi bi-pencil me-1" /> Edit program
                  </Button>
                )}
                {!ended ? (
                  <Button size="sm" variant="outline-warning" onClick={endProgram} disabled={endingBusy}>
                    <i className="bi bi-flag me-1" /> End program
                  </Button>
                ) : (
                  <Button size="sm" variant="outline-success" onClick={reopenProgram} disabled={endingBusy}>
                    <i className="bi bi-arrow-counterclockwise me-1" /> Reopen
                  </Button>
                )}
                <Button size="sm" variant="outline-danger" onClick={deleteProgram} disabled={endingBusy} title="Delete program">
                  <i className="bi bi-trash" />
                </Button>
              </div>
            )}
          </div>

          {ended && (
            <Alert variant="secondary" className="d-flex align-items-center gap-2 mb-3">
              <i className="bi bi-lock-fill" />
              <div>
                <strong>This program is ended.</strong>{' '}
                All data is read-only — reopen the program to make further changes.
              </div>
            </Alert>
          )}

          <div className="d-flex flex-wrap align-items-center gap-3 mt-2">
            <div>
              <div className="text-muted small">Program launched</div>
              <div className="fw-semibold">
                {program.launch_date
                  ? new Date(program.launch_date + 'T00:00:00').toLocaleDateString()
                  : '—'}
              </div>
            </div>
            <div className="vr d-none d-md-block" />
            <div style={{ minWidth: 220 }}>
              <div className="text-muted small">Budget</div>
              <div className="fw-semibold">
                {fmtMoney(kpis.spent, c)} <span className="text-muted">/ {fmtMoney(Number(program.total_budget), c)}</span>
              </div>
              {program.total_budget > 0 && (
                <div className="progress mt-1" style={{ height: 6 }}>
                  <div
                    className="progress-bar"
                    style={{
                      width: `${budgetUsedPct}%`,
                      backgroundColor: budgetUsedPct > 100 ? '#dc3545' : '#e8862e',
                    }}
                  />
                </div>
              )}
            </div>
            {program.notes && (
              <>
                <div className="vr d-none d-md-block" />
                <div className="flex-grow-1 min-w-0">
                  <div className="text-muted small">Notes</div>
                  <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{program.notes}</div>
                </div>
              </>
            )}
          </div>
        </Card.Body>
      </Card>

      {/* KPI tiles */}
      <div className="row g-2">
        <KpiTile icon="bi-people-fill" color="#0d6efd" label="Creators" value={fmtNumber(kpis.creators)} />
        <KpiTile icon="bi-hourglass-split" color="#fd7e14" label="Videos in pipeline" value={fmtNumber(kpis.pipeline)} />
        <KpiTile icon="bi-broadcast" color="#198754" label="Live videos" value={fmtNumber(kpis.live)} />
        <KpiTile icon="bi-cash-stack" color="#6610f2" label="Spent on fees" value={fmtMoney(kpis.spent, c)} />
        <KpiTile icon="bi-calendar-event" color="#e8862e" label={ended ? 'Days ran' : 'Days running'} value={fmtNumber(kpis.days)} />
      </div>

      {/* Charts */}
      <div className="row g-3">
        <div className="col-lg-7">
          <CumulativeChart videos={videos} notes={notes} launchDate={program.launch_date} />
        </div>
        <div className="col-lg-5">
          <MonthlyStackedChart videos={videos} />
        </div>
      </div>

      {/* Program performance — videos + weekly/monthly GMV */}
      {creators.length > 0 && (
        <ProgramProgress creators={creators} videos={videos} currency={c} brandAgg={brandAgg} />
      )}

      {/* Creators + Notes split */}
      <div className="row g-3">
        <div className="col-xl-8">
          <CreatorCards
            programId={program.id}
            program={program}
            brand={brand}
            currency={c}
            launchDate={program.launch_date}
            creators={creators}
            videos={videos}
            programProducts={programProducts}
            canEdit={canMutate}
            onCreatorsChange={(next) => { setCreators(next); reloadBrandAgg(); }}
            onVideosChange={setVideos}
            onEditProgram={() => setShowMeta(true)}
            threads={threads}
            onThreadsChange={setThreads}
            staffName={profile?.full_name || profile?.email || 'Staff'}
            brandAgg={brandAgg}
            programLabelByCreatorId={programLabelByCreatorId}
            onPerfChanged={reloadBrandAgg}
          />
        </div>
        <div className="col-xl-4">
          <NotesPanel programId={program.id} notes={notes} canEdit={canMutate} onChange={setNotes} />
        </div>
      </div>

      {/* Program-level conversation thread (creator-specific messages live
          inside each creator's Videos modal). */}
      <ProgramThreadPanel
        comments={threads.filter(t => !t.creator_id)}
        mode="staff"
        currentAuthorName={profile?.full_name || profile?.email || 'Staff'}
        canPost={canMutate}
        onAdd={async (body, name, parentId) => {
          const { data, error } = await supabase.from('paid_program_threads').insert({
            program_id: program.id,
            author_type: 'staff',
            author_name: name,
            body,
            parent_id: parentId ?? null,
          }).select('*').single();
          if (error) throw error;
          setThreads(prev => [...prev, data as ProgramThreadComment]);
        }}
      />

      {program && (
        <ProgramMetaModal
          show={showMeta}
          program={program}
          brandProducts={brandProducts}
          programProductIds={programProductIds}
          onClose={() => setShowMeta(false)}
          onSaved={(updated, nextBrandProducts, nextProductIds) => {
            setProgram(updated);
            setBrandProducts(nextBrandProducts);
            setProgramProductIds(nextProductIds);
            setShowMeta(false);
            onProgramChange?.(updated);
          }}
        />
      )}
    </div>
  );
}

// =====================================================================
// Small KPI tile
// =====================================================================

function KpiTile({ icon, color, label, value }: { icon: string; color: string; label: string; value: string }) {
  return (
    <div className="col-6 col-md-4 col-xl-2">
      <Card className="h-100">
        <Card.Body className="d-flex align-items-center gap-2 py-3">
          <div
            className="d-flex align-items-center justify-content-center rounded text-white flex-shrink-0"
            style={{ width: 40, height: 40, backgroundColor: color }}
          >
            <i className={`bi ${icon}`} />
          </div>
          <div className="min-w-0">
            <div className="text-muted small text-truncate">{label}</div>
            <div className="fw-bold" style={{ fontSize: '1.1rem' }}>{value}</div>
          </div>
        </Card.Body>
      </Card>
    </div>
  );
}

// =====================================================================
// Edit program modal — name / launch date / budget / currency / notes
// PLUS attached products.
// =====================================================================

interface MetaModalProps {
  show: boolean;
  program: PaidProgram;
  brandProducts: BrandProduct[];
  programProductIds: string[];
  onClose: () => void;
  onSaved: (p: PaidProgram, nextBrandProducts: BrandProduct[], nextProductIds: string[]) => void;
}

const blankInlineProduct = () => ({
  name: '', external_product_id: '', tiktok_link: '',
});

function ProgramMetaModal({
  show, program, brandProducts, programProductIds, onClose, onSaved,
}: MetaModalProps) {
  const [form, setForm] = useState({
    name: program.name ?? '',
    launch_date: program.launch_date ?? todayISO(),
    total_budget: Number(program.total_budget) || 0,
    currency: program.currency || 'USD',
    notes: program.notes ?? '',
  });
  const [localProducts, setLocalProducts] = useState<BrandProduct[]>(brandProducts);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(programProductIds));

  const [addingProduct, setAddingProduct] = useState(false);
  const [newProduct, setNewProduct] = useState(blankInlineProduct());
  const [addBusy, setAddBusy] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!show) return;
    setForm({
      name: program.name ?? '',
      launch_date: program.launch_date ?? todayISO(),
      total_budget: Number(program.total_budget) || 0,
      currency: program.currency || 'USD',
      notes: program.notes ?? '',
    });
    setLocalProducts(brandProducts);
    setSelectedIds(new Set(programProductIds));
    setAddingProduct(false);
    setNewProduct(blankInlineProduct());
    setErr(null);
    setAddErr(null);
  }, [show, program, brandProducts, programProductIds]);

  const toggleProduct = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const submitInlineProduct = async () => {
    setAddBusy(true); setAddErr(null);
    try {
      const payload = {
        brand_id: program.brand_id,
        name: newProduct.name.trim(),
        external_product_id: newProduct.external_product_id.trim() || null,
        tiktok_link: newProduct.tiktok_link.trim() || null,
      };
      const { data, error } = await supabase.from('brand_products').insert(payload).select('*').single();
      if (error) throw error;
      const created = data as BrandProduct;
      setLocalProducts(prev => [created, ...prev]);
      setSelectedIds(prev => new Set(prev).add(created.id));
      setAddingProduct(false);
      setNewProduct(blankInlineProduct());
    } catch (e: any) {
      setAddErr(e?.message ?? 'Failed to add product');
    } finally {
      setAddBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const { data: updated, error: updateErr } = await supabase.from('paid_creator_programs')
        .update({
          name: form.name.trim() || null,
          launch_date: form.launch_date || null,
          total_budget: Number(form.total_budget) || 0,
          currency: form.currency.trim() || 'USD',
          notes: form.notes.trim() || null,
        })
        .eq('id', program.id)
        .select('*').single();
      if (updateErr) throw updateErr;

      const currentIds = new Set(programProductIds);
      const targetIds = selectedIds;
      const toInsert = [...targetIds].filter(id => !currentIds.has(id));
      const toDelete = [...currentIds].filter(id => !targetIds.has(id));
      if (toInsert.length > 0) {
        const rows = toInsert.map(product_id => ({ program_id: program.id, product_id }));
        const { error: insErr } = await supabase.from('paid_program_products').insert(rows);
        if (insErr) throw insErr;
      }
      if (toDelete.length > 0) {
        const { error: delErr } = await supabase.from('paid_program_products')
          .delete()
          .eq('program_id', program.id)
          .in('product_id', toDelete);
        if (delErr) throw delErr;
      }

      onSaved(updated as PaidProgram, localProducts, [...targetIds]);
    } catch (e: any) {
      setErr(e?.message ?? 'Failed to save');
    } finally {
      setBusy(false);
    }
  };

  const sortedProducts = useMemo(
    () => [...localProducts].sort((a, b) => a.name.localeCompare(b.name)),
    [localProducts],
  );

  return (
    <Modal show={show} onHide={onClose} centered size="lg" scrollable>
      <Form onSubmit={submit}>
        <Modal.Header closeButton>
          <Modal.Title>Program details</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {err && <Alert variant="danger">{err}</Alert>}
          <div className="row g-2">
            <Form.Group className="col-12 mb-2">
              <Form.Label className="small fw-semibold">Program name *</Form.Label>
              <Form.Control
                required
                value={form.name}
                placeholder="e.g. Summer 2026 Launch"
                onChange={e => setForm({ ...form, name: e.target.value })}
              />
            </Form.Group>
            <Form.Group className="col-md-6 mb-2">
              <Form.Label className="small fw-semibold">Launch date</Form.Label>
              <Form.Control type="date" value={form.launch_date}
                onChange={e => setForm({ ...form, launch_date: e.target.value })} />
            </Form.Group>
            <Form.Group className="col-md-6 mb-2">
              <Form.Label className="small fw-semibold">Currency</Form.Label>
              <Form.Control value={form.currency} maxLength={4}
                onChange={e => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
            </Form.Group>
            <Form.Group className="col-12 mb-2">
              <Form.Label className="small fw-semibold">Total budget ({form.currency})</Form.Label>
              <NumberInput min={0} step="any"
                value={form.total_budget}
                onChange={n => setForm({ ...form, total_budget: n })} />
            </Form.Group>
            <Form.Group className="col-12 mb-2">
              <Form.Label className="small fw-semibold">Notes</Form.Label>
              <Form.Control as="textarea" rows={3} value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })} />
            </Form.Group>
          </div>

          {/* Products section */}
          <div className="mt-4">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div>
                <div className="fw-semibold">Products for this program</div>
                <div className="small text-muted">
                  Pick which brand products this program promotes. Videos must reference one of these.
                </div>
              </div>
              {!addingProduct && (
                <Button size="sm" variant="outline-primary" onClick={() => setAddingProduct(true)}>
                  <i className="bi bi-plus-lg me-1" /> Add product
                </Button>
              )}
            </div>

            {addingProduct && (
              <div className="border rounded p-3 mb-3" style={{ backgroundColor: '#f8f9fa' }}>
                {addErr && <Alert variant="danger" className="py-2">{addErr}</Alert>}
                <div className="row g-2">
                  <Form.Group className="col-md-6">
                    <Form.Label className="small fw-semibold">Name *</Form.Label>
                    <Form.Control
                      value={newProduct.name}
                      placeholder="e.g. Garbage Puck — 4 pack"
                      onChange={e => setNewProduct({ ...newProduct, name: e.target.value })}
                    />
                  </Form.Group>
                  <Form.Group className="col-md-6">
                    <Form.Label className="small fw-semibold">Product ID</Form.Label>
                    <Form.Control
                      value={newProduct.external_product_id}
                      placeholder="e.g. 1729401883758137709"
                      style={{ fontFamily: 'monospace' }}
                      onChange={e => setNewProduct({ ...newProduct, external_product_id: e.target.value })}
                    />
                  </Form.Group>
                  <Form.Group className="col-12">
                    <Form.Label className="small fw-semibold">TikTok link</Form.Label>
                    <Form.Control
                      type="url"
                      value={newProduct.tiktok_link}
                      placeholder="https://www.tiktok.com/@brand/product/…"
                      onChange={e => setNewProduct({ ...newProduct, tiktok_link: e.target.value })}
                    />
                  </Form.Group>
                </div>
                <div className="d-flex justify-content-end gap-2 mt-2">
                  <Button size="sm" variant="secondary" onClick={() => { setAddingProduct(false); setNewProduct(blankInlineProduct()); }} disabled={addBusy}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="primary" type="button" onClick={submitInlineProduct}
                          disabled={addBusy || !newProduct.name.trim()}>
                    {addBusy ? 'Adding…' : 'Add to catalog'}
                  </Button>
                </div>
              </div>
            )}

            {sortedProducts.length === 0 ? (
              <Alert variant="info" className="py-2 small mb-0">
                No products in this brand's catalog yet. Add one above — it'll be available to all programs for this brand.
              </Alert>
            ) : (
              <div className="border rounded" style={{ maxHeight: 280, overflowY: 'auto' }}>
                {sortedProducts.map(p => {
                  const checked = selectedIds.has(p.id);
                  return (
                    <label
                      key={p.id}
                      className="d-flex align-items-center gap-3 p-2 border-bottom"
                      style={{ cursor: 'pointer' }}
                    >
                      <Form.Check
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleProduct(p.id)}
                        className="m-0"
                      />
                      <div className="flex-grow-1 min-w-0">
                        <div className="fw-semibold">{p.name}</div>
                        <div className="small text-muted d-flex flex-wrap gap-2">
                          {p.external_product_id && <span style={{ fontFamily: 'monospace' }}>{p.external_product_id}</span>}
                          {p.tiktok_link && (
                            <a href={p.tiktok_link} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>
                              <i className="bi bi-tiktok me-1" />Link
                            </a>
                          )}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" disabled={busy || !form.name.trim()}>{busy ? 'Saving…' : 'Save'}</Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
