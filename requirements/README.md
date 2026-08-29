# Python environment locks

These manifests describe the active Windows x64 portable bundle. They are
exact installed-version snapshots, not broad upstream development
requirements.

| Manifest | Installed location | Base interpreter | Isolation |
| --- | --- | --- | --- |
| `python312-shared.lock.txt` | `runtime/python312/Lib/site-packages` | CPython 3.12.10 | shared base |
| `ardy-overlay.lock.txt` | `ardy/.venv/Lib/site-packages` | bundled 3.12.10 | inherits shared base |
| `pockettts-overlay.lock.txt` | `voice/pocket_tts/Lib/site-packages` | bundled 3.12.10 | inherits shared base |
| `lam-python310.lock.txt` | `face_animation/LAM-Audio2Expression/.venv/Lib/site-packages` | bundled 3.10.11 | isolated |

ARDY and PocketTTS share the large PyTorch/CUDA base but carry conflicting
packages in separate overlays. The shared base includes Transformers 5.2.0 and
ONNX Runtime 1.24.3 for the CPU emotion classifier. ARDY overrides Transformers
with 5.8.1 while retaining NumPy 1.26;
PocketTTS sees its overlay NumPy 2.5.1. LAM remains isolated on PyTorch 2.1.2,
CUDA 12.1 wheels, NumPy 1.26.3, and Transformers 4.36.2.

The ARDY overlay also pins `triton-windows==3.2.0.post21`, the Triton 3.2
toolchain matched to the shared PyTorch 2.6 build. It enables the optional
experimental `torch.compile` denoiser path; the standard Efficiency Mode does
not enable compilation.

The vendored ARDY source is installed separately from `./ardy` in editable
mode. Its source identity is recorded in `dependency-manifest.json`. LAM is
executed from its local source checkout and is not installed as a Python
distribution.

The lock files intentionally do not grant redistribution rights for Python
wheels, CUDA libraries, model weights, or voice assets. Consult
`THIRD_PARTY_NOTICES.md` before distributing a populated portable bundle.
