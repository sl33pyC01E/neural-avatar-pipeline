# In-app Gemma and browser: 0.7.1

Gemma 4 E2B and E4B are selectable conversational models. LiteRT-LM 0.17.1 loads the full
`gemma-4-E2B-it.litertlm` or `gemma-4-E4B-it.litertlm` bundle on CPU or GPU for decoder/vision, with the audio
encoder on CPU. The separately named `-gpu` artifact is text-only and is unused.
No Qwen, Whisper or WhisperX chat runtime is packaged. Ardy's LLM2Vec JNI remains.

## Tab 7: Models

Load Gemma, then type, attach an image/WAV or record audio. Gemma receives audio
directly. Attachments remain bounded to 20 MB; images to 16 megapixels. Reasoning
defaults off, including a one-time migration of the previous default-on preference. When enabled, 128/256/512 tokens are selectable; subsequent choices persist. The actual package's
template supports the reasoning toggle and emits a `thought` channel; the UI
streams it separately from the answer in a collapsed-by-default disclosure.
All generated text is inserted as text, never HTML. Only the answer is spoken.

Context size is selectable in tab 7: 4K, 8K, 16K, 32K, 64K or 128K tokens
(4096–131072), with 4K the default. The saved choice is passed to the actual
LiteRT `EngineConfig.maxNumTokens` for both E2B/E4B and CPU/GPU. A change requires
Load/apply, reallocates the engine and starts fresh chat/avatar conversations.
Browser and Cleopatra inherit this engine setting. At most eight images per
conversation are configured;
image token budget is selectable: 70, 140, 280 (default), 560 or 1120. The real
LiteRT 0.17.1 `ExperimentalFlags.visualTokenBudget` is set BEFORE engine creation
and applies to every subsequent message, including browser screenshots. Changing
it reloads the engine/conversations so the vision buffer allocation matches.
These are experimental runtime configurations; device performance is user-tested.
Both artifact metadata defaults specify 16x16 patches and 2520 maximum patches.
Gemma4 pools 3x3 patches per visual token, giving a default budget of 280. The
runtime preserves approximate aspect ratio and rounds dimensions to multiples
of 48: square images become 384, 528, 768, 1104 or 1584 pixels per side for these
budgets (64, 121, 256, 529 or 1089 actual visual tokens). It is not a fixed square
input, and source image dimensions do not independently set the token budget.
E2B/E4B's architectural context is 128K. The selected context is shared by
system/tools, retained messages, media and output. Larger values allocate more
RAM and may not fit alongside the avatar models. Phone capacity and latency at
these settings are not yet qualified; the user runs those tests. The maximum
reply length and optional reasoning budget are separate from context capacity.

Sources: [Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4),
[variable-resolution vision](https://ai.google.dev/gemma/docs/capabilities/vision/image),
[LiteRT 0.17.1 experimental flag](https://github.com/google-ai-edge/LiteRT-LM/blob/v0.17.1/kotlin/java/com/google/ai/edge/litertlm/ExperimentalFlags.kt),
[resize implementation](https://github.com/google-ai-edge/LiteRT-LM/blob/v0.17.1/support/preprocessor/image_preprocessor_utils.cc).
Normal chat and tab 9 retain separate LiteRT conversations/prefixes. New chat
resets that conversation; settings reload or Unload resets both. Browser steps
use temporary conversations. A failed/cancelled conversation is reset. History
is in memory and the debug app does not silently summarize full contexts.

The footer shows first answer-token time, response/load duration, model CPU time
and sampled resident/peak PSS. PSS includes the app and Gemma service; independent
WebView/GPU allocations may be excluded. Prefix retention is reported without
inventing a reused-token count. No token-rate or utilization value is fabricated.
The model worker blocks when idle. Unload releases it; memory pressure may too.

## Tab 8: Browser

The embedded Android WebView opens Google. Load a model in tab 7, enter a goal
beneath the viewport and press Go. A goal or follow-up can also be recorded or
attached as WAV. Gemma receives that audio together with each viewport screenshot;
there is no transcription service. Up to four spoken inputs are retained for a
task, in order; start a new goal to clear them. Recording/picking pauses the loop.
Audio copies stay private and are removed on task replacement/Stop/close. Each step captures only the browser viewport,
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
Reasoning defaults off through the shared tab 7 setting.

The external browser has no Cleopatra JavaScript bridge, file access or content
access. Pages cannot invoke model/service controls. Model output is parsed as
bounded action data, never executable JavaScript. Typed text is JSON-quoted into
a fixed editing routine. The task prompt treats page contents as observations.
The browser can still be mistaken about a page or target: this is an experimental
agent tab, and neither navigation accuracy nor autonomous completion is qualified.

## Tab 9 and validation

See [Gemma avatar](GEMMA_AVATAR.md) for Load all, the validated tool API, scheduled
playback and the relaxed default stance. Desktop tests use the real renderer and
Java validators with fake inference responses. The package template and actual
LiteRT SDK schema adapter are checked without loading weights. Android compile,
lint and APK payload checks complement those tests. Phone execution remains the
user's job; model quality, residency and timings are not inferred from host tests.
