import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const deep = process.argv.includes('--deep');
const checks = [
  ['Root Apache-2.0 license', 'LICENSE'],
  ['Project notice', 'NOTICE'],
  ['Dependency manifest', 'dependency-manifest.json'],
  ['Payload manifest', 'payload-manifest.json'],
  ['Unified launcher', 'launcher.mjs'],
  ['Unified WebUI', 'webui/index.html'],
  ['Face backend', 'face_animation/webui/backend/server.py'],
  ['LAM environment', 'face_animation/LAM-Audio2Expression/.venv/Scripts/python.exe'],
  ['LAM checkpoint', 'face_animation/LAM-Audio2Expression/pretrained_models/lam_audio2exp_streaming.tar'],
  ['ARDY server', 'retargetting/motion-control-server.js'],
  ['ARDY worker', 'motion-models/motion_worker.py'],
  ['ARDY environment', 'ardy/.venv/Scripts/python.exe'],
  ['ARDY editable install', 'ardy/.venv/Lib/site-packages/ardy-0.2.0.dist-info/METADATA'],
  ['ARDY Core-8 model', 'models/huggingface/hub/models--nvidia--ARDY-Core-RP-20FPS-Horizon8'],
  ['ARDY Core-40 model', 'models/huggingface/hub/models--nvidia--ARDY-Core-RP-20FPS-Horizon40'],
  ['ARDY text encoder', 'motion-models/models/ardy-llm2vec-4bit'],
  ['PocketTTS environment', 'voice/pocket_tts/Scripts/python.exe'],
  ['PocketTTS model', 'models/huggingface/hub/models--kyutai--pocket-tts-without-voice-cloning'],
  ['Emotion classifier', 'models/sentiment/emotion-english-distilroberta-base/model.int8.onnx'],
  ['Local VRM avatar', 'vnyan/Zome.vrm'],
  ['Spatial retargeter', 'vnyan/control-panel/spatial-retarget.js'],
  ['Python 3.10', 'runtime/python310/python.exe'],
  ['Python 3.12', 'runtime/python312/python.exe'],
  ['Node.js', 'runtime/node/node.exe'],
  ['FFmpeg', 'runtime/ffmpeg/bin/ffmpeg.exe'],
  ['CUDA runtime', 'runtime/cuda/v12.9/bin/cudart64_12.dll'],
];

const normalizePackage = (value) => value.trim().toLowerCase().replace(/[_.]+/g, '-');
const resolveLocal = (relative) => path.join(root, ...relative.split('/'));
let failures = 0;

function report(ok, label, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? '[OK]     ' : '[MISMATCH]'} ${label}${detail ? ` · ${detail}` : ''}`);
}

function readJson(relative) {
  return JSON.parse(readFileSync(resolveLocal(relative), 'utf8'));
}

function lockPackages(relative) {
  const packages = new Map();
  for (const line of readFileSync(resolveLocal(relative), 'utf8').split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean || clean.startsWith('#') || clean.startsWith('--')) continue;
    const match = clean.match(/^([^=<>!~\s]+)==(.+)$/);
    if (!match) throw new Error(`${relative} contains a non-exact requirement: ${clean}`);
    packages.set(normalizePackage(match[1]), match[2]);
  }
  return packages;
}

function installedPackages(relative) {
  const site = resolveLocal(relative);
  const packages = new Map();
  for (const entry of readdirSync(site, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.dist-info')) continue;
    const metadataPath = path.join(site, entry.name, 'METADATA');
    if (!existsSync(metadataPath)) continue;
    const metadata = readFileSync(metadataPath, 'utf8');
    const name = metadata.match(/^Name:\s*(.+)$/mi)?.[1]?.trim();
    const version = metadata.match(/^Version:\s*(.+)$/mi)?.[1]?.trim();
    if (name && version) packages.set(normalizePackage(name), version);
  }
  return packages;
}

function sha256(relative) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(resolveLocal(relative));
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

console.log(`Neural Avatar Pipeline verification\nRoot: ${root}\nMode: ${deep ? 'deep payload hashes' : 'inventory + dependency locks'}\n`);

for (const [label, relative] of checks) {
  const target = resolveLocal(relative);
  const present = existsSync(target);
  let detail = '';
  if (present && statSync(target).isFile()) {
    const mb = statSync(target).size / 1024 / 1024;
    detail = mb >= 1 ? `${mb.toFixed(1)} MB` : '';
  }
  report(present, label, detail);
}

if (existsSync(resolveLocal('dependency-manifest.json'))) {
  const manifest = readJson('dependency-manifest.json');
  console.log('\nPython dependency locks');
  for (const environment of manifest.environments || []) {
    const site = environment.path.endsWith('site-packages')
      ? environment.path
      : `${environment.path}/Lib/site-packages`;
    if (!existsSync(resolveLocal(site)) || !existsSync(resolveLocal(environment.lock))) {
      report(false, environment.id, `missing ${!existsSync(resolveLocal(site)) ? site : environment.lock}`);
      continue;
    }
    const expected = lockPackages(environment.lock);
    const installed = installedPackages(site);
    const mismatches = [...expected].filter(([name, version]) => installed.get(name) !== version);
    const detail = mismatches.length
      ? mismatches.map(([name, version]) => `${name} expected ${version}, found ${installed.get(name) || 'missing'}`).join('; ')
      : `${expected.size} exact versions`;
    report(mismatches.length === 0, environment.id, detail);
  }
}

if (existsSync(resolveLocal('payload-manifest.json'))) {
  const manifest = readJson('payload-manifest.json');
  console.log(`\nPayload manifest${deep ? ' and SHA-256 hashes' : ''}`);
  for (const artifact of manifest.artifacts || []) {
    let artifactOk = true;
    const details = [];
    for (const file of artifact.files || []) {
      const target = resolveLocal(file.path);
      if (!existsSync(target)) {
        artifactOk = false;
        details.push(`missing ${file.path}`);
        continue;
      }
      const size = statSync(target).size;
      if (size !== file.bytes) {
        artifactOk = false;
        details.push(`size mismatch ${file.path}`);
        continue;
      }
      if (deep) {
        const digest = await sha256(file.path);
        if (digest !== file.sha256) {
          artifactOk = false;
          details.push(`hash mismatch ${file.path}`);
        }
      }
    }
    report(artifactOk, artifact.id, details.length ? details.join('; ') : `${artifact.files.length} files`);
  }
}

if (!deep) console.log('\nTip: run verify.bat --deep to hash every model payload.');
console.log(failures ? `\nFAILED: ${failures} check(s) did not match.` : '\nPASS: the portable bundle matches its recorded contract.');
process.exitCode = failures ? 1 : 0;
