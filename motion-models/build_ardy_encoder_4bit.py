"""Build and verify the shared ARDY/Kimodo LLM2Vec encoder as a local NF4 artifact."""

from __future__ import annotations

import gc
import json
import math
import shutil
import time
from pathlib import Path

import numpy as np
import torch
from huggingface_hub import hf_hub_download, model_info, snapshot_download
from peft import PeftModel
from transformers import AutoTokenizer, BitsAndBytesConfig

from ardy.model.llm2vec.llm2vec import LLM2Vec
from ardy.model.llm2vec.models.bidirectional_llama import LlamaBiModel


ROOT = Path(__file__).resolve().parent
MODELS_ROOT = ROOT / "models"
FINAL_ROOT = MODELS_ROOT / "ardy-llm2vec-4bit"
BUILD_ROOT = MODELS_ROOT / ".ardy-llm2vec-build"
STAGE_ROOT = MODELS_ROOT / ".ardy-llm2vec-4bit-stage"
MERGED_ROOT = BUILD_ROOT / "merged-mntp-bf16"

BASE_REPO = "NousResearch/Meta-Llama-3-8B-Instruct"
MNTP_REPO = "McGill-NLP/LLM2Vec-Meta-Llama-3-8B-Instruct-mntp"
SUPERVISED_REPO = "McGill-NLP/LLM2Vec-Meta-Llama-3-8B-Instruct-mntp-supervised"
CANONICAL_BASE = "meta-llama/Meta-Llama-3-8B-Instruct"
TEST_TEXT = "walk naturally"


def release(*objects) -> None:
    for item in objects:
        del item
    gc.collect()
    torch.cuda.empty_cache()


def encoder(model, tokenizer) -> LLM2Vec:
    model.config._name_or_path = CANONICAL_BASE
    return LLM2Vec(
        model=model,
        tokenizer=tokenizer,
        pooling_mode="mean",
        max_length=512,
        doc_max_length=400,
        skip_instruction=True,
    )


def encode_one(model, tokenizer) -> np.ndarray:
    value = encoder(model, tokenizer).encode(
        [TEST_TEXT], batch_size=1, show_progress_bar=False, device="cuda:0"
    )
    value = np.asarray(value, dtype=np.float32).reshape(-1)
    if value.shape != (4096,) or not np.isfinite(value).all() or np.linalg.norm(value) < 1e-6:
        raise RuntimeError(f"Invalid text embedding: shape={value.shape}, norm={np.linalg.norm(value)}")
    return value


def download_adapter(repo: str, revision: str, target: Path) -> Path:
    """Download only the two PEFT files directly, avoiding Windows cache symlinks."""
    target.mkdir(parents=True, exist_ok=True)
    for name in ("adapter_config.json", "adapter_model.safetensors"):
        hf_hub_download(repo, name, revision=revision, local_dir=target)
    return target


def main() -> None:
    if FINAL_ROOT.exists():
        raise FileExistsError(f"Refusing to overwrite existing artifact: {FINAL_ROOT}")
    for staging in (BUILD_ROOT, STAGE_ROOT):
        if staging.exists() and any(staging.iterdir()):
            raise FileExistsError(f"A non-empty build staging directory exists: {staging}")
    MODELS_ROOT.mkdir(parents=True, exist_ok=True)
    BUILD_ROOT.mkdir(parents=True, exist_ok=True)
    STAGE_ROOT.mkdir(parents=True, exist_ok=True)

    print("Resolving public base and official LLM2Vec adapters...", flush=True)
    base_revision = model_info(BASE_REPO).sha
    mntp_revision = model_info(MNTP_REPO).sha
    supervised_revision = model_info(SUPERVISED_REPO).sha
    base_path = Path(snapshot_download(BASE_REPO, revision=base_revision))
    mntp_path = download_adapter(MNTP_REPO, mntp_revision, BUILD_ROOT / "adapters" / "mntp")
    supervised_path = download_adapter(
        SUPERVISED_REPO, supervised_revision, BUILD_ROOT / "adapters" / "supervised"
    )

    tokenizer = AutoTokenizer.from_pretrained(base_path, local_files_only=True)
    tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "left"

    print("Loading bf16 base and merging the official MNTP adapter...", flush=True)
    base = LlamaBiModel.from_pretrained(
        base_path,
        local_files_only=True,
        dtype=torch.bfloat16,
        device_map={"": "cuda:0"},
        low_cpu_mem_usage=True,
    )
    mntp_model = PeftModel.from_pretrained(base, mntp_path)
    merged = mntp_model.merge_and_unload(safe_merge=True)
    merged.config._name_or_path = CANONICAL_BASE
    MERGED_ROOT.mkdir(parents=True)
    merged.save_pretrained(MERGED_ROOT, safe_serialization=True, max_shard_size="4GB")

    print("Computing a bf16 reference embedding with the supervised adapter...", flush=True)
    supervised_bf16 = PeftModel.from_pretrained(merged, supervised_path)
    reference = encode_one(supervised_bf16, tokenizer)
    del supervised_bf16, merged, mntp_model, base
    gc.collect()
    torch.cuda.empty_cache()

    quant_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=torch.bfloat16,
    )
    print("Quantizing merged MNTP base to 4-bit NF4...", flush=True)
    quantized = LlamaBiModel.from_pretrained(
        MERGED_ROOT,
        local_files_only=True,
        quantization_config=quant_config,
        dtype=torch.bfloat16,
        device_map={"": "cuda:0"},
        low_cpu_mem_usage=True,
    )
    (STAGE_ROOT / "base").mkdir(parents=True)
    quantized.save_pretrained(STAGE_ROOT / "base", safe_serialization=True, max_shard_size="4GB")
    tokenizer.save_pretrained(STAGE_ROOT / "tokenizer")
    supervised_out = STAGE_ROOT / "adapters" / "supervised"
    supervised_out.mkdir(parents=True)
    for name in ("adapter_config.json", "adapter_model.safetensors"):
        shutil.copy2(supervised_path / name, supervised_out / name)
    for name in ("LICENSE", "USE_POLICY.md"):
        source = base_path / name
        if source.is_file():
            shutil.copy2(source, STAGE_ROOT / name)
    (STAGE_ROOT / "llm2vec_config.json").write_text(
        json.dumps(
            {"pooling_mode": "mean", "max_length": 512, "doc_max_length": 400, "skip_instruction": True},
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    del quantized
    gc.collect()
    torch.cuda.empty_cache()

    print("Cold-reloading the saved 4-bit artifact for verification...", flush=True)
    reloaded = LlamaBiModel.from_pretrained(
        STAGE_ROOT / "base",
        local_files_only=True,
        dtype=torch.bfloat16,
        device_map={"": "cuda:0"},
        low_cpu_mem_usage=True,
    )
    reloaded = PeftModel.from_pretrained(reloaded, supervised_out)
    tokenizer_reloaded = AutoTokenizer.from_pretrained(STAGE_ROOT / "tokenizer", local_files_only=True)
    tokenizer_reloaded.pad_token = tokenizer_reloaded.eos_token
    tokenizer_reloaded.padding_side = "left"
    quantized_embedding = encode_one(reloaded, tokenizer_reloaded)
    cosine = float(np.dot(reference, quantized_embedding) / (np.linalg.norm(reference) * np.linalg.norm(quantized_embedding)))
    if not math.isfinite(cosine) or cosine < 0.95:
        raise RuntimeError(f"4-bit verification cosine was too low: {cosine:.6f}")

    manifest = {
        "ready": True,
        "createdAt": time.time(),
        "format": "bitsandbytes-nf4-double-quant",
        "computeDtype": "bfloat16",
        "embeddingWidth": 4096,
        "base": {"canonical": CANONICAL_BASE, "mirror": BASE_REPO, "revision": base_revision},
        "mntp": {"repo": MNTP_REPO, "revision": mntp_revision, "mergedIntoBase": True},
        "supervised": {"repo": SUPERVISED_REPO, "revision": supervised_revision, "mergedIntoBase": False},
        "verification": {"text": TEST_TEXT, "cosineVsBf16": cosine, "norm": float(np.linalg.norm(quantized_embedding))},
    }
    (STAGE_ROOT / "READY.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    del reloaded
    gc.collect()
    torch.cuda.empty_cache()

    STAGE_ROOT.replace(FINAL_ROOT)
    cleanup = {
        "buildRoot": str(BUILD_ROOT.resolve()),
        "cacheRoots": sorted(
            {
                str(base_path.parents[1].resolve()),
                str((Path.home() / ".cache" / "huggingface" / "hub" / "models--McGill-NLP--LLM2Vec-Meta-Llama-3-8B-Instruct-mntp").resolve()),
                str((Path.home() / ".cache" / "huggingface" / "hub" / "models--McGill-NLP--LLM2Vec-Meta-Llama-3-8B-Instruct-mntp-supervised").resolve()),
            }
        ),
    }
    (FINAL_ROOT / "CLEANUP.json").write_text(json.dumps(cleanup, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "artifact": str(FINAL_ROOT), "cosine": cosine, "cleanup": cleanup}, indent=2), flush=True)


if __name__ == "__main__":
    main()
