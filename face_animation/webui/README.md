# Face Lab WebUI

Face Lab is a local comparison surface for the four voice-driven animation
projects in the parent workspace. It follows the interaction structure of the
recent Ardy/Kimodo Motion Drive panel without depending on or modifying that
work.

Start it with `..\launch_face_lab.bat`. The launcher starts the local inference
backend and web interface, then opens `http://localhost:8795/`. Closing the
launcher window stops the processes it started.

The same launcher also starts the existing PocketTTS 2.1.0 environment from
`C:\Users\forre\Documents\voice\pocket_tts`. Its built-in **anna**
voice is moved to CUDA and warmed in a persistent local process, so new test
lines do not reload the model each time. The UI shows the active TTS device
beside Anna's name. Type a line, generate the WAV, then run the selected face
driver against it.

## Working adapters

- **Wav2Arkit:** runnable. Accepts uploaded or microphone audio and returns 52
  ARKit channels at 30 FPS through the local ONNX model.
- **Audio2Face:** runnable through the compiled NVIDIA Audio2Face-3D v3 SDK,
  CUDA 12.9, TensorRT 10.13.3, and the model's 52-control ARKit face solver.
- **uLipSync:** runnable through a native Python port of uLipSync v3's MFCC
  classifier using the project's bundled female calibration profile.
- **LAM A2E:** runnable through the original streaming checkpoint and PyTorch
  inference engine. Its GPU worker remains loaded between requests.

## Preview targets

- **Zome:** `C:\Users\forre\Documents\face\vnyan\Zome.vrm`
- **Wav2Arkit project example:** the official NyxClaw animated reference. The
  repository's renderer is part of its mobile client, so this reference is
  shown as the supplied animation rather than falsely presented as a local rig.
- **Audio2Face project example:** the official Claire v3 facial vertex and
  52-control data, rendered as a locally driven point face.
- **uLipSync project example:** Unity-Chan from the canonical Unity sample,
  loaded from the project's own FBX and texture assets.
- **LAM project example:** the James generated head included in LAM's sample
  output, driven directly by LAM's 51 available morph targets.

The three 52-control engines are retargeted to Zome's detailed viseme, blink,
eye, brow, and mouth morphs. uLipSync's six phoneme values map directly to
Zome's visemes. Standard VRM eye expressions are applied through the VRM
expression manager, and playback adds optional natural blinking, gaze drift,
and subtle head/neck motion. Eye, head, and mouth gains each have an adjustable
slider with editable floating-point limits. The viseme strip can be pressed
directly to inspect poses without loading audio.

**Export MP4** records the active WebGL preview at the selected driver's frame
rate, includes the loaded voice track, and converts the recording to H.264/AAC
with the local FFmpeg installation.
