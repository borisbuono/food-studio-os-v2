-- Meta inbox poller: pg_cron every 10 minutes -> pg_net -> meta-inbox-pull.
-- Same trigger model as social-publish-due (Vercel Hobby has only two cron
-- slots, both taken). Auth = social_inbox_secret from Vault, checked back by
-- the function through social_inbox_secret_ok(). Reads only; nothing sends.
select cron.unschedule(jobid) from cron.job where jobname = 'social-inbox-pull';
select cron.schedule('social-inbox-pull', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://rfdsysrdoncyoytcrzpg.supabase.co/functions/v1/meta-inbox-pull',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-scheduler-secret', (select decrypted_secret from vault.decrypted_secrets
                              where name = 'social_inbox_secret')),
    body := '{"via":"cron"}'::jsonb,
    timeout_milliseconds := 150000
  );
$$);
