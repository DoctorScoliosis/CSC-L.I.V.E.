-- Restore secure RLS policies for the CSC L.I.V.E. application.
-- Run this once in the Supabase SQL Editor.
-- Review the comments before running in production.

begin;

-- Helper functions run with the function owner's privileges so profile checks do
-- not recurse through user_profiles RLS policies.
create or replace function public.app_profile_role(user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
    select lower(trim(coalesce(role, '')))
    from public.user_profiles
    where id = user_id
    limit 1
$$;

create or replace function public.app_profile_is_approved(user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(lower(trim(approval_status)) = 'approved', false)
    from public.user_profiles
    where id = user_id
    limit 1
$$;

create or replace function public.app_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(
        public.app_profile_role(auth.uid()) = 'admin'
        and public.app_profile_is_approved(auth.uid()),
        false
    )
$$;

create or replace function public.app_is_dashboard_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(
        public.app_profile_role(auth.uid()) in ('admin', 'committee')
        and public.app_profile_is_approved(auth.uid()),
        false
    )
$$;

create or replace function public.app_can_read_conversation(conversation_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.conversations conversation_record
        where conversation_record.id = conversation_uuid
          and auth.uid() in (conversation_record.created_by, conversation_record.receiver_id)
    )
$$;

create or replace function public.app_can_send_conversation_message(
    conversation_uuid uuid,
    message_receiver uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.conversations conversation_record
        where conversation_record.id = conversation_uuid
          and (
              (
                  auth.uid() = conversation_record.created_by
                  and message_receiver = conversation_record.receiver_id
              )
              or
              (
                  auth.uid() = conversation_record.receiver_id
                  and message_receiver = conversation_record.created_by
              )
          )
    )
$$;

revoke all on function public.app_profile_role(uuid) from public;
revoke all on function public.app_profile_is_approved(uuid) from public;
revoke all on function public.app_is_admin() from public;
revoke all on function public.app_is_dashboard_user() from public;
revoke all on function public.app_can_read_conversation(uuid) from public;
revoke all on function public.app_can_send_conversation_message(uuid, uuid) from public;
grant execute on function public.app_profile_role(uuid) to authenticated;
grant execute on function public.app_profile_is_approved(uuid) to authenticated;
grant execute on function public.app_is_admin() to authenticated;
grant execute on function public.app_is_dashboard_user() to authenticated;
grant execute on function public.app_can_read_conversation(uuid) to authenticated;
grant execute on function public.app_can_send_conversation_message(uuid, uuid) to authenticated;

alter table public.announcements enable row level security;
alter table public.conversations enable row level security;
alter table public.game_history enable row level security;
alter table public.messages enable row level security;
alter table public.scheduled_matches enable row level security;
alter table public.student_feedback enable row level security;
alter table public.user_profiles enable row level security;

create table if not exists public.conversation_user_settings (
    conversation_id uuid not null references public.conversations(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    hidden_at timestamptz,
    primary key (conversation_id, user_id)
);

alter table public.conversation_user_settings enable row level security;

-- Remove existing policies on these tables to avoid keeping an older permissive
-- policy active alongside the secure replacements below.
do $$
declare
    policy_record record;
begin
    for policy_record in
        select schemaname, tablename, policyname
        from pg_policies
        where schemaname = 'public'
          and tablename = any(array[
              'announcements',
              'conversations',
              'game_history',
              'messages',
              'scheduled_matches',
              'student_feedback',
              'user_profiles'
          ])
    loop
        execute format(
            'drop policy if exists %I on %I.%I',
            policy_record.policyname,
            policy_record.schemaname,
            policy_record.tablename
        );
    end loop;
end
$$;

-- user_profiles -------------------------------------------------------------
-- Users can read their own profile after authentication. Approved dashboard
-- users can see approved admin/committee contact profiles for messaging.
create policy "Users can read own profile"
on public.user_profiles for select
to authenticated
using (id = auth.uid());

create policy "Dashboard users can read approved contacts"
on public.user_profiles for select
to authenticated
using (
    public.app_is_dashboard_user()
    and lower(trim(role)) in ('admin', 'committee')
    and lower(trim(approval_status)) = 'approved'
);

create policy "Admins can read all profiles"
on public.user_profiles for select
to authenticated
using (public.app_is_admin());

-- New users may create only their own pending profile. Approval and role
-- management remain admin-controlled after registration.
create policy "Users can create own pending profile"
on public.user_profiles for insert
to authenticated
with check (
    id = auth.uid()
    and lower(trim(role)) in ('admin', 'committee')
    and lower(trim(approval_status)) = 'pending'
);

create policy "Admins can update profiles"
on public.user_profiles for update
to authenticated
using (public.app_is_admin())
with check (public.app_is_admin());

create policy "Admins can delete profiles"
on public.user_profiles for delete
to authenticated
using (public.app_is_admin());

-- announcements -------------------------------------------------------------
-- Students use the anon key. Public reads expose active announcements only.
-- The frontend filters the intended audience (all/students/committee).
create policy "Public can read active announcements"
on public.announcements for select
to anon, authenticated
using (is_active = true);

create policy "Admins can read all announcements"
on public.announcements for select
to authenticated
using (public.app_is_admin());

create policy "Admins can create announcements"
on public.announcements for insert
to authenticated
with check (public.app_is_admin());

create policy "Admins can update announcements"
on public.announcements for update
to authenticated
using (public.app_is_admin())
with check (public.app_is_admin());

create policy "Admins can delete announcements"
on public.announcements for delete
to authenticated
using (public.app_is_admin());

-- scheduled_matches ---------------------------------------------------------
-- Match schedules are public viewing data. Approved committee/admin accounts
-- can create matches. Committee members can edit only matches they created.
create policy "Public can read scheduled matches"
on public.scheduled_matches for select
to anon, authenticated
using (true);

create policy "Dashboard users can create matches"
on public.scheduled_matches for insert
to authenticated
with check (
    public.app_is_dashboard_user()
    and (
        public.app_is_admin()
        or created_by::text = auth.uid()::text
    )
);

create policy "Admins can update all matches"
on public.scheduled_matches for update
to authenticated
using (public.app_is_admin())
with check (public.app_is_admin());

create policy "Committee can update own matches"
on public.scheduled_matches for update
to authenticated
using (
    public.app_profile_role(auth.uid()) = 'committee'
    and public.app_profile_is_approved(auth.uid())
    and created_by::text = auth.uid()::text
)
with check (
    public.app_profile_role(auth.uid()) = 'committee'
    and public.app_profile_is_approved(auth.uid())
    and created_by::text = auth.uid()::text
);

-- Match deletion stays admin-only because committee deletions use the
-- delete-request workflow.
create policy "Admins can delete matches"
on public.scheduled_matches for delete
to authenticated
using (public.app_is_admin());

-- game_history --------------------------------------------------------------
-- Results are public viewing data. Admins can manage all results. Committee
-- members can manage history only for a match they created.
create policy "Public can read game history"
on public.game_history for select
to anon, authenticated
using (true);

create policy "Dashboard users can create owned game history"
on public.game_history for insert
to authenticated
with check (
    public.app_is_admin()
    or (
        public.app_profile_role(auth.uid()) = 'committee'
        and public.app_profile_is_approved(auth.uid())
        and exists (
            select 1
            from public.scheduled_matches match_record
            where match_record.id = game_history.match_id
              and match_record.created_by::text = auth.uid()::text
        )
    )
);

create policy "Dashboard users can update owned game history"
on public.game_history for update
to authenticated
using (
    public.app_is_admin()
    or (
        public.app_profile_role(auth.uid()) = 'committee'
        and public.app_profile_is_approved(auth.uid())
        and exists (
            select 1
            from public.scheduled_matches match_record
            where match_record.id = game_history.match_id
              and match_record.created_by::text = auth.uid()::text
        )
    )
)
with check (
    public.app_is_admin()
    or (
        public.app_profile_role(auth.uid()) = 'committee'
        and public.app_profile_is_approved(auth.uid())
        and exists (
            select 1
            from public.scheduled_matches match_record
            where match_record.id = game_history.match_id
              and match_record.created_by::text = auth.uid()::text
        )
    )
);

create policy "Admins can delete game history"
on public.game_history for delete
to authenticated
using (public.app_is_admin());

-- student_feedback ----------------------------------------------------------
-- Students submit anonymously. Only approved admins can read or manage the
-- submitted records.
create policy "Public can submit new feedback"
on public.student_feedback for insert
to anon, authenticated
with check (coalesce(status, 'New') = 'New');

create policy "Admins can read feedback"
on public.student_feedback for select
to authenticated
using (public.app_is_admin());

create policy "Admins can update feedback"
on public.student_feedback for update
to authenticated
using (public.app_is_admin())
with check (public.app_is_admin());

create policy "Admins can delete feedback"
on public.student_feedback for delete
to authenticated
using (public.app_is_admin());

-- conversations -------------------------------------------------------------
-- A conversation is private to its two participants.
create policy "Participants can read own conversations"
on public.conversations for select
to authenticated
using (
    public.app_is_dashboard_user()
    and auth.uid() in (created_by, receiver_id)
);

create policy "Users can create own conversations"
on public.conversations for insert
to authenticated
with check (
    public.app_is_dashboard_user()
    and created_by = auth.uid()
    and public.app_profile_role(auth.uid()) = lower(trim(sender_role))
    and public.app_profile_role(receiver_id) = lower(trim(receiver_role))
    and lower(trim(sender_role)) in ('admin', 'committee')
    and lower(trim(receiver_role)) in ('admin', 'committee')
);

create policy "Participants can update own conversations"
on public.conversations for update
to authenticated
using (
    public.app_is_dashboard_user()
    and auth.uid() in (created_by, receiver_id)
)
with check (
    public.app_is_dashboard_user()
    and auth.uid() in (created_by, receiver_id)
);

-- messages ------------------------------------------------------------------
-- Messages are visible only inside conversations owned by the current user.
create policy "Participants can read own messages"
on public.messages for select
to authenticated
using (
    public.app_is_dashboard_user()
    and public.app_can_read_conversation(messages.conversation_id)
);

create policy "Users can send own messages"
on public.messages for insert
to authenticated
with check (
    sender_id = auth.uid()
    and lower(trim(sender_role)) in ('admin', 'committee')
    and lower(trim(receiver_role)) in ('admin', 'committee')
    and (
        length(trim(coalesce(message_text, ''))) > 0
        or attachment_url is not null
    )
    and public.app_can_send_conversation_message(messages.conversation_id, receiver_id)
);

create policy "Receivers can mark own messages read"
on public.messages for update
to authenticated
using (receiver_id = auth.uid())
with check (
    receiver_id = auth.uid()
    and is_read = true
);

-- Grants --------------------------------------------------------------------
grant select on table public.announcements to anon, authenticated;
grant insert, update, delete on table public.announcements to authenticated;

grant select on table public.scheduled_matches to anon, authenticated;
grant insert, update, delete on table public.scheduled_matches to authenticated;

grant select on table public.game_history to anon, authenticated;
grant insert, update, delete on table public.game_history to authenticated;

grant insert on table public.student_feedback to anon, authenticated;
grant select, update, delete on table public.student_feedback to authenticated;

grant select, insert, update, delete on table public.user_profiles to authenticated;
grant select, insert, update on table public.conversations to authenticated;
grant select, insert, update on table public.messages to authenticated;

drop policy if exists "Users can read own conversation settings" on public.conversation_user_settings;
create policy "Users can read own conversation settings"
on public.conversation_user_settings for select
to authenticated
using (
    user_id = auth.uid()
    and public.app_can_read_conversation(conversation_id)
);

revoke all on table public.conversation_user_settings from anon;
revoke all on table public.conversation_user_settings from authenticated;
grant select on table public.conversation_user_settings to authenticated;
revoke delete on table public.conversations from authenticated;

create or replace function public.set_conversation_visibility(
    p_conversation_ids uuid[],
    p_hidden boolean
)
returns void
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    current_user_id uuid := auth.uid();
begin
    if current_user_id is null then
        raise exception 'You must be logged in to update conversation visibility.';
    end if;

    insert into public.conversation_user_settings (
        conversation_id,
        user_id,
        hidden_at
    )
    select
        conversation_record.id,
        current_user_id,
        case when p_hidden then now() else null end
    from public.conversations conversation_record
    where conversation_record.id = any(coalesce(p_conversation_ids, '{}'::uuid[]))
      and current_user_id in (conversation_record.created_by, conversation_record.receiver_id)
    on conflict (conversation_id, user_id)
    do update set hidden_at = excluded.hidden_at;
end
$$;

revoke all on function public.set_conversation_visibility(uuid[], boolean) from public;
grant execute on function public.set_conversation_visibility(uuid[], boolean) to authenticated;

-- Dashboard RPC for duplex messaging. Identity and roles are derived from the
-- authenticated session and the existing conversation instead of browser data.
create or replace function public.send_conversation_message(
    p_conversation_id uuid,
    p_receiver_id uuid,
    p_message_text text default null,
    p_attachment_url text default null,
    p_attachment_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    current_user_id uuid := auth.uid();
    conversation_record public.conversations%rowtype;
    resolved_sender_role text;
    resolved_receiver_role text;
    inserted_message_id uuid;
begin
    if current_user_id is null then
        raise exception 'You must be logged in to send a message.';
    end if;

    select *
    into conversation_record
    from public.conversations
    where id = p_conversation_id;

    if not found then
        raise exception 'Conversation not found.';
    end if;

    if current_user_id = conversation_record.created_by
       and p_receiver_id = conversation_record.receiver_id then
        resolved_sender_role := lower(trim(conversation_record.sender_role));
        resolved_receiver_role := lower(trim(conversation_record.receiver_role));
    elsif current_user_id = conversation_record.receiver_id
       and p_receiver_id = conversation_record.created_by then
        resolved_sender_role := lower(trim(conversation_record.receiver_role));
        resolved_receiver_role := lower(trim(conversation_record.sender_role));
    else
        raise exception 'You are not allowed to send a message in this conversation.';
    end if;

    if resolved_sender_role not in ('admin', 'committee')
       or resolved_receiver_role not in ('admin', 'committee') then
        raise exception 'Conversation roles are invalid.';
    end if;

    if length(trim(coalesce(p_message_text, ''))) = 0
       and p_attachment_url is null then
        raise exception 'Enter a message or attach a photo.';
    end if;

    insert into public.messages (
        conversation_id,
        sender_id,
        sender_role,
        receiver_id,
        receiver_role,
        message_text,
        attachment_url,
        attachment_path
    )
    values (
        p_conversation_id,
        current_user_id,
        resolved_sender_role,
        p_receiver_id,
        resolved_receiver_role,
        nullif(trim(coalesce(p_message_text, '')), ''),
        p_attachment_url,
        p_attachment_path
    )
    returning id into inserted_message_id;

    insert into public.conversation_user_settings (
        conversation_id,
        user_id,
        hidden_at
    )
    values
        (p_conversation_id, current_user_id, null),
        (p_conversation_id, p_receiver_id, null)
    on conflict (conversation_id, user_id)
    do update set hidden_at = null;

    return inserted_message_id;
end
$$;

revoke all on function public.send_conversation_message(uuid, uuid, text, text, text) from public;
grant execute on function public.send_conversation_message(uuid, uuid, text, text, text) to authenticated;

-- Controlled profile writes. Registration and admin approval updates use RPCs
-- so profile RLS remains strict without blocking valid application workflows.
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

-- Realtime publication. Duplicate-object exceptions are ignored safely.
do $$
declare
    table_name text;
begin
    foreach table_name in array array[
        'announcements',
        'conversations',
        'game_history',
        'messages',
        'scheduled_matches',
        'student_feedback',
        'user_profiles'
    ]
    loop
        begin
            execute format('alter publication supabase_realtime add table public.%I', table_name);
        exception
            when duplicate_object then null;
        end;
    end loop;
end
$$;

commit;
