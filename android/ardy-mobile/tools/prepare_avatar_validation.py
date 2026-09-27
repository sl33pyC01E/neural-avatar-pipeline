"""Prepare an offline phone replay using the actual desktop retargeter and APK clip.

Run with --help. Derived avatar/model payloads remain under ignored build/ paths.
No inference models, installed app data, or original VRM files are modified.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import shutil
import struct
import zipfile

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
MOBILE = ROOT / "android/ardy-mobile"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_glb(data):
    if struct.unpack_from("<III", data) != (0x46546C67, 2, len(data)):
        raise ValueError("Expected a glTF 2.0 binary VRM")
    chunks = {}
    offset = 12
    while offset < len(data):
        size, kind = struct.unpack_from("<II", data, offset)
        chunks[kind] = data[offset + 8:offset + 8 + size]
        offset += 8 + size
    return json.loads(chunks[0x4E4F534A]), chunks[0x004E4942]


def repack_vrm(data):
    """Remove unreachable buffer payloads, without changing live accessor/image bytes.

    Keep every accessor and bufferView index stable: editor provenance can refer to
    them, too. Unreferenced bytes between bufferViews are the only data removed.
    Shared views remain shared; bone weights, morphs, textures, and rig stay intact.
    """
    doc, binary = read_glb(data)
    if len(doc["buffers"]) != 1 or "uri" in doc["buffers"][0]:
        raise ValueError("Only a self-contained single-buffer VRM is supported")
    packed = bytearray()
    for view in doc["bufferViews"]:
        if view.get("buffer", 0) != 0:
            raise ValueError("Unexpected external buffer")
        start, size = view.get("byteOffset", 0), view["byteLength"]
        if start < 0 or start + size > len(binary):
            raise ValueError("Buffer view is outside the source buffer")
        packed.extend(b"\0" * (-len(packed) % 4))
        view["byteOffset"] = len(packed)
        packed.extend(binary[start:start + size])
    doc["buffers"][0]["byteLength"] = len(packed)
    encoded = json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode()
    encoded += b" " * (-len(encoded) % 4)
    packed.extend(b"\0" * (-len(packed) % 4))
    result = (struct.pack("<III", 0x46546C67, 2, 28 + len(encoded) + len(packed))
              + struct.pack("<II", len(encoded), 0x4E4F534A) + encoded
              + struct.pack("<II", len(packed), 0x004E4942) + packed)
    before, old_binary = read_glb(data)
    after, new_binary = read_glb(result)
    for a, b in zip(before["bufferViews"], after["bufferViews"]):
        size = a["byteLength"]
        assert old_binary[a.get("byteOffset", 0):a.get("byteOffset", 0) + size] == new_binary[b["byteOffset"]:b["byteOffset"] + size]
    # Only offsets and buffer length may differ in the document.
    restored = json.loads(json.dumps(after))
    restored["buffers"] = before["buffers"]
    restored["bufferViews"] = before["bufferViews"]
    assert restored == before
    # A repack that increases size is not an optimization.
    return bytes(result) if len(result) < len(data) else data


def retarget_source(path):
    source = path.read_text(encoding="utf-8")
    start = source.index("const VRM_SOURCE_CHAINS =")
    end = source.index("function applyVrmFrame(", start)
    core = source[start:end]
    return ("// Extracted verbatim from retargetting/motion-control.js at build time.\n"
            "import * as THREE from 'three';\n"
            "export function createRetargeter(vrm, bindMeta, avatarAlignment) {\n"
            "const state = { vrm, bindMeta, avatarAlignment };\n"
            + core + "\nstate.vrmRig = captureVrmRig(vrm);\n"
            "return { apply: applyVrmNormalizedJoints, reset: resetVrmPose, rig: state.vrmRig };\n}\n"), sha(core.encode())


def prepare(avatar, apk, dependencies, output):
    output.mkdir(parents=True, exist_ok=True)
    (output / "vendor").mkdir(exist_ok=True)
    avatar_bytes = avatar.read_bytes()
    packed = repack_vrm(avatar_bytes)
    (output / "cleopatra.vrm").write_bytes(packed)
    with zipfile.ZipFile(apk) as archive:
        bind = json.loads(archive.read("assets/motion-assets/ardy.mesh.json"))
        clip_bytes = archive.read("assets/generated-motions/ardy-walk-wave.npz")
        with np.load(io.BytesIO(clip_bytes), allow_pickle=False) as clip:
            motion = {"name": str(clip["prompt"]), "fps": float(clip["fps"]),
                      "joints": clip["posed_joints"].tolist(),
                      "rootPositions": clip["root_positions"].tolist(),
                      "rotations": clip["local_rot_mats"].tolist()}
    for name, value in [("bind.json", bind), ("motion.json", motion)]:
        (output / name).write_text(json.dumps(value, separators=(",", ":")), encoding="utf-8")
    module, source_hash = retarget_source(ROOT / "retargetting/motion-control.js")
    (output / "retarget.mjs").write_text(module, encoding="utf-8")
    face_source = (ROOT / 'retargetting/motion-control.js').read_text(encoding='utf-8')
    overlay = face_source[face_source.index('function applyAvatarExpressionOverlay('):face_source.index('function setAvatarExpression(')]
    face = face_source[face_source.index('function applyUnifiedFaceFrame('):face_source.index('function setViewerMode(')]
    (output / 'face.mjs').write_text(
        'export function createFaceDriver(vrm) {\n'
        'const state={vrm,unifiedFaceMorphs:[],avatarExpressions:new Map(),scheduledAvatarExpressions:new Map(),liveSpeechExpressionDurations:new Map()};\n'
        'vrm.scene.traverse(mesh=>{if(mesh.isMesh&&mesh.morphTargetDictionary)state.unifiedFaceMorphs.push({mesh,lookup:new Map(Object.entries(mesh.morphTargetDictionary).map(([name,i])=>[name.toLowerCase(),i]))});});\n'
        + overlay + '\n' + face + '\n'
        'return {apply:applyUnifiedFaceFrame,clear(){vrm.expressionManager?.resetValues();for(const {mesh} of state.unifiedFaceMorphs)mesh.morphTargetInfluences?.fill(0);vrm.expressionManager?.update();}};\n}\n', encoding='utf-8')
    files = {
        "three.module.js": "three/build/three.module.js",
        "loaders/GLTFLoader.js": "three/examples/jsm/loaders/GLTFLoader.js",
        "utils/BufferGeometryUtils.js": "three/examples/jsm/utils/BufferGeometryUtils.js",
        "three-vrm.module.js": "@pixiv/three-vrm/lib/three-vrm.module.js",
        "three-LICENSE.txt": "three/LICENSE",
        "three-vrm-LICENSE.txt": "@pixiv/three-vrm/LICENSE",
    }
    for name, source in files.items():
        dest = output / "vendor" / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(dependencies / source, dest)
    for file in (MOBILE / "avatar-validation/web").iterdir():
        if file.is_file():
            shutil.copyfile(file, output / file.name)
    manifest = {
        "purpose": "Offline avatar validation; no on-device inference benchmark",
        "avatar": {"source": avatar.name, "sha256": sha(avatar_bytes), "sourceBytes": len(avatar_bytes),
                   "packedSha256": sha(packed), "packedBytes": len(packed)},
        "apkSha256": sha(apk.read_bytes()), "clipSha256": sha(clip_bytes),
        "retargetSource": "retargetting/motion-control.js", "retargetCoreSha256": source_hash,
        "faceCoreSha256": sha((overlay + face).encode()),
        "dependencies": {name: json.loads((dependencies / name / "package.json").read_text())["version"]
                         for name in ["three", "@pixiv/three-vrm"]},
    }
    (output / "provenance.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--avatar", type=Path, required=True)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--dependencies", type=Path, required=True, help="retargetting/node_modules")
    parser.add_argument("--output", type=Path, default=MOBILE / "payloads/avatarAssets")
    args = parser.parse_args()
    prepare(args.avatar, args.apk, args.dependencies, args.output)
