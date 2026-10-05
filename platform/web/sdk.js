(function(){
 const c=window.PLATFORM_CONFIG;
 window.Platform={async call(action,payload={},jwt){const r=await fetch(c.url+'/functions/v1/saas-platform',{method:'POST',headers:{'Content-Type':'application/json',apikey:c.key,Authorization:'Bearer '+(jwt||c.key)},body:JSON.stringify({action,payload})});const d=await r.json();if(!r.ok)throw Error(d.error||'No se completó la solicitud');return d.data},money(cents){return new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN'}).format(cents/100)},esc(v){return String(v??'').replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]))}};
})();
