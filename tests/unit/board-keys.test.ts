import { expect, test } from "bun:test";
import { cardKey, type Keyed, laneKey } from "../../src/web/board-keys.ts";

const key = (k: string, mods: Partial<Keyed> = {}): Keyed => ({
  key: k,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  ...mods,
});

test("on a card, an arrow alone reads: it works on the past too", () => {
  expect(cardKey(key("ArrowRight"))).toEqual({ ask: "go", direction: "right", reads: true });
  expect(cardKey(key("ArrowUp"))).toEqual({ ask: "go", direction: "up", reads: true });
});

test("on a card, Shift and an arrow move it, Alt and an arrow add beside it", () => {
  expect(cardKey(key("ArrowLeft", { shiftKey: true }))).toEqual({ ask: "move", direction: "left" });
  expect(cardKey(key("ArrowDown", { altKey: true }))).toEqual({ ask: "beside", direction: "down" });
});

test("on a card, an arrow with another chord is not the board's", () => {
  expect(cardKey(key("ArrowLeft", { ctrlKey: true }))).toBeUndefined();
  expect(cardKey(key("ArrowLeft", { shiftKey: true, altKey: true }))).toBeUndefined();
  expect(cardKey(key("ArrowLeft", { metaKey: true, shiftKey: true }))).toBeUndefined();
});

test("on a card, Enter or F2 renames; Ctrl+Enter and ⌘↵ are the page's", () => {
  expect(cardKey(key("Enter"))).toEqual({ ask: "rename" });
  expect(cardKey(key("F2"))).toEqual({ ask: "rename" });
  expect(cardKey(key("Enter", { ctrlKey: true }))).toBeUndefined();
  expect(cardKey(key("Enter", { metaKey: true }))).toBeUndefined();
});

test("on a card, each letter has its gesture, in either case", () => {
  expect(cardKey(key(" "))).toEqual({ ask: "choose" });
  expect(cardKey(key("Delete"))).toEqual({ ask: "remove" });
  expect(cardKey(key("Backspace"))).toEqual({ ask: "remove" });
  expect(cardKey(key("d"))).toEqual({ ask: "done" });
  expect(cardKey(key("D", { shiftKey: true }))).toEqual({ ask: "done" });
  expect(cardKey(key("l"))).toEqual({ ask: "link" });
  // A adds a card linked from this one (T272).
  expect(cardKey(key("a"))).toEqual({ ask: "linked" });
  expect(cardKey(key("n"))).toEqual({ ask: "note" });
  expect(cardKey(key("e"))).toEqual({ ask: "detail" });
  // I reads the detail where E writes it (T276): it changes nothing, so it works on the past too.
  expect(cardKey(key("i"))).toEqual({ ask: "read", reads: true });
  expect(cardKey(key("I", { shiftKey: true }))).toEqual({ ask: "read", reads: true });
  expect(cardKey(key("t"))).toEqual({ ask: "label" });
  expect(cardKey(key("T", { shiftKey: true }))).toEqual({ ask: "label" });
  expect(cardKey(key("x"))).toBeUndefined();
});

test("on a card, a letter held with Ctrl, ⌘ or Alt is the browser's: its bookmark, its address bar, its new tab", () => {
  for (const letter of ["d", "l", "n", "e", "t", "i", "a"]) {
    expect(cardKey(key(letter, { ctrlKey: true }))).toBeUndefined();
    expect(cardKey(key(letter, { metaKey: true }))).toBeUndefined();
    expect(cardKey(key(letter, { altKey: true }))).toBeUndefined();
  }
});

test("on a card, a key with a name is read as the keyboard spells it", () => {
  expect(cardKey(key("f2"))).toBeUndefined();
  expect(cardKey(key("delete"))).toBeUndefined();
  expect(cardKey(key("BACKSPACE"))).toBeUndefined();
});

test("on a lane's name, the arrows alone read: to the next name, or down to its cards", () => {
  expect(laneKey(key("ArrowRight"))).toEqual({ ask: "to-lane", by: 1, reads: true });
  expect(laneKey(key("ArrowLeft"))).toEqual({ ask: "to-lane", by: -1, reads: true });
  expect(laneKey(key("ArrowDown"))).toEqual({ ask: "to-cards", reads: true });
  expect(laneKey(key("ArrowUp"))).toBeUndefined();
});

test("on a lane's name, Shift and an arrow move the lane, Alt and an arrow add one on that side", () => {
  expect(laneKey(key("ArrowRight", { shiftKey: true }))).toEqual({ ask: "move", direction: "right" });
  expect(laneKey(key("ArrowUp", { shiftKey: true }))).toEqual({ ask: "move", direction: "up" });
  expect(laneKey(key("ArrowRight", { altKey: true }))).toEqual({ ask: "add", after: true });
  expect(laneKey(key("ArrowLeft", { altKey: true }))).toEqual({ ask: "add", after: false });
  // Alt wins over Shift held with it, as it always did.
  expect(laneKey(key("ArrowLeft", { altKey: true, shiftKey: true }))).toEqual({ ask: "add", after: false });
  expect(laneKey(key("ArrowDown", { altKey: true }))).toBeUndefined();
  expect(laneKey(key("+"))).toEqual({ ask: "add", after: true });
});

test("on a lane's name, Enter renames, Shift+Enter writes its hint, Delete removes", () => {
  expect(laneKey(key("Enter"))).toEqual({ ask: "rename" });
  expect(laneKey(key("F2"))).toEqual({ ask: "rename" });
  expect(laneKey(key("Enter", { shiftKey: true }))).toEqual({ ask: "hint" });
  expect(laneKey(key("Enter", { ctrlKey: true }))).toBeUndefined();
  expect(laneKey(key("Enter", { metaKey: true }))).toBeUndefined();
  expect(laneKey(key("Delete"))).toEqual({ ask: "remove" });
  expect(laneKey(key("Backspace"))).toEqual({ ask: "remove" });
  expect(laneKey(key("a"))).toBeUndefined();
});
