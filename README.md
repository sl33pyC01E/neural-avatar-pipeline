# Unified Character Lab

A self-contained Windows lab for CUDA speech, facial animation, ARDY body-motion
generation, and direct VRM preview/retargeting.

## Start

Double-click `launch.bat`. Keep the launcher window open while using the lab.
The unified interface opens automatically at <http://127.0.0.1:8788/>.

Use the three tabs at the top:

- **Facial Animation** — PocketTTS voice generation plus Wav2Arkit,
  Audio2Face, uLipSync, and LAM facial drivers.
- **ARDY VRM Motion** — ARDY Core-8 batch generation, Core-40 live motion,
  route constraints, and direct Zome VRM preview/retargeting.
- **Unified Character** — captures the latest completed face/voice and ARDY
  clips, schedules independent start offsets, plays both on one Zome VRM, and
  exports the combined viewport and voice audio as MP4.

## Default character pipeline

- Voice: PocketTTS `anna` on CUDA
- Face driver: LAM A2E
- Face target: Zome
- Face retargeting: eyes 1.55×, head 1.00×, mouth 0.57×
- Natural head and eye motion: enabled
- Motion runtime: ARDY Core-8 batch / Core-40 live
- Motion text conditioning: bundled 4-bit LLM2Vec with permanent, selectable
  embedding cache entries
- Motion target: Zome VRM

The ARDY workspace remains mounted while changing tabs and also saves its route,
prompts, duration, constraints, and control values locally across page reloads.
Timed text uses explicit start-time/input rows. Free-text rows are resolved as
separate embeddings before rollout; cached mode replaces every prompt field with
an exact permanent-cache dropdown and loads those tensors without running the
text encoder again.
Batch duration is a numeric input without an artificial 12-second maximum;
longer clips take proportionally longer to generate.

Close the launcher window, or press `Ctrl+C` in it, to stop all services.
Shutdown terminates each complete service process tree. CUDA workers also watch
their owning process and exit if it disappears unexpectedly; the browser page
then unloads its embedded WebGL labs so an old tab does not retain GPU memory.
ARDY workers record their owner PID, and a later launch will never silently
adopt a stale worker left by an earlier run.

## Portability

Everything needed by the local lab is below this folder: source code, model
weights, Python runtimes and environments, Node.js, FFmpeg, CUDA user-mode
libraries, the locally supplied VRM avatar, and browser assets. The launcher resolves paths from its own
location and repairs copied environment metadata on every start, so the entire
`unified` folder can be moved or copied to another drive without editing paths.

The original labs are not read at runtime and were not modified. Model loading
is forced to the bundled offline Hugging Face cache.

The destination computer still needs:

- Windows 10 or 11, 64-bit;
- a compatible NVIDIA GPU and current NVIDIA display driver;
- enough free disk space for the approximately 44.3 GB folder.

Python, Node.js, FFmpeg, Hugging Face downloads, and a separate CUDA Toolkit
installation are not required.

## GitHub source checkout

The local working folder is the complete portable build. The GitHub repository
tracks the application source, configuration, documentation, and small assets,
but intentionally excludes Zome (or any other VRM avatar) and the approximately 46 GB of copied model
weights, Python/Node runtimes, virtual environments, installed dependencies,
and generated output. GitHub rejects individual files over 100 MB, and those
binary payloads also exceed ordinary Git LFS storage quotas.

Therefore, a plain GitHub clone is a source checkout rather than a runnable
portable distribution. Keep or separately copy the ignored payload directories
listed in `.gitignore` when moving the fully self-contained build. Supply an
appropriately licensed local avatar at `vnyan/Zome.vrm` to use the current
default configuration; that file is never distributed by this repository.

## Credits, licenses, and research citations

This project integrates third-party software and models; it does not claim
ownership of them. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for
upstream authors, source links, licenses, model terms, and publication-ready
BibTeX citations. Dependency lock files remain the complete version inventory
for transitive Python and JavaScript packages.

## Included services

| Port | Service |
| ---: | --- |
| 8788 | Unified WebUI |
| 8793 | ARDY motion UI and API |
| 8794 | Facial-animation backend |
| 8795 | Facial Animation Lab UI |
| 8796 | PocketTTS CUDA worker |
| 8797 | LAM Audio2Expression worker |
| 8798 | Audio2Face worker |

If one of these ports is already occupied, the launcher stops with a clear
message instead of attaching to another copy of a lab.

## Logs and outputs

- Service logs: `logs/`
- Generated ARDY motion: `motion-models/outputs/webui/`
- Browser-exported recordings: the browser's normal Downloads folder

Run `verify.bat` at any time for a read-only completeness check. It confirms
that the bundled runtimes, environments, model stores, avatar, entry points,
and WebUI are present.

## Verified on this build

The finished bundle was launched from this folder and checked end to end:

- all seven local services started and reported healthy;
- PocketTTS synthesized Anna speech on CUDA;
- Wav2Arkit, uLipSync, LAM, and native Audio2Face each produced facial frames;
- ARDY Core-8 generated a constrained batch motion on `cuda:0`;
- ARDY Core-40 generated a live motion window on `cuda:0`;
- both unified WebUI tabs and the embedded Zome VRM rendered in the browser.

See `PROJECT_MAP.md` for the portable directory and runtime map.
