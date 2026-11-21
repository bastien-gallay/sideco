import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRoot } from "../../src/cli/client.ts";
import { openJournal } from "../../src/server/journal.ts";
import { dataDir, readJournal, readWorkspace } from "../../src/server/start.ts";

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

test("the workspace read from a root is the one its journal holds, with no server running", () => {
  const root = fresh();
  openJournal(dataDir(root)).append([
    {
      seq: 1,
      ts: "2026-11-21T10:00:00.000Z",
      actor: "human",
      event: "BoardCreated",
      board: "b",
      title: "B",
      format: "kanban",
    },
  ]);
  const ws = readWorkspace(root);
  expect(ws.seq).toBe(1);
  expect(ws.boards.map((b) => b.id)).toEqual(["b"]);
});

test("a root with no journal yet reads as an empty workspace", () => {
  expect(readWorkspace(fresh()).boards).toEqual([]);
});

test("reading a journal says what it weighs and how long it took to load and replay", () => {
  const root = fresh();
  openJournal(dataDir(root)).append([
    {
      seq: 1,
      ts: "2026-11-21T10:00:00.000Z",
      actor: "human",
      event: "BoardCreated",
      board: "b",
      title: "B",
      format: "kanban",
    },
  ]);
  const ticks = [100, 142.4];
  const read = readJournal(root, () => ticks.shift() ?? 0);
  expect(read.workspace.seq).toBe(1);
  expect(read.events).toBe(1);
  expect(read.bytes).toBeGreaterThan(50);
  expect(read.ms).toBeCloseTo(42.4);
});

test("a root with no journal weighs nothing", () => {
  const read = readJournal(fresh());
  expect([read.events, read.bytes]).toEqual([0, 0]);
});
