  -- TS Auto Trader: Supabase setup.
-- Paste this whole file into Supabase > SQL Editor > New query > Run. It is safe to run twice.
-- Then run the one line at the very bottom with YOUR email (see SUPABASE.md).

-- 1. Who may use this shop's data (only emails listed here; nobody can read this list through the API).
create table if not exists public.allowed_users (email text primary key);
alter table public.allowed_users enable row level security;
revoke all on public.allowed_users from anon, authenticated;

create or replace function public.is_shop_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.allowed_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.is_shop_user() from public, anon;
grant execute on function public.is_shop_user() to authenticated;

-- 2. The shop's records (items, customers, invoices, payments, stock movements, users, settings).
create table if not exists public.records (
  tbl        text   not null,
  id         text   not null,
  data       jsonb  not null,
  updated_at bigint not null,
  device_id  text   not null,
  seq        bigint not null,
  primary key (tbl, id)
);
create index if not exists records_seq on public.records (seq);
create sequence if not exists public.records_seq_gen;

alter table public.records enable row level security;
revoke all on public.records from anon;
grant select, insert, update, delete on public.records to authenticated;
grant usage, select on sequence public.records_seq_gen to authenticated;
drop policy if exists "shop users only" on public.records;
create policy "shop users only" on public.records
  for all to authenticated
  using (public.is_shop_user()) with check (public.is_shop_user());

-- 3. One call that pushes this device's changes and pulls everyone else's.
--    Same rules as the own-server version: newer change wins, retries are harmless, bad records are refused.
create or replace function public.sync_exchange(
  p_device text, p_cursor bigint default 0, p_changes jsonb default '[]'::jsonb
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_tables   text[] := array['items','parties','docs','payments','stockMoves','users','settings'];
  v_now      bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_page     int := 500;
  v_applied  int := 0;
  v_rejected jsonb := '[]'::jsonb;
  v_out      jsonb := '[]'::jsonb;
  v_last     bigint := coalesce(p_cursor, 0);
  v_rows     int := 0;
  c          jsonb;
  d          jsonb;
  r          record;
  ex         record;
  v_label    text;
  v_upd      bigint;
begin
  if not public.is_shop_user() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_device is null or p_device = '' or length(p_device) > 100 then
    raise exception 'deviceId required';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) > 1000 then
    raise exception 'bad request';
  end if;

  -- One sync at a time, so sequence numbers always follow commit order.
  perform pg_advisory_xact_lock(727001);

  for c in select value from jsonb_array_elements(p_changes) loop
    v_label := coalesce(c ->> 'table', '?') || ':' || coalesce(c ->> 'id', '?');
    d := c -> 'data';

    if jsonb_typeof(c) <> 'object'
       or jsonb_typeof(c -> 'table') is distinct from 'string' or not ((c ->> 'table') = any (v_tables))
       or jsonb_typeof(c -> 'id') is distinct from 'string'
       or jsonb_typeof(c -> 'updatedAt') is distinct from 'number'
       or jsonb_typeof(d) is distinct from 'object' then
      v_rejected := v_rejected || to_jsonb(v_label || ' (bad shape)');
      continue;
    end if;
    if length(c ->> 'id') = 0 or length(c ->> 'id') > 200
       or (d ->> 'id') is distinct from (c ->> 'id')
       or jsonb_typeof(d -> 'updatedAt') is distinct from 'number'
       or (d ->> 'updatedAt')::numeric <> (c ->> 'updatedAt')::numeric
       or jsonb_typeof(d -> 'deviceId') is distinct from 'string' then
      v_rejected := v_rejected || to_jsonb(v_label || ' (bad shape)');
      continue;
    end if;

    v_upd := (c ->> 'updatedAt')::numeric::bigint;
    if v_upd > v_now + 5 * 60 * 1000 then
      v_rejected := v_rejected || to_jsonb(v_label || ' (timestamp in the future)');
      continue;
    end if;

    select updated_at, device_id into ex from public.records where tbl = (c ->> 'table') and id = (c ->> 'id');
    if found then
      if ex.updated_at > v_upd then continue; end if;                              -- we already hold a newer version
      if ex.updated_at = v_upd and ex.device_id collate "C" >= (d ->> 'deviceId') collate "C" then continue; end if; -- duplicate retry
    end if;

    insert into public.records (tbl, id, data, updated_at, device_id, seq)
    values (c ->> 'table', c ->> 'id', d, v_upd, d ->> 'deviceId', nextval('public.records_seq_gen'))
    on conflict (tbl, id) do update
      set data = excluded.data, updated_at = excluded.updated_at, device_id = excluded.device_id, seq = excluded.seq;
    v_applied := v_applied + 1;
  end loop;

  -- Pull: everything after the cursor, minus this device's own records.
  for r in select tbl, id, data, seq, device_id from public.records where seq > coalesce(p_cursor, 0) order by seq limit v_page loop
    v_rows := v_rows + 1;
    v_last := r.seq;
    if r.device_id = p_device then continue; end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'table', r.tbl, 'id', r.id, 'updatedAt', (r.data ->> 'updatedAt')::numeric::bigint, 'data', r.data));
  end loop;

  return jsonb_build_object('cursor', v_last, 'more', v_rows = v_page, 'changes', v_out,
                            'applied', v_applied, 'rejected', v_rejected);
end;
$$;
revoke all on function public.sync_exchange(text, bigint, jsonb) from public, anon;
grant execute on function public.sync_exchange(text, bigint, jsonb) to authenticated;

-- 4. LAST STEP (run it by itself, with YOUR email, the same one you log in with):
-- insert into public.allowed_users (email) values ('owner@example.com') on conflict do nothing;
