import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findServer, initRoot } from "../../src/cli/client.ts";
import { dataDir, PROTOCOL, type Running, start, workspaces } from "../../src/server/start.ts";

const project = (name: string): string =>
  initRoot(join(realpathSync(mkdtempSync(join(tmpdir(), "sideco-daemon-"))), name));
const host = (url: string) => ({ host: new URL(url).host });
let running: Running | undefined;
afterEach(() => running?.stop());

test("one companion serves each project under /w/<id>/, each with its own journal", async () => {
  const shop = project("shop");
  const blog = project("blog");
  running = await start(shop, 0);
  const base = running.base;
  expect(running.url).toBe(`${base}/w/${workspaces()[shop]}`);
  const blogUrl = `${base}/w/${workspaces()[blog]}`;
  for (const [url, title] of [
    [running.url, "Shop"],
    [blogUrl, "Blog"],
  ] as const) {
    const posted = await fetch(`${url}/api/commands`, {
      method: "POST",
      headers: { ...host(base), "content-type": "application/json" },
      body: JSON.stringify({
        actor: "agent",
        commands: [{ kind: "create-board", board: "b", title, format: "kanban" }],
      }),
    });
    expect(posted.status).toBe(200);
  }
  expect(readFileSync(join(dataDir(shop), "boards.jsonl"), "utf8")).toContain('"Shop"');
  expect(readFileSync(join(dataDir(blog), "boards.jsonl"), "utf8")).toContain('"Blog"');
  expect(readFileSync(join(dataDir(shop), "boards.jsonl"), "utf8")).not.toContain('"Blog"');
});

test("the companion says it is Sideco and which protocol it speaks; a project answers for itself", async () => {
  const shop = project("shop");
  running = await start(shop, 0);
  expect(await (await fetch(`${running.base}/health`)).json()).toMatchObject({
    name: "sideco",
    protocol: PROTOCOL,
  });
  expect(await (await fetch(`${running.url}/health`)).json()).toMatchObject({
    name: "sideco",
    workspace: shop,
  });
  expect((await fetch(`${running.base}/w/nobody-000000/health`)).status).toBe(404);
});

test("a project opened by the companion leaves a note there, so an older command line finds it", async () => {
  const shop = project("shop");
  const blog = project("blog");
  running = await start(shop, 0);
  expect(existsSync(join(dataDir(blog), "server.json"))).toBe(false);
  await fetch(`${running.base}/w/${workspaces()[blog]}/health`);
  expect(JSON.parse(readFileSync(join(dataDir(blog), "server.json"), "utf8")).url).toBe(
    `${running.base}/w/${workspaces()[blog]}`,
  );
  expect((await findServer(blog))?.url).toBe(`${running.base}/w/${workspaces()[blog]}`);
  running.stop();
  running = undefined;
  expect(existsSync(join(dataDir(blog), "server.json"))).toBe(false);
});

test("a project another companion still holds is refused, so a journal never has two writers", async () => {
  const shop = project("shop");
  const held = project("held");
  mkdirSync(dataDir(held), { recursive: true });
  writeFileSync(
    join(dataDir(held), "server.json"),
    JSON.stringify({ url: "http://127.0.0.1:1", pid: process.ppid }),
  );
  running = await start(shop, 0);
  expect((await fetch(`${running.base}/w/${workspaces()[held]}/health`)).status).toBe(409);
});

test("the page of a project is served under its address, with a slash so its own requests stay inside", async () => {
  const shop = project("shop");
  running = await start(shop, 0);
  const bare = await fetch(running.url, { redirect: "manual" });
  expect(bare.status).toBe(308);
  expect(bare.headers.get("location")).toBe(`${new URL(running.url).pathname}/`);
  expect((await fetch(`${running.url}/`)).headers.get("content-type")).toContain("text/html");
});

test("the companion's own address leads to the one project it serves, or lists them", async () => {
  const shop = project("shop");
  running = await start(shop, 0);
  const one = await fetch(`${running.base}/`, { redirect: "manual" });
  expect(one.headers.get("location")).toBe(`/w/${workspaces()[shop]}/`);
  const blog = project("blog");
  await fetch(`${running.base}/w/${workspaces()[blog]}/health`);
  const list = await (await fetch(`${running.base}/`)).text();
  expect(list).toContain(`href="/w/${workspaces()[shop]}/"`);
  expect(list).toContain(`href="/w/${workspaces()[blog]}/"`);
  expect(list).toContain(blog);
});
