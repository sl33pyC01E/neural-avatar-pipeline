// CPU-only checks using the actual Three-VRM loader and extracted desktop math.
// Usage: node check_avatar.mjs ASSETS NODE_MODULES ORIGINAL_ZOME REPORT.json [MOTION.json]
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const [assetsArg, modulesArg, originalPath, reportPath, motionOverride] = process.argv.slice(2);
if (!reportPath) throw new Error('Expected ASSETS NODE_MODULES ORIGINAL_ZOME REPORT.json');
const assets = path.resolve(assetsArg), modules = path.resolve(modulesArg);
const url = relative => pathToFileURL(path.join(modules, relative)).href;
const THREE = await import(url('three/build/three.module.js'));
const { GLTFLoader } = await import(url('three/examples/jsm/loaders/GLTFLoader.js'));
const { VRMLoaderPlugin, VRMUtils } = await import(url('@pixiv/three-vrm/lib/three-vrm.module.js'));
const moduleSource = (await fs.readFile(path.join(assets, 'retarget.mjs'), 'utf8'))
  .replace("from 'three'", `from '${url('three/build/three.module.js')}'`);
const { createRetargeter } = await import('data:text/javascript;base64,' + Buffer.from(moduleSource).toString('base64'));
const bind = JSON.parse(await fs.readFile(path.join(assets, 'bind.json'), 'utf8'));
const motion = JSON.parse(await fs.readFile(motionOverride || path.join(assets, 'motion.json'), 'utf8'));

async function load(file) {
  const loader = new GLTFLoader();
  // Textures are irrelevant to CPU skeleton/skinning checks; geometry is loaded fully.
  loader.register(() => ({ name: 'HeadlessTexture', loadTexture: async () => new THREE.Texture() }));
  loader.register(parser => new VRMLoaderPlugin(parser));
  const bytes = await fs.readFile(file);
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const vrm = gltf.userData.vrm;
  assert(vrm);
  VRMUtils.rotateVRM0(vrm); vrm.scene.updateMatrixWorld(true);
  const world = name => vrm.humanoid.getRawBoneNode(name)?.getWorldPosition(new THREE.Vector3());
  const feet = ['leftFoot','leftToes','rightFoot','rightToes'].map(world).filter(Boolean);
  const alignment = { hipsHeightM: world('hips').y, floorOffsetM: Math.min(...feet.map(p => p.y)) };
  return { vrm, retarget: createRetargeter(vrm, bind, alignment), alignment };
}

const old = await load(originalPath);
const cleo = await load(path.join(assets, 'cleopatra.vrm'));
assert.deepEqual(cleo.alignment, old.alignment);
const names = Object.keys(cleo.vrm.humanoid.humanBones);
const restLengths = new Map();
cleo.vrm.scene.traverse(node => {
  if (node.parent) restLengths.set(node, node.getWorldPosition(new THREE.Vector3()).distanceTo(node.parent.getWorldPosition(new THREE.Vector3())));
});
let maxBoneLengthError = 0, maxHumanoidMatrixError = 0;
for (let frame = 0; frame < motion.joints.length; frame++) {
  for (const avatar of [old, cleo]) {
    assert(avatar.retarget.apply(motion.joints[frame], motion.rootPositions[frame], motion.rotations[frame]));
  }
  for (const name of names) {
    const actual = cleo.vrm.humanoid.getRawBoneNode(name).matrixWorld.elements;
    const expected = old.vrm.humanoid.getRawBoneNode(name).matrixWorld.elements;
    for (let i=0;i<16;i++) { assert(Number.isFinite(actual[i])); maxHumanoidMatrixError = Math.max(maxHumanoidMatrixError, Math.abs(actual[i]-expected[i])); }
  }
  for (const [node, length] of restLengths) {
    const posedLength = node.getWorldPosition(new THREE.Vector3()).distanceTo(node.parent.getWorldPosition(new THREE.Vector3()));
    // The root scene translation changes its distance to an external parent only.
    maxBoneLengthError = Math.max(maxBoneLengthError, Math.abs(posedLength-length));
  }
}
assert(maxHumanoidMatrixError < 1e-7, `Cleopatra/Zome mapping diverged: ${maxHumanoidMatrixError}`);
assert(maxBoneLengthError < 1e-6, `Bone lengths changed: ${maxBoneLengthError}`);

// Compare every rendered index before/after geometry compaction, while posed.
// This catches weight/morph/attribute reindexing mistakes that a rig-only test misses.
const meshes = [];
cleo.vrm.scene.traverse(o => { if (o.isSkinnedMesh && o.geometry.index) meshes.push(o); });
function skin(mesh) {
  mesh.skeleton.update();
  const indices = mesh.geometry.index, positions = mesh.geometry.attributes.position;
  const output = new Float64Array(indices.count * 3), point = new THREE.Vector3();
  const cache = new Map();
  for (let i=0;i<indices.count;i++) {
    const vertex = indices.getX(i);
    if (!cache.has(vertex)) { point.fromBufferAttribute(positions, vertex); mesh.applyBoneTransform(vertex, point); cache.set(vertex, point.toArray()); }
    output.set(cache.get(vertex), i*3);
  }
  return output;
}
const beforeVertices = meshes.reduce((n,m) => n+m.geometry.attributes.position.count,0);
const before = meshes.map(skin);
VRMUtils.removeUnnecessaryVertices(cleo.vrm.scene);
const afterVertices = meshes.reduce((n,m) => n+m.geometry.attributes.position.count,0);
let maxSkinError = 0;
meshes.forEach((mesh,i) => { const after = skin(mesh); assert.equal(after.length,before[i].length); for(let j=0;j<after.length;j++) maxSkinError=Math.max(maxSkinError,Math.abs(after[j]-before[i][j])); });
assert(maxSkinError < 1e-7, `Skin changed after compaction: ${maxSkinError}`);
// A half-turn must rotate the head and the torso, not just translate their origins.
const stand = bind.restJoints[0][1] - Math.min(...bind.restJoints.map(p => p[1]));
const identity = () => [[1,0,0],[0,1,0],[0,0,1]];
const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), Math.PI);
const turned = bind.restJoints.map(p => new THREE.Vector3(...p).applyQuaternion(turn).toArray());
const local = bind.restJoints.map(identity); local[0] = [[-1,0,0],[0,1,0],[0,0,-1]];
cleo.retarget.apply(bind.restJoints,[0,stand,0],bind.restJoints.map(identity));
const initial = Object.fromEntries(['hips','chest','head'].map(name => [name,cleo.vrm.humanoid.getRawBoneNode(name).getWorldQuaternion(new THREE.Quaternion())]));
cleo.retarget.apply(turned,[0,stand,0],local);
const angles = Object.fromEntries(Object.entries(initial).map(([name,q]) => [name, q.angleTo(cleo.vrm.humanoid.getRawBoneNode(name).getWorldQuaternion(new THREE.Quaternion()))]));
for (const [name,angle] of Object.entries(angles)) assert(angle > 3.0, `${name} cancelled the half-turn: ${angle}`);
const report = { passed:true, frames:motion.joints.length, humanoidBones:names.length,
  maxHumanoidMatrixError, maxBoneLengthError, maxSkinError, beforeVertices, afterVertices,
  halfTurnRadians:angles, limitations:['CPU rig/skinning checks; no inference or GPU timing measured here.'] };
await fs.mkdir(path.dirname(path.resolve(reportPath)), {recursive:true});
await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
