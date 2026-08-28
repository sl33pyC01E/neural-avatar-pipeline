# Unified Character Lab — Project Map

All paths in this map are relative to the `unified` folder. Runtime path
resolution begins at `launch.bat`; nothing below depends on the folder's parent
directory.

## Launch and coordination

```text
launch.bat
  launcher.mjs
    webui/server.mjs                 unified shell · 8788
    retargetting/motion-control-server.js
                                      ARDY motion UI/API · 8793
    face_animation/webui/backend/server.py
                                      face API · 8794
    face_animation/webui/             Face Lab UI · 8795
    face_animation/webui/backend/pocket_tts_server.py
                                      CUDA speech · 8796
    face_animation/webui/backend/lam_server.py
                                      LAM worker · 8797
    face_animation/webui/backend/audio2face_server.py
                                      Audio2Face worker · 8798
```

`launcher.mjs` validates critical files, fixes relocatable Python-environment
metadata, establishes bundled runtime paths and offline model caches, waits for
health ports, opens the WebUI, streams per-service logs, and stops the complete
process tree on exit.

## Directory layout

```text
unified/
├─ launch.bat                         user entry point
├─ launcher.mjs                       service supervisor and path resolver
├─ verify.bat / verify.mjs            read-only bundle check
├─ webui/                              unified two-tab shell
├─ face_animation/
│  ├─ webui/                           Face Lab UI, API, and worker adapters
│  ├─ NyxClaw-Wav2Arkit/               Wav2Arkit code, ONNX weights, Python env
│  ├─ LAM-Audio2Expression/            LAM code, checkpoint, Python env
│  ├─ Audio2Face-3D/                   NVIDIA Audio2Face models/assets
│  ├─ Audio2Face-3D-SDK/               SDK, native bridge, TensorRT, Python env
│  ├─ uLipSync/                        calibration/reference project
│  └─ assets/                          examples and preview resources
├─ retargetting/                       ARDY browser UI and local API server
├─ motion-models/
│  ├─ motion_worker.py                 Core-8/Core-40 persistent worker
│  ├─ models/ardy-llm2vec-4bit/         optional local text conditioner
│  ├─ constraints/                     motion constraints
│  └─ outputs/webui/                   generated motion files
├─ ardy/                               ARDY engine, MotionCorrection, Python env
├─ voice/pocket_tts/                   PocketTTS Python environment
├─ models/huggingface/hub/             offline PocketTTS and ARDY model stores
├─ vnyan/
│  ├─ Zome.vrm                         local target avatar; ignored by Git
│  └─ control-panel/spatial-retarget.js shared retargeting implementation
├─ runtime/
│  ├─ python310/                       bundled Python 3.10 runtime
│  ├─ python312/                       bundled Python 3.12 runtime/packages
│  ├─ node/                            bundled Node.js and npm
│  ├─ ffmpeg/                          bundled media tools
│  └─ cuda/v12.9/bin/                  bundled CUDA user-mode libraries
└─ logs/                               overwritten service logs
```

## Data flow

### Facial animation

```text
text or audio
  ├─ PocketTTS CUDA → speech waveform
  └─ uploaded/recorded waveform
       → common face backend
       → selected driver (Wav2Arkit | Audio2Face | uLipSync | LAM)
       → ARKit/viseme frames
       → browser VRM retargeting and preview
```

### ARDY motion

```text
route, timing, and explicit free-text or cached-embedding slots
  → motion-control server
  → persistent ARDY worker
     ├─ Core-8 batch generation
     └─ Core-40 live-window generation
  → each scheduled slot resolved independently before rollout
  → constraints / motion correction
  → meshframes + NPZ
  → direct Zome VRM retargeting and browser preview
```

## Portability boundaries

The bundle contains application-level runtimes and models. Hardware drivers,
Windows system libraries, GPU hardware, the browser itself, and browser download
storage remain operating-system resources. No Python package installation,
model download, build step, or network connection is part of normal startup.
