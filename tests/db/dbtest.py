"""Runs supabase/schema.sql on a throwaway local Postgres set up like Supabase, then checks the rules.

    python tests/db/dbtest.py [schema.sql] [older-schema.sql]

The optional second file is run first, to test upgrading from it (for example the schema that is live now:
git show main:supabase/schema.sql > live.sql). Needs psycopg (pip install "psycopg[binary]") and a Postgres 17
with contrib: `npm install` in tests/ fetches a portable one on Windows, or set PG_BIN to a bin folder.
"""
import datetime, json, re, sys, pathlib
import psycopg
import pgtools

HERE = pathlib.Path(__file__).resolve().parent
SCHEMA_PATH = sys.argv[1] if len(sys.argv) > 1 else str(HERE.parent.parent / 'supabase' / 'schema.sql')
SCHEMA = pathlib.Path(SCHEMA_PATH).read_text(encoding='utf-8')
print('schema:', SCHEMA_PATH)
ADMIN = 'owner@example.com'
failures = []

def check(cond, msg):
    print(('ok   ' if cond else 'FAIL ') + msg)
    if not cond:
        failures.append(msg)

# Portable Postgres 17 (same major version as Supabase) with contrib extensions such as btree_gist.
conn = pgtools.server()
DSN = conn.info.dsn
x = conn.execute

# Supabase-like environment: roles, auth.jwt(), extensions schema, default grants, America/Detroit-free UTC session.
x("""
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create schema extensions;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.jwt() to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
set timezone = 'UTC';
""")
# Version 1 as it is live now, with one row to migrate.
x("""
create schema private;
create table private.admins (email text primary key check (email = lower(email)));
create table public.reservations (id bigint generated always as identity primary key, item_id text not null, event_date date not null, customer text, note text, created_at timestamptz not null default now(), unique (item_id, event_date));
insert into public.reservations (item_id, event_date, customer, note) values ('garden-wall', '2027-02-10', 'Old Customer', 'from v1'), ('bloom-bar', '2027-02-10', 'Old Customer', 'from v1');
""")
x(f"insert into private.admins values ('{ADMIN}')")

# Optionally the schema that is live now first, to test the upgrade from it.
if len(sys.argv) > 2:
    x(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
    print('upgraded from:', sys.argv[2])
x(SCHEMA)
x(SCHEMA)  # safe to run twice
check(x("select to_regclass('public.reservations')").fetchone()[0] is None, 'v1 table removed')
mig = x("select c.name, b.notes, array(select item_id from booking_items i where i.booking_id=b.id order by 1), b.event_start at time zone 'America/Detroit', b.event_end at time zone 'America/Detroit' from bookings b join customers c on c.id=b.customer_id").fetchall()
check(len(mig) == 1 and mig[0][0] == 'Old Customer' and mig[0][2] == ['bloom-bar', 'garden-wall'] and str(mig[0][3]) == '2027-02-10 00:00:00' and str(mig[0][4]) == '2027-02-11 00:00:00', f'v1 rows migrated as one all-day booking: {mig}')

def as_role(role, email=None, amr='password'):
    x('reset role')
    claims = {'role': role} if email is None else {'role': role, 'email': email, 'amr': [{'method': amr}]}
    x("select set_config('request.jwt.claims', %s, false)", [json.dumps(claims)])
    x(f'set role {role}')

def save(**b):
    return x('select public.save_booking(%s::jsonb)', [json.dumps({'form_version': 3, **b})]).fetchone()[0]

def expect_error(fn, code, msg):
    try:
        fn()
    except psycopg.Error as e:
        check(e.sqlstate == code, f'{msg} (got {e.sqlstate}: {e.diag.message_primary}; detail {e.diag.message_detail})')
        return e
    check(False, f'{msg} (no error)')

# --- admin ---
as_role('authenticated', ADMIN)
check(x('select public.am_i_admin()').fetchone()[0] is True, 'admin recognized (password sign-in allowed)')
a = save(customer_name='Jane Doe', customer_phone='586-555-0100', customer_email='Jane@Example.com', date='2027-05-01', start='14:00', end='21:00', items=['ivory-wall', 'bloom-bar'], address='12 Main St, Macomb', venue='Palazzo', event_type='Wedding', guests='120', price='450', deposit_paid=True, notes='Pink')
row = x("select start_local, end_local, items, customer_email, setup_minutes, pickup_minutes, status, price, deposit_paid, guests from owner_bookings where id=%s", [a]).fetchone()
check(str(row[0]) == '2027-05-01 14:00:00' and str(row[1]) == '2027-05-01 21:00:00', f'Detroit wall-clock times round-trip: {row[0]} to {row[1]}')
check(row[2] == ['bloom-bar', 'ivory-wall'] and row[3] == 'jane@example.com' and row[4] == 120 and row[5] == 120 and row[6] == 'confirmed' and float(row[7]) == 450 and row[8] is True and row[9] == 120, f'fields saved with defaults: {row}')
utc = x("select event_start from bookings where id=%s", [a]).fetchone()[0]
check(str(utc).startswith('2027-05-01 18:00:00'), f'stored in UTC correctly (EDT = UTC-4): {utc}')
blocked = x("select lower(blocked) at time zone 'America/Detroit', upper(blocked) at time zone 'America/Detroit' from booking_items where booking_id=%s limit 1", [a]).fetchone()
check(str(blocked[0]) == '2027-05-01 12:00:00' and str(blocked[1]) == '2027-05-01 23:00:00', f'held from setup to pickup: {blocked}')

e = expect_error(lambda: save(customer_name='Bob', date='2027-05-01', start='08:00', end='11:00', items=['ivory-wall', 'pedestals']), '23P01', 'overlap with pickup buffer refused with a readable error')
check(e is not None and e.diag.message_detail == 'ivory-wall', 'error names only the taken item')
c = save(customer_name='Early Bird', date='2027-05-01', start='07:00', end='09:00', setup_minutes='60', pickup_minutes='60', items=['ivory-wall'])
check(c is not None, 'same item earlier that day fits when times and buffers do not overlap')
conf = x("select item_id, booking_id, customer_name from item_conflicts('2027-05-01', '13:00', '15:00', 120, 120)").fetchall()
check(sorted(r[0] for r in conf) == ['bloom-bar', 'ivory-wall'] and {r[2] for r in conf} == {'Jane Doe'}, f'item_conflicts lists held items and names: {conf}')
early = x("select item_id, customer_name from item_conflicts('2027-05-01', '09:30', '10:00', 0, 0)").fetchall()
check(early == [('ivory-wall', 'Early Bird')], f'item_conflicts catches the early booking inside its pickup time: {early}')
check(x("select count(*) from item_conflicts('2027-05-01', '13:00', '15:00', 120, 120, %s)", [a]).fetchone()[0] == 0, 'item_conflicts ignores the booking being edited')

# The constraint itself (not just the friendly pre-check) blocks overlaps.
def raw_overlap():
    bid = x("insert into bookings (customer_id, event_start, event_end) values (null, '2027-05-01 20:00-04', '2027-05-01 22:00-04') returning id").fetchone()[0]
    x("insert into booking_items (booking_id, item_id) values (%s, 'bloom-bar')", [bid])
x('begin')
expect_error(raw_overlap, '23P01', 'exclusion constraint blocks overlaps that skip save_booking')
x('rollback')

# Editing: move A later; removed item doesn't cause a false conflict; times re-hold.
save(id=str(a), customer_id=str(x('select customer_id from bookings where id=%s', [a]).fetchone()[0]), customer_name='Jane D.', customer_phone='586-555-0100', customer_email='jane@example.com', date='2027-05-01', start='16:00', end='23:30', items=['bloom-bar'], status='confirmed')
row = x("select start_local, end_local, items, customer_name from owner_bookings where id=%s", [a]).fetchone()
check(str(row[0]) == '2027-05-01 16:00:00' and row[2] == ['bloom-bar'] and row[3] == 'Jane D.', f'edit saves new time, items and customer name: {row}')
check(x("select count(*) from booking_items where booking_id=%s", [a]).fetchone()[0] == 1, 'removed item released')
check(save(customer_name='Bob', date='2027-05-01', start='12:00', end='13:00', setup_minutes='0', pickup_minutes='0', items=['ivory-wall']) is not None, 'ivory wall free again after it was removed from the edited booking')

# Overnight event: end before start = next day.
d = save(customer_name='Night Owl', date='2027-05-08', start='20:00', end='01:00', items=['sweets-cart'])
row = x("select start_local, end_local from owner_bookings where id=%s", [d]).fetchone()
check(str(row[1]) == '2027-05-09 01:00:00', f'end before start rolls to the next day: {row}')

# Status: cancelling frees the items; restoring checks again.
x("update bookings set status='cancelled' where id=%s", [d])
check(x("select active from booking_items where booking_id=%s", [d]).fetchone()[0] is False, 'cancelled booking stops holding items')
check(save(customer_name='Takes Slot', date='2027-05-08', start='21:00', end='23:00', items=['sweets-cart']) is not None, 'cancelled slot can be rebooked')
x('begin')
expect_error(lambda: x("update bookings set status='confirmed' where id=%s", [d]), '23P01', 'restoring a cancelled booking into a taken slot is refused')
x('rollback')

# Hold (requested) blocks like confirmed.
h = save(customer_name='Hold', date='2027-06-01', start='10:00', end='12:00', items=['pedestals'], status='requested')
expect_error(lambda: save(customer_name='Other', date='2027-06-01', start='11:00', end='12:00', items=['pedestals']), '23P01', 'a hold blocks the time too')
expect_error(lambda: save(customer_name='Nothing', date='2027-06-02', start='10:00', end='12:00', items=[]), '22023', 'a booking needs at least one item')

# DST: a November date is EST (UTC-5).
n = save(customer_name='Fall', date='2027-11-20', start='14:00', end='18:00', items=['greenery-wall'])
check(str(x('select event_start from bookings where id=%s', [n]).fetchone()[0]).startswith('2027-11-20 19:00:00'), 'winter dates use EST (UTC-5)')

late = save(customer_name='Late Party', date='2027-05-15', start='20:00', end='01:00', items=['pedestals'])

# Views and customers
cust = x("select name, booking_count from owner_customers order by name").fetchall()
check(('Jane D.', 1) in cust and ('Night Owl', 0) in cust and ('Late Party', 1) in cust, f'owner_customers counts only active bookings: {cust}')
x("update settings set setup_minutes = 90, pickup_minutes = 30")
s = save(customer_name='Defaults', date='2027-07-01', start='10:00', end='11:00', items=['champagne-wall'])
check(x('select setup_minutes, pickup_minutes from bookings where id=%s', [s]).fetchone() == (90, 30), 'settings supply the default setup and pickup time')
expect_error(lambda: x("delete from customers where name='Jane D.'"), '23503', 'a customer with bookings cannot be deleted')

# --- public availability ---
as_role('anon')
days = x("select item_id, event_date::text from booked_items('2027-05-01', '2027-05-31')").fetchall()
check(('bloom-bar', '2027-05-01') in days and ('ivory-wall', '2027-05-01') in days, f'booked_items shows held items by day: {days}')
check(('pedestals', '2027-05-15') in days and ('pedestals', '2027-05-16') in days, 'an event past midnight shows on both days')
check(('sweets-cart', '2027-05-09') not in days, 'the cancelled overnight event no longer shows')
check(('pedestals', '2027-06-01') not in days, 'booked_items respects the range')
check(x("select count(*) from booked_items('2027-02-01', '2027-02-28')").fetchone()[0] == 2, 'migrated v1 booking still shows publicly')
for sql, what in [("select * from bookings", 'bookings'), ("select * from customers", 'customers'), ("select * from booking_items", 'booking items'),
                  ("select * from owner_bookings", 'owner_bookings view'), ("select * from owner_customers", 'owner_customers view'), ("select * from settings", 'settings'),
                  ("select * from private.admins", 'admin list'), ("select public.am_i_admin()", 'am_i_admin'),
                  ("select public.save_booking('{}'::jsonb)", 'save_booking'), ("select * from item_conflicts('2027-05-01','10:00','11:00',0,0)", 'item_conflicts'),
                  ("insert into customers (name) values ('x')", 'insert customer')]:
    x('begin')
    expect_error(lambda: x(sql), '42501', f'visitors blocked from {what}')
    x('rollback')

# --- signed in, but not on the admin list ---
as_role('authenticated', 'stranger@example.com')
check(x('select public.am_i_admin()').fetchone()[0] is False, 'non-admin is told they are not an admin')
check(x('select count(*) from owner_bookings').fetchone()[0] == 0 and x('select count(*) from customers').fetchone()[0] == 0, 'non-admin sees no bookings or customers')
expect_error(lambda: save(customer_name='Sneaky', date='2027-08-01', start='10:00', end='11:00', items=['ivory-wall']), '42501', 'non-admin cannot save bookings')
check(x("update bookings set status='cancelled'").rowcount == 0, 'non-admin cannot change bookings')

x('reset role')

# ---------- Phase 2: website requests that hold time ----------
def req(**r):
    return x('select public.request_booking(%s::jsonb)', [json.dumps(r)]).fetchone()[0]
rules = x('select setup_minutes, pickup_minutes from public.booking_rules()').fetchone()
WEB = dict(name='Web Person', email='Web@Example.com', phone='(586) 555-0133', date='2027-08-14', start='15:00', end='19:00',
           items=['red-rose-wall', 'bloom-bar'], venue='Oak Hall', address='5 Oak St, Macomb', event_type='Birthday', guests='40', notes='Pink please')
as_role('anon')
first = req(**WEB)
check(first and first.get('hold_until'), f'a visitor can send a request: {first}')
x('reset role')
row = x("""select b.status, b.source, c.email, c.phone, b.venue, b.address, b.guests, b.notes,
                  extract(epoch from (b.hold_until - now())) / 3600, b.setup_minutes, b.pickup_minutes, b.id
           from bookings b join customers c on c.id = b.customer_id where b.source = 'website'""").fetchone()
check(row[0] == 'requested' and row[1] == 'website' and row[2] == 'web@example.com' and row[4] == 'Oak Hall' and row[6] == 40 and row[7] == 'Pink please', f'request saved as a website hold with its details: {row[:8]}')
check(71.9 < float(row[8]) <= 72, f'held for 72 hours by default: {float(row[8]):.2f}h')
check((row[9], row[10]) == rules, 'request uses the current setup and pickup time')
web_id = row[11]
as_role('anon')
avail = x("select item_id, busy_from::text, busy_until::text from public.availability('2027-08-14', '2027-08-14')").fetchall()
cols = [d.name for d in x("select * from public.availability('2027-08-14', '2027-08-14')").description]
import datetime
exp_from = (datetime.datetime(2027, 8, 14, 15, 0) - datetime.timedelta(minutes=rules[0])).strftime('%Y-%m-%d %H:%M:%S')
check(len(avail) == 2 and {a[0] for a in avail} == {'red-rose-wall', 'bloom-bar'} and cols == ['item_id', 'busy_from', 'busy_until'], f'visitors see held times per item, no names: {avail}')
check(avail[0][1] == exp_from, f'held time starts at setup: {avail[0][1]} (expected {exp_from})')
e = expect_error(lambda: req(**{**WEB, 'email': 'other@example.com', 'phone': '', 'start': '18:00', 'end': '22:00', 'items': ['red-rose-wall', 'pedestals']}), '23P01', 'a request overlapping a hold is refused')
check(e is not None and e.diag.message_detail == 'red-rose-wall', 'refusal names the taken item')
second = req(**{**WEB, 'items': ['greenery-wall'], 'date': '2027-08-20'})
check(second and second.get('hold_until'), 'a second request from the same person is fine')
x('reset role')
check(x("select count(*) from customers where email = 'web@example.com'").fetchone()[0] == 1, 'the same email reuses one customer')
as_role('anon')
expect_error(lambda: req(**{**WEB, 'items': ['garden-wall'], 'date': '2027-08-21'}), 'P0001', 'a third waiting request from the same email is refused (pending limit)')
expect_error(lambda: req(**{**WEB, 'email': 'new@example.com', 'phone': '586.555.0133', 'items': ['garden-wall'], 'date': '2027-08-21'}), 'P0001', 'same phone number with another email is refused too')
check(req(**{**WEB, 'trap': 'I am a bot', 'email': 'bot@example.com'}) == {'hold_until': None}, 'the hidden trap field fakes success')
x('reset role')
check(x("select count(*) from customers where email = 'bot@example.com'").fetchone()[0] == 0, 'and saves nothing')
as_role('anon')
expect_error(lambda: req(**{**WEB, 'email': 'past@example.com', 'date': '2020-01-01'}), '22023', 'a date in the past is refused')
expect_error(lambda: req(**{**WEB, 'email': 'not-an-email'}), '22023', 'an invalid email is refused')
expect_error(lambda: req(**{**WEB, 'email': 'time@example.com', 'start': 'soon'}), '22023', 'an invalid time is refused')
x('begin')
expect_error(lambda: x('select private.expire_holds()'), '42501', 'visitors cannot run the expiry job')
x('rollback')
no_items = req(name='Just Asking', email='ask@example.com', date='2027-09-10', start='10:00', end='12:00', items=[])
check(no_items and no_items.get('hold_until'), 'a request with no items still reaches the owner')

# Holds that run out stop holding, even before the expiry job marks them.
x('reset role')
x('update bookings set hold_until = now() - interval \'1 minute\' where id = %s', [web_id])
as_role('anon')
check(x("select count(*) from public.availability('2027-08-14', '2027-08-14')").fetchone()[0] == 0, 'a hold past its time no longer shows as busy')
check(x("select count(*) from public.booked_items('2027-08-14', '2027-08-14')").fetchone()[0] == 0, 'or on the day-level lookup')
x('reset role')
check(x('select private.expire_holds()').fetchone()[0] == 1 and x('select status from bookings where id = %s', [web_id]).fetchone()[0] == 'expired', 'the expiry job marks it expired')
check(x('select bool_or(active) from booking_items where booking_id = %s', [web_id]).fetchone()[0] is False, 'and frees its items')
as_role('authenticated', ADMIN)
check(save(customer_name='After Expiry', date='2027-08-14', start='16:00', end='18:00', items=['red-rose-wall']) is not None, 'the owner can book the freed time')
check('hold_until' in [d.name for d in x('select * from owner_bookings limit 0').description], 'owner view includes when a hold ends')
x('reset role')
# A confirmed request keeps holding after its old hold time passes.
sec = x("select id from bookings where source = 'website' and status = 'requested' order by id limit 1").fetchone()[0]
x("update bookings set status = 'confirmed', hold_until = now() - interval '1 hour' where id = %s", [sec])
as_role('anon')
check(x("select count(*) from public.availability('2027-08-20', '2027-08-20')").fetchone()[0] == 1, 'a confirmed request still shows as busy')
# Overall cap: ten website requests an hour.
x('reset role')
made = x("select count(*) from bookings where source = 'website' and created_at > now() - interval '1 hour'").fetchone()[0]
as_role('anon')
for n in range(10 - made):
    req(name=f'Flood {n}', email=f'flood{n}@example.com', date='2027-10-01', start=f'{8 + n:02d}:00', end=f'{8 + n:02d}:10', items=[])
expect_error(lambda: req(name='One Too Many', email='late@example.com', date='2027-10-02', start='10:00', end='11:00', items=[]), 'P0001', 'the eleventh website request in an hour is refused')
x('reset role')

# ---------- Review fixes: no data leaks, no impersonation, ceilings ----------
x("update bookings set created_at = created_at - interval '2 hours' where source = 'website'")  # clear the hourly cap
x("insert into customers (name, email, notes) values ('Victim Person', 'victim@example.com', 'PRIVATE owner note: gate code 4321')")
vid = x("select id from customers where email = 'victim@example.com'").fetchone()[0]
as_role('anon')
e = expect_error(lambda: req(name='Victim Person', email='victim@example.com', phone='9' * 41, date='2027-12-01', start='10:00', end='11:00', items=[]), '22023', 'an over-long phone is refused up front')
check(e is not None and not e.diag.message_detail and 'gate code' not in str(e), 'and the refusal carries no customer data')
e = expect_error(lambda: req(name='Someone', email='someone@example.com', date='2027-12-01', start='10:00', end='11:00', items=['not-an-item']), '22023', 'an unknown item is refused')
check(e is not None and not e.diag.message_detail and 'Failing row' not in str(e), 'database errors come back without details')
expect_error(lambda: req(name='Spy', email='a@b.co?bcc=spy%40evil.example', date='2027-12-01', start='10:00', end='11:00', items=[]), '22023', 'an email that could add a hidden copy to replies is refused')
req(name='Not The Victim', email='victim@example.com', phone='313-555-0000', date='2027-12-02', start='10:00', end='11:00', items=[])
x('reset role')
check(x("select count(*) from customers where email = 'victim@example.com'").fetchone()[0] == 2, 'a different name with a known email makes a new customer')
check(x('select phone, name, notes from customers where id = %s', [vid]).fetchone() == (None, 'Victim Person', 'PRIVATE owner note: gate code 4321'), 'the existing customer is never changed')
as_role('anon')
req(name='  victim   person ', email='VICTIM@example.com', phone='586-555-7777', date='2027-12-03', start='10:00', end='11:00', items=[])
x('reset role')
linked = x("select notes from bookings where customer_id = %s and source = 'website'", [vid]).fetchone()
check(linked is not None and linked[0] == 'Phone given with this request: 586-555-7777', f'same name and email links to the customer, and a new phone is noted on the request: {linked}')
check(x('select phone from customers where id = %s', [vid]).fetchone()[0] is None, 'still without changing their record')

# Ceilings: thirty waiting at once, thirty a day.
waiting = x("select count(*) from bookings where source = 'website' and status = 'requested'").fetchone()[0]
x("insert into bookings (source, status, event_start, event_end, hold_until, created_at) select 'website', 'requested', now() + interval '400 days', now() + interval '400 days 1 hour', now() + interval '3 days', now() - interval '3 days' from generate_series(1, %s)", [max(0, 30 - waiting)])
as_role('anon')
expect_error(lambda: req(name='Late', email='late2@example.com', date='2027-12-05', start='10:00', end='11:00', items=[]), 'P0001', 'no new requests while thirty are waiting')
x('reset role')
x("delete from bookings where customer_id is null and source = 'website'")
x("insert into bookings (source, status, event_start, event_end, created_at) select 'website', 'declined', now() + interval '400 days', now() + interval '400 days 1 hour', now() - interval '2 hours' from generate_series(1, 30)")
as_role('anon')
expect_error(lambda: req(name='Late', email='late3@example.com', date='2027-12-05', start='10:00', end='11:00', items=[]), 'P0001', 'thirty website requests in a day is the ceiling')
x('reset role')
x("delete from bookings where customer_id is null and source = 'website'")

# The owner editing a request that ran out takes it over: it keeps its status and stops expiring.
as_role('anon')
req(name='Edit Me', email='editme@example.com', date='2027-12-12', start='10:00', end='11:00', items=['pedestals'])
x('reset role')
bid, bcust = x("select b.id, b.customer_id from bookings b join customers c on c.id = b.customer_id where c.email = 'editme@example.com'").fetchone()
x("update bookings set hold_until = now() - interval '1 minute' where id = %s", [bid])
as_role('authenticated', ADMIN)
save(id=str(bid), customer_id=str(bcust), customer_name='Edit Me', customer_email='editme@example.com', date='2027-12-12', start='10:00', end='12:00', items=['pedestals'], status='requested')
x('reset role')
x('select private.expire_holds()')
check(x('select status, hold_until from bookings where id = %s', [bid]).fetchone() == ('requested', None), 'an edited request stays on hold and no longer expires')

# Two saves at the same moment: the second must be refused, never saved with the clashing item dropped.
import threading, time
def admin_conn():
    c = psycopg.connect(DSN)
    c.execute("select set_config('request.jwt.claims', %s, false)", [json.dumps({'role': 'authenticated', 'email': ADMIN})])
    c.execute('set role authenticated')
    c.commit()
    return c
t1, t2 = admin_conn(), admin_conn()
first = t1.execute('select public.save_booking(%s::jsonb)', [json.dumps(dict(customer_name='First', date='2027-09-01', start='14:00', end='18:00', items=['garden-wall'], form_version=3))]).fetchone()[0]
race = {}
def second():
    try:
        race['id'] = t2.execute('select public.save_booking(%s::jsonb)', [json.dumps(dict(customer_name='Second', date='2027-09-01', start='15:00', end='17:00', items=['garden-wall', 'pedestals'], form_version=3))]).fetchone()[0]
        t2.commit()
    except psycopg.Error as e:
        race['err'] = e.sqlstate
        t2.rollback()
th = threading.Thread(target=second)
th.start()
time.sleep(1.0)
t1.commit()
th.join()
check(race.get('err') == '23P01' and 'id' not in race, f'simultaneous save of the same item is refused, not saved without it: {race}')
check(x("select count(*) from booking_items i join bookings b on b.id = i.booking_id where i.item_id = 'garden-wall' and b.event_start::date = '2027-09-01'").fetchone()[0] == 1, 'only the first save holds the wall')

# Two website requests for the same item at the same moment.
def anon_conn():
    c = psycopg.connect(DSN)
    c.execute("select set_config('request.jwt.claims', %s, false)", [json.dumps({'role': 'anon'})])
    c.execute('set role anon')
    c.commit()
    return c
x("update bookings set created_at = created_at - interval '2 hours' where source = 'website'")  # clear the hourly cap from the flood test
t3, t4 = anon_conn(), anon_conn()
t3.execute('select public.request_booking(%s::jsonb)', [json.dumps(dict(name='Racer One', email='r1@example.com', date='2027-11-05', start='12:00', end='16:00', items=['champagne-wall']))])
web_race = {}
def second_request():
    try:
        web_race['ok'] = t4.execute('select public.request_booking(%s::jsonb)', [json.dumps(dict(name='Racer Two', email='r2@example.com', date='2027-11-05', start='13:00', end='15:00', items=['champagne-wall', 'sweets-cart']))]).fetchone()[0]
        t4.commit()
    except psycopg.Error as e:
        web_race['err'] = e.sqlstate
        t4.rollback()
th = threading.Thread(target=second_request)
th.start()
time.sleep(1.0)
t3.commit()
th.join()
check(web_race.get('err') == '23P01', f'simultaneous website requests for one item: the second is refused: {web_race}')

# Many requests from one email at once: the two-waiting limit still holds.
x("update bookings set created_at = created_at - interval '2 hours' where source = 'website'")
burst = []
def one_request(n):
    c = anon_conn()
    try:
        c.execute('select public.request_booking(%s::jsonb)', [json.dumps(dict(name='Same Person', email='same@example.com', date='2027-12-20', start=f'{8 + n:02d}:00', end=f'{8 + n:02d}:30', items=[]))])
        c.commit()
        burst.append('ok')
    except psycopg.Error as e:
        burst.append(e.sqlstate)
        c.rollback()
    finally:
        c.close()
threads = [threading.Thread(target=one_request, args=(n,)) for n in range(6)]
for t in threads: t.start()
for t in threads: t.join()
check(burst.count('ok') == 2, f'six requests at once from one email: only two get through: {burst}')

# ---------- Phase 3: phone alerts and the calendar link ----------
x('reset role')
# Start clean of the earlier request limits: those requests were sent long ago and are no longer waiting.
x("update bookings set created_at = created_at - interval '2 days'")
x("update bookings set status = 'declined' where status = 'requested' and source = 'website'")
# pg_net stand-in with the real function's signature; it records each call.
NET_OK = """create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds int default 5000) returns bigint
language sql as $$ insert into net.calls (url, body, timeout) values (url, body, timeout_milliseconds) returning id::bigint $$"""
NET_DOWN = """create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds int default 5000) returns bigint
language plpgsql as $$ begin raise exception 'network down'; end $$"""
x('create schema net; create table net.calls (id serial primary key, url text, body jsonb, timeout int);')
x(NET_OK)
calls = lambda: x('select count(*) from net.calls').fetchone()[0]
alerts = lambda: x('select count(*) from private.alerts').fetchone()[0]
SEND_URL = 'https://dwazctmqkrnajqmswtiy.supabase.co/functions/v1/bloom-bookings/send'

names = [x('select private.item_names(%s)', [ids]).fetchone()[0] for ids in (['bloom-bar'], ['bloom-bar', 'garden-wall'], ['sweets-cart', 'ivory-wall', 'pedestals', 'nope'], [])]
check(names == ['Bloom bar', 'Garden flower wall and Bloom bar', 'Ivory flower wall, White cylinder pillars and Sweets cart', None], f'item names read naturally, in catalog order: {names}')

# Who can call what.
EP1, EP2, EP3 = 'https://fcm.googleapis.com/fcm/send/phone-one', 'https://web.push.apple.com/phone-two', 'https://web.push.apple.com/helper-phone'
P256, AUTH = 'B' * 87, 'C' * 22
service_only = ["select public.claim_alerts()", "select public.finish_alerts('{}', '{}')", "select public.alert_public_key()",
                "select public.save_alert_keys('" + 'A' * 87 + "', '{}')", "select public.calendar_feed('x')"]
admin_only = [f"select public.save_phone('{EP1}', '{P256}', '{AUTH}')", f"select public.remove_phone('{EP1}')",
              f"select public.test_phone_alert('{EP1}')", "select public.calendar_link()"]
internal = ["select private.send_alerts()", "select private.item_names('{}')"]
for role, email, blocked in [('anon', None, service_only + admin_only + internal), ('authenticated', ADMIN, service_only + internal),
                             ('authenticated', 'stranger@example.com', service_only + admin_only + internal)]:
    as_role(role, email)
    for sql in blocked:
        x('begin')
        expect_error(lambda: x(sql), '42501', f'{email or role} blocked: {sql[7:40]}')
        x('rollback')

# No phone has alerts on yet: a request queues nothing.
as_role('anon')
req(name='No Phone Yet', email='np@example.com', date='2027-10-01', start='10:00', end='12:00', items=['ivory-wall'])
x('reset role')
check(alerts() == 0 and calls() == 0, 'with no phones signed up, a request queues no alert')

# The edge function stores the key pair once.
as_role('service_role')
check(x('select public.alert_public_key()').fetchone()[0] is None, 'no key pair yet')
check(x("select public.save_alert_keys(%s, %s)", ['A' * 87, json.dumps({'kty': 'EC', 'd': 'first'})]).fetchone()[0] == 'A' * 87, 'key pair saved')
check(x("select public.save_alert_keys(%s, %s)", ['D' * 87, json.dumps({'kty': 'EC', 'd': 'second'})]).fetchone()[0] == 'A' * 87, 'a second key pair never replaces the first')
check(x('select public.alert_public_key()').fetchone()[0] == 'A' * 87, 'the public key can be read back')
x('begin')
expect_error(lambda: x("select public.save_alert_keys('short', '{}')"), '23514', 'a malformed public key is refused')
x('rollback')

# The owner turns alerts on for two phones; a helper admin for one.
x('reset role')
x("insert into private.admins values ('helper@example.com')")
as_role('authenticated', ADMIN)
x('select public.save_phone(%s, %s, %s)', [EP1, P256, 'X' * 22])
x('select public.save_phone(%s, %s, %s)', [EP1, P256, AUTH])
x('select public.save_phone(%s, %s, %s)', [EP2, P256, AUTH])
for bad in [('http://fcm.googleapis.com/x', P256, AUTH), (EP1, 'short', AUTH), (EP1, P256, 'bad auth!')]:
    x('begin')
    expect_error(lambda: x('select public.save_phone(%s, %s, %s)', list(bad)), '22023', f'a malformed subscription is refused: {bad[0][:12]} {bad[1][:5]} {bad[2][:5]}')
    x('rollback')
as_role('authenticated', 'helper@example.com')
x('select public.save_phone(%s, %s, %s)', [EP3, P256, AUTH])
x('reset role')
phones = x('select endpoint, auth, email from private.phones order by endpoint').fetchall()
check(phones == [(EP1, AUTH, ADMIN), (EP3, AUTH, 'helper@example.com'), (EP2, AUTH, ADMIN)], f'phones saved per person; saving again updates: {phones}')

# A website request queues one alert and asks the edge function to send it.
as_role('anon')
req(name='Alert Me', email='alert@example.com', phone='586-555-0199', date='2027-10-02', start='14:00', end='18:00', items=['garden-wall', 'bloom-bar'])
x('reset role')
alert_booking = x("select id from bookings where customer_id = (select id from customers where email = 'alert@example.com')").fetchone()[0]
check(alerts() == 1 and x('select booking_id from private.alerts').fetchone()[0] == alert_booking, 'a website request queues one alert')
call = x('select url, body, timeout from net.calls').fetchall()
check(call == [(SEND_URL, {}, 10000)], f'and asks the edge function to send it: {call}')
as_role('anon')
check(req(name='Bot', email='bot2@example.com', date='2027-10-03', start='10:00', end='11:00', items=[], trap='x') == {'hold_until': None}, 'bot request')
as_role('authenticated', ADMIN)
save(customer_name='Owner Hold', date='2027-10-04', start='10:00', end='11:00', items=['pedestals'], status='requested')
x('reset role')
check(alerts() == 1 and calls() == 1, 'the owner’s own bookings and bot requests queue no alert')

# If asking the edge function fails, the request is still saved and the alert waits for the retry job.
x(NET_DOWN)
as_role('anon')
down = req(name='Network Down', email='down@example.com', date='2027-10-05', start='09:00', end='10:00', items=['sweets-cart'])
x('reset role')
check(bool(down and down.get('hold_until')) and alerts() == 2, f'a failing alert never blocks a request, and the alert stays queued: {down}')
x(NET_OK)

# The edge function claims the alerts with their text, the badge count and the phones to send to.
waiting = x("select count(*) from bookings where source = 'website' and status = 'requested'").fetchone()[0]
as_role('service_role')
got = x('select public.claim_alerts()').fetchone()[0]
check(got['keys'] == {'public': 'A' * 87, 'private': {'kty': 'EC', 'd': 'first'}}, 'the claim includes the key pair')
check(len(got['alerts']) == 2, f'both waiting alerts handed out: {len(got["alerts"])}')
first_alert = got['alerts'][0]
d = datetime.date(2027, 10, 2)
check(first_alert['message'] == {'title': 'New request: Alert Me', 'body': f'{d:%a}, {d:%b} 2, 2027, 2 PM – 6 PM · Garden flower wall and Bloom bar',
                                 'url': './?open=requests', 'tag': f'request-{alert_booking}', 'badge': waiting},
      f'alert text names the customer, time and items, with the waiting count: {first_alert["message"]}')
check(sorted(p['endpoint'] for p in first_alert['phones']) == sorted([EP1, EP2, EP3]) and all(p['p256dh'] == P256 and p['auth'] == AUTH for p in first_alert['phones']),
      'sent to every admin phone')
check(x('select public.claim_alerts()').fetchone()[0]['alerts'] == [], 'an alert being sent isn’t handed out twice')
x('reset role')
x('select private.send_alerts()')
check(calls() == 1, 'the retry job doesn’t ask while alerts are being sent')
x("update private.alerts set claimed_at = now() - interval '3 minutes'")
x('select private.send_alerts()')
check(calls() == 2, 'the retry job asks again once an unfinished alert is two minutes old')
as_role('service_role')
again = x('select public.claim_alerts()').fetchone()[0]['alerts']
check([a['id'] for a in again] == [a['id'] for a in got['alerts']], 'unfinished alerts are handed out again after two minutes')
x('select public.finish_alerts(%s, %s)', [[first_alert['id']], [EP2]])
x('reset role')
check(x('select count(*) from private.alerts where sent_at is null').fetchone()[0] == 1 and x('select count(*) from private.phones where endpoint = %s', [EP2]).fetchone()[0] == 0,
      'finishing marks alerts sent and forgets phones that no longer exist')

# Only phones of people who are still admins; a request declined before its alert goes out isn't sent.
x("delete from private.admins where email = 'helper@example.com'")
x("update bookings set status = 'declined' where customer_id = (select id from customers where email = 'down@example.com')")
x("update private.alerts set claimed_at = now() - interval '3 minutes' where sent_at is null")
as_role('service_role')
left = x('select public.claim_alerts()').fetchone()[0]['alerts']
check(len(left) == 1 and left[0]['phones'] == [], f'a declined request’s alert goes to no phone: {left}')
x('select public.finish_alerts(%s, %s)', [[left[0]['id']], []])
as_role('anon')
req(name='After Helper', email='after@example.com', date='2027-10-06', start='09:00', end='10:00', items=[])
as_role('service_role')
now_phones = [p['endpoint'] for p in x('select public.claim_alerts()').fetchone()[0]['alerts'][0]['phones']]
check(now_phones == [EP1], f'someone removed from the admins stops getting alerts: {now_phones}')
x('reset role')
x('update private.alerts set sent_at = now()')

# Test alerts go to one phone.
before = calls()
as_role('authenticated', ADMIN)
x('select public.save_phone(%s, %s, %s)', [EP2, P256, AUTH])
check(x('select public.test_phone_alert(%s)', [EP2]).fetchone()[0] is True, 'a test alert can be sent to this phone')
check(x("select public.test_phone_alert('https://fcm.googleapis.com/fcm/send/unknown')").fetchone()[0] is False, 'not to a phone that never turned alerts on')
x('reset role')
check(calls() == before + 1, 'the test asks the edge function right away')
as_role('service_role')
test = x('select public.claim_alerts()').fetchone()[0]['alerts']
check(len(test) == 1 and test[0]['message']['title'] == 'Test alert' and [p['endpoint'] for p in test[0]['phones']] == [EP2], f'the test goes only to that phone: {test}')
x('reset role')
as_role('authenticated', ADMIN)
x('select public.remove_phone(%s)', [EP2])
x('reset role')
check(x('select count(*) from private.phones where endpoint = %s', [EP2]).fetchone()[0] == 0 and x('select count(*) from private.alerts where endpoint = %s', [EP2]).fetchone()[0] == 0,
      'turning alerts off forgets the phone and its waiting test')
x("insert into private.alerts (booking_id, created_at) values (%s, now() - interval '2 days')", [alert_booking])
before = calls()
x('select private.send_alerts()')
as_role('service_role')
check(x('select public.claim_alerts()').fetchone()[0]['alerts'] == [], 'alerts older than a day are dropped')
x('reset role')
check(calls() == before, 'and don’t ask the edge function')

# Calendar link.
as_role('authenticated', ADMIN)
t1 = x('select public.calendar_link()').fetchone()[0]
check(re.fullmatch(r'[a-f0-9]{64}', t1 or '') is not None and x('select public.calendar_link(false)').fetchone()[0] == t1, 'the calendar link is a long random code that stays the same')
t2 = x('select public.calendar_link(true)').fetchone()[0]
check(t2 != t1 and re.fullmatch(r'[a-f0-9]{64}', t2) is not None, 'making a new link replaces the code')
cal = save(customer_name='Cal Person', customer_phone='586-555-0142', customer_email='cal@example.com', date='2026-12-05', start='14:00', end='18:00',
           setup_minutes='120', pickup_minutes='120', items=['pedestals', 'ivory-wall'], address='9 Elm St, Macomb', venue='Elm Hall',
           event_type='Wedding', guests='80', price='1250', deposit_paid=True, notes='Side door, please')
gone = save(customer_name='Cancelled One', date='2026-12-06', start='14:00', end='18:00', items=['garden-wall'])
x("update bookings set status = 'cancelled' where id = %s", [gone])
save(customer_name='Long Ago', date='2025-01-10', start='14:00', end='18:00', items=['garden-wall'])
save(customer_name='Far Off', date='2029-01-10', start='14:00', end='18:00', items=['garden-wall'])
as_role('anon')
req(name='Web Hold', email='webhold@example.com', date='2026-12-07', start='11:00', end='13:00', items=['champagne-wall'])
req(name='Ran Out', email='ranout@example.com', date='2026-12-08', start='11:00', end='13:00', items=['greenery-wall'])
x('reset role')
x("update bookings set hold_until = now() - interval '1 minute' where customer_id = (select id from customers where email = 'ranout@example.com')")
as_role('service_role')
check(x("select public.calendar_feed('nope')").fetchone()[0] is None and x('select public.calendar_feed(%s)', [t1]).fetchone()[0] is None, 'a wrong or replaced link opens nothing')
feed = x('select public.calendar_feed(%s)', [t2]).fetchone()[0]
x('reset role')
summaries = [e['summary'] for e in feed]
check('Cal Person · Ivory flower wall and White cylinder pillars' in summaries and 'On hold: Web Hold · Champagne rose wall' in summaries, f'confirmed bookings and live holds are listed: {summaries}')
check(not any(s.startswith(('Cancelled One', 'Long Ago', 'Far Off', 'On hold: Ran Out')) for s in summaries), 'cancelled, long-past, far-off and run-out holds are left out')
ev = next(e for e in feed if e['summary'].startswith('Cal Person'))
check(ev['uid'] == f'booking-{cal}@bloom-events' and ev['start'] == '20261205T190000Z' and ev['end'] == '20261205T230000Z' and ev['status'] == 'CONFIRMED' and ev['location'] == '9 Elm St, Macomb',
      f'event times in UTC (EST), place and status: {ev["start"]} {ev["end"]} {ev["status"]} {ev["location"]}')
check(ev['description'] == 'Setup from 12 PM, pickup by 8 PM\nVenue: Elm Hall\nPhone: 586-555-0142\nEmail: cal@example.com\nWedding · 80 guests\nPrice: $1,250.00, deposit paid\nNotes: Side door, please',
      f'description lists setup, venue, contact, event, price and notes: {ev["description"]!r}')
hold = next(e for e in feed if e['summary'].startswith('On hold: Web Hold'))
check(hold['status'] == 'TENTATIVE' and hold['description'].split('\n')[-1].startswith('On hold (website request) until '), f'holds are marked tentative with their end: {hold["description"]!r}')

# ---------- Neon signs, prices, pillar sets and per-person pricing ----------
x('reset role')
x("update bookings set created_at = created_at - interval '2 days'")
x("update bookings set status = 'declined' where status = 'requested' and source = 'website'")

catalog = x('select id, kind, price, per_person from public.items order by sort').fetchall()
kinds = {k: [i for i, kk, _, _ in catalog if kk == k] for k in ('wall', 'extra', 'neon')}
prices = {i: None if pr is None else float(pr) for i, _, pr, _ in catalog}
check(len(catalog) == 19 and len(kinds['wall']) == 7 and kinds['extra'] == ['bloom-bar', 'pedestals', 'sweets-cart'] and len(kinds['neon']) == 9,
      f'catalog: 7 walls, 3 extras and 9 neon signs: {[i for i, _, _, _ in catalog]}')
check(all(prices[w] == 299 for w in kinds['wall']) and all(prices[n] == 30 for n in kinds['neon'])
      and (prices['bloom-bar'], prices['pedestals'], prices['sweets-cart']) == (None, 120, 5.95),
      f'catalog prices are the owner’s: walls $299, neon $30, pillars from $120, sweets cart $5.95, bloom bar on request: {prices}')
check([i for i, _, _, pp in catalog if pp] == ['sweets-cart'], 'only the sweets cart is priced per person')
sets = [(r[0], r[1], float(r[2])) for r in x('select item_id, size, price from public.item_sets order by 1, 2').fetchall()]
check(sets == [('pedestals', 3, 120.0), ('pedestals', 5, 200.0)], f'pillars come as a set of 3 ($120) or 5 ($200): {sets}')
check(x('select count(*) from public.packages').fetchone()[0] == 0, 'no package deals are offered')
check(x("select name from public.items where id = 'pedestals'").fetchone()[0] == 'White cylinder pillars', 'the pillars have her name for them')

# Packages still work when she adds some again (these are made up for the test).
x("""insert into public.packages (id, name, parts, needs_wall, saving, sort) values
  ('pkg-wall-neon', 'The Neon Wall package', '{neon-engaged}', true, 29, 1),
  ('pkg-pillars', 'The Pillar package', '{pedestals}', true, 25, 2),
  ('pkg-signs', 'The Sign Pair package', '{neon-just-married,neon-engaged}', false, 10, 3)""")


def quote(items, packages=[], guests=None, pillars=None):
    got = x('select public.booking_quote(%s, %s, %s, %s)', [items, packages, guests, pillars]).fetchone()[0]
    return None if got is None else float(got)


for args, want, why in [
    (([],), None, 'nothing picked has no price'),
    ((['nope'],), None, 'nor do only unknown items'),
    ((['garden-wall'],), 299, 'one wall'),
    ((['garden-wall', 'neon-engaged'],), 329, 'a wall and a neon sign'),
    ((['garden-wall', 'garden-wall', 'nope'], ['pkg-nope']), 299, 'duplicates count once; unknown items and packages are ignored'),
    ((['pedestals'],), 120, 'pillars without a set size are priced as the set of 3'),
    ((['pedestals'], [], None, 3), 120, 'a set of 3 pillars is $120'),
    ((['pedestals'], [], None, 5), 200, 'a set of 5 pillars is $200'),
    ((['sweets-cart'], [], 100), 595, 'the sweets cart for 100 guests is $595'),
    ((['garden-wall', 'sweets-cart'], [], 50), 596.5, 'a wall and the sweets cart for 50 guests'),
    ((['sweets-cart'],), None, 'the sweets cart without a guest count has no price'),
    ((['garden-wall', 'neon-engaged'], [], 120), 329, 'the guest count only matters for per-person items'),
    ((['bloom-bar'],), None, 'the bloom bar is priced on request'),
    ((['garden-wall', 'bloom-bar'],), None, 'so a booking with it has no worked-out price'),
    ((['garden-wall', 'neon-engaged'], ['pkg-wall-neon']), 300, 'a package takes its saving off'),
    ((['neon-engaged'], ['pkg-wall-neon']), 30, 'a package that needs a wall gets no saving without one'),
    ((['ivory-wall', 'pedestals'], ['pkg-pillars'], None, 3), 394, 'a package saving applies to the chosen pillar set'),
    ((['ivory-wall', 'neon-engaged', 'pedestals'], ['pkg-wall-neon', 'pkg-pillars'], None, 5), 500, 'two packages can’t share one wall: the bigger saving wins'),
    ((['ivory-wall', 'garden-wall', 'neon-engaged', 'pedestals'], ['pkg-wall-neon', 'pkg-pillars'], None, 5), 774, 'with two walls both savings apply'),
]:
    got = quote(*args)
    check(got == want, f'price: {why} ({got})')
x('begin')
x("update public.items set price = 0 where kind = 'neon'")
check(quote(['neon-just-married', 'neon-engaged'], ['pkg-signs']) == 0, 'a package never costs less than nothing')
x('rollback')

# Visitors can read prices and work out a quote, but can't change anything.
as_role('anon')
check(x('select count(*) from public.items').fetchone()[0] == 19 and x('select count(*) from public.item_sets').fetchone()[0] == 2
      and x('select count(*) from public.packages').fetchone()[0] == 3, 'visitors can read the catalog, sets and packages')
check(float(x("select public.booking_quote('{garden-wall}')").fetchone()[0]) == 299, 'visitors can work out a price')
check(float(x("select public.booking_quote('{sweets-cart}', '{}', 10, null)").fetchone()[0]) == 59.5, 'including per-person prices')
for sql, what in [("update public.items set price = 1", 'change a price'), ("insert into public.items (id, name, kind, price, sort) values ('x', 'x', 'wall', 1, 99)", 'add an item'),
                  ("delete from public.packages", 'delete packages'), ("update public.item_sets set price = 1", 'change a set price')]:
    x('begin')
    expect_error(lambda: x(sql), '42501', f'visitors can’t {what}')
    x('rollback')
as_role('authenticated', ADMIN)
x('begin')
expect_error(lambda: x("update public.items set price = 1"), '42501', 'prices aren’t changed through the app’s access either')
x('rollback')
x('reset role')
check(x("select count(*) from pg_proc where proname = 'booking_quote'").fetchone()[0] == 1, 'only the current price function exists')

# Website requests: neon signs are held like the walls, and the price is saved with the request.
as_role('anon')
req(name='Neon Fan', email='neon@example.com', date='2027-11-10', start='18:00', end='22:00', items=['garden-wall', 'neon-just-married'])
req(name='Package Fan', email='package@example.com', date='2027-11-11', start='12:00', end='16:00', items=['ivory-wall', 'neon-engaged'], packages=['pkg-wall-neon', 'pkg-nope'])
req(name='Pillar Fan', email='pillar@example.com', date='2027-11-16', start='12:00', end='16:00', items=['champagne-wall', 'pedestals'], pillar_set='3')
req(name='Sweet Fan', email='sweet@example.com', date='2027-11-17', start='12:00', end='16:00', items=['sweets-cart'], guests='100', pillar_set='5')
req(name='Bloom Fan', email='bloom@example.com', date='2027-11-18', start='12:00', end='16:00', items=['bloom-bar', 'red-rose-wall'], guests='40')
busy = [r[0] for r in x("select item_id from public.availability('2027-11-10', '2027-11-10')").fetchall()]
check('neon-just-married' in busy, f'a requested neon sign shows as busy to visitors: {busy}')
e = expect_error(lambda: req(name='Late Fan', email='late@example.com', date='2027-11-10', start='20:00', end='23:00', items=['neon-just-married']), '23P01',
                 'the same neon sign can’t be booked twice at once')
check(e is not None and e.diag.message_detail == 'neon-just-married', 'and the refusal names the sign')
req(name='No Set Fan', email='noset@example.com', date='2027-11-24', start='12:00', end='16:00', items=['pedestals'])
check(req(name='Other Sign', email='other@example.com', date='2027-11-10', start='20:00', end='23:00', items=['neon-engaged']).get('hold_until') is not None,
      'a different sign at the same time is fine')
expect_error(lambda: req(name='Made Up', email='madeup@example.com', date='2027-11-13', start='12:00', end='13:00', items=['neon-made-up']), '22023',
             'an item that isn’t in the catalog is refused')
expect_error(lambda: req(name='Odd Set', email='odd@example.com', date='2027-11-19', start='12:00', end='13:00', items=['pedestals'], pillar_set='4'), '22023',
             'a pillar set that isn’t 3 or 5 is refused')
e = expect_error(lambda: req(name='Second Set', email='second@example.com', date='2027-11-16', start='13:00', end='14:00', items=['pedestals'], pillar_set='3'), '23P01',
                 'with 5 pillars, a second set can’t go out at the same time')
x('reset role')
rows = {r[0]: (None if r[1] is None else float(r[1]), r[2], r[3]) for r in x(
    "select c.email, b.price, b.packages, b.pillar_set from bookings b join customers c on c.id = b.customer_id where b.source = 'website' and c.email in ('neon@example.com', 'package@example.com', 'pillar@example.com', 'sweet@example.com', 'bloom@example.com', 'noset@example.com')").fetchall()}
check(rows.get('neon@example.com') == (329.0, [], None), f'a request is priced from its items: {rows.get("neon@example.com")}')
check(rows.get('package@example.com') == (300.0, ['pkg-wall-neon'], None), f'a package request keeps its package and saving: {rows.get("package@example.com")}')
check(rows.get('pillar@example.com') == (419.0, [], 3), f'a pillar request keeps its set and is priced for it: {rows.get("pillar@example.com")}')
check(rows.get('sweet@example.com') == (595.0, [], None), f'the sweets cart is priced for the guests, and a set size without pillars is dropped: {rows.get("sweet@example.com")}')
check(rows.get('bloom@example.com') == (None, [], None), f'a request with the bloom bar is left for her to price: {rows.get("bloom@example.com")}')
check(rows.get('noset@example.com') == (120.0, [], 3), f'pillars requested without a set are the set of 3: {rows.get("noset@example.com")}')
check(x("select private.item_names('{neon-engaged,ivory-wall}')").fetchone()[0] == 'Ivory flower wall and Engaged neon sign', 'item names come from the catalog, in catalog order')
x('begin')
def unknown_item():
    bid = x("insert into bookings (event_start, event_end) values ('2027-12-01 10:00-05', '2027-12-01 12:00-05') returning id").fetchone()[0]
    x("insert into booking_items (booking_id, item_id) values (%s, 'not-an-item')", [bid])
expect_error(unknown_item, '23503', 'the database itself only accepts catalog items')
x('rollback')

# The owner's bookings: the price fills itself in unless she gives one.
as_role('authenticated', ADMIN)
auto = save(customer_name='Owner Neon', date='2027-11-12', start='10:00', end='14:00', items=['pink-ombre-wall', 'neon-oh-baby'])
pkg = save(customer_name='Owner Package', date='2027-11-14', start='10:00', end='14:00', items=['champagne-wall', 'neon-engaged'], packages=['pkg-wall-neon'])
own = save(customer_name='Owner Price', date='2027-11-15', start='10:00', end='14:00', items=['red-rose-wall'], price='999')
pillars = save(customer_name='Owner Pillars', date='2027-11-25', start='10:00', end='14:00', items=['ivory-texture-wall', 'pedestals'], pillar_set='3')
sweets = save(customer_name='Owner Sweets', date='2027-11-21', start='10:00', end='14:00', items=['sweets-cart'], guests='80')
bloom = save(customer_name='Owner Bloom', date='2027-11-22', start='10:00', end='14:00', items=['bloom-bar'], guests='30')
row = lambda i: x('select price, packages, pillar_set, item_price from owner_bookings where id = %s', [i]).fetchone()
num = lambda v: None if v is None else float(v)
check(num(row(auto)[0]) == 329 and row(auto)[1] == [], f'with no price given, the booking is priced from its items: {row(auto)}')
check(num(row(pkg)[0]) == 300 and row(pkg)[1] == ['pkg-wall-neon'], f'a package booking keeps its package and saving: {row(pkg)}')
check(num(row(own)[0]) == 999, 'a price she types herself is kept')
check(num(row(pillars)[0]) == 419 and row(pillars)[2] == 3 and num(row(pillars)[3]) == 419, f'a booking keeps its pillar set and is priced for it: {row(pillars)}')
check(num(row(sweets)[0]) == 476, f'the sweets cart is priced for her guest count (80 x $5.95): {row(sweets)}')
check(row(bloom)[0] is None and row(bloom)[3] is None, f'a bloom bar booking waits for her price: {row(bloom)}')
save(id=str(bloom), customer_id=str(x('select customer_id from bookings where id = %s', [bloom]).fetchone()[0]), customer_name='Owner Bloom',
     date='2027-11-22', start='10:00', end='14:00', items=['bloom-bar'], guests='30', price='650')
check(num(row(bloom)[0]) == 650, 'and keeps the price she gives it')
save(id=str(auto), customer_id=str(x('select customer_id from bookings where id = %s', [auto]).fetchone()[0]), customer_name='Owner Neon',
     date='2027-11-12', start='10:00', end='14:00', items=['pink-ombre-wall', 'neon-oh-baby', 'neon-engaged'], price='', status='confirmed')
check(num(row(auto)[0]) == 359, f'editing with the price left empty works it out again: {row(auto)}')
save(id=str(pillars), customer_id=str(x('select customer_id from bookings where id = %s', [pillars]).fetchone()[0]), customer_name='Owner Pillars',
     date='2027-11-25', start='10:00', end='14:00', items=['ivory-texture-wall'], pillar_set='3', price='')
check(row(pillars)[2] is None and num(row(pillars)[0]) == 299, f'taking the pillars off drops the set: {row(pillars)}')
expect_error(lambda: save(customer_name='Bad Set', date='2027-11-23', start='10:00', end='14:00', items=['pedestals'], pillar_set='4'), '23514',
             'the owner app can’t save a pillar set that isn’t 3 or 5')
x('reset role')
feed_token = x("insert into private.calendar_link (token) values (repeat('c', 64)) on conflict (id) do update set token = excluded.token returning token").fetchone()[0]
as_role('service_role')
feed = x('select public.calendar_feed(%s)', [feed_token]).fetchone()[0]
x('reset role')
summary = next((e['summary'] for e in feed if e['summary'].startswith('Owner Neon')), '')
check(summary == 'Owner Neon · Pink ombre wall, Oh Baby neon sign and Engaged neon sign', f'the calendar names the neon signs: {summary}')

# Bookings from before prices were worked out get one when the schema runs.
old = x("insert into bookings (event_start, event_end, status) values ('2027-12-20 10:00-05', '2027-12-20 12:00-05', 'confirmed') returning id").fetchone()[0]
x("insert into booking_items (booking_id, item_id) values (%s, 'greenery-wall'), (%s, 'neon-congrats')", [old, old])
x(SCHEMA)
check(float(x('select price from bookings where id = %s', [old]).fetchone()[0]) == 329, 'running the schema prices bookings that had no price')
check(float(x('select price from bookings where id = %s', [own]).fetchone()[0]) == 999, 'and leaves prices that were set alone')
check(x('select count(*) from public.packages').fetchone()[0] == 3 and float(x("select price from public.items where id = 'garden-wall'").fetchone()[0]) == 299,
      'running the schema again keeps the packages and prices there are')

# ---------- Review fixes: prices ----------
# An app opened before an update can't save (it would drop what it doesn't show).
as_role('authenticated', ADMIN)
old_app = dict(customer_name='Old App', date='2027-12-22', start='10:00', end='12:00', items=['garden-wall'])
for version, what in [(None, 'with no form version'), (1, 'from form version 1'), (2, 'from form version 2 (before pillar sets and guests)')]:
    payload = dict(old_app) if version is None else dict(old_app, form_version=version)
    e = expect_error(lambda: x('select public.save_booking(%s::jsonb)', [json.dumps(payload)]), 'P0001', f'a save {what} is refused')
    check(e is not None and 'out of date' in e.diag.message_primary, f'and says the app is out of date: {e and e.diag.message_primary}')
check(save(**old_app) is not None, 'the current app saves')

# owner_bookings says what the items and package come to, so the app can tell a worked-out price from her own.
ip = lambda i: tuple(num(v) for v in x('select price, item_price from owner_bookings where id = %s', [i]).fetchone())
check(ip(pkg) == (300, 300) and ip(own) == (999, 299), f'owner_bookings has the item price: {ip(pkg)} {ip(own)}')

# A request with nothing picked has no price, and its alert doesn't show one; a priced one does.
x('reset role')
x("update bookings set status = 'declined', created_at = created_at - interval '2 days' where source = 'website'")
x('delete from private.alerts')
as_role('anon')
req(name='Just Asking', email='asking@example.com', date='2027-12-24', start='10:00', end='12:00', items=[])
req(name='Priced Ask', email='priced@example.com', date='2027-12-26', start='10:00', end='12:00', items=['garden-wall', 'neon-oh-baby'])
x('reset role')
check(x("select b.price from bookings b join customers c on c.id = b.customer_id where c.email = 'asking@example.com'").fetchone()[0] is None, 'a request with nothing picked has no price')
as_role('service_role')
bodies = {a['message']['title']: a['message']['body'] for a in x('select public.claim_alerts()').fetchone()[0]['alerts']}
x('reset role')
body = bodies.get('New request: Just Asking')
check(body is not None and '$' not in body, f'and its alert leaves the price out: {body!r}')
check((bodies.get('New request: Priced Ask') or '').endswith('Garden flower wall and Oh Baby neon sign · $329.00'), f'a priced request’s alert shows the price: {bodies.get("New request: Priced Ask")!r}')

# Upgrading: upcoming requests from before get their package back from the notes, then their price. Past,
# cancelled and declined bookings are left as they were.
def old_request(day, notes, items, status='requested'):
    bid = x("""insert into bookings (source, status, event_start, event_end, notes, hold_until)
               values ('website', %s, (%s::date + time '12:00') at time zone 'America/Detroit', (%s::date + time '16:00') at time zone 'America/Detroit', %s,
                       case when %s = 'requested' then now() + interval '3 days' end) returning id""", [status, day, day, notes, status]).fetchone()[0]
    x('insert into booking_items (booking_id, item_id) select %s, unnest(%s::text[])', [bid, items])
    return bid
walled = old_request('2028-03-01', 'Package: The Neon Wall package\nPink and white please', ['ivory-wall', 'neon-engaged'])
phoned = old_request('2028-03-02', 'Phone given with this request: 586-555-0123\nPackage: The Sign Pair package', ['neon-just-married', 'neon-engaged'], status='confirmed')
plain = old_request('2028-03-03', 'No package here', ['greenery-wall'], status='confirmed')
past = old_request((datetime.date.today() - datetime.timedelta(days=30)).isoformat(), 'Package: The Neon Wall package', ['garden-wall', 'neon-oh-baby'], status='confirmed')
gone = old_request('2028-03-01', 'Package: The Neon Wall package', ['red-rose-wall', 'neon-congrats'], status='cancelled')
x(SCHEMA)
got = {i: x('select price, packages from bookings where id = %s', [i]).fetchone() for i in (walled, phoned, plain, past, gone)}
got = {i: (num(pr), pk) for i, (pr, pk) in got.items()}
check(got[walled] == (300.0, ['pkg-wall-neon']), f'an old package request gets its package and saving back: {got[walled]}')
check(got[phoned] == (50.0, ['pkg-signs']), f'the package is found when the notes start with another line: {got[phoned]}')
check(got[plain] == (299.0, []), f'a booking without a package is priced from its items: {got[plain]}')
check(got[past] == (None, []) and got[gone] == (None, []), f'past and cancelled bookings are left alone: {got[past]} {got[gone]}')
x(SCHEMA)
check(float(x('select price from bookings where id = %s', [walled]).fetchone()[0]) == 300, 'running the schema again changes nothing')

print('\n' + ('ALL PASSED' if not failures else f'{len(failures)} FAILED'))
conn.close()
sys.exit(1 if failures else 0)
