const fs = require("node:fs");

const VNYAN_BONE_ORDER = [
  "Hips", "Spine", "Chest", "UpperChest", "Neck", "Head",
  "LeftShoulder", "LeftUpperArm", "LeftLowerArm", "LeftHand",
  "RightShoulder", "RightUpperArm", "RightLowerArm", "RightHand",
  "LeftUpperLeg", "LeftLowerLeg", "LeftFoot", "LeftToes",
  "RightUpperLeg", "RightLowerLeg", "RightFoot", "RightToes",
];

const VNYAN_PARENT_CANDIDATES = {
  Spine: ["Hips"],
  Chest: ["Spine", "Hips"],
  UpperChest: ["Chest", "Spine"],
  Neck: ["UpperChest", "Chest"],
  Head: ["Neck", "UpperChest", "Chest"],
  LeftShoulder: ["UpperChest", "Chest"],
  LeftUpperArm: ["LeftShoulder", "UpperChest", "Chest"],
  LeftLowerArm: ["LeftUpperArm", "LeftShoulder"],
  LeftHand: ["LeftLowerArm", "LeftUpperArm"],
  RightShoulder: ["UpperChest", "Chest"],
  RightUpperArm: ["RightShoulder", "UpperChest", "Chest"],
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

const VNYAN_EDGE_NAMES = [
  ["Hips", "Spine"], ["Spine", "Chest"], ["Chest", "UpperChest"], ["UpperChest", "Neck"], ["Neck", "Head"],
  ["Chest", "Neck"],
  ["UpperChest", "LeftShoulder"], ["Chest", "LeftShoulder"], ["LeftShoulder", "LeftUpperArm"], ["LeftUpperArm", "LeftLowerArm"], ["LeftLowerArm", "LeftHand"],
  ["UpperChest", "RightShoulder"], ["Chest", "RightShoulder"], ["RightShoulder", "RightUpperArm"], ["RightUpperArm", "RightLowerArm"], ["RightLowerArm", "RightHand"],
  ["Hips", "LeftUpperLeg"], ["LeftUpperLeg", "LeftLowerLeg"], ["LeftLowerLeg", "LeftFoot"], ["LeftFoot", "LeftToes"],
  ["Hips", "RightUpperLeg"], ["RightUpperLeg", "RightLowerLeg"], ["RightLowerLeg", "RightFoot"], ["RightFoot", "RightToes"],
];

const VNYAN_RETARGET_CHILD = {
  Hips: "Spine",
  Spine: "Chest",
  Chest: "UpperChest",
  UpperChest: "Neck",
  Neck: "Head",
  LeftShoulder: "LeftUpperArm",
  LeftUpperArm: "LeftLowerArm",
  LeftLowerArm: "LeftHand",
  RightShoulder: "RightUpperArm",
  RightUpperArm: "RightLowerArm",
  RightLowerArm: "RightHand",
  LeftUpperLeg: "LeftLowerLeg",
  LeftLowerLeg: "LeftFoot",
  RightUpperLeg: "RightLowerLeg",
  RightLowerLeg: "RightFoot",
};

const MOTION_OUTPUT_BONES = new Set([
  "LeftShoulder", "LeftUpperArm", "LeftLowerArm", "LeftHand",
  "RightShoulder", "RightUpperArm", "RightLowerArm", "RightHand",
  "LeftUpperLeg", "LeftLowerLeg", "LeftFoot",
  "RightUpperLeg", "RightLowerLeg", "RightFoot",
]);

const VRM_HUMANOID_NAMES = {
  Hips: "hips", Spine: "spine", Chest: "chest", UpperChest: "upperChest", Neck: "neck", Head: "head",
  LeftShoulder: "leftShoulder", LeftUpperArm: "leftUpperArm", LeftLowerArm: "leftLowerArm", LeftHand: "leftHand",
  RightShoulder: "rightShoulder", RightUpperArm: "rightUpperArm", RightLowerArm: "rightLowerArm", RightHand: "rightHand",
  LeftUpperLeg: "leftUpperLeg", LeftLowerLeg: "leftLowerLeg", LeftFoot: "leftFoot", LeftToes: "leftToes",
  RightUpperLeg: "rightUpperLeg", RightLowerLeg: "rightLowerLeg", RightFoot: "rightFoot", RightToes: "rightToes",
};

const RETARGET_BONES = [
  ["Hips", "Spine", "pelvis", "spine1"],
  ["Spine", "Chest", "spine1", "spine2"],
  ["Neck", "Head", "neck", "head"],
  ["LeftShoulder", "LeftUpperArm", "left_collar", "left_shoulder"],
  ["LeftUpperArm", "LeftLowerArm", "left_shoulder", "left_elbow"],
  ["LeftLowerArm", "LeftHand", "left_elbow", "left_wrist"],
  ["RightShoulder", "RightUpperArm", "right_collar", "right_shoulder"],
  ["RightUpperArm", "RightLowerArm", "right_shoulder", "right_elbow"],
  ["RightLowerArm", "RightHand", "right_elbow", "right_wrist"],
  ["Hips", "LeftUpperLeg", "pelvis", "left_hip"],
  ["LeftUpperLeg", "LeftLowerLeg", "left_hip", "left_knee"],
  ["LeftLowerLeg", "LeftFoot", "left_knee", "left_ankle"],
  ["Hips", "RightUpperLeg", "pelvis", "right_hip"],
  ["RightUpperLeg", "RightLowerLeg", "right_hip", "right_knee"],
  ["RightLowerLeg", "RightFoot", "right_knee", "right_ankle"],
];

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function finiteVector(value, fallback = [0, 0, 0]) {
  return [
    finiteNumber(value?.[0], fallback[0] || 0),
    finiteNumber(value?.[1], fallback[1] || 0),
    finiteNumber(value?.[2], fallback[2] || 0),
  ];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function multiply(vector, scalar) {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function distance(a, b) {
  if (!a || !b) return 0;
  return length(subtract(a, b));
}

function normalize(vector, fallback = [0, 0, 0]) {
  const magnitude = length(vector);
  return magnitude > 1e-7 ? multiply(vector, 1 / magnitude) : fallback.slice();
}

function normalizeQuat(q) {
  const x = finiteNumber(q?.[0] ?? q?.qx ?? q?.x, 0);
  const y = finiteNumber(q?.[1] ?? q?.qy ?? q?.y, 0);
  const z = finiteNumber(q?.[2] ?? q?.qz ?? q?.z, 0);
  const w = finiteNumber(q?.[3] ?? q?.qw ?? q?.w, 1);
  const len = Math.hypot(x, y, z, w) || 1;
  return [x / len, y / len, z / len, w / len];
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

function quatFromRotationMatrix(matrix) {
  const m00 = matrix[0]; const m01 = matrix[4]; const m02 = matrix[8];
  const m10 = matrix[1]; const m11 = matrix[5]; const m12 = matrix[9];
  const m20 = matrix[2]; const m21 = matrix[6]; const m22 = matrix[10];
  const trace = m00 + m11 + m22;
  let x; let y; let z; let w;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s;
  }
  return normalizeQuat([x, y, z, w]);
}

function inverseQuat(q) {
  const [x, y, z, w] = normalizeQuat(q);
  return [-x, -y, -z, w];
}

function rotateVector(q, vector) {
  const [x, y, z, w] = normalizeQuat(q);
  const axis = [x, y, z];
  const uv = cross(axis, vector);
  const uuv = cross(axis, uv);
  return add(vector, multiply(add(multiply(uv, w), uuv), 2));
}

function nodeLocalTransform(node = {}) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) {
    const matrix = node.matrix.map(Number);
    const scale = [
      Math.hypot(matrix[0], matrix[1], matrix[2]) || 1,
      Math.hypot(matrix[4], matrix[5], matrix[6]) || 1,
      Math.hypot(matrix[8], matrix[9], matrix[10]) || 1,
    ];
    const rotationMatrix = matrix.slice();
    for (let row = 0; row < 3; row += 1) {
      rotationMatrix[row] /= scale[0];
      rotationMatrix[4 + row] /= scale[1];
      rotationMatrix[8 + row] /= scale[2];
    }
    return { position: [matrix[12], matrix[13], matrix[14]], rotation: quatFromRotationMatrix(rotationMatrix), scale };
  }
  return {
    position: finiteVector(node.translation),
    rotation: normalizeQuat(node.rotation),
    scale: finiteVector(node.scale, [1, 1, 1]),
  };
}

function parseGlbJson(file) {
  const data = fs.readFileSync(file);
  if (data.length < 20 || data.readUInt32LE(0) !== 0x46546c67 || data.readUInt32LE(4) !== 2) {
    throw new Error(`Expected a VRM/GLB 2.0 file: ${file}`);
  }
  let offset = 12;
  while (offset + 8 <= data.length) {
    const chunkLength = data.readUInt32LE(offset);
    const chunkType = data.readUInt32LE(offset + 4);
    offset += 8;
    if (chunkType === 0x4e4f534a) {
      return JSON.parse(data.subarray(offset, offset + chunkLength).toString("utf8").replace(/[\u0000\s]+$/g, ""));
    }
    offset += chunkLength;
  }
  throw new Error(`VRM has no glTF JSON chunk: ${file}`);
}

function vrmHumanoidMap(gltf) {
  const extensions = gltf.extensions || {};
  if (extensions.VRMC_vrm) {
    const bones = extensions.VRMC_vrm.humanoid?.humanBones || {};
    return Object.fromEntries(Object.entries(bones).filter(([, value]) => Number.isInteger(value?.node)).map(([name, value]) => [name, value.node]));
  }
  const bones = extensions.VRM?.humanoid?.humanBones || [];
  return Object.fromEntries(bones.filter((value) => value?.bone && Number.isInteger(value?.node)).map((value) => [value.bone, value.node]));
}

function buildVrmPayloadFromFile(file) {
  const gltf = parseGlbJson(file);
  const nodes = gltf.nodes || [];
  const humanoid = vrmHumanoidMap(gltf);
  if (!Object.keys(humanoid).length) throw new Error(`VRM humanoid map is missing: ${file}`);
  const parents = new Map();
  nodes.forEach((node, index) => (node.children || []).forEach((child) => parents.set(child, index)));
  const local = nodes.map(nodeLocalTransform);
  const world = new Array(nodes.length);
  function compose(index) {
    if (world[index]) return world[index];
    const own = local[index] || nodeLocalTransform();
    const parentIndex = parents.get(index);
    if (!Number.isInteger(parentIndex)) return (world[index] = own);
    const parent = compose(parentIndex);
    const scaledLocal = own.position.map((value, axis) => value * parent.scale[axis]);
    return (world[index] = {
      position: add(parent.position, rotateVector(parent.rotation, scaledLocal)),
      rotation: multiplyQuat(parent.rotation, own.rotation),
      scale: own.scale.map((value, axis) => value * parent.scale[axis]),
    });
  }

  const availableNames = VNYAN_BONE_ORDER.filter((name) => Number.isInteger(humanoid[VRM_HUMANOID_NAMES[name]]));
  const nameToIndex = new Map(availableNames.map((name, index) => [name, index]));
  const transforms = new Map(availableNames.map((name) => [name, compose(humanoid[VRM_HUMANOID_NAMES[name]])]));
  const hips = transforms.get("Hips")?.position || [0, 0, 0];
  const joints = availableNames.map((name) => transforms.get(name).position.slice());
  const centered = joints.map((point) => subtract(point, hips));
  const localPositions = [];
  const localRotations = [];
  const worldRotations = [];
  for (const name of availableNames) {
    const transform = transforms.get(name);
    const parentName = resolveVnyanParent(name, transforms);
    const parent = parentName ? transforms.get(parentName) : null;
    localPositions.push(parent ? rotateVector(inverseQuat(parent.rotation), subtract(transform.position, parent.position)) : transform.position.slice());
    localRotations.push(parent ? multiplyQuat(inverseQuat(parent.rotation), transform.rotation) : transform.rotation.slice());
    worldRotations.push(transform.rotation.slice());
  }
  const edgeNames = VNYAN_EDGE_NAMES.filter(([a, b]) => nameToIndex.has(a) && nameToIndex.has(b));
  const flat = centered.length ? centered : [[0, 0, 0]];
  const min = [0, 1, 2].map((axis) => Math.min(...flat.map((point) => point[axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...flat.map((point) => point[axis])));
  const extension = gltf.extensions?.VRMC_vrm || gltf.extensions?.VRM || {};
  const meta = extension.meta || {};
  const feet = ["LeftFoot", "LeftToes", "RightFoot", "RightToes"].filter((name) => transforms.has(name)).map((name) => transforms.get(name).position[1]);
  return {
    kind: "vrm-rest",
    source: `VRM bind pose: ${file}`,
    fps: 0,
    frameCount: 1,
    joints: [joints],
    centeredJoints: [centered],
    localPositions,
    localRotations,
    worldRotations,
    edges: { body: edgeNames.map(([a, b]) => [nameToIndex.get(a), nameToIndex.get(b)]), hands: [] },
    jointNames: Object.fromEntries(availableNames.map((name, index) => [String(index), name])),
    bounds: { min, max, span: Math.max(...max.map((value, axis) => value - min[axis]), 0) },
    stats: {
      avatarName: meta.name || meta.title || "VRM avatar",
      vrmVersion: gltf.extensions?.VRMC_vrm ? "1" : "0",
      boneCount: availableNames.length,
      receivedBoneCount: availableNames.length,
      sourceKind: "vrm-file",
      hipsHeightM: hips[1],
      floorY: feet.length ? Math.min(...feet) : 0,
      file,
    },
  };
}

function quatFromUnitVectors(from, to) {
  const a = normalize(from, [0, 1, 0]);
  const b = normalize(to, [0, 1, 0]);
  const r = dot(a, b) + 1;
  if (r < 1e-6) {
    const axis = Math.abs(a[0]) > Math.abs(a[2]) ? [-a[1], a[0], 0] : [0, -a[2], a[1]];
    const n = normalize(axis, [1, 0, 0]);
    return [n[0], n[1], n[2], 0];
  }
  const c = cross(a, b);
  return normalizeQuat([c[0], c[1], c[2], r]);
}

function smoothStep01(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function blendFrame(a, b, amount) {
  return a.map((point, index) => {
    const target = b[index] || point;
    return add(point, multiply(subtract(target, point), amount));
  });
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return 1;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function indexByName(payload) {
  return Object.fromEntries(Object.entries(payload?.jointNames || {}).map(([index, name]) => [String(name), Number(index)]));
}

function makeBodyBasis(points, indices) {
  const left = points[indices.left];
  const right = points[indices.right];
  const root = points[indices.root];
  const head = points[indices.head];
  if (!left || !right || !root || !head) {
    return { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  }
  const x = normalize(subtract(right, left), [1, 0, 0]);
  const yRaw = normalize(subtract(head, root), [0, 1, 0]);
  const z = normalize(cross(x, yRaw), [0, 0, 1]);
  const y = normalize(cross(z, x), [0, 1, 0]);
  return { x, y, z };
}

function transformSourceVector(vector, sourceBasis, targetBasis) {
  const coords = [
    dot(vector, sourceBasis.x),
    dot(vector, sourceBasis.y),
    -dot(vector, sourceBasis.z),
  ];
  return add(add(multiply(targetBasis.x, coords[0]), multiply(targetBasis.y, coords[1])), multiply(targetBasis.z, coords[2]));
}

function retargetBonesForTarget(targetNames) {
  const hasUpperChest = Number.isInteger(targetNames.UpperChest);
  const upperTorso = hasUpperChest ? "UpperChest" : "Chest";
  return [
    ...RETARGET_BONES.slice(0, 2),
    ...(hasUpperChest ? [["Chest", "UpperChest", "spine2", "spine3"]] : []),
    [upperTorso, "Neck", "spine3", "neck"],
    ...RETARGET_BONES.slice(2, 3),
    [upperTorso, "LeftShoulder", "spine3", "left_collar"],
    ...RETARGET_BONES.slice(3, 6),
    [upperTorso, "RightShoulder", "spine3", "right_collar"],
    ...RETARGET_BONES.slice(6),
  ];
}

function retargetJointMapForTarget(targetNames, legMode = "locked") {
  const hasUpperChest = Number.isInteger(targetNames.UpperChest);
  const map = [
    ["Hips", "pelvis"],
    ["Spine", "spine1"],
    ["Chest", hasUpperChest ? "spine2" : "spine3"],
    ["Neck", "neck"],
    ["Head", "head"],
    ["LeftShoulder", "left_collar"],
    ["LeftUpperArm", "left_shoulder"],
    ["LeftLowerArm", "left_elbow"],
    ["LeftHand", "left_wrist"],
    ["RightShoulder", "right_collar"],
    ["RightUpperArm", "right_shoulder"],
    ["RightLowerArm", "right_elbow"],
    ["RightHand", "right_wrist"],
  ];
  if (legMode !== "locked") {
    map.push(
      ["LeftUpperLeg", "left_hip"],
      ["LeftLowerLeg", "left_knee"],
      ["RightUpperLeg", "right_hip"],
      ["RightLowerLeg", "right_knee"],
    );
    if (legMode === "unlocked") {
      map.push(["LeftFoot", "left_ankle"], ["RightFoot", "right_ankle"]);
    }
  }
  if (hasUpperChest) {
    map.splice(3, 0, ["UpperChest", "spine3"]);
  }
  return map;
}

function drivenBonesForTarget(targetNames, options) {
  const names = [
    "Hips", "Spine", "Chest", "UpperChest", "Neck", "Head",
    "LeftShoulder", "LeftUpperArm", "LeftLowerArm", "LeftHand",
    "RightShoulder", "RightUpperArm", "RightLowerArm", "RightHand",
  ];
  if (options.legMode !== "locked") {
    names.push("LeftUpperLeg", "LeftLowerLeg", "LeftFoot", "RightUpperLeg", "RightLowerLeg", "RightFoot");
  }
  return names.filter((name) => Number.isInteger(targetNames[name]));
}

function applyNeutralLoopPadding(frames, restFrame, fps, options) {
  if (!options.neutralLoop || !frames.length || !restFrame.length) {
    return { frames, leadFrames: 0, tailFrames: 0 };
  }
  const count = Math.max(1, Math.round(Math.max(1, fps) * options.neutralLoopSeconds));
  const first = frames[0];
  const last = frames[frames.length - 1];
  const padded = [restFrame.map((point) => point.slice())];
  for (let i = 1; i <= count; i += 1) {
    padded.push(blendFrame(restFrame, first, smoothStep01(i / (count + 1))));
  }
  padded.push(...frames.map((frame) => frame.map((point) => point.slice())));
  for (let i = 1; i <= count; i += 1) {
    padded.push(blendFrame(last, restFrame, smoothStep01(i / count)));
  }
  return { frames: padded, leadFrames: count + 1, tailFrames: count };
}

function solveFabrikChain(frame, restFrame, chain, goalMap, iterations = 8) {
  const usable = chain.filter((index) => Number.isInteger(index) && frame[index] && restFrame[index]);
  if (usable.length < 2) return;
  const root = frame[usable[0]].slice();
  const endGoal = goalMap.get(usable[usable.length - 1]);
  if (!endGoal) return;

  const lengths = [];
  let totalLength = 0;
  for (let i = 0; i < usable.length - 1; i += 1) {
    const segmentLength = distance(restFrame[usable[i]], restFrame[usable[i + 1]]);
    lengths.push(segmentLength);
    totalLength += segmentLength;
  }

  const positions = usable.map((index) => (goalMap.get(index) || frame[index]).slice());
  positions[0] = root.slice();
  const rootToGoal = distance(root, endGoal);
  if (rootToGoal >= totalLength) {
    const direction = normalize(subtract(endGoal, root), normalize(subtract(restFrame[usable.at(-1)], restFrame[usable[0]]), [0, 1, 0]));
    for (let i = 1; i < usable.length; i += 1) {
      positions[i] = add(positions[i - 1], multiply(direction, lengths[i - 1]));
    }
  } else {
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      positions[positions.length - 1] = endGoal.slice();
      for (let i = positions.length - 2; i >= 0; i -= 1) {
        const fallback = normalize(subtract(restFrame[usable[i]], restFrame[usable[i + 1]]), [0, 1, 0]);
        const direction = normalize(subtract(positions[i], positions[i + 1]), fallback);
        positions[i] = add(positions[i + 1], multiply(direction, lengths[i]));
      }
      positions[0] = root.slice();
      for (let i = 0; i < positions.length - 1; i += 1) {
        const fallback = normalize(subtract(restFrame[usable[i + 1]], restFrame[usable[i]]), [0, 1, 0]);
        const direction = normalize(subtract(positions[i + 1], positions[i]), fallback);
        positions[i + 1] = add(positions[i], multiply(direction, lengths[i]));
      }
    }
  }

  for (let i = 1; i < usable.length; i += 1) {
    frame[usable[i]] = positions[i];
  }
}

function solveTwoBone(frame, restFrame, rootIndex, midIndex, endIndex, endGoal, poleGoal) {
  if (![rootIndex, midIndex, endIndex].every((index) => Number.isInteger(index) && frame[index] && restFrame[index]) || !endGoal) return;
  const root = frame[rootIndex].slice();
  const upperLength = distance(restFrame[rootIndex], restFrame[midIndex]);
  const lowerLength = distance(restFrame[midIndex], restFrame[endIndex]);
  if (upperLength < 1e-5 || lowerLength < 1e-5) return;

  const rawTarget = subtract(endGoal, root);
  const rawDistance = length(rawTarget);
  const minReach = Math.abs(upperLength - lowerLength) + 1e-4;
  const maxReach = upperLength + lowerLength - 1e-4;
  const targetDistance = Math.min(Math.max(rawDistance, minReach), maxReach);
  const forward = normalize(rawTarget, normalize(subtract(restFrame[endIndex], restFrame[rootIndex]), [0, -1, 0]));
  const poleRaw = poleGoal ? subtract(poleGoal, root) : subtract(restFrame[midIndex], restFrame[rootIndex]);
  const poleProjected = subtract(poleRaw, multiply(forward, dot(poleRaw, forward)));
  const fallbackPole = subtract(subtract(restFrame[midIndex], restFrame[rootIndex]), multiply(forward, dot(subtract(restFrame[midIndex], restFrame[rootIndex]), forward)));
  const pole = normalize(poleProjected, normalize(fallbackPole, [0, 0, 1]));
  const along = (upperLength * upperLength + targetDistance * targetDistance - lowerLength * lowerLength) / (2 * targetDistance);
  const height = Math.sqrt(Math.max(upperLength * upperLength - along * along, 0));
  frame[midIndex] = add(root, add(multiply(forward, along), multiply(pole, height)));
  frame[endIndex] = add(root, multiply(forward, targetDistance));
}

function sleeveBarrierWeight(point, restFrame, upperIndex, handIndex) {
  const upper = restFrame[upperIndex];
  const hand = restFrame[handIndex];
  if (!point || !upper || !hand) return 1;
  const span = Math.max(0.03, upper[1] - hand[1]);
  return Math.max(0.25, Math.min(1, (upper[1] - point[1]) / span));
}

function pushGoalOutsideSleeveBarrier(goalMap, restFrame, index, side, minAbsX, amount) {
  if (!Number.isInteger(index) || !restFrame[index] || amount <= 0) return;
  const goal = (goalMap.get(index) || restFrame[index]).slice();
  const sideX = goal[0] * side;
  if (sideX < minAbsX) {
    goal[0] += (side * minAbsX - goal[0]) * amount;
  }
  const closeWeight = sideX < minAbsX * 1.35 ? amount * 0.35 : 0;
  if (closeWeight > 0) {
    goal[2] += (restFrame[index][2] - goal[2]) * closeWeight;
  }
  goalMap.set(index, goal);
}

function applySleeveBarrierGoals(goalMap, restFrame, targetNames, options) {
  if (!options.sleeveBarrier || options.sleeveBarrierStrength <= 0 || options.sleeveBarrierWidth <= 0) return;
  const pairs = [
    { side: -1, upper: targetNames.LeftUpperArm, lower: targetNames.LeftLowerArm, hand: targetNames.LeftHand },
    { side: 1, upper: targetNames.RightUpperArm, lower: targetNames.RightLowerArm, hand: targetNames.RightHand },
  ];
  for (const { side, upper, lower, hand } of pairs) {
    if (![upper, lower, hand].every((index) => Number.isInteger(index) && restFrame[index])) continue;
    const handGoal = goalMap.get(hand) || restFrame[hand];
    const lowerGoal = goalMap.get(lower) || restFrame[lower];
    const width = Math.max(options.sleeveBarrierWidth, Math.abs(restFrame[hand][0]) * 0.72, Math.abs(restFrame[lower][0]) * 0.68);
    const handAmount = options.sleeveBarrierStrength * sleeveBarrierWeight(handGoal, restFrame, upper, hand);
    const lowerAmount = options.sleeveBarrierStrength * sleeveBarrierWeight(lowerGoal, restFrame, upper, hand) * 0.9;
    pushGoalOutsideSleeveBarrier(goalMap, restFrame, lower, side, width * 0.9, lowerAmount);
    pushGoalOutsideSleeveBarrier(goalMap, restFrame, hand, side, width, handAmount);
  }
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
    const localPosition = finiteVector(bone.position);
    const localRotation = normalizeQuat(bone.rotation);
    const parentName = resolveVnyanParent(name, bones);
    const parent = parentName ? compose(parentName) : null;
    const transform = parent
      ? {
          position: add(parent.position, rotateVector(parent.rotation, localPosition)),
          rotation: multiplyQuat(parent.rotation, localRotation),
        }
      : { position: localPosition, rotation: localRotation };
    world.set(name, transform);
    return transform;
  }
  for (const name of VNYAN_BONE_ORDER) compose(name);
  return world;
}

function buildVnyanPayloadFromBones(bones, { now = Date.now(), ttlMs = 1200, stats = {} } = {}) {
  const freshBones = new Map([...bones.entries()].filter(([, bone]) => now - Number(bone.receivedAt || 0) <= ttlMs));
  const worldBones = composeVnyanTransforms(freshBones);
  const availableNames = VNYAN_BONE_ORDER.filter((name) => worldBones.has(name));
  const nameToIndex = new Map(availableNames.map((name, index) => [name, index]));
  const joints = availableNames.map((name) => worldBones.get(name).position);
  const localPositions = availableNames.map((name) => finiteVector(freshBones.get(name)?.position));
  const localRotations = availableNames.map((name) => normalizeQuat(freshBones.get(name)?.rotation));
  const worldRotations = availableNames.map((name) => normalizeQuat(worldBones.get(name)?.rotation));
  const rootIndex = nameToIndex.has("Hips") ? nameToIndex.get("Hips") : 0;
  const root = joints[rootIndex] || [0, 0, 0];
  const centered = joints.map((joint) => subtract(joint, root));
  const edgeNames = VNYAN_EDGE_NAMES.filter(([a, b]) => nameToIndex.has(a) && nameToIndex.has(b));
  const edges = edgeNames.map(([a, b]) => [nameToIndex.get(a), nameToIndex.get(b)]);
  const ageMs = stats.lastPacketAt ? now - stats.lastPacketAt : null;
  return {
    kind: "vnyan-live",
    frameCount: 1,
    fps: 0,
    joints: [joints],
    centeredJoints: [centered],
    localPositions,
    localRotations,
    worldRotations,
    edges: { body: edges, hands: [] },
    jointNames: Object.fromEntries(availableNames.map((name, index) => [String(index), name])),
    stats: {
      boneCount: availableNames.length,
      receivedBoneCount: freshBones.size,
      totalKnownBoneCount: bones.size,
      ageMs,
      ...stats,
    },
  };
}

function retargetSpatialPayload(sourcePayload, targetPayload, options = {}) {
  const sourceFrames = sourcePayload.centeredJoints || [];
  const targetRest = targetPayload.centeredJoints?.[0] || [];
  const sourceRest = sourcePayload.restCenteredJoints || sourcePayload.bindCenteredJoints || sourceFrames[0] || [];
  if (!sourceFrames.length || !targetRest.length) {
    throw new Error("Spatial retarget needs EMAGE joints and a VNyan rest skeleton.");
  }

  const sourceNames = indexByName(sourcePayload);
  const targetNames = indexByName(targetPayload);
  const rootIndex = targetNames.Hips ?? 0;
  const sourceBasis = makeBodyBasis(sourceRest, {
    left: sourceNames.left_shoulder,
    right: sourceNames.right_shoulder,
    root: sourceNames.pelvis,
    head: sourceNames.head,
  });
  const targetBasis = makeBodyBasis(targetRest, {
    left: targetNames.LeftUpperArm ?? targetNames.LeftShoulder,
    right: targetNames.RightUpperArm ?? targetNames.RightShoulder,
    root: targetNames.Hips,
    head: targetNames.Head,
  });

  const legMode = ["locked", "feet-locked", "unlocked"].includes(options.legMode) ? options.legMode : "locked";
  const mapped = retargetBonesForTarget(targetNames).map(([targetParent, targetChild, sourceParent, sourceChild]) => ({
    targetParentIndex: targetNames[targetParent],
    targetChildIndex: targetNames[targetChild],
    sourceParentIndex: sourceNames[sourceParent],
    sourceChildIndex: sourceNames[sourceChild],
  })).filter((bone) => Number.isInteger(bone.targetParentIndex)
    && Number.isInteger(bone.targetChildIndex)
    && Number.isInteger(bone.sourceParentIndex)
    && Number.isInteger(bone.sourceChildIndex));
  const boneScales = mapped.map((bone) => {
    const targetVector = subtract(targetRest[bone.targetChildIndex], targetRest[bone.targetParentIndex]);
    const sourceVector = transformSourceVector(subtract(sourceRest[bone.sourceChildIndex], sourceRest[bone.sourceParentIndex]), sourceBasis, targetBasis);
    return length(targetVector) / Math.max(length(sourceVector), 1e-5);
  });
  const globalBoneScale = median(boneScales);
  const strength = Math.max(0, finiteNumber(options.strength, 1));
  const jointMap = retargetJointMapForTarget(targetNames, legMode).map(([targetName, sourceName]) => ({
    targetName,
    sourceName,
    targetIndex: targetNames[targetName],
    sourceIndex: sourceNames[sourceName],
  })).filter((joint) => Number.isInteger(joint.targetIndex) && Number.isInteger(joint.sourceIndex));

  const bodyChain = [targetNames.Hips, targetNames.Spine, targetNames.Chest, targetNames.UpperChest, targetNames.Neck, targetNames.Head];
  const upperTorsoIndex = Number.isInteger(targetNames.UpperChest) ? targetNames.UpperChest : targetNames.Chest;
  const leftShoulderChain = [upperTorsoIndex, targetNames.LeftShoulder, targetNames.LeftUpperArm];
  const rightShoulderChain = [upperTorsoIndex, targetNames.RightShoulder, targetNames.RightUpperArm];
  const leftLegChain = [targetNames.Hips, targetNames.LeftUpperLeg, targetNames.LeftLowerLeg, targetNames.LeftFoot];
  const rightLegChain = [targetNames.Hips, targetNames.RightUpperLeg, targetNames.RightLowerLeg, targetNames.RightFoot];

  const retargetedFrames = sourceFrames.map((sourceFrame) => {
    const targetFrame = targetRest.map((point) => point.slice());
    const goals = new Map();
    for (const joint of jointMap) {
      if (joint.targetName === "Hips") {
        goals.set(joint.targetIndex, targetRest[joint.targetIndex].slice());
        continue;
      }
      const absoluteSource = transformSourceVector(sourceFrame[joint.sourceIndex], sourceBasis, targetBasis);
      const absoluteGoal = add(targetRest[rootIndex] || [0, 0, 0], multiply(absoluteSource, globalBoneScale));
      const restToGoal = subtract(absoluteGoal, targetRest[joint.targetIndex]);
      goals.set(joint.targetIndex, add(targetRest[joint.targetIndex], multiply(restToGoal, strength)));
    }
    if (legMode === "feet-locked") {
      if (Number.isInteger(targetNames.LeftFoot) && targetRest[targetNames.LeftFoot]) goals.set(targetNames.LeftFoot, targetRest[targetNames.LeftFoot].slice());
      if (Number.isInteger(targetNames.RightFoot) && targetRest[targetNames.RightFoot]) goals.set(targetNames.RightFoot, targetRest[targetNames.RightFoot].slice());
    }
    applySleeveBarrierGoals(goals, targetRest, targetNames, options);

    solveFabrikChain(targetFrame, targetRest, bodyChain, goals, 10);
    solveFabrikChain(targetFrame, targetRest, leftShoulderChain, goals, 8);
    solveTwoBone(targetFrame, targetRest, targetNames.LeftUpperArm, targetNames.LeftLowerArm, targetNames.LeftHand, goals.get(targetNames.LeftHand), goals.get(targetNames.LeftLowerArm));
    solveFabrikChain(targetFrame, targetRest, rightShoulderChain, goals, 8);
    solveTwoBone(targetFrame, targetRest, targetNames.RightUpperArm, targetNames.RightLowerArm, targetNames.RightHand, goals.get(targetNames.RightHand), goals.get(targetNames.RightLowerArm));
    if (legMode !== "locked") {
      solveFabrikChain(targetFrame, targetRest, leftLegChain, goals, 10);
      solveFabrikChain(targetFrame, targetRest, rightLegChain, goals, 10);
    }
    return targetFrame;
  });

  const fps = Math.max(1, finiteNumber(sourcePayload.fps, 30));
  const padded = applyNeutralLoopPadding(retargetedFrames, targetRest, fps, {
    neutralLoop: Boolean(options.neutralLoop),
    neutralLoopSeconds: Math.max(0.05, finiteNumber(options.neutralLoopSeconds, 0.45)),
  });
  const drivenBones = drivenBonesForTarget(targetNames, { legMode });
  return {
    kind: "vnyan-retarget",
    fps,
    frameCount: padded.frames.length,
    centeredJoints: padded.frames,
    jointNames: targetPayload.jointNames || {},
    localPositions: targetPayload.localPositions || [],
    localRotations: targetPayload.localRotations || [],
    worldRotations: targetPayload.worldRotations || [],
    restCenteredJoints: targetRest,
    drivenBones,
    leadFrames: padded.leadFrames,
    tailFrames: padded.tailFrames,
    stats: {
      mappedJoints: jointMap.length,
      drivenBones: drivenBones.length,
      medianBoneScale: globalBoneScale,
      legMode,
      neutralLoop: Boolean(options.neutralLoop),
      neutralLoopSeconds: Math.max(0.05, finiteNumber(options.neutralLoopSeconds, 0.45)),
      sleeveBarrier: Boolean(options.sleeveBarrier),
      sleeveBarrierWidth: finiteNumber(options.sleeveBarrierWidth, 0.16),
      sleeveBarrierStrength: finiteNumber(options.sleeveBarrierStrength, 1),
      sourceFrameCount: sourceFrames.length,
      sourceRestKind: sourcePayload.restCenteredJoints || sourcePayload.bindCenteredJoints ? "bind-pose" : "first-frame",
      targetRestKind: targetPayload.kind === "vrm-rest" ? "vrm-file" : "vnyan-live",
      targetAvatar: targetPayload.stats?.avatarName || "VNyan avatar",
      loopPaddingFrames: padded.frames.length - retargetedFrames.length,
    },
  };
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

function worldRotationsFromLocal(names, nameToIndex, localRotations) {
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
  for (const name of names) compose(name);
  return names.map((name) => world.get(name) || [0, 0, 0, 1]);
}

function spatialPayloadToClipFrames(spatialPayload, baseFrames = []) {
  const nameToIndex = indexByName(spatialPayload);
  const names = Object.keys(nameToIndex).sort((a, b) => nameToIndex[a] - nameToIndex[b]);
  const nameSet = new Set(names);
  const expectedLength = Math.max(...Object.values(nameToIndex)) + 1;
  const restFrame = (spatialPayload.restCenteredJoints || spatialPayload.centeredJoints?.[0] || []).map(finiteVector);
  while (restFrame.length < expectedLength) restFrame.push([0, 0, 0]);
  const localPositions = Array.from({ length: expectedLength }, (_, index) => finiteVector(spatialPayload.localPositions?.[index]));
  const localRotations = Array.from({ length: expectedLength }, (_, index) => normalizeQuat(spatialPayload.localRotations?.[index]));
  const worldRotations = names.map((name, orderIndex) => normalizeQuat(
    spatialPayload.worldRotations?.[nameToIndex[name]]
      || worldRotationsFromLocal(names, nameToIndex, localRotations)[orderIndex],
  ));
  const restWorldByName = new Map(names.map((name, index) => [name, worldRotations[index]]));
  const localPositionByName = new Map(names.map((name) => [name, localPositions[nameToIndex[name]]]));
  const localRotationByName = new Map(names.map((name) => [name, localRotations[nameToIndex[name]]]));
  const driven = new Set(spatialPayload.drivenBones || []);
  const sendOrder = VNYAN_BONE_ORDER.filter((name) => nameSet.has(name) && driven.has(name));
  const outputBones = sendOrder.filter((name) => MOTION_OUTPUT_BONES.has(name));
  const restBones = {};

  const frames = (spatialPayload.centeredJoints || []).map((rawFrame, frameIndex) => {
    const frame = rawFrame.map(finiteVector);
    while (frame.length < expectedLength) frame.push([0, 0, 0]);
    const targetWorldByName = new Map();
    const bones = Object.create(null);
    for (const name of sendOrder) {
      const index = nameToIndex[name];
      const restWorld = restWorldByName.get(name) || [0, 0, 0, 1];
      const childName = retargetChildForBone(name, nameSet);
      let localRotation;
      let targetWorld = restWorld;
      if (childName) {
        const childIndex = nameToIndex[childName];
        const restDirection = subtract(restFrame[childIndex], restFrame[index]);
        const targetDirection = subtract(frame[childIndex], frame[index]);
        const directionDelta = quatFromUnitVectors(restDirection, targetDirection);
        targetWorld = multiplyQuat(directionDelta, restWorld);
        const parentName = resolvePlaybackParent(name, nameSet);
        const parentWorld = parentName
          ? (targetWorldByName.get(parentName) || restWorldByName.get(parentName) || [0, 0, 0, 1])
          : [0, 0, 0, 1];
        localRotation = multiplyQuat(inverseQuat(parentWorld), targetWorld);
      } else {
        localRotation = localRotationByName.get(name) || [0, 0, 0, 1];
      }
      targetWorldByName.set(name, targetWorld);
      if (!outputBones.includes(name)) continue;
      const restLocal = localRotationByName.get(name) || [0, 0, 0, 1];
      const position = localPositionByName.get(name) || [0, 0, 0];
      const bone = {
        space: "vmc_world",
        qx: localRotation[0],
        qy: localRotation[1],
        qz: localRotation[2],
        qw: localRotation[3],
        restqx: restLocal[0],
        restqy: restLocal[1],
        restqz: restLocal[2],
        restqw: restLocal[3],
        restPx: position[0],
        restPy: position[1],
        restPz: position[2],
        px: position[0],
        py: position[1],
        pz: position[2],
      };
      bones[name] = bone;
      if (!restBones[name]) {
        restBones[name] = {
          qx: restLocal[0],
          qy: restLocal[1],
          qz: restLocal[2],
          qw: restLocal[3],
          px: position[0],
          py: position[1],
          pz: position[2],
        };
      }
    }
    const baseIndex = Math.max(0, Math.min(baseFrames.length - 1, frameIndex - Number(spatialPayload.leadFrames || 0)));
    const base = baseFrames[baseIndex] || {};
    return {
      ...base,
      bones,
      boneSpace: "vmc_world",
    };
  });

  return { frames, restBones, outputBones };
}

function alignOscOffset(offset) {
  return (offset + 3) & ~3;
}

function readOscString(buffer, offset, end = buffer.length) {
  let cursor = offset;
  while (cursor < end && buffer[cursor] !== 0) cursor += 1;
  if (cursor >= end) throw new Error("Invalid OSC string.");
  return { value: buffer.toString("utf8", offset, cursor), offset: alignOscOffset(cursor + 1) };
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
      args.push(buffer.readFloatBE(cursor));
      cursor += 4;
    } else if (tag === "i") {
      args.push(buffer.readInt32BE(cursor));
      cursor += 4;
    }
  }
  return [{ address: first.value, args }];
}

module.exports = {
  VNYAN_BONE_ORDER,
  buildVrmPayloadFromFile,
  buildVnyanPayloadFromBones,
  parseOscPacket,
  retargetSpatialPayload,
  spatialPayloadToClipFrames,
};
