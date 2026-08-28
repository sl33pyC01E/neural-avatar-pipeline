import * as THREE from "/vendor/three.module.js";
import { GLTFLoader } from "/vendor/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "/vendor/three-vrm.module.js";

const $ = (id) => document.getElementById(id);
const routeCanvas = $("route");
const ctx = routeCanvas.getContext("2d");
const state = {
  engine: "ardy",
  points: [{ x: 0, z: 0 }],
  scale: 120,
  centerX: 0,
  centerZ: 0.6,
  generating: false,
  playing: false,
  animationStart: 0,
  currentFrame: -1,
  motion: null,
  runtimeReady: { ardy: false, kimodo: false },
  liveActive: false,
  liveKeys: new Set(),
  liveSegments: [],
  liveStartedAt: 0,
  livePlaybackFrame: 0,
  liveMaxFrame: -1,
  liveReplanBufferFrames: 3,
  liveLatencyFrames: [],
  liveCommandDirty: false,
  liveFetching: false,
  liveRoot: { x: 0, z: 0 },
  liveGoal: { x: 0, z: 0 },
  exportMode: null,
  exportUrl: null,
  viewerMode: "vrm",
  vrm: null,
  vrmRig: null,
  avatarFile: "",
  avatarAlignment: null,
  bindMeta: null,
  skirtSpringJoints: [],
  skirtSpringsDisabled: false,
  bowSpringJoints: [],
  bowSpringsDisabled: false,
  hairSpringJoints: [],
  springSettings: new Map(),
  unifiedFaceTrack: null,
  unifiedFaceMorphs: [],
  unifiedPlayback: null,
  textCacheEntries: [],
  scheduleSlots: [{ time: 0, prompt: "walk naturally", cacheKey: "" }],
};
const configs = {
  ardy: { name: "ARDY", skin: "Core-27", fps: 20, duration: 3.2, steps: 4, maxSteps: 10, seconds: 0.7, color: "#57e6b1" },
  kimodo: { name: "Kimodo", skin: "SOMA-77", fps: 30, duration: 3, steps: 20, maxSteps: 100, seconds: 1.4, color: "#9c8cff" },
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x090d12);
scene.fog = new THREE.Fog(0x090d12, 5, 12);
const camera = new THREE.PerspectiveCamera(36, 1, 0.02, 50);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$("viewport").appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xbfd6e8, 0x121820, 2.3));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
keyLight.position.set(3, 5, 4);
keyLight.castShadow = true;
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x76ffd0, 1.8);
rimLight.position.set(-4, 2.5, -3);
scene.add(rimLight);
const grid = new THREE.GridHelper(12, 48, 0x405064, 0x1d2733);
grid.position.y = 0;
scene.add(grid);

const goalMarker = new THREE.Group();
const goalDisc = new THREE.Mesh(
  new THREE.CircleGeometry(0.18, 48),
  new THREE.MeshBasicMaterial({ color: configs.ardy.color, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }),
);
goalDisc.rotation.x = -Math.PI / 2;
goalDisc.position.y = 0.006;
const goalRing = new THREE.Mesh(
  new THREE.RingGeometry(0.18, 0.24, 48),
  new THREE.MeshBasicMaterial({ color: configs.ardy.color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }),
);
goalRing.rotation.x = -Math.PI / 2;
goalRing.position.y = 0.012;
const goalPin = new THREE.Mesh(
  new THREE.ConeGeometry(0.07, 0.18, 24),
  new THREE.MeshBasicMaterial({ color: configs.ardy.color }),
);
goalPin.position.y = 0.2;
goalPin.rotation.z = Math.PI;
goalMarker.add(goalDisc, goalRing, goalPin);
goalMarker.visible = false;
scene.add(goalMarker);

const groundRoute = new THREE.Group();
const groundRouteLine = new THREE.Line(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ color: configs.ardy.color, transparent: true, opacity: 0.32, depthWrite: false }),
);
const groundRoutePoints = new THREE.Points(
  new THREE.BufferGeometry(),
  new THREE.PointsMaterial({ color: configs.ardy.color, size: 0.045, transparent: true, opacity: 0.42, sizeAttenuation: true, depthWrite: false }),
);
groundRoute.add(groundRouteLine, groundRoutePoints);
scene.add(groundRoute);

let bodyMesh = null;
let bindPositions = null;
let orbit = { yaw: 0.72, pitch: 1.18, radius: 4.15, target: new THREE.Vector3(0, 0.9, 0) };
let drag = null;
const vrmLoader = new GLTFLoader();
vrmLoader.register((parser) => new VRMLoaderPlugin(parser));

const VRM_SOURCE_CHAINS = {
  hips: [0, 1], spine: [1, 2], chest: [2, 4], upperChest: [4, 5], neck: [5, 6],
  leftShoulder: [13, 14], leftUpperArm: [14, 15], leftLowerArm: [15, 16],
  rightShoulder: [7, 8], rightUpperArm: [8, 9], rightLowerArm: [9, 10],
  leftUpperLeg: [23, 24], leftLowerLeg: [24, 25], leftFoot: [25, 26],
  rightUpperLeg: [19, 20], rightLowerLeg: [20, 21], rightFoot: [21, 22],
};

const VRM_CHILDREN = {
  hips: "spine", spine: "chest", chest: "upperChest", upperChest: "neck", neck: "head",
  leftShoulder: "leftUpperArm", leftUpperArm: "leftLowerArm", leftLowerArm: "leftHand",
  rightShoulder: "rightUpperArm", rightUpperArm: "rightLowerArm", rightLowerArm: "rightHand",
  leftUpperLeg: "leftLowerLeg", leftLowerLeg: "leftFoot", leftFoot: "leftToes",
  rightUpperLeg: "rightLowerLeg", rightLowerLeg: "rightFoot", rightFoot: "rightToes",
};

// ARDY's Core-27 local rotations map cleanly onto Three-VRM's normalized
// humanoid. The chest has one fewer normalized bone, so preserve both source
// spine rotations by composing them onto the normalized chest.
const VRM_ROTATION_CHAINS = {
  hips: [0], spine: [1], chest: [2, 3], upperChest: [4], neck: [5], head: [6],
  rightShoulder: [7], rightUpperArm: [8], rightLowerArm: [9], rightHand: [10],
  leftShoulder: [13], leftUpperArm: [14], leftLowerArm: [15], leftHand: [16],
  rightUpperLeg: [19], rightLowerLeg: [20], rightFoot: [21], rightToes: [22],
  leftUpperLeg: [23], leftLowerLeg: [24], leftFoot: [25], leftToes: [26],
};

function makeBodyBasis(points, { left, right, root, head }) {
  const x = points[left].clone().sub(points[right]).normalize();
  const yRaw = points[head].clone().sub(points[root]).normalize();
  const z = new THREE.Vector3().crossVectors(x, yRaw).normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const matrix = new THREE.Matrix4().makeBasis(x, y, z);
  return { x, y, z, quaternion: new THREE.Quaternion().setFromRotationMatrix(matrix) };
}

function transformBetweenBases(vector, sourceBasis, targetBasis) {
  return targetBasis.x.clone().multiplyScalar(vector.dot(sourceBasis.x))
    .add(targetBasis.y.clone().multiplyScalar(vector.dot(sourceBasis.y)))
    .add(targetBasis.z.clone().multiplyScalar(vector.dot(sourceBasis.z)));
}

function captureVrmRig(vrm) {
  vrm.scene.position.set(0, 0, 0);
  vrm.scene.updateMatrixWorld(true);
  const rawBones = new Map();
  for (const name of new Set([...Object.keys(VRM_CHILDREN), ...Object.values(VRM_CHILDREN)])) {
    const node = vrm.humanoid.getRawBoneNode(name);
    if (!node) continue;
    rawBones.set(name, {
      node,
      restLocal: node.quaternion.clone(),
      restWorld: node.getWorldQuaternion(new THREE.Quaternion()),
      restPosition: node.getWorldPosition(new THREE.Vector3()),
    });
  }
  const required = ["hips", "head", "leftUpperArm", "rightUpperArm"];
  if (required.some((name) => !rawBones.has(name))) throw new Error("This VRM is missing required humanoid bones.");
  const normalizedBones = new Map();
  for (const name of Object.keys(VRM_ROTATION_CHAINS)) {
    const node = vrm.humanoid.getNormalizedBoneNode(name);
    if (!node) continue;
    normalizedBones.set(name, {
      node,
      restLocal: node.quaternion.clone(),
      restWorld: node.getWorldQuaternion(new THREE.Quaternion()),
      restPosition: node.getWorldPosition(new THREE.Vector3()),
    });
  }
  const targetPoints = Object.fromEntries([...normalizedBones].map(([name, bone]) => [name, bone.restPosition]));
  const targetBasis = makeBodyBasis(targetPoints, { left: "leftUpperArm", right: "rightUpperArm", root: "hips", head: "head" });
  const driveOrder = [
    "hips", "spine", "chest", "upperChest", "neck",
    "leftShoulder", "leftUpperArm", "leftLowerArm", "rightShoulder", "rightUpperArm", "rightLowerArm",
    "leftUpperLeg", "leftLowerLeg", "leftFoot", "rightUpperLeg", "rightLowerLeg", "rightFoot",
  ].filter((name) => rawBones.has(name) && rawBones.has(VRM_CHILDREN[name]));
  return { rawBones, normalizedBones, targetBasis, driveOrder };
}

function resetVrmPose() {
  if (!state.vrmRig || !state.vrm) return;
  for (const bone of state.vrmRig.normalizedBones.values()) bone.node.quaternion.copy(bone.restLocal);
  state.vrm.scene.position.set(0, -(state.avatarAlignment?.floorOffsetM || 0), 0);
  state.vrm.humanoid.update();
  state.vrm.scene.updateMatrixWorld(true);
}

function vrmRootHeight(rootPosition) {
  const rest = state.bindMeta?.restJoints;
  if (!Array.isArray(rest) || !Array.isArray(rootPosition)) return -(state.avatarAlignment?.floorOffsetM || 0);
  const sourceFloor = Math.min(...rest.map((point) => Number(point[1]) || 0));
  const sourceStandingHipHeight = (Number(rest[0]?.[1]) || 0) - sourceFloor;
  if (sourceStandingHipHeight <= 1e-5) return -(state.avatarAlignment?.floorOffsetM || 0);
  const targetHipHeight = Number(state.avatarAlignment?.hipsHeightM) || sourceStandingHipHeight;
  const avatarScale = targetHipHeight / sourceStandingHipHeight;
  const sourceVerticalDelta = (Number(rootPosition[1]) || sourceStandingHipHeight) - sourceStandingHipHeight;
  return -(state.avatarAlignment?.floorOffsetM || 0) + sourceVerticalDelta * avatarScale;
}

function quaternionFromRotationMatrix(values) {
  if (!Array.isArray(values) || values.length !== 3) return new THREE.Quaternion();
  const matrix = new THREE.Matrix4().set(
    values[0][0], values[0][1], values[0][2], 0,
    values[1][0], values[1][1], values[1][2], 0,
    values[2][0], values[2][1], values[2][2], 0,
    0, 0, 0, 1,
  );
  return new THREE.Quaternion().setFromRotationMatrix(matrix).normalize();
}

function applyVrmNormalizedJoints(joints, rootPosition = [0, 0, 0], localRotations = null) {
  if (!state.vrmRig || !state.vrm || !state.bindMeta?.restJoints || !Array.isArray(joints)) return false;
  const sourceRest = state.bindMeta.restJoints.map((point) => new THREE.Vector3(...point));
  const sourceFrame = joints.map((point) => new THREE.Vector3(...point));
  if (sourceFrame.length < 27) return false;
  const sourceRestBasis = makeBodyBasis(sourceRest, { left: 14, right: 8, root: 0, head: 6 });
  const sourceFrameBasis = makeBodyBasis(sourceFrame, { left: 14, right: 8, root: 0, head: 6 });
  const targetBasis = state.vrmRig.targetBasis;
  const basisMap = targetBasis.quaternion.clone().multiply(sourceRestBasis.quaternion.clone().invert());
  const bodyDelta = basisMap.clone()
    .multiply(sourceFrameBasis.quaternion.clone().multiply(sourceRestBasis.quaternion.clone().invert()))
    .multiply(basisMap.clone().invert());

  for (const bone of state.vrmRig.normalizedBones.values()) bone.node.quaternion.copy(bone.restLocal);
  state.vrm.scene.position.set(Number(rootPosition?.[0]) || 0, vrmRootHeight(rootPosition), Number(rootPosition?.[2]) || 0);
  state.vrm.scene.updateMatrixWorld(true);

  for (const name of state.vrmRig.driveOrder) {
    const bone = state.vrmRig.normalizedBones.get(name);
    const child = state.vrmRig.normalizedBones.get(VRM_CHILDREN[name]);
    if (!bone || !child) continue;
    let desiredWorld;
    if (name === "hips") {
      desiredWorld = bodyDelta.clone().multiply(bone.restWorld);
    } else {
      const [sourceParent, sourceChild] = VRM_SOURCE_CHAINS[name];
      const desiredDirection = transformBetweenBases(
        sourceFrame[sourceChild].clone().sub(sourceFrame[sourceParent]),
        sourceRestBasis,
        targetBasis,
      ).normalize();
      const targetRestDirection = child.restPosition.clone().sub(bone.restPosition).normalize();
      // Preserve the root/body facing on every bone before solving its swing.
      // A segment direction alone has no twist information (especially for the
      // nearly vertical spine), so solving from the unrotated rest direction
      // made the spine cancel a 180-degree hips turn on the first driven frame.
      const bodyRestDirection = targetRestDirection.clone().applyQuaternion(bodyDelta).normalize();
      const directionalCorrection = new THREE.Quaternion().setFromUnitVectors(bodyRestDirection, desiredDirection);
      desiredWorld = directionalCorrection
        .multiply(bodyDelta.clone().multiply(bone.restWorld));
    }
    bone.node.parent.updateWorldMatrix(true, false);
    const parentWorld = bone.node.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.node.quaternion.copy(parentWorld.invert().multiply(desiredWorld)).normalize();
    bone.node.updateWorldMatrix(false, true);
  }

  // A position-only skeleton has no segment after the head from which to infer
  // its orientation. Recover it from ARDY's accumulated spine/neck/head
  // rotations and express that world-space delta in the avatar's rest basis.
  if (Array.isArray(localRotations) && localRotations.length > 6) {
    const head = state.vrmRig.normalizedBones.get("head");
    if (head) {
      const sourceHeadWorld = new THREE.Quaternion();
      for (let sourceIndex = 0; sourceIndex <= 6; sourceIndex += 1) {
        sourceHeadWorld.multiply(quaternionFromRotationMatrix(localRotations[sourceIndex]));
      }
      const mappedHeadDelta = basisMap.clone().multiply(sourceHeadWorld).multiply(basisMap.clone().invert());
      const desiredHeadWorld = mappedHeadDelta.multiply(head.restWorld);
      head.node.parent.updateWorldMatrix(true, false);
      const parentWorld = head.node.parent.getWorldQuaternion(new THREE.Quaternion());
      head.node.quaternion.copy(parentWorld.invert().multiply(desiredHeadWorld)).normalize();
      head.node.updateWorldMatrix(false, true);
    }
  }
  state.vrm.humanoid.update();
  state.vrm.scene.updateMatrixWorld(true);
  return true;
}

function applyVrmFrame(joints, rootPosition = [0, 0, 0], localRotations = null) {
  if (applyVrmNormalizedJoints(joints, rootPosition, localRotations)) return;
  if (!state.vrmRig || !state.vrm || !state.bindMeta?.restJoints || !Array.isArray(joints)) return;
  const sourceRest = state.bindMeta.restJoints.map((point) => new THREE.Vector3(...point));
  const sourceFrame = joints.map((point) => new THREE.Vector3(...point));
  if (sourceFrame.length < 27) return;
  const sourceRestBasis = makeBodyBasis(sourceRest, { left: 14, right: 8, root: 0, head: 6 });
  const sourceFrameBasis = makeBodyBasis(sourceFrame, { left: 14, right: 8, root: 0, head: 6 });
  const targetBasis = state.vrmRig.targetBasis;
  const basisMap = targetBasis.quaternion.clone().multiply(sourceRestBasis.quaternion.clone().invert());
  const bodyDelta = basisMap.clone()
    .multiply(sourceFrameBasis.quaternion.clone().multiply(sourceRestBasis.quaternion.clone().invert()))
    .multiply(basisMap.clone().invert());

  for (const bone of state.vrmRig.rawBones.values()) bone.node.quaternion.copy(bone.restLocal);
  state.vrm.scene.position.set(Number(rootPosition?.[0]) || 0, vrmRootHeight(rootPosition), Number(rootPosition?.[2]) || 0);
  state.vrm.scene.updateMatrixWorld(true);

  for (const name of state.vrmRig.driveOrder) {
    const bone = state.vrmRig.rawBones.get(name);
    let desiredWorld;
    if (name === "hips") {
      desiredWorld = bodyDelta.clone().multiply(bone.restWorld);
    } else {
      const [sourceParent, sourceChild] = VRM_SOURCE_CHAINS[name];
      const restDirection = transformBetweenBases(sourceRest[sourceChild].clone().sub(sourceRest[sourceParent]), sourceRestBasis, targetBasis).normalize();
      const frameDirection = transformBetweenBases(sourceFrame[sourceChild].clone().sub(sourceFrame[sourceParent]), sourceRestBasis, targetBasis).normalize();
      const bodyRestDirection = restDirection.clone().applyQuaternion(bodyDelta).normalize();
      const directionDelta = new THREE.Quaternion().setFromUnitVectors(bodyRestDirection, frameDirection);
      desiredWorld = directionDelta.multiply(bodyDelta.clone().multiply(bone.restWorld));
    }
    bone.node.parent.updateWorldMatrix(true, false);
    const parentWorld = bone.node.parent.getWorldQuaternion(new THREE.Quaternion());
    bone.node.quaternion.copy(parentWorld.invert().multiply(desiredWorld));
    bone.node.updateWorldMatrix(false, true);
  }
}

function clearUnifiedFace() {
  const expression = state.vrm?.expressionManager;
  expression?.resetValues();
  for (const { mesh } of state.unifiedFaceMorphs) if (mesh.morphTargetInfluences) mesh.morphTargetInfluences.fill(0);
  expression?.update();
}

function applyUnifiedFaceFrame(track, values, time) {
  if (!state.vrm || !track || !Array.isArray(values)) return;
  const expression = state.vrm.expressionManager;
  expression?.resetValues();
  for (const { mesh } of state.unifiedFaceMorphs) if (mesh.morphTargetInfluences) mesh.morphTargetInfluences.fill(0);
  const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));
  const mouth = (value) => clamp(value * (Number(track.scales?.mouth) || 1));
  const eyes = (value) => clamp(value * (Number(track.scales?.eyes) || 1));
  const names = Array.isArray(track.names) ? track.names : [];
  const source = new Map(names.map((name, index) => [String(name), clamp(values[index])]));
  const get = (name) => source.get(name) || 0;
  const setMorph = (name, weight) => {
    const key = String(name).toLowerCase();
    for (const { mesh, lookup } of state.unifiedFaceMorphs) {
      const index = lookup.get(key);
      if (index !== undefined && mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = Math.max(mesh.morphTargetInfluences[index] || 0, clamp(weight));
    }
  };
  const setExpression = (name, weight) => expression?.setValue(name, clamp(weight));
  const setVowels = ({ aa, ih, ou, E, oh }) => {
    for (const [name, weight] of Object.entries({ aa, ih, ou, E, oh })) setMorph(`VRC_v_${name}`, mouth(weight));
    setExpression('aa', mouth(aa)); setExpression('ih', mouth(ih)); setExpression('ou', mouth(ou)); setExpression('ee', mouth(E)); setExpression('oh', mouth(oh));
  };
  let blinkLeft = 0;
  let blinkRight = 0;
  const pair = (left, right) => (get(left) + get(right)) * 0.5;
  const jaw = get('jawOpen');
  const funnel = get('mouthFunnel');
  const pucker = get('mouthPucker');
  const stretch = pair('mouthStretchLeft', 'mouthStretchRight');
  const smile = pair('mouthSmileLeft', 'mouthSmileRight');
  const press = pair('mouthPressLeft', 'mouthPressRight');
  const lower = pair('mouthLowerDownLeft', 'mouthLowerDownRight');
  const weights = {
    PP: Math.max(press, get('mouthClose') * 0.75), FF: lower * 0.58, TH: get('tongueOut'), DD: Math.min(jaw, 0.42) * 0.45,
    kk: get('mouthShrugLower') * 0.42, CH: funnel * 0.5, SS: stretch * 0.48, nn: get('mouthRollUpper') * 0.48,
    RR: get('mouthShrugUpper') * 0.45, aa: jaw * (1 - Math.max(funnel, pucker) * 0.7), E: Math.max(stretch * 0.68, lower * 0.28),
    ih: Math.max(smile * 0.58, stretch * 0.45), oh: Math.max(funnel * 0.82, jaw * funnel), ou: pucker,
  };
  setVowels(weights);
  for (const [name, weight] of Object.entries(weights)) setMorph(`VRC_v_${name}`, mouth(weight));
  blinkLeft = get('eyeBlinkLeft'); blinkRight = get('eyeBlinkRight');
  setMorph('EyeWideLeft', eyes(get('eyeWideLeft'))); setMorph('EyeWideRight', eyes(get('eyeWideRight')));
  setMorph('EyeShrinkLeft', eyes(get('eyeSquintLeft'))); setMorph('EyeShrinkRight', eyes(get('eyeSquintRight')));
  setMorph('BrowDownLeft', get('browDownLeft')); setMorph('BrowDownRight', get('browDownRight'));
  setMorph('BrowRiseLeft', get('browOuterUpLeft')); setMorph('BrowRiseRight', get('browOuterUpRight'));
  setMorph('BrowInnerLeft', get('browInnerUp')); setMorph('BrowInnerRight', get('browInnerUp'));
  setMorph('MouthSmile', smile); setMorph('MouthTrouble', pair('mouthFrownLeft', 'mouthFrownRight'));
  const lookLeft = pair('eyeLookOutLeft', 'eyeLookInRight');
  const lookRight = pair('eyeLookInLeft', 'eyeLookOutRight');
  setExpression('lookLeft', eyes(lookLeft)); setExpression('lookRight', eyes(lookRight));
  setExpression('lookUp', eyes(pair('eyeLookUpLeft', 'eyeLookUpRight'))); setExpression('lookDown', eyes(pair('eyeLookDownLeft', 'eyeLookDownRight')));
  let proceduralBlink = 0;
  if (track.naturalMotion) {
    const cycle = time % 7.4;
    const blinkPulse = (center) => Math.exp(-Math.pow((cycle - center) / 0.085, 2));
    proceduralBlink = Math.max(blinkPulse(2.15), blinkPulse(5.85));
    const gazeX = Math.sin(time * 0.53) * 0.32 + Math.sin(time * 1.37 + 0.8) * 0.08;
    const gazeY = Math.sin(time * 0.37 + 1.2) * 0.18;
    setExpression(gazeX < 0 ? 'lookLeft' : 'lookRight', eyes(Math.abs(gazeX)));
    setExpression(gazeY < 0 ? 'lookDown' : 'lookUp', eyes(Math.abs(gazeY)));
  }
  setExpression('blinkLeft', eyes(Math.max(blinkLeft, proceduralBlink)));
  setExpression('blinkRight', eyes(Math.max(blinkRight, proceduralBlink)));
  expression?.update();
}

function setViewerMode(mode) {
  const useVrm = mode === "vrm" && state.engine === "ardy" && state.vrm;
  state.viewerMode = useVrm ? "vrm" : "skin";
  if (bodyMesh) bodyMesh.visible = state.viewerMode === "skin";
  if (state.vrm) state.vrm.scene.visible = state.viewerMode === "vrm";
  $("viewer-vrm").classList.toggle("active", state.viewerMode === "vrm");
  $("viewer-skin").classList.toggle("active", state.viewerMode === "skin");
  $("mesh-label").textContent = state.viewerMode === "vrm"
    ? `${state.avatarAlignment?.avatar || "VRM"} · direct`
    : `${configs[state.engine].name} ${configs[state.engine].skin}`;
  state.currentFrame = -1;
}

function setDressPhysicsSafe(safe) {
  const manager = state.vrm?.springBoneManager;
  if (!manager || !state.skirtSpringJoints.length) return;
  if (safe && !state.skirtSpringsDisabled) {
    for (const joint of state.skirtSpringJoints) {
      joint.reset();
      manager.deleteJoint(joint);
      joint.bone.matrixAutoUpdate = true;
      joint.bone.updateMatrix();
    }
    state.skirtSpringsDisabled = true;
    manager.setInitState();
  } else if (!safe && state.skirtSpringsDisabled) {
    for (const joint of state.skirtSpringJoints) {
      joint.bone.matrixAutoUpdate = false;
      manager.addJoint(joint);
    }
    state.skirtSpringsDisabled = false;
    manager.setInitState();
  }
}

function setAccessoryPhysicsSafe(safe) {
  const manager = state.vrm?.springBoneManager;
  if (!manager) return;
  if (safe && !state.bowSpringsDisabled) {
    for (const joint of state.bowSpringJoints) {
      joint.reset();
      manager.deleteJoint(joint);
      joint.bone.matrixAutoUpdate = true;
      joint.bone.updateMatrix();
    }
    state.bowSpringsDisabled = true;
  } else if (!safe && state.bowSpringsDisabled) {
    for (const joint of state.bowSpringJoints) {
      joint.bone.matrixAutoUpdate = false;
      manager.addJoint(joint);
    }
    state.bowSpringsDisabled = false;
  }
  for (const joint of state.hairSpringJoints) {
    const original = state.springSettings.get(joint);
    if (!original) continue;
    joint.settings.dragForce = safe ? Math.max(0.95, original.dragForce) : original.dragForce;
    joint.settings.stiffness = safe ? Math.max(1.35, original.stiffness) : original.stiffness;
    joint.settings.gravityPower = original.gravityPower + Number($("hair-weight").value);
    joint.settings.gravityDir.set(0, -1, 0);
  }
  manager.setInitState();
}

async function loadDirectVrm(file) {
  if (state.vrm && state.avatarFile === file) return state.vrm;
  const gltf = await vrmLoader.loadAsync(`/avatars/${encodeURIComponent(file)}?fresh=${Date.now()}`);
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error("The selected file did not load as a VRM avatar.");
  VRMUtils.rotateVRM0(vrm);
  vrm.humanoid.autoUpdateHumanBones = true;
  vrm.scene.traverse((object) => {
    if (object.isMesh) { object.castShadow = true; object.receiveShadow = true; object.frustumCulled = false; }
  });
  if (state.vrm) {
    scene.remove(state.vrm.scene);
    VRMUtils.deepDispose(state.vrm.scene);
  }
  state.vrm = vrm;
  state.avatarFile = file;
  state.unifiedFaceMorphs = [];
  vrm.scene.traverse((object) => {
    if (object.morphTargetDictionary && object.morphTargetInfluences) {
      state.unifiedFaceMorphs.push({ mesh: object, lookup: new Map(Object.entries(object.morphTargetDictionary).map(([name, index]) => [name.toLowerCase(), index])) });
    }
  });
  state.skirtSpringJoints = vrm.springBoneManager
    ? [...vrm.springBoneManager.joints].filter((joint) => /^Skirt_/i.test(joint.bone?.name || ""))
    : [];
  state.skirtSpringsDisabled = false;
  state.bowSpringJoints = vrm.springBoneManager
    ? [...vrm.springBoneManager.joints].filter((joint) => /^ChestAccess_/i.test(joint.bone?.name || ""))
    : [];
  state.hairSpringJoints = vrm.springBoneManager
    ? [...vrm.springBoneManager.joints].filter((joint) => /^Hair/i.test(joint.bone?.name || ""))
    : [];
  state.springSettings = new Map(
    vrm.springBoneManager
      ? [...vrm.springBoneManager.joints].map((joint) => [joint, { ...joint.settings }])
      : [],
  );
  state.bowSpringsDisabled = false;
  scene.add(vrm.scene);
  state.vrmRig = captureVrmRig(vrm);
  setDressPhysicsSafe($("dress-safe").checked);
  setAccessoryPhysicsSafe($("accessory-safe").checked);
  resetVrmPose();
  setViewerMode("vrm");
  return vrm;
}

function updateCamera() {
  const sinPitch = Math.sin(orbit.pitch);
  camera.position.set(
    orbit.target.x + orbit.radius * sinPitch * Math.sin(orbit.yaw),
    orbit.target.y + orbit.radius * Math.cos(orbit.pitch),
    orbit.target.z + orbit.radius * sinPitch * Math.cos(orbit.yaw),
  );
  camera.lookAt(orbit.target);
}

function resetView() {
  orbit = { yaw: 0.72, pitch: 1.18, radius: 4.15, target: new THREE.Vector3(0, 0.9, 0) };
  updateCamera();
}

async function loadBindMesh(engine) {
  const [metaResponse, binaryResponse] = await Promise.all([
    fetch(`/motion-assets/${engine}.mesh.json`, { cache: "no-store" }),
    fetch(`/motion-assets/${engine}.meshbin`),
  ]);
  if (!metaResponse.ok || !binaryResponse.ok) throw new Error(`Could not load the ${engine} project skin.`);
  const meta = await metaResponse.json();
  state.bindMeta = meta;
  const buffer = await binaryResponse.arrayBuffer();
  const positions = new Float32Array(buffer, 0, meta.vertexCount * 3);
  const indices = new Uint32Array(buffer, meta.indexByteOffset, meta.faceCount * 3);
  const geometry = new THREE.BufferGeometry();
  bindPositions = new Float32Array(positions);
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  if (bodyMesh) {
    scene.remove(bodyMesh);
    bodyMesh.geometry.dispose();
    bodyMesh.material.dispose();
  }
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(configs[engine].color),
    roughness: 0.68,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });
  bodyMesh = new THREE.Mesh(geometry, material);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  bodyMesh.frustumCulled = false;
  scene.add(bodyMesh);
  bodyMesh.visible = state.viewerMode === "skin" || engine !== "ardy";
  state.motion = null;
  state.playing = false;
  state.currentFrame = -1;
  $("frame-label").textContent = "Bind pose";
  if (state.viewerMode === "skin" || engine !== "ardy") $("mesh-label").textContent = `${configs[engine].name} ${configs[engine].skin}`;
}

async function loadGeneratedMesh(motion) {
  state.motion = await fetchGeneratedMotionData(motion);
  state.vrm?.springBoneManager?.reset();
  state.animationStart = performance.now();
  state.currentFrame = -1;
  state.playing = true;
  $("pause").textContent = "Pause";
  publishMotionTrack();
}

async function fetchGeneratedMotionData(motion) {
  const response = await fetch(motion.meshFramesUrl, { cache: "no-store" });
  if (!response.ok) throw new Error("The generated skin animation could not be loaded.");
  const buffer = await response.arrayBuffer();
  const expected = motion.frames * motion.meshVertexCount * 3;
  const vertices = new Float32Array(buffer);
  if (vertices.length !== expected) throw new Error(`Unexpected mesh animation size (${vertices.length} vs ${expected}).`);
  return {
    vertices,
    frames: motion.frames,
    fps: motion.fps,
    vertexCount: motion.meshVertexCount,
    joints: motion.centeredJoints || [],
    rootPositions: motion.rootPositions || [],
    rotations: motion.localRotations || [],
  };
}

function installGeneratedMotion(motion) {
  state.motion = motion;
  state.vrm?.springBoneManager?.reset();
  state.animationStart = performance.now();
  state.currentFrame = -1;
  state.playing = true;
  $("pause").textContent = "Pause";
  publishMotionTrack();
}

function publishMotionTrack() {
  if (!state.motion || window.parent === window) return;
  window.parent.postMessage({ type: 'unified:motion-track', track: {
    id: `motion-${Date.now()}`,
    name: 'ARDY generated motion',
    engine: 'ardy',
    frames: state.motion.frames,
    fps: state.motion.fps,
    duration: state.motion.frames / state.motion.fps,
    playback: {
      frames: state.motion.frames,
      fps: state.motion.fps,
      joints: state.motion.joints,
      rootPositions: state.motion.rootPositions,
      rotations: state.motion.rotations,
    },
  } }, '*');
}

function resizeViewport() {
  const rect = $("viewport").getBoundingClientRect();
  renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
  camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
  camera.updateProjectionMatrix();
}

let lastRenderAt = performance.now();

function liveFrameAt(frame) {
  for (let index = state.liveSegments.length - 1; index >= 0; index -= 1) {
    const segment = state.liveSegments[index];
    if (frame >= segment.startFrame && frame < segment.startFrame + segment.frames) {
      return { segment, localFrame: frame - segment.startFrame };
    }
  }
  return null;
}

function interpolateJoints(first, second, alpha) {
  if (!Array.isArray(second) || alpha <= 0) return first;
  return first.map((joint, jointIndex) => joint.map((value, axis) => (
    value + (second[jointIndex][axis] - value) * alpha
  )));
}

function interpolateRoot(first, second, alpha) {
  if (!Array.isArray(second) || alpha <= 0) return first;
  return first.map((value, axis) => value + (second[axis] - value) * alpha);
}

function interpolateHeadRotations(first, second, alpha) {
  if (!Array.isArray(first) || !Array.isArray(second) || alpha <= 0) return first;
  return first.map((matrix, jointIndex) => {
    if (jointIndex > 6) return matrix;
    const quaternion = quaternionFromRotationMatrix(matrix);
    quaternion.slerp(quaternionFromRotationMatrix(second[jointIndex]), alpha);
    const elements = new THREE.Matrix4().makeRotationFromQuaternion(quaternion).elements;
    return [
      [elements[0], elements[4], elements[8]],
      [elements[1], elements[5], elements[9]],
      [elements[2], elements[6], elements[10]],
    ];
  });
}

function animate(now) {
  requestAnimationFrame(animate);
  const deltaSeconds = Math.min(0.05, Math.max(0, (now - lastRenderAt) / 1000));
  lastRenderAt = now;
  if (goalMarker.visible) {
    const pulse = 1 + 0.12 * (0.5 + 0.5 * Math.sin(now * 0.004));
    goalRing.scale.setScalar(pulse);
    goalDisc.material.opacity = 0.16 + 0.08 * (0.5 + 0.5 * Math.sin(now * 0.004));
  }
  if (state.unifiedPlayback && (bodyMesh || state.vrm)) {
    const playback = state.unifiedPlayback;
    const elapsed = Math.max(0, (now - playback.startedAt) / 1000);
    const motionTime = elapsed - playback.motionOffset;
    if (state.motion && motionTime >= 0) {
      const motionFrame = Math.min(state.motion.frames - 1, Math.floor(motionTime * state.motion.fps));
      if (motionFrame !== playback.motionFrame) {
        playback.motionFrame = motionFrame;
        if (state.viewerMode === 'vrm' && state.vrmRig && state.motion.joints[motionFrame]) {
          applyVrmFrame(state.motion.joints[motionFrame], state.motion.rootPositions[motionFrame], state.motion.rotations[motionFrame]);
        } else if (bodyMesh) {
          const start = motionFrame * state.motion.vertexCount * 3;
          bodyMesh.geometry.attributes.position.array.set(state.motion.vertices.subarray(start, start + state.motion.vertexCount * 3));
          bodyMesh.geometry.attributes.position.needsUpdate = true;
          if (motionFrame % 2 === 0) bodyMesh.geometry.computeVertexNormals();
        }
        $("frame-label").textContent = `Unified · body ${motionFrame + 1} / ${state.motion.frames}`;
      }
    }
    const faceTime = elapsed - playback.faceOffset;
    const faceTrack = state.unifiedFaceTrack;
    if (faceTrack && faceTime >= 0 && faceTime < faceTrack.duration) {
      const faceFrame = Math.min(faceTrack.frames.length - 1, Math.floor(faceTime * faceTrack.fps));
      if (faceFrame !== playback.faceFrame) {
        playback.faceFrame = faceFrame;
        applyUnifiedFaceFrame(faceTrack, faceTrack.frames[faceFrame], faceTime);
      }
      playback.faceCleared = false;
    } else if (!playback.faceCleared) {
      clearUnifiedFace();
      playback.faceCleared = true;
    }
    if (elapsed >= playback.totalDuration) {
      state.unifiedPlayback = null;
      clearUnifiedFace();
      window.parent.postMessage({ type: 'unified:playback-ended' }, '*');
    }
  } else if (state.liveActive && (bodyMesh || state.vrm)) {
    if (state.liveStartedAt && state.liveSegments.length) {
      const exactFrame = Math.min(((now - state.liveStartedAt) / 1000) * configs.ardy.fps, state.liveMaxFrame);
      const frame = Math.floor(exactFrame);
      const alpha = exactFrame - frame;
      state.livePlaybackFrame = Math.max(0, frame);
      const current = liveFrameAt(frame);
      const next = liveFrameAt(Math.min(frame + 1, state.liveMaxFrame)) || current;
      if (current) {
        const currentJoints = current.segment.joints[current.localFrame];
        const nextJoints = next.segment.joints[next.localFrame];
        const currentRoot = current.segment.rootPositions[current.localFrame];
        const nextRoot = next.segment.rootPositions[next.localFrame];
        if (state.viewerMode === "vrm" && state.vrmRig) {
          const currentRotations = current.segment.rotations[current.localFrame];
          const nextRotations = next.segment.rotations[next.localFrame];
          applyVrmFrame(
            interpolateJoints(currentJoints, nextJoints, alpha),
            interpolateRoot(currentRoot, nextRoot, alpha),
            interpolateHeadRotations(currentRotations, nextRotations, alpha),
          );
        } else if (bodyMesh) {
          const target = bodyMesh.geometry.attributes.position.array;
          const firstStart = current.localFrame * current.segment.vertexCount * 3;
          const secondStart = next.localFrame * next.segment.vertexCount * 3;
          const first = current.segment.vertices;
          const second = next.segment.vertices;
          for (let index = 0; index < target.length; index += 1) {
            target[index] = first[firstStart + index] + (second[secondStart + index] - first[firstStart + index]) * alpha;
          }
          bodyMesh.geometry.attributes.position.needsUpdate = true;
          if (frame !== state.currentFrame && frame % 2 === 0) bodyMesh.geometry.computeVertexNormals();
        }
        const root = interpolateRoot(currentRoot, nextRoot, alpha);
        if (root) {
          state.liveRoot = { x: root[0], z: root[2] };
          if ($("live-camera-follow").checked) {
            const followAlpha = Math.min(1, deltaSeconds * 5);
            const followX = state.liveRoot.x + (state.liveGoal.x - state.liveRoot.x) * 0.35;
            const followZ = state.liveRoot.z + (state.liveGoal.z - state.liveRoot.z) * 0.35;
            orbit.target.x += (followX - orbit.target.x) * followAlpha;
            orbit.target.z += (followZ - orbit.target.z) * followAlpha;
            updateCamera();
          }
        }
        if (frame !== state.currentFrame) {
          state.currentFrame = frame;
          $("frame-label").textContent = `LIVE · frame ${frame + 1}`;
          liveCommandChanged(false);
          state.liveSegments = state.liveSegments.filter((segment) => (
            segment.startFrame + segment.frames > frame
          ));
        }
      }
      const triggerFrames = Math.max(4, state.liveReplanBufferFrames);
      if (state.liveMaxFrame - state.livePlaybackFrame <= triggerFrames) requestLiveSegment(false);
    }
  } else if (state.playing && state.motion && (bodyMesh || state.vrm)) {
    const frame = Math.floor(((now - state.animationStart) / 1000) * state.motion.fps) % state.motion.frames;
    if (frame !== state.currentFrame) {
      if (state.viewerMode === "vrm" && state.vrmRig && state.motion.joints[frame]) {
        applyVrmFrame(state.motion.joints[frame], state.motion.rootPositions[frame], state.motion.rotations[frame]);
      } else if (bodyMesh) {
        const start = frame * state.motion.vertexCount * 3;
        bodyMesh.geometry.attributes.position.array.set(state.motion.vertices.subarray(start, start + state.motion.vertexCount * 3));
        bodyMesh.geometry.attributes.position.needsUpdate = true;
        if (frame % 2 === 0) bodyMesh.geometry.computeVertexNormals();
      }
      state.currentFrame = frame;
      $("frame-label").textContent = `Frame ${frame + 1} / ${state.motion.frames}`;
      $("timeline-fill").style.width = `${((frame + 1) / state.motion.frames) * 100}%`;
    }
  }
  if (state.vrm) state.vrm.update(deltaSeconds);
  renderer.render(scene, camera);
}

function distance() {
  let total = 0;
  for (let i = 1; i < state.points.length; i += 1) total += Math.hypot(state.points[i].x - state.points[i - 1].x, state.points[i].z - state.points[i - 1].z);
  return total;
}

function worldToScreen(point) {
  return { x: routeCanvas.width / 2 + (point.x - state.centerX) * state.scale, y: routeCanvas.height / 2 - (point.z - state.centerZ) * state.scale };
}

function screenToWorld(x, y) {
  return { x: state.centerX + (x - routeCanvas.width / 2) / state.scale, z: state.centerZ - (y - routeCanvas.height / 2) / state.scale };
}

function resizeRoute() {
  const rect = routeCanvas.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  routeCanvas.width = Math.round(rect.width * dpr);
  routeCanvas.height = Math.round(rect.height * dpr);
  state.scale = 105 * dpr;
  drawRoute();
}

function drawGrid() {
  ctx.fillStyle = "#090d12";
  ctx.fillRect(0, 0, routeCanvas.width, routeCanvas.height);
  const spacing = state.scale * 0.25;
  const origin = worldToScreen({ x: 0, z: 0 });
  ctx.lineWidth = 1;
  for (let x = origin.x % spacing; x < routeCanvas.width; x += spacing) {
    ctx.strokeStyle = Math.abs(x - origin.x) < 1 ? "#3b4654" : "#1a222d";
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, routeCanvas.height); ctx.stroke();
  }
  for (let y = origin.y % spacing; y < routeCanvas.height; y += spacing) {
    ctx.strokeStyle = Math.abs(y - origin.y) < 1 ? "#3b4654" : "#1a222d";
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(routeCanvas.width, y); ctx.stroke();
  }
}

function drawRoute() {
  drawGrid();
  const color = configs[state.engine].color;
  const points = state.points.map(worldToScreen);
  if (points.length > 1) {
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = `${color}14`; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y); points.slice(1).forEach((p) => ctx.lineTo(p.x, p.y)); ctx.stroke();
    ctx.strokeStyle = `${color}99`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y); points.slice(1).forEach((p) => ctx.lineTo(p.x, p.y)); ctx.stroke();
  }
  points.forEach((point, index) => {
    ctx.fillStyle = index === points.length - 1 ? `${color}bb` : "#111821";
    ctx.strokeStyle = `${color}99`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(point.x, point.y, index === points.length - 1 ? 6 : 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  });
  updateGroundRoute();
  updateGoalMarker();
  updateReadouts();
  saveArdyWorkspace();
}

function updateGroundRoute() {
  groundRoute.visible = !state.liveActive && state.points.length > 1;
  const positions = new Float32Array(state.points.flatMap((point) => [point.x, 0.018, point.z]));
  groundRouteLine.geometry.dispose();
  groundRoutePoints.geometry.dispose();
  groundRouteLine.geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(positions, 3));
  groundRoutePoints.geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  const color = new THREE.Color(configs[state.engine].color);
  groundRouteLine.material.color.copy(color);
  groundRoutePoints.material.color.copy(color);
}

function updateGoalMarker() {
  const hasGoal = state.liveActive || state.points.length > 1;
  goalMarker.visible = state.liveActive || (hasGoal && $("endpoint-enabled").checked);
  if (!goalMarker.visible) return;
  const goal = state.liveActive ? state.liveGoal : state.points.at(-1);
  goalMarker.position.set(goal.x, 0, goal.z);
  const color = new THREE.Color(configs[state.engine].color);
  goalDisc.material.color.copy(color);
  goalRing.material.color.copy(color);
  goalPin.material.color.copy(color);
}

function updateReadouts(preserveStatus = false) {
  const routeDistance = distance();
  const cfg = configs[state.engine];
  const duration = Number($("duration").value);
  const frames = Math.round(duration * cfg.fps);
  $("distance").textContent = `${routeDistance.toFixed(2)} m`;
  $("path-stat").textContent = `${routeDistance.toFixed(2)} m`;
  $("point-count").textContent = `${state.points.length} waypoint${state.points.length === 1 ? "" : "s"}`;
  $("frames-stat").textContent = frames;
  $("duration-label").textContent = `${duration.toFixed(1)}s`;
  $("timeline-label").textContent = `Route fills ${duration.toFixed(1)} seconds`;
  if (!state.motion) $("timeline-fill").style.width = state.points.length > 1 ? "100%" : "0";
  $("route-empty").style.display = state.points.length > 1 ? "none" : "grid";
  $("generate").disabled = state.points.length < 2 || state.generating || state.liveActive;
  if (!preserveStatus && !state.generating && !state.liveActive) $("status").textContent = state.points.length < 2 ? "Add at least one path segment, then generate." : `${state.points.length} waypoints ready for ${cfg.name}.`;
}

function move(key, fast = false) {
  const step = Number($("step").value) * (fast ? 4 : 1);
  const next = { ...state.points.at(-1) };
  if (key === "w") next.z += step;
  if (key === "s") next.z -= step;
  if (key === "a") next.x -= step;
  if (key === "d") next.x += step;
  state.points.push(next);
  drawRoute();
  const element = document.querySelector(`.key[data-key="${key}"]`);
  element?.classList.add("active");
  setTimeout(() => element?.classList.remove("active"), 90);
}

function fitRoute() {
  const xs = state.points.map((point) => point.x);
  const zs = state.points.map((point) => point.z);
  state.centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  state.centerZ = (Math.min(...zs) + Math.max(...zs)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 1);
  state.scale = Math.min(routeCanvas.width, routeCanvas.height) * 0.68 / span;
  drawRoute();
}

async function setEngine(engine) {
  if (state.liveActive && engine !== "ardy") stopLive();
  state.engine = engine;
  const cfg = configs[engine];
  document.documentElement.style.setProperty("--accent", cfg.color);
  document.querySelectorAll(".engine").forEach((element) => element.classList.toggle("active", element.dataset.engine === engine));
  $("engine-chip").textContent = cfg.name;
  $("duration").value = cfg.duration;
  $("steps").max = cfg.maxSteps;
  $("steps").value = cfg.steps;
  $("steps-out").textContent = cfg.steps;
  $("duration-out").textContent = `${cfg.duration.toFixed(1)} s`;
  $("speed-stat").textContent = `~${cfg.seconds.toFixed(1)} s`;
  $("llm-detail").textContent = "Shared 4-bit LLM2Vec · cached";
  $("live-toggle").disabled = engine !== "ardy";
  $("viewer-vrm").disabled = engine !== "ardy" || !state.vrm;
  $("live-toggle").title = engine === "ardy" ? "Stream rolling ARDY horizons with live velocity commands" : "Kimodo is an offline authoring model";
  drawRoute();
  try {
    await loadBindMesh(engine);
    setViewerMode(engine === "ardy" && state.vrm ? "vrm" : "skin");
  } catch (error) { $("status").textContent = error.message; }
}

function fillCacheSelect(select, selectedKey = "") {
  select.replaceChildren();
  if (!state.textCacheEntries.length) {
    const option = new Option("No cached embeddings yet", "");
    select.add(option);
    return;
  }
  select.add(new Option("Choose a cached embedding…", ""));
  for (const entry of state.textCacheEntries) select.add(new Option(entry.text, entry.key));
  if (state.textCacheEntries.some((entry) => entry.key === selectedKey)) select.value = selectedKey;
}

function installTextCacheEntries(entries, preferredKey = "") {
  state.textCacheEntries = Array.isArray(entries) ? entries.filter((entry) => entry?.key && entry?.text) : [];
  const previousKey = $("text-preset").value;
  fillCacheSelect($("text-preset"), preferredKey || previousKey);
  const firstKey = state.textCacheEntries[0]?.key || "";
  for (const slot of state.scheduleSlots) {
    if (!state.textCacheEntries.some((entry) => entry.key === slot.cacheKey)) slot.cacheKey = firstKey;
  }
  renderScheduleSlots();
  saveArdyWorkspace();
}

async function refreshTextCache(preferredKey = "") {
  try {
    const response = await fetch(`/api/text-cache?engine=${encodeURIComponent(state.engine)}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Could not load cached embeddings.");
    installTextCacheEntries(result.entries, preferredKey);
  } catch (error) {
    $("prompt-note").textContent = error.message;
  }
}

function renderScheduleSlots() {
  const container = $("schedule-slots");
  if (!container) return;
  container.replaceChildren();
  const useCache = cachedInputEnabled();
  state.scheduleSlots.forEach((slot, index) => {
    const row = document.createElement("div");
    row.className = "schedule-slot";
    const time = document.createElement("input");
    time.type = "number";
    time.min = "0";
    time.step = "0.1";
    time.value = String(slot.time);
    time.setAttribute("aria-label", `Scheduled slot ${index + 1} start time`);
    time.addEventListener("input", () => { slot.time = time.value; saveArdyWorkspace(); });
    let input;
    if (useCache) {
      input = document.createElement("select");
      fillCacheSelect(input, slot.cacheKey);
      input.setAttribute("aria-label", `Scheduled slot ${index + 1} cached embedding`);
      input.addEventListener("change", () => { slot.cacheKey = input.value; saveArdyWorkspace(); });
    } else {
      input = document.createElement("input");
      input.type = "text";
      input.value = slot.prompt || "";
      input.placeholder = "Describe the motion…";
      input.setAttribute("aria-label", `Scheduled slot ${index + 1} prompt`);
      input.addEventListener("input", () => { slot.prompt = input.value; saveArdyWorkspace(); });
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "schedule-remove";
    remove.textContent = "×";
    remove.title = "Remove this scheduled slot";
    remove.disabled = state.scheduleSlots.length === 1;
    remove.addEventListener("click", () => {
      if (state.scheduleSlots.length === 1) return;
      state.scheduleSlots.splice(index, 1);
      renderScheduleSlots();
      saveArdyWorkspace();
    });
    row.append(time, input, remove);
    container.append(row);
  });
}

function addScheduleSlot() {
  const previous = state.scheduleSlots.at(-1);
  state.scheduleSlots.push({
    time: Number.isFinite(Number(previous?.time)) ? Number(previous.time) + 1 : 0,
    prompt: "",
    cacheKey: state.textCacheEntries[0]?.key || "",
  });
  renderScheduleSlots();
  saveArdyWorkspace();
}

function updateTextInputMode() {
  const enabled = $("text-enabled").checked;
  const scheduled = enabled && $("text-schedule-enabled").checked;
  const useCache = enabled && cachedInputEnabled();
  $("cached-input-enabled").disabled = !enabled;
  $("text-schedule-enabled").disabled = !enabled;
  $("text-input-panel").hidden = !enabled || scheduled || useCache;
  $("cache-input-panel").hidden = !enabled || scheduled || !useCache;
  $("schedule-editor").hidden = !scheduled;
  $("prompt").disabled = !enabled || scheduled || useCache;
  $("cache-text").disabled = !enabled || scheduled || useCache;
  $("text-preset").disabled = !enabled || scheduled || !useCache;
  $("add-schedule-slot").disabled = !scheduled;
  $("text-guidance").disabled = !enabled;
  $("prompt-memory").disabled = !enabled;
  renderScheduleSlots();
}

function cachedInputEnabled() {
  return $("cached-input-enabled").checked;
}

function currentTextInput() {
  if (cachedInputEnabled()) {
    const cacheKey = $("text-preset").value;
    if (!cacheKey) throw new Error("Choose a cached embedding.");
    return { mode: "cache", cacheKey, prompt: "" };
  }
  const prompt = $("prompt").value.trim();
  if (!prompt) throw new Error("Enter a text prompt.");
  return { mode: "text", prompt, cacheKey: "" };
}

function parseTextSchedule(duration) {
  const mode = cachedInputEnabled() ? "cache" : "text";
  const cues = state.scheduleSlots.map((slot, index) => {
    const time = Number(slot.time);
    if (!Number.isFinite(time) || time < 0) throw new Error(`Scheduled slot ${index + 1} needs a valid non-negative start time.`);
    if (time >= duration) throw new Error(`Scheduled slot ${index + 1} at ${time.toFixed(1)}s is outside this ${duration.toFixed(1)}s batch.`);
    if (mode === "cache") {
      if (!slot.cacheKey) throw new Error(`Choose a cached embedding for scheduled slot ${index + 1}.`);
      return { time, mode, cacheKey: slot.cacheKey };
    }
    const prompt = String(slot.prompt || "").trim();
    if (!prompt) throw new Error(`Enter text for scheduled slot ${index + 1}.`);
    return { time, mode, prompt };
  });
  if (!cues.length) throw new Error("Add at least one scheduled slot.");
  cues.sort((a, b) => a.time - b.time);
  const deduped = cues.filter((cue, index) => index === cues.length - 1 || cue.time !== cues[index + 1].time);
  if (deduped[0].time > 0) throw new Error("The first scheduled slot must start at 0.0 seconds.");
  for (let index = 1; index < deduped.length; index += 1) {
    if (deduped[index].time - deduped[index - 1].time < 0.5) throw new Error("Timed text cues must be at least 0.5 seconds apart.");
  }
  return deduped;
}

function routePointAtFraction(fraction) {
  const lengths = state.points.slice(1).map((point, index) => Math.hypot(point.x - state.points[index].x, point.z - state.points[index].z));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  let target = Math.max(0, Math.min(1, fraction)) * total;
  for (let index = 0; index < lengths.length; index += 1) {
    if (target <= lengths[index] || index === lengths.length - 1) {
      const alpha = lengths[index] > 1e-6 ? target / lengths[index] : 0;
      return {
        x: THREE.MathUtils.lerp(state.points[index].x, state.points[index + 1].x, alpha),
        z: THREE.MathUtils.lerp(state.points[index].z, state.points[index + 1].z, alpha),
      };
    }
    target -= lengths[index];
  }
  return { ...state.points.at(-1) };
}

function routeSlice(startTime, endTime, duration) {
  const output = [routePointAtFraction(startTime / duration)];
  const lengths = state.points.slice(1).map((point, index) => Math.hypot(point.x - state.points[index].x, point.z - state.points[index].z));
  const total = lengths.reduce((sum, value) => sum + value, 0);
  let cumulative = 0;
  for (let index = 1; index < state.points.length - 1; index += 1) {
    cumulative += lengths[index - 1];
    const time = total > 1e-6 ? cumulative / total * duration : 0;
    if (time > startTime && time < endTime) output.push({ ...state.points[index] });
  }
  output.push(routePointAtFraction(endTime / duration));
  return output;
}

async function requestBatchSegment({ points, duration, textInput, seed }) {
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      engine: state.engine,
      points,
      duration,
      steps: Number($("steps").value),
      constraintGuidance: Number($("guidance").value),
      textGuidance: Number($("text-guidance").value),
      rootEnabled: $("root-enabled").checked,
      headingEnabled: $("heading-enabled").checked,
      endpointEnabled: $("endpoint-enabled").checked,
      textEnabled: $("text-enabled").checked,
      textMode: textInput?.mode || "text",
      prompt: textInput?.prompt || "",
      cacheKey: textInput?.cacheKey || "",
      seed,
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "Motion generation failed.");
  return result.motion;
}

function blendVector(previous, current, alpha) {
  return current.map((value, index) => THREE.MathUtils.lerp(previous[index], value, alpha));
}

function easedBlend(value) {
  const clamped = THREE.MathUtils.clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function blendRotationMatrix(previous, current, alpha) {
  if (!previous || !current) return current || previous;
  const quaternion = quaternionFromRotationMatrix(previous);
  quaternion.slerp(quaternionFromRotationMatrix(current), alpha).normalize();
  const elements = new THREE.Matrix4().makeRotationFromQuaternion(quaternion).elements;
  return [
    [elements[0], elements[4], elements[8]],
    [elements[1], elements[5], elements[9]],
    [elements[2], elements[6], elements[10]],
  ];
}

function blendRotationFrame(previous, current, alpha) {
  if (!Array.isArray(previous) || !Array.isArray(current)) return current || previous;
  return current.map((matrix, index) => blendRotationMatrix(previous[index], matrix, alpha));
}

function placeGeneratedSegment(motion, worldStart, sourceFrame = 0) {
  const generatedStart = motion.rootPositions[Math.min(sourceFrame, motion.frames - 1)] || [0, 0, 0];
  const offsetX = worldStart.x - (Number(generatedStart[0]) || 0);
  const offsetZ = worldStart.z - (Number(generatedStart[2]) || 0);
  for (let frame = 0; frame < motion.frames; frame += 1) {
    motion.rootPositions[frame][0] += offsetX;
    motion.rootPositions[frame][2] += offsetZ;
    const offset = frame * motion.vertexCount * 3;
    for (let vertex = 0; vertex < motion.vertexCount; vertex += 1) {
      motion.vertices[offset + vertex * 3] += offsetX;
      motion.vertices[offset + vertex * 3 + 2] += offsetZ;
    }
  }
  return motion;
}

function mergeGeneratedSegments(segments) {
  const fps = segments[0].fps;
  const vertexCount = segments[0].vertexCount;
  const totalFrames = segments.reduce((sum, segment, index) => sum + segment.frames - (index ? 1 : 0), 0);
  const vertices = new Float32Array(totalFrames * vertexCount * 3);
  const joints = [];
  const rootPositions = [];
  const rotations = [];
  let destinationFrame = 0;
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    const firstFrame = segmentIndex ? 1 : 0;
    const blendFrames = segmentIndex ? Math.min(Math.round(fps * 0.75), segment.frames - firstFrame) : 0;
    const previousVertexOffset = Math.max(0, destinationFrame - 1) * vertexCount * 3;
    const previousVertices = segmentIndex
      ? vertices.slice(previousVertexOffset, previousVertexOffset + vertexCount * 3)
      : null;
    const previousJoints = joints.at(-1);
    const previousRoot = rootPositions.at(-1);
    const previousRotations = rotations.at(-1);
    const incomingRoot = segment.rootPositions[firstFrame];
    const rootAlignment = segmentIndex && previousRoot && incomingRoot
      ? [0, previousRoot[1] - incomingRoot[1], 0]
      : [0, 0, 0];
    for (let frame = firstFrame; frame < segment.frames; frame += 1) {
      const localFrame = frame - firstFrame;
      const alpha = localFrame < blendFrames ? easedBlend((localFrame + 1) / (blendFrames + 1)) : 1;
      const alignmentWeight = 1 - alpha;
      const sourceOffset = frame * vertexCount * 3;
      const destinationOffset = destinationFrame * vertexCount * 3;
      if (alpha < 1) {
        for (let index = 0; index < vertexCount * 3; index += 1) {
          const axis = index % 3;
          const alignedIncoming = segment.vertices[sourceOffset + index] + rootAlignment[axis] * alignmentWeight;
          vertices[destinationOffset + index] = THREE.MathUtils.lerp(previousVertices[index], alignedIncoming, alpha);
        }
      } else {
        vertices.set(segment.vertices.subarray(sourceOffset, sourceOffset + vertexCount * 3), destinationOffset);
      }
      joints.push(alpha < 1 && previousJoints
        ? segment.joints[frame].map((joint, index) => blendVector(previousJoints[index], joint, alpha))
        : segment.joints[frame]);
      if (alpha < 1 && previousRoot) {
        const alignedRoot = segment.rootPositions[frame].map((value, index) => value + rootAlignment[index] * alignmentWeight);
        rootPositions.push(blendVector(previousRoot, alignedRoot, alpha));
      } else {
        rootPositions.push(segment.rootPositions[frame]);
      }
      rotations.push(alpha < 1 ? blendRotationFrame(previousRotations, segment.rotations[frame], alpha) : segment.rotations[frame]);
      destinationFrame += 1;
    }
  }
  return { vertices, frames: totalFrames, fps, vertexCount, joints, rootPositions, rotations };
}

async function generateArdyScheduledBatch(cues, duration) {
  $("status").textContent = `Generating ${cues.length} prompted intervals and constrained transitions…`;
  const response = await fetch("/api/generate-scheduled", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      engine: "ardy",
      points: state.points,
      duration,
      cues,
      steps: Number($("steps").value),
      constraintGuidance: Number($("guidance").value),
      textGuidance: Number($("text-guidance").value),
      promptHistorySeconds: Number($("prompt-memory").value),
      headingEnabled: $("heading-enabled").checked,
      seed: 42,
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "ARDY timed batch generation failed.");
  return result.motion;
}

async function generateMotion() {
  if (state.generating || state.points.length < 2) return;
  state.generating = true;
  updateReadouts();
  $("generate").textContent = "Generating…";
  $("status").textContent = state.runtimeReady[state.engine]
    ? `Generating with resident ${configs[state.engine].name}…`
    : `Warming up ${configs[state.engine].name} once, then keeping it resident…`;
  try {
    const duration = Number($("duration").value);
    const scheduled = $("text-enabled").checked && $("text-schedule-enabled").checked;
    let motion;
    let generationSeconds = 0;
    let constraintErrorMaxM = 0;
    let cueCount = 1;
    let resolvedCueTrace = "";
    if (scheduled) {
      const cues = parseTextSchedule(duration);
      cueCount = cues.length;
      if (state.engine === "ardy") {
        const motionMeta = await generateArdyScheduledBatch(cues, duration);
        generationSeconds = motionMeta.generationSeconds;
        constraintErrorMaxM = motionMeta.constraintErrorMaxM;
        resolvedCueTrace = (motionMeta.resolvedCues || []).map((cue) => `${Number(cue.appliedTime).toFixed(1)}s “${cue.label}” (${cue.horizonStarts?.length || 0} horizons)`).join(" → ");
        state.exportUrl = motionMeta.exportUrl;
        await loadGeneratedMesh(motionMeta);
        motion = state.motion;
      } else {
        const segments = [];
        for (let index = 0; index < cues.length; index += 1) {
          const startTime = cues[index].time;
          const endTime = index + 1 < cues.length ? cues[index + 1].time : duration;
          if (endTime - startTime < 0.5) throw new Error("The final timed text cue needs at least 0.5 seconds of batch time.");
          const cueLabel = cues[index].mode === "cache"
            ? state.textCacheEntries.find((entry) => entry.key === cues[index].cacheKey)?.text || "cached embedding"
            : cues[index].prompt;
          $("status").textContent = `Generating text cue ${index + 1} of ${cues.length} · ${cueLabel}`;
          const worldPoints = routeSlice(startTime, endTime, duration);
          const worldStart = worldPoints[0];
          const localPoints = worldPoints.map((point) => ({ x: point.x - worldStart.x, z: point.z - worldStart.z }));
          const segmentMeta = await requestBatchSegment({
            points: localPoints,
            duration: endTime - startTime,
            textInput: cues[index],
            seed: 42 + index,
          });
          generationSeconds += segmentMeta.generationSeconds;
          constraintErrorMaxM = Math.max(constraintErrorMaxM, segmentMeta.constraintErrorMaxM);
          const segment = await fetchGeneratedMotionData(segmentMeta);
          if (segments.length) {
            const previousEnd = segments.at(-1).rootPositions.at(-1);
            placeGeneratedSegment(segment, { x: previousEnd[0], z: previousEnd[2] }, 1);
          } else {
            placeGeneratedSegment(segment, worldStart);
          }
          segments.push(segment);
        }
        motion = mergeGeneratedSegments(segments);
      }
      if (state.engine !== "ardy") {
        installGeneratedMotion(motion);
        state.exportUrl = null;
      }
    } else {
      const textInput = $("text-enabled").checked ? currentTextInput() : { mode: "text", prompt: "" };
      const motionMeta = await requestBatchSegment({ points: state.points, duration, textInput, seed: 42 });
      generationSeconds = motionMeta.generationSeconds;
      constraintErrorMaxM = motionMeta.constraintErrorMaxM;
      state.exportUrl = motionMeta.exportUrl;
      await loadGeneratedMesh(motionMeta);
      motion = state.motion;
    }
    state.runtimeReady[state.engine] = true;
    state.exportMode = "batch";
    $("export-current").disabled = false;
    $("export-current").textContent = "Export Batch Video";
    $("frames-stat").textContent = motion.frames;
    $("speed-stat").textContent = `${generationSeconds.toFixed(2)} s`;
    $("status").textContent = scheduled
      ? `${configs[state.engine].name} generated ${cueCount} timed text cues with ${state.engine === "ardy" ? "native autoregressive replanning" : "blended transitions"} · ${(motion.frames / motion.fps).toFixed(1)}s total.`
      : `${configs[state.engine].name} generated ${(motion.frames / motion.fps).toFixed(1)}s of motion · path error ${(constraintErrorMaxM * 100).toFixed(1)} cm max.`;
    if ($("text-enabled").checked) $("prompt-note").textContent = scheduled
      ? resolvedCueTrace
        ? `Worker-confirmed separate inputs: ${resolvedCueTrace}`
        : `${cueCount} separate text inputs were applied on the batch timeline.`
      : cachedInputEnabled()
        ? "The selected permanent embedding was loaded directly by cache key."
        : "Live edits apply on the next 0.4s ARDY horizon.";
  } catch (error) {
    $("status").textContent = error.message;
  } finally {
    state.generating = false;
    $("generate").textContent = "Generate motion";
    updateReadouts(true);
  }
}

async function cacheCurrentText() {
  const text = $("prompt").value.trim();
  if (!text) { $("prompt-note").textContent = "Enter or choose a phrase first."; return; }
  $("cache-text").disabled = true;
  $("prompt-note").textContent = "Encoding once and saving the 4,096-value slot-in…";
  try {
    const response = await fetch("/api/cache-text", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ engine: state.engine, text }) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Could not cache that phrase.");
    installTextCacheEntries(result.entries, result.entry?.key || "");
    $("prompt-note").textContent = result.created
      ? `Permanently saved “${result.entry.text}”.`
      : `“${result.entry.text}” was already cached; the saved embedding was reused without recomputing it.`;
  } catch (error) {
    $("prompt-note").textContent = error.message;
  } finally {
    $("cache-text").disabled = !$("text-enabled").checked || cachedInputEnabled();
  }
}

function liveVelocity() {
  let x = 0;
  let z = 0;
  if (state.liveKeys.has("w")) z += 1;
  if (state.liveKeys.has("s")) z -= 1;
  if (state.liveKeys.has("a")) x -= 1;
  if (state.liveKeys.has("d")) x += 1;
  const length = Math.hypot(x, z) || 1;
  const speed = Number($("live-speed").value);
  return { x: x / length * speed, z: z / length * speed };
}

async function requestLiveSegment(start = false) {
  if (!state.liveActive || state.liveFetching) return;
  state.liveFetching = true;
  state.liveCommandDirty = false;
  const velocity = liveVelocity();
  const playbackFrame = start ? 0 : state.livePlaybackFrame;
  const requestStartedAt = performance.now();
  try {
    const liveTextInput = $("text-enabled").checked ? currentTextInput() : { mode: "text", prompt: "", cacheKey: "" };
    const response = await fetch(start ? "/api/live/start" : "/api/live/step", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        engine: "ardy",
        velocityX: velocity.x,
        velocityZ: velocity.z,
        steps: Number($("steps").value),
        constraintGuidance: Number($("guidance").value),
        textGuidance: Number($("text-guidance").value),
        historyFrames: Math.max(4, Math.round(Number($("prompt-memory").value) * configs.ardy.fps / 4) * 4),
        playbackFrame,
        replanBufferFrames: state.liveReplanBufferFrames,
        liveSmoothingSeconds: Number($("live-smoothing").value),
        headingEnabled: $("heading-enabled").checked,
        textEnabled: $("text-enabled").checked,
        textMode: liveTextInput.mode,
        prompt: liveTextInput.prompt,
        cacheKey: liveTextInput.cacheKey,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Live ARDY step failed.");
    state.runtimeReady.ardy = true;
    const binary = await fetch(result.motion.meshFramesUrl, { cache: "no-store" });
    if (!binary.ok) throw new Error("Live mesh segment was not available.");
    const vertices = new Float32Array(await binary.arrayBuffer());
    if (!start) {
      const latencyFrames = Math.min(6, Math.max(1, Math.ceil((performance.now() - requestStartedAt) / 1000 * result.motion.fps)));
      state.liveLatencyFrames.push(latencyFrames);
      if (state.liveLatencyFrames.length > 5) state.liveLatencyFrames.shift();
      state.liveReplanBufferFrames = Math.max(...state.liveLatencyFrames);
    }
    const replaceFrom = Number(result.motion.replaceFromFrame || 0);
    state.liveSegments = state.liveSegments.filter((segment) => segment.startFrame < replaceFrom);
    state.liveSegments.push({
      startFrame: replaceFrom,
      vertices,
      joints: result.motion.centeredJoints || [],
      rootPositions: result.motion.rootPositions || [],
      rotations: result.motion.localRotations || [],
      frames: result.motion.frames,
      fps: result.motion.fps,
      vertexCount: result.motion.meshVertexCount,
      stepIndex: result.motion.stepIndex,
    });
    state.liveMaxFrame = replaceFrom + result.motion.frames - 1;
    if (!state.liveStartedAt) {
      state.liveStartedAt = performance.now();
      state.livePlaybackFrame = 0;
      state.currentFrame = -1;
    }
    state.exportMode = "live";
    $("export-current").disabled = false;
    $("export-current").textContent = "Export Live Video";
    $("status").textContent = `Live ARDY · ${velocity.x.toFixed(1)}, ${velocity.z.toFixed(1)} m/s · ${result.motion.generationSeconds.toFixed(2)}s replan · ${result.motion.historyFrames} history frames · buffer ${state.liveReplanBufferFrames}`;
  } catch (error) {
    $("status").textContent = error.message;
    stopLive();
  } finally {
    state.liveFetching = false;
    if (state.liveActive && state.liveCommandDirty) setTimeout(() => requestLiveSegment(false), 0);
  }
}

function liveCommandChanged(requestReplan = true) {
  const velocity = liveVelocity();
  state.liveGoal = {
    x: state.liveRoot.x + velocity.x * 2,
    z: state.liveRoot.z + velocity.z * 2,
  };
  updateGoalMarker();
  document.querySelectorAll(".key").forEach((element) => element.classList.toggle("active", state.liveKeys.has(element.dataset.key)));
  if (requestReplan && state.liveActive) {
    state.liveCommandDirty = true;
    requestLiveSegment(false);
  }
}

function startLive() {
  if (state.engine !== "ardy" || state.liveActive) return;
  state.liveActive = true;
  state.liveSegments = [];
  state.liveStartedAt = 0;
  state.livePlaybackFrame = 0;
  state.liveMaxFrame = -1;
  state.liveReplanBufferFrames = 3;
  state.liveLatencyFrames = [];
  state.liveCommandDirty = false;
  state.liveKeys.clear();
  state.liveRoot = { x: 0, z: 0 };
  state.liveGoal = { x: 0, z: 0 };
  state.exportMode = null;
  state.exportUrl = null;
  $("export-current").disabled = true;
  state.motion = null;
  state.playing = false;
  state.vrm?.springBoneManager?.reset();
  $("live-toggle").textContent = "Stop Live";
  $("live-toggle").style.borderColor = configs.ardy.color;
  $("live-speed-field").hidden = false;
  $("live-smoothing-field").hidden = false;
  $("live-stop").hidden = false;
  $("wasd-note").textContent = "Hold keyboard keys · on-screen buttons latch";
  $("replay").disabled = true;
  $("pause").disabled = true;
  $("generate").disabled = true;
  $("status").textContent = state.runtimeReady.ardy ? "Starting live ARDY…" : "Warming up ARDY once for live mode…";
  updateGroundRoute();
  updateGoalMarker();
  requestLiveSegment(true);
}

function stopLive() {
  state.liveActive = false;
  state.liveKeys.clear();
  state.liveSegments = [];
  state.liveStartedAt = 0;
  state.livePlaybackFrame = 0;
  state.liveMaxFrame = -1;
  state.liveLatencyFrames = [];
  state.liveCommandDirty = false;
  $("live-toggle").textContent = "Start Live ARDY";
  $("live-toggle").style.borderColor = "";
  $("live-speed-field").hidden = true;
  $("live-smoothing-field").hidden = true;
  $("live-stop").hidden = true;
  $("wasd-note").textContent = "Keyboard or click · Shift moves 4×";
  $("replay").disabled = false;
  $("pause").disabled = false;
  updateReadouts();
  updateGroundRoute();
  updateGoalMarker();
}

function resetHumanoid() {
  if (state.liveActive) stopLive();
  state.motion = null;
  state.playing = false;
  state.currentFrame = -1;
  state.exportMode = null;
  state.exportUrl = null;
  $("export-current").disabled = true;
  if (bodyMesh && bindPositions) {
    bodyMesh.geometry.attributes.position.array.set(bindPositions);
    bodyMesh.geometry.attributes.position.needsUpdate = true;
    bodyMesh.geometry.computeVertexNormals();
  }
  resetVrmPose();
  state.vrm?.springBoneManager?.reset();
  $("frame-label").textContent = "Bind pose";
  $("timeline-fill").style.width = state.points.length > 1 ? "100%" : "0";
  $("status").textContent = `${configs[state.engine].name} humanoid reset to its official bind pose.`;
}

async function exportCurrentSequence() {
  if (!state.exportMode) return;
  if (state.exportMode === "batch") {
    await exportViewportVideo("batch");
    return;
  }
  $("export-current").disabled = true;
  const originalLabel = $("export-current").textContent;
  $("export-current").textContent = "Preparing export…";
  try {
    if (state.exportMode === "live") {
      const response = await fetch("/api/live/export", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Live export failed.");
      const motion = await fetchGeneratedMotionData(result.export);
      stopLive();
      installGeneratedMotion(motion);
      state.exportMode = "live";
      await exportViewportVideo("live");
      return;
    }
  } catch (error) {
    $("status").textContent = error.message;
  } finally {
    $("export-current").textContent = originalLabel;
    $("export-current").disabled = !state.exportMode;
  }
}

async function exportViewportVideo(sequenceKind) {
  if (!state.motion || !bodyMesh) throw new Error(`Generate a ${sequenceKind} sequence before exporting its video.`);
  if (typeof MediaRecorder === "undefined" || typeof renderer.domElement.captureStream !== "function") {
    $("status").textContent = "This browser cannot record the 3D viewport.";
    return;
  }
  const button = $("export-current");
  button.disabled = true;
  button.textContent = "Recording replay…";
  const previousPlaying = state.playing;
  const previousFrame = state.currentFrame;
  try {
    const candidates = [
      "video/mp4;codecs=avc1.42E01E",
      "video/mp4",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
    const extension = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
    const stream = renderer.domElement.captureStream(30);
    const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 10_000_000 });
    const chunks = [];
    recorder.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });
    const stopped = new Promise((resolve, reject) => {
      recorder.addEventListener("stop", resolve, { once: true });
      recorder.addEventListener("error", (event) => reject(event.error || new Error("Video recording failed.")), { once: true });
    });
    state.animationStart = performance.now();
    state.currentFrame = -1;
    state.playing = true;
    recorder.start(250);
    const durationMs = state.motion.frames / state.motion.fps * 1000;
    $("status").textContent = `Recording the ${durationMs / 1000}s ${sequenceKind} replay at real-time speed…`;
    await new Promise((resolve) => setTimeout(resolve, Math.max(100, durationMs - 5)));
    state.playing = false;
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());
    const blob = new Blob(chunks, { type: mimeType || "video/webm" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${state.engine}-${sequenceKind}-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    $("status").textContent = `Exported the current ${sequenceKind} sequence as ${extension.toUpperCase()} video.`;
  } catch (error) {
    $("status").textContent = error.message;
  } finally {
    state.playing = previousPlaying;
    state.currentFrame = previousFrame;
    if (previousPlaying) state.animationStart = performance.now() - (Math.max(0, previousFrame) / state.motion.fps) * 1000;
    button.textContent = sequenceKind === "live" ? "Export Live Video" : "Export Batch Video";
    button.disabled = !state.motion;
  }
}

async function loadAvatarTargets() {
  const response = await fetch("/api/avatar/list", { cache: "no-store" });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "Could not find local VRMs.");
  const select = $("avatar-target");
  select.replaceChildren(...result.avatars.map((avatar) => {
    const option = document.createElement("option");
    option.value = avatar.file;
    option.textContent = `${avatar.name} · VRM ${avatar.vrmVersion}`;
    option.selected = avatar.file === result.defaultAvatar;
    return option;
  }));
  $("align-avatar").disabled = !result.avatars.length;
  $("avatar-status").textContent = result.avatars.length
    ? `${result.avatars.length} local avatars ready for direct rendering.`
    : "No local VRM avatars were found.";
  if (result.avatars.length) await alignAvatar();
}

async function alignAvatar() {
  const button = $("align-avatar");
  button.disabled = true;
  button.textContent = "Aligning…";
  $("avatar-status").textContent = "Measuring hips, floor, facing, shoulders, torso, arms, and legs…";
  try {
    const response = await fetch("/api/avatar/alignment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ avatar: $("avatar-target").value }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Avatar alignment failed.");
    const alignment = result.alignment;
    state.avatarAlignment = alignment;
    await loadDirectVrm(alignment.file);
    resetVrmPose();
    $("viewer-vrm").disabled = state.engine !== "ardy";
    $("avatar-status").textContent = `${alignment.avatar} loaded directly · ${alignment.mappedJoints} driven joints · no VNyan required · floor ${(alignment.floorOffsetM * 100).toFixed(1)} cm.`;
  } catch (error) {
    $("avatar-status").textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Align";
  }
}

const ARDY_WORKSPACE_KEY = 'unified-character-lab:ardy-workspace:v1';
const ARDY_PERSISTED_CONTROLS = [
  'root-enabled', 'heading-enabled', 'endpoint-enabled', 'live-camera-follow',
  'text-enabled', 'cached-input-enabled', 'text-schedule-enabled', 'prompt', 'text-preset',
  'step', 'live-speed', 'live-smoothing', 'duration', 'steps', 'guidance',
  'text-guidance', 'prompt-memory', 'dress-safe', 'accessory-safe', 'hair-weight',
];

function saveArdyWorkspace() {
  try {
    const controls = Object.fromEntries(ARDY_PERSISTED_CONTROLS.map((id) => {
      const element = $(id);
      return [id, element?.type === 'checkbox' ? element.checked : element?.value];
    }));
    localStorage.setItem(ARDY_WORKSPACE_KEY, JSON.stringify({
      version: 1,
      points: state.points,
      centerX: state.centerX,
      centerZ: state.centerZ,
      scheduleSlots: state.scheduleSlots,
      controls,
    }));
  } catch {}
}

function restoreArdyWorkspace() {
  try {
    const saved = JSON.parse(localStorage.getItem(ARDY_WORKSPACE_KEY) || 'null');
    if (!saved || saved.version !== 1) return;
    if (Array.isArray(saved.points) && saved.points.length) {
      state.points = saved.points
        .map((point) => ({ x: Number(point?.x), z: Number(point?.z) }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.z));
      if (!state.points.length) state.points = [{ x: 0, z: 0 }];
    }
    if (Number.isFinite(Number(saved.centerX))) state.centerX = Number(saved.centerX);
    if (Number.isFinite(Number(saved.centerZ))) state.centerZ = Number(saved.centerZ);
    if (Array.isArray(saved.scheduleSlots) && saved.scheduleSlots.length) {
      state.scheduleSlots = saved.scheduleSlots.map((slot) => ({
        time: Number.isFinite(Number(slot?.time)) ? Number(slot.time) : 0,
        prompt: String(slot?.prompt || ""),
        cacheKey: String(slot?.cacheKey || ""),
      }));
    }
    for (const [id, value] of Object.entries(saved.controls || {})) {
      const element = $(id);
      if (!element) continue;
      if (element.type === 'checkbox') element.checked = Boolean(value);
      else if (value !== undefined && value !== null) element.value = String(value);
    }
    for (const id of ['step', 'live-speed', 'live-smoothing', 'duration', 'steps', 'guidance', 'text-guidance', 'prompt-memory', 'hair-weight']) {
      $(id)?.dispatchEvent(new Event('input'));
    }
    $('text-enabled')?.dispatchEvent(new Event('change'));
    $('cached-input-enabled')?.dispatchEvent(new Event('change'));
    $('text-schedule-enabled')?.dispatchEvent(new Event('change'));
  } catch {}
}

async function exportUnifiedSequence(options) {
  const report = (message) => window.parent.postMessage({ type: 'unified:export-status', message }, '*');
  let captureStream = null;
  let audioContext = null;
  let audioSource = null;
  try {
    if (!state.motion || !state.unifiedFaceTrack) throw new Error('Load both unified tracks before exporting.');
    if (typeof MediaRecorder === 'undefined' || typeof renderer.domElement.captureStream !== 'function') {
      throw new Error('This browser cannot record the unified viewport.');
    }
    const faceOffset = Math.max(0, Number(options.faceOffset) || 0);
    const motionOffset = Math.max(0, Number(options.motionOffset) || 0);
    const totalDuration = Math.max(0.1, Number(options.totalDuration) || 0.1);
    const canvasStream = renderer.domElement.captureStream(30);
    const tracks = [...canvasStream.getVideoTracks()];
    const audioPayload = state.unifiedFaceTrack.audio;
    if (audioPayload?.buffer) {
      audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();
      const decoded = await audioContext.decodeAudioData(audioPayload.buffer.slice(0));
      audioSource = audioContext.createBufferSource();
      audioSource.buffer = decoded;
      audioSource.connect(destination);
      tracks.push(...destination.stream.getAudioTracks());
    }
    captureStream = new MediaStream(tracks);
    const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
    const recorder = new MediaRecorder(captureStream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 12_000_000,
    });
    const chunks = [];
    recorder.addEventListener('dataavailable', (event) => { if (event.data.size) chunks.push(event.data); });
    const stopped = new Promise((resolve, reject) => {
      recorder.addEventListener('stop', resolve, { once: true });
      recorder.addEventListener('error', (event) => reject(event.error || new Error('Unified recording failed.')), { once: true });
    });
    if (state.liveActive) stopLive();
    state.playing = false;
    state.currentFrame = -1;
    state.vrm?.springBoneManager?.reset();
    resetVrmPose();
    clearUnifiedFace();
    setViewerMode('vrm');
    state.unifiedPlayback = {
      startedAt: performance.now(), faceOffset, motionOffset, totalDuration,
      faceFrame: -1, motionFrame: -1, faceCleared: true,
    };
    await audioContext?.resume();
    recorder.start(250);
    if (audioSource && audioContext) audioSource.start(audioContext.currentTime + faceOffset);
    report(`Recording ${totalDuration.toFixed(1)}s unified sequence in real time…`);
    await new Promise((resolve) => setTimeout(resolve, totalDuration * 1000 + 50));
    recorder.stop();
    await stopped;
    const capture = new Blob(chunks, { type: mimeType || 'video/webm' });
    report('Encoding unified recording as MP4…');
    const response = await fetch('http://127.0.0.1:8794/api/export/mp4', {
      method: 'POST',
      headers: { 'content-type': capture.type || 'video/webm' },
      body: capture,
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      throw new Error(failure.error || 'The local MP4 encoder could not finish the unified export.');
    }
    const mp4 = await response.blob();
    const url = URL.createObjectURL(mp4);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `unified-character-${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    window.parent.postMessage({ type: 'unified:export-ended', ok: true }, '*');
  } catch (error) {
    window.parent.postMessage({ type: 'unified:export-ended', ok: false, error: error.message }, '*');
  } finally {
    state.unifiedPlayback = null;
    clearUnifiedFace();
    resetVrmPose();
    try { audioSource?.stop(); } catch {}
    captureStream?.getTracks().forEach((track) => track.stop());
    if (audioContext) await audioContext.close().catch(() => {});
  }
}

window.addEventListener('message', (event) => {
  if (event.origin !== 'http://127.0.0.1:8788' || !event.data?.type) return;
  if (event.data.type === 'unified:preview-mode') {
    document.documentElement.classList.toggle('unified-preview', Boolean(event.data.enabled));
    window.setTimeout(() => { resizeViewport(); resizeRoute(); }, 30);
    return;
  }
  if (event.data.type === 'unified:resize') {
    resizeViewport(); resizeRoute();
    return;
  }
  if (event.data.type === 'unified:set-face-track') {
    state.unifiedFaceTrack = event.data.track || null;
    return;
  }
  if (event.data.type === 'unified:set-motion-track') {
    const track = event.data.track;
    state.motion = track?.frames && track?.fps ? {
      frames: track.frames,
      fps: track.fps,
      joints: track.joints || [],
      rootPositions: track.rootPositions || [],
      rotations: track.rotations || [],
      vertices: new Float32Array(0),
      vertexCount: 0,
    } : null;
    state.playing = false;
    state.currentFrame = -1;
    return;
  }
  if (event.data.type === 'unified:track-query') {
    publishMotionTrack();
    return;
  }
  if (event.data.type === 'unified:play') {
    if (!state.motion || !state.unifiedFaceTrack) return;
    if (state.liveActive) stopLive();
    state.playing = false;
    state.currentFrame = -1;
    state.vrm?.springBoneManager?.reset();
    resetVrmPose();
    clearUnifiedFace();
    setViewerMode('vrm');
    state.unifiedPlayback = {
      startedAt: performance.now(),
      faceOffset: Math.max(0, Number(event.data.faceOffset) || 0),
      motionOffset: Math.max(0, Number(event.data.motionOffset) || 0),
      totalDuration: Math.max(0.1, Number(event.data.totalDuration) || 0.1),
      faceFrame: -1,
      motionFrame: -1,
      faceCleared: true,
    };
    return;
  }
  if (event.data.type === 'unified:export') {
    exportUnifiedSequence(event.data);
    return;
  }
  if (event.data.type === 'unified:dispose') {
    state.unifiedPlayback = null;
    state.playing = false;
    stopLive();
    clearUnifiedFace();
    renderer.dispose();
    renderer.forceContextLoss();
    return;
  }
  if (event.data.type === 'unified:stop') {
    state.unifiedPlayback = null;
    clearUnifiedFace();
    resetVrmPose();
    state.currentFrame = -1;
    $("frame-label").textContent = 'Bind pose';
  }
});

document.querySelectorAll(".engine").forEach((element) => element.addEventListener("click", () => setEngine(element.dataset.engine)));
document.querySelectorAll(".key").forEach((element) => {
  element.addEventListener("click", () => {
    if (!state.liveActive) { move(element.dataset.key); return; }
    const alreadyLatched = state.liveKeys.size === 1 && state.liveKeys.has(element.dataset.key);
    state.liveKeys.clear();
    if (!alreadyLatched) state.liveKeys.add(element.dataset.key);
    liveCommandChanged();
  });
});
window.addEventListener("keydown", (event) => {
  if (/textarea|input|select/i.test(event.target.tagName)) return;
  const key = event.key.toLowerCase();
  if (["w", "a", "s", "d"].includes(key)) {
    event.preventDefault();
    if (state.liveActive) { if (!state.liveKeys.has(key)) { state.liveKeys.add(key); liveCommandChanged(); } }
    else if (!event.repeat) move(key, event.shiftKey);
  }
});
window.addEventListener("keyup", (event) => { const key = event.key.toLowerCase(); if (state.liveActive && ["w", "a", "s", "d"].includes(key) && state.liveKeys.delete(key)) liveCommandChanged(); });
routeCanvas.addEventListener("pointerdown", (event) => {
  const rect = routeCanvas.getBoundingClientRect();
  const point = screenToWorld((event.clientX - rect.left) * routeCanvas.width / rect.width, (event.clientY - rect.top) * routeCanvas.height / rect.height);
  state.points.push({ x: Math.round(point.x * 20) / 20, z: Math.round(point.z * 20) / 20 });
  drawRoute(); routeCanvas.focus();
});
renderer.domElement.addEventListener("pointerdown", (event) => { drag = { x: event.clientX, y: event.clientY, yaw: orbit.yaw, pitch: orbit.pitch }; renderer.domElement.setPointerCapture(event.pointerId); });
renderer.domElement.addEventListener("pointermove", (event) => {
  if (!drag) return;
  orbit.yaw = drag.yaw - (event.clientX - drag.x) * 0.008;
  orbit.pitch = Math.max(0.18, Math.min(Math.PI - 0.18, drag.pitch - (event.clientY - drag.y) * 0.008));
  updateCamera();
});
renderer.domElement.addEventListener("pointerup", () => { drag = null; });
renderer.domElement.addEventListener("wheel", (event) => { event.preventDefault(); orbit.radius = Math.max(1.6, Math.min(10, orbit.radius * Math.exp(event.deltaY * 0.001))); updateCamera(); }, { passive: false });
$("undo").addEventListener("click", () => { if (state.points.length > 1) state.points.pop(); drawRoute(); });
$("clear").addEventListener("click", () => { state.points = [{ x: 0, z: 0 }]; state.centerX = 0; state.centerZ = 0.6; drawRoute(); });
$("fit").addEventListener("click", fitRoute);
$("endpoint-enabled").addEventListener("change", updateGoalMarker);
$("view-reset").addEventListener("click", resetView);
$("viewer-vrm").addEventListener("click", () => setViewerMode("vrm"));
$("viewer-skin").addEventListener("click", () => setViewerMode("skin"));
$("live-toggle").addEventListener("click", () => { if (state.liveActive) stopLive(); else startLive(); });
$("live-stop").addEventListener("click", () => { state.liveKeys.clear(); liveCommandChanged(); });
$("reset-humanoid").addEventListener("click", resetHumanoid);
$("export-current").addEventListener("click", exportCurrentSequence);
$("replay").addEventListener("click", () => { if (state.motion) { state.vrm?.springBoneManager?.reset(); state.animationStart = performance.now(); state.currentFrame = -1; state.playing = true; $("pause").textContent = "Pause"; } });
$("pause").addEventListener("click", () => { if (!state.motion) return; state.playing = !state.playing; if (state.playing) state.animationStart = performance.now() - (state.currentFrame / state.motion.fps) * 1000; $("pause").textContent = state.playing ? "Pause" : "Play"; });
$("text-enabled").addEventListener("change", (event) => {
  if (!event.target.checked) $("text-schedule-enabled").checked = false;
  updateTextInputMode();
  $("prompt-note").textContent = event.target.checked ? "Live edits apply on ARDY’s next 0.4s horizon; timed cues are available for batches." : "Off — no language model or text VRAM.";
  $("llm-stat").textContent = event.target.checked ? "Cached / 4-bit" : "Off";
});
$("text-schedule-enabled").addEventListener("change", (event) => {
  updateTextInputMode();
  $("prompt-note").textContent = event.target.checked
    ? "Each row is a separate scheduled model input; the first row must start at 0.0 seconds."
    : "Live edits apply on ARDY’s next 0.4s horizon.";
});
$("cached-input-enabled").addEventListener("change", () => {
  updateTextInputMode();
  $("prompt-note").textContent = cachedInputEnabled()
    ? "Cached mode loads the selected permanent embedding by key; the text encoder is not run."
    : "Free-text mode uses the prompt field. Cache embedding saves it permanently for direct reuse.";
  if (state.liveActive && $("text-enabled").checked) liveCommandChanged();
});
$("prompt").addEventListener("input", () => {
  if (state.liveActive && $("text-enabled").checked) $("prompt-note").textContent = "Live text queued for the next 0.4s horizon.";
});
$("text-preset").addEventListener("change", () => {
  if (state.liveActive && $("text-enabled").checked) $("prompt-note").textContent = "Cached embedding queued for the next 0.4s horizon.";
});
$("cache-text").addEventListener("click", cacheCurrentText);
$("add-schedule-slot").addEventListener("click", addScheduleSlot);
$("align-avatar").addEventListener("click", alignAvatar);
$("avatar-target").addEventListener("change", alignAvatar);
$("dress-safe").addEventListener("change", (event) => {
  setDressPhysicsSafe(event.target.checked);
  $("avatar-status").textContent = event.target.checked
    ? "Dress-safe physics enabled · skirt springs locked; hair and accessories remain live."
    : "Full avatar physics enabled · skirt clipping may occur during fast motion.";
});
$("accessory-safe").addEventListener("change", (event) => {
  setAccessoryPhysicsSafe(event.target.checked);
  $("avatar-status").textContent = event.target.checked
    ? "Calm accessories enabled · bow locked and hair damping increased."
    : "Full accessory physics enabled.";
});
$("hair-weight").addEventListener("input", (event) => {
  $("hair-weight-out").textContent = Number(event.target.value).toFixed(2);
  setAccessoryPhysicsSafe($("accessory-safe").checked);
  state.vrm?.springBoneManager?.reset();
});
[["step", "step-out", (value) => `${Number(value).toFixed(2)} m`], ["live-speed", "live-speed-out", (value) => `${Number(value).toFixed(2)} m/s`], ["live-smoothing", "live-smoothing-out", (value) => `${Number(value).toFixed(2)} s`], ["duration", "duration-out", (value) => `${Number(value).toFixed(1)} s`], ["steps", "steps-out", String], ["guidance", "guidance-out", (value) => Number(value).toFixed(1)], ["text-guidance", "text-guidance-out", (value) => Number(value).toFixed(1)], ["prompt-memory", "prompt-memory-out", (value) => `${Number(value).toFixed(1)} s`]].forEach(([id, output, format]) => $(id).addEventListener("input", () => { $(output).textContent = format($(id).value); updateReadouts(); }));
$("generate").addEventListener("click", generateMotion);
window.addEventListener("resize", () => { resizeRoute(); resizeViewport(); });

restoreArdyWorkspace();
for (const id of ARDY_PERSISTED_CONTROLS) {
  const element = $(id);
  element?.addEventListener('input', saveArdyWorkspace);
  element?.addEventListener('change', saveArdyWorkspace);
}
window.addEventListener('beforeunload', saveArdyWorkspace);

updateTextInputMode();
refreshTextCache();
resetView();
resizeRoute();
resizeViewport();
Promise.all([
  loadBindMesh("ardy").catch((error) => { $("status").textContent = error.message; }),
  loadAvatarTargets().catch((error) => { $("avatar-status").textContent = error.message; }),
]).then(() => {
  if (window.parent !== window) window.parent.postMessage({ type: 'unified:player-ready' }, '*');
});
requestAnimationFrame(animate);
