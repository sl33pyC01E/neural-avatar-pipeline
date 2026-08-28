import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.dirname(root);
const unifiedRoot = path.dirname(workspace);
const pocketPython = path.join(unifiedRoot, 'voice', 'pocket_tts', 'Scripts', 'python.exe');
const lamPython = path.join(workspace, 'LAM-Audio2Expression', '.venv', 'Scripts', 'python.exe');
const backend = path.join(root, 'backend', 'server.py');
const pocketBackend = path.join(root, 'backend', 'pocket_tts_server.py');
const lamBackend = path.join(root, 'backend', 'lam_server.py');
const commandPrompt = process.env.ComSpec || 'cmd.exe';
const children = [];

function exists(file) {
  try { accessSync(file, constants.F_OK); return true; } catch { return false; }
}

function portOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.setTimeout(450); socket.once('connect', () => done(true)); socket.once('timeout', () => done(false)); socket.once('error', () => done(false));
  });
}

async function waitFor(port, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await portOpen(port, port === 8795 ? 'localhost' : '127.0.0.1')) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not become ready.`);
}

function startChild(command, args, label) {
  const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  child.on('exit', (code) => { if (code && !closing) console.error(`${label} exited with code ${code}.`); });
  children.push(child); return child;
}

let closing = false;
function close() {
  if (closing) return; closing = true;
  for (const child of children) if (!child.killed) child.kill();
  setTimeout(() => process.exit(0), 250).unref();
}
process.on('SIGINT', close); process.on('SIGTERM', close);

if (!exists(pocketPython)) throw new Error(`PocketTTS environment is missing: ${pocketPython}`);
if (!exists(lamPython)) throw new Error(`LAM A2E environment is missing: ${lamPython}`);
if (!exists(path.join(root, 'node_modules'))) {
  console.log('Preparing the Face Lab interface for first use…');
  const install = spawnSync(commandPrompt, ['/d', '/s', '/c', 'npm.cmd', 'install'], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (install.status !== 0) throw new Error('Face Lab interface setup failed.');
}

console.log('Starting Face Lab…');
if (!(await portOpen(8794))) startChild(lamPython, [backend], 'face backend');
if (!(await portOpen(8796))) startChild(pocketPython, [pocketBackend], 'Anna voice');
if (!(await portOpen(8797))) startChild(lamPython, [lamBackend], 'LAM A2E');
if (!(await portOpen(8795, 'localhost'))) startChild(commandPrompt, ['/d', '/s', '/c', 'npm.cmd', 'run', 'dev', '--', '--host', 'localhost', '--port', '8795'], 'web interface');
await Promise.all([waitFor(8794, 'Face backend', 45000), waitFor(8795, 'Web interface', 45000), waitFor(8796, 'Anna voice', 45000), waitFor(8797, 'LAM A2E', 45000)]);

const url = 'http://localhost:8795/';
console.log(`Face Lab is ready: ${url}`);
console.log('Close this window or press Ctrl+C to stop it.');
spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
setInterval(() => {}, 60_000);
