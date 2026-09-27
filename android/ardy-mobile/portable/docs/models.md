# Models and provenance

SHA-256 and sizes of every packaged source/model/APK file are in the top-level manifest. The installer checks local and transferred model hashes. Toolchain files are copied local dependencies; the source/model manifest does not attest to the SDK/JDK distribution itself.

| Component | Provenance / runtime |
| --- | --- |
| Cleopatra VRM | Zome_Cleopatra_v1.vrm; original SHA-256 `9120c484fe2781e8e3dbbb56f5b0b3a00e94db0d34bce7512d4d22275593534f`; packed-asset hash in `payloads/avatarAssets/provenance.json` |
| Ardy Core8 / Core40 | Recovered working Ardy Mobile ONNX exports; normalization and skeleton assets retained |
| LLM2Vec | Recovered Q4_K_M GGUF (4,625,232,928 bytes), fingerprint `60ec43402975a1fa520c7c05193c02e63d793f0311a0f7e59cd17690ebca5fd4`; architecture/license metadata retained |
| Pocket TTS | Sherpa-ONNX 1.13.8, pocket-tts-2026-01-26 export, FP32 and INT8 variants, repaired encoder; Anna reference in manifest |
| LAM | 64-frame 24 kHz ONNX wrapper around the existing backbone; export/parity manifest retains original checkpoint hash and blendshape names |
| Gemma E2B/E4B | Official QAT Q4_0 language models and modality projectors; pinned repos/revisions in `project/benchmark/gemma-qat.json` |
| Gemma runtime | Snapdragon llama.cpp b11200, commit `81bc6b83f827df746eb129235488d325c49cae52`; runtime hashes in `payloads/gemma-qat/runtime-manifest.json` |

Gemma and Ardy/LLM2Vec external weights are installed into app-private files. Pocket/LAM/VRM/runtime assets are packaged in the main APK. No parent-project paths are needed for normal build/install.

Licenses bundled with vendor code, SDK/JDK, Pocket and native sources remain applicable. LLM2Vec metadata identifies a Llama 3-derived model. The recovered Ardy exports, custom avatar and LAM checkpoint do not acquire new redistribution rights by being collected here. Preserve their upstream/project terms when distributing beyond this personal handoff. The bundled source is not represented as a newly licensed all-permissive codebase.

Retired MiniCPM/Qwen/Whisper/LiteRT models, model downloads cache, user chats and device KV caches are intentionally absent.
