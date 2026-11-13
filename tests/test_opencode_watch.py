from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time

import pytest

from tests.opencode_v2_fixtures import SCRIPTS

sys.path.insert(0, str(SCRIPTS))
import watch_lock

pytestmark = pytest.mark.skipif(os.name == "nt", reason="the resident watcher is POSIX only")


def _fake_cli(tmp_path):
    cli = tmp_path / "fake-cli.py"
    cli.write_text(
        "import os, sys, time\n"
        f"open({str(tmp_path / 'starts.txt')!r}, 'a').write(' '.join(sys.argv[1:]) + '\\n')\n"
        "time.sleep(60)\n"
    )
    return cli


def _start(tmp_path, base, cli, *extra):
    return subprocess.run(
        [
            sys.executable,
            str(SCRIPTS / "watch.py"),
            "--memsearch-dir",
            str(base),
            "--collection",
            "c1",
            "--command",
            json.dumps([sys.executable, str(cli)]),
            *extra,
        ],
        capture_output=True,
        text=True,
        timeout=10,
    )


def test_build_argv():
    import watch

    assert watch.build_argv(["ms"], "/m", "c", True, 500) == [
        "ms",
        "watch",
        "/m",
        "--default-collection",
        "c",
        "--debounce-ms",
        "500",
        "--provider",
        "onnx",
    ]
    assert "--provider" not in watch.build_argv(["ms"], "/m", "c", False, 500)


def test_lock_is_exclusive_and_released_on_close(tmp_path):
    first = watch_lock.try_acquire(tmp_path)
    assert first is not None
    assert watch_lock.try_acquire(tmp_path) is None
    assert watch_lock.watcher_alive(tmp_path)
    first.close()
    assert not watch_lock.watcher_alive(tmp_path)


def test_watcher_alive_without_lock_file(tmp_path):
    assert not watch_lock.watcher_alive(tmp_path / "missing")


def test_only_one_resident_watcher_starts(tmp_path):
    base = tmp_path / "base"
    cli = _fake_cli(tmp_path)
    holder = subprocess.Popen(
        [
            sys.executable,
            "-c",
            f"import sys; sys.path.insert(0, {str(SCRIPTS)!r}); import watch_lock, time, pathlib;"
            f"h = watch_lock.try_acquire(pathlib.Path({str(base)!r})); time.sleep(30)",
        ]
    )
    try:
        deadline = time.time() + 10
        while not watch_lock.watcher_alive(base) and time.time() < deadline:
            time.sleep(0.05)
        started = _start(tmp_path, base, cli)
        assert started.returncode == 0
        assert not (tmp_path / "starts.txt").exists(), "a second watcher must not start while the lock is held"
    finally:
        holder.kill()
        holder.wait()
    assert not watch_lock.watcher_alive(base)


def test_watcher_execs_cli_keeps_lock_and_dies_with_it(tmp_path):
    base = tmp_path / "base"
    cli = _fake_cli(tmp_path)
    process = subprocess.Popen(
        [
            sys.executable,
            str(SCRIPTS / "watch.py"),
            "--memsearch-dir",
            str(base),
            "--collection",
            "c1",
            "--command",
            json.dumps([sys.executable, str(cli)]),
            "--default-onnx",
        ]
    )
    try:
        deadline = time.time() + 10
        while not (tmp_path / "starts.txt").exists() and time.time() < deadline:
            time.sleep(0.05)
        assert (tmp_path / "starts.txt").read_text().strip() == (
            f"watch {base / 'memory'} --default-collection c1 --debounce-ms 30000 --provider onnx"
        )
        assert (base / "memory").is_dir()
        assert watch_lock.watcher_alive(base)
        assert (base / ".watch.pid").read_text() == str(process.pid)
        assert _start(tmp_path, base, cli).returncode == 0
        assert (tmp_path / "starts.txt").read_text().splitlines().__len__() == 1
    finally:
        process.send_signal(signal.SIGKILL)
        process.wait()
    assert not watch_lock.watcher_alive(base)


def test_capture_skips_its_own_index_while_a_watcher_runs(tmp_path):
    from tests.opencode_v2_fixtures import Fixture

    f = Fixture(tmp_path / "project")
    f.turn()
    base = f.root / ".memsearch"
    cli = tmp_path / "index-cli.py"
    cli.write_text(f"open({str(tmp_path / 'index-ran')!r}, 'a').write('x')\n")
    lock = watch_lock.try_acquire(base)
    assert lock is not None
    argv = [
        sys.executable,
        str(SCRIPTS / "capture.py"),
        "--project-dir",
        str(f.root),
        "--project-id",
        "project",
        "--db",
        str(f.path),
        "--collection",
        "c",
        "--command",
        json.dumps([sys.executable, str(cli)]),
    ]
    env = {**os.environ, "HOME": str(tmp_path / "home"), "MEMSEARCH_DIR": str(base)}
    (tmp_path / "home").mkdir()
    try:
        result = subprocess.run(
            argv, input='{"text":"- Fixture summary."}\n', text=True, capture_output=True, env=env, timeout=20
        )
    finally:
        lock.close()
    assert result.returncode == 0, result.stdout + result.stderr
    assert not (tmp_path / "index-ran").exists()
    f.conn.close()
