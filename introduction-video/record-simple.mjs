import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const CONTROL_ROOT = 'http://127.0.0.1:8788/api/control';
const storyboardFile = process.argv[2] || './storyboard.json';
const storyboardUrl = path.isAbsolute(storyboardFile) ? pathToFileURL(storyboardFile) : new URL(storyboardFile, import.meta.url);
async function loadStoryboard(url, visited = new Set()) {
  if (visited.has(url.href)) throw new Error(`Circular storyboard inheritance at ${url.href}.`);
  visited.add(url.href);
  const current = JSON.parse(await readFile(url, 'utf8'));
  if (!current.extends) return current;
  const base = await loadStoryboard(new URL(current.extends, url), visited);
  return {
    ...base,
    ...current,
    path: { ...(base.path || {}), ...(current.path || {}) },
    motionSettings: { ...(base.motionSettings || {}), ...(current.motionSettings || {}) },
  };
}
const storyboard = await loadStoryboard(storyboardUrl);
const runId = `simple-introduction-v${storyboard.version}-${Date.now()}`;
let sequence = 0;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function readState() {
  const response = await fetch(`${CONTROL_ROOT}/state`, { cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || 'The control state is unavailable.');
  return payload;
}

async function waitForResult(commandId, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(`${CONTROL_ROOT}/result?id=${commandId}`, { cache: 'no-store' });
    const payload = await response.json();
    if (payload.command?.status === 'completed') return payload.command.result;
    if (payload.command?.status === 'failed') throw new Error(payload.command.error || `Command ${commandId} failed.`);
    await wait(100);
  }
  throw new Error(`Command ${commandId} timed out.`);
}

async function send(action, args = {}) {
  sequence += 1;
  const response = await fetch(CONTROL_ROOT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, args, requestId: `${runId}-${sequence}-${action}` }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || `${action} was rejected.`);
  if (!payload.uiConnected) throw new Error('Live Full Flow is not open and connected.');
  await waitForResult(payload.commandId);
  console.log(`${action} ready`);
}

async function waitForTimeline() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const payload = await readState();
    if (payload.state?.session?.active && payload.state?.session?.motionReady) return;
    await wait(200);
  }
  throw new Error('Core-40 did not establish the live timeline within two minutes.');
}

async function waitUntilTimelineTime(targetSeconds) {
  while (true) {
    const payload = await readState();
    if (!payload.state?.session?.active) throw new Error('The live session stopped before the camera schedule completed.');
    const elapsed = Number(payload.state.session.elapsed) || 0;
    if (elapsed >= targetSeconds) return;
    await wait(Math.max(50, Math.min(250, (targetSeconds - elapsed) * 500)));
  }
}

async function waitForExport() {
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    const payload = await readState();
    if (!payload.state?.session?.active) return;
    await wait(500);
  }
  throw new Error('The MP4 export did not complete within five minutes.');
}

const initial = await readState();
if (!initial.uiConnected) throw new Error('Open Live Full Flow before recording.');
if (initial.state?.session?.active) await send('session.stop');
await send('speech.queue.clear');
await send('loops.set', { speech: false, embeddings: false, path: false });
if (Array.isArray(storyboard.path?.endpoints) && storyboard.path.endpoints.length) {
  await send('path.schedule.set', {
    endpoints: storyboard.path.endpoints,
    loop: false,
    curved: Boolean(storyboard.path.curved),
    curveStrength: storyboard.path.curveStrength ?? 0.55,
  });
} else {
  await send('path.clear');
}
await send('locomotion.stop');
if (storyboard.idlePair?.secondary) {
  await send('embedding.idle-pair.set', {
    primary: storyboard.idlePair.primary || storyboard.idleEmbedding,
    secondary: storyboard.idlePair.secondary,
    intervalSeconds: storyboard.idlePair.intervalSeconds || 12,
  });
} else {
  await send('embedding.idle.set', { selector: storyboard.idleEmbedding });
}
await send('embedding.stack.set', { selectors: storyboard.embeddingStack });
await send('speech.schedule.set', { cues: storyboard.speech, loop: false });
await send('embedding.schedule.set', { cues: storyboard.embeddings, loop: false });
await send('motion.settings.set', storyboard.motionSettings || {
  speed: 0.8,
  steeringBlend: 1,
  denoisingSteps: 4,
  constraintGuidance: 2,
  textGuidance: 3,
  historyFrames: 8,
  adaptiveReplanBuffer: true,
  replanBufferFrames: 3,
  headingEnabled: true
});
await send(storyboard.camera[0].action, storyboard.camera[0].args);
await send('export.single-pass');
console.log('Waiting for the first Core-40 horizon.');
await waitForTimeline();
console.log('RECORDING STARTED');

const liveEvents = [
  ...storyboard.camera.slice(1),
  ...(Array.isArray(storyboard.locomotion) ? storyboard.locomotion : []),
].sort((left, right) => left.time - right.time);
for (const cue of liveEvents) {
  await waitUntilTimelineTime(cue.time);
  await send(cue.action, cue.args);
}

await waitForExport();
console.log('INTRODUCTION MP4 EXPORTED');
