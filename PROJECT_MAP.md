# Neural Avatar Pipeline — Project Map

All paths are relative to the repository root. Runtime paths are derived from
the location of `launch.bat`; the active pipeline does not read the original
Face, Voice, or Retargetting workspaces.

## Launch and services

```text
launch.bat
  launcher.mjs
    webui/server.mjs                              unified shell · 8788
    retargetting/motion-control-server.js         ARDY UI/API · 8793
    face_animation/webui/backend/server.py        face API/export · 8794
    face_animation/webui                          LAM face UI · 8795
    face_animation/webui/backend/pocket_tts_server.py
                                                   PocketTTS CUDA · 8796
    face_animation/webui/backend/lam_server.py    LAM worker · 8797
```

`launcher.mjs` validates required local payloads, repairs copied environment
metadata, sets bundled runtime and offline model paths, waits for service ports,
opens the WebUI, records logs, and terminates the process trees it started.

## Directory layout

```text
unified/
├─ launch.bat                         user entry point
├─ launcher.mjs                       service supervisor/path resolver
├─ verify.bat / verify.mjs            read-only bundle inventory
├─ webui/                              three-tab application shell
├─ face_animation/
│  ├─ webui/app/                       PocketTTS + LAM face interface
│  ├─ webui/backend/server.py          face status, avatar, MP4 export
│  ├─ webui/backend/lam_server.py      LAM inference adapter
│  ├─ webui/backend/pocket_tts_server.py
│  │                                   Anna speech worker
│  └─ LAM-Audio2Expression/            local upstream checkout; ignored
├─ retargetting/                       ARDY UI, schedule, VRM playback
├─ motion-models/
│  ├─ motion_worker.py                 persistent Core-8/Core-40 worker
│  ├─ models/ardy-llm2vec-4bit/         local text encoder; ignored
│  ├─ constraints/                     motion constraints
│  └─ outputs/webui/                   generated clips; ignored
├─ ardy/                               ARDY engine and MotionCorrection
├─ voice/pocket_tts/                   local PocketTTS environment; ignored
├─ models/huggingface/hub/             local offline model store; ignored
├─ vnyan/Zome.vrm                      local avatar convention; ignored
├─ runtime/                            Python, Node, FFmpeg, CUDA payloads
├─ logs/                               service logs; ignored
└─ legacy/                             removed face drivers; local/ignored only
```

## Data flow

### Voice and facial animation

```text
text ── PocketTTS Anna ──┐
uploaded/recorded audio ─┴─ waveform
                            → LAM Audio2Expression
                            → ARKit expression frames
                            → VRM retargeting and preview
                            → optional face-only MP4
```

### Body motion

```text
route + duration + constraints + explicit prompt slots
  → free-text embedding or permanent cached embedding
  → persistent ARDY worker
      ├─ Core-8 batch generation
      └─ Core-40 live-window generation
  → motion correction
  → motion frames
  → VRM retargeting and preview
```

### Unified playback

```text
latest audio/face track + face start offset ─┐
latest ARDY track + motion start offset ─────┼─ synchronized VRM playback
                                             └─ viewport + audio MP4 export
```

## Repository boundaries

The Git repository contains the integration layer, not a redistributable model
bundle. Ignored local paths hold models, environments, generated output, and the
user-supplied avatar. The `raw` branch preserves the earlier multi-driver source
snapshot. Removed local engines are retained under ignored `legacy/` paths and
are not started or referenced by `master`.
