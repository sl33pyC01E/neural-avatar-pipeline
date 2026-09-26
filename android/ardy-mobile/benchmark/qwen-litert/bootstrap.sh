#!/usr/bin/env bash
set -euo pipefail
cd /work
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends git ca-certificates build-essential pkg-config libgl1 libglib2.0-0
if [ ! -d converter/.git ]; then
  git clone https://github.com/john-rocky/hf-to-litertlm.git converter
fi
git -C converter checkout --detach e77865e8b2ecd33efc70aba7c44e77c58959fdde
if [ ! -d litert-torch/.git ]; then
  git init litert-torch
  git -C litert-torch remote add origin https://github.com/john-rocky/litert-torch.git
fi
git -C litert-torch fetch --depth 1 origin 115a13607c730c81018bb9789138a3e5e5119e3d
git -C litert-torch checkout --detach 115a13607c730c81018bb9789138a3e5e5119e3d
if ! git -C litert-torch apply --reverse --check /work/converter/qwen35_work/qwen35_hybrid_litert_torch.patch; then
  git -C litert-torch apply --check /work/converter/qwen35_work/qwen35_hybrid_litert_torch.patch
  git -C litert-torch apply /work/converter/qwen35_work/qwen35_hybrid_litert_torch.patch
fi
python -m venv /work/venv
/work/venv/bin/python -m pip install --upgrade pip
/work/venv/bin/python -m pip install --no-compile torch==2.12.1 torchvision==0.27.1 --index-url https://download.pytorch.org/whl/cpu
/work/venv/bin/python -m pip install --no-compile --requirement /work/build-requirements.lock
/work/venv/bin/python -m pip freeze > /work/installed-requirements.lock
