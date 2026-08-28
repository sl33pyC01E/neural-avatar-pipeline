import { execFileSync, spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';

const ROOT_PATH = 'C:\\Users\\forre\\Documents\\unified';
const OUTPUT = new URL('./results/', import.meta.url);
const PORTS = [8788, 8793, 8794, 8795, 8796, 8797];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (value, digits = 2) => Number(Number(value).toFixed(digits));

function gpuSnapshot() {
  const raw = execFileSync('nvidia-smi', [
    '--query-gpu=name,driver_version,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu,power.draw',
    '--format=csv,noheader,nounits',
  ], { encoding: 'utf8', windowsHide: true }).trim();
  const values = raw.split(',').map((value) => value.trim());
  return {
    name: values[0], driver: values[1], totalMiB: Number(values[2]), usedMiB: Number(values[3]),
    freeMiB: Number(values[4]), utilizationPct: Number(values[5]), temperatureC: Number(values[6]), powerW: Number(values[7]),
  };
}

function hostSnapshot() {
  const script = [
    "$os=Get-CimInstance Win32_OperatingSystem",
    "$project=(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*\\Documents\\unified*' } | ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })",
    "[pscustomobject]@{RAMUsedGiB=[math]::Round(((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory-$os.FreePhysicalMemory*1KB)/1GB,2);ProjectProcessCount=@($project).Count;ProjectWorkingSetGiB=[math]::Round((($project|Measure-Object WorkingSet64 -Sum).Sum)/1GB,3)} | ConvertTo-Json -Compress",
  ].join(';');
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true }));
}

function launcherPids() {
  const escaped = ROOT_PATH.replace(/'/g, "''");
  const script = `$all=Get-CimInstance Win32_Process; $children=$all | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*${escaped}\\webui\\server.mjs*' }; $items=foreach($child in $children){$parent=$all|Where-Object ProcessId -eq $child.ParentProcessId|Select-Object -First 1;if($parent){[pscustomobject]@{ProcessId=$parent.ProcessId;CommandLine=$parent.CommandLine;ChildCommandLine=$child.CommandLine}}}; @($items) | ConvertTo-Json -Compress`;
  const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', windowsHide: true }).trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: port === 8795 ? 'localhost' : '127.0.0.1', port });
    const done = (open) => { socket.destroy(); resolve(open); };
    socket.setTimeout(300);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

async function waitFor(predicate, timeoutMs, label, intervalMs = 100) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    if (await predicate()) return performance.now() - started;
    await sleep(intervalMs);
  }
  throw new Error(`${label} timed out after ${timeoutMs} ms.`);
}

async function statusReady(url) {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    const payload = await response.json();
    return response.ok && payload.ok && payload.ready && !payload.loading;
  } catch { return false; }
}

await mkdir(OUTPUT, { recursive: true });
const existing = launcherPids();
for (const item of existing) {
  if (!String(item.CommandLine || '').toLowerCase().includes('launcher.mjs') ||
      !String(item.ChildCommandLine || '').toLowerCase().includes(`${ROOT_PATH.toLowerCase()}\\webui\\server.mjs`)) {
    throw new Error(`Refusing to stop an unverified launcher process: ${item.ProcessId}`);
  }
  execFileSync('taskkill.exe', ['/pid', String(item.ProcessId), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
}

await waitFor(async () => (await Promise.all(PORTS.map(portOpen))).every((open) => !open), 30000, 'Service shutdown', 200);
await sleep(2500);
const stopped = { gpu: gpuSnapshot(), host: hostSnapshot() };

const startedAt = new Date().toISOString();
const started = performance.now();
const launcher = spawn(`${ROOT_PATH}\\runtime\\node\\node.exe`, [`${ROOT_PATH}\\launcher.mjs`], {
  cwd: ROOT_PATH,
  env: { ...process.env, UNIFIED_NO_BROWSER: '1' },
  windowsHide: true,
  detached: true,
  stdio: 'ignore',
});
launcher.unref();

const portsReadyMs = await waitFor(async () => (await Promise.all(PORTS.map(portOpen))).every(Boolean), 180000, 'All service ports', 100);
const ttsReadyMs = await waitFor(() => statusReady('http://127.0.0.1:8796/api/status'), 180000, 'PocketTTS readiness', 100);
const lamReadyMs = await waitFor(() => statusReady('http://127.0.0.1:8797/api/status'), 180000, 'LAM readiness', 100);
const fullyReadyMs = performance.now() - started;
await sleep(750);
const ready = { gpu: gpuSnapshot(), host: hostSnapshot() };
const ttsStatus = await (await fetch('http://127.0.0.1:8796/api/status')).json();
const lamStatus = await (await fetch('http://127.0.0.1:8797/api/status')).json();

const result = {
  schemaVersion: 1,
  timestamp: new Date().toISOString(),
  startedAt,
  launcherPid: launcher.pid,
  stoppedLauncherPids: existing.map((item) => item.ProcessId),
  ports: PORTS,
  timing: {
    allPortsReadyMs: round(portsReadyMs),
    pocketTtsReadyAfterPortsMs: round(ttsReadyMs),
    lamReadyAfterPreviousCheckMs: round(lamReadyMs),
    fullyReadyMs: round(fullyReadyMs),
    pocketTtsReportedLoadMs: ttsStatus.loadMs,
    lamReportedLoadMs: lamStatus.loadMs,
  },
  resources: { stopped, ready, startupVramDeltaMiB: ready.gpu.usedMiB - stopped.gpu.usedMiB, startupProjectRamDeltaGiB: round(ready.host.ProjectWorkingSetGiB - stopped.host.ProjectWorkingSetGiB, 3) },
};

await writeFile(new URL('LATEST_COLD_START.json', OUTPUT), JSON.stringify(result, null, 2));
await writeFile(new URL('LATEST_COLD_START.md', OUTPUT), `# Neural Avatar Pipeline cold start\n\n` +
  `Measured ${result.timestamp}. The complete portable launcher reached all six listening ports in **${result.timing.allPortsReadyMs} ms** and both resident speech/face models were ready in **${result.timing.fullyReadyMs} ms**.\n\n` +
  `- PocketTTS reported model load: ${result.timing.pocketTtsReportedLoadMs} ms.\n` +
  `- LAM reported model load: ${result.timing.lamReportedLoadMs} ms.\n` +
  `- GPU memory before launch: ${stopped.gpu.usedMiB} MiB.\n` +
  `- GPU memory after launcher readiness: ${ready.gpu.usedMiB} MiB.\n` +
  `- Project working set after launcher readiness: ${ready.host.ProjectWorkingSetGiB} GiB.\n`);
console.log(JSON.stringify({ ok: true, launcherPid: launcher.pid, result }, null, 2));
