# Cleopatra comparison kit

The competition is **Ardy + Pocket/Anna + LAM + Cleopatra VRM +
[(Qwen 3.5 2B + Whisper) versus Gemma 4 E2B]**. Image and audio scores stay
separate. A runtime that disrupts speech or animation cannot win on token speed
alone. There are no phone results yet: the agent prepares/installs; the user runs.

**The interactive interface is now in the app:** tab 7 selects Qwen + Whisper or
Gemma for persistent chat with image/audio input and metrics; tab 8 uses that
selection for an embedded browser agent. See [model chat and browser](../MODEL_CHAT_BROWSER.md).
The PowerShell runner below is optional for repeatable fixture comparisons;
ordinary chat and browser operation do not require a computer.

## Prepared contenders

| Contender | Runtime / precision | Phone execution status |
| --- | --- | --- |
| Qwen 3.5 2B + Whisper tiny/base/small English | llama.cpp Q4_K_M + FP16 vision projector; whisper.cpp Q5_1 | CPU binaries cross-compiled; optional Adreno OpenCL build for the VLM; user qualification pending |
| Gemma 4 E2B baseline | Same llama.cpp build; Q4_0 + Q8_0 multimodal projector (vision and audio) | CPU and optional OpenCL; user qualification pending |
| Gemma 4 E2B mobile | LiteRT-LM 0.17.1, full multimodal artifact on CPU/GPU | The separately named `-gpu` file is text-only; full audio/vision artifact is selected on both backends. User qualification pending |
| Custom Qwen mobile | LiteRT-LM 0.17.1, 768×768 / 576 visual tokens / 8K | Custom graph export in progress; see `qwen-litert/`. GPU requested backend remains subject to user qualification |
| faster-whisper | CTranslate2 + Python frontend | Not an installed Android runtime. Do not substitute desktop CPU/CUDA numbers into this phone contest. Android port remains unqualified. |
| WhisperX native | Silero + CTranslate2 base.en INT8 + wav2vec2 INT8 alignment, CPU | Experimental tab 7 option; native library and Java pipeline built. English, greedy decoding, no diarization. User qualification pending |

No CPU fallback is labelled NPU/GPU. OpenCL requires nonzero GPU layer offload
in the startup log, which is retained; this is not proof that every operator or
the projector was offloaded. LiteRT records the requested backend and runtime
errors, not a fabricated device utilization percentage. Qualcomm SM8750 NPU
artifacts exist for Gemma, but the corresponding vendor runtime and full modality
coverage are not yet integrated. The CPU/GPU candidates are ready for first user
runs, not certified as working on the phone.

`models.json` pins ten source model/projector artifacts by repository revision,
bytes and SHA-256. Nine previously provisioned artifacts have private app copies.
The community Qwen LiteRT file is a local tooling reference and is not provisioned;
the custom Qwen build has its own receipt. `whisperx-models.json` pins the extra
ASR/VAD/alignment files. Only the selected contender is loaded.
These payloads stay outside Git. App-owned servers bind authenticated localhost;
the separate browser WebView can access the internet. The optional comparison
runner uses ADB transport, not a public HTTP service. Stopping the benchmark service releases its dedicated
process, without stopping the avatar process.

## User runs

Open **Cleopatra · Avatar Check**. In tab 5 choose the same Core-40 embedding for
every comparison. In tab 6 use the same text, cue, tail and settings; enable
**Benchmark workload → Repeat Together** and press **Send**. It repeats until
Stop all, tab switch or hiding the app. The bounded trace records body batches,
speech/face events, resident engines, CPU frame p95 and audio underruns.

From PowerShell, run this file yourself:

```powershell
.\benchmark\Run-Comparison.ps1 -Engine qwen-whisper -Load full
.\benchmark\Run-Comparison.ps1 -Engine gemma-gguf -Load full
.\benchmark\Run-Comparison.ps1 -Engine gemma-litert-gpu -Load full
```

The wrapper waits for you to prepare the phone. Use `-Load idle` after warming
Together and pressing Stop all. Keep the app/VRM visible and sessions resident.
Use `-Backend opencl` with Qwen or Gemma GGUF to compare Adreno, or
`-Engine gemma-litert-cpu` for the LiteRT CPU candidate. `-Whisper tiny` or
`-Whisper small` changes the separate ASR size. `-AllCases` runs the full fixture
set; the default 3 cases per modality × 3 repeats is only a setup check.

The underlying `tools/run_phone_benchmark.py` does nothing to the phone without
`--run`. Advanced controls include `--image-tokens`, `--thinking` and
`--reasoning-budget`. Disable thinking first; compare a bounded thinking variant
separately. Context is bounded at 4096 tokens, output at 256 plus any reasoning
budget, and CPU threads at two. LiteRT's image budget is artifact-controlled and
is explicitly recorded as not adjustable through this adapter.

Run matched idle/full pairs in alternating order, cool the phone between pairs,
and keep charging, display brightness, Core profile, embedding, speech text and
thermal state comparable. Changing only one setting makes its effect measurable.
Startup is process-cold with uncontrolled filesystem/kernel caches; no cache
eviction, memory lock or persistent wake lock is used. Native workers use blocking
waits (`--poll 0`), and sessions remain loaded during the measured run.

## Measurements and limits

- Memory: sampled package-process plus native-server PSS/RSS during model load,
  warm residency and work. Raw dumps and process counts are kept. PSS is the main
  comparison; RSS can double-count shared pages. Sampling can miss brief peaks;
  shared GPU/driver allocations may be unattributed. Record battery/thermal state
  before/after. These are not energy-consumption measurements.
- Image: full response latency, first answer token, native prompt/decode timings
  and media encoder timing when emitted by llama.cpp; valid action rate, target
  hit accuracy, box IoU and correct abstention. Out-of-range/malformed coordinates
  fail. Screenshot pixels stay unchanged; only the requested coordinate space
  switches between original pixels and 0–1000 on each axis.
- Audio: transcription latency, real-time factor, word/character errors and
  silence hallucinations. Qwen and Whisper stay resident together even during
  image tests. Whisper handles ASR directly; no extra Qwen call is charged for
  pure transcription. Spoken-command interpretation is a separate next dataset,
  not inferred from a transcription score.
- Load: source traces are matched to request intervals. Report overlap and
  `loadVerified`; reject a purported full-load comparison when the baseline was
  stopped or mostly inactive. Keep frame pacing and underruns beside the scores.
- Rank latency using `deviceRequestMs` and its p50/p95/RTF summaries, with timing
  coverage checked. The small, tracked native patches measure after request bytes
  arrive, including media preprocessing and generation; LiteRT measures with media
  bytes in memory through conversation close. Native timing includes JSON/base64
  parsing and stream backpressure; LiteRT includes conversation teardown. Keep
  these small scope differences visible. HTTP/ADB `wallMs` is diagnostic only:
  LiteRT's file/intent/poll transport is slower than the native HTTP transport.
  Native token timings alone can omit media preprocessing. First-token timings
  are labelled by clock; Whisper provides a final transcript, not a token stream.

Reports/logs go to `payloads/benchmark/results/`. Requests use fresh conversations
and disable prompt-cache reuse. Failures, timeouts and invalid answers stay visible.
The 15 controlled UI images cover tab switching, an unlabelled menu/share icon,
send-tab menu selection and an absent target across three aspect ratios. The 13
audio fixtures use human LibriSpeech reading, deterministic 10 dB noise and silence.
They are calibration fixtures, not a representative held-out production benchmark.
Add real, consented screenshots and conversational commands before choosing a winner.
No predicted tap or send is executed.

## Reproduce preparation (no inference)

`tools/prepare_ardy_contract.py` regenerates the small sampler contract assets.
`tools/prepare_benchmark_fixtures.py` regenerates fixtures. Clone the pinned runtime
sources under `payloads/llama.cpp` and `payloads/whisper.cpp`, then use
`tools/prepare_benchmark.py --download --build --ndk PATH` and `--install` with
the selected ADB transport. Build applies only the checked-in device-timing
patches and pins their hashes in the receipts. `--opencl` builds the additional VLM runtime using
Khronos OpenCL headers and the phone's read-only vendor link library; its receipt
pins their identities. `--install-runtimes-only` installs binaries without
recopying models. No preparation command starts an app/server or runs inference.

## Primary references

- [Qwen 3.5 2B](https://huggingface.co/Qwen/Qwen3.5-2B): vision model, thinking toggle; use its actual template.
- [Gemma 4 model card](https://ai.google.dev/gemma/docs/core/model_card_4): E2B image/audio capabilities and image-budget tiers.
- [LiteRT Android API](https://ai.google.dev/edge/litert-lm/android) and [mobile artifacts](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm).
- [llama.cpp multimodal runtime](https://github.com/ggml-org/llama.cpp/blob/master/docs/multimodal.md), [server settings](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) and [Adreno OpenCL](https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/OPENCL.md).
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp), [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [WhisperX](https://github.com/m-bain/whisperX).
- [LibriSpeech](https://www.openslr.org/12/) and the [pinned small fixture dataset](https://huggingface.co/datasets/hf-internal-testing/librispeech_asr_dummy).
