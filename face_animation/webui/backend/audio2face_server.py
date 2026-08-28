from __future__ import annotations

import json
import os
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import numpy as np

from runtime_watchdog import start_parent_watchdog


start_parent_watchdog()


HOST = "127.0.0.1"
PORT = int(os.environ.get("FACE_LAB_A2F_PORT", "8798"))
WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
UNIFIED_ROOT = WORKSPACE_ROOT.parent
SDK_ROOT = WORKSPACE_ROOT / "Audio2Face-3D-SDK"
BRIDGE = SDK_ROOT / "_build" / "release-cu129" / "audio2face-sdk" / "bin" / "a2f-web-bridge.exe"
MODEL = SDK_ROOT / "_data" / "generated" / "audio2face-sdk" / "samples" / "data" / "multi-diffusion" / "model.json"
ENGINE = MODEL.parent / "network.trt"
RUNTIME_DIRS = [
    SDK_ROOT / "_build" / "release-cu129" / "audio2x-sdk" / "bin",
    SDK_ROOT / "_deps" / "TensorRT-10.13.3" / "lib",
    Path(os.environ.get("UNIFIED_CUDA_BIN", UNIFIED_ROOT / "runtime" / "cuda" / "v12.9" / "bin")),
]

_lock = threading.Lock()
_last_latency_ms: float | None = None
_last_error: str | None = None


def ready() -> bool:
    return BRIDGE.exists() and MODEL.exists() and ENGINE.exists() and all(path.exists() for path in RUNTIME_DIRS)


def resample_16k(audio: np.ndarray, sample_rate: int) -> np.ndarray:
    audio = np.nan_to_num(np.asarray(audio, dtype=np.float32).reshape(-1))
    if sample_rate == 16000:
        return audio
    target_count = max(1, round(len(audio) * 16000 / sample_rate))
    old_positions = np.linspace(0.0, 1.0, len(audio), endpoint=False)
    new_positions = np.linspace(0.0, 1.0, target_count, endpoint=False)
    return np.interp(new_positions, old_positions, audio).astype(np.float32)


def infer(audio: np.ndarray, sample_rate: int) -> dict:
    global _last_latency_ms, _last_error
    if not ready():
        raise RuntimeError("The native Audio2Face runtime is not fully installed.")
    source = resample_16k(audio, sample_rate)
    started = time.perf_counter()
    environment = os.environ.copy()
    environment["PATH"] = os.pathsep.join(str(path) for path in RUNTIME_DIRS) + os.pathsep + environment.get("PATH", "")
    with _lock, tempfile.TemporaryDirectory(prefix="face-lab-a2f-") as temp_dir:
        input_path = Path(temp_dir) / "audio.f32"
        output_path = Path(temp_dir) / "frames.json"
        source.astype("<f4", copy=False).tofile(input_path)
        process = subprocess.run(
            [str(BRIDGE), str(MODEL), str(input_path), str(output_path)],
            cwd=SDK_ROOT,
            env=environment,
            capture_output=True,
            text=True,
            timeout=180,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        if process.returncode != 0 or not output_path.exists():
            detail = (process.stderr or process.stdout or "Audio2Face inference failed.").strip()
            _last_error = detail
            raise RuntimeError(detail)
        result = json.loads(output_path.read_text(encoding="utf-8"))
    _last_latency_ms = round((time.perf_counter() - started) * 1000, 1)
    _last_error = None
    result.update(
        ok=True,
        driver="audio2face",
        sampleRate=sample_rate,
        duration=round(len(audio) / sample_rate, 4),
        latencyMs=_last_latency_ms,
        nativeRuntime="NVIDIA Audio2Face-3D SDK v3 / TensorRT 10.13.3",
    )
    return result


class Handler(BaseHTTPRequestHandler):
    server_version = "FaceLabAudio2Face/0.1"

    def log_message(self, message: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {message % args}")

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type, x-sample-rate")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def do_GET(self) -> None:
        if urlparse(self.path).path not in {"/", "/api/status"}:
            self.send_json(404, {"ok": False, "error": "Not found."})
            return
        self.send_json(200, {"ok": True, "ready": ready(), "lastLatencyMs": _last_latency_ms, "error": _last_error})

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/api/infer/audio2face":
            self.send_json(404, {"ok": False, "error": "Not found."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 120 * 1024 * 1024:
                raise ValueError("Audio payload is empty or too large.")
            sample_rate = int(float(self.headers.get("X-Sample-Rate", "48000")))
            if sample_rate < 8000 or sample_rate > 192000:
                raise ValueError("Unsupported audio sample rate.")
            audio = np.frombuffer(self.rfile.read(length), dtype="<f4").copy()
            if len(audio) < sample_rate // 20:
                raise ValueError("Audio clip is too short.")
            self.send_json(200, infer(audio, sample_rate))
        except ValueError as error:
            self.send_json(400, {"ok": False, "error": str(error)})
        except Exception as error:
            self.send_json(500, {"ok": False, "error": str(error)})


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Face Lab Audio2Face: http://{HOST}:{PORT}", flush=True)
    print(f"Native NVIDIA runtime ready: {ready()}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
