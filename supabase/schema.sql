-- Bloom Events availability calendar (Supabase project dwazctmqkrnajqmswtiy).
-- Safe to run more than once. Visitors only ever see which items are taken on which dates,
-- through booked_items(); customer names and notes are readable only by signed-in admins.

create schema if not exists private;

-- Emails allowed to manage bookings on admin.html. Add one with:
--   insert into private.admins (email) values ('owner@example.com');
create table if not exists private.admins (
  email text primary key check (email = lower(email))
);
alter table private.admins enable row level security;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from private.admins a
    where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  -- admin.html signs in with emailed codes only. Refusing password sessions stops someone who
  -- registers an admin's email with a password before the admin's first sign-in.
  and not exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) m
    where m ->> 'method' = 'password'
  )
$$;
revoke all on function private.is_admin() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

-- One row per item per booked day. Item ids match RENTALS in site.js (packages are booked as their parts).
create table if not exists public.reservations (
  id bigint generated always as identity primary key,
  item_id text not null check (item_id in (
    'ivory-wall', 'garden-wall', 'pink-ombre-wall', 'red-rose-wall', 'champagne-wall',
    'greenery-wall', 'ivory-texture-wall', 'bloom-bar', 'pedestals', 'sweets-cart')),
  event_date date not null,
  customer text check (char_length(customer) <= 200),
  note text check (char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  unique (item_id, event_date)
);
alter table public.reservations enable row level security;
revoke all on public.reservations from anon, authenticated;
grant select, insert, update, delete on public.reservations to authenticated;

drop policy if exists "Admins manage reservations" on public.reservations;
create policy "Admins manage reservations" on public.reservations
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- Public availability: item and date only, at most about 13 months per call.
create or replace function public.booked_items(from_date date, to_date date)
returns table (item_id text, event_date date)
language sql stable security definer set search_path = ''
as $$
  select r.item_id, r.event_date
  from public.reservations r
  where r.event_date between from_date and least(to_date, from_date + 400)
  order by r.event_date, r.item_id
$$;
revoke all on function public.booked_items(date, date) from public;
grant execute on function public.booked_items(date, date) to anon, authenticated;

-- Lets admin.html tell a signed-in visitor whether their email can manage bookings.
create or replace function public.am_i_admin() returns boolean
language sql stable security invoker set search_path = ''
as $$ select private.is_admin() $$;
revoke all on function public.am_i_admin() from public, anon;
grant execute on function public.am_i_admin() to authenticated;
