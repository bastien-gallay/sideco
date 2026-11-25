import { describe, expect, test } from "bun:test";
import { CommandError, parseCommand, slugify } from "../../src/domain/commands.ts";

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

  test("a reply names the note it answers", () => {
    expect(parseCommand({ kind: "reply", board: "b1", to: "N1", text: " Oui " })).toEqual({
      kind: "reply",
      board: "b1",
      to: "N1",
      text: "Oui",
    });
    expect(() => parseCommand({ kind: "reply", board: "b1", to: "note", text: "Oui" })).toThrow(
      "`to` must be an id like E1 or C12",
    );
    expect(() => parseCommand({ kind: "reply", board: "b1", to: "N1", text: " " })).toThrow(
      "`text` must not be empty",
    );
  });

  test("refuses an unknown kind by name", () => {
    expect(() => parseCommand({ kind: "explode" })).toThrow('unknown command kind: "explode"');
    // Which end of a link moves is never guessed (S350).
    expect(() =>
      parseCommand({ kind: "relink", board: "b1", src: "A1", dst: "B1", end: "source", to: "C1" }),
    ).toThrow("`end` must be one of: src, dst");
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

describe("names in a batch", () => {
  test("`add` and `note` may name what they create", () => {
    expect(
      parseCommand({ kind: "add", board: "b", type: "event", label: "Paid", alias: "paid" }),
    ).toMatchObject({ alias: "paid" });
    expect(parseCommand({ kind: "note", board: "b", text: "Why?", alias: "why-2" })).toMatchObject({
      alias: "why-2",
    });
  });

  test.each(["Paid", "2nd", "", "with space", "@paid", "-paid", "a".repeat(41), 3])(
    "refuses the name %j",
    (alias) => {
      expect(() => parseCommand({ kind: "add", board: "b", type: "event", label: "x", alias })).toThrow(
        "`alias` must be a name like placed or step-2",
      );
    },
  );

  test("a reference stands wherever a command takes the id of a card or of a note", () => {
    const b = "b";
    for (const command of [
      { kind: "add", board: b, type: "event", label: "x", from: "@paid" },
      { kind: "rename", board: b, id: "@paid", label: "x" },
      { kind: "annotate", board: b, id: "@paid", detail: "x" },
      { kind: "move", board: b, id: "@paid", lane: "doing", before: "@paid" },
      { kind: "remove", board: b, id: "@paid" },
      { kind: "link", board: b, src: "@paid", dst: "@paid" },
      { kind: "unlink", board: b, src: "@paid", dst: "@paid" },
      { kind: "reverse", board: b, src: "@paid", dst: "@paid" },
      { kind: "relink", board: b, src: "@paid", dst: "E1", end: "src", to: "@paid" },
      { kind: "relink", board: b, src: "E1", dst: "E2", end: "dst", to: "E3" },
      { kind: "focus", board: b, ids: ["E1", "@paid"] },
      { kind: "note", board: b, text: "x", target: "@paid" },
      { kind: "reply", board: b, to: "@paid", text: "x" },
      { kind: "resolve", board: b, id: "@paid" },
    ]) {
      expect(parseCommand(command)).toMatchObject(command);
    }
  });

  test.each(["@", "@Paid", "@2nd", "@a b", "@@paid", "paid", `@${"a".repeat(41)}`])(
    "refuses %j as a reference",
    (id) => {
      expect(() => parseCommand({ kind: "remove", board: "b", id })).toThrow(
        "`id` must be an id like E1 or C12, or the @name an earlier command of the batch gave",
      );
    },
  );

  test("the id a new card claims is an id, never a reference", () => {
    expect(() => parseCommand({ kind: "add", board: "b", type: "event", label: "x", id: "@paid" })).toThrow(
      /^`id` must be an id like E1 or C12$/,
    );
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
    expect<string>(slugify(title)).toBe(slug);
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
