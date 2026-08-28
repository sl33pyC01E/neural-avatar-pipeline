import time

import torch
from pocket_tts import TTSModel


text = "Hi, I'm Anna. This is a low-latency facial animation test for Zome."
started = time.perf_counter()
model = TTSModel.load_model(language="english", temp=0.7)
model.to("cuda")
voice = model.get_state_for_audio_prompt("anna")
torch.cuda.synchronize()
print("load_gpu_ms", round((time.perf_counter() - started) * 1000, 1), flush=True)
started = time.perf_counter()
chunks = []
first_ms = None
for chunk in model.generate_audio_stream(voice, text, copy_state=True):
    if first_ms is None:
        torch.cuda.synchronize()
        first_ms = round((time.perf_counter() - started) * 1000, 1)
    chunks.append(chunk)
audio = torch.cat(chunks)
torch.cuda.synchronize()
elapsed = time.perf_counter() - started
duration = audio.numel() / model.sample_rate
print("first_chunk_ms", first_ms, "generate_gpu_ms", round(elapsed * 1000, 1), "duration_s", round(duration, 2), "x_realtime", round(duration / elapsed, 2), "device", audio.device, flush=True)
