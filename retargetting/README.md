# Motion Drive

Local ARDY and Kimodo motion generation, interactive ARDY control, and direct VRM playback.

## Start

Run `start_motion_drive.bat`, then open <http://127.0.0.1:8793/>. Closing the launcher window stops the server and its model workers.

The launcher expects Node.js dependencies in `node_modules` and the local ARDY/Kimodo environments under `../ardy` and `../kimodo`. Model weights and generated output are intentionally not stored in Git.

## Layout

- `motion-control.html`, `motion-control.js`, `motion-control-server.js`: current Motion Drive UI and server.
- `motion-assets/`: checked-in ARDY and Kimodo preview meshes.
- `start_motion_drive.bat`: current launcher.
- `kimodo-lab*` and `start_kimodo_lab.bat`: standalone Kimodo diagnostic lab.
- `MOTION_DRIVE_EXPERIMENTS.md`: chronological implementation and tuning record.
- `legacy/emage-diffusion/`: archived EMAGE-era combined retargeting lab; it remains runnable with its own launcher.

The inference worker and evaluation utilities are maintained in the adjacent `../motion-models` Git repository.
