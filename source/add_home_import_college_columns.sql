alter table public.participants
    add column if not exists home_college text,
    add column if not exists home_college_id bigint,
    add column if not exists import_college text,
    add column if not exists import_college_id bigint;

alter table public.attendance
    add column if not exists home_college text;

update public.participants
set home_college = coalesce(nullif(trim(home_college), ''), nullif(trim(team_name), ''), nullif(trim(team), ''))
where home_college is null or trim(home_college) = '';

update public.participants
set import_college = coalesce(nullif(trim(import_college), ''), nullif(trim(team_name), ''), nullif(trim(team), ''))
where coalesce(is_import, false) = true
  and (import_college is null or trim(import_college) = '');

update public.attendance
set home_college = coalesce(nullif(trim(home_college), ''), nullif(trim(team), ''))
where home_college is null or trim(home_college) = '';

create index if not exists participants_home_college_idx
    on public.participants(home_college);

create index if not exists participants_import_college_idx
    on public.participants(import_college);

create index if not exists attendance_home_college_date_idx
    on public.attendance(home_college, attendance_date);
