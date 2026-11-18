/**
 * English by default, French on request: the workshop vocabulary, the drawing
 * and the exports speak the reader's language; what the agent reads stays English.
 */
import { describe, expect, test } from "bun:test";
import { describeBoard } from "../../src/domain/digest.ts";
import { FORMATS } from "../../src/domain/formats.ts";
import { asLocale, DEFAULT_LOCALE, LOCALES } from "../../src/domain/i18n.ts";
import { layoutBoard } from "../../src/domain/layout/index.ts";
import { cardName } from "../../src/domain/layout/scene.ts";
import { KANBAN, ORDERING, table } from "../support.ts";

test("English is the default, and French is the other language", () => {
  expect(DEFAULT_LOCALE).toBe("en");
  expect([...LOCALES]).toEqual(["en", "fr"]);
});

test("a locale is read from what a shell or a browser calls a language", () => {
  expect(asLocale("fr")).toBe("fr");
  expect(asLocale("fr-FR")).toBe("fr");
  expect(asLocale("fr_FR.UTF-8")).toBe("fr");
  expect(asLocale("EN")).toBe("en");
  expect(asLocale("de")).toBeUndefined();
  expect(asLocale("")).toBeUndefined();
  expect(asLocale(undefined)).toBeUndefined();
});

describe.each(FORMATS.map((f) => [f.id, f] as const))("format %s", (_id, format) => {
  test("says its name, its question, its types and its lanes in every language", () => {
    const texts = [
      format.name,
      format.purpose,
      ...format.types.flatMap((t) => [t.label, t.hint]),
      ...format.lanes.flatMap((l) => (l.hint ? [l.label, l.hint] : [l.label])),
    ];
    for (const text of texts) for (const locale of LOCALES) expect(text[locale].trim()).not.toBe("");
  });
});

describe("the drawing", () => {
  const lanes = (locale?: "en" | "fr"): string[] =>
    layoutBoard(table(KANBAN).board(), locale)
      .bands.filter((b) => b.kind === "lane")
      .map((b) => b.label);
  const rows = (locale?: "en" | "fr"): string[] =>
    layoutBoard(table(ORDERING).board(), locale)
      .bands.filter((b) => b.kind === "row")
      .map((b) => b.label);

  test("names lanes and type rows in English unless asked otherwise", () => {
    expect(lanes()).toEqual(["To do", "Doing", "Done"]);
    expect(lanes("fr")).toEqual(["À faire", "En cours", "Fait"]);
    expect(rows()).toContain("Event");
    expect(rows("fr")).toContain("Événement");
  });

  test("a card's tooltip says its type and who added it, and its name says its words first, in the reader's language", () => {
    const e1 = (locale?: "en" | "fr") =>
      layoutBoard(table(ORDERING).board(), locale).cards.find((c) => c.id === "E1");
    expect(e1()?.tip).toBe("E1 · Event · added by Claude");
    expect(e1("fr")?.tip).toBe("E1 · Événement · ajouté par Claude");
    const fr = e1("fr");
    expect(fr && cardName(fr)).toBe("Commande passée · E1 · Événement · ajouté par Claude");
  });
});

test("what the agent reads is English, whatever the reader's language", () => {
  expect(describeBoard(table(KANBAN).board())).toContain("lane todo (To do)");
});
