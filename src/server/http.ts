/**
 * The HTTP face of the hub. Three channels, as few as the loop needs:
 *
 *   GET  /api/events    server → page, Server-Sent Events, resumable by sequence
 *   POST /api/commands  page or CLI → server, an atomic batch
 *   GET  /api/wait      agent → server, a long poll that returns when the human hands over
 *
 * The server listens on the loopback interface only, and still refuses requests
 * that a web page on another origin could have made the browser send.
 */
import { existsSync, statSync } from "node:fs";
import { join, normalize, sep } from "node:path";
import { type Command, parseCommand } from "../domain/commands.ts";
import { ACTORS, type Actor } from "../domain/events.ts";
import type { Presence } from "../domain/presence.ts";
import { atCommand, BatchError, type Hub } from "./hub.ts";
import type { Page } from "./page.ts";

export interface Site {
  hub: Hub;
  page: Page;
  /** The workspace this server speaks for; callers check it before writing. */
  root: string;
  /** Where `sideco publish` writes; served read-only under /pub/. */
  siteDir: string;
  /** Shows the page at this address to the human on this machine; absent when the server cannot. */
  show?: (address: string) => Promise<boolean>;
}

export interface ServerOptions extends Site {
  port: number;
}

/**
 * Answers one request. `keepOpen` is called for the requests that stay open by
 * design (the event stream, the long poll), so the caller can lift its idle timeout.
 */
export type Handler = (request: Request, keepOpen?: () => void) => Promise<Response>;

const MAX_WAIT_MS = 30 * 60 * 1000;
const KEEPALIVE_MS = 25_000;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

/** The whole HTTP behaviour, with no socket: the server and the tests call it the same way. */
export function handler(site: Site): Handler {
  const { hub, page, root, siteDir, show } = site;
  return async (request, keepOpen = () => {}) => {
    const url = new URL(request.url);
    const refusal = guard(request, url);
    if (refusal) return refusal;

    if (request.method === "GET") {
      switch (url.pathname) {
        case "/":
          return new Response(page.html, {
            headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
          });
        case "/stream-worker.js":
          return new Response(page.worker, {
            headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" },
          });
        case "/health":
          return json({
            ok: true,
            name: "sideco",
            workspace: root,
            seq: hub.workspace.seq,
            listening: hub.listening,
            watching: hub.watching,
          });
        case "/api/workspace":
          return json(hub.workspace);
        case "/api/events":
          keepOpen();
          return stream(hub, page.build, request, url);
        case "/api/changes":
          return changes(hub, url);
        case "/api/wait":
          keepOpen();
          return wait(hub, request, url);
      }
      if (url.pathname.startsWith("/pub/")) return published(siteDir, url.pathname.slice("/pub/".length));
    }
    if (request.method === "POST" && url.pathname === "/api/commands") return commands(hub, request);
    // A sandboxed shell cannot open a browser; this server, started outside it, can. Its own page only.
    if (request.method === "POST" && url.pathname === "/api/open")
      return json({ opened: show ? await show(url.origin) : false });
    return json({ error: "not found" }, 404);
  };
}

/** Listens on the loopback interface only. */
export function serve(options: ServerOptions): ReturnType<typeof Bun.serve> {
  const handle = handler(options);
  return Bun.serve({
    hostname: "127.0.0.1",
    port: options.port,
    fetch: (request, server) => handle(request, () => server.timeout(request, 0)),
  });
}

/** Refuses what a foreign web page could trigger: a rebound host name, or a cross-origin write. */
function guard(request: Request, url: URL): Response | undefined {
  const allowed = new Set([`127.0.0.1:${url.port}`, `localhost:${url.port}`]);
  if (!allowed.has(request.headers.get("host") ?? "")) return json({ error: "unexpected host" }, 403);
  const origin = request.headers.get("origin");
  if (origin !== null && !allowed.has(origin.replace(/^http:\/\//, "")))
    return json({ error: "cross-origin request refused" }, 403);
  if (
    request.method === "POST" &&
    !(request.headers.get("content-type") ?? "").startsWith("application/json")
  ) {
    return json({ error: "send JSON" }, 415);
  }
  return undefined;
}

async function commands(hub: Hub, request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "the body is not valid JSON" }, 400);
  }
  const batch = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const actor = ACTORS.find((a) => a === batch.actor);
  if (!actor) return json({ error: "`actor` must be human, agent or system" }, 400);
  if (!Array.isArray(batch.commands) || batch.commands.length === 0 || batch.commands.length > 500) {
    return json({ error: "`commands` must be a list of 1 to 500 commands" }, 400);
  }
  const session =
    typeof batch.session === "string" && batch.session !== "" ? batch.session.slice(0, 200) : undefined;

  let parsed: Command[];
  try {
    parsed = batch.commands.map((raw, index) => atCommand(index, () => parseCommand(raw)));
    const done = hub.dispatch(parsed, { actor: actor as Actor, session });
    return json({ seq: hub.workspace.seq, minted: done.minted, events: done.events.length });
  } catch (error) {
    if (error instanceof BatchError) return json({ error: error.message, index: error.index }, 400);
    throw error;
  }
}

function stream(hub: Hub, build: string, request: Request, url: URL): Response {
  const after = Number(request.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0) || 0;
  const encoder = new TextEncoder();
  let close = (): void => {};

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string): void => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          close();
        }
      };
      const presence = (listening: number): void => {
        const said: Presence = { listening, run: hub.run, build };
        send(`event: presence\ndata: ${JSON.stringify(said)}\n\n`);
      };
      for (const event of hub.pageEventsAfter(after)) send(frame(event.seq, event));
      presence(hub.listening);
      const stopEvents = hub.subscribe((event) => send(frame(event.seq, event)));
      const stopPresence = hub.onPresence(presence);
      const keepalive = setInterval(() => send(": keepalive\n\n"), KEEPALIVE_MS);
      close = () => {
        stopEvents();
        stopPresence();
        clearInterval(keepalive);
      };
      request.signal.addEventListener("abort", close);
    },
    cancel() {
      close();
    },
  });
  return new Response(body, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}

function frame(seq: number, data: unknown): string {
  return `id: ${seq}\ndata: ${JSON.stringify(data)}\n\n`;
}

function changes(hub: Hub, url: URL): Response {
  const session = url.searchParams.get("session");
  if (!session) return json({ error: "`session` is required" }, 400);
  if (url.searchParams.get("when") === "passed" && !hub.hasPendingTurn(session)) {
    return json({ text: "", count: 0, upTo: hub.workspace.seq, passed: false });
  }
  return json(hub.changesFor(session, url.searchParams.get("ack") === "1"));
}

async function wait(hub: Hub, request: Request, url: URL): Promise<Response> {
  const session = url.searchParams.get("session");
  if (!session) return json({ error: "`session` is required" }, 400);
  const timeout = Math.min(Math.max(Number(url.searchParams.get("timeout")) || 0, 0), MAX_WAIT_MS);
  // A hand-over comes from a page; with none open, a caller that says so is not kept waiting.
  if (url.searchParams.get("watched") === "1" && hub.watching === 0)
    return json({ outcome: "unwatched", text: "" });
  request.signal.addEventListener("abort", () => hub.abandon(session));
  const outcome = await hub.waitForTurn(session, timeout);
  const text = outcome === "passed" ? hub.changesFor(session, true).text : "";
  return json({ outcome, text });
}

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  svg: "image/svg+xml",
  json: "application/json; charset=utf-8",
};

function published(siteDir: string, path: string): Response {
  const file = normalize(join(siteDir, decodeURIComponent(path) || "index.html"));
  if (!file.startsWith(siteDir + sep) || !existsSync(file) || !statSync(file).isFile())
    return json({ error: "not published" }, 404);
  const type = TYPES[file.split(".").pop() ?? ""] ?? "application/octet-stream";
  return new Response(Bun.file(file), { headers: { "content-type": type, "cache-control": "no-store" } });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
