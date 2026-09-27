"""Verify a portable bundle or install its APK/model files. Never starts an app."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shlex
import subprocess
import uuid

ROOT = Path(__file__).resolve().parent


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def local(name):
    path = (ROOT / name).resolve()
    if not path.is_relative_to(ROOT) or not path.is_file():
        raise ValueError('Missing or invalid bundled file: ' + name)
    return path


def check(entry):
    path = local(entry['file'])
    if path.stat().st_size != entry['bytes'] or sha(path) != entry['sha256']:
        raise ValueError('Fingerprint mismatch: ' + entry['file'])
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify', action='store_true')
    parser.add_argument('--transport', type=int)
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
    if args.verify:
        for entry in manifest['files']:
            check(entry)
        print('Verified', len(manifest['files']), 'files. No device used.')
        return
    if args.transport is None:
        parser.error('--transport is required; use toolchain/sdk/platform-tools/adb.exe devices -l')
    spec = manifest['apps']['main']
    package = spec['package']
    if package != 'ai.cleo.ardyavatarvalidation':
        raise ValueError('Unexpected target package')
    entries = {entry['file']: entry for entry in manifest['files']}
    apk = check(entries[spec['apk']])
    models = [(check(entries[m['file']]), m) for m in spec['models']]
    adb = [str(ROOT / 'toolchain/sdk/platform-tools/adb.exe'), '-t', str(args.transport)]
    def run(*command):
        return subprocess.check_output([*adb, *command], text=True, encoding='utf-8', errors='replace').strip()
    def private(command):
        return run('shell', 'run-as ' + package + ' sh -c ' + shlex.quote(command))
    print('Installing Cleopatra APK without launch', flush=True)
    subprocess.run([*adb, 'install', '-r', str(apk)], check=True)
    verified = []
    for source, model in models:
        dest = model['remote']
        if not re.fullmatch(r'files/[a-zA-Z0-9_./-]+', dest) or '..' in PurePosixPath(dest).parts:
            raise ValueError('Invalid model destination')
        entry = entries[model['file']]
        exists = private(f'if [ -f {shlex.quote(dest)} ]; then sha256sum {shlex.quote(dest)}; fi')
        if not exists.startswith(entry['sha256']):
            stage = '/data/local/tmp/unimobile-' + uuid.uuid4().hex
            partial = dest + '.partial'
            try:
                print('Copying', source.name, flush=True)
                subprocess.run([*adb, 'push', str(source), stage], check=True)
                run('shell', 'chmod', '644', stage)
                private('mkdir -p ' + shlex.quote(str(PurePosixPath(dest).parent)))
                private('cp ' + shlex.quote(stage) + ' ' + shlex.quote(partial))
                if not private('sha256sum ' + shlex.quote(partial)).startswith(entry['sha256']):
                    raise ValueError('Transferred model hash mismatch: ' + dest)
                private('mv ' + shlex.quote(partial) + ' ' + shlex.quote(dest))
            finally:
                run('shell', 'rm', '-f', stage)
        verified.append(dest)
        print('Verified', dest, flush=True)
    report = {'package': package, 'apkSha256': entries[spec['apk']]['sha256'], 'modelsVerified': verified,
              'appLaunched': False, 'modelInference': False, 'dataCleared': False}
    (ROOT / 'install-main-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print('Installation complete. Open and test the app yourself.')


if __name__ == '__main__':
    main()
