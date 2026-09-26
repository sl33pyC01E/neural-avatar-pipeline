# In-app Gemma and browser: 0.6.0

Gemma 4 E2B is the only conversational model. LiteRT-LM 0.17.1 loads the full
`gemma-4-E2B-it.litertlm` bundle on CPU or GPU for decoder/vision, with the audio
encoder on CPU. The separately named `-gpu` artifact is text-only and is unused.
No Qwen, Whisper or WhisperX chat runtime is packaged. Ardy's LLM2Vec JNI remains.

## Tab 7: Models

Load Gemma, then type, attach an image/WAV or record audio. Gemma receives audio
directly. Attachments remain bounded to 20 MB; images to 16 megapixels. Reasoning
defaults on with a 256-token budget (128/256/512 selectable). The actual package's
template supports the reasoning toggle and emits a `thought` channel; the UI
streams it separately from the answer in a collapsed-by-default disclosure.
All generated text is inserted as text, never HTML. Only the answer is spoken.

The engine uses a 4,096-token context and at most eight images per conversation;
image allocation is controlled by the artifact and has no runtime slider here.
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

## Tab 9 and validation

See [Gemma avatar](GEMMA_AVATAR.md) for Load all, the validated tool API, scheduled
playback and the relaxed default stance. Desktop tests use the real renderer and
Java validators with fake inference responses. The package template and actual
LiteRT SDK schema adapter are checked without loading weights. Android compile,
lint and APK payload checks complement those tests. Phone execution remains the
user's job; model quality, residency and timings are not inferred from host tests.
