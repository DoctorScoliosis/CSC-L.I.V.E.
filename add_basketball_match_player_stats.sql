create table if not exists public.basketball_match_player_stats (
    id uuid primary key default gen_random_uuid(),
    match_id bigint not null references public.scheduled_matches(id) on delete cascade,
    team_id bigint not null references public.sports_leaderboard(id) on delete cascade,
    team_name text not null,
    participant_id uuid null references public.participants(id) on delete set null,
    id_number text not null,
    player_name text,
    points numeric not null default 0,
    fouls integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint basketball_match_player_stats_unique_player unique (match_id, team_id, id_number),
    constraint basketball_match_player_stats_points_nonnegative check (points >= 0),
    constraint basketball_match_player_stats_fouls_nonnegative check (fouls >= 0)
);

create index if not exists basketball_match_player_stats_match_idx
    on public.basketball_match_player_stats(match_id);

create index if not exists basketball_match_player_stats_team_idx
    on public.basketball_match_player_stats(team_id);

alter table public.basketball_match_player_stats enable row level security;

drop policy if exists "Basketball stats are readable by dashboard users" on public.basketball_match_player_stats;
create policy "Basketball stats are readable by dashboard users"
on public.basketball_match_player_stats
for select
to authenticated, anon
using (true);

drop policy if exists "Committee and admin can insert basketball stats" on public.basketball_match_player_stats;
create policy "Committee and admin can insert basketball stats"
on public.basketball_match_player_stats
for insert
to authenticated, anon
with check (true);

drop policy if exists "Committee and admin can update basketball stats" on public.basketball_match_player_stats;
create policy "Committee and admin can update basketball stats"
on public.basketball_match_player_stats
for update
to authenticated, anon
using (true)
with check (true);

drop policy if exists "Committee and admin can delete basketball stats" on public.basketball_match_player_stats;
create policy "Committee and admin can delete basketball stats"
on public.basketball_match_player_stats
for delete
to authenticated, anon
using (true);

do $$
begin
    alter publication supabase_realtime add table public.basketball_match_player_stats;
exception
    when duplicate_object then null;
    when undefined_object then null;
end $$;
