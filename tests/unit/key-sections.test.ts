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
  test("a kanban has five: moving about, a card moved or added, a card changed, the page, a lane heading", () => {
    const sections = keySections(rows("en", "kanban"), "en", "kanban");
    expect(sections.map((s) => s.title)).toEqual([
      "Moving about",
      "Moving a card, adding one",
      "Changing a card",
      "The page",
      "A lane heading",
    ]);
    expect(keysOf(sections[0])).toEqual(["Tab", "← → ↑ ↓", "Page ↑ ↓, Home, End"]);
    // The keys of a card are two sections (T304): fifteen rows under one heading were a column by themselves.
    expect(keysOf(sections[1])).toEqual(["Shift + ← → ↑ ↓", "Shift + Home, End", "Alt + ← → ↑ ↓", "A"]);
    expect(keysOf(sections[2])?.[0]).toBe("Enter or F2");
    expect(keysOf(sections[2])).toContain("Delete");
    expect(keysOf(sections[3])?.[0]).toBe("/ or ⌘K / Ctrl+K");
    expect(keysOf(sections[3])?.at(-1)).toBe("< and >, or [ and ]");
  });

  test("a plan says what the keyboard does to an axis under its own heading, not among the gestures of the mouse (T304)", () => {
    const told = withMoreKeys(MESSAGES.en.shortcutList("grid", true), "en");
    const axis = keySections(told, "en", "grid").at(-1);
    expect(axis?.title).toBe("An axis of the plan");
    expect(keysOf(axis)).toEqual(["Tab", "Enter or F2"]);
    expect(
      keySections(withMoreKeys(MESSAGES.fr.shortcutList("grid", true), "fr"), "fr", "grid").at(-1)?.title,
    ).toBe("Un axe du plan");
    for (const locale of ["en", "fr"] as const)
      for (const [gesture] of MESSAGES[locale].mouseList("grid")) expect(gesture).not.toMatch(/Tab|F2/);
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

  test("a board without lanes of its own has four, in French too; no key is lost", () => {
    const all = rows("fr", "graph");
    const sections = keySections(all, "fr", "graph");
    expect(sections.map((s) => s.title)).toEqual([
      "Se déplacer",
      "Déplacer une carte, en ajouter une",
      "Changer une carte",
      "La page",
    ]);
    expect(sections.flatMap((s) => s.rows)).toEqual(all);
    // Whatever the board and the language: every row is under one heading, in its order.
    for (const locale of ["en", "fr"] as const)
      for (const how of ["timeline", "lanes", "kanban", "grid", "graph"] as const) {
        const told = withMoreKeys(MESSAGES[locale].shortcutList(how, false), locale, how === "kanban");
        const under = keySections(told, locale, how).filter(
          (s) => !s.title.match(/heading|en-tête|ax[ie]s?/),
        );
        expect(under.flatMap((s) => s.rows)).toEqual(told);
        expect(under.length).toBe(4);
      }
  });
});
