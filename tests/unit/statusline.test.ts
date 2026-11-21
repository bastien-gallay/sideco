import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { statusLine, statusLineFor } from "../../src/cli/statusline.ts";

const URL = "http://127.0.0.1:4747";
const ESC = "\x1b";
let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "sideco-status-")));
  mkdirSync(join(root, ".sideco"));
  mkdirSync(join(root, "src"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("a running companion is its address, written out and clickable", () => {
  expect(statusLine(URL)).toBe(`${ESC}]8;;${URL}\x07sideco · 127.0.0.1:4747${ESC}]8;;\x07`);
});

test("a workspace with no companion says so, with no link", () => {
  expect(statusLine(undefined)).toBe("sideco · not running");
});

test("the line follows the directory Claude Code is in, from anywhere under the workspace", async () => {
  const seen: string[] = [];
  const locate = async (at: string) => {
    seen.push(at);
    return URL;
  };
  const line = await statusLineFor(JSON.stringify({ workspace: { current_dir: join(root, "src") } }), locate);
  expect(line).toBe(statusLine(URL));
  expect(seen).toEqual([root]);
  expect(await statusLineFor(JSON.stringify({ cwd: root }), locate)).toBe(statusLine(URL));
});

test("outside a workspace, or with input it cannot read, the line is empty and nothing is asked", async () => {
  const locate = async () => {
    throw new Error("no companion is looked for");
  };
  expect(await statusLineFor(JSON.stringify({ cwd: tmpdir() }), locate)).toBe("");
  expect(await statusLineFor("not json", locate)).toBe("");
  expect(await statusLineFor("null", locate)).toBe("");
});

test("a companion that cannot be reached is not running, never an error", async () => {
  const blocked = async () => {
    throw new Error("EPERM");
  };
  expect(await statusLineFor(JSON.stringify({ cwd: root }), blocked)).toBe(statusLine(undefined));
});
