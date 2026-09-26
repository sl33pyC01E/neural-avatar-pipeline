"""Download/build/install the phone comparison kit. Never launches phone code."""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'payloads/benchmark'
REMOTE = '/data/local/tmp/cleopatra-bench'
PACKAGE = 'ai.cleo.ardyavatarvalidation'
QWEN_LITERT = 'Qwen3.5-2B-Cleo-512-4k-int8.litertlm'

def load_qwen_litert():
    receipt=json.loads((ROOT/'benchmark/qwen-litert/prebuilt-receipt.json').read_text(encoding='utf-8'))
    quality=receipt.get('generationQuality',{})
    if (receipt.get('file')!=QWEN_LITERT or receipt.get('imageSize')!=512
        or receipt.get('visualTokens')!=256 or receipt.get('contextTokens')!=4096
        or receipt.get('graphExported') is not False or not receipt.get('usesPrebuiltGraphs')
        or not quality.get('passed') or quality.get('sha256')!=receipt.get('sha256')
        or quality.get('contextTokens')!=4096 or quality.get('imageSize')!=512):
        raise ValueError('Expected the checked premade Qwen 512-pixel / 4096-token bundle')
    source=next(row for row in json.loads((ROOT/'benchmark/models.json').read_text())['models'] if row['file']=='Qwen3.5-2B-VL_int8.litertlm')
    if receipt.get('sourceSha256')!=source['sha256']:raise ValueError('Unexpected premade Qwen source')
    return receipt

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

def timing_patch(source, name):
    patch=ROOT/'benchmark/patches'/(name+'-device-timing.patch')
    command=['git','-C',str(source),'apply']
    if subprocess.run([*command,'--reverse','--check',str(patch)],capture_output=True).returncode:
        subprocess.run([*command,'--check',str(patch)],check=True)
        subprocess.run([*command,str(patch)],check=True)
    diff=subprocess.check_output(['git','-C',str(source),'diff','--no-ext-diff','--binary'])
    if diff.replace(b'\r\n',b'\n')!=patch.read_bytes().replace(b'\r\n',b'\n'):
        raise ValueError('Unexpected runtime source modifications: '+str(source))
    return sha(patch)

def build(ndk):
    cmake = shutil.which('cmake')
    common = ['-G','Ninja',f'-DCMAKE_TOOLCHAIN_FILE={ndk}/build/cmake/android.toolchain.cmake',
        '-DANDROID_ABI=arm64-v8a','-DANDROID_PLATFORM=android-29','-DANDROID_STL=c++_static',
        '-DCMAKE_BUILD_TYPE=Release','-DBUILD_SHARED_LIBS=OFF','-DGGML_NATIVE=OFF',
        '-DGGML_OPENMP=OFF','-DGGML_LLAMAFILE=OFF','-DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod',
        '-UHAVE_DOTPROD','-UHAVE_FP16_VECTOR_ARITHMETIC']
    receipts = {}
    for name, repo, commit, target, flags in [
        ('llama','ggml-org/llama.cpp','81bc6b83f827df746eb129235488d325c49cae52','llama-server',
         ['-DLLAMA_OPENSSL=OFF','-DLLAMA_BUILD_TESTS=OFF','-DLLAMA_BUILD_APP=OFF',
          '-DLLAMA_BUILD_UI=OFF','-DLLAMA_BUILD_EXAMPLES=OFF']),
        ('whisper','ggml-org/whisper.cpp','d09f61a', 'whisper-server',
         ['-DWHISPER_BUILD_TESTS=OFF','-DWHISPER_BUILD_SERVER=ON','-DWHISPER_CURL=OFF'])]:
        source = ROOT / 'payloads' / (name+'.cpp')
        actual = subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()
        if commit and not actual.startswith(commit):
            raise ValueError('Unreviewed source revision: '+actual)
        patch_sha=timing_patch(source,name)
        directory = ROOT / 'payloads' / (name+'-android-cpu')
        subprocess.run([cmake,'-S',str(source),'-B',str(directory),*common,*flags],check=True)
        subprocess.run([cmake,'--build',str(directory),'--target',target,'-j','4'],check=True)
        dest = OUT / target
        shutil.copyfile(directory/'bin'/target,dest)
        subprocess.run([str(ndk/'toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-strip.exe'),'--strip-unneeded',str(dest)],check=True)
        receipts[name] = dict(repository=repo,commit=actual,backend='CPU',abi='arm64-v8a',
                              file=target,sha256=sha(dest),bytes=dest.stat().st_size,options=common+flags,timingPatchSha256=patch_sha)
    (OUT/'runtime-build.json').write_text(json.dumps(receipts,indent=2)+'\n')

def install(adb, transport, models):
    prefix=[adb,'-t',str(transport)]
    def run(*args): return subprocess.check_output([*prefix,*args],text=True).strip()
    run('shell','mkdir','-p',REMOTE)
    files=[*models,*json.loads((OUT/'runtime-build.json').read_text()).values()]
    if (OUT/'runtime-opencl.json').exists():files.append(json.loads((OUT/'runtime-opencl.json').read_text()))
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

def build_opencl(ndk):
    source=ROOT/'payloads/llama.cpp';directory=ROOT/'payloads/llama-android-opencl'
    headers=ROOT/'payloads/OpenCL-Headers';library=ROOT/'payloads/benchmark-builddeps/libOpenCL.so'
    actual=subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()
    if actual!='81bc6b83f827df746eb129235488d325c49cae52':raise ValueError('Unreviewed llama revision')
    patch_sha=timing_patch(source,'llama')
    options=['-G','Ninja',f'-DCMAKE_TOOLCHAIN_FILE={ndk}/build/cmake/android.toolchain.cmake',
        '-DANDROID_ABI=arm64-v8a','-DANDROID_PLATFORM=android-29','-DANDROID_STL=c++_static',
        '-DCMAKE_BUILD_TYPE=Release','-DBUILD_SHARED_LIBS=OFF','-DGGML_NATIVE=OFF','-DGGML_OPENMP=OFF',
        '-DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod','-DGGML_OPENCL=ON','-DGGML_OPENCL_EMBED_KERNELS=ON',
        f'-DOpenCL_LIBRARY={library}',f'-DOpenCL_INCLUDE_DIR={headers}',
        '-DLLAMA_OPENSSL=OFF','-DLLAMA_BUILD_TESTS=OFF','-DLLAMA_BUILD_APP=OFF','-DLLAMA_BUILD_UI=OFF','-DLLAMA_BUILD_EXAMPLES=OFF']
    cmake=shutil.which('cmake');subprocess.run([cmake,'-S',str(source),'-B',str(directory),*options],check=True)
    subprocess.run([cmake,'--build',str(directory),'--target','llama-server','-j','4'],check=True)
    dest=OUT/'llama-server-opencl';shutil.copyfile(directory/'bin/llama-server',dest)
    subprocess.run([str(ndk/'toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-strip.exe'),'--strip-unneeded',str(dest)],check=True)
    receipt=dict(repository='ggml-org/llama.cpp',commit=actual,backend='OpenCL requested; phone coverage untested',
        file=dest.name,sha256=sha(dest),bytes=dest.stat().st_size,options=options,linkLibrarySha256=sha(library),timingPatchSha256=patch_sha,
        headersCommit=subprocess.check_output(['git','-C',str(headers),'rev-parse','HEAD'],text=True).strip())
    (OUT/'runtime-opencl.json').write_text(json.dumps(receipt,indent=2)+'\n')

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--download',action='store_true');p.add_argument('--build',action='store_true')
    p.add_argument('--install',action='store_true');p.add_argument('--ndk',type=Path)
    p.add_argument('--install-runtimes-only',action='store_true')
    p.add_argument('--opencl',action='store_true',help='Build the separate S25 Adreno candidate; never runs it')
    p.add_argument('--adb',default='adb');p.add_argument('--transport',type=int,default=1)
    a=p.parse_args();OUT.mkdir(parents=True,exist_ok=True)
    models=json.loads((ROOT/'benchmark/models.json').read_text())['models']
    if a.download:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            for result in pool.map(fetch,models):print(result,flush=True)
    if a.build:
        if not a.ndk:p.error('--ndk is required for build')
        build(a.ndk)
    if a.opencl:
        if not a.ndk:p.error('--ndk is required for OpenCL build')
        build_opencl(a.ndk)
    if a.install:
        install(a.adb,a.transport,[*[model for model in models if model.get('provision',True)],load_qwen_litert()])
    elif a.install_runtimes_only:install(a.adb,a.transport,[])

if __name__=='__main__':main()
