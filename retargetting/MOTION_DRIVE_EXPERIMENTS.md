# Motion Drive experiment history

This ledger records the approaches tried while integrating ARDY, Kimodo, and direct VRM playback. It exists so a working idea is not lost when a later experiment regresses quality. Dates are the actual development dates; individual entries are ordered chronologically within the day.

## 2026-08-22

### Baseline model integration

- Loaded ARDY Core-27 Horizon-8 and Kimodo SOMA-77 as persistent local workers.
- Confirmed both models can generate root-path-constrained motion without text encoders.
- Added the official project meshes, direct VRM loading, video export, route visualization, and interactive ARDY controls.
- Result: solid foundation. Persistent workers and direct mesh/VRM playback remain the preferred architecture.

### Quantized text conditioning

- Built a local 4-bit LLM2Vec text encoder and a disk-backed 4,096-value embedding cache.
- Shared cached embeddings between batch and live requests.
- Result: encoder outputs are nonzero and prompt-dependent. Same-seed `walk naturally` and `crouch walk` generations differ substantially, so the encoder/cache is not the prompt-adherence bottleneck.

### Timed text: independent clips plus client blending

- Generated one clip per prompt interval and blended decoded vertices/joints at cue boundaries.
- Result: rejected. Root coordinates and body states were not in a shared autoregressive history, producing noisy changes and occasional origin resets.

### Timed text: repeated live horizons

- Reused the live endpoint horizon generator and changed embeddings at cue times.
- Result: better than decoded clip blending and proved the right general direction, but history was shortened abruptly and constraints were expressed inconsistently between client-relative and model-global coordinates. Multiple cue changes could jump or ignore prompts.

### Timed text: custom inpaint bridge

- Generated independent intervals, saved their feature tensors, and asked ARDY to inpaint a short pose/root bridge.
- Result: rejected. This did not match ARDY's intended timeline-replan architecture and caused severe clipping/origin behavior.

### Timed text: native autoregressive replan

- Reimplemented the official demo pattern around `Ardy.autoregressive_step()`:
  - one continuous normalized `motion_tensor`;
  - token-aligned cropped history;
  - future root/heading constraint windows;
  - prompt embedding selected per horizon;
  - official motion correction and re-encoding before corrected frames become future history.
- Result: current best batch architecture. Motion correction eliminated alternating origin resets. Prompt response improves with shorter history.

### Prompt tuning

- Exposed text CFG as **Prompt strength** and history crop as **Prompt memory**.
- Current defaults: prompt strength `3.0`, prompt memory `1.6 s`.
- Result: more responsive than the earlier hard-coded text weight `2.0` and history `4.0 s`. Higher memory is smoother but slower to adopt a new prompt; lower memory reacts faster but can be abrupt.

### Live root control

- Initial velocity extrapolation carried momentum after input release.
- Full-frame root pinning stopped drift but made motion rigid.
- Current approach:
  - short command-space acceleration/deceleration ramp;
  - full-frame root pin only while truly idle;
  - three root anchors while moving (first, midpoint, endpoint);
  - official correction/re-encoding before reuse as history.
- Result: current candidate. Input and idle position are correct; visual quality still needs systematic tuning.

### Official interactive-controller audit

- Re-read NVIDIA's interactive demo, constraint generator, batch script, paper, and project page, then compared them with successful public integrations.
- Primary references: [NVIDIA ARDY repository](https://github.com/nv-tlabs/ardy), [interactive generation loop](https://github.com/nv-tlabs/ardy/blob/main/scripts/interactive_demo/generation.py), [target-velocity constraints](https://github.com/nv-tlabs/ardy/blob/main/scripts/interactive_demo/gen_constraints.py), and [ARDY paper](https://arxiv.org/html/2607.08741).
- Public integration references: [Text-To-VRMA](https://github.com/Kirakun0328/text-to-vrma), [CozyClay](https://github.com/HaD0Yun/CozyClay), and the Hugging Face ARDY demo's continue-from-previous-motion implementation.
- The official controller does not densely pin the next short generation horizon. It:
  - derives history from the frame actually being played;
  - keeps a small already-generated replan buffer;
  - replaces only generated-but-unplayed future motion;
  - projects commanded velocity two seconds ahead;
  - applies sparse root goals every 10 frames; and
  - lets constraints extend beyond the immediately decoded generation horizon.
- The paper's ablation explains an important model split: Horizon-8 reacts faster to changed instructions, while Horizon-40 has substantially better motion/text fidelity. The published interactive demo uses a 40-frame generation window.
- Result: the earlier three-anchor live controller was fighting the model. Replaced it with the official playback-aware, sparse-lookahead structure.

### Live playback and latency

- Replaced whole-horizon queue playback with one absolute playback timeline. Each replan now carries a `replaceFromFrame`; the browser discards only overlapping unplayed future frames.
- Measured end-to-end request and mesh-fetch latency and dynamically reserves 1-6 buffer frames. Replans trigger before the viewer consumes that reserve; input changes request an immediate replan.
- Added renderer-side interpolation between ARDY's 20 fps frames. Mesh vertices, root/joint positions, and head rotations now update smoothly at display refresh rate without altering model output.
- Added optional camera following that eases toward a point between the character and its two-second live goal.
- Result: responsive controls no longer advance the target without input, playback does not restart at origin during replans, and display motion is less rigid.

### Seam-blending experiment

- Tested quaternion crossfades over the first 2-3 generated frames.
- The crossfade reduced the first seam displacement, but moved the discontinuity later in the horizon and worsened peak step/velocity metrics.
- Result: rejected and removed from the production path. Preserve ARDY's generated rotations and improve continuity through correct history/replan timing instead.

### Horizon and resource matrix

- Core-8 sustained-forward test: about 2.05 m travel, roughly 0.067 s mean generation, and about 0.168 m worst measured joint seam step.
- Core-40 sustained-forward test: about 1.94 m travel and about 0.026 m worst measured joint seam step in that run.
- Core-40 forward/turn/stop test: about 0.086 s mean generation, 0.040 m maximum root seam step, and 0.134 m maximum joint seam step.
- Final architecture keeps two persistent ARDY workers: Core-8 for batch/timed prompts and Core-40 for live control. Kimodo remains a separate persistent worker.
- Peak observed with both ARDY workers resident: 31% system RAM, 4,556 MiB VRAM (about 18.5%), and 77 W in the sampled test. This stayed well below the requested 50% RAM and 50% VRAM limits.
- Result: use Core-40 live with four denoising steps, eight history frames, a one-second steering blend, sparse ten-frame goals, and a latency-sized replan buffer. Keep Core-8 for batch/timed text because it adopts prompt changes faster.

### VRM retargeting and physics

- Directly loaded local VRMs without requiring VNyan.
- Calibrated Core-27 to VRM normalized bones and corrected rest-basis, limb, hip, head, and root-height mapping.
- Added skirt safety, accessory calming, and adjustable hair weight.
- Result: Zome VRM 0 is the current reference avatar. Retargeting is usable; spring behavior remains avatar-specific.

### Zome torso-facing correction

- The original direction-only bone solve applied ARDY body facing to the hips,
  then solved the nearly vertical spine from its unrotated rest direction. Since
  a vertical segment carries no yaw/twist information, the spine could cancel a
  180-degree hips turn immediately and pull back-mounted accessories through the
  front of the torso.
- Every driven bone now inherits the mapped body-facing rotation first. Its
  joint direction contributes only the remaining swing correction.
- Applied to both the normalized Three-VRM path and the raw-bone fallback.

## Rules for future experiments

1. Preserve one continuous normalized ARDY motion tensor. Do not stitch decoded meshes or joint arrays to change prompts.
2. Keep history and constraint windows token aligned (the ARDY checkpoints use 4-frame patches at 20 fps; Core-8 generates 8 new frames and Core-40 generates 40).
3. Apply the official motion-correction and re-encoding step before corrected frames become subsequent history.
4. Judge a change with both numeric continuity checks and visual playback. Successful file generation alone is not a quality test.
5. Change one parameter at a time and record prompt, seed, route, history, CFG weights, steps, RAM, VRAM, and outcome.
6. Keep system RAM below 40 GiB used and GPU VRAM below 12 GiB used during unattended tests.
