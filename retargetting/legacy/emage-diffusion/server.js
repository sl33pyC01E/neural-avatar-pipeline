const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const { spawn } = require("node:child_process");
const dgram = require("node:dgram");

const HOST = "127.0.0.1";
const PORT = Number(process.env.RETARGETTING_PORT || 8791);
const VNYAN_VMC_HOST = process.env.VNYAN_VMC_HOST || HOST;
const VNYAN_VMC_PORT = Number(process.env.VNYAN_VMC_PORT || 33369);
const VNYAN_TARGET_VMC_HOST = process.env.RETARGET_VNYAN_VMC_HOST || process.env.VNYAN_TARGET_VMC_HOST || HOST;
const VNYAN_TARGET_VMC_PORT = Number(process.env.RETARGET_VNYAN_VMC_PORT || process.env.VNYAN_TARGET_VMC_PORT || 3333);
const VNYAN_BONE_TTL_MS = Number(process.env.VNYAN_BONE_TTL_MS || 1200);
const VNYAN_TARGET_FRAME_MS = Number(process.env.RETARGET_VNYAN_FRAME_MS || 16);
const REQUEST_BODY_LIMIT = Number(process.env.RETARGETTING_BODY_LIMIT || 32 * 1024 * 1024);
const ROOT = __dirname;
const PROJECT_ROOT = path.resolve(ROOT, "..", "..");
const RUNS_ROOT = path.join(ROOT, "runs");
const AUDIO_ROOT = path.join(RUNS_ROOT, "audio");
const MOTION_ROOT = path.join(RUNS_ROOT, "motion");
const JOINTS_ROOT = path.join(RUNS_ROOT, "joints");
const KIMODO_RUNS_ROOT = path.join(RUNS_ROOT, "kimodo");
const KIMODO_MOTION_ROOT = path.join(KIMODO_RUNS_ROOT, "motion");
const KIMODO_JOINTS_ROOT = path.join(KIMODO_RUNS_ROOT, "joints");

const FACE_ROOT = path.join(os.homedir(), "Documents", "face");
const VNYAN_PANEL_ROOT = process.env.VNYAN_PANEL_ROOT || path.join(FACE_ROOT, "vnyan", "control-panel");
const HOOMAN_ROOT = process.env.HOOMAN_ROOT || path.join(os.homedir(), "Documents", "hooman");
const EMAGE_ROOT = process.env.EMAGE_ROOT || path.join(HOOMAN_ROOT, "emage");
const EMAGE_PYTHON = process.env.EMAGE_PYTHON || path.join(EMAGE_ROOT, ".venv", "Scripts", "python.exe");
const EMAGE_BRIDGE = process.env.EMAGE_BRIDGE || path.join(EMAGE_ROOT, "emage_inference_bridge.py");
const KIMODO_ROOT = process.env.KIMODO_ROOT || path.join(HOOMAN_ROOT, "kimodo");
const KIMODO_PYTHON = process.env.KIMODO_PYTHON || path.join(KIMODO_ROOT, ".venv", "Scripts", "python.exe");
const KIMODO_SERVER = process.env.KIMODO_SERVER || path.join(KIMODO_ROOT, "kimodo_server.py");
const KIMODO_JOINT_CONVERTER = process.env.KIMODO_JOINT_CONVERTER || path.join(PROJECT_ROOT, "kimodo_csv_to_joints.py");
const KIMODO_HOST = process.env.KIMODO_HOST || HOST;
const KIMODO_PORT = Number(process.env.KIMODO_PORT || 17654);
const KIMODO_MODEL = process.env.KIMODO_MODEL || "Kimodo-SOMA-RP-v1.1";
const KOKORO_PYTHON = process.env.KOKORO_PYTHON || path.join(os.homedir(), "Documents", "voice", "Applio", "env", "python.exe");
const KOKORO_BRIDGE = process.env.KOKORO_BRIDGE || path.join(VNYAN_PANEL_ROOT, "kokoro-cuda-bridge.py");
const KOKORO_DEFAULT_VOICE = process.env.KOKORO_DEFAULT_VOICE || "bf_isabella";
const KOKORO_PRELOAD_VOICES = process.env.KOKORO_PRELOAD_VOICES || KOKORO_DEFAULT_VOICE;
const JOINT_EXTRACTOR = process.env.RETARGETTING_JOINT_EXTRACTOR || path.join(ROOT, "emage_to_joints.py");
const THREE_MODULE = path.join(PROJECT_ROOT, "node_modules", "three", "build", "three.module.js");

const KOKORO_VOICES = [
  "af_alloy", "af_aoede", "af_bella", "af_heart", "af_jessica", "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky",
  "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck", "am_santa",
  "bf_alice", "bf_emma", "bf_isabella", "bf_lily",
  "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
  "ef_dora", "em_alex", "em_santa", "ff_siwis",
  "hf_alpha", "hf_beta", "hm_omega", "hm_psi",
  "if_sara", "im_nicola",
  "jf_alpha", "jf_gongitsune", "jf_nezumi", "jf_tebukuro", "jm_kumo",
  "pf_dora", "pm_alex", "pm_santa",
  "zf_xiaobei", "zf_xiaoni", "zf_xiaoxiao", "zf_xiaoyi",
  "zm_yunjian", "zm_yunxi", "zm_yunxia", "zm_yunyang",
];

const state = {
  kokoro: { ready: false, error: "", lastAudio: null },
  emage: { ready: false, warming: false, error: "", loadSec: null, cudaDevice: "" },
  kimodo: {
    host: KIMODO_HOST,
    port: KIMODO_PORT,
    ready: false,
    starting: false,
    spawned: false,
    error: "",
    lastPingAt: 0,
    pid: null,
    logTail: "",
    quantize: process.env.KIMODO_QUANTIZE || "4bit",
    model: KIMODO_MODEL,
  },
  vnyan: {
    listening: false,
    host: VNYAN_VMC_HOST,
    port: VNYAN_VMC_PORT,
    outputHost: VNYAN_TARGET_VMC_HOST,
    outputPort: VNYAN_TARGET_VMC_PORT,
    outputPlaying: false,
    outputMode: "",
    outputFrame: 0,
    outputFrameCount: 0,
    outputLastSentAt: 0,
    outputError: "",
    error: "",
    packets: 0,
    bonePackets: 0,
    boneCount: 0,
    lastPacketAt: 0,
    source: "",
  },
  lastAudio: null,
  lastMotion: null,
  lastJoints: null,
};

let requestId = 0;
let kokoroBridge = null;
let emageBridge = null;
let kimodoProcess = null;
let vnyanReceiver = null;
let vnyanRetargetTimer = null;
let vnyanRetargetClip = null;
let vnyanRetargetFrameIndex = 0;
let vnyanRetargetFrameFloat = 0;
let vnyanRetargetPlaying = false;
let vnyanRetargetLastTickAt = 0;
const audioStore = new Map();
const motionStore = new Map();
const jointsStore = new Map();
const vnyanBones = new Map();

const vmcSender4 = dgram.createSocket("udp4");
const vmcSender6 = dgram.createSocket("udp6");
vmcSender4.on("error", (error) => {
  state.vnyan.outputError = error.message;
});
vmcSender6.on("error", (error) => {
  state.vnyan.outputError = error.message;
});

const VNYAN_BONE_ORDER = [
  "Hips", "Spine", "Chest", "UpperChest", "Neck", "Head",
  "LeftShoulder", "LeftUpperArm", "LeftLowerArm", "LeftHand",
  "RightShoulder", "RightUpperArm", "RightLowerArm", "RightHand",
  "LeftUpperLeg", "LeftLowerLeg", "LeftFoot", "LeftToes",
  "RightUpperLeg", "RightLowerLeg", "RightFoot", "RightToes",
];

const VNYAN_EDGE_NAMES = [
  ["Hips", "Spine"], ["Spine", "Chest"], ["Chest", "UpperChest"], ["UpperChest", "Neck"], ["Neck", "Head"],
  ["Chest", "Neck"],
  ["UpperChest", "LeftShoulder"], ["Chest", "LeftShoulder"], ["LeftShoulder", "LeftUpperArm"], ["LeftUpperArm", "LeftLowerArm"], ["LeftLowerArm", "LeftHand"],
  ["UpperChest", "RightShoulder"], ["Chest", "RightShoulder"], ["RightShoulder", "RightUpperArm"], ["RightUpperArm", "RightLowerArm"], ["RightLowerArm", "RightHand"],
  ["Hips", "LeftUpperLeg"], ["LeftUpperLeg", "LeftLowerLeg"], ["LeftLowerLeg", "LeftFoot"], ["LeftFoot", "LeftToes"],
  ["Hips", "RightUpperLeg"], ["RightUpperLeg", "RightLowerLeg"], ["RightLowerLeg", "RightFoot"], ["RightFoot", "RightToes"],
];

const VNYAN_LEFT_GUIDES = ["LeftShoulder", "LeftUpperArm", "LeftLowerArm", "LeftHand", "LeftUpperLeg", "LeftLowerLeg", "LeftFoot"];
const VNYAN_RIGHT_GUIDES = ["RightShoulder", "RightUpperArm", "RightLowerArm", "RightHand", "RightUpperLeg", "RightLowerLeg", "RightFoot"];
const VNYAN_CENTER_GUIDES = ["Hips", "Spine", "Chest", "UpperChest", "Neck", "Head"];

const VNYAN_PARENT_CANDIDATES = {
  Hips: [],
  Spine: ["Hips"],
  Chest: ["Spine", "Hips"],
  UpperChest: ["Chest", "Spine", "Hips"],
  Neck: ["UpperChest", "Chest", "Spine", "Hips"],
  Head: ["Neck", "UpperChest", "Chest", "Spine", "Hips"],
  LeftShoulder: ["UpperChest", "Chest", "Spine"],
  LeftUpperArm: ["LeftShoulder", "UpperChest", "Chest", "Spine"],
  LeftLowerArm: ["LeftUpperArm", "LeftShoulder"],
  LeftHand: ["LeftLowerArm", "LeftUpperArm"],
  RightShoulder: ["UpperChest", "Chest", "Spine"],
  RightUpperArm: ["RightShoulder", "UpperChest", "Chest", "Spine"],
  RightLowerArm: ["RightUpperArm", "RightShoulder"],
  RightHand: ["RightLowerArm", "RightUpperArm"],
  LeftUpperLeg: ["Hips"],
  LeftLowerLeg: ["LeftUpperLeg", "Hips"],
  LeftFoot: ["LeftLowerLeg", "LeftUpperLeg"],
  LeftToes: ["LeftFoot", "LeftLowerLeg"],
  RightUpperLeg: ["Hips"],
  RightLowerLeg: ["RightUpperLeg", "Hips"],
  RightFoot: ["RightLowerLeg", "RightUpperLeg"],
  RightToes: ["RightFoot", "RightLowerLeg"],
};

const VNYAN_RETARGET_BONE_ORDER = [
  "Hips", "Spine", "Chest", "UpperChest", "Neck", "Head",
  "LeftShoulder", "LeftUpperArm", "LeftLowerArm", "LeftHand",
  "RightShoulder", "RightUpperArm", "RightLowerArm", "RightHand",
  "LeftUpperLeg", "LeftLowerLeg", "LeftFoot",
  "RightUpperLeg", "RightLowerLeg", "RightFoot",
];

const VNYAN_DEFAULT_RETARGET_BONES = new Set([
  "Hips", "Spine", "Chest", "UpperChest", "Neck", "Head",
  "LeftShoulder", "LeftUpperArm", "LeftLowerArm", "LeftHand",
  "RightShoulder", "RightUpperArm", "RightLowerArm", "RightHand",
]);

const VNYAN_RETARGET_CHILD = {
  Hips: "Spine",
  Spine: "Chest",
  Chest: "UpperChest",
  UpperChest: "Neck",
  Neck: "Head",
  LeftUpperArm: "LeftLowerArm",
  LeftLowerArm: "LeftHand",
  RightUpperArm: "RightLowerArm",
  RightLowerArm: "RightHand",
  LeftUpperLeg: "LeftLowerLeg",
  LeftLowerLeg: "LeftFoot",
  RightUpperLeg: "RightLowerLeg",
  RightLowerLeg: "RightFoot",
};

const VNYAN_NEUTRAL_GAZE_BONES = ["LeftEye", "RightEye"];
const VNYAN_NEUTRAL_GAZE_BLENDSHAPES = [
  "LookLeft", "lookLeft", "lookleft",
  "LookRight", "lookRight", "lookright",
  "LookUp", "lookUp", "lookup",
  "LookDown", "lookDown", "lookdown",
];

function ensureDirs() {
  for (const dir of [AUDIO_ROOT, MOTION_ROOT, JOINTS_ROOT, KIMODO_RUNS_ROOT, KIMODO_MOTION_ROOT, KIMODO_JOINTS_ROOT]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > REQUEST_BODY_LIMIT) {
        req.destroy(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { ok: false, error: "Not found" });
      return;
    }
    res.writeHead(200, {
      "content-type": contentType,
      "content-length": data.length,
      "cache-control": "no-store",
    });
    res.end(data);
  });
}

function runProcess(command, args, { cwd = ROOT, timeoutMs = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
      },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Process timed out: ${path.basename(command)}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr.trim() || stdout.trim() || `Process exited with code ${code}`));
      }
    });
  });
}

function publicAudio(audio) {
  if (!audio) return null;
  return {
    id: audio.id,
    path: audio.path,
    url: audio.url,
    sampleRate: audio.sampleRate,
    duration: audio.duration,
    elapsedSec: audio.elapsedSec,
    voice: audio.voice,
  };
}

function publicMotion(motion) {
  if (!motion) return null;
  return {
    id: motion.id,
    path: motion.path,
    url: motion.url,
    audioPath: motion.audioPath,
    frames: motion.frames,
    fps: motion.fps,
    duration: motion.duration,
    elapsedSec: motion.elapsedSec,
    summary: motion.summary,
    prompt: motion.prompt,
    sourceType: motion.sourceType,
    generationTimeSec: motion.generationTimeSec,
  };
}

function publicJoints(joints) {
  if (!joints) return null;
  return {
    id: joints.id,
    path: joints.path,
    url: joints.url,
    motionPath: joints.motionPath,
    frameCount: joints.frameCount,
    fps: joints.fps,
    duration: joints.duration,
    stats: joints.stats,
    bounds: joints.bounds,
    elapsedSec: joints.elapsedSec,
    sourceType: joints.sourceType,
    jointCount: joints.jointCount,
  };
}

function bridgeRequest(bridge, payload, timeoutMs, label) {
  const id = String(++requestId);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      bridge.pending.delete(id);
      reject(new Error(`${label} timed out.`));
    }, timeoutMs);
    bridge.pending.set(id, { resolve, reject, timer });
    bridge.child.stdin.write(`${JSON.stringify({ id, ...payload })}\n`, (error) => {
      if (!error) return;
      const pending = bridge.pending.get(id);
      if (!pending) return;
      bridge.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(error);
    });
  });
}

function handleBridgeLine(bridge, line, resultKey, label) {
  try {
    const message = JSON.parse(line);
    const pending = bridge.pending.get(String(message.id));
    if (!pending) return;
    bridge.pending.delete(String(message.id));
    clearTimeout(pending.timer);
    if (message.ok) {
      pending.resolve(resultKey ? message[resultKey] : message);
    } else {
      pending.reject(new Error(message.error || `${label} failed.`));
    }
  } catch {
    // Model libraries can be noisy on stdout; pending timeouts protect callers.
  }
}

function attachBridge(child, resultKey, label, onExit) {
  const bridge = { child, pending: new Map(), stdoutBuffer: "" };
  child.stdout.on("data", (chunk) => {
    bridge.stdoutBuffer += chunk.toString("utf8");
    let newline = bridge.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = bridge.stdoutBuffer.slice(0, newline).trim();
      bridge.stdoutBuffer = bridge.stdoutBuffer.slice(newline + 1);
      if (line) handleBridgeLine(bridge, line, resultKey, label);
      newline = bridge.stdoutBuffer.indexOf("\n");
    }
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8").trim();
    if (!text) return;
    if (label === "Kokoro" && text.includes("kokoro-cuda-ready")) {
      state.kokoro.ready = true;
      state.kokoro.error = "";
    }
    if (label === "EMAGE" && text.includes("emage-cuda-ready")) {
      state.emage.ready = true;
      state.emage.warming = false;
      state.emage.error = "";
      const match = text.match(/load_sec=([0-9.]+)/);
      if (match) state.emage.loadSec = Number(match[1]);
    }
  });
  child.on("error", onExit);
  child.on("exit", (code) => onExit(new Error(`${label} bridge exited with code ${code}`)));
  return bridge;
}

function rejectBridge(bridge, error) {
  if (!bridge) return;
  for (const pending of bridge.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  bridge.pending.clear();
}

function ensureKokoroBridge() {
  if (kokoroBridge && kokoroBridge.child && !kokoroBridge.child.killed) {
    return kokoroBridge;
  }
  if (!fs.existsSync(KOKORO_PYTHON)) throw new Error(`Kokoro python not found: ${KOKORO_PYTHON}`);
  if (!fs.existsSync(KOKORO_BRIDGE)) throw new Error(`Kokoro bridge not found: ${KOKORO_BRIDGE}`);
  const child = spawn(KOKORO_PYTHON, [
    KOKORO_BRIDGE,
    "--server",
    "--device",
    "cuda",
    "--preload-voices",
    KOKORO_PRELOAD_VOICES,
  ], {
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      HF_HOME: process.env.HF_HOME || path.join(os.homedir(), "Documents", "voice", "hf_cache"),
      HF_HUB_CACHE: process.env.HF_HUB_CACHE || path.join(os.homedir(), "Documents", "voice", "hf_cache", "hub"),
      HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
    },
  });
  kokoroBridge = attachBridge(child, "audio", "Kokoro", (error) => {
    rejectBridge(kokoroBridge, error);
    kokoroBridge = null;
    state.kokoro.ready = false;
    state.kokoro.error = error.message;
  });
  return kokoroBridge;
}

function ensureEmageBridge() {
  if (emageBridge && emageBridge.child && !emageBridge.child.killed) {
    return emageBridge;
  }
  if (!fs.existsSync(EMAGE_PYTHON)) throw new Error(`EMAGE python not found: ${EMAGE_PYTHON}`);
  if (!fs.existsSync(EMAGE_BRIDGE)) throw new Error(`EMAGE bridge not found: ${EMAGE_BRIDGE}`);
  state.emage.ready = false;
  state.emage.warming = true;
  state.emage.error = "";
  const child = spawn(EMAGE_PYTHON, [EMAGE_BRIDGE, "--server"], {
    cwd: EMAGE_ROOT,
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
    },
  });
  emageBridge = attachBridge(child, "motion", "EMAGE", (error) => {
    rejectBridge(emageBridge, error);
    emageBridge = null;
    state.emage.ready = false;
    state.emage.warming = false;
    state.emage.error = error.message;
  });
  return emageBridge;
}

async function synthesizeKokoro(text, { voice = KOKORO_DEFAULT_VOICE, speed = 1 } = {}) {
  ensureDirs();
  const bridge = ensureKokoroBridge();
  const stem = `kokoro_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const outPath = path.join(AUDIO_ROOT, `${stem}.wav`);
  const audio = await bridgeRequest(bridge, {
    text: String(text || ""),
    voice: String(voice || KOKORO_DEFAULT_VOICE),
    speed: Number(speed) || 1,
    out: outPath,
  }, 180000, "Kokoro");
  const registered = {
    id: `audio_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    path: audio.path || outPath,
    url: "",
    sampleRate: Number(audio.sample_rate || 24000),
    duration: Number(audio.duration || 0),
    elapsedSec: Number(audio.elapsed_sec || 0),
    voice: voice || KOKORO_DEFAULT_VOICE,
  };
  registered.url = `/api/audio/${registered.id}`;
  audioStore.set(registered.id, registered);
  state.lastAudio = publicAudio(registered);
  state.kokoro.lastAudio = state.lastAudio;
  return registered;
}

async function runEmage(audioPath) {
  ensureDirs();
  const bridge = ensureEmageBridge();
  const motion = await bridgeRequest(bridge, {
    audio_path: audioPath,
    save_folder: MOTION_ROOT,
  }, 600000, "EMAGE");
  const registered = {
    id: `motion_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    path: motion.motion_path,
    url: "",
    audioPath: motion.audio_path || audioPath,
    frames: Number(motion.frames || 0),
    fps: Number(motion.fps || 30),
    duration: Number(motion.duration || 0),
    elapsedSec: Number(motion.elapsed_sec || 0),
    summary: motion.summary || {},
  };
  registered.url = `/api/motion/${registered.id}`;
  motionStore.set(registered.id, registered);
  state.lastMotion = publicMotion(registered);
  return registered;
}

function registerMotionPath(motionPath) {
  const resolved = path.resolve(String(motionPath || "").trim());
  if (!resolved) throw new Error("motionPath is required.");
  if (!fs.existsSync(resolved)) throw new Error(`Motion file not found: ${resolved}`);
  if (!resolved.toLowerCase().endsWith(".npz")) throw new Error("Motion file must be an .npz file.");
  for (const motion of motionStore.values()) {
    if (path.resolve(motion.path).toLowerCase() === resolved.toLowerCase()) {
      state.lastMotion = publicMotion(motion);
      return motion;
    }
  }
  const stat = fs.statSync(resolved);
  const registered = {
    id: `motion_${stat.mtimeMs.toFixed(0)}_${path.basename(resolved, ".npz").replace(/[^a-zA-Z0-9_-]/g, "_")}`,
    path: resolved,
    url: "",
    audioPath: "",
    frames: 0,
    fps: 30,
    duration: 0,
    elapsedSec: 0,
    summary: {},
  };
  registered.url = `/api/motion/${registered.id}`;
  motionStore.set(registered.id, registered);
  state.lastMotion = publicMotion(registered);
  return registered;
}

async function extractJoints(motion) {
  ensureDirs();
  if (!motion?.path || !fs.existsSync(motion.path)) {
    throw new Error("Motion file not found.");
  }
  if (!fs.existsSync(JOINT_EXTRACTOR)) throw new Error(`Joint extractor not found: ${JOINT_EXTRACTOR}`);

  const id = `joints_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const outPath = path.join(JOINTS_ROOT, `${id}.json`);
  const started = Date.now();
  await runProcess(EMAGE_PYTHON, [JOINT_EXTRACTOR, "--input", motion.path, "--output", outPath], {
    cwd: ROOT,
    timeoutMs: 240000,
  });
  const payload = JSON.parse(fs.readFileSync(outPath, "utf8"));
  const registered = {
    id,
    path: outPath,
    url: `/api/joints/${id}`,
    motionPath: motion.path,
    frameCount: Number(payload.frameCount || 0),
    fps: Number(payload.fps || 30),
    duration: Number(payload.duration || 0),
    stats: payload.stats || {},
    bounds: payload.bounds || {},
    elapsedSec: (Date.now() - started) / 1000,
    sourceType: payload.sourceType || motion.sourceType || "",
    jointCount: Array.isArray(payload.jointNames) ? payload.jointNames.length : Object.keys(payload.jointNames || {}).length,
  };
  jointsStore.set(id, registered);
  state.lastJoints = publicJoints(registered);
  return { registered, payload };
}

function updateKimodoLog(chunk) {
  const lines = `${state.kimodo.logTail || ""}${chunk}`.split(/\r?\n/);
  state.kimodo.logTail = lines.slice(-40).join("\n");
}

function kimodoRequest(payload, timeoutMs = 900000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: KIMODO_HOST, port: KIMODO_PORT });
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error("Kimodo server timed out."));
    }, timeoutMs);

    socket.on("connect", () => {
      socket.write(`${JSON.stringify(payload)}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline < 0 || settled) return;
      settled = true;
      clearTimeout(timer);
      socket.end();
      try {
        const response = JSON.parse(buffer.slice(0, newline));
        if (response.status === "ok") {
          resolve(response);
        } else {
          reject(new Error(response.error || "Kimodo request failed."));
        }
      } catch (error) {
        reject(error);
      }
    });
    socket.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    socket.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("Kimodo server closed the connection."));
    });
  });
}

function kimodoModelMatches(response) {
  const running = String(response?.model || "").toLowerCase();
  const expected = String(KIMODO_MODEL || "").toLowerCase();
  return !running || !expected || running === expected || running.includes(expected) || expected.includes(running);
}

async function pingKimodo(timeoutMs = 1500) {
  try {
    const response = await kimodoRequest({ cmd: "ping" }, timeoutMs);
    state.kimodo.ready = response.status === "ok" && kimodoModelMatches(response);
    state.kimodo.starting = false;
    state.kimodo.error = state.kimodo.ready
      ? ""
      : `Kimodo server model is ${response.model || "unknown"}; expected ${KIMODO_MODEL}.`;
    state.kimodo.lastPingAt = Date.now();
    state.kimodo.model = response.model || KIMODO_MODEL;
    return response;
  } catch (error) {
    state.kimodo.ready = false;
    state.kimodo.error = error.message;
    return null;
  }
}

function startKimodoProcess() {
  if (kimodoProcess && !kimodoProcess.killed) {
    return { started: false, alreadyStarted: true, pid: kimodoProcess.pid };
  }
  if (!fs.existsSync(KIMODO_PYTHON)) throw new Error(`Kimodo Python not found: ${KIMODO_PYTHON}`);
  if (!fs.existsSync(KIMODO_SERVER)) throw new Error(`Kimodo server not found: ${KIMODO_SERVER}`);

  state.kimodo.starting = true;
  state.kimodo.ready = false;
  state.kimodo.error = "";
  state.kimodo.logTail = "";
  state.kimodo.model = KIMODO_MODEL;
  kimodoProcess = spawn(KIMODO_PYTHON, [
    KIMODO_SERVER,
    "--host", KIMODO_HOST,
    "--port", String(KIMODO_PORT),
    "--model", KIMODO_MODEL,
  ], {
    cwd: KIMODO_ROOT,
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8",
      HF_HUB_DISABLE_SYMLINKS_WARNING: "1",
      KIMODO_QUANTIZE: process.env.KIMODO_QUANTIZE || "4bit",
    },
  });
  state.kimodo.spawned = true;
  state.kimodo.pid = kimodoProcess.pid;

  kimodoProcess.stdout.on("data", (chunk) => updateKimodoLog(chunk.toString("utf8")));
  kimodoProcess.stderr.on("data", (chunk) => updateKimodoLog(chunk.toString("utf8")));
  kimodoProcess.on("error", (error) => {
    state.kimodo.error = error.message;
    state.kimodo.starting = false;
  });
  kimodoProcess.on("exit", (code) => {
    state.kimodo.ready = false;
    state.kimodo.starting = false;
    state.kimodo.pid = null;
    state.kimodo.error = code === 0 ? "" : `Kimodo server exited with code ${code}`;
    kimodoProcess = null;
  });
  return { started: true, pid: kimodoProcess.pid };
}

async function ensureKimodoReady(timeoutMs = 900000) {
  const existing = await pingKimodo(1200);
  if (existing && state.kimodo.ready) return existing;
  if (existing && !state.kimodo.ready) throw new Error(state.kimodo.error);
  startKimodoProcess();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const response = await pingKimodo(2000);
    if (response && state.kimodo.ready) return response;
  }
  throw new Error(`Kimodo did not become ready. ${state.kimodo.error || state.kimodo.logTail || ""}`.trim());
}

function registerKimodoCsvMotion(csvPath, meta = {}) {
  const resolved = path.resolve(String(csvPath || ""));
  if (!resolved.toLowerCase().endsWith(".csv")) throw new Error("Kimodo CSV path must be a .csv file.");
  if (!fs.existsSync(resolved)) throw new Error(`Kimodo CSV not found: ${resolved}`);
  const id = `kimodo_csv_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const motion = {
    id,
    path: resolved,
    url: `/api/motion/${id}`,
    audioPath: "",
    frames: Number(meta.frames || 0),
    fps: Number(meta.fps || 30),
    duration: Number(meta.duration || 0),
    elapsedSec: Number(meta.generationTimeSec || 0),
    summary: { model: meta.model || state.kimodo.model || KIMODO_MODEL },
    prompt: meta.prompt || "",
    sourceType: "kimodo",
    generationTimeSec: Number(meta.generationTimeSec || 0),
  };
  motionStore.set(id, motion);
  state.lastMotion = publicMotion(motion);
  return motion;
}

async function extractKimodoCsvJoints(motion) {
  ensureDirs();
  if (!fs.existsSync(KIMODO_PYTHON)) throw new Error(`Kimodo Python not found: ${KIMODO_PYTHON}`);
  if (!fs.existsSync(KIMODO_JOINT_CONVERTER)) throw new Error(`Kimodo joint converter not found: ${KIMODO_JOINT_CONVERTER}`);
  const id = `kimodo_joints_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const outPath = path.join(KIMODO_JOINTS_ROOT, `${id}.json`);
  const started = Date.now();
  await runProcess(KIMODO_PYTHON, [
    KIMODO_JOINT_CONVERTER,
    "--csv", motion.path,
    "--out", outPath,
    "--fps", String(motion.fps || 30),
  ], { cwd: KIMODO_ROOT, timeoutMs: 300000 });
  const payload = JSON.parse(fs.readFileSync(outPath, "utf8"));
  payload.sourceType = payload.sourceType || "kimodo";
  const registered = {
    id,
    path: outPath,
    url: `/api/joints/${id}`,
    motionPath: motion.path,
    frameCount: Number(payload.frameCount || 0),
    jointCount: Array.isArray(payload.jointNames) ? payload.jointNames.length : Object.keys(payload.jointNames || {}).length,
    fps: Number(payload.fps || motion.fps || 30),
    duration: Number(payload.duration || 0),
    stats: payload.stats || {},
    bounds: payload.bounds || {},
    elapsedSec: (Date.now() - started) / 1000,
    sourceType: "kimodo",
  };
  jointsStore.set(id, registered);
  state.lastJoints = publicJoints(registered);
  return { registered, payload };
}

async function generateKimodoMotion(body) {
  ensureDirs();
  await ensureKimodoReady();
  const prompt = String(body.prompt || "").trim();
  if (!prompt) throw new Error("Kimodo prompt is empty.");
  const duration = Math.max(0.5, Math.min(12, Number(body.duration || 3)));
  const diffusionSteps = Math.max(10, Math.min(150, Math.round(Number(body.diffusionSteps || 50))));
  const cfgWeight = Math.max(0, Math.min(10, Number(body.cfgWeight || 2)));
  const seed = body.seed === "" || body.seed === null || body.seed === undefined ? undefined : Number(body.seed);
  const wantsCsv = String(KIMODO_MODEL).toLowerCase().includes("g1");
  const outPath = path.join(KIMODO_MOTION_ROOT, `kimodo_${Date.now()}_${Math.random().toString(16).slice(2)}.${wantsCsv ? "csv" : "npz"}`);
  const response = await kimodoRequest({
    request_id: `retarget_lab_${Date.now()}`,
    prompt,
    duration,
    diffusion_steps: diffusionSteps,
    cfg_weight: cfgWeight,
    seed,
    output_path: outPath,
  }, 900000);
  const motionPath = response.npz_path || response.motion_path || response.csv_path || outPath;
  const commonMeta = {
    prompt,
    frames: Number(response.num_frames || 0),
    fps: Number(response.fps || 30),
    duration,
    generationTimeSec: Number(response.generation_time_s || 0),
    model: response.model || state.kimodo.model || KIMODO_MODEL,
  };
  if (String(motionPath).toLowerCase().endsWith(".csv")) {
    const motion = registerKimodoCsvMotion(motionPath, commonMeta);
    const { registered, payload } = await extractKimodoCsvJoints(motion);
    return { motion, registered, payload, response };
  }
  const motion = registerMotionPath(motionPath);
  motion.prompt = prompt;
  motion.sourceType = "kimodo";
  motion.generationTimeSec = commonMeta.generationTimeSec;
  motion.frames = commonMeta.frames;
  motion.fps = commonMeta.fps;
  motion.duration = commonMeta.duration;
  motion.elapsedSec = commonMeta.generationTimeSec;
  motion.summary = { ...(motion.summary || {}), model: commonMeta.model };
  state.lastMotion = publicMotion(motion);
  const { registered, payload } = await extractJoints(motion);
  payload.sourceType = payload.sourceType || "kimodo";
  return { motion, registered, payload, response };
}

function requireStore(map, id, label) {
  const item = map.get(String(id || ""));
  if (!item) throw new Error(`${label} not found.`);
  return item;
}

function alignOscOffset(offset) {
  return (offset + 3) & ~3;
}

function readOscString(buffer, offset, end = buffer.length) {
  let cursor = offset;
  while (cursor < end && buffer[cursor] !== 0) cursor += 1;
  if (cursor >= end) throw new Error("Invalid OSC string.");
  const value = buffer.toString("utf8", offset, cursor);
  return { value, offset: alignOscOffset(cursor + 1) };
}

function parseOscPacket(buffer, offset = 0, end = buffer.length) {
  const first = readOscString(buffer, offset, end);
  if (first.value === "#bundle") {
    const messages = [];
    let cursor = first.offset + 8;
    while (cursor + 4 <= end) {
      const size = buffer.readInt32BE(cursor);
      cursor += 4;
      if (size <= 0 || cursor + size > end) break;
      messages.push(...parseOscPacket(buffer, cursor, cursor + size));
      cursor += size;
    }
    return messages;
  }

  const typeTags = readOscString(buffer, first.offset, end);
  let cursor = typeTags.offset;
  const args = [];
  for (const tag of String(typeTags.value || "").replace(/^,/, "")) {
    if (tag === "s") {
      const next = readOscString(buffer, cursor, end);
      args.push(next.value);
      cursor = next.offset;
    } else if (tag === "f") {
      if (cursor + 4 > end) throw new Error("Invalid OSC float.");
      args.push(buffer.readFloatBE(cursor));
      cursor += 4;
    } else if (tag === "i") {
      if (cursor + 4 > end) throw new Error("Invalid OSC int.");
      args.push(buffer.readInt32BE(cursor));
      cursor += 4;
    } else if (tag === "d") {
      if (cursor + 8 > end) throw new Error("Invalid OSC double.");
      args.push(buffer.readDoubleBE(cursor));
      cursor += 8;
    } else if (tag === "T") {
      args.push(true);
    } else if (tag === "F") {
      args.push(false);
    } else if (tag === "N") {
      args.push(null);
    }
  }
  return [{ address: first.value, args }];
}

function padOsc(buffer) {
  const pad = (4 - (buffer.length % 4)) % 4;
  return pad ? Buffer.concat([buffer, Buffer.alloc(pad)]) : buffer;
}

function writeOscString(value) {
  return padOsc(Buffer.from(`${value}\0`, "utf8"));
}

function writeOscMessage(address, args = []) {
  const parts = [
    writeOscString(address),
    writeOscString(`,${args.map((arg) => arg.type).join("")}`),
  ];
  for (const arg of args) {
    if (arg.type === "s") {
      parts.push(writeOscString(arg.value));
    } else if (arg.type === "f") {
      const float = Buffer.alloc(4);
      float.writeFloatBE(Number(arg.value), 0);
      parts.push(float);
    } else if (arg.type === "i") {
      const int = Buffer.alloc(4);
      int.writeInt32BE(Number(arg.value), 0);
      parts.push(int);
    } else {
      throw new Error(`Unsupported OSC arg type: ${arg.type}`);
    }
  }
  return Buffer.concat(parts);
}

function normalizeUdpHost(host) {
  return String(host || "").trim().replace(/^\[(.*)\]$/, "$1");
}

function targetVmcSocketsFor(host) {
  const normalized = normalizeUdpHost(host);
  const lower = normalized.toLowerCase();
  if (!normalized || lower === "localhost" || normalized === "127.0.0.1" || normalized === "::1") {
    return [
      { socket: vmcSender4, host: "127.0.0.1" },
      { socket: vmcSender6, host: "::1" },
    ];
  }
  if (normalized.includes(":")) {
    return [{ socket: vmcSender6, host: normalized }];
  }
  return [{ socket: vmcSender4, host: normalized }];
}

function sendTargetVmcOsc(address, args) {
  const message = writeOscMessage(address, args);
  for (const target of targetVmcSocketsFor(VNYAN_TARGET_VMC_HOST)) {
    target.socket.send(message, VNYAN_TARGET_VMC_PORT, target.host, (error) => {
      if (error) state.vnyan.outputError = error.message;
    });
  }
}

const vmcTargetStartedAt = Date.now();
let vmcTargetStatusLastSentAt = 0;

function sendTargetVmcStatus(force = false) {
  const now = Date.now();
  if (!force && now - vmcTargetStatusLastSentAt < 250) return;
  vmcTargetStatusLastSentAt = now;
  sendTargetVmcOsc("/VMC/Ext/OK", [{ type: "i", value: 1 }]);
  sendTargetVmcOsc("/VMC/Ext/T", [{ type: "f", value: (now - vmcTargetStartedAt) / 1000 }]);
}

function sendTargetVmcBoneQuat(name, quat, position = null) {
  const q = normalizeQuat(quat);
  const px = finiteNumber(position?.[0], 0);
  const py = finiteNumber(position?.[1], 0);
  const pz = finiteNumber(position?.[2], 0);
  sendTargetVmcOsc(
    "/VMC/Ext/Bone/Pos",
    [
      { type: "s", value: name },
      { type: "f", value: px },
      { type: "f", value: py },
      { type: "f", value: pz },
      { type: "f", value: q[0] },
      { type: "f", value: q[1] },
      { type: "f", value: q[2] },
      { type: "f", value: q[3] },
    ],
  );
}

function sendTargetVmcBlendshape(name, value) {
  sendTargetVmcOsc(
    "/VMC/Ext/Blend/Val",
    [
      { type: "s", value: name },
      { type: "f", value },
    ],
  );
}

function sendTargetVmcBlendApply() {
  sendTargetVmcOsc("/VMC/Ext/Blend/Apply", []);
}

function sendTargetVmcNeutralGaze() {
  for (const name of VNYAN_NEUTRAL_GAZE_BONES) {
    sendTargetVmcBoneQuat(name, [0, 0, 0, 1], [0, 0, 0]);
  }
  for (const name of VNYAN_NEUTRAL_GAZE_BLENDSHAPES) {
    sendTargetVmcBlendshape(name, 0);
  }
  sendTargetVmcBlendApply();
}

function handleVnyanOscMessage(message, rinfo) {
  state.vnyan.packets += 1;
  state.vnyan.lastPacketAt = Date.now();
  state.vnyan.source = `${rinfo.address}:${rinfo.port}`;
  state.vnyan.error = "";

  if (message.address !== "/VMC/Ext/Bone/Pos") return;
  const args = message.args || [];
  if (args.length < 8 || typeof args[0] !== "string") return;
  const name = args[0];
  const position = [Number(args[1]) || 0, Number(args[2]) || 0, Number(args[3]) || 0];
  const rotation = [Number(args[4]) || 0, Number(args[5]) || 0, Number(args[6]) || 0, Number(args[7]) || 1];
  vnyanBones.set(name, {
    name,
    position,
    rotation,
    receivedAt: state.vnyan.lastPacketAt,
  });
  state.vnyan.bonePackets += 1;
  state.vnyan.boneCount = vnyanBones.size;
}

function startVnyanReceiver() {
  if (vnyanReceiver) return;
  vnyanReceiver = dgram.createSocket("udp4");
  vnyanReceiver.on("message", (message, rinfo) => {
    try {
      for (const packet of parseOscPacket(message)) {
        handleVnyanOscMessage(packet, rinfo);
      }
    } catch (error) {
      state.vnyan.error = error.message;
    }
  });
  vnyanReceiver.on("error", (error) => {
    state.vnyan.listening = false;
    state.vnyan.error = error.message;
  });
  vnyanReceiver.bind(VNYAN_VMC_PORT, VNYAN_VMC_HOST, () => {
    state.vnyan.listening = true;
    state.vnyan.error = "";
  });
}

function remapNames(names, nameToIndex) {
  return names.filter((name) => nameToIndex.has(name)).map((name) => nameToIndex.get(name));
}

function normalizeQuat(q) {
  const x = Number(q?.[0]) || 0;
  const y = Number(q?.[1]) || 0;
  const z = Number(q?.[2]) || 0;
  const w = Number(q?.[3]) || 1;
  const length = Math.hypot(x, y, z, w) || 1;
  return [x / length, y / length, z / length, w / length];
}

function multiplyQuat(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return normalizeQuat([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]);
}

function rotateVector(q, v) {
  const [x, y, z, w] = q;
  const vx = Number(v?.[0]) || 0;
  const vy = Number(v?.[1]) || 0;
  const vz = Number(v?.[2]) || 0;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteVector(value, fallback = [0, 0, 0]) {
  if (!Array.isArray(value)) return fallback.slice();
  return [
    finiteNumber(value[0], fallback[0] || 0),
    finiteNumber(value[1], fallback[1] || 0),
    finiteNumber(value[2], fallback[2] || 0),
  ];
}

function addVec(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subVec(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function mulVec(a, scalar) {
  return [a[0] * scalar, a[1] * scalar, a[2] * scalar];
}

function dotVec(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function crossVec(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalizeVec(vector, fallback = [0, 0, 1]) {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  return length > 1e-7 ? mulVec(vector, 1 / length) : fallback.slice();
}

function inverseQuat(q) {
  const normalized = normalizeQuat(q);
  return [-normalized[0], -normalized[1], -normalized[2], normalized[3]];
}

function quatFromUnitVectors(from, to) {
  const a = normalizeVec(from);
  const b = normalizeVec(to, a);
  let r = dotVec(a, b) + 1;
  let x;
  let y;
  let z;
  if (r < 1e-6) {
    r = 0;
    if (Math.abs(a[0]) > Math.abs(a[2])) {
      x = -a[1];
      y = a[0];
      z = 0;
    } else {
      x = 0;
      y = -a[2];
      z = a[1];
    }
  } else {
    [x, y, z] = crossVec(a, b);
  }
  return normalizeQuat([x, y, z, r]);
}

function resolveNameIndex(jointNames) {
  const entries = Object.entries(jointNames || {});
  return Object.fromEntries(entries.map(([index, name]) => [String(name), Number(index)]));
}

function resolvePlaybackParent(name, nameSet) {
  for (const parent of VNYAN_PARENT_CANDIDATES[name] || []) {
    if (nameSet.has(parent)) return parent;
  }
  return "";
}

function retargetChildForBone(name, nameSet) {
  if (name === "Chest" && !nameSet.has("UpperChest")) return "Neck";
  const child = VNYAN_RETARGET_CHILD[name];
  return child && nameSet.has(child) ? child : "";
}

function interpolateFrame(a, b, amount) {
  return a.map((point, index) => {
    const start = finiteVector(point);
    const end = finiteVector(b[index], start);
    return addVec(start, mulVec(subVec(end, start), amount));
  });
}

function smoothStep(t) {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

function freshVnyanBones(now = Date.now()) {
  const fresh = new Map();
  for (const [name, bone] of vnyanBones.entries()) {
    if (now - Number(bone.receivedAt || 0) <= VNYAN_BONE_TTL_MS) {
      fresh.set(name, bone);
    }
  }
  return fresh;
}

function resolveVnyanParent(name, bones) {
  for (const parent of VNYAN_PARENT_CANDIDATES[name] || []) {
    if (bones.has(parent)) return parent;
  }
  return "";
}

function composeVnyanTransforms(bones) {
  const world = new Map();

  function compose(name) {
    if (world.has(name)) return world.get(name);
    const bone = bones.get(name);
    if (!bone) return null;
    const localPosition = [
      Number(bone.position?.[0]) || 0,
      Number(bone.position?.[1]) || 0,
      Number(bone.position?.[2]) || 0,
    ];
    const localRotation = normalizeQuat(bone.rotation);
    const parentName = resolveVnyanParent(name, bones);
    const parent = parentName ? compose(parentName) : null;
    const transform = parent
      ? {
          position: [
            parent.position[0] + rotateVector(parent.rotation, localPosition)[0],
            parent.position[1] + rotateVector(parent.rotation, localPosition)[1],
            parent.position[2] + rotateVector(parent.rotation, localPosition)[2],
          ],
          rotation: multiplyQuat(parent.rotation, localRotation),
        }
      : { position: localPosition, rotation: localRotation };
    world.set(name, transform);
    return transform;
  }

  for (const name of VNYAN_BONE_ORDER) {
    compose(name);
  }
  return world;
}

function buildVnyanPayload() {
  const now = Date.now();
  const freshBones = freshVnyanBones(now);
  const worldBones = composeVnyanTransforms(freshBones);
  const availableNames = VNYAN_BONE_ORDER.filter((name) => worldBones.has(name));
  const nameToIndex = new Map(availableNames.map((name, index) => [name, index]));
  const joints = availableNames.map((name) => worldBones.get(name).position);
  const localPositions = availableNames.map((name) => finiteVector(freshBones.get(name)?.position));
  const localRotations = availableNames.map((name) => normalizeQuat(freshBones.get(name)?.rotation));
  const worldRotations = availableNames.map((name) => normalizeQuat(worldBones.get(name)?.rotation));
  const rootIndex = nameToIndex.has("Hips") ? nameToIndex.get("Hips") : 0;
  const root = joints[rootIndex] || [0, 0, 0];
  const centered = joints.map((joint) => [
    joint[0] - root[0],
    joint[1] - root[1],
    joint[2] - root[2],
  ]);
  const edgeNames = VNYAN_EDGE_NAMES.filter(([a, b]) => nameToIndex.has(a) && nameToIndex.has(b));
  const edges = edgeNames.map(([a, b]) => [nameToIndex.get(a), nameToIndex.get(b)]);
  const guideLeft = remapNames(VNYAN_LEFT_GUIDES, nameToIndex);
  const guideRight = remapNames(VNYAN_RIGHT_GUIDES, nameToIndex);
  const guideCenter = remapNames(VNYAN_CENTER_GUIDES, nameToIndex);
  const flat = centered.length ? centered : [[0, 0, 0]];
  const min = [0, 1, 2].map((axis) => Math.min(...flat.map((point) => point[axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...flat.map((point) => point[axis])));
  const span = Math.max(...max.map((value, axis) => value - min[axis]), 0);
  const ageMs = state.vnyan.lastPacketAt ? now - state.vnyan.lastPacketAt : null;

  return {
    kind: "vnyan-live",
    source: `VNyan VMC live ${VNYAN_VMC_HOST}:${VNYAN_VMC_PORT}`,
    fps: 0,
    frameCount: 1,
    joints: [joints],
    centeredJoints: [centered],
    localPositions,
    localRotations,
    worldRotations,
    edges: { body: edges, hands: [] },
    jointNames: Object.fromEntries(availableNames.map((name, index) => [String(index), name])),
    guides: {
      left: guideLeft,
      right: guideRight,
      center: guideCenter,
      main: [...guideCenter, ...guideLeft, ...guideRight],
    },
    readoutIndices: [
      ...remapNames(["Head", "LeftHand", "RightHand", "LeftLowerArm", "RightLowerArm", "LeftFoot", "RightFoot"], nameToIndex),
    ],
    bounds: { min, max, span },
    stats: {
      boneCount: availableNames.length,
      receivedBoneCount: freshBones.size,
      totalKnownBoneCount: vnyanBones.size,
      edgeCount: edges.length,
      ageMs,
      packets: state.vnyan.packets,
      bonePackets: state.vnyan.bonePackets,
      listening: state.vnyan.listening,
      source: state.vnyan.source,
      port: VNYAN_VMC_PORT,
      ttlMs: VNYAN_BONE_TTL_MS,
      lastPacketAt: state.vnyan.lastPacketAt,
    },
  };
}

function buildFallbackWorldRotations(names, nameToIndex, localRotations) {
  const nameSet = new Set(names);
  const world = new Map();

  function compose(name) {
    if (world.has(name)) return world.get(name);
    const index = nameToIndex[name];
    const local = normalizeQuat(localRotations[index]);
    const parentName = resolvePlaybackParent(name, nameSet);
    const parentWorld = parentName ? compose(parentName) : [0, 0, 0, 1];
    const rotation = parentName ? multiplyQuat(parentWorld, local) : local;
    world.set(name, rotation);
    return rotation;
  }

  for (const name of names) {
    compose(name);
  }
  return names.map((name) => world.get(name) || [0, 0, 0, 1]);
}

function normalizePlaybackFrame(frame, expectedLength) {
  if (!Array.isArray(frame) || frame.length < 2) {
    throw new Error("Retarget frame data is missing.");
  }
  const normalized = frame.map((point) => finiteVector(point));
  while (normalized.length < expectedLength) {
    normalized.push([0, 0, 0]);
  }
  return normalized;
}

function buildVnyanRetargetClip(payload, { returnToRest = false } = {}) {
  const body = payload?.payload || payload || {};
  const jointNames = body.jointNames || {};
  const nameToIndex = resolveNameIndex(jointNames);
  const names = Object.keys(nameToIndex).sort((a, b) => nameToIndex[a] - nameToIndex[b]);
  if (!names.length) throw new Error("Retarget payload has no VNyan joint names.");

  const nameSet = new Set(names);
  const expectedLength = Math.max(...Object.values(nameToIndex)) + 1;
  const sourceFrames = Array.isArray(body.centeredJoints) ? body.centeredJoints : [];
  if (!sourceFrames.length) throw new Error("Retarget payload has no frames.");
  const frames = sourceFrames.map((frame) => normalizePlaybackFrame(frame, expectedLength));
  const restFrame = normalizePlaybackFrame(body.restCenteredJoints || body.restFrame || frames[0], expectedLength);
  const restLocalPositionsByIndex = Array.from({ length: expectedLength }, (_, index) => (
    finiteVector(body.restLocalPositions?.[index] || body.localPositions?.[index])
  ));
  const restLocalRotationsByIndex = Array.from({ length: expectedLength }, (_, index) => (
    normalizeQuat(body.restLocalRotations?.[index] || body.localRotations?.[index])
  ));
  const fallbackWorldRotations = buildFallbackWorldRotations(names, nameToIndex, restLocalRotationsByIndex);
  const restWorldRotations = names.map((name, orderIndex) => (
    normalizeQuat(body.restWorldRotations?.[nameToIndex[name]] || body.worldRotations?.[nameToIndex[name]] || fallbackWorldRotations[orderIndex])
  ));
  const restWorldByName = new Map(names.map((name, orderIndex) => [name, restWorldRotations[orderIndex]]));
  const restLocalPositionByName = new Map(names.map((name) => [name, restLocalPositionsByIndex[nameToIndex[name]]]));
  const restLocalRotationByName = new Map(names.map((name) => [name, restLocalRotationsByIndex[nameToIndex[name]]]));
  const requestedDrivenBones = Array.isArray(body.drivenBones) ? new Set(body.drivenBones.map(String)) : null;
  const fps = Math.max(1, Math.min(90, finiteNumber(body.fps, 30)));
  const returnCount = Math.max(4, Math.round(fps * 0.35));
  const playbackFrames = frames.map((frame) => frame.map((point) => point.slice()));
  if (returnToRest) {
    const lastFrame = playbackFrames[playbackFrames.length - 1] || restFrame;
    for (let i = 1; i <= returnCount; i += 1) {
      playbackFrames.push(interpolateFrame(lastFrame, restFrame, smoothStep(i / returnCount)));
    }
  }

  return {
    fps,
    frameMs: Math.max(8, Math.round(1000 / fps)),
    frames: playbackFrames,
    restFrame,
    names,
    nameSet,
    nameToIndex,
    restWorldByName,
    restLocalPositionByName,
    restLocalRotationByName,
    sendOrder: VNYAN_RETARGET_BONE_ORDER.filter((name) => (
      nameSet.has(name)
      && (requestedDrivenBones ? requestedDrivenBones.has(name) : VNYAN_DEFAULT_RETARGET_BONES.has(name))
    )),
  };
}

function sendVnyanRetargetFrame(clip, frame, frameIndex = 0) {
  sendTargetVmcStatus(true);
  sendTargetVmcNeutralGaze();
  const targetWorldByName = new Map();

  for (const name of clip.sendOrder) {
    const index = clip.nameToIndex[name];
    const restWorld = clip.restWorldByName.get(name) || [0, 0, 0, 1];
    const childName = retargetChildForBone(name, clip.nameSet);
    if (!childName) {
      targetWorldByName.set(name, restWorld);
      sendTargetVmcBoneQuat(name, clip.restLocalRotationByName.get(name) || [0, 0, 0, 1], clip.restLocalPositionByName.get(name) || [0, 0, 0]);
      continue;
    }

    const childIndex = clip.nameToIndex[childName];
    const restDirection = subVec(clip.restFrame[childIndex], clip.restFrame[index]);
    const targetDirection = subVec(frame[childIndex], frame[index]);
    const directionDelta = quatFromUnitVectors(restDirection, targetDirection);
    const targetWorld = multiplyQuat(directionDelta, restWorld);
    targetWorldByName.set(name, targetWorld);

    const parentName = resolvePlaybackParent(name, clip.nameSet);
    const parentIndex = parentName ? clip.nameToIndex[parentName] : -1;
    const parentWorld = parentName
      ? (targetWorldByName.get(parentName) || clip.restWorldByName.get(parentName) || [0, 0, 0, 1])
      : [0, 0, 0, 1];
    const localRotation = parentIndex >= 0 ? multiplyQuat(inverseQuat(parentWorld), targetWorld) : targetWorld;
    const localPosition = clip.restLocalPositionByName.get(name) || [0, 0, 0];
    sendTargetVmcBoneQuat(name, localRotation, localPosition);
  }

  state.vnyan.outputFrame = frameIndex + 1;
  state.vnyan.outputLastSentAt = Date.now();
  state.vnyan.outputError = "";
}

function clampVnyanRetargetFrameIndex(clip, frameIndex) {
  const last = Math.max(0, (clip?.frames?.length || 1) - 1);
  return Math.max(0, Math.min(last, Math.round(finiteNumber(frameIndex, 0))));
}

function sendCurrentVnyanRetargetFrame() {
  if (!vnyanRetargetClip?.frames?.length) return;
  const now = Date.now();
  let frame;
  let index;

  if (vnyanRetargetPlaying) {
    const frameCount = vnyanRetargetClip.frames.length;
    const dt = vnyanRetargetLastTickAt ? Math.max(0, Math.min(0.25, (now - vnyanRetargetLastTickAt) / 1000)) : 0;
    vnyanRetargetFrameFloat = (vnyanRetargetFrameFloat + dt * vnyanRetargetClip.fps) % frameCount;
    if (vnyanRetargetFrameFloat < 0) vnyanRetargetFrameFloat += frameCount;
    index = Math.floor(vnyanRetargetFrameFloat);
    const nextIndex = (index + 1) % frameCount;
    const amount = vnyanRetargetFrameFloat - index;
    frame = interpolateFrame(vnyanRetargetClip.frames[index], vnyanRetargetClip.frames[nextIndex], amount);
  } else {
    index = clampVnyanRetargetFrameIndex(vnyanRetargetClip, vnyanRetargetFrameIndex);
    vnyanRetargetFrameFloat = index;
    frame = vnyanRetargetClip.frames[index];
  }

  vnyanRetargetLastTickAt = now;
  vnyanRetargetFrameIndex = index;
  sendVnyanRetargetFrame(vnyanRetargetClip, frame, index);
}

function stopVnyanRetargetPlayback({ sendRest = true } = {}) {
  if (vnyanRetargetTimer) {
    clearInterval(vnyanRetargetTimer);
    vnyanRetargetTimer = null;
  }
  if (sendRest && vnyanRetargetClip?.restFrame) {
    sendVnyanRetargetFrame(vnyanRetargetClip, vnyanRetargetClip.restFrame, 0);
  }
  vnyanRetargetClip = null;
  vnyanRetargetFrameIndex = 0;
  vnyanRetargetFrameFloat = 0;
  vnyanRetargetPlaying = false;
  vnyanRetargetLastTickAt = 0;
  state.vnyan.outputPlaying = false;
  state.vnyan.outputMode = "";
  state.vnyan.outputFrame = 0;
}

function startVnyanRetargetMirror(payload, frameIndex = 0, playing = false) {
  stopVnyanRetargetPlayback({ sendRest: false });
  const clip = buildVnyanRetargetClip(payload, { returnToRest: false });
  vnyanRetargetClip = clip;
  vnyanRetargetFrameIndex = clampVnyanRetargetFrameIndex(clip, frameIndex);
  vnyanRetargetFrameFloat = vnyanRetargetFrameIndex;
  vnyanRetargetPlaying = Boolean(playing);
  vnyanRetargetLastTickAt = Date.now();
  state.vnyan.outputHost = VNYAN_TARGET_VMC_HOST;
  state.vnyan.outputPort = VNYAN_TARGET_VMC_PORT;
  state.vnyan.outputPlaying = true;
  state.vnyan.outputMode = vnyanRetargetPlaying ? "viewer-play" : "viewer-pause";
  state.vnyan.outputFrame = vnyanRetargetFrameIndex + 1;
  state.vnyan.outputFrameCount = clip.frames.length;
  state.vnyan.outputError = "";

  sendCurrentVnyanRetargetFrame();
  vnyanRetargetTimer = setInterval(sendCurrentVnyanRetargetFrame, Math.max(8, VNYAN_TARGET_FRAME_MS));

  return {
    host: VNYAN_TARGET_VMC_HOST,
    port: VNYAN_TARGET_VMC_PORT,
    fps: clip.fps,
    mode: state.vnyan.outputMode,
    playing: vnyanRetargetPlaying,
    frameIndex: vnyanRetargetFrameIndex,
    frameCount: clip.frames.length,
    drivenBones: clip.sendOrder,
  };
}

function controlVnyanRetargetMirror({ frameIndex = vnyanRetargetFrameIndex, playing = vnyanRetargetPlaying } = {}) {
  if (!vnyanRetargetClip?.frames?.length) {
    throw new Error("VNyan retarget mirror is not active.");
  }
  vnyanRetargetFrameIndex = clampVnyanRetargetFrameIndex(vnyanRetargetClip, frameIndex);
  vnyanRetargetFrameFloat = vnyanRetargetFrameIndex;
  vnyanRetargetPlaying = Boolean(playing);
  vnyanRetargetLastTickAt = Date.now();
  state.vnyan.outputMode = vnyanRetargetPlaying ? "viewer-play" : "viewer-pause";
  sendCurrentVnyanRetargetFrame();
  return {
    host: VNYAN_TARGET_VMC_HOST,
    port: VNYAN_TARGET_VMC_PORT,
    mode: state.vnyan.outputMode,
    playing: vnyanRetargetPlaying,
    frameIndex: vnyanRetargetFrameIndex,
    frameCount: vnyanRetargetClip.frames.length,
    drivenBones: vnyanRetargetClip.sendOrder,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      sendFile(res, path.join(ROOT, "index.html"), "text/html; charset=utf-8");
      return;
    }

    if (req.method === "GET" && (url.pathname === "/motion" || url.pathname === "/motion-control.html")) {
      sendFile(res, path.join(PROJECT_ROOT, "motion-control.html"), "text/html; charset=utf-8");
      return;
    }

    if (req.method === "GET" && url.pathname === "/vendor/three.module.js") {
      sendFile(res, THREE_MODULE, "text/javascript; charset=utf-8");
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      if (!state.kimodo.ready) {
        await pingKimodo(state.kimodo.starting ? 500 : 120);
      }
      sendJson(res, 200, { ok: true, state });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/vnyan/live") {
      sendJson(res, 200, { ok: true, vnyan: state.vnyan, payload: buildVnyanPayload(), state });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/vnyan/play-retarget") {
      const body = JSON.parse(await readRequestBody(req) || "{}");
      const output = startVnyanRetargetMirror(body, body.frameIndex, body.playing);
      sendJson(res, 200, { ok: true, output, state });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/vnyan/frame-retarget") {
      const body = JSON.parse(await readRequestBody(req) || "{}");
      const output = controlVnyanRetargetMirror({ frameIndex: body.frameIndex, playing: body.playing });
      sendJson(res, 200, { ok: true, output, state });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/vnyan/control-retarget") {
      const body = JSON.parse(await readRequestBody(req) || "{}");
      const output = controlVnyanRetargetMirror({ frameIndex: body.frameIndex, playing: body.playing });
      sendJson(res, 200, { ok: true, output, state });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/vnyan/stop-retarget") {
      stopVnyanRetargetPlayback({ sendRest: true });
      sendJson(res, 200, { ok: true, output: { host: VNYAN_TARGET_VMC_HOST, port: VNYAN_TARGET_VMC_PORT }, state });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/voices") {
      sendJson(res, 200, {
        ok: true,
        defaultVoice: KOKORO_DEFAULT_VOICE,
        voices: KOKORO_VOICES.map((voice) => ({ label: voice, value: voice })),
      });
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/audio/")) {
      const audio = requireStore(audioStore, decodeURIComponent(url.pathname.slice("/api/audio/".length)), "Audio");
      sendFile(res, audio.path, "audio/wav");
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/motion/")) {
      const motion = requireStore(motionStore, decodeURIComponent(url.pathname.slice("/api/motion/".length)), "Motion");
      sendFile(res, motion.path, "application/octet-stream");
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/joints/")) {
      const joints = requireStore(jointsStore, decodeURIComponent(url.pathname.slice("/api/joints/".length)), "Joint data");
      sendFile(res, joints.path, "application/json; charset=utf-8");
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/preload") {
      ensureKokoroBridge();
      ensureEmageBridge();
      sendJson(res, 200, { ok: true, state });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/kimodo/ping") {
      const response = await pingKimodo(2500);
      sendJson(res, 200, { ok: true, kimodoOnline: Boolean(response && state.kimodo.ready), response, state });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/kimodo/start") {
      const existing = await pingKimodo(1200);
      if (!existing) {
        startKimodoProcess();
      }
      sendJson(res, 200, { ok: true, state });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/tts") {
      const body = JSON.parse(await readRequestBody(req) || "{}");
      const text = String(body.text || "").trim();
      if (!text) throw new Error("Text is empty.");
      const audio = await synthesizeKokoro(text, {
        voice: String(body.voice || KOKORO_DEFAULT_VOICE),
        speed: Number(body.speed || 1),
      });
      sendJson(res, 200, { ok: true, audio: publicAudio(audio), state });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/emage") {
      const body = JSON.parse(await readRequestBody(req) || "{}");
      const audio = body.audioId ? requireStore(audioStore, body.audioId, "Audio") : null;
      const audioPath = audio?.path || String(body.audioPath || "").trim();
      if (!audioPath) throw new Error("audioId or audioPath is required.");
      const motion = await runEmage(audioPath);
      sendJson(res, 200, { ok: true, motion: publicMotion(motion), state });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/joints") {
      const body = JSON.parse(await readRequestBody(req) || "{}");
      const motion = body.motionId
        ? requireStore(motionStore, body.motionId, "Motion")
        : registerMotionPath(body.motionPath);
      const { registered, payload } = await extractJoints(motion);
      sendJson(res, 200, { ok: true, motion: publicMotion(motion), joints: publicJoints(registered), payload, state });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/kimodo/generate") {
      const body = JSON.parse(await readRequestBody(req) || "{}");
      const { motion, registered, payload, response } = await generateKimodoMotion(body);
      sendJson(res, 200, {
        ok: true,
        motion: publicMotion(motion),
        joints: publicJoints(registered),
        payload,
        kimodo: response,
        state,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/generate") {
      const body = JSON.parse(await readRequestBody(req) || "{}");
      const text = String(body.text || "").trim();
      if (!text) throw new Error("Text is empty.");
      const audio = await synthesizeKokoro(text, {
        voice: String(body.voice || KOKORO_DEFAULT_VOICE),
        speed: Number(body.speed || 1),
      });
      const motion = await runEmage(audio.path);
      const { registered, payload } = await extractJoints(motion);
      sendJson(res, 200, {
        ok: true,
        audio: publicAudio(audio),
        motion: publicMotion(motion),
        joints: publicJoints(registered),
        payload,
        state,
      });
      return;
    }

    sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message, state });
  }
});

ensureDirs();
startVnyanReceiver();
server.listen(PORT, HOST, () => {
  console.log(`Retargetting Lab: http://${HOST}:${PORT}`);
  try {
    ensureKokoroBridge();
    console.log(`Kokoro CUDA bridge warming with ${KOKORO_PRELOAD_VOICES}`);
  } catch (error) {
    console.error(`Kokoro warmup failed: ${error.message}`);
  }
});
