"""Build complete tenant routes; credentials are used only in the build process."""
from pathlib import Path
import os, json, re, urllib.request, shutil

def publish(sites, source, base):
    source, base = Path(source), Path(base)
    active = {site['slug'] for site in sites}
    for marker in base.glob('*/.platform-site'):
        if marker.parent.name not in active and marker.read_text() == marker.parent.name:
            shutil.rmtree(marker.parent)
    template = (source / 'store.html').read_text()
    assets = {m.group(1) for m in re.finditer(r'(?:src|href)="([^"/:]+\.(?:js|css))"', template)}
    assets.add('store.html')  # private preview links within the business panel
    for name in assets:
        if not (source / name).is_file():
            raise RuntimeError('Falta archivo del catálogo: ' + name)
    config = (source / 'config.js').read_text()
    match = re.fullmatch(r'\s*window\.PLATFORM_CONFIG\s*=\s*(\{.*\});?\s*', config, re.S)
    if not match:
        raise RuntimeError('Configuración pública inválida')
    public = json.loads(match.group(1))
    for site in sites:
        slug = site['slug']
        if not re.fullmatch('[a-z][a-z0-9-]{2,39}', slug):
            raise RuntimeError('Ruta inválida')
        target = base / slug
        marker = target / '.platform-site'
        if target.exists() and not marker.exists():
            raise RuntimeError('Ruta ocupada por archivos ajenos: ' + slug)
        target.mkdir(parents=True, exist_ok=True)
        for name in assets:
            shutil.copyfile(source / name, target / name)
        (target / 'index.html').write_text(template)
        (target / 'config.js').write_text('window.PLATFORM_CONFIG=' + json.dumps({**public, 'site': slug}) + ';\n')
        marker.write_text(slug)
    return len(sites)

if __name__ == '__main__':
    url = os.environ['SUPABASE_URL'].rstrip('/')
    key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
    req = urllib.request.Request(url + '/rest/v1/rpc/saas_publish_sites', data=b'{}', headers={
        'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as response:
        sites = json.load(response)
    print('Rutas construidas:', publish(sites, os.environ.get('PLATFORM_WEB', 'platform/web'), os.environ.get('PUBLIC_OUTPUT', '.')))
