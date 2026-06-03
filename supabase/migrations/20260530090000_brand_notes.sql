-- =========================================================
-- Afflix Core — free-text notes per brand
-- =========================================================

alter table public.brands
  add column if not exists notes text;
