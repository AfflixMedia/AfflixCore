-- Per-deal deliverable deadline (Paid Collab contract PDF)
--
-- §2 Deliverables states "Complete the deliverables within N days after the
-- sample has been delivered." N used to be derived from the video count
-- (<6 → 10 days, else 14). The handler can now override it per creator;
-- null keeps the automatic rule.
--
-- No RLS change — rides the existing handler_collab_creators policies.

alter table public.handler_collab_creators
  add column if not exists deliverable_days integer;

comment on column public.handler_collab_creators.deliverable_days is
  'Contract §2 completion window in days after sample delivery. Null = automatic (10 for <6 videos, 14 otherwise).';
