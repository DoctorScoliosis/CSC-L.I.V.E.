-- Keep deleted conversations hidden only for the account that removed them.
-- Run this once in the Supabase SQL Editor.

begin;

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

revoke all on function public.app_can_read_conversation(uuid) from public;
grant execute on function public.app_can_read_conversation(uuid) to authenticated;

create table if not exists public.conversation_user_settings (
    conversation_id uuid not null references public.conversations(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    hidden_at timestamptz,
    primary key (conversation_id, user_id)
);

alter table public.conversation_user_settings enable row level security;

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

drop policy if exists "Participants can delete own conversations" on public.conversations;
revoke delete on table public.conversations from authenticated;

commit;
