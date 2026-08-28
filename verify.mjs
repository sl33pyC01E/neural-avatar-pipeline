import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const checks = [
  ['Unified launcher', 'launcher.mjs'],
  ['Unified WebUI', 'webui/index.html'],
  ['Face backend', 'face_animation/webui/backend/server.py'],
  ['Wav2Arkit environment', 'face_animation/NyxClaw-Wav2Arkit/.venv/Scripts/python.exe'],
  ['Wav2Arkit model', 'face_animation/NyxClaw-Wav2Arkit/pretrained_models/wav2arkit/wav2arkit_cpu.onnx.data'],
  ['LAM environment', 'face_animation/LAM-Audio2Expression/.venv/Scripts/python.exe'],
  ['LAM checkpoint', 'face_animation/LAM-Audio2Expression/pretrained_models/lam_audio2exp_streaming.tar'],
  ['Audio2Face environment', 'face_animation/Audio2Face-3D-SDK/.venv/Scripts/python.exe'],
  ['Audio2Face models', 'face_animation/Audio2Face-3D'],
  ['ARDY server', 'retargetting/motion-control-server.js'],
  ['ARDY worker', 'motion-models/motion_worker.py'],
  ['ARDY environment', 'ardy/.venv/Scripts/python.exe'],
  ['ARDY Core-8 model', 'models/huggingface/hub/models--nvidia--ARDY-Core-RP-20FPS-Horizon8'],
  ['ARDY Core-40 model', 'models/huggingface/hub/models--nvidia--ARDY-Core-RP-20FPS-Horizon40'],
  ['ARDY text encoder', 'motion-models/models/ardy-llm2vec-4bit'],
  ['PocketTTS environment', 'voice/pocket_tts/Scripts/python.exe'],
  ['PocketTTS model', 'models/huggingface/hub/models--kyutai--pocket-tts-without-voice-cloning'],
  ['Zome VRM', 'vnyan/Zome.vrm'],
  ['Spatial retargeter', 'vnyan/control-panel/spatial-retarget.js'],
  ['Python 3.10', 'runtime/python310/python.exe'],
  ['Python 3.12', 'runtime/python312/python.exe'],
  ['Node.js', 'runtime/node/node.exe'],
  ['FFmpeg', 'runtime/ffmpeg/bin/ffmpeg.exe'],
  ['CUDA runtime', 'runtime/cuda/v12.9/bin/cudart64_12.dll'],
];

let failures = 0;
console.log(`Unified Character Lab verification\nRoot: ${root}\n`);
for (const [label, relative] of checks) {
  const target = path.join(root, ...relative.split('/'));
  const present = existsSync(target);
  if (!present) failures += 1;
  let detail = '';
  if (present && statSync(target).isFile()) {
    const mb = statSync(target).size / 1024 / 1024;
    detail = mb >= 1 ? ` (${mb.toFixed(1)} MB)` : '';
  }
  console.log(`${present ? '[OK]     ' : '[MISSING]'} ${label}${detail}`);
}

console.log(failures ? `\nFAILED: ${failures} required item(s) are missing.` : '\nPASS: the portable bundle is complete.');
process.exitCode = failures ? 1 : 0;
