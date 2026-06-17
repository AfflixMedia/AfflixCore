import { supabase } from '../../lib/supabase';

/* ════════════════════════════════════════════════════════════
   Data-access layer for the Handler Collab workspace.
   Brands come from public.brands (paid-collab scope, assigned via
   paid_collab_handler_brands). Months/creators live in handler_collab_brand_months /
   handler_collab_creators, keyed by public.brands.id (RLS: handler/bob write,
   bob/apc/client/handler read via user_has_brand_access).
════════════════════════════════════════════════════════════ */

export type PaymentStatus = 'videos_in_progress' | 'pending' | 'paid';

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
  onboarded_on: string | null;
  completed_on: string | null;
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

export async function loadAll() {
  // Brands now come from public.brands: paid-collab-enabled (scope contains
  // 'paid_creator') and, for a handler, RLS-scoped to those assigned to them.
  const { data: bRows, error: bErr } = await supabase
    .from('brands').select('id,name,client').contains('scope', ['paid_creator']).order('name');
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
