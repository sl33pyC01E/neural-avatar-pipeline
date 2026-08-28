import argparse
import json
from pathlib import Path

import numpy as np


EMAGE_ROOT = Path.home() / "Documents" / "hooman" / "emage"
SMPLX_MODEL_FILE = EMAGE_ROOT / "emage_evaltools" / "smplx_models" / "smplx" / "SMPLX_NEUTRAL_2020.npz"
ARDY_SKIN_STANDARD_FILE = Path(__file__).resolve().parents[1] / "ardy" / "ardy" / "assets" / "skeletons" / "cskel27" / "skin_standard.npz"

BODY_EDGES = [
    [0, 3], [3, 6], [6, 9], [9, 12], [12, 15],
    [12, 13], [13, 16], [16, 18], [18, 20],
    [12, 14], [14, 17], [17, 19], [19, 21],
    [0, 1], [1, 4], [4, 7],
    [0, 2], [2, 5], [5, 8],
]

HAND_EDGES = [
    [20, 37], [37, 38], [38, 39], [39, 66],
    [20, 25], [25, 26], [26, 27], [27, 67],
    [20, 28], [28, 29], [29, 30], [30, 68],
    [20, 34], [34, 35], [35, 36], [36, 69],
    [20, 31], [31, 32], [32, 33], [33, 70],
    [21, 52], [52, 53], [53, 54], [54, 71],
    [21, 40], [40, 41], [41, 42], [42, 72],
    [21, 43], [43, 44], [44, 45], [45, 73],
    [21, 49], [49, 50], [50, 51], [51, 74],
    [21, 46], [46, 47], [47, 48], [48, 75],
]

JOINT_NAMES = {
    0: "pelvis",
    1: "left_hip",
    2: "right_hip",
    3: "spine1",
    4: "left_knee",
    5: "right_knee",
    6: "spine2",
    7: "left_ankle",
    8: "right_ankle",
    9: "spine3",
    12: "neck",
    13: "left_collar",
    14: "right_collar",
    15: "head",
    16: "left_shoulder",
    17: "right_shoulder",
    18: "left_elbow",
    19: "right_elbow",
    20: "left_wrist",
    21: "right_wrist",
}

IMPORTANT_BONES = {
    "left_upper_arm": [16, 18],
    "left_lower_arm": [18, 20],
    "right_upper_arm": [17, 19],
    "right_lower_arm": [19, 21],
    "left_collar": [13, 16],
    "right_collar": [14, 17],
    "neck_head": [12, 15],
}

KIMODO_SOMA77_NAMES = [
    "Hips", "Spine1", "Spine2", "Chest", "Neck1", "Neck2", "Head", "HeadEnd", "Jaw", "LeftEye", "RightEye",
    "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
    "LeftHandThumbMetacarpal", "LeftHandThumbProximal", "LeftHandThumbDistal", "LeftHandThumbTip",
    "LeftHandIndexMetacarpal", "LeftHandIndexProximal", "LeftHandIndexMiddle", "LeftHandIndexDistal", "LeftHandIndexTip",
    "LeftHandMiddleMetacarpal", "LeftHandMiddleProximal", "LeftHandMiddleMiddle", "LeftHandMiddleDistal", "LeftHandMiddleTip",
    "LeftHandRingMetacarpal", "LeftHandRingProximal", "LeftHandRingMiddle", "LeftHandRingDistal", "LeftHandRingTip",
    "LeftHandPinkyMetacarpal", "LeftHandPinkyProximal", "LeftHandPinkyMiddle", "LeftHandPinkyDistal", "LeftHandPinkyTip",
    "RightShoulder", "RightArm", "RightForeArm", "RightHand",
    "RightHandThumbMetacarpal", "RightHandThumbProximal", "RightHandThumbDistal", "RightHandThumbTip",
    "RightHandIndexMetacarpal", "RightHandIndexProximal", "RightHandIndexMiddle", "RightHandIndexDistal", "RightHandIndexTip",
    "RightHandMiddleMetacarpal", "RightHandMiddleProximal", "RightHandMiddleMiddle", "RightHandMiddleDistal", "RightHandMiddleTip",
    "RightHandRingMetacarpal", "RightHandRingProximal", "RightHandRingMiddle", "RightHandRingDistal", "RightHandRingTip",
    "RightHandPinkyMetacarpal", "RightHandPinkyProximal", "RightHandPinkyMiddle", "RightHandPinkyDistal", "RightHandPinkyTip",
    "LeftLeg", "LeftShin", "LeftFoot", "LeftToeBase", "LeftToeEnd",
    "RightLeg", "RightShin", "RightFoot", "RightToeBase", "RightToeEnd",
]

KIMODO_JOINT_ALIASES = {
    "Hips": "pelvis",
    "Spine1": "spine1",
    "Spine2": "spine2",
    "Chest": "spine3",
    "Neck1": "neck",
    "Neck2": "neck2",
    "Head": "head",
    "HeadEnd": "head_end",
    "Jaw": "jaw",
    "LeftEye": "left_eye",
    "RightEye": "right_eye",
    "LeftShoulder": "left_collar",
    "LeftArm": "left_shoulder",
    "LeftForeArm": "left_elbow",
    "LeftHand": "left_wrist",
    "RightShoulder": "right_collar",
    "RightArm": "right_shoulder",
    "RightForeArm": "right_elbow",
    "RightHand": "right_wrist",
    "LeftLeg": "left_hip",
    "LeftShin": "left_knee",
    "LeftFoot": "left_ankle",
    "LeftToeBase": "left_toe",
    "LeftToeEnd": "left_toe_end",
    "RightLeg": "right_hip",
    "RightShin": "right_knee",
    "RightFoot": "right_ankle",
    "RightToeBase": "right_toe",
    "RightToeEnd": "right_toe_end",
}

KIMODO_BODY_EDGES = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7],
    [6, 8], [6, 9], [6, 10],
    [3, 11], [11, 12], [12, 13], [13, 14],
    [3, 39], [39, 40], [40, 41], [41, 42],
    [0, 67], [67, 68], [68, 69], [69, 70], [70, 71],
    [0, 72], [72, 73], [73, 74], [74, 75], [75, 76],
]

KIMODO_HAND_EDGES = [
    [14, 15], [15, 16], [16, 17], [17, 18],
    [14, 19], [19, 20], [20, 21], [21, 22], [22, 23],
    [14, 24], [24, 25], [25, 26], [26, 27], [27, 28],
    [14, 29], [29, 30], [30, 31], [31, 32], [32, 33],
    [14, 34], [34, 35], [35, 36], [36, 37], [37, 38],
    [42, 43], [43, 44], [44, 45], [45, 46],
    [42, 47], [47, 48], [48, 49], [49, 50], [50, 51],
    [42, 52], [52, 53], [53, 54], [54, 55], [55, 56],
    [42, 57], [57, 58], [58, 59], [59, 60], [60, 61],
    [42, 62], [62, 63], [63, 64], [64, 65], [65, 66],
]

KIMODO_IMPORTANT_BONES = {
    "left_upper_arm": [12, 13],
    "left_lower_arm": [13, 14],
    "right_upper_arm": [40, 41],
    "right_lower_arm": [41, 42],
    "left_collar": [11, 12],
    "right_collar": [39, 40],
    "neck_head": [4, 6],
}

ARDY_CORE27_NAMES = [
    "Hips",
    "Spine", "Spine1", "Spine2", "Spine3", "Neck", "Head",
    "RightShoulder", "RightArm", "RightForeArm", "RightHand", "RightHandEnd", "RightHandThumb1",
    "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand", "LeftHandEnd", "LeftHandThumb1",
    "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase",
    "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase",
]

ARDY_CORE27_ALIASES = {
    "Hips": "pelvis",
    "Spine": "spine1",
    "Spine1": "spine2",
    "Spine2": "spine2_mid",
    "Spine3": "spine3",
    "Neck": "neck",
    "Head": "head",
    "RightShoulder": "right_collar",
    "RightArm": "right_shoulder",
    "RightForeArm": "right_elbow",
    "RightHand": "right_wrist",
    "RightHandEnd": "right_hand_end",
    "RightHandThumb1": "right_thumb",
    "LeftShoulder": "left_collar",
    "LeftArm": "left_shoulder",
    "LeftForeArm": "left_elbow",
    "LeftHand": "left_wrist",
    "LeftHandEnd": "left_hand_end",
    "LeftHandThumb1": "left_thumb",
    "RightUpLeg": "right_hip",
    "RightLeg": "right_knee",
    "RightFoot": "right_ankle",
    "RightToeBase": "right_toe",
    "LeftUpLeg": "left_hip",
    "LeftLeg": "left_knee",
    "LeftFoot": "left_ankle",
    "LeftToeBase": "left_toe",
}

ARDY_CORE27_BODY_EDGES = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6],
    [4, 7], [7, 8], [8, 9], [9, 10], [10, 11], [10, 12],
    [4, 13], [13, 14], [14, 15], [15, 16], [16, 17], [16, 18],
    [0, 19], [19, 20], [20, 21], [21, 22],
    [0, 23], [23, 24], [24, 25], [25, 26],
]

ARDY_CORE27_IMPORTANT_BONES = {
    "left_upper_arm": [14, 15],
    "left_lower_arm": [15, 16],
    "right_upper_arm": [8, 9],
    "right_lower_arm": [9, 10],
    "left_collar": [13, 14],
    "right_collar": [7, 8],
    "neck_head": [5, 6],
}


def rounded(values, digits=5):
    return np.asarray(values, dtype=np.float32).round(digits).tolist()


def unit_vector(values):
    values = np.asarray(values, dtype=np.float32)
    norm = np.linalg.norm(values, axis=-1, keepdims=True)
    return np.divide(values, np.maximum(norm, 1e-6))


def angle_between(a, b):
    a = unit_vector(a)
    b = unit_vector(b)
    dot = np.clip(np.sum(a * b, axis=-1), -1.0, 1.0)
    return np.degrees(np.arccos(dot))


def stat_block(values):
    values = np.asarray(values, dtype=np.float32)
    return {
        "min": float(values.min()),
        "max": float(values.max()),
        "mean": float(values.mean()),
        "std": float(values.std()),
    }


def load_betas(data):
    betas = np.asarray(data["betas"], dtype=np.float32) if "betas" in data else np.zeros(300, dtype=np.float32)
    betas = betas.reshape(-1)
    if betas.shape[0] < 300:
        betas = np.pad(betas, (0, 300 - betas.shape[0]))
    return betas[:300]


def smplx_joints(data, include_global=True):
    if not SMPLX_MODEL_FILE.exists():
        raise FileNotFoundError(f"SMPL-X model file not found: {SMPLX_MODEL_FILE}")

    import torch
    import smplx

    poses = np.asarray(data["poses"], dtype=np.float32)
    if poses.ndim != 2 or poses.shape[1] < 165:
        raise ValueError(f"Unexpected EMAGE poses shape: {poses.shape}")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = smplx.SMPLX(
        str(SMPLX_MODEL_FILE),
        gender="neutral",
        use_pca=False,
        num_betas=300,
        num_expression_coeffs=100,
        batch_size=1,
    ).to(device).eval()

    pose_tensor = torch.from_numpy(poses).to(device)
    betas = torch.from_numpy(load_betas(data)).to(device)
    trans = np.asarray(data["trans"], dtype=np.float32) if "trans" in data else np.zeros((poses.shape[0], 3), dtype=np.float32)
    trans_tensor = torch.from_numpy(trans).to(device)
    expressions = np.asarray(data["expressions"], dtype=np.float32) if "expressions" in data else np.zeros((poses.shape[0], 100), dtype=np.float32)
    expressions_tensor = torch.from_numpy(expressions[:, :100]).to(device)

    chunks = []
    chunk_size = 160 if device == "cuda" else 48
    with torch.no_grad():
      for start in range(0, pose_tensor.shape[0], chunk_size):
          chunk = pose_tensor[start:start + chunk_size]
          count = chunk.shape[0]
          transl = trans_tensor[start:start + chunk_size] if include_global else torch.zeros(count, 3, device=device)
          output = model(
              betas=betas.unsqueeze(0).repeat(count, 1),
              transl=transl,
              expression=expressions_tensor[start:start + chunk_size],
              jaw_pose=chunk[:, 22 * 3:23 * 3],
              global_orient=chunk[:, :3] if include_global else torch.zeros(count, 3, device=device),
              body_pose=chunk[:, 3:22 * 3],
              left_hand_pose=chunk[:, 25 * 3:40 * 3],
              right_hand_pose=chunk[:, 40 * 3:55 * 3],
              leye_pose=chunk[:, 23 * 3:24 * 3],
              reye_pose=chunk[:, 24 * 3:25 * 3],
              return_joints=True,
          )
          chunks.append(output.joints[:, :76, :].detach().cpu().numpy())

    return np.concatenate(chunks, axis=0)


def motion_stats(joints):
    centered = joints - joints[:, 0:1, :]
    left_upper = centered[:, 18] - centered[:, 16]
    left_lower = centered[:, 20] - centered[:, 18]
    right_upper = centered[:, 19] - centered[:, 17]
    right_lower = centered[:, 21] - centered[:, 19]
    left_elbow = angle_between(left_upper, left_lower)
    right_elbow = angle_between(right_upper, right_lower)
    left_wrist = centered[:, 20]
    right_wrist = centered[:, 21]
    left_wrist_travel = np.linalg.norm(np.diff(left_wrist, axis=0), axis=1).sum() if len(joints) > 1 else 0.0
    right_wrist_travel = np.linalg.norm(np.diff(right_wrist, axis=0), axis=1).sum() if len(joints) > 1 else 0.0
    span = np.linalg.norm(centered[:, 20] - centered[:, 21], axis=1)

    bone_lengths = {}
    important_rel_std = []

    def relative_std_for_edge(edge):
        a, b = edge
        lengths = np.linalg.norm(centered[:, b] - centered[:, a], axis=1)
        mean = float(lengths.mean())
        std = float(lengths.std())
        rel_std = float(std / max(abs(mean), 1e-6))
        return mean, std, rel_std

    for name, edge in IMPORTANT_BONES.items():
        mean, std, rel_std = relative_std_for_edge(edge)
        important_rel_std.append(rel_std)
        bone_lengths[name] = {
            "meanM": mean,
            "stdM": std,
            "relativeStd": rel_std,
        }

    body_rel_std = [relative_std_for_edge(edge)[2] for edge in BODY_EDGES]
    hand_rel_std = [relative_std_for_edge(edge)[2] for edge in HAND_EDGES]
    all_rel_std = important_rel_std + body_rel_std + hand_rel_std

    return {
        "leftElbowDeg": stat_block(left_elbow),
        "rightElbowDeg": stat_block(right_elbow),
        "leftWristTravelM": float(left_wrist_travel),
        "rightWristTravelM": float(right_wrist_travel),
        "wristSpanM": stat_block(span),
        "importantBoneLengths": bone_lengths,
        "coreBoneLengthMaxRelativeStd": float(max(important_rel_std) if important_rel_std else 0.0),
        "bodyBoneLengthMaxRelativeStd": float(max(body_rel_std) if body_rel_std else 0.0),
        "handBoneLengthMaxRelativeStd": float(max(hand_rel_std) if hand_rel_std else 0.0),
        "maxBoneLengthRelativeStd": float(max(all_rel_std) if all_rel_std else 0.0),
    }


def motion_stats_for_layout(joints, important_bones, body_edges, hand_edges, elbow_indices, wrist_indices):
    centered = joints - joints[:, 0:1, :]
    left_upper = centered[:, elbow_indices["left_upper"][1]] - centered[:, elbow_indices["left_upper"][0]]
    left_lower = centered[:, elbow_indices["left_lower"][1]] - centered[:, elbow_indices["left_lower"][0]]
    right_upper = centered[:, elbow_indices["right_upper"][1]] - centered[:, elbow_indices["right_upper"][0]]
    right_lower = centered[:, elbow_indices["right_lower"][1]] - centered[:, elbow_indices["right_lower"][0]]
    left_elbow = angle_between(left_upper, left_lower)
    right_elbow = angle_between(right_upper, right_lower)
    left_wrist = centered[:, wrist_indices["left"]]
    right_wrist = centered[:, wrist_indices["right"]]
    left_wrist_travel = np.linalg.norm(np.diff(left_wrist, axis=0), axis=1).sum() if len(joints) > 1 else 0.0
    right_wrist_travel = np.linalg.norm(np.diff(right_wrist, axis=0), axis=1).sum() if len(joints) > 1 else 0.0
    span = np.linalg.norm(left_wrist - right_wrist, axis=1)

    bone_lengths = {}
    important_rel_std = []

    def relative_std_for_edge(edge):
        a, b = edge
        lengths = np.linalg.norm(centered[:, b] - centered[:, a], axis=1)
        mean = float(lengths.mean())
        std = float(lengths.std())
        rel_std = float(std / max(abs(mean), 1e-6))
        return mean, std, rel_std

    for name, edge in important_bones.items():
        mean, std, rel_std = relative_std_for_edge(edge)
        important_rel_std.append(rel_std)
        bone_lengths[name] = {
            "meanM": mean,
            "stdM": std,
            "relativeStd": rel_std,
        }

    body_rel_std = [relative_std_for_edge(edge)[2] for edge in body_edges]
    hand_rel_std = [relative_std_for_edge(edge)[2] for edge in hand_edges]
    all_rel_std = important_rel_std + body_rel_std + hand_rel_std

    return {
        "leftElbowDeg": stat_block(left_elbow),
        "rightElbowDeg": stat_block(right_elbow),
        "leftWristTravelM": float(left_wrist_travel),
        "rightWristTravelM": float(right_wrist_travel),
        "wristSpanM": stat_block(span),
        "importantBoneLengths": bone_lengths,
        "coreBoneLengthMaxRelativeStd": float(max(important_rel_std) if important_rel_std else 0.0),
        "bodyBoneLengthMaxRelativeStd": float(max(body_rel_std) if body_rel_std else 0.0),
        "handBoneLengthMaxRelativeStd": float(max(hand_rel_std) if hand_rel_std else 0.0),
        "maxBoneLengthRelativeStd": float(max(all_rel_std) if all_rel_std else 0.0),
    }


def kimodo_joint_names(count):
    if count == len(KIMODO_SOMA77_NAMES):
        return {
            str(index): KIMODO_JOINT_ALIASES.get(name, name)
            for index, name in enumerate(KIMODO_SOMA77_NAMES)
        }
    return {str(index): f"joint_{index}" for index in range(count)}


def ardy_joint_names(count):
    if count == len(ARDY_CORE27_NAMES):
        return {
            str(index): ARDY_CORE27_ALIASES.get(name, name)
            for index, name in enumerate(ARDY_CORE27_NAMES)
        }
    return {str(index): f"joint_{index}" for index in range(count)}


def ardy_bind_joints():
    if not ARDY_SKIN_STANDARD_FILE.exists():
        return None
    skin = np.load(ARDY_SKIN_STANDARD_FILE, allow_pickle=True)
    transforms = np.asarray(skin["bind_rig_transform"], dtype=np.float32)
    names = [str(name) for name in np.asarray(skin["rig_joint_names"]).tolist()]
    if transforms.shape != (len(ARDY_CORE27_NAMES), 4, 4) or names != ARDY_CORE27_NAMES:
        return None
    joints = transforms[:, :3, 3]
    return joints - joints[0:1]


def kimodo_fps(data):
    for key in ("fps", "frame_rate", "mocap_frame_rate"):
        if key in data:
            try:
                return int(np.asarray(data[key]).item())
            except Exception:
                pass
    return 30


def build_kimodo_payload(input_path, data):
    joints = np.asarray(data["posed_joints"], dtype=np.float32)
    if joints.ndim == 4 and joints.shape[0] == 1:
        joints = joints[0]
    if joints.ndim != 3 or joints.shape[2] != 3:
        raise ValueError(f"Unexpected Kimodo posed_joints shape: {joints.shape}")

    centered = joints - joints[:, 0:1, :]
    flat = centered.reshape(-1, 3)
    bounds_min = flat.min(axis=0)
    bounds_max = flat.max(axis=0)
    fps = kimodo_fps(data)

    is_ardy_core = joints.shape[1] == len(ARDY_CORE27_NAMES)
    bind_joints = ardy_bind_joints() if is_ardy_core else None
    if joints.shape[1] == len(KIMODO_SOMA77_NAMES):
        body_edges = KIMODO_BODY_EDGES
        hand_edges = KIMODO_HAND_EDGES
        stats = motion_stats_for_layout(
            joints,
            KIMODO_IMPORTANT_BONES,
            body_edges,
            hand_edges,
            {
                "left_upper": [12, 13],
                "left_lower": [13, 14],
                "right_upper": [40, 41],
                "right_lower": [41, 42],
            },
            {"left": 14, "right": 42},
        )
    elif is_ardy_core:
        body_edges = ARDY_CORE27_BODY_EDGES
        hand_edges = []
        stats = motion_stats_for_layout(
            joints,
            ARDY_CORE27_IMPORTANT_BONES,
            body_edges,
            hand_edges,
            {
                "left_upper": [14, 15],
                "left_lower": [15, 16],
                "right_upper": [8, 9],
                "right_lower": [9, 10],
            },
            {"left": 16, "right": 10},
        )
    else:
        body_edges = []
        hand_edges = []
        stats = {
            "coreBoneLengthMaxRelativeStd": 0.0,
            "bodyBoneLengthMaxRelativeStd": 0.0,
            "handBoneLengthMaxRelativeStd": 0.0,
            "maxBoneLengthRelativeStd": 0.0,
        }

    return {
        "sourceType": "ardy" if is_ardy_core else "kimodo",
        "source": (
            f"ARDY Core-27: {Path(input_path).resolve()}"
            if is_ardy_core
            else f"Kimodo SOMA: {Path(input_path).resolve()}"
        ),
        "fps": fps,
        "frameCount": int(joints.shape[0]),
        "duration": float(joints.shape[0] / max(1, fps)),
        "joints": rounded(joints),
        "centeredJoints": rounded(centered),
        **({"restCenteredJoints": rounded(bind_joints), "restSource": str(ARDY_SKIN_STANDARD_FILE.resolve())} if bind_joints is not None else {}),
        "rootTrajectory": rounded(joints[:, 0, :]),
        "edges": {
            "body": body_edges,
            "hands": hand_edges,
        },
        "jointNames": ardy_joint_names(joints.shape[1]) if is_ardy_core else kimodo_joint_names(joints.shape[1]),
        "bounds": {
            "min": rounded(bounds_min),
            "max": rounded(bounds_max),
            "span": float(np.max(bounds_max - bounds_min)),
        },
        "stats": stats,
    }


def build_payload(input_path):
    data = np.load(input_path, allow_pickle=True)
    if "posed_joints" in data:
        return build_kimodo_payload(input_path, data)
    if "poses" not in data:
        raise ValueError("Expected EMAGE NPZ with a 'poses' array or Kimodo NPZ with 'posed_joints'.")

    joints = smplx_joints(data, include_global=True)
    centered = joints - joints[:, 0:1, :]
    flat = centered.reshape(-1, 3)
    bounds_min = flat.min(axis=0)
    bounds_max = flat.max(axis=0)

    fps = 30
    if "mocap_frame_rate" in data:
        try:
            fps = int(np.asarray(data["mocap_frame_rate"]).item())
        except Exception:
            fps = 30

    return {
        "sourceType": "emage",
        "source": str(Path(input_path).resolve()),
        "fps": fps,
        "frameCount": int(joints.shape[0]),
        "duration": float(joints.shape[0] / max(1, fps)),
        "joints": rounded(joints),
        "centeredJoints": rounded(centered),
        "rootTrajectory": rounded(joints[:, 0, :]),
        "edges": {
            "body": BODY_EDGES,
            "hands": HAND_EDGES,
        },
        "jointNames": {str(i): JOINT_NAMES.get(i, f"joint_{i}") for i in range(joints.shape[1])},
        "bounds": {
            "min": rounded(bounds_min),
            "max": rounded(bounds_max),
            "span": float(np.max(bounds_max - bounds_min)),
        },
        "stats": motion_stats(joints),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", default="")
    args = parser.parse_args()

    payload = build_payload(args.input)
    text = json.dumps(payload, separators=(",", ":"))
    if args.output:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(text, encoding="utf-8")
        print(json.dumps({
            "ok": True,
            "path": str(out_path),
            "frameCount": payload["frameCount"],
            "maxBoneLengthRelativeStd": payload["stats"]["maxBoneLengthRelativeStd"],
        }))
    else:
        print(text)


if __name__ == "__main__":
    main()
