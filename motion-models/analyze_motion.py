"""Analyze an ARDY or Kimodo NPZ and render a compact skeleton contact sheet."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("motion", type=Path)
    parser.add_argument("--constraints", type=Path)
    parser.add_argument("--preview", type=Path)
    return parser.parse_args()


def percentile(values: np.ndarray, q: float) -> float:
    return float(np.percentile(values, q)) if values.size else 0.0


def main() -> None:
    args = parse_args()
    data = np.load(args.motion, allow_pickle=False)
    joints = np.asarray(data["posed_joints"], dtype=np.float64)
    if joints.ndim == 4 and joints.shape[0] == 1:
        joints = joints[0]
    parents = np.asarray(data["joint_parents"], dtype=np.int64)
    names = [str(name) for name in data["joint_names"].tolist()]
    fps = float(np.asarray(data["fps"]).item())
    root = np.asarray(data["root_positions"], dtype=np.float64)
    if root.ndim == 3 and root.shape[0] == 1:
        root = root[0]

    edges = [(int(parent), index) for index, parent in enumerate(parents) if parent >= 0]
    lengths = np.stack([np.linalg.norm(joints[:, child] - joints[:, parent], axis=-1) for parent, child in edges])
    length_means = np.maximum(lengths.mean(axis=1), 1e-8)
    relative_std = lengths.std(axis=1) / length_means
    velocities = np.linalg.norm(np.diff(joints, axis=0), axis=-1) * fps
    accelerations = np.linalg.norm(np.diff(joints, n=2, axis=0), axis=-1) * fps**2

    horizon = 8 if "ARDY" in str(np.asarray(data["source"]).item()) else None
    horizon_metrics = None
    if horizon and len(joints) > horizon:
        boundary_steps = np.arange(horizon - 1, len(joints) - 1, horizon)
        all_steps = np.arange(len(joints) - 1)
        regular_steps = np.setdiff1d(all_steps, boundary_steps)
        per_step_peak_speed = velocities.max(axis=1)
        horizon_metrics = {
            "boundary_peak_joint_speed_mps": percentile(per_step_peak_speed[boundary_steps], 95),
            "regular_peak_joint_speed_mps_p95": percentile(per_step_peak_speed[regular_steps], 95),
            "boundary_to_regular_ratio": (
                percentile(per_step_peak_speed[boundary_steps], 95)
                / max(percentile(per_step_peak_speed[regular_steps], 95), 1e-8)
            ),
        }

    contact_metrics = None
    if "foot_contacts" in data:
        contacts = np.asarray(data["foot_contacts"], dtype=bool)
        if contacts.ndim == 3 and contacts.shape[0] == 1:
            contacts = contacts[0]
        foot_names = ["LeftFoot", "LeftToeBase", "RightFoot", "RightToeBase"]
        if contacts.ndim == 2 and contacts.shape[1] == 4 and all(name in names for name in foot_names):
            foot_speeds = velocities[:, [names.index(name) for name in foot_names]]
            stable_contacts = contacts[1:] & contacts[:-1]
            contact_values = foot_speeds[stable_contacts]
            contact_metrics = {
                "samples": int(contact_values.size),
                "median_mps": percentile(contact_values, 50),
                "p95_mps": percentile(contact_values, 95),
            }

    path_errors = []
    if args.constraints:
        constraints = json.loads(args.constraints.read_text(encoding="utf-8"))
        for constraint in constraints:
            if constraint.get("type") != "root2d":
                continue
            targets = constraint.get("root_2d", constraint.get("smooth_root_2d"))
            for frame, target in zip(constraint["frame_indices"], targets):
                path_errors.append(float(np.linalg.norm(root[int(frame), [0, 2]] - np.asarray(target))))

    report = {
        "source": str(np.asarray(data["source"]).item()) if "source" in data else "unknown",
        "frames": int(joints.shape[0]),
        "joints": int(joints.shape[1]),
        "fps": fps,
        "finite": bool(np.isfinite(joints).all()),
        "root_travel_m": float(np.linalg.norm(np.diff(root[:, [0, 2]], axis=0), axis=-1).sum()),
        "root_displacement_m": float(np.linalg.norm(root[-1, [0, 2]] - root[0, [0, 2]])),
        "constraint_error_m": {
            "mean": float(np.mean(path_errors)) if path_errors else None,
            "max": float(np.max(path_errors)) if path_errors else None,
            "samples": path_errors,
        },
        "bone_length_relative_std": {
            "median": float(np.median(relative_std)),
            "p95": percentile(relative_std, 95),
            "max": float(relative_std.max()),
        },
        "joint_speed_mps": {"median": percentile(velocities, 50), "p95": percentile(velocities, 95)},
        "joint_acceleration_mps2": {
            "median": percentile(accelerations, 50),
            "p95": percentile(accelerations, 95),
        },
        "horizon_seams": horizon_metrics,
        "contact_foot_speed": contact_metrics,
    }
    report_path = args.motion.with_suffix(".quality.json")
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    preview = args.preview or args.motion.with_suffix(".preview.png")
    preview.parent.mkdir(parents=True, exist_ok=True)
    frame_indices = np.linspace(0, len(joints) - 1, 8, dtype=int)
    fig, axes = plt.subplots(2, 4, figsize=(15, 8), constrained_layout=True)
    for axis, frame in zip(axes.flat, frame_indices):
        pose = joints[frame]
        for parent, child in edges:
            axis.plot(
                [pose[parent, 0], pose[child, 0]],
                [pose[parent, 1], pose[child, 1]],
                color="#2774ae",
                linewidth=2,
            )
        axis.scatter(pose[:, 0], pose[:, 1], s=7, color="#e45756")
        axis.set_title(f"frame {frame} / {frame / fps:.2f}s")
        axis.set_aspect("equal", adjustable="box")
        axis.grid(alpha=0.2)
        axis.set_xlabel("X (m)")
        axis.set_ylabel("Y (m)")
    fig.suptitle(f"{report['source']} — front view", fontsize=14)
    fig.savefig(preview, dpi=150)
    plt.close(fig)

    print(json.dumps({**report, "preview": str(preview.resolve())}, indent=2))


if __name__ == "__main__":
    main()
