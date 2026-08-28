"""Persistent local HTTP worker for constraint-driven ARDY or Kimodo inference."""

from __future__ import annotations

import argparse
import gc
import hashlib
import json
import math
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import numpy as np
import torch

from runtime_watchdog import start_parent_watchdog


start_parent_watchdog()


ROOT = Path(__file__).resolve().parent
OUTPUT_ROOT = ROOT / "outputs" / "webui"
QUANTIZED_ENCODER_ROOT = ROOT / "models" / "ardy-llm2vec-4bit"
TEXT_CACHE_ROOT = ROOT / "models" / "text-embedding-cache"


def compact_points(points: list[dict[str, Any]]) -> list[tuple[float, float]]:
    compacted: list[tuple[float, float]] = []
    for item in points:
        point = (float(item.get("x", 0)), float(item.get("z", 0)))
        if not compacted or math.dist(point, compacted[-1]) > 1e-5:
            compacted.append(point)
    return compacted


def timed_waypoints(points: list[tuple[float, float]], num_frames: int) -> tuple[list[int], list[list[float]]]:
    if len(points) < 2:
        raise ValueError("Add at least two distinct route points.")
    segment_lengths = [math.dist(points[index - 1], points[index]) for index in range(1, len(points))]
    total = sum(segment_lengths)
    if total <= 1e-6:
        raise ValueError("The route has no travel distance.")
    cumulative = [0.0]
    for length in segment_lengths:
        cumulative.append(cumulative[-1] + length)
    raw_frames = [round(value / total * (num_frames - 1)) for value in cumulative]
    frame_to_point: dict[int, tuple[float, float]] = {}
    for frame, point in zip(raw_frames, points):
        frame_to_point[int(frame)] = point
    frame_to_point[0] = points[0]
    frame_to_point[num_frames - 1] = points[-1]
    frames = sorted(frame_to_point)
    values = [[float(frame_to_point[frame][0]), float(frame_to_point[frame][1])] for frame in frames]
    return frames, values


def headings_from_waypoints(values: list[list[float]]) -> list[float]:
    headings: list[float] = []
    for index, point in enumerate(values):
        other = values[index + 1] if index + 1 < len(values) else values[index - 1]
        dx = other[0] - point[0] if index + 1 < len(values) else point[0] - other[0]
        dz = other[1] - point[1] if index + 1 < len(values) else point[1] - other[1]
        headings.append(math.atan2(dx, dz))
    return headings


def route_point_at_fraction(points: list[tuple[float, float]], fraction: float) -> list[float]:
    """Sample a polyline by distance, matching the web route timeline."""
    if len(points) < 2:
        raise ValueError("Add at least two distinct route points.")
    lengths = [math.dist(points[index - 1], points[index]) for index in range(1, len(points))]
    total = sum(lengths)
    if total <= 1e-6:
        raise ValueError("The route has no travel distance.")
    remaining = min(1.0, max(0.0, fraction)) * total
    for index, length in enumerate(lengths):
        if remaining <= length or index == len(lengths) - 1:
            alpha = remaining / length if length > 1e-6 else 0.0
            start = points[index]
            end = points[index + 1]
            return [
                float(start[0] + (end[0] - start[0]) * alpha),
                float(start[1] + (end[1] - start[1]) * alpha),
            ]
        remaining -= length
    return [float(points[-1][0]), float(points[-1][1])]


def route_values_for_frames(
    points: list[tuple[float, float]],
    start_frame: int,
    frame_count: int,
    total_frames: int,
) -> list[list[float]]:
    denominator = max(1, total_frames - 1)
    return [
        route_point_at_fraction(points, (start_frame + frame) / denominator)
        for frame in range(frame_count)
    ]


class ZeroTextEncoder:
    def __call__(self, texts: list[str]) -> tuple[torch.Tensor, list[int]]:
        return torch.zeros((len(texts), 1, 4096), dtype=torch.float32), [0] * len(texts)


class LocalQuantizedTextEncoder:
    """Load the verified self-contained 4-bit encoder shared by both models."""

    def __init__(self, root: Path, engine: str, device: str = "cuda:0") -> None:
        if not (root / "READY.json").is_file():
            raise FileNotFoundError(
                f"Quantized ARDY encoder is not ready at {root}. Complete the one-time encoder build first."
            )
        from peft import PeftModel
        from transformers import AutoTokenizer

        if engine == "ardy":
            from ardy.model.llm2vec.llm2vec import LLM2Vec
            from ardy.model.llm2vec.models.bidirectional_llama import LlamaBiModel
        else:
            from kimodo.model.llm2vec.llm2vec import LLM2Vec
            from kimodo.model.llm2vec.models.bidirectional_llama import LlamaBiModel

        self.device = device
        tokenizer = AutoTokenizer.from_pretrained(root / "tokenizer", local_files_only=True)
        tokenizer.pad_token = tokenizer.eos_token
        tokenizer.padding_side = "left"
        base = LlamaBiModel.from_pretrained(
            root / "base",
            local_files_only=True,
            device_map={"": device},
            torch_dtype=torch.bfloat16,
        )
        # The MNTP adapter is merged into the quantized base during the one-time build.
        # The supervised adapter remains active on top, matching LLM2Vec's reference load order.
        model = PeftModel.from_pretrained(base, root / "adapters" / "supervised")
        model.config._name_or_path = "meta-llama/Meta-Llama-3-8B-Instruct"
        llm2vec_config = json.loads((root / "llm2vec_config.json").read_text(encoding="utf-8"))
        self.model = LLM2Vec(model=model, tokenizer=tokenizer, **llm2vec_config)
        self.model.model.eval()

    def __call__(self, texts: list[str]) -> tuple[torch.Tensor, list[int]]:
        with torch.inference_mode():
            encoded = self.model.encode(texts, batch_size=1, show_progress_bar=False, device=self.device)
        tensor = torch.as_tensor(encoded, device=self.device)[:, None]
        if tensor.shape[-1] != 4096:
            raise RuntimeError(f"Unexpected ARDY text width: {tensor.shape}")
        return tensor, [1] * len(texts)


class CachedTextEncoder:
    """Disk-backed prompt embeddings with a lazy 4-bit encoder fallback."""

    def __init__(self, engine: str, device: str) -> None:
        self.engine = engine
        self.device = device
        self.backend = None
        self.tensor_cache: dict[str, torch.Tensor] = {}
        TEXT_CACHE_ROOT.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def canonical(text: str) -> str:
        return " ".join(text.strip().rstrip(".!?").split()).casefold()

    @staticmethod
    def key(text: str) -> str:
        return hashlib.sha256(CachedTextEncoder.canonical(text).encode("utf-8")).hexdigest()[:24]

    def _paths(self, text: str) -> tuple[Path, Path]:
        key = self.key(text)
        return TEXT_CACHE_ROOT / f"{key}.npy", TEXT_CACHE_ROOT / f"{key}.json"

    def _load_one(self, text: str) -> np.ndarray | None:
        data_path, metadata_path = self._paths(text)
        if not (data_path.is_file() and metadata_path.is_file()):
            return None
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if self.canonical(metadata.get("text", "")) != self.canonical(text) or metadata.get("width") != 4096:
            return None
        value = np.load(data_path, allow_pickle=False)
        return np.asarray(value, dtype=np.float32).reshape(1, 4096)

    def load_key(self, key: str) -> tuple[torch.Tensor, list[int], dict[str, Any]]:
        """Load one exact permanent cache entry without initializing the encoder."""
        clean_key = key.strip().lower()
        if len(clean_key) != 24 or any(character not in "0123456789abcdef" for character in clean_key):
            raise ValueError("Choose a valid cached text embedding.")
        data_path = TEXT_CACHE_ROOT / f"{clean_key}.npy"
        metadata_path = TEXT_CACHE_ROOT / f"{clean_key}.json"
        if not (data_path.is_file() and metadata_path.is_file()):
            raise ValueError("That cached text embedding is no longer available.")
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        if metadata.get("key") != clean_key or metadata.get("width") != 4096:
            raise ValueError("That cached text embedding is invalid.")
        tensor = self.tensor_cache.get(clean_key)
        if tensor is None:
            value = np.load(data_path, allow_pickle=False)
            tensor = torch.from_numpy(np.asarray(value, dtype=np.float32).reshape(1, 1, 4096)).to(self.device)
            self.tensor_cache[clean_key] = tensor
        return tensor, [1], metadata

    @staticmethod
    def clean_key(key: str) -> str:
        clean_key = str(key).strip().lower()
        if len(clean_key) != 24 or any(character not in "0123456789abcdef" for character in clean_key):
            raise ValueError("Choose a valid cached text embedding.")
        return clean_key

    def _save_one(self, text: str, value: np.ndarray, nickname: str = "") -> None:
        clean = text.strip()
        data_path, metadata_path = self._paths(clean)
        np.save(data_path, np.asarray(value, dtype=np.float32).reshape(1, 4096), allow_pickle=False)
        metadata_path.write_text(
            json.dumps(
                {
                    "key": self.key(clean),
                    "text": clean,
                    "nickname": nickname.strip()[:80],
                    "width": 4096,
                    "dtype": "float32",
                    "createdAt": time.time(),
                    "encoder": "LLM2Vec-Meta-Llama-3-8B-Instruct-mntp-supervised",
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

    def _ensure_backend(self) -> LocalQuantizedTextEncoder:
        if self.backend is None:
            self.backend = LocalQuantizedTextEncoder(QUANTIZED_ENCODER_ROOT, self.engine, self.device)
        return self.backend

    def release_backend(self) -> None:
        if self.backend is not None:
            self.backend = None
            gc.collect()
            torch.cuda.empty_cache()

    def __call__(self, texts: list[str]) -> tuple[torch.Tensor, list[int]]:
        values: list[np.ndarray] = []
        for text in texts:
            clean = text.strip()
            cached = self._load_one(clean)
            if cached is None:
                encoded, _ = self._ensure_backend()([clean])
                cached = encoded.detach().float().cpu().numpy().reshape(1, 4096)
                self._save_one(clean, cached)
            values.append(cached)
        stacked = np.stack(values, axis=0)
        return torch.from_numpy(stacked).to(self.device), [1] * len(values)

    def cache(self, text: str, nickname: str = "") -> tuple[bool, dict[str, Any]]:
        """Create one permanent entry, or return the existing entry without recomputing it."""
        clean = text.strip()
        if not clean:
            raise ValueError("Enter a phrase to cache.")
        key = self.key(clean)
        existing = self._load_one(clean)
        created = existing is None
        if created:
            encoded, _ = self._ensure_backend()([clean])
            self._save_one(clean, encoded.detach().float().cpu().numpy().reshape(1, 4096), nickname)
        metadata_path = TEXT_CACHE_ROOT / f"{key}.json"
        entry = json.loads(metadata_path.read_text(encoding="utf-8"))
        if not created and nickname.strip() and entry.get("nickname") != nickname.strip()[:80]:
            entry["nickname"] = nickname.strip()[:80]
            metadata_path.write_text(json.dumps(entry, indent=2) + "\n", encoding="utf-8")
        return created, entry

    def set_nickname(self, key: str, nickname: str) -> dict[str, Any]:
        clean_key = self.clean_key(key)
        metadata_path = TEXT_CACHE_ROOT / f"{clean_key}.json"
        data_path = TEXT_CACHE_ROOT / f"{clean_key}.npy"
        if not (metadata_path.is_file() and data_path.is_file()):
            raise ValueError("That cached text embedding is no longer available.")
        entry = json.loads(metadata_path.read_text(encoding="utf-8"))
        if entry.get("key") != clean_key or entry.get("width") != 4096:
            raise ValueError("That cached text embedding is invalid.")
        entry["nickname"] = str(nickname).strip()[:80]
        metadata_path.write_text(json.dumps(entry, indent=2) + "\n", encoding="utf-8")
        return entry

    def delete(self, key: str) -> dict[str, Any]:
        clean_key = self.clean_key(key)
        metadata_path = TEXT_CACHE_ROOT / f"{clean_key}.json"
        data_path = TEXT_CACHE_ROOT / f"{clean_key}.npy"
        if not (metadata_path.is_file() and data_path.is_file()):
            raise ValueError("That cached text embedding is no longer available.")
        entry = json.loads(metadata_path.read_text(encoding="utf-8"))
        if entry.get("key") != clean_key:
            raise ValueError("That cached text embedding is invalid.")
        data_path.unlink()
        metadata_path.unlink()
        self.tensor_cache.pop(clean_key, None)
        return entry

    def entries(self) -> list[dict[str, Any]]:
        entries = []
        for metadata_path in TEXT_CACHE_ROOT.glob("*.json"):
            try:
                item = json.loads(metadata_path.read_text(encoding="utf-8"))
                if (TEXT_CACHE_ROOT / f"{item['key']}.npy").is_file():
                    entries.append(item)
            except (KeyError, OSError, ValueError):
                continue
        return sorted(entries, key=lambda item: (item.get("nickname") or item.get("text", "")).casefold())


class MotionRuntime:
    def __init__(self, engine: str) -> None:
        self.engine = engine
        self.device = "cuda:0" if torch.cuda.is_available() else "cpu"
        self.model = None
        self.raw_denoiser = None
        self.text_encoder = None
        self.skin = None
        self.live_motion = None
        self.live_arrays: dict[str, np.ndarray] | None = None
        self.live_step_index = 0
        self.loaded_at = 0.0
        self.lock = threading.Lock()

    def load(self) -> None:
        if self.model is not None:
            return
        if self.device == "cpu":
            raise RuntimeError("CUDA is required for the local motion UI.")
        if self.engine == "ardy":
            from ardy.model import load_model

            self.model = load_model(os.environ.get("ARDY_MODEL", "core8"), device=self.device, text_encoder=False)
            self.raw_denoiser = self.model.denoiser.model
        else:
            from kimodo import load_model

            self.model = load_model("kimodo-soma-rp-v1.1", device=self.device, text_encoder=ZeroTextEncoder())
        self.loaded_at = time.time()

    def load_text_encoder(self) -> None:
        if self.text_encoder is None:
            self.text_encoder = CachedTextEncoder(self.engine, self.device)
            self.model.text_encoder = self.text_encoder

    def state(self) -> dict[str, Any]:
        return {
            "pid": os.getpid(),
            "ownerPid": int(os.environ.get("UNIFIED_PARENT_PID") or os.environ.get("UNIFIED_LAUNCHER_PID") or 0),
            "engine": self.engine,
            "ready": self.model is not None,
            "device": self.device,
            "textReady": self.text_encoder is not None,
            "textEncoderLoaded": bool(self.text_encoder and self.text_encoder.backend is not None),
            "textArtifactReady": (QUANTIZED_ENCODER_ROOT / "READY.json").is_file(),
            "cachedTextCount": len(CachedTextEncoder(self.engine, self.device).entries()),
            "loadedAt": self.loaded_at,
            "model": (
                f"core{self.model.gen_horizon_len}" if self.engine == "ardy" and self.model is not None else None
            ),
        }

    def _resolve_text_input(
        self, body: dict[str, Any]
    ) -> tuple[str, torch.Tensor | None, list[int] | None, dict[str, Any] | None]:
        """Resolve free text or an exact cache key. Cached mode never invokes the encoder backend."""
        mode = str(body.get("textMode", "text")).strip().lower()
        prompt = str(body.get("prompt", "")).strip()
        if mode == "cache":
            cache_key = str(body.get("cacheKey", "")).strip()
            self.load_text_encoder()
            text_feat, text_lengths, metadata = self.text_encoder.load_key(cache_key)
            return str(metadata.get("text", "cached embedding")), text_feat, text_lengths, metadata
        if not prompt:
            raise ValueError("Enter a prompt or turn text guidance off.")
        return prompt, None, None, None

    def generate(self, body: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            self.load()
            duration = float(body.get("duration", 3.2 if self.engine == "ardy" else 3.0))
            fps = float(self.model.motion_rep.fps if self.engine == "ardy" else self.model.fps)
            num_frames = max(8, round(duration * fps))
            if self.engine == "ardy":
                patch = self.model.num_frames_per_token
                num_frames = max(patch, math.ceil(num_frames / patch) * patch)
            points = compact_points(list(body.get("points") or []))
            frames, values = timed_waypoints(points, num_frames)
            heading_enabled = bool(body.get("headingEnabled", True))
            text_enabled = bool(body.get("textEnabled", False))
            prompt = str(body.get("prompt", "")).strip()
            text_feat = None
            text_lengths = None
            text_metadata = None
            if text_enabled:
                prompt, text_feat, text_lengths, text_metadata = self._resolve_text_input(body)
            headings = headings_from_waypoints(values)
            if self.engine == "ardy":
                constraint = {"type": "root2d", "frame_indices": frames, "root_2d": values}
                if heading_enabled:
                    constraint["global_root_heading"] = headings
            else:
                constraint = {"type": "root2d", "frame_indices": frames, "smooth_root_2d": values}
                if heading_enabled:
                    constraint["global_root_heading"] = [[math.cos(angle), math.sin(angle)] for angle in headings]

            seed = int(body.get("seed", 42))
            steps = int(body.get("steps", 4 if self.engine == "ardy" else 20))
            constraint_guidance = float(body.get("constraintGuidance", 2.0))
            text_guidance = float(body.get("textGuidance", 2.0))
            torch.manual_seed(seed)
            torch.cuda.manual_seed_all(seed)
            torch.cuda.reset_peak_memory_stats()
            started = time.perf_counter()
            output = self._generate_motion(
                constraint,
                num_frames,
                steps,
                constraint_guidance,
                text_enabled,
                prompt,
                text_guidance,
                text_feat,
                text_lengths,
            )
            torch.cuda.synchronize()
            elapsed = time.perf_counter() - started
            result = self._save_and_describe(output, constraint, num_frames, fps, elapsed, text_enabled, prompt, seed, steps)
            if text_metadata:
                result["textInput"] = {"mode": "cache", "key": text_metadata["key"], "text": text_metadata["text"]}
            return result

    def generate_scheduled(self, body: dict[str, Any]) -> dict[str, Any]:
        """Generate one continuous, route-constrained autoregressive prompt timeline."""
        if self.engine != "ardy":
            raise ValueError("Model-generated timed transitions are currently available for ARDY only.")
        with self.lock:
            self.load()
            from ardy.constraints import load_constraints_lst

            fps = float(self.model.motion_rep.fps)
            patch = int(self.model.num_frames_per_token)
            horizon = int(self.model.gen_horizon_len)
            duration = float(body.get("duration", 3.2))
            num_frames = max(horizon, math.ceil(duration * fps / horizon) * horizon)
            points = compact_points(list(body.get("points") or []))
            route_point_at_fraction(points, 0.0)
            cues = sorted([dict(item) for item in list(body.get("cues") or [])], key=lambda item: float(item.get("time", 0)))
            for cue in cues:
                cue["time"] = float(cue.get("time", 0))
                cue["mode"] = str(cue.get("mode", "text")).strip().lower()
                cue["prompt"] = str(cue.get("prompt", "")).strip()
                cue["cacheKey"] = str(cue.get("cacheKey", "")).strip()
            if not cues or cues[0]["time"] > 1e-6:
                raise ValueError("Timed text needs a prompt at 0.0 seconds.")
            if any(cue["mode"] == "cache" and not cue["cacheKey"] for cue in cues):
                raise ValueError("Every cached timed slot needs a cached embedding.")
            if any(cue["mode"] != "cache" and not cue["prompt"] for cue in cues):
                raise ValueError("Every free-text timed slot needs a prompt.")
            if any(cue["time"] < 0 or cue["time"] >= duration for cue in cues):
                raise ValueError("A timed text cue is outside the batch duration.")

            boundaries = [0]
            for cue in cues[1:]:
                aligned = int(round(cue["time"] * fps / horizon) * horizon)
                if aligned <= boundaries[-1] or aligned >= num_frames:
                    raise ValueError("Timed text cues are too close after alignment; leave at least 0.4 seconds between them.")
                boundaries.append(aligned)
            boundaries.append(num_frames)

            seed = int(body.get("seed", 42))
            steps = int(body.get("steps", 4))
            constraint_guidance = float(body.get("constraintGuidance", 2.0))
            text_guidance = float(body.get("textGuidance", 2.0))
            heading_enabled = bool(body.get("headingEnabled", True))
            torch.manual_seed(seed)
            torch.cuda.manual_seed_all(seed)
            torch.cuda.reset_peak_memory_stats()
            started = time.perf_counter()

            from ardy.model.cfg import AutoLatentClassifierFreeGuidedModel
            from ardy.postprocess import post_process_motion

            if not 1 <= steps <= int(self.model.diffusion.num_base_steps):
                raise ValueError(f"ARDY steps must be 1–{self.model.diffusion.num_base_steps}.")
            self.load_text_encoder()
            self.model.denoiser = AutoLatentClassifierFreeGuidedModel(self.raw_denoiser, cfg_type="separated")

            # Resolve each UI slot independently before rollout. No schedule string is ever
            # passed to the encoder, and cached slots load their exact saved tensor by key.
            resolved_cues: list[dict[str, Any]] = []
            for index, cue in enumerate(cues):
                if cue["mode"] == "cache":
                    text_feat, text_lengths, metadata = self.text_encoder.load_key(cue["cacheKey"])
                    label = str(metadata.get("text", "cached embedding"))
                    source = {"mode": "cache", "key": metadata["key"], "text": label}
                else:
                    text_feat, text_lengths = self.text_encoder([cue["prompt"]])
                    label = cue["prompt"]
                    source = {"mode": "text", "text": label}
                resolved_cues.append({
                    "slot": index,
                    "requestedTime": cue["time"],
                    "appliedFrame": boundaries[index],
                    "appliedTime": boundaries[index] / fps,
                    "label": label,
                    "source": source,
                    "horizonStarts": [],
                    "textFeat": text_feat,
                    "textLengths": text_lengths,
                })
            self.text_encoder.release_backend()

            max_window = int(10 * fps)
            # NVIDIA exposes history crop length as the prompt response/smoothness
            # control: less history reacts faster, while more history transitions
            # more gradually. Keep it token aligned and inside the trained window.
            prompt_history_seconds = float(body.get("promptHistorySeconds", 1.6))
            requested_history = max(patch, int(round(prompt_history_seconds * fps / patch) * patch))
            history_crop = min(requested_history, max_window - horizon)
            motion_tensor: torch.Tensor | None = None

            for generated_frames in range(0, num_frames, horizon):
                history_length = 0 if motion_tensor is None else min(int(motion_tensor.shape[1]), history_crop)
                history_length -= history_length % patch
                history = None if motion_tensor is None else motion_tensor[:, -history_length:]

                remaining_after_horizon = num_frames - generated_frames - horizon
                future_length = min(remaining_after_horizon, max_window - history_length - horizon)
                future_length -= future_length % patch
                window_frames = history_length + horizon + future_length

                future_values = route_values_for_frames(
                    points,
                    generated_frames,
                    horizon + future_length,
                    num_frames,
                )
                constraint: dict[str, Any] = {
                    "type": "root2d",
                    "frame_indices": list(range(history_length, window_frames)),
                    "root_2d": future_values,
                }
                if heading_enabled:
                    constraint["global_root_heading"] = headings_from_waypoints(future_values)
                constraints = load_constraints_lst([constraint], self.model.skeleton)
                lengths = torch.tensor([window_frames], device=self.device)
                observed, mask = self.model.motion_rep.create_conditions_from_constraints_batched(
                    constraints, lengths, to_normalize=True, device=self.device
                )
                if history_length:
                    mask[:, :history_length] = 0
                    observed[:, :history_length] = 0

                cue_index = max(
                    index for index, boundary in enumerate(boundaries[:-1]) if boundary <= generated_frames
                )
                active_cue = resolved_cues[cue_index]
                active_cue["horizonStarts"].append(generated_frames)
                text_feat = active_cue["textFeat"]
                text_lengths = active_cue["textLengths"]
                text_mask = torch.arange(text_feat.shape[1], device=self.device)[None] < torch.tensor(
                    text_lengths, device=self.device
                )[:, None]

                if history is None:
                    start = future_values[0]
                    heading = headings_from_waypoints(future_values)[0]
                    init_global_translation = torch.tensor(
                        [[start[0], 0.0, start[1]]], dtype=torch.float32, device=self.device
                    )
                    init_first_heading_angle = torch.tensor([heading], dtype=torch.float32, device=self.device)
                else:
                    init_global_translation = None
                    init_first_heading_angle = None

                with torch.inference_mode():
                    samples = self.model.autoregressive_step(
                        num_frames=window_frames,
                        num_denoising_steps=steps,
                        motion_mask=mask,
                        observed_motion=observed,
                        cfg_weight=(text_guidance, constraint_guidance),
                        texts=None,
                        text_feat=text_feat,
                        text_pad_mask=text_mask,
                        init_history_sequence=history,
                        init_global_translation=init_global_translation,
                        init_first_heading_angle=init_first_heading_angle,
                    )
                    new_motion = samples[:, history_length : history_length + horizon]
                    decoded_horizon = self.model.motion_rep.inverse(new_motion, is_normalized=True)
                    horizon_constraint: dict[str, Any] = {
                        "type": "root2d",
                        "frame_indices": list(range(horizon)),
                        "root_2d": future_values[:horizon],
                    }
                    if heading_enabled:
                        horizon_constraint["global_root_heading"] = headings_from_waypoints(
                            future_values[:horizon]
                        )
                    horizon_constraints = load_constraints_lst([horizon_constraint], self.model.skeleton)
                    corrected = post_process_motion(
                        decoded_horizon["local_rot_mats"],
                        decoded_horizon["root_positions"],
                        decoded_horizon["foot_contacts"],
                        self.model.skeleton,
                        constraint_lst=horizon_constraints,
                    )
                    new_motion = self.model.motion_rep(
                        local_joint_rots=corrected["local_rot_mats"],
                        root_positions=corrected["root_positions"],
                        to_normalize=True,
                    )
                    motion_tensor = (
                        new_motion.clone()
                        if motion_tensor is None
                        else torch.cat([motion_tensor, new_motion], dim=1)
                    )

            self.text_encoder.release_backend()
            if motion_tensor is None or motion_tensor.shape[1] != num_frames:
                actual = 0 if motion_tensor is None else int(motion_tensor.shape[1])
                raise RuntimeError(f"Scheduled rollout produced {actual} frames; expected {num_frames}.")
            with torch.inference_mode():
                output = self.model.motion_rep.inverse(motion_tensor, is_normalized=True, return_numpy=True)
            torch.cuda.synchronize()
            elapsed = time.perf_counter() - started

            full_values = route_values_for_frames(points, 0, num_frames, num_frames)
            final_constraint: dict[str, Any] = {
                "type": "root2d",
                "frame_indices": list(range(num_frames)),
                "root_2d": full_values,
            }
            if heading_enabled:
                final_constraint["global_root_heading"] = headings_from_waypoints(full_values)
            public_cues = [
                {key: value for key, value in cue.items() if key not in {"textFeat", "textLengths"}}
                for cue in resolved_cues
            ]
            prompt_metadata = json.dumps(public_cues, ensure_ascii=False)
            result = self._save_and_describe(
                output,
                final_constraint,
                num_frames,
                fps,
                elapsed,
                True,
                prompt_metadata,
                seed,
                steps,
            )
            result["cueCount"] = len(cues)
            result["transitionCount"] = max(0, len(cues) - 1)
            result["transitionMode"] = "official-autoregressive-replan"
            result["resolvedCues"] = public_cues
            return result

    def start_live(self, body: dict[str, Any]) -> dict[str, Any]:
        if self.engine != "ardy":
            raise ValueError("Live streaming is available for ARDY only.")
        with self.lock:
            self.load()
            self.live_motion = None
            self.live_arrays = None
            self.live_step_index = 0
            seed = int(body.get("seed", 42))
            torch.manual_seed(seed)
            torch.cuda.manual_seed_all(seed)
            return self._live_step(body)

    def live_step(self, body: dict[str, Any]) -> dict[str, Any]:
        if self.engine != "ardy":
            raise ValueError("Live streaming is available for ARDY only.")
        with self.lock:
            self.load()
            return self._live_step(body)

    def _live_step(self, body: dict[str, Any]) -> dict[str, Any]:
        from ardy.constraints import load_constraints_lst
        from ardy.model.cfg import AutoLatentClassifierFreeGuidedModel

        fps = float(self.model.motion_rep.fps)
        horizon = int(self.model.gen_horizon_len)
        patch = int(self.model.num_frames_per_token)
        max_window = int(10 * fps) // patch * patch
        playback_frame = max(0, int(body.get("playbackFrame", 0)))
        replan_buffer = max(0, int(body.get("replanBufferFrames", 3)))
        requested_history = max(patch, int(body.get("historyFrames", patch)))
        requested_history = requested_history // patch * patch

        # Match NVIDIA's interactive demo: choose history relative to the frame
        # being played, keep a small safety buffer, and replace generated-but-
        # unplayed motion after that point. Do not blindly continue from the end
        # of the last generated horizon.
        current_length = 0 if self.live_motion is None else int(self.live_motion.shape[1])
        history_end = min(current_length - 1, playback_frame + replan_buffer)
        if current_length >= patch:
            history_end = max(history_end, patch - 1)
        history_length = min(history_end + 1, requested_history)
        history_length = history_length // patch * patch
        history_start = max(0, history_end - history_length + 1)
        history = None
        if self.live_motion is not None and history_length > 0:
            history = self.live_motion[:, history_start : history_end + 1]

        velocity = np.asarray([float(body.get("velocityX", 0)), float(body.get("velocityZ", 0))], dtype=np.float32)
        text_enabled = bool(body.get("textEnabled", False))
        prompt = str(body.get("prompt", "")).strip()
        resolved_text_feat = None
        resolved_text_lengths = None
        if text_enabled:
            prompt, resolved_text_feat, resolved_text_lengths, _ = self._resolve_text_input(body)

        if self.live_arrays is None or current_length == 0:
            current_root = np.zeros(2, dtype=np.float32)
            current_velocity = np.zeros(2, dtype=np.float32)
            playback_frame = 0
        else:
            playback_frame = min(playback_frame, current_length - 1)
            posed = self.live_arrays["posed_joints"]
            current_root = posed[playback_frame, 0, [0, 2]].astype(np.float32)
            if playback_frame > 0:
                previous_root = posed[playback_frame - 1, 0, [0, 2]].astype(np.float32)
                current_velocity = (current_root - previous_root) * fps
            else:
                current_velocity = np.zeros(2, dtype=np.float32)

        # NVIDIA's target-velocity controller looks two seconds ahead and places
        # sparse goals every ten frames. The blend controls acceleration only;
        # it does not densely pin the generated 0.4 s horizon.
        lookahead_frames = max(horizon, int(round(2.0 * fps)))
        smoothing_seconds = max(0.05, min(float(body.get("liveSmoothingSeconds", 1.0)), 2.0))
        smoothing_frames = max(1, min(lookahead_frames, round(smoothing_seconds * fps)))
        future = []
        position = current_root.copy()
        for index in range(lookahead_frames):
            alpha = min(1.0, (index + 1) / smoothing_frames)
            frame_velocity = (1.0 - alpha) * current_velocity + alpha * velocity
            position = position + frame_velocity / fps
            future.append(position.copy())

        constraint_offsets = list(range(10, lookahead_frames + 1, 10))
        absolute_constraint_frames = [playback_frame + offset for offset in constraint_offsets]
        frame_indices = [frame - history_start for frame in absolute_constraint_frames]
        root_values = [future[offset - 1].tolist() for offset in constraint_offsets]
        constraint: dict[str, Any] = {"type": "root2d", "frame_indices": frame_indices, "root_2d": root_values}
        if bool(body.get("headingEnabled", True)) and np.linalg.norm(velocity) > 0.05:
            heading = math.atan2(float(velocity[0]), float(velocity[1]))
            constraint["global_root_heading"] = [heading] * len(frame_indices)

        furthest_constraint = max(frame_indices, default=history_length + horizon - 1)
        total_frames = max(history_length + horizon, furthest_constraint + 1)
        total_frames = math.ceil(total_frames / patch) * patch
        total_frames = min(max_window, total_frames)
        constraints = load_constraints_lst([constraint], self.model.skeleton)
        lengths = torch.tensor([total_frames], device=self.device)
        observed, mask = self.model.motion_rep.create_conditions_from_constraints_batched(
            constraints, lengths, to_normalize=True, device=self.device
        )
        if text_enabled:
            self.model.denoiser = AutoLatentClassifierFreeGuidedModel(self.raw_denoiser, cfg_type="separated")
            if resolved_text_feat is not None and resolved_text_lengths is not None:
                text_feat, text_lengths = resolved_text_feat, resolved_text_lengths
            else:
                self.load_text_encoder()
                text_feat, text_lengths = self.text_encoder([prompt])
                self.text_encoder.release_backend()
            text_mask = torch.arange(text_feat.shape[1], device=self.device)[None] < torch.tensor(
                text_lengths, device=self.device
            )[:, None]
            cfg_weight: float | tuple[float, float] = (
                float(body.get("textGuidance", 2.0)),
                float(body.get("constraintGuidance", 2.0)),
            )
        else:
            self.model.denoiser = AutoLatentClassifierFreeGuidedModel(self.raw_denoiser, cfg_type="regular")
            text_feat = torch.zeros((1, 1, 4096), device=self.device)
            text_mask = torch.zeros((1, 1), dtype=torch.bool, device=self.device)
            cfg_weight = float(body.get("constraintGuidance", 2.0))
        started = time.perf_counter()
        with torch.inference_mode():
            samples = self.model.autoregressive_step(
                num_frames=total_frames,
                num_denoising_steps=int(body.get("steps", 4)),
                motion_mask=mask,
                observed_motion=observed,
                cfg_weight=cfg_weight,
                texts=None,
                text_feat=text_feat,
                text_pad_mask=text_mask,
                init_history_sequence=history,
                init_global_translation=(torch.zeros((1, 3), device=self.device) if history is None else None),
                init_first_heading_angle=(torch.zeros(1, device=self.device) if history is None else None),
            )
            new_motion = samples[:, history_length : history_length + horizon]
            decoded = self.model.motion_rep.inverse(new_motion, is_normalized=True, return_numpy=True)
        torch.cuda.synchronize()
        elapsed = time.perf_counter() - started
        replace_from = history_end + 1
        seam_root_step = 0.0
        seam_joint_step_max = 0.0
        seam_velocity_change = 0.0
        seam_joint_velocity_change_max = 0.0
        replaced_pose_change = 0.0
        horizon_joint_step_max = 0.0
        horizon_joint_velocity_change_max = 0.0
        if self.live_arrays is not None and history_end >= 0:
            retained_root = self.live_arrays["posed_joints"][history_end, 0, [0, 2]]
            new_root = new_arrays_root = np.asarray(decoded["posed_joints"])[0, 0, 0, [0, 2]]
            seam_root_step = float(np.linalg.norm(new_root - retained_root))
            retained_pose = self.live_arrays["posed_joints"][history_end]
            new_pose = np.asarray(decoded["posed_joints"])[0, 0]
            seam_joint_step_max = float(np.linalg.norm(new_pose - retained_pose, axis=-1).max())
            if history_end > 0:
                old_velocity = (
                    self.live_arrays["posed_joints"][history_end, 0, [0, 2]]
                    - self.live_arrays["posed_joints"][history_end - 1, 0, [0, 2]]
                ) * fps
                new_velocity = (new_arrays_root - retained_root) * fps
                seam_velocity_change = float(np.linalg.norm(new_velocity - old_velocity))
                old_joint_velocity = (
                    self.live_arrays["posed_joints"][history_end]
                    - self.live_arrays["posed_joints"][history_end - 1]
                ) * fps
                new_joint_velocity = (new_pose - retained_pose) * fps
                seam_joint_velocity_change_max = float(
                    np.linalg.norm(new_joint_velocity - old_joint_velocity, axis=-1).max()
                )
            if replace_from < len(self.live_arrays["posed_joints"]):
                replaced_pose = self.live_arrays["posed_joints"][replace_from]
                replaced_pose_change = float(np.linalg.norm(new_pose - replaced_pose, axis=-1).max())
            combined_pose = np.concatenate(
                [self.live_arrays["posed_joints"][history_end : history_end + 1], np.asarray(decoded["posed_joints"])[0]],
                axis=0,
            )
            joint_steps = np.diff(combined_pose, axis=0)
            horizon_joint_step_max = float(np.linalg.norm(joint_steps, axis=-1).max())
            if len(joint_steps) > 1:
                joint_velocity_changes = np.diff(joint_steps * fps, axis=0)
                horizon_joint_velocity_change_max = float(
                    np.linalg.norm(joint_velocity_changes, axis=-1).max()
                )
        if self.live_motion is None:
            self.live_motion = new_motion.detach()
        else:
            self.live_motion = torch.cat([self.live_motion[:, :replace_from], new_motion.detach()], dim=1)
        new_arrays = {key: np.asarray(value)[0] for key, value in decoded.items()}
        if self.live_arrays is None:
            self.live_arrays = {key: np.array(value, copy=True) for key, value in new_arrays.items()}
        else:
            self.live_arrays = {
                key: np.concatenate([self.live_arrays[key][:replace_from], np.asarray(value)], axis=0)
                for key, value in new_arrays.items()
            }
        stamp = f"ardy-live-{time.strftime('%Y%m%d-%H%M%S')}-{self.live_step_index:06d}.meshframes"
        mesh_path = OUTPUT_ROOT / stamp
        OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
        vertex_count = self._save_skinned_mesh_frames(new_arrays, mesh_path)[1]
        live_joints = np.asarray(new_arrays["posed_joints"], dtype=np.float32)
        live_centered = live_joints - live_joints[:, [0]]
        live_local_rotations = np.asarray(new_arrays["local_rot_mats"], dtype=np.float32)
        self.live_step_index += 1
        return {
            "engine": "ardy",
            "frames": horizon,
            "fps": fps,
            "generationSeconds": elapsed,
            "realtimeFactor": (horizon / fps) / elapsed,
            "meshFrameFile": mesh_path.name,
            "meshVertexCount": vertex_count,
            "stepIndex": self.live_step_index - 1,
            "replaceFromFrame": replace_from,
            "playbackFrame": playback_frame,
            "historyStartFrame": history_start,
            "historyEndFrame": history_end,
            "historyFrames": history_length,
            "replanBufferFrames": replan_buffer,
            "windowFrames": total_frames,
            "constraintFrames": absolute_constraint_frames,
            "seamRootStepM": seam_root_step,
            "seamJointStepMaxM": seam_joint_step_max,
            "seamVelocityChangeMps": seam_velocity_change,
            "seamJointVelocityChangeMaxMps": seam_joint_velocity_change_max,
            "replacedPoseChangeMaxM": replaced_pose_change,
            "horizonJointStepMaxM": horizon_joint_step_max,
            "horizonJointVelocityChangeMaxMps": horizon_joint_velocity_change_max,
            "rootPosition": new_arrays["posed_joints"][-1, 0].round(5).tolist(),
            "rootPositions": live_joints[:, 0].round(5).tolist(),
            "centeredJoints": live_centered.round(5).tolist(),
            "localRotations": live_local_rotations.round(6).tolist(),
            "velocity": velocity.tolist(),
            "textEnabled": text_enabled,
        }

    def export_live(self) -> dict[str, Any]:
        if self.engine != "ardy":
            raise ValueError("Live export is available for ARDY only.")
        with self.lock:
            if self.live_arrays is None:
                raise ValueError("Start Live ARDY before exporting a sequence.")
            arrays = {key: np.asarray(value) for key, value in self.live_arrays.items()}
            skeleton = self.model.skeleton
            names = list(skeleton.bone_order_names)
            parents = np.asarray(skeleton.joint_parents.cpu())
            stamp = time.strftime("%Y%m%d-%H%M%S")
            OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
            path = OUTPUT_ROOT / f"ardy-live-sequence-{stamp}.npz"
            np.savez(
                path,
                **arrays,
                fps=np.asarray(self.model.motion_rep.fps),
                joint_names=np.asarray(names),
                joint_parents=parents,
                source=np.asarray("ARDY live web UI"),
            )
            frames = int(arrays["posed_joints"].shape[0])
            mesh_path = OUTPUT_ROOT / f"ardy-live-sequence-{stamp}.meshframes"
            mesh_path, vertex_count = self._save_skinned_mesh_frames(arrays, mesh_path)
            posed_joints = np.asarray(arrays["posed_joints"], dtype=np.float32)
            centered_joints = posed_joints - posed_joints[:, [0]]
            local_rotations = np.asarray(arrays["local_rot_mats"], dtype=np.float32)
            return {
                "path": str(path.resolve()),
                "file": path.name,
                "frames": frames,
                "fps": float(self.model.motion_rep.fps),
                "duration": frames / float(self.model.motion_rep.fps),
                "meshFrameFile": mesh_path.name,
                "meshVertexCount": vertex_count,
                "rootPositions": posed_joints[:, 0].round(5).tolist(),
                "centeredJoints": centered_joints.round(5).tolist(),
                "localRotations": local_rotations.round(6).tolist(),
            }

    def _generate_motion(
        self,
        constraint: dict[str, Any],
        num_frames: int,
        steps: int,
        constraint_guidance: float,
        text_enabled: bool,
        prompt: str,
        text_guidance: float,
        text_feat_override: torch.Tensor | None = None,
        text_lengths_override: list[int] | None = None,
    ) -> dict[str, np.ndarray]:
        if self.engine == "kimodo":
            from kimodo.constraints import load_constraints_lst

            constraints = load_constraints_lst([constraint], self.model.skeleton, device=self.device)
            if text_enabled:
                self.load_text_encoder()
                kimodo_prompt = prompt
                kimodo_cfg_type = "separated"
                kimodo_cfg_weight: float | list[float] = [text_guidance, constraint_guidance]
            else:
                kimodo_prompt = ""
                kimodo_cfg_type = "regular"
                kimodo_cfg_weight = constraint_guidance
            with torch.inference_mode():
                result = self.model(
                    kimodo_prompt,
                    num_frames,
                    num_denoising_steps=steps,
                    constraint_lst=constraints,
                    cfg_type=kimodo_cfg_type,
                    cfg_weight=kimodo_cfg_weight,
                    num_samples=1,
                    post_processing=False,
                    return_numpy=True,
                    progress_bar=lambda values: values,
                )
            if text_enabled:
                self.text_encoder.release_backend()
            return result

        from ardy.constraints import load_constraints_lst
        constraints = load_constraints_lst([constraint], self.model.skeleton)
        lengths = torch.tensor([num_frames], device=self.device)
        observed, mask = self.model.motion_rep.create_conditions_from_constraints_batched(
            constraints, lengths, to_normalize=True, device=self.device
        )
        motion = self._generate_ardy_features(
            num_frames,
            steps,
            constraint_guidance,
            prompt if text_enabled else "",
            text_guidance,
            observed,
            mask,
            text_feat_override,
            text_lengths_override,
        )
        return self.model.motion_rep.inverse(motion, is_normalized=True, return_numpy=True)

    def _generate_ardy_features(
        self,
        num_frames: int,
        steps: int,
        constraint_guidance: float,
        prompt: str,
        text_guidance: float,
        observed: torch.Tensor,
        mask: torch.Tensor,
        text_feat_override: torch.Tensor | None = None,
        text_lengths_override: list[int] | None = None,
    ) -> torch.Tensor:
        from ardy.model.cfg import AutoLatentClassifierFreeGuidedModel
        from ardy.motion_rep.tools import length_to_mask

        if not 1 <= steps <= int(self.model.diffusion.num_base_steps):
            raise ValueError(f"ARDY steps must be 1–{self.model.diffusion.num_base_steps}.")
        lengths = torch.tensor([num_frames], device=self.device)
        if prompt:
            self.model.denoiser = AutoLatentClassifierFreeGuidedModel(self.raw_denoiser, cfg_type="separated")
            if text_feat_override is not None and text_lengths_override is not None:
                text_feat, text_lengths = text_feat_override, text_lengths_override
            else:
                self.load_text_encoder()
                text_feat, text_lengths = self.text_encoder([prompt])
                self.text_encoder.release_backend()
            text_mask = torch.arange(text_feat.shape[1], device=self.device)[None] < torch.tensor(
                text_lengths, device=self.device
            )[:, None]
            cfg_weight: float | tuple[float, float] = (text_guidance, constraint_guidance)
        else:
            self.model.denoiser = AutoLatentClassifierFreeGuidedModel(self.raw_denoiser, cfg_type="regular")
            text_feat = torch.zeros((1, 1, 4096), device=self.device)
            text_mask = torch.zeros((1, 1), dtype=torch.bool, device=self.device)
            cfg_weight = constraint_guidance
        history = int(10 * self.model.motion_rep.fps) - self.model.gen_horizon_len
        history -= history % self.model.num_frames_per_token
        with torch.inference_mode():
            return self.model(
                [prompt],
                num_frames,
                num_denoising_steps=steps,
                pad_mask=length_to_mask(lengths),
                first_heading_angle=torch.zeros(1, device=self.device),
                motion_mask=mask,
                observed_motion=observed,
                cfg_weight=cfg_weight,
                text_feat=text_feat,
                text_pad_mask=text_mask,
                crop_history_length=history,
                progress_bar=lambda values: values,
            )

    def _save_and_describe(
        self,
        output: dict[str, Any],
        constraint: dict[str, Any],
        num_frames: int,
        fps: float,
        elapsed: float,
        text_enabled: bool,
        prompt: str,
        seed: int,
        steps: int,
    ) -> dict[str, Any]:
        arrays: dict[str, np.ndarray] = {}
        for key, value in output.items():
            array = np.asarray(value)
            arrays[key] = array[0] if array.ndim and array.shape[0] == 1 else array
        skeleton = self.model.skeleton if self.engine == "ardy" else self.model.output_skeleton
        names = list(skeleton.bone_order_names)
        parents = np.asarray(skeleton.joint_parents.cpu())
        stamp = time.strftime("%Y%m%d-%H%M%S")
        OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
        path = OUTPUT_ROOT / f"{self.engine}-{stamp}-{time.time_ns() % 1_000_000:06d}.npz"
        np.savez(
            path,
            **arrays,
            fps=np.asarray(fps),
            joint_names=np.asarray(names),
            joint_parents=parents,
            source=np.asarray(f"{self.engine.upper()} web UI"),
            prompt=np.asarray(prompt),
        )
        joints = np.asarray(arrays["posed_joints"])
        root = np.asarray(arrays["root_positions"])
        centered = joints - joints[:, [0]]
        local_rotations = np.asarray(arrays["local_rot_mats"], dtype=np.float32)
        target_values = constraint.get("root_2d", constraint.get("smooth_root_2d"))
        errors = [
            float(np.linalg.norm(root[int(frame), [0, 2]] - np.asarray(target)))
            for frame, target in zip(constraint["frame_indices"], target_values)
        ]
        mesh_path, vertex_count = self._save_skinned_mesh_frames(arrays, path.with_suffix(".meshframes"))
        return {
            "engine": self.engine,
            "path": str(path.resolve()),
            "frames": num_frames,
            "fps": fps,
            "duration": num_frames / fps,
            "generationSeconds": elapsed,
            "realtimeFactor": (num_frames / fps) / elapsed,
            "peakVramGiB": torch.cuda.max_memory_allocated() / 1024**3,
            "constraintErrorMaxM": max(errors),
            "constraintErrorMeanM": sum(errors) / len(errors),
            "textEnabled": text_enabled,
            "seed": seed,
            "steps": steps,
            "jointNames": names,
            "jointParents": parents.tolist(),
            "centeredJoints": np.round(centered, 5).tolist(),
            "localRotations": np.round(local_rotations, 6).tolist(),
            "rootPositions": np.round(joints[:, 0], 5).tolist(),
            "meshFramesPath": str(mesh_path.resolve()),
            "meshFrameFile": mesh_path.name,
            "meshVertexCount": vertex_count,
        }

    def _save_skinned_mesh_frames(self, arrays: dict[str, np.ndarray], path: Path) -> tuple[Path, int]:
        rotations = torch.as_tensor(arrays["global_rot_mats"], device=self.device, dtype=torch.float32)
        joints = torch.as_tensor(arrays["posed_joints"], device=self.device, dtype=torch.float32)
        if self.skin is None:
            if self.engine == "ardy":
                from ardy.viz.core_skin import CoreSkin

                self.skin = CoreSkin(self.model.skeleton)
            else:
                from kimodo.viz.soma_skin import SOMASkin

                self.skin = SOMASkin(self.model.output_skeleton.to(self.device))
        chunks = []
        with torch.inference_mode():
            for start in range(0, joints.shape[0], 12):
                stop = min(start + 12, joints.shape[0])
                chunks.append(self.skin.skin(rotations[start:stop], joints[start:stop], rot_is_global=True).cpu())
        vertices = torch.cat(chunks).numpy().astype("<f4", copy=False)
        path.write_bytes(np.ascontiguousarray(vertices).tobytes())
        return path, int(vertices.shape[1])


def make_handler(runtime: MotionRuntime):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, status: int, body: dict[str, Any]) -> None:
            payload = json.dumps(body).encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("content-length", str(len(payload)))
            self.send_header("access-control-allow-origin", "http://127.0.0.1:8793")
            self.send_header("access-control-allow-headers", "content-type")
            self.end_headers()
            self.wfile.write(payload)

        def do_OPTIONS(self) -> None:
            self._send(204, {})

        def do_GET(self) -> None:
            if self.path == "/health":
                self._send(200, {"ok": True, **runtime.state()})
            elif self.path == "/text-cache":
                cache = runtime.text_encoder or CachedTextEncoder(runtime.engine, runtime.device)
                self._send(200, {"ok": True, "entries": cache.entries(), **runtime.state()})
            else:
                self._send(404, {"ok": False, "error": "Not found"})

        def do_POST(self) -> None:
            try:
                length = int(self.headers.get("content-length", "0"))
                body = json.loads(self.rfile.read(length) or b"{}")
                if self.path == "/load":
                    with runtime.lock:
                        runtime.load()
                    self._send(200, {"ok": True, **runtime.state()})
                elif self.path == "/shutdown":
                    self._send(200, {"ok": True, "stopping": True, **runtime.state()})
                    threading.Thread(target=self.server.shutdown, daemon=True).start()
                elif self.path == "/generate":
                    self._send(200, {"ok": True, "motion": runtime.generate(body), **runtime.state()})
                elif self.path == "/generate-scheduled":
                    self._send(200, {"ok": True, "motion": runtime.generate_scheduled(body), **runtime.state()})
                elif self.path == "/cache-text":
                    text = str(body.get("text", "")).strip()
                    if not text:
                        raise ValueError("Enter a phrase to cache.")
                    with runtime.lock:
                        runtime.load()
                        runtime.load_text_encoder()
                        created, entry = runtime.text_encoder.cache(text, str(body.get("nickname", "")))
                        runtime.text_encoder.release_backend()
                    self._send(200, {"ok": True, "created": created, "entry": entry, "entries": runtime.text_encoder.entries(), **runtime.state()})
                elif self.path == "/text-cache/nickname":
                    cache = runtime.text_encoder or CachedTextEncoder(runtime.engine, runtime.device)
                    with runtime.lock:
                        entry = cache.set_nickname(str(body.get("key", "")), str(body.get("nickname", "")))
                    self._send(200, {"ok": True, "entry": entry, "entries": cache.entries(), **runtime.state()})
                elif self.path == "/text-cache/delete":
                    cache = runtime.text_encoder or CachedTextEncoder(runtime.engine, runtime.device)
                    with runtime.lock:
                        entry = cache.delete(str(body.get("key", "")))
                    self._send(200, {"ok": True, "deleted": entry, "entries": cache.entries(), **runtime.state()})
                elif self.path == "/live/start":
                    self._send(200, {"ok": True, "motion": runtime.start_live(body), **runtime.state()})
                elif self.path == "/live/step":
                    self._send(200, {"ok": True, "motion": runtime.live_step(body), **runtime.state()})
                elif self.path == "/live/export":
                    self._send(200, {"ok": True, "export": runtime.export_live(), **runtime.state()})
                else:
                    self._send(404, {"ok": False, "error": "Not found"})
            except Exception as error:
                self._send(400, {"ok": False, "error": str(error), **runtime.state()})

        def log_message(self, fmt: str, *args: Any) -> None:
            print(f"[{runtime.engine}] {fmt % args}", flush=True)

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", choices=["ardy", "kimodo"], required=True)
    parser.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    runtime = MotionRuntime(args.engine)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(runtime))
    print(json.dumps({"ready": True, "engine": args.engine, "port": args.port}), flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
