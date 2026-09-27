# Cleopatra v22: Gemma QAT and persistent prefixes

Tab 7 **Models** selects Gemma 4 E2B IT or E4B IT and one runtime:

| Runtime | Language model | Vision/audio | Disk KV |
|---|---|---|---|
| LiteRT GPU / CPU | Existing `.litertlm` bundle | Existing full bundle | No; RAM only |
| llama.cpp CPU | Official Google QAT Q4_0 GGUF | Official combined projector, CPU | Build / restore / clear |
| llama.cpp OpenCL | Adreno GPU offload requested | GPU offload requested; unsupported operations may use CPU | Build / restore / clear |
| llama.cpp Hexagon | Experimental NPU offload requested | CPU encoder | Build / restore / clear |

The default remains LiteRT GPU. The new choices are integrated but have **not
been executed on the phone by the agent**. A non-CPU load must report nonzero
offloaded layers before being shown as ready; a missing driver or backend failure
is displayed instead of silently labelling CPU execution as accelerated. Runtime
logs are retained in app-private `cache/cleo-llama.log`.

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
file identity, backend/context/image/reasoning settings, and exact rendered
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
  lifecycle: 38 assertions against an authenticated fake HTTP peer, including
  process-restart restore without prefill, corruption, edits, model separation,
  rebuild and scoped deletion. This does not execute native inference.
- Actual downloaded chat templates: 20 host rendering checks cover common-prefix
  equivalence for text/image/audio and tool-response continuation.
- Prompt tree: 443 assertions / 84 nodes. Browser targeting: 52 checks. The
  desktop UI harness uses CPU SwiftShader and a fake native bridge; backend
  selection, cache controls/metrics, prompt editing, layouts and existing avatar
  flows pass.

Reports are under `validation/*v22*`. GPU/NPU operator support, native streaming,
tool/grammar quality, disk restore equivalence, speed, thermals and full-stack RAM
still require the user's phone test. No phone UI test, generation, benchmark or
audio playback was run by the agent.
