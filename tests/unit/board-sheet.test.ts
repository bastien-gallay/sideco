/** The sheet of a board's title and question sends only what changed (T289, T290). */
import { describe, expect, test } from "bun:test";
import { changes } from "../../src/web/board-changes.ts";

const board = { id: "b", title: "Rétro", purpose: "Qu'a-t-on appris ?" };

describe("the sheet of a board's title and question", () => {
  test("sends nothing when nothing changed", () => {
    expect(changes(board, "Rétro", "Qu'a-t-on appris ?")).toEqual([]);
  });

  test("retitles, and asks another question, each only when changed", () => {
    expect(changes(board, "Rétro 13", "Qu'a-t-on appris ?")).toEqual([
      { kind: "retitle", board: "b", title: "Rétro 13" },
    ]);
    expect(changes(board, "Rétro", "Quoi garder ?")).toEqual([
      { kind: "purpose", board: "b", purpose: "Quoi garder ?" },
    ]);
  });

  test("an emptied question gives the workshop's back; an emptied title is not sent", () => {
    expect(changes(board, "", "")).toEqual([{ kind: "purpose", board: "b", purpose: "" }]);
    expect(changes({ id: "b", title: "Rétro" }, "Rétro", "")).toEqual([]);
  });
});
