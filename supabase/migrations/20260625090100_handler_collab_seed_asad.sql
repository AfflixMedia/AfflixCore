-- =========================================================
-- Afflix Core — Seed data migration: import Asad's existing Paid Collab
-- Handler data (8 brands / 7 brand-months / 23 creators) from the
-- standalone "afflix-base" tool's export into the new
-- handler_collab_brands / handler_collab_brand_months / handler_collab_creators
-- tables (see 20260625090000_handler_collab_workspace.sql).
--
-- Original UUIDs are preserved verbatim (no remapping needed — these are
-- brand-new tables with no collision risk). Dead columns from the source
-- export (sheets_url, videos_status, content_url) are dropped — confirmed
-- unused anywhere in the source app.
--
-- Requires a profiles row for asad@afflixmedia.com to already exist
-- (role = 'paid_collab_handler'); aborts loudly if not found.
-- =========================================================

do $$
begin
  if not exists (select 1 from public.profiles where email = 'asad@afflixmedia.com') then
    raise exception 'Seed aborted: no profiles row for asad@afflixmedia.com — create the handler account first.';
  end if;
end $$;

-- ---------- handler_collab_brands ----------
insert into public.handler_collab_brands (id, handler_id, name, created_at)
select v.id, h.id, v.name, v.created_at
from (values
  ('0d5bbdb3-cae4-498c-8c0f-84b6d151628d'::uuid, 'Wetcat', '2026-06-10T20:59:02.808779+00:00'::timestamptz),
  ('c8f9863c-0f59-4dde-a11e-93bc64effe46'::uuid, 'Iconic Rings', '2026-06-10T23:52:02.274978+00:00'::timestamptz),
  ('fa99918f-1ca0-453e-a503-166e74cdad8c'::uuid, 'Zytrell', '2026-06-11T19:47:34.721697+00:00'::timestamptz),
  ('df3900c7-b3d6-43eb-9a41-375e34c1c970'::uuid, 'Quasi', '2026-06-11T21:05:14.484769+00:00'::timestamptz),
  ('2809f3e3-39f4-4013-b730-97d49d6900ea'::uuid, 'Dreamier', '2026-06-12T13:02:59.998934+00:00'::timestamptz),
  ('15dcebcc-0780-4d8d-8169-3daf59ee681a'::uuid, 'Escargot', '2026-06-12T13:20:59.607036+00:00'::timestamptz),
  ('e52afd46-b43f-485d-a5cb-09c0d768d1c2'::uuid, 'Lifeboost Coffee', '2026-06-12T19:01:58.279797+00:00'::timestamptz),
  ('b6c90658-f888-4351-9220-f12d32e7bad3'::uuid, 'ZZ CRUD One', '2026-06-16T15:58:20.35711+00:00'::timestamptz)
) as v(id, name, created_at)
cross join (select id from public.profiles where email = 'asad@afflixmedia.com') as h(id)
on conflict (id) do nothing;

-- ---------- handler_collab_brand_months ----------
insert into public.handler_collab_brand_months
  (id, brand_id, month, budget, content_guide_url, focus_product_url, notes)
values
  ('a3fbf951-bd59-46f9-aead-44fc03d5d4f7'::uuid, 'df3900c7-b3d6-43eb-9a41-375e34c1c970'::uuid, '2026-06', 500, 'https://docs.google.com/document/d/1Z7f-HpIuv2sHjSR6ZSYlRS2VFanCpbCdw_pYWras7gw/edit?tab=t.0', '[{"name":"Collagen Glow Up Mask","url":"https://www.tiktok.com/view/product/1731749677897191481"}]', 'Deactivated'),
  ('3cd9a5e7-dd1c-4d63-9c24-6e745d85eca4'::uuid, '0d5bbdb3-cae4-498c-8c0f-84b6d151628d'::uuid, '2026-06', 4000, 'https://docs.google.com/document/d/1y0eUGeseihi5tpBHPMoSVAsKnkfqaz3O2kyubnC2BdA/edit?tab=t.ppbgqds3e35p', '[{"name":"Turkish Towel","url":"https://www.tiktok.com/view/product/1732411625941537120"}]', '$1500 on TOP creators.
$2500 on others.'),
  ('914ef956-e9eb-496c-aea8-d0bec97d37de'::uuid, 'c8f9863c-0f59-4dde-a11e-93bc64effe46'::uuid, '2026-06', 1000, 'https://docs.google.com/document/d/1dKHJfYj_kUOmQakhIAVsa_N-flDDKbuFNsSDPQUR7VM/edit?tab=t.0', '[{"name":"The Mevrick","url":"https://www.tiktok.com/view/product/1732102367481795579"}]', ''),
  ('303502f9-7f98-4370-b61c-eab1c47a88e1'::uuid, 'fa99918f-1ca0-453e-a503-166e74cdad8c'::uuid, '2026-06', 1000, 'https://docs.google.com/document/d/13WfKQ90MvuwfbnQ2LxdZMNbanDqRZONuuIudmk7MzZI/edit?tab=t.0', '[{"name":"Acne Cream","url":"https://www.tiktok.com/view/product/1732415851201598450"}]', ''),
  ('13a26595-dcc1-4b0b-aa7b-6dd1c06b9d53'::uuid, '2809f3e3-39f4-4013-b730-97d49d6900ea'::uuid, '2026-06', 1000, '', '[{"name":"Bamboo Viscose Convertible Footie","url":"https://www.tiktok.com/view/product/1732417131286860688"},{"name":"Kids Bamboo Viscose Pajama Set","url":"https://www.tiktok.com/view/product/1732415695607337872"}]', ''),
  ('1bcabc28-85f6-4ae1-9d8e-b461282d9d44'::uuid, 'e52afd46-b43f-485d-a5cb-09c0d768d1c2'::uuid, '2026-06', 2000, 'https://docs.google.com/document/d/1Q4gqQlsJSHFJHiErPrTpCF0ErRcb2WRBgGNkA7sMVmk/edit?tab=t.0', '[{"name":"TikTok Exclusive Bundle","url":"https://www.tiktok.com/view/product/1732425131512337071"}]', ''),
  ('40d7c8ae-dc0b-48ec-972f-7ea48d6c5f2d'::uuid, '15dcebcc-0780-4d8d-8169-3daf59ee681a'::uuid, '2026-06', 1000, '', '[{"name":"Birthday Card Bundle","url":"https://www.tiktok.com/view/product/1732410301532573946"}]', 'Paused till further notice')
on conflict (id) do nothing;

-- ---------- handler_collab_creators ----------
insert into public.handler_collab_creators
  (id, brand_id, name, tiktok_handle, amount, videos_count, zelle, paypal, phone, email, category,
   payment_status, onboarded_on, completed_on, video_codes, products, monthly, created_at)
values
  ('021f4cec-393b-4c98-8a83-4d00f85301a2'::uuid, 'fa99918f-1ca0-453e-a503-166e74cdad8c'::uuid, 'Kylie Huges', 'kylieehughess', 250, 5, '', '', '', '', '',
   'videos_in_progress', '2026-06-12'::date, null, '[]'::jsonb, '[{"url":"https://www.tiktok.com/view/product/1732415851201598450","name":"Acne Cream"}]'::jsonb, '{}'::jsonb, '2026-06-12T13:34:11.715035+00:00'::timestamptz),
  ('e1dcf8b3-ffb4-40e7-9099-236a7366d30a'::uuid, '0d5bbdb3-cae4-498c-8c0f-84b6d151628d'::uuid, 'Cassidy Ellis', 'cassidy_ellis', 200, 6, '', '', '+1 (214) 399-8111', '', '',
   'videos_in_progress', '2026-06-12'::date, null, '[]'::jsonb, '[{"url":"https://www.tiktok.com/view/product/1732411625941537120","name":"Turkish Towel"}]'::jsonb, '{}'::jsonb, '2026-06-12T16:37:13.173933+00:00'::timestamptz),
  ('2dead6a6-56a5-4c22-8567-2199bc9f63d1'::uuid, '0d5bbdb3-cae4-498c-8c0f-84b6d151628d'::uuid, 'Cole Bell', 'colebell0', 200, 5, '', '', '', '', '',
   'videos_in_progress', '2026-06-11'::date, null, '[]'::jsonb, '[{"url":"https://www.tiktok.com/view/product/1732411625941537120","name":"Turkish Towel"}]'::jsonb, '{}'::jsonb, '2026-06-10T23:09:28.956231+00:00'::timestamptz),
  ('b71600cf-4dbf-4ba7-bf93-899815fd1d70'::uuid, '0d5bbdb3-cae4-498c-8c0f-84b6d151628d'::uuid, 'Samantha Carmak', 'its_sammyyy_', 200, 5, '', '', '', '', '',
   'videos_in_progress', '2026-06-11'::date, null, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, '2026-06-10T23:10:28.844844+00:00'::timestamptz),
  ('ac203279-89a7-4a3f-bde0-0fdca6b0ed8a'::uuid, '0d5bbdb3-cae4-498c-8c0f-84b6d151628d'::uuid, 'Kristen Shobert', 'kristenshobert', 200, 6, '', '', '', '', '',
   'videos_in_progress', '2026-06-11'::date, null, '[]'::jsonb, '[{"url":"https://www.tiktok.com/view/product/1732411625941537120","name":"Turkish Towel"}]'::jsonb, '{}'::jsonb, '2026-06-10T23:09:54.713437+00:00'::timestamptz),
  ('327ce7b3-6726-403f-bac8-a592f95e011e'::uuid, 'c8f9863c-0f59-4dde-a11e-93bc64effe46'::uuid, 'Demarcus', 'dadalldecades', 200, 5, '', '', '+1 (346) 444-0632', '', '',
   'videos_in_progress', '2026-06-11'::date, null, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, '2026-06-10T23:52:48.917073+00:00'::timestamptz),
  ('0f3b7e69-ea82-4bd6-8f9d-e32b69e0fa8e'::uuid, 'c8f9863c-0f59-4dde-a11e-93bc64effe46'::uuid, 'Jevon Cheney', 'cheneyconcepts', 200, 5, '', '', '+1 (419) 310-8053', '', 'Life Style / Fitness / Tech',
   'videos_in_progress', '2026-06-11'::date, null, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, '2026-06-10T23:52:32.752526+00:00'::timestamptz),
  ('c92ba7fc-0978-46ef-a464-47c791f26d63'::uuid, '0d5bbdb3-cae4-498c-8c0f-84b6d151628d'::uuid, 'Jevon Cheney', 'cheneyconcepts', 500, 10, '', '', '+1 (419) 310-8053', '', 'Life Style / Fitness / Tech',
   'videos_in_progress', '2026-06-11'::date, null, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, '2026-06-10T23:08:54.761666+00:00'::timestamptz),
  ('cbda6fe1-8de1-453e-ab03-c51d233d591f'::uuid, '0d5bbdb3-cae4-498c-8c0f-84b6d151628d'::uuid, 'Demarcus', 'dadalldecades', 250, 8, '', '', '+1 (346) 444-0632', '', '',
   'videos_in_progress', '2026-06-11'::date, null, '[{"video":"","adCode":""},{"video":"","adCode":""},{"video":"","adCode":""},{"video":"","adCode":""},{"video":"","adCode":""},{"video":"","adCode":""},{"video":"","adCode":""},{"video":"","adCode":""}]'::jsonb, '[{"url":"https://www.tiktok.com/view/product/1732411625941537120","name":"Turkish Towel"}]'::jsonb, '{}'::jsonb, '2026-06-10T20:59:59.044293+00:00'::timestamptz),
  ('a1a342a1-3e09-490b-9856-2b3e36daa729'::uuid, '0d5bbdb3-cae4-498c-8c0f-84b6d151628d'::uuid, 'Kylie Huges', 'kylieehughess', 200, 4, '', '', '', '', '',
   'videos_in_progress', '2026-06-11'::date, null, '[]'::jsonb, '[{"url":"https://www.tiktok.com/view/product/1732411625941537120","name":"Turkish Towel"}]'::jsonb, '{}'::jsonb, '2026-06-11T00:10:39.71653+00:00'::timestamptz),
  ('c3964bec-6771-4443-9118-3f9c6356c537'::uuid, '0d5bbdb3-cae4-498c-8c0f-84b6d151628d'::uuid, 'Aubrie', 'texasmamax5
mamaaub2', 300, 1, '', '', '', '', '',
   'videos_in_progress', '2026-06-11'::date, null, '[]'::jsonb, '[{"url":"https://www.tiktok.com/view/product/1732411625941537120","name":"Turkish Towel"}]'::jsonb, '{}'::jsonb, '2026-06-10T23:11:21.300666+00:00'::timestamptz),
  ('fe5d8692-41e2-42ce-9cd9-270252a1cf69'::uuid, '0d5bbdb3-cae4-498c-8c0f-84b6d151628d'::uuid, 'Andrea', 'andreaaftereffect', 200, 6, '', '', '', '', '',
   'videos_in_progress', '2026-06-11'::date, null, '[]'::jsonb, '[{"url":"https://www.tiktok.com/view/product/1732411625941537120","name":"Turkish Towel"}]'::jsonb, '{}'::jsonb, '2026-06-11T13:19:40.968999+00:00'::timestamptz),
  ('36f73589-e09b-41fe-b9d8-34250079f342'::uuid, 'fa99918f-1ca0-453e-a503-166e74cdad8c'::uuid, 'Brooke Jackson', 'babblingbrookej', 200, 7, '', '', '+1 (706) 371-7136', '', '',
   'videos_in_progress', '2026-06-13'::date, null, '[]'::jsonb, '[{"url":"https://www.tiktok.com/view/product/1732415851201598450","name":"Acne Cream"}]'::jsonb, '{}'::jsonb, '2026-06-12T19:14:34.639603+00:00'::timestamptz),
  ('3338c10c-1438-489c-a269-d621a8d40cbd'::uuid, '0d5bbdb3-cae4-498c-8c0f-84b6d151628d'::uuid, 'Brooke Jackson', 'babblingbrookej', 150, 6, '', '', '+1 (706) 371-7136', '', '',
   'videos_in_progress', '2026-06-11'::date, null, '[]'::jsonb, '[{"url":"https://www.tiktok.com/view/product/1732411625941537120","name":"Turkish Towel"}]'::jsonb, '{}'::jsonb, '2026-06-10T23:08:18.150617+00:00'::timestamptz),
  ('96506d10-ca62-4a64-9e30-bf0586def95b'::uuid, '0d5bbdb3-cae4-498c-8c0f-84b6d151628d'::uuid, 'Simply Sarah', 'simplysarah.daily', 400, 5, '', '', '+1 (801) 404-3023', '', '',
   'videos_in_progress', '2026-06-12'::date, null, '[{"auth":false,"video":"","adCode":""},{"auth":false,"video":"","adCode":""},{"auth":false,"video":"","adCode":""},{"auth":false,"video":"","adCode":""},{"auth":false,"video":"","adCode":""}]'::jsonb, '[{"url":"https://www.tiktok.com/view/product/1732411625941537120","name":"Turkish Towel"}]'::jsonb, '{}'::jsonb, '2026-06-11T19:26:58.778905+00:00'::timestamptz),
  ('e0c6d4a5-20df-46f6-aa56-386fd624086b'::uuid, 'fa99918f-1ca0-453e-a503-166e74cdad8c'::uuid, 'Lexi Rushtaz', 'shopfinds311', 200, 10, '', '', '+1 (484) 602-6289', '', '',
   'videos_in_progress', '2026-06-15'::date, null, '[]'::jsonb, '[{"url":"https://www.tiktok.com/view/product/1732415851201598450","name":"Acne Cream"}]'::jsonb, '{}'::jsonb, '2026-06-15T15:52:56.10435+00:00'::timestamptz),
  ('fdf0b4ee-16c0-44fd-a05f-93c032b9e924'::uuid, '2809f3e3-39f4-4013-b730-97d49d6900ea'::uuid, 'Kirsten Brandt', 'kbrandt95', 200, 5, '', '', '+1 (319) 504-9345', '', '',
   'videos_in_progress', '2026-06-14'::date, null, '[]'::jsonb, '[{"url":"https://www.tiktok.com/view/product/1732415695607337872","name":"Kids Bamboo Viscose Pajama Set"}]'::jsonb, '{}'::jsonb, '2026-06-14T01:15:35.954629+00:00'::timestamptz),
  ('76ab2e63-a51d-404a-bbb6-ef6327a584f0'::uuid, 'fa99918f-1ca0-453e-a503-166e74cdad8c'::uuid, 'Elida', 'elidamazo87', 200, 5, '', '', '+1 (612) 203-6725', '', '',
   'videos_in_progress', '2026-06-16'::date, null, '[]'::jsonb, '[{"url":"https://www.tiktok.com/view/product/1732415851201598450","name":"Acne Cream"}]'::jsonb, '{}'::jsonb, '2026-06-16T13:06:18.052311+00:00'::timestamptz),
  ('4463cb6b-dd9a-41f0-8faa-6dd25079f729'::uuid, 'e52afd46-b43f-485d-a5cb-09c0d768d1c2'::uuid, 'Victoria Sternu', 'vsternau', 250, 8, '', '', '+1 (618) 910-7408', '', '',
   'videos_in_progress', '2026-06-13'::date, null, '[]'::jsonb, '[{"url":"https://www.tiktok.com/view/product/1732425131512337071","name":"TikTok Exclusive Bundle"}]'::jsonb, '{}'::jsonb, '2026-06-12T20:26:46.229041+00:00'::timestamptz),
  ('f20c5c83-107f-4da6-9a9e-1b3ca433fcf8'::uuid, '0d5bbdb3-cae4-498c-8c0f-84b6d151628d'::uuid, 'Victoria Sternu', 'vsternau', 200, 6, '', '', '+1 (618) 910-7408', '', '',
   'videos_in_progress', '2026-06-11'::date, null, '[]'::jsonb, '[{"url":"https://www.tiktok.com/view/product/1732411625941537120","name":"Turkish Towel"}]'::jsonb, '{}'::jsonb, '2026-06-10T23:07:38.975121+00:00'::timestamptz),
  ('9649fdd1-3146-4812-86f9-c4cc9784221d'::uuid, 'e52afd46-b43f-485d-a5cb-09c0d768d1c2'::uuid, 'Justin', '19battlecat82', 200, 6, '', '', '+1 (402) 202-8842', '', '',
   'videos_in_progress', '2026-06-13'::date, null, '[]'::jsonb, '[{"url":"https://www.tiktok.com/view/product/1732425131512337071","name":"TikTok Exclusive Bundle"}]'::jsonb, '{}'::jsonb, '2026-06-13T01:29:23.149467+00:00'::timestamptz),
  ('8e49ada7-9dce-4b13-8868-f05e6e44ac34'::uuid, '2809f3e3-39f4-4013-b730-97d49d6900ea'::uuid, 'Mandi', 'msmandilynne', 200, 4, '', '', '+1 (513) 509-0479', '', '',
   'videos_in_progress', '2026-06-16'::date, null, '[]'::jsonb, '[{"url":"https://www.tiktok.com/view/product/1732415695607337872","name":"Kids Bamboo Viscose Pajama Set"}]'::jsonb, '{}'::jsonb, '2026-06-16T13:22:46.433648+00:00'::timestamptz),
  ('f45de6ec-fddf-4fb6-9c3d-60ffe5b06cf5'::uuid, '0d5bbdb3-cae4-498c-8c0f-84b6d151628d'::uuid, 'Sandy Vela', 'sandy_vela', 200, 6, '', '', '+1 (818) 993-2135', '', '',
   'videos_in_progress', '2026-06-14'::date, null, '[{"auth":false,"video":"","adCode":""},{"auth":false,"video":"","adCode":""},{"auth":false,"video":"","adCode":""},{"auth":false,"video":"","adCode":""},{"auth":false,"video":"","adCode":""},{"auth":false,"video":"","adCode":""}]'::jsonb, '[{"url":"https://www.tiktok.com/view/product/1732411625941537120","name":"Turkish Towel"}]'::jsonb, '{}'::jsonb, '2026-06-14T01:22:10.369179+00:00'::timestamptz)
on conflict (id) do nothing;
