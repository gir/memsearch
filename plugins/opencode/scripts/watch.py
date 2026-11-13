#!/usr/bin/env python3
"""Start the one resident `memsearch watch` shared by every OpenCode session.

Takes a non-blocking lock first; if another watcher already holds it this exits 0 at once,
so every session can call it on startup and on its timer. On success the process replaces
itself with `memsearch watch`, which keeps the lock for as long as it runs.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from watch_lock import PID_NAME, try_acquire


def build_argv(command: list[str], memory: str, collection: str, default_onnx: bool, debounce_ms: int) -> list[str]:
    return [
        *command,
        "watch",
        memory,
        "--default-collection",
        collection,
        "--debounce-ms",
        str(debounce_ms),
        *(["--provider", "onnx"] if default_onnx else []),
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--memsearch-dir", required=True)
    parser.add_argument("--collection", required=True)
    parser.add_argument("--command", required=True, help="JSON argv of the memsearch CLI")
    parser.add_argument("--default-onnx", action="store_true")
    parser.add_argument("--debounce-ms", type=int, default=30000)
    args = parser.parse_args()
    base = Path(args.memsearch_dir)
    lock = try_acquire(base)
    if lock is None:
        return 0
    memory = base / "memory"
    memory.mkdir(parents=True, exist_ok=True)
    (base / PID_NAME).write_text(str(os.getpid()))
    os.set_inheritable(lock.fileno(), True)
    argv = build_argv(json.loads(args.command), str(memory), args.collection, args.default_onnx, args.debounce_ms)
    sys.stdout.flush()
    os.execvpe(argv[0], argv, {**os.environ, "MEMSEARCH_DIR": str(base)})
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
