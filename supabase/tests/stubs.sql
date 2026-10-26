-- Minimal stand-ins for the Supabase-managed schemas, so the migrations and the
-- policy tests run on a plain Postgres (see supabase/tests/run.sh).
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant all on storage.objects to anon, authenticated, service_role;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;

create schema realtime;
grant usage on schema realtime to anon, authenticated, service_role;
create table realtime.messages (id bigserial primary key, topic text, extension text);
alter table realtime.messages enable row level security;
grant all on realtime.messages to anon, authenticated, service_role;
create function realtime.topic() returns text language sql stable as $$
  select current_setting('realtime.topic', true)
$$;
