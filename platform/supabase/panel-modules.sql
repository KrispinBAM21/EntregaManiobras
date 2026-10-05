-- ACTUALIZACION: ejecutar sobre platform.sql ya instalado. No repite tablas anteriores.
begin;
grant usage on sequence maniobras_private.payment_reference_seq to service_role;
alter table saas_private.settings add column if not exists map_config jsonb not null default '{}'::jsonb;
update saas_private.settings set map_config=jsonb_build_object(
 'tiles','https://basemaps.cartocdn.com/rastertiles/'||coalesce((select data->'map'->>'style' from public.catalog_settings where id=1),'voyager')||'/{z}/{x}/{y}{r}.png?key={apiKey}',
 'mapKey',(select data->'map'->>'apiKey' from public.catalog_settings where id=1))
where map_config='{}'::jsonb and coalesce((select data->'map'->>'apiKey' from public.catalog_settings where id=1),'')<>'';
create table if not exists saas_private.assets (
 path text primary key, site_id uuid not null references saas_private.sites(id),
 bytes integer not null check(bytes between 1 and 5242880), created_at timestamptz default now()
);
alter table saas_private.assets enable row level security;
revoke all on saas_private.assets from public,anon,authenticated;
grant select,insert,delete on saas_private.assets to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('business-images','business-images',true,5242880,array['image/png','image/jpeg'])
on conflict(id) do update set public=true,file_size_limit=5242880,allowed_mime_types=array['image/png','image/jpeg'];
-- Solo Edge escribe en el bucket. Lectura pública para logos/fotos comerciales.
do $$begin
 if to_regprocedure('public.saas_platform_v1(text,uuid,boolean,jsonb)') is null then
  alter function public.saas_platform_api(text,uuid,boolean,jsonb) rename to saas_platform_v1;
 end if;
end$$;
create or replace function public.saas_platform_api(p_action text,p_actor uuid,p_admin boolean,p_payload jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s saas_private.sites; r jsonb; cfg jsonb; path text;
begin
 if p_action='map_defaults' then
  if not p_admin or p_actor is null then raise exception 'Solo el creador';end if;
  update saas_private.settings set map_config=p_payload where id=1;
  insert into saas_private.audit(actor,operation) values(p_actor,'map_defaults');return '{}';
 end if;
 if p_action in ('preview_site','site_context','asset_reserve','asset_remove') then
  if p_actor is null then raise exception 'Inicia sesión';end if;
  select * into s from saas_private.sites where
   (id=nullif(p_payload->>'site_id','')::uuid or slug=p_payload->>'slug') and (owner_id=p_actor or p_admin) for update;
  if not found then raise exception 'No tienes acceso a este sitio';end if;
  if not p_admin and (not s.enabled or s.expires_at is null or s.expires_at<=now()) then raise exception 'Renueva la suscripción del sitio';end if;
  if p_action='preview_site' then
   select coalesce(jsonb_agg(to_jsonb(x)-'site_id'),'[]') into r from saas_private.products x where site_id=s.id and active;
   select map_config into cfg from saas_private.settings where id=1;
   return jsonb_build_object('id',s.id,'slug',s.slug,'config',s.config,'products',r,'map_defaults',cfg,'preview',true);
  elsif p_action='site_context' then
   return jsonb_build_object('owner_id',s.owner_id,'config',s.config);
  elsif p_action='asset_reserve' then
   path=s.owner_id::text||'/'||s.id::text||'/'||gen_random_uuid()::text||'.'||case when p_payload->>'mime'='image/png' then 'png' else 'jpg' end;
   if (select count(*) from saas_private.assets where site_id=s.id)>=100 or
      (select coalesce(sum(bytes),0) from saas_private.assets where site_id=s.id)+(p_payload->>'bytes')::int>52428800 then
    raise exception 'Límite de imágenes alcanzado (100 imágenes o 50 MB por negocio)';
   end if;
   insert into saas_private.assets values(path,s.id,(p_payload->>'bytes')::int,now());return jsonb_build_object('path',path);
  else
   delete from saas_private.assets where site_id=s.id and assets.path=p_payload->>'path';return '{}';
  end if;
 end if;
 if p_action='site_config' then
  cfg=p_payload->'config';
  if cfg->>'theme' is not null and cfg->>'theme' not in ('light','dark') then raise exception 'Tema inválido';end if;
  if cfg->>'primaryColor' is not null and cfg->>'primaryColor'!~'^#[0-9a-fA-F]{6}$' then raise exception 'Color inválido';end if;
  if cfg->>'accentColor' is not null and cfg->>'accentColor'!~'^#[0-9a-fA-F]{6}$' then raise exception 'Color inválido';end if;
  if cfg->>'mapMode' is not null and cfg->>'mapMode' not in ('shared','own') then raise exception 'Mapa inválido';end if;
 end if;
 r=public.saas_platform_v1(p_action,p_actor,p_admin,p_payload);
 if p_action='dashboard' then select map_config into cfg from saas_private.settings where id=1;
  r=r||jsonb_build_object('map_defaults',cfg);
 elsif p_action='public_site' then select map_config into cfg from saas_private.settings where id=1;
  r=r||jsonb_build_object('map_defaults',cfg);
 end if;
 return r;
end$$;
revoke all on function public.saas_platform_api(text,uuid,boolean,jsonb),public.saas_platform_v1(text,uuid,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.saas_platform_api(text,uuid,boolean,jsonb),public.saas_platform_v1(text,uuid,boolean,jsonb) to service_role;
commit;
