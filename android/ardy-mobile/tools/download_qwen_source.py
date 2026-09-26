"""Fetch only the pinned Qwen source weights and tokenizer into the build workspace."""
import argparse
import json
from pathlib import Path
from huggingface_hub import snapshot_download

p=argparse.ArgumentParser(description=__doc__);p.add_argument('--work-dir',type=Path,required=True);p.add_argument('--profile',type=Path,required=True)
a=p.parse_args();config=json.loads(a.profile.read_text(encoding='utf-8'))
target=a.work_dir/'source'/config['sourceRevision']
snapshot_download(config['sourceModel'],revision=config['sourceRevision'],local_dir=target,
                  allow_patterns=['*.json','*.safetensors','*.jinja','*.txt'],max_workers=2)
print('Pinned source downloaded to',target)
