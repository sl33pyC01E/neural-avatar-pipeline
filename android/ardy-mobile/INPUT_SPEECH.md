# Cleopatra 0.8.3 (20): input, attention and speech

The Face preset starts horizontally at the VRM's eye height, centered at yaw
zero. VRM look-at computes the listener direction from the camera and the
current world-space head pose; the same smoothed target spans idle and speech.
LAM expression output and independent eye/mouth/head gains remain active.

Main's bottom row is hold-to-talk, camera/media, text and send. Releasing the
microphone sends the recorded audio directly to Gemma, together with any text.
Cancelled/hidden holds do not send. A first-use permission dialog ends the hold;
after granting it, hold again. Space/Enter also operate the focused microphone.
The camera menu offers native photo capture, image picker and WAV picker.
Photo capture uses an unexported FileProvider restricted to `cache/camera/`;
photo decoding is downsampled to a maximum 2048-pixel edge before orientation
and PNG conversion. Input still has the existing 20 MB source-file limit.

Send on Enter defaults on and persists in Settings. Shift+Enter and IME
composition do not submit. Turning it off allows Enter for new lines.

## What streaming means here

[Pocket's Python API](https://github.com/kyutai-labs/pocket-tts/blob/main/docs/API%20Reference/python-api.md)
accepts a text string and yields audio chunks. It does not expose an incremental
text-token input stream. The pinned
[Sherpa 1.13.8 implementation](https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/sherpa-onnx/csrc/offline-tts-pocket-impl.h)
resets its speech/decoder state for each internal sentence segment, generates
the segment's latent frames and then emits decoded PCM callbacks. Native pause
shortening only affects the returned audio, after those callbacks.

Main now groups Gemma's cumulative answer into complete phrases, normally at
sentence boundaries after 160 characters, with a 360-character cap. Short
answers flush at completion. One bounded native text queue feeds one
SpeechFacePipeline, one LAM reset and one AudioTrack across the reply. It does
not feed partial word tokens into Pocket, and Pocket's speech state still
restarts between phrase calls. Inputs remain limited to 2,000 characters;
cancel, late input and model failure stop the take rather than replaying text.

Pocket's internal minimum/maximum segment lengths change from 30/200 to
180/400 characters, grouping adjacent short sentences with their punctuation.
This applies to the voice runtime in debug tabs too. Existing voice settings
still apply: prepared mode shortens pauses and returns PCM per prepared phrase;
raw mode forwards the native audio callbacks without pause shortening.
`Start speaking as the reply arrives` defaults on for Main and can be disabled
to compare against the full-answer path.

Avatar controls must precede spoken words. The native service supplies the
validated plan alongside text; the first phrase stages it, and later tool calls
after spoken text are rejected. Torso/Body retain their motion coverage gates,
scheduled speech cue, shared playback clock and tail. There is no new claim
of gap-free playback under arbitrary generation load; underruns remain visible
in Session metrics.

## Verification and limits

- Android Java compilation, debug build and lint.
- `check_speech_phrases.mjs`: incremental text is spoken exactly once, short
  sentences group, phrase size is bounded, revisions/oversize input fail.
- `SpeechInputCheck.java`: synthetic PCM crosses two input phrases without
  loss/reordering/padding, starts before text completion and resets LAM once;
  queue bounds and cancellation also checked. No model inference or sound.
- `check_desktop_web.mjs`: real Cleopatra VRM with CPU SwiftShader rendering,
  fake native bridge; eye-level preset, narrow-screen layout, mic release and
  cancellation, camera/media routing, Enter/IME handling, voice before final
  Gemma text, one take across phrases, existing frame/tool/startup behavior.
- `check_model_chat.py`: real SDK tool declarations and scoped grammar flags,
  streaming parser, frame restrictions and invalid control rejection.

These checks do not establish native phone speech quality, latency or camera/
microphone behavior. Installation is allowed; phone launch and listening tests
belong to the user. No device inference or UI automation is used by this update.
