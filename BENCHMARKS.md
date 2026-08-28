# Resource and latency benchmarks

Measured August 28, 2026 on the complete local portable bundle. Each workload has three runs unless explicitly noted. Tables show median and range. The browser remained open because it owns the renderer, audio context, and Live Full Flow controller.

## Test system

- GPU: NVIDIA GeForce RTX 4090, 24564 MiB VRAM, driver 610.88
- CPU: 13th Gen Intel(R) Core(TM) i9-13900KF, 24 cores / 32 logical processors
- RAM: 63.84 GiB
- OS: Microsoft Windows 11 Pro, build 26200
- Pipeline: PocketTTS Anna CUDA, LAM Audio2Expression, ARDY Core-8 and Core-40, quantized cached text embeddings

## Runtime latency and throughput

| Workload | Latency | Throughput |
| --- | ---: | ---: |
| PocketTTS synthesis | 2185.5 ms (1881.5–2282.2 ms) | 2.64× (2.45–2.89×) realtime |
| LAM inference on 5.76 s audio | 171.5 ms (170.4–177.4 ms) | 33.59× (32.47–33.8×) realtime |
| ARDY Core-8, 3.2 s clip, 4 steps | 0.76 s (0.75–1.35 s) | 4.19× (2.36–4.25×) realtime |
| ARDY Core-40, 40-frame horizon, 4 steps | 0.1 s (0.1–0.12 s) | 19.21× (16.97–19.28×) realtime |
| ARDY Core-40, 40-frame horizon, 7 steps | 0.17 s (0.17–0.2 s) | 11.94× (10.11–11.96×) realtime |
| Live Full Flow: session start to motion ready | 483.84 ms (482.13–492.28 ms) | — |
| Live Full Flow: speech command to first audible playback (TTFA) | 2788.12 ms (2755.36–3734.1 ms) | — |
| Approved introduction export, resident models | 37.01 s (36.91–37.26 s) | 0.878× wall-clock media rate |

The first Core-8 request also started and loaded its worker, producing 9661.78 ms HTTP wall time. Its two resident-model requests took 901.26 and 852.23 ms. Core-40 at the quality setting used for the approved video remained about 11.94× faster than its generated two-second horizon.

PocketTTS dominates live speech response time. Direct synthesis took 2185.5 ms, LAM then required only 171.5 ms, and the complete browser-controlled speech-to-first-audible path measured 2788.12 ms. Each run began with an empty speech queue. TTFA is measured from submitting `speech.say` until the UI reports the line as `speaking`; it is a software-observed playback-start measurement, not an acoustic microphone measurement.

## Resource use

| State | Whole-device VRAM | Project working set |
| --- | ---: | ---: |
| Launcher stopped | 3474 MiB (2871–3513 MiB) | 0.089 GiB benchmark/terminal residue |
| Six services plus resident PocketTTS/LAM | 4478 MiB (4421–5113 MiB) | 3.16 GiB (3.06–4.46 GiB) |
| Full stack after ARDY Core-8/Core-40 benchmarks | 8235 MiB | 6.025 GiB |
| Peak sampled during combined benchmark | 8238 MiB | — |

Relative to the median stopped-device baseline, the fully loaded observed VRAM increase was 4761 MiB (19.4% of the RTX 4090's VRAM). Peak sampled GPU utilization was 92%, peak board power 102.37 W, and peak temperature 54°C. The loaded project working set was 9.4% of installed RAM.

## Practical hardware guidance

The measured full-stack peak slightly exceeds the usable capacity normally available on an 8 GB GPU once Windows and browser rendering are included. The current practical recommendation is therefore an NVIDIA CUDA GPU with at least **12 GB VRAM**; 8 GB configurations are not claimed as supported. Use at least **16 GB system RAM**, with **32 GB or more recommended** when running development tools alongside the pipeline. These are headroom-based recommendations derived from the measured configuration, not validation results for every GPU model.

## Export characteristics

- Approved output: H.264 High profile video and AAC-LC audio in MP4
- Resolution and rate: 1490×876 at 30/1 fps
- Container duration: 32.49 seconds
- Size: 11.07 MiB
- Warm export wall time: 37.01 s (36.91–37.26 s)
- Closing visual post-roll: 2.1563 seconds beyond the audio track, intentional

## Method

- Component latency: identical fixed inputs were sent directly to the local PocketTTS, LAM, and ARDY HTTP services. ARDY used cached embeddings so text-encoder loading did not contaminate motion-generation timing.
- Full flow: the documented loopback control API started the session, cleared the speech queue, and submitted a line while the open browser reported motion and first audible playback state.
- Resources: GPU samples were collected every 250 ms with NVIDIA's driver utility. RAM is the summed working set of processes whose command line belongs to this project.
- Export: the approved storyboard was exported three times with resident models and probed with bundled FFprobe.

## Caveats

- Windows WDDM did not expose reliable per-process VRAM, so GPU figures are whole-device readings and include the desktop, browser, and other GPU applications. The stopped baseline makes the project-attributable increase visible.
- Speech generation is stochastic; identical text produced 5.44–5.76 seconds of audio, so real-time factors vary slightly with generated duration.
- The benchmark is a measured profile of this machine. The published hardware guidance adds operational headroom but has not yet been validated across multiple GPU models.

## Supplemental startup sample

Startup is not a runtime priority, but three restart cycles were retained for reproducibility and to establish a clean stopped-resource baseline. All six ports became available in 2616.85 ms (2616.25–2852.49 ms); PocketTTS and LAM were resident and ready in 3193.82 ms (3191.77–3541.56 ms).
