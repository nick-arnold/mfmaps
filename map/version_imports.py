"""Append the deploy version to relative ES module imports.

Django's ManifestStaticFilesStorage hashes files but does not rewrite import
paths inside JavaScript, so `import './map-setup.js'` keeps its cached copy
forever. This runs after collectstatic and versions those imports.
"""
import os
import pathlib
import re
import sys

version = os.environ.get('APP_VERSION', 'dev')
root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '/app/staticfiles')
pattern = re.compile(r"""((?:from|import)\s+['"]\./[^'"?]+\.js)(['"])""")

count = 0
for path in root.rglob('*.js'):
    text = path.read_text(encoding='utf-8', errors='ignore')
    patched = pattern.sub(lambda m: f'{m.group(1)}?v={version}{m.group(2)}', text)
    if patched != text:
        path.write_text(patched, encoding='utf-8')
        count += 1

print(f'versioned imports in {count} files (v={version})')
