from __future__ import annotations

import io
import json
import os
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import numpy as np
import torch
from pocket_tts import TTSModel

from runtime_watchdog import start_parent_watchdog


start_parent_watchdog()


HOST = os.environ.get("FACE_LAB_HOST", "127.0.0.1")
PORT = int(os.environ.get("FACE_LAB_TTS_PORT", "8796"))
VOICE = "anna"
MAX_TEXT_LENGTH = 800
DEVICE = "cuda" if torch.cuda.is_available() and os.environ.get("FACE_LAB_TTS_DEVICE", "cpu").lower() == "cuda" else "cpu"

_model = None
_voice_state = None
_load_error: str | None = None
_load_ms: float | None = None
_loading = False
_model_lock = threading.Lock()


def load_engine():
    global _model, _voice_state, _load_error, _load_ms, _loading
    if _model is not None:
        return _model, _voice_state
    with _model_lock:
        if _model is not None:
            return _model, _voice_state
        _loading = True
        started = time.perf_counter()
        try:
            model = TTSModel.load_model(language="english", temp=0.7)
            model.to(DEVICE)
            voice_state = model.get_state_for_audio_prompt(VOICE)
            if DEVICE == "cuda":
                torch.cuda.synchronize()
            _model = model
            _voice_state = voice_state
            _load_ms = round((time.perf_counter() - started) * 1000, 1)
            _load_error = None
            print(f"PocketTTS ready: {VOICE} on {DEVICE} ({_load_ms} ms warm-up)", flush=True)
        except Exception as error:
            _load_error = str(error)
            print(f"PocketTTS warm-up failed: {_load_error}", flush=True)
            raise
        finally:
            _loading = False
    return _model, _voice_state


def encode_wav(audio, sample_rate: int) -> bytes:
    samples = np.asarray(audio.detach().cpu(), dtype=np.float32).reshape(-1)
    samples = np.nan_to_num(samples, nan=0.0, posinf=1.0, neginf=-1.0)
    peak = float(np.max(np.abs(samples))) if len(samples) else 0.0
    if peak > 0.99:
        samples *= 0.99 / peak
    pcm = np.round(np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")
    output = io.BytesIO()
    with wave.open(output, "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(sample_rate)
        stream.writeframes(pcm.tobytes())
    return output.getvalue()


def encode_pcm16(audio) -> bytes:
    samples = np.asarray(audio.detach().cpu(), dtype=np.float32).reshape(-1)
    samples = np.nan_to_num(samples, nan=0.0, posinf=1.0, neginf=-1.0)
    return np.round(np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()


class PocketTTSHandler(BaseHTTPRequestHandler):
    server_version = "FaceLabPocketTTS/0.1"

    def log_message(self, message: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {message % args}")

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Expose-Headers", "x-tts-voice, x-tts-device, x-tts-latency-ms, x-sample-rate, x-pcm-format")
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
        self.send_json(
            200,
            {
                "ok": True,
                "engine": "kyutai-labs/pocket-tts",
                "voice": VOICE,
                "device": DEVICE,
                "ready": _model is not None,
                "loading": _loading,
                "loadMs": _load_ms,
                "error": _load_error,
            },
        )

    def do_POST(self) -> None:
        request_path = urlparse(self.path).path
        if request_path not in {"/api/tts", "/api/tts/stream"}:
            self.send_json(404, {"ok": False, "error": "Not found."})
            return
        started = time.perf_counter()
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 16 * 1024:
                raise ValueError("The voice request is empty or too large.")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            text = str(payload.get("text", "")).strip()
            if not text:
                raise ValueError("Enter something for Anna to say.")
            if len(text) > MAX_TEXT_LENGTH:
                raise ValueError(f"Text is limited to {MAX_TEXT_LENGTH} characters per test.")
            model, voice_state = load_engine()
            if request_path == "/api/tts/stream":
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("X-TTS-Voice", VOICE)
                self.send_header("X-TTS-Device", DEVICE)
                self.send_header("X-Sample-Rate", str(int(model.sample_rate)))
                self.send_header("X-PCM-Format", "s16le")
                self.send_header("Connection", "close")
                self.end_headers()
                self.close_connection = True
                with _model_lock:
                    for chunk in model.generate_audio_stream(voice_state, text, copy_state=True):
                        self.wfile.write(encode_pcm16(chunk))
                        self.wfile.flush()
                return
            with _model_lock:
                audio = model.generate_audio(voice_state, text, copy_state=True)
                if DEVICE == "cuda":
                    torch.cuda.synchronize()
            wav_data = encode_wav(audio, int(model.sample_rate))
            elapsed_ms = round((time.perf_counter() - started) * 1000, 1)
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(wav_data)))
            self.send_header("X-TTS-Voice", VOICE)
            self.send_header("X-TTS-Device", DEVICE)
            self.send_header("X-TTS-Latency-Ms", str(elapsed_ms))
            self.end_headers()
            self.wfile.write(wav_data)
        except (BrokenPipeError, ConnectionResetError):
            return
        except ValueError as error:
            self.send_json(400, {"ok": False, "error": str(error)})
        except Exception as error:
            self.send_json(500, {"ok": False, "error": str(error)})


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), PocketTTSHandler)
    print(f"Face Lab PocketTTS: http://{HOST}:{PORT} · voice {VOICE}", flush=True)
    threading.Thread(target=lambda: load_engine(), daemon=True, name="pocket-tts-warmup").start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
