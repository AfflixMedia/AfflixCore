-- Multi-assignee tasks: when one task is assigned to several people it is stored
-- as one row PER person (so each keeps their own status / reminders), and the
-- rows created together share a `group_id`. The assigner (Bob / Team Lead) UI
-- collapses rows with the same group_id into a single combined card showing
-- per-person progress. APCs still see only their own single row.
--
-- Additive + nullable; existing single-assignee tasks keep group_id = null and
-- render exactly as before. No RLS change needed — group_id lives on `tasks`
-- and inherits the existing row policies.
alter table public.tasks add column if not exists group_id uuid;
create index if not exists tasks_group_id_idx on public.tasks (group_id);
