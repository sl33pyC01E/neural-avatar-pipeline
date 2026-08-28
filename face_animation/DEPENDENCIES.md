# Local dependency manifest

The Face Lab integration is tracked by the top-level repository. The model
engines remain independent upstream Git checkouts because they contain large
weights, virtual environments, compiled runtimes, and generated samples.

| Folder | Upstream | Pinned local revision | Runtime role |
| --- | --- | --- | --- |
| `Audio2Face-3D` | `NVIDIA/Audio2Face-3D` | `4d61b6b` | NVIDIA model documentation and hub |
| `Audio2Face-3D-SDK` | `NVIDIA/Audio2Face-3D-SDK` | `1ca0f02` | Compiled CUDA/TensorRT solver and Claire rig |
| `LAM-Audio2Expression` | `aigc3d/LAM_Audio2Expression` | `02a703c` | GPU ARKit-expression inference and James example |
| `NyxClaw-Wav2Arkit` | `myned-ai/nyxclaw` | `fa5088e` | CPU ONNX Wav2Arkit inference and official demo |
| `uLipSync` | `hecomi/uLipSync` | `0605879` | MFCC profile and Unity-Chan example assets |

## External local runtimes

- Zome VRM: local user-supplied avatar, intentionally excluded from Git
- PocketTTS: `C:\Users\forre\Documents\voice\pocket_tts`
- FFmpeg: resolved from the local `PATH` for MP4 encoding
- NVIDIA GPU runtime: CUDA 12.9 and TensorRT 10.13.3

The root `.gitignore` intentionally excludes the five upstream folders. Their
downloaded models and build outputs stay in place locally but are not duplicated
inside the Face Lab history.
