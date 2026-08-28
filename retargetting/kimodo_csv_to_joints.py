from __future__ import annotations

import argparse
import json
import math
import warnings
from pathlib import Path
from typing import Any

import numpy as np
import torch

warnings.filterwarnings("ignore", category=FutureWarning)

from kimodo.exports.mujoco import MujocoQposConverter
from kimodo.geometry import quaternion_to_matrix
from kimodo.skeleton.registry import build_skeleton

G1_RETARGET_ALIASES = {
    "pelvis_skel": "pelvis",
    "left_hip_pitch_skel": "left_hip",
    "left_knee_skel": "left_knee",
    "left_ankle_roll_skel": "left_ankle",
    "right_hip_pitch_skel": "right_hip",
    "right_knee_skel": "right_knee",
    "right_ankle_roll_skel": "right_ankle",
    "waist_yaw_skel": "spine1",
    "waist_roll_skel": "spine2",
    "waist_pitch_skel": "spine3",
    "left_shoulder_pitch_skel": "left_collar",
    "left_shoulder_yaw_skel": "left_shoulder",
    "left_elbow_skel": "left_elbow",
    "left_wrist_yaw_skel": "left_wrist",
    "right_shoulder_pitch_skel": "right_collar",
    "right_shoulder_yaw_skel": "right_shoulder",
    "right_elbow_skel": "right_elbow",
    "right_wrist_yaw_skel": "right_wrist",
}


def finite_bounds(points: np.ndarray) -> dict[str, list[float]]:
    flat = points.reshape(-1, 3)
    finite = flat[np.isfinite(flat).all(axis=1)]
    if finite.size == 0:
        return {"min": [0.0, 0.0, 0.0], "max": [0.0, 0.0, 0.0], "size": [0.0, 0.0, 0.0]}
    mn = finite.min(axis=0)
    mx = finite.max(axis=0)
    return {
        "min": np.round(mn, 6).astype(float).tolist(),
        "max": np.round(mx, 6).astype(float).tolist(),
        "size": np.round(mx - mn, 6).astype(float).tolist(),
    }


def rounded_list(array: np.ndarray, decimals: int = 6) -> list[Any]:
    return np.round(array.astype(np.float64), decimals).tolist()


def append_g1_retarget_points(joints: np.ndarray, joint_names: list[str], body_edges: list[list[int]]) -> tuple[np.ndarray, list[str], list[list[int]]]:
    name_to_index = {name: index for index, name in enumerate(joint_names)}
    spine_index = name_to_index.get("waist_pitch_skel", 0)
    pelvis_index = name_to_index.get("pelvis_skel", 0)
    spine = joints[:, spine_index, :]
    pelvis = joints[:, pelvis_index, :]
    up = spine - pelvis
    lengths = np.linalg.norm(up, axis=1, keepdims=True)
    up = np.divide(up, np.maximum(lengths, 1e-6))
    neck = spine + up * 0.16
    head = spine + up * 0.30
    neck_index = len(joint_names)
    head_index = neck_index + 1
    joints = np.concatenate([joints, neck[:, None, :], head[:, None, :]], axis=1)
    joint_names = joint_names + ["neck", "head"]
    body_edges = body_edges + [[spine_index, neck_index], [neck_index, head_index]]
    return joints, joint_names, body_edges


def qpos_to_fk_motion(converter: MujocoQposConverter, qpos_np: np.ndarray) -> dict[str, torch.Tensor]:
    """Reconstruct G1 local rotations and joint positions without Kimodo's smoothing pass."""
    qpos = torch.from_numpy(qpos_np.astype(np.float32))
    if qpos.dim() == 2:
        qpos = qpos.unsqueeze(0)
    if qpos.dim() != 3 or int(qpos.shape[-1]) != 36:
        raise ValueError(f"Expected qpos shape (T,36) or (1,T,36); got {tuple(qpos.shape)}")

    device = qpos.device
    dtype = qpos.dtype
    batch_size, num_frames, _ = qpos.shape
    if batch_size != 1:
        raise ValueError(f"Only a single Kimodo clip is supported; got batch_size={batch_size}")

    kimodo_to_mujoco_matrix = converter.kimodo_to_mujoco_matrix.to(device=device, dtype=dtype)
    mujoco_to_kimodo_matrix = kimodo_to_mujoco_matrix.T

    root_mujoco = qpos[..., :3]
    root_positions = torch.matmul(mujoco_to_kimodo_matrix[None, None, ...], root_mujoco[..., None]).squeeze(-1)

    root_rot_mujoco = quaternion_to_matrix(qpos[..., 3:7])
    root_offset = converter._rot_offsets_f2q[0].to(device=device, dtype=dtype)
    root_rot_f2q = torch.einsum(
        "ij,...jk,kl->...il",
        mujoco_to_kimodo_matrix,
        root_rot_mujoco,
        kimodo_to_mujoco_matrix,
    )
    root_rot_kimodo = torch.einsum("ij,...jk->...ik", root_offset.T, root_rot_f2q)

    template = torch.eye(3, device=device, dtype=dtype).expand(
        batch_size,
        num_frames,
        converter.skeleton.nbjoints,
        3,
        3,
    ).contiguous()
    template[:, :, 0] = root_rot_kimodo
    local_rot_mats = converter._joint_dofs_to_local_rot_mats(
        qpos[..., 7:],
        template,
        device,
        dtype,
        use_relative=False,
    )
    global_rot_mats, posed_joints, _ = converter.skeleton.fk(local_rot_mats[0], root_positions[0])
    return {
        "posed_joints": posed_joints,
        "global_rot_mats": global_rot_mats,
        "local_rot_mats": local_rot_mats[0],
        "root_positions": root_positions[0],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert Kimodo G1 MuJoCo qpos CSV into 3D joint tracks.")
    parser.add_argument("--csv", required=True, help="Kimodo-generated MuJoCo qpos CSV.")
    parser.add_argument("--out", required=True, help="Output JSON path.")
    parser.add_argument("--fps", type=float, default=30.0, help="Source motion FPS.")
    args = parser.parse_args()

    csv_path = Path(args.csv).resolve()
    out_path = Path(args.out).resolve()
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV does not exist: {csv_path}")

    qpos = np.loadtxt(str(csv_path), delimiter=",")
    if qpos.ndim == 1:
        qpos = qpos[None, :]
    if qpos.ndim != 2 or qpos.shape[1] != 36:
        raise ValueError(f"Expected Kimodo G1 qpos CSV with shape (T,36); got {tuple(qpos.shape)}")

    fps = float(args.fps or 30.0)
    if not math.isfinite(fps) or fps <= 0:
        fps = 30.0

    skeleton = build_skeleton(34)
    converter = MujocoQposConverter(skeleton)
    motion = qpos_to_fk_motion(converter, qpos)

    joints = motion["posed_joints"].detach().cpu().numpy().astype(np.float64)
    root_index = int(skeleton.root_idx)
    root_positions = joints[:, root_index, :]
    centered = joints - root_positions[:, None, :]

    parents = skeleton.joint_parents.detach().cpu().numpy().astype(int)
    body_edges = [[int(parent), int(index)] for index, parent in enumerate(parents) if parent >= 0]
    original_joint_names = list(skeleton.bone_order_names)
    joints, original_joint_names, body_edges = append_g1_retarget_points(joints, original_joint_names, body_edges)
    joint_names = [G1_RETARGET_ALIASES.get(name, name) for name in original_joint_names]
    key_names = [
        "pelvis_skel",
        "waist_pitch_skel",
        "left_shoulder_pitch_skel",
        "left_elbow_skel",
        "left_wrist_yaw_skel",
        "left_hand_roll_skel",
        "right_shoulder_pitch_skel",
        "right_elbow_skel",
        "right_wrist_yaw_skel",
        "right_hand_roll_skel",
        "left_knee_skel",
        "left_ankle_roll_skel",
        "right_knee_skel",
        "right_ankle_roll_skel",
    ]
    key_indices = [original_joint_names.index(name) for name in key_names if name in original_joint_names]

    bounds = finite_bounds(joints)
    centered_bounds = finite_bounds(centered)
    span = math.sqrt(sum(float(v) * float(v) for v in bounds["size"]))
    centered_span = math.sqrt(sum(float(v) * float(v) for v in centered_bounds["size"]))

    payload = {
        "kind": "kimodo-g1",
        "sourceType": "kimodo",
        "sourceModel": "kimodo-g1",
        "source": f"Kimodo G1 CSV: {csv_path}",
        "fps": fps,
        "frameCount": int(joints.shape[0]),
        "duration": float(joints.shape[0] / fps),
        "rootIndex": root_index,
        "jointNames": joint_names,
        "keyJointIndices": key_indices,
        "edges": {"body": body_edges, "hands": []},
        "joints": rounded_list(joints),
        "centeredJoints": rounded_list(centered),
        "rootPositions": rounded_list(root_positions),
        "bounds": bounds,
        "centeredBounds": centered_bounds,
        "stats": {
            "source": str(csv_path),
            "qposColumns": int(qpos.shape[1]),
            "frames": int(joints.shape[0]),
            "joints": int(joints.shape[1]),
            "fps": fps,
            "duration": float(joints.shape[0] / fps),
            "span": round(span, 6),
            "centeredSpan": round(centered_span, 6),
            "root": joint_names[root_index],
        },
    }

    if "foot_contacts" in motion:
        contacts = motion["foot_contacts"].detach().cpu().numpy()
        payload["footContacts"] = rounded_list(contacts, 4)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload), encoding="utf-8")
    print(json.dumps({"ok": True, "out": str(out_path), "frames": int(joints.shape[0]), "joints": int(joints.shape[1])}))


if __name__ == "__main__":
    main()
