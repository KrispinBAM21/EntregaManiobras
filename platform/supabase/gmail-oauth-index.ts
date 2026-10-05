// Supabase Edge Function: gmail-oauth. Disable gateway Verify JWT;
// POST authenticates with getUser; GET /callback validates single-use OAuth state.
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

// IMAP password mode: fixed Gmail host, verified TLS, read-only mailbox, no socket logs.
import { ImapFlow } from 'npm:imapflow@2.2.5';
import { simpleParser } from 'npm:mailparser@3.9.35';
import { Buffer } from 'node:buffer';
const IMAP_PREFIX='imap-app-v1:';
function imapCredentials(email:unknown,password:unknown){
 const user=typeof email==='string'?email.trim().toLowerCase():'';
 const pass=typeof password==='string'?password.replace(/ /g,''):'';
 if(!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(gmail\.com|googlemail\.com)$/.test(user)||! /^[a-z]{16}$/i.test(pass))throw new SafeError('Introduce un Gmail válido y su contraseña de aplicación de 16 letras.');
 return {email:user,password:pass};
}
async function connectImap(credentials:{email:string,password:string}){
 const client=new ImapFlow({host:'imap.gmail.com',port:993,secure:true,auth:{user:credentials.email,pass:credentials.password},logger:false,logRaw:false,disableAutoIdle:true,disableCompression:true,connectionTimeout:12000,greetingTimeout:10000,socketTimeout:15000,tls:{rejectUnauthorized:true}});
 client.on('error',()=>{});const deadline=setTimeout(()=>client.close(),30000);
 let validity='';try {await client.connect();const mailbox=await client.mailboxOpen('INBOX',{readOnly:true});validity=String(mailbox.uidValidity);}
 catch{clearTimeout(deadline);client.close();throw new SafeError('Gmail rechazó la conexión IMAP o no respondió. Revisa el correo, la contraseña de aplicación y los permisos IMAP de tu cuenta.',400);}
 return {client,validity,close:async()=>{clearTimeout(deadline);client.close();}};
}
async function imapMessage(row:any){
 if(!row?.emailId||!/^\d+$/.test(row.emailId))throw new SafeError('Gmail no devolvió el identificador global del aviso.',502);
 const id=BigInt(row.emailId).toString(16);
 const parsed=await simpleParser(row.source,{skipHtmlToText:true,skipTextToHtml:true,skipImageLinks:true});
 const headers=(parsed.headerLines||[]).map((h:any)=>{const line=h.line.replace(/\r?\n[ \t]+/g,' '),colon=line.indexOf(':');return {name:line.slice(0,colon),value:line.slice(colon+1).trim()}});
 const parts=[];for(const [mimeType,body] of [['text/plain',parsed.text],['text/html',parsed.html]])if(typeof body==='string'&&body.length<=450000)parts.push({mimeType,body:{data:Buffer.from(body,'utf8').toString('base64url')}});
 return {id,internalDate:String(new Date(row.internalDate).getTime()),payload:{mimeType:'multipart/alternative',headers,parts}};
}
async function connectionReader(secret:string,email:string,onClose:(close:()=>Promise<void>)=>void){
 if(!secret.startsWith(IMAP_PREFIX))return google;
 let credentials;try{const obj=JSON.parse(secret.slice(IMAP_PREFIX.length));credentials=imapCredentials(obj.email,obj.password);if(credentials.email!==email.toLowerCase())throw 0}catch{throw new SafeError('La conexión IMAP guardada no es válida. Vuelve a conectarla.',409)}
 const session=await connectImap(credentials);onClose(session.close);const client=session.client;const messages=new Map<string,any>();
 return async(url:string,init:RequestInit={})=>{
  const u=new URL(url);
  if(u.hostname==='oauth2.googleapis.com')return {access_token:'imap-server-only'};
  if(u.pathname.endsWith('/profile'))return {emailAddress:credentials.email};
  if(u.pathname.endsWith('/messages')){
   const cursor=u.searchParams.get('pageToken');let before=Number.MAX_SAFE_INTEGER;
   if(cursor){if(!/^imap1:\d{1,20}:\d{1,10}$/.test(cursor))throw new SafeError('Página IMAP inválida. Reinicia la consulta.');const [,valid,uid]=cursor.split(':');if(valid!==session.validity)throw new SafeError('Gmail cambió la numeración de correos. Reinicia la consulta.',409);before=Number(uid);}
   const found=await client.search({gmraw:'from:noreply@hey.inc subject:"Recepción de transferencia nacional SPEI" newer_than:7d -in:spam -in:trash'},{uid:true});
   const uids=(Array.isArray(found)?found:[]).filter((uid:number)=>uid<before).sort((a:number,b:number)=>b-a);const page=uids.slice(0,20);
   // Sequential operations avoid IMAP command queue deadlocks; at most 20 small messages.
   for(const uid of page){const row:any=await client.fetchOne(uid,{size:true,internalDate:true},{uid:true});if(!row||row.size>1000000)continue;
    const full:any=await client.fetchOne(uid,{source:{start:0,maxLength:1000001},internalDate:true},{uid:true});if(!full?.source||full.source.length>1000000)continue;
    const message=await imapMessage(full);messages.set(message.id,message);
   }
   return {messages:[...messages.keys()].map(id=>({id})),nextPageToken:uids.length>page.length&&page.length?'imap1:'+session.validity+':'+page[page.length-1]:undefined};
  }
  const id=u.pathname.split('/').pop()||'';if(messages.has(id))return messages.get(id);
  throw new SafeError('Consulta IMAP no permitida.',400);
 };
}

const BANKS = ['Hey Banco','Spin by OXXO','Klar','Bitso','Ualá','Stori','albo','Mifel'];
const encoder = new TextEncoder();
class SafeError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const from64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const random = () => b64(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const stateHash = async (value: string) => Array.from(await digest(value), x => x.toString(16).padStart(2,'0')).join('');
const challenge = async (value: string) => b64(await digest(value)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
async function encryptionKey() {
  let bytes: Uint8Array;
  try { bytes = from64(Deno.env.get('GMAIL_TOKEN_ENCRYPTION_KEY') || ''); }
  catch { throw new SafeError('Configura GMAIL_TOKEN_ENCRYPTION_KEY: Base64 de 32 bytes.',503); }
  if (bytes.length !== 32) throw new SafeError('Configura GMAIL_TOKEN_ENCRYPTION_KEY: Base64 de 32 bytes.',503);
  return crypto.subtle.importKey('raw', new Uint8Array(bytes).buffer, 'AES-GCM', false, ['encrypt','decrypt']);
}
async function encrypt(value: string, aad: string, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(aad)},key,encoder.encode(value));
  return 'v1.'+b64(iv)+'.'+b64(new Uint8Array(data));
}
async function decrypt(value: string, aad: string, key: CryptoKey) {
  const [version,iv,data] = value.split('.');
  if(version !== 'v1' || !iv || !data) throw new SafeError('No se pudo leer la conexión. Revisa la clave de cifrado.',503);
  try { return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:from64(iv),additionalData:encoder.encode(aad)},key,from64(data))); }
  catch { throw new SafeError('No se pudo leer la conexión. Revisa la clave de cifrado.',503); }
}
async function google(url: string, init: RequestInit = {}) {
  const response = await fetch(url,{...init,signal:AbortSignal.timeout(15000)});
  let data: any;
  try { data = await response.json(); } catch { throw new SafeError('Google no respondió correctamente. Intenta de nuevo.',502); }
  if(!response.ok) {
    if(data.error === 'invalid_grant') throw new SafeError('La autorización venció o fue revocada. Vuelve a conectar Gmail.',409);
    if(data.error === 'invalid_client') throw new SafeError('Revisa GMAIL_CLIENT_ID y GMAIL_CLIENT_SECRET en Supabase.',503);
    if(response.status === 403) throw new SafeError('Gmail rechazó el acceso. Revisa Gmail API, el permiso y los usuarios de prueba.',403);
    throw new SafeError('No se pudo completar la consulta con Google.',502);
  }
  return data;
}
async function body(req: Request) {
  const reader = req.body?.getReader();
  if(!reader) throw new SafeError('Solicitud vacía.');
  const chunks: Uint8Array[]=[]; let total=0;
  while(true) { const {value,done}=await reader.read(); if(done)break;
    total+=value.length; if(total>16384){await reader.cancel();throw new SafeError('Solicitud demasiado grande.',413)} chunks.push(value);
  }
  const bytes=new Uint8Array(total);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length}
  try { const data=JSON.parse(new TextDecoder().decode(bytes));if(!data || typeof data!=='object' || Array.isArray(data))throw 0;return data; }
  catch { throw new SafeError('Solicitud inválida.'); }
}


// Solo reconoce el aviso recibido de Hey del formato proporcionado.
// Nunca convierte un correo detectado en un pago aprobado.
function decodeEntities(value: string) {
  const named: Record<string,string>={nbsp:' ',ensp:' ',emsp:' ',thinsp:' ',dollar:'$',colon:':',sol:'/',amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',
    aacute:'á',eacute:'é',iacute:'í',oacute:'ó',uacute:'ú',ntilde:'ñ',uuml:'ü',
    Aacute:'Á',Eacute:'É',Iacute:'Í',Oacute:'Ó',Uacute:'Ú',Ntilde:'Ñ',Uuml:'Ü',
    ldquo:'"',rdquo:'"',lsquo:"'",rsquo:"'"};
  return value.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-zA-Z]+);/gi,(entity,code)=>{
    if(code[0]!=='#')return named[code]??entity;
    const n=code[1].toLowerCase()==='x'?parseInt(code.slice(2),16):Number(code.slice(1));
    return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):' ';
  });
}
function mimeHeader(value: string) {
  return value.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,(_,charset,encoding,data)=>{
    try {
      const bytes=encoding.toLowerCase()==='b'?from64(data):Uint8Array.from(
        data.replaceAll('_',' ').replace(/=([0-9a-f]{2})/gi,(_:string,hex:string)=>String.fromCharCode(parseInt(hex,16))),
        (c:string)=>c.charCodeAt(0));
      return new TextDecoder(charset).decode(bytes);
    } catch{return ''}
  });
}
function htmlText(value: string) {
  const stripped=value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ')
    .replace(/<(br|\/p|\/div|\/tr|\/td|\/h[1-6])\b[^>]*>/gi,'\n')
    .replace(/<[^>]*>/g,' ');
  return decodeEntities(stripped).replace(/[\u200b-\u200d\ufeff]/g,'')
    .replace(/[ \t\u00a0\u202f]+/g,' ').replace(/\n\s*\n/g,'\n').trim();
}
function messageText(payload: any, depth=0): string {
  if(depth>12)return '';
  if(payload?.filename)return ''; // No descarga ni procesa adjuntos.
  const mime=payload?.mimeType;
  if(['text/plain','text/html'].includes(mime) && typeof payload?.body?.data==='string'){
    const encoded=payload.body.data;if(encoded.length>600000)return '';
    try {
      const bytes=from64(encoded.replaceAll('-','+').replaceAll('_','/'));
      const contentType=String((payload.headers||[]).find((h:any)=>String(h.name).toLowerCase()==='content-type')?.value||'');
      const declared=contentType.match(/charset\s*=\s*["']?([a-z0-9_-]+)/i)?.[1];
      let value:string;
      if(declared){try{value=new TextDecoder(declared).decode(bytes)}catch{value=new TextDecoder().decode(bytes)}}
      else {try{value=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{value=new TextDecoder('windows-1252').decode(bytes)}}
      return mime==='text/html'?htmlText(value):value;
    }catch{return ''}
  }
  const parts=Array.isArray(payload?.parts)?payload.parts:[];
  // Preferir HTML: las etiquetas de tabla conservan separaciones de campos.
  const html=parts.find((p:any)=>p.mimeType==='text/html'&&!p.filename);
  if(html)return messageText(html,depth+1);
  return parts.slice(0,30).map((p:any)=>messageText(p,depth+1)).join('\n').slice(0,450000);
}
function parseHey(message: any) {
  const headers=Array.isArray(message?.payload?.headers)?message.payload.headers:[];
  const header=(name:string)=>String(headers.find((h:any)=>String(h.name).toLowerCase()===name)?.value||'');
  const from=mimeHeader(header('from')).trim().toLowerCase();
  if(!/^(?:[^<>]*<)?noreply@hey\.inc>?$/.test(from))return null;
  if(mimeHeader(header('subject')).normalize('NFC').replace(/\s+/g,' ').trim()!=='Recepción de transferencia nacional SPEI')return null;
  const text=messageText(message.payload).normalize('NFC').replace(/[\u200b-\u200d\ufeff]/g,'');
  if(!/Recibiste\s+una\s+transferencia\s+nacional\s+SPEI/i.test(text))return null;
  const amount=text.match(/Cantidad\s*:?\s*\$\s*((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})(?!\d)/i);
  const track=text.match(/Clave\s+rastreo\s*:?\s*["'“”‘’]*\s*([A-Za-z0-9]{10,80})/i);
  const dest=text.match(/terminaci[oó]n\s*[:\s]*[*\s]*(\d{4})(?!\d)/i);
  const reference=text.match(/Referencia\s*:?\s*["'“”‘’]*\s*([0-9]{1,30})/i);
  const date=text.match(/Fecha de aplicaci[oó]n\s*:?\s*(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2})/i);
  if(!amount||!track||!dest||!date)return null;
  const cents=Number(amount[1].replaceAll(',','').replace('.',''));
  const received=Number(message.internalDate);
  if(!Number.isSafeInteger(cents)||cents<=0||cents>10000000000||!Number.isSafeInteger(received)||received<=0)return null;
  // La fecha del banco queda literal: no se inventa una zona horaria.
  return {message_id:message.id,amount_cents:cents,destination_last4:dest[1],tracking_key:track[1],reference:reference?.[1]||'',application_date:date[1].replace(/\s+/g,' '),received_at:new Date(received).toISOString()};
}

function heyPaymentProof(message:any,movement:any){
 const headers=Array.isArray(message?.payload?.headers)?message.payload.headers:[];
 const auth=headers.filter((h:any)=>String(h.name).toLowerCase()==='authentication-results').map((h:any)=>String(h.value));
 const authentication=auth.find((value:string)=>/^\s*mx\.google\.com\s*;/i.test(value))||'';
 const authenticated=/dkim=pass\b[\s\S]*?header\.(?:i|d)=@?(?:[A-Za-z0-9_-]+\.)*hey\.inc\b/i.test(authentication);
 const text=messageText(message.payload).normalize('NFC');
 // Only the beneficiary account field is evidence of the recipient; introductory wording is ambiguous.
 const recipient=text.match(/Nombre\s*:?\s*[*\s]*(\d{4})(?!\d)/i);
 return {message_id:movement.message_id,tracking_key:movement.tracking_key,authenticated,recipient_last4:recipient?.[1]||''};
}

async function validWorkerSecret(req:Request){
 const expected=Deno.env.get('GMAIL_WORKER_SECRET')||'',received=req.headers.get('x-worker-secret')||'';
 if(expected.length<32||received.length>256||!received)return false;
 const encoder=new TextEncoder(),hashes=await Promise.all([expected,received].map(value=>crypto.subtle.digest('SHA-256',encoder.encode(value))));
 const a=new Uint8Array(hashes[0]),b=new Uint8Array(hashes[1]);let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]^b[i];return difference===0;
}

Deno.serve(async req => {
  const project = Deno.env.get('SUPABASE_URL') || '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const clientId = Deno.env.get('GMAIL_CLIENT_ID') || '';
  const clientSecret = Deno.env.get('GMAIL_CLIENT_SECRET') || '';
  const redirect = project+'/functions/v1/gmail-oauth/callback';
  const site = Deno.env.get('PUBLIC_SITE_URL') || 'https://krispinbam21.github.io/EntregaManiobras/';
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') || 'https://krispinbam21.github.io').split(',').map(x=>x.trim()).filter(Boolean);
  const origin=req.headers.get('origin')||'';
  const headers: Record<string,string> = {'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
    'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
  if(allowed.includes(origin))headers['Access-Control-Allow-Origin']=origin;
  const reply=(data: unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
  const callback = new URL(req.url).pathname.endsWith('/gmail-oauth/callback');
  let telegramReturn:number|null=null;let closeImap:(()=>Promise<void>)|null=null;
  function finish(ok: boolean, message: string) {
    if(telegramReturn)return new Response(null,{status:303,headers:{Location:'https://t.me/Gestor_Pagos_Mzo_bot','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
    let destination: URL;
    try { destination = new URL('gmail-conexion.html', site.endsWith('/')?site:site+'/'); }
    catch { return reply({error:'Revisa PUBLIC_SITE_URL.'},503); }
    if(destination.protocol!=='https:' || destination.username || destination.password || !allowed.includes(destination.origin))
      return reply({error:'Revisa PUBLIC_SITE_URL y ALLOWED_ORIGINS.'},503);
    destination.searchParams.set('gmail',ok?'conectado':'error');
    if(!ok)destination.searchParams.set('motivo',message);
    return new Response(null,{status:303,headers:{Location:destination.href,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  }
  if(origin && !allowed.includes(origin))return reply({error:'Origen no permitido.'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if((callback && req.method!=='GET') || (!callback && req.method!=='POST'))return reply({error:'Método no permitido.'},405);
  try {
    if(!project || !anon || !service)throw new SafeError('Faltan secretos de Gmail o Supabase.',503);
    const key=await encryptionKey();
    const db=createClient(project,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const rpc=async (action: string, actor: string|null, payload: unknown={})=>{
      const {data,error}=await db.rpc('maniobras_gmail_api',{p_action:action,p_actor:actor,p_payload:payload});
      if(error){
        if(['PGRST202','42P01','42883'].includes(error.code))throw new SafeError('Ejecuta el SQL nuevo de conexión Gmail y revisa el despliegue.',503);
        if(error.message==='Demasiados intentos')throw new SafeError('Espera diez minutos antes de iniciar otra conexión.',429);
        throw new SafeError('No se pudo guardar o consultar la conexión Gmail.',500);
      }
      return data;
    };
    if(callback) {
      const params=new URL(req.url).searchParams;const state=params.get('state')||'';
      if(!/^[A-Za-z0-9_-]{43}$/.test(state))throw new SafeError('Autorización inválida. Inicia la conexión desde el sitio.');
      const pending=await rpc('claim',null,{state_hash:await stateHash(state)});
      if(pending?.telegram_id)telegramReturn=Number(pending.telegram_id);
      if(!pending)throw new SafeError('La conexión venció o ya fue utilizada. Vuelve a conectar Gmail.');
      if(params.has('error'))throw new SafeError('No autorizaste el acceso a Gmail. Puedes intentarlo de nuevo.');
      const code=params.get('code')||'';if(!code || code.length>4096)throw new SafeError('Google no devolvió una autorización válida.');
      const aad=pending.user_id+':'+pending.slot;
      const verifier=await decrypt(pending.verifier_cipher,aad,key);
      const token=await google('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,code,code_verifier:verifier,grant_type:'authorization_code',redirect_uri:redirect})});
      if(typeof token.refresh_token!=='string' || !token.refresh_token)throw new SafeError('Google no devolvió autorización continua. Revoca el permiso de esta aplicación en Google y vuelve a conectar.');
      if(!String(token.scope||'').split(' ').includes('https://www.googleapis.com/auth/gmail.readonly'))throw new SafeError('Debes autorizar el permiso de lectura de Gmail.');
      const profile=await google('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:'Bearer '+token.access_token}});
      if(typeof profile.emailAddress!=='string')throw new SafeError('Google no identificó el correo.');
      await rpc('complete',pending.user_id,{slot:pending.slot,generation:pending.generation,email:profile.emailAddress,refresh_cipher:await encrypt(token.refresh_token,aad,key)});
      if(telegramReturn){try{await fetch('https://api.telegram.org/bot'+Deno.env.get('TELEGRAM_BOT_TOKEN')+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:telegramReturn,text:'Gmail conectado: '+profile.emailAddress+'\nRegresa al bot y elige Configurar banca. No compartas tu contraseña.'})})}catch{}}
      return finish(true,'');
    }
    const input=await body(req);
    const worker=await validWorkerSecret(req);
    if(req.headers.has('x-worker-secret')&&!worker)throw new SafeError('Acceso de verificador inválido.',401);
    if(worker&&input.action==='worker'){
      const claimed=await db.rpc('maniobras_payment_worker_claim');
      if(claimed.error)throw new SafeError('Instala pagos-worker.sql.',503);
      const jobs=Array.isArray(claimed.data)?claimed.data:[];
      const results=await Promise.all(jobs.map(async(job:any)=>{
        let next=job.page_token||null,error='',approved=0;
        try{
          const response=await fetch(project+'/functions/v1/gmail-oauth',{method:'POST',signal:AbortSignal.timeout(45000),headers:{'Content-Type':'application/json','x-worker-secret':Deno.env.get('GMAIL_WORKER_SECRET')!},body:JSON.stringify({action:'scan',actor:job.actor,slot:job.slot,run_token:job.run_token,...(job.page_token?{page_token:job.page_token}:{})})});
          const data=await response.json();
          if(!response.ok){error='HTTP '+response.status;if(response.status!==429)next=null}
          else{next=data.next_page_token||null;error=data.verification_error||data.telegram_error||'';approved=Array.isArray(data.approved)?data.approved.length:0;
            if(job.telegram_id){const fresh=await db.rpc('maniobras_telegram_api',{p_action:'new_movements',p_telegram:job.telegram_id,p_payload:{}});if(!fresh.error&&fresh.data?.length){const notified=await fetch('https://api.telegram.org/bot'+Deno.env.get('TELEGRAM_BOT_TOKEN')+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:job.telegram_id,text:'Movimientos recibidos en tu correo:\n'+fresh.data.map((m:any)=>'$'+Number(m.amount).toFixed(2)+' MXN · Referencia '+(m.reference||'sin referencia')).join('\n')})});const notifyResult=await notified.json();if(!notified.ok||notifyResult.ok!==true)throw Error('No se pudo enviar aviso de movimientos');await db.rpc('maniobras_telegram_api',{p_action:'ack_movements',p_telegram:job.telegram_id,p_payload:{ids:fresh.data.map((m:any)=>m.id)}})}}
          }
        }catch{error='No se pudo completar la consulta periódica'}
        const saved=await db.rpc('maniobras_payment_worker_finish',{p_actor:job.actor,p_slot:job.slot,p_run:job.run_token,p_cursor:next,p_error:error.slice(0,200)});
        return {slot:job.slot,approved,error:error||(saved.error?'No se pudo guardar el resultado':'')};
      }));
      console.log('PAGOS_WORKER',{checked:results.length,approved:results.reduce((n:any,r:any)=>n+r.approved,0),errors:results.filter((r:any)=>r.error).map((r:any)=>r.error)});
      return reply({ok:!results.some((r:any)=>r.error),checked:results.length,results});
    }
    const authorization=req.headers.get('authorization')||'';
    const authClient=createClient(project,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
    let actor:string;let telegramOwner=false;
    const internal=Deno.env.get('TELEGRAM_INTERNAL_SECRET')||'';
    const fromTelegram=req.headers.get('x-telegram-secret');
    const telegramRequest=!!fromTelegram&&internal.length>=32&&fromTelegram===internal;
    if(fromTelegram&&!telegramRequest)throw new SafeError('Acceso de Telegram inválido.',401);
    if(telegramRequest){
      if(!['list','begin','save_bank','disconnect','test','scan','movements'].includes(input.action)||!Number.isSafeInteger(input.telegram_id))throw new SafeError('Solicitud de Telegram inválida.',403);
      const access=await db.rpc('maniobras_telegram_api',{p_action:input.action==='list'?'account':'access',p_telegram:input.telegram_id,p_payload:{}});
      if(access.error||!access.data?.user_id)throw new SafeError(access.error?.message||'Crea tu cuenta o renueva la suscripción.',403);
      actor=access.data.user_id;telegramOwner=access.data.owner===true;
    }else if(worker){
      if(input.action!=='scan'||typeof input.actor!=='string'||typeof input.run_token!=='string')throw new SafeError('Acción de verificador inválida.',403);
      const target=await db.rpc('maniobras_payment_worker_target',{p_actor:input.actor,p_slot:input.slot,p_run:input.run_token});
      if(target.error||target.data!==true)throw new SafeError('Banca no autorizada para consulta periódica.',403);
      actor=input.actor;
    }else{
      if(!/^Bearer\s+\S+$/i.test(authorization))throw new SafeError('Inicia sesión en tu sitio.',401);
      const {data:identity,error}=await authClient.auth.getUser();
      if(error||!identity.user||identity.user.is_anonymous)throw new SafeError('Inicia sesión con tu cuenta del sitio.',401);
      actor=identity.user.id;
      if(['list','begin','connect_imap','save_bank','test','scan','movements'].includes(input.action)){
        const access=await authClient.rpc('maniobras_bot_web_access');
        if(access.error)throw new SafeError('Instala bot-panel-web.sql para habilitar acceso desde la web.',503);
        if(access.data!==true)throw new SafeError('Tu suscripción no está activa. Paga o renueva desde el panel del bot.',403);
      }
    }
    let bankPolicy:Record<string,{enabled?:boolean,visible?:boolean,removed?:boolean}>={},ownerBankAccess=telegramOwner;
    if(!telegramRequest&&!worker&&['list','begin','connect_imap','save_bank','test','scan','movements'].includes(input.action)){
      const owner=await authClient.rpc('is_catalog_admin');ownerBankAccess=!owner.error&&owner.data===true;
    }
    if(!worker&&['list','begin','connect_imap','save_bank','test','scan','movements'].includes(input.action)){
      const config=await db.from('catalog_settings').select('data').eq('id',1).maybeSingle();
      if(config.error)throw new SafeError('No se pudo consultar la disponibilidad de bancas.',503);
      bankPolicy=config.data?.data?.botSubscription?.bankCatalog||{};
    }
    const bankEnabled=(bank:string)=>bankPolicy[bank]?.enabled!==false&&bankPolicy[bank]?.removed!==true;
    const bankVisible=(bank:string)=>bankEnabled(bank)&&bankPolicy[bank]?.visible!==false;
    if(input.action==='list')return reply({connections:await rpc('list',actor),banks:ownerBankAccess?BANKS:BANKS.filter(bankVisible),bank_policy:bankPolicy});
    if(!ownerBankAccess&&!worker&&['begin','connect_imap','save_bank','test','scan','movements'].includes(input.action)){
      const rows=await rpc('list',actor),row=rows.find((c:any)=>c.slot===input.slot),bank=input.action==='save_bank'?input.bank:row?.bank;
      if(typeof bank!=='string'||!bankEnabled(bank))throw new SafeError('Esta banca está desactivada o retirada del bot. Elige otra banca.',403);
      if(input.action==='save_bank'&&!bankVisible(bank)&&row?.bank!==bank)throw new SafeError('Esta banca no está disponible para nuevas conexiones.',403);
    }

    if(['business_banks','publish_banks','delete_business_bank'].includes(input.action)) {
      const {data:owner,error:ownerError}=await authClient.rpc('is_catalog_admin');
      if(ownerError || owner!==true)throw new SafeError('Solo el propietario puede publicar bancas del negocio.',403);
      const bankRpc=async(action:string,payload:unknown={})=>{
        const {data,error}=await db.rpc('maniobras_business_banks_api',{p_action:action,p_actor:actor,p_payload:payload});
        if(error){
          console.error('ERROR_BANCAS', {action,code:error.code,message:error.message,hint:error.hint});
          if(error.code==='21000')throw new SafeError('No se pudo guardar la banca: '+String(error.message||'La consulta devolvió más filas de las esperadas').slice(0,300)+' (21000). Revisa ERROR_BANCAS en Logs de gmail-oauth.',400);
          if(['PGRST202','42883','42P01'].includes(error.code))throw new SafeError('Falta instalar banca-publica-referencias.sql o actualizar la caché del esquema.',503);
          if(error.code==='42501')throw new SafeError('Faltan permisos internos para administrar bancas (42501). Revisa los GRANT del SQL de bancas.',403);
          const known=['La banca cambió','Guarda la banca','Guarda antes el negocio','Cuenta inválida','Datos inválidos','Espacio inválido'];
          throw new SafeError(known.includes(error.message)?error.message+'; actualiza la lista e intenta nuevamente.':'No se pudo '+(({publish:'publicar las bancas',list:'consultar las bancas',account:'leer la banca'} as Record<string,string>)[action]||'completar la operación')+'. Código: '+String(error.code||'sin código').replace(/[^A-Z0-9]/gi,''),400);
        }
        return data;
      };
      if(input.action==='business_banks')return reply({banks:await bankRpc('list')});
      if(input.action==='delete_business_bank'){
        if(!Number.isInteger(input.slot)||input.slot<1||input.slot>3)throw new SafeError('Selecciona una banca válida.');
        const {error}=await db.from('maniobras_gmail_connections').update({bank:null,account_type:null,account_cipher:null,last4:null}).eq('user_id',actor).eq('slot',input.slot);
        if(error)throw new SafeError('No se pudo eliminar la banca. Código: '+String(error.code||'sin código').replace(/[^A-Z0-9]/gi,''),400);
        return reply({ok:true});
      }

      if(!Array.isArray(input.banks)||input.banks.length>3||typeof input.reference_enabled!=='boolean')throw new SafeError('Selecciona hasta tres bancas.');
      const selected=[];const used=new Set();
      for(const item of input.banks){
        if(!Number.isInteger(item.slot)||item.slot<1||item.slot>3||used.has(item.slot)||typeof item.beneficiary!=='string'||item.beneficiary.length>100||/[<>\x00-\x1f]/.test(item.beneficiary))throw new SafeError('Datos de banca inválidos.');
        used.add(item.slot);
        const connection=await bankRpc('account',{slot:item.slot});
        if(!connection?.account_cipher)throw new SafeError('Guarda primero la cuenta o CLABE de esa banca.');
        const account=await decrypt(connection.account_cipher,actor+':'+item.slot+':account',key);
        if(!/^\d{8,20}$/.test(account))throw new SafeError('Vuelve a guardar la cuenta de esa banca.');
        selected.push({slot:item.slot,generation:connection.generation,account_cipher:connection.account_cipher,bank:connection.bank,account_type:connection.account_type,last4:connection.last4,account,beneficiary:item.beneficiary.trim()});
      }
      await bankRpc('publish',{banks:selected,reference_enabled:input.reference_enabled});
      return reply({ok:true,banks:await bankRpc('list')});
    }

    const slot=input.slot;
    if(!Number.isInteger(slot) || slot<1 || slot>3)throw new SafeError('Selecciona uno de los tres espacios.');
    if(input.action==='connect_imap') {
      if(telegramRequest||worker)throw new SafeError('Conecta la contraseña desde el formulario privado del sitio.',403);
      if(input.consent!==true)throw new SafeError('Confirma la autorización de lectura de correos.');
      const credentials=imapCredentials(input.email,input.password);
      const operation=async(action:string,payload:unknown)=>{const {data,error}=await db.rpc('maniobras_imap_connection',{p_action:action,p_actor:actor,p_payload:payload});if(error)throw new SafeError(error.message?.startsWith('Espera 30')?error.message:['Guarda primero la banca','La banca cambió durante la prueba'].includes(error.message)?error.message:'Instala gmail-imap.sql o revisa la configuración de la banca.',error.message?.startsWith('Espera 30')?429:400);return data};
      const prior=await operation('attempt',{slot});const session=await connectImap(credentials);closeImap=session.close;
      await operation('complete',{slot,generation:prior.generation,account_cipher:prior.account_cipher,email:credentials.email,cipher:await encrypt(IMAP_PREFIX+JSON.stringify(credentials),actor+':'+slot,key)});
      return reply({ok:true,email:credentials.email,message:'Conexión IMAP comprobada y guardada cifrada. Ya puedes consultar movimientos; esta prueba no confirma pagos.'});
    }
    if(input.action==='begin') {
      if(!clientId||!clientSecret)throw new SafeError('Configura OAuth o elige contraseña de aplicación.',503);
      const state=random(),verifier=random();
      await rpc('begin',actor,{slot,state_hash:await stateHash(state),verifier_cipher:await encrypt(verifier,actor+':'+slot,key)});
      if(telegramRequest){const saved=await db.from('maniobras_gmail_oauth_states').update({telegram_id:input.telegram_id}).eq('state_hash',await stateHash(state));if(saved.error)throw new SafeError('No se pudo iniciar la conexión desde Telegram.');}
      const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search=new URLSearchParams({client_id:clientId,redirect_uri:redirect,response_type:'code',scope:'https://www.googleapis.com/auth/gmail.readonly',
        access_type:'offline',prompt:'consent select_account',state,code_challenge:await challenge(verifier),code_challenge_method:'S256'}).toString();
      return reply({url:url.href});
    }
    if(input.action==='save_bank') {
      if(!BANKS.includes(input.bank) || !['clabe','account'].includes(input.account_type))throw new SafeError('Selecciona un banco y tipo de cuenta válidos.');
      const account=typeof input.account==='string'?input.account.replaceAll(' ',''):'';
      if(!/^\d{8,20}$/.test(account) || (input.account_type==='clabe' && account.length!==18))throw new SafeError('La CLABE debe tener 18 dígitos; la cuenta, entre 8 y 20.');
      if(input.account_type==='clabe') {
        const weights=[3,7,1];const sum=Array.from(account.slice(0,17),(c,i)=>Number(c)*weights[i%3]%10).reduce((a,b)=>a+b,0);
        if((10-sum%10)%10!==Number(account[17]))throw new SafeError('El dígito verificador de la CLABE no coincide. Revisa el número.');
      }
      await rpc('save_bank',actor,{slot,bank:input.bank,account_type:input.account_type,last4:account.slice(-4),account_cipher:await encrypt(account,actor+':'+slot+':account',key)});
      return reply({ok:true});
    }
    if(input.action==='disconnect'){await rpc('disconnect',actor,{slot});return reply({ok:true})}
    if(['scan','movements'].includes(input.action)) {
      const movementRpc=async(action:string,payload:unknown={})=>{
        const {data,error}=await db.rpc('maniobras_gmail_movements_api',{p_action:action,p_actor:actor,p_payload:payload});
        if(error){
          if(['PGRST202','42P01','42883'].includes(error.code))throw new SafeError('Ejecuta solamente el SQL nuevo gmail-movimientos.sql.',503);
          if(error.message==='Espera 30 segundos')throw new SafeError(error.message,429);
          if(error.message==='Configura Hey Banco y su cuenta')throw new SafeError(error.message,400);
          if(error.message==='Conexión cambió durante la consulta')throw new SafeError('La conexión cambió. Consulta nuevamente.',409);
          throw new SafeError('No se pudo consultar o guardar los movimientos.',500);
        }return data;
      };
      const withCandidates=async(rows:any[])=>{
        const {data:candidates,error}=await db.rpc('maniobras_movement_candidates',{p_actor:actor,p_slot:slot});
        if(error)return rows; // El lector anterior sigue funcionando antes de instalar la migración nueva.
        return rows.map(row=>({...row,candidate_folio:(candidates||[]).find((match:any)=>match.movement_id===row.id)?.folio||''}));
      };
      if(input.action==='movements')return reply({movements:await withCandidates(await movementRpc('list',{slot}))});
      const connection=await movementRpc('start',{slot});
      const refresh=await decrypt(connection.refresh_cipher,actor+':'+slot,key);
      const reader=await connectionReader(refresh,connection.email,close=>{closeImap=close});
      const token=await reader('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refresh,grant_type:'refresh_token'})});
      const authorization={Authorization:'Bearer '+token.access_token};
      const profile=await reader('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:authorization});
      if(String(profile.emailAddress).toLowerCase()!==String(connection.email).toLowerCase())throw new SafeError('El correo autorizado cambió. Conéctalo nuevamente.',409);
      const query=new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
      query.search=new URLSearchParams({q:'from:noreply@hey.inc subject:"Recepción de transferencia nacional SPEI" newer_than:7d',maxResults:'20',includeSpamTrash:'false'}).toString();
      if(input.page_token!==undefined){
        if(typeof input.page_token!=='string'||!input.page_token||input.page_token.length>2048||/[\x00-\x1f]/.test(input.page_token))throw new SafeError('Página de consulta inválida.');
        query.searchParams.set('pageToken',input.page_token);
      }
      const found=await reader(query.href,{headers:authorization});
      const ids=(Array.isArray(found.messages)?found.messages:[]).slice(0,20);
      const movements=[];const proofs:any[]=[];let ignored=0;
      for(let i=0;i<ids.length;i+=4){
        const batch=await Promise.all(ids.slice(i,i+4).map(async(item:any)=>{
          if(!/^[a-f0-9]{1,40}$/i.test(String(item.id)))throw new SafeError('Gmail devolvió un identificador inválido.',502);
          const message=await reader('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+item.id+'?format=full',{headers:authorization});
          const movement=parseHey(message);if(movement)proofs.push(heyPaymentProof(message,movement));return movement;
        }));
        for(const movement of batch){if(movement)movements.push(movement);else ignored++}
      }
      const result=await movementRpc('store',{slot,generation:connection.generation,email:connection.email,bank:connection.bank,last4:connection.last4,movements});
      let approved:any[]=[],verificationError='',telegramError='';
      const {data:owner,error:ownerError}=worker?{data:true,error:null}:await authClient.rpc('is_catalog_admin');
      if(!ownerError){
        const verification=await db.rpc('maniobras_verify_bank_payments',{p_actor:actor,p_slot:slot,p_proofs:proofs});
        if(verification.error)verificationError='Instala pagos-referencia-validacion.sql para validar órdenes.';
        else approved=Array.isArray(verification.data)?verification.data:[];
      }
      const bot=Deno.env.get('TELEGRAM_BOT_TOKEN'),chat=Deno.env.get('TELEGRAM_ADMIN_CHAT_ID');
      if(approved.length){
        if(!bot||!chat)telegramError='Pago validado; falta configurar Telegram para el aviso.';
        else try{
          const response=await fetch('https://api.telegram.org/bot'+bot+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(10000),body:JSON.stringify({chat_id:chat,text:approved.map(o=>'Pago validado por correo bancario\nOrden: '+o.folio+'\nImporte: $'+Number(o.total).toFixed(2)+'\nReferencia: '+o.reference).join('\n\n')})});
          const sent=await response.json();if(!response.ok||!sent.ok)throw Error('Telegram');
        }catch{telegramError='Pago validado; no se pudo enviar el aviso a Telegram.'}
      }
      return reply({ok:true,approved,verification_error:verificationError,telegram_error:telegramError,checked:ids.length,recognized:movements.length,added:result.added,ignored,limited:Boolean(found.nextPageToken),next_page_token:typeof found.nextPageToken==='string'?found.nextPageToken:null,movements:await withCandidates(await movementRpc('list',{slot})),
        message:verificationError||telegramError||(approved.length?'Consulta terminada: '+approved.length+' pago(s) validado(s).':'Consulta terminada. Sin coincidencias verificables: se exige referencia, importe, destinatario y firma bancaria.')});
    }
    if(input.action==='test') {
      const connection=await rpc('token',actor,{slot});
      if(!connection)throw new SafeError('Conecta primero el Gmail de este espacio.',404);
      const refresh=await decrypt(connection.refresh_cipher,actor+':'+slot,key);
      const reader=await connectionReader(refresh,connection.email,close=>{closeImap=close});
      const token=await reader('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
        body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refresh,grant_type:'refresh_token'})});
      const profile=await reader('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{Authorization:'Bearer '+token.access_token}});
      await rpc('tested',actor,{slot});
      return reply({ok:true,email:profile.emailAddress,message:'Gmail responde correctamente. Esta prueba no confirma pagos.'});
    }
    throw new SafeError('Acción inválida.');
  } catch(error) {
    const safe=error instanceof SafeError?error:new SafeError('No se pudo completar la conexión. Revisa los secretos y vuelve a intentar.',500);
    if(callback){if(telegramReturn){try{await fetch('https://api.telegram.org/bot'+Deno.env.get('TELEGRAM_BOT_TOKEN')+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:telegramReturn,text:'No se pudo conectar Gmail: '+safe.message+'\nVuelve a elegir Conectar Gmail desde el bot.'})})}catch{}}return finish(false,safe.message)}
    return reply({error:safe.message},safe.status);
  } finally {if(closeImap)await closeImap();}
});
