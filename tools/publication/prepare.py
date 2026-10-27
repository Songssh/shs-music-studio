"""Prepare a review tree and source ZIP without changing HEAD or the normal index.

Run after audit.py and source review. No commit, branch, tag or network operation.
The eventual public commit uses the audited, filtered history in a separate bare
repository. The development branch and ordinary Git index remain intact.
"""
import hashlib
import json
import os
import pathlib
import subprocess
import zipfile
import audit

ROOT = audit.ROOT
OUT = audit.OUT
BASE = '82945e027cfce38602768fdb323236808d47f5bb'
VERSION = '0.1.0-preview'

def command(*args, data=None):
    return subprocess.check_output(['git',*args],cwd=ROOT,env=env,input=data)

if __name__ == '__main__':
    OUT.mkdir(exist_ok=True)
    history=OUT/'public-history.git'
    if not history.is_dir():
        raise SystemExit('Prepare and audit the separate filtered public-history.git first; never use raw upstream history')
    audit.current()
    if json.loads((OUT/'current-scan.json').read_text(encoding='utf-8'))['findings']:
        raise SystemExit('Unreviewed source signatures; resolve before preparing')
    names=(OUT/'public-files.txt').read_text(encoding='utf-8').splitlines()
    exclusions=json.loads((OUT/'source-exclusions.json').read_text(encoding='utf-8'))
    env={**os.environ,'GIT_INDEX_FILE':str(OUT/'publication.index')}
    command('read-tree','HEAD')
    # Only this reviewed allowlist is forced: upstream has tracked files below
    # ignored directories. Never use add -f . or include ignored discoveries.
    command('--literal-pathspecs','add','-f','--pathspec-from-file=-','--pathspec-file-nul',data='\0'.join(names).encode('utf-8')+b'\0')
    for item in exclusions:
        command('update-index','--force-remove','--',item['path'])
    tree=command('write-tree').decode().strip()
    # Transfer only this source tree and its blobs, never the original commits.
    pack=command('pack-objects','--stdout','--revs',data=(tree+'\n').encode())
    subprocess.run(['git','--git-dir',str(history),'index-pack','--stdin'],input=pack,check=True,stdout=subprocess.DEVNULL)
    parent=subprocess.check_output(['git','--git-dir',str(history),'rev-parse','refs/heads/auth/login-baseline']).decode().strip()
    records=command('ls-files','--stage','-z').decode('utf-8').split('\0')
    entries=[];links=[]
    for record in filter(None,records):
        meta,name=record.split('\t',1);mode,oid,stage=meta.split()
        if mode=='160000':links.append({'path':name,'commit':oid})
        else:entries.append((name,oid))
    destination=ROOT/'release/out'/f'SHS-Music-Studio-v{VERSION}-source.zip'
    destination.parent.mkdir(parents=True,exist_ok=True)
    prefix=f'SHS-Music-Studio-v{VERSION}-source/'
    # Read from frozen Git blobs, not the mutable worktree. No local .git/config.
    batch=subprocess.Popen(['git','cat-file','--batch'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE)
    try:
        with zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
            for name,oid in entries:
                batch.stdin.write((oid+'\n').encode());batch.stdin.flush()
                header=batch.stdout.readline().decode().split()
                if len(header)!=3 or header[1]!='blob':raise RuntimeError('Missing source blob: '+name)
                data=batch.stdout.read(int(header[2]));batch.stdout.read(1)
                z.writestr(prefix+name,data)
            z.writestr(prefix+'SUBMODULES.json',json.dumps(links,indent=2)+'\n')
    finally:
        batch.stdin.close();batch.wait()
    summary={'version':VERSION,'originalHead':command('rev-parse','HEAD').decode().strip(),
             'originalUpstreamBase':BASE,'publicationParent':parent,'tree':tree,'sourceFiles':len(entries),
             'gitlinks':links,'sourceArchive':destination.name,
             'sourceSha256':hashlib.sha256(destination.read_bytes()).hexdigest(),
             'normalIndexUnchanged':True,'commitCreated':False,'pushed':False}
    audit.write('prepared-tree.json',summary)
    (OUT/'publication.diff').write_bytes(command('diff','--cached','--binary',BASE))
    (OUT/'publication-changes.txt').write_bytes(command('diff','--cached','--name-status',BASE))
    (OUT/'publication-vs-head.txt').write_bytes(command('diff','--cached','--name-status','HEAD'))
    print(json.dumps(summary,indent=2))
