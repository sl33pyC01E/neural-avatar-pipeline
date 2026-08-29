# Portable dependency contract

Neural Avatar Pipeline has two forms of the same repository:

- The public Git checkout contains source, lock files, manifests, and
  documentation.
- The populated local working tree additionally contains ignored Python
  environments, runtimes, CUDA libraries, models, a voice embedding, and a
  user-supplied avatar. Copying that entire populated folder produces the
  offline portable bundle.

No active service reads the original Face, Voice, or Retargetting projects.

## Environment layout

| Runtime | Location inside `unified` | Python | Dependency role |
| --- | --- | --- | --- |
| Shared CUDA base | `runtime/python312` | 3.12.10 | PyTorch 2.6.0+cu124 and common ARDY/PocketTTS dependencies |
| ARDY overlay | `ardy/.venv` | 3.12.10 | ARDY-specific Transformers 5.8.1, bitsandbytes, Triton 3.2 for Windows, and model packages |
| PocketTTS overlay | `voice/pocket_tts` | 3.12.10 | PocketTTS 2.1.0, Anna support, NumPy 2.5.1, and the shared CPU ONNX emotion classifier runtime |
| LAM environment | `face_animation/LAM-Audio2Expression/.venv` | 3.10.11 | Isolated PyTorch 2.1.2+cu121 and Transformers 4.36.2 stack |

The two Python 3.12 overlays use `include-system-site-packages = true` so they
share one large PyTorch installation. This is intentional. ARDY requires NumPy
below 2 while PocketTTS 2.1 requires NumPy 2 or newer; each overlay shadows the
shared base only where its dependency graph differs. Flattening them into one
environment would make at least one runtime invalid.

LAM remains isolated because its older PyTorch, Torchaudio, Transformers, and
NumPy combination is not compatible with the active ARDY/PocketTTS stack.

Exact installed versions are recorded under [`requirements/`](requirements/).
[`dependency-manifest.json`](dependency-manifest.json) records the runtime,
environment, and upstream-source topology in machine-readable form.
Given populated bundled interpreters and source checkouts,
`setup-environments.ps1` recreates these same three environments. Pass
`-Rebuild` only when intentionally replacing existing environment folders.

The optional compiler backend uses `triton-windows==3.2.0.post21`. Triton 3.2
is the version paired with PyTorch 2.6; its Windows wheel includes the compiler
toolchain required by CUDA Inductor. This package lives inside `ardy/.venv`, so
it travels with a populated portable copy. Compilation is not enabled by the
default Efficiency Mode because Core-40's changing live-history shapes caused
an unacceptable first-horizon compile stall during initial integration.

## Relocation

Python virtual environments normally retain absolute paths to their base
interpreter. Before starting any service, `launcher.mjs` rewrites each local
`pyvenv.cfg` using the current location of the repository:

- `ardy/.venv` is rebound to `runtime/python312`.
- `voice/pocket_tts` is rebound to `runtime/python312`.
- `face_animation/LAM-Audio2Expression/.venv` is rebound to
  `runtime/python310`.

The launcher also constructs `PATH`, `PYTHONPATH`, CUDA, FFmpeg, Hugging Face,
and offline-cache variables exclusively from paths below its own directory.
The system NVIDIA display driver remains the only required GPU component that
cannot travel inside the project folder.

To move the complete lab, copy the entire populated `unified` directory to the
new Windows x64 machine, place an appropriately licensed local VRM at the
configured avatar path, and run `launch.bat`. Do not copy only the Git-tracked
files if an offline-ready bundle is required.

## Source and payload identity

The active source revisions are recorded in `dependency-manifest.json`:

- ARDY: `693f74d13b3d04a0a22ce127ee79c929dd89756b`
- LAM Audio2Expression: `02a703c3ea7d8e360eb43098eca85ee98a083529`
- PocketTTS: package version `2.1.0`
- Emotion English DistilRoBERTa-base: source revision `0e1cd914e3d46199ed785853e12b57304e04178b`, locally exported as dynamic INT8 ONNX
- Quantized LLM2Vec: exact base, MNTP, and supervised-adapter revisions

[`payload-manifest.json`](payload-manifest.json) records expected paths, byte
sizes, revisions, and SHA-256 hashes for the two ARDY models, the quantized text
encoder, PocketTTS English model and Anna embedding, the local emotion
classifier, and the LAM streaming checkpoint. The avatar is explicitly excluded.

Run `verify.bat` for a fast inventory and exact package-version comparison. Run
`verify.bat --deep` to additionally hash every recorded model payload. Neither
mode starts a service or loads a model onto the GPU.

## Rebuilding instead of copying

The lock files are suitable inputs for a future bootstrap script, but they do
not by themselves grant download or redistribution rights. A rebuild must:

1. Supply matching portable CPython 3.10.11 and 3.12.10 runtimes.
2. Install the shared Python 3.12 lock.
3. Run `setup-environments.ps1`, which creates the ARDY and PocketTTS
   environments with `--system-site-packages`, then installs their overlay
   locks.
4. The setup script installs the vendored `ardy/` source in editable mode
   without re-resolving dependencies and creates the isolated LAM environment.
5. Acquire each model at the recorded revision after accepting its applicable
   terms, then compare it with `payload-manifest.json`.
   `face_animation/webui/backend/build_emotion_model.py` downloads the pinned
   emotion checkpoint and produces the recorded CPU INT8 ONNX payload.
6. Supply Node.js, npm, FFmpeg, CUDA user-mode libraries, and a local VRM.

Some payloads are gated or separately licensed. Authentication tokens must be
provided by the user at download time and must never be written into this
repository.
