"""HISTORICAL (pre-v25). Provision the full Gemma LiteRT audio/vision bundle. Never launches phone code."""
import argparse,hashlib,json,shutil,subprocess,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'payloads/benchmark'
REMOTE='/data/local/tmp/cleopatra-bench'
PACKAGE='ai.cleo.ardyavatarvalidation'

def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def fetch(item):
    path = OUT / item['file']
    if path.exists() and sha(path) == item['sha256']:
        return item['file'] + ' already verified'
    partial = path.with_suffix(path.suffix+'.partial')
    url = f"https://huggingface.co/{item['repo']}/resolve/{item['revision']}/{item['source']}"
    print('Downloading', item['file'], item['bytes'], 'bytes', flush=True)
    with urllib.request.urlopen(url, timeout=120) as source, partial.open('wb') as target:
        shutil.copyfileobj(source, target, 1024*1024)
    if partial.stat().st_size != item['bytes'] or sha(partial) != item['sha256']:
        raise ValueError('Payload hash mismatch: '+item['file'])
    partial.replace(path)
    return item['file']+' verified'

def install(adb, transport, models):
    prefix=[adb,'-t',str(transport)]
    def run(*args): return subprocess.check_output([*prefix,*args],text=True).strip()
    run('shell','mkdir','-p',REMOTE)
    files=models
    for item in files:
        source=OUT/item['file']; dest=REMOTE+'/'+source.name
        if not source.is_file() or sha(source)!=item['sha256']:
            raise ValueError('Missing or changed local payload '+str(source))
        current=run('shell',f'if [ -f {dest} ]; then sha256sum {dest}; fi')
        if not current.startswith(item['sha256']):
            subprocess.run([*prefix,'push',str(source),dest+'.partial'],check=True)
            if not run('shell','sha256sum',dest+'.partial').startswith(item['sha256']):
                raise ValueError('Phone payload hash mismatch')
            run('shell','mv',dest+'.partial',dest)
        run('shell','chmod','755' if '-server' in source.name else '644',dest)
        print('Installed and verified',source.name,flush=True)
    # App-owned runtimes read private model files without ADB at execution time.
    run('shell','run-as',PACKAGE,'mkdir','-p','files/benchmark')
    for item in models:
        if item['file'].endswith(('.litertlm','.gguf','.bin')):
            dest='files/benchmark/'+item['file']
            current=run('shell',f'run-as {PACKAGE} sh -c "if [ -f {dest} ]; then sha256sum {dest}; fi"')
            if not current.startswith(item['sha256']):
                run('shell','run-as',PACKAGE,'cp',REMOTE+'/'+item['file'],dest+'.partial')
                if not run('shell','run-as',PACKAGE,'sha256sum',dest+'.partial').startswith(item['sha256']):
                    raise ValueError('Private model hash mismatch')
                run('shell','run-as',PACKAGE,'mv',dest+'.partial',dest)
            print('App-private model verified',item['file'],flush=True)
    print('Installation only. No app, server or inference was started.')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--download',action='store_true');p.add_argument('--install',action='store_true')
    p.add_argument('--adb',default='adb');p.add_argument('--transport',type=int,required=True)
    args=p.parse_args();OUT.mkdir(parents=True,exist_ok=True)
    models=json.loads((ROOT/'benchmark/archive/models-before-llama-only.json').read_text())['models']
    if args.download:
        for model in models:print(fetch(model),flush=True)
    if args.install:install(args.adb,args.transport,models)
if __name__=='__main__':main()
