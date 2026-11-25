/**
 * The sheet of keys in sections (T282): one long list said nothing of what
 * each key is for. The keys that move the keyboard, those that act on a card,
 * those of the page, and what a lane heading takes, each under its name.
 */
import { describe, expect, test } from "bun:test";
import { keySections } from "../../src/web/key-sections.ts";
import { MESSAGES } from "../../src/web/messages.ts";
import { withMoreKeys } from "../../src/web/more-keys.ts";

const rows = (locale: "en" | "fr", how: "kanban" | "graph") =>
  withMoreKeys(MESSAGES[locale].shortcutList(how, true), locale, how === "kanban");
const keysOf = (section: { rows: [string, string][] } | undefined) => section?.rows.map(([keys]) => keys);

describe("the keys of the sheet, in sections (T282)", () => {
  test("a kanban has four: moving about, a card, the page, a lane heading", () => {
    const sections = keySections(rows("en", "kanban"), "en", "kanban");
    expect(sections.map((s) => s.title)).toEqual([
      "Moving about",
      "Changing a card",
      "The page",
      "A lane heading",
    ]);
    expect(keysOf(sections[0])).toEqual(["Tab", "← → ↑ ↓", "Page ↑ ↓, Home, End"]);
    expect(keysOf(sections[1])?.[0]).toBe("Shift + ← → ↑ ↓");
    expect(keysOf(sections[1])).toContain("Delete");
    expect(keysOf(sections[2])?.[0]).toBe("/ or ⌘K / Ctrl+K");
    expect(keysOf(sections[2])?.at(-1)).toBe("< and >, or [ and ]");
  });

  test("what a lane heading takes is said key by key, no longer on one line", () => {
    const lane = keySections(rows("en", "kanban"), "en", "kanban").at(-1);
    expect(lane?.rows).toContainEqual(["Shift + Enter", "Write its subtitle"]);
    expect(lane?.rows).toContainEqual(["↓", "To the cards of the lane"]);
    expect(lane?.rows.length).toBe(7);
    const fr = keySections(rows("fr", "kanban"), "fr", "kanban").at(-1);
    expect(fr?.title).toBe("Un en-tête de colonne");
    expect(fr?.rows).toContainEqual(["Maj + Entrée", "Écrire son sous-titre"]);
  });

  test("a board without lanes of its own has three, in French too; no key is lost", () => {
    const all = rows("fr", "graph");
    const sections = keySections(all, "fr", "graph");
    expect(sections.map((s) => s.title)).toEqual(["Se déplacer", "Changer une carte", "La page"]);
    expect(sections.flatMap((s) => s.rows)).toEqual(all);
    // Whatever the board and the language: every row is under one heading, in its order.
    for (const locale of ["en", "fr"] as const)
      for (const how of ["timeline", "lanes", "kanban", "grid", "graph"] as const) {
        const told = withMoreKeys(MESSAGES[locale].shortcutList(how, false), locale, how === "kanban");
        const under = keySections(told, locale, how).filter((s) => !s.title.match(/heading|en-tête/));
        expect(under.flatMap((s) => s.rows)).toEqual(told);
        expect(under.length).toBe(3);
      }
  });
});
