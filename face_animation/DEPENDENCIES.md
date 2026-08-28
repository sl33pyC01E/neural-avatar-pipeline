# Facial module dependency manifest

The default facial pipeline has one inference engine. Its upstream checkout and
large runtime payloads remain local and are intentionally excluded from Git.

| Local folder | Upstream | Pinned revision | Runtime role |
| --- | --- | --- | --- |
| `LAM-Audio2Expression` | [`aigc3d/LAM_Audio2Expression`](https://github.com/aigc3d/LAM_Audio2Expression) | `02a703c` | CUDA audio-to-ARKit expression inference |

Additional local requirements are PocketTTS 2.1.0 with the Anna preset, FFmpeg
for MP4 encoding, a compatible NVIDIA GPU/driver, and a user-supplied VRM. The
complete portable bundle keeps all application-level runtimes below the project
root. The Git source checkout omits them.

Earlier comparison engines are preserved in the `raw` branch. Copies in the
maintainer's local `legacy/` directory are ignored and are neither active
dependencies nor part of the public `master` tree.
