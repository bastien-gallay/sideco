/**
 * The workshops' table of the French guide says each kind of card and its
 * letter as the code does (T300, AT1): the letters changed once, and the guide
 * kept the old ones for four workshops out of seven.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FORMATS } from "../../src/domain/formats.ts";

const guide = readFileSync("docs/guide.fr.md", "utf8");

/** The kinds of card a row of the table names, each with its letter: `actor` `P` → "actor P". */
function kindsOf(format: string): string[] {
  const row = guide.split("\n").find((line) => line.startsWith(`| \`${format}\` |`));
  const cell = row?.split("|").at(-2) ?? "";
  return [...cell.matchAll(/`([a-z-]+)` `([A-Z])`/g)].map(([, kind, letter]) => `${kind} ${letter}`);
}

test.each(FORMATS.map((format) => [format.id, format]))(
  "guide.fr.md says the kinds of %s and their letters",
  (_, format) => {
    expect(kindsOf(format.id)).toEqual(format.types.map((type) => `${type.id} ${type.prefix}`));
  },
);
