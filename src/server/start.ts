/**
 * Starts the companion for one workspace: opens the journal, builds the page,
 * finds a free port and leaves a note (`.vico/server.json`) so the CLI and the
 * hooks can find it.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./http.ts";
import { Hub } from "./hub.ts";
import { openJournal } from "./journal.ts";
import { buildPage } from "./page.ts";

export const DEFAULT_PORT = 4747;
const PORT_TRIES = 20;

export interface Running {
  url: string;
  port: number;
  hub: Hub;
  stop(): void;
}

export function dataDir(root: string): string {
  return join(root, ".vico");
}

export function serverNote(root: string): string {
  return join(dataDir(root), "server.json");
}

export async function start(
  root: string,
  preferredPort = DEFAULT_PORT,
  show?: (address: string) => Promise<boolean>,
): Promise<Running> {
  const dir = dataDir(root);
  mkdirSync(dir, { recursive: true });
  const hub = new Hub(openJournal(dir));
  const page = await buildPage();
  const siteDir = join(dir, "site");

  const server = listen((port) => serve({ hub, page, root, siteDir, show, port }), preferredPort);
  const port = server.port;
  if (port === undefined) throw new Error("the server did not report its port");
  const url = `http://127.0.0.1:${port}`;
  writeFileSync(
    serverNote(root),
    `${JSON.stringify({ url, port, pid: process.pid, workspace: root }, null, 2)}\n`,
  );
  return {
    url,
    port,
    hub,
    stop() {
      server.stop(true);
      rmSync(serverNote(root), { force: true });
    },
  };
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
