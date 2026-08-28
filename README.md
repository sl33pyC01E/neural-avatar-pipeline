# Neural Avatar Pipeline

Neural Avatar Pipeline is a local Windows workspace for generating synchronized
speech, facial animation, and full-body character motion. The default pipeline
uses PocketTTS for the voice, LAM Audio2Expression for ARKit facial motion, and
both ARDY runtimes for body motion. A unified timeline can play the generated
tracks together and export the result as an MP4.

The application is designed to run offline once its local runtimes, models, and
avatar have been supplied. Those large or separately licensed payloads are not
included in the Git repository.

## Default pipeline

| Stage | Component | Role |
| --- | --- | --- |
| Voice | PocketTTS 2.1.0, `anna` preset | CUDA speech synthesis |
| Face | LAM Audio2Expression | Audio-to-ARKit facial animation |
| Body, batch | ARDY Core-8 | Complete prompted motion clips |
| Body, live | ARDY Core-40 | Longer-horizon interactive motion |
| Text conditioning | Quantized LLM2Vec | Free-text and cached motion embeddings |
| Character | User-supplied VRM | Local preview and export target |

The interface has four persistent workspaces:

- **Facial Animation** generates or accepts speech, runs LAM, previews the
  facial track on the VRM, and exports facial animation with audio.
- **ARDY VRM Motion** creates batch or live body motion. It supports explicit
  timed prompt slots and permanently cached text embeddings.
- **Unified Character** schedules the latest face/voice and motion tracks at
  independent start times, previews them on one character, and exports the
  combined result as MP4.
- **Live Full Flow** keeps ARDY Core-40 running under WASD control while queued
  PocketTTS speech is passed through LAM and played with synchronized facial
  animation on the same character.

## Quick start

### Portable local bundle

1. Put an appropriately licensed VRM at `vnyan/Zome.vrm`, or update the local
   avatar configuration to point to another file inside the project.
2. Double-click `launch.bat`.
3. Keep the launcher window open while using the application at
   <http://127.0.0.1:8788/>.
4. Close the launcher window or press `Ctrl+C` to stop every service it owns.

The supplied launcher resolves paths relative to its own folder. A complete
local bundle can therefore be copied to another Windows location without
referring to the original Face, Voice, or Retargetting projects.

### Git source checkout

A Git clone contains the integration code, UI, configuration, documentation,
and small assets. It intentionally excludes model weights, Python and Node
installations, virtual environments, CUDA libraries, generated output, and VRM
avatars. To run a source checkout, populate the ignored runtime/model locations
with legally obtained copies of the upstream dependencies described in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

The current launcher expects a Windows 10/11 x64 system with a compatible
NVIDIA GPU and display driver. The complete portable build carries its own
application-level Python, Node.js, FFmpeg, CUDA user-mode libraries, and model
payloads; the system GPU driver remains an external requirement.

## Basic workflow

### 1. Generate speech and a face track

Open **Facial Animation**. Enter text for Anna, upload audio, or record from a
microphone. Select **Generate LAM animation** to compute an ARKit expression
track. The preview includes adjustable eye, head, and mouth gains plus optional
natural gaze and blinking. Use **Export MP4** when a face-only render is wanted.

### 2. Generate body motion

Open **ARDY VRM Motion** and choose the batch or live runtime:

- Core-8 produces a complete clip from the route, duration, constraints, and
  prompt schedule.
- Core-40 supports the live-window workflow while preserving its own controls.

Timed prompts use explicit rows: a floating-point start time on the left and
either a free-text prompt or cached-embedding selector on the right. Add rows
with the plus button. Free-text rows are embedded independently before rollout.
With cached input enabled, each row references the selected saved embedding
directly and does not require the prompt text to remain in the input box.

### 3. Combine the tracks

Open **Unified Character** after both source clips exist. Give the face and body
tracks independent offsets. Two zero offsets start them together; for example,
a face offset of `0` and motion offset of `5.0` starts body motion five seconds
after the face/voice track. Preview the result, then export the composed viewport
and speech track as MP4.

### 4. Run the live full flow

Open **Live Full Flow** and use the embedding manager before starting a session:

1. Create permanent embeddings from exact motion prompts and optionally give
   each one a short nickname. Existing tensors are reused instead of recomputed.
2. Choose one embedding as the idle fallback.
3. Add any embeddings you want to swap between to the control stack.
4. Optionally add timed speech, embedding, and walk-path cues.
5. Start the live session, then use WASD to control locomotion.

Up/Down moves the stack highlight. Right activates the highlighted embedding;
Left releases it, allowing the idle embedding to take over. Only one stack item
is active at a time because ARDY accepts one conditioning tensor per live
horizon. Nicknames can be changed without altering the saved tensor, and cache
entries can be permanently deleted from the manager.

The three cue lists share a clock that begins when Core-40's first motion
horizon is ready—not while the model is warming up. A speech row has a start
time and spoken line. An embedding row has a start time and cached selection,
including an explicit return to idle. A walk-path row gives an arrival time and
an X/Z endpoint in metres relative to the session origin. Add as many rows as
needed with the plus buttons. WASD temporarily overrides scheduled steering;
releasing the keys resumes pursuit of the current endpoint from the character's
actual position. Manual arrow-key embedding changes remain available between
scheduled cues.

The walk-path grid mirrors the ARDY route planner: click to add snapped
endpoints, or focus the grid and use WASD for 0.25-metre steps. Edit generated
arrival times and X/Z values in the rows below the grid. Arrival times are
calculated from segment distance and the current move-speed setting. Undo,
Clear, and Fit operate on the same endpoint list. With **Loop scheduled run**
enabled, the planner adds a dashed final leg
back to the origin. Once the character reaches origin and queued speech is
finished, the session clock resets and every speech and embedding cue is armed
for the next cycle. Holding WASD pauses that restart until manual control is
released.

Enter speech and press Enter or **Speak**. PocketTTS generates Anna's audio,
LAM computes its face track, and the prepared result is queued for synchronized
playback without stopping the live body-motion stream. Multiple submitted lines
are prepared in order and play sequentially. Scheduled lines enter this same
live queue at their cue times; they are not prerendered when the session starts.
New embeddings are intentionally created while the live session is stopped so
loading the text encoder cannot interrupt Core-40 replanning.

## Local services

| Port | Service |
| --- | --- |
| 8788 | Unified application shell |
| 8793 | ARDY motion UI and API |
| 8794 | Face API and MP4 export |
| 8795 | Facial Animation UI |
| 8796 | PocketTTS CUDA worker |
| 8797 | LAM Audio2Expression worker |

The launcher refuses to adopt an unrelated or stale process already occupying
a required port. CUDA workers also watch the launcher that owns them so an
abnormal shutdown does not intentionally leave a model service behind.

## Repository layout

- `webui/` — unified four-workspace shell and live-flow controller
- `face_animation/` — LAM face UI, API, and worker adapter
- `retargetting/` — ARDY browser UI, scheduler, VRM playback, and local API
- `motion-models/` — ARDY worker, constraints, and generated motion interface
- `ardy/` — ARDY engine integration for both Core-8 and Core-40
- `launcher.mjs` / `launch.bat` — portable service supervisor and entry point
- `PROJECT_MAP.md` — service and data-flow map
- `THIRD_PARTY_NOTICES.md` — upstream licenses, attribution, and citations

`legacy/` exists only in the maintainer's local working copy and is ignored by
Git. It contains the facial drivers removed from the default pipeline.

## Branches

- `master` is the public default: PocketTTS + LAM + ARDY Core-8/Core-40.
- `raw` preserves the original multi-driver research workspace before the
  default pipeline was reduced.

## Avatar and model policy

No Zome VRM—or any other avatar—is distributed in this repository. The default
local filename is retained only as a configuration convention. Model weights,
voice assets, gated base models, and generated media remain subject to their
respective upstream terms. Review the notices before copying or distributing a
portable bundle.

## Attribution

This project integrates work from NVIDIA Toronto AI Lab, 3D AIGC, Kyutai,
McGill NLP, three.js, pixiv, and their contributors. License details, model
terms, pinned revisions, and publication citations are collected in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
