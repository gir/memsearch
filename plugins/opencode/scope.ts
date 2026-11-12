import type { Plugin } from "@opencode/plugin";
import { realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { deriveCollectionNameFromScript } from "./derive-collection.ts";
import { projectRoot, pythonExecutable, run } from "./runtime.ts";

export interface Scope { root: string; projectID: string; workspaceID?: string }
/** Where memories live. Distinct from Scope, which decides who may read which session. */
export interface Storage {
  /** Memsearch directory passed to the CLI as MEMSEARCH_DIR. */
  dir: string;
  /** Markdown journals, indexed into `collection`. */
  memory: string;
  collection: string;
  /** Per-project capture lock and checkpoints; never shared between projects. */
  stateDir: string;
}

/**
 * Default is one global store shared by every project: MEMSEARCH_DIR when set,
 * else ~/.memsearch, with the collection derived from that directory.
 * MEMSEARCH_PROJECT_SCOPE=1 restores per-project <root>/.memsearch storage.
 */
export function resolveStorage(root: string, deriveScript: string, env: NodeJS.ProcessEnv = process.env): Storage {
  if (env.MEMSEARCH_PROJECT_SCOPE === "1") return projectStorage(root, deriveCollectionNameFromScript(deriveScript, root));
  const dir = resolve(env.MEMSEARCH_DIR?.trim() || join(homedir(), ".memsearch"));
  const id = createHash("sha256").update(root).digest("hex").slice(0, 16);
  return { dir, memory: join(dir, "memory"), collection: deriveCollectionNameFromScript(deriveScript, dir),
    stateDir: join(dir, ".opencode-projects", id) };
}

export function projectStorage(root: string, collection: string): Storage {
  const dir = join(root, ".memsearch");
  return { dir, memory: join(dir, "memory"), collection, stateDir: dir };
}

export function storageArgs(storage: Storage): string[] {
  return ["--memsearch-dir", storage.dir, "--state-dir", storage.stateDir];
}

export function hostScope(ctx: Pick<Plugin.Context, "location">): Scope {
  const location = ctx.location;
  return {
    root: realpathSync(projectRoot(realpathSync(location.directory))),
    projectID: location.project.id,
    workspaceID: location.workspaceID,
  };
}

export async function sessionScope(ctx: Pick<Plugin.Context, "session">, scope: Scope, sessionID: string, db: string, pluginDir: string): Promise<Scope> {
  const session = await ctx.session.get({ sessionID });
  const root = realpathSync(projectRoot(realpathSync(session.location.directory)));
  if (root !== scope.root) {
    throw new Error("Memory request is outside this plugin's project checkout/workspace.");
  }
  // Host project IDs can change for the same checkout. The public SessionInfo
  // omits workspaceID in 2.0.32. Validate physical ownership and persisted
  // workspace in the read-only projection before allowing any memory access.
  await run([pythonExecutable()], [join(pluginDir, "scripts/opencode_turns.py"), sessionID, ...scopeArgs(scope), "--db", db], root, undefined, 15_000);
  return { ...scope, root };
}

export function databasePath(channel: string, env: NodeJS.ProcessEnv = process.env): string {
  const data = join(env.XDG_DATA_HOME || join(homedir(), ".local/share"), "opencode");
  const shared = ["latest", "dev", "beta", "next", "prod"].includes(channel) || /^(1|true)$/i.test(env.OPENCODE_DISABLE_CHANNEL_DB ?? "");
  const file = env.OPENCODE_DB ?? (shared ? "opencode.db" : `opencode-${channel.replace(/[^a-zA-Z0-9._-]/g, "-")}.db`);
  return file === ":memory:" ? file : resolve(data, file);
}

export function scopeArgs(scope: Scope): string[] {
  return ["--project-dir", scope.root, "--project-id", scope.projectID, ...(scope.workspaceID ? ["--workspace-id", scope.workspaceID] : [])];
}
