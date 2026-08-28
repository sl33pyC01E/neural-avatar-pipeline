# Local LLM Control API

Unified Lab exposes a loopback-only JSON API at `http://127.0.0.1:8788/api/control`.
It controls the open **Live Full Flow** workspace without unloading resident
models. The WebUI must remain open because it owns audio playback, the VRM
renderer, keyboard state, and browser audio permissions.

After a fresh browser launch, click **Start live session** once if the browser
requires a user gesture to unlock audio. Subsequent session and speech commands
can remain API-driven while that page stays open.

## Agent workflow

1. Read `GET /api/control/schema` for the current action catalog.
2. Read `GET /api/control/state` before choosing embedding keys or changing
   active state.
3. Submit one command with `POST /api/control`.
4. Poll `GET /api/control/result?id=<commandId>` until its status is
   `completed` or `failed`.
5. Read state again before issuing dependent commands.

Agent frameworks that accept OpenAPI can import
`GET /api/control/openapi.json` (OpenAPI 3.1). The action-specific descriptions
and argument ranges remain available from `/api/control/schema`.

Check `uiConnected` in state and command responses. Commands submitted while it
is false remain pending for the WebUI; do not submit a dependent command until
the previous result is complete.

Give every intended action a unique stable `requestId`. If a request times out,
retry it with the same ID. The server returns the original command instead of
executing speech, movement, or another side effect twice.

```json
{
  "requestId": "director-turn-004-camera",
  "action": "camera.set",
  "args": {
    "target": "face",
    "directionAnchor": "face",
    "follow": true,
    "orbit": true,
    "orbitSpeed": 8,
    "distance": 1.3
  }
}
```

The command response is asynchronous:

```json
{
  "ok": true,
  "accepted": true,
  "commandId": 17,
  "uiConnected": true
}
```

## Examples

Queue live speech:

```json
{
  "requestId": "director-turn-004-line-1",
  "action": "speech.say",
  "args": { "text": "Welcome back. I have been expecting you." }
}
```

Activate an embedding by nickname after inspecting state:

```json
{
  "requestId": "director-turn-004-motion",
  "action": "embedding.activate",
  "args": { "selector": "curious idle" }
}
```

Configure two similar idle embeddings to alternate every twelve seconds:

```json
{
  "requestId": "director-idle-pair-001",
  "action": "embedding.idle-pair.set",
  "args": {
    "primary": "The person stands up straight, naturally.",
    "secondary": "The person lowers their hands and stands in a neutral pose.",
    "intervalSeconds": 12
  }
}
```

Replace only the walk schedule and loop it independently:

```json
{
  "requestId": "director-turn-004-path",
  "action": "path.schedule.set",
  "args": {
    "loop": true,
    "endpoints": [
      { "time": 0, "x": 0, "z": 0 },
      { "time": 4, "x": 1.5, "z": 0 },
      { "time": 8, "x": 1.5, "z": 1.5 }
    ]
  }
}
```

Hold forward and left for 800 milliseconds:

```json
{
  "requestId": "director-turn-004-step",
  "action": "locomotion.keys",
  "args": { "keys": ["w", "a"], "durationMs": 800 }
}
```

Set Live Full Flow motion generation controls independently of the ARDY tab:

```json
{
  "requestId": "director-turn-004-motion-settings",
  "action": "motion.settings.set",
  "args": {
    "speed": 0.8,
    "steeringBlend": 1.0,
    "denoisingSteps": 4,
    "constraintGuidance": 2.0,
    "textGuidance": 3.0,
    "historyFrames": 8,
    "adaptiveReplanBuffer": true,
    "replanBufferFrames": 3,
    "headingEnabled": true
  }
}
```

Restart the live timeline and export exactly one pass as a compatible MP4:

```json
{
  "requestId": "director-turn-004-export",
  "action": "export.single-pass",
  "args": {}
}
```

The export captures the rendered VRM, ARDY motion, LAM face animation, Anna
speech, and any camera commands issued during the pass. Speech and embedding
schedule loops are suppressed after their first pass; a looping walk path
records one complete route including its final return to origin.

## Control boundaries

- The server binds only to `127.0.0.1`; it is not a remote-control service.
- Commands are validated and executed by the WebUI, not evaluated as code.
- Locomotion duration is capped at 60 seconds. Use `locomotion.stop` when a
  held command is no longer wanted.
- Live Full Flow owns its Core-40 generation settings. It does not inherit
  denoising, guidance, history, steering, speed, or path-heading values from
  the ARDY authoring tab.
- The API can create cached embeddings but intentionally cannot delete them.
- Speech, embedding, and path schedules have independent loop flags.
- Scheduled Live Full Flow paths are sent to ARDY as dense, frame-indexed
  `root2d` constraints. WASD temporarily switches to target-velocity control;
  releasing it returns to the native scheduled constraint track.
- Scheduled speech remains live: PocketTTS and LAM run when each cue is due.
- Camera position targets and direction anchors are independent. `target`
  chooses what remains in frame; `directionAnchor` chooses which rotation the
  shot follows (`world`, `face`, `torso`, or `feet`).
- Camera angles are expressed in degrees and distances in metres. `yaw` is an
  offset from the selected direction anchor; with `world`, it is the absolute
  world-relative angle used by earlier versions.

## Camera cuts and moves

Camera shot changes are explicit. Use `camera.cut` for an immediate edit and
`camera.move` for a smooth, eased revolve. A smooth move follows the shortest
yaw arc while continuously resolving its destination against the selected body
direction anchor. `camera.set`, `camera.preset`, `camera.nudge`, and
`camera.reset` also accept `transition: "cut" | "move"` and
`transitionSeconds` (0.1–30 seconds).

Camera commands begin immediately, while a scheduled speech cue begins live
PocketTTS and LAM preparation. For a voice-led shot change, schedule the camera
command at roughly `speech cue time + 1.0 second` as an initial timing rule, then
tune that offset for the machine and line length. This is guidance only: camera
timing remains fully independent and unrestricted.

Cut directly to a face shot:

```json
{
  "requestId": "director-shot-011-cut",
  "action": "camera.cut",
  "args": {
    "target": "face",
    "directionAnchor": "face",
    "distance": 1.25,
    "yaw": 0,
    "pitch": 82
  }
}
```

Revolve smoothly to a full-body shot over 2.5 seconds:

```json
{
  "requestId": "director-shot-012-move",
  "action": "camera.move",
  "args": {
    "target": "full",
    "directionAnchor": "feet",
    "follow": true,
    "distance": 4.15,
    "yaw": 35,
    "pitch": 68,
    "transitionSeconds": 2.5
  }
}
```

The schema endpoint is authoritative for available actions and argument ranges.
