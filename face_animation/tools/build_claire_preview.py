"""Build Face Lab's compact point preview from Audio2Face's Claire rig."""

from __future__ import annotations

import json
import struct
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = ROOT / "Audio2Face-3D-SDK" / "_data" / "audio2face-models" / "audio2face-3d-v3.0"
OUTPUT = ROOT / "assets" / "project_examples" / "audio2face-claire-points.glb"


def align4(data: bytearray) -> None:
    data.extend(b"\0" * ((-len(data)) % 4))


def main() -> None:
    rig = np.load(MODEL_DIR / "bs_skin_Claire.npz")
    names = [value.decode("utf-8") for value in rig["poseNames"].tolist()][1:]
    mask = rig["frontalMask"].astype(np.int64)
    neutral = np.asarray(rig["neutral"][mask], dtype="<f4")

    binary = bytearray()
    buffer_views: list[dict] = []
    accessors: list[dict] = []

    def add_vec3(values: np.ndarray, include_bounds: bool = False) -> int:
        align4(binary)
        offset = len(binary)
        payload = np.ascontiguousarray(values, dtype="<f4").tobytes()
        binary.extend(payload)
        view_index = len(buffer_views)
        buffer_views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(payload), "target": 34962})
        accessor = {"bufferView": view_index, "componentType": 5126, "count": len(values), "type": "VEC3"}
        if include_bounds:
            accessor["min"] = values.min(axis=0).astype(float).tolist()
            accessor["max"] = values.max(axis=0).astype(float).tolist()
        accessors.append(accessor)
        return len(accessors) - 1

    position_accessor = add_vec3(neutral, include_bounds=True)
    targets = []
    for name in names:
        delta = np.asarray(rig[name][mask] - neutral, dtype="<f4")
        targets.append({"POSITION": add_vec3(delta)})

    document = {
        "asset": {"version": "2.0", "generator": "Face Lab Audio2Face Claire preview"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "Claire_Audio2Face_v3"}],
        "meshes": [{
            "name": "Claire frontal geometry",
            "weights": [0.0] * len(names),
            "primitives": [{
                "attributes": {"POSITION": position_accessor},
                "targets": targets,
                "mode": 0,
                "extras": {"targetNames": names},
            }],
        }],
        "buffers": [{"byteLength": len(binary)}],
        "bufferViews": buffer_views,
        "accessors": accessors,
    }

    json_bytes = json.dumps(document, separators=(",", ":")).encode("utf-8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)
    align4(binary)
    total = 12 + 8 + len(json_bytes) + 8 + len(binary)
    output = bytearray(struct.pack("<4sII", b"glTF", 2, total))
    output.extend(struct.pack("<I4s", len(json_bytes), b"JSON"))
    output.extend(json_bytes)
    output.extend(struct.pack("<I4s", len(binary), b"BIN\0"))
    output.extend(binary)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_bytes(output)
    print(f"Wrote {OUTPUT} ({len(output) / 1024**2:.1f} MiB, {len(neutral)} points, {len(names)} controls)")


if __name__ == "__main__":
    main()
