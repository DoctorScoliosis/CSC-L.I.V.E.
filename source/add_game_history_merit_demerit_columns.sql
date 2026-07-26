alter table public.game_history
    add column if not exists team_one_merit_points numeric default 0,
    add column if not exists team_one_merit_remarks text,
    add column if not exists team_one_demerit_points numeric default 0,
    add column if not exists team_one_demerit_remarks text,
    add column if not exists team_two_merit_points numeric default 0,
    add column if not exists team_two_merit_remarks text,
    add column if not exists team_two_demerit_points numeric default 0,
    add column if not exists team_two_demerit_remarks text;

update public.game_history
set
    team_one_merit_points = coalesce(team_one_merit_points, 0),
    team_one_demerit_points = coalesce(team_one_demerit_points, 0),
    team_two_merit_points = coalesce(team_two_merit_points, 0),
    team_two_demerit_points = coalesce(team_two_demerit_points, 0);

create index if not exists game_history_team_one_adjustments_idx
    on public.game_history(team_one_id, team_one_merit_points, team_one_demerit_points);

create index if not exists game_history_team_two_adjustments_idx
    on public.game_history(team_two_id, team_two_merit_points, team_two_demerit_points);
