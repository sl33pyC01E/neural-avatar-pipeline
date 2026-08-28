from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
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
PORT = int(os.environ.get("FACE_LAB_BACKEND_PORT", "8794"))
WEBUI_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = WEBUI_ROOT.parent
FACE_ROOT = WORKSPACE_ROOT.parent
NYX_ROOT = WORKSPACE_ROOT / "NyxClaw-Wav2Arkit"
NYX_SOURCE = NYX_ROOT / "src"
WAV2ARKIT_MODEL = NYX_ROOT / "pretrained_models" / "wav2arkit" / "wav2arkit_cpu.onnx"
SAMPLE_AUDIO = WORKSPACE_ROOT / "Audio2Face-3D-SDK" / "sample-data" / "audio_4sec_16k_s16le.wav"
ULIPSYNC_PROFILE = WORKSPACE_ROOT / "uLipSync" / "Assets" / "uLipSync" / "Assets" / "Profiles" / "uLipSync-Profile-Sample-Female.asset"

MODELS = {
    "zome": {
        "name": "Zome",
        "detail": "VRM 0.x · 74 facial morphs · 15 visemes",
        "path": FACE_ROOT / "vnyan" / "Zome.vrm",
    },
}

PROJECT_EXAMPLES = {
    "example-wav2arkit": {
        "name": "NyxClaw phone avatar demo",
        "detail": "Official animated reference · renderer lives in the NyxClaw mobile client",
        "path": NYX_ROOT / "docs" / "nyxclaw_intro.gif",
        "renderer": "media",
        "driver": "wav2arkit",
        "driven": False,
        "content_type": "image/gif",
    },
    "example-audio2face": {
        "name": "Audio2Face Claire geometry",
        "detail": "Official v3 Claire facial vertices and 52-control solver rig",
        "path": WORKSPACE_ROOT / "assets" / "project_examples" / "audio2face-claire-points.glb",
        "renderer": "gltf",
        "driver": "audio2face",
        "driven": True,
        "content_type": "model/gltf-binary",
    },
    "example-ulipsync": {
        "name": "uLipSync Unity-Chan sample",
        "detail": "Unity-Chan FBX from the project's canonical Unity sample scene",
        "path": WORKSPACE_ROOT / "uLipSync" / "Assets" / "uLipSync" / "Samples" / "00. Common" / "UnityChan" / "Models" / "unitychan.fbx",
        "renderer": "fbx",
        "driver": "ulipsync",
        "driven": True,
        "content_type": "application/octet-stream",
    },
    "example-lam": {
        "name": "LAM James generated head",
        "detail": "Generated skin.glb shipped with LAM's sample output assets",
        "path": WORKSPACE_ROOT / "LAM-Audio2Expression" / "assets" / "sample_lam" / "james" / "arkitWithBSData" / "skin.glb",
        "renderer": "gltf",
        "driver": "lam",
        "driven": True,
        "content_type": "model/gltf-binary",
    },
}
ULIPSYNC_TEXTURE_DIR = WORKSPACE_ROOT / "uLipSync" / "Assets" / "uLipSync" / "Samples" / "00. Common" / "UnityChan" / "Models" / "UnityChanShader" / "Texture"

_wav2arkit = None
_wav2arkit_lock = threading.Lock()
_wav2arkit_load_ms = None
_ulipsync = None
_ulipsync_lock = threading.Lock()


def service_running(port: int) -> bool:
    try:
        with socket.create_connection((HOST, port), timeout=0.08):
            return True
    except OSError:
        return False


def driver_statuses() -> list[dict]:
    a2f_engine = WORKSPACE_ROOT / "Audio2Face-3D-SDK" / "_data" / "generated" / "audio2face-sdk" / "samples" / "data" / "multi-diffusion" / "network.trt"
    a2f_bridge = WORKSPACE_ROOT / "Audio2Face-3D-SDK" / "_build" / "release-cu129" / "audio2face-sdk" / "bin" / "a2f-web-bridge.exe"
    a2f_online = a2f_engine.exists() and a2f_bridge.exists() and service_running(8798)
    lam_weights = WORKSPACE_ROOT / "LAM-Audio2Expression" / "pretrained_models" / "lam_audio2exp_streaming.tar"
    lam_online = lam_weights.exists() and service_running(8797)
    return [
        {
            "id": "wav2arkit",
            "name": "Wav2Arkit",
            "detail": "52 ARKit channels · ONNX CPU",
            "state": "ready" if WAV2ARKIT_MODEL.exists() else "missing",
            "runnable": WAV2ARKIT_MODEL.exists(),
            "note": "Ready for local inference." if WAV2ARKIT_MODEL.exists() else "ONNX model is missing.",
        },
        {
            "id": "audio2face",
            "name": "Audio2Face",
            "detail": "NVIDIA v3 · TensorRT · ARKit 52",
            "state": "ready" if a2f_online else "starting" if a2f_engine.exists() and a2f_bridge.exists() else "missing",
            "runnable": a2f_online,
            "note": "Native Audio2Face-3D v3 is ready with its 52-control ARKit solver."
            if a2f_online
            else "Audio2Face is installed; its native worker is starting."
            if a2f_engine.exists() and a2f_bridge.exists()
            else "The compiled Audio2Face runtime or TensorRT engine is missing.",
        },
        {
            "id": "ulipsync",
            "name": "uLipSync",
            "detail": "Calibrated MFCC · CPU",
            "state": "ready" if ULIPSYNC_PROFILE.exists() else "missing",
            "runnable": ULIPSYNC_PROFILE.exists(),
            "note": "Ready through a native Python port of uLipSync v3's MFCC classifier and bundled female calibration profile."
            if ULIPSYNC_PROFILE.exists()
            else "The bundled uLipSync calibration profile is missing.",
        },
        {
            "id": "lam",
            "name": "LAM A2E",
            "detail": "Wav2Vec · ARKit 52",
            "state": "ready" if lam_online else "starting" if lam_weights.exists() else "missing",
            "runnable": lam_online,
            "note": "Original LAM streaming checkpoint is loaded on the GPU and ready for local inference."
            if lam_online
            else "LAM weights are installed; its GPU worker is starting."
            if lam_weights.exists()
            else "The original LAM streaming checkpoint is missing.",
        },
    ]


def get_wav2arkit():
    global _wav2arkit, _wav2arkit_load_ms
    if _wav2arkit is not None:
        return _wav2arkit
    with _wav2arkit_lock:
        if _wav2arkit is not None:
            return _wav2arkit
        if not WAV2ARKIT_MODEL.exists():
            raise FileNotFoundError(f"Wav2Arkit model not found: {WAV2ARKIT_MODEL}")
        sys.path.insert(0, str(NYX_SOURCE))
        from wav2arkit.inference import Wav2ArkitInference

        started = time.perf_counter()
        _wav2arkit = Wav2ArkitInference(str(WAV2ARKIT_MODEL))
        _wav2arkit_load_ms = round((time.perf_counter() - started) * 1000, 1)
        return _wav2arkit


def get_ulipsync():
    global _ulipsync
    if _ulipsync is not None:
        return _ulipsync
    with _ulipsync_lock:
        if _ulipsync is None:
            from ulipsync_adapter import ULipSyncInference

            _ulipsync = ULipSyncInference(ULIPSYNC_PROFILE)
    return _ulipsync


class FaceLabHandler(BaseHTTPRequestHandler):
    server_version = "FaceLab/0.1"

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
        pathname = urlparse(self.path).path
        if pathname in {"/", "/api/status"}:
            models = [
                {
                    "id": model_id,
                    "name": model["name"],
                    "detail": model["detail"],
                    "ready": model["path"].exists(),
                    "sizeMb": round(model["path"].stat().st_size / 1048576, 1) if model["path"].exists() else 0,
                    "url": f"http://{HOST}:{PORT}/models/{model_id}.vrm",
                }
                for model_id, model in MODELS.items()
            ]
            models.extend(
                {
                    "id": example_id,
                    "name": example["name"],
                    "detail": example["detail"],
                    "ready": example["path"].exists(),
                    "sizeMb": round(example["path"].stat().st_size / 1048576, 1) if example["path"].exists() else 0,
                    "url": f"http://{HOST}:{PORT}/examples/{example_id}",
                    "renderer": example["renderer"],
                    "driver": example["driver"],
                    "driven": example["driven"],
                }
                for example_id, example in PROJECT_EXAMPLES.items()
            )
            self.send_json(
                200,
                {
                    "ok": True,
                    "drivers": driver_statuses(),
                    "models": models,
                    "wav2arkitLoaded": _wav2arkit is not None,
                    "wav2arkitLoadMs": _wav2arkit_load_ms,
                },
            )
            return
        if pathname.startswith("/models/") and pathname.endswith(".vrm"):
            model_id = Path(pathname).stem
            model = MODELS.get(model_id)
            if not model or not model["path"].exists():
                self.send_json(404, {"ok": False, "error": "Model is not available."})
                return
            data = model["path"].read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "model/gltf-binary")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if pathname.startswith("/examples/ulipsync-textures/"):
            texture_name = Path(pathname).name
            texture_path = ULIPSYNC_TEXTURE_DIR / texture_name
            if texture_path.parent != ULIPSYNC_TEXTURE_DIR or not texture_path.exists():
                self.send_json(404, {"ok": False, "error": "Texture is not available."})
                return
            data = texture_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "image/x-tga")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if pathname.startswith("/examples/"):
            example_id = pathname.removeprefix("/examples/")
            example = PROJECT_EXAMPLES.get(example_id)
            if not example or not example["path"].exists():
                self.send_json(404, {"ok": False, "error": "Project example is not available."})
                return
            data = example["path"].read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", example["content_type"])
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if pathname == "/samples/default.wav" and SAMPLE_AUDIO.exists():
            data = SAMPLE_AUDIO.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self.send_json(404, {"ok": False, "error": "Not found."})

    def do_POST(self) -> None:
        pathname = urlparse(self.path).path
        if pathname == "/api/export/mp4":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 300 * 1024 * 1024:
                    raise ValueError("Recorded preview is empty or too large.")
                ffmpeg = shutil.which("ffmpeg")
                if not ffmpeg:
                    raise FileNotFoundError("The local MP4 encoder is unavailable.")
                with tempfile.TemporaryDirectory(prefix="face-lab-export-") as temp_dir:
                    source = Path(temp_dir) / "capture.webm"
                    output = Path(temp_dir) / "face-animation.mp4"
                    source.write_bytes(self.rfile.read(length))
                    completed = subprocess.run(
                        [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source), "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(output)],
                        capture_output=True,
                        text=True,
                        timeout=600,
                    )
                    if completed.returncode != 0 or not output.exists():
                        print(f"MP4 encoder error: {completed.stderr.strip()}", flush=True)
                        raise RuntimeError("The MP4 encoder could not finish this capture.")
                    data = output.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Disposition", 'attachment; filename="face-animation.mp4"')
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except Exception as error:
                self.send_json(500, {"ok": False, "error": str(error)})
            return
        if pathname not in {"/api/infer/wav2arkit", "/api/infer/ulipsync"}:
            self.send_json(404, {"ok": False, "error": "Not found."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 120 * 1024 * 1024:
                raise ValueError("Audio payload is empty or too large.")
            sample_rate = int(float(self.headers.get("X-Sample-Rate", "48000")))
            if sample_rate < 8000 or sample_rate > 192000:
                raise ValueError("Unsupported audio sample rate.")
            raw = self.rfile.read(length)
            audio = np.frombuffer(raw, dtype="<f4").copy()
            if audio.size < sample_rate // 20:
                raise ValueError("Audio clip is too short.")
            if pathname.endswith("/ulipsync"):
                self.send_json(200, get_ulipsync().infer(audio, sample_rate))
            else:
                model = get_wav2arkit()
                started = time.perf_counter()
                with _wav2arkit_lock:
                    result, _ = model.infer_streaming(audio, sample_rate)
                elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
                if result.get("code") != 0 or result.get("expression") is None:
                    raise RuntimeError(result.get("error") or "Wav2Arkit inference failed.")
                frames = np.clip(result["expression"], 0.0, 1.0).astype(np.float32)
                self.send_json(
                    200,
                    {
                        "ok": True,
                        "driver": "wav2arkit",
                        "fps": 30,
                        "sampleRate": sample_rate,
                        "duration": round(audio.size / sample_rate, 4),
                        "latencyMs": elapsed_ms,
                        "loadMs": _wav2arkit_load_ms,
                        "names": model.get_blendshape_names(),
                        "frames": np.round(frames, 4).tolist(),
                    },
                )
        except Exception as error:
            self.send_json(500, {"ok": False, "error": str(error)})


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), FaceLabHandler)
    print(f"Face Lab backend: http://{HOST}:{PORT}", flush=True)
    print(f"Zome: {MODELS['zome']['path']}", flush=True)
    print("Project-native examples: Audio2Face Claire, Unity-Chan, LAM James, and NyxClaw reference", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
