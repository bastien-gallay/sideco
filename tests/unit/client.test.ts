import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Blocked,
  ensureServer,
  type Fetch,
  findRoot,
  findServer,
  initRoot,
  listen,
  RETRY_PAUSE_MS,
  showPage,
  WAIT_LEG_MS,
} from "../../src/cli/client.ts";

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "sideco-client-")));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("findRoot climbs to the nearest directory holding .sideco", () => {
  const root = join(dir, "repo");
  const deep = join(root, "src", "domain");
  mkdirSync(deep, { recursive: true });
  expect(findRoot(deep)).toBeUndefined();
  initRoot(root);
  expect(findRoot(deep)).toBe(root);
  expect(findRoot(root)).toBe(root);
});

test("findRoot names the workspace by its real path, so a symlinked cwd finds the same companion", () => {
  const root = join(dir, "repo");
  mkdirSync(join(root, "src"), { recursive: true });
  initRoot(root);
  symlinkSync(root, join(dir, "alias"));
  expect(findRoot(join(dir, "alias", "src"))).toBe(root);
});

test("findRoot of a directory that does not exist is undefined, not an exception", () => {
  expect(findRoot(join(dir, "nowhere", "deeper"))).toBeUndefined();
});

test("initRoot keeps session traces out of git, and leaves an edited .gitignore alone", () => {
  initRoot(dir);
  const ignore = join(dir, ".sideco", ".gitignore");
  expect(readFileSync(ignore, "utf8")).toContain("sessions.jsonl\nserver.json\nsite/\n");
  expect(readFileSync(ignore, "utf8")).not.toContain("boards.jsonl");
  writeFileSync(ignore, "mine\n");
  initRoot(dir);
  expect(readFileSync(ignore, "utf8")).toBe("mine\n");
});

test("findServer is undefined without a note, and with a note that is not JSON", async () => {
  initRoot(dir);
  expect(await findServer(dir)).toBeUndefined();
  writeFileSync(join(dir, ".sideco", "server.json"), "not json");
  expect(await findServer(dir)).toBeUndefined();
  writeFileSync(join(dir, ".sideco", "server.json"), JSON.stringify({ url: 4747 }));
  expect(await findServer(dir)).toBeUndefined();
});

/** A workspace whose note points at a companion, and a fetch that fails the way `code` says. */
function noted(code: string): Fetch {
  initRoot(dir);
  writeFileSync(join(dir, ".sideco", "server.json"), JSON.stringify({ url: "http://127.0.0.1:4747" }));
  return (async () => {
    throw Object.assign(new TypeError(`${code}: Was there a typo in the url or port?`), { code });
  }) as unknown as Fetch;
}

test("a companion that is not there is simply not found", async () => {
  expect(await findServer(dir, 50, noted("ConnectionRefused"))).toBeUndefined();
});

test("a shell forbidden to reach the loopback says so, instead of 'not running'", async () => {
  const refused = findServer(dir, 50, noted("EPERM"));
  expect(refused).rejects.toBeInstanceOf(Blocked);
  expect(refused).rejects.toThrow(
    "this shell may not connect to the companion at http://127.0.0.1:4747 (EPERM): a sandbox blocks local connections. Run this command outside the sandbox.",
  );
});

test("a blocked shell does not try to start a second companion, and answers at once", async () => {
  const started = performance.now();
  expect(ensureServer(dir, noted("EPERM"))).rejects.toBeInstanceOf(Blocked);
  await ensureServer(dir, noted("EPERM")).catch(() => {});
  expect(performance.now() - started).toBeLessThan(500);
  expect(JSON.parse(readFileSync(join(dir, ".sideco", "server.json"), "utf8"))).toEqual({
    url: "http://127.0.0.1:4747",
  });
});

test("a shell forbidden to listen does not wait for a companion that cannot start", async () => {
  initRoot(dir);
  const started = performance.now();
  const refused = ensureServer(dir, fetch, () => false);
  expect(refused).rejects.toBeInstanceOf(Blocked);
  expect(refused).rejects.toThrow(
    "this shell may not start the companion: a sandbox blocks local ports. Run this command outside the sandbox.",
  );
  await refused.catch(() => {});
  expect(performance.now() - started).toBeLessThan(500);
  expect(existsSync(join(dir, ".sideco", "server.json"))).toBe(false);
});

test("showPage asks the companion to open its page, and takes any other answer as a no", async () => {
  const asked: string[] = [];
  const answering = (status: number, body: unknown): Fetch =>
    (async (input: string | URL | Request, init?: RequestInit) => {
      asked.push(`${init?.method} ${String(input)}`);
      return Response.json(body, { status });
    }) as Fetch;
  const url = "http://127.0.0.1:4747";
  expect(await showPage({ url, fetch: answering(200, { opened: true }) })).toBe(true);
  expect(asked).toEqual([`POST ${url}/api/open`]);
  expect(await showPage({ url, fetch: answering(200, { opened: false }) })).toBe(false);
  // A companion from before this route answers 404; one out of reach throws.
  expect(await showPage({ url, fetch: answering(404, { error: "not found" }) })).toBe(false);
  const unreachable = (async () => {
    throw new Error("connection refused");
  }) as unknown as Fetch;
  expect(await showPage({ url, fetch: unreachable })).toBe(false);
});

/** As long as an agent at rest is listened for. */
const REWAKE_LIKE_MS = 12 * 60 * 60 * 1000;

/** A companion whose long poll answers these outcomes in turn, and notes how long each call asked for. */
function polled(outcomes: string[], asked: number[]): Fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    asked.push(Number(url.searchParams.get("timeout")));
    const outcome = outcomes.shift() ?? "timeout";
    return Response.json({ outcome, text: outcome === "passed" ? "The human passed you the turn." : "" });
  }) as Fetch;
}

test("listening longer than a request can stay open is done in legs, each short enough", async () => {
  const asked: number[] = [];
  const url = "http://127.0.0.1:4747";
  const waited = await listen({ url, fetch: polled(["timeout", "timeout", "passed"], asked) }, "s1", 540_000);
  expect(waited).toEqual({ outcome: "passed", text: "The human passed you the turn." });
  expect(asked).toEqual([WAIT_LEG_MS, WAIT_LEG_MS, 540_000 - 2 * WAIT_LEG_MS]);
  // The runtime gives up on a request left silent for 360 s (measured, Bun 1.4.4): a leg ends well before.
  expect(WAIT_LEG_MS).toBeLessThan(300_000);
});

test("once parked, the listening does not ask for a page again: one that reloads must not end it", async () => {
  const watched: (string | null)[] = [];
  const fetch = (async (input: string | URL | Request) => {
    watched.push(new URL(String(input)).searchParams.get("watched"));
    return Response.json({ outcome: watched.length < 3 ? "timeout" : "passed", text: "" });
  }) as Fetch;
  const waited = await listen({ url: "http://127.0.0.1:4747", fetch }, "s1", 3 * WAIT_LEG_MS, true);
  expect(waited.outcome).toBe("passed");
  expect(watched).toEqual(["1", null, null]);
});

test("once parked, a request that fails is made again after a pause: a companion restarted is heard again", async () => {
  const url = "http://127.0.0.1:4747";
  const pauses: number[] = [];
  const rest = async (ms: number): Promise<void> => void pauses.push(ms);
  /** Answers in turn; "down" is a companion out of reach. */
  const companion = (answers: string[]): Fetch =>
    (async () => {
      const outcome = answers.shift() ?? "down";
      if (outcome === "down") throw new Error("connection refused");
      return Response.json({ outcome, text: "" });
    }) as unknown as Fetch;

  const heard = await listen(
    { url, fetch: companion(["timeout", "down", "down", "passed"]) },
    "s1",
    REWAKE_LIKE_MS,
    true,
    rest,
  );
  expect(heard.outcome).toBe("passed");
  expect(pauses).toEqual([RETRY_PAUSE_MS, RETRY_PAUSE_MS]);

  // Out of reach from the start, there is nothing to listen to; gone for good, the listening gives up.
  pauses.length = 0;
  expect(listen({ url, fetch: companion([]) }, "s1", REWAKE_LIKE_MS, true, rest)).rejects.toThrow("refused");
  expect(pauses).toEqual([]);
  expect(listen({ url, fetch: companion(["timeout"]) }, "s1", REWAKE_LIKE_MS, true, rest)).rejects.toThrow(
    "refused",
  );
});

test("listening stops at its time, and at once when the session moves on", async () => {
  const asked: number[] = [];
  const url = "http://127.0.0.1:4747";
  expect(await listen({ url, fetch: polled([], asked) }, "s1", 300_000)).toEqual({
    outcome: "timeout",
    text: "",
  });
  expect(asked.reduce((sum, ms) => sum + ms, 0)).toBe(300_000);
  asked.length = 0;
  expect((await listen({ url, fetch: polled(["released"], asked) }, "s1", 540_000)).outcome).toBe("released");
  expect(asked).toHaveLength(1);
  asked.length = 0;
  expect((await listen({ url, fetch: polled([], asked) }, "s1", 5_000)).outcome).toBe("timeout");
  expect(asked).toEqual([5_000]);
});
