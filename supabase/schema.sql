-- Bloom Events bookings (Supabase project dwazctmqkrnajqmswtiy). Safe to run more than once.
-- Times are stored as timestamptz; the owner app sends and shows them as Detroit wall-clock time.
-- Visitors only ever see which items are taken on which dates, through booked_items();
-- customers, addresses and notes are readable only by signed-in admins.

create extension if not exists btree_gist with schema extensions;
create schema if not exists private;

-- Emails allowed to use the owner app. Add one with:
--   insert into private.admins (email) values ('owner@example.com');
create table if not exists private.admins (
  email text primary key check (email = lower(email))
);
alter table private.admins enable row level security;

-- Public sign-ups are switched off in Supabase Auth, so every account that can sign in was created on purpose.
create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from private.admins a
    where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
$$;
revoke all on function private.is_admin() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

-- One row: default setup and pickup time around an event, changeable in the app.
create table if not exists public.settings (
  id boolean primary key default true check (id),
  setup_minutes int not null default 120 check (setup_minutes between 0 and 1440),
  pickup_minutes int not null default 120 check (pickup_minutes between 0 and 1440)
);
insert into public.settings (id) values (true) on conflict do nothing;
alter table public.settings add column if not exists hold_hours int not null default 72 check (hold_hours between 1 and 720);

create table if not exists public.customers (
  id bigint generated always as identity primary key,
  name text not null check (char_length(trim(name)) between 1 and 200),
  phone text check (char_length(phone) <= 40),
  email text check (char_length(email) <= 254),
  notes text check (char_length(notes) <= 5000),
  created_at timestamptz not null default now()
);

-- "requested" and "confirmed" bookings hold their items; the other statuses free them.
create table if not exists public.bookings (
  id bigint generated always as identity primary key,
  customer_id bigint references public.customers on delete restrict,
  status text not null default 'confirmed' check (status in ('requested', 'confirmed', 'declined', 'cancelled', 'expired')),
  source text not null default 'owner' check (source in ('owner', 'website')),
  event_start timestamptz not null,
  event_end timestamptz not null,
  setup_minutes int not null default 120 check (setup_minutes between 0 and 1440),
  pickup_minutes int not null default 120 check (pickup_minutes between 0 and 1440),
  address text check (char_length(address) <= 300),
  venue text check (char_length(venue) <= 200),
  event_type text check (char_length(event_type) <= 100),
  guests int check (guests between 1 and 100000),
  price numeric(10, 2) check (price >= 0),
  deposit_paid boolean not null default false,
  notes text check (char_length(notes) <= 5000),
  created_at timestamptz not null default now(),
  check (event_end > event_start and event_end <= event_start + interval '7 days')
);
-- Website requests hold their items until hold_until unless the owner confirms or declines first.
alter table public.bookings add column if not exists hold_until timestamptz;
create index if not exists bookings_event_start on public.bookings (event_start);
create index if not exists bookings_customer on public.bookings (customer_id);

-- Each booked item holds its time from setup to pickup. The exclusion constraint makes two holds
-- on the same item that overlap impossible, even if two saves happen at the same moment.
create table if not exists public.booking_items (
  booking_id bigint not null references public.bookings on delete cascade,
  item_id text not null check (item_id in (
    'ivory-wall', 'garden-wall', 'pink-ombre-wall', 'red-rose-wall', 'champagne-wall',
    'greenery-wall', 'ivory-texture-wall', 'bloom-bar', 'pedestals', 'sweets-cart')),
  blocked tstzrange not null,
  active boolean not null,
  primary key (booking_id, item_id),
  constraint booking_items_no_overlap exclude using gist (item_id with =, blocked with &&) where (active)
);

-- An item's held time and whether it holds at all always come from its booking.
create or replace function private.booking_item_hold() returns trigger
language plpgsql set search_path = ''
as $$
begin
  select tstzrange(b.event_start - make_interval(mins => b.setup_minutes), b.event_end + make_interval(mins => b.pickup_minutes), '[)'),
    b.status in ('requested', 'confirmed')
  into new.blocked, new.active
  from public.bookings b where b.id = new.booking_id;
  return new;
end
$$;
drop trigger if exists booking_items_hold on public.booking_items;
create trigger booking_items_hold before insert or update on public.booking_items
  for each row execute function private.booking_item_hold();

create or replace function private.booking_changed() returns trigger
language plpgsql set search_path = ''
as $$
begin
  update public.booking_items set active = active where booking_id = new.id;
  return null;
end
$$;
drop trigger if exists bookings_refresh_items on public.bookings;
create trigger bookings_refresh_items after update of event_start, event_end, setup_minutes, pickup_minutes, status on public.bookings
  for each row execute function private.booking_changed();

-- Marks website requests whose hold ran out as expired, which frees their items.
create or replace function private.expire_holds() returns integer
language sql security definer set search_path = ''
as $$
  with expired as (
    update public.bookings set status = 'expired'
    where status = 'requested' and hold_until is not null and hold_until <= now()
    returning 1
  )
  select count(*)::int from expired
$$;
revoke all on function private.expire_holds() from public;
grant execute on function private.expire_holds() to authenticated;

alter table public.settings enable row level security;
alter table public.customers enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_items enable row level security;
revoke all on public.settings, public.customers, public.bookings, public.booking_items from anon, authenticated;
grant select, update on public.settings to authenticated;
grant select, insert, update, delete on public.customers, public.bookings, public.booking_items to authenticated;

drop policy if exists "Admins manage settings" on public.settings;
create policy "Admins manage settings" on public.settings for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists "Admins manage customers" on public.customers;
create policy "Admins manage customers" on public.customers for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists "Admins manage bookings" on public.bookings;
create policy "Admins manage bookings" on public.bookings for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
drop policy if exists "Admins manage booking items" on public.booking_items;
create policy "Admins manage booking items" on public.booking_items for all to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- What the owner app reads. security_invoker keeps the tables' admin-only rules in force.
create or replace view public.owner_bookings with (security_invoker = true) as
select b.id, b.status, b.source, b.event_start, b.event_end,
  b.event_start at time zone 'America/Detroit' as start_local,
  b.event_end at time zone 'America/Detroit' as end_local,
  b.setup_minutes, b.pickup_minutes, b.address, b.venue, b.event_type, b.guests, b.price, b.deposit_paid, b.notes, b.created_at,
  b.customer_id, c.name as customer_name, c.phone as customer_phone, c.email as customer_email,
  array(select i.item_id from public.booking_items i where i.booking_id = b.id order by i.item_id) as items,
  b.hold_until
from public.bookings b
left join public.customers c on c.id = b.customer_id;

create or replace view public.owner_customers with (security_invoker = true) as
select c.id, c.name, c.phone, c.email, c.notes, c.created_at,
  count(b.id) filter (where b.status in ('requested', 'confirmed')) as booking_count,
  max(b.event_start at time zone 'America/Detroit') filter (where b.status in ('requested', 'confirmed')) as latest_event_local
from public.customers c
left join public.bookings b on b.customer_id = c.id
group by c.id;

revoke all on public.owner_bookings, public.owner_customers from anon, authenticated;
grant select on public.owner_bookings, public.owner_customers to authenticated;

-- Saves a booking with its customer and items in one step. Dates and times are Detroit wall-clock;
-- an end time at or before the start time means the event ends the next day.
create or replace function public.save_booking(b jsonb) returns bigint
language plpgsql security invoker set search_path = ''
as $$
declare
  v_id bigint := nullif(b ->> 'id', '')::bigint;
  v_customer bigint := nullif(b ->> 'customer_id', '')::bigint;
  v_day date := (b ->> 'date')::date;
  v_start_time time := (b ->> 'start')::time;
  v_end_time time := (b ->> 'end')::time;
  v_status text := coalesce(nullif(b ->> 'status', ''), 'confirmed');
  v_setup int := coalesce(nullif(b ->> 'setup_minutes', '')::int, (select s.setup_minutes from public.settings s));
  v_pickup int := coalesce(nullif(b ->> 'pickup_minutes', '')::int, (select s.pickup_minutes from public.settings s));
  v_items text[] := array(select distinct jsonb_array_elements_text(coalesce(b -> 'items', '[]'::jsonb)));
  v_start timestamptz;
  v_end timestamptz;
  v_taken text[];
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  perform private.expire_holds();
  if cardinality(v_items) = 0 then
    raise exception 'Choose at least one item' using errcode = '22023';
  end if;
  v_start := (v_day + v_start_time) at time zone 'America/Detroit';
  v_end := (v_day + v_end_time + case when v_end_time <= v_start_time then interval '1 day' else interval '0 days' end) at time zone 'America/Detroit';

  -- A readable answer for the usual case; the exclusion constraint still guards against races.
  if v_status in ('requested', 'confirmed') then
    select array_agg(distinct i.item_id) into v_taken
    from public.booking_items i
    where i.active and i.item_id = any (v_items) and (v_id is null or i.booking_id <> v_id)
      and i.blocked && tstzrange(v_start - make_interval(mins => v_setup), v_end + make_interval(mins => v_pickup), '[)');
    if v_taken is not null then
      raise exception 'Already booked at that time' using errcode = '23P01', detail = array_to_string(v_taken, ',');
    end if;
  end if;

  if v_customer is null then
    insert into public.customers (name, phone, email)
    values (trim(b ->> 'customer_name'), nullif(trim(b ->> 'customer_phone'), ''), nullif(lower(trim(b ->> 'customer_email')), ''))
    returning id into v_customer;
  else
    update public.customers
    set name = trim(b ->> 'customer_name'), phone = nullif(trim(b ->> 'customer_phone'), ''), email = nullif(lower(trim(b ->> 'customer_email')), '')
    where id = v_customer;
  end if;

  -- Drop removed items before new times apply, so a removed item can't cause a false conflict.
  delete from public.booking_items where booking_id = v_id and item_id <> all (v_items);
  if v_id is null then
    insert into public.bookings (customer_id, status, event_start, event_end, setup_minutes, pickup_minutes, address, venue, event_type, guests, price, deposit_paid, notes)
    values (v_customer, v_status, v_start, v_end, v_setup, v_pickup, nullif(trim(b ->> 'address'), ''), nullif(trim(b ->> 'venue'), ''),
      nullif(b ->> 'event_type', ''), nullif(b ->> 'guests', '')::int, nullif(b ->> 'price', '')::numeric,
      coalesce((b ->> 'deposit_paid')::boolean, false), nullif(trim(b ->> 'notes'), ''))
    returning id into v_id;
  else
    update public.bookings
    set customer_id = v_customer, status = v_status, event_start = v_start, event_end = v_end, setup_minutes = v_setup, pickup_minutes = v_pickup,
      address = nullif(trim(b ->> 'address'), ''), venue = nullif(trim(b ->> 'venue'), ''), event_type = nullif(b ->> 'event_type', ''),
      guests = nullif(b ->> 'guests', '')::int, price = nullif(b ->> 'price', '')::numeric,
      deposit_paid = coalesce((b ->> 'deposit_paid')::boolean, false), notes = nullif(trim(b ->> 'notes'), '')
    where id = v_id;
    if not found then
      raise exception 'Booking not found' using errcode = 'P0002';
    end if;
  end if;

  -- The conflict target matters: without it an overlap would be skipped silently instead of refused.
  insert into public.booking_items (booking_id, item_id) select v_id, unnest(v_items) on conflict (booking_id, item_id) do nothing;
  return v_id;
end
$$;
revoke all on function public.save_booking(jsonb) from public, anon;
grant execute on function public.save_booking(jsonb) to authenticated;

-- Items already held around a proposed time, for the booking form to warn before saving.
create or replace function public.item_conflicts(p_date date, p_start time, p_end time, p_setup int, p_pickup int, p_booking bigint default null)
returns table (item_id text, booking_id bigint, customer_name text, start_local timestamp, end_local timestamp)
language sql stable security invoker set search_path = ''
as $$
  select i.item_id, b.id, c.name, b.event_start at time zone 'America/Detroit', b.event_end at time zone 'America/Detroit'
  from public.booking_items i
  join public.bookings b on b.id = i.booking_id
  left join public.customers c on c.id = b.customer_id
  where i.active and (p_booking is null or b.id <> p_booking)
    and (b.status <> 'requested' or b.hold_until is null or b.hold_until > now())
    and i.blocked && tstzrange(
      ((p_date + p_start) at time zone 'America/Detroit') - make_interval(mins => p_setup),
      ((p_date + p_end + case when p_end <= p_start then interval '1 day' else interval '0 days' end) at time zone 'America/Detroit') + make_interval(mins => p_pickup),
      '[)')
  order by b.event_start
$$;
revoke all on function public.item_conflicts(date, time, time, int, int, bigint) from public, anon;
grant execute on function public.item_conflicts(date, time, time, int, int, bigint) to authenticated;

-- Public availability for the website: which items are held on which Detroit dates (by event time),
-- at most about 13 months per call. Names, addresses and times stay private.
create or replace function public.booked_items(from_date date, to_date date)
returns table (item_id text, event_date date)
language sql stable security definer set search_path = ''
as $$
  select distinct i.item_id, d::date
  from public.booking_items i
  join public.bookings b on b.id = i.booking_id
  cross join lateral generate_series(
    (b.event_start at time zone 'America/Detroit')::date::timestamp,
    ((b.event_end - interval '1 second') at time zone 'America/Detroit')::date::timestamp,
    interval '1 day') d
  where i.active
    and (b.status <> 'requested' or b.hold_until is null or b.hold_until > now())
    and b.event_end > (from_date::timestamp at time zone 'America/Detroit')
    and b.event_start < ((least(to_date, from_date + 400) + 1)::timestamp at time zone 'America/Detroit')
    and d::date between from_date and least(to_date, from_date + 400)
  order by 2, 1
$$;
revoke all on function public.booked_items(date, date) from public;
grant execute on function public.booked_items(date, date) to anon, authenticated;

-- Public availability with times: when each item is held (setup to pickup) as Detroit wall-clock times,
-- at most about 13 months per call. Names, addresses and notes stay private.
create or replace function public.availability(from_date date, to_date date)
returns table (item_id text, busy_from timestamp, busy_until timestamp)
language sql stable security definer set search_path = ''
as $$
  select i.item_id, lower(i.blocked) at time zone 'America/Detroit', upper(i.blocked) at time zone 'America/Detroit'
  from public.booking_items i
  join public.bookings b on b.id = i.booking_id
  where i.active
    and (b.status <> 'requested' or b.hold_until is null or b.hold_until > now())
    and i.blocked && tstzrange(from_date::timestamp at time zone 'America/Detroit', (least(to_date, from_date + 400) + 1)::timestamp at time zone 'America/Detroit', '[)')
  order by 2, 1
$$;
revoke all on function public.availability(date, date) from public;
grant execute on function public.availability(date, date) to anon, authenticated;

-- The setup and pickup time the website adds around a customer's event when checking what's free.
create or replace function public.booking_rules()
returns table (setup_minutes int, pickup_minutes int)
language sql stable security definer set search_path = ''
as $$ select s.setup_minutes, s.pickup_minutes from public.settings s $$;
revoke all on function public.booking_rules() from public;
grant execute on function public.booking_rules() to anon, authenticated;

-- Booking requests from the website, saved as holds ("requested") that keep their items until the owner
-- confirms or declines, or hold_until passes. Anyone can call this, so it checks everything itself.
create or replace function public.request_booking(r jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := trim(coalesce(r ->> 'name', ''));
  v_email text := lower(trim(coalesce(r ->> 'email', '')));
  v_phone text := nullif(trim(coalesce(r ->> 'phone', '')), '');
  v_digits text := regexp_replace(coalesce(r ->> 'phone', ''), '\D', '', 'g');
  v_items text[] := array(select distinct jsonb_array_elements_text(coalesce(r -> 'items', '[]'::jsonb)));
  v_today date := (now() at time zone 'America/Detroit')::date;
  v_rules public.settings;
  v_day date;
  v_start_time time;
  v_end_time time;
  v_start timestamptz;
  v_end timestamptz;
  v_hold timestamptz;
  v_customer bigint;
  v_id bigint;
  v_taken text[];
begin
  -- The trap field is hidden from people, so only bots fill it in: report success and save nothing.
  if coalesce(r ->> 'trap', '') <> '' then
    return jsonb_build_object('hold_until', null);
  end if;
  begin
    v_day := (r ->> 'date')::date;
    v_start_time := (r ->> 'start')::time;
    v_end_time := (r ->> 'end')::time;
  exception when others then
    raise exception 'invalid_request' using errcode = '22023';
  end;
  if v_name = '' or char_length(v_name) > 200 or char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or v_day is null or v_start_time is null or v_end_time is null or v_day < v_today or v_day > v_today + 550 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;
  perform private.expire_holds();

  -- Spam limits: two waiting requests per email or phone, and at most ten new requests an hour overall.
  if (select count(*) from public.bookings b join public.customers c on c.id = b.customer_id
      where b.source = 'website' and b.status = 'requested'
        and (c.email = v_email or (char_length(v_digits) >= 7 and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = v_digits))) >= 2 then
    raise exception 'pending_limit' using errcode = 'P0001';
  end if;
  if (select count(*) from public.bookings b where b.source = 'website' and b.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'busy' using errcode = 'P0001';
  end if;

  select * into v_rules from public.settings;
  v_start := (v_day + v_start_time) at time zone 'America/Detroit';
  v_end := (v_day + v_end_time + case when v_end_time <= v_start_time then interval '1 day' else interval '0 days' end) at time zone 'America/Detroit';
  select array_agg(distinct i.item_id) into v_taken
  from public.booking_items i
  where i.active and i.item_id = any (v_items)
    and i.blocked && tstzrange(v_start - make_interval(mins => v_rules.setup_minutes), v_end + make_interval(mins => v_rules.pickup_minutes), '[)');
  if v_taken is not null then
    raise exception 'Already booked at that time' using errcode = '23P01', detail = array_to_string(v_taken, ',');
  end if;

  select c.id into v_customer from public.customers c where c.email = v_email order by c.id limit 1;
  if v_customer is null then
    insert into public.customers (name, phone, email) values (v_name, v_phone, v_email) returning id into v_customer;
  else
    update public.customers set phone = coalesce(phone, v_phone) where id = v_customer;
  end if;
  v_hold := now() + make_interval(hours => v_rules.hold_hours);
  insert into public.bookings (customer_id, status, source, event_start, event_end, setup_minutes, pickup_minutes, hold_until, address, venue, event_type, guests, notes)
  values (v_customer, 'requested', 'website', v_start, v_end, v_rules.setup_minutes, v_rules.pickup_minutes, v_hold,
    nullif(trim(r ->> 'address'), ''), nullif(trim(r ->> 'venue'), ''), nullif(trim(r ->> 'event_type'), ''),
    case when coalesce(r ->> 'guests', '') ~ '^[1-9][0-9]{0,4}$' then (r ->> 'guests')::int end,
    nullif(trim(r ->> 'notes'), ''))
  returning id into v_id;
  -- The conflict target matters: without it an overlap would be skipped silently instead of refused.
  insert into public.booking_items (booking_id, item_id) select v_id, unnest(v_items) on conflict (booking_id, item_id) do nothing;
  return jsonb_build_object('hold_until', to_char(v_hold at time zone 'America/Detroit', 'YYYY-MM-DD"T"HH24:MI:SS'));
end
$$;
revoke all on function public.request_booking(jsonb) from public;
grant execute on function public.request_booking(jsonb) to anon, authenticated;

-- Lets the owner app tell a signed-in person whether their email can manage bookings.
create or replace function public.am_i_admin() returns boolean
language sql stable security invoker set search_path = ''
as $$ select private.is_admin() $$;
revoke all on function public.am_i_admin() from public, anon;
grant execute on function public.am_i_admin() to authenticated;

-- Version 1 kept one row per item per day in public.reservations. Move any rows into bookings as
-- all-day events, then remove the old table.
do $$
declare
  r record;
  v_customer bigint;
  v_booking bigint;
begin
  if to_regclass('public.reservations') is not null then
    for r in
      select event_date, coalesce(nullif(trim(customer), ''), 'Unknown') as customer, note, array_agg(item_id) as items
      from public.reservations group by 1, 2, 3
    loop
      insert into public.customers (name) values (r.customer) returning id into v_customer;
      insert into public.bookings (customer_id, event_start, event_end, setup_minutes, pickup_minutes, notes)
      values (v_customer, r.event_date::timestamp at time zone 'America/Detroit', (r.event_date + 1)::timestamp at time zone 'America/Detroit', 0, 0, r.note)
      returning id into v_booking;
      insert into public.booking_items (booking_id, item_id) select v_booking, unnest(r.items);
    end loop;
    drop table public.reservations;
  end if;
end
$$;

-- Every 15 minutes, expire website holds that ran out. Skipped where pg_cron isn't available (local tests);
-- the functions above also expire stale holds before they save anything.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    grant usage on schema cron to postgres;
    grant all privileges on all tables in schema cron to postgres;
    perform cron.schedule('bloom-expire-holds', '*/15 * * * *', 'select private.expire_holds()');
  end if;
end
$$;
