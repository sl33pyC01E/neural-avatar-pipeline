"""Remove only verified, redundant source directories after the NF4 encoder build."""

from __future__ import annotations

import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parent
ARTIFACT = ROOT / "models" / "ardy-llm2vec-4bit"
MODELS_ROOT = (ROOT / "models").resolve()
HUB_ROOT = (Path.home() / ".cache" / "huggingface" / "hub").resolve()
TARGETS = [
    MODELS_ROOT / ".ardy-llm2vec-build",
    HUB_ROOT / "models--McGill-NLP--LLM2Vec-Meta-Llama-3-8B-Instruct-mntp",
    HUB_ROOT / "models--McGill-NLP--LLM2Vec-Meta-Llama-3-8B-Instruct-mntp-supervised",
    HUB_ROOT / "models--NousResearch--Meta-Llama-3-8B-Instruct",
]


def contained(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def main() -> None:
    ready_path = ARTIFACT / "READY.json"
    if not ready_path.is_file():
        raise RuntimeError(f"Verified artifact is missing: {ready_path}")
    ready = json.loads(ready_path.read_text(encoding="utf-8"))
    if ready.get("ready") is not True or ready.get("verification", {}).get("cosineVsBf16", 0) < 0.95:
        raise RuntimeError("Artifact verification did not meet the cleanup threshold.")
    removed = []
    for target in TARGETS:
        resolved = target.resolve()
        valid_parent = MODELS_ROOT if resolved.name == ".ardy-llm2vec-build" else HUB_ROOT
        if not contained(resolved, valid_parent) or resolved == valid_parent:
            raise RuntimeError(f"Unsafe cleanup target: {resolved}")
        if resolved.exists():
            shutil.rmtree(resolved)
            removed.append(str(resolved))
    print(json.dumps({"ok": True, "removed": removed}, indent=2))


if __name__ == "__main__":
    main()
