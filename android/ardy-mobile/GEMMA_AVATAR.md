# Cleopatra 0.7.1 · Gemma avatar

Tab 8 remains Browser. **Tab 9 · Cleopatra** loads the VRM and offers Load all,
per-engine readiness, a persistent Gemma conversation, streamed answers/thoughts,
Send, Stop, New chat and Unload all. Nothing starts merely by installing the APK.
Load all opens live Ardy, Pocket/Anna and LAM sessions and the selected Gemma
LiteRT engine. It does not generate body motion or play speech. The selected
Core-8/Core-40 comes from tab 5; speech/face controls come from tabs 2–3; Gemma's
E2B/E4B, CPU/GPU, context size, image budget and reasoning settings come from tab 7. Loading is an attempt, not a
promise that Android will retain every engine under memory pressure.

## Avatar tool

`avatar_stage(motion, expression, strength, cue_seconds, tail_seconds, camera?, root?, face?, schedule?)` is a real
LiteRT function tool with automatic execution disabled. The service validates
the five basic arguments and every optional nested control before accepting a plan. `motion` is an alias for one of at
most twelve **cached text embeddings**, never prerecorded motion. The current
catalog exposes available relaxed speaking, explaining, waving, welcoming,
shrugging, thinking, reassuring and emphasis embeddings. Ardy generates rolling
body batches live from the selected vector. LLM2Vec need not load for that step;
it remains available for creating new embeddings in tab 5.

Expressions are limited to presets actually supported by the VRM. Strength is
0–0.75, cue 0–3 seconds, tail 0.5–3 seconds. Unknown keys/names, wrong types,
non-finite/out-of-range numbers and excess calls are rejected. At most three tool
calls can stage a turn. The UI displays tool requests/results under a disclosure.
Without a valid call, a neutral default plan uses the first available embedding.
A tool call stages settings only. After the final answer, Pocket and rolling LAM
prepare it; live Ardy starts at frame zero. Playback waits for sufficient body
coverage. One audio clock schedules body, voice, face and the eased tail. The
expression overlay follows its track cues; LAM articulation follows the speech cue. Neither changes saved face gains.

Only answer text reaches Pocket. Reasoning and tool data never become speech.
Avatar answers are requested in short spoken sentences; replies exceeding the
2,000-character speech limit remain visible with a clear request to shorten them.
Stop, hiding the app or leaving tab 9 cancels pending generation/playback and
invalidates late responses. Tool-selected embeddings do not change tab 5's
visible selection. Failed/cancelled Gemma conversations reset their prefix.

Optional camera controls: orbit yaw ±180°, elevation −30–60°, target distance
0.3–6 m, look-at height 0.1–2.5 m, target pan X/Z ±2 m. Root controls: floor X/Z
±3 m and heading ±180°. Root transforms apply AFTER calibrated retargeting, so
changing heading rotates the whole solved avatar instead of cancelling Ardy's
orientation. This is whole-body floor placement, not individual foot IK. Optional
face controls multiply the user's eye/mouth/head amplitudes by 0–2 for the take.
They do not modify saved settings.

Up to 12 chronological scheduled cues can change camera/root/face/expression at
0–30 seconds of track time, with 0–3 second smooth transitions. Cues after the
actual end do not run. Playback waiting freezes cues; preparation never applies
them. Stop clears pending cues. Root placement and the last camera view persist;
manual camera gestures override camera automation until the next staged take.
Omitted controls retain their current values.

Tab 9 also accepts images, WAV audio or recorded speech directly into its Gemma
conversation. Input events retain their originating tab across file pickers and
permission dialogs; tab 8/9 audio does not leak into tab 7's attachment composer.

## Default stance and residency

The VRM starts at face distance in a relaxed stance: lowered arms and slightly bent elbows.
Its retargeting calibration remains unchanged. A lightweight idle adds breathing, blinking and slight sway during
preparation; live Ardy blends into the first frame once the shared clock starts.
Visible idle is capped at 20 frames/second and blends away when Ardy/LAM owns the
body/face. The idle layer restores its base transforms each frame to avoid drift.
Idle can be turned off; then the rest view renders only when invalidated. Hidden
views stop rendering and requesting motion. Face/Body buttons change framing. Native workers block when idle;
there is no dummy RAM reservation, keep-awake lock or periodic idle inference.
Unload and memory-pressure handling release sessions.

## Validation limits

Host tests exercise the real Java tool validator (28 rejected invalid inputs),
LiteRT SDK tool-schema adapter, the actual Gemma artifact's thought/tool template,
stream accumulation, real VRM renderer, default arm placement, nine-tab UI,
streamed collapsed reasoning, embedding routing, clock gating, stop and stale
results. CPU-rendered browser checks use stub native/model responses, not phone
inference. Android compile/lint and packaged payload checks are separate receipts.
The agent installs; the user tests model behavior, coexistence, quality and speed.

Version code 16 adds the saved 4K–128K context setting (4K default) to the E4B/audio/avatar-controls checkpoint, installed without launch. The original Ardy app/version and
Core-8/Core-40/LLM2Vec files were verified unchanged. Cleanup removed 35 matched
Qwen/Whisper files (11,277,306,916 bytes) from this checkpoint and its staging
directories; the full Gemma bundle was hash-verified and retained. Receipts are
under `validation/*gemma-avatar-2026-09-26.json` and
`validation/retired-phone-models-2026-09-26.json`.

E4B provision and controls receipts: `validation/gemma-e4b-*.json`,
`validation/gemma-controls-*.json`, and `validation/*gemma-controls-2026-09-26.json`.

Context-setting build, desktop UI and installation receipts are under
`validation/*context-settings-2026-09-26.json`. The host UI check verifies saved
context forwarding, reload/reset behavior, and inheritance by Browser and
Cleopatra; it does not allocate native model memory or run phone inference.
