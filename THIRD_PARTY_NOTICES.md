# Third-party notices, attribution, and citations

Unified Character Lab is an integration layer. The names, code, models, data,
voices, and artwork listed below remain the property of their respective
authors and are governed by their own terms. Inclusion here is attribution, not
an endorsement by or transfer of ownership from an upstream project.

The GitHub source checkout does **not** distribute model weights, Python or
Node environments, CUDA/TensorRT binaries, voice assets, or a VRM avatar. Those
items may exist in a local portable build, remain subject to their upstream
terms, and must not be redistributed without confirming those terms.

## Primary components

| Component | Use in this lab | Upstream and attribution | License or model terms |
| --- | --- | --- | --- |
| ARDY | Core-8 batch and Core-40 live body-motion generation | NVIDIA Toronto AI Lab, [nv-tlabs/ardy](https://github.com/nv-tlabs/ardy) | Code: [Apache-2.0](ardy/LICENSE). Checkpoints: [Horizon 8](https://huggingface.co/nvidia/ARDY-Core-RP-20FPS-Horizon8) and [Horizon 40](https://huggingface.co/nvidia/ARDY-Core-RP-20FPS-Horizon40), each under the [NVIDIA Open Model Agreement](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-agreement/). |
| LLM2Vec | ARDY text conditioning and the local quantized encoder | Parishad BehnamGhader, Vaibhav Adlakha, Marius Mosbach, Dzmitry Bahdanau, Nicolas Chapados, and Siva Reddy; [McGill-NLP/llm2vec](https://github.com/McGill-NLP/llm2vec) | MIT for the upstream portions. The vendored notices and Unitree asset notice are preserved in [`ardy/ATTRIBUTIONS.MD`](ardy/ATTRIBUTIONS.MD); NVIDIA modifications carry their file-level Apache-2.0 notices. The underlying gated Meta Llama model has separate Meta terms. |
| Pocket TTS 2.1.0 | CUDA speech synthesis with the `anna` preset | Kyutai; [kyutai-labs/pocket-tts](https://github.com/kyutai-labs/pocket-tts) | Code: MIT. Local no-cloning model: [CC BY 4.0 model card](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning). The `anna` preset is linked from Kyutai's [voice catalog](https://huggingface.co/kyutai/tts-voices/blob/main/vctk/p228_023_enhanced.wav); voice assets and generated uses remain subject to the catalog/source-dataset terms. |
| Audio2Face-3D SDK | Native CUDA/TensorRT audio-to-face inference and Claire solver | Copyright © 2025 NVIDIA Corporation; [NVIDIA/Audio2Face-3D-SDK](https://github.com/NVIDIA/Audio2Face-3D-SDK) | SDK code: MIT. Audio2Face-3D v3.0 weights and model assets: [NVIDIA Open Model License](https://huggingface.co/nvidia/Audio2Face-3D-v3.0). |
| LAM Audio2Expression | Streaming audio-to-ARKit facial expression inference | 3D AIGC / `aigc3d`; [aigc3d/LAM_Audio2Expression](https://github.com/aigc3d/LAM_Audio2Expression), local pinned revision `02a703c` | Code and [model card](https://huggingface.co/3DAIGC/LAM_audio2exp): Apache-2.0. |
| NyxClaw / Wav2Arkit | CPU ONNX audio-to-52-ARKit driver | Copyright © 2025 Myned AI; [myned-ai/nyxclaw](https://github.com/myned-ai/nyxclaw), local pinned revision `fa5088e` | NyxClaw code: MIT. [Wav2Arkit CPU model](https://huggingface.co/myned-ai/wav2arkit_cpu): Apache-2.0. |
| uLipSync | MFCC lip-sync algorithm and female calibration profile used by the Python adapter | Copyright © 2021 hecomi; [hecomi/uLipSync](https://github.com/hecomi/uLipSync), local pinned revision `0605879` | [MIT](https://github.com/hecomi/uLipSync/blob/main/LICENSE.md). Any Unity-Chan sample artwork has its own asset terms and is not included in the GitHub source checkout. |
| three.js | WebGL rendering | Copyright © 2010–2026 three.js authors; [mrdoob/three.js](https://github.com/mrdoob/three.js) | [MIT](https://github.com/mrdoob/three.js/blob/dev/LICENSE). Locked versions: 0.165.0 and 0.185.1. |
| `@pixiv/three-vrm` | VRM loading, expressions, humanoid bones, and spring-bone playback | pixiv Inc.; [pixiv/three-vrm](https://github.com/pixiv/three-vrm) | [MIT](https://github.com/pixiv/three-vrm/blob/dev/LICENSE). Locked versions: 3.5.3 and 3.5.5. |

The Audio2Face integration also carries small custom bridge code in
`face_animation/integrations/audio2face/`; the upstream SDK and model retain
the terms above. The derived Claire preview asset at
`face_animation/assets/project_examples/audio2face-claire-points.glb` carries
the required notice: **Licensed by NVIDIA Corporation under the NVIDIA Open
Model License.** `face_animation/DEPENDENCIES.md` records the exact locally
copied upstream revisions.

The Python uLipSync adapter implements the algorithm described by the upstream
MIT-licensed project. Its applicable notice is:

> Copyright (c) 2021 hecomi
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

## Secondary and legacy adapters

The repository retains inactive diagnostic or legacy adapters for
[NVIDIA Kimodo](https://github.com/nv-tlabs/kimodo) (Apache-2.0 code; model
weights use NVIDIA's model-specific terms),
[EMAGE](https://github.com/PantoMatrix/EMAGE), and
[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0). These
adapters are not part of normal Unified Lab startup, and their upstream code or
weights are not distributed in the GitHub source checkout.

## VRM avatar exclusion

`vnyan/Zome.vrm` is explicitly ignored and is not distributed in this
repository. The local launcher currently expects a user-supplied, appropriately
licensed avatar at that path. No license or redistribution right for Zome—or
for any replacement VRM—is granted by this project.

## Research citations

Please cite the upstream research when publishing work that uses the relevant
model. These entries are reproduced from the authors' official project or
model pages.

### ARDY

```bibtex
@article{zhao2026ardy,
  title     = {ARDY: Autoregressive Diffusion with Hybrid Representation for Interactive Human Motion Generation},
  author    = {Zhao, Kaifeng and Petrovich, Mathis and Zhang, Haotian and Wang, Tingwu and Tang, Siyu and Rempe, Davis},
  journal   = {ACM Transactions on Graphics (TOG)},
  year      = {2026},
  volume    = {45},
  number    = {4},
  articleno = {86},
  doi       = {10.1145/3811284}
}
```

### Audio2Face-3D

```bibtex
@misc{nvidia2025audio2face3d,
  title         = {Audio2Face-3D: Audio-driven Realistic Facial Animation For Digital Avatars},
  author        = {Chaeyeon Chung and Ilya Fedorov and Michael Huang and Aleksey Karmanov and Dmitry Korobchenko and Roger Ribera and Yeongho Seol},
  year          = {2025},
  eprint        = {2508.16401},
  archivePrefix = {arXiv},
  primaryClass  = {cs.GR},
  url           = {https://arxiv.org/abs/2508.16401},
  note          = {Authors listed in alphabetical order}
}
```

### LAM

```bibtex
@inproceedings{he2025lam,
  title     = {LAM: Large Avatar Model for One-shot Animatable Gaussian Head},
  author    = {Yisheng He and Xiaodong Gu and Xiaodan Ye and Chao Xu and Zhengyi Zhao and Yuan Dong and Weihao Yuan and Zilong Dong and Liefeng Bo},
  booktitle = {arXiv preprint arXiv:2502.17796},
  year      = {2025}
}
```

### LLM2Vec

```bibtex
@inproceedings{llm2vec,
  title     = {{LLM2V}ec: Large Language Models Are Secretly Powerful Text Encoders},
  author    = {Parishad BehnamGhader and Vaibhav Adlakha and Marius Mosbach and Dzmitry Bahdanau and Nicolas Chapados and Siva Reddy},
  booktitle = {First Conference on Language Modeling},
  year      = {2024},
  url       = {https://openreview.net/forum?id=IW1PR7vEBf}
}
```

### Pocket TTS / Continuous Audio Language Models

```bibtex
@article{rouard2025continuous,
  title   = {Continuous Audio Language Models},
  author  = {Simon Rouard and Manu Orsini and Axel Roebel and Neil Zeghidour and Alexandre D\'{e}fossez},
  journal = {arXiv preprint arXiv:2509.06926},
  year    = {2025},
  doi     = {10.48550/arXiv.2509.06926},
  url     = {https://arxiv.org/abs/2509.06926}
}
```

## Transitive dependencies

`retargetting/package-lock.json` and `face_animation/webui/package-lock.json`
record exact JavaScript dependency versions and SPDX license identifiers.
Python environments are excluded from Git; their installed `.dist-info`
metadata and license files remain inside the local portable build. Every
transitive package retains its own license and copyright notices.
