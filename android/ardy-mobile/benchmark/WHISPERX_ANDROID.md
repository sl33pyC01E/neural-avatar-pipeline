> Historical research: retired from the active app in 0.6.0. See [Gemma avatar](../GEMMA_AVATAR.md). Do not restart the cancelled Spark build.

# Native WhisperX option

Tab 7 offers **WhisperX native · Base English (experimental)** alongside the
three whisper.cpp sizes. It runs on the phone's CPU, in the model service:

1. Decode PCM16/float32 WAV, mix channels and resample to 16 kHz.
2. Silero ONNX detects speech, with hysteresis and padding. Speech is split into
   at most 25-second chunks.
3. CTranslate2 4.8.2 uses base.en, INT8 weights/FP32 activations and Ruy. The
   native frontend implements Whisper's 80-bin Slaney log-mel spectrogram.
4. wav2vec2-base-960h INT8 ONNX and CTC alignment produce word timestamps.

This is a native port of the WhisperX pipeline, not its Python distribution.
It uses one chunk per decoder call and greedy decoding. Temperature retries,
Python batching, automatic language selection, and speaker diarization are not
included. Words outside the English alignment vocabulary retain their text
without fabricated timestamps. The original transcript is preserved.

All stages stay resident with Qwen and use blocking waits between requests.
ONNX CPU thread spinning is disabled. Stop/unload cancels between stages and
releases the model process; the CTranslate2 call itself is not interruptible
mid-chunk. Selecting whisper.cpp loads only the original whisper.cpp engine.
There is no claim of Adreno or NPU execution for WhisperX.

The total ASR duration includes preprocessing, VAD, decoding and alignment. VAD
and alignment times appear beside the total. Detailed results retain the word
timings and individual stage times. Comparing this total against whisper.cpp
also charges the extra alignment work; use the separate stages when analyzing
where the time went.

## Reproduce

Clone CTranslate2 at the revision in `tools/prepare_whisperx_android.py`, with
its pinned submodules, under `payloads/ctranslate2`. The tracked Android patch
disables unsupported Linux thread affinity on Bionic; no affinity is requested.
The build statically links CTranslate2/Ruy into the JNI library and supports
16 KiB Android ELF page alignment.

```powershell
python tools/prepare_whisperx_android.py --ndk PATH --report validation/whisperx-native-build-2026-09-26.json
python tools/prepare_whisperx_models.py --download
python tools/prepare_whisperx_models.py --install --adb PATH --transport 1
```

The manifest pins 10 files, including ASR, VAD, alignment and their configuration.
Provisioning verifies local, transfer and app-private hashes and never launches
phone code. Models are provisioned separately from the debug APK.
The 243,174,455-byte model set was provisioned on September 26; see
`validation/provisioning-whisperx-2026-09-26.json`. APK 0.5.1 is installed;
the user's runtime check is pending.

The C++ spectrogram matches the faster-whisper NumPy implementation on silence,
tones and deterministic noise. Java checks cover RIFF padding, resampling,
malformed WAV rejection, CTC word boundaries, offsets and unalignable words.
Android compilation, lint and packaged JNI checks cover build compatibility.
These checks do not qualify transcription accuracy, alignment quality, runtime
loading, memory use or speed on the phone. The user runs those checks.

Sources: [WhisperX](https://github.com/m-bain/whisperX),
[faster-whisper](https://github.com/SYSTRAN/faster-whisper),
[CTranslate2](https://github.com/OpenNMT/CTranslate2),
[base.en weights](https://huggingface.co/Systran/faster-whisper-base.en),
[Silero ONNX](https://huggingface.co/onnx-community/silero-vad), and
[wav2vec2 ONNX](https://huggingface.co/Xenova/wav2vec2-base-960h).
License notices are packaged under `assets/licenses/whisperx`.
