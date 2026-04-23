-- =========================================================
-- Afflix Core - Report schema v2 migration
-- Adds new comment section values (video_performance, shop_health)
-- Run AFTER schema_comments.sql
-- =========================================================

alter table public.report_comments
  drop constraint if exists report_comments_section_check;

alter table public.report_comments
  add constraint report_comments_section_check
  check (section in (
    'overall','top_creators','top_videos','video_performance',
    'gmv_max','product_highlights','shop_health','insights'
  ));
