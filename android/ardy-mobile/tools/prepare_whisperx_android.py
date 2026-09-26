"""Cross-compile the CTranslate2 core needed by a native WhisperX port. No phone execution."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import shutil

ROOT=Path(__file__).resolve().parents[1]
REVISION='d44d2d069eb88c7b7804da864c10c201501cb4a9'


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--ndk',type=Path,required=True);p.add_argument('--report',type=Path,required=True)
    a=p.parse_args();source=ROOT/'payloads/ctranslate2';build=ROOT/'payloads/whisperx-android'
    revision=subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip()
    if revision!=REVISION:raise ValueError('Unexpected CTranslate2 source revision')
    patch=ROOT/'benchmark/patches/ctranslate2-android.patch'
    command=['git','-C',str(source),'apply']
    if subprocess.run([*command,'--reverse','--check',str(patch)],capture_output=True).returncode:
        subprocess.run([*command,'--check',str(patch)],check=True)
        subprocess.run([*command,str(patch)],check=True)
    flags=['-G','Ninja',f'-DCMAKE_TOOLCHAIN_FILE={a.ndk}/build/cmake/android.toolchain.cmake','-DANDROID_ABI=arm64-v8a',
           '-DANDROID_PLATFORM=android-29','-DCMAKE_BUILD_TYPE=Release','-DANDROID_STL=c++_static',
           '-DCMAKE_POLICY_VERSION_MINIMUM=3.5','-DWITH_MKL=OFF','-DWITH_CUDA=OFF','-DWITH_RUY=ON',
           '-DOPENMP_RUNTIME=NONE','-DENABLE_CPU_DISPATCH=OFF','-DBUILD_CLI=OFF','-DBUILD_TESTS=OFF',f'-DCT2_SOURCE={source}']
    subprocess.run(['cmake','-S',str(ROOT/'native/whisperx'),'-B',str(build),*flags],check=True)
    with (build/'build.log').open('w',encoding='utf-8') as stream:
        subprocess.run(['cmake','--build',str(build),'--target','cleo_whisperx','-j','4'],stdout=stream,stderr=subprocess.STDOUT,check=True)
    binary=ROOT/'payloads/benchmark/libcleo_whisperx.so';shutil.copyfile(build/binary.name,binary)
    subprocess.run([str(a.ndk/'toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-strip.exe'),'--strip-unneeded',str(binary)],check=True)
    with binary.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
    receipt=dict(repository='OpenNMT/CTranslate2',revision=revision,abi='arm64-v8a',backend='Ruy CPU',file=binary.name,
                 bytes=binary.stat().st_size,sha256=digest,flags=flags,phoneExecuted=False,phoneQualified=False,
                 pipeline=['Silero VAD','CTranslate2 base.en INT8 greedy ASR','wav2vec2 INT8 CTC word alignment'],diarization=False,
                 patchSha256=hashlib.sha256(patch.read_bytes()).hexdigest())
    a.report.write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8');print(json.dumps(receipt))


if __name__=='__main__':main()
