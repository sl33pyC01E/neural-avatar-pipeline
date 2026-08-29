from __future__ import annotations

import json
import math
import os
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import numpy as np

from runtime_watchdog import start_parent_watchdog


start_parent_watchdog()


HOST = os.environ.get("FACE_LAB_HOST", "127.0.0.1")
PORT = int(os.environ.get("FACE_LAB_LAM_PORT", "8797"))
WEBUI_ROOT = Path(__file__).resolve().parents[1]
LAM_ROOT = WEBUI_ROOT.parent / "LAM-Audio2Expression"
CONFIG = LAM_ROOT / "configs" / "lam_audio2exp_config_streaming.py"
WEIGHT = LAM_ROOT / "pretrained_models" / "lam_audio2exp_streaming.tar"

sys.path.insert(0, str(LAM_ROOT))
os.chdir(LAM_ROOT)

_engine = None
_load_error: str | None = None
_load_ms: float | None = None
_loading = False
_lock = threading.Lock()
_stream_sessions: dict[str, dict] = {}
_stream_sessions_lock = threading.Lock()


def load_engine():
    global _engine, _load_error, _load_ms, _loading
    if _engine is not None:
        return _engine
    with _lock:
        if _engine is not None:
            return _engine
        _loading = True
        started = time.perf_counter()
        try:
            from engines.defaults import default_config_parser, default_setup
            from engines.infer import INFER

            cfg = default_config_parser(
                str(CONFIG),
                {
                    "weight": str(WEIGHT),
                    "save_path": str(LAM_ROOT / "exp" / "face_lab"),
                    "ex_vol": False,
                    "save_json_path": None,
                },
            )
            cfg = default_setup(cfg)
            engine = INFER.build(dict(type=cfg.infer.type, cfg=cfg))
            engine.model.eval()
            # Building the model does not initialize every CUDA kernel used by
            # streaming inference. Run and discard one real-sized silent window
            # so the first user line does not pay that one-time penalty.
            warmup_result, _ = engine.infer_streaming_audio(np.zeros(24000, dtype=np.float32), 24000, None)
            if (
                warmup_result is None
                or warmup_result.get("code") != 0
                or warmup_result.get("expression") is None
            ):
                raise RuntimeError("LAM A2E CUDA inference warm-up did not return facial expressions.")
            _engine = engine
            _load_ms = round((time.perf_counter() - started) * 1000, 1)
            _load_error = None
            print(f"LAM A2E ready ({_load_ms} ms warm-up)", flush=True)
        except Exception as error:
            _load_error = str(error)
            print(f"LAM A2E warm-up failed: {_load_error}", flush=True)
            raise
        finally:
            _loading = False
    return _engine


def infer_audio(audio: np.ndarray, sample_rate: int) -> dict:
    from models.utils import ARKitBlendShape

    engine = load_engine()
    started = time.perf_counter()
    audio = np.nan_to_num(np.asarray(audio, dtype=np.float32).reshape(-1))
    chunk_samples = max(1, sample_rate)
    context = None
    frames: list[np.ndarray] = []
    with _lock:
        for offset in range(0, len(audio), chunk_samples):
            chunk = audio[offset : offset + chunk_samples]
            if len(chunk) < sample_rate // 20:
                chunk = np.pad(chunk, (0, sample_rate // 20 - len(chunk)))
            result, context = engine.infer_streaming_audio(chunk, sample_rate, context)
            if result is None or result.get("code") != 0 or result.get("expression") is None:
                raise RuntimeError("LAM A2E did not return facial expressions.")
            frames.append(np.asarray(result["expression"], dtype=np.float32))
            context["is_initial_input"] = False
    output = np.concatenate(frames, axis=0)
    expected = max(1, math.ceil(len(audio) / sample_rate * 30))
    output = np.clip(output[:expected], 0.0, 1.0)
    return {
        "ok": True,
        "driver": "lam",
        "fps": 30,
        "sampleRate": sample_rate,
        "duration": round(len(audio) / sample_rate, 4),
        "latencyMs": round((time.perf_counter() - started) * 1000, 1),
        "loadMs": _load_ms,
        "names": list(ARKitBlendShape),
        "frames": np.round(output, 4).tolist(),
    }


def start_stream_session() -> str:
    load_engine()
    now = time.monotonic()
    with _stream_sessions_lock:
        for key in [key for key, value in _stream_sessions.items() if now - value["touched"] > 300]:
            _stream_sessions.pop(key, None)
        session_id = uuid.uuid4().hex
        _stream_sessions[session_id] = {"context": None, "touched": now}
    return session_id


def infer_stream_chunk(session_id: str, audio: np.ndarray, sample_rate: int) -> dict:
    from models.utils import ARKitBlendShape

    clean_audio = np.nan_to_num(np.asarray(audio, dtype=np.float32).reshape(-1))
    original_samples = len(clean_audio)
    if not original_samples:
        raise ValueError("The LAM stream chunk is empty.")
    if original_samples < sample_rate // 20:
        model_audio = np.pad(clean_audio, (0, sample_rate // 20 - original_samples))
    else:
        model_audio = clean_audio
    with _stream_sessions_lock:
        session = _stream_sessions.get(session_id)
        if session is None:
            raise ValueError("The LAM stream session has expired.")
        context = session["context"]
    engine = load_engine()
    started = time.perf_counter()
    with _lock:
        result, context = engine.infer_streaming_audio(model_audio, sample_rate, context)
    if result is None or result.get("code") != 0 or result.get("expression") is None:
        raise RuntimeError("LAM A2E did not return facial expressions for the stream chunk.")
    context["is_initial_input"] = False
    with _stream_sessions_lock:
        session = _stream_sessions.get(session_id)
        if session is None:
            raise ValueError("The LAM stream session has expired.")
        session["context"] = context
        session["touched"] = time.monotonic()
    frames = np.clip(np.asarray(result["expression"], dtype=np.float32), 0.0, 1.0)
    expected = max(1, math.ceil(original_samples / sample_rate * 30))
    frames = frames[:expected]
    return {
        "ok": True,
        "driver": "lam",
        "fps": 30,
        "sampleRate": sample_rate,
        "duration": round(original_samples / sample_rate, 4),
        "latencyMs": round((time.perf_counter() - started) * 1000, 1),
        "names": list(ARKitBlendShape),
        "frames": np.round(frames, 4).tolist(),
    }


def finish_stream_session(session_id: str) -> None:
    with _stream_sessions_lock:
        _stream_sessions.pop(session_id, None)


class LAMHandler(BaseHTTPRequestHandler):
    server_version = "FaceLabLAM/0.1"

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
        self.send_json(200, {"ok": True, "ready": _engine is not None, "loading": _loading, "loadMs": _load_ms, "error": _load_error})

    def do_POST(self) -> None:
        request_url = urlparse(self.path)
        request_path = request_url.path
        if request_path == "/api/infer/lam/stream/start":
            try:
                self.send_json(200, {"ok": True, "sessionId": start_stream_session()})
            except Exception as error:
                self.send_json(500, {"ok": False, "error": str(error)})
            return
        if request_path == "/api/infer/lam/stream/finish":
            session_id = str(parse_qs(request_url.query).get("session", [""])[0])
            finish_stream_session(session_id)
            self.send_json(200, {"ok": True})
            return
        if request_path not in {"/api/infer/lam", "/api/infer/lam/stream/chunk"}:
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
            if request_path == "/api/infer/lam/stream/chunk":
                session_id = str(parse_qs(request_url.query).get("session", [""])[0])
                self.send_json(200, infer_stream_chunk(session_id, audio, sample_rate))
            else:
                self.send_json(200, infer_audio(audio, sample_rate))
        except ValueError as error:
            self.send_json(400, {"ok": False, "error": str(error)})
        except Exception as error:
            self.send_json(500, {"ok": False, "error": str(error)})


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), LAMHandler)
    print(f"Face Lab LAM A2E: http://{HOST}:{PORT}", flush=True)
    threading.Thread(target=lambda: load_engine(), daemon=True, name="lam-warmup").start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
