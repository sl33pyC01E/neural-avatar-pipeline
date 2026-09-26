# Ardy contract corrections — 0.4.2

The recovered APK is a useful historical reference, but it contains sampling
shortcuts that are also present in the initial restored sampler. The authoritative
reference for these fixes is the checked-in Ardy model implementation.

| Contract | Earlier mobile behavior | Corrected behavior / reference |
| --- | --- | --- |
| Future constraint tokens | Every unused future slot was visible to attention | Only tokens containing actual observations are valid. With the current generation-horizon root controls there are no future observations, so these slots are masked out. `ardy/ardy/model/latent_utils.py:convert_frame_mask_to_token_mask`. |
| Cropped history heading | Always zero | Uses the unnormalized cosine/sine heading of the first retained frame. `ardy_model.py:generate`, history-cropping update. |
| Discrete latent history | Continuous denoiser estimates reused directly | Unnormalize, clamp, round to the decoder's FSQ lattice with ties-to-even, normalize again before reuse. `ardy_model.py:_recenter_history` and `autoencoder/fsq.py:requantize`. |
| Decoder padding | Padded zero latents marked as valid motion | Exact history/generation validity mask. The last real root velocity repeats the preceding real velocity, rather than becoming zero because the root was padded. `latent_utils.py:get_explicit_motion_from_hybrid_autoregressive` and `motion_rep/tools.py`. |

The decoder advertises symbolic input dimensions but its attention Reshape embeds
the export's fixed token count. A real CPU invocation with shorter tensors exposed
this. Keep the fixed-size tensors, supply the correct validity mask, and construct
local-root velocities from only the valid frames. No model weights were modified.

`tools/prepare_ardy_contract.py` extracts the 128-dimensional FSQ mean, scale and
half-width from the exact hash-pinned Core-8/Core-40 decoder graphs. It checks the
audited graph prefix and fails if a different decoder is supplied. The small JSON
assets are tracked separately from the unchanged APK recovery snapshot.

Checkpoint magic changes from ARD1 to ARD2. The old history is rejected and starts
fresh; old files are not deleted. Subsequent ARD2 checkpoint resumes reproduce
the next horizon exactly. Frame/token alignment, 4096-wide cached embeddings,
DDIM schedule, four denoising steps, root X/Z recentering and retargeter are retained.
The current app deliberately requests unconstrained body motion; it does not claim
to support a route/heading constraint UI. The optional sampler endpoint constraint
uses full 330-feature normalized observed-motion values and feature masks, with
heading represented as cosine/sine, not a raw angle or a root-only tensor.

The one-horizon 0.72 text-conditioning crossfade is a recovered mobile behavior,
not an upstream guarantee. It remains unchanged; evaluate transitions separately.
The renderer's procedural head overlay and retarget tuning are separate from the
model contract fixes.

`validation/ardy-contract-cpu-2026-09-26.json` records real-model checks through
nine horizons for both profiles, including actual ORT input inspection, history
eviction, FSQ lattice membership, heading, masks, final velocity, finite rotations,
bone lengths, seeded reset and exact saved-state continuation. These checks do not
establish perceptual motion quality or phone latency. The user judges the motion.
