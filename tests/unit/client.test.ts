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
  showPage,
} from "../../src/cli/client.ts";

let dir: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "vico-client-")));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("findRoot climbs to the nearest directory holding .vico", () => {
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
  const ignore = join(dir, ".vico", ".gitignore");
  expect(readFileSync(ignore, "utf8")).toContain("sessions.jsonl\nserver.json\nsite/\n");
  expect(readFileSync(ignore, "utf8")).not.toContain("boards.jsonl");
  writeFileSync(ignore, "mine\n");
  initRoot(dir);
  expect(readFileSync(ignore, "utf8")).toBe("mine\n");
});

test("findServer is undefined without a note, and with a note that is not JSON", async () => {
  initRoot(dir);
  expect(await findServer(dir)).toBeUndefined();
  writeFileSync(join(dir, ".vico", "server.json"), "not json");
  expect(await findServer(dir)).toBeUndefined();
  writeFileSync(join(dir, ".vico", "server.json"), JSON.stringify({ url: 4747 }));
  expect(await findServer(dir)).toBeUndefined();
});

/** A workspace whose note points at a companion, and a fetch that fails the way `code` says. */
function noted(code: string): Fetch {
  initRoot(dir);
  writeFileSync(join(dir, ".vico", "server.json"), JSON.stringify({ url: "http://127.0.0.1:4747" }));
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
  expect(JSON.parse(readFileSync(join(dir, ".vico", "server.json"), "utf8"))).toEqual({
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
  expect(existsSync(join(dir, ".vico", "server.json"))).toBe(false);
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
