-- CSC Cup student registration support.
-- Run this in the Supabase SQL editor for the same project used by the dashboards.

create extension if not exists pgcrypto;

create table if not exists public.participants (
    id uuid primary key default gen_random_uuid(),
    name text,
    student_id text,
    team text,
    status text not null default 'pending',
    created_at timestamptz default now()
);

alter table public.participants
    add column if not exists full_name text,
    add column if not exists course text,
    add column if not exists age integer,
    add column if not exists id_number text,
    add column if not exists team_id text,
    add column if not exists team_name text,
    add column if not exists parent_consent_photo text,
    add column if not exists medical_certificate_photo text,
    add column if not exists reviewed_by text,
    add column if not exists reviewed_by_name text,
    add column if not exists reviewed_at timestamptz,
    add column if not exists rejection_reason text,
    add column if not exists updated_at timestamptz default now();

alter table public.participants
    drop constraint if exists participants_status_check;

alter table public.participants
    add constraint participants_status_check
    check (lower(status) in ('pending', 'approved', 'rejected'));

create unique index if not exists participants_id_number_unique
    on public.participants (id_number)
    where id_number is not null and id_number <> '';

create or replace function public.set_participants_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists participants_set_updated_at on public.participants;
create trigger participants_set_updated_at
before update on public.participants
for each row execute function public.set_participants_updated_at();

insert into storage.buckets (id, name, public)
values ('participant-documents', 'participant-documents', true)
on conflict (id) do update set public = true;

alter table public.participants enable row level security;

drop policy if exists "Public can submit participant registrations" on public.participants;
create policy "Public can submit participant registrations"
on public.participants
for insert
to anon, authenticated
with check (
    lower(coalesce(status, 'pending')) = 'pending'
);

drop policy if exists "Authenticated users can read participants" on public.participants;
create policy "Authenticated users can read participants"
on public.participants
for select
to authenticated
using (true);

drop policy if exists "Authenticated users can update participant review fields" on public.participants;
create policy "Authenticated users can update participant review fields"
on public.participants
for update
to authenticated
using (true)
with check (lower(status) in ('pending', 'approved', 'rejected'));

drop policy if exists "Public can upload participant documents" on storage.objects;
create policy "Public can upload participant documents"
on storage.objects
for insert
to anon, authenticated
with check (bucket_id = 'participant-documents');

drop policy if exists "Public can view participant documents" on storage.objects;
create policy "Public can view participant documents"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'participant-documents');

drop policy if exists "Authenticated users can update participant documents" on storage.objects;
create policy "Authenticated users can update participant documents"
on storage.objects
for update
to authenticated
using (bucket_id = 'participant-documents')
with check (bucket_id = 'participant-documents');
