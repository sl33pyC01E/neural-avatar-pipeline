# Ardy Mobile: Cleopatra integration

This branch continues the existing **Ardy Mobile** Android application,
`ai.cleo.ardymobile`, using the installed phone build as the recovery reference.
The target avatar is `Zome_Cleopatra_v1.vrm`.

## Latest checkpoint: 0.6.0 · Gemma avatar

Gemma 4 E2B now uses LiteRT CPU/GPU with the full audio/vision bundle. Qwen,
Whisper, WhisperX and the chat llama.cpp workers are removed from the app and
active provisioning/benchmark commands. Ardy's independent GGUF LLM2Vec encoder
and cached embedding bank remain available in tab 5.

Answers and Gemma-provided reasoning stream in tabs 7–9. Reasoning starts
collapsed. Browser remains tab 8; **tab 9 · Cleopatra** loads Gemma, live Ardy,
Pocket/Anna, LAM and the VRM together. The `avatar_stage` tool selects a cached
text embedding to steer live Ardy generation, a supported expression, and the
speech cue/tail. The final answer feeds the scheduled audio/face/body pipeline.
The default VRM stance lowers the arms and slightly bends the elbows; idle
rendering still sleeps. See [Gemma avatar](GEMMA_AVATAR.md).

The original Ardy app is preserved. Host checks and build results do not qualify
phone inference, model coexistence, voice quality or timing. The agent can install;
the user launches and tests. The cancelled Spark Qwen build must stay stopped.

### Retained avatar controls from 0.4.3

Tab 5 adds two-finger panning alongside one-finger orbit and pinch zoom, plus a
Reset view button. Pan is a separate offset from Ardy root following, and the
body/face views retain their own framing. Cancelled touches and hidden views clear
the active gesture.

**VRM appearance** has exposure, contrast, saturation, fill/key light and tone
mapping controls. Settings save locally and apply across avatar tabs. Balanced
uses softer lighting and neutral highlight compression; Original restores the
previous look. Color grading runs in the VRM materials, without an extra render
pass or changes to the avatar asset. Idle views still stop rendering.

The six-tab checkpoint now schedules body, voice and face on a shared audio clock
and corrects four Ardy history/mask/decoder contracts. See
[scheduled takes](SCHEDULED_TAKES.md) and [the contract audit](ARDY_CONTRACT_AUDIT.md).
The checkpoint is installed for the user's visual/audio/model test; the original app and
its models are retained. Desktop checks do not establish phone quality or speed.

The [measurement kit](benchmark/README.md) compares Gemma LiteRT CPU/GPU with
image/audio scores under matched idle and active avatar workloads. The user runs
phone tests; the agent must not invoke the benchmark launcher.

## Agreed scope

1. Preserve Core-8 and Core-40 and the existing on-device LLM2Vec GGUF backend.
2. Preserve the user-verified real-time baseline: **Core-40, one rolling batch,
   cached text embeddings**. Retargeting and display must not block generation.
3. Retarget the generated motion correctly onto Cleopatra, including root
   placement, facing, body proportions, limb alignment, and continuous playback.
4. Keep a clean, reproducible Ardy baseline once phone validation passes.
5. Build the larger application separately in its own repository afterward.

## Current implementation instructions

The user approved the avatar appearance and controls on 2026-09-25. Keep them.
On 2026-09-26 the user clarified: **the agent may install; the user tests**.
Build and validate on the development machine, then install the separate
checkpoint and provision verified models. Do not launch phone apps, run phone
inference/benchmarks, play audio, or automate phone controls. The user launches
the installed app and reports the results. Keep the original Ardy installation.

The user reported a speech-preparation crash, then approved Pocket and LAM and
expanded the debug sequence to these nine tabs:

1. **Welcome:** navigation to the modules.
2. **PocketTTS:** Anna speech and runtime settings.
3. **LAM:** replay the last Pocket clip using the playback clock, with independent eye/mouth/head amplitudes.
4. **Speak + Face:** face view and text input, using tabs 2/3 settings.
5. **Ardy:** cached embeddings, live/batched generation and creation of new embeddings.
6. **Together:** the combined scheduled body/voice/face pipeline and opt-in repeating benchmark workload.
7. **Models:** Gemma chat, image/audio input, CPU/GPU and reasoning settings, streamed text and metrics.
8. **Browser:** embedded Google browser, screenshot/action loop, follow-up input and pause/stop controls.
9. **Cleopatra:** Gemma replies through live Ardy, Pocket/Anna, LAM and the VRM; explicit Load all and bounded avatar tools.

Only after the modules work independently should their tabs collapse into a debug
menu behind a real product frontend. Quantization and compilation are authorized
where they improve size/speed; preserve Anna and verify quality and compatibility.
See [the Pocket debug checkpoint](POCKET_DEBUG.md) for the crash evidence and current limits.

The intended lifecycle is continuous availability with aggressive idle sleep:
retain useful model sessions within a configurable memory budget, avoid dummy
RAM reservations, stop generation/render/audio work when idle, and persist enough
state to recover from Android memory reclamation. Memory-pressure callbacks
should trim cached models safely. No permanent wake lock or periodic idle polling.

## Cleopatra product direction

Once Cleopatra's VRM is updated, optimized, and correctly retargeted to Ardy's
core body, package a neat, fully self-contained AI Android app named
**Cleopatra** in its own repository.

The intended components are:

- Ardy Core-8 and Core-40 for motion;
- the compatible 4-bit GGUF LLM2Vec encoder and a precached steering bank;
- the Cleo/Cleopatra VRM avatar;
- PocketTTS for speech output;
- **Gemma 4 E2B** on LiteRT for text, vision and direct audio (current direction);
- a small OpenCode/OpenClaw-style agent scaffold;
- potentially ChromaDB for persistent storage.

Gemma provides vision and direct audio input. Browser grounding uses normalized
0–1000 coordinates relative to the captured viewport. The 1000-coordinate
convention does not require a 1000×1000 input image. The full audio/vision bundle
is retained; image allocation is fixed by the LiteRT artifact. Agent scaffolding
and persistent storage remain future work.
See [the acceleration assessment](ACCELERATION.md) for model-specific GPU/NPU
options and the evidence separating available backends from verified execution.

## Recovered baseline

The S25 Ultra's installed APK was copied and inspected on 2026-09-25. Its version
is `0.1.0-stored-embeddings` (version code 1), last updated on September 10.

`recovery/installed-app.json` records the installed APK, signing certificate,
model file sizes and SHA-256 hashes, and the target VRM fingerprint.
`recovery/apk-inventory.json` fingerprints every file inside the APK.

The phone already contains:

- Core-8 ONNX denoiser and decoder, with an 8-frame generation horizon;
- Core-40 ONNX denoiser and decoder, with a 40-frame generation horizon;
- `ardy-llm2vec-q4_k_m.gguf`, a Llama 3 based LLM2Vec conversion producing
  4,096-dimensional features;
- the native `libardy_llm2vec.so` embedding backend;
- 141 bundled cached embedding vectors, plus separately stored user embeddings.

Both motion profiles run at 20 motion frames per second. Core-40 therefore
produces two seconds per generation horizon. The real-time result above is the
user's established result, not a new benchmark performed during recovery.

The installed avatar renderer uses baked mesh/texture assets and a 21-bone
retarget rig, rather than loading an arbitrary VRM file. The original Zome render
and retarget metadata is retained under `recovery/assets/vrm`. Cleopatra's node
hierarchy, rest transforms, skin joint lists, humanoid mappings, and expression
mappings match the desktop original. The replacement renderer loads her complete
VRM directly and uses proper rotational skinning; it does not use the old baked
mobile skin assets.

## Recovery contents and limits

- `recovery/java`: the app's 27 Java files recovered with JADX 1.5.6.
- `recovery/lib`: the exact installed native LLM2Vec library.
- `recovery/assets/ardy-runtime`: the exact runtime metadata and normalization,
  skeleton, and skinning data.
- `recovery/assets/sample-cache` and `embedding-bank`: the shipped embedding bank.
- `recovery/llm2vec-gguf-metadata.json`: metadata read from the installed GGUF.

The decompiled Java is an inspection reference. It has not been rebuilt or
verified as equivalent source; JADX emitted warnings in several methods. Keep
this snapshot unchanged and implement the buildable application separately.
The original JNI C++ source, export scripts, and original Gradle project have
not yet been located.

The complete original APK is backed up locally at the path in
`recovery/installed-app.json`. ONNX/GGUF weights, avatar geometry/textures, APKs,
and signing keys are not committed. The APK inventory makes these payloads
verifiable without adding them to this source repository.

The installed signing certificate differs from the currently available desktop
and Spark default debug certificates. Before updating the installed package,
recover the matching signing key. The separate avatar validation package below
is available for reversible device testing in the meantime. Do not
uninstall the working app or clear its model/embedding storage.

## Desktop retargeting reference and phone checkpoint

The shared Unified/Zome/Ardy reference is `retargetting/motion-control.js`:
`captureVrmRig`, `applyVrmNormalizedJoints`, and `vrmRootHeight`. Its body-facing
fix is documented in `retargetting/MOTION_DRIVE_EXPERIMENTS.md`. The original
checkout's unrelated capture additions are not copied into this worktree.

Inspection found that the recovered APK's `ArdySkinView.updateVrmMesh` only adds
weighted joint-position displacements to rest vertices and leaves normals
unchanged. It never applies bone rotation or inverse-bind skin matrices. The
sampler computes local source rotations, but its result discards them before
the VRM renderer. This explains a concrete missing part of the mobile port;
replacing the avatar payload alone cannot fix it.

[`avatar-validation`](avatar-validation/README.md) is now a buildable offline
Android checkpoint using Cleopatra's full VRM and the actual desktop retargeter.
It was installed on the S25 Ultra as **Cleopatra · Avatar Check**. CPU checks
passed all 64 recovered motion frames and all 53 humanoid bones with exactly
matching original Zome/Cleopatra transforms. Compaction reduced drawable vertices
from 253,533 to 144,860 with zero change in tested skinned positions. The original
49.6 MB asset remains essentially the same size on disk; the meaningful reduction
is the runtime geometry, not a claimed texture or APK compression.

Initial phone replay settled around 120 display fps with approximately 3 ms
CPU frame p95. This is short-run replay evidence, not a new combined inference
benchmark or a claim that the final app is fully tuned. Live generation,
long-run thermals, dynamic clothing/hair, foot contact and rolling continuity
still require integration and device qualification.

## Next implementation checkpoints

The checkpoint separates the debug modules into tabs. Pocket runs alone on tab 2;
tab 3 prepares LAM facial animation from the last completed Anna clip, then replays
the same PCM with audio-clock synchronization and independent amplitude controls.
Tab 1 is Welcome, tab 4 combines speech and face, tab 5 holds rolling Ardy and
the embedding submenu, and tab 6 runs Together. The user's quality report
led to repairing an encoder export that cropped Anna's conditioning to 1.04 seconds
and correcting the distinction between raw callbacks and finalized pause-shortened
audio. See `POCKET_DEBUG.md` for evidence and the remaining perceptual checks.
See `SCHEDULED_TAKES.md` for tab 6's shared audio clock, speech cue and motion tail.

Remaining acceptance gates are combined Android runtime qualification, perceptual
motion/speech/face tuning, memory/thermal behavior and any selected accelerator.
The user performs the phone tests; installation permission does not authorize
the agent to run these gates. Preserve this branch and the original installation, then
save the qualified clean Ardy baseline before creating the separate product repo.
