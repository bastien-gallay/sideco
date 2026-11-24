/**
 * Undo and redo: each author takes back their own last gesture on a board, by
 * events that say the opposite. The journal only ever grows.
 */
import { describe, expect, test } from "bun:test";
import { CommandError } from "../../src/domain/commands.ts";
import { describeChanges } from "../../src/domain/digest.ts";
import type { Actor } from "../../src/domain/events.ts";
import { UNDO_DEPTH } from "../../src/domain/undo.ts";
import { findBoard, findElement, replay } from "../../src/domain/workspace.ts";
import { FLOW, KANBAN, ORDERING, type Table, table } from "../support.ts";

const undo = (t: Table, board: string, actor: Actor = "human"): void => {
  t.do({ kind: "undo", board }, actor);
};
const redo = (t: Table, board: string, actor: Actor = "human"): void => {
  t.do({ kind: "redo", board }, actor);
};
const label = (t: Table, id: string, board?: string): string | undefined =>
  findElement(t.board(board), id)?.label;
const order = (t: Table, board?: string): string[] => t.board(board).elements.map((el) => el.id);

describe("undo takes back the author's last gesture", () => {
  test("a rename comes back, and the journal keeps both the gesture and its undoing", () => {
    const t = table(ORDERING).script('rename E1 "Validée"', "human");
    const renamed = t.seq;
    undo(t, "commande");
    expect(label(t, "E1")).toBe("Commande passée");
    expect(t.events.at(-1)).toMatchObject({
      event: "ElementRenamed",
      id: "E1",
      label: "Commande passée",
      actor: "human",
      undoes: renamed,
    });
    expect(t.events).toHaveLength(renamed + 1);
  });

  test("gestures come back one at a time, the latest first", () => {
    const t = table(ORDERING).script('rename E1 "Un"\nrename E1 "Deux"\ndetail E2 "Une règle"', "human");
    undo(t, "commande");
    expect(findElement(t.board(), "E2")?.detail).toBeUndefined();
    undo(t, "commande");
    expect(label(t, "E1")).toBe("Un");
    undo(t, "commande");
    expect(label(t, "E1")).toBe("Commande passée");
  });

  test("with nothing to take back, it says so", () => {
    const t = table(ORDERING);
    expect(() => undo(t, "commande")).toThrow(CommandError);
    expect(() => undo(t, "commande")).toThrow('nothing to undo on "commande"');
    expect(() => redo(t, "commande")).toThrow('nothing to redo on "commande"');
  });

  test("each author has their own: the human never undoes what Claude did", () => {
    const t = table(ORDERING).script('rename E1 "À moi"', "human").script('rename E2 "À Claude"', "agent");
    undo(t, "commande", "human");
    expect(label(t, "E1")).toBe("Commande passée");
    expect(label(t, "E2")).toBe("À Claude");
    undo(t, "commande", "agent");
    expect(label(t, "E2")).toBe("Stock réservé");
  });

  test("a move comes back to its lane and to its place in the lane", () => {
    const t = table(KANBAN);
    const before = order(t);
    t.script("move T4 --lane doing --before T2", "human");
    expect(order(t)).not.toEqual(before);
    undo(t, "sprint");
    expect(order(t)).toEqual(before);
    expect(findElement(t.board(), "T4")?.lane).toBe("todo");
  });

  test("a link and an unlink come back", () => {
    const t = table(ORDERING).script("link E2 R1\nunlink C1 E1", "human");
    const has = (src: string, dst: string): boolean =>
      t.board().edges.some((e) => e.src === src && e.dst === dst);
    undo(t, "commande");
    expect(has("C1", "E1")).toBe(true);
    undo(t, "commande");
    expect(has("E2", "R1")).toBe(false);
  });

  test("a link reversed is one gesture, named as such: one undo turns it back (S349)", () => {
    const t = table(ORDERING).script('link C1 E1 "produit"', "human").script("reverse C1 E1", "human");
    expect(t.board().trails.human?.undo.at(-1)?.name).toBe("reverse C1 E1");
    undo(t, "commande");
    const between = t.board().edges.filter((e) => [e.src, e.dst].sort().join() === "C1,E1");
    expect(between.map((e) => [e.src, e.dst, e.label])).toEqual([["C1", "E1", "produit"]]);
  });

  test("an element added with its link is one gesture: one undo removes both", () => {
    const t = table(FLOW).script('add step "Emballer" --from F2', "human");
    expect(findElement(t.board(), "F4")).toBeDefined();
    undo(t, "livraison");
    expect(findElement(t.board(), "F4")).toBeUndefined();
    expect(t.board().edges.some((e) => e.dst === "F4")).toBe(false);
    expect(() => undo(t, "livraison")).toThrow("nothing to undo");
  });
});

describe("a removed element is restored as it was", () => {
  const removed = (): Table => table(ORDERING).script("rm E1", "human");

  test("same id, same author, same place, same links", () => {
    const whole = table(ORDERING);
    const t = removed();
    expect(findElement(t.board(), "E1")).toBeUndefined();
    undo(t, "commande");
    expect(t.events.at(-1)).toMatchObject({ event: "ElementRestored", id: "E1", actor: "human" });
    expect(findElement(t.board(), "E1")).toMatchObject({ label: "Commande passée", by: "agent", col: 1 });
    expect(order(t)).toEqual(order(whole));
    expect(
      t
        .board()
        .edges.map((e) => `${e.src}>${e.dst}`)
        .sort(),
    ).toEqual(
      whole
        .board()
        .edges.map((e) => `${e.src}>${e.dst}`)
        .sort(),
    );
  });

  test("its id is in use again, and still never given to another element", () => {
    const t = removed();
    undo(t, "commande");
    expect(t.board().retired).not.toContain("E1");
    expect(t.do({ kind: "add", board: "commande", type: "event", label: "Autre" }, "human")).toBe("E3");
  });
});

describe("redo puts back what undo took", () => {
  test("a rename undone, then redone", () => {
    const t = table(ORDERING).script('rename E1 "Validée"', "human");
    undo(t, "commande");
    const undone = t.seq;
    redo(t, "commande");
    expect(label(t, "E1")).toBe("Validée");
    expect(t.events.at(-1)).toMatchObject({ event: "ElementRenamed", label: "Validée", redoes: undone });
    undo(t, "commande");
    expect(label(t, "E1")).toBe("Commande passée");
  });

  test("an added element undone, then redone, comes back with its link", () => {
    const t = table(FLOW).script('add step "Emballer" --from F2', "human");
    undo(t, "livraison");
    redo(t, "livraison");
    expect(findElement(t.board(), "F4")).toMatchObject({ label: "Emballer", by: "human" });
    expect(t.board().edges.some((e) => e.src === "F2" && e.dst === "F4")).toBe(true);
  });

  test("a new gesture closes the way back: there is nothing left to redo", () => {
    const t = table(ORDERING).script('rename E1 "Validée"', "human");
    undo(t, "commande");
    t.script('rename E2 "Autre chose"', "human");
    expect(() => redo(t, "commande")).toThrow("nothing to redo");
  });

  test("a note, a focus or a hand-over is not a gesture on the model: it neither undoes nor closes the way back", () => {
    const t = table(ORDERING).script('rename E1 "Validée"', "human");
    undo(t, "commande");
    t.do({ kind: "note", board: "commande", text: "Une question" }, "human");
    t.do({ kind: "focus", board: "commande", ids: ["E2"] }, "human");
    t.do({ kind: "pass", board: "commande", to: "agent" }, "human");
    redo(t, "commande");
    expect(label(t, "E1")).toBe("Validée");
    undo(t, "commande");
    expect(t.board().notes).toHaveLength(1);
    expect(t.board().turn?.to).toBe("agent");
  });
});

describe("a removed board is kept aside, and comes back whole", () => {
  test("undo on the removed board restores it, with its elements, links and ids", () => {
    const whole = table(ORDERING);
    const t = table(ORDERING).script("board rm commande", "human");
    expect(findBoard(t.ws, "commande")).toBeUndefined();
    expect(t.ws.boards).toHaveLength(0);
    undo(t, "commande");
    expect(t.events.at(-1)).toMatchObject({ event: "BoardRestored", board: "commande", actor: "human" });
    expect(order(t, "commande")).toEqual(order(whole));
    expect(t.board("commande").edges).toHaveLength(whole.board().edges.length);
    expect(t.board("commande").title).toBe("Passage de commande");
  });

  test("redo removes it again", () => {
    const t = table(ORDERING).script("board rm commande", "human");
    undo(t, "commande");
    redo(t, "commande");
    expect(findBoard(t.ws, "commande")).toBeUndefined();
  });

  test("only the one who removed it brings it back by undo", () => {
    const t = table(ORDERING).script("board rm commande", "agent");
    expect(() => undo(t, "commande", "human")).toThrow('nothing to undo on "commande"');
  });

  test("a board created under the same id replaces the one kept aside", () => {
    const t = table(ORDERING).script("board rm commande", "human");
    t.script('board new "Autre" --id commande', "human");
    expect(t.board("commande").elements).toHaveLength(0);
    expect(() => undo(t, "commande")).toThrow("nothing to undo");
  });

  test("a board that never was is still refused, with the boards that exist", () => {
    const t = table(ORDERING);
    expect(() => undo(t, "nulle-part")).toThrow('no board "nulle-part" (boards: commande)');
  });
});

describe("an undo never overwrites what the other author did since", () => {
  test("Claude renamed the element after you: your rename is no longer yours to take back", () => {
    const t = table(ORDERING).script('detail E2 "Une règle"\nrename E1 "À moi"', "human");
    t.script('rename E1 "À Claude"', "agent");
    expect(() => undo(t, "commande")).toThrow("refused");
    expect(label(t, "E1")).toBe("À Claude");
    undo(t, "commande");
    expect(findElement(t.board(), "E2")?.detail).toBeUndefined();
  });

  test("Claude changed something else about it: your rename still comes back", () => {
    const t = table(ORDERING).script('rename E1 "À moi"', "human");
    t.script('move E1 --col 3\ndetail E1 "Précision"', "agent");
    undo(t, "commande");
    expect(findElement(t.board(), "E1")).toMatchObject({
      label: "Commande passée",
      col: 3,
      detail: "Précision",
    });
  });

  test("Claude removed the element: your gestures on it, and on its links, are refused together", () => {
    const t = table(ORDERING).script('rename E1 "À moi"\nlink E1 E2', "human");
    t.script("rm E1", "agent");
    expect(() => undo(t, "commande")).toThrow(
      `refused: your gestures seq ${t.seq - 1} (link E1 E2), seq ${t.seq - 2} (rename E1 "À moi") were changed since by Claude (seq ${t.seq}: rm E1); nothing left to undo on "commande"`,
    );
    expect(() => undo(t, "commande")).toThrow("nothing to undo");
    undo(t, "commande", "agent");
    expect(label(t, "E1")).toBe("À moi");
  });

  test("Claude built on an element you added: removing it is refused, and the card stays", () => {
    const t = table(ORDERING).script('add event "Paiement reçu" --col 3', "human");
    t.script("link E2 E3", "agent");
    expect(() => undo(t, "commande")).toThrow("refused: your gesture seq");
    expect(findElement(t.board(), "E3")).toBeDefined();
  });

  test("the same holds for what you could put back", () => {
    const t = table(ORDERING).script('rename E1 "À moi"', "human");
    undo(t, "commande");
    t.script('rename E1 "À Claude"', "agent");
    expect(() => redo(t, "commande")).toThrow("refused: your gesture seq");
    expect(() => redo(t, "commande")).toThrow("nothing to redo");
  });
});

describe("a gesture the other author changed since is refused, said, then left behind", () => {
  test("the refusal names the gesture, what changed it, and what the next undo takes back", () => {
    const t = table(ORDERING).script('detail E2 "Une règle"', "human");
    const first = t.seq;
    t.script('rename E1 "À moi"', "human");
    const mine = t.seq;
    t.script('rename E1 "À Claude"', "agent");
    const theirs = t.seq;
    expect(() => undo(t, "commande")).toThrow(
      `refused: your gesture seq ${mine} (rename E1 "À moi") was changed since by Claude (seq ${theirs}: rename E1 "À Claude"); the next undo takes back seq ${first} (detail E2)`,
    );
    // Nothing on the board moved; the journal says the refusal.
    expect(label(t, "E1")).toBe("À Claude");
    expect(t.events.at(-1)).toMatchObject({
      event: "UndoRefused",
      board: "commande",
      actor: "human",
      way: "undo",
      gestures: [mine],
      by: "agent",
      at: theirs,
    });
    undo(t, "commande");
    expect(findElement(t.board(), "E2")?.detail).toBeUndefined();
  });

  test("Claude is refused the same way when the human changed its gesture", () => {
    const t = table(ORDERING).script("move E2 --col 3", "agent");
    t.script("move E2 --col 1", "human");
    expect(() => undo(t, "commande", "agent")).toThrow(
      /^refused: your gesture seq \d+ \(move E2 --col 3\) was changed since by the human \(seq \d+: move E2 --col 1\)/,
    );
  });

  test("a refusal is part of the projection: replayed, the gesture stays left behind", () => {
    const t = table(ORDERING).script('rename E1 "À moi"', "human");
    t.script('rename E1 "À Claude"', "agent");
    expect(() => undo(t, "commande")).toThrow("refused");
    expect(replay(t.events).boards[0]?.trails).toEqual(t.board().trails);
    expect(() => undo(t, "commande")).toThrow("nothing to undo");
  });

  test("a refusal is not a change of the board: Claude is told nothing", () => {
    const t = table(ORDERING).script('rename E1 "À moi"', "human");
    t.script('rename E1 "À Claude"', "agent");
    const read = t.seq;
    expect(() => undo(t, "commande")).toThrow("refused");
    expect(describeChanges(t.events, read).count).toBe(0);
    expect(t.board().changedSeq).toBe(read);
  });

  test("a column Claude inserts shifts the place your move comes back to", () => {
    const t = table(ORDERING).script("move E2 --col 3", "human");
    t.script("insert-col 1", "agent");
    expect(findElement(t.board(), "E2")?.col).toBe(4);
    undo(t, "commande");
    expect(findElement(t.board(), "E2")?.col).toBe(3);
    expect(findElement(t.board(), "R1")?.col).toBe(3);
  });
});

describe("the way back is part of the projection", () => {
  test("replaying the journal gives the same boards and the same ways back", () => {
    const t = table(ORDERING).script('rename E1 "Validée"\nrm H1\nmove E2 --col 3', "human");
    undo(t, "commande");
    undo(t, "commande");
    redo(t, "commande");
    t.script("board rm commande", "human");
    undo(t, "commande");
    expect(replay(t.events)).toEqual(t.ws);
  });

  test("it is bounded: the oldest gestures fall off", () => {
    const t = table(ORDERING);
    for (let i = 0; i < UNDO_DEPTH + 5; i++) t.script(`rename E1 "v${i}"`, "human");
    for (let i = 0; i < UNDO_DEPTH; i++) undo(t, "commande");
    expect(label(t, "E1")).toBe("v4");
    expect(() => undo(t, "commande")).toThrow("nothing to undo");
  });
});

describe("what Claude is told", () => {
  const told = (t: Table, after: number): string => describeChanges(t.events, after).text;

  test("a gesture undone before Claude read it leaves no line", () => {
    const t = table(ORDERING);
    const read = t.seq;
    t.script('rename E1 "Validée"\nrm H1', "human");
    undo(t, "commande");
    undo(t, "commande");
    expect(told(t, read)).toBe("");
  });

  test("a gesture undone after Claude read it is a change like another", () => {
    const t = table(ORDERING).script('rename E1 "Validée"', "human");
    const read = t.seq;
    undo(t, "commande");
    expect(told(t, read)).toContain('~ E1 renamed "Validée" → "Commande passée"');
  });

  test("an element Claude knew removed, then restored, is announced with where it is", () => {
    const t = table(ORDERING).script("rm H1", "human");
    const read = t.seq;
    undo(t, "commande");
    expect(told(t, read)).toBe(
      'board commande "Passage de commande"\n  + H1 hotspot "Et si le stock manque ?" (col 2) restored',
    );
    redo(t, "commande");
    expect(told(t, read)).toBe("");
  });

  test("a board removed then restored before Claude read it leaves no line", () => {
    const t = table(ORDERING);
    const read = t.seq;
    t.script("board rm commande", "human");
    undo(t, "commande");
    expect(told(t, read)).toBe("");
  });

  test("what changed on a board before it was removed is still told once it is back", () => {
    const t = table(ORDERING);
    const read = t.seq;
    t.script('rename E1 "Validée"\nboard rm commande', "human");
    undo(t, "commande");
    expect(told(t, read)).toBe(
      'board commande "Passage de commande"\n  ~ E1 renamed "Commande passée" → "Validée"',
    );
  });

  test("a board Claude knew removed, then restored, is announced; removed again, it is no news", () => {
    const t = table(ORDERING).script("board rm commande", "human");
    const read = t.seq;
    undo(t, "commande");
    expect(told(t, read)).toBe('board commande "Passage de commande"\n  + board restored');
    redo(t, "commande");
    expect(told(t, read)).toBe("");
    undo(t, "commande");
    expect(told(t, read)).toContain("+ board restored");
  });
});

describe("the human may undo anyway, once told what it overwrites (B8)", () => {
  const anyway = (t: Table, board: string, actor: Actor = "human"): void => {
    t.do({ kind: "undo", board, ifChanged: "overwrite" }, actor);
  };

  test("their old label comes back over Claude's, and Redo puts Claude's back", () => {
    const t = table(ORDERING).script('rename E1 "À moi"', "human");
    const mine = t.seq;
    t.script('rename E1 "À Claude"', "agent");
    anyway(t, "commande");
    expect(label(t, "E1")).toBe("Commande passée");
    expect(t.events.at(-1)).toMatchObject({ event: "ElementRenamed", actor: "human", undoes: mine });
    redo(t, "commande");
    expect(label(t, "E1")).toBe("À Claude");
  });

  test("Claude's gesture is then the one blocked: Claude never takes the human's change back", () => {
    const t = table(ORDERING).script('rename E1 "À moi"', "human");
    t.script('rename E1 "À Claude"', "agent");
    anyway(t, "commande");
    expect(() => undo(t, "commande", "agent")).toThrow("refused: your gesture seq");
  });

  test("a gesture nobody changed is taken back as usual", () => {
    const t = table(ORDERING).script('rename E1 "À moi"', "human");
    anyway(t, "commande");
    expect(label(t, "E1")).toBe("Commande passée");
  });

  test("Claude cannot undo anyway", () => {
    const t = table(ORDERING).script('rename E1 "À Claude"', "agent");
    t.script('rename E1 "À moi"', "human");
    expect(() => anyway(t, "commande", "agent")).toThrow("only the human undoes anyway");
  });

  test("a card Claude removed since cannot be written to: the undo says so and writes nothing", () => {
    const t = table(ORDERING).script('rename E1 "À moi"', "human");
    t.script("rm E1", "agent");
    const before = t.events.length;
    expect(() => anyway(t, "commande")).toThrow('cannot undo anyway on "commande": E1 is gone');
    expect(t.events).toHaveLength(before);
  });

  test("keeping Claude's change writes the refusal without answering an error", () => {
    const t = table(ORDERING).script('rename E1 "À moi"', "human");
    t.script('rename E1 "À Claude"', "agent");
    t.do({ kind: "undo", board: "commande", ifChanged: "keep" }, "human");
    expect(t.events.at(-1)).toMatchObject({ event: "UndoRefused", actor: "human" });
    expect(label(t, "E1")).toBe("À Claude");
    expect(() => undo(t, "commande")).toThrow("nothing to undo");
  });
});
