import { supabase } from '../../lib/supabase';

/* ════════════════════════════════════════════════════════════
   Data-access layer for the Handler Collab workspace.
   Brands come from public.brands (paid-collab scope, assigned via
   paid_collab_handler_brands). Months/creators live in handler_collab_brand_months /
   handler_collab_creators, keyed by public.brands.id (RLS: handler/bob write,
   bob/apc/client/handler read via user_has_brand_access).
════════════════════════════════════════════════════════════ */

// follow_up = "in progress" with no new posted video for 1 week (new creators
// start in progress with a fresh 7-day window, even at zero videos; auto-managed
// by the handler_collab_creators_auto_status trigger + the
// handler_collab_apply_follow_ups() sweep — migrations 20260806090000 + 20260820090000).
export type PaymentStatus = 'videos_in_progress' | 'follow_up' | 'pending' | 'paid';

export interface VideoCode {
  video: string;
  adCode: string;
  auth?: boolean;
}

export interface Product {
  name: string;
  url: string;
}

export interface MonthlyEntry {
  gmv?: number;
  adSpent?: number;
  l30?: number;
}

export interface HandlerBrand {
  id: string;     // public.brands.id (brands are no longer a separate list)
  name: string;
  client: string;
  currency?: string | null;  // region currency (USD/GBP/EUR) — money symbol
  region?: string | null;
}

export interface HandlerBrandMonth {
  id: string;
  brand_id: string;
  month: string;
  budget: number;
  content_guide_url: string;
  focus_product_url: string;
  notes: string;
}

export interface HandlerCreator {
  id: string;
  brand_id: string;
  name: string;
  tiktok_handle: string;
  amount: number;
  videos_count: number;
  zelle: string;
  paypal: string;
  phone: string;
  email: string;
  category: string;
  payment_status: PaymentStatus;
  // When payment_status === 'pending', clients/Bob only see the "Payment Pending"
  // label once the handler flips this on (see handlerCollabReadonly.clientStatus).
  pending_visible_to_client: boolean;
  // Set when the share-link client marks this creator's payment as done (PayPal).
  // Soft flag only — the handler finalizes payment_status. Null = not confirmed.
  client_paid_confirmed_at?: string | null;
  client_paid_confirmed_name?: string | null;
  onboarded_on: string | null;
  completed_on: string | null;
  // Link to the signed contract (e.g. Google Drive), pasted by the handler
  // after the creator returns the signed agreement PDF.
  contract_url?: string | null;
  // Contract §2: days to complete the deliverables after sample delivery.
  // Null = automatic (10 for <6 videos, 14 otherwise).
  deliverable_days?: number | null;
  // Last time the posted-video count increased (drives the 1-week follow-up rule).
  video_count_updated_at?: string | null;
  video_codes: VideoCode[];
  products: Product[];
  monthly: Record<string, MonthlyEntry>;
  created_at: string;
}

export async function getClients() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .eq('role', 'paid_collab_client')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(d => ({
    id: d.id,
    name: d.full_name || 'Unknown Client',
    email: d.email || ''
  }));
}

// Server-side status sweep: stalled "Videos in Progress" creators (no new video
// for 1 week) → follow_up; all-videos-posted rows → pending. Best-effort — a
// failure (e.g. migration not applied yet) must never block the workspace.
export async function applyFollowUps(): Promise<void> {
  try { await supabase.rpc('handler_collab_apply_follow_ups'); } catch { /* ignore */ }
}

/* ── activity log (Logs tab) ──
   Brand-scoped audit rows written by the handler_collab_creators_log trigger
   (migration 20260821090000): payment-status changes (who + old → new, incl.
   the automatic sweep), client "marked payment as done", creator add/remove.
   RLS: Bob + every handler assigned to the brand + internal staff with brand
   access — so co-handlers of a shared brand see each other's changes. */
export type ActivityAction =
  | 'creator_added' | 'status_change'
  | 'client_paid_marked' | 'client_paid_unmarked' | 'creator_removed';
export interface ActivityLog {
  id: string;
  brand_id: string;
  creator_id: string | null;
  creator_name: string;
  month: string | null;          // creator's onboarded month at log time
  action: ActivityAction;
  old_status: string | null;
  new_status: string | null;
  auto: boolean;                 // true = automatic status sweep, not a person
  actor_id: string | null;
  actor_name: string;
  created_at: string;
}

export async function loadActivityLogs(brandIds: string[], limit = 500): Promise<ActivityLog[]> {
  if (!brandIds.length) return [];
  const { data, error } = await supabase
    .from('handler_collab_activity_log')
    .select('*')
    .in('brand_id', brandIds)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []) as ActivityLog[];
}

export async function loadAll() {
  // Apply the follow-up status rules before reading, so the lists show them fresh.
  await applyFollowUps();
  // Brands come from public.brands, RLS-scoped to those assigned to the handler
  // (via paid_collab_handler_brands) — no paid_creator scope requirement.
  const { data: bRows, error: bErr } = await supabase
    .from('brands').select('id,name,client,currency,region').order('name');
  if (bErr) throw bErr;
  const brands = (bRows || []) as HandlerBrand[];
  const ids = brands.map(b => b.id);
  if (ids.length === 0) return { brands, brandMonths: [] as HandlerBrandMonth[], creators: [] as HandlerCreator[] };
  const [bm, c] = await Promise.all([
    supabase.from('handler_collab_brand_months').select('*').in('brand_id', ids),
    supabase.from('handler_collab_creators').select('*').in('brand_id', ids),
  ]);
  if (bm.error) throw bm.error;
  if (c.error) throw c.error;
  return {
    brands,
    brandMonths: (bm.data || []) as HandlerBrandMonth[],
    creators: (c.data || []) as HandlerCreator[],
  };
}

// Brands are managed in public.brands by Bob (with the "Paid Collabs" scope) and
// assigned to handlers via paid_collab_handler_brands — handlers no longer create them.

/* ── brand weekly-report dates ──
   Weekly Performance columns are EXACTLY the weeks that exist in the brand's
   weekly_reports — each report's start/end date becomes one column. Read-only;
   RLS scopes this to the handler's assigned brands. Returns
   brand_id -> [{ start, end }] sorted ascending by start; brands with no weekly
   reports are omitted. */
export interface ReportWeek { start: string; end: string }
export async function loadBrandReportWeeks(brandIds: string[]): Promise<Record<string, ReportWeek[]>> {
  if (!brandIds.length) return {};
  const { data, error } = await supabase
    .from('weekly_reports')
    .select('brand_id, week_start, week_end')
    .in('brand_id', brandIds)
    .order('week_start', { ascending: true });
  if (error) throw error;
  const m: Record<string, ReportWeek[]> = {};
  (data || []).forEach((r: any) => {
    (m[r.brand_id] = m[r.brand_id] || []).push({ start: r.week_start, end: r.week_end });
  });
  return m;
}

// Per-brand weekly anchor (brand_report_settings.weekly_anchor) — week-1 start date
// that fixes the weekly cadence. Shared with the APC/Bob weekly-report flow.
export async function loadBrandReportAnchors(brandIds: string[]): Promise<Record<string, string>> {
  if (!brandIds.length) return {};
  const { data, error } = await supabase
    .from('brand_report_settings')
    .select('brand_id, weekly_anchor')
    .in('brand_id', brandIds);
  if (error) throw error;
  const m: Record<string, string> = {};
  (data || []).forEach((r: any) => { if (r.weekly_anchor) m[r.brand_id] = r.weekly_anchor; });
  return m;
}

export async function setBrandWeeklyAnchor(brandId: string, anchor: string) {
  const { error } = await supabase
    .from('brand_report_settings')
    .upsert({ brand_id: brandId, weekly_anchor: anchor }, { onConflict: 'brand_id' });
  if (error) throw error;
}

// Create a draft weekly report (same shape the APC/Bob flow inserts). The caller
// computes the next week_start/week_end/week_number from the brand's anchor +
// existing reports. Returns the inserted row's id + dates.
export async function createWeeklyReport(
  brandId: string, userId: string, weekStart: string, weekEnd: string, weekNumber: number,
): Promise<{ id: string; start: string; end: string }> {
  const { data, error } = await supabase
    .from('weekly_reports')
    .insert({
      brand_id: brandId,
      created_by: userId,
      week_start: weekStart,
      week_end: weekEnd,
      week_number: weekNumber,
      status: 'draft',
    })
    .select('id, week_start, week_end')
    .single();
  if (error) throw error;
  return { id: (data as any).id, start: (data as any).week_start, end: (data as any).week_end };
}

/* ── brand-month (budget + links) ── */
export async function upsertBrandMonth(brandId: string, month: string, patch: Partial<HandlerBrandMonth>) {
  const fields: Record<string, any> = {
    budget: patch.budget != null ? Number(patch.budget) || 0 : undefined,
    content_guide_url: patch.content_guide_url,
    focus_product_url: patch.focus_product_url,
    notes: patch.notes,
  };
  Object.keys(fields).forEach(k => fields[k] === undefined && delete fields[k]);
  const { data, error } = await supabase
    .from('handler_collab_brand_months')
    .upsert({ brand_id: brandId, month, ...fields }, { onConflict: 'brand_id,month' })
    .select()
    .single();
  if (error) throw error;
  return data as HandlerBrandMonth;
}

/* ── creators / deals ── */
export async function addCreator(data: Record<string, any>) {
  const payload = {
    brand_id: data.brand_id,
    name: (data.name || '').trim(),
    tiktok_handle: data.tiktok_handle || '',
    amount: Number(data.amount) || 0,
    videos_count: parseInt(data.videos_count, 10) || 0,
    zelle: data.zelle || '',
    paypal: data.paypal || '',
    phone: data.phone || '',
    email: data.email || '',
    category: data.category || '',
    payment_status: data.payment_status || 'videos_in_progress',
    onboarded_on: data.onboarded_on || null,
    contract_url: (data.contract_url || '').trim(),
    // Contract §2 completion window; null = automatic (see contractPdf.ts).
    deliverable_days: data.deliverable_days ? parseInt(data.deliverable_days, 10) || null : null,
    video_codes: Array.isArray(data.video_codes) ? data.video_codes : [],
    monthly: data.monthly && typeof data.monthly === 'object' ? data.monthly : {},
    products: Array.isArray(data.products) ? data.products : [],
  };
  if (!payload.name) throw new Error('Name required');
  const { data: row, error } = await supabase.from('handler_collab_creators').insert(payload).select().single();
  if (error) throw error;
  return row as HandlerCreator;
}

export async function updateCreator(id: string, patch: Record<string, any>) {
  const { error } = await supabase.from('handler_collab_creators').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteCreator(id: string) {
  const { error } = await supabase.from('handler_collab_creators').delete().eq('id', id);
  if (error) throw error;
}

/* ── creator contract signing links (migration 20260822090000) ──
   One shareable link per creator deal. The handler generates it from the
   Contract column; the creator opens /sign/<token>, reads the very PDF snapshot
   stored in `payload`, and signs once (frozen server-side afterwards). The
   handler can deactivate/reactivate the link and is notified on signature. */
export interface ContractSignLink {
  id: string;
  creator_id: string;
  brand_id: string;
  token: string;
  active: boolean;
  payload: Record<string, any>;
  created_at: string;
  signed_at: string | null;
  signer_name: string | null;
  signer_signature: string | null;
}

function newContractToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// All signing links for the given brands (RLS scopes to brands the caller can
// see). Signature blobs are skipped here — the list only needs the state.
export async function loadContractLinks(brandIds: string[]): Promise<ContractSignLink[]> {
  if (!brandIds.length) return [];
  const { data, error } = await supabase
    .from('handler_contract_signatures')
    .select('id, creator_id, brand_id, token, active, created_at, signed_at, signer_name')
    .in('brand_id', brandIds);
  if (error) throw error;
  return (data || []) as ContractSignLink[];
}

export async function getContractLink(creatorId: string): Promise<ContractSignLink | null> {
  const { data, error } = await supabase
    .from('handler_contract_signatures')
    .select('*')
    .eq('creator_id', creatorId)
    .maybeSingle();
  if (error) throw error;
  return (data as ContractSignLink) || null;
}

// Create the link (auto-generated token) or, when one already exists, refresh
// the snapshot the creator will sign. A SIGNED link is never touched — the
// signed copy must stay exactly what was signed.
export async function upsertContractLink(
  creatorId: string,
  brandId: string,
  payload: Record<string, any>,
): Promise<ContractSignLink> {
  const existing = await getContractLink(creatorId);
  if (existing) {
    if (existing.signed_at) return existing;
    const { data, error } = await supabase
      .from('handler_contract_signatures')
      .update({ payload })
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data as ContractSignLink;
  }
  const { data: u } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('handler_contract_signatures')
    .insert({
      creator_id: creatorId,
      brand_id: brandId,
      token: newContractToken(),
      payload,
      created_by: u?.user?.id ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as ContractSignLink;
}

export async function setContractLinkActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase
    .from('handler_contract_signatures')
    .update({ active })
    .eq('id', id);
  if (error) throw error;
}

/* ── contract template (signature block) settings — one row per handler ── */
export interface ContractSettings {
  rep_name: string;
  signature_url: string;
}

export async function getContractSettings(): Promise<ContractSettings | null> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u?.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from('handler_contract_settings')
    .select('rep_name, signature_url')
    .eq('owner_id', uid)
    .maybeSingle();
  if (error) throw error;
  return (data as ContractSettings) || null;
}

export async function saveContractSettings(patch: ContractSettings) {
  const { data: u } = await supabase.auth.getUser();
  const uid = u?.user?.id;
  if (!uid) throw new Error('Not signed in');
  const { error } = await supabase
    .from('handler_contract_settings')
    .upsert({ owner_id: uid, ...patch, updated_at: new Date().toISOString() });
  if (error) throw error;
}

// ── persisted brand ordering (drag-and-drop in the workspace) ──
// Returns the caller's saved brand-id order (RLS scopes to their own rows).
export async function loadBrandOrder(): Promise<string[]> {
  const { data, error } = await supabase
    .from('handler_collab_brand_order')
    .select('brand_id, position')
    .order('position', { ascending: true });
  if (error) throw error;
  return (data || []).map((r: any) => r.brand_id);
}
// Replace the caller's order with `ids` (positions = array index). Reordering keeps
// every brand, so an upsert is enough; stale rows cascade-drop with the brand.
export async function saveBrandOrder(handlerId: string, ids: string[]) {
  if (!handlerId) return;
  const rows = ids.map((id, i) => ({ handler_id: handlerId, brand_id: id, position: i }));
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('handler_collab_brand_order')
    .upsert(rows, { onConflict: 'handler_id,brand_id' });
  if (error) throw error;
}

/* ── paid-collab comments (brand / program / week / creator / insights / kpi) ── */
export type CommentTargetType = 'brand' | 'program' | 'week' | 'creator' | 'insights' | 'kpi';
export interface PaidCollabComment {
  id: string;
  brand_id: string;
  target_type: CommentTargetType;
  target_key: string;
  author_type: 'client' | 'handler' | 'bob' | 'apc';
  author_id: string | null;
  author_name: string;
  body: string;
  parent_id: string | null;
  created_at: string;
}

// Load every comment for the given brands (RLS scopes to brands the caller can see).
export async function loadComments(brandIds: string[]): Promise<PaidCollabComment[]> {
  if (!brandIds.length) return [];
  const { data, error } = await supabase
    .from('paid_collab_comments')
    .select('*')
    .in('brand_id', brandIds)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []) as PaidCollabComment[];
}

// Add a comment as the signed-in handler/staff (RLS enforces brand access).
export async function addComment(input: {
  brandId: string; targetType: CommentTargetType; targetKey: string;
  authorId: string; authorType: 'handler' | 'bob' | 'apc'; authorName: string;
  body: string; parentId?: string | null;
}): Promise<PaidCollabComment> {
  const { data, error } = await supabase.from('paid_collab_comments').insert({
    brand_id: input.brandId,
    target_type: input.targetType,
    target_key: input.targetKey || '',
    author_type: input.authorType,
    author_id: input.authorId,
    author_name: input.authorName,
    body: input.body.trim().slice(0, 4000),
    parent_id: input.parentId || null,
  }).select().single();
  if (error) throw error;
  return data as PaidCollabComment;
}

// Signed-in CLIENT "mark payment as done" on a creator deal. Soft confirmation only
// (sets client_paid_confirmed_at, NOT payment_status) + notifies the brand's handler(s).
// Clients can't UPDATE handler_collab_creators via RLS, so this goes through a
// SECURITY DEFINER RPC. Mirrors the public share fn post-shared-paidcollab-paid.
export async function setClientPaid(creatorId: string, confirmed: boolean): Promise<HandlerCreator> {
  const { data, error } = await supabase.rpc('set_client_paidcollab_paid', {
    p_creator: creatorId,
    p_confirmed: confirmed,
  });
  if (error) throw error;
  return data as HandlerCreator;
}

// Add a comment as the signed-in paid-collab CLIENT. Clients can't insert into
// paid_collab_comments via RLS (only bob/handler/apc can), so this goes through a
// SECURITY DEFINER RPC that posts as author_type='client' and notifies the brand's
// handler(s). Mirrors the public share link's post-shared-paidcollab-comment fn.
export async function addClientComment(input: {
  brandId: string; targetType: CommentTargetType; targetKey: string;
  body: string; parentId?: string | null;
}): Promise<PaidCollabComment> {
  const { data, error } = await supabase.rpc('post_client_paidcollab_comment', {
    p_brand: input.brandId,
    p_tt: input.targetType,
    p_tk: input.targetKey || '',
    p_body: input.body,
    p_parent: input.parentId || null,
  });
  if (error) throw error;
  return data as PaidCollabComment;
}

// Toggle a single video's "Authorised" flag. Uses a SECURITY DEFINER RPC so APCs /
// team leads with brand access can flip it from the read-only views without broad
// write access to the creators table (bob / handler can also call it).
export async function setCreatorVideoAuth(creatorId: string, index: number, auth: boolean) {
  const { error } = await supabase.rpc('set_handler_creator_video_auth', {
    p_creator: creatorId, p_index: index, p_auth: auth,
  });
  if (error) throw error;
}

// Update a creator's `monthly` GMV / Ad Spent / L30 map (the Performance tab). Goes
// through a SECURITY DEFINER RPC so internal staff (apc / team_lead) with brand access
// — not only bob / the assigned handler — can edit performance numbers without broad
// write access to the creators table (bob / handlers are allowed too).
export async function setCreatorMonthly(creatorId: string, monthly: Record<string, any>) {
  const { error } = await supabase.rpc('set_handler_creator_monthly', {
    p_creator: creatorId, p_monthly: monthly,
  });
  if (error) throw error;
}

/* ── Notes board (Google Keep-style) ──
   Global notes for the handler workspace (handler_notes). Owner-scoped via RLS;
   a note can optionally link to a brand (brand-wise) and/or a month (program-wise),
   carry free-form labels, and a reminder that fires an in-app/push notification. */
export interface HandlerNote {
  id: string;
  owner_id: string;
  brand_id: string | null;
  creator_id: string | null;   // optional "creator-wise" link → handler_collab_creators
  month: string | null;
  title: string;
  body: string;
  color: string;
  labels: string[];
  pinned: boolean;
  archived: boolean;
  reminder_at: string | null;
  reminder_done: boolean;
  reminder_sent_at: string | null;
  // Super Boss only: Ads Managers can read (not edit) this note (legacy — superseded
  // by handler_note_shares; the column is kept for back-compat).
  shared_with_ads: boolean;
  created_at: string;
  updated_at: string;
  // Populated ONLY by list_visible_notes() (the board/fab read path) — the owner's
  // role/name drive role-based colouring + the "shared by" chip; is_owner gates edits.
  owner_role?: string;
  owner_is_superbob?: boolean;
  owner_name?: string;
  is_owner?: boolean;
}

export type NotePatch = Partial<Omit<HandlerNote, 'id' | 'owner_id' | 'created_at' | 'updated_at'>>;

/* ── Note sharing (cross-role) ──
   A note owned by internal staff can be shared with ROLE groups; Super Boss can
   also share with EVERYONE or a specific TEAM (a Team Lead + the APCs under them).
   Recipients get read-only access (resolved by note_shared_with_caller in RLS). */
export type NoteShareRole = 'super_boss' | 'bob' | 'team_lead' | 'apc' | 'ads_manager';
export type NoteShareTarget =
  | { kind: 'all' }
  | { kind: 'role'; role: NoteShareRole }
  | { kind: 'team'; team: string };

export interface NoteLabel { id: string; name: string; color: string | null; owner_id: string; }

/* A note's creator_id points at ONE handler_collab_creators row (a deal), but
   the UI groups creator notes by "the same creator" across months WITHIN a
   brand — the repo-wide identity convention (handle, else name; mirrors
   creatorIdentityKey in lib/paidCollabSchema). */
export function creatorNoteKey(c: { brand_id?: string | null; tiktok_handle?: string | null; name?: string | null }): string {
  const first = String(c.tiktok_handle || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean)[0] || '';
  const handle = (first.startsWith('http') ? (first.replace(/\/+$/, '').split('/').pop() || '') : first)
    .replace(/^@+/, '').toLowerCase().trim();
  const ident = handle ? `h:${handle}` : `n:${String(c.name || '').toLowerCase().trim()}`;
  return `${c.brand_id || ''}|${ident}`;
}

// ownerId: restrict to one owner's notes — needed for Bob, whose read-all RLS
// would otherwise pull every user's notes onto his personal board.
export async function loadNotes(ownerId?: string): Promise<HandlerNote[]> {
  let q = supabase
    .from('handler_notes')
    .select('*')
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false });
  if (ownerId) q = q.eq('owner_id', ownerId);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as HandlerNote[];
}

export async function createNote(patch: NotePatch): Promise<HandlerNote> {
  const { data, error } = await supabase
    .from('handler_notes')
    .insert(patch)
    .select()
    .single();
  if (error) throw error;
  return data as HandlerNote;
}

export async function updateNote(id: string, patch: NotePatch): Promise<HandlerNote> {
  const { data, error } = await supabase
    .from('handler_notes')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as HandlerNote;
}

export async function deleteNote(id: string): Promise<void> {
  const { error } = await supabase.from('handler_notes').delete().eq('id', id);
  if (error) throw error;
}

// Convert any reminders that are now due into notifications (in-app + realtime).
// Called from the front-end on load / interval so reminders surface even when
// pg_cron isn't enabled. Returns the number fired.
export async function fireDueNoteReminders(): Promise<number> {
  const { data, error } = await supabase.rpc('fire_due_note_reminders');
  if (error) throw error;
  return (data as number) || 0;
}

/* Board/fab read path: every note the caller OWNS or is SHARED, with owner
   metadata (role/name/is_owner) folded in for colouring + the shared-by chip.
   Replaces loadNotes() for the boards — also scopes Bob to own+shared (his
   read-all RLS would otherwise flood the board). */
export async function loadVisibleNotes(): Promise<HandlerNote[]> {
  const { data, error } = await supabase.rpc('list_visible_notes');
  if (error) throw error;
  return ((data as any[]) || []) as HandlerNote[];
}

// Current share targets on a note (owner-only via RLS). Maps DB rows → tokens.
export async function loadNoteShares(noteId: string): Promise<NoteShareTarget[]> {
  const { data, error } = await supabase
    .from('handler_note_shares')
    .select('target_kind, target_role, target_team')
    .eq('note_id', noteId);
  if (error) throw error;
  return ((data as any[]) || []).map(r => {
    if (r.target_kind === 'all') return { kind: 'all' } as NoteShareTarget;
    if (r.target_kind === 'team') return { kind: 'team', team: r.target_team } as NoteShareTarget;
    return { kind: 'role', role: r.target_role } as NoteShareTarget;
  });
}

const shareKey = (t: NoteShareTarget) =>
  t.kind === 'all' ? 'all' : t.kind === 'team' ? `team:${t.team}` : `role:${t.role}`;

// Diff-replace a note's shares: delete rows no longer wanted, insert the new ones.
// RLS enforces owner + the Super-Boss-only gate on 'all'/'team'.
export async function setNoteShares(noteId: string, targets: NoteShareTarget[]): Promise<void> {
  const current = await loadNoteShares(noteId);
  const want = new Set(targets.map(shareKey));
  const have = new Set(current.map(shareKey));

  const toAdd = targets.filter(t => !have.has(shareKey(t)));
  const toRemove = current.filter(t => !want.has(shareKey(t)));

  for (const t of toRemove) {
    let q = supabase.from('handler_note_shares').delete()
      .eq('note_id', noteId).eq('target_kind', t.kind);
    if (t.kind === 'role') q = q.eq('target_role', t.role);
    if (t.kind === 'team') q = q.eq('target_team', t.team);
    const { error } = await q;
    if (error) throw error;
  }
  if (toAdd.length) {
    const rows = toAdd.map(t => ({
      note_id: noteId,
      target_kind: t.kind,
      target_role: t.kind === 'role' ? t.role : null,
      target_team: t.kind === 'team' ? t.team : null,
    }));
    // Plain insert (the unique index is on coalesce() expressions, so PostgREST
    // upsert can't target it); a concurrent duplicate (23505) is harmless.
    const { error } = await supabase.from('handler_note_shares').insert(rows);
    if (error && error.code !== '23505') throw error;
  }
}

// Saved label catalogue (reusable). Scope to one owner for the reuse picker.
export async function loadNoteLabels(ownerId?: string): Promise<NoteLabel[]> {
  let q = supabase.from('note_labels').select('id, name, color, owner_id').order('name');
  if (ownerId) q = q.eq('owner_id', ownerId);
  const { data, error } = await q;
  if (error) throw error;
  return ((data as any[]) || []) as NoteLabel[];
}

// Save a label to the caller's catalogue. Plain insert (unique index is on
// lower(name)); a duplicate (23505) just means the label already exists.
export async function upsertNoteLabel(name: string, color?: string | null): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const { error } = await supabase.from('note_labels').insert({ name: trimmed, color: color ?? null });
  if (error && error.code !== '23505') throw error;
}
