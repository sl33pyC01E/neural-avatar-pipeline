"""Generate constraint-only Kimodo motion without loading a language model."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch

from kimodo import load_model
from kimodo.constraints import load_constraints_lst


class ZeroTextEncoder:
    """Minimal encoder-compatible object; it owns no model weights."""

    def __init__(self, width: int = 4096) -> None:
        self.width = width

    def __call__(self, texts: list[str]) -> tuple[torch.Tensor, list[int]]:
        return torch.zeros((len(texts), 1, self.width), dtype=torch.float32), [0] * len(texts)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--constraints", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--frames", type=int, default=90)
    parser.add_argument("--steps", type=int, default=20)
    parser.add_argument("--constraint-guidance", type=float, default=2.0)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--postprocess", action="store_true")
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
    model = load_model(
        "kimodo-soma-rp-v1.1",
        device=device,
        text_encoder=ZeroTextEncoder(),
    )
    load_seconds = time.perf_counter() - load_started
    constraints = load_constraints_lst(str(args.constraints), model.skeleton, device=device)

    torch.cuda.synchronize()
    generation_started = time.perf_counter()
    with torch.inference_mode():
        output = model(
            "",
            args.frames,
            num_denoising_steps=args.steps,
            constraint_lst=constraints,
            cfg_type="regular",
            cfg_weight=args.constraint_guidance,
            num_samples=1,
            post_processing=args.postprocess,
            return_numpy=True,
            progress_bar=lambda values: values,
        )
    torch.cuda.synchronize()
    generation_seconds = time.perf_counter() - generation_started

    args.output.parent.mkdir(parents=True, exist_ok=True)
    arrays = {}
    for key, value in output.items():
        array = np.asarray(value)
        arrays[key] = array[0] if array.ndim and array.shape[0] == 1 else array
    arrays.update(
        fps=np.asarray(model.fps),
        joint_names=np.asarray(model.output_skeleton.bone_order_names),
        joint_parents=np.asarray(model.output_skeleton.joint_parents.cpu()),
        source=np.asarray("Kimodo-SOMA-RP-v1.1 constraint-only (zero text embedding)"),
    )
    np.savez(args.output, **arrays)

    report = {
        "runtime": "kimodo",
        "model": "Kimodo-SOMA-RP-v1.1",
        "text_encoder": type(model.text_encoder).__name__,
        "language_model_loaded": False,
        "frames": args.frames,
        "fps": float(model.fps),
        "duration_seconds": args.frames / float(model.fps),
        "diffusion_steps": args.steps,
        "cfg_type": "regular",
        "constraint_guidance": args.constraint_guidance,
        "load_seconds": load_seconds,
        "generation_seconds": generation_seconds,
        "realtime_factor": (args.frames / float(model.fps)) / generation_seconds,
        "peak_vram_gib": torch.cuda.max_memory_allocated() / 1024**3,
        "output": str(args.output.resolve()),
    }
    report_path = args.output.with_suffix(".benchmark.json")
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
