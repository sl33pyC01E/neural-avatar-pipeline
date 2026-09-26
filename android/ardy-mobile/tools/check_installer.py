"""Exercise installer failure boundaries using a fake ADB transport; no device access."""
import contextlib
import io
import json
from pathlib import Path
import shlex
import tempfile
import unittest
from unittest.mock import patch

import install_checkpoint as installer


class InstallerCheck(unittest.TestCase):
    def scenario(self, *, package=installer.TARGET, corrupt_copy=False, existing=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'recovery').mkdir()
            model = {'appRelativePath': 'files/embedding-models/ardy-llm2vec-q4_k_m.gguf',
                     'bytes': 17, 'sha256': 'a' * 64}
            (root / 'recovery/installed-app.json').write_text(json.dumps({
                'package': installer.SOURCE, 'installedModels': [model]}))
            apk = root / 'checkpoint.apk'
            apk.write_bytes(b'fake APK')
            report = root / 'report.json'
            calls, files = [], {}
            path = model['appRelativePath']
            if existing:
                files[path] = (17, 'b' * 64)
            original_files = dict(files)

            def output(command, **kwargs):
                calls.append(command)
                if command[0] == 'aapt2':
                    return f"package: name='{package}' versionCode='3' versionName='check'\n"
                self.assertEqual(command[:4], ['adb', '-t', '99', 'shell'])
                shell = command[4]
                if shell.startswith('dumpsys package '):
                    return 'versionCode=1 versionName=original'
                if shell == 'df -k /data':
                    return 'Filesystem 1K-blocks Used Available Use% Mounted\n/data 999999999 1 999999998 1% /data'
                tokens = shlex.split(shell)
                if tokens[:3] == ['run-as', installer.SOURCE, 'cat']:
                    self.assertEqual(tokens[3], path)
                    self.assertEqual(tokens[4:9], ['|', 'run-as', installer.TARGET, 'sh', '-c'])
                    writer = shlex.split(tokens[9])
                    self.assertEqual(writer[:2], ['cat', '>'])
                    files[writer[2]] = (17, ('b' if corrupt_copy else 'a') * 64)
                    return ''
                self.assertEqual(tokens[:4], ['run-as', installer.TARGET, 'sh', '-c'])
                private = shlex.split(tokens[4])
                if private[0] == 'if':
                    found = files.get(private[3])
                    return '' if found is None else f'{found[0]}\n{found[1]}  file'
                if private[0] == 'mkdir':
                    return ''
                if private[0] == 'mv':
                    files[private[2]] = files.pop(private[1])
                    return ''
                if private[:2] == ['rm', '-f']:
                    files.pop(private[2], None)
                    return ''
                self.fail(f'Unexpected device action: {shell}')

            def run(command, **kwargs):
                calls.append(command)
                self.assertEqual(command, ['adb', '-t', '99', 'install', '-r', str(apk)])

            error = None
            with patch.object(installer, 'ROOT', root), patch('sys.argv', [
                    'install_checkpoint.py', '--adb', 'adb', '--transport', '99', '--aapt2', 'aapt2',
                    '--apk', str(apk), '--report', str(report)]), \
                    patch.object(installer.subprocess, 'check_output', output), \
                    patch.object(installer.subprocess, 'run', run), contextlib.redirect_stdout(io.StringIO()):
                try:
                    installer.main()
                except (ValueError, RuntimeError) as failure:
                    error = str(failure)
            result = json.loads(report.read_text()) if report.exists() else None
            return error, files, original_files, result, calls

    def test_copy_verified_before_activation(self):
        error, files, _, report, _ = self.scenario()
        self.assertIsNone(error)
        self.assertTrue(report['complete'])
        self.assertFalse(report['appLaunched'])
        self.assertFalse(report['inferenceTest'])
        self.assertEqual(len(files), 1)
        self.assertFalse(any(name.endswith('partial') for name in files))

    def test_original_package_cannot_be_installed(self):
        error, _, _, report, calls = self.scenario(package=installer.SOURCE)
        self.assertIn('separate', error)
        self.assertIsNone(report)
        self.assertEqual(len(calls), 1, 'Package rejection must precede any ADB action')

    def test_corrupt_copy_is_not_activated(self):
        error, files, _, report, _ = self.scenario(corrupt_copy=True)
        self.assertIn('checksum', error)
        self.assertEqual(files, {})
        self.assertFalse(report['complete'])

    def test_unexpected_existing_file_is_preserved(self):
        error, files, original, report, _ = self.scenario(existing=True)
        self.assertIn('Refusing to replace', error)
        self.assertEqual(files, original)
        self.assertFalse(report['complete'])

    def test_manifest_path_cannot_escape_models(self):
        for path in ['/data/local/tmp/model', 'files/../other/model', 'files/model;id', 'files/settings.json']:
            with self.assertRaises(ValueError):
                installer.model_path(path)


if __name__ == '__main__':
    unittest.main()
