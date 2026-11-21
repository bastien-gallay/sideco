import { expect, test } from "bun:test";
import { slugify } from "../../src/domain/commands.ts";
import {
  asBoardId,
  asElementId,
  type BoardId,
  type ElementId,
  isBoardId,
  isElementId,
} from "../../src/domain/ids.ts";

const board = (id: BoardId): string => id;
const element = (id: ElementId): string => id;

test("an element id is a capital letter and a number without leading zero", () => {
  expect(["E1", "C12", "N999999"].every(isElementId)).toBe(true);
  expect(["e1", "E0", "E01", "EE1", "E", "1", "E1234567"].some(isElementId)).toBe(false);
});

test("a board id is lowercase letters, digits and inner dashes, 40 at most", () => {
  expect(["backlog", "c4-sideco", "a", "x".repeat(40)].every(isBoardId)).toBe(true);
  expect(["", "Backlog", "-a", "a-", "a_b", "x".repeat(41), "é"].some(isBoardId)).toBe(false);
});

test("a string becomes an id only through the rule that checks it", () => {
  expect(asBoardId("backlog")).toBe("backlog" as BoardId);
  expect(asBoardId("Backlog")).toBeUndefined();
  expect(asElementId("T152")).toBe("T152" as ElementId);
  expect(asElementId("t152")).toBeUndefined();
  const checked = asElementId("T152");
  if (checked) expect(element(checked)).toBe("T152");
  // @ts-expect-error a plain string is not an element id
  element("T152");
  // @ts-expect-error a plain string is not a board id
  board("backlog");
});

test("a slug is a board id", () => {
  expect(board(slugify("Journal sideco sous charge"))).toBe("journal-sideco-sous-charge");
});
