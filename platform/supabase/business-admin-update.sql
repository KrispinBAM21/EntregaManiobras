-- Actualización incremental: requiere platform.sql y panel-modules.sql ya instalados.
begin;
create table if not exists saas_private.site_staff(site_id uuid references saas_private.sites(id),user_id uuid references auth.users(id),permissions text[] not null default '{}',primary key(site_id,user_id),check(permissions <@ array['products','orders','payments','settings','reports']::text[]));
create table if not exists saas_private.site_bans(site_id uuid references saas_private.sites(id),phone text,reason text not null,expires_at timestamptz,primary key(site_id,phone));
create table if not exists saas_private.site_audit(id bigint generated always as identity,site_id uuid references saas_private.sites(id),actor uuid,operation text not null,target uuid,created_at timestamptz default now());
alter table saas_private.orders add column if not exists courier_id uuid references auth.users(id);
alter table saas_private.orders add column if not exists accepted_at timestamptz;
alter table saas_private.orders add column if not exists delivered_at timestamptz;
alter table saas_private.orders add column if not exists courier_earning int;
alter table saas_private.orders add column if not exists settled_at timestamptz;
do $$declare t text;begin foreach t in array array['site_staff','site_bans','site_audit'] loop execute format('alter table saas_private.%I enable row level security',t);execute format('revoke all on saas_private.%I from public,anon,authenticated',t);execute format('grant all on saas_private.%I to service_role',t);end loop;end$$;
grant usage,select on all sequences in schema saas_private to service_role;
do $$begin if to_regprocedure('public.saas_platform_v2(text,uuid,boolean,jsonb)') is null then alter function public.saas_platform_api(text,uuid,boolean,jsonb) rename to saas_platform_v2;end if;end$$;
-- Permite pedidos con transferencia manual sin exigir una conexión de correo.
do $patch$declare definition text;old_clause text := 'if not exists(select 1 from public.maniobras_gmail_connections c where c.user_id=s.owner_id and c.slot=(b->>''bank_slot'')::int and c.last4=b->>''last4'' and c.bank=b->>''bank'') then raise exception ''La banca cambió; el negocio debe actualizarla'';end if;';begin
 select pg_get_functiondef('public.saas_platform_v1(text,uuid,boolean,jsonb)'::regprocedure) into definition;
 if position(old_clause in definition)>0 then execute replace(definition,old_clause,'if b->>''bank_slot'' is not null and '||substr(old_clause,4));
 elsif position('if b->>''bank_slot'' is not null and not exists' in definition)=0 then raise exception 'Versión de plataforma incompatible: revisa saas_platform_v1';end if;
end$patch$;
create or replace function public.saas_platform_api(p_action text,p_actor uuid,p_admin boolean,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare s saas_private.sites;r jsonb;cfg jsonb;perms text[];needed text;own boolean;target uuid;o saas_private.orders;b jsonb;paid boolean;acting uuid:=p_actor;
begin
 if p_action='dashboard' then
  r=public.saas_platform_v2(p_action,p_actor,p_admin,p_payload);
  select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('bot_access',maniobras_private.bot_has_access(x.owner_id),'permissions',case when x.owner_id=p_actor or p_admin then array['products','orders','payments','settings','reports','owner'] else st.permissions end) order by x.created_at desc),'[]') into cfg
  from saas_private.sites x left join saas_private.site_staff st on st.site_id=x.id and st.user_id=p_actor where x.owner_id=p_actor or p_admin or st.user_id=p_actor;
  return r||jsonb_build_object('sites',cfg);
 end if;
 if p_action='order' then
  select * into s from saas_private.sites where slug=p_payload->>'slug';
  if exists(select 1 from saas_private.site_bans where site_id=s.id and phone=regexp_replace(p_payload->'customer'->>'phone','[^0-9]','','g') and (expires_at is null or expires_at>now())) then raise exception 'Este contacto está bloqueado para pedidos en este negocio';end if;
 end if;
 if p_action in ('site_config','site_orders','product','order_decision','order_payment_decision','site_context','preview_site','asset_reserve','asset_remove','bank_snapshot','site_report','site_staff','staff_save','staff_remove','customer_ban','customer_unban','settle','site_bot') then
  if p_actor is null then raise exception 'Inicia sesión';end if;
  select * into s from saas_private.sites where id=nullif(p_payload->>'site_id','')::uuid or slug=p_payload->>'slug' for update;
  if not found then raise exception 'No tienes acceso a este sitio';end if;
  own=s.owner_id=p_actor or p_admin;
  select permissions into perms from saas_private.site_staff where site_id=s.id and user_id=p_actor;
  if not own and perms is null then raise exception 'No tienes acceso a este sitio';end if;
  if not p_admin and (not s.enabled or s.expires_at is null or s.expires_at<=now()) then raise exception 'Renueva la suscripción del sitio';end if;
  needed=case when p_action='product' then 'products' when p_action='order_decision' then 'orders' when p_action='order_payment_decision' then 'payments' when p_action in ('site_config','bank_snapshot') then 'settings' when p_action='site_report' then 'reports' else null end;
  if not own and needed is not null and not needed=any(perms) then raise exception 'No tienes permiso para este módulo';end if;
  if not own and p_action in ('asset_reserve','asset_remove','site_context') and not perms && array['products','settings'] then raise exception 'Sin permiso';end if;
  if not own and p_action in ('site_staff','staff_save','staff_remove','customer_ban','customer_unban','settle','site_bot') then raise exception 'Solo el propietario';end if;
  paid=maniobras_private.bot_has_access(s.owner_id);
  if p_action='site_bot' then
   if not paid then raise exception 'El propietario necesita una suscripción activa del bot';end if;
   if s.owner_id<>p_actor then raise exception 'Vincula los correos con la cuenta propietaria';end if;
   select coalesce(jsonb_agg(jsonb_build_object('slot',slot,'bank',bank,'last4',last4,'tested_at',tested_at)),'[]') into r from public.maniobras_gmail_connections where user_id=p_actor;
   return jsonb_build_object('banks',r,'expires_at',(select expires_at from maniobras_private.bot_subscriptions where user_id=p_actor));
  elsif p_action='site_staff' then
   select coalesce(jsonb_agg(jsonb_build_object('user_id',st.user_id,'email',u.email,'permissions',st.permissions)),'[]') into r from saas_private.site_staff st join auth.users u on u.id=st.user_id where st.site_id=s.id;return r;
  elsif p_action='staff_save' then
   select id into target from auth.users where lower(email)=lower(trim(p_payload->>'email')) and email_confirmed_at is not null;
   if target is null then raise exception 'La persona debe crear y confirmar su cuenta primero';end if;
   if target=s.owner_id then raise exception 'El propietario ya tiene acceso completo';end if;
   select array_agg(value) into perms from jsonb_array_elements_text(p_payload->'permissions');
   if perms is null or not perms <@ array['products','orders','payments','settings','reports']::text[] then raise exception 'Permisos inválidos';end if;
   insert into saas_private.site_staff values(s.id,target,perms) on conflict(site_id,user_id) do update set permissions=excluded.permissions;
  elsif p_action='staff_remove' then delete from saas_private.site_staff where site_id=s.id and user_id=(p_payload->>'user_id')::uuid;
  elsif p_action='customer_ban' then
   if length(coalesce(p_payload->>'reason','')) not between 3 and 300 or coalesce(p_payload->>'phone','')!~'^[0-9]{7,15}$' then raise exception 'Contacto o motivo inválido';end if;
   if not exists(select 1 from saas_private.orders where site_id=s.id and regexp_replace(customer->>'phone','[^0-9]','','g')=p_payload->>'phone') then raise exception 'Contacto sin pedidos en este negocio';end if;
   if p_payload->>'hours' is not null and (p_payload->>'hours')::int not between 1 and 87600 then raise exception 'Duración inválida';end if;
   insert into saas_private.site_bans values(s.id,p_payload->>'phone',p_payload->>'reason',case when p_payload->>'hours' is null then null else now()+((p_payload->>'hours')::int*interval '1 hour') end) on conflict(site_id,phone) do update set reason=excluded.reason,expires_at=excluded.expires_at;
  elsif p_action='customer_unban' then delete from saas_private.site_bans where site_id=s.id and phone=p_payload->>'phone';
  elsif p_action='settle' then
   update saas_private.orders set settled_at=now() where site_id=s.id and id=(p_payload->>'id')::uuid and status='delivered' and settled_at is null;
   if not found then raise exception 'Viaje no disponible para liquidación';end if;
  elsif p_action='site_report' then
   return jsonb_build_object('audit',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select * from saas_private.site_audit where site_id=s.id order by created_at desc limit 200)x),'bans',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from saas_private.site_bans x where site_id=s.id and (expires_at is null or expires_at>now())));
  elsif p_action='site_orders' then
   if not own and not perms && array['orders','products','payments','reports'] then raise exception 'Sin permiso';end if;
   r=public.saas_platform_v2(p_action,s.owner_id,p_admin,p_payload);
   if not own and not perms && array['orders','payments','reports'] then r=jsonb_set(r,'{orders}','[]');end if;
   return r;
  elsif p_action='preview_site' then
   if not own and not 'settings'=any(perms) then raise exception 'Sin permiso';end if;
   r=public.saas_platform_v2(p_action,s.owner_id,p_admin,p_payload);
  elsif p_action='site_config' then
   cfg=p_payload->'config';
   if jsonb_typeof(cfg) is distinct from 'object' or jsonb_typeof(coalesce(cfg->'banks','[]')) is distinct from 'array' or jsonb_array_length(coalesce(cfg->'banks','[]'))>3 then raise exception 'Configuración inválida: máximo tres cuentas';end if;
   if coalesce((cfg->>'commissionPercent')::numeric,0) not between 0 and 100 then raise exception 'Comisión inválida';end if;
   -- Las cuentas manuales son válidas sin bot. Las vinculadas se comprueban en Edge.
   for b in select value from jsonb_array_elements(coalesce(cfg->'banks','[]')) loop
    if coalesce(b->>'account','')!~'^[0-9]{8,20}$' or length(coalesce(b->>'beneficiary',''))>100 then raise exception 'Cuenta inválida';end if;
    if b->>'bank_slot' is not null and not paid then raise exception 'Renueva el bot o cambia la cuenta a validación manual';end if;
   end loop;
   -- v1 exige vinculación: valida allí una copia sin cuentas y conserva las manuales después.
   r=public.saas_platform_v2(p_action,s.owner_id,p_admin,jsonb_set(p_payload,'{config,banks}','[]'));
   update saas_private.sites set config=cfg where id=s.id;
  elsif p_action='order_decision' then
   select * into o from saas_private.orders where site_id=s.id and id=(p_payload->>'id')::uuid for update;
   if p_payload->>'status'='accepted' and o.status<>'new' then raise exception 'Este viaje ya fue aceptado';end if;
   if not own and o.status='accepted' and o.courier_id is distinct from p_actor then raise exception 'El viaje está asignado a otra persona';end if;
   r=public.saas_platform_v2(p_action,s.owner_id,p_admin,p_payload);
   if p_payload->>'status'='accepted' then update saas_private.orders set courier_id=p_actor,accepted_at=now(),courier_earning=round(shipping*(100-coalesce((s.config->>'commissionPercent')::numeric,0))/100)::int where id=o.id;
   elsif p_payload->>'status'='delivered' then update saas_private.orders set delivered_at=now() where id=o.id;end if;
  else r=public.saas_platform_v2(p_action,s.owner_id,p_admin,p_payload);
  end if;
  if p_action not in ('preview_site','site_context','asset_remove','asset_reserve','bank_snapshot') then insert into saas_private.site_audit(site_id,actor,operation,target) values(s.id,p_actor,p_action,coalesce(nullif(p_payload->>'id','')::uuid,target));end if;
  return coalesce(r,'{}');
 end if;
 return public.saas_platform_v2(p_action,p_actor,p_admin,p_payload);
end$$;
revoke all on function public.saas_platform_api(text,uuid,boolean,jsonb),public.saas_platform_v2(text,uuid,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.saas_platform_api(text,uuid,boolean,jsonb),public.saas_platform_v2(text,uuid,boolean,jsonb) to service_role;
commit;
