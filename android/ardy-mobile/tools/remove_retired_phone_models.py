"""Remove fingerprint-matched Qwen/Whisper payloads after the Gemma-only update.

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
    if not version or int(version[1])<14:raise ValueError('Install the Gemma-only checkpoint before removing old models')
    old=json.loads((ROOT/'benchmark/archive/models-before-gemma-only.json').read_text())['models']
    retired=[row for row in old if 'qwen' in row['file'].lower() or row['file'].startswith('ggml-')]
    retired.append(json.loads((ROOT/'benchmark/qwen-litert/prebuilt-receipt.json').read_text()))
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
        raw=shell(command(private,f'if [ -f {shlex.quote(target)} ]; then stat -c %s {shlex.quote(target)}; sha256sum {shlex.quote(target)}; fi'))
        if not raw:missing.append(target);continue
        size,digest=raw.splitlines();digest=digest.split()[0]
        if int(size)!=row['bytes'] or digest!=row['sha256']:raise ValueError('Refusing to delete changed file: '+target)
        verified.append(dict(private=private,path=target,bytes=int(size),sha256=digest))
    gemma=next(row for row in json.loads((ROOT/'benchmark/models.json').read_text())['models'] if row['file']=='gemma-4-E2B-it.litertlm')
    preserved=shell(command(True,'sha256sum files/benchmark/gemma-4-E2B-it.litertlm')).split()[0]
    if preserved!=gemma['sha256']:raise ValueError('Full Gemma bundle did not match its manifest')
    if args.remove:
        for item in verified:
            shell(command(item['private'],'rm -- '+shlex.quote(item['path'])))
            shell(command(item['private'],'test ! -e '+shlex.quote(item['path'])))
    report=dict(time=datetime.now(timezone.utc).isoformat(),removed=args.remove,inferenceTest=False,
        appLaunched=False,originalAppTouched=False,files=verified,alreadyAbsent=missing,
        bytesRemoved=sum(item['bytes'] for item in verified) if args.remove else 0,gemmaSha256Preserved=preserved)
    args.report.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(dict(removed=args.remove,files=len(verified),bytesRemoved=report['bytesRemoved'],gemmaPreserved=True)))

if __name__=='__main__':main()
