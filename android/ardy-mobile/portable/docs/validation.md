# Validation and known limits

The user authorizes installation but performs phone tests. This checkpoint was not launched or benchmarked on the phone by the agent.

Host checks cover Java tool-schema/trajectory/prompt-cache contracts, incremental speaker-prefix handling, quaternion interpolation, seam blending, navigation bounds, APK model/runtime hashes and JNI callbacks. A CPU-rendered browser check exercises the actual avatar UI, saved-pose capture/reopen/replay, pacing, module layouts, startup failure/cancellation and direct-camera bridge. Its native model events are fixtures, not inference. Reports live in `project/validation`.

## Memory investigation

Passive Android exit history recorded a LOW_MEMORY exit for `:models` on 2026-09-27. The last receipt was E2B, 4096 context, 70 visual tokens, GPU encoding and Hexagon decoding. The native log showed all 36 language layers offloaded to HTP and OpenCL modality encoding; it had generated replies before being killed. The small KV allocation (~33 MiB) means lowering context alone does not address all resident weights, encoders and driver buffers.

Face mode previously warmed an Ardy denoiser/decoder unnecessarily. This build skips those sessions for Face and full cached body replay, reducing avoidable pressure. The actual phone OOM outcome remains unverified. Process PSS does not include all accelerator memory. Raw logs/process lists/user conversation text were excluded from the handoff.

## UI and animation

Main viewport sizing no longer follows expanding response/status/session content. Neutral eye height is captured once, and camera tracking uses a stable floor anchor with smoothing. Explicit frame changes clear the previous take's follow offset and tracking mode, so Face does not drift back from an earlier body trajectory. Reversible head/idle offsets are removed before resetting the base pose. The camera button directly invokes capture; attachments are in Settings. Idle/LAM/Ardy yaw layering and the new camera/pose controls pass host contracts, but visual comfort and retarget quality remain user judgments on the phone.

## Model scope

The MiniCPM experiment was discarded before installation at the user's request. Its APK, source module, native worker and large model/conversion files are excluded. Cleopatra retains Gemma E2B/E4B with Pocket, LAM and Ardy; no alternative omni stack is installed by this handoff.
