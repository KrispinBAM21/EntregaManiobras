(function(){
 openBotWebSubscription=function(){location.assign('platform/web/panel.html')};
 document.addEventListener('click',e=>{if(e.target.closest('#botWebAccess,#activateDigitalBot,#myDigitalBot,#openBotSubscription')){e.preventDefault();e.stopImmediatePropagation();openBotWebSubscription()}},true);
 let plans=null;const oldDigital=renderDigitalCatalog;
 renderDigitalCatalog=function(){oldDigital();const price=document.querySelector('#digitalCatalog .digital-product-copy strong');if(price&&plans)price.textContent=money(plans.bot_price/100)+' por 30 días'};
 fetch(SUPABASE_URL+'/functions/v1/saas-platform',{method:'POST',headers:{'Content-Type':'application/json',apikey:SUPABASE_ANON_KEY,Authorization:'Bearer '+SUPABASE_ANON_KEY},body:JSON.stringify({action:'plans'})}).then(r=>r.ok?r.json():null).then(r=>{if(r?.data){plans=r.data;renderDigitalCatalog()}}).catch(()=>{});
 const id='saas',oldPane=renderAdminPane;
 adminTabs.push([id,'Sitios y suscripciones',UI.business]);
 renderAdminPane=function(tab){if(tab!==id)return oldPane(tab);if(!canModule(id))return;activeAdmin=id;document.getElementById('adminContent').innerHTML='<h3>Sitios y suscripciones</h3><p>Consulta pagos del bot, crea sitios de comida, administra renovaciones y configura precios.</p><a class="btn" href="platform/web/panel.html" target="_blank" rel="noopener">'+UI.business+'<span>Abrir panel de sitios y suscripciones</span></a><p class="small muted">Usa tu misma cuenta. Cada negocio conserva sus propios pedidos y productos.</p>'};
 const footer=document.querySelector('.site-legal-footer nav')||document.querySelector('footer')||document.querySelector('main');
 const a=document.createElement('a');a.href='platform/web/panel.html';a.className='btn secondary';a.innerHTML=UI.business+'<span>Bot y sitios para mi negocio</span>';footer?.append(a);
})();
