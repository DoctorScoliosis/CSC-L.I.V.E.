-- Run this once in the Supabase SQL Editor before using tournament labels
-- and live basketball quarter / volleyball set controls.

alter table public.scheduled_matches
    add column if not exists match_stage text not null default 'regular',
    add column if not exists game_period integer;

alter table public.scheduled_matches
    drop constraint if exists scheduled_matches_match_stage_check;

alter table public.scheduled_matches
    add constraint scheduled_matches_match_stage_check
    check (match_stage in ('regular', 'semifinals', 'finals', 'battle_for_third'));

alter table public.scheduled_matches
    drop constraint if exists scheduled_matches_game_period_check;

alter table public.scheduled_matches
    add constraint scheduled_matches_game_period_check
    check (game_period is null or game_period between 1 and 5);
