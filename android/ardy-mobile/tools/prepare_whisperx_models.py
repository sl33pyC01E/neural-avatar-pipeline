"""Pin and provision the English native WhisperX pipeline. Never runs phone inference."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'payloads/whisperx'
MANIFEST = ROOT / 'benchmark/whisperx-models.json'
SOURCES = [
    ('Systran/faster-whisper-base.en', '3d3d5dee26484f91867d81cb899cfcf72b96be6c', 'base.en',
     [('model.bin','model.bin'), ('config.json','config.json'), ('vocabulary.txt','vocabulary.txt'), ('README.md','README.md')]),
    ('Xenova/wav2vec2-base-960h', 'a19f851b3d42865797e410752b4c570c871e4825', 'alignment',
     [('onnx/model_quantized.onnx','model.onnx'), ('vocab.json','vocab.json'), ('preprocessor_config.json','preprocessor_config.json'), ('README.md','README.md')]),
    ('onnx-community/silero-vad', 'e71cae966052b992a7eca6b17738916ce0eca4ec', 'vad',
     [('onnx/model.onnx','model.onnx'), ('LICENSE','LICENSE')]),
]


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--download',action='store_true');p.add_argument('--install',action='store_true')
    p.add_argument('--adb',default='adb');p.add_argument('--transport',default='1')
    a=p.parse_args()
    if a.download:
        pinned={row['file']:row for row in json.loads(MANIFEST.read_text(encoding='utf-8'))['models']} if MANIFEST.is_file() else {}
        rows=[]
        for repo,revision,folder,files in SOURCES:
            metadata=json.load(urllib.request.urlopen(f'https://huggingface.co/api/models/{repo}/revision/{revision}?blobs=true'))
            remote={item['rfilename']:item for item in metadata['siblings']}
            for source,name in files:
                dest=OUT/folder/name;dest.parent.mkdir(parents=True,exist_ok=True)
                info=remote[source];prior=pinned.get(f'{folder}/{name}')
                if prior and (prior['repo']!=repo or prior['revision']!=revision):raise ValueError('Explicitly update the model manifest before changing revisions')
                expected=prior['sha256'] if prior else info.get('lfs',{}).get('sha256')
                if not dest.is_file() or dest.stat().st_size!=info['size'] or (expected and digest(dest)!=expected):
                    temporary=dest.with_suffix(dest.suffix+'.partial')
                    urllib.request.urlretrieve(f'https://huggingface.co/{repo}/resolve/{revision}/{source}',temporary)
                    if temporary.stat().st_size!=info['size'] or (expected and digest(temporary)!=expected):raise ValueError('Download mismatch: '+source)
                    temporary.replace(dest)
                rows.append(dict(repo=repo,revision=revision,source=source,file=f'{folder}/{name}',bytes=dest.stat().st_size,sha256=digest(dest)))
                print('Verified',folder,name,flush=True)
        MANIFEST.write_text(json.dumps(dict(language='en',asr='CTranslate2 INT8 base.en',vad='Silero',alignment='wav2vec2-base-960h INT8 ONNX',phoneQualified=False,models=rows),indent=2)+'\n',encoding='utf-8')
    if a.install:
        rows=json.loads(MANIFEST.read_text(encoding='utf-8'))['models']
        prefix=[a.adb,'-t',a.transport]
        def run(*parts):return subprocess.check_output([*prefix,*parts],text=True).strip()
        for item in rows:
            local=OUT/item['file'];remote='/data/local/tmp/cleopatra-whisperx/'+item['file'];private='files/whisperx/'+item['file']
            if digest(local)!=item['sha256']:raise ValueError('Local model mismatch')
            run('shell','mkdir','-p',remote.rsplit('/',1)[0]);run('shell','run-as','ai.cleo.ardyavatarvalidation','mkdir','-p',private.rsplit('/',1)[0])
            current=run('shell',f'if [ -f {remote} ]; then sha256sum {remote}; fi')
            if not current.startswith(item['sha256']):
                subprocess.run([*prefix,'push',str(local),remote+'.partial'],check=True)
                if not run('shell','sha256sum',remote+'.partial').startswith(item['sha256']):raise ValueError('Phone payload mismatch')
                run('shell','mv',remote+'.partial',remote)
            run('shell','run-as','ai.cleo.ardyavatarvalidation','cp',remote,private+'.partial')
            if not run('shell','run-as','ai.cleo.ardyavatarvalidation','sha256sum',private+'.partial').startswith(item['sha256']):raise ValueError('Private payload mismatch')
            run('shell','run-as','ai.cleo.ardyavatarvalidation','mv',private+'.partial',private)
        print('Provisioned WhisperX models. No phone code was launched.')


if __name__=='__main__':main()
