# Cleopatra v23: accelerator startup and memory

## Saved phone evidence from v22

Both E2B OpenCL attempts reached `model loaded` and `server is listening`
(initialization approximately 12.67 s and 14.01 s). The E2B Hexagon attempt also
reached that state (approximately 8.45 s). The app then raised:

> Requested accelerator did not confirm layer offload.

That exception came from our Java readiness gate. It required an `offloaded N/N
layers` log line after native health succeeded. In the pinned b11200 source,
`common_log_get_verbosity()` maps native `GGML_LOG_LEVEL_INFO` to trace level 4;
the default threshold is 3. Thus missing log evidence was not proof that the
accelerator failed. GPU logs also explicitly assigned a layer to GPUOpenCL,
then disabled unsupported Flash Attention. That warning did not prevent loading.

v23 uses native HTTP health for readiness and verbosity 4 for evidence. Missing
offload counts are displayed as unavailable; zero and partial counts remain
visible. Neither missing evidence nor inability to save a startup receipt rejects
a healthy worker. Each model/backend gets a bounded log and startup receipt.

This fixes the observed app-side rejection. It does **not** establish that every
GPU/NPU operation, generation, audio or image path works on this phone.

The user's later v22 attempts added a separate failure: Android recorded model
service exits for **LOW_MEMORY** at 00:27:09 and 00:27:44 on September 27. The last
startup receipt identifies E4B / Hexagon / 8K context / 280 visual tokens, with
about 4.49 GiB system memory available before loading. Its native log stops during
initialization, before server-ready. This attempt cannot be explained by the
offload-log gate alone. After that exit, passive process inspection found no
surviving llama worker. v23's memory policy addresses avoidable resident/graph
allocations; whether E4B now fits on the accelerator remains unverified.

## Passive CPU memory snapshot

The already-running E4B llama.cpp worker, with 8K context, 280 visual tokens and
reasoning off, reported these `/proc` values before the change:

| Worker allocation | KiB |
|---|---:|
| Total proportional resident memory (PSS) | 4,250,226 |
| Anonymous PSS | 3,870,700 |
| File-backed PSS | 379,419 |
| Swap | 88,688 |

Worker PSS was about **4.05 GiB**, excluding the avatar and model-service process.
Its largest anonymous region was 2,704,804 KiB, matching the size of the language
model's dense Q4_0 tensors plus regular Q6_K token embeddings. This is consistent
with CPU repacking; a memory map alone does not prove the exact allocation owner.

The official QAT GGUFs are mixed precision:

| Tensor group | E2B bytes | E4B bytes |
|---|---:|---:|
| Language Q4_0 tensors | 1,047,969,792 | 2,219,212,800 |
| Per-layer embeddings, Q6_K | 1,926,758,400 | 2,312,110,080 |
| Regular token embeddings, Q6_K | 330,301,440 | 550,502,400 |

E4B's combined vision/audio projector additionally contains 920,911,872 bytes of
BF16 tensors and 70,529,792 bytes of F32 tensors. These file-level measurements
explain why a Q4_0 label does not imply a fully four-bit resident stack. They are
not themselves RAM measurements or a matched comparison with LiteRT.

## Changes

- Default **Memory focused** preset: CPU `--no-repack`, batch/ubatch 128/64.
  **Throughput** keeps CPU repacking and batch/ubatch 256/128.
- Both presets enable on-demand embedding reads (`--lazy-mode on`). The native
  default enables this only for tensors larger than 4 GiB, above both per-layer
  embedding tables here.
- Retain at most two context checkpoints instead of the native default 32.
  The separate prompt-cache RAM budget remains zero. Persistent prefix files
  remain available and include effective launch options in their compatibility key.
- Keep explicit CPU/OpenCL/HTP0 placement and disable automatic fitting. GPU/NPU
  use their own weight layouts. KV precision and model/projector files are unchanged.
- Avoid duplicating the entire Java message history through JSON serialization
  when constructing the next request.

Memory-mapped weights still count while resident; the operating system can reclaim
their clean pages. These changes may reduce anonymous memory and retained state
but can slow processing. A before/after phone measurement is still needed.

## Verification

Host checks exercise production protocol, fake-HTTP disk-cache lifecycle, saved-log
interpretation, bounded native-output capture, memory settings and UI persistence.
Android compilation/lint and APK integrity checks are recorded alongside them in
`validation/*v23*`. The desktop renderer uses CPU SwiftShader and a fake bridge.
No phone model, app, service, generation or benchmark was started by the agent.
The user performs the phone execution test after installation.

Source references: pinned llama.cpp `common/log.cpp`, `common/log.h`,
`common/arg.cpp`, `src/llama-model-loader.cpp`; official artifacts and exact
hashes in `benchmark/gemma-qat.json`.
