/**
 * One companion, many projects. Each project is a space under `/w/<id>/`, with
 * its own hub on its own journal, opened the first time a request names it.
 * The companion's own address says who it is and leads to the spaces.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { idOf, rootOf, workspaces } from "./home.ts";
import { guard, type Handler, handler } from "./http.ts";
import { Hub } from "./hub.ts";
import { openJournal } from "./journal.ts";
import type { Page } from "./page.ts";

/**
 * What the companion and a command line must agree on to talk. A command line
 * refuses a companion that speaks another: raise it when the HTTP contract changes.
 */
export const PROTOCOL = 1;

export interface Space {
  id: string;
  root: string;
  hub: Hub;
  handle: Handler;
}

export interface SpacesOptions {
  page: Page;
  /** The companion's address, with no path: `http://127.0.0.1:4747`. */
  base: string;
  dataDir: (root: string) => string;
  show?: (address: string) => Promise<boolean>;
  /** Called when `sideco stop` closes the last open space: the companion is of no more use. */
  onEmpty?: () => void;
}

/** Where an older command line looks for the companion of a project: it still finds it there. */
const noteOf = (dir: string): string => join(dir, "server.json");

export class Spaces {
  private readonly open = new Map<string, Space>();

  constructor(private readonly options: SpacesOptions) {}

  /** The space of `root`, opened if need be. */
  of(root: string): Space | undefined {
    return this.byId(idOf(root));
  }

  /** The space an id names, opened if need be; undefined for an id no project has. */
  byId(id: string): Space | undefined {
    const known = this.open.get(id);
    if (known) return known;
    const root = rootOf(id);
    if (root === undefined) return undefined;
    const dir = this.options.dataDir(root);
    if (heldElsewhere(noteOf(dir))) throw new Held(root);
    mkdirSync(dir, { recursive: true });
    const hub = new Hub(openJournal(dir));
    const prefix = `/w/${id}`;
    const { page, show, base } = this.options;
    const handle = handler({ hub, page, root, siteDir: join(dir, "site"), show, prefix });
    const url = `${base}${prefix}`;
    const port = Number(new URL(base).port);
    writeFileSync(
      noteOf(dir),
      `${JSON.stringify({ url, port, pid: process.pid, workspace: root }, null, 2)}\n`,
    );
    const space = { id, root, hub, handle };
    this.open.set(id, space);
    return space;
  }

  all(): Space[] {
    return [...this.open.values()];
  }

  /**
   * Closes the space of one project, as `sideco stop` asks there: the others
   * stay served. Says whether it was open.
   */
  // ponytail: a page still streaming from the closed hub sees nothing more until it reloads; end its stream once Hub can close
  closeOne(id: string): boolean {
    const space = this.open.get(id);
    if (!space) return false;
    rmSync(noteOf(this.options.dataDir(space.root)), { force: true });
    this.open.delete(id);
    if (this.open.size === 0) this.options.onEmpty?.();
    return true;
  }

  /** Takes the notes away: an older command line must not find a companion that is gone. */
  close(): void {
    for (const space of this.open.values()) rmSync(noteOf(this.options.dataDir(space.root)), { force: true });
  }
}

/** A project whose journal another companion, still alive, writes. */
export class Held extends Error {
  constructor(readonly root: string) {
    super(`another companion holds ${root}; stop it (sideco stop) and ask again`);
  }
}

function heldElsewhere(note: string): boolean {
  if (!existsSync(note)) return false;
  let pid: unknown;
  try {
    pid = (JSON.parse(readFileSync(note, "utf8")) as { pid?: unknown }).pid;
  } catch {
    return false;
  }
  if (typeof pid !== "number" || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true; // ponytail: a pid the system gave again to another program reads as held; sideco stop clears it
  } catch {
    return false;
  }
}

const SPACE = /^\/w\/([\w.-]+)(\/.*)?$/;

/** The companion's own routes, and each space's under its prefix. */
export function companion(spaces: Spaces): Handler {
  return async (request, keepOpen) => {
    const url = new URL(request.url);
    const refusal = guard(request, url);
    if (refusal) return refusal;
    const named = SPACE.exec(url.pathname);
    if (named) return inSpace(spaces, named[1] ?? "", named[2], request, keepOpen);
    if (url.pathname === "/health")
      return json({ ok: true, name: "sideco", protocol: PROTOCOL, pid: process.pid });
    if (url.pathname === "/") {
      const open = spaces.all();
      const only = open.length === 1 ? open[0] : undefined;
      return only ? redirect(`/w/${only.id}/${url.search}`, 302) : listing(open);
    }
    return json({ error: "not found" }, 404);
  };
}

/** A request under `/w/<id>`: `rest` is what follows, undefined with no slash after the id. */
async function inSpace(
  spaces: Spaces,
  id: string,
  rest: string | undefined,
  request: Request,
  keepOpen?: () => void,
): Promise<Response> {
  const url = new URL(request.url);
  if (rest === undefined) return redirect(`${url.pathname}/${url.search}`, 308);
  if (rest === "/api/stop" && request.method === "POST") return json({ stopped: spaces.closeOne(id) });
  let space: Space | undefined;
  try {
    space = spaces.byId(id);
  } catch (error) {
    if (error instanceof Held) return json({ error: error.message }, 409);
    throw error;
  }
  return space ? space.handle(request, keepOpen) : json({ error: `no project has the id ${id}` }, 404);
}

function listing(open: Space[]): Response {
  const ids = workspaces();
  const items = open
    .map((space) => `<li><a href="/w/${space.id}/">${escapeHtml(space.root)}</a></li>`)
    .join("\n");
  const known = Object.keys(ids).length;
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Sideco</title><h1>Sideco</h1>\n<ul>\n${items}\n</ul>\n<p>${open.length} open of ${known} known projects.</p>\n`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const redirect = (location: string, status: number): Response =>
  new Response(null, { status, headers: { location } });

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
