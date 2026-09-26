"""Read-only backup of explicitly inventoried app models for local development.

Does not install, launch, benchmark, or modify anything on the phone.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--adb', required=True)
parser.add_argument('--transport', required=True)
parser.add_argument('--include-llm2vec', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
inventory = json.loads((root / 'recovery/installed-app.json').read_text())
for model in inventory['installedModels']:
    if '.gguf' in model['appRelativePath'] and not args.include_llm2vec:
        continue
    relative = Path(model['appRelativePath']).relative_to('files')
    destination = root / 'payloads/installed-models' / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and destination.stat().st_size == model['bytes']:
        with destination.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() == model['sha256']:
                print(f'Already verified: {relative}', flush=True)
                continue
    temporary = destination.with_suffix(destination.suffix + '.partial')
    digest = hashlib.sha256()
    print(f'Copying model to development machine: {relative}', flush=True)
    command = [args.adb, '-t', args.transport, 'exec-out', 'run-as', inventory['package'], 'cat', model['appRelativePath']]
    with temporary.open('wb') as output, subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as process:
        while block := process.stdout.read(1024 * 1024):
            output.write(block)
            digest.update(block)
        error = process.stderr.read().decode(errors='replace')
        if process.wait():
            raise RuntimeError(error)
    if temporary.stat().st_size != model['bytes'] or digest.hexdigest() != model['sha256']:
        raise RuntimeError(f'Model copy did not match the installed inventory: {relative}')
    temporary.replace(destination)
    print(f'Verified: {relative}', flush=True)
