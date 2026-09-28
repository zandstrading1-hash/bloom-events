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

-- Everything that can be booked, with the price the Rentals page shows. Running this file again keeps prices
-- changed since (change one with: update public.items set price = 500 where id = 'ivory-wall';).
create table if not exists public.items (
  id text primary key check (id ~ '^[a-z0-9-]+$'),
  name text not null check (char_length(name) between 1 and 100),
  kind text not null check (kind in ('wall', 'extra', 'neon')),
  price numeric(10, 2) not null check (price >= 0),
  sort int not null
);
insert into public.items (id, name, kind, price, sort) values
  ('ivory-wall', 'Ivory flower wall', 'wall', 450, 1), ('garden-wall', 'Garden flower wall', 'wall', 450, 2),
  ('pink-ombre-wall', 'Pink ombre wall', 'wall', 450, 3), ('red-rose-wall', 'Red rose wall', 'wall', 450, 4),
  ('champagne-wall', 'Champagne rose wall', 'wall', 450, 5), ('greenery-wall', 'Greenery wall', 'wall', 450, 6),
  ('ivory-texture-wall', 'Ivory textured wall', 'wall', 450, 7),
  ('bloom-bar', 'Bloom bar', 'extra', 350, 8), ('pedestals', 'White pedestals', 'extra', 275, 9), ('sweets-cart', 'Sweets cart', 'extra', 325, 10),
  ('neon-mr-and-mrs', 'Mr. & Mrs. neon sign', 'neon', 125, 11), ('neon-happy-birthday', 'Happy Birthday neon sign', 'neon', 125, 12),
  ('neon-christening-day', 'Christening Day neon sign', 'neon', 125, 13), ('neon-congratulations', 'Congratulations neon sign', 'neon', 125, 14),
  ('neon-oh-baby', 'Oh Baby neon sign', 'neon', 125, 15), ('neon-better-together', 'Better Together neon sign', 'neon', 125, 16),
  ('neon-just-married', 'Just Married neon sign', 'neon', 125, 17), ('neon-engaged', 'Engaged neon sign', 'neon', 125, 18),
  ('neon-congrats', 'Congrats neon sign', 'neon', 125, 19)
on conflict (id) do update set name = excluded.name, kind = excluded.kind, sort = excluded.sort;

-- Packages: their items (and a flower wall of the customer's choice for some) for less than the items alone.
create table if not exists public.packages (
  id text primary key check (id ~ '^pkg-[a-z0-9-]+$'),
  name text not null,
  parts text[] not null,
  needs_wall boolean not null default false,
  saving numeric(10, 2) not null check (saving >= 0),
  sort int not null
);
insert into public.packages (id, name, parts, needs_wall, saving, sort) values
  ('pkg-sweet-setup', 'The Sweet Setup package', '{bloom-bar,sweets-cart}', false, 75, 1),
  ('pkg-bridal-suite', 'The Bridal Suite package', '{bloom-bar}', true, 80, 2),
  ('pkg-full-bloom', 'The Full Bloom package', '{bloom-bar,pedestals,sweets-cart}', true, 150, 3)
on conflict (id) do update set name = excluded.name, parts = excluded.parts, needs_wall = excluded.needs_wall, sort = excluded.sort;

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
alter table public.bookings add column if not exists packages text[] not null default '{}';
create index if not exists bookings_event_start on public.bookings (event_start);
create index if not exists bookings_customer on public.bookings (customer_id);

-- Each booked item holds its time from setup to pickup. The exclusion constraint makes two holds
-- on the same item that overlap impossible, even if two saves happen at the same moment.
create table if not exists public.booking_items (
  booking_id bigint not null references public.bookings on delete cascade,
  item_id text not null references public.items,
  blocked tstzrange not null,
  active boolean not null,
  primary key (booking_id, item_id),
  constraint booking_items_no_overlap exclude using gist (item_id with =, blocked with &&) where (active)
);
-- Databases made before the catalog checked items against a fixed list; the catalog replaces it.
alter table public.booking_items drop constraint if exists booking_items_item_id_check;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'booking_items_item_id_fkey' and conrelid = 'public.booking_items'::regclass) then
    alter table public.booking_items add constraint booking_items_item_id_fkey foreign key (item_id) references public.items (id);
  end if;
end
$$;

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

alter table public.items enable row level security;
alter table public.packages enable row level security;
revoke all on public.items, public.packages from anon, authenticated;
grant select on public.items, public.packages to anon, authenticated;
drop policy if exists "Anyone can read items" on public.items;
create policy "Anyone can read items" on public.items for select to anon, authenticated using (true);
drop policy if exists "Anyone can read packages" on public.packages;
create policy "Anyone can read packages" on public.packages for select to anon, authenticated using (true);

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

-- The price of a booking: its items at catalog prices, less each package's saving when the booking has all of
-- that package's items (and a flower wall, for packages that include one). Packages don't share items: the
-- biggest saving is counted first and uses up its items. Unknown ids are ignored, and nothing picked has no price.
create or replace function public.booking_quote(p_items text[], p_packages text[] default '{}') returns numeric
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_pool text[] := array(select distinct i.id from public.items i where i.id = any (coalesce(p_items, '{}')));
  v_total numeric := coalesce((select sum(i.price) from public.items i where i.id = any (v_pool)), 0);
  v_wall text;
  pk record;
begin
  if cardinality(v_pool) = 0 then
    return null;
  end if;
  for pk in select * from public.packages p where p.id = any (coalesce(p_packages, '{}')) order by p.saving desc, p.sort loop
    continue when not pk.parts <@ v_pool;
    v_wall := null;
    if pk.needs_wall then
      select i.id into v_wall from public.items i where i.id = any (v_pool) and i.kind = 'wall' order by i.sort limit 1;
      continue when v_wall is null;
    end if;
    v_pool := array(select x from unnest(v_pool) x where x <> all (pk.parts) and x is distinct from v_wall);
    v_total := v_total - pk.saving;
  end loop;
  return greatest(v_total, 0);
end
$$;
revoke all on function public.booking_quote(text[], text[]) from public;
grant execute on function public.booking_quote(text[], text[]) to anon, authenticated;

-- What the owner app reads. security_invoker keeps the tables' admin-only rules in force.
create or replace view public.owner_bookings with (security_invoker = true) as
select b.id, b.status, b.source, b.event_start, b.event_end,
  b.event_start at time zone 'America/Detroit' as start_local,
  b.event_end at time zone 'America/Detroit' as end_local,
  b.setup_minutes, b.pickup_minutes, b.address, b.venue, b.event_type, b.guests, b.price, b.deposit_paid, b.notes, b.created_at,
  b.customer_id, c.name as customer_name, c.phone as customer_phone, c.email as customer_email,
  array(select i.item_id from public.booking_items i where i.booking_id = b.id order by i.item_id) as items,
  b.hold_until,
  b.packages,
  public.booking_quote(array(select i.item_id from public.booking_items i where i.booking_id = b.id), b.packages) as item_price
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
  v_packages text[] := array(select p.id from public.packages p
    where p.id in (select jsonb_array_elements_text(coalesce(b -> 'packages', '[]'::jsonb))) order by p.sort);
  v_price numeric;
  v_start timestamptz;
  v_end timestamptz;
  v_taken text[];
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  -- An app opened before an update may not show every item, and saving would drop the ones it doesn't show.
  if coalesce(nullif(b ->> 'form_version', '')::int, 1) < 2 then
    raise exception 'This app is out of date. Close it fully and open it again.' using errcode = 'P0001';
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

  -- A price left empty is worked out from the items and packages.
  v_price := coalesce(nullif(b ->> 'price', '')::numeric, public.booking_quote(v_items, v_packages));

  -- Drop removed items before new times apply, so a removed item can't cause a false conflict.
  delete from public.booking_items where booking_id = v_id and item_id <> all (v_items);
  if v_id is null then
    insert into public.bookings (customer_id, status, event_start, event_end, setup_minutes, pickup_minutes, address, venue, event_type, guests, price, packages, deposit_paid, notes)
    values (v_customer, v_status, v_start, v_end, v_setup, v_pickup, nullif(trim(b ->> 'address'), ''), nullif(trim(b ->> 'venue'), ''),
      nullif(b ->> 'event_type', ''), nullif(b ->> 'guests', '')::int, v_price, v_packages,
      coalesce((b ->> 'deposit_paid')::boolean, false), nullif(trim(b ->> 'notes'), ''))
    returning id into v_id;
  else
    update public.bookings
    set customer_id = v_customer, status = v_status, event_start = v_start, event_end = v_end, setup_minutes = v_setup, pickup_minutes = v_pickup,
      address = nullif(trim(b ->> 'address'), ''), venue = nullif(trim(b ->> 'venue'), ''), event_type = nullif(b ->> 'event_type', ''),
      guests = nullif(b ->> 'guests', '')::int, price = v_price, packages = v_packages,
      deposit_paid = coalesce((b ->> 'deposit_paid')::boolean, false), notes = nullif(trim(b ->> 'notes'), ''),
      hold_until = null
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
-- confirms or declines, or hold_until passes. Anyone can call this, so it checks everything itself, never
-- changes existing customers, and never passes database error details (which can include whole rows) back.
create or replace function public.request_booking(r jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := regexp_replace(trim(coalesce(r ->> 'name', '')), '\s+', ' ', 'g');
  v_email text := lower(trim(coalesce(r ->> 'email', '')));
  v_phone text := nullif(trim(coalesce(r ->> 'phone', '')), '');
  v_digits text := regexp_replace(coalesce(r ->> 'phone', ''), '\D', '', 'g');
  v_address text := nullif(trim(coalesce(r ->> 'address', '')), '');
  v_venue text := nullif(trim(coalesce(r ->> 'venue', '')), '');
  v_type text := nullif(trim(coalesce(r ->> 'event_type', '')), '');
  v_notes text := nullif(trim(coalesce(r ->> 'notes', '')), '');
  v_guests text := coalesce(r ->> 'guests', '');
  v_items text[];
  v_today date := (now() at time zone 'America/Detroit')::date;
  v_rules public.settings;
  v_day date;
  v_start_time time;
  v_end_time time;
  v_start timestamptz;
  v_end timestamptz;
  v_hold timestamptz;
  v_customer bigint;
  v_customer_phone text;
  v_id bigint;
  v_taken text[];
  v_packages text[];
begin
  -- The trap field is hidden from people, so only bots fill it in: report success and save nothing.
  if coalesce(r ->> 'trap', '') <> '' then
    return jsonb_build_object('hold_until', null);
  end if;
  begin
    v_day := (r ->> 'date')::date;
    v_start_time := (r ->> 'start')::time;
    v_end_time := (r ->> 'end')::time;
    v_items := array(select distinct jsonb_array_elements_text(coalesce(r -> 'items', '[]'::jsonb)));
    v_packages := array(select p.id from public.packages p
      where p.id in (select jsonb_array_elements_text(coalesce(r -> 'packages', '[]'::jsonb))) order by p.sort);
  exception when others then
    raise exception 'invalid_request' using errcode = '22023';
  end;
  -- The email pattern keeps out characters that would change a mailto: link in the owner app.
  if v_name = '' or char_length(v_name) > 200 or char_length(v_email) > 254
     or v_email !~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$'
     or char_length(coalesce(v_phone, '')) > 40 or char_length(coalesce(v_address, '')) > 300
     or char_length(coalesce(v_venue, '')) > 200 or char_length(coalesce(v_type, '')) > 100
     or char_length(coalesce(v_notes, '')) > 4500 or (v_guests <> '' and v_guests !~ '^[1-9][0-9]{0,4}$')
     or cardinality(v_items) > 20
     or v_day is null or v_start_time is null or v_end_time is null or v_day < v_today or v_day > v_today + 550 then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  -- One request at a time, so the limits below hold even when many arrive at once.
  perform pg_advisory_xact_lock(hashtext('bloom-request-booking'));
  perform private.expire_holds();

  -- Spam limits: two waiting requests per email or phone; overall at most ten new website requests an hour,
  -- thirty a day, and thirty waiting at once, so a script can't hold the whole calendar.
  if (select count(*) from public.bookings b join public.customers c on c.id = b.customer_id
      where b.source = 'website' and b.status = 'requested'
        and (c.email = v_email or (char_length(v_digits) >= 7 and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = v_digits))) >= 2 then
    raise exception 'pending_limit' using errcode = 'P0001';
  end if;
  if (select count(*) from public.bookings b where b.source = 'website' and b.created_at > now() - interval '1 hour') >= 10
     or (select count(*) from public.bookings b where b.source = 'website' and b.created_at > now() - interval '1 day') >= 30
     or (select count(*) from public.bookings b where b.source = 'website' and b.status = 'requested') >= 30 then
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

  -- A returning customer is matched only on the same name and email, and is never changed from here.
  -- A different phone number is noted on the request instead.
  select c.id, c.phone into v_customer, v_customer_phone from public.customers c
  where c.email = v_email and lower(regexp_replace(trim(c.name), '\s+', ' ', 'g')) = lower(v_name)
  order by c.id limit 1;
  if v_customer is not null and v_phone is not null and regexp_replace(coalesce(v_customer_phone, ''), '\D', '', 'g') <> v_digits then
    v_notes := concat_ws(E'\n', 'Phone given with this request: ' || v_phone, v_notes);
  end if;
  v_hold := now() + make_interval(hours => v_rules.hold_hours);
  begin
    if v_customer is null then
      insert into public.customers (name, phone, email) values (v_name, v_phone, v_email) returning id into v_customer;
    end if;
    insert into public.bookings (customer_id, status, source, event_start, event_end, setup_minutes, pickup_minutes, hold_until, address, venue, event_type, guests, notes, packages, price)
    values (v_customer, 'requested', 'website', v_start, v_end, v_rules.setup_minutes, v_rules.pickup_minutes, v_hold,
      v_address, v_venue, v_type, nullif(v_guests, '')::int, v_notes, v_packages, public.booking_quote(v_items, v_packages))
    returning id into v_id;
    -- The conflict target matters: without it an overlap would be skipped silently instead of refused.
    insert into public.booking_items (booking_id, item_id) select v_id, unnest(v_items) on conflict (booking_id, item_id) do nothing;
  exception
    when exclusion_violation then
      raise exception 'Already booked at that time' using errcode = '23P01';
    when others then
      raise exception 'invalid_request' using errcode = '22023';
  end;
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

-- Phone alerts and the calendar link. The edge function bloom-bookings (supabase/functions) sends the
-- alerts and serves the calendar; it reaches these tables only through the service-role functions below.
create or replace function private.item_names(ids text[]) returns text
language plpgsql stable set search_path = ''
as $$
declare
  names text[] := array(select i.name from public.items i where i.id = any (ids) order by i.sort);
  n int := cardinality(names);
begin
  return case when n = 0 then null when n < 3 then array_to_string(names, ' and ')
    else array_to_string(names[1:n - 1], ', ') || ' and ' || names[n] end;
end
$$;

-- "2 PM" or "2:30 PM", Detroit time.
create or replace function private.clock(t timestamptz) returns text
language sql stable set search_path = ''
as $$ select replace(to_char(t at time zone 'America/Detroit', 'FMHH12:MI AM'), ':00', '') $$;

-- "Sat, Nov 25, 2 PM – 6 PM", with the year when it isn't this year.
create or replace function private.when_text(s timestamptz, e timestamptz) returns text
language sql stable set search_path = ''
as $$
  select to_char(s at time zone 'America/Detroit', 'Dy, Mon FMDD')
    || case when extract(year from s at time zone 'America/Detroit') <> extract(year from now() at time zone 'America/Detroit')
         then to_char(s at time zone 'America/Detroit', ', YYYY') else '' end
    || ', ' || private.clock(s) || ' – ' || private.clock(e)
$$;
revoke all on function private.item_names(text[]), private.clock(timestamptz), private.when_text(timestamptz, timestamptz) from public;

-- The key pair phones use to check that alerts really come from Bloom Bookings. Made once by the edge function.
create table if not exists private.alert_keys (
  id boolean primary key default true check (id),
  public_key text not null check (public_key ~ '^[A-Za-z0-9_-]{87}$'),
  private_key jsonb not null,
  created_at timestamptz not null default now()
);
alter table private.alert_keys enable row level security;

-- Phones that turned on alerts in the owner app, one row per phone.
create table if not exists private.phones (
  endpoint text primary key check (endpoint ~ '^https://[^\s]+$' and char_length(endpoint) <= 1000),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}=*$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{16,40}=*$'),
  email text not null,
  created_at timestamptz not null default now()
);
alter table private.phones enable row level security;

-- Alerts waiting to be sent: one per new website request, or a test for one phone.
create table if not exists private.alerts (
  id bigint generated always as identity primary key,
  booking_id bigint references public.bookings on delete cascade,
  endpoint text references private.phones on delete cascade,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz
);
create index if not exists alerts_waiting on private.alerts (id) where sent_at is null;
alter table private.alerts enable row level security;

-- Asks the edge function to send waiting alerts. Runs after a request is saved and every few minutes.
-- It never raises: an alert must never stop a customer's request from being saved.
create or replace function private.send_alerts() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from private.alerts a where a.sent_at is null and a.created_at > now() - interval '1 day'
               and (a.claimed_at is null or a.claimed_at < now() - interval '2 minutes'))
     and exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'net' and p.proname = 'http_post') then
    perform net.http_post(url := 'https://dwazctmqkrnajqmswtiy.supabase.co/functions/v1/bloom-bookings/send',
      body := '{}'::jsonb, timeout_milliseconds := 10000);
  end if;
exception when others then
  null;
end
$$;
revoke all on function private.send_alerts() from public;

create or replace function private.alert_new_request() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from private.phones) then
    insert into private.alerts (booking_id) values (new.id);
    perform private.send_alerts();
  end if;
  return null;
exception when others then
  return null;
end
$$;
revoke all on function private.alert_new_request() from public;
drop trigger if exists bookings_alert on public.bookings;
create trigger bookings_alert after insert on public.bookings
  for each row when (new.source = 'website' and new.status = 'requested') execute function private.alert_new_request();

-- For the owner app: turn alerts on or off for this phone, or send it a test.
create or replace function public.save_phone(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  insert into private.phones (endpoint, p256dh, auth, email) values (p_endpoint, p_p256dh, p_auth, lower(auth.jwt() ->> 'email'))
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, email = excluded.email;
exception when check_violation or not_null_violation then
  raise exception 'invalid_phone' using errcode = '22023';
end
$$;

create or replace function public.remove_phone(p_endpoint text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  delete from private.phones where endpoint = p_endpoint;
end
$$;

create or replace function public.test_phone_alert(p_endpoint text) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from private.phones where endpoint = p_endpoint) then
    return false;
  end if;
  insert into private.alerts (endpoint) values (p_endpoint);
  perform private.send_alerts();
  return true;
end
$$;
revoke all on function public.save_phone(text, text, text), public.remove_phone(text), public.test_phone_alert(text) from public, anon;
grant execute on function public.save_phone(text, text, text), public.remove_phone(text), public.test_phone_alert(text) to authenticated;

-- For the edge function only (service role): the key pair, and claiming and finishing alerts.
create or replace function public.alert_public_key() returns text
language sql stable security definer set search_path = ''
as $$ select k.public_key from private.alert_keys k $$;

create or replace function public.save_alert_keys(p_public text, p_private jsonb) returns text
language sql security definer set search_path = ''
as $$
  insert into private.alert_keys (public_key, private_key) values (p_public, p_private) on conflict (id) do nothing;
  select k.public_key from private.alert_keys k;
$$;

-- Hands out up to 20 waiting alerts with their text and the phones to send them to. An alert that was
-- handed out but not finished is handed out again after two minutes; after a day it is dropped.
create or replace function public.claim_alerts() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_badge int := (select count(*) from public.bookings b
                  where b.source = 'website' and b.status = 'requested' and (b.hold_until is null or b.hold_until > now()));
  v_alerts jsonb;
begin
  with picked as (
    select a.id from private.alerts a
    where a.sent_at is null and a.created_at > now() - interval '1 day'
      and (a.claimed_at is null or a.claimed_at < now() - interval '2 minutes')
    order by a.id limit 20
    for update skip locked
  ), claimed as (
    update private.alerts a set claimed_at = now() from picked where a.id = picked.id
    returning a.id, a.booking_id, a.endpoint
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'message', case when c.booking_id is null
        then jsonb_build_object('title', 'Test alert', 'body', 'Alerts are working on this phone.', 'url', './', 'tag', 'test')
        else jsonb_build_object('title', 'New request: ' || coalesce(cu.name, 'someone'),
          'body', concat_ws(' · ', private.when_text(b.event_start, b.event_end),
            private.item_names(array(select i.item_id from public.booking_items i where i.booking_id = b.id)),
            '$' || to_char(b.price, 'FM999,999,990.00')),
          'url', './?open=requests', 'tag', 'request-' || b.id)
        end || jsonb_build_object('badge', v_badge),
      'phones', coalesce((select jsonb_agg(jsonb_build_object('endpoint', p.endpoint, 'p256dh', p.p256dh, 'auth', p.auth))
        from private.phones p join private.admins ad on ad.email = p.email
        where (c.endpoint is null or p.endpoint = c.endpoint) and (c.booking_id is null or b.status = 'requested')), '[]'::jsonb)
    ) order by c.id), '[]'::jsonb)
  into v_alerts
  from claimed c
  left join public.bookings b on b.id = c.booking_id
  left join public.customers cu on cu.id = b.customer_id;
  return jsonb_build_object(
    'keys', (select jsonb_build_object('public', k.public_key, 'private', k.private_key) from private.alert_keys k),
    'alerts', v_alerts);
end
$$;

create or replace function public.finish_alerts(p_sent bigint[], p_gone text[]) returns void
language sql security definer set search_path = ''
as $$
  update private.alerts set sent_at = now() where id = any (p_sent);
  delete from private.phones where endpoint = any (p_gone);
$$;

-- The calendar link: a long random code in the address is the only thing that opens it.
create table if not exists private.calendar_link (
  id boolean primary key default true check (id),
  token text not null check (token ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);
alter table private.calendar_link enable row level security;

create or replace function public.calendar_link(p_reset boolean default false) returns text
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_reset then
    delete from private.calendar_link;
  end if;
  insert into private.calendar_link (token) values (replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (id) do nothing;
  return (select l.token from private.calendar_link l);
end
$$;
revoke all on function public.calendar_link(boolean) from public, anon;
grant execute on function public.calendar_link(boolean) to authenticated;

-- Confirmed bookings and live holds from six months back to two years ahead, ready for a calendar file.
create or replace function public.calendar_feed(p_token text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when exists (select 1 from private.calendar_link l where l.token = p_token) then
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'uid', 'booking-' || b.id || '@bloom-events',
        'start', to_char(b.event_start at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
        'end', to_char(b.event_end at time zone 'UTC', 'YYYYMMDD"T"HH24MISS"Z"'),
        'status', case when b.status = 'confirmed' then 'CONFIRMED' else 'TENTATIVE' end,
        'summary', case when b.status = 'requested' then 'On hold: ' else '' end || coalesce(c.name, 'Booking')
          || coalesce(' · ' || private.item_names(array(select i.item_id from public.booking_items i where i.booking_id = b.id)), ''),
        'location', coalesce(b.address, b.venue),
        'description', concat_ws(E'\n',
          'Setup from ' || private.clock(b.event_start - make_interval(mins => b.setup_minutes))
            || ', pickup by ' || private.clock(b.event_end + make_interval(mins => b.pickup_minutes)),
          case when b.address is not null and b.venue is not null then 'Venue: ' || b.venue end,
          'Phone: ' || c.phone,
          'Email: ' || c.email,
          nullif(concat_ws(' · ', b.event_type, b.guests || ' guests'), ''),
          'Price: ' || to_char(b.price, 'FM$999,999,990.00') || case when b.deposit_paid then ', deposit paid' else ', deposit not paid' end,
          case when b.status = 'requested' then 'On hold'
            || case when b.source = 'website' then ' (website request)' else '' end
            || coalesce(' until ' || to_char(b.hold_until at time zone 'America/Detroit', 'Dy, Mon FMDD') || ', ' || private.clock(b.hold_until), '') end,
          'Notes: ' || b.notes)
      ) order by b.event_start, b.id)
      from public.bookings b
      left join public.customers c on c.id = b.customer_id
      where b.status in ('requested', 'confirmed')
        and (b.status <> 'requested' or b.hold_until is null or b.hold_until > now())
        and b.event_end > now() - interval '180 days' and b.event_start < now() + interval '2 years'
    ), '[]'::jsonb)
  end
$$;
revoke all on function public.alert_public_key(), public.save_alert_keys(text, jsonb), public.claim_alerts(),
  public.finish_alerts(bigint[], text[]), public.calendar_feed(text) from public, anon, authenticated;
grant execute on function public.alert_public_key(), public.save_alert_keys(text, jsonb), public.claim_alerts(),
  public.finish_alerts(bigint[], text[]), public.calendar_feed(text) to service_role;

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

-- Upcoming bookings saved before prices were worked out automatically get their price from their items. Website
-- requests from then named their package only in the notes ("Package: ..."), so it's read from there first.
update public.bookings b
set packages = array(select p.id from public.packages p
  where position(p.name in substring(b.notes from '(?:^|\n)Package: ([^\n]*)')) > 0 order by p.sort)
where b.price is null and b.status in ('requested', 'confirmed') and b.event_end > now()
  and b.source = 'website' and cardinality(b.packages) = 0 and b.notes ~ '(?:^|\n)Package: ';
update public.bookings b
set price = public.booking_quote(array(select i.item_id from public.booking_items i where i.booking_id = b.id), b.packages)
where b.price is null and b.status in ('requested', 'confirmed') and b.event_end > now();

-- Every 15 minutes, expire website holds that ran out, and every 5 minutes retry alerts that didn't go out.
-- Skipped where pg_net or pg_cron isn't available (local tests); the functions above also expire stale
-- holds before they save anything, and a new request asks for its alert right away.
-- Each extension is created only once: on Supabase, "create extension if not exists" re-runs its access setup
-- even when the extension is already there.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net')
     and not exists (select 1 from pg_extension where extname = 'pg_net') then
    create extension pg_net with schema extensions;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    if not exists (select 1 from pg_extension where extname = 'pg_cron') then
      create extension pg_cron with schema pg_catalog;
    end if;
    perform cron.schedule('bloom-expire-holds', '*/15 * * * *', 'select private.expire_holds()');
    perform cron.schedule('bloom-send-alerts', '*/5 * * * *', 'select private.send_alerts()');
  end if;
end
$$;
