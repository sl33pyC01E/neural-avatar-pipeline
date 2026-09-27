# Duplex model research — 2026-09-27

Qwen Omni and MiniCPM are excluded at the user's request. MiniCPM's prepared experimental APK and model payload were removed before phone installation; Cleopatra stays with Gemma and Pocket TTS. No Venus, DuplexOmni or other candidate weights were downloaded or run.

Qwen2.5-Omni's Thinker already emits text; its Talker is a speech-token generator, not a second independent language reasoner. Removing Talker/vocoder is supported, but does not introduce native input/output duplex. The inspected Transformers generation runs Thinker then Talker. Mainline llama.cpp supports its vision/audio input; the MiniCPM duplex engine in llama.cpp-omni is model-specific. Published 3B Q4_K_M language weights plus Q8 modality projector total 3,642,962,976 bytes before working memory. Sources: [model](https://huggingface.co/Qwen/Qwen2.5-Omni-3B), [files](https://huggingface.co/ggml-org/Qwen2.5-Omni-3B-GGUF/tree/main), [generation code](https://github.com/huggingface/transformers/blob/v4.52.3/src/transformers/models/qwen2_5_omni/modeling_qwen2_5_omni.py), [llama.cpp](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md).

| Candidate | Documented capability | Fit for Cleopatra |
| --- | --- | --- |
| MiniCPM-o 4.5 | Native streaming audio/video full duplex, 9B total | Existing [C++ duplex runtime](https://github.com/tc-mb/llama.cpp-omni); discarded because its complete standard Q2_K/F16 auxiliary payload was about 6.7 GiB before working memory |
| [Realtime-Venus-Omni](https://github.com/inclusionAI/Realtime-Venus) | 9B full-duplex audio/video, interruptions and asynchronous work | Published demo uses GPU/server inference; no verified drop-in C++/phone runtime identified |
| [DuplexOmni](https://huggingface.co/MuyeHuang/DuplexOmni) | Audio/video full duplex, Qwen3-Omni-derived, about 35B total | Too large for the target; custom inference stack |
| [Mini-Omni2](https://arxiv.org/html/2410.11190v2) | 0.5B language backbone + encoders, vision/audio; keyword-driven interruption during speech | Small research candidate, but “Stop Omni” interruption is narrower than continuous semantic duplex; no verified llama.cpp-omni port identified |
| [Moshi](https://github.com/kyutai-labs/moshi), [PersonaPlex](https://github.com/NVIDIA/personaplex) | About 7B, native full-duplex speech | No native vision; not the small unified stack requested |
| [F-Actor](https://huggingface.co/maikezu/f-actor) | 1B, controllable full-duplex speech | Compact research lead if separate vision is acceptable; runtime/Android port needed |
| [LFM2.5-Audio-1.5B](https://huggingface.co/LiquidAI/LFM2.5-Audio-1.5B) | Small audio/text model with interleaved streamed output and GGUF runners | No vision; reviewed documentation does not establish native continuing-input duplex |

No verified ready-made alternative was found combining native vision, semantic full duplex, C++ mobile runtime and less than 3 GB working memory. Quantized weight size is not peak resident memory. A runtime built around one duplex model does not confer duplex training or scheduling on every supported language backbone.
