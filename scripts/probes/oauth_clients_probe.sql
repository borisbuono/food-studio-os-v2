-- Rolled-back RLS probe for oauth_clients (run on prod inside begin/rollback; the last SELECT is the report).
-- Expect: stranger 0 rows / all RPCs refused / secret_vault_id refused / vault schema refused; Boris 1 row safe cols; permissive audit 0.
begin;
-- ---- probes (rolled back)
create temp table probe(step text, result text);
grant all on probe to authenticated;
insert into probe select 'seed as postgres', (select public.oauth_client_set('387f1045-0340-4029-a1e4-28b15c372680','google','111-test.apps.googleusercontent.com','SECRET-BM','bistro-mondo.com'))::text;
insert into probe select 'fn as postgres', (select row(client_id, client_secret, hosted_domain)::text from public.fn_oauth_client_for('387f1045-0340-4029-a1e4-28b15c372680','google'));
insert into probe select 'fn no row (taller) → 0 rows', (select count(*) from public.fn_oauth_client_for('daec58d9-44a2-4c24-9183-2a87219093fb','google'))::text;
-- stranger
insert into auth.users (id, email, instance_id, aud, role) values ('00000000-0000-4000-8000-00000000beef','stranger@probe.test','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000beef',true);
select set_config('request.jwt.claim.role','authenticated',true);
insert into probe select 'stranger select oauth_clients', (select count(*) from public.oauth_clients)::text;
do $$ begin perform client_id from public.fn_oauth_client_for('387f1045-0340-4029-a1e4-28b15c372680','google'); insert into probe values ('stranger fn_oauth_client_for','ALLOWED (BAD)'); exception when others then insert into probe values ('stranger fn_oauth_client_for', 'refused: '||sqlerrm); end $$;
do $$ begin perform public.oauth_client_set('387f1045-0340-4029-a1e4-28b15c372680','google','evil','evil',null); insert into probe values ('stranger oauth_client_set','ALLOWED (BAD)'); exception when others then insert into probe values ('stranger oauth_client_set', 'refused: '||sqlerrm); end $$;
do $$ begin perform public.oauth_client_disable('387f1045-0340-4029-a1e4-28b15c372680','google'); insert into probe values ('stranger oauth_client_disable','ALLOWED (BAD)'); exception when others then insert into probe values ('stranger oauth_client_disable', 'refused: '||sqlerrm); end $$;
do $$ begin perform secret_vault_id from public.oauth_clients; insert into probe values ('authenticated select secret_vault_id','ALLOWED (BAD)'); exception when others then insert into probe values ('authenticated select secret_vault_id', 'refused: '||sqlerrm); end $$;
do $$ begin perform 1 from vault.decrypted_secrets; insert into probe values ('authenticated vault.decrypted_secrets','ALLOWED (BAD)'); exception when others then insert into probe values ('authenticated vault.decrypted_secrets', 'refused: '||sqlerrm); end $$;
-- Boris
select set_config('request.jwt.claim.sub','93110186-51b5-4969-a812-6fbff1809415',true);
insert into probe select 'boris select oauth_clients (safe cols)', (select count(*)||' rows, client_id='||min(client_id)||', status='||min(status) from public.oauth_clients);
insert into probe select 'boris oauth_client_set taller', (select public.oauth_client_set('daec58d9-44a2-4c24-9183-2a87219093fb','google','222-test.apps.googleusercontent.com','SECRET-TALLER','ibzfoodstudio.com'))::text;
insert into probe select 'boris replace bm', (select public.oauth_client_set('387f1045-0340-4029-a1e4-28b15c372680','google','333-new.apps.googleusercontent.com','SECRET-BM-2',null))::text;
do $$ begin perform public.oauth_client_disable('387f1045-0340-4029-a1e4-28b15c372680','google'); insert into probe values ('boris disable bm','ok'); end $$;
reset role;
select set_config('request.jwt.claim.role','',true);
select set_config('request.jwt.claim.sub','',true);
insert into probe select 'fn bm after disable → 0 rows', (select count(*) from public.fn_oauth_client_for('387f1045-0340-4029-a1e4-28b15c372680','google'))::text;
insert into probe select 'fn taller after boris set', (select row(client_id, client_secret, hosted_domain)::text from public.fn_oauth_client_for('daec58d9-44a2-4c24-9183-2a87219093fb','google'));
insert into probe select 'vault rows for oauth', (select count(*) from vault.secrets where name like 'oauth:%')::text;
insert into probe select 'permissive-policy audit on oauth_clients', (select count(*) from pg_policies where schemaname='public' and tablename='oauth_clients' and (roles::text like '%anon%' or coalesce(qual,'')='true' or coalesce(with_check,'')='true'))::text;
select * from probe;
rollback;
