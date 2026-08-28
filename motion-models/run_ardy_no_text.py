"""Generate constraint-only ARDY Core motion without loading a language model."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch

from ardy.constraints import load_constraints_lst
from ardy.model import load_model
from ardy.model.cfg import AutoLatentClassifierFreeGuidedModel
from ardy.motion_rep.tools import length_to_mask


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--constraints", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--frames", type=int, default=64)
    parser.add_argument("--steps", type=int, default=4)
    parser.add_argument("--constraint-guidance", type=float, default=2.0)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not torch.cuda.is_available():
        raise RuntimeError("A CUDA GPU is required for the feasibility run.")

    torch.manual_seed(args.seed)
    torch.cuda.manual_seed_all(args.seed)
    device = "cuda:0"
    torch.cuda.reset_peak_memory_stats()

    load_started = time.perf_counter()
    model = load_model("core8", device=device, text_encoder=False)
    # With zero text, regular CFG is exactly constraint-vs-unconditional and
    # needs two denoiser branches instead of separated CFG's three.
    model.denoiser = AutoLatentClassifierFreeGuidedModel(model.denoiser.model, cfg_type="regular")
    load_seconds = time.perf_counter() - load_started

    constraints = load_constraints_lst(str(args.constraints), model.skeleton)
    lengths = torch.tensor([args.frames], device=device)
    pad_mask = length_to_mask(lengths)
    observed_motion, motion_mask = model.motion_rep.create_conditions_from_constraints_batched(
        constraints,
        lengths,
        to_normalize=True,
        device=device,
    )
    text_feat = torch.zeros((1, 1, 4096), device=device)
    text_pad_mask = torch.zeros((1, 1), dtype=torch.bool, device=device)
    heading = torch.zeros(1, device=device)
    history_frames = int(10 * model.motion_rep.fps) - model.gen_horizon_len
    history_frames -= history_frames % model.num_frames_per_token

    torch.cuda.synchronize()
    generation_started = time.perf_counter()
    with torch.inference_mode():
        motion = model(
            [""],
            args.frames,
            num_denoising_steps=args.steps,
            pad_mask=pad_mask,
            first_heading_angle=heading,
            motion_mask=motion_mask,
            observed_motion=observed_motion,
            cfg_weight=args.constraint_guidance,
            text_feat=text_feat,
            text_pad_mask=text_pad_mask,
            crop_history_length=history_frames,
            progress_bar=lambda values: values,
        )
        output = model.motion_rep.inverse(motion, is_normalized=True, return_numpy=True)
    torch.cuda.synchronize()
    generation_seconds = time.perf_counter() - generation_started

    args.output.parent.mkdir(parents=True, exist_ok=True)
    arrays = {}
    for key, value in output.items():
        array = np.asarray(value)
        arrays[key] = array[0] if array.ndim and array.shape[0] == 1 else array
    arrays.update(
        fps=np.asarray(model.motion_rep.fps),
        joint_names=np.asarray(model.skeleton.bone_order_names),
        joint_parents=np.asarray(model.skeleton.joint_parents.cpu()),
        source=np.asarray("ARDY-Core-RP-20FPS-Horizon8 constraint-only (zero text embedding)"),
    )
    np.savez(args.output, **arrays)

    report = {
        "runtime": "ardy",
        "model": "ARDY-Core-RP-20FPS-Horizon8",
        "text_encoder": None,
        "language_model_loaded": False,
        "frames": args.frames,
        "fps": float(model.motion_rep.fps),
        "duration_seconds": args.frames / float(model.motion_rep.fps),
        "horizon_frames": model.gen_horizon_len,
        "diffusion_steps": args.steps,
        "cfg_type": "regular",
        "constraint_guidance": args.constraint_guidance,
        "load_seconds": load_seconds,
        "generation_seconds": generation_seconds,
        "realtime_factor": (args.frames / float(model.motion_rep.fps)) / generation_seconds,
        "peak_vram_gib": torch.cuda.max_memory_allocated() / 1024**3,
        "output": str(args.output.resolve()),
    }
    report_path = args.output.with_suffix(".benchmark.json")
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
