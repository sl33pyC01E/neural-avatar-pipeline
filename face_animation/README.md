# Face animation workspace

This folder contains four candidate projects for low-resource, low-latency
voice-driven facial animation.

Launch the local comparison interface with `launch_face_lab.bat`. Its source
and current adapter status are documented in `webui\README.md`.

## Repository layout

- `webui/`: browser interface, launcher, and local inference services
- `integrations/`: small custom/native integration source kept separate from
  the upstream engine checkouts
- `assets/project_examples/`: compact generated assets owned by Face Lab
- `tools/`: reproducible asset builders
- `DEPENDENCIES.md`: upstream revisions and required local runtimes
- `CHANGELOG.md`: tested module checkpoints

The five engine directories are independent upstream repositories and are not
duplicated into this repository's history.

The launcher also starts the existing PocketTTS environment from
`C:\Users\forre\Documents\voice\pocket_tts` and warms the built-in
`anna` voice on CUDA. The WebUI can generate a local Anna WAV and pass it
directly to the selected facial driver.

The preview can switch between Zome and each selected project's own supplied
example assets. Retarget gains for eyes, head, and mouth are adjustable, and
the active rendered result can be exported as an MP4 with its voice audio.

## Target avatar

The intended target is the local high-quality Zome VRM at
`C:\Users\forre\Documents\face\vnyan\Zome.vrm`.

Zome is a 26.1 MB VRM 0.x avatar (`ゾメちゃん`, version 1.3, by Yorshka) with
74 facial morph targets. Its face includes:

- The 15 VRChat/Oculus-style visemes: `sil`, `PP`, `FF`, `TH`, `DD`, `kk`,
  `CH`, `SS`, `nn`, `RR`, `aa`, `E`, `ih`, `oh`, and `ou`
- The five standard VRM vowel expressions: `a`, `i`, `u`, `e`, and `o`
- Full and independent-eye blinking, gaze directions, brows, eye variation,
  smiles, and several emotional/special expressions

It does not expose the native Apple ARKit 52 names, but its unusually rich
morph set allows a much higher-fidelity retarget than a five-vowel VRM. The
preferred integration is a reusable ARKit-to-Zome mapping layer that preserves
the 15 visemes and maps compatible eye, brow, mouth, and affect channels.

## Projects

| Folder | Purpose | Local status |
| --- | --- | --- |
| `Audio2Face-3D-SDK` | NVIDIA Audio2Face-3D runtime SDK | CUDA/TensorRT runtime installed, SDK compiled, v3 engine built, 52-channel inference verified |
| `Audio2Face-3D` | NVIDIA's project hub and documentation | Downloaded |
| `NyxClaw-Wav2Arkit` | CPU-oriented Wav2Arkit runtime and avatar server | Dependencies and model downloaded; inference smoke test passed |
| `uLipSync` | Lightweight calibrated MFCC lip sync | Bundled female profile connected to the WebUI; inference verified |
| `LAM-Audio2Expression` | Audio-to-ARKit expression model | Original streaming checkpoint installed on GPU; inference verified |

## Wav2Arkit quick start

The Python environment is stored in `NyxClaw-Wav2Arkit/.venv`. The model is
stored in `NyxClaw-Wav2Arkit/pretrained_models/wav2arkit/`.

From PowerShell:

```powershell
cd C:\Users\forre\Documents\face\face_animation\NyxClaw-Wav2Arkit
$env:PYTHONPATH = "$PWD\src"
uv run --no-sync python -c "from wav2arkit.inference import Wav2ArkitInference; model = Wav2ArkitInference('pretrained_models/wav2arkit/wav2arkit_cpu.onnx'); print(model.get_blendshape_names())"
```

Local smoke-test result on this machine:

- Output: 30 frames x 52 ARKit blendshapes for one second of audio
- Warm load, including model warmup: about 13.2 seconds
- Warm inference for one second of audio: about 53.5 ms

The upstream package currently needs `src` on `PYTHONPATH` for direct module
imports. Its server entrypoint already runs from that source tree.

## Audio2Face-3D status

The NVIDIA SDK is compiled locally against CUDA 12.9 and TensorRT 10.13.3. The
public Audio2Face-3D v3 model is downloaded and converted to a local TensorRT
engine. Face Lab's native bridge runs the SDK's diffusion model and its bundled
Claire face solver, returning the standard 52 ARKit controls at 60 FPS.

The verified four-second test produced 240 frames. A warm WebUI request takes
about 2.5 seconds because the current bridge starts a fresh native process and
loads the model for each clip; it does not send audio or avatar data off-device.

## Verified WebUI inference

The bundled four-second speech clip was tested end to end on this machine:

| Driver | Output | Observed latency |
| --- | --- | --- |
| Wav2Arkit | 120 frames × 52 controls at 30 FPS | ~138 ms |
| Audio2Face v3 | 240 frames × 52 controls at 60 FPS | ~2.5 s |
| uLipSync | 120 frames × 6 calibrated phonemes at 30 FPS | ~53 ms |
| LAM A2E | 120 frames × 52 controls at 30 FPS | ~71–220 ms warm |
