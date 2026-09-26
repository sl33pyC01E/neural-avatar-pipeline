> Historical research: retired from the active app in 0.6.0. See [Gemma avatar](../../GEMMA_AVATAR.md). Do not restart the cancelled Spark build.

# Cleopatra Qwen LiteRT package

## Active package: premade 512/4K

The user cancelled the custom graph export on September 26. Its Spark workspace,
container and unused image were deleted; the finishing and transfer jobs are
stopped. Do not resume that export without a new user request.

The app now uses `Qwen3.5-2B-Cleo-512-4k-int8.litertlm`: **512×512 input images,
256 visual tokens, 4,096 context tokens**. Image size and context capacity come
from the premade graph. Context includes conversation, image tokens, reasoning
and the answer. CPU and GPU are selectable; actual phone coverage is unqualified.

Source: `litert-community/Qwen3.5-2B`, revision
`4327b7425533c26da2aec1d7b915e9742eead2cb`, `Qwen3.5-2B-VL_int8.litertlm`.
Only the chat template and thought-channel metadata are changed. Every other
section, including weights and compiled graphs, is hash-verified unchanged.
The delivered hash is identical to the file that passed the native reference
conversation and image checks described below. `prebuilt-receipt.json` records
the source, preserved sections and generation report. It explicitly sets
`graphExported: false` and `phoneQualified: false`.

`tools/prepare_qwen_prebuilt.py` promotes that checked local bundle under its
delivery name and verifies source, template and bundle hashes. To reproduce it
from the source download, use `repack_qwen_litert.py` with `chat.jinja`, then the
native quality gate and the metadata/quality reports referenced by the promotion
script. `prepare_benchmark.py --install` provisions the premade artifact; it no
longer requires a custom graph build. Provisioning never starts phone code.

## Cancelled custom export recipe

Requested profile: **768×768, 576 visual tokens, 8,192 context tokens**.
`profile.json` pins the original Qwen checkpoint and the converter/fork revisions.
This is a graph export, not a metadata change to the community 512/4096 bundle.

The decoder uses INT8 linear/embedding weights and FP32 activations, retaining
float recurrent/convolution math. Vision uses an FP16 encoder and INT8 adapter.
Six prefill signatures reduce initialization and resident memory compared with
the full eleven-signature ladder. Phone performance and GPU coverage are unqualified.

The source model uses patch size 16 and 2×2 spatial merging: `(768 / 32)^2 = 576`.
The image size and cache capacity are compiled graph properties. Reasoning is a
runtime toggle, with the app's selectable token budget. The package declares a
`thought` channel delimited by `<think>\n` and `</think>` so LiteRT's budget
constraint can close reasoning and continue the answer.

`chat.jinja` retains completed reasoning exactly in the conversation prefix.
It deliberately requires typed content: LiteRT 0.17.1's FastVLM processor drops
channel fields when flattening a one-part text message into a string. Its own
assistant output is typed, so retaining that representation preserves reasoning.
The template check models the runtime capability probe and this adapter, then
checks three consecutive turns with thinking on/off and text/image input.

The actual LiteRT 0.17.1 CPU check of the reference 512/4K bundle caught looping
with the app's old shared 0.3-temperature sampler. Qwen now uses top-k 20 and
presence penalty 1.5, temperature/top-p 1.0/0.95 when thinking and 0.7/0.8 when
not thinking. The same reference passes eight questions, retained conversations
with both modes, and simple red/blue image checks. Reports under `validation/`
retain the before/after output. This is template/sampler evidence only; it does
not qualify the custom graph or browser grounding.

FastVLM resizes the complete image to the compiled square; it does not center
crop. This preserves normalized 0–1000 coordinate mapping, while changing the
aspect ratio seen by the encoder. The decoder receives sequential positions
rather than the original model's multidimensional image RoPE. Browser grounding
must therefore be judged on real phone results, not inferred from encoder parity.

## Spark build

Spark is ARM64. The converter has x86 Linux wheels, so compilation uses an owned
amd64 Docker container under existing emulation. Numerical calibration and
verification run in a separate native ARM Python environment; running those
matrix operations under emulation was too slow. These are build checks, not
substitutes for Android latency/accuracy measurements. No phone code is invoked.

Workspace: `/home/sleepy/cleopatra-qwen-litert`. Container: `cleopatra-qwen-build`.
The container mounts that workspace at `/work`, uses the runc runtime, and has
explicit CPU/RAM limits. CUDA is disabled for the compiler. Other Spark models
and environments are preserved.

Copy `bootstrap.sh`, `build-requirements.lock`, `profile.json`, `chat.jinja`, and
these tools into the workspace:

- `build_qwen_litert.py`, `download_qwen_source.py`, `split_qwen_vision.py`
- `check_qwen_vision.py`, `check_qwen_template.py`, `check_qwen_litert_quality.py`
- `repack_qwen_litert.py`, `inspect_litert.py`

Run `bootstrap.sh` inside the container. It installs the pinned source fork and
the exact x86 dependency lock. The CPU PyTorch pair is 2.12.1 / torchvision 0.27.1.
An isolated native venv uses the same pair, transformers 5.14.1 and ai-edge-litert
2.2.0 for the Android-compatible numerical gate. Download the source revision
with `download_qwen_source.py` using the native environment.

Generate the split recipe with `split_qwen_vision.py CONVERTER TARGET`. Run the
generated recipe natively with `VISION_STAGE=prepare`, `IMG=768`, `MODEL` set to
the pinned source directory, and `CLEO_CONVERTER` set to the converter checkout.
Its output directory must be `out/<profile-name>/vision`, writable by the host
user. The generated script is derived from the pinned upstream recipe; no model
math is removed. It saves calibration scales, source reference outputs and the
same sample inputs for compilation.

Inside the container, run:

```sh
/work/venv/bin/python /work/build_qwen_litert.py --work-dir /work --profile /work/profile.json --template /work/chat.jinja --stage vision
```

Then run `check_qwen_vision.py` natively on the vision directory. It checks the
unquantized and final quantized encoder/adapter against the source output, rejects
unsupported operation families, and fingerprints the checked graphs. Next use
`--stage decoder`, then `--stage package` inside the container. Packaging requires
the passing numerical report and unchanged graph hashes; it also verifies actual
image, adapter and attention-cache dimensions. Executor metadata binds the hybrid
cache/state tensors. The metadata repacker verifies every other section unchanged.

Outputs go under `out/Qwen3.5-2B-Cleo-768-8k-int8`. Copy the final `.litertlm` to
local `payloads/benchmark/` and its build receipt to this directory. Provisioning
refuses a metadata-only repack or the wrong image/context profile. Never relabel
the community bundle or the template-only check file as the custom export.

Before provisioning, use `check_qwen_litert_quality.py` in an isolated native ARM
environment with `litert-lm-api==0.17.1`, `tokenizers==0.22.2` and Pillow. Supply
the bundle, `--converter CONVERTER`, `--tokenizer SOURCE/tokenizer.json`,
`--report REPORT`, and `--build-receipt RECEIPT`.
This runs the converter's eight fixed questions (at least six correct, no
degeneration), retained conversations with thinking on/off, counted reasoning
tokens against the budget, and two simple image pipeline checks. The report
attaches to the matching artifact's build receipt.
Provisioning requires a passing report with the same bundle hash.

For a decoder already running on Spark, `finish_qwen_litert.py --work-dir WORK
--wait-pid HOST_DECODER_PID` waits for that process, packages the completed export,
runs the native gate and stops the owned compiler container on success. Its
`finish-status.json` and stage logs remain in the workspace. It does not install
or execute anything on the phone.

On Windows, `tools/finish_qwen_delivery.py --adb PATH --serial PHONE_SERIAL`
completes the one-shot transfer after the Spark finisher reports `ready`. It
requires the pinned profile and a matching passing quality report, copies the
artifact with SCP, verifies its checksum, locates that phone by its hardware
serial, and provisions only the custom model plus the existing worker binaries.
It never installs an APK, restarts the app, or executes inference. Connection
waits are bounded to eight hours by default. A failed build stops delivery.
The current stage is in `payloads/benchmark/qwen-delivery-status.json`; final
build/quality/provisioning receipts go under this directory and `validation/`.
The delivery helper's host test mocks SSH and ADB, including wrong-device and
failed-quality cases; it does not contact the phone.

The build receipt records source weight hashes, graph contracts, numerical
checks and generation checks. It explicitly leaves phone qualification pending.
These native CPU conversion checks do not establish phone speed, memory use,
GPU coverage, browser grounding, or transcription accuracy. The agent may
install, but may not execute tests on the phone.

Sources: [converter recipe](https://github.com/john-rocky/hf-to-litertlm/tree/e77865e8b2ecd33efc70aba7c44e77c58959fdde/qwen35vl_work),
[Qwen source](https://huggingface.co/Qwen/Qwen3.5-2B/tree/15852e8c16360a2fea060d615a32b45270f8a8fc),
[LiteRT FastVLM adapter](https://github.com/google-ai-edge/LiteRT-LM/blob/v0.17.1/runtime/conversation/model_data_processor/fastvlm_data_processor.cc).
