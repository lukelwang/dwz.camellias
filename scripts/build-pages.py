"""Build the public page and one unlinked owner page from the same markup."""
from pathlib import Path
import argparse,hashlib,re

root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--manager-output',required=True,help='Existing or chosen owner page filename at the site root')
args=parser.parse_args()
if not re.fullmatch(r'studio-[a-f0-9]{12}\.html',args.manager_output):
 parser.error('Use a studio-<12 hex characters>.html filename.')
template=(root/'templates/gallery.html.template').read_text()
public=re.sub(r'<!-- OWNER_START -->.*?<!-- OWNER_END -->','',template,flags=re.S)
public=public.replace('<option value="newly-added">','<option value="newly-added" selected>')
manager=template.replace('<!-- OWNER_START -->','').replace('<!-- OWNER_END -->','')
manager=manager.replace('<meta name="referrer"','<meta name="robots" content="noindex, nofollow, nosnippet">\n  <meta name="referrer"',1)
def clean(value):
 def version(match):
  asset=root/match[2]
  if not asset.is_file(): return match[0]
  digest=hashlib.sha256(asset.read_bytes()).hexdigest()[:12]
  return match[1]+'="'+match[2]+'?v='+digest+'"'
 value=re.sub(r'(src|href)="([^"?#]+\.(?:js|css))"',version,value)
 return '\n'.join(line.rstrip() for line in value.splitlines())+'\n'
(root/'index.html').write_text(clean(public.replace('__PAGE__','gallery')))
(root/args.manager_output).write_text(clean(manager.replace('__PAGE__','manager')))
print('Built public and owner pages.')
