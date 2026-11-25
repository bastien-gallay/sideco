/**
 * Reading a part of a board: one lane, one column, the notes, the cards without
 * their details, or one card with what is tied to it. The first line says what
 * part it is, so that a part is never taken for the whole.
 */
import { describe, expect, test } from "bun:test";
import { describeBoard, describeCard } from "../../src/domain/digest.ts";
import { KANBAN, ORDERING, table } from "../support.ts";

const kanban = () =>
  table(KANBAN).script(
    'detail T2 "Stop, PreToolUse"\nnote "Lequel d\'abord ?" --on T2\nnote "Sprint trop chargé"\nlink T2 B1 "bloqué par"',
  );

describe("a part of a board", () => {
  test("one lane: its cards, the links and the notes that touch them", () => {
    const shown = describeBoard(kanban().board(), { lane: "doing" });
    expect(shown.split("\n")[0]).toMatch(/^# sprint — Sprint 12 \(kanban, seq \d+\) · part: lane doing$/);
    expect(shown).toContain('  T2 task "Brancher les hooks" — Stop, PreToolUse');
    expect(shown).toContain("  B1 blocker");
    expect(shown).not.toContain("T1 task");
    expect(shown).not.toContain("lane todo");
    expect(shown).toContain('  T2 -> B1 "bloqué par"');
    expect(shown).toContain("N1 by agent on T2");
    expect(shown).not.toContain("Sprint trop chargé");
  });

  test("one column of a timeline", () => {
    const shown = describeBoard(table(ORDERING).board(), { col: 2 });
    expect(shown).toContain("· part: col 2");
    expect(shown).toContain("  R1 policy");
    expect(shown).not.toContain("col 1");
    expect(shown).not.toContain("P1 actor");
    // A link is shown as soon as one of its ends is.
    expect(shown).toContain("  E1 -> R1");
    expect(shown).not.toContain("C1 -> E1");
  });

  test("brief: the cards without their details", () => {
    const shown = describeBoard(kanban().board(), { brief: true });
    expect(shown).toContain("· part: brief");
    expect(shown).toContain('  T2 task "Brancher les hooks"\n');
    expect(shown).not.toContain("Stop, PreToolUse");
    expect(shown).toContain("lane todo");
  });

  test("notes: the open threads and nothing else", () => {
    const shown = describeBoard(kanban().board(), { notes: true });
    expect(shown).toContain("· part: notes");
    expect(shown).toContain("N1 by agent on T2");
    expect(shown).toContain("Sprint trop chargé");
    expect(shown).not.toContain("T2 task");
    expect(shown).not.toContain("links");
  });

  test("parts combine, and a part the board does not have is refused", () => {
    const shown = describeBoard(kanban().board(), { lane: "doing", brief: true });
    expect(shown).toContain("· part: lane doing, brief");
    expect(shown).not.toContain("Stop, PreToolUse");
    expect(() => describeBoard(kanban().board(), { lane: "nowhere" })).toThrow('no column "nowhere"');
    expect(() => describeBoard(kanban().board(), { col: 2 })).toThrow("Kanban boards have no columns");
    expect(() => describeBoard(table(ORDERING).board(), { lane: "todo" })).toThrow("have no columns");
  });

  test("the whole board says no part", () => {
    expect(describeBoard(kanban().board()).split("\n")[0]).not.toContain("part");
  });
});

describe("one card", () => {
  test("its line, where it is, its links and its threads, closed ones included", () => {
    const t = kanban().script('reply N1 "Stop d\'abord"\nresolve N1');
    const shown = describeCard(t.board(), "T2");
    expect(shown.split("\n")).toEqual([
      expect.stringMatching(/^# sprint — Sprint 12 \(kanban, seq \d+\) · part: card T2$/),
      '  T2 task "Brancher les hooks" — Stop, PreToolUse',
      "  in lane doing (Doing)",
      "links",
      '  T2 -> B1 "bloqué par"',
      "notes",
      "  N1 by agent on T2: Lequel d'abord ? (resolved)",
      "    N3 by agent: Stop d'abord",
    ]);
  });

  test("in a timeline it says its column; an unknown card is refused", () => {
    expect(describeCard(table(ORDERING).board(), "R1")).toContain("  in col 2");
    expect(() => describeCard(table(ORDERING).board(), "Z9")).toThrow("no card Z9");
  });
});
