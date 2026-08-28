# LAM facial animation module

This module is the facial-animation stage of Neural Avatar Pipeline. It accepts
generated, uploaded, or recorded speech; runs LAM Audio2Expression; retargets
the resulting ARKit channels to the local VRM; and can export the rendered face
track with its audio as MP4.

## Active components

- `webui/app/` — browser interface and VRM preview
- `webui/backend/server.py` — status, local avatar delivery, and MP4 export
- `webui/backend/pocket_tts_server.py` — PocketTTS `anna` CUDA service
- `webui/backend/lam_server.py` — persistent LAM inference service
- `LAM-Audio2Expression/` — local upstream code, environment, and checkpoint;
  excluded from Git
- `DEPENDENCIES.md` — upstream revision and local payload notes

The former comparison drivers are not part of the `master` runtime or UI. Their
last tracked state is available on the `raw` branch; the maintainer's copied
payloads are retained only in the repository's ignored `legacy/` folder.

## Use

Start the complete application with the repository-root `launch.bat`, then open
the **Facial Animation** tab. Generate Anna speech, upload a compatible audio
file, or record a microphone clip. Select **Generate LAM animation** to create
the face track. The controls adjust eye, head, and mouth intensity and optional
natural movement. **Export MP4** records the current face preview with audio.

The default local avatar convention is `../vnyan/Zome.vrm`, but the avatar is a
user-supplied file and is never committed or distributed by this project.
