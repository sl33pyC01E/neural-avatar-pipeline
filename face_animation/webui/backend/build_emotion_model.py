from __future__ import annotations

import json
import shutil
from pathlib import Path

import torch
from huggingface_hub import snapshot_download
from onnxruntime.quantization import QuantType, quantize_dynamic
from transformers import AutoModelForSequenceClassification, AutoTokenizer


REPOSITORY = "j-hartmann/emotion-english-distilroberta-base"
REVISION = "0e1cd914e3d46199ed785853e12b57304e04178b"
ROOT = Path(__file__).resolve().parents[3]
TARGET = ROOT / "models" / "sentiment" / "emotion-english-distilroberta-base"
SOURCE = TARGET / "source"
ONNX_MODEL = TARGET / "model.onnx"
QUANTIZED_MODEL = TARGET / "model.int8.onnx"
TOKENIZER_FILES = (
    "config.json",
    "merges.txt",
    "special_tokens_map.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.json",
)


class LogitsOnly(torch.nn.Module):
    def __init__(self, model: torch.nn.Module) -> None:
        super().__init__()
        self.model = model

    def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
        return self.model(input_ids=input_ids, attention_mask=attention_mask).logits


def main() -> None:
    TARGET.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=REPOSITORY,
        revision=REVISION,
        local_dir=SOURCE,
        allow_patterns=[*TOKENIZER_FILES, "pytorch_model.bin"],
    )
    tokenizer = AutoTokenizer.from_pretrained(SOURCE, local_files_only=True)
    model = AutoModelForSequenceClassification.from_pretrained(SOURCE, local_files_only=True)
    model.eval()
    encoded = tokenizer("A compact local emotion classifier.", return_tensors="pt")
    wrapped = LogitsOnly(model)
    with torch.inference_mode():
        torch.onnx.export(
            wrapped,
            (encoded["input_ids"], encoded["attention_mask"]),
            ONNX_MODEL,
            input_names=["input_ids", "attention_mask"],
            output_names=["logits"],
            dynamic_axes={
                "input_ids": {0: "batch", 1: "sequence"},
                "attention_mask": {0: "batch", 1: "sequence"},
                "logits": {0: "batch"},
            },
            opset_version=17,
            dynamo=False,
        )
    quantize_dynamic(ONNX_MODEL, QUANTIZED_MODEL, weight_type=QuantType.QInt8, per_channel=True)
    for filename in TOKENIZER_FILES:
        shutil.copy2(SOURCE / filename, TARGET / filename)
    labels = {str(index): label for index, label in model.config.id2label.items()}
    (TARGET / "MODEL_INFO.json").write_text(json.dumps({
        "repository": REPOSITORY,
        "revision": REVISION,
        "format": "ONNX dynamic INT8",
        "labels": labels,
    }, indent=2) + "\n", encoding="utf-8")
    ONNX_MODEL.unlink(missing_ok=True)
    shutil.rmtree(SOURCE)
    print(QUANTIZED_MODEL)


if __name__ == "__main__":
    main()
