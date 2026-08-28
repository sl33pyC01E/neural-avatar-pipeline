const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const net = require("node:net");
const dgram = require("node:dgram");
const { spawn } = require("node:child_process");

const HOST = "127.0.0.1";
const PORT = Number(process.env.KIMODO_LAB_PORT || 8792);
const REQUEST_BODY_LIMIT = Number(process.env.KIMODO_LAB_BODY_LIMIT || 32 * 1024 * 1024);

const ROOT = __dirname;
const RUNS_ROOT = path.join(ROOT, "runs");
const KIMODO_RUNS_ROOT = path.join(RUNS_ROOT, "kimodo");
const KIMODO_MOTION_ROOT = path.join(KIMODO_RUNS_ROOT, "motion");
const KIMODO_JOINTS_ROOT = path.join(KIMODO_RUNS_ROOT, "joints");
const THREE_MODULE = path.join(ROOT, "node_modules", "three", "build", "three.module.js");
const JOINT_CONVERTER = path.join(ROOT, "kimodo_csv_to_joints.py");

const HOOMAN_ROOT = process.env.HOOMAN_ROOT || path.join(os.homedir(), "Documents", "hooman");
const KIMODO_ROOT = process.env.KIMODO_ROOT || path.join(HOOMAN_ROOT, "kimodo");
const KIMODO_PYTHON = process.env.KIMODO_PYTHON || path.join(KIMODO_ROOT, ".venv", "Scripts", "python.exe");
const KIMODO_SERVER = process.env.KIMODO_SERVER || path.join(KIMODO_ROOT, "kimodo_server.py");
const KIMODO_HOST = process.env.KIMODO_HOST || HOST;
const KIMODO_PORT = Number(process.env.KIMODO_PORT || 17654);
const VNYAN_TARGET_VMC_HOST = process.env.KIMODO_VNYAN_VMC_HOST || process.env.RETARGET_VNYAN_VMC_HOST || process.env.VNYAN_TARGET_VMC_HOST || HOST;
const VNYAN_TARGET_VMC_PORT = Number(process.env.KIMODO_VNYAN_VMC_PORT || process.env.RETARGET_VNYAN_VMC_PORT || process.env.VNYAN_TARGET_VMC_PORT || 3333);
const VNYAN_TARGET_FRAME_MS = Number(process.env.KIMODO_VNYAN_FRAME_MS || process.env.RETARGET_VNYAN_FRAME_MS || 16);

const state = {
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
  },
  vnyan: {
    outputHost: VNYAN_TARGET_VMC_HOST,
    outputPort: VNYAN_TARGET_VMC_PORT,
    outputActive: false,
    outputPlaying: false,
    outputMode: "",
    outputFrame: 0,
    outputFrameCount: 0,
    outputDrivenBones: 0,
    outputLastSentAt: 0,
    outputError: "",
  },
  lastMotion: null,
  lastJoints: null,
};

let kimodoProcess = null;
let requestCounter = 0;
let lastPayload = null;
let vnyanMirrorTimer = null;
let vnyanMirrorClip = null;
let vnyanMirrorFrameIndex = 0;
let vnyanMirrorFrameFloat = 0;
let vnyanMirrorPlaying = false;
let vnyanMirrorLoop = true;
let vnyanMirrorSpeed = 1;
let vnyanMirrorLastTickAt = 0;
const motionStore = new Map();
const jointsStore = new Map();
const vmcSender4 = dgram.createSocket("udp4");
const vmcSender6 = dgram.createSocket("udp6");

vmcSender4.on("error", (error) => {
  state.vnyan.outputError = error.message;
});
vmcSender6.on("error", (error) => {
  state.vnyan.outputError = error.message;
});

const KIMODO_TO_VNYAN_BONES = [
  { target: "LeftUpperArm", source: "left_shoulder_yaw_skel", child: "left_elbow_skel" },
  { target: "LeftLowerArm", source: "left_elbow_skel", child: "left_wrist_yaw_skel" },
  { target: "LeftHand", source: "left_wrist_yaw_skel", child: "left_hand_roll_skel" },
  { target: "RightUpperArm", source: "right_shoulder_yaw_skel", child: "right_elbow_skel" },
  { target: "RightLowerArm", source: "right_elbow_skel", child: "right_wrist_yaw_skel" },
  { target: "RightHand", source: "right_wrist_yaw_skel", child: "right_hand_roll_skel" },
  { target: "LeftUpperLeg", source: "left_hip_yaw_skel", child: "left_knee_skel" },
  { target: "LeftLowerLeg", source: "left_knee_skel", child: "left_ankle_roll_skel" },
  { target: "LeftFoot", source: "left_ankle_roll_skel", child: "left_toe_base" },
  { target: "RightUpperLeg", source: "right_hip_yaw_skel", child: "right_knee_skel" },
  { target: "RightLowerLeg", source: "right_knee_skel", child: "right_ankle_roll_skel" },
  { target: "RightFoot", source: "right_ankle_roll_skel", child: "right_toe_base" },
];

const VNYAN_PARENT_CANDIDATES = {
  LeftUpperArm: ["LeftShoulder", "UpperChest", "Chest", "Spine", "Hips"],
  LeftLowerArm: ["LeftUpperArm"],
  LeftHand: ["LeftLowerArm"],
  RightUpperArm: ["RightShoulder", "UpperChest", "Chest", "Spine", "Hips"],
  RightLowerArm: ["RightUpperArm"],
  RightHand: ["RightLowerArm"],
  LeftUpperLeg: ["Hips"],
  LeftLowerLeg: ["LeftUpperLeg"],
  LeftFoot: ["LeftLowerLeg"],
  RightUpperLeg: ["Hips"],
  RightLowerLeg: ["RightUpperLeg"],
  RightFoot: ["RightLowerLeg"],
};

const VNYAN_NEUTRAL_GAZE_BONES = ["LeftEye", "RightEye"];
const VNYAN_NEUTRAL_GAZE_BLENDSHAPES = [
  "LookLeft", "lookLeft", "lookleft",
  "LookRight", "lookRight", "lookright",
  "LookUp", "lookUp", "lookup",
  "LookDown", "lookDown", "lookdown",
];

function ensureDirs() {
  for (const dir of [RUNS_ROOT, KIMODO_RUNS_ROOT, KIMODO_MOTION_ROOT, KIMODO_JOINTS_ROOT]) {
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
  fs.readFile(filePath, (error, data) => {
    if (error) {
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

function normalizeQuat(q) {
  const x = Number(q?.[0]) || 0;
  const y = Number(q?.[1]) || 0;
  const z = Number(q?.[2]) || 0;
  const w = Number(q?.[3]) || 1;
  const length = Math.hypot(x, y, z, w) || 1;
  return [x / length, y / length, z / length, w / length];
}

function multiplyQuat(a, b) {
  const [ax, ay, az, aw] = normalizeQuat(a);
  const [bx, by, bz, bw] = normalizeQuat(b);
  return normalizeQuat([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]);
}

function inverseQuat(q) {
  const normalized = normalizeQuat(q);
  return [-normalized[0], -normalized[1], -normalized[2], normalized[3]];
}

function subVec(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function addVec(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
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
  const finite = finiteVector(vector, fallback);
  const length = Math.hypot(finite[0], finite[1], finite[2]);
  return length > 1e-7 ? mulVec(finite, 1 / length) : fallback.slice();
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

function interpolateFrame(a, b, amount) {
  return a.map((point, index) => {
    const start = finiteVector(point);
    const end = finiteVector(b?.[index], start);
    return addVec(start, mulVec(subVec(end, start), amount));
  });
}

function sendTargetVmcBoneQuat(name, quat, position = [0, 0, 0]) {
  const q = normalizeQuat(quat);
  const p = finiteVector(position);
  sendTargetVmcOsc(
    "/VMC/Ext/Bone/Pos",
    [
      { type: "s", value: name },
      { type: "f", value: p[0] },
      { type: "f", value: p[1] },
      { type: "f", value: p[2] },
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

function resolveJointNameIndex(jointNames) {
  const map = new Map();
  if (Array.isArray(jointNames)) {
    jointNames.forEach((name, index) => map.set(String(name), index));
    return map;
  }
  for (const [index, name] of Object.entries(jointNames || {})) {
    map.set(String(name), Number(index));
  }
  return map;
}

function normalizePlaybackFrame(frame, expectedLength) {
  if (!Array.isArray(frame) || frame.length < 2) {
    throw new Error("Kimodo frame data is missing.");
  }
  const normalized = frame.map((point) => finiteVector(point));
  while (normalized.length < expectedLength) {
    normalized.push([0, 0, 0]);
  }
  return normalized;
}

function resolveVnyanPlaybackParent(name, drivenNames) {
  for (const parent of VNYAN_PARENT_CANDIDATES[name] || []) {
    if (drivenNames.has(parent)) return parent;
  }
  return "";
}

function buildKimodoVnyanClip(payload) {
  const body = payload?.payload || payload || lastPayload || {};
  const nameToIndex = resolveJointNameIndex(body.jointNames);
  if (!nameToIndex.size) throw new Error("Kimodo payload has no joint names.");
  const expectedLength = Math.max(...nameToIndex.values()) + 1;
  const sourceFrames = Array.isArray(body.centeredJoints) && body.centeredJoints.length
    ? body.centeredJoints
    : body.joints;
  if (!Array.isArray(sourceFrames) || !sourceFrames.length) {
    throw new Error("Kimodo payload has no frames.");
  }

  const frames = sourceFrames.map((frame) => normalizePlaybackFrame(frame, expectedLength));
  const bones = KIMODO_TO_VNYAN_BONES
    .map((bone) => ({
      ...bone,
      sourceIndex: nameToIndex.get(bone.source),
      childIndex: nameToIndex.get(bone.child),
    }))
    .filter((bone) => Number.isInteger(bone.sourceIndex) && Number.isInteger(bone.childIndex));
  if (!bones.length) {
    throw new Error("No Kimodo joints matched the VNyan bone map.");
  }

  const drivenNames = new Set(bones.map((bone) => bone.target));
  for (const bone of bones) {
    bone.parent = resolveVnyanPlaybackParent(bone.target, drivenNames);
  }

  return {
    fps: Math.max(1, Math.min(90, finiteNumber(body.fps || body.stats?.fps, 30))),
    frames,
    frameCount: frames.length,
    restFrame: frames[0],
    bones,
  };
}

function sendKimodoVnyanFrame(clip, frame, frameIndex = 0) {
  sendTargetVmcStatus(true);
  sendTargetVmcNeutralGaze();
  const targetWorldByName = new Map();

  for (const bone of clip.bones) {
    const restParent = finiteVector(clip.restFrame[bone.sourceIndex]);
    const restChild = finiteVector(clip.restFrame[bone.childIndex]);
    const targetParent = finiteVector(frame[bone.sourceIndex]);
    const targetChild = finiteVector(frame[bone.childIndex]);
    const restDirection = subVec(restChild, restParent);
    const targetDirection = subVec(targetChild, targetParent);
    const directionDelta = quatFromUnitVectors(restDirection, targetDirection);
    targetWorldByName.set(bone.target, directionDelta);
    const parentWorld = bone.parent
      ? (targetWorldByName.get(bone.parent) || [0, 0, 0, 1])
      : [0, 0, 0, 1];
    const localRotation = bone.parent ? multiplyQuat(inverseQuat(parentWorld), directionDelta) : directionDelta;
    sendTargetVmcBoneQuat(bone.target, localRotation, [0, 0, 0]);
  }

  state.vnyan.outputFrame = frameIndex + 1;
  state.vnyan.outputFrameCount = clip.frameCount;
  state.vnyan.outputDrivenBones = clip.bones.length;
  state.vnyan.outputLastSentAt = Date.now();
  state.vnyan.outputError = "";
}

function clampVnyanFrameIndex(clip, frameIndex) {
  const last = Math.max(0, (clip?.frames?.length || 1) - 1);
  return Math.max(0, Math.min(last, Math.round(finiteNumber(frameIndex, 0))));
}

function sendCurrentKimodoVnyanFrame() {
  if (!vnyanMirrorClip?.frames?.length) return;
  const now = Date.now();
  let index;
  let frame;

  if (vnyanMirrorPlaying) {
    const frameCount = vnyanMirrorClip.frames.length;
    const dt = vnyanMirrorLastTickAt ? Math.max(0, Math.min(0.25, (now - vnyanMirrorLastTickAt) / 1000)) : 0;
    vnyanMirrorFrameFloat += dt * vnyanMirrorClip.fps * vnyanMirrorSpeed;
    if (vnyanMirrorLoop) {
      vnyanMirrorFrameFloat %= frameCount;
      if (vnyanMirrorFrameFloat < 0) vnyanMirrorFrameFloat += frameCount;
    } else if (vnyanMirrorFrameFloat >= frameCount - 1) {
      vnyanMirrorFrameFloat = frameCount - 1;
      vnyanMirrorPlaying = false;
    }
    index = Math.floor(vnyanMirrorFrameFloat);
    const nextIndex = vnyanMirrorLoop ? (index + 1) % frameCount : Math.min(frameCount - 1, index + 1);
    const amount = Math.max(0, Math.min(1, vnyanMirrorFrameFloat - index));
    frame = interpolateFrame(vnyanMirrorClip.frames[index], vnyanMirrorClip.frames[nextIndex], amount);
  } else {
    index = clampVnyanFrameIndex(vnyanMirrorClip, vnyanMirrorFrameIndex);
    vnyanMirrorFrameFloat = index;
    frame = vnyanMirrorClip.frames[index];
  }

  vnyanMirrorLastTickAt = now;
  vnyanMirrorFrameIndex = index;
  state.vnyan.outputPlaying = vnyanMirrorPlaying;
  state.vnyan.outputMode = vnyanMirrorPlaying ? "play" : "pause";
  sendKimodoVnyanFrame(vnyanMirrorClip, frame, index);
}

function stopKimodoVnyanPlayback({ sendRest = true } = {}) {
  if (vnyanMirrorTimer) {
    clearInterval(vnyanMirrorTimer);
    vnyanMirrorTimer = null;
  }
  if (sendRest && vnyanMirrorClip?.restFrame) {
    sendKimodoVnyanFrame(vnyanMirrorClip, vnyanMirrorClip.restFrame, 0);
  } else {
    sendTargetVmcStatus(true);
    sendTargetVmcNeutralGaze();
  }
  vnyanMirrorClip = null;
  vnyanMirrorFrameIndex = 0;
  vnyanMirrorFrameFloat = 0;
  vnyanMirrorPlaying = false;
  vnyanMirrorLoop = true;
  vnyanMirrorSpeed = 1;
  vnyanMirrorLastTickAt = 0;
  state.vnyan.outputActive = false;
  state.vnyan.outputPlaying = false;
  state.vnyan.outputMode = "";
  state.vnyan.outputFrame = 0;
}

function startKimodoVnyanPlayback(payload, options = {}) {
  stopKimodoVnyanPlayback({ sendRest: false });
  const clip = buildKimodoVnyanClip(payload || lastPayload);
  vnyanMirrorClip = clip;
  vnyanMirrorFrameIndex = clampVnyanFrameIndex(clip, options.frameIndex);
  vnyanMirrorFrameFloat = vnyanMirrorFrameIndex;
  vnyanMirrorPlaying = Boolean(options.playing);
  vnyanMirrorLoop = options.loop !== false;
  vnyanMirrorSpeed = Math.max(0.05, Math.min(4, finiteNumber(options.speed, 1)));
  vnyanMirrorLastTickAt = Date.now();

  state.vnyan.outputHost = VNYAN_TARGET_VMC_HOST;
  state.vnyan.outputPort = VNYAN_TARGET_VMC_PORT;
  state.vnyan.outputActive = true;
  state.vnyan.outputPlaying = vnyanMirrorPlaying;
  state.vnyan.outputMode = vnyanMirrorPlaying ? "play" : "pause";
  state.vnyan.outputFrame = vnyanMirrorFrameIndex + 1;
  state.vnyan.outputFrameCount = clip.frameCount;
  state.vnyan.outputDrivenBones = clip.bones.length;
  state.vnyan.outputError = "";

  sendCurrentKimodoVnyanFrame();
  vnyanMirrorTimer = setInterval(sendCurrentKimodoVnyanFrame, Math.max(8, VNYAN_TARGET_FRAME_MS));
  return publicVnyanOutput();
}

function controlKimodoVnyanPlayback(options = {}) {
  if (!vnyanMirrorClip?.frames?.length) {
    return startKimodoVnyanPlayback(lastPayload, options);
  }
  vnyanMirrorFrameIndex = clampVnyanFrameIndex(vnyanMirrorClip, options.frameIndex);
  vnyanMirrorFrameFloat = vnyanMirrorFrameIndex;
  vnyanMirrorPlaying = Boolean(options.playing);
  if (options.loop !== undefined) vnyanMirrorLoop = options.loop !== false;
  if (options.speed !== undefined) {
    vnyanMirrorSpeed = Math.max(0.05, Math.min(4, finiteNumber(options.speed, vnyanMirrorSpeed)));
  }
  vnyanMirrorLastTickAt = Date.now();
  state.vnyan.outputActive = true;
  state.vnyan.outputPlaying = vnyanMirrorPlaying;
  state.vnyan.outputMode = vnyanMirrorPlaying ? "play" : "pause";
  sendCurrentKimodoVnyanFrame();
  return publicVnyanOutput();
}

function publicVnyanOutput() {
  return {
    host: VNYAN_TARGET_VMC_HOST,
    port: VNYAN_TARGET_VMC_PORT,
    active: state.vnyan.outputActive,
    playing: state.vnyan.outputPlaying,
    mode: state.vnyan.outputMode,
    frameIndex: Math.max(0, state.vnyan.outputFrame - 1),
    frameCount: state.vnyan.outputFrameCount,
    drivenBones: vnyanMirrorClip?.bones?.map((bone) => bone.target) || [],
    lastSentAt: state.vnyan.outputLastSentAt,
    error: state.vnyan.outputError,
  };
}

function runProcess(command, args, { cwd = ROOT, timeoutMs = 300000 } = {}) {
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function updateKimodoLog(chunk) {
  const lines = `${state.kimodo.logTail || ""}${chunk}`.split(/\r?\n/);
  state.kimodo.logTail = lines.slice(-40).join("\n");
}

function kimodoRequest(payload, timeoutMs = 600000) {
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

async function pingKimodo(timeoutMs = 2000) {
  try {
    const response = await kimodoRequest({ cmd: "ping" }, timeoutMs);
    state.kimodo.ready = response.status === "ok";
    if (state.kimodo.ready) {
      state.kimodo.starting = false;
    }
    state.kimodo.error = "";
    state.kimodo.lastPingAt = Date.now();
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
  if (!fs.existsSync(KIMODO_PYTHON)) {
    throw new Error(`Kimodo Python not found: ${KIMODO_PYTHON}`);
  }
  if (!fs.existsSync(KIMODO_SERVER)) {
    throw new Error(`Kimodo server not found: ${KIMODO_SERVER}`);
  }

  state.kimodo.starting = true;
  state.kimodo.error = "";
  state.kimodo.logTail = "";
  kimodoProcess = spawn(KIMODO_PYTHON, [KIMODO_SERVER, "--host", KIMODO_HOST, "--port", String(KIMODO_PORT)], {
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
  const existing = await pingKimodo(1500);
  if (existing) {
    state.kimodo.starting = false;
    return existing;
  }
  startKimodoProcess();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(2500);
    const response = await pingKimodo(2000);
    if (response) {
      state.kimodo.starting = false;
      return response;
    }
  }
  throw new Error(`Kimodo did not become ready. ${state.kimodo.error || state.kimodo.logTail || ""}`.trim());
}

function makeId(prefix) {
  requestCounter += 1;
  return `${prefix}_${Date.now()}_${requestCounter}_${Math.random().toString(16).slice(2, 8)}`;
}

function publicMotion(motion) {
  if (!motion) return null;
  return {
    id: motion.id,
    path: motion.path,
    url: `/api/motion/${encodeURIComponent(motion.id)}`,
    fps: motion.fps,
    prompt: motion.prompt,
    duration: motion.duration,
    generationTimeSec: motion.generationTimeSec,
  };
}

function publicJoints(joints) {
  if (!joints) return null;
  return {
    id: joints.id,
    path: joints.path,
    url: `/api/joints/${encodeURIComponent(joints.id)}`,
    frameCount: joints.frameCount,
    jointCount: joints.jointCount,
    fps: joints.fps,
  };
}

function requireStore(store, id, label) {
  const item = store.get(id);
  if (!item) throw new Error(`${label} not found: ${id}`);
  return item;
}

function registerMotionPath(csvPath, meta = {}) {
  const resolved = path.resolve(String(csvPath || ""));
  if (!resolved.toLowerCase().endsWith(".csv")) {
    throw new Error("Kimodo motion path must be a CSV.");
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`CSV does not exist: ${resolved}`);
  }
  const id = makeId("kimodo_motion");
  const motion = {
    id,
    path: resolved,
    fps: Number(meta.fps || 30),
    prompt: meta.prompt || "",
    duration: meta.duration || null,
    generationTimeSec: meta.generationTimeSec || null,
  };
  motionStore.set(id, motion);
  state.lastMotion = publicMotion(motion);
  return motion;
}

async function convertKimodoCsv(motion) {
  const jointsPath = path.join(KIMODO_JOINTS_ROOT, `${path.basename(motion.path, ".csv")}_joints.json`);
  await runProcess(KIMODO_PYTHON, [
    JOINT_CONVERTER,
    "--csv",
    motion.path,
    "--out",
    jointsPath,
    "--fps",
    String(motion.fps || 30),
  ], { cwd: KIMODO_ROOT, timeoutMs: 300000 });
  const payload = JSON.parse(fs.readFileSync(jointsPath, "utf8"));
  const id = makeId("kimodo_joints");
  const joints = {
    id,
    path: jointsPath,
    frameCount: Number(payload.frameCount || payload.stats?.frames || 0),
    jointCount: Number(payload.jointNames?.length || payload.stats?.joints || 0),
    fps: Number(payload.fps || motion.fps || 30),
  };
  jointsStore.set(id, joints);
  state.lastJoints = publicJoints(joints);
  return { joints, payload };
}

async function generateKimodoMotion(body) {
  ensureDirs();
  await ensureKimodoReady();
  const prompt = String(body.prompt || "A person gives a small conversational gesture.").trim();
  const duration = Math.max(0.5, Math.min(12, Number(body.duration || 3)));
  const diffusionSteps = Math.max(10, Math.min(150, Math.round(Number(body.diffusionSteps || 50))));
  const cfgWeight = Math.max(0, Math.min(10, Number(body.cfgWeight || 2)));
  const seed = body.seed === "" || body.seed === null || body.seed === undefined ? undefined : Number(body.seed);
  const outPath = path.join(KIMODO_MOTION_ROOT, `kimodo_${Date.now()}_${Math.random().toString(16).slice(2)}.csv`);
  const response = await kimodoRequest({
    request_id: `kimodo_lab_${Date.now()}`,
    prompt,
    duration,
    diffusion_steps: diffusionSteps,
    cfg_weight: cfgWeight,
    seed,
    output_path: outPath,
  }, 900000);
  return registerMotionPath(response.csv_path || outPath, {
    fps: Number(response.fps || 30),
    prompt,
    duration,
    generationTimeSec: response.generation_time_s,
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/kimodo-lab.html")) {
      sendFile(res, path.join(ROOT, "kimodo-lab.html"), "text/html; charset=utf-8");
      return;
    }

    if (req.method === "GET" && url.pathname === "/vendor/three.module.js") {
      sendFile(res, THREE_MODULE, "text/javascript; charset=utf-8");
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      if (!state.kimodo.ready) {
        await pingKimodo(300);
      }
      sendJson(res, 200, { ok: true, state });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/kimodo/ping") {
      const response = await pingKimodo(2500);
      sendJson(res, 200, { ok: true, kimodoOnline: Boolean(response), response, state });
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

    if (req.method === "POST" && url.pathname === "/api/generate") {
      const body = JSON.parse(await readRequestBody(req) || "{}");
      const motion = await generateKimodoMotion(body);
      const { joints, payload } = await convertKimodoCsv(motion);
      lastPayload = payload;
      sendJson(res, 200, {
        ok: true,
        motion: publicMotion(motion),
        joints: publicJoints(joints),
        payload,
        state,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/load") {
      const body = JSON.parse(await readRequestBody(req) || "{}");
      const motion = registerMotionPath(body.csvPath, { fps: Number(body.fps || 30), prompt: "Loaded CSV" });
      const { joints, payload } = await convertKimodoCsv(motion);
      lastPayload = payload;
      sendJson(res, 200, {
        ok: true,
        motion: publicMotion(motion),
        joints: publicJoints(joints),
        payload,
        state,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/vnyan/play") {
      const body = JSON.parse(await readRequestBody(req) || "{}");
      const output = startKimodoVnyanPlayback(body.payload || lastPayload, {
        frameIndex: body.frameIndex,
        playing: body.playing,
        loop: body.loop,
        speed: body.speed,
      });
      sendJson(res, 200, { ok: true, output, state });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/vnyan/control") {
      const body = JSON.parse(await readRequestBody(req) || "{}");
      const output = controlKimodoVnyanPlayback({
        frameIndex: body.frameIndex,
        playing: body.playing,
        loop: body.loop,
        speed: body.speed,
      });
      sendJson(res, 200, { ok: true, output, state });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/vnyan/stop") {
      const body = JSON.parse(await readRequestBody(req) || "{}");
      stopKimodoVnyanPlayback({ sendRest: body.sendRest !== false });
      sendJson(res, 200, { ok: true, output: publicVnyanOutput(), state });
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/motion/")) {
      const motion = requireStore(motionStore, decodeURIComponent(url.pathname.slice("/api/motion/".length)), "Motion");
      sendFile(res, motion.path, "text/csv; charset=utf-8");
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/joints/")) {
      const joints = requireStore(jointsStore, decodeURIComponent(url.pathname.slice("/api/joints/".length)), "Joint data");
      sendFile(res, joints.path, "application/json; charset=utf-8");
      return;
    }

    sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error.message, state });
  }
});

ensureDirs();
server.on("error", (error) => {
  console.error(`Kimodo Lab server failed: ${error.message}`);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  console.log(`Kimodo 3D Lab: http://${HOST}:${PORT}`);
  console.log(`Kimodo service target: ${KIMODO_HOST}:${KIMODO_PORT}`);
});
