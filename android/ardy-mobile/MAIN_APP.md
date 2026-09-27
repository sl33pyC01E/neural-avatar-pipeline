# Cleopatra 0.8.1 · Main

See [the startup/skin fix](LOAD_FIX.md) for the confirmed Android memory-kill
diagnosis, staged loading, new error reporting and subtle skin warmth default.

Startup is a minimal Launch page. No VRM or model inference starts before Launch.
The corner Settings menu shares the existing model/context/image/reasoning
controls, links to voice/face/Ardy settings, and contains all nine debug tabs.
The original debug tab 9 and `avatar_stage` API remain available.

Launch opens Main, initializes the VRM and the selected Gemma E2B/E4B, Ardy
Core-8/Core-40, PocketTTS/Anna and LAM. It prefills the Main system/tool prompt
before enabling Send. The bottom composer accepts text, images, WAV files and
recorded audio; Gemma handles audio directly. Answer/thought channels stream
separately, with reasoning collapsed and generation reasoning off by default.
Speech consumes only the completed answer. Stop cancels generation/playback.

## Framing and tools

| Frame | Body driver | Model camera/root controls |
| --- | --- | --- |
| Face (default) | Idle body; LAM face; no Ardy generation or motion gate | No camera or root tool controls |
| Torso | Live Ardy with stationary X/Z and heading constraints on every generated frame | Root locked; camera distance 1.05–1.65 m only |
| Body | Live Ardy with unconstrained root | Camera orbit/framing/zoom and floor placement/heading |

Torso also removes translation/yaw from the rendered root as a deterministic
backstop. Upper-body articulation remains; this is not individual foot IK.
Body retains the existing ±3 m floor placement and ±180° heading tool bounds
in addition to Ardy's generated motion. Frame switches stop/reset the take and
restore the matching camera preset. User camera gestures still work.

Main's `act` tool has optional `gesture`, `emotion`, `intensity`, `lead_seconds`,
`tail_seconds`, `camera`, `root`, `face` and `schedule` arguments. Defaults allow a
normal spoken answer without a tool call. The current frame/camera/root scene
is supplied each turn, while the stable situation/rules/tool schema stay in the
retained prefix. Java validates both immediate and scheduled controls against
the selected frame before accepting them. Gestures resolve to cached **text
embeddings** for live Ardy, not animation clips.

Voice/face/body share the AudioTrack clock. Face-only expression/gain cues use
the voice clock directly and never wait for Ardy. Torso/Body use the existing
frame-zero preparation gate, voice cue and eased tail. The main page inherits
Pocket, face amplitudes and Ardy profile settings from the debug modules.

## Attention and prompt preparation

The shared LAM mapper previously added a large procedural eye oscillation using
utterance time, restarting at every reply. The rendered path now uses LAM's
actual expression/gaze output with a single continuous presentation clock for
subtle head/neck attention and blinking. Idle/speech transitions blend from the
last displayed head/eye pose. LAM remains the mouth/expression driver; head
motion is explicitly procedural, and all existing amplitude controls remain.

Main uses LiteRT-LM 0.17.1 `ConversationConfig.prefillPrefaceOnInit=true` for its
situation and `act` schema. Preparation time and prefix token count (when the
SDK returns it) appear under Session. Both Gemma artifacts use this path with
separate weights: switching model/backend/context/image/reasoning settings
recreates the engine and its prefix. The Android API has no KV-state save/load
interface, so two persistent disk prefixes are not claimed. Only the selected
Gemma is loaded; an unused second Gemma is not silently started just for warming.

## Resident mode

Keep loaded models resident defaults on. The main-process avatar service and
`:models` Gemma service are foreground services with ongoing notifications.
Resident mode disables our automatic pressure/budget unloading and Ardy release
on navigation. Hiding the app cancels active work and releases recording/audio
resources, while completed model sessions stay open. Native queues block at
idle, visible idle is capped at 20 fps, and hidden rendering stops. No dummy RAM
allocation, periodic inference, boot autoload or permanent wake lock is used.

Settings exposes actual notification, battery-exemption and background-restriction
status, the resident toggle and Android settings links. The package declares
`POST_NOTIFICATIONS` and `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` in addition to
the existing foreground-service permissions. Microphone permission is still
requested when Record is first used. Stop in the avatar notification unloads
Gemma as well as the avatar stack; Unload is always honored.

Android provides priority/exemptions, **not guaranteed physical RAM pinning**.
The OS, OEM memory management, force-stop, reboot or process death can still
reclaim it. Samsung's sleeping-app policy may require a user choice in its UI.
Changing model configuration and explicitly caching a new LLM2Vec embedding
can release/recreate sessions. LLM2Vec's separate 4.6 GB encoder remains
on-demand; live responses use its cached embeddings.

References: [foreground service types](https://developer.android.com/develop/background-work/services/fgs/service-types),
[Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby).

## Inventory and checks

The active catalog contains only full multimodal Gemma E2B/E4B. Ardy Core-8/40,
LLM2Vec, Pocket/Anna, LAM and the Cleopatra VRM remain. Read-only inventory on
2026-09-26 found no Qwen/Whisper weights in private/staging model folders. Three
unused old Gemma artifacts (GGUF, projection and text-only GPU bundle) remain
on disk; active code does not select them. APK checks reject retired Qwen/chat
llama/Whisper runtime workers and require Ardy's independent LLM2Vec JNI library.

Receipts: `validation/desktop-main-v17/result.json`,
`validation/gemma-protocol-main-v17.json`, both `gemma-e*b-main-template-v17.json`,
`validation/apk-main-v17.json`, `validation/installation-main-v17.json` and
`validation/residency-main-v17.json`.

Host checks exercise the real VRM with CPU SwiftShader and a stub native/model
bridge, Java tool validation with the actual LiteRT SDK, and the Jinja templates
read from both real Gemma bundles. They cover entry navigation, prefill routing,
multimodal streaming, Face skipping Ardy, Torso root locking, Body root/camera,
audio-clock scheduling, head handoff, settings and all prior debug flows. Android
compile/lint, APK payload hashes, JNI callback ABI and signature checks are
separate. No phone app launch, inference, audio or benchmark is performed by the
agent. The user tests the installed update's voice, motion, latency and retention.

## Installed checkpoint

Version 17 (`0.8.0-main`) was installed without launching it. All five checkpoint
Ardy/LLM2Vec files matched the recovery inventory. The older `ai.cleo.ardymobile`
package was already absent at installation time; it was not reinstalled or
changed. The installer now supports this case only when all model copies already
exist in the checkpoint, and it still verifies their full hashes.

Notification permission, the package-specific Doze exemption and
`RUN_ANY_IN_BACKGROUND=allow` were applied and read back through ADB. Samsung's
separate sleeping-app UI policy was not changed. No system-wide battery policy
was disabled. Android lint completed with 0 errors and 11 warnings, including
the direct battery-exemption intent's Play-distribution policy warning; this is
the user-requested sideloaded resident-app checkpoint, not a Play submission.

APK SHA-256: `b407a48f5c83a5664c26d0b59531e8012262681f536d1694545448d2f58dce70`.
