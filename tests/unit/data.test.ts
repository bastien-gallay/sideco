import { expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataText } from "../../src/cli/data.ts";
import { register } from "../../src/server/start.ts";

test("sideco data lists each project kept at home, its weight, and a folder that is gone", () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "sideco-data-")));
  expect(dataText(home)).toBe(`no project keeps its boards in ${home}`);
  const here = realpathSync(mkdtempSync(join(tmpdir(), "sideco-here-")));
  writeFileSync(join(register(here, home), "boards.jsonl"), "x".repeat(2000));
  register("/nowhere/gone", home);
  const lines = dataText(home).split("\n");
  expect(lines[0]).toBe(home);
  expect(lines[1]).toMatch(/^ {2}sideco-here-\w+-[0-9a-f]{6} +2 KB {2}.+$/);
  expect(lines[1]).toEndWith(here);
  expect(lines[2]).toMatch(/^ {2}gone-[0-9a-f]{6} +0 KB {2}\/nowhere\/gone {2}\(folder gone\)$/);
  rmSync(home, { recursive: true, force: true });
});
