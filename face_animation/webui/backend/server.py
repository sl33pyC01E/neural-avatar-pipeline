from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from runtime_watchdog import start_parent_watchdog


start_parent_watchdog()


HOST = "127.0.0.1"
PORT = int(os.environ.get("FACE_LAB_BACKEND_PORT", "8794"))
WEBUI_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = WEBUI_ROOT.parent
UNIFIED_ROOT = WORKSPACE_ROOT.parent
LAM_WEIGHT = WORKSPACE_ROOT / "LAM-Audio2Expression" / "pretrained_models" / "lam_audio2exp_streaming.tar"
AVATAR = {
    "id": "zome",
    "name": "Local VRM avatar",
    "detail": "User-supplied VRM target · excluded from Git",
    "path": UNIFIED_ROOT / "vnyan" / "Zome.vrm",
}


def service_running(port: int) -> bool:
    try:
        with socket.create_connection((HOST, port), timeout=0.08):
            return True
    except OSError:
        return False


def lam_status() -> dict:
    online = LAM_WEIGHT.exists() and service_running(8797)
    return {
        "id": "lam",
        "name": "LAM Audio2Expression",
        "detail": "Streaming Wav2Vec · 52 ARKit controls · CUDA",
        "state": "ready" if online else "starting" if LAM_WEIGHT.exists() else "missing",
        "runnable": online,
        "note": (
            "LAM is loaded and ready for local facial-animation inference."
            if online
            else "LAM is installed and its CUDA worker is starting."
            if LAM_WEIGHT.exists()
            else "The LAM streaming checkpoint is missing."
        ),
    }


class FacePipelineHandler(BaseHTTPRequestHandler):
    server_version = "NeuralAvatarFace/1.0"

    def log_message(self, message: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {message % args}")

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
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
            avatar_path = AVATAR["path"]
            self.send_json(
                200,
                {
                    "ok": True,
                    "driver": lam_status(),
                    "avatar": {
                        "id": AVATAR["id"],
                        "name": AVATAR["name"],
                        "detail": AVATAR["detail"],
                        "ready": avatar_path.exists(),
                        "sizeMb": round(avatar_path.stat().st_size / 1048576, 1) if avatar_path.exists() else 0,
                        "url": f"http://{HOST}:{PORT}/avatar.vrm",
                    },
                },
            )
            return
        if pathname == "/avatar.vrm":
            avatar_path = AVATAR["path"]
            if not avatar_path.exists():
                self.send_json(404, {"ok": False, "error": "The local VRM avatar is not available."})
                return
            data = avatar_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "model/gltf-binary")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self.send_json(404, {"ok": False, "error": "Not found."})

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/api/export/mp4":
            self.send_json(404, {"ok": False, "error": "Not found."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 300 * 1024 * 1024:
                raise ValueError("Recorded preview is empty or too large.")
            ffmpeg = shutil.which("ffmpeg")
            if not ffmpeg:
                raise FileNotFoundError("The local MP4 encoder is unavailable.")
            with tempfile.TemporaryDirectory(prefix="neural-avatar-export-") as temp_dir:
                source = Path(temp_dir) / "capture.webm"
                output = Path(temp_dir) / "facial-animation.mp4"
                source.write_bytes(self.rfile.read(length))
                completed = subprocess.run(
                    [
                        ffmpeg,
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-y",
                        "-i",
                        str(source),
                        "-vf",
                        "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                        "-c:v",
                        "libx264",
                        "-preset",
                        "veryfast",
                        "-crf",
                        "20",
                        "-pix_fmt",
                        "yuv420p",
                        "-c:a",
                        "aac",
                        "-b:a",
                        "160k",
                        "-movflags",
                        "+faststart",
                        str(output),
                    ],
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
            self.send_header("Content-Disposition", 'attachment; filename="facial-animation.mp4"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as error:
            self.send_json(500, {"ok": False, "error": str(error)})


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), FacePipelineHandler)
    print(f"Neural Avatar face backend: http://{HOST}:{PORT}", flush=True)
    print(f"Local VRM target: {AVATAR['path']}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
