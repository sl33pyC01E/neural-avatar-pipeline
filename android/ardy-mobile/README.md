# Ardy Mobile: Cleopatra integration

This branch continues the existing **Ardy Mobile** Android application,
`ai.cleo.ardymobile`, using the installed phone build as the recovery reference.
The target avatar is `Zome_Cleopatra_v1.vrm`.

## Agreed scope

1. Preserve Core-8 and Core-40 and the existing on-device LLM2Vec GGUF backend.
2. Preserve the user-verified real-time baseline: **Core-40, one rolling batch,
   cached text embeddings**. Retargeting and display must not block generation.
3. Retarget the generated motion correctly onto Cleopatra, including root
   placement, facing, body proportions, limb alignment, and continuous playback.
4. Keep a clean, reproducible Ardy baseline once phone validation passes.
5. Build the larger application separately in its own repository afterward.

## Cleopatra product direction

Once Cleopatra's VRM is updated, optimized, and correctly retargeted to Ardy's
core body, package a neat, fully self-contained AI Android app named
**Cleopatra** in its own repository.

The intended components are:

- Ardy Core-8 and Core-40 for motion;
- the compatible 4-bit GGUF LLM2Vec encoder and a precached steering bank;
- the Cleo/Cleopatra VRM avatar;
- PocketTTS for speech output;
- either Gemma 4 E2B, or Qwen 3.5 2B with faster-whisper/WhisperX;
- a small OpenCode/OpenClaw-style agent scaffold;
- potentially ChromaDB for persistent storage.

The VLM, speech-recognition implementation, agent scaffold, and storage system
remain candidates. They have not been selected, integrated, or qualified on the
phone. This is the next product phase; the current acceptance gate is the
updated avatar and the clean real-time Ardy baseline.

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
mappings match the desktop original, but the baked mobile render assets still
need to be regenerated for her changed geometry, materials, and accessories.

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

1. Recover the original source/signing key where possible; otherwise restore a
   buildable app from the recovered reference and preserve the installed app.
2. Export Cleopatra's mobile render assets with recorded source checksums and
   validate rest-pose skinning before changing animation behavior.
3. Verify retargeting against the source skeleton and the desktop VRM reference
   through representative idle, walking, turning, and upper-body motions.
4. Keep generation and playback asynchronous; preserve motion time and history
   across single Core-40 horizons and steering changes.
5. Measure generation, retargeting, render timing, and buffer continuity on the
   phone. Save the tested build and settings as the clean Ardy baseline.
