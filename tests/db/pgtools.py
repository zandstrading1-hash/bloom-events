"""Throwaway local Postgres 17 servers set up like Supabase, shared by the database checks in this folder."""
import atexit, os, pathlib, socket, subprocess, tempfile
import psycopg

HERE = pathlib.Path(__file__).resolve().parent
BIN = pathlib.Path(os.environ.get('PG_BIN') or HERE.parent / 'node_modules/@embedded-postgres/windows-x64/native/bin')
EXE = '.exe' if os.name == 'nt' else ''

SUPABASE_LIKE = """
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create schema extensions;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.jwt() to anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create schema private;
create table private.admins (email text primary key check (email = lower(email)));
insert into private.admins values ('owner@example.com');
"""


def server():
    """Starts a fresh server on a free port (Windows reserves changing port ranges) and returns an autocommit connection."""
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    tmp = tempfile.mkdtemp(prefix='bloompg')
    subprocess.run([str(BIN / f'initdb{EXE}'), '-D', tmp, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--no-locale'], check=True, capture_output=True)
    # pg_ctl's output must not be captured: on Windows the call then never returns.
    subprocess.run([str(BIN / f'pg_ctl{EXE}'), '-D', tmp, '-o', f'-p {port}', '-w', '-l', tmp + '/log.txt', 'start'], check=True,
                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    atexit.register(lambda: subprocess.run([str(BIN / f'pg_ctl{EXE}'), '-D', tmp, '-m', 'immediate', 'stop'],
                                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
    return psycopg.connect(f'host=127.0.0.1 port={port} user=postgres dbname=postgres', autocommit=True)
