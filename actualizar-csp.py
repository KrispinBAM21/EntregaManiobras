"""Recalcula el hash de los scripts propios de un HTML. Uso: python actualizar-csp.py index.html"""
import base64
import hashlib
from pathlib import Path
import re
import sys

path = Path(sys.argv[1] if len(sys.argv) > 1 else 'index.html')
source = path.read_text(encoding='utf-8')
scripts = [body for attrs, body in re.findall(r'<script([^>]*)>(.*?)</script>', source, re.S)
           if 'src=' not in attrs and 'application/json' not in attrs and body.strip()]
hashes = ' '.join("'sha256-" + base64.b64encode(hashlib.sha256(body.encode()).digest()).decode() + "'"
                  for body in scripts)
policy = ("default-src 'self'; script-src 'self' " + hashes +
          " https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; "
          "worker-src 'self' blob: https://cdn.jsdelivr.net; connect-src https: wss: blob:; "
          "img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https:; "
          "font-src 'self' data: https:; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'")
source = re.sub(r'<meta http-equiv="Content-Security-Policy" content="[^"]*">\n?', '', source)
source = source.replace('<head>', '<head>\n<meta http-equiv="Content-Security-Policy" content="' + policy + '">', 1)
path.write_text(source, encoding='utf-8')
print('Hash CSP actualizado:', path)
