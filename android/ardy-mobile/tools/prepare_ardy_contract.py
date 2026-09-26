"""Extract FSQ history constants from the exact installed decoders; no inference."""
import hashlib
import json
from pathlib import Path
import numpy as np
import onnx
from onnx import numpy_helper

ROOT = Path(__file__).resolve().parents[1]
HASHES = {
    'core8': '8facfe5cb3cdd1a88db77d65ef9d1c1c18a5deaa3f72c2b5fe17c5564ac8b053',
    'core40': '5a9ba4e1d1f537c61f91d63d63685f7f2176dffc8b9dd12cc88783d205987d2e',
}

def main():
    dest = ROOT / 'avatar-validation/app/src/main/assets/ardy-contract'
    dest.mkdir(parents=True, exist_ok=True)
    for profile, expected in HASHES.items():
        path = ROOT / f'payloads/installed-models/ardy-models/{profile}-onnx/decoder.onnx'
        digest = hashlib.file_digest(path.open('rb'), 'sha256').hexdigest()
        if digest != expected:
            raise ValueError(f'{profile}: unexpected decoder')
        graph = onnx.load(path).graph
        constants = {n.output[0]: numpy_helper.to_array(n.attribute[0].t)
                     for n in graph.node if n.op_type == 'Constant'}
        # Fail closed if the decoder export topology differs from the audited prefix.
        ops = [n.op_type for n in graph.node[:15]]
        assert ops == ['Constant','Mul','Constant','Constant','Add','Constant',
                       'Constant','Clip','Constant','Mul','Round','Sub','Add','Constant','Div']
        assert list(graph.node[1].input) == ['latent_tokens', '/Constant_output_0']
        std = constants['/Constant_output_0']
        mean = constants['/Constant_2_output_0']
        half = constants['/Constant_5_output_0']
        assert std.shape == mean.shape == half.shape == (128,)
        assert np.all(std > 0) and np.all(half > 0)
        assert np.array_equal(half, constants['/Constant_6_output_0'])
        value = dict(decoderSha256=digest, normalized=True, levels=(half*2).tolist(),
                     mean=mean.tolist(), std=std.tolist(), halfWidth=half.tolist())
        (dest / f'{profile}.json').write_text(json.dumps(value, indent=2)+'\n')
        print(profile, digest, '128 normalized FSQ dimensions')

if __name__ == '__main__':
    main()
