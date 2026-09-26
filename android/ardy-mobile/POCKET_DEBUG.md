# PocketTTS isolation checkpoint — 2026-09-26

The user tests on the phone; the agent reads logs, builds, and installs only.
The current checkpoint is a six-tab module lab with isolated tests and combined
speech, face and body runs. The earlier Pocket/LAM corrections remain the baseline.

## Integrated module lab — 0.4.0, version code 7

The user reported that 0.3.2 is better and requested a combined pipeline test,
then a welcome menu and an Ardy/full-pipeline split. The app now opens on:

1. **Welcome:** links to each module; loads no VRM, WebGL or inference session.
2. **PocketTTS:** the isolated Anna test and shared speech settings.
3. **Face:** the existing last-clip LAM replay and shared eye/mouth/head settings.
4. **Speak + face:** face camera, text input, Send and Stop.
5. **Ardy:** the former tab 1, with model/controls, cached embeddings and creation.
6. **Together:** text-to-speech/face plus the Ardy profile and cached steering
   embedding currently selected in tab 5. Body generation runs alongside speech;
   it is not inferred from the speech text. New embeddings are created in tab 5.

Tabs 4 and 6 read the actual tab 2 controls on Send and share the same face driver
and settings object as tab 3. This includes buffered versus raw streaming. WebView
DOM storage is now explicitly enabled for saved controls. Switching tabs must not
restore an older Ardy profile over an unsubmitted current selection.

`SpeechFacePipeline` assembles exact Pocket PCM into one-second windows, with two
bounded queues of two windows each. LAM analyzes ahead of playback. Each facial
window must be accepted by the visible renderer before the matching audio is
written to AudioTrack. Playback begins after the first window, not after analyzing
the entire clip. Only the final analysis window is zero-padded to 800 samples;
playback always gets the unmodified samples. Pocket/LAM sessions load concurrently
on demand, remain warm afterward, and queue workers shut down after each request.

Prepared speech still waits for Pocket's finalized pause-shortened clip. Raw
streaming can feed LAM during native audio callbacks and retains untrimmed pauses.
The existing native sentence-level LM barrier still applies. No extra text
segmentation, step reduction, precision change or sped-up playback is hidden in
the integrated tabs. Tab 4 runs no Ardy; tab 6 runs the real selected Core-8/Core-40
sampler, and pauses body requests when speech finishes or the user stops/leaves.

Ardy supplies the head/neck base pose in tab 6. The Face Lab head motion adds to
that pose once per rendered frame; it does not replace or accumulate over it.
Eye-bone gaze and the existing ARKit-to-VRM expression driver remain unchanged.
Stale stream IDs and windows arriving after a tab switch are rejected.

The compact Send-to-playback timing uses the native request time and AudioTrack's
`play()` call. It is not acoustic hardware latency. Details separate Pocket load/
generation, LAM load/compute, first facial window, duration and underruns. Timings
are saved as `cache/talk-last.json` or `cache/full-last.json`, with nested Pocket
settings. `totalMs` includes playback; raw callback backpressure is excluded from
Pocket compute time. The latest fully generated WAV also remains available in tab 3.

`SpeechFacePipelineCheck.java` ran real mixed-precision Pocket and LAM on Windows
CPU in both buffered and raw modes. Playback capture was bit-exact with the chosen
Pocket output, and rolling facial values matched the existing prepared-timeline
path. Queue backpressure, cancellation while full and worker-error propagation
passed. No audio device was opened. The SwiftShader browser check covers six-tab
navigation, inherited controls, rolling audio-clock following, stale-window
rejection, combined Ardy requests, additive head poses and the viewport layout.
These checks do not exercise Android AudioTrack or simultaneous phone CPU/GPU
contention. The user performs that test; the agent installs only.

## Speed checkpoint — 0.3.2, version code 6

The user confirmed that both speech and face work in 0.3.1 and requested more speed.
The last user-generated phone report recorded **FP32 / 10 steps / 2 threads / warm**:
1,661.6 ms generation, 2.761 seconds final audio, 0.602 RTF, 1,680.5 ms to the
playback-start call, and zero underruns. This was read from `cache/pocket-last.json`;
the agent did not initiate a phone test.

The new default **Faster · INT8 LM / FP32 audio** quantizes only `lm_main`.
The flow model, audio decoder, full repaired Anna conditioning, 10 flow steps,
seed, text handling, pause shortening and playback path remain as before.
The approved **Full precision** setting and **All INT8** comparison remain available.
Model/runtime selections now persist; selecting a different precision or thread
count still reloads Pocket. The new mixed profile requires the user's listening
and phone-speed test; it is not numerically identical to FP32.

A two-run Windows CPU comparison of the same prompt measured warm generation:
FP32 1.857 s, mixed 1.173 s, all INT8 0.906 s. The generated clips were 2.761,
2.942 and 2.918 seconds respectively, so this is an end-to-end comparison, not
an equal-latent-count kernel benchmark. Warm mixed was about 37% less generation
time in this check. These are **desktop** results, not predictions for the phone.
See `validation/pocket-speed-cpu-2026-09-26.json`.

Pocket and LAM now stay warm across tab switches while the memory budget allows.
Tab 2 still runs no LAM or avatar inference/rendering. Inference remains serialized
on the speech worker. Memory pressure, over-budget trimming, embedding creation
and Stop release sessions; they do no polling or model work while idle.

LAM keeps one prepared timeline for clips up to two minutes. Its key includes
every PCM sample and the model/metadata/postprocessing revision. Replaying the same
clip or changing amplitudes reuses that timeline without LAM inference. A changed
clip/model misses; memory trimming clears it. The first play of new audio still
runs the unchanged LAM window and postprocessor. The cache is memory-only and
does not survive process death. Timing now records cached/warm status, loading,
compute and playback start in `cache/lam-last.json`.

The actual shared LAM path produced 89 frames for mixed Anna on desktop CPU;
cached lookup and parsing took 12 ms versus 1.075 s for the cold LAM check.
Tests verify identical transported frame values, changed-PCM/model invalidation,
independent per-playback metadata, the size bound and pressure clearing.
The browser check preserves the playback-clock, readiness and amplitude checks
and checks persistent settings and access to the approved speech baseline.

## Quality correction — 0.3.1, version code 5

The user confirmed that 0.3.0 produces audio, but reported slow, unnatural cadence
and an often random first syllable. After the correction below, the user confirmed
that speech and LAM face playback both work. Further speed profiles need listening tests.

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

The approved quality baseline uses FP32 / 10 flow steps / decoder chunk 15 / two
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
- The APK includes the 402,298,879-byte LAM model for tab 3. Tab 2 never loads it;
  an already-used LAM session can remain warm without executing.
- Metrics distinguish model preparation, first decoded chunk, generated audio
  duration, and generation time excluding the synchronous playback callback.
  `computeRtf` excludes model loading and AudioTrack waiting; cold voice encoding
  remains part of generation. First chunk is not a hardware audible-latency measurement.
- CPU threads (1/2/4/6), flow steps (2/3/5/10) and decoder chunks (4/8/15) are exposed
  for user comparisons. Defaults are mixed precision / 2 threads / 10 steps / 15 decoder frames.
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

Tab 3 replays the last completed Pocket WAV through LAM. Pocket can remain warm,
and Ardy is paused/released. `LamWindow` runs the verified 64-frame,
24 kHz-to-16 kHz export on CPU, followed by the existing silence/blending/smoothing/
symmetry/blink postprocessor. `LamTimeline` analyzes one-second blocks; only the
final analysis block is padded to the 800-sample (30 fps) boundary. Playback uses
the unmodified original PCM. The complete face timeline is prepared and acknowledged
by the renderer before playback starts, then sampled against AudioTrack's clock.
Stop/tab changes/backgrounding cancel playback; tab changes retain warm sessions.
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
