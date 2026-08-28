# Changelog

## 2026-08-28 — Default LAM pipeline

- Reduced the public facial-animation runtime and UI to LAM Audio2Expression.
- Removed the inactive comparison-driver selector, examples, adapters, and
  dedicated worker from the default branch.
- Kept PocketTTS Anna speech generation, microphone/upload input, VRM preview,
  retarget controls, natural eye/head motion, unified-track handoff, and MP4
  export.
- Preserved the original multi-driver source snapshot on the `raw` branch and
  copied removed local payloads into the ignored `legacy/` directory.
- Kept both ARDY Core-8 batch and Core-40 live runtimes in the overall pipeline.
