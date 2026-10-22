"""Runs a live-rehearsal DO block (one that ends by raising 'RESULT ...', so the live run rolls back) against a
throwaway local database with pg_net and pg_cron stand-ins, and prints the RESULT line.

    python tests/db/rehearse.py <schema.sql>[,<update.sql>...] <rehearsal.sql>
"""
import pathlib, sys
import psycopg
import pgtools

conn = pgtools.server()
x = conn.execute
x(pgtools.SUPABASE_LIKE)
x("""
create schema net;
create table net.http_request_queue (id bigserial primary key, method text, url text);
create function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds int default 5000) returns bigint
language sql as $$ insert into net.http_request_queue (method, url) values ('POST', url) returning id $$;
create schema cron;
create table cron.job (jobname text, schedule text, active boolean default true);
insert into cron.job values ('bloom-expire-holds', '*/15 * * * *', true), ('bloom-send-alerts', '*/5 * * * *', true);
""")
for path in sys.argv[1].split(','):
    x(pathlib.Path(path).read_text(encoding='utf-8'))
try:
    x(pathlib.Path(sys.argv[2]).read_text(encoding='utf-8'))
    print('no RESULT raised')
except psycopg.Error as e:
    print(e.diag.message_primary)
