"""Install Cleopatra and copy the original app's verified models without launching apps.

Requires the user's authorization to install. No activity/service start, inference,
UI automation, audio playback, benchmark, uninstall or data-clear commands exist here.
Copies remain inside the separate checkpoint package; source files are read-only.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shlex
import subprocess
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'ai.cleo.ardymobile'
TARGET = 'ai.cleo.ardyavatarvalidation'


def model_path(value):
    path = PurePosixPath(value)
    if (not re.fullmatch(r'files/[a-zA-Z0-9_./-]+', value)
            or '..' in path.parts or path.is_absolute()
            or not value.startswith(('files/ardy-models/', 'files/embedding-models/'))):
        raise ValueError(f'Unexpected inventoried model path: {value}')
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--adb', required=True)
    parser.add_argument('--transport', required=True)
    parser.add_argument('--aapt2', required=True)
    parser.add_argument('--apk', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    inventory = json.loads((ROOT / 'recovery/installed-app.json').read_text(encoding='utf-8'))
    if inventory['package'] != SOURCE:
        raise ValueError('Unexpected source package')
    for entry in inventory['installedModels']:
        model_path(entry['appRelativePath'])
        if not re.fullmatch('[0-9a-f]{64}', entry['sha256']) or entry['bytes'] <= 0:
            raise ValueError('Invalid model fingerprint')
    badging = subprocess.check_output([args.aapt2, 'dump', 'badging', str(args.apk)], text=True, encoding='utf-8')
    package = re.search(r"^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging, re.M)
    if not package or package[1] != TARGET:
        raise ValueError('Only the separate Cleopatra checkpoint package may be installed')
    adb = [args.adb, '-t', args.transport]

    def shell(command):
        return subprocess.check_output([*adb, 'shell', command], text=True, encoding='utf-8', errors='replace').strip()

    def private(command):
        return shell(f'run-as {TARGET} sh -c {shlex.quote(command)}')

    def fingerprint(path):
        value = private(f'if [ -f {shlex.quote(str(path))} ]; then stat -c %s {shlex.quote(str(path))}; sha256sum {shlex.quote(str(path))}; fi')
        if not value:
            return None
        lines = value.splitlines()
        return {'bytes': int(lines[0]), 'sha256': lines[1].split()[0]}

    def version(name):
        data = shell(f'dumpsys package {name}')
        return {key: re.search(r'\b' + key + r'=([^\s]+)', data)[1] for key in ('versionCode', 'versionName')}

    original_version = version(SOURCE)
    free = int(shell('df -k /data').splitlines()[-1].split()[3]) * 1024
    required = sum(m['bytes'] for m in inventory['installedModels']) + args.apk.stat().st_size + 1024**3
    if free < required:
        raise RuntimeError(f'Not enough free device space for the checkpoint and its models ({required} bytes required)')
    with args.apk.open('rb') as stream:
        apk_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
    report = {'installedAt': datetime.now(timezone.utc).isoformat(), 'package': TARGET,
              'versionCode': int(package[2]), 'versionName': package[3], 'apkSha256': apk_hash,
              'apkBytes': args.apk.stat().st_size, 'originalPackage': SOURCE, 'originalVersion': original_version,
              'appLaunched': False, 'inferenceTest': False, 'models': [], 'complete': False}

    def save():
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')

    print(f'Installing {TARGET} {package[3]} without launching it…', flush=True)
    subprocess.run([*adb, 'install', '-r', str(args.apk)], check=True)
    report['installedVersion'] = version(TARGET)
    save()
    for entry in inventory['installedModels']:
        path = model_path(entry['appRelativePath'])
        expected = {key: entry[key] for key in ('bytes', 'sha256')}
        current = fingerprint(path)
        if current is not None and current != expected:
            raise RuntimeError(f'Refusing to replace an existing model with an unexpected fingerprint: {path}')
        if current is None:
            temporary = str(path) + '.install-partial'
            print(f'Copying within device storage: {path}', flush=True)
            private(f'mkdir -p {shlex.quote(str(path.parent))}')
            writer = shlex.quote(f'cat > {shlex.quote(temporary)}')
            # The pipeline never opens an app or copies via shared/public storage.
            shell(f'run-as {SOURCE} cat {shlex.quote(str(path))} | run-as {TARGET} sh -c {writer}')
            if fingerprint(temporary) != expected:
                private(f'rm -f {shlex.quote(temporary)}')
                raise RuntimeError(f'Copied model checksum did not match the inventoried source: {path}')
            private(f'mv {shlex.quote(temporary)} {shlex.quote(str(path))}')
        report['models'].append({'path': str(path), **expected, 'action': 'retained' if current else 'copied'})
        save()
        print(f'Verified: {path}', flush=True)
    if version(SOURCE) != original_version:
        raise RuntimeError('Original app version changed during installation')
    report['complete'] = True
    report['originalVersionUnchanged'] = True
    save()
    print('Installed and models verified. The user launches and tests the app.', flush=True)


if __name__ == '__main__':
    main()
