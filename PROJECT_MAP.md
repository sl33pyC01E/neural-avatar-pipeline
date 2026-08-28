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
├─ LICENSE / NOTICE                    Apache-2.0 integration license
├─ DEPENDENCIES.md                     portable environment contract
├─ dependency-manifest.json            runtime/source/environment topology
├─ payload-manifest.json               model revisions and SHA-256 hashes
├─ requirements/                       exact Python base/overlay locks
├─ setup-environments.ps1              local environment reconstruction
├─ VALIDATION_PLAN.md                   staged QA, benchmark, demo protocol
├─ CONTROL_API.md                      local LLM command protocol and examples
├─ webui/                              four-workspace application shell
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
├─ voice/pocket_tts/                   local PocketTTS overlay; ignored
├─ models/huggingface/hub/             local offline model store; ignored
├─ vnyan/Zome.vrm                      local avatar convention; ignored
├─ runtime/                            Python, Node, FFmpeg, CUDA payloads
├─ logs/                               service logs; ignored
└─ legacy/                             removed face drivers; local/ignored only
```

The portable Python layout is layered rather than flat. `runtime/python312`
contains the shared CUDA PyTorch base; `ardy/.venv` and `voice/pocket_tts`
inherit it while shadowing incompatible packages. LAM is isolated under its
source folder on `runtime/python310`. All paths stay below `unified`, and the
launcher rewrites the three `pyvenv.cfg` files when the project is moved.

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

### Live full flow

```text
permanent cached embeddings
  → nickname / idle / stack manager
  → manual arrow cycling + timed embedding cues
  → one active key (or idle fallback) ────────────────┐
grid + timed X/Z endpoints → live path steering ─────┤
WASD temporary override ─────────────────────────────┤
                                                     ↓
          resident ARDY Core-40 rolling horizons ─────┐
                                                      ├─ continuous VRM output
manual text or timed speech cues
  → PocketTTS Anna → waveform → LAM frames ──────────┘
```

The live workspace reuses the same ARDY/VRM player used by Unified Character
instead of opening another WebGL context. Embedding tensors are loaded by cache
key, retained by the live worker after first use, and swapped at the next ARDY
replan. Speech lines are prepared sequentially and can queue while the current
line plays. All timed cues use a session clock that begins after the first ARDY
horizon is ready. Scheduled speech is dispatched into the live pipeline at cue
time; it is not prerendered. Path steering replans from the reported live root
position, so releasing a WASD override resumes the route rather than resetting
the character. Speech, embedding, and walk-path loops have independent cycle
clocks. Path looping synthesizes a final return-to-origin endpoint and rearms
only the route; speech waits for its own scheduled queue before repeating, and
embedding cues repeat on their own interval. None restarts the resident models.

Live camera framing has two independent references: a face/torso/hips/full
position target and a world/face/torso/feet direction anchor. Direction is
computed as rotation away from each VRM bone's captured rest orientation, so
avatar-specific rest axes do not leak into the camera. Face and torso use their
matching humanoid rotations; feet average both projected foot directions and
fall back to hips when needed. Camera yaw, manual drag, and auto orbit are stored
as a relative offset around the selected anchor.

The unified server also owns a loopback JSON command bus. An LLM reads the
self-describing schema and current WebUI snapshot, submits an idempotent command,
then polls its result. The browser applies validated commands through the same
live-flow functions used by human controls and reports updated state back to the
server; no arbitrary code is evaluated.

## Repository boundaries

The Git repository contains the integration layer, not a redistributable model
bundle. Ignored local paths hold models, environments, generated output, and the
user-supplied avatar. The `raw` branch preserves the earlier multi-driver source
snapshot. Removed local engines are retained under ignored `legacy/` paths and
are not started or referenced by `master`.
