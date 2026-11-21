/**
 * The dependency rule of docs/coding-standards.md: imports point inward, to a
 * domain that does no I/O. Each module of src/ is read, and each import it makes
 * is checked against what its layer may reach.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { breaches } from "../layers.ts";

const ROOT = join(import.meta.dir, "..", "..");

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts"))
    .map((name) => join(dir, name));
}

describe("the checker", () => {
  test("the domain reaching the server breaks the rule", () => {
    expect(breaches("src/domain/layout/x.ts", 'import { Hub } from "../../server/hub.ts";')).toEqual([
      "src/domain/layout/x.ts imports ../../server/hub.ts: the domain may not reach the server",
    ]);
  });

  test("the domain reaching the platform breaks the rule", () => {
    expect(breaches("src/domain/x.ts", 'import { readFileSync } from "node:fs";')).toEqual([
      "src/domain/x.ts imports node:fs: the domain may not reach the platform",
    ]);
  });

  test("the page reaching the server breaks the rule, even by a dynamic import", () => {
    expect(breaches("src/web/x.ts", 'const hub = await import("../server/hub.ts");')).toEqual([
      "src/web/x.ts imports ../server/hub.ts: the page may not reach the server",
    ]);
  });

  test("the server reaching the command line breaks the rule", () => {
    expect(breaches("src/server/x.ts", 'export { main } from "../cli/main.ts";')).toEqual([
      "src/server/x.ts imports ../cli/main.ts: the server may not reach the command line",
    ]);
  });

  test("the command line reaching the server past its entry point breaks the rule", () => {
    expect(breaches("src/cli/x.ts", 'import { openJournal } from "../server/journal.ts";')).toEqual([
      "src/cli/x.ts imports ../server/journal.ts: the command line may reach the server only through src/server/start.ts",
    ]);
  });

  test("an import inward, or within its layer, keeps it", () => {
    const source = [
      'import type { Board } from "../workspace.ts";',
      'import { curve } from "./scene.ts";',
    ].join("\n");
    expect(breaches("src/domain/layout/x.ts", source)).toEqual([]);
    expect(breaches("src/web/x.ts", 'import { apply } from "../domain/workspace.ts";')).toEqual([]);
    expect(breaches("src/cli/x.ts", 'import { start } from "../server/start.ts";')).toEqual([]);
  });

  test("a word that only looks like an import is not one", () => {
    expect(breaches("src/domain/x.ts", '// the page says "import from ../server" here')).toEqual([]);
  });
});

test("every module of src/ keeps the dependency rule", () => {
  const found = ["src/domain", "src/server", "src/cli", "src/web"]
    .flatMap(sources)
    .flatMap((path) => breaches(relative(ROOT, join(ROOT, path)), readFileSync(join(ROOT, path), "utf8")));
  expect(found).toEqual([]);
});
