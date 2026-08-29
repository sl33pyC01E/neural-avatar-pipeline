const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const spatialRetarget = require("../vnyan/control-panel/spatial-retarget");

const HOST = process.env.MOTION_CONTROL_HOST || "127.0.0.1";
const PORT = Number(process.env.MOTION_CONTROL_PORT || 8793);
const EFFICIENCY_MODE = process.env.UNIFIED_EFFICIENCY_MODE === "1";
const ROOT = __dirname;
const FACE_ROOT = path.resolve(ROOT, "..");
const WORKER = path.join(FACE_ROOT, "motion-models", "motion_worker.py");
const GENERATED_ROOT = path.join(FACE_ROOT, "motion-models", "outputs", "webui");
const ASSET_ROOT = path.join(ROOT, "motion-assets");
const VRM_ROOT = path.join(FACE_ROOT, "vnyan");
const THREE_MODULE = path.join(ROOT, "node_modules", "three", "build", "three.module.js");
const THREE_GLTF_LOADER = path.join(ROOT, "node_modules", "three", "examples", "jsm", "loaders", "GLTFLoader.js");
const THREE_BUFFER_GEOMETRY_UTILS = path.join(ROOT, "node_modules", "three", "examples", "jsm", "utils", "BufferGeometryUtils.js");
const THREE_VRM_MODULE = path.join(ROOT, "node_modules", "@pixiv", "three-vrm", "lib", "three-vrm.module.js");
const ARDY_PYTHON = path.join(FACE_ROOT, "ardy", ".venv", "Scripts", "python.exe");
const ENGINES = {
  ardy: {
    python: ARDY_PYTHON,
    workerEngine: "ardy",
    env: { ARDY_MODEL: "core8", TEXT_ENCODER_RESIDENCY: "resident" },
    port: 18731,
    process: null,
    log: "",
  },
  ardyLive: {
    python: ARDY_PYTHON,
    workerEngine: "ardy",
    env: { ARDY_MODEL: "core40", TEXT_ENCODER_RESIDENCY: "ephemeral" },
    port: 18733,
    process: null,
    log: "",
  },
  kimodo: {
    python: path.join(FACE_ROOT, "kimodo", ".venv", "Scripts", "python.exe"),
    workerEngine: "kimodo",
    port: 18732,
    process: null,
    log: "",
  },
};

const ARDY_JOINT_ALIASES = {
  Hips: "pelvis", Spine: "spine1", Spine1: "spine2", Spine2: "spine2_mid", Spine3: "spine3", Neck: "neck", Head: "head",
  RightShoulder: "right_collar", RightArm: "right_shoulder", RightForeArm: "right_elbow", RightHand: "right_wrist",
  LeftShoulder: "left_collar", LeftArm: "left_shoulder", LeftForeArm: "left_elbow", LeftHand: "left_wrist",
  RightUpLeg: "right_hip", RightLeg: "right_knee", RightFoot: "right_ankle", RightToeBase: "right_toe",
  LeftUpLeg: "left_hip", LeftLeg: "left_knee", LeftFoot: "left_ankle", LeftToeBase: "left_toe",
};

function avatarFiles() {
  return fs.readdirSync(VRM_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".vrm"))
    .map((entry) => {
      const file = path.join(VRM_ROOT, entry.name);
      const payload = spatialRetarget.buildVrmPayloadFromFile(file);
      return { file: entry.name, name: payload.stats.avatarName, vrmVersion: payload.stats.vrmVersion, boneCount: payload.stats.boneCount };
    })
    .sort((a, b) => (a.file === "Zome.vrm" ? -1 : b.file === "Zome.vrm" ? 1 : a.name.localeCompare(b.name)));
}

function resolveAvatarFile(name) {
  const base = path.basename(String(name || "Zome.vrm"));
  const file = path.resolve(VRM_ROOT, base);
  if (path.dirname(file) !== path.resolve(VRM_ROOT) || !file.toLowerCase().endsWith(".vrm") || !fs.existsSync(file)) {
    throw new Error("Selected VRM is not available.");
  }
  return file;
}

function ardyBindPayload() {
  const asset = JSON.parse(fs.readFileSync(path.join(ASSET_ROOT, "ardy.mesh.json"), "utf8"));
  return {
    sourceType: "ardy",
    source: "ARDY Core-27 official bind pose",
    fps: 20,
    centeredJoints: [asset.restJoints],
    restCenteredJoints: asset.restJoints,
    jointNames: Object.fromEntries(asset.jointNames.map((name, index) => [String(index), ARDY_JOINT_ALIASES[name] || name])),
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  });
  res.end(body);
}

function sendFile(res, file, contentType, cacheControl = "no-store") {
  const data = fs.readFileSync(file);
  res.writeHead(200, { "content-type": contentType, "content-length": data.length, "cache-control": cacheControl });
  res.end(data);
}

function sendDownload(res, file) {
  const data = fs.readFileSync(file);
  res.writeHead(200, {
    "content-type": "application/octet-stream",
    "content-length": data.length,
    "content-disposition": `attachment; filename="${path.basename(file)}"`,
    "cache-control": "no-store",
  });
  res.end(data);
}

function requireEngine(engine) {
  if (!["ardy", "kimodo"].includes(engine)) throw new Error(`Unknown engine: ${engine}`);
  return engine;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; if (body.length > 4 * 1024 * 1024) reject(new Error("Request too large")); });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function requestWorker(engine, method, pathname, body, timeoutMs = 180000) {
  const target = ENGINES[engine];
  return new Promise((resolve, reject) => {
    const data = body == null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({ host: HOST, port: target.port, method, path: pathname, timeout: timeoutMs, headers: data ? { "content-type": "application/json", "content-length": data.length } : {} }, (res) => {
      let text = "";
      res.setEncoding("utf8"); res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => { try { resolve(JSON.parse(text)); } catch { reject(new Error(text || `Worker returned ${res.statusCode}`)); } });
    });
    req.on("timeout", () => req.destroy(new Error(`${engine} timed out`)));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function proxyWorkerBinary(engine, pathname, res, timeoutMs = 30000) {
  const target = ENGINES[engine];
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port: target.port, method: "GET", path: pathname, timeout: timeoutMs }, (upstream) => {
      const headers = {
        "content-type": upstream.headers["content-type"] || "application/octet-stream",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      };
      if (upstream.headers["content-length"]) headers["content-length"] = upstream.headers["content-length"];
      res.writeHead(upstream.statusCode || 502, headers);
      upstream.pipe(res);
      upstream.on("end", resolve);
      upstream.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`${engine} mesh segment timed out`)));
    req.on("error", reject);
    req.end();
  });
}

async function workerHealth(engine) {
  try { return await requestWorker(engine, "GET", "/health", null, 800); } catch { return null; }
}

async function ensureWorker(engine) {
  const target = ENGINES[engine];
  if (!target) throw new Error(`Unknown worker: ${engine}`);
  const existing = await workerHealth(engine);
  if (existing?.ok && Number(existing.ownerPid) === process.pid) return existing;
  if (existing?.ok) {
    await requestWorker(engine, "POST", "/shutdown", {}, 3000).catch(() => null);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && await workerHealth(engine)) await new Promise((resolve) => setTimeout(resolve, 100));
    if (await workerHealth(engine)) throw new Error(`${engine} has a stale GPU worker on port ${target.port} that could not be released.`);
  }
  if (!fs.existsSync(target.python)) throw new Error(`${engine} environment is missing.`);
  if (!target.process || target.process.exitCode != null) {
    target.log = "";
    target.process = spawn(
      target.python,
      [WORKER, "--engine", target.workerEngine, "--port", String(target.port)],
      { cwd: path.dirname(WORKER), windowsHide: true, env: { ...process.env, UNIFIED_PARENT_PID: String(process.pid), ...(target.env || {}) } },
    );
    for (const stream of [target.process.stdout, target.process.stderr]) stream.on("data", (chunk) => { target.log = (target.log + chunk.toString()).slice(-6000); });
  }
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const state = await workerHealth(engine);
    if (state?.ok) return state;
    if (target.process.exitCode != null) throw new Error(target.log.trim() || `${engine} worker exited.`);
  }
  throw new Error(`${engine} worker did not become ready.`);
}

async function statePayload() {
  const entries = await Promise.all(["ardy", "kimodo"].map(async (engine) => [engine, await workerHealth(engine)]));
  return Object.fromEntries(entries);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "GET, POST, OPTIONS",
      });
      res.end(); return;
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/motion-control.html")) {
      const file = path.join(ROOT, "motion-control.html");
      const data = fs.readFileSync(file);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": data.length, "cache-control": "no-store" }); res.end(data); return;
    }
    if (req.method === "GET" && url.pathname === "/api/runtime-profile") {
      sendJson(res, 200, { ok: true, efficiencyMode: EFFICIENCY_MODE }); return;
    }
    if (req.method === "GET" && url.pathname === "/vendor/three.module.js") {
      sendFile(res, THREE_MODULE, "text/javascript; charset=utf-8", "public, max-age=86400"); return;
    }
    if (req.method === "GET" && url.pathname === "/vendor/GLTFLoader.js") {
      sendFile(res, THREE_GLTF_LOADER, "text/javascript; charset=utf-8", "public, max-age=86400"); return;
    }
    if (req.method === "GET" && url.pathname === "/utils/BufferGeometryUtils.js") {
      sendFile(res, THREE_BUFFER_GEOMETRY_UTILS, "text/javascript; charset=utf-8", "public, max-age=86400"); return;
    }
    if (req.method === "GET" && url.pathname === "/vendor/three-vrm.module.js") {
      sendFile(res, THREE_VRM_MODULE, "text/javascript; charset=utf-8", "public, max-age=86400"); return;
    }
    if (req.method === "GET" && url.pathname === "/motion-control.js") {
      sendFile(res, path.join(ROOT, "motion-control.js"), "text/javascript; charset=utf-8"); return;
    }
    if (req.method === "GET" && url.pathname === "/api/avatar/list") {
      sendJson(res, 200, { ok: true, avatars: avatarFiles(), defaultAvatar: "Zome.vrm" }); return;
    }
    if (req.method === "GET" && /^\/avatars\/[^/]+\.vrm$/i.test(url.pathname)) {
      sendFile(res, resolveAvatarFile(decodeURIComponent(path.basename(url.pathname))), "model/gltf-binary", "no-store"); return;
    }
    if (req.method === "POST" && url.pathname === "/api/avatar/alignment") {
      const body = JSON.parse(await readBody(req) || "{}");
      const target = spatialRetarget.buildVrmPayloadFromFile(resolveAvatarFile(body.avatar));
      const aligned = spatialRetarget.retargetSpatialPayload(ardyBindPayload(), target, {
        legMode: "unlocked", strength: 1, neutralLoop: false, sleeveBarrier: false,
      });
      sendJson(res, 200, {
        ok: true,
        alignment: {
          avatar: target.stats.avatarName,
          file: path.basename(target.stats.file),
          vrmVersion: target.stats.vrmVersion,
          mappedJoints: aligned.stats.mappedJoints,
          drivenBones: aligned.stats.drivenBones,
          scale: aligned.stats.medianBoneScale,
          hipsHeightM: target.stats.hipsHeightM,
          floorOffsetM: target.stats.floorY,
          sourceRest: aligned.stats.sourceRestKind,
          targetRest: aligned.stats.targetRestKind,
        },
      }); return;
    }
    if (req.method === "GET" && /^\/motion-assets\/(ardy|kimodo)\.mesh\.(json)$/.test(url.pathname)) {
      const file = path.join(ASSET_ROOT, path.basename(url.pathname)); sendFile(res, file, "application/json; charset=utf-8"); return;
    }
    if (req.method === "GET" && /^\/motion-assets\/(ardy|kimodo)\.meshbin$/.test(url.pathname)) {
      const file = path.join(ASSET_ROOT, path.basename(url.pathname)); sendFile(res, file, "application/octet-stream", "public, max-age=86400"); return;
    }
    if (req.method === "GET" && /^\/generated\/[a-z0-9-]+\.meshframes$/i.test(url.pathname)) {
      const file = path.resolve(GENERATED_ROOT, path.basename(url.pathname));
      if (path.dirname(file) !== path.resolve(GENERATED_ROOT) || !fs.existsSync(file)) throw new Error("Generated mesh not found.");
      sendFile(res, file, "application/octet-stream"); return;
    }
    if (req.method === "GET" && /^\/live-mesh\/[a-z0-9-]+\.meshframes$/i.test(url.pathname)) {
      const name = path.basename(url.pathname);
      const state = await workerHealth("ardyLive");
      if (!state?.ok) throw new Error("The live ARDY worker is not available.");
      await proxyWorkerBinary("ardyLive", `/live/mesh/${name}`, res);
      return;
    }
    if (req.method === "GET" && /^\/generated\/[a-z0-9-]+\.npz$/i.test(url.pathname)) {
      const file = path.resolve(GENERATED_ROOT, path.basename(url.pathname));
      if (path.dirname(file) !== path.resolve(GENERATED_ROOT) || !fs.existsSync(file)) throw new Error("Motion export not found.");
      sendDownload(res, file); return;
    }
    if (req.method === "GET" && url.pathname === "/api/state") { sendJson(res, 200, { ok: true, engines: await statePayload() }); return; }
    if (req.method === "GET" && url.pathname === "/api/text-cache") {
      const engine = requireEngine(String(url.searchParams.get("engine") || "ardy"));
      await ensureWorker(engine); const output = await requestWorker(engine, "GET", "/text-cache", null); sendJson(res, output.ok ? 200 : 400, output); return;
    }
    if (req.method === "GET" && url.pathname === "/api/live/text-cache") {
      await ensureWorker("ardyLive");
      const output = await requestWorker("ardyLive", "GET", "/text-cache", null);
      sendJson(res, output.ok ? 200 : 400, output); return;
    }
    if (req.method === "POST" && url.pathname === "/api/load") {
      const body = JSON.parse(await readBody(req) || "{}"); const engine = requireEngine(String(body.engine || "ardy"));
      await ensureWorker(engine); const output = await requestWorker(engine, "POST", "/load", {}); sendJson(res, output.ok ? 200 : 400, output); return;
    }
    if (req.method === "POST" && url.pathname === "/api/generate") {
      const body = JSON.parse(await readBody(req) || "{}"); const engine = requireEngine(String(body.engine || "ardy"));
      await ensureWorker(engine); const output = await requestWorker(engine, "POST", "/generate", body);
      if (output.ok && output.motion?.meshFrameFile) output.motion.meshFramesUrl = `/generated/${output.motion.meshFrameFile}`;
      if (output.ok && output.motion?.path) output.motion.exportUrl = `/generated/${path.basename(output.motion.path)}`;
      sendJson(res, output.ok ? 200 : 400, output); return;
    }
    if (req.method === "POST" && url.pathname === "/api/generate-scheduled") {
      const body = JSON.parse(await readBody(req) || "{}"); const engine = requireEngine(String(body.engine || "ardy"));
      await ensureWorker(engine); const output = await requestWorker(engine, "POST", "/generate-scheduled", body, 600000);
      if (output.ok && output.motion?.meshFrameFile) output.motion.meshFramesUrl = `/generated/${output.motion.meshFrameFile}`;
      if (output.ok && output.motion?.path) output.motion.exportUrl = `/generated/${path.basename(output.motion.path)}`;
      sendJson(res, output.ok ? 200 : 400, output); return;
    }
    if (req.method === "POST" && url.pathname === "/api/cache-text") {
      const body = JSON.parse(await readBody(req) || "{}"); const engine = requireEngine(String(body.engine || "ardy"));
      await ensureWorker(engine); const output = await requestWorker(engine, "POST", "/cache-text", body); sendJson(res, output.ok ? 200 : 400, output); return;
    }
    if (req.method === "POST" && url.pathname === "/api/live/cache-text") {
      const body = JSON.parse(await readBody(req) || "{}");
      await ensureWorker("ardyLive");
      const output = await requestWorker("ardyLive", "POST", "/cache-text", body);
      sendJson(res, output.ok ? 200 : 400, output); return;
    }
    if (req.method === "POST" && url.pathname === "/api/live/text-cache/nickname") {
      const body = JSON.parse(await readBody(req) || "{}");
      await ensureWorker("ardyLive");
      const output = await requestWorker("ardyLive", "POST", "/text-cache/nickname", body);
      sendJson(res, output.ok ? 200 : 400, output); return;
    }
    if (req.method === "POST" && url.pathname === "/api/live/text-cache/delete") {
      const body = JSON.parse(await readBody(req) || "{}");
      await ensureWorker("ardyLive");
      const output = await requestWorker("ardyLive", "POST", "/text-cache/delete", body);
      sendJson(res, output.ok ? 200 : 400, output); return;
    }
    if (req.method === "POST" && (url.pathname === "/api/live/start" || url.pathname === "/api/live/step")) {
      const body = JSON.parse(await readBody(req) || "{}");
      const engine = requireEngine(String(body.engine || "ardy"));
      if (engine !== "ardy") throw new Error("Live streaming is available for ARDY only.");
      await ensureWorker("ardyLive");
      const workerPath = url.pathname === "/api/live/start" ? "/live/start" : "/live/step";
      const output = await requestWorker("ardyLive", "POST", workerPath, body);
      if (output.ok && output.motion?.meshFrameToken) output.motion.meshFramesUrl = `/live-mesh/${output.motion.meshFrameToken}`;
      sendJson(res, output.ok ? 200 : 400, output); return;
    }
    if (req.method === "POST" && url.pathname === "/api/live/export") {
      await ensureWorker("ardyLive");
      const output = await requestWorker("ardyLive", "POST", "/live/export", {});
      if (output.ok && output.export?.file) output.export.url = `/generated/${output.export.file}`;
      if (output.ok && output.export?.meshFrameFile) output.export.meshFramesUrl = `/generated/${output.export.meshFrameFile}`;
      sendJson(res, output.ok ? 200 : 400, output); return;
    }
    sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (error) { sendJson(res, 400, { ok: false, error: error.message }); }
});

function stopWorkers() {
  for (const target of Object.values(ENGINES)) {
    if (!target.process?.pid || target.process.exitCode != null) continue;
    spawnSync("taskkill.exe", ["/pid", String(target.process.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
  }
}
process.on("SIGINT", () => { stopWorkers(); process.exit(0); });
process.on("SIGTERM", () => { stopWorkers(); process.exit(0); });
process.on("exit", stopWorkers);

server.listen(PORT, HOST, () => console.log(`Motion Drive: http://${HOST}:${PORT}`));
