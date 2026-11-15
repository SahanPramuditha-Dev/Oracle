"""Read-only local verification-package preflight; never submits or publishes."""
import ast
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


class Links(HTMLParser):
    def __init__(self):super().__init__();self.links=[];self.scripts=0
    def handle_starttag(self, tag, attrs):
        if tag=='script':self.scripts+=1
        for key,value in attrs:
            if key in {'href','src'} and value:self.links.append(value)


def check():
    directory=ROOT/'verification-site';public=directory/'public'
    metadata=json.loads((directory/'review.json').read_text())
    config=json.loads((directory/'firebase.json').read_text())
    tree=ast.parse((ROOT/'backend/app/google_workspace.py').read_text())
    scopes=next(ast.literal_eval(node.value) for node in tree.body if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='SCOPES' for t in node.targets))
    expected={'index.html','privacy.html','terms.html','styles.css','favicon.svg'}
    files=[p for p in public.rglob('*') if p.is_file()]
    content='\n'.join(p.read_text(encoding='utf-8') for p in files)
    links_valid=True;no_scripts=True
    for page in public.glob('*.html'):
        parser=Links();parser.feed(page.read_text(encoding='utf-8'));no_scripts &= parser.scripts==0
        for link in parser.links:
            parsed=urlsplit(link)
            if parsed.scheme or link.startswith('#'):continue
            target=page.parent/(parsed.path or page.name)
            if target.is_dir():target=target/'index.html'
            links_valid &= target.resolve().is_relative_to(public.resolve()) and target.exists()
    gates={
        'only_expected_public_files':{p.relative_to(public).as_posix() for p in files}==expected,
        'hosting_boundary':(directory/config['hosting']['public']).resolve()==public.resolve(),
        'project_site_matches':config['hosting']['site']==metadata['project_id']=='oracle-5ac86',
        'scope_justifications_match_backend':set(scopes)=={item['scope'] for item in metadata['scopes']},
        'internal_links_resolve':bool(links_valid),
        'no_scripts_or_trackers':bool(no_scripts),
        'no_credential_markers':not bool(re.search(r'GOCSPX-|AIza[\w-]{20,}|-----BEGIN .*PRIVATE KEY-----|"(?:access_token|refresh_token|client_secret)"\s*:',content)),
        'no_claim_of_google_approval':'google verified' not in content.lower(),
    }
    print(json.dumps({'local_preflight':gates,'public_deployment':'not checked','google_verification':'not submitted or approved'},indent=2))
    return all(gates.values())


if __name__=='__main__':sys.exit(0 if check() else 1)
