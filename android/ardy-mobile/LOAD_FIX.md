# Cleopatra 0.8.1 · Startup and skin

The read-only phone exit history records two `:models` deaths at 21:04:37 and
21:05:10 on 2026-09-26 as `LOW_MEMORY`, both at foreground importance 100.
The surviving log for PID 4145 identifies full E4B and ends while initializing
its GPU `vision_280` delegate, before Main prompt preparation. No managed
exception was needed for these exits: Android killed the worker. The evidence
is in `validation/gemma-load-failure-v17.json`.

The prior full-stack loader opened the avatar engines concurrently with Gemma.
Version 18 now sequences explicit cold loads/reloads:

1. Close old Ardy/Pocket/LAM sessions on their owning workers; acknowledge only
   after both queues complete. Preserve the embedding bank and motion history.
2. Initialize the selected Gemma, with the user's context/image/backend settings.
3. Prepare the Main system/tool prefix, when entering Main.
4. Warm Ardy, Pocket/Anna and LAM; enable Send when all are ready.

A ready Gemma is reused. Once loading finishes, the resident behavior stays in
effect. This removes overlapping startup allocations; it is a mitigation for
the confirmed memory kill, not a measured claim about peak RAM or steady-state
fit. No phone inference/launch/benchmark was performed by the assistant.

Stop cancels the startup ticket, so delayed release/readiness replies cannot
resume loading. A Gemma error cancels remaining warm-up and stays visible;
Load/Launch can retry it. The service writes one bounded `gemma-load-state.json`
receipt with stage, settings, PID and memory metadata, without prompts or media.
After binder death the client reads Android's own process-exit reason and shows
it with the matching worker's receipt. A newer load suppresses an old death
notification. Android 10 falls back to a generic stopped message.

Skin-only output grading uses a small RGB attenuation `(0.97, 0.92, 0.89)` at
the new default warmth of 1. The slider spans 0–2; 0 restores unadjusted skin.
Only the Cleopatra face/skin materials receive it, without an extra render pass.
Existing lighting/color choices remain; old settings without this new field
inherit warmth 1. Original preset restores 0 and Balanced uses 1.

Host validation:

- `validation/desktop-load-fix-v18/result.json`: actual VRM rendered on CPU
  SwiftShader with a fake Android/model bridge; includes cold startup order,
  failure retention, retry, cancellation with late acknowledgments, all existing
  frame/media/tool flows, and the new skin default. Screenshot `main-face.png`
  in that directory was visually reviewed.
- `validation/gemma-protocol-load-fix-v18.json`: actual SDK tool schema and Java
  validation, 38 rejected invalid avatar inputs.
- `validation/gemma-e2b-prefill-v18.json` and `gemma-e4b-prefill-v18.json`: actual
  artifact templates, now including the system-only prefix used by Main.
- Android Java compilation and lint; APK payload/DEX/signature verification and
  install receipts are recorded alongside this checkpoint.

These checks do not execute the phone's native Gemma/Ardy/Pocket/LAM stack.
The user performs the next Launch test; actual memory relief remains unmeasured.
