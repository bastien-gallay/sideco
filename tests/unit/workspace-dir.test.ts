import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRoot } from "../../src/cli/client.ts";
import { dataDir } from "../../src/server/start.ts";

const fresh = (): string => mkdtempSync(join(tmpdir(), "sideco-dir-"));

test("a new workspace keeps its boards under .sideco", () => {
  const root = fresh();
  expect(dataDir(root)).toBe(join(root, ".sideco"));
});

test("a workspace made before the rename keeps reading its .vico folder", () => {
  const root = fresh();
  mkdirSync(join(root, ".vico"));
  expect(dataDir(root)).toBe(join(root, ".vico"));
  expect(findRoot(join(root))).toBeDefined();
});

test("once moved to .sideco, the old folder is no longer read", () => {
  const root = fresh();
  mkdirSync(join(root, ".vico"));
  mkdirSync(join(root, ".sideco"));
  expect(dataDir(root)).toBe(join(root, ".sideco"));
});
