-- Repair user_profiles writes rejected by RLS.
-- Run this once in the Supabase SQL Editor.

drop function if exists public.save_pending_user_profile(text, text, text, text);

create or replace function public.save_pending_user_profile(
    p_email text,
    p_full_name text,
    p_mobile_number text,
    p_role text,
    p_assigned_sport_id jsonb default null,
    p_assigned_sport_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    current_user_id uuid := auth.uid();
    normalized_role text := lower(trim(coalesce(p_role, '')));
    authenticated_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
    pending_profile public.user_profiles%rowtype;
begin
    if current_user_id is null then
        raise exception 'You must be logged in to create a profile.';
    end if;

    if normalized_role not in ('admin', 'committee') then
        raise exception 'Invalid dashboard role.';
    end if;

    if authenticated_email = ''
       or authenticated_email <> lower(trim(coalesce(p_email, ''))) then
        raise exception 'The authenticated email does not match the registered account.';
    end if;

    pending_profile := jsonb_populate_record(
        null::public.user_profiles,
        jsonb_build_object(
            'assigned_sport_id', p_assigned_sport_id,
            'assigned_sport_name', nullif(trim(coalesce(p_assigned_sport_name, '')), '')
        )
    );

    insert into public.user_profiles (
        id,
        email,
        full_name,
        mobile_number,
        role,
        approval_status,
        reviewed_at,
        reviewed_by,
        assigned_sport_id,
        assigned_sport_name
    )
    values (
        current_user_id,
        trim(p_email),
        trim(p_full_name),
        trim(p_mobile_number),
        normalized_role,
        'pending',
        null,
        null,
        pending_profile.assigned_sport_id,
        pending_profile.assigned_sport_name
    )
    on conflict (id)
    do update set
        email = excluded.email,
        full_name = excluded.full_name,
        mobile_number = excluded.mobile_number,
        role = excluded.role,
        assigned_sport_id = excluded.assigned_sport_id,
        assigned_sport_name = excluded.assigned_sport_name
    where lower(trim(public.user_profiles.approval_status)) = 'pending';

    return current_user_id;
end
$$;

create or replace function public.admin_set_account_approval_status(
    target_user_id uuid,
    next_status text
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    normalized_status text := lower(trim(coalesce(next_status, '')));
begin
    if not public.app_is_admin() then
        raise exception 'Only an approved admin can update account approvals.';
    end if;

    if target_user_id = auth.uid() then
        raise exception 'You cannot change the approval status of the account currently signed in.';
    end if;

    if normalized_status not in ('approved', 'hold', 'suspended') then
        raise exception 'Invalid account approval status.';
    end if;

    update public.user_profiles
    set
        approval_status = normalized_status,
        reviewed_at = now(),
        reviewed_by = auth.uid()
    where id = target_user_id;

    if not found then
        raise exception 'Account profile not found.';
    end if;
end
$$;

create or replace function public.admin_assign_account_sport(
    target_user_id uuid,
    assigned_sport_id jsonb,
    assigned_sport_name text
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    updated_profile public.user_profiles%rowtype;
begin
    if not public.app_is_admin() then
        raise exception 'Only an approved admin can assign account sports.';
    end if;

    updated_profile := jsonb_populate_record(
        null::public.user_profiles,
        jsonb_build_object(
            'assigned_sport_id', assigned_sport_id,
            'assigned_sport_name', nullif(trim(coalesce(assigned_sport_name, '')), '')
        )
    );

    update public.user_profiles
    set
        assigned_sport_id = updated_profile.assigned_sport_id,
        assigned_sport_name = updated_profile.assigned_sport_name
    where id = target_user_id;

    if not found then
        raise exception 'Account profile not found.';
    end if;
end
$$;

revoke all on function public.save_pending_user_profile(text, text, text, text, jsonb, text) from public;
revoke all on function public.admin_set_account_approval_status(uuid, text) from public;
revoke all on function public.admin_assign_account_sport(uuid, jsonb, text) from public;
grant execute on function public.save_pending_user_profile(text, text, text, text, jsonb, text) to authenticated;
grant execute on function public.admin_set_account_approval_status(uuid, text) to authenticated;
grant execute on function public.admin_assign_account_sport(uuid, jsonb, text) to authenticated;
