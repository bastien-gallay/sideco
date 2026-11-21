/**
 * The address of a board, and of a card on it: `#/b/BOARD` and `#/b/BOARD/ID`.
 * An element id is unique only within its board, so a card's link carries both.
 */
import { describe, expect, test } from "bun:test";
import { type BoardId, type ElementId, isBoardId, isElementId } from "../../src/domain/ids.ts";
import { boardLink, cardLink, readLink } from "../../src/domain/links.ts";

const board = (id: string): BoardId => {
  if (!isBoardId(id)) throw new Error(id);
  return id;
};
const element = (id: string): ElementId => {
  if (!isElementId(id)) throw new Error(id);
  return id;
};

describe("a link to a board or a card", () => {
  test("a board's address, and a card's under it", () => {
    expect(boardLink(board("backlog"))).toBe("#/b/backlog");
    expect(cardLink(board("backlog"), element("T182"))).toBe("#/b/backlog/T182");
  });

  test("read back, it names the board, and the card when there is one", () => {
    expect(readLink("#/b/backlog")).toEqual({ board: board("backlog") });
    expect(readLink("#/b/types-de-boards/S129")).toEqual({
      board: board("types-de-boards"),
      card: element("S129"),
    });
  });

  test("anything else names nothing", () => {
    for (const hash of ["", "#", "#/b/", "#/b/Backlog", "#/b/backlog/t1", "#/b/backlog/T1/x", "#/x/backlog"])
      expect(readLink(hash)).toBeUndefined();
  });
});
