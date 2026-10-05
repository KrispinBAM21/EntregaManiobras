import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
const url=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!;
const origins=(Deno.env.get('ALLOWED_ORIGINS')||'https://krispinbam21.github.io').split(',').map(s=>s.trim());
const db=createClient(url,service,{auth:{persistSession:false}});
const publicActions=new Set(['plans','public_site','order','order_status']);
const userActions=new Set(['dashboard','create_site','invoice','prices','decision','site_config','product','site_orders','order_decision','site_access','order_payment_decision','subscribers','subscription_access']);
function plain(value:unknown,depth=0):void {
 if(depth>8)throw Error('Información demasiado extensa');
 if(typeof value==='string'&&(value.length>2000||/[<>\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)))throw Error('Texto inválido');
 if(typeof value==='number'&&!Number.isFinite(value))throw Error('Número inválido');
 if(Array.isArray(value)){if(value.length>100)throw Error('Demasiados elementos');for(const v of value)plain(v,depth+1)}
 else if(value&&typeof value==='object'){if(Object.keys(value).length>50)throw Error('Demasiados campos');for(const v of Object.values(value))plain(v,depth+1)}
}
async function digest(s:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,'0')).join('')}
async function rpc(action:string,actor:string|null,admin:boolean,payload:unknown){const {data,error}=await db.rpc('saas_platform_api',{p_action:action,p_actor:actor,p_admin:admin,p_payload:payload});if(error){if(error.code==='P0001')throw Error(error.message);console.error(JSON.stringify({event:'platform_db_failed',action,code:error.code}));throw Error('No se completó la operación. Revisa los registros de saas-platform.')}return data}
async function checkAccount(cipher:string,owner:string,slot:number,account:string){
 try{const bytes=Uint8Array.from(atob(Deno.env.get('GMAIL_TOKEN_ENCRYPTION_KEY')||''),c=>c.charCodeAt(0));if(bytes.length!==32)throw Error();const key=await crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['decrypt']);const [v,iv,data]=cipher.split('.');if(v!=='v1')throw Error();const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:Uint8Array.from(atob(iv),c=>c.charCodeAt(0)),additionalData:new TextEncoder().encode(owner+':'+slot+':account')},key,Uint8Array.from(atob(data),c=>c.charCodeAt(0)));if(new TextDecoder().decode(plain)!==account)throw Error();}
 catch{throw Error('La cuenta no coincide con la banca vinculada; vuelve a guardarla. Comprueba la clave de cifrado existente en Secrets.')}
}
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'',headers={'Content-Type':'application/json','Access-Control-Allow-Origin':origins.includes(origin)?origin:'','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(origin&&!origins.includes(origin))return reply({error:'Origen no autorizado'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply({error:'Solo POST'},405);
 try{
  const raw=await req.text();if(raw.length>32768)return reply({error:'Solicitud demasiado grande'},413);const b=JSON.parse(raw);plain(b);
  if(b.action==='notifications'){
   const secret=Deno.env.get('PLATFORM_WORKER_SECRET');if(!secret||secret.length<32||req.headers.get('authorization')!=='Bearer '+secret)return reply({error:'Acceso denegado'},401);
   const token=Deno.env.get('TELEGRAM_BOT_TOKEN');if(!token)throw Error('Configura el token del bot en Secrets');
   const {data:jobs,error}=await db.rpc('saas_notifications',{p_action:'claim'});if(error)throw Error('No se pudieron consultar notificaciones');let sent=0;
   for(const j of jobs){try{const r=await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:j.telegram_id,text:j.message}),signal:AbortSignal.timeout(10000)});const result=await r.json();if(!r.ok||!result.ok)continue;const ack=await db.rpc('saas_notifications',{p_action:'ack',p_payload:{id:j.id,token:j.token}});if(!ack.error)sent++}catch{console.error(JSON.stringify({event:'platform_telegram_retry'}))}}
   return reply({sent});
  }
  if(!publicActions.has(b.action)&&!userActions.has(b.action))return reply({error:'Acción no disponible'},400);
  const ip=req.headers.get('x-forwarded-for')?.split(',')[0]||'unknown';await rpc('rate',null,false,{key:await digest(ip)});
  let actor:string|null=null,admin=false;const auth=req.headers.get('authorization')||'';
  if(!publicActions.has(b.action)){
   const client=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
   const {data,error}=await client.auth.getUser();if(error||!data.user)return reply({error:'Inicia sesión'},401);actor=data.user.id;
   const role=await client.rpc('is_catalog_admin');if(role.error)throw Error('No se pudo verificar el acceso');admin=role.data===true;
  }
  const payload=b.payload||{};
  if(b.action==='site_config')for(const bank of payload.config?.banks||[]){const snapshot=await rpc('bank_snapshot',actor,admin,{site_id:payload.site_id,slot:bank.bank_slot});if(!snapshot?.cipher)throw Error('Vincula primero esa banca en el módulo de correos');await checkAccount(snapshot.cipher,snapshot.owner,bank.bank_slot,bank.account)}
  for(const field of ['logo','image']){const v=b.action==='site_config'?payload.config?.[field]:payload[field];if(v&&!/^https:\/\//.test(v))throw Error('Las imágenes deben usar URL HTTPS')}
  for(const x of payload.config?.social||[])if(!/^https:\/\//.test(x.url)||!['facebook','instagram','tiktok','x','website','whatsapp'].includes(x.type))throw Error('Red social inválida');
  if(payload.config?.tiles&&!/^https:\/\//.test(payload.config.tiles))throw Error('Usa tiles HTTPS');
  if(b.action==='order'||b.action==='order_status'){if(!/^[0-9a-f-]{36}$/i.test(payload.access_token||''))throw Error('Código de acceso inválido');payload.access_hash=await digest(payload.access_token);delete payload.access_token}
  return reply({data:await rpc(b.action,actor,admin,payload)});
 }catch(e){return reply({error:e instanceof Error?e.message:'Solicitud inválida'},400)}
});
