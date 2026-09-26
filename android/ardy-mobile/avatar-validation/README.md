# Cleopatra avatar validation

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

This is renderer/retarget validation. Core-8/Core-40 inference and LLM2Vec are
still in the original Ardy Mobile installation and are not connected to this
checkpoint. Display fps must not be reported as inference throughput. Clip
repetition has a deliberate endpoint-to-start replay cut; this is not a test of
rolling generation continuity. Spring physics starts off so the primary rig
can be checked independently.

## Build

Requirements: Python with NumPy, Node, JDK 17+, Android SDK 36, and the desktop
`retargetting/node_modules`. The Gradle wrapper pins 8.11.1 and AGP pins 8.9.2.
AGP warns that SDK 36 is newer than its tested SDK; this small Java app builds
successfully with the installed SDK. Target SDK remains 35, matching Ardy Mobile.

From `android/ardy-mobile`, substitute the local payload paths:

```powershell
python tools/prepare_avatar_validation.py --avatar "PATH/TO/Zome_Cleopatra_v1.vrm" --apk "PATH/TO/ardy-mobile-installed.apk" --dependencies "PATH/TO/retargetting/node_modules"
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

`tools/check_device.mjs` uses an explicitly forwarded local WebView debug port
to exercise the three modes, capture screenshots, and record frame timing.
Leave Avatar Check visible while running it. Use the process ID returned by
`adb shell pidof ai.cleo.ardyavatarvalidation` for the forwarding command:

```text
adb forward tcp:9229 localabstract:webview_devtools_remote_PROCESS_ID
node tools/check_device.mjs http://127.0.0.1:9229 avatar-validation/app/build/device-check
```

Phone timing includes retargeting, scene updates and rendering submissions.
The CPU timer is not a GPU timer. Test with live inference enabled before
claiming combined real-time performance.

## Reconnection contract

The native motion worker must pass consecutive source joint frames, root
positions, and local rotation matrices at the model's reported fps to the
same retargeter. Preserve the existing continuous normalized motion history,
token alignment, cached text conditioning, and Core-40 single-batch rollout.
Do not regenerate motion to refresh the display or reconstruct head orientation
from endpoint positions. The display interpolates joints and uses quaternion
slerp for the source local rotations between motion frames.

This separate package allows phone validation while the original signing key
and buildable source are being recovered. Replacing the established package
still requires its matching signing key; its model and embedding data remain
in that original installation.
