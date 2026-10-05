from pathlib import Path
import os,json,re,urllib.request,shutil
base=Path(os.environ.get('PUBLIC_OUTPUT','.'));url=os.environ['SUPABASE_URL'].rstrip('/');key=os.environ['SUPABASE_SERVICE_ROLE_KEY']
req=urllib.request.Request(url+'/rest/v1/rpc/saas_publish_sites',data=b'{}',headers={'apikey':key,'Authorization':'Bearer '+key,'Content-Type':'application/json'})
with urllib.request.urlopen(req,timeout=30) as response:sites=json.load(response)
source=Path(os.environ.get('PLATFORM_WEB','platform/web'))
for site in sites:
 slug=site['slug']
 if not re.fullmatch('[a-z][a-z0-9-]{2,39}',slug):raise RuntimeError('Ruta inválida')
 target=base/slug;marker=target/'.platform-site'
 if target.exists() and not marker.exists():raise RuntimeError('Ruta ocupada por archivos ajenos: '+slug)
 target.mkdir(parents=True,exist_ok=True)
 for name in ['store.html','store.js','icons.js','sdk.js','config.js','platform.css']:shutil.copyfile(source/name,target/('index.html' if name=='store.html' else name))
 (target/'panel.html').write_text('<!doctype html><html lang="es-MX"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=../platform/web/panel.html"><title>Panel del negocio</title><a href="../platform/web/panel.html">Abrir panel</a></html>')
 marker.write_text(slug)
print('Rutas construidas:',len(sites))
