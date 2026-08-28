"""Export the official ARDY and Kimodo bind meshes for the local web viewer."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np


FACE_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = FACE_ROOT / "retargetting" / "motion-assets"
SOURCES = {
    "ardy": FACE_ROOT / "ardy" / "ardy" / "assets" / "skeletons" / "cskel27" / "skin_standard.npz",
    "kimodo": FACE_ROOT / "kimodo" / "kimodo" / "assets" / "skeletons" / "somaskel77" / "skin_standard.npz",
}


def export_mesh(engine: str, source: Path) -> None:
    data = np.load(source)
    positions = np.ascontiguousarray(data["bind_vertices"], dtype="<f4")
    indices = np.ascontiguousarray(data["faces"], dtype="<u4")
    payload = positions.tobytes() + indices.tobytes()
    binary_path = OUTPUT_ROOT / f"{engine}.meshbin"
    metadata_path = OUTPUT_ROOT / f"{engine}.mesh.json"
    binary_path.write_bytes(payload)
    metadata_path.write_text(
        json.dumps(
            {
                "engine": engine,
                "source": str(source),
                "vertexCount": int(positions.shape[0]),
                "faceCount": int(indices.shape[0]),
                "positionByteLength": int(positions.nbytes),
                "indexByteOffset": int(positions.nbytes),
                "indexByteLength": int(indices.nbytes),
                "binary": f"/motion-assets/{engine}.meshbin",
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"{engine}: {positions.shape[0]} vertices, {indices.shape[0]} faces")


def main() -> None:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    for engine, source in SOURCES.items():
        export_mesh(engine, source)


if __name__ == "__main__":
    main()
