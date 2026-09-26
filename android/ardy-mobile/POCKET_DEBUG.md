# PocketTTS isolation checkpoint — 2026-09-26

The user tests on the phone; the agent reads logs, builds, and installs only.
Current target: reliable, fast **Anna** speech in tab 2, independently of VRM,
Ardy, LLM2Vec inference, and LAM. Face integration follows in tab 3.

## Observed crash and correction

The user's 0.2.1 test aborted at 07:25:10 local time. Read-only crash-buffer
inspection found `SIGABRT` with `NoSuchMethodError` for
`PocketAnna$$ExternalSyntheticLambda0.invoke([F)Ljava/lang/Integer;`.
JNI then called `NewFloatArray` with that exception pending.

[Sherpa 1.13.8's JNI callback](https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/sherpa-onnx/jni/offline-tts.cc)
looks up that concrete boxed-Integer signature. A Java lambda implementing Kotlin's
generic `Function1` exposes the erased method. `PocketCallback` now explicitly
implements `Integer invoke(float[])`; keep rules preserve it for optimized builds.
The callback validates samples, propagates sink errors outside JNI, and honors
cancellation without another audio-array copy.

The prior Windows synthesis check used Sherpa's **Java** callback interface.
It could not expose this Android **Kotlin API** mismatch. The new check reproduces
the missing method on the old SAM, checks the replacement, and inspects the APK's
DEX implementation against the native library descriptor. These checks do not
replace the user's Android synthesis/playback test.

## Runtime and measurements

- Existing INT8 language, flow and decoder graphs are retained with Anna's exact
  reference audio. The voice encoder and text conditioner retain their original precision.
- A warm engine and one cached Anna voice embedding are reused. Changing CPU
  threads reloads the engine; memory pressure can also release it.
- Tab 2 never initializes LAM. It starts without fetching VRM geometry or loading
  the avatar JS module; visiting it pauses motion, closes warm Ardy sessions and
  stops avatar rendering. An already-running embedding must finish before speech.
- The default APK omits the inactive 402,298,879-byte LAM model. Its local export,
  code and numerical reports remain available for the next phase.
- Metrics distinguish model preparation, first decoded chunk, generated audio
  duration, and generation time excluding the synchronous playback callback.
  `computeRtf` excludes model loading and AudioTrack waiting; cold voice encoding
  remains part of generation. First chunk is not a hardware audible-latency measurement.
- CPU threads (1/2/4/6), flow steps (2/3/5) and decoder chunks (4/8/15) are exposed
  for user comparisons. Defaults remain 2 threads / 5 steps / 8 decoder frames.
  A lower step count may reduce speech quality; no setting is claimed fastest yet.

[Pocket's pinned implementation](https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/sherpa-onnx/csrc/offline-tts-pocket-impl.h)
finishes a sentence's LM/flow latent sequence before decoding chunks. Smaller decoder
chunks do not provide token-by-token LM streaming. Shorter sentence segmentation
(120-character maximum, 20-character minimum merge target) limits pre-audio work
on longer input. Cancellation takes effect at audio callbacks, not during the
sentence's native LM loop. The UI keeps that distinction visible.

Further quantization or compiled GPU/NPU/LiteRT work is authorized, but should
be compared against the user's stable warm/cold speech measurements and Anna's
quality. The present fix does not claim GPU/NPU offload or final phone performance.
