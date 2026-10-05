from pathlib import Path
import re,json,argparse,base64
p=argparse.ArgumentParser();p.add_argument('--original',required=True);p.add_argument('--base',default='https://krispinbam21.github.io/EntregaManiobras/');p.add_argument('--out',default='web');a=p.parse_args()
s=Path(a.original).read_text();m=re.search(r'<script[^>]*id="siteConnection"[^>]*>(.*?)</script>',s,re.S)
if not m:raise SystemExit('Falta siteConnection en el index original')
c=json.loads(m.group(1));key=c['SUPABASE_ANON_KEY']
if key.startswith('sb_secret_'):raise SystemExit('No uses claves de servicio')
if key.count('.')==2 and json.loads(base64.urlsafe_b64decode(key.split('.')[1]+'===')).get('role')!='anon':raise SystemExit('Se requiere clave pública anon')
out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
config={'url':c['SUPABASE_URL'],'key':key,'base':a.base,'telegram':'https://t.me/Gestor_Pagos_Mzo_bot'}
(out/'config.js').write_text('window.PLATFORM_CONFIG='+json.dumps(config)+';\n')
print('Conexión pública preparada')
