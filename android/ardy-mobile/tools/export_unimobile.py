"""Create the Windows x64 portable Android handoff. No inference or phone actions."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--toolchain', action='store_true')
    parser.add_argument('--jdk', type=Path, default=Path('C:/Program Files/Android/Android Studio/jbr'))
    parser.add_argument('--sdk', type=Path, default=Path.home() / 'AppData/Local/Android/Sdk')
    args = parser.parse_args()
    out = args.output.resolve()
    if out == ROOT or out.is_relative_to(ROOT):
        raise ValueError('Export must be a separate directory')
    out.mkdir(parents=True, exist_ok=True)
    owner = out / '.unimobile-export'
    if any(out.iterdir()) and not owner.is_file():
        raise ValueError('Refusing to merge into an unrelated existing directory')
    owner.write_text('Cleopatra portable Android handoff\n', encoding='utf-8')
    project = out / 'project'
    def copy(source, dest):
        source, dest = Path(source), Path(dest)
        if source.is_file():
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.is_file() and source.stat().st_size == dest.stat().st_size and source.stat().st_mtime_ns == dest.stat().st_mtime_ns:
                return
            shutil.copy2(source, dest)
        else:
            shutil.copytree(source, dest, dirs_exist_ok=True, copy_function=copy,
                ignore=shutil.ignore_patterns('build', '.gradle', '__pycache__', '*.pyc', 'local.properties', '*.lock', '*.lck', '*.keystore', '*.jks', '*.log'))
    copy(ROOT / 'avatar-validation', project / 'avatar-validation')
    copy(ROOT / 'native', project / 'native')
    copy(ROOT / 'portable', out)
    for folder in ('assets', 'lib'):
        copy(ROOT / 'recovery' / folder, project / 'recovery' / folder)
    copy(ROOT / 'recovery/llm2vec-gguf-metadata.json', project / 'recovery/llm2vec-gguf-metadata.json')
    for path in (ROOT / 'tools').glob('*'):
        if path.is_file() and not any(x in path.name.lower() for x in ('qwen','whisper','run_phone','check_device','benchmark','inspect_litert','finish_')):
            copy(path, project / 'tools' / path.name)
    for path in ROOT.glob('*.md'):
        copy(path, project / path.name)
    copy(ROOT / 'benchmark/gemma-qat.json', project / 'benchmark/gemma-qat.json')
    copy(ROOT / 'runtime-dependencies.json', project / 'runtime-dependencies.json')
    for name in ('gemma-protocol-v26.json','prompt-tree-v26.json','motion-library-v26.json','apk-v26.json','portable-v26.json','install-main-v26.json'):
        if (ROOT / 'validation' / name).is_file():copy(ROOT / 'validation' / name, project / 'validation' / name)
    if (ROOT / 'validation/desktop-motion-v26/result.json').is_file():copy(ROOT / 'validation/desktop-motion-v26/result.json', project / 'validation/desktop-motion-v26.json')
    generated = ROOT / 'avatar-validation/app/build/generated'
    payload = project / 'payloads'
    copy(ROOT / 'payloads/avatarAssets', payload / 'avatarAssets')
    for folder in ('pocket-tts', 'lam'):
        copy(generated / 'runtimeAssets' / folder, payload / 'runtimeAssets' / folder)
    copy(generated / 'runtimeAssets/import-models.json', payload / 'runtimeAssets/import-models.json')
    for folder in ('llamaLibs','llamaAssets'):
        copy(generated / folder, payload / folder)
    for name in ('sherpa-onnx-static-link-onnxruntime-1.13.8.aar', 'json-20250517.jar'):
        copy(ROOT / 'payloads/dependencies' / name, payload / 'dependencies' / name)
    copy(ROOT / 'payloads/installed-models', payload / 'installed-models')
    if (ROOT/'payloads/native-sources').exists():copy(ROOT/'payloads/native-sources',payload/'native-sources')
    for path in (ROOT / 'payloads/gemma-qat').glob('*'):
        if path.suffix in ('.gguf','.json'):copy(path, payload / 'gemma-qat' / path.name)
    props = project / 'avatar-validation/gradle.properties'
    props.write_text((ROOT / 'avatar-validation/gradle.properties').read_text(encoding='utf-8') + '\nportablePayloadRoot=../payloads\n', encoding='utf-8')
    copy(ROOT / 'avatar-validation/app/build/outputs/apk/debug/app-debug.apk', out / 'dist/Cleopatra-v26.apk')
    if args.toolchain:
        print('Copying isolated Windows build tools and offline dependency cache', flush=True)
        copy(args.jdk, out / 'toolchain/jdk')
        for folder in ('platform-tools','platforms/android-36','build-tools/35.0.0','licenses'):
            copy(args.sdk / folder, out / 'toolchain/sdk' / folder)
        gradle = Path.home() / '.gradle'
        for folder in ('wrapper/dists/gradle-8.11.1-bin','caches/modules-2/files-2.1','caches/modules-2/metadata-2.107'):
            copy(gradle / folder, out / 'toolchain/gradle-home' / folder)
        py = Path.home() / 'AppData/Local/Programs/Python/Python312'
        for file in py.iterdir():
            if file.is_file() and (file.suffix in ('.dll','.exe') or file.name == 'LICENSE.txt'):
                copy(file, out / 'toolchain/python' / file.name)
        for folder in ('Lib','DLLs'):
            shutil.copytree(py / folder, out / 'toolchain/python' / folder, dirs_exist_ok=True, copy_function=copy,
                ignore=shutil.ignore_patterns('site-packages','__pycache__','*.pyc','test','tests','idlelib','tkinter','ensurepip'))
        copy(Path('C:/Program Files/nodejs/node.exe'), out / 'toolchain/node/node.exe')
        copy(ROOT / 'portable/docs/licenses/Node-LICENSE.txt', out / 'toolchain/node/LICENSE')
    apps = {'main': {'package':'ai.cleo.ardyavatarvalidation','apk':'dist/Cleopatra-v26.apk','models':[]}}
    original = json.loads((ROOT / 'recovery/installed-app.json').read_text(encoding='utf-8'))
    for item in original['installedModels']:
        relative = item['appRelativePath'].removeprefix('files/')
        apps['main']['models'].append({'file':'project/payloads/installed-models/' + relative,'remote':item['appRelativePath']})
    spec = json.loads((ROOT / 'benchmark/gemma-qat.json').read_text(encoding='utf-8'))
    for item in spec['models']:
        apps['main']['models'].append({'file':'project/payloads/gemma-qat/' + item['file'],'remote':'files/benchmark/' + item['file']})
    files = []
    print('Fingerprinting the distributable files', flush=True)
    for path in sorted(out.rglob('*')):
        rel = path.relative_to(out)
        if not path.is_file() or path.name in ('manifest.json', '.unimobile-export') and len(rel.parts)==1:
            continue
        if 'build' in rel.parts or '.gradle' in rel.parts or '__pycache__' in rel.parts or path.suffix in ('.lock','.lck') or rel.parts[0]=='toolchain':
            continue
        if path.name.startswith(('install-main-report','install-omni-report','portable-build')):continue
        with path.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
        files.append({'file':rel.as_posix(),'bytes':path.stat().st_size,'sha256':digest})
    # Validate large recovered/published payloads against their independent provenance.
    indexed={x['file']:x for x in files}
    for item in original['installedModels']:
        actual=indexed['project/payloads/installed-models/'+item['appRelativePath'].removeprefix('files/')]
        assert (actual['bytes'],actual['sha256']) == (item['bytes'],item['sha256'])
    for item in spec['models']:
        actual=indexed['project/payloads/gemma-qat/'+item['file']]
        assert (actual['bytes'],actual['sha256']) == (item['bytes'],item['sha256'])
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    dirty=bool(subprocess.check_output(['git','status','--porcelain','--','.'],cwd=ROOT,text=True).strip())
    manifest={'format':1,'sourceRepository':'https://github.com/sl33pyC01E/neural-avatar-pipeline','sourceCommit':commit,'sourceHasUncommittedChanges':dirty,
              'host':'Windows x64','androidAbi':'arm64-v8a','apps':apps,'files':files,'phoneTest':False,
              'toolchainIntegrity':'Build tools copied locally; artifact SHA-256 list covers project, models, docs and shipped APKs.'}
    (out / 'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    (out / '.gitignore').write_text('project/payloads/\ntoolchain/\ndist/\n**/build/\n**/.gradle/\n**/local.properties\n*.keystore\n*.jks\n',encoding='utf-8')
    print('Exported',len(files),'files;',round(sum(x['bytes'] for x in files)/2**30,2),'GiB plus toolchain:',out,flush=True)


if __name__ == '__main__':
    main()
