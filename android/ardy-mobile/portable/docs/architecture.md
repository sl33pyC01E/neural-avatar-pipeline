# Architecture and maintenance

## Runtime

Cleopatra is `ai.cleo.ardyavatarvalidation`. `MainActivity` owns Android permissions, camera/media acquisition and the WebView bridge. `ModelChatService` runs in the separate `:models` process and supervises a device-local llama.cpp worker. `ResidentService` owns Ardy, LLM2Vec, Pocket synthesis/playback and LAM. `native/llama_runner.c` makes the native worker exit when its supervisor dies.

The WebView uses locally packaged Three.js/three-vrm, the existing Zome/Ardy retargeter and Cleopatra VRM. `web/main.mjs` coordinates Main and the debug modules. `avatar-agent.mjs` performs release/load/prompt-prepare/warm sequencing, cancellation and recovery. `MainAvatarToolApi`, `AgentControls` and `ArdyPlan` validate the model's controls; prompt edits never remove native validation.

Text streams from Gemma. Spoken output is incrementally stripped of a leading `Cleopatra:` label. Speech phrases feed Pocket, LAM consumes the generated PCM, and audio playback timestamps drive the face/body schedule. Ardy embedding caching stores text-conditioning vectors; the new motion library stores actual retargeted poses. These are distinct caches.

## Lifetime and memory

The user starts and unloads the resident stack. Foreground service notifications and battery-optimization settings improve retention; Android can still reclaim it. There is no guarantee of hard-locking all model/GPU/NPU memory. Frame rendering and motion requests stop when hidden. The app resumes from acknowledged service state, not stale UI readiness.

Face mode leaves Ardy sessions on disk because it uses Pocket, LAM and gentle idle motion. Torso loads Ardy with root locked. Body supports live Ardy or saved-pose replay; full cached replay can release Ardy, while lower-body layering retains it. The LLM2Vec model is needed when creating embeddings, not to use existing embeddings. Avoid warming unrelated debug engines at once.

Metrics distinguish process PSS from system available memory. GPU/NPU driver allocations are not fully represented by PSS. A service exit message names the last recorded state; that state is not proof of where allocation failed.

## Editable prompts and caches

Settings → Prompt tree exposes prompt bodies and triggers. `PromptTree.java` supplies defaults and revision fingerprints. Gemma prompt-cache keys include model/runtime settings, frame, tool catalog, saved tracks and prompt revision. Main's Face schema excludes irrelevant locomotion fields. Switching frames re-prepares the appropriate prefix. See `project/PROMPT_TREE.md` and `project/MODELS_QAT_CACHE.md` for implementation detail.

Native KV/prefix caches are app-private device-specific acceleration artifacts. Do not ship another device's chat/KV data. This handoff contains source defaults and model weights, not user conversations, saved prompt overrides or newly recorded personal motion clips.

## Build and upgrade

`build.ps1` selects only bundled tools and an isolated Gradle home, using offline dependency resolution. `portablePayloadRoot` makes Gradle consume durable model/assets directories and stage current `web/` files during each build. Do not edit generated `app/build/generated/avatarAssets`.

The shipped APKs were signed by the existing development setup. A new machine creates its own debug key, so its rebuilt APK may not update an already installed app with a different signer. Preserve your own signing key separately for continuing upgrades. The installer never uninstalls or clears data to work around a signature mismatch. Configure your own release signing before distribution.

Ordinary Java/UI rebuilds are offline. Recompiling native runtimes or regenerating model exports requires the pinned upstream sources and extra development tools (NDK/CMake or Python model-export dependencies). Gemma's runtime provenance is in `project/payloads/gemma-qat/runtime-manifest.json`; `project/tools/prepare_gemma_qat.py` stages those binaries and builds the small process launcher. The original recovered `libardy_llm2vec.so` is preserved with a checksum; its exact native source/build recipe has not been recovered. This is the remaining native-source reproducibility gap, not an APK build dependency.

For a new repository, commit source, docs, wrapper and scripts. Keep weights, SDK/JDK, Gradle caches and APKs in a versioned artifact store with the manifest. Preserve licenses and model provenance. Do not commit `.android/adbkey`, signing keys, raw phone logs, chat history or tokens.
