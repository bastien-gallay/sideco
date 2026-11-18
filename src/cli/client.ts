/**
 * How the CLI and the hooks reach the companion: find the workspace, find its
 * server, check it is the right one, talk JSON to it.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Workspace } from "../domain/workspace.ts";
import { dataDir, serverNote } from "../server/start.ts";

export class ClientError extends Error {
  override name = "ClientError";
}

/** The shell is kept away from the loopback, as a sandbox does: the way out is the same each time. */
export class Blocked extends ClientError {
  constructor(what: string) {
    super(`this shell may not ${what}. Run this command outside the sandbox.`);
  }
}

/** Whether this process may listen on a local port. Port 0 is never taken, so a refusal is a ban. */
export function mayListen(): boolean {
  try {
    Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() }).stop(true);
    return true;
  } catch {
    return false;
  }
}

/**
 * The nearest directory at or above `from` that holds a `.vico/`, by its real
 * path: a workspace reached through a symlink is the same workspace.
 */
export function findRoot(from: string): string | undefined {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(dataDir(dir))) return realpathSync(dir);
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Creates the workspace and returns its real path. Session traces stay local; the board journal is yours to commit. */
export function initRoot(root: string): string {
  mkdirSync(dataDir(root), { recursive: true });
  const ignore = join(dataDir(root), ".gitignore");
  if (!existsSync(ignore))
    writeFileSync(
      ignore,
      "# Prompts and commands of your sessions stay on this machine.\nsessions.jsonl\nserver.json\nsite/\n",
    );
  return realpathSync(root);
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** A companion to talk to. `fetch` is a field so tests can reach a handler with no socket. */
export interface Server {
  url: string;
  fetch: Fetch;
}

/**
 * The running server for `root`, verified to speak for that workspace; undefined
 * when none answers. Throws `Blocked` when the system forbids the connection.
 */
export async function findServer(
  root: string,
  timeoutMs = 400,
  fetcher: Fetch = fetch,
): Promise<Server | undefined> {
  const note = serverNote(root);
  if (!existsSync(note)) return undefined;
  let url: unknown;
  try {
    url = (JSON.parse(readFileSync(note, "utf8")) as { url?: unknown }).url;
  } catch {
    return undefined;
  }
  if (typeof url !== "string") return undefined;
  try {
    const response = await fetcher(`${url}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    const health = (await response.json()) as { name?: string; workspace?: string };
    return health.name === "vico" && health.workspace === root ? { url, fetch: fetcher } : undefined;
  } catch (error) {
    if ((error as { code?: unknown }).code === "EPERM")
      throw new Blocked(`connect to the companion at ${url} (EPERM): a sandbox blocks local connections`);
    return undefined;
  }
}

/**
 * Stops the companion of `root` and returns its address; undefined when none
 * runs. Only a server that answers for this workspace is stopped.
 */
export async function stopServer(root: string): Promise<string | undefined> {
  const server = await findServer(root);
  if (!server) return undefined;
  const pid = (JSON.parse(readFileSync(serverNote(root), "utf8")) as { pid?: unknown }).pid;
  if (typeof pid !== "number")
    throw new ClientError(`${serverNote(root)} does not name the companion's process`);
  process.kill(pid, "SIGTERM");
  for (let attempt = 0; attempt < 30 && (await findServer(root, 200)); attempt++) await Bun.sleep(50);
  return server.url;
}

/** The running server, started in the background first if none answers. */
export async function ensureServer(
  root: string,
  fetcher: Fetch = fetch,
  canListen: () => boolean = mayListen,
): Promise<Server> {
  const running = await findServer(root, undefined, fetcher);
  if (running) return running;
  if (!canListen()) throw new Blocked("start the companion: a sandbox blocks local ports");
  const main = join(import.meta.dir, "main.ts");
  Bun.spawn([process.execPath, main, "serve", "--root", root], {
    stdio: ["ignore", "ignore", "ignore"],
    cwd: root,
  }).unref();
  for (let attempt = 0; attempt < 40; attempt++) {
    await Bun.sleep(100);
    const server = await findServer(root, undefined, fetcher);
    if (server) return server;
  }
  throw new ClientError("the companion did not start; run `vico serve` to see why");
}

export interface Posted {
  seq: number;
  minted: (string | null)[];
}

export async function post(
  server: Server,
  actor: string,
  session: string | undefined,
  commands: unknown[],
  timeoutMs = 5000,
): Promise<Posted> {
  const response = await server.fetch(`${server.url}/api/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actor, session, commands }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await answer<Posted & { error?: string; index?: number }>(response);
  if (!response.ok) {
    const where = commands.length > 1 && body.index !== undefined ? `command ${body.index + 1}: ` : "";
    throw new ClientError(`${where}${body.error ?? `HTTP ${response.status}`}`);
  }
  return body;
}

/** Asks the companion to show its page: it may run outside the sandbox that holds this shell. */
export async function showPage(server: Server, timeoutMs = 4000): Promise<boolean> {
  try {
    const response = await server.fetch(`${server.url}/api/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok && (await answer<{ opened?: boolean }>(response)).opened === true;
  } catch {
    return false;
  }
}

export async function get<T>(server: Server, path: string, timeoutMs = 5000): Promise<T> {
  const response = await server.fetch(`${server.url}${path}`, {
    signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  const body = await answer<T & { error?: string }>(response);
  if (!response.ok) throw new ClientError(body.error ?? `HTTP ${response.status}`);
  return body;
}

async function answer<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new ClientError(
      `the companion at ${response.url || "this address"} did not answer in JSON (HTTP ${response.status}); is another program on its port?`,
    );
  }
}

export function getWorkspace(server: Server): Promise<Workspace> {
  return get<Workspace>(server, "/api/workspace");
}
