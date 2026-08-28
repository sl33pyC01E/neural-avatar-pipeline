# Changelog

## 2026-08-27 — Workable local checkpoint

Face Lab reached a complete local testing state for the Zome VRM.

### Runtime

- Added one-click startup through `launch_face_lab.bat`.
- Organized the complete module under `Documents/face/face_animation` and the
  PocketTTS runtime under `Documents/voice/pocket_tts`.
- Connected Wav2Arkit, NVIDIA Audio2Face-3D v3, uLipSync, and LAM A2E.
- Kept the LAM and PocketTTS models resident between requests.
- Moved PocketTTS and the built-in Anna voice to CUDA on the RTX 4090.

### Preview and retargeting

- Added the high-quality local Zome VRM as the primary target.
- Corrected Zome's initial camera orientation.
- Routed standard VRM expressions through Three-VRM's expression manager so
  blinking and gaze are not overwritten during rendering.
- Added natural blinking, gaze drift, and subtle head/neck motion.
- Added separate eye, head, and mouth gain sliders with editable float limits.
- Added project-native examples for Audio2Face Claire, uLipSync Unity-Chan,
  LAM James, and the official NyxClaw animated reference.

### Output

- Added local audio upload, microphone capture, bundled sample loading, and
  Anna voice generation.
- Added H.264/AAC MP4 export of the active rendered animation and voice track.

### Verification

- All four inference engines reported ready through the WebUI.
- All four project examples loaded successfully.
- Zome blink behavior was visually verified during LAM playback.
- PocketTTS reported CUDA and generated the test line in about one second.
- A complete MP4 export was encoded successfully.
- The production frontend build and Python syntax checks passed.
