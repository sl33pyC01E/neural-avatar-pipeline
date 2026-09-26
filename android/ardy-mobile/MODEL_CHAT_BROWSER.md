# In-app models and browser: 0.5.1 (in progress)

Tabs 7 and 8 run from **Cleopatra · Avatar Check**. No computer launcher is
needed after installation and model provisioning. The agent installs; the user
opens the app and tests it. No phone model execution was performed for this change.

## Tab 7: Models

Choose **Qwen 3.5 2B + Whisper** or **Gemma 4 E2B**, then Load. Switching models
loads the new selection and releases the previous one. Other setting changes
require Load/apply and start a new conversation. Qwen loads the selected Whisper
tiny/base/small English model alongside the VLM; audio is transcribed before the
chat turn. Gemma receives audio directly.

Type a message, attach an image or WAV, or Record (up to 60 seconds), then Send.
Image orientation is applied before encoding. Attachments are limited to 20 MB,
images to 16 megapixels, and the attachment cache retains the newest eight files.
The app requests microphone permission only when Record is used.

The native runtime keeps one conversation slot and resends its exact conversation
prefix with `cache_prompt` enabled. Failed/incomplete turns are excluded from
history. LiteRT keeps a persistent Conversation. New chat resets history; it does
not reload the weights. History is in memory, so unloading or process reclamation
starts a fresh conversation. The custom Qwen LiteRT context is 8,192 tokens; other runtimes use 4,096. Start a new chat when it
fills. This debug build does not silently summarize or trim the conversation.

Settings expose llama.cpp's minimum and maximum image tokens plus maximum image
encoder batch tokens. Minimum 0 selects the model default. The maximum starts at
560, encoder batch size at 1,024. Source images retain their aspect ratio. Model
preprocessing can round allocations to its patch grid. LiteRT's packaged artifact
fixes image allocation; its unavailable overrides are disabled and explained.
Reasoning defaults on, with a selectable 128/256/512-token budget (default 256).
The native request uses `reasoning_budget_tokens` and `enable_thinking`; the
LiteRT Conversation uses ThinkingConfig. Answer output is capped at 512 tokens
in addition to the reasoning budget.

CPU and Adreno OpenCL are selectable for both GGUF models. Both models also offer
LiteRT CPU/GPU. Qwen uses our 768×768 / 576-visual-token / 8K-context build,
with its thinking channel and a template that retains the exact conversation prefix.
Gemma uses the full audio/vision package on both LiteRT backends: the separate
`-gpu` artifact is text-only and caused the missing audio encoder failure. OpenCL loading requires evidence of nonzero layer offload in the
startup log. Backend selection is not a claim of full operator coverage or NPU
support. These candidates still need the user's phone qualification.

The speech selector also offers **WhisperX native · Base English (experimental)**:
Silero VAD, CTranslate2 INT8 greedy decoding, and wav2vec2 INT8 word alignment,
all on CPU. Its additional stage times are shown beside total ASR time. It is an
English native pipeline port without Python, temperature retries, or speaker
diarization. See [the Android WhisperX implementation](benchmark/WHISPERX_ANDROID.md)
and [the custom Qwen build](benchmark/qwen-litert/README.md).

The bottom strip reports load time, time to first answer text, response duration,
Whisper duration, model CPU time, decode rate, sampled PSS and prefix reuse. Missing
metrics display a dash. The first answer time includes reasoning and, for Qwen
audio, ASR. PSS sums the app process, model service and owned workers; isolated
WebView renderers and GPU driver allocations may be outside this sum. A partial
reading is labelled. Peaks are sampled once per second and can miss short spikes.
CPU time is not wall time or a GPU utilization measurement.

## Tab 8: Browser

The embedded Android WebView opens Google. Load a model in tab 7, enter a goal
beneath the viewport and press Go. Each step captures only the browser viewport,
sends it to the selected local model with the goal and recent actions, validates
one returned action, performs it, and captures the next view. Supported actions
are click, scroll up/down, type into the focused field, Enter, Back, ask and done.
The coordinates use a normalized 0–1000 space relative to the screenshot.

A proposed click displays a yellow bounding box and center for 900 ms before
execution. Navigation, scrolling or viewport size changes invalidate the old
coordinates. Manual touch pauses the loop. Follow-up questions show an input box;
Continue resumes inspection. The model can request confirmation for actions with
external effects; the user can approve or decline. The browser also pauses on
errors, unsupported links or a requested download. After 50 actions it asks
whether to continue another batch.

Pause cancels a pending response and keeps the goal. Resume captures a fresh
view. Stop clears the task. Leaving tab 8 or hiding the app pauses it. A pending
click is guarded against pause, navigation and stale results. The browser shares
tab 7's settings but does not mix browser turns into the normal chat history.
Reasoning is enabled by default through the shared tab 7 setting.

The external browser has no Cleopatra JavaScript bridge, file access or content
access. Pages cannot invoke model/service controls. Model output is parsed as
bounded action data, never executable JavaScript. Typed text is JSON-quoted into
a fixed editing routine. The task prompt treats page contents as observations.
The browser can still be mistaken about a page or target: this is an experimental
agent tab, and neither navigation accuracy nor autonomous completion is qualified.

## Packaging and lifecycle

The APK packages three ARM64 executables in its extracted native library folder:
CPU/OpenCL llama-server and whisper-server, plus the WhisperX JNI library. Models live in private app storage
under `files/benchmark`, copied and hash-verified by `prepare_benchmark.py --install`.
Pinned source artifacts and a separately fingerprinted custom Qwen export are
provisioned; only the selected contender is loaded. This checkpoint is self-contained at runtime, but model provisioning is
still separate from the APK download. The final distribution bundle is future work.

Inference runs in the separate `:models` process. Native servers bind only
127.0.0.1 and require a fresh per-runtime bearer token. The WebView uses the
internet; model requests remain local. Models remain resident between messages,
native workers use blocking waits, and metrics sampling stops when idle. There is
no reserved-memory promise or wake lock. Stop & unload releases the process;
critical memory pressure unloads it. Backgrounding during active inference stops
that work; an idle resident model can remain available. Workers have a parent-death
signal so they cannot survive the model service.

Native source patches, exact revisions, model hashes and preparation instructions
are in `benchmark/`. The original `ai.cleo.ardymobile` package is preserved.

## Loading repairs

Whisper-server does not accept whisper-cli’s `-nc` flag; removing it repairs the
observed Qwen-ready/Whisper-startup failure. Its independent-request context is
already the server default. Native GPU loading now reads an explicit receipt of
actual offloaded layers, independent of llama.cpp log verbosity. Worker logs
include model, backend and timestamp and retain the latest twelve files.

The user reported Gemma CPU and the old text-only LiteRT GPU package loading.
That does not qualify the full multimodal package or Qwen GPU. Android also
recorded app-update exits during earlier installations; those are not GPU crash
evidence. The next delivery is one consolidated installation, with execution
left to the user.

## Verification

- Android compilation, lint and APK signature/payload checks.
- `check_model_chat.py`: real Java adapter against a fake host HTTP server;
  prefix history, media routing, reasoning key, failed streams and action parsing.
- `check_desktop_web.mjs`: CPU-rendered eight-tab UI with a stub Android bridge;
  settings, chat controls, metrics, follow-up actions and compact layouts, plus
  regressions for the existing avatar, face and scheduled speech views.
- Installation receipt and private model hashes; no launch or phone inference.

These checks do not establish phone latency, audio quality, GPU success, image
accuracy or successful browser tasks. Those results must come from the user's runs.
