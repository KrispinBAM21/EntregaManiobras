-- Incremental: requiere el panel por negocio ya instalado. No repite los SQL anteriores.
begin;
create or replace function saas_private.check_store_design(cfg jsonb,p_site uuid) returns void language plpgsql security invoker set search_path='' as $$
declare p jsonb;n int;product_price int;seen text[]='{}';
begin
 if cfg->>'backgroundStyle' is not null and cfg->>'backgroundStyle' not in ('solid','mesh','stripes','image') then raise exception 'Fondo inválido';end if;
 foreach p in array array[cfg->'backgroundLight',cfg->'backgroundDark'] loop if p is not null and p#>>'{}'!~'^#[0-9a-fA-F]{6}$' then raise exception 'Color de fondo inválido';end if;end loop;
 if cfg->'preMenuEnabled' is not null and jsonb_typeof(cfg->'preMenuEnabled')<>'boolean' then raise exception 'Premenú inválido';end if;
 for p in select value from jsonb_each(cfg) where key in ('backgroundImage','backgroundImageDark','preMenuImage') loop if coalesce(p#>>'{}','')<>'' and p#>>'{}'!~'^https://' then raise exception 'Imagen de fondo o bienvenida inválida';end if;end loop;
 if jsonb_typeof(coalesce(cfg->'promotions','[]'))<>'array' or jsonb_array_length(coalesce(cfg->'promotions','[]'))>20 or jsonb_typeof(coalesce(cfg->'promotionTemplates','[]'))<>'array' or jsonb_array_length(coalesce(cfg->'promotionTemplates','[]'))>20 then raise exception 'Máximo 20 promociones y 20 plantillas por negocio';end if;
 for p in select value from jsonb_array_elements(coalesce(cfg->'promotions','[]')||coalesce(cfg->'promotionTemplates','[]')) loop
  if jsonb_typeof(p)<>'object' or coalesce(p->>'id','')!~'^[a-zA-Z0-9_-]{1,100}$' or length(coalesce(p->>'title','')) not between 1 and 100 or length(coalesce(p->>'text',''))>500 or coalesce(p->>'style','banner') not in ('banner','card','spotlight') or coalesce(p->>'image','')<>'' and p->>'image'!~'^https://' then raise exception 'Plantilla de promoción inválida';end if;
  if p->>'price' is not null then
   if (p->>'price')!~'^[0-9]+$' or (p->>'price')::numeric>2147483647 then raise exception 'Precio especial inválido';end if;
   select price into product_price from saas_private.products where site_id=p_site and id=nullif(p->>'productId','')::uuid;
   if not found or (p->>'price')::int>=product_price then raise exception 'Selecciona un producto de este negocio con precio especial menor al habitual';end if;
  elsif coalesce(p->>'productId','')<>'' and not exists(select 1 from saas_private.products where site_id=p_site and id=(p->>'productId')::uuid) then raise exception 'Producto de otro negocio';end if;
 end loop;
 for p in select value from jsonb_array_elements(coalesce(cfg->'promotions','[]')) loop
  if (p->>'id')=any(seen) then raise exception 'Promoción duplicada';end if;seen=array_append(seen,p->>'id');
  if jsonb_typeof(p->'active') is distinct from 'boolean' or nullif(p->>'startsAt','') is null or nullif(p->>'endsAt','') is null or not isfinite((p->>'startsAt')::timestamptz) or not isfinite((p->>'endsAt')::timestamptz) or (p->>'endsAt')::timestamptz<=(p->>'startsAt')::timestamptz then raise exception 'Fechas de promoción inválidas';end if;
 end loop;
end$$;
create or replace function saas_private.promotion_price(cfg jsonb,p_product uuid,p_base int) returns int language sql stable security invoker set search_path='' as $$
 select least(p_base,coalesce(min((p->>'price')::int),p_base)) from jsonb_array_elements(coalesce(cfg->'promotions','[]')) p
 where p->>'productId'=p_product::text and p->>'price' is not null and (p->>'active')::boolean=true and (p->>'startsAt')::timestamptz<=statement_timestamp() and (p->>'endsAt')::timestamptz>statement_timestamp();
$$;
-- Se conserva la función original y se sustituye solo el cálculo y la validación del diseño.
do $patch$declare definition text;old_price text := 'sub=sub+p.price*qty;rows=rows||jsonb_build_array';new_price text := 'p.price=saas_private.promotion_price(s.config,p.id,p.price);sub=sub+p.price*qty;rows=rows||jsonb_build_array';begin
 select pg_get_functiondef('public.saas_platform_v1(text,uuid,boolean,jsonb)'::regprocedure) into definition;
 if position(new_price in definition)=0 then
  if position(old_price in definition)=0 then raise exception 'Versión incompatible: no se encontró el cálculo de productos';end if;
  definition=replace(definition,old_price,new_price);
 end if;
 if position('perform saas_private.check_store_design(cfg,s.id);' in definition)=0 then
  if position('cfg=p_payload->''config'';' in definition)=0 then raise exception 'Versión incompatible: no se encontró la configuración';end if;
  definition=replace(definition,'cfg=p_payload->''config'';','cfg=p_payload->''config'';perform saas_private.check_store_design(cfg,s.id);');
 end if;
 execute definition;
end$patch$;
-- Configuración puede consultar el catálogo para elegir productos, sin consultar pedidos.
do $permissions$declare definition text;begin
 select pg_get_functiondef('public.saas_platform_api(text,uuid,boolean,jsonb)'::regprocedure) into definition;
 definition=replace(definition,'array[''orders'',''products'',''payments'',''reports'']','array[''orders'',''products'',''payments'',''reports'',''settings'']');
 execute definition;
end$permissions$;
revoke all on function saas_private.check_store_design(jsonb,uuid),saas_private.promotion_price(jsonb,uuid,int) from public,anon,authenticated;
grant execute on function saas_private.check_store_design(jsonb,uuid),saas_private.promotion_price(jsonb,uuid,int) to service_role;
commit;
