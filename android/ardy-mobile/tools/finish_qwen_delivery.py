"""One-shot delivery of the active Spark build. Copies models, never starts phone code."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import shlex
import subprocess
import time

from prepare_benchmark import install, sha, ROOT, OUT, PACKAGE


def validate_receipt(receipt, profile):
    quality=receipt.get('generationQuality',{})
    if (receipt.get('file')!=profile['name']+'.litertlm'
        or receipt.get('profile')!=profile or not receipt.get('graphExported')
        or receipt.get('imageSize')!=profile['imageSize']
        or receipt.get('contextTokens')!=profile['contextTokens']
        or not re.fullmatch('[0-9a-f]{64}',receipt.get('sha256',''))
        or not isinstance(receipt.get('bytes'),int) or receipt['bytes']<=0
        or not receipt.get('visionParity',{}).get('passed')
        or not quality.get('passed') or quality.get('sha256')!=receipt['sha256']
        or quality.get('contextTokens')!=profile['contextTokens']
        or quality.get('imageSize')!=profile['imageSize']):
        raise ValueError('The completed export does not match the pinned, quality-checked profile')


def matching_transport(adb, serial):
    listing=subprocess.check_output([adb,'devices','-l'],text=True,timeout=15)
    for line in listing.splitlines():
        match=re.search(r'\bdevice\s.*\btransport_id:(\d+)\b',line)
        if not match:continue
        transport=match[1]
        try:
            actual=subprocess.check_output([adb,'-t',transport,'shell','getprop','ro.serialno'],text=True,timeout=15).strip()
            if actual==serial:return transport
        except (subprocess.SubprocessError,OSError):continue
    return None


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--host',default='sleepy@spark.local')
    p.add_argument('--remote-root',default='/home/sleepy/cleopatra-qwen-litert')
    p.add_argument('--adb',required=True);p.add_argument('--serial',required=True)
    p.add_argument('--max-hours',type=float,default=8)
    a=p.parse_args()
    if not 0<a.max_hours<=24:p.error('Use a bounded wait of at most 24 hours')
    if not re.fullmatch(r'[a-zA-Z0-9_.@-]+',a.host) or a.host.startswith('-'):p.error('Invalid SSH host')
    if not re.fullmatch(r'/[a-zA-Z0-9_./-]+',a.remote_root) or '..' in Path(a.remote_root).parts:p.error('Invalid remote root')
    profile=json.loads((ROOT/'benchmark/qwen-litert/profile.json').read_text())
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]*',profile['name']):raise ValueError('Invalid artifact name')
    OUT.mkdir(parents=True,exist_ok=True)
    status_path=OUT/'qwen-delivery-status.json';last_stage=None
    def state(stage,**values):
        nonlocal last_stage
        record=dict(stage=stage,date=datetime.now(timezone.utc).isoformat(),profile=profile['name'],appLaunched=False,inferenceTest=False,apkUpdated=False,**values)
        temporary=status_path.with_suffix('.partial');temporary.write_text(json.dumps(record,indent=2)+'\n');temporary.replace(status_path)
        if stage!=last_stage:print(json.dumps(record),flush=True);last_stage=stage
    def remote_json(relative):
        command='cat -- '+shlex.quote(a.remote_root+'/'+relative)
        data=subprocess.check_output(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10',a.host,command],text=True,timeout=25)
        return json.loads(data)
    deadline=time.monotonic()+a.max_hours*3600
    try:
        state('waiting-for-build')
        while True:
            if time.monotonic()>=deadline:raise TimeoutError('Timed out waiting for Spark build completion')
            try:remote=remote_json('finish-status.json')
            except (OSError,subprocess.SubprocessError,json.JSONDecodeError) as error:
                state('waiting-for-spark',error=str(error));time.sleep(30);continue
            if remote.get('profile')!=profile['name']:raise ValueError('Remote finisher is working on a different profile')
            if remote.get('stage')=='failed':raise RuntimeError('Spark build failed: '+str(remote.get('error')))
            if remote.get('stage')=='ready':break
            state('waiting-for-build',remoteStage=remote.get('stage'));time.sleep(30)
        receipt=remote_json('out/'+profile['name']+'/build-receipt.json');validate_receipt(receipt,profile)
        if remote.get('sha256')!=receipt['sha256']:raise ValueError('Build status and receipt disagree')
        target=OUT/receipt['file'];partial=target.with_suffix(target.suffix+'.partial')
        if not target.is_file() or target.stat().st_size!=receipt['bytes'] or sha(target)!=receipt['sha256']:
            state('copying-from-spark',bytes=receipt['bytes'])
            source=a.host+':'+a.remote_root+'/out/'+profile['name']+'/'+receipt['file']
            subprocess.run(['scp','-o','BatchMode=yes','-o','ConnectTimeout=10',source,str(partial)],check=True,timeout=3600)
            if partial.stat().st_size!=receipt['bytes'] or sha(partial)!=receipt['sha256']:raise ValueError('Transferred artifact checksum mismatch')
            partial.replace(target)
        (ROOT/'benchmark/qwen-litert/build-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
        date=datetime.now(timezone.utc).date().isoformat()
        (ROOT/f'validation/qwen-generation-quality-{date}.json').write_text(json.dumps(receipt['generationQuality'],indent=2)+'\n')
        state('waiting-for-phone',sha256=receipt['sha256'])
        while True:
            if time.monotonic()>=deadline:raise TimeoutError('Model saved locally; matching phone did not reconnect before the deadline')
            try:transport=matching_transport(a.adb,a.serial)
            except (OSError,subprocess.SubprocessError):transport=None
            if transport:break
            time.sleep(30)
        state('provisioning-phone',sha256=receipt['sha256'])
        # This installer only copies and hashes files. It cannot install an APK,
        # start activities/services, or invoke the inference/benchmark adapters.
        install(a.adb,transport,[receipt])
        report=dict(provisionedAt=datetime.now(timezone.utc).isoformat(),package=PACKAGE,
            file='files/benchmark/'+receipt['file'],bytes=receipt['bytes'],sha256=receipt['sha256'],
            profile=profile,complete=True,appLaunched=False,inferenceTest=False,apkUpdated=False,
            phoneQualified=False,verification='Local, staging and app-private SHA-256; native Spark generation gate passed')
        report_path=ROOT/f'validation/provisioning-qwen-litert-{date}.json'
        report_path.write_text(json.dumps(report,indent=2)+'\n')
        state('ready',sha256=receipt['sha256'],receipt=str(report_path))
    except Exception as error:
        state('failed',error=str(error));raise


if __name__=='__main__':main()
