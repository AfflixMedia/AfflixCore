// Helper for uploading inline report images to Supabase Storage.
// Bucket: 'report-images' (public-read, authed-write — see migration).
//
// Returns a public URL that can be saved into report content (image_url).

import { supabase } from './supabase';

const BUCKET = 'report-images';

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

export async function uploadReportImage(file: File, opts: { brandId?: string; reportType?: 'weekly' | 'monthly' } = {}): Promise<string> {
  const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase().slice(0, 8) || 'bin';
  const base = slugify(file.name.replace(/\.[^.]+$/, '') || 'image') || 'image';
  const folder = [opts.reportType ?? 'monthly', opts.brandId ?? 'misc'].join('/');
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${base}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('Could not resolve public URL for uploaded image');
  return data.publicUrl;
}
