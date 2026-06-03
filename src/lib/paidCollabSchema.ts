// Paid Creator Program tracker — DB row types + helpers shared by the
// Brand Detail tab (Bob/APC entry view) and the Paid Collab Client portal.

export type PaymentPopupOverride = 'auto' | 'force_hide' | 'force_show';

export interface PaidProgram {
  id: string;
  brand_id: string;
  name: string | null;
  launch_date: string | null;
  ended_at: string | null;
  total_budget: number;
  currency: string;
  notes: string | null;
  payment_popup_default?: PaymentPopupOverride;
  created_at: string;
  updated_at: string;
}

/** A program is "ended" once `ended_at` is set — fully read-only after that. */
export const isProgramEnded = (p: Pick<PaidProgram, 'ended_at'>): boolean =>
  !!p.ended_at;

export const programDisplayName = (p: Pick<PaidProgram, 'name'> | null): string =>
  p?.name?.trim() || 'Untitled program';

export const programPeriodLabel = (p: Pick<PaidProgram, 'launch_date' | 'ended_at'>): string => {
  const fmt = (iso: string) =>
    new Date(iso.length > 10 ? iso : iso + 'T00:00:00').toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  const start = p.launch_date ? fmt(p.launch_date) : '—';
  if (p.ended_at) return `${start} → ${fmt(p.ended_at)}`;
  return `${start} → ongoing`;
};

/** Existing automatic predicate — only based on live count vs agreed videos. */
export const isCreatorPaymentPendingAuto = (c: PaidCreator, liveCount: number): boolean =>
  c.status !== 'dropped'
  && c.agreed_videos > 0
  && liveCount >= c.agreed_videos
  && !c.paid_out;

/**
 * Effective "payment pending" visibility for a creator.
 *
 * Simple model — the PROGRAM toggle is the single master control:
 *   - program 'force_hide' → badge never shows (master OFF)
 *   - program 'force_show' → badge always shows (non-dropped, non-paid)
 *   - program 'auto'       → automatic: show only for creators whose live
 *                            video count has met their agreed count
 *
 * The 3rd & 4th args are accepted for call-site compatibility; only the
 * program default is used.
 */
export const isCreatorPaymentPending = (
  c: PaidCreator, liveCount: number,
  p?: Pick<PaidProgram, 'payment_popup_default'> | null,
  _b?: { payment_popup_default?: PaymentPopupOverride | null } | null,
): boolean => {
  const prog = p?.payment_popup_default;
  if (prog === 'force_hide') return false;
  if (prog === 'force_show') return c.status !== 'dropped' && !c.paid_out;
  return isCreatorPaymentPendingAuto(c, liveCount);
};

/** Rollup stats for a single program card. */
export interface ProgramSummary {
  program: PaidProgram;
  creatorCount: number;
  videosPipeline: number;
  videosLive: number;
  videosTotal: number;
  paymentPending: number;
  /** Sum of agreed_videos across non-dropped creators (for "all videos posted" filter). */
  agreedTotal: number;
  /** All non-dropped creators have hit their agreed-videos count. */
  allVideosPosted: boolean;
  spent: number;
}

/** Group creators + videos by program and compute summary stats per program. */
export function summarizePrograms(
  programs: PaidProgram[],
  creators: PaidCreator[],
  videos: PaidVideo[],
): Map<string, ProgramSummary> {
  const creatorsByProgram = new Map<string, PaidCreator[]>();
  for (const c of creators) {
    const arr = creatorsByProgram.get(c.program_id) ?? [];
    arr.push(c);
    creatorsByProgram.set(c.program_id, arr);
  }
  // Every video is "live" once added — count all videos per creator.
  const videosByCreator = new Map<string, number>();
  for (const v of videos) {
    videosByCreator.set(v.creator_id, (videosByCreator.get(v.creator_id) ?? 0) + 1);
  }
  const result = new Map<string, ProgramSummary>();
  for (const p of programs) {
    const cs = creatorsByProgram.get(p.id) ?? [];
    const activeCreators = cs.filter(c => c.status !== 'dropped');
    // Live = videos actually added. Pipeline = agreed videos not yet delivered.
    const live = cs.reduce((s, c) => s + (videosByCreator.get(c.id) ?? 0), 0);
    const pipeline = activeCreators.reduce(
      (s, c) => s + Math.max(0, (c.agreed_videos || 0) - (videosByCreator.get(c.id) ?? 0)), 0);
    // Pass the program so the payment_popup_default toggle is respected.
    const paymentPending = cs.filter(c =>
      isCreatorPaymentPending(c, videosByCreator.get(c.id) ?? 0, p)).length;
    const spent = cs.reduce((s, c) => s + Number(c.fee || 0), 0);
    const agreedTotal = activeCreators.reduce((s, c) => s + (c.agreed_videos || 0), 0);
    const allVideosPosted =
      activeCreators.length > 0
      && activeCreators.every(c =>
        c.agreed_videos > 0 && (videosByCreator.get(c.id) ?? 0) >= c.agreed_videos);
    result.set(p.id, {
      program: p,
      creatorCount: cs.length,
      videosPipeline: pipeline,
      videosLive: live,
      videosTotal: pipeline + live,
      paymentPending,
      agreedTotal,
      allVideosPosted,
      spent,
    });
  }
  return result;
}

export type CreatorStatus = 'active' | 'paused' | 'done' | 'dropped';

export interface PaidCreator {
  id: string;
  program_id: string;
  name: string;
  handle: string | null;
  fee: number;
  agreed_videos: number;
  onboard_date: string | null;
  status: CreatorStatus;
  notes: string | null;
  paypal_email: string | null;
  sort_order: number;
  gmv: number;
  items_sold: number;
  likes: number;
  paid_out: boolean;
  paid_at: string | null;
  payment_popup_override?: PaymentPopupOverride;
  weekly_perf_anchor: string | null;
  created_at: string;
}

export type PerformancePeriod = 'weekly' | 'monthly';

/**
 * Brand-wide creator identity — same creator across multiple programs of the
 * same brand. Prefer handle; fall back to name. Used to aggregate performance
 * entries across programs of one brand (NEVER across brands).
 */
export function creatorIdentityKey(c: Pick<PaidCreator, 'handle' | 'name'>): string {
  const handle = (c.handle || '').toLowerCase().replace(/^@+/, '').trim();
  if (handle) return `h:${handle}`;
  return `n:${(c.name || '').toLowerCase().trim()}`;
}

export interface BrandCreatorAggregate {
  /** identity → every creator row in the brand that shares this identity */
  creatorsByIdentity: Map<string, PaidCreator[]>;
  /** identity → every performance row across all matching creators in the brand */
  perfByIdentity: Map<string, PaidCreatorPerformance[]>;
}

/**
 * Group a brand's creators and performance rows by identity. Pass `creators`
 * and `performance` that you ALREADY filtered to a single brand — this helper
 * intentionally does NOT do cross-brand work, callers are responsible for
 * scoping by brand.
 */
export function buildBrandCreatorAggregate(
  creators: PaidCreator[],
  performance: PaidCreatorPerformance[],
): BrandCreatorAggregate {
  const creatorsByIdentity = new Map<string, PaidCreator[]>();
  const identityByCreatorId = new Map<string, string>();
  for (const c of creators) {
    const key = creatorIdentityKey(c);
    identityByCreatorId.set(c.id, key);
    const arr = creatorsByIdentity.get(key) ?? [];
    arr.push(c);
    creatorsByIdentity.set(key, arr);
  }
  const perfByIdentity = new Map<string, PaidCreatorPerformance[]>();
  for (const p of performance) {
    const key = identityByCreatorId.get(p.creator_id);
    if (!key) continue; // performance row whose creator isn't in this brand
    const arr = perfByIdentity.get(key) ?? [];
    arr.push(p);
    perfByIdentity.set(key, arr);
  }
  return { creatorsByIdentity, perfByIdentity };
}

/** Sum a creator's GMV across every program in the brand. */
export function aggBrandGmv(
  c: PaidCreator,
  agg: BrandCreatorAggregate,
  periodType: PerformancePeriod = 'weekly',
): number {
  const entries = agg.perfByIdentity.get(creatorIdentityKey(c)) ?? [];
  return entries
    .filter(e => e.period_type === periodType)
    .reduce((s, e) => s + (Number(e.gmv) || 0), 0);
}

/** Sum a creator's items sold across every program in the brand. */
export function aggBrandItems(
  c: PaidCreator,
  agg: BrandCreatorAggregate,
  periodType: PerformancePeriod = 'weekly',
): number {
  const entries = agg.perfByIdentity.get(creatorIdentityKey(c)) ?? [];
  return entries
    .filter(e => e.period_type === periodType)
    .reduce((s, e) => s + (Number(e.items_sold) || 0), 0);
}

/** All performance entries in this brand that belong to "the same creator". */
export function brandPerfEntriesFor(
  c: Pick<PaidCreator, 'handle' | 'name'>,
  agg: BrandCreatorAggregate,
): PaidCreatorPerformance[] {
  return agg.perfByIdentity.get(creatorIdentityKey(c)) ?? [];
}

export interface PaidCreatorPerformance {
  id: string;
  creator_id: string;
  period_type: PerformancePeriod;
  period_start: string;       // YYYY-MM-DD (week start, or first-of-month)
  gmv: number;
  items_sold: number;
  notes: string | null;
  created_at: string;
}

export type VideoStatus = 'pipeline' | 'live';

export interface PaidVideo {
  id: string;
  creator_id: string;
  product_id: string | null;
  tiktok_url: string | null;
  ad_code: string | null;
  ad_code_authorized: boolean;
  status: VideoStatus;
  posted_on: string | null;
  notes: string | null;
  weekly_perf_anchor: string | null;
  created_at: string;
}

export interface PaidVideoPerformance {
  id: string;
  video_id: string;
  period_type: PerformancePeriod;
  period_start: string;
  gmv: number;
  items_sold: number;
  notes: string | null;
  created_at: string;
}

export interface BrandProduct {
  id: string;
  brand_id: string;
  external_product_id: string | null;
  name: string;
  tiktok_link: string | null;
  standard_commission: number;
  shop_ads_commission: number;
  shop_ads_commission_not_set: boolean;
  created_at: string;
  updated_at: string;
}

export type NoteKind =
  | 'note'
  | 'delay'
  | 'pause'
  | 'milestone'
  | 'budget_suggestion'
  | 'first_live';

export interface ProgramNote {
  id: string;
  program_id: string;
  kind: NoteKind;
  title: string;
  body: string | null;
  occurred_on: string | null;
  pin_to_chart: boolean;
  created_at: string;
}

export const NOTE_KIND_META: Record<NoteKind, { label: string; icon: string; color: string }> = {
  note:              { label: 'Note',              icon: 'bi-sticky',           color: '#6c757d' },
  delay:             { label: 'Delay',             icon: 'bi-exclamation-triangle-fill', color: '#dc3545' },
  pause:             { label: 'Pause',             icon: 'bi-pause-circle-fill', color: '#fd7e14' },
  milestone:         { label: 'Milestone',         icon: 'bi-star-fill',         color: '#0d6efd' },
  budget_suggestion: { label: 'Budget suggestion', icon: 'bi-cash-coin',         color: '#198754' },
  first_live:        { label: 'First content live',icon: 'bi-rocket-takeoff-fill', color: '#20c997' },
};

export const CREATOR_STATUS_META: Record<CreatorStatus, { label: string; color: string }> = {
  active:  { label: 'Active',  color: '#198754' },
  paused:  { label: 'Paused',  color: '#fd7e14' },
  done:    { label: 'Done',    color: '#0d6efd' },
  dropped: { label: 'Dropped', color: '#6c757d' },
};

export const fmtMoney = (n: number, currency = 'USD') =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n || 0);

export const fmtNumber = (n: number) =>
  new Intl.NumberFormat(undefined).format(Math.round(n || 0));

export const daysBetween = (a: string | null | undefined, b: string | null | undefined): number => {
  if (!a || !b) return 0;
  const d1 = new Date(a + 'T00:00:00').getTime();
  const d2 = new Date(b + 'T00:00:00').getTime();
  return Math.max(0, Math.round((d2 - d1) / 86400000));
};

export const todayISO = () => new Date().toISOString().slice(0, 10);

export const monthKey = (iso: string) => iso.slice(0, 7); // YYYY-MM

export const monthLabel = (yyyymm: string): string => {
  const [y, m] = yyyymm.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'short', year: '2-digit' });
};
