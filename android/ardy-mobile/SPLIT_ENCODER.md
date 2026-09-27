# Cleopatra v25: GPU encoder with NPU language model

In **Debug → 7 · Models → Model**, choose **Encoder → decoder: GPU → NPU**
(the default), then press **Apply & load**. Both Gemma 4 E2B/E4B IT QAT use llama.cpp.

This requests `--device HTP0 -ngl 999 --mmproj-device GPUOpenCL
--mmproj-offload` using the already-packaged llama.cpp b11200 worker. No new
weights, conversion or native rebuild is required. Image embeddings are computed
on the encoder backend, then consumed by the language model for prompt processing
and token generation. Unsupported operations can still use CPU.

Fallbacks are GPU→GPU, GPU→CPU and CPU→CPU, in encoder-first order.
There are no LiteRT, Auto, CPU→GPU or CPU→NPU options. Main, Browser and tab 9
inherit the Models selection. Changing pairing requires reloading and changes
the disk-prefix compatibility key. The app does not silently switch devices.

Gemma's combined projector contains vision and audio encoders. The pinned runtime
passes one device configuration into both, so this selector moves **both**, not
just vision. Selecting vision GPU while keeping audio CPU would require modifying
the native runtime. It does not require moving PocketTTS, LAM or Ardy.

Startup diagnostics separately record the requested decoder device, observed
layer offload, requested encoder device and observed `CLIP using … backend` lines.
Missing evidence stays marked unconfirmed; these logs do not prove that every
operation was accelerated.

This is supported configuration, not a phone performance result. In particular,
splitting devices does not guarantee lower shared RAM or cure the earlier E4B
low-memory termination. The agent ran host configuration/protocol/cache/UI checks,
Android build/lint and APK verification, and installed without launching the app.
Phone image/audio generation and performance are tested by the user.

Primary sources for the pinned runtime:

- [Server options: independent multimodal device](https://github.com/ggml-org/llama.cpp/blob/81bc6b83f827df746eb129235488d325c49cae52/tools/server/README.md)
- [Shared vision/audio context configuration](https://github.com/ggml-org/llama.cpp/blob/81bc6b83f827df746eb129235488d325c49cae52/tools/mtmd/mtmd.cpp)
- [Encoder backend initialization and CPU fallback](https://github.com/ggml-org/llama.cpp/blob/81bc6b83f827df746eb129235488d325c49cae52/tools/mtmd/clip.cpp)
