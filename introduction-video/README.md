# Introduction video

This folder contains the approved Neural Avatar Pipeline project introduction,
its reproducible storyboard, and the local API runner used to record it.

- `neural-avatar-pipeline-introduction.mp4` is the approved exported video.
- `storyboard.json` owns the spoken copy, cached motion selections, camera cues,
  motion settings, and nominal timeline.
- `record-simple.mjs` loads that storyboard and directs the open Live Full Flow
  workspace through the local control API, including one-pass MP4 export.

```powershell
runtime\node\node.exe introduction-video\record-simple.mjs
```

Before a rehearsal, open Live Full Flow and refresh it so the complete embedding
bank is visible. The runner stops an existing session, clears earlier schedules,
installs this storyboard, starts Core-40, and synchronizes camera cues to the
Live Full Flow clock after the first motion horizon is ready.

The approved cut intentionally has no walk path so locomotion artifacts cannot
compromise the project overview.
