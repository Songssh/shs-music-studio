"""Read-only publication checks. Reports paths and line numbers, never secret values.

python tools/publication/audit.py --history --zip path/to/package.zip
Python 3.10+, Git; output is private, ignored .publish-audit/.
This complements Gitleaks and visual review; it is not a proof of no secrets.
"""
import argparse
import collections
import hashlib
import json
import pathlib
import re
import subprocess
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / '.publish-audit'
PATTERNS = {
    'private-key': re.compile(rb'-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----'),
    'github-token': re.compile(rb'\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{50,255})\b'),
    'aws-access-id': re.compile(rb'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b'),
    'huggingface-token': re.compile(rb'\bhf_[A-Za-z0-9]{30,}\b'),
    'openai-token': re.compile(rb'\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}\b'),
    'credential-url': re.compile(rb'https?://[^\s/:"<>]+:[^\s/@"<>]{4,}@'),
}
PRIVATE_SUFFIXES = ('.db', '.db-wal', '.db-shm', '.db-journal', '.sqlite', '.sqlite3',
                    '.pfx', '.p12', '.pem', '.key', '.crt', '.cer', '.jks', '.keystore')
WEIGHTS = ('.gguf', '.safetensors', '.pt', '.pth', '.onnx', '.bf16')

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

def write(name, value):
    OUT.mkdir(exist_ok=True)
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

def sensitive_path(name):
    p = pathlib.PurePosixPath(name.replace('\\', '/'))
    n = p.name.lower()
    parts = [s.lower() for s in p.parts]
    if '..' in parts or p.is_absolute() or (parts and ':' in parts[0]):
        return 'unsafe archive path'
    if 'auth-private' in parts or '.aws' in parts or '.ssh' in parts:
        return 'private authentication directory'
    if n in ('bootstrap-token', 'session-secret', 'portable.json', '.env'):
        return 'local configuration or authentication secret'
    if n.startswith('.env.') and n not in ('.env.example', '.env.docker') and not n.endswith('.example'):
        return 'local environment configuration'
    if n.endswith(PRIVATE_SUFFIXES):
        return 'database, certificate or key'
    if n.endswith(WEIGHTS):
        return 'model weights'
    if n.endswith('.log'):
        return 'development/runtime log'
    if re.search(r'(credentials|browser-session|storage-state).*\.json$', n):
        return 'account or browser session file'
    return None

def source_exclusion(name):
    if name.startswith('tools/auth-dev/'):
        return 'machine-specific operational snapshot and live account test tooling'
    if name.startswith('docs/implementation/'):
        return 'local implementation evidence, account screenshots and machine paths'
    if name.startswith('Essentia/') and name.endswith('.exe'):
        return 'prebuilt third-party executable; provenance/licensing review required'
    return sensitive_path(name)

def matches(data):
    found=[]
    for rule, pat in PATTERNS.items():
        for m in pat.finditer(data):
            # Pattern definitions themselves do not contain actual credential values.
            found.append({'rule':rule, 'line':data.count(b'\n',0,m.start())+1})
    return found

def current():
    names=sorted(set(git('ls-files','-z','--cached','--others','--exclude-standard').decode('utf-8').split('\0'))-{''})
    accepted=[]; excluded=[]; findings=[]
    for name in names:
        reason=source_exclusion(name)
        if reason:
            excluded.append({'path':name,'reason':reason});continue
        p=ROOT/name
        if not p.is_file():
            continue  # Gitlinks are listed separately, never traversed.
        accepted.append(name)
        for f in matches(p.read_bytes()): findings.append({'path':name,**f})
    (OUT/'public-files.txt').write_text('\n'.join(accepted)+'\n',encoding='utf-8')
    write('source-exclusions.json',excluded)
    write('current-scan.json',{'files':len(accepted),'findings':findings})
    ignored=git('ls-files','--others','--ignored','--exclude-standard','--directory','-z').decode('utf-8').split('\0')
    (OUT/'ignored-paths.txt').write_text('\n'.join(sorted(n for n in ignored if n))+'\n',encoding='utf-8')
    print(json.dumps({'sourceFiles':len(accepted),'excludedTrackedOrCandidate':len(excluded),'contentFindings':len(findings)}))

def history():
    raw=git('rev-list','--objects','--all','--reflog','--missing=print').decode('utf-8')
    if any(l.startswith('?') for l in raw.splitlines()): raise RuntimeError('Missing Git objects; hydrate before auditing')
    names={l.split(' ',1)[0]:l.split(' ',1)[1] for l in raw.splitlines() if ' ' in l}
    # Include local unreachable objects too. No object deletion or history rewrite.
    objects=git('cat-file','--batch-all-objects','--batch-check=%(objectname) %(objecttype) %(objectsize)').decode().splitlines()
    proc=subprocess.Popen(['git','cat-file','--batch'],cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE)
    count=0; size=0; binary=0; findings=[]; paths=[]
    try:
        for obj in objects:
            oid,kind,length=obj.split(); length=int(length)
            if kind!='blob':continue
            proc.stdin.write((oid+'\n').encode());proc.stdin.flush()
            header=proc.stdout.readline().decode().split()
            if len(header)!=3:raise RuntimeError('Failed reading object '+oid)
            data=proc.stdout.read(int(header[2]));proc.stdout.read(1)
            count+=1;size+=len(data);binary+=b'\x00' in data[:8192]
            name=names.get(oid,'<unreachable-or-unmapped>')
            reason=sensitive_path(name)
            if reason:paths.append({'object':oid,'path':name,'reason':reason})
            for f in matches(data):findings.append({'object':oid,'path':name,**f})
    finally:
        proc.stdin.close();proc.wait()
    report={'shallow':git('rev-parse','--is-shallow-repository').decode().strip(),
            'headCommits':int(git('rev-list','--count','HEAD')),
            'allRefCommits':int(git('rev-list','--count','--all')),
            'objects':len(objects),'blobsScanned':count,'bytesScanned':size,
            'binaryBlobsScannedForSignatures':binary,'pathFindings':paths,'contentFindings':findings}
    write('history-object-scan.json',report)
    print(json.dumps({k:v for k,v in report.items() if not k.endswith('Findings')}))

def archive(file):
    file=pathlib.Path(file).resolve();findings=[];paths=[];inventory=[];total=0
    digest=hashlib.file_digest(file.open('rb'),'sha256').hexdigest() if hasattr(hashlib,'file_digest') else None
    if digest is None:
        h=hashlib.sha256()
        with file.open('rb') as f:
            for chunk in iter(lambda:f.read(8*1024*1024),b''):h.update(chunk)
        digest=h.hexdigest()
    with zipfile.ZipFile(file) as z:
        seen=set()
        for info in z.infolist():
            name=info.filename
            if name.casefold() in seen:raise RuntimeError('Duplicate archive path: '+name)
            seen.add(name.casefold())
            if info.is_dir():continue
            reason=sensitive_path(name)
            if reason:paths.append({'path':name,'reason':reason})
            # Reading every member also verifies its ZIP CRC. Binary signatures included.
            data=z.read(info);total+=len(data)
            for f in matches(data):findings.append({'path':name,**f})
            inventory.append({'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
    report={'file':file.name,'sha256':digest,'bytes':file.stat().st_size,'entries':len(inventory),
            'uncompressedBytesScanned':total,'pathFindings':paths,'contentFindings':findings}
    write(file.stem+'-audit.json',report);write(file.stem+'-inventory.json',inventory)
    print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--history',action='store_true');parser.add_argument('--zip',action='append',default=[])
    args=parser.parse_args();OUT.mkdir(exist_ok=True);current()
    if args.history:history()
    for file in args.zip:archive(file)
