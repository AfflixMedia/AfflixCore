-- =========================================================
-- Backfill: mirror existing report_approval_decisions into report_comments
-- so the new approval-section comment thread shows pre-existing decisions.
-- New decisions are mirrored automatically by the post-approval-decision
-- edge function — this migration only handles legacy rows.
-- =========================================================

insert into public.report_comments
  (report_id, section, author_type, author_name, body, parent_id, created_at)
select
  rad.report_id,
  'approval',
  'client',
  rad.decided_by_name,
  case
    when rad.decision = 'approved' then
      case when rad.comment is not null and length(trim(rad.comment)) > 0
        then '[Approved] ' || rad.comment
        else '[Approved]'
      end
    else
      case when rad.comment is not null and length(trim(rad.comment)) > 0
        then '[Requested changes] ' || rad.comment
        else '[Requested changes]'
      end
  end,
  null,
  rad.decided_at
from public.report_approval_decisions rad
where not exists (
  select 1 from public.report_comments rc
  where rc.report_id  = rad.report_id
    and rc.section    = 'approval'
    and rc.author_name = rad.decided_by_name
);
