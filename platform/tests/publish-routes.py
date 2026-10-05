import importlib.util, tempfile, json, re
from pathlib import Path
spec=importlib.util.spec_from_file_location('publisher','platform/scripts/publish.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as root:
    base=Path(root)
    assert m.publish([{'slug':'tacos-mzo'},{'slug':'venta-comida'}],'platform/web',base)==2
    page=(base/'tacos-mzo/index.html').read_text()
    for asset in re.findall(r'(?:src|href)="([^"/:]+\.(?:js|css))"',page):
        assert (base/'tacos-mzo'/asset).is_file(),asset
    assert '"site": "tacos-mzo"' in (base/'tacos-mzo/config.js').read_text()
    assert 'SERVICE_ROLE' not in (base/'tacos-mzo/config.js').read_text()
    assert 'id="adminEntry" type="button" hidden' in page
    (base/'own-folder').mkdir();(base/'own-folder/index.html').write_text('original')
    m.publish([{'slug':'venta-comida'}],'platform/web',base)
    assert not (base/'tacos-mzo').exists()
    assert (base/'own-folder/index.html').read_text()=='original'
    try:m.publish([{'slug':'own-folder'}],'platform/web',base)
    except RuntimeError:pass
    else:raise AssertionError('Must not overwrite unrelated folder')
print('PASS: complete routes, tenant config, expired cleanup and unrelated folder protection')
