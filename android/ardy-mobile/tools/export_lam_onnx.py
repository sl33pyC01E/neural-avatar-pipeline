"""Export the existing LAM backbone on CPU, preserving its 64-frame streaming window.

Validates ONNX output against the exact PyTorch backbone on a window from Anna's
generated audio. Postprocessing and Android audio-clock integration are separate.
Never initializes CUDA or a phone.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import wave

os.environ['CUDA_VISIBLE_DEVICES'] = ''
os.environ['HF_HUB_OFFLINE'] = '1'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', type=Path, required=True)
    p.add_argument('--audio', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--report', type=Path, required=True)
    args = p.parse_args()
    source = args.source.resolve()
    sys.path.insert(0, str(source))
    import numpy as np
    import torch
    import torchaudio
    import onnxruntime as ort
    from scipy.signal import resample_poly
    from models.network import Audio2Expression
    from models.utils import ARKitBlendShape
    torch.set_num_threads(2)
    torch.set_num_interop_threads(1)
    model = Audio2Expression(device=torch.device('cpu'),
                             pretrained_encoder_type='wav2vec',
                             pretrained_encoder_path='',
                             wav2vec2_config_path=str(source / 'configs/wav2vec2_config.json'),
                             num_identity_classes=12, identity_feat_dim=64,
                             hidden_dim=512, expression_dim=52, norm_type='ln', use_transformer=False,
                             num_attention_heads=8, num_transformer_layers=6).eval().cpu()
    checkpoint_path = source / 'pretrained_models/lam_audio2exp_streaming.tar'
    checkpoint = torch.load(checkpoint_path, map_location='cpu', weights_only=True)
    state = checkpoint.get('state_dict', checkpoint)
    state = {name.removeprefix('module.').removeprefix('backbone.'): value for name, value in state.items()}
    model.load_state_dict(state, strict=True)
    # Use eager attention for portable, explicit ONNX operations.
    model.audio_encoder.config._attn_implementation = 'eager'

    class Window(torch.nn.Module):
        def __init__(self, backbone):
            super().__init__(); self.backbone = backbone
            self.resampler = torchaudio.transforms.Resample(24000, 16000)
        def forward(self, audio, identity):
            audio16 = self.resampler(audio)[..., :34133]
            return self.backbone({'input_audio_array': audio16, 'id_idx': identity, 'time_steps': 64})

    wrapped = Window(model).eval()
    with wave.open(str(args.audio), 'rb') as wav:
        if wav.getnchannels() != 1 or wav.getsampwidth() != 2:
            raise ValueError('Expected PCM16 mono speech')
        samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype='<i2').astype(np.float32) / 32768
        rate = wav.getframerate()
    import math
    divisor = math.gcd(rate, 24000)
    samples = resample_poly(samples, 24000 // divisor, rate // divisor).astype(np.float32)
    window = 24000 * 64 // 30
    inputs = np.zeros((1, window), dtype=np.float32)
    take = min(window, len(samples)); inputs[0, -take:] = samples[:take]
    identity = np.zeros((1, 12), dtype=np.float32); identity[0, 0] = 1
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with torch.inference_mode():
        expected = wrapped(torch.from_numpy(inputs), torch.from_numpy(identity)).numpy()
        torch.onnx.export(wrapped, (torch.from_numpy(inputs), torch.from_numpy(identity)), str(args.output),
                          input_names=['audio', 'identity'], output_names=['expressions'],
                          opset_version=17, dynamo=False)
    options = ort.SessionOptions(); options.intra_op_num_threads = 2; options.inter_op_num_threads = 1
    options.add_session_config_entry('session.intra_op.allow_spinning', '0')
    session = ort.InferenceSession(str(args.output), options, providers=['CPUExecutionProvider'])
    actual = session.run(None, {'audio': inputs, 'identity': identity})[0]
    np.testing.assert_allclose(actual, expected, atol=1e-4, rtol=1e-4)
    assert actual.shape == (1, 64, 52) and np.isfinite(actual).all()
    with checkpoint_path.open('rb') as stream:
        checkpoint_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
    report = {'passed': True, 'device': 'Windows CPU', 'phoneTest': False,
              'inputSamples': window, 'sampleRate': 24000, 'backboneSampleRate': 16000, 'frames': 64, 'fps': 30,
              'resampler': 'torchaudio sinc, part of exported graph; desktop uses librosa/soxr',
              'maxAbsError': float(np.max(np.abs(actual - expected))),
              'checkpointSha256': checkpoint_hash,
              'onnxSha256': hashlib.sha256(args.output.read_bytes()).hexdigest(),
              'onnxBytes': args.output.stat().st_size, 'names': ARKitBlendShape,
              'limits': 'One speech window, raw backbone parity only. Streaming postprocessing and Android playback are not validated.'}
    args.report.write_text(json.dumps(report, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
