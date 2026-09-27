# Gemma phone measurements (historical LiteRT harness)

**v25:** The app uses llama.cpp only; the LiteRT benchmark service below has been
removed. Use Debug → Models for current device pairing, image/audio chat and
resource measurements. Provision current models with `tools/prepare_gemma_qat.py`.
`models.json` is now the QAT inventory; `archive/models-before-llama-only.json`
retains the prior LiteRT identities. Instructions below describe the old checkpoint
and must not be used to provision or benchmark v25.

The comparison harness targets **Gemma 4 E2B** on LiteRT CPU/GPU, alongside live Ardy,
Pocket/Anna, LAM and Cleopatra VRM. Qwen and separate Whisper/WhisperX transcription
are retired. Historical reports/recipes remain as research records; the custom
Spark export is cancelled and must not restart. `archive/models-before-gemma-only.json`
records retired model identities; `models.json` provisions only full multimodal Gemma.

Tab 7 provides progressive chat with images/audio, streamed reasoning and metrics.
Tab 8 retains the embedded browser. Tab 9 attempts simultaneous model residency
and lets Gemma pilot the avatar through a bounded tool API. See
[Gemma avatar](../GEMMA_AVATAR.md) and [chat/browser](../MODEL_CHAT_BROWSER.md).

The optional fixture runner is **user-run only**. The coding agent does not run
phone inference. Warm Together in tab 6 with Benchmark workload enabled, then
run `Run-Comparison.ps1 -Engine gemma-litert-gpu -Load full -Transport <id>`.
For CPU choose `gemma-litert-cpu`; for idle press Stop all after warmup and use
`-Load idle`. The wrapper prompts you before starting. The Python runner requires
`--run`; without it, it only prints a plan. Neither runner taps or sends anything.

Image scoring compares pixel coordinates with normalized 0–1000 coordinates;
audio uses direct Gemma transcription. Results retain separate accuracy, time,
PSS and thermal measurements under idle/full avatar load. File/intent transport
latency stays separate from on-device inference time. Small default runs are
setup checks rather than rankings; use `-AllCases` for the full fixtures. Keep
speech/core/embedding/display/charging/thermal conditions comparable.

Context is 4,096 tokens; image allocation is fixed by the artifact. Output is
bounded to 256 plus any reasoning budget. Advanced Python flags include
`--thinking --reasoning-budget 128`. CPU threads are two. PSS includes package
processes but may exclude shared GPU allocations. No NPU integration is claimed.

`tools/prepare_benchmark.py --transport <id> --download --install` verifies and
provisions Gemma without launching the app. It no longer builds/copies native
chat or ASR servers. The current full bundle is 2,588,147,712 bytes with SHA-256
`181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c`.

The app also offers the full Gemma E4B bundle in tab 7 (3,659,530,240 bytes).
Provisioning includes both pinned bundles; app selection also applies to tabs
8–9. The command-line harness still targets E2B; use the app for E4B comparisons
until that harness is extended. No E4B phone benchmark is claimed.
