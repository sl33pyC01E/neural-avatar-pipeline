import { readFile } from 'node:fs/promises';

const CONTROL_ROOT = 'http://127.0.0.1:8788/api/control';
const storyboard = JSON.parse(await readFile(new URL('./storyboard.json', import.meta.url), 'utf8'));
const runId = `introduction-v${storyboard.version}-${Date.now()}`;
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
    const command = payload.command;
    if (command?.status === 'completed') return command.result;
    if (command?.status === 'failed') throw new Error(command.error || `Command ${commandId} failed.`);
    await wait(100);
  }
  throw new Error(`Command ${commandId} did not finish within ${timeoutMs / 1000} seconds.`);
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
  if (!payload.uiConnected) throw new Error('Live Full Flow is not open and connected to the control API.');
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
    if (!payload.state?.session?.active) throw new Error('The live session stopped during the introduction.');
    const elapsed = Number(payload.state.session.elapsed) || 0;
    if (elapsed >= targetSeconds) return;
    await wait(Math.max(50, Math.min(250, (targetSeconds - elapsed) * 500)));
  }
}

function assertEmbeddingsAvailable(state) {
  const available = state?.embeddings?.available || [];
  const selectors = new Set(available.flatMap((entry) => [entry.key, entry.nickname, entry.text].filter(Boolean).map((value) => value.trim().toLowerCase())));
  const required = [storyboard.idleEmbedding, ...storyboard.embeddingStack]
    .filter((value, index, values) => values.indexOf(value) === index);
  const missing = required.filter((selector) => !selectors.has(selector.trim().toLowerCase()));
  if (missing.length) {
    throw new Error(`Refresh Live Full Flow so it loads the complete embedding bank. Missing: ${missing.join(' | ')}`);
  }
}

if (!process.argv.includes('--go')) {
  console.log(`Prepared: ${storyboard.title}`);
  console.log(`${storyboard.speech.length} spoken lines, ${storyboard.embeddings.length} motion cues, ${storyboard.camera.length} camera cues.`);
  console.log('Nothing was sent. Run this file with --go to begin the rehearsal.');
  process.exit(0);
}

try {
  const initial = await readState();
  if (!initial.uiConnected) throw new Error('Open Live Full Flow before starting the introduction.');
  assertEmbeddingsAvailable(initial.state);

  if (initial.state?.session?.active) await send('session.stop');
  await send('speech.queue.clear');
  await send('loops.set', { speech: false, embeddings: false, path: false });
  await send('path.clear');
  await send('locomotion.stop');
  await send('embedding.idle.set', { selector: storyboard.idleEmbedding });
  await send('embedding.stack.set', { selectors: storyboard.embeddingStack });
  await send('speech.schedule.set', { cues: storyboard.speech, loop: false });
  await send('embedding.schedule.set', { cues: storyboard.embeddings, loop: false });
  await send('motion.settings.set', {
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
  await send('session.start');
  console.log('Waiting for the first Core-40 horizon. The introduction clock has not started yet.');
  await waitForTimeline();
  console.log('INTRODUCTION STARTED');

  for (const cue of storyboard.camera.slice(1)) {
    await waitUntilTimelineTime(cue.time);
    await send(cue.action, cue.args);
  }

  await waitUntilTimelineTime(storyboard.estimatedDurationSeconds);
  console.log('INTRODUCTION REHEARSAL COMPLETE');
} catch (error) {
  console.error(error?.stack || error);
  process.exitCode = 1;
}
