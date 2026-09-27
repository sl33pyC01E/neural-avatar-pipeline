# Cleopatra v24: Gemma QAT and persistent prefixes

Tab 7 **Models** selects Gemma 4 E2B IT or E4B IT and one runtime:

| Runtime | Language model | Vision/audio | Disk KV |
|---|---|---|---|
| LiteRT GPU / CPU | Existing `.litertlm` bundle | Existing full bundle | No; RAM only |
| llama.cpp CPU | Official Google QAT Q4_0 GGUF | CPU default; OpenCL selectable | Build / restore / clear |
| llama.cpp OpenCL | Adreno GPU offload requested | OpenCL default; CPU selectable | Build / restore / clear |
| llama.cpp Hexagon | Experimental NPU offload requested | CPU default; OpenCL selectable | Build / restore / clear |

v24 adds a separate **vision + audio encoder** selector for llama.cpp. It uses
`--mmproj-device` independently of the language `--device`, enabling GPU encoder
+ NPU decoder. Both encoders share this setting in the pinned runtime. See
[split placement, inherited settings and test limits](SPLIT_ENCODER.md).

The default remains LiteRT GPU. Readiness follows the native `/health` endpoint.
Backend evidence displays the requested device and the actual offloaded-layer
count when available; missing diagnostic output is shown as unconfirmed, not a
load failure. v22 incorrectly killed healthy OpenCL and Hexagon workers because
b11200 hides native INFO messages at the default verbosity. v23 requests verbosity
4 and removes that log-phrase readiness gate. The user's saved GPU/NPU attempts
reached server-ready; native generation still needs the user's test.

Each model/backend retains its latest private log, e.g.
`cache/cleo-e2b-llama-opencl.log`, capped at 1 MiB. A matching `-startup.json`
receipt retains settings, observed offload counts and buffer-size diagnostics.
Logs are diagnostic and may include native prompt output; they are not the disk
prefix cache. The agent has not started any phone inference.

## Memory presets

Models offers **Memory focused** (default for llama.cpp) or **Throughput**.
Both use `--lazy-mode on`, `--ctx-checkpoints 2`, `--cache-ram 0` and explicit
backend/context settings with `--fit off`. The memory preset lowers batch/ubatch
from 256/128 to 128/64. On CPU only, it also sets `--no-repack`, keeping immutable
weights file-backed instead of allocating an anonymous repacked copy. GPU/NPU
retain their backend-specific layouts. Changing the preset requires Load/apply.

These settings may cost throughput and have not yet been measured on the phone.
File-backed pages still consume RAM while resident; this does not guarantee
LiteRT's footprint. Both GGUFs include large Q6_K embeddings and mostly BF16
vision/audio projectors despite the Q4_0 label. See the saved-log diagnosis and
passive pre-change memory snapshot in [ACCELERATOR_MEMORY.md](ACCELERATOR_MEMORY.md).

Main, Browser and tab 9 use the selected backend through the same validated avatar
and browser APIs. Text and reasoning stream separately; thoughts stay collapsed.
Tool fragments are assembled and validated before executing controls. Images and
WAV audio go directly to Gemma. Qwen and Whisper have not been reintroduced.

## Model and runtime identity

`benchmark/gemma-qat.json` pins official Google repositories, revisions, sizes and
SHA-256 values. E2B is 3.35 GB plus a 0.987 GB projector; E4B is 5.15 GB plus a
0.992 GB projector. These are disk sizes, not RAM estimates. Both downloaded
projectors declare vision and audio encoders. Both language models declare
131,072-token maximum context; the app offers 4K through 128K allocations.

Image budgets remain 70, 140, 280, 560 and 1,120 tokens. The pinned Gemma projector
implements dynamic resizing with 16-pixel patches and 3×3 pooling; its metadata's
224-pixel nominal image size is not a fixed input-resolution limit. Input shape
and budget determine the actual resolution. `--image-max-tokens` forwards the
selected budget to llama.cpp. Reasoning defaults off; 128/256/512-token budgets
are forwarded with the chat-template thinking flag.

`tools/prepare_gemma_qat.py --runtime --models` prepares the official llama.cpp
**b11200 / 81bc6b83f827df746eb129235488d325c49cae52** Snapdragon release and QAT
files. `--install --adb ... --transport ...` copies and verifies the model files
in the existing app's private `files/benchmark`, then removes its own temporary
transfer copies. It never launches the app or starts inference. The APK packages
the worker, dependency libraries, DSP kernels and an NDK-built parent-death
launcher. Model weights are provisioned separately, as with the existing Gemma
LiteRT bundles; the APK alone does not contain both multi-GB QAT sets.

The worker listens only on localhost with a random per-process API key. One
Gemma runtime is resident at a time. Explicit unload stops its child; parent
process death also kills the worker. Idle polling is disabled. Memory/CPU metrics
include the native worker PID as well as the model service and avatar process;
unavailable readings remain marked partial.

## Prompt tree and disk cache

Open **Prompt tree & disk prefix cache** in Models. Its editor shows 84 prompts,
templates and tool descriptions, with their triggers and editable saved overrides.
See [prompt tree and browser format handling](PROMPT_TREE.md).

The llama.cpp **Save / restore prompt KV to disk** setting defaults on. Models
and Browser prefixes can also be prepared explicitly with **Build / restore** or
**Rebuild**. Main prepares its exact situation and dynamic tool catalog on Launch;
tab 9 prepares its own prefix on first send. E2B and E4B need separate preparations.

The implementation renders the real chat template twice with different probe
messages, takes their common system/tool prefix, and prefills that prefix with
`n_predict: 0`. Probe text, user messages, screenshots, audio and generated replies
are excluded. It calls `/slots/0?action=save` to persist real native KV state.
A new session restores a compatible file before generation instead of prefilling
that prefix again. Each inference still supplies its full conversation and uses
llama.cpp's progressive prefix matching; this preserves correctness when changing
between modules sharing the one native slot.

Cache identity includes the pinned runtime, official artifact hashes, installed
file identity, backend/encoder/context/image/reasoning/memory settings, effective native
launch options, and exact rendered
system/tool prefix. Saved state is checksummed; data and metadata are atomically
renamed. A corrupt or incompatible file is rejected and rebuilt. Retention is
bounded to 12 completed prefixes / 2 GiB, with old files pruned. Cache failure
falls back to ordinary prompt evaluation and reports the reason. **Clear disk
prefixes** only removes this cache; model weights and the live chat remain.

Models shows saved/restored tokens, disk bytes, prefill/save/restore time and
backend evidence. Bottom metrics show first answer token, total latency, CPU
time, current/peak PSS, actual reused tokens, prompt evaluation time and decode
tokens/sec when supplied by the runtime. Restoring weights, allocating contexts
and preparing a new user input still take time; disk KV does not eliminate model
loading or guarantee a speedup on every backend.

## Verification boundary

- Android build and lint pass; APK payload hashes, extracted worker/DSP hashes,
  retained Pocket/LAM/Ardy assets and signature were checked.
- Production streaming/tool protocol: 18 host checks. Production disk-cache
  lifecycle: 57 assertions against an authenticated fake HTTP peer, including
  process-restart restore without prefill, corruption, edits, model separation,
  rebuild and scoped deletion. This does not execute native inference.
- Actual downloaded chat templates: 20 host rendering checks cover common-prefix
  equivalence for text/image/audio and tool-response continuation.
- Prompt tree: 443 assertions / 84 nodes. Browser targeting: 52 checks. The
  desktop UI harness uses CPU SwiftShader and a fake native bridge; backend
  selection, cache controls/metrics, prompt editing, layouts and existing avatar
  flows pass.

Baseline reports are under `validation/*v22*`; v23/v24 rerun the production protocol,
cache, launch/log-capture and desktop UI checks under their respective version names.
v24 covers independent encoder placement, saved settings, later-tab inheritance,
encoder log evidence and cache invalidation. GPU/NPU operator support, native streaming,
tool/grammar quality, disk restore equivalence, speed, thermals and full-stack RAM
still require the user's phone test. No phone UI test, generation, benchmark or
audio playback was run by the agent.
