"""Terminate a bundled Python service when its owning launcher disappears."""

from __future__ import annotations

import ctypes
import os
import threading
import time


def _parent_pid() -> int:
    raw = os.environ.get("UNIFIED_PARENT_PID") or os.environ.get("UNIFIED_LAUNCHER_PID") or "0"
    try:
        return max(0, int(raw))
    except ValueError:
        return 0


def _wait_for_windows_process(pid: int) -> None:
    synchronize = 0x00100000
    wait_object_0 = 0x00000000
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    handle = kernel32.OpenProcess(synchronize, False, pid)
    if not handle:
        os._exit(0)
    try:
        while True:
            if kernel32.WaitForSingleObject(handle, 1000) == wait_object_0:
                os._exit(0)
    finally:
        kernel32.CloseHandle(handle)


def _poll_process(pid: int) -> None:
    while True:
        try:
            os.kill(pid, 0)
        except OSError:
            os._exit(0)
        time.sleep(1)


def start_parent_watchdog() -> None:
    """Start once; no-op when a service is run outside the Unified launcher."""
    pid = _parent_pid()
    if not pid or pid == os.getpid():
        return
    target = _wait_for_windows_process if os.name == "nt" else _poll_process
    threading.Thread(target=target, args=(pid,), daemon=True, name="unified-parent-watchdog").start()
