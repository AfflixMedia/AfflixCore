-- =========================================================
-- Afflix Core — Paid Collab Performance: let Bob/APCs edit a creator's GMV numbers.
--
-- The Performance tab edits handler_collab_creators.monthly (per-month + per-week
-- GMV / Ad Spent / L30). Direct table writes are gated by writes_paid_collab_brand()
-- = bob or the assigned handler, so APCs (who view paid collab read-only) can't write
-- it. Rather than widen the table's write RLS — which would also expose amount,
-- payment_status, paypal/zelle, etc. — this SECURITY DEFINER RPC updates ONLY the
-- `monthly` jsonb, gated to staff who can already edit the brand's paid collab
-- (bob / assigned handler via writes_paid_collab_brand) OR internal staff
-- (apc / team_lead via is_internal_staff) who have access to the brand
-- (user_has_brand_access). Clients are excluded. Mirrors set_handler_creator_video_auth.
-- =========================================================

create or replace function public.set_handler_creator_monthly(
  p_creator uuid, p_monthly jsonb
)
returns void language plpgsql security definer set search_path = public as $$
declare
  b_id uuid;
begin
  select brand_id into b_id
  from public.handler_collab_creators where id = p_creator;
  if b_id is null then raise exception 'creator not found'; end if;

  if not (public.writes_paid_collab_brand(b_id)
          or (public.is_internal_staff() and public.user_has_brand_access(b_id))) then
    raise exception 'not allowed';
  end if;

  if p_monthly is null or jsonb_typeof(p_monthly) <> 'object' then
    raise exception 'monthly must be a json object';
  end if;

  update public.handler_collab_creators set monthly = p_monthly where id = p_creator;
end;
$$;

revoke all on function public.set_handler_creator_monthly(uuid, jsonb) from public;
grant execute on function public.set_handler_creator_monthly(uuid, jsonb) to authenticated;
