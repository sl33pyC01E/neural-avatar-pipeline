"""Remove retired LiteRT/Qwen/Whisper payloads after the llama.cpp-only update.

No app/service launch, inference, UI action or recursive removal. Dry run by default.
Only task-owned checkpoint files and its named staging directories are considered.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path, PurePosixPath
import re
import shlex
import subprocess

ROOT=Path(__file__).resolve().parents[1]
PACKAGE='ai.cleo.ardyavatarvalidation'

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--adb',required=True);parser.add_argument('--transport',required=True)
    parser.add_argument('--remove',action='store_true');parser.add_argument('--report',type=Path,required=True)
    args=parser.parse_args();adb=[args.adb,'-t',args.transport]
    def shell(command):return subprocess.check_output([*adb,'shell',command],text=True,encoding='utf-8',timeout=180).strip()
    def command(private,command):return f'run-as {PACKAGE} sh -c {shlex.quote(command)}' if private else command
    version=re.search(r'\bversionCode=(\d+)',shell(f'dumpsys package {PACKAGE}'))
    if not version or int(version[1])<25:raise ValueError('Install the llama.cpp-only checkpoint before removing old models')
    old=json.loads((ROOT/'benchmark/archive/models-before-gemma-only.json').read_text())['models']
    retired=[row for row in old if 'qwen' in row['file'].lower() or row['file'].startswith('ggml-')]
    retired.append(json.loads((ROOT/'benchmark/qwen-litert/prebuilt-receipt.json').read_text()))
    retired.extend(json.loads((ROOT/'benchmark/archive/models-before-llama-only.json').read_text())['models'])
    candidates=[]
    for row in retired:
        for private,prefix in [(True,'files/benchmark/'),(False,'/data/local/tmp/cleopatra-bench/')]:
            candidates.append((private,prefix,row))
    for row in json.loads((ROOT/'benchmark/whisperx-models.json').read_text())['models']:
        for private,prefix in [(True,'files/whisperx/'),(False,'/data/local/tmp/cleopatra-whisperx/')]:
            candidates.append((private,prefix,row))
    for receipt in ['runtime-build.json','runtime-opencl.json']:
        file=ROOT/'payloads/benchmark'/receipt
        if file.exists():
            data=json.loads(file.read_text());rows=[data] if 'file' in data else data.values()
            for row in rows:
                if row['file'] in {'llama-server','llama-server-opencl','whisper-server'}:
                    candidates.append((False,'/data/local/tmp/cleopatra-bench/',row))
    verified=[];missing=[]
    for private,prefix,row in candidates:
        name=row['file'];path=PurePosixPath(name)
        if path.is_absolute() or '..' in path.parts or not re.fullmatch(r'[a-zA-Z0-9_.\-/]+',name):raise ValueError('Unsafe manifest filename')
        target=prefix+name
        raw=shell(command(private,f'if [ -L {shlex.quote(target)} ]; then exit 2; fi; if [ -f {shlex.quote(target)} ]; then stat -c %s {shlex.quote(target)}; sha256sum {shlex.quote(target)}; fi'))
        if not raw:missing.append(target);continue
        size,digest=raw.splitlines();digest=digest.split()[0]
        if int(size)!=row['bytes'] or digest!=row['sha256']:raise ValueError('Refusing to delete changed file: '+target)
        verified.append(dict(private=private,path=target,bytes=int(size),sha256=digest))
    # Verify the complete replacements before any deletion. These are read-only
    # SHA checks, never model loads. Preserve avatar/embedding files and prompt KV.
    preserved=[]
    for row in json.loads((ROOT/'benchmark/gemma-qat.json').read_text())['models']:
        target='files/benchmark/'+row['file']
        raw=shell(command(True,f'test ! -L {shlex.quote(target)} && stat -c %s {shlex.quote(target)} && sha256sum {shlex.quote(target)}'))
        size,digest=raw.splitlines();digest=digest.split()[0]
        if int(size)!=row['bytes'] or digest!=row['sha256']:raise ValueError('QAT replacement does not match its manifest: '+target)
        preserved.append(dict(path=target,bytes=int(size),sha256=digest))
    # LiteRT creates flat cache files named after the complete model filename.
    # No directory deletion: shared OpenCL caches and current KV stay intact.
    prefixes=[row['file'] for row in retired if row['file'].endswith('.litertlm')]
    listing=shell(command(True,"find cache -maxdepth 1 -type f -print"))
    for target in listing.splitlines():
        name=PurePosixPath(target).name
        if PurePosixPath(target).parent!=PurePosixPath('cache') or not re.fullmatch(r'[a-zA-Z0-9_.-]+',name):continue
        if not any(name.startswith(prefix+'.') or name.startswith(prefix+'_') for prefix in prefixes):continue
        if not name.endswith(('.bin','.xnnpack_cache')):continue
        raw=shell(command(True,f'test ! -L {shlex.quote(target)} && stat -c %s {shlex.quote(target)} && sha256sum {shlex.quote(target)}'))
        size,digest=raw.splitlines();verified.append(dict(private=True,path=target,bytes=int(size),sha256=digest.split()[0],kind='retired-model-cache'))
    if args.remove:
        for item in verified:
            target=shlex.quote(item['path'])
            # Recheck the exact file immediately before deleting it.
            observed=shell(command(item['private'],f'test ! -L {target} && sha256sum {target}')).split()[0]
            if observed!=item['sha256']:raise ValueError('File changed during cleanup: '+item['path'])
            shell(command(item['private'],'rm -- '+target))
            shell(command(item['private'],'test ! -e '+shlex.quote(item['path'])))
    report=dict(time=datetime.now(timezone.utc).isoformat(),removed=args.remove,inferenceTest=False,
        appLaunched=False,originalAppTouched=False,files=verified,alreadyAbsent=missing,
        bytesRemoved=sum(item['bytes'] for item in verified) if args.remove else 0,qatModelsPreserved=preserved)
    args.report.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(removed=args.remove,files=len(verified),bytesRemoved=report['bytesRemoved'],gemmaPreserved=True)))

if __name__=='__main__':main()
