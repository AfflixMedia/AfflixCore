-- =========================================================
-- Afflix Core — authenticated paid-collab client comments
--
-- The public share link lets a client post comments via the
-- post-shared-paidcollab-comment edge function (service role, token-validated).
-- The signed-in paid_collab_client portal has no token, and the pcc_insert RLS
-- policy only allows bob / handler / apc to insert — so a logged-in client could
-- READ discussions but not reply.
--
-- This adds a SECURITY DEFINER RPC that lets a signed-in client (with brand
-- access) post a comment as author_type='client', and fans out the same
-- notification to the brand's assigned handler(s) that the edge function does.
-- =========================================================

create or replace function public.post_client_paidcollab_comment(
  p_brand   uuid,
  p_tt      text,
  p_tk      text,
  p_body    text,
  p_parent  uuid default null
)
returns public.paid_collab_comments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_name   text;
  v_brand  text;
  v_row    public.paid_collab_comments;
  v_body   text := left(btrim(p_body), 4000);
  v_tk     text := coalesce(p_tk, '');
  v_link   text;
  v_title  text;
  v_text   text;
  v_label  text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if not public.user_has_brand_access(p_brand) then
    raise exception 'No access to this brand';
  end if;
  if p_tt not in ('brand','program','week','creator','insights','kpi') then
    raise exception 'Invalid target_type';
  end if;
  if v_body = '' then
    raise exception 'Empty comment';
  end if;

  -- A creator thread must reference a creator that belongs to this brand.
  if p_tt = 'creator' and not exists (
    select 1 from public.handler_collab_creators c where c.id::text = v_tk and c.brand_id = p_brand
  ) then
    raise exception 'Invalid creator';
  end if;

  -- A reply's parent must live on the same brand + thread.
  if p_parent is not null and not exists (
    select 1 from public.paid_collab_comments p
    where p.id = p_parent and p.brand_id = p_brand and p.target_type = p_tt and p.target_key = v_tk
  ) then
    raise exception 'Invalid parent';
  end if;

  select coalesce(full_name, email, 'Client') into v_name from public.profiles where id = v_uid;
  select name into v_brand from public.brands where id = p_brand;

  insert into public.paid_collab_comments
    (brand_id, target_type, target_key, author_type, author_id, author_name, body, parent_id)
  values
    (p_brand, p_tt, v_tk, 'client', v_uid, coalesce(v_name, 'Client'), v_body, p_parent)
  returning * into v_row;

  -- Notify the brand's assigned paid-collab handler(s) — paid collab is their domain.
  v_label := case p_tt when 'brand' then 'Brand' when 'program' then 'Program' when 'week' then 'Week'
                       when 'creator' then 'Creator' when 'insights' then 'Insights' else 'KPI' end;
  v_title := 'New comment on ' || coalesce(v_brand, 'a brand') || ' (Paid Collab)';
  v_text  := coalesce(v_name, 'Client') || ' commented on ' || v_label || ': "'
             || left(v_body, 140) || (case when length(v_body) > 140 then '…' else '' end) || '"';
  v_link  := '/paid-collab?brand=' || p_brand::text || '&tt=' || p_tt || '&tk=' || v_tk || '&pcc=' || v_row.id::text;

  insert into public.notifications (user_id, type, title, body, link, payload)
  select pchb.handler_id, 'paid_collab_comment', v_title, v_text, v_link,
         jsonb_build_object('brand_id', p_brand, 'target_type', p_tt, 'target_key', v_tk, 'comment_id', v_row.id)
  from public.paid_collab_handler_brands pchb
  where pchb.brand_id = p_brand;

  return v_row;
end;
$$;

grant execute on function public.post_client_paidcollab_comment(uuid, text, text, text, uuid) to authenticated;


-- =========================================================
-- Staff (handler/bob/apc) comment → notify the brand's assigned client(s).
--
-- Staff post comments via a direct RLS insert (store.addComment) which never
-- notified anyone. This trigger fans a notification out to the paid-collab
-- client(s) of the brand whenever a STAFF comment lands, with the same
-- click-through link the handler gets — so the client is pinged and can jump
-- straight to the thread. Client comments (author_type='client') are skipped
-- here (they notify the handler via the RPC / edge function instead), so there
-- is no double-notify.
-- =========================================================
create or replace function public.tg_paid_collab_comment_notify_client()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_brand text;
  v_label text;
  v_title text;
  v_text  text;
  v_link  text;
begin
  if NEW.author_type in ('handler','bob','apc') then
    select name into v_brand from public.brands where id = NEW.brand_id;
    v_label := case NEW.target_type when 'brand' then 'Brand' when 'program' then 'Program'
                 when 'week' then 'Week' when 'creator' then 'Creator'
                 when 'insights' then 'Insights' else 'KPI' end;
    v_title := 'New reply on ' || coalesce(v_brand, 'a brand') || ' (Paid Collab)';
    v_text  := NEW.author_name || ' commented on ' || v_label || ': "'
               || left(NEW.body, 140) || (case when length(NEW.body) > 140 then '…' else '' end) || '"';
    v_link  := '/paid-collab?brand=' || NEW.brand_id::text || '&tt=' || NEW.target_type
               || '&tk=' || NEW.target_key || '&pcc=' || NEW.id::text;
    insert into public.notifications (user_id, type, title, body, link, payload)
    select pcb.client_id, 'paid_collab_comment', v_title, v_text, v_link,
           jsonb_build_object('brand_id', NEW.brand_id, 'target_type', NEW.target_type,
                              'target_key', NEW.target_key, 'comment_id', NEW.id)
    from public.paid_collab_client_brands pcb
    where pcb.brand_id = NEW.brand_id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists paid_collab_comment_notify_client on public.paid_collab_comments;
create trigger paid_collab_comment_notify_client
  after insert on public.paid_collab_comments
  for each row execute function public.tg_paid_collab_comment_notify_client();


-- =========================================================
-- Authenticated client "mark payment as done" — soft confirmation by the
-- signed-in client that they processed a creator's PayPal payment. Mirrors the
-- public share edge function post-shared-paidcollab-paid: sets
-- client_paid_confirmed_at/_name (NOT payment_status) and notifies the brand's
-- handler(s). Clients can't UPDATE handler_collab_creators via RLS, so this runs
-- SECURITY DEFINER with an explicit brand-access check.
-- =========================================================
create or replace function public.set_client_paidcollab_paid(
  p_creator   uuid,
  p_confirmed boolean
)
returns public.handler_collab_creators
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_name     text;
  v_brand_id uuid;
  v_cname    text;
  v_brand    text;
  v_month    text;
  v_row      public.handler_collab_creators;
  v_title    text;
  v_text     text;
  v_link     text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select brand_id, name into v_brand_id, v_cname from public.handler_collab_creators where id = p_creator;
  if v_brand_id is null then raise exception 'Invalid creator'; end if;
  if not public.user_has_brand_access(v_brand_id) then raise exception 'No access to this brand'; end if;

  select coalesce(full_name, email, 'Client') into v_name from public.profiles where id = v_uid;

  update public.handler_collab_creators
    set client_paid_confirmed_at   = case when p_confirmed then now() else null end,
        client_paid_confirmed_name = case when p_confirmed then coalesce(v_name, 'Client') else null end
    where id = p_creator
    returning * into v_row;

  if p_confirmed then
    select name into v_brand from public.brands where id = v_brand_id;
    v_month := coalesce(to_char(v_row.onboarded_on, 'YYYY-MM'), '');
    v_title := coalesce(v_name, 'Client') || ' marked a payment as done (Paid Collab)';
    v_text  := coalesce(v_name, 'Client') || ' confirmed paying ' || coalesce(v_cname, 'a creator')
               || ' on ' || coalesce(v_brand, 'a brand') || '. Please cross-check and update the status.';
    v_link  := '/paid-collab?brand=' || v_brand_id::text || '&pay=1'
               || (case when v_month <> '' then '&month=' || v_month else '' end);
    insert into public.notifications (user_id, type, title, body, link, payload)
    select pchb.handler_id, 'paid_collab_client_paid', v_title, v_text, v_link,
           jsonb_build_object('brand_id', v_brand_id, 'creator_id', p_creator, 'kind', 'client_marked_paid')
    from public.paid_collab_handler_brands pchb
    where pchb.brand_id = v_brand_id;
  end if;

  return v_row;
end;
$$;

grant execute on function public.set_client_paidcollab_paid(uuid, boolean) to authenticated;
