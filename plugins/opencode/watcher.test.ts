import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureWatcher } from "./watcher.ts";

const pluginDir = dirname(fileURLToPath(import.meta.url));
const wait = async (ok: () => boolean, ms = 10_000) => { const end = Date.now() + ms; while (!ok() && Date.now() < end) await new Promise(r => setTimeout(r, 50)); };

test("repeated ensureWatcher calls leave exactly one resident watcher", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "memsearch-watcher-")));
  const dir = join(root, "store"); mkdirSync(dir);
  const cli = join(root, "cli.py");
  writeFileSync(cli, `import os, sys, time\nopen(${JSON.stringify(join(root, "starts.txt"))}, "a").write(str(os.getpid()) + "\\n")\ntime.sleep(60)\n`);
  const storage = { dir, memory: join(dir, "memory"), collection: "c", stateDir: dir };
  const env = { ...process.env, HOME: root };
  t.after(() => {
    try { process.kill(Number(readFileSync(join(dir, ".watch.pid"), "utf8")), "SIGKILL"); } catch { /* already gone */ }
    rmSync(root, { recursive: true, force: true });
  });
  ensureWatcher(pluginDir, root, "c", ["python3", cli], storage, env);
  await wait(() => existsSync(join(root, "starts.txt")));
  for (let i = 0; i < 4; i++) ensureWatcher(pluginDir, root, "c", ["python3", cli], storage, env);
  await new Promise(r => setTimeout(r, 1500));
  assert.equal(readFileSync(join(root, "starts.txt"), "utf8").trim().split("\n").length, 1);
});

test("MEMSEARCH_PLUGIN_WATCH=0 opts out", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "memsearch-watcher-off-")));
  ensureWatcher(pluginDir, root, "c", ["python3", "-c", "pass"], { dir: root, memory: join(root, "memory"), collection: "c", stateDir: root }, { ...process.env, MEMSEARCH_PLUGIN_WATCH: "0" });
  await new Promise(r => setTimeout(r, 500));
  assert.equal(existsSync(join(root, ".watch.lock")), false);
  rmSync(root, { recursive: true, force: true });
});
