/**
 * The words a search found, marked in what the page shows of a card: case and
 * accents aside, as the search itself.
 */
import { describe, expect, test } from "bun:test";
import { markWords } from "../../src/domain/find.ts";

describe("the words found, marked", () => {
  test("each word found is a part of its own, the rest around it", () => {
    expect(markWords("Payer la note du traiteur", ["note", "traiteur"])).toEqual([
      { text: "Payer la " },
      { text: "note", found: true },
      { text: " du " },
      { text: "traiteur", found: true },
    ]);
  });

  test("case and accents aside, the text keeps its own", () => {
    expect(markWords("Écrire la Note", ["ecrire", "note"])).toEqual([
      { text: "Écrire", found: true },
      { text: " la " },
      { text: "Note", found: true },
    ]);
  });

  test("overlapping words make one mark, and a word that looks like an id marks that id only", () => {
    expect(markWords("relire", ["rel", "lire"])).toEqual([{ text: "relire", found: true }]);
    expect(markWords("T2 et T22", ["t2"])).toEqual([{ text: "T2", found: true }, { text: " et T22" }]);
  });

  test("nothing found: the text whole", () => {
    expect(markWords("Publier", ["quetzal"])).toEqual([{ text: "Publier" }]);
    expect(markWords("", ["x"])).toEqual([]);
  });
});
