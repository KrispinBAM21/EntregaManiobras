const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const TELEGRAM_ADMIN_CHAT_ID = Deno.env.get("TELEGRAM_ADMIN_CHAT_ID") || "";
const TELEGRAM_ADMIN_USER_ID = Deno.env.get("TELEGRAM_ADMIN_USER_ID") || "";
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") || "";
const PUBLIC_SITE_URL = Deno.env.get("PUBLIC_SITE_URL") || "https://krispinbam21.github.io/EntregaManiobras/";

function serviceHeaders(extra: Record<string, string> = {}) {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function sbRest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...serviceHeaders(),
      ...(init.headers || {}),
    },
  });

  const text = await res.text();

  if (!res.ok) {
    let data:any=null;try{data=JSON.parse(text)}catch{}
    throw new BotUpstreamError('supabase',res.status,String(data?.code||'HTTP_ERROR'),String(data?.message||'Error del servicio de datos')); 
  }

  if(!text.trim())return null;
  try{return JSON.parse(text)}catch{throw new BotUpstreamError('supabase',502,'INVALID_JSON','Respuesta inválida del servicio de datos');}
}

async function telegram(method: string, payload: unknown) {
  if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN no configurado");
  }

  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  const data = await res.json();

  if (!res.ok || data?.ok === false) {
    throw new BotUpstreamError('telegram',res.status,method+'_'+String(data?.error_code||'HTTP_ERROR'),'Telegram no pudo completar el envío.');
  }

  return data;
}


class BotUpstreamError extends Error {
  constructor(public source:string, public status:number, public code:string, message:string) { super(message); this.name='BotUpstreamError'; }
}
function nativeError(error:unknown){
  if(error instanceof BotUpstreamError){
    if(error.source==='gmail' && error.message && !/https?:|token|secret|password|contrase(?:ña|na)/i.test(error.message)) return error.message.slice(0,240);
    return 'No se pudo completar la consulta. Revisa el diagnóstico de la función.';
  }
  const message=error instanceof Error?error.message:'';
  // Only intentional user instructions are shown; internal failures stay in Logs.
  if(error instanceof Error && error.name==='Error' && message && !/https?:|token|secret|Supabase REST|Telegram |password/i.test(message)) return message.slice(0,240);
  return 'No se pudo completar la consulta. Revisa el diagnóstico de la función.';
}
function reportNativeError(error:unknown,action:string){
  const reference=crypto.randomUUID().slice(0,8);
  const type=error instanceof Error?error.name:'UnknownError';
  const diagnostic:Record<string,unknown>={event:'telegram_action_failed',reference,action:action.replace(/[^a-z_]/gi,'').slice(0,32),type};
  if(error instanceof BotUpstreamError){diagnostic.source=error.source;diagnostic.status=error.status;diagnostic.code=error.code.replace(/[^a-z0-9_-]/gi,'').slice(0,40);}
  // No request bodies, passwords, messages, account numbers or Telegram IDs are logged.
  console.error(JSON.stringify(diagnostic));
  return nativeError(error)+' Código de diagnóstico: '+reference;
}
function connectionRows(result:any){
  if(!result || !Array.isArray(result.connections)) throw new BotUpstreamError('gmail',502,'INVALID_CONNECTIONS_RESPONSE','La función gmail-oauth no devolvió la lista de conexiones esperada.');
  return result.connections;
}

const NATIVE_BANKS=['Hey Banco','Spin by OXXO','Klar','Bitso','Ualá','Stori','albo','Mifel'];
const INTERNAL_SECRET=Deno.env.get('TELEGRAM_INTERNAL_SECRET')||'';
async function botRpc(action:string,telegramId:number,payload:unknown={}){if(nativeAdmin(telegramId))await sbRest('rpc/maniobras_bot_telegram_admin',{method:'POST',body:JSON.stringify({p_action:'ensure_creator',p_actor:telegramId,p_payload:{}})});return sbRest('rpc/maniobras_telegram_api',{method:'POST',body:JSON.stringify({p_action:action,p_telegram:telegramId,p_payload:payload})})}
async function botGmail(telegramId:number,input:Record<string,unknown>){
  if(INTERNAL_SECRET.length<32)throw Error('Configura TELEGRAM_INTERNAL_SECRET en las funciones');
  let r:Response;
  try{r=await fetch(SUPABASE_URL+'/functions/v1/gmail-oauth',{method:'POST',headers:{'Content-Type':'application/json','x-telegram-secret':INTERNAL_SECRET},body:JSON.stringify({...input,telegram_id:telegramId}),signal:AbortSignal.timeout(45000)});}
  catch(e){throw new BotUpstreamError('gmail',0,e instanceof Error?e.name:'NETWORK_ERROR','No se pudo conectar con el lector de correo. Vuelve a intentar.');}
  let data:any;try{data=await r.json()}catch{throw new BotUpstreamError('gmail',r.status,'INVALID_JSON','El lector de correo devolvió una respuesta inválida.');}
  if(!r.ok)throw new BotUpstreamError('gmail',r.status,String(data?.code||'HTTP_ERROR'),String(data?.error||'No se pudo consultar Gmail'));
  return data;
}

function nativeAdmin(id:number){return !!TELEGRAM_ADMIN_USER_ID && String(id)===TELEGRAM_ADMIN_USER_ID}
async function profileRpc(action:string,id:number,payload:unknown={}){return sbRest('rpc/maniobras_telegram_profile_api',{method:'POST',body:JSON.stringify({p_action:action,p_telegram:id,p_payload:payload})})}
function nativeMenu(account:any,id=0){const rows:any[]=account?[
 [{text:'👤 Mi cuenta',callback_data:'bot:account'},{text:'⭐ Suscripción',callback_data:'bot:subscribe'}],
 ...(account.active&&account.profile_complete?[[{text:'🏦 Vincular banca y correo',callback_data:'bot:slots'},{text:'📊 Movimientos',callback_data:'bot:movements'}]]:[]),
 ...(!account.profile_complete?[[{text:'📝 Completar registro',callback_data:'bot:signup'}]]:[]),
 [{text:'ℹ️ Cómo funciona',callback_data:'bot:help'}]
 ]:[[{text:'📝 Crear cuenta',callback_data:'bot:signup'},{text:'🔑 Iniciar sesión',callback_data:'bot:account'}],[{text:'ℹ️ Cómo funciona',callback_data:'bot:help'}]];
 if(nativeAdmin(id))rows.push([{text:'🛠 Administrador',callback_data:'bot:admin'}]);if(nativeAdmin(id))rows.push([{text:'👥 Usuarios registrados',callback_data:'bot:users:0'},{text:'⭐ Usuarios suscritos',callback_data:'bot:subscribers:0'}]);return {inline_keyboard:rows}}
async function nativeSend(chat:number,text:string,markup?:unknown){await telegram('sendMessage',{chat_id:chat,text,...(markup?{reply_markup:markup}:{})})}
async function nativeStart(chat:number,id:number){const a=await botRpc('account',id);await nativeSend(chat,a?'👋 Hola, '+a.name+'. '+(!a.profile_complete?'Completa tu nombre y correo para continuar.':a.owner?'Acceso de creador gratuito y permanente. Puedes usar banca, correo y administración.':a.suspended?'Tu suscripción está desactivada por el administrador.':a.active?'Tu suscripción está activa. Puedes vincular tu banca.':'Primero paga la suscripción para habilitar banca, correo y movimientos.'):'👋 Bienvenido. Crea tu cuenta con nombre y correo. Tu sesión queda vinculada a tu Telegram. No envíes contraseñas.',nativeMenu(a,id))}
async function nativeCreate(chat:number,id:number,name:string,username=''){await profileRpc('draft_set',id,{step:'name',username});await nativeSend(chat,'📝 Paso 1 de 2: escribe tu nombre completo. /cancelar para salir.')}
async function nativeRegistration(message:any){const id=message.from.id,chat=message.chat.id,draft=await profileRpc('draft',id);if(!draft)return false;const text=String(message.text||'').trim();
 if(draft.step==='name'){if(text.length<2||text.length>100||/[<>\x00-\x1f]/.test(text))throw Error('Escribe un nombre válido, entre 2 y 100 caracteres');await profileRpc('draft_set',id,{...draft,step:'email',name:text});await nativeSend(chat,'📧 Paso 2 de 2: escribe tu correo electrónico de contacto. Después autorizarás Gmail por separado; no envíes su contraseña.');return true}
 if(text.length>254||! /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(text))throw Error('Escribe un correo electrónico válido');
 let a=await botRpc('account',id);if(!a){const r=await fetch(SUPABASE_URL+'/auth/v1/admin/users',{method:'POST',headers:serviceHeaders(),body:JSON.stringify({email:'tg-'+id+'@telegram.invalid',email_confirm:true,password:crypto.randomUUID()+crypto.randomUUID(),user_metadata:{full_name:draft.name},app_metadata:{provider_identity:'telegram',telegram_id:String(id)}})});const user=await r.json();if(!r.ok)throw Error('No se pudo crear la cuenta. Contacta al administrador con tu ID de /id.');a=await botRpc('register',id,{user_id:user.id,name:draft.name})}
 await profileRpc('save',id,{name:draft.name,email:text,username:message.from.username||draft.username||''});a=await botRpc('account',id);await nativeSend(chat,'✅ Registro completo. Nombre: '+a.name+'\nCorreo: '+a.contact_email+'\nTelegram: '+(a.telegram_username?'@'+a.telegram_username:'sin nombre de usuario; se utiliza tu ID '+id)+'\nID de cuenta: '+a.user_id+'\n'+(a.owner?'Acceso de creador gratuito y permanente.':a.active?'Tu acceso continúa activo.':'⭐ Paga la suscripción para continuar.'),nativeMenu(a,id));return true}
async function nativeUsers(chat:number,id:number,activeOnly:boolean,offset:number){return nativeAdminList(chat,id,activeOnly?'active':'all',Math.floor(offset/10)*5)}
async function nativeSlots(chat:number,id:number,forMovements=false){const a=await botRpc('account',id);if(!a)return nativeStart(chat,id);if(!a.active){await nativeSend(chat,'Tu suscripción no está activa. Renueva para utilizar correos y movimientos.',nativeMenu(a,id));return}const list=await botGmail(id,{action:'list'});await nativeSend(chat,'Elige uno de los tres espacios. La lectura de movimientos disponible actualmente es Hey Banco; las demás bancas pueden configurarse y probar su conexión Gmail.',{inline_keyboard:[1,2,3].map(slot=>{const c=connectionRows(list).find((c:any)=>c.slot===slot);return [{text:'Espacio '+slot+(c?' · '+(c.bank||c.email||'Gmail'):' · Sin conectar'),callback_data:'bot:'+(forMovements?'scan:':'slot:')+slot}]})})}
async function nativeAction(chat:number,id:number,data:string,name:string,username=''){const parts=data.split(':'),action=parts[1];if(!nativeAdmin(id)&&['slots','movements','slot','connect','banks','bank','type','test','disconnect','scan','subscribe','invoice'].includes(action)){const webOnly=await sbRest('rpc/saas_telegram_mode',{method:'POST',body:JSON.stringify({p_telegram:id})});if(webOnly===true){await nativeSend(chat,'🌐 Tu suscripción está vinculada al panel web. Configura tu banca y Gmail, realiza pruebas y consulta movimientos desde allí. Telegram conserva tu registro de suscripción.',{inline_keyboard:[[{text:'🌐 Abrir mi panel',url:PUBLIC_SITE_URL.replace(/\/$/,'')+'/platform/web/panel.html'}]]});return}}if(action==='admin')return nativeAdminPanel(chat,id);if(action==='adminlist')return nativeAdminList(chat,id,parts[2],Number(parts[3]));if(action==='adminuser')return nativeAdminUser(chat,id,parts[2]);if(action==='adminactivate'||action==='admindeactivate'){await nativeAdminRequest(action==='adminactivate'?'activate':'deactivate',id,{user_id:parts[2]});await nativeSend(chat,action==='adminactivate'?'✅ Suscripción activada. Si seguía vigente conserva su vencimiento; si venció tiene 30 días.':'⏸ Suscripción desactivada. Se conservan pagos y correos; no se desbloquea con otro pago.');return nativeAdminUser(chat,id,parts[2])}if(action==='home')return nativeStart(chat,id);if(action==='users'||action==='subscribers'){const offset=Number(parts[2]);if(!Number.isInteger(offset)||offset<0||offset>100000)throw Error('Página inválida');return nativeUsers(chat,id,action==='subscribers',offset)}if(action==='signup')return nativeCreate(chat,id,name,username);if(action==='help'){await nativeSend(chat,'El bot conecta hasta tres correos Gmail con autorización de Google, guarda la banca receptora y consulta avisos de movimientos. No entra a tu banca y no solicita contraseñas.\n\nLa lectura automática actual reconoce Hey Banco. El acceso dura 30 días y debe renovarse al vencer. Las órdenes del negocio se validan con banco, importe y referencia. Un aviso recibido en tu correo no equivale a una orden aprobada.\n\nComandos: /start, /cuenta, /correos, /movimientos, /suscripcion, /vincular CODIGO, /cancelar, /paysupport.');return}
const a=await botRpc('account',id);if(!a)return nativeCreate(chat,id,name,username);if(!a.profile_complete)return nativeCreate(chat,id,name,username);
if(action==='account'){await nativeSend(chat,'Nombre: '+a.name+'\nID: '+a.user_id+'\nSuscripción: '+(a.owner?'creador · gratis, sin vencimiento':a.suspended?'desactivada por el administrador':a.active?'activa hasta '+new Date(a.expires_at).toLocaleString('es-MX'):'inactiva')+'\nCorreo: '+a.contact_email+'\nTelegram: '+(a.telegram_username?'@'+a.telegram_username:'ID '+id),nativeMenu(a,id));return}
if(action==='subscribe'){if(a.owner){await nativeSend(chat,'🛠 Eres el creador. Tu acceso es gratuito y no requiere suscripción.',nativeMenu(a,id));return}if(a.suspended){await nativeSend(chat,'⏸ Tu suscripción fue desactivada por el administrador. Contacta a soporte; no realices otro pago para intentar desbloquearla.',nativeMenu(a,id));return}if(a.active){await nativeSend(chat,'⭐ Tu suscripción ya está activa hasta '+new Date(a.expires_at).toLocaleString('es-MX')+'. Es una sola suscripción por usuario. Puedes renovar al vencer.',nativeMenu(a,id));return}const cfg=await botRpc('settings',id);if(!cfg.enabled){await nativeSend(chat,'Las suscripciones aún no están habilitadas.');return}await nativeSend(chat,'Acceso por 30 días: '+cfg.priceStars+' Stars. Se activa solamente cuando Telegram confirma el pago. La renovación es voluntaria.\n\nAl continuar aceptas acceso por 30 días, lectura de Gmail autorizada por ti y bloqueo de consultas al vencer. Soporte: /paysupport.',{inline_keyboard:[[{text:'⭐ Pagar suscripción de 30 días',callback_data:'bot:invoice'}]]});return}
if(action==='invoice'){const invoice=await botRpc('invoice',id);await telegram('sendInvoice',{chat_id:chat,title:'Gestor de pagos · 30 días',description:'Acceso al gestor de correos y movimientos durante 30 días desde el pago. Soporte: /paysupport.',payload:invoice.id,provider_token:'',currency:'XTR',prices:[{label:'Acceso durante 30 días',amount:invoice.amount}]});return}
if(action==='slots')return nativeSlots(chat,id);if(action==='movements')return nativeSlots(chat,id,true);
if(!a.active){await nativeSend(chat,'Tu acceso ha vencido. Renueva con /suscripcion.');return}
const slot=Number(parts[2]);if(!Number.isInteger(slot)||slot<1||slot>3)throw Error('Espacio inválido');
if(action==='slot'){const result=await botGmail(id,{action:'list'}),c=connectionRows(result).find((c:any)=>c.slot===slot);if(!c?.bank)return nativeAction(chat,id,'bot:banks:'+slot,name);if(!c.connected){await nativeSend(chat,'🏦 '+c.bank+' · Cuenta terminada en '+c.last4+'\n📧 Ahora vincula el Gmail que recibe sus avisos.',{inline_keyboard:[[{text:'📧 Vincular Gmail',callback_data:'bot:connect:'+slot}],[{text:'🏦 Cambiar banca',callback_data:'bot:banks:'+slot}]]});return}if(!c.tested_at){await nativeSend(chat,'📧 Gmail vinculado. 🧪 Prueba la conexión antes de consultar movimientos.',{inline_keyboard:[[{text:'🧪 Probar conexión',callback_data:'bot:test:'+slot}],[{text:'📧 Cambiar Gmail',callback_data:'bot:connect:'+slot}]]});return}await nativeSend(chat,'Espacio '+slot+'\n'+(c?('Correo: '+(c.email||'sin conectar')+'\nBanco: '+(c.bank||'sin configurar')+'\nCuenta terminada en: '+(c.last4||'sin capturar')):'No conectado'),{inline_keyboard:[[{text:'Conectar / cambiar Gmail',callback_data:'bot:connect:'+slot}],[{text:'Configurar banca',callback_data:'bot:banks:'+slot},{text:'Probar conexión',callback_data:'bot:test:'+slot}],[{text:'Consultar movimientos',callback_data:'bot:scan:'+slot},{text:'Desconectar',callback_data:'bot:disconnect:'+slot}]]});return}
if(action==='connect'){const list=await botGmail(id,{action:'list'});if(!connectionRows(list).some((c:any)=>c.slot===slot&&c.bank))return nativeAction(chat,id,'bot:banks:'+slot,name);const result=await botGmail(id,{action:'begin',slot});await nativeSend(chat,'Autoriza la lectura en Google. Al terminar regresarás al bot. Nunca envíes la contraseña por Telegram.',{inline_keyboard:[[{text:'Autorizar Gmail en Google',url:result.url}]]});return}
if(action==='banks'){const available=await botGmail(id,{action:'list'}),banks=NATIVE_BANKS.map((b,i)=>({b,i})).filter(x=>available.banks.includes(x.b));if(!banks.length){await nativeSend(chat,'🏦 El administrador no tiene bancas disponibles para nuevas conexiones.');return}await nativeSend(chat,'Selecciona la banca receptora del espacio '+slot,{inline_keyboard:banks.map(({b,i})=>[{text:b,callback_data:'bot:bank:'+slot+':'+i}])});return}
if(action==='bank'){const bank=NATIVE_BANKS[Number(parts[3])];if(!bank)throw Error('Banca inválida');const available=await botGmail(id,{action:'list'});if(!available.banks.includes(bank))throw Error('Esta banca ya no está disponible. Vuelve a seleccionar banca.');await botRpc('state',id,{step:'account_type',slot,bank,expires:Date.now()+600000});await nativeSend(chat,'Banco: '+bank+'. Selecciona el tipo de identificador.',{inline_keyboard:[[{text:'CLABE',callback_data:'bot:type:'+slot+':clabe'},{text:'Número de cuenta',callback_data:'bot:type:'+slot+':account'}]]});return}
if(action==='type'){if(a.state?.step!=='account_type'||a.state.slot!==slot||a.state.expires<Date.now())throw Error('La captura venció. Vuelve a elegir banca');const type=parts[3];if(!['clabe','account'].includes(type))throw Error('Tipo inválido');await botRpc('state',id,{...a.state,step:'account_number',account_type:type});await nativeSend(chat,'Escribe '+(type==='clabe'?'los 18 dígitos de la CLABE':'el número de cuenta, de 8 a 20 dígitos')+'. No envíes tarjeta, NIP ni contraseña. /cancelar para detener.');return}
if(action==='test'){const result=await botGmail(id,{action:'test',slot});await nativeSend(chat,'✅ '+(result.message||'La conexión Gmail respondió correctamente.'),{inline_keyboard:[[{text:'📊 Consultar movimientos',callback_data:'bot:scan:'+slot}]]});return}
if(action==='disconnect'){await botGmail(id,{action:'disconnect',slot});await botRpc('state',id,{});await nativeSend(chat,'Correo y banca desconectados. Puedes configurar otro en ese espacio.');return}
if(action==='scan'){const list=await botGmail(id,{action:'list'}),c=connectionRows(list).find((c:any)=>c.slot===slot);if(!c?.bank||!c.connected||!c.tested_at)return nativeAction(chat,id,'bot:slot:'+slot,name);const result=await botGmail(id,{action:'scan',slot});if(!Array.isArray(result?.movements))throw new BotUpstreamError('gmail',502,'INVALID_MOVEMENTS_RESPONSE','El lector no devolvió una lista de movimientos válida.');const rows=result.movements;await nativeSend(chat,rows.length?'Movimientos detectados:\n'+rows.slice(0,10).map((m:any)=>'$'+(Number(m.amount_cents)/100).toFixed(2)+' MXN · Referencia '+(m.reference||'sin referencia')+'\n'+(m.tracking_key||'')).join('\n\n'):(result.message||'No se encontraron avisos compatibles.'));return}
}
async function nativeMessage(message:any){const chat=message.chat.id,id=message.from.id,name=String(message.from.first_name||'Usuario')+' '+String(message.from.last_name||''),text=String(message.text||'').trim();
if(message.successful_payment){const p=message.successful_payment;await botRpc('paid',id,{id:p.invoice_payload,amount:p.total_amount,currency:p.currency,charge_id:p.telegram_payment_charge_id});const afterPayment=await botRpc('account',id);if(afterPayment?.suspended){await nativeSend(chat,'✅ El pago quedó registrado. Tu suscripción sigue desactivada por el administrador; solicita su reactivación.');return}await nativeSend(chat,'✅ Pago confirmado por Telegram. Tu acceso está activo durante 30 días.\n🏦 Continúa vinculando tu banca.' ,{inline_keyboard:[[{text:'🏦 Vincular mi banca',callback_data:'bot:slots'}]]});return}
const command=text.split(/\s/)[0].split('@')[0].toLowerCase();
if(command==='/id'){await nativeSend(chat,'Chat ID: '+chat+'\nUsuario ID: '+id);return}
if(command==='/vincular'){const token=text.split(/\s+/)[1];if(!/^[a-f0-9-]{36}$/i.test(token||''))throw Error('Usa /vincular CODIGO generado desde el perfil del sitio');await sbRest('rpc/maniobras_telegram_link',{method:'POST',body:JSON.stringify({p_telegram:id,p_token:token,p_name:name.trim()})});await nativeSend(chat,'Cuenta vinculada. Tu suscripción y correos usan ahora la cuenta de tu perfil.');return nativeStart(chat,id)}
if(command==='/admin')return nativeAdminPanel(chat,id)
if(command==='/cancelar'){await profileRpc('draft_clear',id);if(await botRpc('account',id))await botRpc('state',id,{});return nativeStart(chat,id)}
if(['/support','/paysupport','/terms'].includes(command)){await nativeSend(chat,command==='/terms'?'Acceso por 30 días desde pago confirmado. Al vencer se bloquean consultas hasta renovar. Puedes revocar Gmail desde Google o desconectarlo desde el bot. No se solicita contraseña bancaria. Para aclaraciones usa /paysupport.':'Para soporte o aclaraciones de suscripción, contacta al administrador. Indica tu ID de /id y la fecha del pago.');if(TELEGRAM_ADMIN_CHAT_ID)await telegram('sendMessage',{chat_id:TELEGRAM_ADMIN_CHAT_ID,text:'Solicitud de soporte del usuario Telegram '+id+' ('+name.trim()+').'});return}
const commands:Record<string,string>={'/register':'signup','/registro':'signup','/login':'account','/cuenta':'account','/correos':'slots','/movimientos':'movements','/suscripcion':'subscribe','/help':'help','/ayuda':'help'};
if(commands[command])return nativeAction(chat,id,'bot:'+commands[command],name.trim(),message.from.username||'');
if(!command.startsWith('/')&&await nativeRegistration(message))return;
const a=await botRpc('account',id);if(a?.state?.step==='account_number'){if(!a.active)throw Error('Renueva tu suscripción antes de guardar una banca');if(a.state.expires<Date.now()){await botRpc('state',id,{});throw Error('La captura venció. Vuelve a seleccionar la banca')}await botGmail(id,{action:'save_bank',slot:a.state.slot,bank:a.state.bank,account_type:a.state.account_type,account:text.replace(/\s/g,'')});await botRpc('state',id,{});await nativeSend(chat,'✅ Banca guardada. Ahora vincula el correo que recibe los avisos.');return nativeAction(chat,id,'bot:slot:'+a.state.slot,name.trim())}
return nativeStart(chat,id)
}


async function nativeAdminRequest(action:string,id:number,payload:unknown={}){if(!nativeAdmin(id))throw Error('Acceso solo para el administrador');await sbRest('rpc/maniobras_bot_telegram_admin',{method:'POST',body:JSON.stringify({p_action:'ensure_creator',p_actor:id,p_payload:{}})});return sbRest('rpc/maniobras_bot_telegram_admin',{method:'POST',body:JSON.stringify({p_action:action,p_actor:id,p_payload:payload})})}
async function nativeAdminPanel(chat:number,id:number){if(!nativeAdmin(id))throw Error('Acceso solo para el administrador');await nativeAdminRequest('ensure_creator',id);await nativeSend(chat,'🛠 Administrador del bot\nAcceso de creador gratuito y permanente. Selecciona una lista para consultar usuarios y activar o desactivar su suscripción.',{inline_keyboard:[[{text:'👥 Todos los usuarios',callback_data:'bot:adminlist:all:0'}],[{text:'✅ Activos',callback_data:'bot:adminlist:active:0'},{text:'⌛ Vencidos',callback_data:'bot:adminlist:expired:0'}],[{text:'⏸ Desactivados',callback_data:'bot:adminlist:suspended:0'},{text:'🔄 Renovaron',callback_data:'bot:adminlist:renewed:0'}],[{text:'🏠 Inicio',callback_data:'bot:home'}]]})}
async function nativeAdminList(chat:number,id:number,filter:string,offset:number){if(!Number.isInteger(offset)||offset<0||offset>100000)throw Error('Página inválida');const r=await nativeAdminRequest('list',id,{filter,offset});await nativeSend(chat,'👥 Usuarios · '+r.total+' resultados\nSelecciona una cuenta para ver su acceso y sus bancas.',{inline_keyboard:[...r.users.map((u:any)=>[{text:u.name+' · '+({active:'activa',expired:'vencida',suspended:'desactivada',creator:'creador'}[u.status]||u.status),callback_data:'bot:adminuser:'+u.user_id}]),...(offset>0?[[{text:'⬅️ Anteriores',callback_data:'bot:adminlist:'+filter+':'+Math.max(0,offset-5)}]]:[]),...(offset+5<r.total?[[{text:'➡️ Siguientes',callback_data:'bot:adminlist:'+filter+':'+(offset+5)}]]:[]),[{text:'🛠 Administrador',callback_data:'bot:admin'}]]})}
async function nativeAdminUser(chat:number,id:number,userId:string){if(!/^[0-9a-f-]{36}$/i.test(userId||''))throw Error('Usuario inválido');const u=await nativeAdminRequest('user',id,{user_id:userId});if(!u)throw Error('Usuario no encontrado');const states={active:'✅ Activa',expired:'⌛ Vencida',suspended:'⏸ Desactivada',creator:'🛠 Creador sin costo',pending:'💳 Pago pendiente',none:'Sin suscripción'};await nativeSend(chat,('👤 '+u.name+'\n'+u.email+'\n'+(u.telegram_username?'@'+u.telegram_username:'Solo web')+'\nID: '+u.user_id+'\n'+(states[u.status]||u.status)+'\n'+(u.status==='creator'?'Sin vencimiento':u.expires_at?'Vence: '+new Date(u.expires_at).toLocaleString('es-MX'):'Sin periodo activo')+'\nRenovaciones: '+u.renewal_count+'\n\n🏦 Bancas\n'+(u.banks.map((b:any)=>b.bank+' · '+b.last4+' · '+(b.active?'habilitada':'inactiva')).join('\n')||'Sin bancas')).slice(0,4000),{inline_keyboard:[...(u.status==='creator'?[]:[[{text:u.status==='active'?'⏸ Desactivar suscripción':'✅ Activar suscripción',callback_data:'bot:'+(u.status==='active'?'admindeactivate':'adminactivate')+':'+u.user_id}]]),[{text:'👥 Usuarios',callback_data:'bot:adminlist:all:0'},{text:'🛠 Administrador',callback_data:'bot:admin'}]]})}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("ok", { status: 200 });
  }

  try {
    if (!TELEGRAM_WEBHOOK_SECRET || !TELEGRAM_BOT_TOKEN) return new Response("Configura los secretos de Telegram", { status: 503 });
    if (
      req.headers.get("X-Telegram-Bot-Api-Secret-Token") !==
        TELEGRAM_WEBHOOK_SECRET
    ) {
      return new Response("forbidden", { status: 403 });
    }

    const declaredLength = Number(req.headers.get("content-length") || 0);
    if (declaredLength > 65536) return new Response("too large", { status: 413 });
    const rawBody = await req.text();
    if (new TextEncoder().encode(rawBody).length > 65536) return new Response("too large", { status: 413 });
    const update = JSON.parse(rawBody);
    const message = update?.message;
    if(update.pre_checkout_query){const q=update.pre_checkout_query;let ok=false;try{const result=await botRpc('checkout',q.from.id,{id:q.invoice_payload,amount:q.total_amount,currency:q.currency});ok=result.ok===true}catch{}await telegram('answerPreCheckoutQuery',{pre_checkout_query_id:q.id,ok,...(!ok?{error_message:'La solicitud venció o el importe cambió. Genera otra suscripción.'}:{})});return new Response('ok')}
    if(message){if(message.chat?.type!=='private'||message.from?.is_bot)return new Response('ok');if(message.successful_payment){await nativeMessage(message);return new Response('ok')}try{await nativeMessage(message)}catch(e){await nativeSend(message.chat.id,reportNativeError(e,'message'))}return new Response('ok')}
    const callback=update?.callback_query;
    if(callback?.data?.startsWith('bot:')){if(callback.message?.chat?.type!=='private'||String(callback.message.chat.id)!==String(callback.from.id))return new Response('forbidden',{status:403});await telegram('answerCallbackQuery',{callback_query_id:callback.id});try{await nativeAction(callback.message.chat.id,callback.from.id,callback.data,[callback.from.first_name,callback.from.last_name].filter(Boolean).join(' '),callback.from.username||'')}catch(e){await nativeSend(callback.message.chat.id,reportNativeError(e,callback.data.split(':')[1]||'callback'))}return new Response('ok')}
    if (!callback) {
      return new Response("ok", { status: 200 });
    }

    const chatId = String(callback?.message?.chat?.id ?? "");
    const userId = String(callback?.from?.id ?? "");

    if (!TELEGRAM_ADMIN_CHAT_ID || !TELEGRAM_ADMIN_USER_ID) {
      await telegram("answerCallbackQuery", { callback_query_id: callback.id, text: "La revisión administrativa aún no está configurada", show_alert: true });
      return new Response("ok");
    }
    if (
      chatId !== String(TELEGRAM_ADMIN_CHAT_ID)
    ) {
      return new Response("forbidden", { status: 403 });
    }

    if (
      userId !== String(TELEGRAM_ADMIN_USER_ID)
    ) {
      return new Response("forbidden", { status: 403 });
    }

    const raw = String(callback?.data || "");
    const [action, orderId] = raw.split(":");

    if (
      !["approve", "reject", "view"].includes(action) ||
      !/^[0-9a-f-]{36}$/i.test(orderId || "")
    ) {
      return new Response("bad request", { status: 400 });
    }

    const orders = await sbRest(
      `orders?id=eq.${encodeURIComponent(orderId)}&select=id,public_id,customer_name,total,expected_amount,payment_status,is_fake,delivery_status&limit=1`
    );

    const order = Array.isArray(orders) ? orders[0] : null;

    if (!order) {
      return new Response("not found", { status: 404 });
    }

    if (action === "view") {
      await telegram("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: `${order.public_id} - $${Number(
          order.expected_amount ?? order.total
        ).toFixed(2)} MXN`,
        show_alert: true,
      });

      return new Response("ok", { status: 200 });
    }

    const nextStatus =
      action === "approve" ? "APPROVED" : "REJECTED";

    if(order.is_fake||order.delivery_status==='delivered'){
      await telegram('answerCallbackQuery',{callback_query_id:callback.id,text:'Esta orden no admite cambios de pago',show_alert:true});return new Response('ok');
    }
    if(order.payment_status===nextStatus){await telegram('answerCallbackQuery',{callback_query_id:callback.id,text:'El pago ya tiene ese estado'});return new Response('ok');}
    await sbRest(`orders?id=eq.${orderId}`, {
      method: "PATCH",
      headers: {
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        payment_status: nextStatus,
        status: nextStatus === "APPROVED" ? "pagado" : "pendiente",
        approved_at:
          nextStatus === "APPROVED"
            ? new Date().toISOString()
            : null,
        rejected_at:
          nextStatus === "REJECTED"
            ? new Date().toISOString()
            : null,
        rejection_reason:
          nextStatus === "REJECTED"
            ? "Rechazado desde Telegram"
            : null,
      }),
    });

    await sbRest("order_events", {
      method: "POST",
      headers: {
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        order_id: orderId,
        event_type:
          nextStatus === "APPROVED"
            ? "PAYMENT_APPROVED"
            : "PAYMENT_REJECTED",
        old_status: order.payment_status,
        new_status: nextStatus,
        source: "TELEGRAM_ADMIN",
        metadata: {
          telegram_user_id: callback?.from?.id ?? null,
        },
      }),
    });

    await telegram("answerCallbackQuery", {
      callback_query_id: callback.id,
      text:
        nextStatus === "APPROVED"
          ? "Pago aprobado"
          : "Pago rechazado",
    });

    if (
      callback?.message?.chat?.id &&
      callback?.message?.message_id
    ) {
      await telegram("editMessageReplyMarkup", {
        chat_id: callback.message.chat.id,
        message_id: callback.message.message_id,
        reply_markup: { inline_keyboard: [] },
      });
    }

    return new Response("ok", { status: 200 });
  } catch (error) {
    // No registrar tokens, mensajes privados ni errores que puedan contener URLs con secretos.
    console.error("No se pudo procesar una actualización de Telegram");
    return new Response("Error interno", { status: 500 });
  }
});
