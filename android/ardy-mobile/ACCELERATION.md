# Cleopatra acceleration assessment — 2026-09-25

Target: the inventoried Samsung S25 Ultra (SM-S938U). This assessment uses local
APK/model inspection and upstream documentation. **No phone benchmark or active
phone test was run.** GPU/NPU availability is not a performance result.

| Engine | GPU path | NPU path | Current evidence / next gate |
| --- | --- | --- | --- |
| Ardy Core-8 / Core-40 | ONNX Runtime QNN GPU | QNN HTP | Original APK contains a QNN-enabled ORT build, QnnGpu, QnnHtp and V79 libraries. Both recovered models have dynamic dimensions; specialize shapes, inspect partition coverage and compare motion before using acceleration. CPU remains the recovered reference. |
| Compatible LLM2Vec 8B Q4_K_M | Rebuild the embedding JNI with llama.cpp OpenCL/Adreno or Vulkan | Separate Hexagon/QNN investigation; no validated path for this exact encoder | Recovered native binary has the CPU backend symbol and no Vulkan/OpenCL/Hexagon initialization symbols. Preserve bidirectional attention, pooling, tokenizer, prompt handling and 4096-feature compatibility. A different embedding model is not interchangeable. Cached embeddings require no model inference. |
| PocketTTS / Anna | Community LiteRT Android GPU port; requires Anna preset conversion | Possible fixed-shape conversion experiment, unqualified | Current Sherpa ONNX backend runs on CPU. A local CPU check synthesized Anna successfully. Dynamic KV states and dynamic INT8 operators in these ONNX graphs are not a drop-in QNN graph. The LiteRT sample lists six voices without Anna. Preserve Anna when evaluating it. |
| LAM audio-to-expression | Evaluate QNN GPU on the exported ONNX model | Fixed audio-window QNN HTP candidate | Exported 64-frame model, including 24→16 kHz sinc resampling, passed CPU PyTorch/ONNX parity; the deterministic facial postprocessing also matches desktop. Still no GPU/NPU execution or combined Android result. |
| Qwen 3.5 2B VLM | llama.cpp Vulkan / Adreno OpenCL, subject to this architecture's operator and vision-encoder coverage | Qualcomm AI Hub lists Qwen3.5-2B and Galaxy S25 support; exact runtime and vision coverage still need verification | Preferred VLM. Keep the vision projector, thinking toggle, reasoning budget and image-token ceiling. The public Hub page has inconsistent generic architecture text and chipset filtering; it is not proof of complete on-phone VLM offload. |
| Separate transcription | whisper.cpp Vulkan is an Android-native candidate | Qualcomm Whisper exports/QNN are a separate candidate | Choose a small model and measure latency/power in the combined app when the user authorizes qualification. Faster-whisper/WhisperX desktop Python/CUDA stacks should not be assumed to provide Android Adreno acceleration. |
| VRM display | Already uses WebGL GPU rendering | Not applicable | User approved the renderer and controls. Shared GPU contention with inference must be considered. |

## Concrete graph findings

`validation/acceleration-audit-2026-09-25.json` records weights, shapes, operator
counts and native-library fingerprints. `tools/audit_acceleration.py` reproduces
it without inference or a connected device.

- Core-8 uses up to 16 tokens / 64 frames; Core-40 uses 64 tokens / 256 frames.
  Both denoisers and decoders use symbolic frame/token dimensions even though
  the recovered app supplies fixed maxima. Denoisers contain GatherElements,
  ScatterElements, Range and Erf; decoders also contain Mod and Trilu. Constant
  folding or exact graph rewrites may remove some, but full offload is unproven.
- Pocket's LM, flow and decoder contain DynamicQuantizeLinear / MatMulInteger;
  variable-length state is another conversion hurdle. INT8 in a filename does
  not establish NPU compatibility.
- The installed ORT binary contains hundreds of QNN implementation/error strings.
  The stock 1.24.3 Android AAR contains only generic QNN provider-name/context
  strings. Do not infer compiled QNN support just from `addQnn()` or a string
  match. Keep the original runtime/library set together if restoring that path.

## Runtime policy

Keep CPU as an explicit baseline. Acceleration qualification must record which
graph nodes execute on which provider and any fallback. Compile/partition success,
first-result latency, rolling latency, peak resident memory and idle behavior are
different checks. Compare output numerics and visible motion/audio before switching
defaults. Do not make a UI switch that silently falls back and reports “NPU”.

The intended scheduler retains useful sessions under a memory budget and blocks
when idle. Run embeddings only for new steering text, keep a bounded motion buffer,
and generate speech/facial frames only when needed. GPU inference competes with
VRM rendering; a nominally faster kernel can still worsen frame pacing. NPU could
help isolate work, but that is an engineering hypothesis until measured.

## Primary sources

- [ONNX Runtime QNN EP](https://onnxruntime.ai/docs/execution-providers/QNN-ExecutionProvider.html):
  backend configuration, static-shape requirement, supported operators, profiling
  and fallback controls. Current docs include an FP16 HTP option as well as older
  quantized-only guidance; use the actual SDK/runtime version and graph coverage.
- [llama.cpp OpenCL backend](https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/OPENCL.md):
  Android builds and Adreno support.
- [Qwen's 2B model card](https://huggingface.co/Qwen/Qwen3.5-2B) and
  [processor configuration](https://huggingface.co/Qwen/Qwen3.5-2B/blob/main/preprocessor_config.json):
  vision encoder, thinking template control, patch size 16 and merge size 2.
- [llama.cpp runtime controls](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md):
  reasoning on/off, `--reasoning-budget`, `--image-max-tokens`; these must be
  implemented by the selected runtime, not merely stored as UI preferences.
- [Qualcomm Qwen3.5-2B](https://aihub.qualcomm.com/models/qwen3_5_2b):
  supported device listing. No published non-phone metric is claimed for this phone.
- [Kyutai PocketTTS](https://github.com/kyutai-labs/pocket-tts) and
  [the LiteRT port](https://github.com/john-rocky/LiteRT-Models): a GPU route exists,
  with author-reported results on other devices; not independently qualified here.
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp): Android example and Vulkan
  backend. Native integration and model choice remain to be done.

Local LAM reference: `face_animation/LAM-Audio2Expression/models/network.py`,
`models/encoder/wav2vec.py`, `engines/infer.py`, and the shared desktop facial mapping.
