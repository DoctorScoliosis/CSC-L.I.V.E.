-- Fix student feedback submissions rejected by an outdated feedback type check.
-- Run this once in the Supabase SQL Editor.

begin;

alter table public.student_feedback
drop constraint if exists student_feedback_feedback_type_check;

-- NOT VALID keeps older rows readable even if a previous version stored a
-- different label. PostgreSQL still enforces this rule for every new insert.
alter table public.student_feedback
add constraint student_feedback_feedback_type_check
check (
    lower(trim(feedback_type)) in ('recommendation', 'concern')
)
not valid;

commit;

-- Confirm the installed definition.
select
    constraint_name,
    check_clause
from information_schema.check_constraints
where constraint_schema = 'public'
  and constraint_name = 'student_feedback_feedback_type_check';
