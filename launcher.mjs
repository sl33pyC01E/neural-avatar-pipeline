import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.join(root, 'runtime');
const python310 = path.join(runtime, 'python310');
const python312 = path.join(runtime, 'python312');
const node = path.join(runtime, 'node', 'node.exe');
const npmCli = path.join(runtime, 'node', 'node_modules', 'npm', 'bin', 'npm-cli.js');
const ffmpegBin = path.join(runtime, 'ffmpeg', 'bin');
const cudaBin = path.join(runtime, 'cuda', 'v12.9', 'bin');
const logsRoot = path.join(root, 'logs');
const outputsRoot = path.join(root, 'motion-models', 'outputs', 'webui');
const lanBindHost = '0.0.0.0';

const ports = [
  [8788, 'Unified WebUI'],
  [8793, 'ARDY Motion Lab'],
  [8794, 'Face backend'],
  [8795, 'Face Animation Lab'],
  [8796, 'PocketTTS'],
  [8797, 'LAM Audio2Expression'],
];

const children = [];
let closing = false;
let requestedExitCode = 0;

function required(file, label) {
  if (!existsSync(file)) throw new Error(`${label} is missing: ${file}`);
}

function configureVenv(relativePath, base, version, includeSystem, prompt = '') {
  const venv = path.join(root, relativePath);
  const cfg = path.join(venv, 'pyvenv.cfg');
  required(path.join(venv, 'Scripts', 'python.exe'), `${relativePath} Python environment`);
  const lines = [
    `home = ${base}`,
    `include-system-site-packages = ${includeSystem ? 'true' : 'false'}`,
    `version = ${version}`,
    `executable = ${path.join(base, 'python.exe')}`,
    `command = ${path.join(base, 'python.exe')} -m venv ${includeSystem ? '--system-site-packages ' : ''}${venv}`,
  ];
  if (prompt) lines.push(`prompt = ${prompt}`);
  writeFileSync(cfg, `${lines.join('\r\n')}\r\n`, 'utf8');
}

function portOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(500);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitFor(port, label, timeoutMs = 180_000) {
  const host = port === 8795 ? 'localhost' : '127.0.0.1';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen(port, host)) return;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`${label} did not bind to port ${port} within ${Math.round(timeoutMs / 1000)} seconds.`);
}

function startChild(label, command, args, cwd, environment) {
  const child = spawn(command, args, {
    cwd,
    env: environment,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = createWriteStream(path.join(logsRoot, `${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.log`), { flags: 'w' });
  const relay = (stream, output) => stream.on('data', (chunk) => {
    output.write(`[${label}] ${chunk}`);
    log.write(chunk);
  });
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);
  child.on('error', (error) => console.error(`[${label}] ${error.message}`));
  child.on('exit', (code) => {
    log.end();
    if (!closing) {
      console.error(`[${label}] exited unexpectedly${code == null ? '' : ` with code ${code}`}. Stopping the remaining lab services.`);
      stopChildren(code || 1);
    }
  });
  children.push({ label, child });
  return child;
}

function killChildTrees() {
  for (const { child } of [...children].reverse()) {
    if (!child.pid || child.exitCode !== null) continue;
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
  }
}

function stopChildren(exitCode = 0) {
  if (closing) return;
  closing = true;
  requestedExitCode = exitCode;
  console.log('\nStopping Unified Lab…');
  killChildTrees();
  process.exit(requestedExitCode);
}

process.on('SIGINT', stopChildren);
process.on('SIGTERM', stopChildren);
process.on('SIGHUP', stopChildren);
process.on('SIGBREAK', stopChildren);
process.on('uncaughtException', (error) => { console.error(error); stopChildren(1); });
process.on('unhandledRejection', (error) => { console.error(error); stopChildren(1); });
process.on('exit', () => { if (!closing) killChildTrees(); });

required(node, 'Bundled Node.js');
required(npmCli, 'Bundled npm');
required(path.join(ffmpegBin, 'ffmpeg.exe'), 'Bundled FFmpeg');
required(path.join(cudaBin, 'cudart64_12.dll'), 'Bundled CUDA 12.9 runtime');
required(path.join(root, 'dependency-manifest.json'), 'Dependency manifest');
required(path.join(root, 'payload-manifest.json'), 'Payload manifest');
required(path.join(root, 'vnyan', 'Zome.vrm'), 'Local VRM avatar');
required(path.join(root, 'models', 'huggingface', 'hub', 'models--nvidia--ARDY-Core-RP-20FPS-Horizon8'), 'ARDY Core-8 model');
required(path.join(root, 'models', 'huggingface', 'hub', 'models--nvidia--ARDY-Core-RP-20FPS-Horizon40'), 'ARDY Core-40 model');
required(path.join(root, 'models', 'huggingface', 'hub', 'models--kyutai--pocket-tts-without-voice-cloning'), 'PocketTTS model');

mkdirSync(logsRoot, { recursive: true });
mkdirSync(outputsRoot, { recursive: true });

configureVenv(path.join('face_animation', 'LAM-Audio2Expression', '.venv'), python310, '3.10.11', false);
configureVenv(path.join('ardy', '.venv'), python312, '3.12.10', true);
configureVenv(path.join('voice', 'pocket_tts'), python312, '3.12.10', true, 'pocket-tts');

for (const [port, label] of ports) {
  const host = port === 8795 ? 'localhost' : '127.0.0.1';
  if (await portOpen(port, host)) throw new Error(`${label} cannot start because port ${port} is already in use. Close the other lab and run launch.bat again.`);
}

const localPath = [
  ffmpegBin,
  cudaBin,
  path.join(runtime, 'node'),
  python312,
  path.join(python312, 'Scripts'),
  python310,
  path.join(python310, 'Scripts'),
  process.env.PATH || '',
].join(path.delimiter);

const environment = {
  ...process.env,
  PATH: localPath,
  CUDA_PATH: path.join(runtime, 'cuda', 'v12.9'),
  CUDA_HOME: path.join(runtime, 'cuda', 'v12.9'),
  HF_HOME: path.join(root, 'models', 'huggingface'),
  HF_HUB_CACHE: path.join(root, 'models', 'huggingface', 'hub'),
  HUGGINGFACE_HUB_CACHE: path.join(root, 'models', 'huggingface', 'hub'),
  HUGGINGFACE_CACHE_DIR: path.join(root, 'models', 'huggingface', 'hub'),
  HF_HUB_OFFLINE: '1',
  TRANSFORMERS_OFFLINE: '1',
  PYTHONNOUSERSITE: '1',
  PYTHONPATH: [root, path.join(root, 'ardy'), path.join(root, 'ardy', 'MotionCorrection', 'python')].join(path.delimiter),
  UNIFIED_LAUNCHER_PID: String(process.pid),
  FACE_LAB_TTS_DEVICE: 'cpu',
  UNIFIED_LAB_ROOT: root,
  UNIFIED_CUDA_BIN: cudaBin,
  UNIFIED_EFFICIENCY_MODE: process.env.UNIFIED_EFFICIENCY_MODE === '1' ? '1' : '0',
  UNIFIED_EXPERIMENTAL_ARDY_COMPILE: process.env.UNIFIED_EXPERIMENTAL_ARDY_COMPILE === '1' ? '1' : '0',
  UNIFIED_WEBUI_HOST: lanBindHost,
  MOTION_CONTROL_HOST: lanBindHost,
  FACE_LAB_HOST: lanBindHost,
};

const faceWeb = path.join(root, 'face_animation', 'webui');
const pocketPython = path.join(root, 'voice', 'pocket_tts', 'Scripts', 'python.exe');
const lamPython = path.join(root, 'face_animation', 'LAM-Audio2Expression', '.venv', 'Scripts', 'python.exe');

console.log(`Unified Lab root: ${root}`);
console.log(`Runtime profile: ${environment.UNIFIED_EFFICIENCY_MODE === '1' ? 'Efficiency Mode' : 'Quality baseline'}`);
console.log('Starting local services…');

startChild('Unified WebUI', node, [path.join(root, 'webui', 'server.mjs')], root, environment);
startChild('ARDY Motion Lab', node, [path.join(root, 'retargetting', 'motion-control-server.js')], path.join(root, 'retargetting'), environment);
startChild('Face backend', lamPython, [path.join(faceWeb, 'backend', 'server.py')], faceWeb, environment);
startChild('PocketTTS', pocketPython, [path.join(faceWeb, 'backend', 'pocket_tts_server.py')], faceWeb, environment);
startChild('LAM Audio2Expression', lamPython, [path.join(faceWeb, 'backend', 'lam_server.py')], faceWeb, environment);
startChild('Face Animation Lab', node, [npmCli, 'run', 'dev', '--', '--host', lanBindHost, '--port', '8795'], faceWeb, environment);

await Promise.all(ports.map(([port, label]) => waitFor(port, label)));

const url = 'http://127.0.0.1:8788/';
console.log(`\nUnified Lab is ready: ${url}`);
const lanInterfaces = Object.entries(os.networkInterfaces()).flatMap(([name, addresses]) =>
  (addresses || [])
    .filter((address) => address.family === 'IPv4' && !address.internal && !address.address.startsWith('169.254.') && !/^vEthernet/i.test(name))
    .map((address) => ({ name, address: address.address })),
);
for (const entry of lanInterfaces) console.log(`LAN WebUI (${entry.name}): http://${entry.address}:8788/`);
if (lanInterfaces.length) console.log('If another device cannot connect, run enable-lan-access.bat once as administrator.');
console.log('Close this window or press Ctrl+C to stop every service.');
if (process.env.UNIFIED_NO_BROWSER !== '1') {
  spawn('cmd.exe', ['/d', '/s', '/c', 'start', '', url], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
}
setInterval(() => {}, 60_000);
