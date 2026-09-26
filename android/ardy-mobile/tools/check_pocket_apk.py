"""Verify the JNI callback's actual concrete method in the packaged Android DEX."""
import argparse
import hashlib
import json
import struct
import zipfile
from pathlib import Path


def concrete_methods(data, descriptor):
    def u32(offset):
        return struct.unpack_from('<I', data, offset)[0]

    def leb(offset):
        value = shift = 0
        while True:
            byte = data[offset]
            offset += 1
            value |= (byte & 127) << shift
            if byte < 128:
                return value, offset
            shift += 7

    strings = []
    for i in range(u32(56)):
        _, offset = leb(u32(u32(60) + i * 4))
        strings.append(data[offset:data.index(0, offset)].decode('utf-8', errors='replace'))
    types = [strings[u32(u32(68) + i * 4)] for i in range(u32(64))]
    for i in range(u32(96)):
        definition = u32(100) + i * 32
        if types[u32(definition)] != descriptor:
            continue
        offset = u32(definition + 24)
        counts = []
        for _ in range(4):
            value, offset = leb(offset)
            counts.append(value)
        for _ in range(counts[0] + counts[1]):
            _, offset = leb(offset)
            _, offset = leb(offset)
        result = []
        for count in counts[2:]:
            index = 0
            for _ in range(count):
                delta, offset = leb(offset)
                flags, offset = leb(offset)
                code, offset = leb(offset)
                index += delta
                _, proto, name = struct.unpack_from('<HHI', data, u32(92) + index * 8)
                prototype = u32(76) + proto * 12
                params = u32(prototype + 8)
                arguments = [] if not params else [types[struct.unpack_from('<H', data, params + 4 + p * 2)[0]] for p in range(u32(params))]
                signature = strings[name] + '(' + ''.join(arguments) + ')' + types[u32(prototype + 4)]
                if code and not flags & 0x400:
                    result.append(signature)
        return result
    return []


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apk', type=Path)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    required = 'invoke([F)Ljava/lang/Integer;'
    with zipfile.ZipFile(args.apk) as archive:
        methods = [method for name in archive.namelist() if name.endswith('.dex')
                   for method in concrete_methods(archive.read(name), 'Lai/cleo/ardymobile/PocketCallback;')]
        assert required in methods, f'Missing concrete Sherpa callback: {methods}'
        native = archive.read('lib/arm64-v8a/libsherpa-onnx-jni.so')
        assert b'([F)Ljava/lang/Integer;' in native, 'Recheck the installed JNI callback contract'
        assert b'PocketTTS only' in archive.read('assets/index.html')
        lam=json.loads(archive.read('assets/lam/manifest.json'))
        with archive.open('assets/lam/lam-window64-24k.onnx') as stream:
            assert hashlib.file_digest(stream,'sha256').hexdigest()==lam['onnxSha256'], 'LAM payload hash mismatch'
        manifest=json.loads(archive.read('assets/pocket-tts/manifest.json'))
        assert manifest['encoderRepair']['passed']
        assert manifest['files']['encoder.onnx']['sha256']==manifest['encoderRepair']['repairedSha256']
        assert manifest['encoderRepair']['repairedSha256']!='e8f2f6d301ffb96e398b138a7dc6d3038622d236044636b73d920bab85890260', 'Truncating encoder was packaged'
        for name,expected in manifest['files'].items():
            with archive.open('assets/pocket-tts/'+name) as stream:
                assert hashlib.file_digest(stream,'sha256').hexdigest()==expected['sha256'], f'Payload hash mismatch: {name}'
        assert all(name in manifest['files'] for name in ('lm_main.onnx','lm_flow.onnx','decoder.onnx'))
        unused = args.apk.stat().st_size - sum(i.compress_size for i in archive.infolist())
        assert unused < 8 * 1024**2, 'APK contains large unused ZIP space; remove only the output APK and repackage'
        web = Path(__file__).resolve().parents[1] / 'avatar-validation/web'
        for name in [file.name for file in web.iterdir() if file.suffix in ('.mjs','.html')]:
            assert archive.read('assets/' + name) == (web / name).read_bytes(), f'Stale packaged UI: {name}'
        packaged_workers={}
        for source,target in [('llama-server','libcleo_llama.so'),('llama-server-opencl','libcleo_llama_opencl.so'),('whisper-server','libcleo_whisper.so')]:
            binary=archive.read('lib/arm64-v8a/'+target)
            assert binary[:6]==b'\x7fELF\x02\x01' and struct.unpack_from('<H',binary,18)[0]==183, 'Expected ARM64 ELF executable'
            assert b'/system/bin/linker64' in binary and b'CLEO_PID=' in binary, 'Missing Android entrypoint or process identity'
            expected=(web.parents[1]/'payloads/benchmark'/source).read_bytes()
            assert binary==expected, 'Packaged runtime differs from verified cross-compile: '+source
            packaged_workers[target]=hashlib.sha256(binary).hexdigest()
    with args.apk.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    result = {'passed': True, 'concreteDexCallback': required, 'sherpaJniDescriptorMatches': True,
              'apkSha256': digest, 'apkBytes': args.apk.stat().st_size, 'lamPayloadBundled': True, 'lamPayloadHashVerified':True,'packagedWebMatchesSource': True,
              'repairedEncoderSha256':manifest['encoderRepair']['repairedSha256'],'allPocketPayloadHashesVerified':True,
              'packagedModelRuntimes':packaged_workers,
              'phoneTest': False, 'limitation': 'Verifies packaged ABI and payloads, not Android synthesis/model/browser execution.'}
    args.report.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result))
