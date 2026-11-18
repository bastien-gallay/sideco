import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBatch } from "../../src/cli/argv.ts";
import { type Handler, handler } from "../../src/server/http.ts";
import { Hub } from "../../src/server/hub.ts";
import { memoryJournal } from "../../src/server/journal.ts";
import { ORDERING, T0 } from "../support.ts";

const BASE = "http://127.0.0.1:4747";
let dir: string;
let hub: Hub;
let handle: Handler;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vico-http-"));
  hub = new Hub(memoryJournal(), () => new Date(T0));
  handle = handler({
    hub,
    page: "<!doctype html><title>Vico</title>",
    root: "/repo",
    siteDir: join(dir, "site"),
  });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function get(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return handle(new Request(`${BASE}${path}`, { headers: { host: "127.0.0.1:4747", ...headers } }));
}

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return handle(
    new Request(`${BASE}/api/commands`, {
      method: "POST",
      headers: { host: "127.0.0.1:4747", "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const say = (script: string, actor = "agent", session?: string): Promise<Response> =>
  post({ actor, session, commands: parseBatch(script, "commande") });

/** Reads Server-Sent Events frames off a response, one at a time. */
function frames(response: Response): {
  next(): Promise<{ id?: string; event?: string; data: unknown }>;
  close(): Promise<void>;
} {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    async next() {
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end !== -1) {
          const raw = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const field = (name: string): string | undefined =>
            new RegExp(`^${name}: (.*)$`, "m").exec(raw)?.[1];
          return { id: field("id"), event: field("event"), data: JSON.parse(field("data") ?? "null") };
        }
        const chunk = await reader.read();
        if (chunk.done) throw new Error("the stream ended");
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    },
    close: () => reader.cancel(),
  };
}

describe("reading", () => {
  test("the page, the health note and the workspace", async () => {
    const page = await get("/");
    expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await page.text()).toContain("<title>Vico</title>");
    expect(await (await get("/health")).json()).toEqual({
      ok: true,
      name: "vico",
      workspace: "/repo",
      seq: 0,
      listening: 0,
      watching: 0,
    });
    // A page following the journal is a watcher: `vico open` need not open another.
    const stream = frames(await get("/api/events"));
    await stream.next();
    expect(await (await get("/health")).json()).toMatchObject({ watching: 1 });
    await stream.close();
    await say(ORDERING);
    const ws = (await (await get("/api/workspace")).json()) as { boards: { id: string }[] };
    expect(ws.boards.map((b) => b.id)).toEqual(["commande"]);
  });

  test("anything else is a 404 in JSON", async () => {
    const response = await get("/api/nope");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not found" });
  });
});

describe("commands", () => {
  test("a batch is applied and answers with the ids it minted", async () => {
    const response = await say('board new "B" --id b\nadd command "Payer"\nadd event "Payé"');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ seq: 3, minted: [null, "C1", "E1"], events: 3 });
  });

  test("a refused batch says which command and why, and changes nothing", async () => {
    await say(ORDERING);
    const seq = hub.workspace.seq;
    const response = await say('add event "A"\nrename E99 "x"');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'no element E99 on "commande"', index: 1 });
    expect(hub.workspace.seq).toBe(seq);
  });

  test("a malformed command is refused at the door, with its index", async () => {
    const response = await post({
      actor: "agent",
      commands: [
        { kind: "create-board", board: "b", title: "B", format: "flow" },
        { kind: "add", board: "b" },
      ],
    });
    expect(await response.json()).toEqual({ error: "`type` must be a string", index: 1 });
    expect(hub.workspace.boards).toEqual([]);
  });

  test.each([
    ["not json", "the body is not valid JSON"],
    [{ commands: [{ kind: "turn-end" }] }, "`actor` must be human, agent or system"],
    [{ actor: "robot", commands: [{ kind: "turn-end" }] }, "`actor` must be human, agent or system"],
    [{ actor: "agent", commands: [] }, "`commands` must be a list of 1 to 500 commands"],
    [{ actor: "agent" }, "`commands` must be a list of 1 to 500 commands"],
  ])("a bad envelope %j is refused", async (body, error) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error });
  });

  test("the session travels with the events", async () => {
    await post({ actor: "agent", session: "s1", commands: [{ kind: "prompt", text: "hello" }] });
    expect(hub.events[0]).toMatchObject({ event: "PromptSubmitted", session: "s1", actor: "agent" });
  });
});

describe("what a foreign web page could make the browser send is refused", () => {
  test("another host name: DNS rebinding", async () => {
    const response = await get("/api/workspace", { host: "evil.example:4747" });
    expect(response.status).toBe(403);
  });

  test("another origin, on reads and writes alike", async () => {
    expect((await get("/api/workspace", { origin: "https://evil.example" })).status).toBe(403);
    const write = await post(
      { actor: "human", commands: [{ kind: "create-board", board: "b", title: "B", format: "flow" }] },
      { origin: "https://evil.example" },
    );
    expect(write.status).toBe(403);
    expect(hub.workspace.boards).toEqual([]);
  });

  test("a form post: no JSON content type, no write", async () => {
    const response = await post(JSON.stringify({ actor: "human", commands: [] }), {
      "content-type": "text/plain",
    });
    expect(response.status).toBe(415);
  });

  test("the page's own origin is welcome, under both loopback names", async () => {
    expect((await get("/health", { origin: "http://127.0.0.1:4747" })).status).toBe(200);
    expect((await get("/health", { host: "localhost:4747", origin: "http://localhost:4747" })).status).toBe(
      200,
    );
  });
});

describe("the event stream", () => {
  test("replays the journal, says who is listening, then pushes each new event", async () => {
    await say('board new "B" --id b');
    const response = await get("/api/events");
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const stream = frames(response);
    expect(await stream.next()).toMatchObject({ id: "1", data: { event: "BoardCreated", board: "b" } });
    // The presence frame closes the replay and names this run of the companion.
    expect(await stream.next()).toEqual({
      id: undefined,
      event: "presence",
      data: { listening: 0, run: hub.run },
    });
    expect((await say('add event "Payé" --board b', "agent")).status).toBe(200);
    expect(await stream.next()).toMatchObject({
      id: "2",
      data: { event: "ElementAdded", id: "E1", label: "Payé", actor: "agent" },
    });
    await stream.close();
  });

  test("resumes after the last event the page saw", async () => {
    await say(ORDERING);
    const last = hub.workspace.seq;
    const stream = frames(await get("/api/events", { "last-event-id": String(last - 1) }));
    expect((await stream.next()).id).toBe(String(last));
    expect((await stream.next()).event).toBe("presence");
    await stream.close();
  });

  test("tells the page when an agent starts listening", async () => {
    const stream = frames(await get("/api/events"));
    expect(await stream.next()).toMatchObject({ event: "presence", data: { listening: 0 } });
    const waiting = get("/api/wait?session=s1&timeout=5000");
    expect(await stream.next()).toMatchObject({ event: "presence", data: { listening: 1 } });
    hub.abandon("s1");
    await waiting;
    await stream.close();
  });

  test("a page that leaves stops being served", async () => {
    const stream = frames(await get("/api/events"));
    await stream.next();
    await stream.close();
    await say('board new "B" --id b');
    expect(hub.workspace.seq).toBe(1);
  });
});

describe("the agent's side of the loop", () => {
  test("changes need a session; acknowledging delivers them once", async () => {
    expect((await get("/api/changes")).status).toBe(400);
    await say(ORDERING);
    await say('rename E1 "Validée"', "human");
    const first = (await (await get("/api/changes?session=s1&ack=1")).json()) as {
      text: string;
      count: number;
    };
    expect(first).toMatchObject({ count: 1 });
    expect(first.text).toContain('~ E1 renamed "Commande passée" → "Validée"');
    expect(await (await get("/api/changes?session=s1&ack=1")).json()).toMatchObject({ text: "", count: 0 });
  });

  test("`when=passed` stays silent until the human hands over, so a busy agent is not interrupted", async () => {
    await say(ORDERING);
    await say('rename E1 "Validée"', "human");
    expect(await (await get("/api/changes?session=s1&ack=1&when=passed")).json()).toMatchObject({
      text: "",
      passed: false,
    });
    await say("pass --to agent", "human");
    const told = (await (await get("/api/changes?session=s1&ack=1&when=passed")).json()) as {
      text: string;
      passed: boolean;
    };
    expect(told.passed).toBe(true);
    expect(told.text).toContain("Validée");
    expect(await (await get("/api/changes?session=s1&ack=1&when=passed")).json()).toMatchObject({ text: "" });
  });

  test("a wait returns the human's changes when they hand over", async () => {
    await say(ORDERING);
    const waiting = get("/api/wait?session=s1&timeout=5000");
    await say('rename E1 "Validée"\npass --to agent "regarde E1"', "human");
    const waited = (await (await waiting).json()) as { outcome: string; text: string };
    expect(waited.outcome).toBe("passed");
    expect(waited.text).toContain("Validée");
    expect(waited.text).toContain("The human passed you the turn: regarde E1");
    expect(await (await get("/api/changes?session=s1")).json()).toMatchObject({ text: "" });
  });

  test("a wait that needs a watcher returns at once when no page is open", async () => {
    await say(ORDERING);
    expect(await (await get("/api/wait?session=s1&timeout=5000&watched=1")).json()).toEqual({
      outcome: "unwatched",
      text: "",
    });
    const page = frames(await get("/api/events"));
    expect(await (await get("/api/wait?session=s1&timeout=20&watched=1")).json()).toMatchObject({
      outcome: "timeout",
    });
    await page.close();
  });

  test("a wait that times out says so and delivers nothing", async () => {
    await say(ORDERING);
    await say('rename E1 "Validée"', "human");
    expect(await (await get("/api/wait?session=s1&timeout=20")).json()).toEqual({
      outcome: "timeout",
      text: "",
    });
    expect(await (await get("/api/changes?session=s1")).json()).toMatchObject({ count: 1 });
  });

  test("long-lived requests ask to be kept open", async () => {
    let kept = 0;
    const keepOpen = (): void => {
      kept += 1;
    };
    const request = (path: string): Request =>
      new Request(`${BASE}${path}`, { headers: { host: "127.0.0.1:4747" } });
    await handle(request("/health"), keepOpen);
    expect(kept).toBe(0);
    const stream = frames(await handle(request("/api/events"), keepOpen));
    await handle(request("/api/wait?session=s1&timeout=1"), keepOpen);
    expect(kept).toBe(2);
    await stream.close();
  });
});

describe("the published site", () => {
  beforeEach(() => {
    mkdirSync(join(dir, "site"), { recursive: true });
    writeFileSync(join(dir, "site", "index.html"), "<!doctype html><h1>Tableaux</h1>");
    writeFileSync(join(dir, "site", "commande.md"), "# Passage de commande\n");
    writeFileSync(join(dir, "secret.txt"), "outside the site");
  });

  test("is served with the right types, the index by default", async () => {
    const index = await get("/pub/");
    expect(index.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await index.text()).toContain("Tableaux");
    const md = await get("/pub/commande.md");
    expect(md.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
  });

  test("never serves a file outside the site", async () => {
    for (const path of [
      "/pub/../secret.txt",
      "/pub/%2e%2e/secret.txt",
      "/pub/..%2fsecret.txt",
      "/pub/nope.html",
    ]) {
      expect((await get(path)).status).toBe(404);
    }
  });
});

describe("showing the page", () => {
  const shown: string[] = [];
  const able = (answer: boolean): Handler =>
    handler({
      hub,
      page: "",
      root: "/repo",
      siteDir: join(dir, "site"),
      show: async (address) => {
        shown.push(address);
        return answer;
      },
    });
  const ask = (to: Handler, headers: Record<string, string> = {}): Promise<Response> =>
    to(
      new Request(`${BASE}/api/open`, {
        method: "POST",
        headers: { host: "127.0.0.1:4747", "content-type": "application/json", ...headers },
        body: "{}",
      }),
    );

  test("the companion opens its own page when a shell asks, and says whether it could", async () => {
    shown.length = 0;
    expect(await (await ask(able(true))).json()).toEqual({ opened: true });
    expect(shown).toEqual([BASE]);
    expect(await (await ask(able(false))).json()).toEqual({ opened: false });
    // A companion with no way to show a page says so too.
    expect(await (await ask(handle)).json()).toEqual({ opened: false });
  });

  test("a foreign web page may not make windows pop up", async () => {
    shown.length = 0;
    expect((await ask(able(true), { origin: "https://evil.example" })).status).toBe(403);
    expect(shown).toEqual([]);
  });
});
