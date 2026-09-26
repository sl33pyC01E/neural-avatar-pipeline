# Cleopatra native checkpoint

An offline Android checkpoint for Cleopatra's full VRM, using the existing
`retargetting/motion-control.js` normalized humanoid solver verbatim. The build
extracts its functions into a small module; it does not maintain another copy
of the retargeting algorithm. It bundles Three 0.165.0 and Three-VRM 3.5.3 from
the desktop installation, including their licenses.

Package: `ai.cleo.ardyavatarvalidation`.
Phone label: **Cleopatra · Avatar Check**.

The app replays the actual 64-frame, 20-fps walking/waving motion recovered from
the installed Ardy Mobile APK. The clip contains source joints, root positions,
and local rotations, including the head rotation that a position-only skeleton
cannot recover. Controls offer the source clip, rest pose, continuous turn,
skeleton overlay, camera orbit/zoom, and optional spring physics.

The scene uses the VRM's complete skin, inverse bind matrices, textures, morphs,
and bone hierarchy. Three-VRM removes unused vertices after loading; it preserves
indexed geometry and attributes. The original VRM remains unchanged.

The **Motion & voice** disclosure now connects Core-8/Core-40 rolling generation,
the recovered LLM2Vec JNI and cached embedding bank, PocketTTS with Anna, and LAM
facial animation. The renderer and camera controls remain the approved version.
Live motion uses bounded consecutive horizons, not repeated clips. Preview replay
still deliberately wraps its recovered clip. Display fps is not inference speed.

Ardy and the compatible 4.6 GB GGUF can be imported by content hash through Android's
file picker; their private files in the original package cannot be opened by this
separate app. The authorized developer installer can also provision them through
ADB without launching either app. Both paths copy and verify files without changing originals.
The APK bundles Cleopatra, the embedding bank, Pocket/Anna and the exported LAM
model. **This is not yet the fully self-contained Cleopatra product APK.**

Native components compile and their numerical paths were tested on the development
machine. The combined Android JNI/service/audio path has not been run since the
user prohibited active phone tests. The local emulator could not start because
its hypervisor driver is missing. No switch to phone testing was made.

## Build

Requirements: Python with NumPy/ONNX/ONNX Runtime, PyTorch/torchaudio/Transformers for
LAM export, Node, JDK 17+, Android SDK 36, and the desktop
`retargetting/node_modules`. The Gradle wrapper pins 8.11.1 and AGP pins 8.9.2.
AGP warns that SDK 36 is newer than its tested SDK; this small Java app builds
successfully with the installed SDK. Target SDK remains 35, matching Ardy Mobile.

From `android/ardy-mobile`, substitute the local payload paths:

```powershell
python tools/prepare_avatar_validation.py --avatar "PATH/TO/Zome_Cleopatra_v1.vrm" --apk "PATH/TO/ardy-mobile-installed.apk" --dependencies "PATH/TO/retargetting/node_modules"
python tools/fetch_runtime_dependencies.py
# Export on CPU using the existing LAM source/checkpoint and a local mono speech WAV.
python tools/export_lam_onnx.py --source "PATH/TO/face_animation/LAM-Audio2Expression" --audio "PATH/TO/anna.wav" --output payloads/lam/lam-window64-24k.onnx --report validation/lam-export-24k-2026-09-25.json
python tools/prepare_runtime_assets.py --pocket payloads/dependencies/sherpa-onnx-pocket-tts-int8-2026-01-26 --lam-model payloads/lam/lam-window64-24k.onnx --lam-report validation/lam-export-24k-2026-09-25.json --lam-source "PATH/TO/face_animation/LAM-Audio2Expression"
node tools/check_avatar.mjs avatar-validation/app/build/generated/avatarAssets "PATH/TO/retargetting/node_modules" "PATH/TO/vnyan/Zome.vrm" avatar-validation/app/build/avatar-check.json
cd avatar-validation
.\gradlew.bat :app:assembleDebug
```

Set `JAVA_HOME` and `ANDROID_HOME` to the installed JDK and SDK if necessary.
Generated payloads, APKs, local paths, keys, screenshots, and build logs are
ignored by Git. `provenance.json` inside the APK records source/model hashes
and dependency versions. Payloads are local prerequisites, not network downloads.
The app requests no network permission and serves its bundled assets internally.

APK: `app/build/outputs/apk/debug/app-debug.apk`.

## Checks

`tools/check_avatar.mjs` loads both original Zome and Cleopatra through the real
Three-VRM loader, substituting empty textures only for the CPU-only test:

- compares every mapped humanoid world matrix across all 64 recovered frames;
- checks bone lengths and finite transforms;
- compares every rendered skinned vertex index before/after vertex compaction;
- checks that hips, chest, and head retain a 180-degree source turn.

**The agent may install; the user tests** (clarified 2026-09-26). Do not launch
phone apps, run inference, play audio, benchmark, or automate phone controls.
`check_device.mjs` is retained
only as historical tooling; its mode/timing assumptions predate idle rendering.

Current checks and reports live in `../validation`:

- `ArdyCpuCheck.java`: real recovered weights, nine horizons per profile, context
  eviction, finite output, bone lengths, seed reset and exact checkpoint resume.
- `PocketAnnaCheck.java`: real CPU synthesis to a WAV file, without playback.
- `export_lam_onnx.py`: PyTorch/ONNX parity including a fixed sinc resampler.
- `LamPostCheck.java`: desktop LAM postprocessing parity, excluding random blinks.
- `check_motion_buffer.mjs`: real generated motion at seams, starvation and limits.
- `check_desktop_web.mjs`: local Edge/SwiftShader and a stub native bridge; tests
  the actual renderer/UI and idle scheduling, not Android inference.

The Windows JVM checks use the installed Temurin 25 runtime. Android Studio's JBR
loads an older MSVC runtime that fails to initialize desktop ORT; the Android build
still uses the Studio JBR. Do not modify the system JDK to work around this.

Phone timing includes retargeting, scene updates and rendering submissions.
The CPU timer is not a GPU timer. Test with live inference enabled before
claiming combined real-time performance.

## Motion, speech and lifecycle

The native motion worker must pass consecutive source joint frames, root
positions, and local rotation matrices at the model's reported fps to the
same retargeter. Preserve the existing continuous normalized motion history,
token alignment, cached text conditioning, and Core-40 single-batch rollout.
Do not regenerate motion to refresh the display or reconstruct head orientation
from endpoint positions. The display interpolates joints and uses quaternion
slerp for the source local rotations between motion frames.

The native resident service uses blocking worker queues, no wake lock, and no idle
polling. Rendering stops when hidden or in a static rest pose. Pause keeps the live
motion buffer. Ardy checkpoints at lifecycle boundaries and restores history/root/
random state; it does not write every frame. Android can reclaim the process; a
user-started sticky foreground service and its Stop notification provide lifecycle
control. The memory setting is a **best-effort model-cache budget**, not an OS RAM
reservation or a hard allocator cap. Memory pressure closes warm sessions safely.
LLM2Vec uses the original opaque JNI contract; its internal caching/cancellation
behavior has not been qualified in the restored app.

Pocket audio is passed through LAM before playback. Facial frames carry timestamps
derived from audio sample positions, and the display queries the AudioTrack clock.
The shared desktop facial mapping is extracted verbatim with a checksum. LAM uses
the original 64-frame context, silence/blending/SG/symmetry processing and separate
random blinks. Its exported sinc resampler differs from the desktop librosa/soxr
resampler; perceptual and device synchronization qualification remains necessary.

Motion events include a per-view stream identifier and profile. Late batches and
errors from an old profile/view cannot enter the current playback buffer; pausing
keeps the identifier and rolling history. Embedding/import work temporarily blocks
new speech requests so the large GGUF load does not race a speech-session reload.

## Install for the user's test

`tools/install_checkpoint.py` verifies the APK package, installs only the separate
checkpoint, and copies inventoried Ardy/LLM2Vec weights directly between the two
private app directories using `run-as`. Every copied file is verified by size and
SHA-256 before activation. Unexpected existing model files are left untouched.
The original app version and files are preserved. This tool never starts an app.

From `android/ardy-mobile`:

```powershell
python tools/install_checkpoint.py --adb "PATH/TO/adb.exe" --transport TRANSPORT_ID --aapt2 "PATH/TO/aapt2.exe" --apk avatar-validation/app/build/outputs/apk/debug/app-debug.apk --report validation/installation-DATE.json
```

The user opens **Cleopatra · Avatar Check**, expands **Motion & voice**, selects
a cached description and Core-40, and starts motion. New text uses **Cache embedding**;
Anna and LAM use **Speak**. Installation and checksums are not inference qualification.

The matching signing key is still required to replace the original Ardy Mobile
package. Never uninstall it or clear its model/embedding storage. GPU/NPU routes
and remaining conversion requirements are documented in `../ACCELERATION.md`.
