"""Finish and gate the owned Spark export after an already-running decoder job."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import time


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-dir',type=Path,required=True)
    parser.add_argument('--wait-pid',type=int)
    args=parser.parse_args();work=args.work_dir.resolve()
    profile=json.loads((work/'profile.json').read_text());name=profile['name']
    out=work/'out'/name;container='cleopatra-qwen-build'
    def state(stage,**extra):
        value=dict(stage=stage,date=datetime.now(timezone.utc).isoformat(),profile=name,phoneExecuted=False,**extra)
        (work/'finish-status.json').write_text(json.dumps(value,indent=2)+'\n');print(json.dumps(value),flush=True)
    def run(command,log):
        with (work/log).open('w') as stream:subprocess.run(command,stdout=stream,stderr=subprocess.STDOUT,check=True)
    try:
        if args.wait_pid:
            state('waiting-for-decoder',pid=args.wait_pid)
            command=Path('/proc')/str(args.wait_pid)/'cmdline'
            while command.exists():
                try:active=command.read_bytes()
                except FileNotFoundError:break
                if b'/qwen35vl_work/export_qwen35vl_decoder.py' not in active:break
                time.sleep(30)
        if not (out/'decoder/export_result.json').is_file():raise RuntimeError('Decoder export did not produce its completion receipt')
        state('packaging')
        run(['docker','exec',container,'/work/venv/bin/python','/work/build_qwen_litert.py','--work-dir','/work','--profile','/work/profile.json','--template','/work/chat.jinja','--stage','package'],'package-build.log')
        # The container creates the receipt as root. Only this owned receipt
        # needs host write access for the native quality gate to attach results.
        subprocess.run(['docker','exec',container,'chown','--reference=/work/profile.json',f'/work/out/{name}/build-receipt.json'],check=True)
        state('generation-quality')
        run([str(work/'quality-venv/bin/python'),str(work/'check_qwen_litert_quality.py'),str(out/(name+'.litertlm')),
             '--converter',str(work/'converter'),'--tokenizer',str(work/'source'/profile['sourceRevision']/'tokenizer.json'),
             '--report',str(work/'generation-quality.json'),'--build-receipt',str(out/'build-receipt.json')],'generation-quality.log')
        receipt=json.loads((out/'build-receipt.json').read_text())
        if not receipt.get('generationQuality',{}).get('passed'):raise RuntimeError('The export quality gate did not pass')
        state('ready',artifact=str(out/(name+'.litertlm')),sha256=receipt['sha256'],bytes=receipt['bytes'])
        subprocess.run(['docker','stop',container],check=True)
    except Exception as error:
        state('failed',error=str(error));raise


if __name__=='__main__':main()
