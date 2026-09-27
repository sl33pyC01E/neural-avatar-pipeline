# Persistent prompt state: findings and implementation boundary

Inspected LiteRT-LM **v0.17.1**, the APK's pinned runtime, and llama.cpp checkout
**81bc6b8** (2026-09-26). The subsequent v22 implementation packages the pinned Snapdragon runtime and
installs the official QAT GGUFs. It saves/restores computed prefixes via llama.cpp.
See [implementation and verification](MODELS_QAT_CACHE.md). No phone inference
was performed; the LiteRT limitations below still apply.

## LiteRT-LM

The Kotlin Conversation/JNI API has no disk state export/import operation. Its
`prefillPrefaceOnInit` flag moves prompt preparation into conversation creation;
it does not serialize the result. Source:
[Config.kt](https://github.com/google-ai-edge/LiteRT-LM/blob/v0.17.1/kotlin/java/com/google/ai/edge/litertlm/Config.kt),
[Conversation.kt](https://github.com/google-ai-edge/LiteRT-LM/blob/v0.17.1/kotlin/java/com/google/ai/edge/litertlm/Conversation.kt),
[JNI declarations](https://github.com/google-ai-edge/LiteRT-LM/blob/v0.17.1/kotlin/java/com/google/ai/edge/litertlm/LiteRtLmJni.kt).

The native StateInterface declares Serialize and Load. However, the concrete
[LitertState implementation](https://github.com/google-ai-edge/LiteRT-LM/blob/v0.17.1/runtime/executor/litert/state.h)
returns UnimplementedError for both. This is a deeper blocker than an absent
Java wrapper. State can use in-place buffers, ping-pong banks or GPU-optimized
in-place allocation; serialization must handle the actual active state layout.

The executor's
[CloneContext / RestoreContext](https://github.com/google-ai-edge/LiteRT-LM/blob/v0.17.1/runtime/executor/llm_litert_compiled_model_executor.cc)
work with in-memory objects containing state buffers, processed tokens, runtime
configuration and current execution state. They are useful starting points, not
a portable disk format.
[Session checkpoints](https://github.com/google-ai-edge/LiteRT-LM/blob/v0.17.1/runtime/core/session_advanced.cc)
record positions/session/task state in a map within the live process.
[CachedSession](https://github.com/google-ai-edge/LiteRT-LM/blob/v0.17.1/runtime/core/cached_session.h)
matches incoming prefixes and reuses a live underlying session. Neither provides
cold-process KV restoration.

A custom LiteRT implementation would need to:

1. Synchronize inference, serialize the correct tensor banks with names, shapes,
   types and allocation metadata, and restore them into compatible buffers.
2. Capture/restore processed tokens, step position, conversation/template state
   and other state needed to resume before the first user turn.
3. Expose native save/load through JNI and recreate a conversation without
   redundantly prefilling the same prefix before restoration.
4. Key each immutable prefix by model artifact hash, tokenizer/template, runtime
   version, backend/precision, context and vision settings, exact rendered system
   text, tool schema and dynamic catalog. E2B/E4B require distinct snapshots.
5. Write atomically, verify checksums and dimensions, bound disk usage, reject
   stale/incompatible data and fall back to fresh prefill. A prompt-text file is
   not evidence of a valid computed prefix.

The user would then test fresh-process restore against ordinary prefill for text,
tool calls, image/audio input and cancellation, plus full-stack RAM, latency and
thermal behavior. Neither correctness nor a speedup has been measured here.

## llama.cpp as an alternative

Unlike the pinned LiteRT binding, llama.cpp exposes
[whole-context and per-sequence state save/load functions](https://github.com/ggml-org/llama.cpp/blob/81bc6b8/include/llama.h).
That makes it a more direct candidate for disk prompt-cache integration. Cache
identity/invalidation and restoration of application conversation state are still
our responsibility; backend/model-specific restoration needs a device test.

The [Snapdragon backend guide](https://github.com/ggml-org/llama.cpp/blob/81bc6b8/docs/backend/snapdragon/README.md)
supports CPU, Adreno OpenCL and experimental Hexagon NPU. The existing local
Android OpenCL build enables the Adreno kernels; it does not enable Hexagon or
Vulkan. The v22 APK instead packages the official Snapdragon build with both OpenCL and
Hexagon; all three choices are exposed in Models.
NPU support for all operators and multimodal stages cannot be inferred from a
generic backend or text-only example; CPU fallback and transfer costs matter.

Google publishes QAT Q4_0 GGUF packages:

| Model | Language GGUF | Projector GGUF | Approximate combined disk size |
|---|---:|---:|---:|
| [E2B](https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf/tree/main) | 3.35 GB | 0.987 GB | 4.34 GB |
| [E4B](https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf/tree/main) | 5.15 GB | 0.992 GB | 6.15 GB |

These are file sizes, not resident RAM estimates. llama.cpp documents both models
under [image and audio input](https://github.com/ggml-org/llama.cpp/blob/81bc6b8/docs/multimodal.md).
The downloaded E2B and E4B projectors each declare both vision and audio
encoders. Their runtime execution still needs the user's phone test. Use the current corrected-vocabulary Google artifacts, not an old
cached revision. No new conversion is necessary for these published GGUFs.

The implemented path keeps LiteRT available and selects one resident Gemma
runtime at a time. Disk files hold only the rendered system/tool prefix, keyed
by model identity, runtime, settings and exact template output. The native server
uses per-slot save/restore and progressive prefix reuse. CPU, GPU/NPU correctness,
performance, memory and cold-process restore equivalence remain device-test items.
