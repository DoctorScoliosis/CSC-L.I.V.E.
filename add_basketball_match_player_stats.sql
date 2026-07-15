create table if not exists public.basketball_match_player_stats (
    id uuid primary key default gen_random_uuid(),
    match_id bigint not null references public.scheduled_matches(id) on delete cascade,
    team_id bigint not null references public.sports_leaderboard(id) on delete cascade,
    team_name text not null,
    participant_id bigint null references public.participants(id) on delete set null,
    id_number text not null,
    player_name text,
    game_period integer not null default 1,
    is_active boolean not null default false,
    points numeric not null default 0,
    fouls integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint basketball_match_player_stats_period_check check (game_period between 1 and 5),
    constraint basketball_match_player_stats_unique_player_period unique (match_id, team_id, game_period, id_number),
    constraint basketball_match_player_stats_points_nonnegative check (points >= 0),
    constraint basketball_match_player_stats_fouls_nonnegative check (fouls >= 0)
);

alter table public.basketball_match_player_stats
    add column if not exists game_period integer not null default 1;

alter table public.basketball_match_player_stats
    add column if not exists is_active boolean not null default false;

alter table public.basketball_match_player_stats
    drop constraint if exists basketball_match_player_stats_unique_player;

with grouped as (
    select
        match_id,
        team_id,
        game_period,
        lower(trim(id_number)) as normalized_id_number,
        (array_agg(id order by created_at asc nulls last))[1] as keep_id,
        max(points) as merged_points,
        max(fouls) as merged_fouls
    from public.basketball_match_player_stats
    group by match_id, team_id, game_period, lower(trim(id_number))
    having count(*) > 1
),
latest_names as (
    select distinct on (match_id, team_id, game_period, lower(trim(id_number)))
        match_id,
        team_id,
        game_period,
        lower(trim(id_number)) as normalized_id_number,
        participant_id,
        player_name,
        id_number
    from public.basketball_match_player_stats
    order by match_id, team_id, game_period, lower(trim(id_number)), updated_at desc nulls last, created_at desc nulls last
)
update public.basketball_match_player_stats stats
set
    points = grouped.merged_points,
    fouls = grouped.merged_fouls,
    participant_id = latest_names.participant_id,
    player_name = coalesce(latest_names.player_name, stats.player_name),
    id_number = coalesce(latest_names.id_number, stats.id_number),
    updated_at = now()
from grouped
left join latest_names
    on latest_names.match_id = grouped.match_id
    and latest_names.team_id = grouped.team_id
    and latest_names.game_period = grouped.game_period
    and latest_names.normalized_id_number = grouped.normalized_id_number
where stats.id = grouped.keep_id;

with ranked as (
    select
        id,
        row_number() over (
            partition by match_id, team_id, game_period, lower(trim(id_number))
            order by created_at asc nulls last, updated_at asc nulls last
        ) as duplicate_rank
    from public.basketball_match_player_stats
)
delete from public.basketball_match_player_stats stats
using ranked
where stats.id = ranked.id
    and ranked.duplicate_rank > 1;

alter table public.basketball_match_player_stats
    drop constraint if exists basketball_match_player_stats_period_check;

alter table public.basketball_match_player_stats
    add constraint basketball_match_player_stats_period_check
    check (game_period between 1 and 5);

alter table public.basketball_match_player_stats
    drop constraint if exists basketball_match_player_stats_unique_player_period;

alter table public.basketball_match_player_stats
    add constraint basketball_match_player_stats_unique_player_period
    unique (match_id, team_id, game_period, id_number);

create index if not exists basketball_match_player_stats_match_idx
    on public.basketball_match_player_stats(match_id);

create index if not exists basketball_match_player_stats_team_idx
    on public.basketball_match_player_stats(team_id);

create index if not exists basketball_match_player_stats_period_idx
    on public.basketball_match_player_stats(match_id, team_id, game_period);

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
