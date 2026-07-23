alter table public.sports
    add column if not exists player_limit integer;

alter table public.sports
    drop constraint if exists sports_player_limit_check;

alter table public.sports
    add constraint sports_player_limit_check
    check (player_limit is null or player_limit > 0);

create or replace view public.registration_slot_counts as
with participant_sports as (
    select
        p.id,
        p.team_id::text as team_id,
        coalesce(nullif(trim(p.team_name), ''), nullif(trim(p.team), ''), nullif(trim(p.import_college), ''), nullif(trim(p.home_college), '')) as team_name,
        trim(sport_id) as sport_id
    from public.participants p
    cross join lateral regexp_split_to_table(coalesce(p.major_sport_id, '') || ',' || coalesce(p.minor_sport_id, ''), ',') as sport_id
    where lower(coalesce(p.status, 'pending')) <> 'rejected'
)
select
    sport_id,
    team_id,
    team_name,
    count(*)::integer as registered_count
from participant_sports
where sport_id <> ''
group by sport_id, team_id, team_name;

grant select on public.registration_slot_counts to anon, authenticated;
