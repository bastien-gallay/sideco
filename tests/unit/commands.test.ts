import { describe, expect, test } from "bun:test";
import { CommandError, isElementId, parseCommand, slugify } from "../../src/domain/commands.ts";

describe("parseCommand", () => {
  test("accepts a well-formed command and drops unknown fields", () => {
    const command = parseCommand({
      kind: "add",
      board: "b1",
      type: "event",
      label: "  Paid  ",
      x: 120,
      y: 40,
    });
    expect(command).toEqual({
      kind: "add",
      board: "b1",
      type: "event",
      label: "Paid",
      id: undefined,
      col: undefined,
      lane: undefined,
      detail: undefined,
      from: undefined,
      edgeLabel: undefined,
    });
  });

  test("refuses an unknown kind by name", () => {
    expect(() => parseCommand({ kind: "explode" })).toThrow('unknown command kind: "explode"');
  });

  test.each([
    [{ kind: "add", board: "b", type: "event", label: "" }, "`label` must not be empty"],
    [{ kind: "add", board: "b", type: "event", label: 3 }, "`label` must be a string"],
    [
      { kind: "add", board: "b", type: "event", label: "x".repeat(201) },
      "`label` is longer than 200 characters",
    ],
    [{ kind: "add", board: "Bad Id", type: "event", label: "x" }, "`board` must be a board id"],
    [
      { kind: "add", board: "b", type: "event", label: "x", col: 0 },
      "`col` must be a whole number from 1 to 10000",
    ],
    [{ kind: "add", board: "b", type: "event", label: "x", col: 1.5 }, "`col` must be a whole number"],
    [{ kind: "rename", board: "b", id: "e1", label: "x" }, "`id` must be an id like E1 or C12"],
    [{ kind: "focus", board: "b", ids: ["E1", "nope"] }, "`ids[1]` must be an id"],
    [{ kind: "pass", board: "b", to: "everyone" }, "`to` must be one of: agent, human"],
    [{ kind: "tool-finish", call: "c1", ok: "yes" }, "`ok` must be true or false"],
    [{ kind: "todos", todos: [{ text: "x", status: "started" }] }, "`status` must be one of"],
    [[], "a command is a JSON object"],
    ["add", "a command is a JSON object"],
  ])("refuses %j", (input, message) => {
    expect(() => parseCommand(input)).toThrow(CommandError);
    expect(() => parseCommand(input)).toThrow(message);
  });

  test("an empty detail is allowed: it clears the detail", () => {
    expect(parseCommand({ kind: "annotate", board: "b", id: "E1", detail: "" })).toMatchObject({
      detail: "",
    });
  });

  test("null reads as absent for optional fields", () => {
    expect(parseCommand({ kind: "link", board: "b", src: "E1", dst: "E2", label: null })).toMatchObject({
      label: undefined,
    });
  });
});

describe("slugify", () => {
  test.each([
    ["Passage de commande", "passage-de-commande"],
    ["Événements & règles métier !", "evenements-regles-metier"],
    ["  ", "board"],
    ["日本語", "board"],
    ["a".repeat(60), "a".repeat(40)],
    [`${"a".repeat(39)} b`, "a".repeat(39)],
  ])("%j → %j", (title, slug) => {
    expect(slugify(title)).toBe(slug);
  });

  test("a slug is always a valid board id", () => {
    for (const title of ["Hello, World", "--x--", "É", "UPPER lower 42"]) {
      expect(() => parseCommand({ kind: "retitle", board: slugify(title), title: "t" })).not.toThrow();
    }
  });
});

test("removing a board is a command of the closed set", () => {
  expect(parseCommand({ kind: "remove-board", board: "commande", extra: 1 })).toEqual({
    kind: "remove-board",
    board: "commande",
  });
  expect(() => parseCommand({ kind: "remove-board" })).toThrow();
});

test("element ids are one capital letter and a number without leading zero", () => {
  expect(["E1", "C12", "N999999"].every(isElementId)).toBe(true);
  expect(["e1", "E0", "E01", "EE1", "E", "1", "E1234567"].some(isElementId)).toBe(false);
});
