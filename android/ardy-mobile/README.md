# Ardy Mobile: Cleopatra integration

This branch continues the existing **Ardy Mobile** Android application,
`ai.cleo.ardymobile`, using the installed phone build as the recovery reference.
The target avatar is `Zome_Cleopatra_v1.vrm`.

## Latest checkpoint: 0.10.0 · agent motion and portable Android handoff

Version 26 adds agent-controlled camera modes, floor/body/torso/head steering,
Core8/Core40 batch/live plans, timed gestures, saved-pose capture and layered
locomotion. Manual inspectors live only in Debug → Ardy → Stage. Main Face
avoids loading unused Ardy sessions; stable viewport sizing and camera tracking
reduce loading/status-driven movement. The camera icon opens capture directly,
and spoken streaming removes a leading Cleopatra speaker label.

See [agent API and limits](portable/docs/agent-motion.md),
[memory diagnosis / validation limits](portable/docs/validation.md), and
[portable handoff](portable/README.md). `tools/export_unimobile.py` creates the
standalone Windows/Android bundle at `Documents/unimobile`; its offline build
uses included tools and durable payloads. The stack stays with Gemma E2B/E4B,
Pocket TTS, LAM, Ardy, LLM2Vec and Cleopatra. MiniCPM and Qwen Omni experiments
were discarded. The user performs all phone inference tests;
[alternative-model research](OMNI_ALTERNATIVES.md) records the findings.

## Previous checkpoint: 0.9.0 · llama.cpp and module workspace

Both official Gemma 4 E2B/E4B IT QAT models now use **llama.cpp only**.
The default pairing is **GPU encoder → NPU decoder**, with exactly three explicit
fallbacks: GPU→GPU, GPU→CPU and CPU→CPU. The encoder setting covers vision and
audio; unsupported native operations may still use CPU. Old saved device choices
migrate to the requested default while model, context and quality choices survive.
No phone performance result is implied by selecting a pairing.

Debug navigation is now a module picker with separate Run, Settings and Diagnostics
sections as appropriate. Every module has one controls scroll area; the avatar and
browser viewport stay stable. Wide layouts place controls beside the avatar.
Prompt browsing/editing is separate, reading positions persist, and streamed text
only follows when already at the end. Leaving chat cancels its active response;
recording requests cannot restart after leaving a module or hiding the app.
Resident models remain available across navigation.

LiteRT dependencies, its benchmark service and model options were removed.
The cleanup tool verifies both QAT language models/projectors before deleting
fingerprint-matched LiteRT, Qwen and Whisper phone weights and their named caches.
Ardy/llm2vec, Anna/Pocket, LAM, VRM and saved prompt prefixes remain.
See [checkpoint details and verification](MODULE_WORKSPACE.md) and
[device placement](SPLIT_ENCODER.md).

v23 fixes an app-side check that rejected GPU/NPU workers after they reached
server-ready. Models also offers a default memory-focused llama.cpp preset and a
throughput preset. Logs now preserve each model/backend's startup evidence.
See [the diagnosis and verification limits](ACCELERATOR_MEMORY.md).

Settings → **Prompt tree** lists every application instruction/template and tool
description with its trigger. Save edits or restore defaults without reinstalling.
Edits persist on disk; affected conversations refresh on the next request while
model weights stay resident. Browser output now uses a JSON schema with reasoning
off and one bounded format correction if needed. The saved failure was shorthand
(`click: [coordinates], explanation`) rather than JSON. See
[prompt editing and browser handling](PROMPT_TREE.md).

Tab **7 · Models** offers official Google E2B/E4B IT QAT Q4_0
through pinned llama.cpp b11200: CPU, OpenCL GPU, and experimental Hexagon NPU.
Its prompt panel opens the editable tree and builds/restores/clears actual KV
files. Main, Browser and tab 9 share the same llama.cpp runtime and device pairing. See [the implementation, controls and test limits](MODELS_QAT_CACHE.md)
and [the runtime findings](PROMPT_CACHE_RESEARCH.md).

### Retained browser targeting

Browser clicks now use Gemma's documented `box_2d` order: top, left, bottom,
right on independently normalized 0–1000 axes. One conversion drives the
preview and tap. Screenshots copy the displayed native viewport with PixelCopy;
streamed replies no longer change its size. **Inspect target** pauses tab 8 and
shows the last captured image, response, model settings and mapped target.
The old response was not retained, so the cause of the reported miss remains
unconfirmed. See [targeting changes and verification](BROWSER_TARGETING.md).

### Retained input, attention and phrase streaming

Main now starts at eye level, with the same camera-relative gaze during idle
and speech. The composer has hold-to-talk (release to send), a camera/media
menu and a text line. Send on Enter defaults on and can be disabled in Settings.
Gemma's incoming reply is grouped into phrases for Pocket; one AudioTrack and
LAM timeline span the entire reply. Short sentences are grouped to reduce
Pocket state resets. See [implementation and verification](INPUT_SPEECH.md).

### Retained Gemma tool syntax fix

The earlier LiteRT response failure was an unquoted string in Gemma's native
`act` call. That diagnosis is preserved in [TOOL_FIX.md](TOOL_FIX.md). The current
llama.cpp path sends the declared tool schema and validates completed tool
arguments before applying avatar controls. Main's prompt avoids unquoted
pseudo-code. New chat recovers from a failed response without reloading weights.

### Retained startup and skin changes

Android exit history identified the two reported Gemma worker stops as
`LOW_MEMORY`; the last saved E4B log ended during GPU vision initialization.
Full-stack startup now waits for avatar session release before loading Gemma,
then prepares the Main prompt before warming Ardy, Pocket and LAM. Completed
sessions still remain resident. Settings are preserved; no automatic model or
context downgrade is applied. Process death now reports Android's exit reason
and the last saved load stage/settings. Late readiness events cannot hide errors.

The skin is subtly warmer/darker by default, with a Skin warmth slider in VRM
appearance. Hair, eyes and clothes keep their colors. The default also applies
to saved appearance settings from earlier versions.

Host checks pass; whether staged loading prevents the phone's memory kill remains
for the user's Launch test. See [startup diagnosis and checks](LOAD_FIX.md).

The user has confirmed the combined baseline fits and runs interactively. Startup
now shows a minimal Launch page. Settings contains all nine existing debug tabs;
debug tab 9 retains its original controls/API. Launch opens the new **Main** view,
loads the selected Gemma plus Ardy, Pocket/Anna and LAM, and prepares the avatar
system/tool prefix. Main has a face-distance VRM, continuous idle/speech attention,
and a bottom text/audio/image composer. **Face** skips Ardy generation; **Torso**
uses stationary root constraints with limited zoom; **Body** permits free root
motion and camera control. See [Main and residency](MAIN_APP.md).

Resident mode defaults on. Both services retain loaded sessions across idle,
navigation and memory-pressure callbacks; workers block and hidden rendering
stops. Explicit Unload/Stop still works. Notification/battery controls are in
Settings. This requests Android priority and exemptions, not an absolute RAM lock.
LLM2Vec remains an on-demand embedding-cache operation, outside the live reply stack.

### Retained model settings

Gemma 4 E2B/E4B use llama.cpp QAT with the four encoder/decoder pairings above.
LiteRT, Qwen and Whisper runtimes are removed from the app. Ardy's independent GGUF LLM2Vec encoder
and cached embedding bank remain available in tab 5.

Answers and Gemma-provided reasoning stream in tabs 7–9. Reasoning defaults off; enabled traces start
collapsed. Tab 7 exposes 70–1120 image tokens, shared by tabs 8–9. Audio input is
available in all three Gemma tabs. Tab 7 now offers a saved context setting from 4K to 128K tokens (4K default).
Load/apply recreates Gemma and clears its conversations; Browser and Cleopatra
share the selection. Larger contexts allocate more RAM and need phone validation. Browser remains tab 8; **tab 9 · Cleopatra** loads Gemma, live Ardy,
Pocket/Anna, LAM and the VRM together. The `avatar_stage` tool selects a cached
text embedding to steer live Ardy generation, a supported expression, and the
speech cue/tail, plus camera, floor placement, heading, face gains and timed cues. The final answer feeds the scheduled audio/face/body pipeline.
The default VRM stance lowers the arms and slightly bends the elbows; face framing is the default. Visible idle adds gentle breathing/blinking/sway
at up to 20 fps, and yields to model animation. Hidden views sleep; Idle off
restores demand-only rendering. See [Gemma avatar](GEMMA_AVATAR.md).

The recovered Ardy assets are preserved. Host checks and build results do not qualify
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
pass or changes to the avatar asset. With Idle off, resting views stop rendering.

The six-tab checkpoint now schedules body, voice and face on a shared audio clock
and corrects four Ardy history/mask/decoder contracts. See
[scheduled takes](SCHEDULED_TAKES.md) and [the contract audit](ARDY_CONTRACT_AUDIT.md).
The checkpoint is installed for the user's visual/audio/model test; the original app and
its models are retained. Desktop checks do not establish phone quality or speed.

The [measurement kit](benchmark/README.md) retains historical LiteRT fixture reports.
Its legacy service was removed in v25; current user-run comparisons use Models.
The agent must not invoke phone inference or benchmark launchers.

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
7. **Models:** Gemma E2B/E4B QAT, llama.cpp encoder/decoder pairings, image/audio, reasoning, prompt tree, disk KV controls, streamed text and metrics.
8. **Browser:** embedded Google browser, screenshot/action loop, text/audio goals and follow-up input, and pause/stop controls.
9. **Cleopatra:** Gemma replies through live Ardy, Pocket/Anna, LAM and the VRM; explicit Load all and bounded avatar tools.

The user approved moving these proven modules behind a debug menu on 2026-09-26.
The new Main view is separate from all nine debug tabs. Quantization and compilation are authorized
where they improve size/speed; preserve Anna and verify quality and compatibility.
See [the Pocket debug checkpoint](POCKET_DEBUG.md) for the crash evidence and current limits.

The intended lifecycle is continuous availability with aggressive idle sleep:
retain loaded reply-stack sessions in resident mode, avoid dummy RAM reservations,
and stop generation/render/audio work when idle. Android can still reclaim the
process. Disabling resident mode re-enables the older memory-budget/pressure trims.
No permanent wake lock or periodic idle inference. Settings changes, explicit
Unload/Stop and the separate LLM2Vec caching operation can release/recreate sessions.

## Cleopatra product direction

Once Cleopatra's VRM is updated, optimized, and correctly retargeted to Ardy's
core body, package a neat, fully self-contained AI Android app named
**Cleopatra** in its own repository.

The intended components are:

- Ardy Core-8 and Core-40 for motion;
- the compatible 4-bit GGUF LLM2Vec encoder and a precached steering bank;
- the Cleo/Cleopatra VRM avatar;
- PocketTTS for speech output;
- **Gemma 4 E2B/E4B IT QAT** on llama.cpp for text, vision and direct audio;
- a small OpenCode/OpenClaw-style agent scaffold;
- potentially ChromaDB for persistent storage.

Gemma provides vision and direct audio input. Browser grounding uses normalized
0–1000 coordinates relative to the captured viewport. The 1000-coordinate
convention does not require a 1000×1000 input image. The full audio/vision bundle
is retained; the selected image token budget bounds dynamic image preprocessing. Agent scaffolding
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
