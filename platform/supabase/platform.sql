-- NUEVO. Ejecutar una vez sobre el proyecto original. No repite migraciones anteriores.
begin;
grant usage on schema auth to service_role;
grant select(id,email,email_confirmed_at) on auth.users to service_role;
create schema if not exists saas_private;
revoke all on schema saas_private from public,anon,authenticated;
grant usage on schema saas_private to service_role;
create table saas_private.settings(id int primary key check(id=1),bot_price int not null check(bot_price>0),site_price int not null check(site_price>0),days int not null default 30 check(days=30));
insert into saas_private.settings values(1,9900,19900,30);
create table saas_private.members(user_id uuid primary key references auth.users(id),web_only boolean not null default true,created_at timestamptz not null default now());
create table saas_private.sites(id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),slug text unique not null check(slug ~ '^[a-z][a-z0-9-]{2,39}$' and slug not in ('admin','api','web','sitios','panel','assets','supabase','scripts','tests','platform')),template text not null default 'food' check(template='food'),config jsonb not null default '{}',enabled boolean not null default true,expires_at timestamptz,created_at timestamptz not null default now());
create index on saas_private.sites(owner_id);
create table saas_private.products(id uuid primary key default gen_random_uuid(),site_id uuid not null references saas_private.sites(id),name text not null check(length(name) between 1 and 100),description text not null default '',price int not null check(price>=0),stock int not null check(stock>=0),category text not null default 'Comida',icon text not null default 'plate',image text not null default '',active boolean not null default true);
create index on saas_private.products(site_id);
create table saas_private.invoices(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),site_id uuid references saas_private.sites(id),kind text not null check(kind in ('BOT','WEB')),reference text unique not null,amount int not null check(amount>0),bank jsonb not null,status text not null default 'pending' check(status in ('pending','confirmed','denied','false')),movement_id uuid unique references public.maniobras_gmail_movements(id),created_at timestamptz not null default now(),paid_at timestamptz,reason text not null default '');
create index on saas_private.invoices(user_id,created_at desc);
create table saas_private.orders(id uuid primary key default gen_random_uuid(),site_id uuid not null references saas_private.sites(id),access_hash text not null,folio bigint generated always as identity,reference text unique not null,customer jsonb not null,delivery jsonb not null,items jsonb not null,subtotal int not null,shipping int not null,total int not null,bank jsonb not null,payment_status text not null default 'pending' check(payment_status in ('pending','confirmed','denied','false')),status text not null default 'new' check(status in ('new','accepted','delivered','cancelled')),movement_id uuid unique references public.maniobras_gmail_movements(id),released_at timestamptz,created_at timestamptz not null default now());
create index on saas_private.orders(site_id,created_at desc);
create table saas_private.events(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),message text not null,created_at timestamptz not null default now(),sent_at timestamptz,lease_until timestamptz,lease_token uuid,attempts int not null default 0);
create table saas_private.audit(id bigint generated always as identity,actor uuid,operation text not null,target uuid,reason text not null default '',created_at timestamptz not null default now());
create table saas_private.limits(key text primary key,count int not null default 1,window_at timestamptz not null default now());
do $$declare t text;begin foreach t in array array['settings','members','sites','products','invoices','orders','events','audit','limits'] loop execute format('alter table saas_private.%I enable row level security',t);execute format('revoke all on saas_private.%I from public,anon,authenticated',t);execute format('grant all on saas_private.%I to service_role',t);end loop;end$$;
grant usage,select on all sequences in schema saas_private to service_role;
-- Todas las llamadas pasan por la función Edge. p_admin procede de is_catalog_admin con JWT real.
create function public.saas_platform_api(p_action text,p_actor uuid,p_admin boolean,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare s saas_private.sites;i saas_private.invoices;o saas_private.orders;p saas_private.products;cfg jsonb;b jsonb;r jsonb;v jsonb;qty int;sub int=0;ship int=0;rows jsonb='[]';ref text;until_at timestamptz;attempt saas_private.limits;target uuid;lat float8;lng float8;km float8;pl text;state text;
begin
 if p_action='rate' then
  insert into saas_private.limits(key) values(p_payload->>'key') on conflict(key) do update set count=case when limits.window_at<now()-interval '1 minute' then 1 else limits.count+1 end,window_at=case when limits.window_at<now()-interval '1 minute' then now() else limits.window_at end returning * into attempt;
  if attempt.count>30 then raise exception 'Demasiadas solicitudes; espera un minuto';end if;return '{}'::jsonb;
 end if;
 if p_action='plans' then return (select to_jsonb(x)-'id' from saas_private.settings x where id=1);end if;
 if p_action='public_site' then
  select * into s from saas_private.sites where slug=p_payload->>'slug' and enabled and expires_at>now();
  if not found then raise exception 'Sitio no disponible o suscripción vencida';end if;
  perform saas_private.release_expired(s.id);
  select coalesce(jsonb_agg(to_jsonb(x)-'site_id'),'[]') into r from saas_private.products x where site_id=s.id and active;
  return jsonb_build_object('id',s.id,'slug',s.slug,'config',s.config,'products',r);
 end if;
 if p_action='order_status' then
  select * into o from saas_private.orders where id=(p_payload->>'id')::uuid and access_hash=p_payload->>'access_hash';
  if not found then raise exception 'Pedido no disponible';end if;return to_jsonb(o)-'access_hash'-'movement_id';
 end if;
 if p_action='order' then
  select * into s from saas_private.sites where slug=p_payload->>'slug' and enabled and expires_at>now() for update;
  if not found then raise exception 'Sitio no disponible';end if;
  perform saas_private.release_expired(s.id);
  select * into o from saas_private.orders where site_id=s.id and access_hash=p_payload->>'access_hash';
  if found then return to_jsonb(o)-'access_hash'-'movement_id';end if;
  if length(coalesce(p_payload->'customer'->>'name','')) not between 2 and 100 or coalesce(p_payload->'customer'->>'phone','') !~ '^[0-9+ ()-]{8,25}$' then raise exception 'Completa nombre y teléfono';end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array' or jsonb_array_length(p_payload->'items') not between 1 and 40 then raise exception 'Carrito inválido';end if;
  for v in select value from jsonb_array_elements(p_payload->'items') loop
   qty=(v->>'qty')::int;if qty not between 1 and 99 then raise exception 'Cantidad inválida';end if;
   select * into p from saas_private.products where id=(v->>'id')::uuid and site_id=s.id and active for update;
   if not found or p.stock<qty then raise exception 'Producto agotado o no disponible';end if;
   sub=sub+p.price*qty;rows=rows||jsonb_build_array(jsonb_build_object('id',p.id,'name',p.name,'qty',qty,'price',p.price,'subtotal',p.price*qty));
   update saas_private.products set stock=stock-qty where id=p.id;
  end loop;
  if p_payload->'delivery'->>'type'='delivery' then
   lat=(p_payload->'delivery'->>'lat')::float8;lng=(p_payload->'delivery'->>'lng')::float8;
   if lat is null or lng is null or lat not between -90 and 90 or lng not between -180 and 180 or coalesce(p_payload->'delivery'->>'address','')='' or s.config->>'lat' is null then raise exception 'Completa dirección y pin de entrega';end if;
   km=6371*2*asin(sqrt(least(1.0,power(sin(radians(lat-(s.config->>'lat')::float8)/2),2)+cos(radians(lat))*cos(radians((s.config->>'lat')::float8))*power(sin(radians(lng-(s.config->>'lng')::float8)/2),2))));
   if km>coalesce((s.config->>'maxKm')::float8,15) then raise exception 'Entrega fuera de cobertura';end if;
   ship=round(coalesce((s.config->>'deliveryBase')::numeric,0)+km*coalesce((s.config->>'perKm')::numeric,0));
  elsif p_payload->'delivery'->>'type' is distinct from 'pickup' then raise exception 'Tipo de entrega inválido';end if;
  select value into b from jsonb_array_elements(coalesce(s.config->'banks','[]')) where value->>'id'=p_payload->>'bank_id' and value->>'visible'='true';
  if b is null then raise exception 'Elige una banca visible';end if;
  if not exists(select 1 from public.maniobras_gmail_connections c where c.user_id=s.owner_id and c.slot=(b->>'bank_slot')::int and c.last4=b->>'last4' and c.bank=b->>'bank') then raise exception 'La banca cambió; el negocio debe actualizarla';end if;
  ref=nextval('maniobras_private.payment_reference_seq')::text;
  insert into saas_private.orders(site_id,access_hash,reference,customer,delivery,items,subtotal,shipping,total,bank) values(s.id,p_payload->>'access_hash',ref,p_payload->'customer',p_payload->'delivery',rows,sub,ship,sub+ship,b) returning * into o;
  insert into saas_private.events(user_id,message) values(s.owner_id,'Nuevo pedido PED-'||o.folio||'. Total $'||(o.total/100.0)||'. Referencia '||o.reference);
  return to_jsonb(o)-'access_hash'-'movement_id';
 end if;
 if p_actor is null then raise exception 'Inicia sesión para continuar';end if;
 if p_action='bank_snapshot' then
  select * into s from saas_private.sites where id=(p_payload->>'site_id')::uuid and (owner_id=p_actor or p_admin);
  if not found then raise exception 'No tienes acceso a este sitio';end if;
  return (select jsonb_build_object('owner',s.owner_id,'cipher',c.account_cipher) from public.maniobras_gmail_connections c where user_id=s.owner_id and slot=(p_payload->>'slot')::int);
 elsif p_action='dashboard' then
  select coalesce(jsonb_agg(to_jsonb(x) order by created_at desc),'[]') into r from saas_private.sites x where owner_id=p_actor or p_admin;
  select data into cfg from public.catalog_settings where id=1;
  return jsonb_build_object('admin',p_admin,'sites',r,'settings',(select to_jsonb(x)-'id' from saas_private.settings x where id=1),'bot_access',p_admin or maniobras_private.bot_has_access(p_actor),'bot_expires',(select expires_at from maniobras_private.bot_subscriptions where user_id=p_actor),'payments',coalesce(cfg->'payments','[]'),'social',coalesce(cfg->'social','[]'),'invoices',(select coalesce(jsonb_agg(to_jsonb(x) order by created_at desc),'[]') from (select * from saas_private.invoices where user_id=p_actor or p_admin order by created_at desc limit 200)x),'events',(select coalesce(jsonb_agg(to_jsonb(x)-'lease_token'-'lease_until'),'[]') from (select * from saas_private.events where user_id=p_actor order by created_at desc limit 30)x));
 elsif p_action='create_site' then
  if not exists(select 1 from auth.users where id=p_actor and email_confirmed_at is not null) then raise exception 'Confirma tu correo antes de crear un sitio';end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text,947));
  if (select count(*) from saas_private.sites where owner_id=p_actor)>=10 then raise exception 'Máximo 10 sitios por cuenta';end if;
  insert into saas_private.sites(owner_id,slug,config) values(p_actor,lower(p_payload->>'slug'),jsonb_build_object('name',p_payload->>'name','whatsapp','','banks','[]'::jsonb,'social','[]'::jsonb)) returning * into s;
  insert into saas_private.members(user_id) values(p_actor) on conflict do nothing;return to_jsonb(s);
 elsif p_action='invoice' then
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text,948));pl=p_payload->>'kind';
  if pl='BOT' and (p_admin or maniobras_private.bot_is_creator(p_actor)) then raise exception 'El creador tiene acceso gratuito permanente';end if;
  if pl not in ('BOT','WEB') then raise exception 'Plan inválido';end if;
  if pl='WEB' then select * into s from saas_private.sites where id=(p_payload->>'site_id')::uuid and owner_id=p_actor;if not found then raise exception 'Sitio no disponible';end if;end if;
  select * into i from saas_private.invoices where user_id=p_actor and kind=pl and site_id is not distinct from s.id and status='pending' order by created_at desc limit 1;
  if found then return to_jsonb(i);end if;
  select data into cfg from public.catalog_settings where id=1;
  select value into b from jsonb_array_elements(coalesce(cfg->'payments','[]')) where value->>'id'=p_payload->>'bank_id' and coalesce(value->>'visible','true')<>'false' and value->>'linked_bank'='true';
  if b is null then raise exception 'Selecciona una banca vinculada y publicada por el creador';end if;
  if (cfg->'paymentChannels'->(b->>'id')) is not null and not (cfg->'paymentChannels'->(b->>'id') ? 'transfer') then raise exception 'La banca no permite transferencia';end if;
  insert into saas_private.invoices(user_id,site_id,kind,reference,amount,bank) select p_actor,s.id,pl,nextval('maniobras_private.payment_reference_seq')::text,case when pl='BOT' then bot_price else site_price end,b from saas_private.settings where id=1 returning * into i;
  insert into saas_private.members(user_id) values(p_actor) on conflict do nothing;return to_jsonb(i);
 elsif p_action='subscription_access' then
  if not p_admin then raise exception 'Solo el creador';end if;
  return maniobras_private.bot_change_access((p_payload->>'user_id')::uuid,p_payload->>'operation',p_actor,null);
 elsif p_action='subscribers' then
  if not p_admin then raise exception 'Solo el creador';end if;
  return (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select m.user_id,u.email,b.expires_at,case when maniobras_private.bot_is_creator(m.user_id) then 'creator' when exists(select 1 from maniobras_private.bot_access_controls c where c.user_id=m.user_id and c.suspended) then 'suspended' when b.expires_at>now() then 'active' else 'expired' end as status,(select count(*) from saas_private.invoices i where i.user_id=m.user_id and kind='BOT' and status='confirmed') as paid_count,(select coalesce(jsonb_agg(jsonb_build_object('slot',c.slot,'bank',c.bank,'last4',c.last4)),'[]') from public.maniobras_gmail_connections c where c.user_id=m.user_id) as banks from saas_private.members m join auth.users u on u.id=m.user_id left join maniobras_private.bot_subscriptions b on b.user_id=m.user_id)x);
 elsif p_action='prices' then
  if not p_admin then raise exception 'Solo el creador';end if;
  update saas_private.settings set bot_price=(p_payload->>'bot_price')::int,site_price=(p_payload->>'site_price')::int where id=1;return '{}'::jsonb;
 elsif p_action='decision' then
  if not p_admin then raise exception 'Solo el creador';end if;
  select * into i from saas_private.invoices where id=(p_payload->>'id')::uuid for update;
  if not found then raise exception 'Factura no disponible';end if;
  state=p_payload->>'status';if state not in ('confirmed','denied','false') or length(coalesce(p_payload->>'reason',''))<3 then raise exception 'Estado y motivo obligatorios';end if;
  if i.status='confirmed' then raise exception 'Pago ya confirmado; administra el acceso por separado';end if;
  update saas_private.invoices set status=state,paid_at=case when state='confirmed' then now() end,reason=p_payload->>'reason' where id=i.id;
  insert into saas_private.audit(actor,operation,target,reason) values(p_actor,state,i.id,p_payload->>'reason');
  if state='confirmed' then perform saas_private.activate(i);end if;return '{}'::jsonb;
 elsif p_action in ('site_config','product','site_orders','order_decision','order_payment_decision','site_access') then
  select * into s from saas_private.sites where id=(p_payload->>'site_id')::uuid and (owner_id=p_actor or p_admin) for update;
  if not found then raise exception 'No tienes acceso a este sitio';end if;
  if p_action='site_access' then
   if not p_admin then raise exception 'Solo el creador';end if;
   update saas_private.sites set enabled=(p_payload->>'enabled')::boolean where id=s.id;
   insert into saas_private.audit(actor,operation,target) values(p_actor,'site_access',s.id);return '{}'::jsonb;
  end if;
  if not p_admin and (not s.enabled or s.expires_at is null or s.expires_at<=now()) then raise exception 'Renueva la suscripción del sitio';end if;
  if p_action='site_orders' then return jsonb_build_object('orders',(select coalesce(jsonb_agg(to_jsonb(x)-'access_hash'),'[]') from (select * from saas_private.orders where site_id=s.id order by created_at desc limit 200)x),'products',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from saas_private.products x where site_id=s.id));end if;
  if p_action='site_config' then
   cfg=p_payload->'config';if jsonb_typeof(cfg)<>'object' then raise exception 'Configuración inválida';end if;
   if jsonb_array_length(coalesce(cfg->'banks','[]'))>3 then raise exception 'Máximo tres bancas';end if;
   for b in select value from jsonb_array_elements(coalesce(cfg->'banks','[]')) loop
    if not exists(select 1 from public.maniobras_gmail_connections c where user_id=s.owner_id and slot=(b->>'bank_slot')::int and c.bank=b->>'bank' and c.last4=right(b->>'account',4) and c.last4=b->>'last4' and c.tested_at is not null) or (b->>'account') !~ '^[0-9]{8,20}$' then raise exception 'Guarda y prueba primero esa banca en el módulo de correos';end if;
   end loop;
   if coalesce((cfg->>'deliveryBase')::int,0)<0 or coalesce((cfg->>'perKm')::int,0)<0 then raise exception 'Tarifa inválida';end if;
   if cfg->>'lat' is not null and ((cfg->>'lat')::float8 not between -90 and 90 or (cfg->>'lng')::float8 not between -180 and 180) then raise exception 'Pin inválido';end if;
   update saas_private.sites set config=cfg where id=s.id;return '{}'::jsonb;
  elsif p_action='product' then
   if p_payload->>'id' is not null and not exists(select 1 from saas_private.products where id=(p_payload->>'id')::uuid and site_id=s.id) then raise exception 'Producto ajeno';end if;
   insert into saas_private.products(id,site_id,name,description,price,stock,category,icon,image,active) values(coalesce((p_payload->>'id')::uuid,gen_random_uuid()),s.id,p_payload->>'name',coalesce(p_payload->>'description',''),(p_payload->>'price')::int,(p_payload->>'stock')::int,coalesce(p_payload->>'category','Comida'),coalesce(p_payload->>'icon','plate'),coalesce(p_payload->>'image',''),coalesce((p_payload->>'active')::boolean,true)) on conflict(id) do update set name=excluded.name,description=excluded.description,price=excluded.price,stock=excluded.stock,category=excluded.category,icon=excluded.icon,image=excluded.image,active=excluded.active;
   return '{}'::jsonb;
  elsif p_action='order_payment_decision' then
   select * into o from saas_private.orders where site_id=s.id and id=(p_payload->>'id')::uuid for update;
   state=p_payload->>'status';
   if not found or o.payment_status='confirmed' or state not in ('confirmed','denied','false') or length(coalesce(p_payload->>'reason',''))<3 then raise exception 'Revisa el pedido y escribe un motivo';end if;
   update saas_private.orders set payment_status=state where id=o.id;
   insert into saas_private.audit(actor,operation,target,reason) values(p_actor,'order_payment_'||state,o.id,p_payload->>'reason');perform saas_private.release_expired(s.id);return '{}';
  elsif p_action='order_decision' then
   state=p_payload->>'status';if state not in ('accepted','delivered','cancelled') then raise exception 'Estado inválido';end if;
   select * into o from saas_private.orders where site_id=s.id and id=(p_payload->>'id')::uuid for update;
   if not found or o.payment_status<>'confirmed' or o.status in ('delivered','cancelled') or (state='delivered' and o.status<>'accepted') then raise exception 'Confirma el pago y acepta el pedido antes de entregarlo';end if;
   update saas_private.orders set status=state where id=o.id;return '{}'::jsonb;
  end if;
 end if;raise exception 'Acción no disponible';
end$$;
create function saas_private.release_expired(p_site uuid) returns void language plpgsql security invoker set search_path='' as $$declare o saas_private.orders;item jsonb;begin
 for o in select * from saas_private.orders where site_id=p_site and released_at is null and status='new' and (payment_status in ('denied','false') or (payment_status='pending' and created_at<now()-interval '1 hour')) for update skip locked loop
  for item in select value from jsonb_array_elements(o.items) loop update saas_private.products set stock=stock+(item->>'qty')::int where site_id=p_site and id=(item->>'id')::uuid;end loop;
  update saas_private.orders set status='cancelled',released_at=now() where id=o.id;
 end loop;
end$$;
create function saas_private.activate(i saas_private.invoices) returns void language plpgsql security invoker set search_path='' as $$begin
 if i.kind='BOT' then
  select * into i from saas_private.invoices x where x.id=i.id;
  insert into maniobras_private.bot_invoices(id,user_id,currency,amount,reference,bank,status,created_at,paid_at,movement_id) values(i.id,i.user_id,'MXN',i.amount,i.reference,i.bank,'paid',i.created_at,now(),i.movement_id);
  insert into maniobras_private.bot_subscriptions(user_id,expires_at) values(i.user_id,now()+interval '30 days') on conflict(user_id) do update set expires_at=greatest(now(),bot_subscriptions.expires_at)+interval '30 days';
 else update saas_private.sites set expires_at=greatest(now(),coalesce(expires_at,now()))+interval '30 days' where id=i.site_id;end if;
 insert into saas_private.events(user_id,message) values(i.user_id,'Suscripción '||i.kind||' confirmada. Referencia '||i.kind||'-'||i.reference||'. Acceso por 30 días. Configura banca y Gmail desde el panel web.');
 insert into saas_private.events(user_id,message) select t.user_id,'Nueva suscripción '||i.kind||' pagada por '||coalesce(u.email,i.user_id::text)||'. $'||i.amount/100.0||'. Referencia '||i.reference from maniobras_private.bot_creator c join maniobras_private.telegram_accounts t on t.telegram_id=c.telegram_id left join auth.users u on u.id=i.user_id where c.id=1;
end$$;
-- Amplía el verificador existente; requiere sus pruebas DKIM y cuenta destinataria. Un correo solo no basta.
do $$begin if to_regprocedure('public.saas_verify_before_platform(uuid,integer,jsonb)') is null then alter function public.maniobras_verify_bank_payments(uuid,integer,jsonb) rename to saas_verify_before_platform;end if;end$$;
create or replace function public.maniobras_verify_bank_payments(p_actor uuid,p_slot integer,p_proofs jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb;proof jsonb;m public.maniobras_gmail_movements;c public.maniobras_gmail_connections;i saas_private.invoices;o saas_private.orders;s saas_private.sites;
begin
 perform pg_advisory_xact_lock(hashtextextended('bank-payments',715));
 r=public.saas_verify_before_platform(p_actor,p_slot,p_proofs);
 select * into c from public.maniobras_gmail_connections where user_id=p_actor and slot=p_slot;
 for proof in select value from jsonb_array_elements(p_proofs) loop
  if proof->>'authenticated' is distinct from 'true' or proof->>'recipient_last4' is distinct from c.last4 then continue;end if;
  select * into m from public.maniobras_gmail_movements where user_id=p_actor and email=lower(c.email) and message_id=proof->>'message_id' and tracking_key=proof->>'tracking_key';
  if not found or exists(select 1 from maniobras_private.payment_matches where movement_id=m.id) or exists(select 1 from maniobras_private.bot_invoices where movement_id=m.id) or exists(select 1 from saas_private.invoices where movement_id=m.id) or exists(select 1 from saas_private.orders where movement_id=m.id) then continue;end if;
  select * into i from saas_private.invoices where status='pending' and reference=m.reference and amount=m.amount_cents and bank->>'bank_slot'=p_slot::text and bank->>'last4'=c.last4 and bank->>'bank'=c.bank and created_at<=m.received_at+interval '5 minutes' and exists(select 1 from maniobras_private.business_banks where user_id=p_actor and slot=p_slot) for update;
  if found then update saas_private.invoices set status='confirmed',paid_at=now(),movement_id=m.id where id=i.id;perform saas_private.activate(i);continue;end if;
  select x.* into o from saas_private.orders x join saas_private.sites ss on ss.id=x.site_id where ss.owner_id=p_actor and x.payment_status='pending' and x.status='new' and x.released_at is null and x.reference=m.reference and x.total=m.amount_cents and x.bank->>'bank_slot'=p_slot::text and x.bank->>'bank'=c.bank and x.bank->>'last4'=c.last4 and x.created_at<=m.received_at+interval '5 minutes' for update of x;
  if found then update saas_private.orders set payment_status='confirmed',movement_id=m.id where id=o.id;insert into saas_private.events(user_id,message) values(p_actor,'Pago confirmado PED-'||o.folio||'. Referencia '||o.reference);end if;
 end loop;return r;
end$$;
-- Telegram conserva el registro y muestra enlace al panel para los miembros de esta plataforma.
create function public.saas_telegram_mode(p_telegram bigint) returns boolean language sql stable security invoker set search_path='' as $$select exists(select 1 from saas_private.members m join maniobras_private.telegram_accounts t on t.user_id=m.user_id where t.telegram_id=p_telegram and m.web_only)$$;
create function public.saas_notifications(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$declare r jsonb;begin
 if p_action='claim' then
  with batch as (select e.id from saas_private.events e join maniobras_private.telegram_accounts t on t.user_id=e.user_id where e.sent_at is null and e.attempts<10 and (e.lease_until is null or e.lease_until<now()) order by e.created_at limit 10 for update of e skip locked),leased as (update saas_private.events e set lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=attempts+1 from batch where e.id=batch.id returning e.*)
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'token',e.lease_token,'message',e.message,'telegram_id',t.telegram_id)),'[]') into r from leased e join maniobras_private.telegram_accounts t on t.user_id=e.user_id;return r;
 elsif p_action='ack' then update saas_private.events set sent_at=now(),lease_until=null where id=(p_payload->>'id')::uuid and lease_token=(p_payload->>'token')::uuid;return '{}';end if;raise exception 'Acción inválida';end$$;
revoke all on all functions in schema saas_private from public,anon,authenticated;
grant execute on all functions in schema saas_private to service_role;
revoke all on function public.saas_platform_api(text,uuid,boolean,jsonb),public.saas_verify_before_platform(uuid,integer,jsonb),public.maniobras_verify_bank_payments(uuid,integer,jsonb),public.saas_telegram_mode(bigint),public.saas_notifications(text,jsonb) from public,anon,authenticated;
grant execute on function public.saas_platform_api(text,uuid,boolean,jsonb),public.saas_verify_before_platform(uuid,integer,jsonb),public.maniobras_verify_bank_payments(uuid,integer,jsonb),public.saas_telegram_mode(bigint),public.saas_notifications(text,jsonb) to service_role;
create function public.saas_publish_sites() returns jsonb language sql stable security invoker set search_path='' as $$select coalesce(jsonb_agg(jsonb_build_object('slug',slug)),'[]') from saas_private.sites where enabled and expires_at>now()$$;
revoke all on function public.saas_publish_sites() from public,anon,authenticated;
grant execute on function public.saas_publish_sites() to service_role;
notify pgrst,'reload schema';
commit;
