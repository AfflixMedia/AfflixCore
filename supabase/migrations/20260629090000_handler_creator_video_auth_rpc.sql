-- =========================================================
-- Afflix Core — Paid Collab: let APCs toggle a video's "Authorised" flag
--
-- APCs view paid-collab data read-only (Brand Detail → Paid Collab tab), and they
-- are NOT covered by writes_paid_collab_brand() (bob / assigned handler only), so
-- they can't update handler_collab_creators directly. Rather than widen the table's
-- write RLS (which would expose amount, payment_status, etc.), this SECURITY DEFINER
-- RPC flips ONLY video_codes[index].auth, gated to staff who can already see the brand.
--
-- Allowed callers: bob or the assigned handler (writes_paid_collab_brand), OR internal
-- staff (apc / team_lead — is_internal_staff) who have access to the brand
-- (user_has_brand_access). Clients are excluded.
-- =========================================================

create or replace function public.set_handler_creator_video_auth(
  p_creator uuid, p_index int, p_auth boolean
)
returns void language plpgsql security definer set search_path = public as $$
declare
  b_id uuid;
  codes jsonb;
begin
  select brand_id, video_codes into b_id, codes
  from public.handler_collab_creators where id = p_creator;
  if b_id is null then raise exception 'creator not found'; end if;

  if not (public.writes_paid_collab_brand(b_id)
          or (public.is_internal_staff() and public.user_has_brand_access(b_id))) then
    raise exception 'not allowed';
  end if;

  if codes is null or jsonb_typeof(codes) <> 'array' then raise exception 'no videos'; end if;
  if p_index < 0 or p_index >= jsonb_array_length(codes) then raise exception 'bad video index'; end if;

  codes := jsonb_set(codes, array[p_index::text, 'auth'], to_jsonb(coalesce(p_auth, false)), true);
  update public.handler_collab_creators set video_codes = codes where id = p_creator;
end;
$$;

revoke all on function public.set_handler_creator_video_auth(uuid, int, boolean) from public;
grant execute on function public.set_handler_creator_video_auth(uuid, int, boolean) to authenticated;
