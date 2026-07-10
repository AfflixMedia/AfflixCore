-- =========================================================
-- Afflix Core — Task review workflow: "Submit for review"
--
-- Assignees no longer complete a task directly. New flow:
--   open → in_progress → in_review   (assignee clicks "Submit for review")
--   in_review → done                 (assigner ACCEPTS)
--   in_review → in_progress          (assigner REJECTS, optional review_note)
-- Self-assigned tasks (creator = assignee, or no creator) skip review — the
-- UI still offers straight-to-done for those; the DB allows any transition
-- (the workflow is a UI rule, like assignee-only status).
--
-- ADDITIVE: widens the status CHECK, adds tasks.review_note, re-creates
-- tasks_notify to cover the new transitions:
--   → in_review                  : notify the creator ("submitted for review")
--   in_review → done             : notify the assignee ("accepted")
--   in_review → open/in_progress : notify the assignee ("sent back" + note)
--   → done (not from in_review)  : unchanged (notify creator — self/legacy path)
-- =========================================================

alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks
  add constraint tasks_status_check check (status in ('open', 'in_progress', 'in_review', 'done'));

alter table public.tasks add column if not exists review_note text;

create or replace function public.tasks_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text; v_brand text;
begin
  if TG_OP = 'INSERT' then
    select coalesce(nullif(full_name,''), email) into v_name from public.profiles where id = new.created_by;
    select name into v_brand from public.brands where id = new.brand_id;
    if new.assignee_id <> coalesce(new.created_by, '00000000-0000-0000-0000-000000000000') then
      insert into public.notifications (user_id, type, title, body, link, payload)
      values (new.assignee_id, 'task',
              coalesce(v_name,'Your Team Lead') || ' assigned you a task',
              new.title
                || case when v_brand is not null then ' · ' || v_brand else '' end
                || case when new.due_date is not null then ' (due ' || to_char(new.due_date,'Mon DD') || ')' else '' end,
              '/tasks',
              jsonb_build_object('task_id', new.id, 'brand_id', new.brand_id, 'kind', 'assigned'));
    end if;
    return new;
  elsif TG_OP = 'UPDATE' then
    -- Assignee submitted for review → tell the assigner.
    if new.status = 'in_review' and old.status is distinct from 'in_review'
       and new.created_by is not null and new.created_by <> new.assignee_id then
      select coalesce(nullif(full_name,''), email) into v_name from public.profiles where id = new.assignee_id;
      insert into public.notifications (user_id, type, title, body, link, payload)
      values (new.created_by, 'task',
              coalesce(v_name,'An APC') || ' submitted a task for review',
              new.title,
              '/tasks',
              jsonb_build_object('task_id', new.id, 'kind', 'submitted'));
    -- Assigner accepted (review → done) → tell the assignee.
    elsif new.status = 'done' and old.status = 'in_review'
       and new.created_by is not null and new.created_by <> new.assignee_id then
      select coalesce(nullif(full_name,''), email) into v_name from public.profiles where id = new.created_by;
      insert into public.notifications (user_id, type, title, body, link, payload)
      values (new.assignee_id, 'task',
              coalesce(v_name,'Your Team Lead') || ' accepted your task',
              new.title,
              '/tasks',
              jsonb_build_object('task_id', new.id, 'kind', 'accepted'));
    -- Assigner rejected (review → open/in_progress) → tell the assignee.
    elsif new.status in ('open','in_progress') and old.status = 'in_review'
       and new.created_by is not null and new.created_by <> new.assignee_id then
      select coalesce(nullif(full_name,''), email) into v_name from public.profiles where id = new.created_by;
      insert into public.notifications (user_id, type, title, body, link, payload)
      values (new.assignee_id, 'task',
              coalesce(v_name,'Your Team Lead') || ' sent a task back',
              new.title || coalesce(' — ' || nullif(new.review_note,''), ''),
              '/tasks',
              jsonb_build_object('task_id', new.id, 'kind', 'rejected'));
    -- Direct completion (self-assigned / legacy path) → tell the creator.
    elsif new.status = 'done' and old.status is distinct from 'done'
       and new.created_by is not null and new.created_by <> new.assignee_id then
      select coalesce(nullif(full_name,''), email) into v_name from public.profiles where id = new.assignee_id;
      insert into public.notifications (user_id, type, title, body, link, payload)
      values (new.created_by, 'task',
              coalesce(v_name,'An APC') || ' completed a task',
              new.title,
              '/tasks',
              jsonb_build_object('task_id', new.id, 'kind', 'completed'));
    end if;
    return new;
  end if;
  return new;
end;
$$;
