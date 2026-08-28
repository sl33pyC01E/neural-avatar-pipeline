"""Resource-guarded ARDY live-replan evaluation against Motion Drive.

Runs the same idle -> forward -> turn -> stop sequence while varying one
setting. It records seam continuity, latency, and machine utilization without
loading another model process. The script aborts before a request if either
system RAM or VRAM reaches the configured cap.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import time
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path

import psutil


@dataclass
class ResourceSample:
    ram_percent: float
    vram_percent: float
    vram_used_mib: int
    vram_total_mib: int
    power_watts: float


def resource_sample() -> ResourceSample:
    line = subprocess.check_output(
        [
            "nvidia-smi",
            "--query-gpu=memory.used,memory.total,power.draw",
            "--format=csv,noheader,nounits",
        ],
        text=True,
    ).strip().splitlines()[0]
    used, total, power = [part.strip() for part in line.split(",")]
    used_mib, total_mib = int(used), int(total)
    return ResourceSample(
        ram_percent=round(float(psutil.virtual_memory().percent), 2),
        vram_percent=round(100.0 * used_mib / total_mib, 2),
        vram_used_mib=used_mib,
        vram_total_mib=total_mib,
        power_watts=round(float(power), 2),
    )


def guarded_post(url: str, path: str, body: dict, cap_percent: float) -> dict:
    before = resource_sample()
    if before.ram_percent >= cap_percent or before.vram_percent >= cap_percent:
        raise RuntimeError(f"Resource cap reached before request: {before}")
    request = urllib.request.Request(
        f"{url.rstrip('/')}{path}",
        data=json.dumps(body).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=180) as response:
        result = json.load(response)
    after = resource_sample()
    if after.ram_percent >= cap_percent or after.vram_percent >= cap_percent:
        raise RuntimeError(f"Resource cap reached after request: {after}")
    if not result.get("ok"):
        raise RuntimeError(result.get("error", "Live request failed"))
    result["resourcesBefore"] = asdict(before)
    result["resourcesAfter"] = asdict(after)
    return result


def evaluate(
    url: str,
    history_frames: int,
    steps: int,
    blend_seconds: float,
    cap_percent: float,
    auto_text: bool,
    sustain_forward_steps: int,
    replan_buffer_override: int | None,
) -> dict:
    if sustain_forward_steps:
        commands = [("start", 0, 0.0, 0.0, "idle")]
        commands += [
            ("step", 3 + index * 6, 0.0, 1.2, f"forward-{index + 1}")
            for index in range(sustain_forward_steps)
        ]
    else:
        commands = [
            ("start", 0, 0.0, 0.0, "idle"),
            ("step", 1, 0.0, 1.2, "forward"),
            ("step", 7, 1.2, 0.0, "turn"),
            ("step", 13, 0.0, 0.0, "stop"),
        ]
    rows = []
    replan_buffer_frames = (
        replan_buffer_override
        if replan_buffer_override is not None
        else (2 if sustain_forward_steps else 6)
    )
    for endpoint, playback, velocity_x, velocity_z, label in commands:
        prompt = "stand" if label in {"idle", "stop"} else "walk naturally"
        result = guarded_post(
            url,
            f"/api/live/{endpoint}",
            {
                "engine": "ardy",
                "velocityX": velocity_x,
                "velocityZ": velocity_z,
                "steps": steps,
                "constraintGuidance": 2.0,
                "textGuidance": 3.0,
                "historyFrames": history_frames,
                "playbackFrame": playback,
                "replanBufferFrames": replan_buffer_frames,
                "liveSmoothingSeconds": blend_seconds,
                "headingEnabled": True,
                "textEnabled": auto_text,
                "prompt": prompt if auto_text else "",
            },
            cap_percent,
        )
        motion = result["motion"]
        rows.append(
            {
                "command": label,
                "playbackFrame": motion["playbackFrame"],
                "replaceFromFrame": motion["replaceFromFrame"],
                "historyFrames": motion["historyFrames"],
                "windowFrames": motion["windowFrames"],
                "generationSeconds": motion["generationSeconds"],
                "seamRootStepM": motion["seamRootStepM"],
                "seamJointStepMaxM": motion["seamJointStepMaxM"],
                "seamVelocityChangeMps": motion["seamVelocityChangeMps"],
                "seamJointVelocityChangeMaxMps": motion["seamJointVelocityChangeMaxMps"],
                "replacedPoseChangeMaxM": motion["replacedPoseChangeMaxM"],
                "endRoot": motion["rootPosition"],
                "horizonJointStepMaxM": motion["horizonJointStepMaxM"],
                "horizonJointVelocityChangeMaxMps": motion["horizonJointVelocityChangeMaxMps"],
                "resourcesBefore": result["resourcesBefore"],
                "resourcesAfter": result["resourcesAfter"],
            }
        )
        time.sleep(0.1)
    non_initial = rows[1:]
    return {
        "configuration": {
            "historyFrames": history_frames,
            "steps": steps,
            "blendSeconds": blend_seconds,
            "replanBufferFrames": replan_buffer_frames,
            "autoText": auto_text,
        },
        "summary": {
            "generationSecondsMean": sum(row["generationSeconds"] for row in rows) / len(rows),
            "seamRootStepMaxM": max(row["seamRootStepM"] for row in non_initial),
            "seamJointStepMaxM": max(row["seamJointStepMaxM"] for row in non_initial),
            "seamVelocityChangeMaxMps": max(row["seamVelocityChangeMps"] for row in non_initial),
            "seamJointVelocityChangeMaxMps": max(
                row["seamJointVelocityChangeMaxMps"] for row in non_initial
            ),
            "horizonJointStepMaxM": max(row["horizonJointStepMaxM"] for row in non_initial),
            "horizonJointVelocityChangeMaxMps": max(
                row["horizonJointVelocityChangeMaxMps"] for row in non_initial
            ),
            "ramPercentMax": max(row["resourcesAfter"]["ram_percent"] for row in rows),
            "vramPercentMax": max(row["resourcesAfter"]["vram_percent"] for row in rows),
            "powerWattsMax": max(row["resourcesAfter"]["power_watts"] for row in rows),
            "endRoot": rows[-1]["endRoot"],
            "endPlanarDistanceM": math.hypot(rows[-1]["endRoot"][0], rows[-1]["endRoot"][2]),
        },
        "steps": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8793")
    parser.add_argument("--histories", type=int, nargs="+", default=[4, 8, 16])
    parser.add_argument("--steps", type=int, default=3)
    parser.add_argument("--blend-seconds", type=float, default=1.0)
    parser.add_argument("--cap-percent", type=float, default=50.0)
    parser.add_argument("--auto-text", action="store_true")
    parser.add_argument("--sustain-forward-steps", type=int, default=0)
    parser.add_argument("--replan-buffer", type=int)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--summary-only", action="store_true")
    args = parser.parse_args()

    results = [
        evaluate(
            args.url,
            history,
            args.steps,
            args.blend_seconds,
            args.cap_percent,
            args.auto_text,
            args.sustain_forward_steps,
            args.replan_buffer,
        )
        for history in args.histories
    ]
    payload = {"createdAt": time.time(), "results": results}
    rendered = json.dumps(payload, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    if args.summary_only:
        print(json.dumps([result["configuration"] | result["summary"] for result in results], indent=2))
    else:
        print(rendered)


if __name__ == "__main__":
    main()
