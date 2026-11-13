import { spawn } from "node:child_process";
import { join } from "node:path";
import type { Command } from "./runtime.ts";
import { embeddingArgs, pythonEnv, pythonExecutable } from "./runtime.ts";
import type { Storage } from "./scope.ts";

/**
 * Ask for the shared resident `memsearch watch`. scripts/watch.py takes a lock and exits at
 * once when a watcher is already running, so every session may call this on startup and on
 * its timer; whichever session notices a missing watcher restarts it. The watcher is
 * detached and outlives the session that started it.
 * Set MEMSEARCH_PLUGIN_WATCH=0 to opt out.
 */
export function ensureWatcher(pluginDir: string, root: string, collection: string, command: Command, storage: Storage, env: NodeJS.ProcessEnv = pythonEnv()): void {
  if (env.MEMSEARCH_PLUGIN_WATCH === "0" || process.platform === "win32") return;
  try {
    const child = spawn(pythonExecutable(), [join(pluginDir, "scripts/watch.py"), "--memsearch-dir", storage.dir,
      "--collection", collection, "--command", JSON.stringify(command),
      ...(embeddingArgs(root).length ? ["--default-onnx"] : []),
    ], { cwd: root, stdio: "ignore", detached: true, env: { ...env, MEMSEARCH_DIR: storage.dir } });
    child.on("error", () => {});
    child.unref();
  } catch { /* Capture keeps indexing on its own debounced schedule without a watcher. */ }
}
