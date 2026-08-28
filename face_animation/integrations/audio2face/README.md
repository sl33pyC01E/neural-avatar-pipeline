# Audio2Face native bridge

This folder preserves the small native bridge used by Face Lab to run NVIDIA
Audio2Face-3D v3 and return its 52 ARKit controls as JSON.

The active compiled copy is installed under the independent
`Audio2Face-3D-SDK` checkout. `bridge/` is the source checkpoint for the custom
executable; `tools/` contains the Windows TensorRT setup helpers used during the
local build. Large SDK files, TensorRT engines, DLLs, and build outputs remain
inside the ignored upstream checkout.
