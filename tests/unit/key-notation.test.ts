/**
 * How the sheet writes a key (T305): for the reader's keyboard only, a plus spaced everywhere, a key drawn for
 * each key.
 */
import { describe, expect, test } from "bun:test";
import { ownKeys, pieces } from "../../src/web/key-notation.ts";
import { keySections } from "../../src/web/key-sections.ts";
import { MESSAGES } from "../../src/web/messages.ts";
import { withMoreKeys } from "../../src/web/more-keys.ts";

describe("the keys of a row, as the reader's keyboard writes them (T305)", () => {
  test("a Mac reads ⌘, another keyboard Ctrl, never both", () => {
    expect(ownKeys("⌘Z / Ctrl+Z", true)).toBe("⌘Z");
    expect(ownKeys("⌘Z / Ctrl+Z", false)).toBe("Ctrl + Z");
    expect(ownKeys("⇧⌘Z / Ctrl+Shift+Z or Ctrl+Y", true)).toBe("⇧⌘Z");
    expect(ownKeys("⇧⌘Z / Ctrl+Shift+Z or Ctrl+Y", false)).toBe("Ctrl + Shift + Z or Ctrl + Y");
    // The slash of the search is a key, not the bar between two keyboards.
    expect(ownKeys("/ or ⌘K / Ctrl+K", true)).toBe("/ or ⌘K");
    expect(ownKeys("/ ou ⌘K / Ctrl+K", false)).toBe("/ ou Ctrl + K");
    expect(ownKeys("⌘↵ / Ctrl+Entrée", false)).toBe("Ctrl + Entrée");
  });

  test("a row that names no keyboard is left as it is, the key + too", () => {
    for (const keys of ["Shift + ← → ↑ ↓", "+ or Alt + ← →", "Enter or F2", "< and >, or [ and ]", "?"])
      for (const mac of [true, false]) expect(ownKeys(keys, mac)).toBe(keys);
  });

  test("each key is drawn as one key, the words between left as words", () => {
    expect(pieces("Enter or F2")).toEqual([{ key: "Enter" }, { word: " or " }, { key: "F2" }]);
    expect(pieces("< et >, ou [ et ]").map((piece) => ("key" in piece ? piece.key : piece.word))).toEqual([
      "<",
      " et ",
      ">",
      ", ou ",
      "[",
      " et ",
      "]",
    ]);
    expect(pieces("B, S")).toEqual([{ key: "B" }, { word: ", " }, { key: "S" }]);
    expect(pieces("+ or Alt + ← →")).toEqual([{ key: "+" }, { word: " or " }, { key: "Alt + ← →" }]);
    expect(pieces("Ctrl + Shift + Z or Ctrl + Y").filter((piece) => "key" in piece).length).toBe(2);
    // End alone is another key than End held with Shift: the row stays one key.
    expect(pieces("Shift + Home, End")).toEqual([{ key: "Shift + Home, End" }]);
    expect(pieces("?")).toEqual([{ key: "?" }]);
  });

  test("on every sheet, in both languages and on both keyboards: no key names two keyboards, none is joined", () => {
    for (const locale of ["en", "fr"] as const)
      for (const how of ["timeline", "lanes", "kanban", "grid", "graph"] as const)
        for (const mac of [true, false]) {
          const rows = withMoreKeys(
            MESSAGES[locale].shortcutList(how, true),
            locale,
            how === "kanban",
            how !== "graph",
          );
          for (const section of keySections(rows, locale, how))
            for (const [keys] of section.rows) {
              const own = ownKeys(keys, mac);
              expect(own.includes("⌘") && own.includes("Ctrl")).toBe(false);
              expect(own).not.toMatch(/\S\+\S/);
              // The longest key drawn fits the column of keys, some twenty letters wide.
              for (const piece of pieces(own))
                if ("key" in piece) expect(piece.key.length).toBeLessThanOrEqual(20);
              expect(
                pieces(own)
                  .map((piece) => ("key" in piece ? piece.key : piece.word))
                  .join(""),
              ).toBe(own);
            }
        }
  });

  test("a page further is said by its keys, not by Page and an arrow", () => {
    const keys = (locale: "en" | "fr") =>
      withMoreKeys(MESSAGES[locale].shortcutList("kanban", true), locale, true).map(([key]) => key);
    expect(keys("en")).toContain("PgUp, PgDn, Home, End");
    expect(keys("fr")).toContain("Pg préc., Pg suiv., Début, Fin");
  });

  test("two ⌘ / Ctrl alternatives on one row keep each side to its own keyboard (T320)", () => {
    expect(ownKeys("⌘Z / Ctrl+Z or ⇧⌘Z / Ctrl+Shift+Z", true)).toBe("⌘Z or ⇧⌘Z");
    expect(ownKeys("⌘Z / Ctrl+Z or ⇧⌘Z / Ctrl+Shift+Z", false)).toBe("Ctrl + Z or Ctrl + Shift + Z");
    expect(ownKeys("⌘[ / Ctrl+[, ⌘] / Ctrl+]", true)).toBe("⌘[, ⌘]");
    expect(ownKeys("⌘[ / Ctrl+[, ⌘] / Ctrl+]", false)).toBe("Ctrl + [, Ctrl + ]");
  });

  test("a single key after a held comma does not break the held key apart (T320)", () => {
    expect(pieces("Shift + Home, End, or Esc")).toEqual([
      { key: "Shift + Home, End" },
      { word: ", or " },
      { key: "Esc" },
    ]);
    expect(pieces("Shift + Home, End or Esc")).toEqual([
      { key: "Shift + Home, End" },
      { word: " or " },
      { key: "Esc" },
    ]);
    expect(pieces("Ctrl + Z, Ctrl + Y")).toEqual([{ key: "Ctrl + Z" }, { word: ", " }, { key: "Ctrl + Y" }]);
  });

  test("hints outside the sheet space their plus and name only the reader's keyboard (T320)", () => {
    for (const locale of ["en", "fr"] as const) {
      const messages = MESSAGES[locale];
      for (const hint of [messages.laneKeys, messages.saveLines]) {
        expect(hint).not.toMatch(/\S\+\S/);
        expect(hint.includes("⌘") && hint.includes("Ctrl")).toBe(false);
      }
      const sendKeys = locale === "fr" ? ["⌘↵", "Ctrl + Entrée"] : ["⌘↵", "Ctrl + Enter"];
      for (const key of sendKeys) {
        const detail = messages.detailKeys(key);
        expect(detail).toContain(key);
        expect(detail).not.toMatch(/\S\+\S/);
        expect(detail.includes("⌘") && detail.includes("Ctrl")).toBe(false);
      }
    }
  });
});
