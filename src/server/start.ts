/**
 * The server's entry point. Starts the companion for one workspace: opens the
 * journal, builds the page, finds a free port and leaves a note
 * (`.sideco/server.json`) so the CLI and the hooks can find it. The command line
 * reaches the server through this module only.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locale } from "../domain/i18n.ts";
import { replay, type Workspace } from "../domain/workspace.ts";
import { homeData, homeDir } from "./home.ts";
import { type Handler, listenWith } from "./http.ts";
import type { Hub } from "./hub.ts";
import { IDLE_CHECK_MS, IdleWatch, STALE_SESSION_MS } from "./idle.ts";
import { journalBytes, openJournal } from "./journal.ts";
import { buildPage } from "./page.ts";
import { companion, PROTOCOL, type Space, Spaces } from "./spaces.ts";

export { homeDir, idOf, register, workspaces } from "./home.ts";
export { IDLE_GRACE_MS } from "./idle.ts";
export { journalBytes } from "./journal.ts";
export { PROTOCOL } from "./spaces.ts";

export const DEFAULT_PORT = 4747;
const PORT_TRIES = 20;

export interface Running {
  /** The address of the workspace `start` was asked for: `<base>/w/<id>`. */
  url: string;
  /** The companion's own address, which every workspace shares. */
  base: string;
  port: number;
  hub: Hub;
  spaces: Spaces;
  stop(): void;
}

/**
 * Where a workspace keeps its boards: its own `.sideco/`, or the `.vico/` of a
 * workspace made before the rename, until it is moved; else its folder under
 * the home of Sideco once it is registered there. A root neither holds names
 * the `.sideco/` it would have.
 */
export function dataDir(root: string): string {
  const current = join(root, ".sideco");
  if (existsSync(current)) return current;
  const legacy = join(root, ".vico");
  if (existsSync(legacy)) return legacy;
  return homeData(root) ?? current;
}

/** The workspace as the journal of `root` holds it, read without a server. */
export function readWorkspace(root: string): Workspace {
  return replay(openJournal(dataDir(root)).load());
}

/** A journal read the way the server reads it when it starts: loaded, then replayed. */
export interface JournalRead {
  workspace: Workspace;
  events: number;
  bytes: number;
  /** How long loading and replaying took: what a start of the companion costs. */
  ms: number;
}

export function readJournal(root: string, clock: () => number = () => performance.now()): JournalRead {
  const dir = dataDir(root);
  const began = clock();
  const events = openJournal(dir).load();
  const workspace = replay(events);
  return { workspace, events: events.length, bytes: journalBytes(dir), ms: clock() - began };
}

export function serverNote(root: string): string {
  return join(dataDir(root), "server.json");
}

export interface StartOptions {
  /** Opens an address in the user's browser, for shells that may not. */
  show?: (address: string) => Promise<boolean>;
  /** The language the page opens in; each reader may pick another. */
  locale?: Locale;
  /**
   * Called once nothing has used the companion for `graceMs`: no page, no
   * waiting session, no open session. Without it, the companion never stops by itself.
   */
  idle?: { graceMs: number; onIdle: () => void };
  /** Called once `sideco stop` has closed every project: without it, the companion stays. */
  onEmpty?: () => void;
}

/**
 * Starts the companion, which serves every project under `/w/<id>/`, and opens
 * the space of `root`. It leaves a note at home (`server.json`) so a command
 * line finds it, and one in each project it opens, for an older command line.
 */
export async function start(
  root: string,
  preferredPort = DEFAULT_PORT,
  { show, locale, idle, onEmpty }: StartOptions = {},
): Promise<Running> {
  const page = await buildPage(locale);
  let handle: Handler = async () => new Response(null, { status: 503 });
  const server = listen(
    (port) => listenWith((request, keepOpen) => handle(request, keepOpen), port),
    preferredPort,
  );
  const port = server.port;
  if (port === undefined) throw new Error("the server did not report its port");
  const base = `http://127.0.0.1:${port}`;
  const spaces = new Spaces({
    page,
    base,
    dataDir,
    show,
    onEmpty: () => setTimeout(() => (onEmpty ?? stop)(), 0),
  });
  handle = companion(spaces);
  let space: Space | undefined;
  try {
    space = spaces.of(root);
  } catch (error) {
    server.stop(true);
    throw error;
  }
  if (!space) throw new Error(`${root} has no id`);
  const note = companionNote();
  writeFileSync(
    note,
    `${JSON.stringify({ url: base, port, pid: process.pid, protocol: PROTOCOL }, null, 2)}\n`,
  );
  const watch =
    idle && new IdleWatch(() => spaces.all().map((open) => open.hub), { ...idle, staleMs: STALE_SESSION_MS });
  const looking =
    watch &&
    setInterval(() => watch.check(Date.now()), Math.min(IDLE_CHECK_MS, Math.max(50, idle.graceMs / 4)));
  function stop(): void {
    if (looking) clearInterval(looking);
    server.stop(true);
    spaces.close();
    if (readNote(note)?.pid === process.pid) rmSync(note, { force: true });
  }
  return { url: `${base}/w/${space.id}`, base, port, hub: space.hub, spaces, stop };
}

/** Where the companion says where it listens: at home, shared by every project. */
export function companionNote(): string {
  mkdirSync(homeDir(), { recursive: true });
  return join(homeDir(), "server.json");
}

export interface CompanionNote {
  url: string;
  port: number;
  pid: number;
  protocol: number;
}

export function readNote(path: string): Partial<CompanionNote> | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Partial<CompanionNote>;
  } catch {
    return undefined;
  }
}

/** The preferred port, or the next free one. Port 0 asks the system for any free port. */
function listen<T>(open: (port: number) => T, preferred: number): T {
  let last: unknown;
  for (let offset = 0; offset < (preferred === 0 ? 1 : PORT_TRIES); offset++) {
    try {
      return open(preferred + offset);
    } catch (error) {
      last = error;
      if ((error as { code?: string }).code !== "EADDRINUSE") break;
    }
  }
  throw last;
}
