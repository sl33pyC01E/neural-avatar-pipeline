import { execFile, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ROOT = new URL('../', import.meta.url);
const OUTPUT = new URL('./results/', import.meta.url);
const CONTROL = 'http://127.0.0.1:8788/api/control';
const MOTION = 'http://127.0.0.1:8793';
const TTS = 'http://127.0.0.1:8796';
const LAM = 'http://127.0.0.1:8797';
const RUNS = 3;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nowMs = () => performance.now();
const round = (value, digits = 2) => Number(Number(value).toFixed(digits));
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const summary = (values) => ({
  median: round(median(values)),
  min: round(Math.min(...values)),
  max: round(Math.max(...values)),
});

let controlSequence = 0;
let phase = 'baseline';
let sampling = true;
const gpuSamples = [];

async function getJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || `${url} returned ${response.status}`);
  return payload;
}

async function postJson(url, body) {
  const started = nowMs();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  const wallMs = nowMs() - started;
  if (!response.ok || !payload.ok) throw new Error(payload.error || `${url} returned ${response.status}`);
  return { payload, wallMs };
}

async function sendControl(action, args = {}) {
  controlSequence += 1;
  const queued = await postJson(CONTROL, {
    action,
    args,
    requestId: `benchmark-${Date.now()}-${controlSequence}-${action}`,
  });
  const commandId = queued.payload.commandId;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const result = await getJson(`${CONTROL}/result?id=${commandId}`);
    if (result.command?.status === 'completed') return { queueWallMs: queued.wallMs, result: result.command.result };
    if (result.command?.status === 'failed') throw new Error(result.command.error || `${action} failed`);
    await sleep(50);
  }
  throw new Error(`${action} timed out`);
}

function gpuSnapshotSync() {
  const raw = execFileSync('nvidia-smi', [
    '--query-gpu=name,driver_version,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu,power.draw',
    '--format=csv,noheader,nounits',
  ], { encoding: 'utf8', windowsHide: true }).trim();
  const [name, driver, totalMiB, usedMiB, freeMiB, utilizationPct, temperatureC, powerW] = raw.split(',').map((value) => value.trim());
  return {
    name,
    driver,
    totalMiB: Number(totalMiB),
    usedMiB: Number(usedMiB),
    freeMiB: Number(freeMiB),
    utilizationPct: Number(utilizationPct),
    temperatureC: Number(temperatureC),
    powerW: Number(powerW),
  };
}

function hostSnapshot() {
  const script = [
    "$os=Get-CimInstance Win32_OperatingSystem",
    "$cpu=Get-CimInstance Win32_Processor | Select-Object -First 1",
    "$cs=Get-CimInstance Win32_ComputerSystem",
    "$project=(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*\\Documents\\unified*' } | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })",
    "[pscustomobject]@{Windows=$os.Caption;Build=$os.BuildNumber;CPU=$cpu.Name;Cores=$cpu.NumberOfCores;Logical=$cpu.NumberOfLogicalProcessors;RAMTotalGiB=[math]::Round($cs.TotalPhysicalMemory/1GB,2);RAMUsedGiB=[math]::Round(($cs.TotalPhysicalMemory-$os.FreePhysicalMemory*1KB)/1GB,2);ProjectProcessCount=@($project).Count;ProjectWorkingSetGiB=[math]::Round((($project|Measure-Object WorkingSet64 -Sum).Sum)/1GB,3)} | ConvertTo-Json -Compress",
  ].join(';');
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true }));
}

async function sampleGpuLoop() {
  while (sampling) {
    try {
      const { stdout } = await execFileAsync('nvidia-smi', [
        '--query-gpu=memory.used,utilization.gpu,temperature.gpu,power.draw',
        '--format=csv,noheader,nounits',
      ], { encoding: 'utf8', windowsHide: true, timeout: 2000 });
      const [usedMiB, utilizationPct, temperatureC, powerW] = stdout.trim().split(',').map((value) => Number(value.trim()));
      gpuSamples.push({ at: new Date().toISOString(), phase, usedMiB, utilizationPct, temperatureC, powerW });
    } catch {}
    await sleep(250);
  }
}

function parseWav(buffer) {
  const view = new DataView(buffer);
  const ascii = (offset, length) => String.fromCharCode(...new Uint8Array(buffer, offset, length));
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') throw new Error('PocketTTS did not return a RIFF/WAVE file.');
  let offset = 12;
  let format = null;
  let dataOffset = 0;
  let dataLength = 0;
  while (offset + 8 <= buffer.byteLength) {
    const id = ascii(offset, 4);
    const length = view.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      format = {
        code: view.getUint16(offset + 8, true),
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bits: view.getUint16(offset + 22, true),
      };
    }
    if (id === 'data') { dataOffset = offset + 8; dataLength = length; break; }
    offset += 8 + length + (length % 2);
  }
  if (!format || !dataOffset || !dataLength) throw new Error('WAV format or data chunk is missing.');
  const bytesPerSample = format.bits / 8;
  const frames = Math.floor(dataLength / bytesPerSample / format.channels);
  const mono = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < format.channels; channel += 1) {
      const sampleOffset = dataOffset + (frame * format.channels + channel) * bytesPerSample;
      if (format.code === 1 && format.bits === 16) sum += view.getInt16(sampleOffset, true) / 32768;
      else if (format.code === 3 && format.bits === 32) sum += view.getFloat32(sampleOffset, true);
      else throw new Error(`Unsupported WAV format ${format.code}/${format.bits}.`);
    }
    mono[frame] = sum / format.channels;
  }
  return { sampleRate: format.sampleRate, duration: frames / format.sampleRate, mono };
}

async function benchmarkTts() {
  const text = 'Neural Avatar Pipeline measures local speech and facial animation latency on this machine.';
  const runs = [];
  let wav = null;
  for (let index = 0; index < RUNS; index += 1) {
    phase = `tts-${index + 1}`;
    const started = nowMs();
    const response = await fetch(`${TTS}/api/tts`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
    });
    const buffer = await response.arrayBuffer();
    const wallMs = nowMs() - started;
    if (!response.ok) throw new Error(`PocketTTS failed: ${new TextDecoder().decode(buffer)}`);
    const parsed = parseWav(buffer);
    wav ||= parsed;
    const serverMs = Number(response.headers.get('x-tts-latency-ms'));
    runs.push({ run: index + 1, wallMs: round(wallMs), serverMs: round(serverMs), audioSeconds: round(parsed.duration, 4), realtimeFactor: round(parsed.duration / (serverMs / 1000)) });
  }
  return { text, runs, wallMs: summary(runs.map((run) => run.wallMs)), serverMs: summary(runs.map((run) => run.serverMs)), realtimeFactor: summary(runs.map((run) => run.realtimeFactor)), wav };
}

async function benchmarkLam(wav) {
  const payload = wav.mono.buffer.slice(wav.mono.byteOffset, wav.mono.byteOffset + wav.mono.byteLength);
  const runs = [];
  for (let index = 0; index < RUNS; index += 1) {
    phase = `lam-${index + 1}`;
    const started = nowMs();
    const response = await fetch(`${LAM}/api/infer/lam`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-sample-rate': String(wav.sampleRate) },
      body: payload,
    });
    const result = await response.json();
    const wallMs = nowMs() - started;
    if (!response.ok || !result.ok) throw new Error(result.error || 'LAM failed.');
    runs.push({ run: index + 1, wallMs: round(wallMs), inferenceMs: round(result.latencyMs), audioSeconds: result.duration, processingMsPerAudioSecond: round(result.latencyMs / result.duration), realtimeFactor: round(result.duration / (result.latencyMs / 1000)) });
  }
  return { runs, wallMs: summary(runs.map((run) => run.wallMs)), inferenceMs: summary(runs.map((run) => run.inferenceMs)), processingMsPerAudioSecond: summary(runs.map((run) => run.processingMsPerAudioSecond)), realtimeFactor: summary(runs.map((run) => run.realtimeFactor)) };
}

async function benchmarkCore8(cacheKey) {
  const runs = [];
  for (let index = 0; index < RUNS; index += 1) {
    phase = `ardy-core8-${index + 1}`;
    const { payload, wallMs } = await postJson(`${MOTION}/api/generate`, {
      engine: 'ardy', duration: 3.2, points: [{ x: 0, z: 0 }, { x: 0, z: 2 }],
      textEnabled: true, textMode: 'cache', cacheKey, steps: 4,
      constraintGuidance: 2, textGuidance: 3, headingEnabled: true, seed: 42,
    });
    const motion = payload.motion;
    runs.push({ run: index + 1, wallMs: round(wallMs), generationSeconds: round(motion.generationSeconds, 4), realtimeFactor: round(motion.realtimeFactor), peakVramGiB: round(motion.peakVramGiB, 3), constraintErrorMaxM: round(motion.constraintErrorMaxM, 4) });
  }
  return { runs, wallMs: summary(runs.map((run) => run.wallMs)), generationSeconds: summary(runs.map((run) => run.generationSeconds)), realtimeFactor: summary(runs.map((run) => run.realtimeFactor)), peakVramGiB: summary(runs.map((run) => run.peakVramGiB)) };
}

function liveBody(cacheKey, steps, textGuidance) {
  return {
    engine: 'ardy', velocityX: 0, velocityZ: 0, steps,
    constraintGuidance: 2, textGuidance, historyFrames: 8,
    playbackFrame: 0, replanBufferFrames: 3, liveSmoothingSeconds: 1,
    headingEnabled: true, retainTextEncoder: false,
    textEnabled: true, textMode: 'cache', cacheKey,
    routePoints: [], routeElapsed: 0, routeCurve: false,
  };
}

async function benchmarkCore40(cacheKey, label, steps, textGuidance) {
  const runs = [];
  for (let index = 0; index < RUNS; index += 1) {
    phase = `${label}-${index + 1}`;
    const { payload, wallMs } = await postJson(`${MOTION}/api/live/start`, liveBody(cacheKey, steps, textGuidance));
    const motion = payload.motion;
    runs.push({ run: index + 1, wallMs: round(wallMs), generationSeconds: round(motion.generationSeconds, 4), realtimeFactor: round(motion.realtimeFactor), frames: motion.frames, fps: motion.fps, seamJointStepMaxM: round(motion.seamJointStepMaxM, 5) });
  }
  return { steps, textGuidance, runs, wallMs: summary(runs.map((run) => run.wallMs)), generationSeconds: summary(runs.map((run) => run.generationSeconds)), realtimeFactor: summary(runs.map((run) => run.realtimeFactor)) };
}

async function waitForMotionReady(timeoutMs = 120000) {
  const started = nowMs();
  while (nowMs() - started < timeoutMs) {
    const state = await getJson(`${CONTROL}/state`);
    if (state.state?.session?.motionReady) return nowMs() - started;
    await sleep(50);
  }
  throw new Error('Live Full Flow did not become motion-ready.');
}

async function benchmarkLiveFlowStarts() {
  const runs = [];
  for (let index = 0; index < RUNS; index += 1) {
    await sendControl('session.stop');
    await sleep(250);
    phase = `full-flow-start-${index + 1}`;
    const started = nowMs();
    const command = await sendControl('session.start');
    await waitForMotionReady();
    runs.push({ run: index + 1, commandMs: round(nowMs() - started - 0), readyMs: round(nowMs() - started), queueWallMs: round(command.queueWallMs) });
  }
  return { runs, readyMs: summary(runs.map((run) => run.readyMs)) };
}

async function benchmarkSpeechFlow() {
  const runs = [];
  for (let index = 0; index < RUNS; index += 1) {
    await sendControl('speech.queue.clear');
    const text = `Live pipeline latency sample ${index + 1}. Speech, face, and motion remain synchronized.`;
    phase = `full-flow-speech-${index + 1}`;
    const started = nowMs();
    await sendControl('speech.say', { text });
    const observed = {};
    let speakingSeen = false;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const snapshot = await getJson(`${CONTROL}/state`);
      const item = snapshot.state?.speech?.queue?.find((entry) => entry.text === text);
      if (item) {
        const key = String(item.status).split(' · ')[0];
        if (observed[key] == null) observed[key] = round(nowMs() - started);
        if (key === 'speaking') speakingSeen = true;
      } else if (speakingSeen) {
        observed.complete = round(nowMs() - started);
        break;
      }
      await sleep(40);
    }
    if (!speakingSeen) throw new Error(`Speech sample ${index + 1} never reached audible playback.`);
    runs.push({ run: index + 1, text, ...observed, speechToAudioMs: observed.speaking });
  }
  return { runs, speechToAudioMs: summary(runs.map((run) => run.speechToAudioMs)), completeMs: summary(runs.map((run) => run.complete)) };
}

function gpuPhaseSummary(samples) {
  const grouped = {};
  for (const sample of samples) (grouped[sample.phase] ||= []).push(sample);
  const peak = (values, key) => {
    const finite = values.map((item) => item[key]).filter(Number.isFinite);
    return finite.length ? Math.max(...finite) : null;
  };
  return Object.fromEntries(Object.entries(grouped).map(([name, values]) => {
    const peakPowerW = peak(values, 'powerW');
    return [name, {
      peakUsedMiB: peak(values, 'usedMiB'),
      peakUtilizationPct: peak(values, 'utilizationPct'),
      peakPowerW: peakPowerW == null ? null : round(peakPowerW),
      peakTemperatureC: peak(values, 'temperatureC'),
    }];
  }));
}

function reportMarkdown(result) {
  const f = (item) => `${item.median} (${item.min}–${item.max})`;
  return `# Neural Avatar Pipeline warm benchmark\n\n` +
    `Measured ${result.timestamp} on ${result.hardware.gpu.name} (${result.hardware.gpu.totalMiB} MiB VRAM), ${result.hardware.host.CPU}, ${result.hardware.host.RAMTotalGiB} GiB RAM, driver ${result.hardware.gpu.driver}. Values are median (range), three runs.\n\n` +
    `| Workload | Latency | Throughput |\n| --- | ---: | ---: |\n` +
    `| PocketTTS server | ${f(result.pocketTts.serverMs)} ms | ${f(result.pocketTts.realtimeFactor)}× realtime |\n` +
    `| LAM inference | ${f(result.lam.inferenceMs)} ms | ${f(result.lam.realtimeFactor)}× realtime |\n` +
    `| ARDY Core-8, 4 steps | ${f(result.core8.generationSeconds)} s | ${f(result.core8.realtimeFactor)}× realtime |\n` +
    `| ARDY Core-40, 4 steps | ${f(result.core40Standard.generationSeconds)} s | ${f(result.core40Standard.realtimeFactor)}× realtime |\n` +
    `| ARDY Core-40, 7 steps | ${f(result.core40Quality.generationSeconds)} s | ${f(result.core40Quality.realtimeFactor)}× realtime |\n` +
    `| Full Flow motion ready | ${f(result.fullFlowStart.readyMs)} ms | — |\n` +
    `| Full Flow speech → audible | ${f(result.fullFlowSpeech.speechToAudioMs)} ms | — |\n\n` +
    `## Resources\n\n` +
    `- Baseline GPU memory: ${result.resources.before.gpu.usedMiB} MiB.\n` +
    `- Loaded-idle GPU memory: ${result.resources.after.gpu.usedMiB} MiB.\n` +
    `- Peak sampled GPU memory: ${result.resources.peakGpuUsedMiB} MiB.\n` +
    `- Baseline project working set: ${result.resources.before.host.ProjectWorkingSetGiB} GiB.\n` +
    `- Loaded-idle project working set: ${result.resources.after.host.ProjectWorkingSetGiB} GiB.\n`;
}

await mkdir(OUTPUT, { recursive: true });
const sampler = sampleGpuLoop();
const before = { gpu: gpuSnapshotSync(), host: hostSnapshot() };
const initialControl = await getJson(`${CONTROL}/state`);

try {
  await sendControl('session.stop');
  await sendControl('locomotion.stop');
  await sendControl('speech.queue.clear');
  await sendControl('loops.set', { speech: false, embeddings: false, path: false });
  await sendControl('embedding.idle-pair.set', {
    primary: 'The person stands up straight, naturally.',
    secondary: 'The person lowers their hands and stands in a neutral pose.',
    intervalSeconds: 12,
  });

  const tts = await benchmarkTts();
  const lam = await benchmarkLam(tts.wav);
  delete tts.wav;

  const liveCache = await getJson(`${MOTION}/api/live/text-cache`);
  const natural = liveCache.entries.find((entry) => /stands up straight, naturally/i.test(entry.text));
  const walking = liveCache.entries.find((entry) => /walks forwards naturally/i.test(entry.text));
  if (!natural || !walking) throw new Error('Required cached benchmark embeddings were not found.');

  const core8 = await benchmarkCore8(walking.key);
  const core40Standard = await benchmarkCore40(natural.key, 'ardy-core40-standard', 4, 3);
  const core40Quality = await benchmarkCore40(natural.key, 'ardy-core40-quality', 7, 4);
  const fullFlowStart = await benchmarkLiveFlowStarts();
  const fullFlowSpeech = await benchmarkSpeechFlow();
  await sendControl('session.stop');
  phase = 'loaded-idle';
  await sleep(750);
  const after = { gpu: gpuSnapshotSync(), host: hostSnapshot() };
  sampling = false;
  await sampler;

  const result = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    mode: 'warm services; first ARDY call includes worker/model cold load when applicable',
    runsPerWorkload: RUNS,
    hardware: { gpu: before.gpu, host: before.host },
    serviceStatus: {
      tts: await getJson(`${TTS}/api/status`),
      lam: await getJson(`${LAM}/api/status`),
      motion: await getJson(`${MOTION}/api/state`),
    },
    pocketTts: tts,
    lam,
    core8,
    core40Standard,
    core40Quality,
    fullFlowStart,
    fullFlowSpeech,
    resources: {
      before,
      after,
      peakGpuUsedMiB: Math.max(...gpuSamples.map((sample) => sample.usedMiB).filter(Number.isFinite)),
      peakGpuUtilizationPct: Math.max(...gpuSamples.map((sample) => sample.utilizationPct).filter(Number.isFinite)),
      peakPowerW: round(Math.max(...gpuSamples.map((sample) => sample.powerW).filter(Number.isFinite))),
      gpuByPhase: gpuPhaseSummary(gpuSamples),
    },
    initialUiState: {
      view: initialControl.state?.view,
      sessionActive: initialControl.state?.session?.active,
    },
  };
  const stamp = result.timestamp.replace(/[:.]/g, '-');
  await writeFile(new URL(`warm-${stamp}.json`, OUTPUT), JSON.stringify(result, null, 2));
  await writeFile(new URL('LATEST_WARM.md', OUTPUT), reportMarkdown(result));
  await writeFile(new URL('LATEST_WARM.json', OUTPUT), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ok: true, report: 'benchmarks/results/LATEST_WARM.md', result: 'benchmarks/results/LATEST_WARM.json' }, null, 2));
} catch (error) {
  sampling = false;
  await sampler;
  try { await sendControl('session.stop'); } catch {}
  console.error(error?.stack || error);
  process.exitCode = 1;
}
