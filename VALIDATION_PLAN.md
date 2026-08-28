# Validation, quality, benchmark, and demo plan

This is the next project stage after dependency organization. It records the
intended protocol; it does not claim results that have not yet been measured.

## 1. Functional verification

- Run the fast and deep portable-bundle checks.
- Start from a cold machine state and confirm all six local services become
  ready and shut down without leaving processes or VRAM allocations behind.
- Exercise Facial Animation with generated, uploaded, and recorded audio.
- Exercise ARDY Core-8 batch generation, Core-40 live replanning, free-text
  prompts, cached embeddings, and multi-slot schedules.
- Verify Unified Character timing offsets, synchronized face/body playback,
  and MP4 export.
- Verify Live Full Flow speech queues, all three independent schedule loops,
  WASD override/resume behavior, camera targets, and body-direction anchors.
- Move a copy of the populated folder to a different absolute path and repeat
  the smoke workflow to validate environment rebasing.

## 2. Output quality tests

- Use a fixed prompt, route, seed, speech script, and avatar configuration.
- Record motion constraint error, temporal continuity, foot sliding, body
  orientation, face/body synchronization, lip alignment, and export A/V sync.
- Compare cold and warm runs without changing model or control settings.
- Preserve representative output files and their settings alongside the
  written observations; do not treat a single subjective rollout as a score.

## 3. Resource and latency benchmarks

- Record GPU model, VRAM, driver, system RAM, CPU, and Windows version.
- Measure cold startup and warm startup separately.
- Record idle RAM/VRAM after each resident model loads.
- Measure PocketTTS time to first audio and total real-time factor.
- Measure LAM processing time per second of audio.
- Measure Core-8 generation time, Core-40 replan latency, and achieved
  real-time factor.
- Measure combined live-flow speech-to-audio, speech-to-face, prompt-to-motion,
  and end-to-end response latency.
- Measure MP4 export duration, resolution, frame rate, output size, and A/V
  duration drift.
- Close the browser and launcher independently to distinguish WebGL memory from
  worker/model allocations.

Every reported result should state whether it is cold or warm and include at
least three runs plus median and range.

## 4. Project-introduction API and video

After the pipeline passes the preceding stages, add one high-level API action
that directs a repeatable project introduction. The action should orchestrate:

- a fixed introduction speech script,
- selected cached motion embeddings,
- a scheduled walk path,
- camera presets and direction anchors,
- live synchronized face, body, and voice playback,
- recording and MP4 export,
- a returned output path and benchmark metadata.

The final generated MP4 will be used as the opening media in the public GitHub
project overview. Its API action must be a composition of documented lower-level
controls rather than a hidden alternate runtime.
