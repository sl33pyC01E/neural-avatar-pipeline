# Neural Avatar Pipeline warm benchmark

Measured 2026-08-28T20:35:48.471Z on NVIDIA GeForce RTX 4090 (24564 MiB VRAM), 13th Gen Intel(R) Core(TM) i9-13900KF, 63.84 GiB RAM, driver 610.88. Values are median (range), three runs.

| Workload | Latency | Throughput |
| --- | ---: | ---: |
| PocketTTS server | 2185.5 (1881.5–2282.2) ms | 2.64 (2.45–2.89)× realtime |
| LAM inference | 171.5 (170.4–177.4) ms | 33.59 (32.47–33.8)× realtime |
| ARDY Core-8, 4 steps | 0.76 (0.75–1.35) s | 4.19 (2.36–4.25)× realtime |
| ARDY Core-40, 4 steps | 0.1 (0.1–0.12) s | 19.21 (16.97–19.28)× realtime |
| ARDY Core-40, 7 steps | 0.17 (0.17–0.2) s | 11.94 (10.11–11.96)× realtime |
| Full Flow motion ready | 483.84 (482.13–492.28) ms | — |
| Full Flow speech → first audible (TTFA) | 2788.12 (2755.36–3734.1) ms | — |

TTFA starts when `speech.say` is submitted with an empty queue and ends when the UI reports the line as `speaking`. It is software-observed playback start, not an acoustic microphone measurement.

## Resources

- Baseline GPU memory: 6847 MiB.
- Loaded-idle GPU memory: 8235 MiB.
- Peak sampled GPU memory: 8238 MiB.
- Baseline project working set: 5.086 GiB.
- Loaded-idle project working set: 6.025 GiB.
