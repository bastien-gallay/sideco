import { describe, expect, test } from "bun:test";
import { boardAction, tokenize } from "../../src/cli/argv.ts";
import { type Aliases, bindAlias, resolveAliases } from "../../src/domain/aliases.ts";
import { type Command, CommandError, parseCommand } from "../../src/domain/commands.ts";

const command = (line: string): Command => parseCommand(boardAction(tokenize(line), "b").command);

const NAMED: Aliases = new Map([
  ["placed", { board: "b", id: "E1" }],
  ["reserve", { board: "b", id: "P1" }],
  ["ask", { board: "b", id: "N1" }],
]);

describe("resolveAliases", () => {
  test.each([
    ["link @placed @reserve", { src: "E1", dst: "P1" }],
    ["link @placed P7", { src: "E1", dst: "P7" }],
    ["unlink @placed @reserve", { src: "E1", dst: "P1" }],
    ["reverse @placed @reserve", { src: "E1", dst: "P1" }],
    ["relink @placed P7 --to @reserve", { src: "E1", dst: "P7", to: "P1" }],
    ['rename @placed "Order confirmed"', { id: "E1" }],
    ['detail @placed "Emitted by the checkout"', { id: "E1" }],
    ["move @placed --col 2", { id: "E1" }],
    ["move @placed --lane doing --before @reserve", { id: "E1", before: "P1" }],
    ["rm @placed", { id: "E1" }],
    ["focus @placed E7 @reserve", { ids: ["E1", "E7", "P1"] }],
    ['note "Checked first?" --on @reserve', { target: "P1" }],
    ['add command "Pay" --from @placed', { from: "E1" }],
    ['reply @ask "Yes"', { to: "N1" }],
    ["resolve @ask", { id: "N1" }],
  ])("%s", (line, ids) => {
    const resolved = resolveAliases(command(line), NAMED);
    expect(resolved).toMatchObject(ids);
    expect(JSON.stringify(resolved)).not.toContain("@");
  });

  test("a command that refers to no name is left as it was", () => {
    for (const line of ['add event "A" --col 2 --from E1', "link E1 P1", "focus", "pass", 'retitle "T"']) {
      expect(resolveAliases(command(line), NAMED)).toEqual(command(line));
    }
    expect(resolveAliases({ kind: "turn-end" }, NAMED)).toEqual({ kind: "turn-end" });
  });

  test("only ids are references: a text that starts with @ stays a text", () => {
    expect(resolveAliases(command('rename E1 "@placed"'), NAMED)).toMatchObject({ label: "@placed" });
    expect(resolveAliases(command('note "@reserve ?"'), NAMED)).toMatchObject({ text: "@reserve ?" });
  });

  test("a name no earlier command gave is refused, with the names given so far", () => {
    expect(() => resolveAliases(command("link @placed @lost"), NAMED)).toThrow(CommandError);
    expect(() => resolveAliases(command("link @placed @lost"), NAMED)).toThrow(
      "nothing is named @lost earlier in this batch (names so far: placed, reserve, ask)",
    );
    expect(() => resolveAliases(command("rm @lost"), new Map())).toThrow(
      "nothing is named @lost earlier in this batch (names so far: none)",
    );
  });

  test("a name given twice is refused: it says what already bears it", () => {
    expect(() => resolveAliases(command('add event "Again" --alias placed'), NAMED)).toThrow(CommandError);
    expect(() => resolveAliases(command('note "Again" --alias placed'), NAMED)).toThrow(
      "@placed already names E1 in this batch",
    );
  });

  test("a name stands for a card of its board: another board of the batch cannot use it", () => {
    const elsewhere = parseCommand(boardAction(tokenize('rename @placed "Mine"'), "other").command);
    expect(() => resolveAliases(elsewhere, NAMED)).toThrow(CommandError);
    expect(() => resolveAliases(elsewhere, NAMED)).toThrow('@placed names E1 on "b", not a card of "other"');
  });

  test("a command cannot refer to the name it gives", () => {
    expect(() => resolveAliases(command('add command "Pay" --alias pay --from @pay'), NAMED)).toThrow(
      "nothing is named @pay earlier in this batch",
    );
  });
});

describe("bindAlias", () => {
  test("a command that named what it created adds the name, for the commands after it", () => {
    const after = bindAlias(NAMED, command('add command "Pay" --alias pay'), "C1");
    expect(after.get("pay")).toEqual({ board: "b", id: "C1" });
    expect(resolveAliases(command("link @placed @pay"), after)).toMatchObject({ src: "E1", dst: "C1" });
    expect(NAMED.has("pay")).toBe(false);
  });

  test("a command that names nothing leaves the names as they were", () => {
    expect(bindAlias(NAMED, command('add command "Pay"'), "C1")).toBe(NAMED);
    expect(bindAlias(NAMED, command("link E1 P1"), undefined)).toBe(NAMED);
  });
});
