# Cleopatra v25 · module workspace

Version 0.9.0 uses llama.cpp b11200 for both official Gemma QAT models. Select
GPU encode/NPU decode (default), GPU/GPU, GPU/CPU or CPU/CPU. Vision and audio
share the encoder device; language prefill and generation share the decoder.
Backend evidence distinguishes requested placement from observed offload.
No acceleration, memory saving or native generation result is claimed here.

## Debug navigation and lifecycle

- A numbered module picker replaces the nine-button grid. Modules returns to the directory.
- Pocket has Speak, Settings and Diagnostics; Ardy has Motion, Appearance and Inspect.
- Models has Chat, Model, Prompts & cache and Resources, with shared load/new/unload actions and status.
- Face, speech/face, Together and Cleopatra have Run and Settings/timing sections.
- Each module uses one scrolling controls area. The avatar viewport stays fixed;
  wide screens place it beside the controls. Browser keeps a fixed capture viewport
  with one scrolling console and a collapsible trace.
- Prompt tree separates browsing from editing, grows the editor with its content
  and preserves unsaved-edit guards. No model load is needed to edit prompts.
- Module/section reading positions and form drafts survive navigation. Streaming
  follows the bottom only when the reader is already there.
- Leaving model chat cancels its active reply without unloading weights. Existing
  speech/motion/browser pause rules remain. Pending microphone requests clear on
  module switch/pause; late permission replies cannot restart a hidden recording.
  Native WebView events are marshalled to the UI thread and ignored after destruction.

## Runtime removal and model cleanup

The LiteRT SDK, service adapter and unused benchmark service are removed. Current
model inventory is `benchmark/models.json`; the pinned provisioner reads
`benchmark/gemma-qat.json`. The previous LiteRT inventory and scripts are retained
as historical recovery material under the archived manifest, outside the APK.
Qwen/Whisper were already absent from the APK and remain absent.

`tools/remove_retired_phone_models.py` requires v25 before removing anything. It
verifies all four replacement QAT files, matches each retired weight by size and
SHA-256, rejects symlinks, and deletes only exact files. Named LiteRT model caches
are inventoried and rechecked immediately before deletion. There is no recursive
cache/data clear, app launch, benchmark or inference. Ardy/llm2vec, Pocket, LAM,
VRM, prompts, conversations and current KV files are outside the deletion set.

## Verification

- Android assembleDebug and lintDebug passed: zero errors, 11 warnings.
- APK signature and packaged UI/worker/DSP/Pocket/LAM hashes passed; no LiteRT
  native library remains. Ardy embedding JNI remains bundled.
- Host protocol: 18 streaming/tool checks, 57 disk-prefix assertions against a
  fake authenticated HTTP peer, 171 launch/log/settings assertions, plus the
  retained avatar/browser tool validation.
- CPU SwiftShader UI checks cover all nine modules and 60 section/size combinations,
  portrait, keyboard-height and landscape. They also retain prior avatar,
  multimodal, streaming, browser, prompt-tree and startup-failure regressions.
- Installation and scoped retired-file cleanup receipts are saved separately.
  No phone app launch, model execution, audio playback or automated UI test.

Reports: `validation/apk-v25.json`, `gemma-protocol-v25.json`,
`desktop-modules-v25/result.json`, `install-v25.json`, `retired-llms-v25.json`.

Installed v25 without launch. Cleanup removed 22 retired weight/cache files,
13,020,341,352 bytes (13.02 GB / 12.13 GiB), including duplicate ADB staging copies.
Both QAT language/projector pairs matched their pinned SHA-256 hashes before
cleanup; installation separately verified the retained Ardy/LLM2Vec files.
