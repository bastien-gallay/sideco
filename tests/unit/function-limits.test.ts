/**
 * The function limits of docs/coding-standards.md (about 40 lines, a cognitive
 * complexity of 15, few nested blocks) are guides, which biome reports as infos.
 * They may not be broken more often than today: the functions over each limit
 * are counted per module, and a count may only come down.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { countOver, drift, FUNCTION_LIMITS } from "../function-limits.ts";

const ROOT = join(import.meta.dir, "..", "..");

describe("the checker", () => {
  test("a module with more functions over a limit than allowed breaks the rule", () => {
    expect(drift({ "src/a.ts": { lines: 1 } }, { "src/a.ts": { lines: 2 } })).toEqual([
      "src/a.ts has 2 functions over the lines limit, 1 allowed: split the one you made longer",
    ]);
  });

  test("a module that has none allowed breaks the rule with its first", () => {
    expect(drift({}, { "src/a.ts": { complexity: 1 } })).toEqual([
      "src/a.ts has 1 function over the complexity limit, 0 allowed: split the one you made more complex",
    ]);
  });

  test("a module with fewer than allowed asks for its count to come down", () => {
    expect(drift({ "src/a.ts": { nesting: 3 } }, { "src/a.ts": { nesting: 1 } })).toEqual([
      "src/a.ts has 1 function over the nesting limit, 3 allowed: lower it to 1 in tests/function-limits.ts",
    ]);
  });

  test("a module at its count is fine", () => {
    expect(drift({ "src/a.ts": { lines: 2 } }, { "src/a.ts": { lines: 2 } })).toEqual([]);
  });

  test("biome's infos are counted per module and per limit", () => {
    const report = {
      diagnostics: [
        { category: "lint/complexity/noExcessiveLinesPerFunction", location: { path: "src/a.ts" } },
        { category: "lint/complexity/noExcessiveLinesPerFunction", location: { path: "src/a.ts" } },
        { category: "lint/complexity/noExcessiveCognitiveComplexity", location: { path: "src/b.ts" } },
        { category: "lint/nursery/noExcessiveNestedBlocks", location: { path: "src/b.ts" } },
        { category: "lint/style/useConst", location: { path: "src/b.ts" } },
      ],
    };
    expect(countOver(report)).toEqual({
      "src/a.ts": { lines: 2 },
      "src/b.ts": { complexity: 1, nesting: 1 },
    });
  });
});

test("no module of src/ breaks the function limits more often than it did", () => {
  const run = Bun.spawnSync(
    ["bunx", "biome", "lint", "src", "--reporter=json", "--max-diagnostics=none", "--diagnostic-level=info"],
    { cwd: ROOT },
  );
  const counts = countOver(JSON.parse(run.stdout.toString()));
  expect(drift(FUNCTION_LIMITS, counts)).toEqual([]);
});
