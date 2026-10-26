-- Policy and limit tests. Each block prints PASS/FAIL; run.sh fails on any FAIL.
\set ON_ERROR_STOP 0
\set QUIET 1
insert into auth.users values ('00000000-0000-0000-0000-00000000000a', 'a@test'), ('00000000-0000-0000-0000-00000000000b', 'b@test');

create function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '% %', case when ok then 'PASS' else 'FAIL' end, label; end $$;

select pg_temp.check('profiles created on sign-up', (select count(*) = 2 from public.profiles));

-- As user A
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.projects (name) values ('a1'), ('a2'), ('a3'), ('a4'), ('a5');
select pg_temp.check('owner defaults to the caller', (select bool_and(owner_id = auth.uid()) from public.projects));
do $$ begin
  insert into public.projects (name) values ('a6');
  perform pg_temp.check('6th project rejected', false);
exception when others then
  perform pg_temp.check('6th project rejected (' || sqlerrm || ')', sqlerrm = 'project_limit_reached');
end $$;
do $$ begin
  insert into public.projects (name, owner_id) values ('spoof', '00000000-0000-0000-0000-00000000000b');
  perform pg_temp.check('cannot create a project for someone else', false);
exception when others then
  perform pg_temp.check('cannot create a project for someone else', true);
end $$;
do $$ begin
  update public.projects set document = jsonb_build_object('nodes', jsonb_build_array(repeat('x', 6 * 1024 * 1024))) where name = 'a1';
  perform pg_temp.check('oversized document rejected', false);
exception when others then
  perform pg_temp.check('oversized document rejected', sqlerrm = 'document_too_large');
end $$;
do $$ begin
  update public.projects set document = '{"nodes": 1}' where name = 'a1';
  perform pg_temp.check('malformed document rejected', false);
exception when others then
  perform pg_temp.check('malformed document rejected', sqlerrm = 'invalid_document');
end $$;
select pg_temp.check('save_project bumps the version',
  (select public.save_project(id, '{"nodes": []}', 1) = 2 from public.projects where name = 'a1'));
select pg_temp.check('stale save_project returns null (conflict)',
  (select public.save_project(id, '{"nodes": []}', 1) is null from public.projects where name = 'a1'));
select pg_temp.check('user secrets invisible to clients', (select count(*) = 0 from public.user_secrets));
do $$ begin
  insert into public.user_secrets (user_id, anthropic_key_enc) values (auth.uid(), 'x');
  perform pg_temp.check('clients cannot write secrets', false);
exception when others then perform pg_temp.check('clients cannot write secrets', true); end $$;
do $$ begin
  insert into public.mcp_tokens (user_id, name, token_hash, hint) values (auth.uid(), 't', 'h', 'x');
  perform pg_temp.check('clients cannot mint MCP tokens', false);
exception when others then perform pg_temp.check('clients cannot mint MCP tokens', true); end $$;
do $$ begin
  perform public.hit_rate_limit(auth.uid(), 'ai', 10, 60);
  perform pg_temp.check('clients cannot call the rate limiter', false);
exception when others then perform pg_temp.check('clients cannot call the rate limiter', true); end $$;
insert into storage.objects (bucket_id, name) values ('assets', '00000000-0000-0000-0000-00000000000a/logo.svg');
do $$ begin
  insert into storage.objects (bucket_id, name) values ('assets', '00000000-0000-0000-0000-00000000000b/evil.svg');
  perform pg_temp.check('cannot upload into another user''s folder', false);
exception when others then perform pg_temp.check('cannot upload into another user''s folder', true); end $$;
create temp table a_project as select id from public.projects where name = 'a2';
grant all on a_project to authenticated;

-- As user B
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check('B sees none of A''s projects', (select count(*) = 0 from public.projects));
update public.projects set name = 'pwned';
delete from public.projects;
select pg_temp.check('B cannot see A''s profile', (select count(*) = 1 from public.profiles));
select pg_temp.check('B cannot see A''s images', (select count(*) = 0 from storage.objects));
select pg_temp.check('B''s save_project on A''s project does nothing',
  (select public.save_project((select id from a_project), '{"nodes": []}', 1) is null));
select set_config('realtime.topic', 'project:' || (select id from a_project), false);
insert into realtime.messages (topic, extension) values ('x', 'broadcast');
reset role;
insert into realtime.messages (topic, extension) values ('project:' || (select id from a_project), 'broadcast');
set role authenticated;
select pg_temp.check('B cannot join A''s live channel', (select count(*) = 0 from realtime.messages));
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.check('A can join own live channel', (select count(*) >= 1 from realtime.messages));

reset role;
select pg_temp.check('A''s projects untouched by B', (select count(*) = 5 and bool_and(name <> 'pwned') from public.projects));
select pg_temp.check('rate limiter allows 2, blocks the 3rd',
  (select public.hit_rate_limit('00000000-0000-0000-0000-00000000000a', 't', 2, 60))
  and (select public.hit_rate_limit('00000000-0000-0000-0000-00000000000a', 't', 2, 60))
  and not (select public.hit_rate_limit('00000000-0000-0000-0000-00000000000a', 't', 2, 60)));

-- Concurrency: the limit holds under parallel inserts (checked from run.sh too).
delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.check('deleting an account deletes its projects', (select count(*) = 0 from public.projects));
