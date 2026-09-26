# Scheduled Together takes — 0.4.1

Tab 6 prepares a fresh Core-8/Core-40 motion stream at frame zero while holding
the displayed pose. It releases audio only after the renderer acknowledges both
the corresponding LAM window and sufficient contiguous Ardy frames. Preparation
does not advance motion. A new take resets generated context/seed; regular tab 5
retains its separate rolling checkpoint.

The AudioTrack contains lead silence, the exact Pocket speech PCM, and tail
silence. Its playback position drives body and face. The **Speech cue** (default
0.5 seconds, adjustable 0–3) locates speech and face on the Ardy track. The
**Motion tail** (default 1 second, adjustable 0.5–3) leaves motion after speech.
The final half second smoothly reduces body playback speed to zero; face weight
fades over 0.25 seconds. The final generated pose is held with rendering asleep.
This is a continuous eased hold, not learned locomotion braking or foot locking.
Tab 4 retains its immediate speech/face path.

`playbackStartMs` measures AudioTrack start relative to Send; `speechStartMs`
adds the scheduled cue. Neither is a microphone measurement of acoustic latency.
The report also includes motion-gate wait, cue, tail, track duration and underruns.
The saved last-speech WAV contains speech only, so tab 3 replays unchanged audio.

The user's preceding 0.4.0 take reported playback start 1060.59 ms, first face
1044.72 ms, Pocket compute 696.56 ms, and zero underruns. That is a single user
run, not a benchmark of 0.4.1.

Validation: Android assemble/lint, packaged DEX/assets/hash/signature checks,
pure timeline/real-motion buffer checks, and the complete web renderer with a
stub native bridge under CPU SwiftShader. Browser checks cover frame-zero start,
preparation hold, motion coverage before audio, exact cue offset, stationary
audio clock, tail fade/hold, repeated takes and idle shutdown. They do not run
Android inference or audio playback. The agent installs; the user tests.
