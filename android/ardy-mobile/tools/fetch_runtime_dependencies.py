"""Fetch pinned runtime/check dependencies into ignored payloads; verify every SHA-256."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import tarfile
from urllib.request import urlopen

ROOT=Path(__file__).resolve().parents[1]


def verify(path,entry):
    if not path.is_file() or path.stat().st_size!=entry['bytes']:return False
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()==entry['sha256']


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--verify-only',action='store_true');args=parser.parse_args()
    directory=ROOT/'payloads/dependencies'
    if not args.verify_only:directory.mkdir(parents=True,exist_ok=True)
    entries=json.loads((ROOT/'runtime-dependencies.json').read_text(encoding='utf-8'))['files']
    for entry in entries:
        if Path(entry['name']).name!=entry['name']:raise ValueError('Dependency name must be a basename')
        destination=directory/entry['name']
        if entry['name']=='anna.wav' and not destination.exists():
            existing=directory/'sherpa-onnx-pocket-tts-int8-2026-01-26/anna.wav'
            if verify(existing,entry):
                if args.verify_only:destination=existing
                else:shutil.copyfile(existing,destination)
        if not verify(destination,entry):
            if destination.exists() or args.verify_only:raise ValueError('Missing or modified dependency: '+str(destination))
            temporary=destination.with_name(destination.name+'.partial')
            with urlopen(entry['url'],timeout=60) as response,temporary.open('wb') as out:shutil.copyfileobj(response,out,1024*1024)
            if not verify(temporary,entry):raise ValueError('Downloaded checksum mismatch: '+entry['name'])
            temporary.replace(destination)
        print('Verified '+entry['name'],flush=True)
    if not args.verify_only:
        for name in ('sherpa-onnx-pocket-tts-int8-2026-01-26','sherpa-onnx-pocket-tts-2026-01-26'):
            with tarfile.open(directory/(name+'.tar.bz2'),'r:bz2') as package:package.extractall(directory,filter='data')
        shutil.copyfile(directory/'anna.wav',directory/'sherpa-onnx-pocket-tts-int8-2026-01-26/anna.wav')


if __name__=='__main__':main()
