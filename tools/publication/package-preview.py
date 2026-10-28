"""Assemble a LOCAL review candidate from an audited ZIP and fresh server/UI builds.

Never copies a running installation or user data. Never publishes. Binary licensing
is a separate required gate recorded in THIRD_PARTY.md and the manifest.
"""
import argparse
import hashlib
import json
import pathlib
import shutil
import datetime
import zipfile
import audit

ROOT=audit.ROOT

def sha(file):
    h=hashlib.sha256()
    with file.open('rb') as f:
        for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
    return h.hexdigest()

if __name__=='__main__':
    ap=argparse.ArgumentParser()
    ap.add_argument('--base',required=True)
    ap.add_argument('--base-sha256',required=True)
    ap.add_argument('--stage',required=True,help='A new, empty output directory inside release/out')
    ap.add_argument('--version', required=True)
    ap.add_argument('--fresh', required=True, help='Fresh server build staging directory')
    args=ap.parse_args()
    VERSION=args.version
    if not all(c.isalnum() or c in '.-' for c in VERSION):raise SystemExit('Invalid version')
    if audit.git('status','--porcelain','--untracked-files=no').strip():
        raise SystemExit('Commit the reviewed source before packaging')
    base=pathlib.Path(args.base).resolve();stage=pathlib.Path(args.stage).resolve()
    allowed=(ROOT/'release/out').resolve()
    if allowed not in stage.parents or stage.exists():raise SystemExit('Stage must be a NEW directory under release/out')
    if sha(base)!=args.base_sha256.lower():raise SystemExit('Audited base ZIP checksum mismatch')
    fresh=pathlib.Path(args.fresh).resolve()/'server'
    if not (fresh/'server.mjs').is_file() or not (ROOT/'ui/dist/index.html').is_file():
        raise SystemExit('Build server into .publish-audit/fresh-stage and build ui first')
    stage.mkdir(parents=True)
    static={p.relative_to(ROOT/'server/src/data').as_posix() for p in (ROOT/'server/src/data').rglob('*') if p.is_file()}
    with zipfile.ZipFile(base) as z:
        seen=set()
        for item in z.infolist():
            n=item.filename
            if n.casefold() in seen:raise SystemExit('Duplicate archive member: '+n)
            seen.add(n.casefold())
            if item.is_dir():continue
            problem=audit.sensitive_path(n)
            if problem:raise SystemExit('Rejected base member: '+n+' ('+problem+')')
            if n.startswith('server/data/') and n[len('server/data/'):] not in static:
                raise SystemExit('Unknown static server asset: '+n)
            if n.startswith('server/data/'):
                if z.read(item)!=(ROOT/'server/src/data'/n[len('server/data/'):]).read_bytes():
                    raise SystemExit('Base static asset differs from source: '+n)
            if n.startswith(('ui/','server/chunks/')) or n in ('server/server.mjs','FILE-MANIFEST.json'):continue
            destination=stage/n
            destination.parent.mkdir(parents=True,exist_ok=True)
            with z.open(item) as source,destination.open('wb') as target:shutil.copyfileobj(source,target)
    shutil.copytree(fresh,stage/'server',dirs_exist_ok=True)
    shutil.copytree(ROOT/'ui/dist',stage/'ui/dist')
    for name in ['package.json','package-lock.json']:
        shutil.copy2(ROOT/'server'/name,stage/'server'/name)
    for n in ['.env.example','portable.mjs','profile-path.mjs','create-certificate.ps1','HOT-Step.bat',
              'SHS-Music-Studio.bat','Setup.bat','Configure-LAN.bat','Configure-LAN.ps1',
              'Verify.bat','verify-portable.mjs','README.txt']:
        shutil.copy2(ROOT/'release'/n,stage/n)
    for n in ['LICENSE','THIRD_PARTY.md']:
        shutil.copy2(ROOT/n,stage/n)
    shutil.copy2(ROOT/'engine/LICENSE',stage/'engine/LICENSE')
    (stage/'licenses').mkdir(exist_ok=True)
    for n,p in [('cpp-httplib-LICENSE.txt','engine/vendor/cpp-httplib/LICENSE'),
                ('AdamW8bit-CUDA-LICENSE.txt','engine/src/train/adamw8bit_cuda_LICENSE.txt')]:
        shutil.copy2(ROOT/p,stage/'licenses'/n)
    shutil.copy2(ROOT/f'docs/publication/v{VERSION}.md',stage/'RELEASE-NOTES.md')
    shutil.copy2(ROOT/'docs/publication/BINARY-REDISTRIBUTION.md',stage/'licenses/BINARY-REDISTRIBUTION.md')
    (stage/'VERSION').write_text(VERSION,encoding='ascii')
    manifest=json.loads((stage/'release-manifest.json').read_text(encoding='utf-8'))
    manifest.update({'product':'SHS Music Studio','version':VERSION,'baseArchive':base.name,
                     'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
                     'baseArchiveSha256':sha(base),'publicationStatus':'LOCAL REVIEW CANDIDATE — binary licensing/provenance gates pending',
                     'sourceHead':audit.git('rev-parse','HEAD').decode().strip(),
                     'sourceTree':audit.git('rev-parse','HEAD^{tree}').decode().strip(),
                     'engineRebuilt':False,'serverAndUiRebuilt':True})
    manifest['engine']['correspondingSourceVerified']=False
    manifest['engine']['files']=[{'path':p.relative_to(stage).as_posix(),'sha256':sha(p)} for p in sorted((stage/'engine').rglob('*')) if p.suffix.lower() in ('.exe','.dll')]
    manifest['applicationArtifacts']=[{'path':p.relative_to(stage).as_posix(),'sha256':sha(p)} for folder in [stage/'server',stage/'ui/dist'] for p in sorted(folder.rglob('*')) if p.is_file() and 'node_modules' not in p.parts]
    (stage/'release-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    inventory=[]
    for p in sorted(stage.rglob('*')):
        if p.is_file():inventory.append({'path':p.relative_to(stage).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p)})
    (stage/'FILE-MANIFEST.json').write_text(json.dumps(inventory,indent=2)+'\n',encoding='utf-8')
    print('Prepared review candidate:',stage)
    print('Run its Verify.bat before creating the ZIP. This command never publishes.')
