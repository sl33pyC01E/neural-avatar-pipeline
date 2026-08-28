const controlUri = 'http://127.0.0.1:8788/api/control';
const runId = `quality-v2-${Date.now()}`;
let sequence = 0;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function send(action, args = {}) {
  sequence += 1;
  const response = await fetch(controlUri, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, args, requestId: `${runId}-${sequence}` }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(`${action}: ${result.error || response.status}`);
  console.log(`[${new Date().toISOString()}] ${action}`);
}

async function clean() {
  await send('loops.set', { speech: false, embeddings: false, path: false });
  await send('speech.schedule.set', { cues: [], loop: false });
  await send('embedding.schedule.set', { cues: [], loop: false });
  await send('path.clear');
  await send('locomotion.stop');
  await send('embedding.release');
  await send('camera.cut', { target: 'torso', directionAnchor: 'torso', follow: true, orbit: false, distance: 2.25, yaw: 20, pitch: 76 });
}

try {
  await send('speech.queue.clear');
  await clean();

  await send('speech.schedule.set', {
    loop: false,
    cues: [
      { time: 2, text: 'Beginning the second live quality pass.' },
      { time: 24, text: 'This shot should cut immediately, while the next shot should revolve smoothly.' },
      { time: 44, text: 'The walking route should remain continuous while its loop runs independently.' },
    ],
  });
  await send('embedding.schedule.set', {
    loop: false,
    cues: [
      { time: 0, selector: 'walk naturally' },
      { time: 22, selector: 'talk expressively' },
      { time: 38, selector: 'wave hello' },
      { time: 50, selector: 'idle' },
    ],
  });
  await send('path.schedule.set', {
    loop: true,
    endpoints: [
      { time: 0, x: 0, z: 0 },
      { time: 6, x: 0, z: -1 },
      { time: 12, x: 1, z: -1 },
      { time: 18, x: 1, z: 0 },
    ],
  });
  await send('loops.set', { speech: false, embeddings: false, path: true });
  await send('camera.cut', { target: 'full', directionAnchor: 'feet', follow: true, orbit: false, distance: 4.15, yaw: 35, pitch: 68 });

  await wait(8000);
  await send('camera.move', { target: 'face', directionAnchor: 'face', follow: true, orbit: false, distance: 1.25, yaw: 0, pitch: 82, transitionSeconds: 3 });
  await wait(8000);
  await send('camera.move', { target: 'torso', directionAnchor: 'torso', follow: true, orbit: false, distance: 2.4, yaw: -30, pitch: 76, transitionSeconds: 4 });
  await wait(8000);
  await send('camera.cut', { target: 'face', directionAnchor: 'face', follow: true, orbit: false, distance: 1.15, yaw: 12, pitch: 84 });
  await wait(6000);
  await send('camera.move', { target: 'full', directionAnchor: 'feet', follow: true, orbit: false, distance: 4.5, yaw: 55, pitch: 70, transitionSeconds: 5 });
  await wait(10000);
  await send('camera.move', { target: 'full', directionAnchor: 'feet', follow: true, orbit: true, orbitSpeed: 14, distance: 4.2, yaw: -20, pitch: 66, transitionSeconds: 3 });
  await wait(10000);
  await send('camera.move', { target: 'torso', directionAnchor: 'torso', follow: true, orbit: false, distance: 2.25, yaw: 20, pitch: 76, transitionSeconds: 3 });
  await wait(6000);

  await clean();
  console.log('QUALITY TEST V2 COMPLETE');
} catch (error) {
  console.error(error?.stack || error);
  try { await clean(); } catch {}
  process.exitCode = 1;
}
