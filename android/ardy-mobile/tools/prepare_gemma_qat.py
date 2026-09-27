"""Stage pinned Snapdragon runtime and official Google QAT weights. No inference."""
import argparse, hashlib, json, os, shutil, subprocess, tarfile, urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'payloads/gemma-qat'
SPEC=json.loads((ROOT/'benchmark/gemma-qat.json').read_text())
PACKAGE='ai.cleo.ardyavatarvalidation'
def sha(p):
    with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def fetch(url,path,size,digest):
    if path.is_file() and path.stat().st_size==size and sha(path)==digest:return
    part=path.with_suffix(path.suffix+'.partial')
    print('Downloading',path.name,flush=True)
    with urllib.request.urlopen(url,timeout=180) as src,part.open('wb') as dst:shutil.copyfileobj(src,dst,1024*1024)
    if part.stat().st_size!=size or sha(part)!=digest:raise ValueError('Hash mismatch: '+str(part))
    part.replace(path)
def runtime():
    r=SPEC['runtime'];path=OUT/'snapdragon.tar.gz';fetch(r['url'],path,r['bytes'],r['sha256'])
    dest=ROOT/'avatar-validation/app/build/generated/llamaLibs/arm64-v8a';dest.mkdir(parents=True,exist_ok=True)
    entries=[]
    needed={'libllama-server-impl.so','libllama-common.so','libmtmd.so','libllama.so','libggml.so','libggml-cpu.so','libggml-rpc.so','libggml-opencl.so','libggml-hexagon.so','libggml-base.so','libggml-htp-v73.so','libggml-htp-v75.so','libggml-htp-v79.so','libggml-htp-v81.so','llama-server'}
    # Remove obsolete files only inside this generated runtime directory.
    for old in dest.glob('*.so'):
        if old.name not in needed and old.name not in {'libcleo_llama_server.so','libcleo_llama_runner.so'}:old.unlink()
    with tarfile.open(path) as archive:
        for item in archive.getmembers():
            p=Path(item.name);name=p.name
            if not item.isfile() or name not in needed:continue
            # No broad archive extraction; write selected basenames only.
            target=dest/('libcleo_llama_server.so' if name=='llama-server' else name)
            with archive.extractfile(item) as src,target.open('wb') as dst:shutil.copyfileobj(src,dst)
            entries.append({'file':target.name,'sha256':sha(target),'bytes':target.stat().st_size})
    if not (dest/'libcleo_llama_server.so').is_file():raise ValueError('Missing server')
    sdk=Path(os.environ.get('ANDROID_HOME',str(Path.home()/'AppData/Local/Android/Sdk')))
    ndk=sdk/'ndk/29.0.14206865/toolchains/llvm/prebuilt/windows-x86_64/bin'
    runner=dest/'libcleo_llama_runner.so'
    subprocess.run([str(ndk/'clang.exe'),'--target=aarch64-linux-android29','-O2','-fPIE','-pie','-Wl,-z,max-page-size=16384',str(ROOT/'native/llama_runner.c'),'-o',str(runner)],check=True)
    entries.append({'file':runner.name,'sha256':sha(runner),'bytes':runner.stat().st_size})
    assets=ROOT/'avatar-validation/app/build/generated/llamaAssets';assets.mkdir(parents=True,exist_ok=True)
    shutil.copy2(ROOT/'benchmark/gemma-qat.json',assets/'gemma-qat.json')
    (OUT/'runtime-manifest.json').write_text(json.dumps({'runtime':r,'files':entries},indent=2)+'\n')
    print('Staged runtime:',len(entries),'files',flush=True)
def models():
    from huggingface_hub import hf_hub_download
    for m in SPEC['models']:
        path=OUT/m['file']
        if not path.exists():
            print('Downloading',m['file'],flush=True)
            hf_hub_download(m['repo'],m['file'],revision=m['revision'],local_dir=OUT)
        if path.stat().st_size!=m['bytes'] or sha(path)!=m['sha256']:raise ValueError('Hash mismatch: '+str(path))
        print('Verified',m['file'],flush=True)
def install(adb,transport):
    prefix=[adb,'-t',str(transport)]
    def run(*args):return subprocess.check_output([*prefix,*args],text=True).strip()
    run('shell','run-as',PACKAGE,'mkdir','-p','files/benchmark')
    for m in SPEC['models']:
        path=OUT/m['file'];dest='files/benchmark/'+m['file'];stage='/data/local/tmp/cleo-qat-'+m['file']
        if path.stat().st_size!=m['bytes'] or sha(path)!=m['sha256']:raise ValueError('Local hash mismatch')
        current=run('shell',f'run-as {PACKAGE} sh -c "if [ -f {dest} ]; then sha256sum {dest}; fi"')
        if not current.startswith(m['sha256']):
            subprocess.run([*prefix,'push',str(path),stage],check=True)
            run('shell','chmod','644',stage)
            run('shell','run-as',PACKAGE,'cp',stage,dest+'.partial')
            if not run('shell','run-as',PACKAGE,'sha256sum',dest+'.partial').startswith(m['sha256']):raise ValueError('Private hash mismatch')
            run('shell','run-as',PACKAGE,'mv',dest+'.partial',dest)
            run('shell','rm',stage)
        print('Private model verified:',m['file'],flush=True)
    print('Installed files only. No app or inference started.',flush=True)
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--runtime',action='store_true');p.add_argument('--models',action='store_true');p.add_argument('--install',action='store_true');p.add_argument('--adb',default='adb');p.add_argument('--transport',type=int)
    a=p.parse_args();OUT.mkdir(parents=True,exist_ok=True)
    if a.runtime:runtime()
    if a.models:models()
    if a.install:
        if not a.transport:p.error('--transport required for install')
        install(a.adb,a.transport)
