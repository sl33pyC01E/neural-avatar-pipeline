# Cleopatra / unimobile

Standalone Android handoff, prepared 2026-09-27. Start here rather than the older checkpoint notes in `project/`.

This folder contains editable Android/WebView source, the Cleopatra VRM and retargeter, Pocket TTS with Anna, LAM, both Ardy cores, the LLM2Vec encoder, Gemma E2B/E4B QAT weights, native runtimes, a signed debug APK, and a Windows x64 offline build toolchain. No MiniCPM, Qwen or Whisper application model is included.

## Use

1. Copy this entire folder to a writable local folder on a Windows x64 machine. Preserve the directory layout. Avoid deeply nested paths.
2. `powershell -ExecutionPolicy Bypass -File .\verify.ps1` verifies the source, model and APK SHA-256 manifest.
3. `powershell -ExecutionPolicy Bypass -File .\build.ps1 -Clean` builds and lints the APK offline. Android Studio, an external JDK, Python installation and the parent unified project are not required.
4. Connect an Android arm64 phone (Android 10+ for Cleopatra), enable USB debugging and authorize that computer. Run `toolchain\sdk\platform-tools\adb.exe devices -l` to find its transport ID.
5. `powershell -ExecutionPolicy Bypass -File .\install.ps1 -Transport <id>` installs the shipped Cleopatra APK and verifies/copies the separate model files. It does not launch the app. The user tests on the phone.

The models are included in this folder and installed into app-private storage; the main APK alone is not the complete distribution. After installation, inference needs no network. Browser search naturally uses the network. Android WebView and optional camera/media apps are operating-system dependencies. Debug signing keys and device authorization keys are deliberately not included.

## Contents

| Path | Purpose |
| --- | --- |
| `project/avatar-validation` | Gradle project, Java services and main/debug WebView UI |
| `project/payloads` | Durable build inputs and offline weights; survives Gradle clean |
| `project/recovery/assets` | Ardy normalization, skeleton, embedding bank and sample poses |
| `project/recovery/lib` | Recovered LLM2Vec arm64 JNI runtime |
| `project/native` | Launcher source and native rebuild provenance |
| `project/tools` | Preparation and host verification scripts; some optional model exports need additional Python packages |
| `dist` | Shipped signed APK; installer uses this rather than silently installing a new build |
| `toolchain` | Windows JDK, Android SDK subset, Gradle dependency cache, Python stdlib and Node |
| `docs` | Architecture, agent API, lifecycle, limitations and maintenance |
| `manifest.json` | Source revision, independent payload checksums, installation destinations |

Models and tools make this a large folder. Files are actual copies, not symlinks or links back to the original workspace. Keep `project/payloads`, `toolchain` and `dist` with the source when moving it.

Read [architecture and maintenance](docs/architecture.md), [agent motion controls](docs/agent-motion.md), [validation and known limits](docs/validation.md), and [model provenance](docs/models.md). The GitHub branch remains `codex/ardy-mobile-cleopatra` in `sl33pyC01E/neural-avatar-pipeline`; this folder is ready to initialize as its own source repository without carrying the parent repository history.
