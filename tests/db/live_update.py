"""Builds the update to type into the live Supabase SQL editor (only statements new or changed since the live schema,
one per line, comments stripped) and proves it is enough: a database upgraded with just the update must match one
upgraded by running the whole new schema.

    python tests/db/live_update.py <live-schema.sql> <new-schema.sql> <out-update.sql> [one-off.sql]

The optional one-off file holds statements that belong only to this update (for example new prices, which running
schema.sql again must not overwrite). They run after the schema changes but before schema.sql's backfills of existing
bookings (its `update public.bookings` statements), so those are priced with the new prices; the comparison database
runs the whole schema in that same order.
Prints the update's size and the SHA-256 of its whitespace-collapsed text, to check against the editor before Run.
"""
import hashlib, pathlib, re, sys
import pgtools


def strip_comments(text):
    out = []
    for line in text.split('\n'):
        quoted, cut = False, len(line)
        for i, ch in enumerate(line):
            if ch == "'":
                quoted = not quoted
            elif not quoted and line.startswith('--', i):
                cut = i
                break
        out.append(line[:cut])
    return '\n'.join(out)


def statements(text):
    result, current, quoted, dollar, i = [], [], False, False, 0
    while i < len(text):
        ch = text[i]
        if not dollar and ch == "'":
            quoted = not quoted
        elif not quoted and text.startswith('$$', i):
            dollar = not dollar
            current.append('$$'); i += 2; continue
        if ch == ';' and not quoted and not dollar:
            current.append(';')
            stmt = ' '.join(''.join(current).split())
            if stmt != ';':
                result.append(stmt)
            current = []
        else:
            current.append(ch)
        i += 1
    return result


read = lambda path: pathlib.Path(path).read_text(encoding='utf-8').replace('\r\n', '\n')
live_text, new_text = read(sys.argv[1]), read(sys.argv[2])
oneoff_text = read(sys.argv[4]) if len(sys.argv) > 4 else ''
for literal in re.findall(r"'(?:[^']|'')*'", strip_comments(new_text + '\n' + oneoff_text)):
    assert '  ' not in literal and '\n' not in literal, literal  # collapsing whitespace must not change a string
live = set(statements(strip_comments(live_text)))
is_backfill = lambda s: s.startswith('update public.bookings ')
new_all = statements(strip_comments(new_text))
oneoff = statements(strip_comments(oneoff_text))
changed = [s for s in new_all if s not in live]
delta = [s for s in changed if not is_backfill(s)] + oneoff + [s for s in changed if is_backfill(s)]
pathlib.Path(sys.argv[3]).write_text('\n'.join(delta) + '\n', encoding='utf-8', newline='\n')
norm = ' '.join(' '.join(delta).split())
print(f'update: {len(delta)} statements, {len(norm)} chars, sha256 {hashlib.sha256(norm.encode()).hexdigest()}')

# A live-like booking before the update, to exercise constraint changes and price backfills.
live_seed = """
insert into public.customers (name) values ('Seed');
insert into public.bookings (customer_id, event_start, event_end) values ((select id from public.customers limit 1), '2027-03-01 10:00-05', '2027-03-01 12:00-05');
insert into public.booking_items (booking_id, item_id) values ((select max(id) from public.bookings), 'garden-wall');
insert into public.bookings (customer_id, event_start, event_end, guests) values ((select id from public.customers limit 1), '2027-03-02 10:00-05', '2027-03-02 12:00-05', 10);
insert into public.booking_items (booking_id, item_id) values ((select max(id) from public.bookings), 'sweets-cart'), ((select max(id) from public.bookings), 'ivory-wall');
"""


def database(scripts):
    conn = pgtools.server()
    conn.execute(pgtools.SUPABASE_LIKE)
    for s in scripts:
        if s.strip():
            conn.execute(s)
    return conn


a = database([live_text, live_seed, '\n'.join(delta)])
b = database([live_text, live_seed, '\n'.join(s for s in new_all if not is_backfill(s)), '\n'.join(oneoff), '\n'.join(s for s in new_all if is_backfill(s))])

SNAP = {
    'functions': "select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') order by 1",
    'function grants': "select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', coalesce(p.proacl::text, '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') order by 1, 2",
    'views': "select c.relname, pg_get_viewdef(c.oid) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'v' order by 1",
    'columns': "select table_schema || '.' || table_name || '.' || column_name, data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '') from information_schema.columns where table_schema in ('public', 'private') order by 1",
    'constraints': "select conrelid::regclass::text || ' ' || conname, pg_get_constraintdef(oid) from pg_constraint where connamespace in ('public'::regnamespace, 'private'::regnamespace) order by 1",
    'table grants': "select c.oid::regclass::text, coalesce(c.relacl::text, '') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'private') and c.relkind in ('r', 'v') order by 1",
    'policies': "select schemaname || '.' || tablename || ' ' || policyname, cmd || ' ' || array_to_string(roles, ',') || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '') from pg_policies order by 1",
    'row security': "select c.oid::regclass::text, c.relrowsecurity::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public', 'private') and c.relkind = 'r' order by 1",
    'triggers': "select tgrelid::regclass::text || ' ' || tgname, pg_get_triggerdef(oid) from pg_trigger where not tgisinternal order by 1",
    'catalog rows': "select to_jsonb(i)::text, '' from public.items i union all select to_jsonb(p)::text, '' from public.packages p order by 1",
    'booking prices': "select id::text, to_jsonb(b)::text from public.bookings b order by 1",
    'catalog prices': "select id, coalesce(price::text, 'on request') from public.items order by 1",
}
different = 0
for name, sql in SNAP.items():
    ra, rb = a.execute(sql).fetchall(), b.execute(sql).fetchall()
    if name == 'functions':  # the typed update is compact: compare without comments and spacing
        ra = [(k, ' '.join(strip_comments(v).split())) for k, v in ra]
        rb = [(k, ' '.join(strip_comments(v).split())) for k, v in rb]
    if name == 'booking prices':  # created_at differs between the two servers
        drop = lambda rows: [(k, re.sub(r'"created_at": "[^"]*", ', '', v)) for k, v in rows]
        ra, rb = drop(ra), drop(rb)
    if ra != rb:
        different += 1
        da, db_ = dict(ra), dict(rb)
        keys = sorted(set(da) | set(db_))
        print(f'DIFFERENT {name}:', [k for k in keys if da.get(k) != db_.get(k)][:6])
    else:
        print(f'same {name}: {len(ra)}')
print('EQUIVALENT' if not different else f'{different} DIFFERENCES')
sys.exit(1 if different else 0)
