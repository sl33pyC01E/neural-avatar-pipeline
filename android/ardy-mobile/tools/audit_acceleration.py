"""Inspect local model graphs and recovered binaries. Does not invoke a device or inference."""
import argparse
from collections import Counter
import hashlib
import json
import re
from pathlib import Path
import zipfile

import onnx


def graph_info(path):
    model = onnx.load(path, load_external_data=False)
    def tensors(values):
        return {v.name: {
            'dtype': onnx.TensorProto.DataType.Name(v.type.tensor_type.elem_type),
            'shape': [d.dim_value if d.HasField('dim_value') else d.dim_param or '?'
                      for d in v.type.tensor_type.shape.dim]
        } for v in values}
    inputs = tensors(model.graph.input)
    return {
        'file': path.name, 'bytes': path.stat().st_size,
        'sha256': hashlib.file_digest(path.open('rb'), 'sha256').hexdigest(),
        'opsets': {o.domain or 'ai.onnx': o.version for o in model.opset_import},
        'inputs': inputs, 'outputs': tensors(model.graph.output),
        'dynamicInputs': [name for name, value in inputs.items()
                          if any(not isinstance(d, int) or d <= 0 for d in value['shape'])],
        'operators': dict(sorted(Counter((n.domain or 'ai.onnx') + ':' + n.op_type
                                        for n in model.graph.node).items())),
        'initializerDtypes': dict(Counter(onnx.TensorProto.DataType.Name(t.data_type)
                                          for t in model.graph.initializer)),
    }


def binary_info(data):
    symbols = ['QNNExecutionProvider', 'QnnExecutionProvider', 'ggml_backend_cpu_init',
               'ggml_backend_vk_init', 'ggml_backend_opencl_init', 'ggml_backend_hexagon_init']
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
            'qnnStringCount': sum(1 for value in re.findall(rb'[ -~]{10,}',data) if b'QNN' in value or b'Qnn' in value),
            'symbolStrings': {name: name.encode() in data for name in symbols}}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--models', type=Path, required=True)
    p.add_argument('--pocket', type=Path, required=True)
    p.add_argument('--apk', type=Path, required=True)
    p.add_argument('--ort-aar', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--lam', type=Path)
    a = p.parse_args()
    report = {'deviceTests': False, 'inferenceTests': False, 'models': {}, 'binaries': {}}
    for path in sorted(a.models.rglob('*.onnx')):
        report['models'][path.relative_to(a.models).as_posix()] = graph_info(path)
    for path in sorted(a.pocket.glob('*.onnx')):
        report['models']['pocket/' + path.name] = graph_info(path)
    if a.lam:report['models']['lam/'+a.lam.name]=graph_info(a.lam)
    with zipfile.ZipFile(a.apk) as apk:
        for name in apk.namelist():
            if name.startswith('lib/arm64-v8a/') and name.endswith('.so'):
                report['binaries']['installed/' + Path(name).name] = binary_info(apk.read(name))
    with zipfile.ZipFile(a.ort_aar) as aar:
        report['binaries']['stock-ort-1.24.3/libonnxruntime.so'] = binary_info(aar.read('jni/arm64-v8a/libonnxruntime.so'))
    a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({name: {'dynamicInputs': info['dynamicInputs'], 'operatorTypes': len(info['operators'])}
                      for name, info in report['models'].items()}, indent=2))


if __name__ == '__main__':
    main()
