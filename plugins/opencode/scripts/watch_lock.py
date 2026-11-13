"""Single-instance lock for the resident `memsearch watch` process."""

from __future__ import annotations

import os
from pathlib import Path
from typing import BinaryIO

LOCK_NAME = ".watch.lock"
PID_NAME = ".watch.pid"


def _flock(handle: BinaryIO) -> bool:
    import fcntl

    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError:
        return False


def try_acquire(base: Path) -> BinaryIO | None:
    """Take the watcher lock without blocking. The lock lives as long as the returned
    handle stays open (it survives exec when the descriptor is inheritable)."""
    if os.name == "nt":
        return None
    base.mkdir(parents=True, exist_ok=True)
    handle = (base / LOCK_NAME).open("a+b")
    if _flock(handle):
        return handle
    handle.close()
    return None


def watcher_alive(base: Path) -> bool:
    """True when another process currently holds the watcher lock."""
    if os.name == "nt" or not (base / LOCK_NAME).exists():
        return False
    handle = try_acquire(base)
    if handle is None:
        return True
    handle.close()
    return False
