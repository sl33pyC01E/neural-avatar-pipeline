# PocketTTS isolation checkpoint — 2026-09-26

The user tests on the phone; the agent reads logs, builds, and installs only.
Current target: reliable, fast **Anna** speech in tab 2, independently of VRM,
Ardy, LLM2Vec inference, and LAM. The user also requested the working LAM tab in this build.

## Current quality correction — 0.3.1, version code 5

The user confirmed that 0.3.0 produces audio, but reported slow, unnatural cadence
and an often random first syllable. **Perceptual quality is not yet confirmed.**

Two concrete defects were found while checking this report:

1. Both upstream precision bundles contain the same broken voice encoder. Its
   first padding target is the traced constant **24,960 samples**. ONNX Pad receives
   `24960 - audio_length`, which becomes negative and crops longer input. Anna's
   12.571656-second source therefore supplied only **1.04 seconds / 13 frames** of
   conditioning. `repair_pocket_encoder.py` replaces just this scalar with dynamic
   `ceil(audio_length / 1920) * 1920`; weights and remaining nodes are unchanged.
   The corrected graph produces **158 frames** for the full reference. Regression
   checks cover 1/2/10/12.57 seconds, bit-exact 1-second behavior, and a tail mutation
   that the old graph completely ignores but the repaired graph detects.
2. Sherpa applies `ScaleSilence(0.2)` to its final returned audio **after** sending
   streaming callbacks. The old app played raw callbacks, whereas the earlier
   desktop check measured the shortened returned WAV. Those were different audio
   paths. The prepared-clip mode now captures and plays the returned audio itself.
   Raw streaming remains explicitly labeled as untrimmed and sets silence scale 1.

The default quality baseline uses FP32 / 10 flow steps / decoder chunk 15 / two
CPU threads / seed 42, with the full clip prepared before playback. INT8 uses the
same repaired encoder and is available for an otherwise identical comparison.
The 10-step baseline follows the [January export wrapper](https://huggingface.co/KevinAHM/pocket-tts-onnx/blob/355aac517813b2915a662801f8a3a31a2304aa4d/pocket_tts_onnx.py);
it is not a claim that 10 steps are required or fastest. FP32 adds about 383 MB
of models to this diagnostic APK. Only the selected precision is loaded.

Input now receives the reference's initial capitalization and terminal punctuation,
and Sherpa's default 200/30-character phrase bounds replace the forced 120/20
split. The native merger still removes spaces after some punctuation; that upstream
behavior is unchanged. AudioTrack is primed before `play()`. Timing includes actual
playback-start call separately from first decoded chunk, plus underruns before the
intentional final drain. It is not a hardware audible-latency measurement.

`cache/pocket-last.wav` stores one completed generated clip as lossless float32 WAV;
`cache/pocket-last.json` stores precision, settings, durations and playback metrics.
The phone creates them only when the user invokes speech. No microphone capture,
background synthesis, or agent-triggered phone test is involved. The cache may be
reclaimed by Android. Cancelled/failed generation keeps the previous completed WAV.

Desktop CPU checks confirmed the repaired encoder is used by Sherpa, finite speech
from both precision modes, and bit-exact WAV buffering/replay. They do not establish
intelligibility, voice similarity, phone latency or thermal behavior. The prior
0.328 desktop RTF used truncated conditioning and a different audio duration; it
must not be treated as the current model's performance baseline.

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

- INT8 and FP32 language, flow and decoder graphs are bundled with Anna's exact
  reference audio. The repaired voice encoder and text conditioner use FP32.
- A warm engine and one cached Anna voice embedding are reused. Changing CPU
  threads reloads the engine; memory pressure can also release it.
- Tab 2 never initializes LAM. It starts without fetching VRM geometry or loading
  the avatar JS module; visiting it pauses motion, closes warm Ardy sessions and
  stops avatar rendering. An already-running embedding must finish before speech.
- The APK includes the 402,298,879-byte LAM model for tab 3. Tab 2 never loads it.
- Metrics distinguish model preparation, first decoded chunk, generated audio
  duration, and generation time excluding the synchronous playback callback.
  `computeRtf` excludes model loading and AudioTrack waiting; cold voice encoding
  remains part of generation. First chunk is not a hardware audible-latency measurement.
- CPU threads (1/2/4/6), flow steps (2/3/5/10) and decoder chunks (4/8/15) are exposed
  for user comparisons. Current defaults are 2 threads / 10 steps / 15 decoder frames.
  A lower step count may reduce speech quality; no setting is claimed fastest yet.

[Pocket's pinned implementation](https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/sherpa-onnx/csrc/offline-tts-pocket-impl.h)
finishes a sentence's LM/flow latent sequence before decoding chunks. Smaller decoder
chunks do not provide token-by-token LM streaming. The standard sentence segmentation
uses a 200-character maximum and 30-character minimum merge target. Cancellation takes effect at audio callbacks, not during the
sentence's native LM loop. The UI keeps that distinction visible.

Further quantization or compiled GPU/NPU/LiteRT work is authorized, but should
be compared against the user's stable warm/cold speech measurements and Anna's
quality. The present fix does not claim GPU/NPU offload or final phone performance.

## LAM tab and independent amplitudes

Tab 3 replays the last completed Pocket WAV through LAM. Pocket is released before
LAM loads, and Ardy is paused/released. `LamWindow` runs the verified 64-frame,
24 kHz-to-16 kHz export on CPU, followed by the existing silence/blending/smoothing/
symmetry/blink postprocessor. `LamTimeline` analyzes one-second blocks; only the
final analysis block is padded to the 800-sample (30 fps) boundary. Playback uses
the unmodified original PCM. The complete face timeline is prepared and acknowledged
by the renderer before playback starts, then sampled against AudioTrack's clock.
Stop/tab changes/backgrounding cancel playback; non-face tabs release the LAM session.
This first prepared-clip route does not claim live LAM inference or phone lip-sync qualification.

The Face Lab's existing head/neck natural-motion equations and default gains are
reused: eyes 1.55, mouth 0.57, head 1.0. Sliders are independent and persist locally;
zero really disables the corresponding movement. The shared mapper's prior `|| 1`
fallback incorrectly treated zero as one and left smile/frown morphs unscaled; both
are corrected in this branch's `retargetting/motion-control.js` before extraction.
The original checkout's unrelated edits are untouched.

Cleopatra declares VRM **Bone** look-at with inner/outer horizontal and vertical
range maps. Eye gaze therefore uses Three-VRM's configured bone applier; alternative
look-direction morphs are cleared to avoid applying gaze twice. Blinks/wide/squint
remain expression/morph channels. Mouth uses LAM's 52 ARKit channels through the
existing shared VRM/VRC viseme mapper. Head/neck rotation is the explicit Face Lab
procedural overlay, not a claimed LAM output. The natural-motion checkbox disables
that overlay and procedural gaze/blinks. Tab 3 has its own face camera framing;
tab 1's camera state is restored on return.

`LamTimelineCheck.java` ran the same production window and timeline code on the
corrected FP32 Pocket WAV: 66,272 samples, 83 aligned frames, nonzero jaw response,
unchanged PCM, finite output and cancellation before inference. The browser check
verified audio-clock interpolation, renderer readiness acknowledgement, bone gaze,
independent gains, zero suppression and neutral restoration, with CPU SwiftShader.
These remain desktop checks, not a phone test.
