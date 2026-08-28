const controlUri = 'http://127.0.0.1:8788/api/control';
const runId = `quality-${Date.now()}`;
let sequence = 0;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function send(action, args = {}) {
  sequence += 1;
  const response = await fetch(controlUri, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, args, requestId: `${runId}-${sequence}` }),
  });
  if (!response.ok) throw new Error(`${action} returned HTTP ${response.status}: ${await response.text()}`);
  const result = await response.json();
  if (!result.ok) throw new Error(`${action} was rejected: ${JSON.stringify(result)}`);
  console.log(`[${new Date().toISOString()}] ${action}`);
}

async function clean() {
  await send('loops.set', { speech: false, embeddings: false, path: false });
  await send('speech.schedule.set', { cues: [], loop: false });
  await send('embedding.schedule.set', { cues: [], loop: false });
  await send('path.clear');
  await send('locomotion.stop');
  await send('embedding.release');
  await send('camera.reset');
}

try {
  await send('speech.queue.clear');
  await clean();
  await send('embedding.stack.set', {
    selectors: ['stand', 'wave hello', 'walk naturally', 'talk expressively', 'the person does a little dance'],
  });
  await send('camera.preset', { preset: 'full' });

  await send('speech.schedule.set', {
    loop: false,
    cues: [
      { time: 2, text: 'Welcome to the Neural Avatar Pipeline quality test.' },
      { time: 16, text: 'Bright blue birds bounce, whisper, pause, and speak precisely: one, two, three point five.' },
      { time: 32, text: 'Speech, facial animation, body motion, locomotion, and camera control are running together in real time.' },
    ],
  });
  await send('embedding.schedule.set', {
    loop: false,
    cues: [
      { time: 0, selector: 'stand' },
      { time: 4, selector: 'wave hello' },
      { time: 10, selector: 'walk naturally' },
      { time: 28, selector: 'talk expressively' },
      { time: 36, selector: 'the person does a little dance' },
      { time: 44, selector: 'idle' },
    ],
  });
  await send('path.schedule.set', {
    loop: false,
    endpoints: [
      { time: 12, x: 0, z: -1 },
      { time: 18, x: 1, z: -1 },
      { time: 24, x: 1, z: 0 },
      { time: 30, x: 0, z: 0 },
    ],
  });

  await wait(8000);
  await send('camera.preset', { preset: 'face' });
  await wait(10000);
  await send('camera.set', {
    target: 'torso', directionAnchor: 'torso', follow: true, orbit: false,
    distance: 2.25, yaw: 20, pitch: 76, smoothing: 5,
  });
  await wait(10000);
  await send('camera.set', {
    target: 'full', directionAnchor: 'feet', follow: true, orbit: false,
    distance: 4.15, yaw: 35, pitch: 68, smoothing: 5,
  });
  await wait(8000);
  await send('camera.set', { orbit: true, orbitSpeed: 18 });
  await wait(8000);
  await send('camera.set', { orbit: false });
  await send('camera.nudge', { yaw: -20, pitch: 4, distance: -0.25 });

  await send('locomotion.keys', { keys: ['w'], durationMs: 1500 });
  await wait(1900);
  await send('locomotion.keys', { keys: ['a'], durationMs: 1200 });
  await wait(1600);
  await send('locomotion.keys', { keys: ['d'], durationMs: 1200 });
  await wait(1600);
  await send('locomotion.stop');

  await send('embedding.schedule.set', {
    loop: true,
    cues: [
      { time: 0, selector: 'wave hello' },
      { time: 4, selector: 'idle' },
    ],
  });
  await send('loops.set', { speech: false, embeddings: true, path: false });
  await wait(10000);
  await clean();
  console.log('QUALITY TEST COMPLETE');
} catch (error) {
  console.error(error?.stack || error);
  try { await clean(); } catch {}
  process.exitCode = 1;
}
