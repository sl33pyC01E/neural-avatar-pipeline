from __future__ import annotations

import math
import re
import time
from pathlib import Path

import numpy as np
from scipy.signal import resample_poly


PHONEME_NAMES = ["A", "I", "U", "E", "O", "-"]
OUTPUT_NAMES = [f"uLipSync_{name}" for name in PHONEME_NAMES]
NUMBER_LINE = re.compile(r"^\s+- (-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*$")
NAME_LINE = re.compile(r"^  - name: (.+?)\s*$")


class ULipSyncInference:
    """Offline adapter for uLipSync v3's calibrated MFCC classifier."""

    def __init__(self, profile_path: Path):
        self.profile_path = profile_path
        self.target_sample_rate = 16000
        self.sample_count = 1024
        self.mel_channels = 26
        self.fps = 30
        self.names, self.prototypes = self._load_profile(profile_path)

    @staticmethod
    def _load_profile(path: Path) -> tuple[list[str], np.ndarray]:
        groups: list[tuple[str, list[float]]] = []
        current_name: str | None = None
        current_values: list[float] = []
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            name_match = NAME_LINE.match(line)
            if name_match:
                if current_name is not None:
                    groups.append((current_name, current_values))
                current_name = name_match.group(1).strip("'\"")
                current_values = []
                continue
            if current_name is not None:
                number_match = NUMBER_LINE.match(line)
                if number_match:
                    current_values.append(float(number_match.group(1)))
        if current_name is not None:
            groups.append((current_name, current_values))

        names: list[str] = []
        prototypes: list[np.ndarray] = []
        for name, values in groups:
            data = np.asarray(values, dtype=np.float32)
            if data.size < 12 or data.size % 12:
                continue
            names.append(name)
            prototypes.append(data.reshape(-1, 12)[-16:].mean(axis=0))
        if not prototypes:
            raise ValueError(f"No uLipSync calibration data found in {path}")
        return names, np.stack(prototypes)

    def _mfcc(self, window: np.ndarray) -> np.ndarray:
        data = np.asarray(window, dtype=np.float32).copy()
        if data.size != self.sample_count:
            data = np.pad(data[-self.sample_count :], (max(0, self.sample_count - data.size), 0))
        previous = data.copy()
        data[1:] = previous[1:] - 0.97 * previous[:-1]
        data *= np.hamming(data.size).astype(np.float32)
        peak = float(np.max(np.abs(data)))
        if peak > np.finfo(np.float32).eps:
            data /= peak
        spectrum = np.abs(np.fft.fft(data)).astype(np.float32)

        f_max = self.target_sample_rate / 2
        mel_max = 1127.0 * math.log(f_max / 700.0 + 1.0)
        n_max = len(spectrum) // 2
        df = f_max / n_max
        d_mel = mel_max / (self.mel_channels + 1)
        mel_spectrum = np.zeros(self.mel_channels, dtype=np.float32)
        for channel in range(self.mel_channels):
            mel_begin, mel_center, mel_end = (d_mel * (channel + offset) for offset in range(3))
            f_begin = 700.0 * (math.exp(mel_begin / 1127.0) - 1.0)
            f_center = 700.0 * (math.exp(mel_center / 1127.0) - 1.0)
            f_end = 700.0 * (math.exp(mel_end / 1127.0) - 1.0)
            i_begin = math.ceil(f_begin / df)
            i_center = round(f_center / df)
            i_end = math.floor(f_end / df)
            total = 0.0
            for index in range(i_begin + 1, i_end + 1):
                frequency = df * index
                if index < i_center:
                    weight = (frequency - f_begin) / max(f_center - f_begin, 1e-8)
                else:
                    weight = (f_end - frequency) / max(f_end - f_center, 1e-8)
                weight /= max((f_end - f_begin) * 0.5, 1e-8)
                total += weight * float(spectrum[index])
            mel_spectrum[channel] = max(total, 1e-12)
        mel_spectrum = 10.0 * np.log10(mel_spectrum)
        indices = np.arange(self.mel_channels, dtype=np.float32)
        cepstrum = np.asarray(
            [np.sum(mel_spectrum * np.cos((indices + 0.5) * i * np.pi / self.mel_channels)) for i in range(self.mel_channels)],
            dtype=np.float32,
        )
        return cepstrum[1:13]

    def infer(self, audio: np.ndarray, sample_rate: int) -> dict:
        started = time.perf_counter()
        audio = np.nan_to_num(np.asarray(audio, dtype=np.float32).reshape(-1))
        if sample_rate != self.target_sample_rate:
            divisor = math.gcd(sample_rate, self.target_sample_rate)
            audio = resample_poly(audio, self.target_sample_rate // divisor, sample_rate // divisor).astype(np.float32)

        frame_count = max(1, math.ceil(len(audio) / self.target_sample_rate * self.fps))
        output = np.zeros((frame_count, len(PHONEME_NAMES)), dtype=np.float32)
        source_indices = {name: index for index, name in enumerate(self.names)}
        for frame_index in range(frame_count):
            end = min(len(audio), max(1, round((frame_index + 1) * self.target_sample_rate / self.fps)))
            start = max(0, end - self.sample_count)
            window = np.pad(audio[start:end], (max(0, self.sample_count - (end - start)), 0))
            raw_volume = float(np.sqrt(np.mean(np.square(window))))
            normalized_volume = float(np.clip((math.log10(max(raw_volume, 1e-12)) + 2.5) / 1.0, 0.0, 1.0))
            mfcc = self._mfcc(window)
            mfcc_norm = max(float(np.linalg.norm(mfcc)), 1e-8)
            prototype_norms = np.maximum(np.linalg.norm(self.prototypes, axis=1), 1e-8)
            similarities = np.maximum((self.prototypes @ mfcc) / (prototype_norms * mfcc_norm), 0.0)
            scores = np.power(similarities, 100.0)
            if float(scores.sum()) > 0:
                scores /= scores.sum()
            for output_index, name in enumerate(PHONEME_NAMES):
                source_index = source_indices.get(name)
                if source_index is not None:
                    output[frame_index, output_index] = float(scores[source_index]) * normalized_volume
        return {
            "ok": True,
            "driver": "ulipsync",
            "fps": self.fps,
            "sampleRate": sample_rate,
            "duration": round(len(audio) / self.target_sample_rate, 4),
            "latencyMs": round((time.perf_counter() - started) * 1000, 1),
            "names": OUTPUT_NAMES,
            "frames": np.round(output, 4).tolist(),
        }
