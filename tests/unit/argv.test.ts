import { describe, expect, test } from "bun:test";
import { boardAction, parseArgs, parseBatch, tokenize, UsageError } from "../../src/cli/argv.ts";
import { parseCommand } from "../../src/domain/commands.ts";

describe("tokenize", () => {
  test.each([
    ['add event "Commande passée" --col 2', ["add", "event", "Commande passée", "--col", "2"]],
    ["note 'Qui réserve ?' --on P1", ["note", "Qui réserve ?", "--on", "P1"]],
    ['rename E1 "Dire \\"oui\\""', ["rename", "E1", 'Dire "oui"']],
    ["rename E1 l\\'ami", ["rename", "E1", "l'ami"]],
    ['detail E1 ""', ["detail", "E1", ""]],
    ["  add   event   A  ", ["add", "event", "A"]],
    ["# a comment", []],
    ['add event "A" # trailing comment', ["add", "event", "A"]],
    ['add event "prix #1"', ["add", "event", "prix #1"]],
    ["add event issue#12", ["add", "event", "issue#12"]],
    ["", []],
  ])("%j", (line, tokens) => {
    expect(tokenize(line)).toEqual(tokens);
  });

  test("an unclosed quote is an error, not a guess", () => {
    expect(() => tokenize('add event "oops')).toThrow(UsageError);
    expect(() => tokenize('add event "oops')).toThrow('unclosed " quote');
  });
});

describe("parseArgs", () => {
  test("flags take a value, in both spellings, and short forms expand", () => {
    const { positional, flags } = parseArgs([
      "E1",
      "--col",
      "3",
      "--lane=doing",
      "-o",
      "out.md",
      "-b",
      "sprint",
      "-f",
      "md",
    ]);
    expect(positional).toEqual(["E1"]);
    expect(Object.fromEntries(flags)).toEqual({
      col: "3",
      lane: "doing",
      out: "out.md",
      board: "sprint",
      format: "md",
    });
  });

  test("a flag without a value says which", () => {
    expect(() => parseArgs(["E1", "--col"])).toThrow("--col needs a value");
    // A word named as an object's own parts are is a word like another.
    expect(parseArgs(["E1", "constructor", "__proto__"]).positional).toEqual([
      "E1",
      "constructor",
      "__proto__",
    ]);
    // A switch says yes by being there, and takes nothing after it.
    expect(parseArgs(["--brief", "backlog", "--notes"])).toEqual({
      positional: ["backlog"],
      flags: new Map([
        ["brief", "yes"],
        ["notes", "yes"],
      ]),
    });
  });
});

describe("boardAction", () => {
  const wire = (line: string, board: string | undefined = "b"): Record<string, unknown> => {
    const { command } = boardAction(tokenize(line), board);
    return JSON.parse(JSON.stringify(command));
  };

  test.each([
    ['retitle "Nouveau titre"', { kind: "retitle", board: "b", title: "Nouveau titre" }],
    [
      'add event "Payée" --col 2 --detail "Par carte"',
      { kind: "add", board: "b", type: "event", label: "Payée", col: 2, detail: "Par carte" },
    ],
    [
      'add step "Expédier" --from D1 --edge oui --id S7',
      { kind: "add", board: "b", type: "step", label: "Expédier", from: "D1", edgeLabel: "oui", id: "S7" },
    ],
    ['rename E1 "Validée"', { kind: "rename", board: "b", id: "E1", label: "Validée" }],
    ['detail E1 "Texte"', { kind: "annotate", board: "b", id: "E1", detail: "Texte" }],
    ["detail E1", { kind: "annotate", board: "b", id: "E1", detail: "" }],
    ["move T1 --lane doing --before T2", { kind: "move", board: "b", id: "T1", lane: "doing", before: "T2" }],
    ["rm E1", { kind: "remove", board: "b", id: "E1" }],
    ["insert-col 2", { kind: "insert-column", board: "b", at: 2 }],
    ["move-col 3 1", { kind: "move-column", board: "b", from: 3, to: 1 }],
    ['link E1 P1 "déclenche"', { kind: "link", board: "b", src: "E1", dst: "P1", label: "déclenche" }],
    ["unlink E1 P1", { kind: "unlink", board: "b", src: "E1", dst: "P1" }],
    ["reverse E1 P1", { kind: "reverse", board: "b", src: "E1", dst: "P1" }],
    ["relink E1 P1 --to P2", { kind: "relink", board: "b", src: "E1", dst: "P1", end: "dst", to: "P2" }],
    ["relink E1 P1 --from E2", { kind: "relink", board: "b", src: "E1", dst: "P1", end: "src", to: "E2" }],
    ['focus E1 P1 --why "à revoir"', { kind: "focus", board: "b", ids: ["E1", "P1"], reason: "à revoir" }],
    ["focus", { kind: "focus", board: "b", ids: [] }],
    ['note "Qui ?" --on P1', { kind: "note", board: "b", text: "Qui ?", target: "P1" }],
    ['reply N1 "L\'entrepôt"', { kind: "reply", board: "b", to: "N1", text: "L'entrepôt" }],
    ["resolve N1", { kind: "resolve", board: "b", id: "N1" }],
    ['pass "à toi"', { kind: "pass", board: "b", to: "human", message: "à toi" }],
    ["pass --to agent", { kind: "pass", board: "b", to: "agent" }],
    ["rm E1 --board other", { kind: "remove", board: "other", id: "E1" }],
    [
      'add event "Order placed" --col 1 --alias placed',
      { kind: "add", board: "b", type: "event", label: "Order placed", col: 1, alias: "placed" },
    ],
    [
      'note "Checked first?" --on @reserve --alias ask',
      { kind: "note", board: "b", text: "Checked first?", target: "@reserve", alias: "ask" },
    ],
    ["link @placed @reserve", { kind: "link", board: "b", src: "@placed", dst: "@reserve" }],
  ])("%s", (line, expected) => {
    expect(wire(line)).toEqual(expected);
  });

  test("every verb produces a command the server accepts", () => {
    const lines = [
      'retitle "T"',
      'add event "A"',
      'rename E1 "B"',
      "detail E1",
      "move E1 --col 2",
      "rm E1",
      "insert-col 1",
      "link E1 E2",
      "unlink E1 E2",
      "focus",
      'note "x"',
      "resolve N1",
      "pass",
      'add event "A" --alias a --from @b',
      'note "x" --alias ask --on @a',
      "move @a --lane doing --before @b",
      "focus @a E2",
      'reply @ask "y"',
    ];
    for (const line of lines) expect(() => parseCommand(wire(line))).not.toThrow();
  });

  test("`board new` derives the id from the title and becomes the current board", () => {
    const action = boardAction(tokenize('board new "Passage de commande" --format flow'), undefined);
    expect(action.board).toBe("passage-de-commande");
    expect(action.command).toEqual({
      kind: "create-board",
      board: "passage-de-commande",
      title: "Passage de commande",
      format: "flow",
    });
    expect(boardAction(tokenize('board new "X" --id mine'), undefined).board).toBe("mine");
  });

  test("`board rm` names the board to remove: never the current one by default", () => {
    expect(boardAction(tokenize("board rm commande"), "b").command).toEqual({
      kind: "remove-board",
      board: "commande",
    });
    expect(() => boardAction(tokenize("board rm"), "b")).toThrow("`board rm` needs the id of the board");
  });

  test("in a batch, --dry-run is refused: it would be dropped, and the undo done for real (PA11)", () => {
    expect(() => parseBatch('rename E1 "A"\nundo --dry-run', "b")).toThrow(
      "line 2: --dry-run does not go in a batch: run `sideco undo --dry-run` alone",
    );
  });

  test("in a batch, removing the current board leaves no current board", () => {
    expect(() => parseBatch('board new "Un" --id un\nboard rm un\nadd event "A"', undefined)).toThrow(
      /^line 3: /,
    );
    expect(parseBatch('add event "A"\nboard rm autre\nadd event "B"', "un").map((c) => c.board)).toEqual([
      "un",
      "autre",
      "un",
    ]);
  });

  test.each([
    ["add event", "`add` needs a title"],
    ["rename", "`rename` needs an id"],
    ["add event A --col deux", '--col takes a whole number, got "deux"'],
    ["insert-col x", 'insert-col takes a whole number, got "x"'],
    ["move-col 2 x", 'move-col takes whole numbers, got "x"'],
    ["move-col 2", "`move-col` needs the number it takes"],
    ["board list", "usage: board new"],
    ["dance", 'unknown command "dance"'],
    ["move T1 done", '`move` takes 1 argument, not "done": to choose the column, --lane done'],
    ["move T1", "`move` needs where to: --lane L, --col N or --before ID"],
    ['rename T1 "Un" "Deux"', '`rename` takes 2 arguments, not "Deux"'],
    ["rm T1 T2", '`rm` takes 1 argument, not "T2"'],
  ])("%s → %s", (line, message) => {
    expect(() => boardAction(tokenize(line), "b")).toThrow(message);
  });

  test("without a board, the error says how to choose one", () => {
    expect(() => boardAction(tokenize("rm E1"), undefined)).toThrow("which board? pass --board ID");
  });
});

describe("parseBatch", () => {
  test("reads one command per line, skipping blanks and comments", () => {
    const commands = parseBatch('# le modèle\n\nadd event "A"\n  add event "B"  \n', "b");
    expect(commands.map((c) => c.label)).toEqual(["A", "B"]);
  });

  test("a `board new` line sets the board for the lines after it", () => {
    const commands = parseBatch(
      'board new "Un" --id un\nadd event "A"\nboard new "Deux" --id deux\nadd event "B"\nadd event "C" --board un',
      undefined,
    );
    expect(commands.map((c) => c.board)).toEqual(["un", "un", "deux", "deux", "un"]);
  });

  test("an error names its line", () => {
    expect(() => parseBatch('add event "A"\nadd event\n', "b")).toThrow("line 2: `add` needs a title");
    expect(() => parseBatch('add event "A"\n\nrename E1 "oops', "b")).toThrow('line 3: unclosed " quote');
  });
});
