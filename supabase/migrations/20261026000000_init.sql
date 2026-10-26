-- Project Ars — initial schema.
--
-- Security model
--   * Every table has row level security. Browsers (role `authenticated`) only ever
--     see their own rows; tables holding secrets have NO client policies at all and
--     are reached only by the API with the service role.
--   * The 5-projects-per-account limit and the document size cap are enforced here,
--     so they hold even for requests that bypass the app and talk to PostgREST directly.

-- ---------------------------------------------------------------------------
-- Profiles: one row per account, created by trigger on sign-up.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  locale text check (locale in ('pt-BR', 'en', 'es')),
  -- Where MCP clients act by default: the project the user had open most recently.
  active_project_id uuid,
  active_selection jsonb not null default '[]'::jsonb
    check (jsonb_typeof(active_selection) = 'array' and jsonb_array_length(active_selection) <= 1000),
  active_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "read own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "update own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null default 'Untitled' check (char_length(name) between 1 and 120),
  document jsonb not null default '{"nodes": []}'::jsonb,
  -- Bumped on every save; writers compare-and-swap on it so concurrent edits never
  -- silently overwrite each other (editor tab vs. MCP).
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_owner_idx on public.projects (owner_id, updated_at desc);

alter table public.profiles
  add constraint profiles_active_project_fk
  foreign key (active_project_id) references public.projects (id) on delete set null;

alter table public.projects enable row level security;

create policy "read own projects" on public.projects
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "create own projects" on public.projects
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "update own projects" on public.projects
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "delete own projects" on public.projects
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Plan limits. Change them here (and in src/limits.ts, which only drives the UI).
create function public.max_projects_per_account() returns integer
language sql immutable as $$ select 5 $$;

create function public.max_document_bytes() returns integer
language sql immutable as $$ select 5 * 1024 * 1024 $$;

create function public.enforce_project_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    -- Serialize inserts per owner so two parallel requests can't both pass the count.
    perform pg_advisory_xact_lock(hashtextextended(new.owner_id::text, 0));
    if (select count(*) from public.projects where owner_id = new.owner_id) >= public.max_projects_per_account() then
      raise exception 'project_limit_reached' using errcode = 'P0001',
        hint = format('Each account can have at most %s projects.', public.max_projects_per_account());
    end if;
  elsif new.owner_id is distinct from old.owner_id then
    raise exception 'owner_change_not_allowed' using errcode = 'P0001';
  end if;
  if octet_length(new.document::text) > public.max_document_bytes() then
    raise exception 'document_too_large' using errcode = 'P0001';
  end if;
  if jsonb_typeof(new.document -> 'nodes') is distinct from 'array' then
    raise exception 'invalid_document' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger projects_rules
  before insert or update on public.projects
  for each row execute function public.enforce_project_rules();

-- Saves a document only if nobody else saved since `base_version`.
-- Returns the new version, or null on conflict (the caller reloads).
create function public.save_project(p_id uuid, p_document jsonb, p_base_version integer)
returns integer
language sql security invoker set search_path = '' as $$
  update public.projects
     set document = p_document, version = version + 1
   where id = p_id and version = p_base_version
  returning version;
$$;

-- ---------------------------------------------------------------------------
-- Secrets: reachable only with the service role (no client policies on purpose).
-- ---------------------------------------------------------------------------

-- The user's own AI provider keys, encrypted by the API (AES-256-GCM, key in
-- ARS_ENCRYPTION_KEY, user id as associated data). Never sent back to browsers.
create table public.user_secrets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Which provider the in-app assistant uses.
  ai_provider text not null default 'anthropic' check (ai_provider in ('anthropic', 'openai')),
  anthropic_key_enc text,
  anthropic_key_last4 text,
  -- Any OpenAI-compatible Chat Completions API (OpenAI, OpenRouter, Gemini, Groq, Mistral…).
  openai_base_url text check (openai_base_url ~ '^https://'),
  openai_model text check (char_length(openai_model) <= 120),
  openai_key_enc text,
  openai_key_last4 text,
  updated_at timestamptz not null default now()
);
alter table public.user_secrets enable row level security;

-- Personal access tokens for MCP clients (Claude Code, Claude Desktop).
-- Only a SHA-256 hash is stored; the token itself is shown once at creation.
create table public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  token_hash text not null unique,
  hint text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index mcp_tokens_user_idx on public.mcp_tokens (user_id);
alter table public.mcp_tokens enable row level security;

-- Remote MCP servers the in-app agent may call (tokens encrypted like API keys).
create table public.mcp_servers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (name ~ '^[a-zA-Z0-9_-]{1,64}$'),
  url text not null check (url ~ '^https://'),
  token_enc text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
alter table public.mcp_servers enable row level security;

-- ---------------------------------------------------------------------------
-- Rate limiting for API routes (fixed window, per user and bucket).
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (user_id, bucket, window_start)
);
alter table public.rate_limits enable row level security;

-- True when the call is allowed. Old windows are pruned opportunistically.
create function public.hit_rate_limit(p_user uuid, p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  n integer;
begin
  insert into public.rate_limits as r (user_id, bucket, window_start, hits)
  values (p_user, p_bucket, w, 1)
  on conflict (user_id, bucket, window_start) do update set hits = r.hits + 1
  returning hits into n;
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return n <= p_limit;
end;
$$;

-- Server-only helpers must not be callable from browsers.
revoke execute on function public.hit_rate_limit(uuid, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.enforce_project_rules() from public, anon, authenticated;
revoke execute on function public.save_project(uuid, jsonb, integer) from public, anon;
grant execute on function public.save_project(uuid, jsonb, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: images, in a private bucket, one folder per user (<user id>/<hash>.<ext>).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assets', 'assets', false, 10485760,
        array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);

create policy "read own assets" on storage.objects
  for select to authenticated
  using (bucket_id = 'assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "upload own assets" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "delete own assets" on storage.objects
  for delete to authenticated
  using (bucket_id = 'assets' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- Realtime: live edits from MCP reach the editor over a private broadcast
-- channel "project:<id>" that only the project's owner may join. Only the API
-- (service role) sends; there is no insert policy for clients.
-- ---------------------------------------------------------------------------
create policy "owner receives project broadcasts" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and exists (
      select 1 from public.projects p
      where 'project:' || p.id::text = (select realtime.topic())
        and p.owner_id = (select auth.uid())
    )
  );
