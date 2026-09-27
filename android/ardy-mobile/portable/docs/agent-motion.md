# Agent motion and camera API

These controls belong to the agent. Main remains a conversation viewport with Face/Torso/Body framing. Debug → Ardy → Stage is an inspector for capture/trim/playback, not the primary interaction design.

Main declares an optional `act` tool. Gemma calls it before its spoken text. The app supplies APP SCENE with the active frame, pose-track IDs, camera/root/steering state and available cached embedding keys. Always use the actual declared enums and track IDs; do not invent them.

| Control | Meaning |
| --- | --- |
| `root: {x,z,heading}` | Foot/floor anchor in meters; whole-body yaw in degrees |
| `steering: {torso_yaw,head_yaw,head_reference}` | Independent upper torso/head yaw offsets; head reference `body` or `camera` |
| `camera_mode` | `orbit`, `trail`, `interviewer`, `stage`, `free`; Body only |
| `camera` | Yaw/elevation, distance, height and pan; Torso only allows distance 1.05–1.65 m |
| `gesture` | Existing cached text-embedding key for Ardy |
| `motion: {core,strategy,batch_seconds,trajectory,gestures}` | Choose core and generation schedule |
| `save_track: {name,seconds,blend,stride}` | Capture a Body Ardy take for later replay |
| `locomotion: {action,track,layer,...}` | Play, walk to a target, pace, or stop a saved track |
| `schedule` | Timed root/camera/steering/face/expression cues on the shared body/audio clock |

Face permits facial controls and head steering only. Torso permits gestures with a locked root. Body permits root trajectories, locomotion, camera modes and pose capture. Native validation rejects prohibited combinations and out-of-range inputs even after prompt edits.

Example Body take (gesture names must be substituted from the declared catalog):

```json
{
  "camera_mode": "trail",
  "steering": {"head_reference":"camera", "head_yaw":0},
  "motion": {
    "core":"core8", "strategy":"batch", "batch_seconds":6,
    "trajectory":[
      {"at_seconds":0,"x":0,"z":0,"heading":0},
      {"at_seconds":4,"x":1,"z":0,"heading":90}
    ]
  },
  "save_track":{"name":"Walk candidate","seconds":6,"blend":0.2,"stride":1}
}
```

Core8 and Core40 are both usable in batch or live mode. Defaults are Core8 for batch and Core40 for live. Batch prebuffers 2–20 seconds before starting the performance, then extends if speech exceeds the prepared span. Trajectory coordinates are relative to the current floor anchor; first point is at time zero, later times strictly increase. Smooth interpolation supplies actual sampler constraints while preserving normalization/context history.

Gesture embedding changes apply at generated horizon boundaries: Core8 ≈0.4 s, Core40 ≈2 s. They are not sample-accurate switches. Camera/face cues use playback time. Controls already issued for a spoken turn are not edited mid-generation; the next APP SCENE permits feedback steering between turns.

## Pose-library workflow

1. Generate a candidate Ardy Body take and capture it with `save_track` (maximum 12 s). Confirm its ID appears in the later APP SCENE; a scheduled capture is not a completed save.
2. Use a clean complete gait cycle. Trim start/end and choose seam blend/stride; trim metadata preserves the original poses. The Debug inspector is available for diagnosis.
3. `locomotion` with `layer:"full"` replays saved body poses without Ardy inference. `layer:"lower"` preserves hips/spine/legs/feet while Ardy drives chest/arms/head, then LAM drives the face.
4. `walk_to` supplies x/z; `pace` supplies width and speed. The navigator accelerates/decelerates and limits turning. Root targets are bounded to ±3 m. Do not combine cached locomotion with a live root trajectory or scheduled root placement.

Clips use normalized VRM bone poses, shortest-path quaternion interpolation and seam blending. They are stored in IndexedDB with avatar provenance, capped at 32 clips / 32 MiB. Clips for a different avatar are rejected. Stop/hidden state stops locomotion requests.

This is a gait authoring/replay foundation. No validated walk/run library is preinstalled and no foot-contact IK is implemented. Retargeted foot sliding, transitions and the subjective quality of mixed lower/live-upper motion still require user phone tests. Full trajectory bridge synthesis between two saved clips is not yet a dedicated API; crossfades and Ardy waypoint constraints are available.
