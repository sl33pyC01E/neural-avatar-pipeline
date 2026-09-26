"""Stage Pocket/Anna and a manifest of the exact recovered Ardy/LLM2Vec models.

No download, device access, or modification of the source payloads.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import shutil

MOBILE = Path(__file__).resolve().parents[1]
FILES = ('lm_flow.int8.onnx', 'lm_main.int8.onnx', 'encoder.onnx', 'decoder.int8.onnx',
         'text_conditioner.onnx', 'vocab.json', 'token_scores.json', 'anna.wav', 'LICENSE', 'README.md')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pocket', type=Path, required=True)
    parser.add_argument('--lam-model', type=Path, required=True)
    parser.add_argument('--lam-report', type=Path, required=True)
    parser.add_argument('--lam-source', type=Path, required=True)
    args = parser.parse_args()
    destination = MOBILE / 'avatar-validation/app/build/generated/runtimeAssets'
    pocket = destination / 'pocket-tts'
    pocket.mkdir(parents=True, exist_ok=True)
    manifest = {'voice': 'anna', 'voiceSource': 'https://huggingface.co/kyutai/tts-voices/resolve/main/vctk/p228_023_enhanced.wav',
                'runtime': 'sherpa-onnx 1.13.8', 'modelExport': 'pocket-tts-int8-2026-01-26', 'files': {}}
    for name in FILES:
        source = args.pocket / name
        with source.open('rb') as stream:
            digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        shutil.copyfile(source, pocket / name)
        manifest['files'][name] = {'bytes': source.stat().st_size, 'sha256': digest}
    encoded = json.dumps(manifest, indent=2) + '\n'
    (pocket / 'manifest.json').write_text(encoded, encoding='utf-8')
    (MOBILE / 'validation/pocket-payload-2026-09-25.json').write_text(encoded, encoding='utf-8')
    # The imported files are identified by content, not an ambiguous decoder.onnx filename.
    models = {
        'ardy-models/core8-onnx/denoiser.onnx': 'b1c7f632622db28033a8092de3386eedec57ae478c8d2a602a0d4d9643874b3d',
        'ardy-models/core8-onnx/decoder.onnx': '8facfe5cb3cdd1a88db77d65ef9d1c1c18a5deaa3f72c2b5fe17c5564ac8b053',
        'ardy-models/core40-onnx/denoiser.onnx': 'c0745f310b373c93858eb02bb7f30bae0ee139258e608ef4a317e8882e9bfac3',
        'ardy-models/core40-onnx/decoder.onnx': '5a9ba4e1d1f537c61f91d63d63685f7f2176dffc8b9dd12cc88783d205987d2e',
        'embedding-models/ardy-llm2vec-q4_k_m.gguf': '60ec43402975a1fa520c7c05193c02e63d793f0311a0f7e59cd17690ebca5fd4',
    }
    (destination / 'import-models.json').write_text(json.dumps(models, indent=2)+'\n', encoding='utf-8')
    lam_report=json.loads(args.lam_report.read_text(encoding='utf-8'))
    if not lam_report['passed'] or lam_report['sampleRate']!=24000:
        raise ValueError('A passing 24 kHz LAM export/parity report is required')
    with args.lam_model.open('rb') as stream:
        if hashlib.file_digest(stream,'sha256').hexdigest()!=lam_report['onnxSha256']:
            raise ValueError('LAM model/report mismatch')
    constants={}
    for item in ast.parse((args.lam_source/'models/utils.py').read_text(encoding='utf-8')).body:
        if isinstance(item,ast.Assign) and isinstance(item.targets[0],ast.Name):
            name=item.targets[0].id
            if name in ('ARKitBlendShape','ARKitLeftRightPair','MOUTH_BLENDSHAPES'):constants[name]=ast.literal_eval(item.value)
    names=constants['ARKitBlendShape']
    lam_report['mouthIndices']=[names.index(name) for name in constants['MOUTH_BLENDSHAPES']]
    lam_report['symmetricPairs']=[[names.index(a),names.index(b)] for a,b in constants['ARKitLeftRightPair']]
    lam=destination/'lam';lam.mkdir(exist_ok=True)
    shutil.copyfile(args.lam_model,lam/'lam-window64-24k.onnx')
    shutil.copyfile(args.lam_source/'LICENSE',lam/'LICENSE')
    (lam/'manifest.json').write_text(json.dumps(lam_report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'pocketFiles': len(FILES), 'bytes': sum(f['bytes'] for f in manifest['files'].values()), 'destination': str(destination)}))


if __name__ == '__main__':
    main()
