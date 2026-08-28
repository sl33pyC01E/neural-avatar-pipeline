# Facial Animation WebUI

This WebUI provides the PocketTTS-to-LAM face workflow used by Neural Avatar
Pipeline. The root launcher starts the interface, face API, persistent Anna
speech worker, and persistent LAM worker.

## Workflow

1. Enter text for PocketTTS Anna, upload audio, or record a microphone clip.
2. Generate speech when using text.
3. Select **Generate LAM animation**.
4. Preview the ARKit track on the local VRM and adjust eye, head, mouth, and
   natural-motion controls.
5. Export the active facial animation and audio as H.264/AAC MP4 when needed.

The face API is intentionally narrow: it reports LAM and avatar readiness,
serves the local avatar, and performs MP4 encoding. LAM inference runs through
`backend/lam_server.py`; the UI contains no driver selector or fallback facial
engine.

Use the repository-root `launch.bat` for normal operation. The source checkout
does not include its model checkpoint, virtual environments, media runtime, or
avatar; those must be supplied in the documented ignored locations.
