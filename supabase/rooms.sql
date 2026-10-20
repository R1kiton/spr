-- Gesto Arena room storage. Apply with a trusted database administrator.
-- This is a repeatable setup script, not a generated Supabase migration.
-- Never expose gesto_private in Supabase's Data API settings.
-- Configure server_config separately with SHA-256 of a random server-only key.
-- The browser calls Next.js routes; only Next.js calls this RPC.

begin;

create schema if not exists gesto_private;
revoke all on schema gesto_private from public, anon, authenticated, service_role;

create table if not exists gesto_private.server_config (
  singleton boolean primary key default true check (singleton),
  server_key_hash text not null check (server_key_hash ~ '^[a-f0-9]{64}$')
);

create table if not exists gesto_private.rooms (
  code text primary key check (code ~ '^[A-Z2-9]{6}$'),
  state jsonb not null check (
    pg_catalog.jsonb_typeof(state) = 'object'
    and pg_catalog.octet_length(state::text) < 65536
  ),
  version bigint not null default 1 check (version > 0),
  expires_at timestamptz not null default (pg_catalog.now() + interval '24 hours')
);

create index if not exists rooms_expires_at_idx
  on gesto_private.rooms (expires_at);

alter table gesto_private.server_config enable row level security;
alter table gesto_private.rooms enable row level security;
revoke all on table gesto_private.server_config, gesto_private.rooms
  from public, anon, authenticated, service_role;

-- The definer stays in the unexposed schema. A random server credential is
-- required because this application intentionally has no user accounts.
-- There are no browser-accessible RLS policies or direct table grants.
create or replace function gesto_private.room_store(
  p_server_key text,
  p_operation text,
  p_code text,
  p_state jsonb default null,
  p_expected_version bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if p_server_key is null
    or pg_catalog.length(p_server_key) < 32
    or pg_catalog.length(p_server_key) > 1024
    or not exists (
      select 1
      from gesto_private.server_config as config
      where config.singleton
        and config.server_key_hash = pg_catalog.encode(
          pg_catalog.sha256(pg_catalog.convert_to(p_server_key, 'UTF8')), 'hex'
        )
    )
  then
    raise exception 'Unauthorized room storage request' using errcode = '42501';
  end if;

  if p_code is null or p_code !~ '^[A-Z2-9]{6}$'
    or p_operation is null or p_operation not in ('read', 'create', 'update')
  then
    raise exception 'Invalid room storage request' using errcode = '22023';
  end if;

  if p_operation = 'read' then
    select pg_catalog.jsonb_build_object('state', room.state, 'version', room.version)
      into v_result
    from gesto_private.rooms as room
    where room.code = p_code and room.expires_at > pg_catalog.now();

    -- SQL NULL is returned as JSON null by PostgREST for missing/expired rooms.
    return v_result;
  end if;

  if p_state is null or pg_catalog.jsonb_typeof(p_state) <> 'object'
    or pg_catalog.octet_length(p_state::text) >= 65536
  then
    raise exception 'Invalid room state' using errcode = '22023';
  end if;

  if p_operation = 'create' then
    -- Bound cleanup work, and do not wait on rooms another request is updating.
    delete from gesto_private.rooms as room
    where room.ctid in (
      select expired.ctid
      from gesto_private.rooms as expired
      where expired.expires_at <= pg_catalog.now()
      order by expired.expires_at
      limit 100
      for update skip locked
    );

    insert into gesto_private.rooms (code, state)
    values (p_code, p_state)
    on conflict (code) do nothing
    returning pg_catalog.jsonb_build_object('state', state, 'version', version)
      into v_result;

    return coalesce(v_result, '{"conflict":true}'::jsonb);
  end if;

  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'Expected room version is required' using errcode = '22023';
  end if;

  -- PostgreSQL rechecks this predicate after acquiring a contended row lock.
  -- Only one request can replace any given version; callers retry conflicts
  -- after reading the current room and revalidating the requested action.
  update gesto_private.rooms as room
  set state = p_state,
      version = room.version + 1,
      expires_at = pg_catalog.now() + interval '24 hours'
  where room.code = p_code
    and room.version = p_expected_version
    and room.expires_at > pg_catalog.now()
  returning pg_catalog.jsonb_build_object('state', room.state, 'version', room.version)
    into v_result;

  return coalesce(v_result, '{"conflict":true}'::jsonb);
end;
$function$;

-- PostgREST exposes only this invoker wrapper; the checked private function
-- supplies the narrowly scoped table privileges.
create or replace function public.gesto_room_store(
  p_server_key text,
  p_operation text,
  p_code text,
  p_state jsonb default null,
  p_expected_version bigint default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select gesto_private.room_store(
    p_server_key, p_operation, p_code, p_state, p_expected_version
  );
$function$;

revoke all on function gesto_private.room_store(text, text, text, jsonb, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.gesto_room_store(text, text, text, jsonb, bigint)
  from public, anon, authenticated, service_role;
grant usage on schema gesto_private to anon;
grant execute on function gesto_private.room_store(text, text, text, jsonb, bigint) to anon;
grant execute on function public.gesto_room_store(text, text, text, jsonb, bigint) to anon;

notify pgrst, 'reload schema';

commit;
