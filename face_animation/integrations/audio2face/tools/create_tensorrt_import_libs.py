"""Create MSVC import libraries from the TensorRT DLLs installed by PyPI."""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path


EXPORT_LINE = re.compile(r"^\s+\d+\s+[0-9A-F]+\s+[0-9A-F]+\s+(\S+)\s*$")


def main() -> int:
    if len(sys.argv) != 3:
        raise SystemExit("usage: create_tensorrt_import_libs.py DLL_DIR OUTPUT_DIR")
    dll_dir = Path(sys.argv[1]).resolve()
    output_dir = Path(sys.argv[2]).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    for dll in sorted(dll_dir.glob("*.dll")):
        destination = output_dir / dll.name
        shutil.copy2(dll, destination)
        dump = subprocess.run(
            ["dumpbin", "/exports", str(dll)],
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        ).stdout
        exports = [match.group(1) for line in dump.splitlines() if (match := EXPORT_LINE.match(line))]
        if not exports:
            raise RuntimeError(f"No exports found in {dll}")
        definition = output_dir / f"{dll.stem}.def"
        definition.write_text(
            f"LIBRARY {dll.name}\nEXPORTS\n" + "\n".join(f"    {name}" for name in exports) + "\n",
            encoding="utf-8",
        )
        library = output_dir / f"{dll.stem}.lib"
        subprocess.run(["lib", f"/def:{definition}", "/machine:x64", f"/out:{library}"], check=True)
        print(f"{library.name}: {len(exports)} exports")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
