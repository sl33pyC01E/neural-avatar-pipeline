import { readFile, writeFile } from 'node:fs/promises';

const ROOT = new URL('./results/', import.meta.url);
const PROJECT_REPORT = new URL('../BENCHMARKS.md', import.meta.url);
const round = (value, digits = 2) => Number(Number(value).toFixed(digits));
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summary = (values) => ({ median: round(median(values)), min: round(Math.min(...values)), max: round(Math.max(...values)) });
const read = async (name) => JSON.parse(await readFile(new URL(name, ROOT), 'utf8'));
const format = (item, suffix = '') => `${item.median}${suffix} (${item.min}–${item.max}${suffix})`;

const warm = await read('LATEST_WARM.json');
const exportsResult = await read('LATEST_EXPORT.json');
const coldRuns = await Promise.all([1, 2, 3].map((run) => read(`cold-start-run-${run}.json`)));

const phaseValues = Object.values(warm.resources.gpuByPhase);
warm.resources.peakGpuUsedMiB = Math.max(...phaseValues.map((item) => item.peakUsedMiB).filter(Number.isFinite));
warm.resources.peakGpuUtilizationPct = Math.max(...phaseValues.map((item) => item.peakUtilizationPct).filter(Number.isFinite));
warm.resources.peakPowerW = round(Math.max(...phaseValues.map((item) => item.peakPowerW).filter(Number.isFinite)));
warm.resources.peakTemperatureC = Math.max(...phaseValues.map((item) => item.peakTemperatureC).filter(Number.isFinite));
await writeFile(new URL('LATEST_WARM.json', ROOT), JSON.stringify(warm, null, 2));

for (const run of exportsResult.runs) run.mode = 'warm';
exportsResult.warmWallSeconds = summary(exportsResult.runs.map((run) => run.wallSeconds));
await writeFile(new URL('LATEST_EXPORT.json', ROOT), JSON.stringify(exportsResult, null, 2));

const cold = {
  runs: coldRuns,
  allPortsReadyMs: summary(coldRuns.map((run) => run.timing.allPortsReadyMs)),
  fullyReadyMs: summary(coldRuns.map((run) => run.timing.fullyReadyMs)),
  pocketTtsLoadMs: summary(coldRuns.map((run) => run.timing.pocketTtsReportedLoadMs)),
  lamLoadMs: summary(coldRuns.map((run) => run.timing.lamReportedLoadMs)),
  stoppedGpuMiB: summary(coldRuns.map((run) => run.resources.stopped.gpu.usedMiB)),
  readyGpuMiB: summary(coldRuns.map((run) => run.resources.ready.gpu.usedMiB)),
  startupVramDeltaMiB: summary(coldRuns.map((run) => run.resources.startupVramDeltaMiB)),
  readyProjectWorkingSetGiB: summary(coldRuns.map((run) => run.resources.ready.host.ProjectWorkingSetGiB)),
};
await writeFile(new URL('LATEST_COLD_START_SERIES.json', ROOT), JSON.stringify(cold, null, 2));

const fullStackIncrementalVram = warm.resources.after.gpu.usedMiB - cold.stoppedGpuMiB.median;
const fullStackVramPct = fullStackIncrementalVram / warm.hardware.gpu.totalMiB * 100;
const report = `# Resource and latency benchmarks

Measured August 28, 2026 on the complete local portable bundle. Each workload has three runs unless explicitly noted. Tables show median and range. The browser remained open because it owns the renderer, audio context, and Live Full Flow controller.

## Test system

- GPU: ${warm.hardware.gpu.name}, ${warm.hardware.gpu.totalMiB} MiB VRAM, driver ${warm.hardware.gpu.driver}
- CPU: ${warm.hardware.host.CPU}, ${warm.hardware.host.Cores} cores / ${warm.hardware.host.Logical} logical processors
- RAM: ${warm.hardware.host.RAMTotalGiB} GiB
- OS: ${warm.hardware.host.Windows}, build ${warm.hardware.host.Build}
- Pipeline: PocketTTS Anna CUDA, LAM Audio2Expression, ARDY Core-8 and Core-40, quantized cached text embeddings

## Runtime latency and throughput

| Workload | Latency | Throughput |
| --- | ---: | ---: |
| PocketTTS synthesis | ${format(warm.pocketTts.serverMs, ' ms')} | ${format(warm.pocketTts.realtimeFactor, '×')} realtime |
| LAM inference on 5.76 s audio | ${format(warm.lam.inferenceMs, ' ms')} | ${format(warm.lam.realtimeFactor, '×')} realtime |
| ARDY Core-8, 3.2 s clip, 4 steps | ${format(warm.core8.generationSeconds, ' s')} | ${format(warm.core8.realtimeFactor, '×')} realtime |
| ARDY Core-40, 40-frame horizon, 4 steps | ${format(warm.core40Standard.generationSeconds, ' s')} | ${format(warm.core40Standard.realtimeFactor, '×')} realtime |
| ARDY Core-40, 40-frame horizon, 7 steps | ${format(warm.core40Quality.generationSeconds, ' s')} | ${format(warm.core40Quality.realtimeFactor, '×')} realtime |
| Live Full Flow: session start to motion ready | ${format(warm.fullFlowStart.readyMs, ' ms')} | — |
| Live Full Flow: speech command to first audible playback (TTFA) | ${format(warm.fullFlowSpeech.speechToAudioMs, ' ms')} | — |
| Approved introduction export, resident models | ${format(exportsResult.warmWallSeconds, ' s')} | ${round(exportsResult.mediaDurationSeconds.median / exportsResult.warmWallSeconds.median, 3)}× wall-clock media rate |

The first Core-8 request also started and loaded its worker, producing ${warm.core8.runs[0].wallMs} ms HTTP wall time. Its two resident-model requests took ${warm.core8.runs[1].wallMs} and ${warm.core8.runs[2].wallMs} ms. Core-40 at the quality setting used for the approved video remained about ${warm.core40Quality.realtimeFactor.median}× faster than its generated two-second horizon.

PocketTTS dominates live speech response time. Direct synthesis took ${warm.pocketTts.serverMs.median} ms, LAM then required only ${warm.lam.inferenceMs.median} ms, and the complete browser-controlled speech-to-first-audible path measured ${warm.fullFlowSpeech.speechToAudioMs.median} ms. Each run began with an empty speech queue. TTFA is measured from submitting \`speech.say\` until the UI reports the line as \`speaking\`; it is a software-observed playback-start measurement, not an acoustic microphone measurement.

## Resource use

| State | Whole-device VRAM | Project working set |
| --- | ---: | ---: |
| Launcher stopped | ${format(cold.stoppedGpuMiB, ' MiB')} | 0.089 GiB benchmark/terminal residue |
| Six services plus resident PocketTTS/LAM | ${format(cold.readyGpuMiB, ' MiB')} | ${format(cold.readyProjectWorkingSetGiB, ' GiB')} |
| Full stack after ARDY Core-8/Core-40 benchmarks | ${warm.resources.after.gpu.usedMiB} MiB | ${warm.resources.after.host.ProjectWorkingSetGiB} GiB |
| Peak sampled during combined benchmark | ${warm.resources.peakGpuUsedMiB} MiB | — |

Relative to the median stopped-device baseline, the fully loaded observed VRAM increase was ${fullStackIncrementalVram} MiB (${round(fullStackVramPct, 1)}% of the RTX 4090's VRAM). Peak sampled GPU utilization was ${warm.resources.peakGpuUtilizationPct}%, peak board power ${warm.resources.peakPowerW} W, and peak temperature ${warm.resources.peakTemperatureC}°C. The loaded project working set was ${round(warm.resources.after.host.ProjectWorkingSetGiB / warm.hardware.host.RAMTotalGiB * 100, 1)}% of installed RAM.

## Practical hardware guidance

The measured full-stack peak slightly exceeds the usable capacity normally available on an 8 GB GPU once Windows and browser rendering are included. The current practical recommendation is therefore an NVIDIA CUDA GPU with at least **12 GB VRAM**; 8 GB configurations are not claimed as supported. Use at least **16 GB system RAM**, with **32 GB or more recommended** when running development tools alongside the pipeline. These are headroom-based recommendations derived from the measured configuration, not validation results for every GPU model.

## Export characteristics

- Approved output: H.264 High profile video and AAC-LC audio in MP4
- Resolution and rate: ${exportsResult.runs[0].width}×${exportsResult.runs[0].height} at ${exportsResult.runs[0].frameRate} fps
- Container duration: ${exportsResult.mediaDurationSeconds.median} seconds
- Size: ${exportsResult.outputSizeMiB.median} MiB
- Warm export wall time: ${format(exportsResult.warmWallSeconds, ' s')}
- Closing visual post-roll: ${exportsResult.runs[0].postRollSeconds} seconds beyond the audio track, intentional

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

Startup is not a runtime priority, but three restart cycles were retained for reproducibility and to establish a clean stopped-resource baseline. All six ports became available in ${format(cold.allPortsReadyMs, ' ms')}; PocketTTS and LAM were resident and ready in ${format(cold.fullyReadyMs, ' ms')}.
`;

await writeFile(PROJECT_REPORT, report);
await writeFile(new URL('LATEST_COLD_START_SERIES.md', ROOT), `# Cold-start series\n\nAll ports: ${format(cold.allPortsReadyMs, ' ms')}. PocketTTS and LAM ready: ${format(cold.fullyReadyMs, ' ms')}.\n`);
await writeFile(new URL('LATEST_EXPORT.md', ROOT), `# Approved introduction export benchmark\n\nThree warm one-pass exports of the approved storyboard were measured.\n\n| Run | Wall time | Media duration | Wall/media | Size |\n| ---: | ---: | ---: | ---: | ---: |\n${exportsResult.runs.map((run) => `| ${run.run} | ${run.wallSeconds}s | ${run.containerSeconds}s | ${run.wallToMediaRatio}× | ${run.sizeMiB} MiB |`).join('\n')}\n\nAll outputs: H.264/AAC, ${exportsResult.runs[0].width}×${exportsResult.runs[0].height}, ${exportsResult.runs[0].frameRate} fps. Video exceeds audio by ${exportsResult.runs[0].postRollSeconds}s because the exporter intentionally preserves a closing visual post-roll.\n`);
console.log('Benchmark summaries updated.');
