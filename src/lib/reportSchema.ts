// ============================================================================
//  Weekly Report schema (v2) — TikTok-Shop 14-section format
// ----------------------------------------------------------------------------
//  The whole report is driven by ONE declarative registry (WEEKLY_SECTIONS).
//  The schema types, the empty()/normalize() loaders, the edit form and the
//  read-only dashboard all derive their fields from that registry, so adding
//  or changing a section happens in exactly one place.
//
//  Core rule for comparison: every metric is `number | null`.
//    • null  = the user never entered it  -> dashboard shows "—", no delta.
//    • 0     = the user entered a real zero -> compares normally.
//  This is what makes "compare a field only when data is available" automatic.
// ============================================================================

// ---- shared types (reused by monthly schema + custom-section editor) -------
export type ListingQuality = '' | 'excellent' | 'good' | 'fair' | 'poor';
export type YesNoNA = 'yes' | 'no' | 'not_rated';

export interface Insights { summary: string; }  // rich-text HTML (incl. advanced dividers)

export interface ApprovalRequest {
  enabled: boolean;
  content: string;            // rich text HTML — what is being requested for approval
  expires_at?: string | null; // after this the auto-popup stops; section stays viewable
}

export type CustomFieldType = 'text' | 'number' | 'textarea' | 'richtext' | 'date' | 'url' | 'select';

export interface CustomField {
  id: string;
  label: string;
  type: CustomFieldType;
  options?: string[];
}

/** Anchors a custom section relative to a standard section (renders right after it). */
export type StandardSectionId =
  | 'start'
  | 'snapshot' | 'chronology' | 'activity' | 'gmv_performance' | 'gmv_breakdown'
  | 'shop_analytics' | 'search_insights' | 'product_traffic' | 'channel_analytics'
  | 'product_analytics' | 'marketing_offsite' | 'ad_overall' | 'ad_by_product'
  | 'shop_score' | 'affiliate_summary' | 'top_creators' | 'top_videos'
  | 'insights';

export interface CustomSection {
  id: string;
  name: string;
  description?: string;
  is_repeater: boolean;
  body: string;
  fields: CustomField[];
  rows: Record<string, any>[];
  insert_after: StandardSectionId;
  compare_with_previous?: boolean;
  is_paid_collab?: boolean;
  paid_collab_program_id?: string | null;
  paid_collab_week?: string | null;
}

// ============================================================================
//  Section registry
// ============================================================================

export type FieldFormat =
  | 'currency' | 'number' | 'percent' | 'ratio' | 'score' | 'decimal'
  | 'text' | 'url' | 'bool';

export interface SectionField {
  key: string;
  label: string;
  format: FieldFormat;
  /** Auto (read-only) field computed from the section's other values. */
  auto?: (vals: Record<string, any>) => number | null;
  /** Short formula hint shown next to auto fields. */
  formula?: string;
  /** Show a week-over-week delta for this field on the dashboard. */
  comparable?: boolean;
  /** Lower is better (CPO, Ad %, violations) — delta color inverts. */
  lowerIsBetter?: boolean;
  /** Bootstrap grid width for the editor (scalar sections). Default 3. */
  col?: number;
  placeholder?: string;
}

export type SectionKind = 'scalar' | 'table' | 'fixed';

export interface SectionDef {
  id: Exclude<StandardSectionId, 'start' | 'insights'>;
  num: string;             // "1", "4.1"
  title: string;
  blurb?: string;
  kind: SectionKind;
  /** scalar: object fields. table/fixed: row columns. */
  fields: SectionField[];
  chart?: 'line' | 'mix' | 'funnel';
  /** fixed-table only: the locked first-column values (e.g. channel names). */
  fixedRows?: string[];
  /** fixed-table only: the row key that holds the locked label. */
  labelKey?: string;
  /** Special handling flags consumed by the editor/dashboard. */
  special?: 'gmv_max' | 'product_traffic';
}

// ---- tiny formula helpers --------------------------------------------------
const div = (a: any, b: any): number | null => {
  const x = toN(a), y = toN(b);
  if (x == null || y == null || y === 0) return null;
  return x / y;
};
const pct = (a: any, b: any): number | null => {
  const r = div(a, b);
  return r == null ? null : r * 100;
};
function toN(v: any): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export const WEEKLY_SECTIONS: SectionDef[] = [
  // 1 ──────────────────────────────────────────────────────────────────────
  {
    id: 'snapshot', num: '1', title: 'Executive Snapshot', kind: 'scalar',
    blurb: 'The headline scorecard — twelve numbers, organic up top, paid media below.',
    fields: [
      { key: 'total_gmv', label: 'Total GMV', format: 'currency', comparable: true },
      { key: 'orders', label: 'Orders', format: 'number', comparable: true },
      { key: 'aov', label: 'AOV', format: 'currency', comparable: true },
      { key: 'shop_performance_score', label: 'Shop Performance Score', format: 'score', comparable: true },
      { key: 'new_videos_posted', label: 'New Videos Posted', format: 'number', comparable: true },
      { key: 'affiliate_gmv', label: 'Affiliate GMV', format: 'currency', comparable: true },
      { key: 'live_gmv', label: 'LIVE GMV', format: 'currency', comparable: true },
      { key: 'offsite_effect', label: 'Offsite Effect', format: 'currency', comparable: true },
      { key: 'ad_spend', label: 'Ad Spend', format: 'currency', comparable: true },
      { key: 'ad_roas', label: 'Ad ROI (ROAS)', format: 'ratio', comparable: true,
        auto: v => div(v.total_gmv, v.ad_spend), formula: 'GMV ÷ Spend' },
      { key: 'cost_per_order', label: 'Cost / Order', format: 'currency', comparable: true, lowerIsBetter: true,
        auto: v => div(v.ad_spend, v.orders), formula: 'Spend ÷ Orders' },
      { key: 'ad_pct_of_gmv', label: 'Ad % of GMV', format: 'percent', comparable: true, lowerIsBetter: true,
        auto: v => pct(v.ad_spend, v.total_gmv), formula: 'Spend ÷ Total GMV' },
    ],
  },
  // 2 ──────────────────────────────────────────────────────────────────────
  {
    id: 'chronology', num: '2', title: 'Weekly Chronology', kind: 'table', chart: 'line',
    blurb: 'A running log across reporting weeks. Add a row per week — the chart tracks the trend.',
    fields: [
      { key: 'week_label', label: 'Reporting Week', format: 'text' },
      { key: 'samples', label: 'Samples', format: 'number' },
      { key: 'videos', label: 'Videos', format: 'number' },
      { key: 'lives', label: 'LIVEs', format: 'number' },
      { key: 'total_gmv', label: 'Total GMV', format: 'currency' },
      { key: 'orders', label: 'Orders', format: 'number' },
      { key: 'aov', label: 'AOV', format: 'currency' },
      { key: 'notable', label: 'Notable events', format: 'text' },
    ],
  },
  // 3 ──────────────────────────────────────────────────────────────────────
  {
    id: 'activity', num: '3', title: 'Content & Activity Output', kind: 'scalar',
    blurb: 'Input metrics — the work that feeds the funnel.',
    fields: [
      { key: 'samples_approved', label: 'Samples approved', format: 'number', comparable: true },
      { key: 'new_videos_posted', label: 'New videos posted', format: 'number', comparable: true },
      { key: 'total_videos_cumulative', label: 'Total videos posted so far', format: 'number', comparable: true },
      { key: 'live_streams', label: 'LIVE streams', format: 'number', comparable: true },
    ],
  },
  // 4 ──────────────────────────────────────────────────────────────────────
  {
    id: 'gmv_performance', num: '4', title: 'GMV Performance', kind: 'scalar',
    blurb: 'Total sales and how they split across the three selling surfaces.',
    fields: [
      { key: 'total_gmv', label: 'Total GMV', format: 'currency', comparable: true },
      { key: 'affiliate_gmv', label: 'Affiliate GMV', format: 'currency', comparable: true },
      { key: 'video_gmv', label: 'Video GMV', format: 'currency', comparable: true },
      { key: 'live_gmv', label: 'LIVE GMV', format: 'currency', comparable: true },
      { key: 'shop_tab_gmv', label: 'Shop Tab GMV', format: 'currency', comparable: true },
    ],
  },
  // 4.1 ────────────────────────────────────────────────────────────────────
  {
    id: 'gmv_breakdown', num: '4.1', title: 'GMV Breakdown by Content Source', kind: 'scalar', chart: 'mix',
    blurb: 'Track the mix shift week to week.',
    fields: [
      { key: 'creator_content_gmv', label: 'Creator Content GMV', format: 'currency', comparable: true, col: 4 },
      { key: 'seller_content_gmv', label: 'Seller Content GMV', format: 'currency', comparable: true, col: 4 },
      { key: 'shop_tab_gmv', label: 'Shop Tab GMV', format: 'currency', comparable: true, col: 4 },
    ],
  },
  // 5 ──────────────────────────────────────────────────────────────────────
  {
    id: 'shop_analytics', num: '5', title: 'Shop Analytics (Core)', kind: 'scalar',
    fields: [
      { key: 'gmv', label: 'GMV (total paid by customers)', format: 'currency', comparable: true, col: 4 },
      { key: 'orders', label: 'Orders', format: 'number', comparable: true, col: 4 },
      { key: 'aov', label: 'AOV (average order value)', format: 'currency', comparable: true, col: 4 },
    ],
  },
  // 6 ──────────────────────────────────────────────────────────────────────
  {
    id: 'search_insights', num: '6', title: 'Search Insights (from Video Content)', kind: 'scalar',
    blurb: 'How much demand comes through TikTok search — a leading indicator of discoverability.',
    fields: [
      { key: 'search_impressions', label: 'Search Impressions', format: 'number', comparable: true, col: 6 },
      { key: 'search_gmv', label: 'Search GMV', format: 'currency', comparable: true, col: 6 },
    ],
  },
  // 7 ──────────────────────────────────────────────────────────────────────
  {
    id: 'product_traffic', num: '7', title: 'Product Traffic — Funnel by Channel', kind: 'fixed',
    special: 'product_traffic', labelKey: 'channel',
    fixedRows: ['Seller LIVE', 'Seller Video', 'Affiliate Video', 'Overall'],
    blurb: 'Impressions → clicks → add-to-cart for each channel. Last week auto-fills from the previous report.',
    fields: [
      { key: 'channel', label: 'Channel', format: 'text' },
      { key: 'impressions', label: 'Impressions', format: 'number' },
      { key: 'clicks', label: 'Clicks', format: 'number' },
      { key: 'ctr', label: 'CTR', format: 'percent', auto: v => pct(v.clicks, v.impressions), formula: 'Clicks ÷ Impressions' },
      { key: 'add_to_cart', label: 'Add-to-Cart', format: 'number' },
      { key: 'atc_rate', label: 'ATC Rate', format: 'percent', auto: v => pct(v.add_to_cart, v.clicks), formula: 'ATC ÷ Clicks' },
    ],
  },
  // 8 ──────────────────────────────────────────────────────────────────────
  {
    id: 'channel_analytics', num: '8', title: 'Channel Analytics — Video vs LIVE GMV', kind: 'table',
    blurb: 'Attributed GMV per channel. Views = video views or LIVE views depending on the row.',
    fields: [
      { key: 'channel', label: 'Channel', format: 'text' },
      { key: 'attributed_gmv', label: 'Attributed GMV', format: 'currency' },
      { key: 'product_impr', label: 'Product Impr.', format: 'number' },
      { key: 'views', label: 'Views', format: 'number' },
      { key: 'product_clicks', label: 'Product Clicks', format: 'number' },
    ],
  },
  // 9 ──────────────────────────────────────────────────────────────────────
  {
    id: 'product_analytics', num: '9', title: 'Product Analytics (per product)', kind: 'table',
    fields: [
      { key: 'product', label: 'Product', format: 'text' },
      { key: 'product_id', label: 'ID', format: 'text' },
      { key: 'gmv', label: 'GMV', format: 'currency' },
      { key: 'sellr_live_gmv', label: 'Sellr LIVE GMV', format: 'currency' },
      { key: 'sellr_vid_gmv', label: 'Sellr Vid GMV', format: 'currency' },
      { key: 'creatr_gmv', label: 'Creatr GMV', format: 'currency' },
      { key: 'creatr_live_gmv', label: 'Creatr LIVE GMV', format: 'currency' },
      { key: 'creatr_vid_gmv', label: 'Creatr Vid GMV', format: 'currency' },
      { key: 'sellr_card_gmv', label: 'Sellr Card GMV', format: 'currency' },
      { key: 'orders', label: 'Orders', format: 'number' },
      { key: 'items', label: 'Items', format: 'number' },
      { key: 'impr', label: 'Impr.', format: 'number' },
      { key: 'clicks', label: 'Clicks', format: 'number' },
      { key: 'ctr', label: 'CTR', format: 'percent', auto: v => pct(v.clicks, v.impr), formula: 'Clicks ÷ Impr' },
      { key: 'atc', label: 'ATC', format: 'number' },
      { key: 'atc_pct', label: 'ATC %', format: 'percent', auto: v => pct(v.atc, v.clicks), formula: 'ATC ÷ Clicks' },
      { key: 'ctor', label: 'CTOR', format: 'percent', auto: v => pct(v.orders, v.clicks), formula: 'Orders ÷ Clicks' },
    ],
  },
  // 10 ─────────────────────────────────────────────────────────────────────
  {
    id: 'marketing_offsite', num: '10', title: 'Marketing & Offsite Performance', kind: 'scalar',
    fields: [
      { key: 'offsite_gmv', label: 'Offsite GMV', format: 'currency', comparable: true, col: 4 },
      { key: 'onsite_gmv', label: 'TikTok Shop GMV (onsite)', format: 'currency', comparable: true, col: 4 },
      { key: 'offsite_effect', label: 'Offsite Effect', format: 'currency', comparable: true, col: 4 },
    ],
  },
  // 11.1 ───────────────────────────────────────────────────────────────────
  {
    id: 'ad_overall', num: '11.1', title: 'Ad Spend & Paid Performance — Overall', kind: 'scalar',
    special: 'gmv_max',
    blurb: 'Pull from the brand’s GMV Max page, or enter manually.',
    fields: [
      { key: 'ad_spend', label: 'Ad Spend', format: 'currency', comparable: true },
      { key: 'total_orders_paid', label: 'Total Orders (paid)', format: 'number', comparable: true },
      { key: 'gmv_generated', label: 'GMV generated', format: 'currency', comparable: true },
      { key: 'cost_per_order', label: 'Cost Per Order (CPO)', format: 'currency', comparable: true, lowerIsBetter: true,
        auto: v => div(v.ad_spend, v.total_orders_paid), formula: 'Spend ÷ Paid Orders' },
      { key: 'roas', label: 'ROI (ROAS)', format: 'ratio', comparable: true,
        auto: v => div(v.gmv_generated, v.ad_spend), formula: 'GMV generated ÷ Spend' },
    ],
  },
  // 11.2 ───────────────────────────────────────────────────────────────────
  {
    id: 'ad_by_product', num: '11.2', title: 'Ad Spend by Product', kind: 'table',
    fields: [
      { key: 'product', label: 'Product', format: 'text' },
      { key: 'product_id', label: 'Product ID', format: 'text' },
      { key: 'spend', label: 'Spend', format: 'currency' },
      { key: 'total_orders', label: 'Total Orders', format: 'number' },
      { key: 'gmv_generated', label: 'GMV generated', format: 'currency' },
      { key: 'cost_per_order', label: 'Cost / Order', format: 'currency', auto: v => div(v.spend, v.total_orders), formula: 'Spend ÷ Orders' },
      { key: 'roi', label: 'ROI', format: 'ratio', auto: v => div(v.gmv_generated, v.spend), formula: 'GMV ÷ Spend' },
    ],
  },
  // 12.1 ───────────────────────────────────────────────────────────────────
  {
    id: 'shop_score', num: '12.1', title: 'Account Health — Shop Performance Score', kind: 'scalar',
    blurb: 'Log every violation / warning with the action taken for auditability.',
    fields: [
      { key: 'shop_performance_score', label: 'Shop Performance Score', format: 'score', comparable: true, col: 4 },
      { key: 'violations', label: 'Violations', format: 'number', comparable: true, lowerIsBetter: true, col: 4 },
      { key: 'warnings', label: 'Warnings', format: 'number', comparable: true, lowerIsBetter: true, col: 4 },
    ],
  },
  // 13.1 ───────────────────────────────────────────────────────────────────
  {
    id: 'affiliate_summary', num: '13.1', title: 'Affiliate Center — Summary', kind: 'scalar',
    fields: [
      { key: 'creator_attributed_gmv', label: 'Creator-attributed GMV', format: 'currency', comparable: true, col: 4 },
      { key: 'new_videos_by_creators', label: 'New videos posted (by creators)', format: 'number', comparable: true, col: 4 },
      { key: 'live_streams_by_creators', label: 'LIVE streams (by creators)', format: 'number', comparable: true, col: 4 },
    ],
  },
  // 13.2 ───────────────────────────────────────────────────────────────────
  {
    id: 'top_creators', num: '13.2', title: 'Top Creators (Top 3)', kind: 'table',
    fields: [
      { key: 'username', label: 'Username', format: 'text' },
      { key: 'creator_gmv', label: 'Creator-attributed GMV', format: 'currency' },
      { key: 'items_sold', label: 'Items Sold', format: 'number' },
      { key: 'videos_posted', label: 'Videos Posted', format: 'number' },
    ],
  },
  // 13.3 ───────────────────────────────────────────────────────────────────
  {
    id: 'top_videos', num: '13.3', title: 'Top Videos (Top 3)', kind: 'table',
    fields: [
      { key: 'video_url', label: 'Video link', format: 'url' },
      { key: 'product', label: 'Product promoted', format: 'text' },
      { key: 'video_gmv', label: 'Video-attributed GMV', format: 'currency' },
      { key: 'items_sold', label: 'Items Sold', format: 'number' },
    ],
  },
];

export const SECTION_BY_ID: Record<string, SectionDef> =
  Object.fromEntries(WEEKLY_SECTIONS.map(s => [s.id, s]));

/** Full render order incl. the 'start' and 'insights' anchors used by custom sections. */
export const WEEKLY_SECTION_ORDER: StandardSectionId[] = [
  'start',
  ...WEEKLY_SECTIONS.map(s => s.id),
  'insights',
];

export const SECTION_LABELS: Record<string, string> = {
  start: 'Top of report',
  ...Object.fromEntries(WEEKLY_SECTIONS.map(s => [s.id, `${s.num}. ${s.title}`])),
  insights: 'Insights',
  approval: 'Approval Needed / Action Items',
};

// ============================================================================
//  Content type — derived shape, one key per section
// ============================================================================

/** A scalar section's stored data: manual fields only (auto fields are computed). */
export type ScalarData = Record<string, number | null | boolean>;
export type RowData = Record<string, number | null | string>;

export interface WeeklyReportContent {
  snapshot: ScalarData;
  chronology: RowData[];
  activity: ScalarData;
  gmv_performance: ScalarData;
  gmv_breakdown: ScalarData;
  shop_analytics: ScalarData;
  search_insights: ScalarData;
  product_traffic: RowData[];      // fixed 4 channel rows
  channel_analytics: RowData[];
  product_analytics: RowData[];
  marketing_offsite: ScalarData;
  ad_overall: ScalarData;          // + not_started / auto_fill booleans
  ad_by_product: RowData[];
  shop_score: ScalarData;
  affiliate_summary: ScalarData;
  top_creators: RowData[];
  top_videos: RowData[];
  insights: Insights;
  custom_sections: CustomSection[];
  approval: ApprovalRequest;
}

// ---- value helpers ---------------------------------------------------------
export function numOrNull(v: any): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function num(v: any): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function str(v: any): string { return v == null ? '' : String(v); }

/** Compute an auto field (or read a manual field) from a value bag. */
export function fieldValue(field: SectionField, vals: Record<string, any>): number | null {
  if (field.auto) return field.auto(vals);
  return numOrNull(vals?.[field.key]);
}

// ---- empty factories -------------------------------------------------------
function emptyScalar(def: SectionDef): ScalarData {
  const o: ScalarData = {};
  for (const f of def.fields) {
    if (f.auto) continue;
    o[f.key] = f.format === 'bool' ? false : null;
  }
  if (def.special === 'gmv_max') { o.not_started = false; o.auto_fill = false; }
  return o;
}
export function emptyRow(def: SectionDef): RowData {
  const o: RowData = {};
  for (const f of def.fields) {
    if (f.auto) continue;
    o[f.key] = (f.format === 'text' || f.format === 'url') ? '' : null;
  }
  return o;
}
function fixedRows(def: SectionDef): RowData[] {
  return (def.fixedRows ?? []).map(label => ({ ...emptyRow(def), [def.labelKey ?? 'channel']: label }));
}

export const emptyContent = (): WeeklyReportContent => ({
  snapshot: emptyScalar(SECTION_BY_ID.snapshot),
  chronology: [],
  activity: emptyScalar(SECTION_BY_ID.activity),
  gmv_performance: emptyScalar(SECTION_BY_ID.gmv_performance),
  gmv_breakdown: emptyScalar(SECTION_BY_ID.gmv_breakdown),
  shop_analytics: emptyScalar(SECTION_BY_ID.shop_analytics),
  search_insights: emptyScalar(SECTION_BY_ID.search_insights),
  product_traffic: fixedRows(SECTION_BY_ID.product_traffic),
  channel_analytics: [],
  product_analytics: [],
  marketing_offsite: emptyScalar(SECTION_BY_ID.marketing_offsite),
  ad_overall: emptyScalar(SECTION_BY_ID.ad_overall),
  ad_by_product: [],
  shop_score: emptyScalar(SECTION_BY_ID.shop_score),
  affiliate_summary: emptyScalar(SECTION_BY_ID.affiliate_summary),
  top_creators: [],
  top_videos: [],
  insights: { summary: '' },
  custom_sections: [],
  approval: { enabled: false, content: '' },
});

// ============================================================================
//  normalizeContent — loads ANY stored report (legacy v1 or new v2) and maps
//  it onto the v2 shape. Missing values stay null so the dashboard dashes them.
// ============================================================================

// Map a legacy v1 custom-section anchor onto the closest v2 section id.
const LEGACY_ANCHOR: Record<string, StandardSectionId> = {
  start: 'start',
  overall: 'snapshot',
  top_creators: 'top_creators',
  top_videos: 'top_videos',
  video_performance: 'activity',
  gmv_max: 'ad_overall',
  product_highlights: 'product_analytics',
  shop_health: 'shop_score',
  insights: 'insights',
};
const VALID_ANCHORS = new Set<string>(WEEKLY_SECTION_ORDER);

export function normalizeContent(raw: any): WeeklyReportContent {
  const src = raw ?? {};

  // Legacy v1 blocks (used as fallbacks when the new key is absent).
  const lo = src.overall ?? {};
  const lvp = src.video_performance ?? {};
  const lgm = (Array.isArray(src.gmv_max) ? src.gmv_max[0] : src.gmv_max) ?? {};
  const lsh = src.shop_health ?? {};
  const adNotStarted = lo.ad_spend_not_started === true;

  // Per-field legacy fallbacks, keyed by `${sectionId}.${fieldKey}`.
  const legacy: Record<string, any> = {
    'snapshot.total_gmv': lo.total_gmv,
    'snapshot.orders': lo.orders,
    'snapshot.affiliate_gmv': lo.affiliate_gmv,
    'snapshot.shop_performance_score': lsh.shop_performance_score,
    'snapshot.new_videos_posted': lvp.total_videos_posted,
    'snapshot.ad_spend': adNotStarted ? null : (lgm.ad_spend ?? lo.ad_spend),
    'activity.samples_approved': lo.samples_approved,
    'activity.total_videos_cumulative': lvp.total_videos_posted,
    'gmv_performance.total_gmv': lo.total_gmv,
    'gmv_performance.affiliate_gmv': lo.affiliate_gmv,
    'shop_analytics.gmv': lo.total_gmv,
    'shop_analytics.orders': lo.orders,
    'ad_overall.ad_spend': lgm.ad_spend ?? (adNotStarted ? null : lo.ad_spend),
    'ad_overall.total_orders_paid': lgm.orders,
    'ad_overall.gmv_generated': lgm.gmv,
    'shop_score.shop_performance_score': lsh.shop_performance_score,
    'affiliate_summary.creator_attributed_gmv': lo.affiliate_gmv,
  };

  const scalar = (def: SectionDef): ScalarData => {
    const newObj = src[def.id] ?? {};
    const out: ScalarData = {};
    for (const f of def.fields) {
      if (f.auto) continue;
      if (f.format === 'bool') { out[f.key] = !!newObj[f.key]; continue; }
      const has = newObj[f.key] != null && newObj[f.key] !== '';
      out[f.key] = has ? numOrNull(newObj[f.key]) : numOrNull(legacy[`${def.id}.${f.key}`]);
    }
    if (def.special === 'gmv_max') {
      out.not_started = !!newObj.not_started || (def.id === 'ad_overall' && lgm.not_yet_started === true && src.ad_overall == null);
      out.auto_fill = !!newObj.auto_fill;
    }
    return out;
  };

  const table = (def: SectionDef, legacyRows?: any[], mapLegacy?: (r: any) => RowData): RowData[] => {
    const arr = src[def.id];
    if (Array.isArray(arr)) {
      return arr.map((r: any) => {
        const out: RowData = {};
        for (const f of def.fields) {
          if (f.auto) continue;
          out[f.key] = (f.format === 'text' || f.format === 'url') ? str(r[f.key]) : numOrNull(r[f.key]);
        }
        return out;
      });
    }
    if (legacyRows && mapLegacy && Array.isArray(legacyRows)) return legacyRows.map(mapLegacy);
    return [];
  };

  // product_traffic: ensure the 4 fixed channels always exist (merge stored values in).
  const trafficDef = SECTION_BY_ID.product_traffic;
  const storedTraffic: any[] = Array.isArray(src.product_traffic) ? src.product_traffic : [];
  const product_traffic: RowData[] = (trafficDef.fixedRows ?? []).map(label => {
    const stored = storedTraffic.find(r => str(r.channel) === label) ?? {};
    const out: RowData = { channel: label };
    for (const f of trafficDef.fields) {
      if (f.auto || f.key === 'channel') continue;
      out[f.key] = numOrNull(stored[f.key]);
    }
    return out;
  });

  // Custom sections: re-anchor legacy insert_after values onto the new ids.
  const custom_sections: CustomSection[] = Array.isArray(src.custom_sections)
    ? src.custom_sections.map((s: any) => {
        const fields: CustomField[] = Array.isArray(s.fields) ? s.fields.map((f: any) => ({
          id: str(f.id) || crypto.randomUUID(),
          label: str(f.label),
          type: (['text', 'number', 'textarea', 'richtext', 'date', 'url', 'select'].includes(f.type) ? f.type : 'text') as CustomFieldType,
          options: Array.isArray(f.options) ? f.options.map(str) : undefined,
        })) : [];
        const rows: Record<string, any>[] = Array.isArray(s.rows) ? s.rows : [];
        const isRepeater = !!s.is_repeater;
        let body = str(s.body);
        if (!isRepeater && !body && fields.length > 0 && rows[0]) {
          body = fields.map(f => {
            const v = rows[0][f.id];
            if (v == null || v === '') return '';
            if (f.type === 'richtext' || f.type === 'textarea') return `<h5>${escapeHtml(f.label)}</h5>${String(v)}`;
            if (f.type === 'url') return `<p><strong>${escapeHtml(f.label)}:</strong> <a href="${escapeAttr(String(v))}">${escapeHtml(String(v))}</a></p>`;
            return `<p><strong>${escapeHtml(f.label)}:</strong> ${escapeHtml(String(v))}</p>`;
          }).filter(Boolean).join('');
        }
        const rawAnchor = str(s.insert_after);
        const anchor: StandardSectionId = VALID_ANCHORS.has(rawAnchor)
          ? (rawAnchor as StandardSectionId)
          : (LEGACY_ANCHOR[rawAnchor] ?? 'insights');
        return {
          id: str(s.id) || crypto.randomUUID(),
          name: str(s.name),
          description: str(s.description),
          is_repeater: isRepeater,
          body,
          fields,
          rows,
          insert_after: anchor,
          compare_with_previous: !!s.compare_with_previous,
          is_paid_collab: !!s.is_paid_collab,
          paid_collab_program_id: s.paid_collab_program_id ?? null,
          paid_collab_week: s.paid_collab_week ?? null,
        };
      })
    : [];

  const approval: ApprovalRequest = {
    enabled: !!src.approval?.enabled,
    content: str(src.approval?.content),
    expires_at: src.approval?.expires_at ?? null,
  };

  return {
    snapshot: scalar(SECTION_BY_ID.snapshot),
    chronology: table(SECTION_BY_ID.chronology),
    activity: scalar(SECTION_BY_ID.activity),
    gmv_performance: scalar(SECTION_BY_ID.gmv_performance),
    gmv_breakdown: scalar(SECTION_BY_ID.gmv_breakdown),
    shop_analytics: scalar(SECTION_BY_ID.shop_analytics),
    search_insights: scalar(SECTION_BY_ID.search_insights),
    product_traffic,
    channel_analytics: table(SECTION_BY_ID.channel_analytics),
    product_analytics: table(SECTION_BY_ID.product_analytics, src.product_highlights, (r: any) => ({
      product: str(r.product_name), product_id: str(r.product_id),
      gmv: numOrNull(r.total_gmv ?? r.gmv),
      sellr_live_gmv: null, sellr_vid_gmv: null, creatr_gmv: numOrNull(r.affiliate_gmv),
      creatr_live_gmv: null, creatr_vid_gmv: null, sellr_card_gmv: null,
      orders: null, items: numOrNull(r.total_units_sold ?? r.units_sold),
      impr: null, clicks: null, atc: null,
    })),
    marketing_offsite: scalar(SECTION_BY_ID.marketing_offsite),
    ad_overall: scalar(SECTION_BY_ID.ad_overall),
    ad_by_product: table(SECTION_BY_ID.ad_by_product),
    shop_score: scalar(SECTION_BY_ID.shop_score),
    affiliate_summary: scalar(SECTION_BY_ID.affiliate_summary),
    top_creators: table(SECTION_BY_ID.top_creators, src.top_creators, (r: any) => ({
      username: str(r.name ?? r.username), creator_gmv: numOrNull(r.gmv ?? r.creator_gmv),
      items_sold: numOrNull(r.items_sold), videos_posted: numOrNull(r.videos ?? r.videos_posted),
    })),
    top_videos: table(SECTION_BY_ID.top_videos, src.top_videos, (r: any) => ({
      video_url: str(r.video_url), product: str(r.product ?? r.creator_name),
      video_gmv: numOrNull(r.gmv ?? r.video_gmv), items_sold: numOrNull(r.items_sold),
    })),
    insights: { summary: str(src.insights?.summary) },
    custom_sections,
    approval,
  };
}

// ---- formatting (shared by editor preview + dashboard) ---------------------
export function formatValue(format: FieldFormat, v: number | null | undefined, opts?: { compact?: boolean }): string {
  if (v == null) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  switch (format) {
    case 'currency': {
      const abs = Math.abs(n);
      if (opts?.compact && abs >= 10000) return `$${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
      return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    }
    case 'percent': return `${n.toFixed(2).replace(/\.00$/, '')}%`;
    case 'ratio': return `${n.toFixed(2)}x`;
    case 'score': return n.toFixed(1);
    case 'decimal': return n.toFixed(2);
    case 'number': return n.toLocaleString();
    default: return String(v);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}
