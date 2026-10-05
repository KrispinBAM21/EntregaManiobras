-- NUEVO Y OPCIONAL: después de desplegar saas-platform.
-- Vault debe tener platform_worker_secret (mismo valor que PLATFORM_WORKER_SECRET de Edge)
-- y platform_supabase_url (https://rtskwikdauqqatruwddp.supabase.co).
-- No pegar estos valores en archivos públicos ni en GitHub.
do $$begin
 if not exists(select 1 from vault.decrypted_secrets where name='platform_worker_secret') or not exists(select 1 from vault.decrypted_secrets where name='platform_supabase_url') then raise exception 'Crea primero ambos secretos en Vault';end if;
end$$;
select cron.schedule('platform-telegram-notifications','* * * * *',$job$
 select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name='platform_supabase_url' limit 1)||'/functions/v1/saas-platform',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='platform_worker_secret' limit 1)),body:='{"action":"notifications"}'::jsonb);
$job$);
