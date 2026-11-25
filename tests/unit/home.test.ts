import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { findRoot, initRoot } from "../../src/cli/client.ts";
import { dataDir, homeDir, workspaces } from "../../src/server/start.ts";

let dir: string;
let home: string;
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "sideco-home-")));
  home = process.env.SIDECO_HOME ?? "";
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("the boards of every project live under SIDECO_HOME, else ~/.sideco", () => {
  expect(homeDir({ SIDECO_HOME: "/x/y" })).toBe("/x/y");
  expect(homeDir({})).toBe(join(homedir(), ".sideco"));
  expect(home).not.toBe("");
});

test("a new project keeps its boards out of its folder, under an id of its own", () => {
  const root = initRoot(join(dir, "shop"));
  expect(existsSync(join(root, ".sideco"))).toBe(false);
  const id = workspaces()[root];
  expect(id).toMatch(/^shop-[0-9a-f]{6}$/);
  expect(dataDir(root)).toBe(join(home, id ?? ""));
  expect(existsSync(dataDir(root))).toBe(true);
});

test("a project opened again keeps its id; two projects never share one", () => {
  const first = initRoot(join(dir, "a"));
  const id = workspaces()[first];
  expect(initRoot(first)).toBe(first);
  expect(workspaces()[first]).toBe(id);
  const second = initRoot(join(dir, "b"));
  expect(workspaces()[second]).not.toBe(id);
});

test("a project that already has a .sideco folder keeps its boards there", () => {
  const root = join(dir, "kept");
  mkdirSync(join(root, ".sideco"), { recursive: true });
  expect(initRoot(root)).toBe(root);
  expect(dataDir(root)).toBe(join(root, ".sideco"));
  expect(workspaces()[root]).toBeUndefined();
});

test("findRoot finds a project kept under SIDECO_HOME from any folder inside it", () => {
  const root = initRoot(join(dir, "deep"));
  mkdirSync(join(root, "src", "x"), { recursive: true });
  expect(findRoot(join(root, "src", "x"))).toBe(root);
  expect(findRoot(dir)).toBeUndefined();
});
