/**
 * The page follows a card that is given a new id (T224): what the reader holds
 * on to, the chosen card, the start of a link, goes on under the new id, and
 * the card says the id it went by.
 */
import { describe, expect, test } from "bun:test";
import { formerly } from "../../src/domain/i18n.ts";
import { layoutBoard } from "../../src/domain/layout/index.ts";
import { heldAfter } from "../../src/web/renumbered.ts";
import { table } from "../support.ts";

const SPRINT = `
board new "Sprint" --format kanban --id sprint
add task "Écrire"
add task "Relire"
`;

const renumbered = { board: "sprint", id: "T1", to: "T9" };

describe("what the page holds on to", () => {
  test("the card renumbered goes on under its new id", () => {
    expect(heldAfter("T1", "sprint", renumbered)).toBe("T9");
  });

  test("another card, or nothing held, stays as it was", () => {
    expect(heldAfter("T2", "sprint", renumbered)).toBe("T2");
    expect(heldAfter(null, "sprint", renumbered)).toBeNull();
  });

  test("a card of the same id on another board is not that card", () => {
    expect(heldAfter("T1", "retro", renumbered)).toBe("T1");
  });
});

describe("a card says the id it went by", () => {
  test("in the reader's language, the latest last", () => {
    expect(formerly(["T1"], "en")).toBe("formerly T1");
    expect(formerly(["T1", "T4"], "fr")).toBe("anciennement T1, T4");
    expect(formerly(undefined, "en")).toBeUndefined();
    expect(formerly([], "fr")).toBeUndefined();
  });

  test("in its tooltip, after its id, so a pointer and a screen reader both hear it", () => {
    const t = table(SPRINT);
    t.do({ kind: "renumber", board: "sprint", id: "T1", to: "T9" });
    const card = (locale: "en" | "fr") => layoutBoard(t.board(), locale).cards.find((c) => c.id === "T9");
    expect(card("en")?.tip).toStartWith("T9 · formerly T1 · ");
    expect(card("fr")?.tip).toStartWith("T9 · anciennement T1 · ");
    expect(layoutBoard(t.board()).cards.find((c) => c.id === "T2")?.tip).not.toContain("formerly");
  });
});
