# Third-party notices, attribution, and citations

Neural Avatar Pipeline is an integration layer. Upstream names, code, models,
data, voices, and artwork remain the property of their respective authors and
are governed by their own terms. This notice provides attribution; it does not
transfer ownership or imply upstream endorsement.

The Git source checkout does **not** distribute model weights, Python or Node
environments, CUDA libraries, voice assets, generated media, or a VRM avatar.
Those files may exist in a private local bundle and must not be redistributed
without independently confirming the applicable terms.

## Default pipeline components

| Component | Use | Upstream and attribution | License or model terms |
| --- | --- | --- | --- |
| ARDY | Core-8 batch and Core-40 live body-motion generation | NVIDIA Toronto AI Lab, [`nv-tlabs/ardy`](https://github.com/nv-tlabs/ardy) | Code: [Apache-2.0](ardy/LICENSE). Checkpoints: [Horizon 8](https://huggingface.co/nvidia/ARDY-Core-RP-20FPS-Horizon8) and [Horizon 40](https://huggingface.co/nvidia/ARDY-Core-RP-20FPS-Horizon40), under the [NVIDIA Open Model Agreement](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-agreement/). |
| LLM2Vec | Quantized ARDY text conditioning and permanent prompt embeddings | Parishad BehnamGhader, Vaibhav Adlakha, Marius Mosbach, Dzmitry Bahdanau, Nicolas Chapados, and Siva Reddy; [`McGill-NLP/llm2vec`](https://github.com/McGill-NLP/llm2vec) | Upstream portions: MIT. Vendored and transitive notices, including the Unitree asset notice, are preserved in [`ardy/ATTRIBUTIONS.MD`](ardy/ATTRIBUTIONS.MD). The underlying gated Meta Llama model has separate Meta terms. |
| PocketTTS 2.1.0 | CUDA speech synthesis with the `anna` preset | Kyutai, [`kyutai-labs/pocket-tts`](https://github.com/kyutai-labs/pocket-tts) | Code: MIT. Local no-cloning model: [CC BY 4.0 model card](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning). The Anna preset is linked from Kyutai's [voice catalog](https://huggingface.co/kyutai/tts-voices/blob/main/vctk/p228_023_enhanced.wav); voice assets and generated uses remain subject to their source terms. |
| LAM Audio2Expression | Streaming audio-to-ARKit facial-expression inference | 3D AIGC / `aigc3d`, [`aigc3d/LAM_Audio2Expression`](https://github.com/aigc3d/LAM_Audio2Expression), pinned local revision `02a703c` | Code and [model card](https://huggingface.co/3DAIGC/LAM_audio2exp): Apache-2.0. |
| three.js | WebGL character rendering | Copyright © 2010–2026 three.js authors, [`mrdoob/three.js`](https://github.com/mrdoob/three.js) | [MIT](https://github.com/mrdoob/three.js/blob/dev/LICENSE). Exact installed versions are recorded in the package lockfiles. |
| `@pixiv/three-vrm` | VRM loading, expressions, humanoid bones, and spring-bone playback | pixiv Inc., [`pixiv/three-vrm`](https://github.com/pixiv/three-vrm) | [MIT](https://github.com/pixiv/three-vrm/blob/dev/LICENSE). Exact installed versions are recorded in the package lockfiles. |

## Additional retained source

The repository retains standalone diagnostic and historical body-motion tools
for [NVIDIA Kimodo](https://github.com/nv-tlabs/kimodo) (Apache-2.0 code; model
weights use NVIDIA's model-specific terms),
[EMAGE](https://github.com/PantoMatrix/EMAGE), and
[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0). They are
not launched by the default pipeline, and their upstream code or weights are not
included in the Git source checkout.

The facial comparison engines removed from `master` are preserved in Git history
on the `raw` branch. They are not present in or dependencies of the default
pipeline. That branch contains the notices applicable to its own contents.

## VRM avatar exclusion

`vnyan/Zome.vrm` is explicitly ignored and is not distributed in this
repository. The local launcher uses that path as the default convention for a
user-supplied, appropriately licensed avatar. This project grants no license or
redistribution right for Zome or any replacement VRM.

## Research citations

Please cite the upstream research when publishing work that uses the relevant
model. The entries below follow the authors' project or model pages.

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

### PocketTTS / Continuous Audio Language Models

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
Python environments are excluded from Git; their installed metadata and license
files remain within the private local bundle. Every transitive package retains
its own copyright and license notices.
