import { describe, expect, test } from "bun:test";
import { LOCALES } from "../../src/domain/i18n.ts";
import { layoutBoard, vacancy } from "../../src/domain/layout/index.ts";
import { MESSAGES, pickLocale } from "../../src/web/messages.ts";
import {
  addOffers,
  agentStatus,
  describeEvent,
  discussions,
  handOverHint,
  handOverNotice,
  pendingCount,
  recentTurns,
  redoTarget,
  undoTarget,
} from "../../src/web/view.ts";
import { FLOW, KANBAN, ORDERING, type Table, table } from "../support.ts";

function withSession(script = ORDERING): Table {
  const t = table(script);
  t.do({ kind: "session-start", cwd: "/repo" }, "agent", "s1");
  return t;
}
const session = (t: Table): Table["ws"]["sessions"][number] | undefined => t.ws.sessions[0];

describe("agentStatus says what Claude is doing, in words", () => {
  test("no session linked yet", () => {
    expect(agentStatus(undefined, 0)).toEqual({ tone: "off", text: "No Claude Code session linked" });
  });

  test("at rest, thinking, running a tool, waiting in the terminal", () => {
    const t = withSession();
    expect(agentStatus(session(t), 0)).toEqual({ tone: "idle", text: "Claude is idle" });
    t.do({ kind: "prompt", text: "go" }, "agent", "s1");
    expect(agentStatus(session(t), 0)).toEqual({ tone: "busy", text: "Claude is thinking" });
    t.do({ kind: "tool-start", call: "c1", tool: "Bash", summary: "bun test" }, "agent", "s1");
    expect(agentStatus(session(t), 0)).toEqual({ tone: "busy", text: "Claude is running Bash bun test" });
    t.do({ kind: "notify", message: "Claude needs your permission to use Bash" }, "agent", "s1");
    expect(agentStatus(session(t), 0)).toEqual({
      tone: "waiting",
      text: "Claude is waiting for you in the terminal: Claude needs your permission to use Bash",
    });
  });

  test("a session that ended is no session: the page says none is linked", () => {
    const t = withSession();
    t.do({ kind: "session-end" }, "agent", "s1");
    expect(agentStatus(session(t), 0)).toEqual({ tone: "off", text: "No Claude Code session linked" });
    expect(handOverHint("ended", 0)).toBe(handOverHint(undefined, 0));
    expect(handOverNotice("ended", 0)).toBe(handOverNotice(undefined, 0));
  });

  test("listening wins: an agent blocked on the board waits for the hand-over", () => {
    const t = withSession();
    t.do({ kind: "tool-start", call: "c1", tool: "Bash", summary: "vico wait" }, "agent", "s1");
    expect(agentStatus(session(t), 1)).toEqual({
      tone: "listening",
      text: "Claude is waiting for you to hand over",
    });
  });
});

test("an agent listening with no session linked (plain `vico wait`) is still shown as listening", () => {
  expect(agentStatus(undefined, 1)).toEqual({
    tone: "listening",
    text: "Claude is waiting for you to hand over",
  });
});

describe("handOverHint says when Claude will see the changes", () => {
  test("at once when it listens", () => {
    expect(handOverHint("running", 1)).toBe("Claude resumes as soon as you hand over.");
  });
  test("after its current action when it works", () => {
    expect(handOverHint("running", 0)).toBe(
      "Claude is working: it will read your changes after its current action.",
    );
    expect(handOverHint("thinking", 0)).toBe(
      "Claude is working: it will read your changes after its current action.",
    );
  });
  test("at the next terminal message when it rests or waits there", () => {
    expect(handOverHint("idle", 0)).toBe(
      "Claude is idle: it will read your changes at your next message in the terminal.",
    );
    expect(handOverHint("waiting", 0)).toBe(
      "Claude is idle: it will read your changes at your next message in the terminal.",
    );
    expect(handOverHint(undefined, 0)).toBe(
      "No session linked: Claude will read your changes when a session starts here.",
    );
  });
});

describe("handOverNotice says, right after a hand-over, why nothing moves in the terminal", () => {
  test("nothing to add when Claude listens: it resumes at once", () => {
    expect(handOverNotice("idle", 1)).toBeUndefined();
  });
  test("Claude at rest reads it only at the next terminal message", () => {
    expect(handOverNotice("idle", 0)).toBe(
      "Handed over. Claude is not listening: it will read this at your next message in the terminal.",
    );
    expect(handOverNotice("waiting", 0)).toBe(handOverNotice("idle", 0));
    expect(handOverNotice("idle", 0, "fr")).toBe(
      "Main passée. Claude n'écoute pas : il la lira à ton prochain message dans le terminal.",
    );
  });
  test("Claude at work reads it after its current action; without a session, when one starts", () => {
    expect(handOverNotice("running", 0)).toBe(
      "Handed over. Claude is working: it will read this after its current action.",
    );
    expect(handOverNotice(undefined, 0)).toBe(
      "Handed over. No session linked: Claude will read this when a session starts here.",
    );
  });
});

describe("pendingCount is what Claude has not been told, net of back-and-forth", () => {
  test("counts the human's net changes after the session's cursor", () => {
    const t = withSession();
    expect(pendingCount(t.events, session(t))).toBe(0);
    t.script('rename E1 "Essai"\nrename E1 "Validée"\nrm H1', "human");
    expect(pendingCount(t.events, session(t))).toBe(2);
    t.do({ kind: "delivered", upTo: t.seq }, "system", "s1");
    expect(pendingCount(t.events, session(t))).toBe(0);
  });

  test("with no session, everything the human did is pending", () => {
    const t = table(ORDERING).script('rename E1 "Validée"', "human");
    expect(pendingCount(t.events, undefined)).toBe(1);
  });
});

describe("describeEvent words one journal line for the history", () => {
  const line = (t: Table, index = -1): string => {
    const event = t.events.at(index);
    if (!event) throw new Error("no event");
    return describeEvent(event);
  };

  test("board events name the element and the author", () => {
    const t = table(ORDERING);
    expect(line(t, 0)).toBe("Claude creates the board “Passage de commande”");
    expect(line(t, 3)).toBe("Claude adds E1 “Commande passée”");
    t.script('rename E1 "Validée"', "human");
    expect(line(t)).toBe("You rename E1 to “Validée”");
    t.script("move E2 --col 3", "human");
    expect(line(t)).toBe("You move E2");
    t.script("rm H1", "human");
    expect(line(t)).toBe("You remove H1");
    t.script("link E2 P1");
    expect(line(t)).toBe("Claude links E2 → P1");
    t.script('focus E1 --why "ici"');
    expect(line(t)).toBe("Claude puts the focus on E1: ici");
    t.do({ kind: "note", board: "commande", text: "Qui réserve ?", target: "P1" }, "human");
    expect(line(t)).toBe("You note on P1: Qui réserve ?");
    t.script('reply N1 "L\'entrepôt"');
    expect(line(t)).toBe("Claude replies to N1 on P1: L'entrepôt");
    t.script('reply N1 "Toujours ?"', "human");
    expect(line(t)).toBe("You reply to N1 on P1: Toujours ?");
    t.do({ kind: "pass", board: "commande", to: "agent" }, "human");
    expect(line(t)).toBe("You hand over to Claude");
    t.script('pass "à toi"');
    expect(line(t)).toBe("Claude hands over to you: à toi");
  });

  test("a removed board is named by its title", () => {
    const t = table(ORDERING).script("board rm commande", "human");
    expect(line(t)).toBe("You remove the board “Passage de commande”");
  });

  test("session events tell the terminal's story", () => {
    const t = withSession();
    expect(line(t)).toBe("Session started");
    t.do({ kind: "prompt", text: "Modélise la commande\nen détail" }, "agent", "s1");
    expect(line(t)).toBe("Prompt: Modélise la commande en détail");
    t.do({ kind: "tool-start", call: "c1", tool: "Bash", summary: "bun test" }, "agent", "s1");
    expect(line(t)).toBe("Claude runs Bash bun test");
    t.do({ kind: "tool-finish", call: "c1", ok: false }, "agent", "s1");
    expect(line(t)).toBe("Tool failed");
    t.do({ kind: "turn-end" }, "agent", "s1");
    expect(line(t)).toBe("Claude ended its turn");
    t.do({ kind: "delivered", upTo: 3 }, "system", "s1");
    expect(line(t)).toBe("Claude read your changes");
  });

  test("every event of a real journal has a wording, short enough for one line", () => {
    const t = withSession(ORDERING)
      .script(KANBAN)
      .script(
        "move T3 --lane doing\ninsert-col 1 --board commande\nunlink C1 E1 --board commande\nresolve N1 --board commande".replace(
          "resolve N1 --board commande",
          "focus --board sprint",
        ),
        "human",
      );
    for (const event of t.events) {
      for (const locale of LOCALES) {
        const text = describeEvent(event, locale);
        expect(text).not.toBe("");
        expect(text.length).toBeLessThanOrEqual(90);
        expect(text).not.toContain("\n");
      }
    }
  });
});

test("recentTurns keeps the last turns, oldest first, so the newest sits by the status", () => {
  const t = withSession();
  for (const text of ["un", "deux", "trois", "quatre"]) t.do({ kind: "prompt", text }, "agent", "s1");
  expect(recentTurns(session(t), 3).map((turn) => turn.prompt)).toEqual(["deux", "trois", "quatre"]);
  expect(recentTurns(undefined, 3)).toEqual([]);
});

describe("in French, when the reader asks for it", () => {
  test("the status and the hand-over hint", () => {
    const t = withSession();
    expect(agentStatus(undefined, 0, "fr").text).toBe("Aucune session Claude Code reliée");
    expect(agentStatus(session(t), 0, "fr").text).toBe("Claude est au repos");
    expect(agentStatus(session(t), 1, "fr").text).toBe("Claude attend que tu lui passes la main");
    t.do({ kind: "tool-start", call: "c1", tool: "Bash", summary: "bun test" }, "agent", "s1");
    expect(agentStatus(session(t), 0, "fr").text).toBe("Claude exécute Bash bun test");
    expect(handOverHint("running", 0, "fr")).toBe(
      "Claude travaille : il lira tes changements après son action en cours.",
    );
  });

  test("the history lines", () => {
    const t = table(ORDERING);
    const line = (): string => describeEvent(t.events.at(-1) as never, "fr");
    expect(describeEvent(t.events[0] as never, "fr")).toBe("Claude crée le tableau « Passage de commande »");
    t.script('rename E1 "Validée"', "human");
    expect(line()).toBe("Tu renommes E1 en « Validée »");
    t.script('note "Qui réserve ?" --on P1\nreply N1 "L\'entrepôt"');
    expect(line()).toBe("Claude répond à N1 sur P1 : L'entrepôt");
    t.script('note "Et le reste ?"\nreply N3 "Plus tard"', "human");
    expect(line()).toBe("Tu réponds à N3 : Plus tard");
    t.do({ kind: "pass", board: "commande", to: "agent" }, "human");
    expect(line()).toBe("Tu passes la main à Claude");
    t.script('pass "à toi"');
    expect(line()).toBe("Claude te passe la main : à toi");
  });
});

describe("the page's own words", () => {
  test("count in the reader's language", () => {
    expect(MESSAGES.en.pending(1)).toBe("1 change Claude has not read");
    expect(MESSAGES.en.pending(3)).toBe("3 changes Claude has not read");
    expect(MESSAGES.fr.pending(1)).toBe("1 changement que Claude n'a pas lu");
    expect(MESSAGES.fr.pending(3)).toBe("3 changements que Claude n'a pas lus");
    expect(MESSAGES.en.live(1)).toBe("Live · 1 event");
    expect(MESSAGES.fr.live(2)).toBe("En direct · 2 événements");
    expect(MESSAGES.en.handOver).toBe("Hand over to Claude");
    expect(MESSAGES.fr.handOver).toBe("Passer la main à Claude");
  });

  test("removing a board says what leaves and how it comes back, before it is done", () => {
    expect(MESSAGES.en.removeBoardQuestion("Sprint 12")).toBe("Remove the board “Sprint 12”?");
    expect(MESSAGES.fr.removeBoardQuestion("Sprint 12")).toBe("Supprimer le tableau « Sprint 12 » ?");
    expect(MESSAGES.en.removeBoardConsequence(0)).toStartWith("It is empty. ");
    expect(MESSAGES.en.removeBoardConsequence(1)).toStartWith("It holds 1 element. ");
    expect(MESSAGES.en.removeBoardConsequence(3)).toStartWith("It holds 3 elements. ");
    expect(MESSAGES.fr.removeBoardConsequence(3)).toStartWith("Il contient 3 éléments. ");
    for (const locale of LOCALES) {
      expect(MESSAGES[locale].removeBoardConsequence(3)).toContain("Claude");
    }
    expect(MESSAGES.en.removeBoardConsequence(3)).toEndWith(" Undo brings it back.");
    expect(MESSAGES.fr.removeBoardConsequence(3)).toEndWith(" Annuler le fait revenir.");
  });

  test("Undo and Redo name their shortcut, and the removal that can be taken back names the board", () => {
    expect(MESSAGES.en.undo("Ctrl+Z")).toBe("Undo your last change (Ctrl+Z)");
    expect(MESSAGES.en.redo("⇧⌘Z")).toBe("Redo (⇧⌘Z)");
    expect(MESSAGES.fr.undo("⌘Z")).toBe("Annuler ton dernier changement (⌘Z)");
    expect(MESSAGES.fr.redo("Ctrl+Maj+Z")).toBe("Rétablir (Ctrl+Maj+Z)");
    expect([MESSAGES.en.undoAction, MESSAGES.en.redoAction]).toEqual(["Undo", "Redo"]);
    expect([MESSAGES.fr.undoAction, MESSAGES.fr.redoAction]).toEqual(["Annuler", "Rétablir"]);
    expect(MESSAGES.en.boardRemoved("Sprint 12")).toBe("Board “Sprint 12” removed.");
    expect(MESSAGES.fr.boardRemoved("Sprint 12")).toBe("Tableau « Sprint 12 » supprimé.");
    expect(MESSAGES.fr.agentRestoredBoard("Sprint 12")).toBe("Claude a restauré le tableau « Sprint 12 ».");
  });

  test("a tab left open across an update says so, beside the offer to reload", () => {
    expect([MESSAGES.en.updated, MESSAGES.en.reload]).toEqual(["Vico was updated.", "Reload"]);
    expect([MESSAGES.fr.updated, MESSAGES.fr.reload]).toEqual(["Vico a été mis à jour.", "Recharger"]);
  });

  test("the language is the reader's choice, then the companion's, then English", () => {
    expect(pickLocale("fr", "en")).toBe("fr");
    expect(pickLocale("en", "fr")).toBe("en");
    expect(pickLocale(null, "fr")).toBe("fr");
    expect(pickLocale("klingon", "fr-FR")).toBe("fr");
    expect(pickLocale(null, "")).toBe("en");
    expect(pickLocale(undefined, undefined)).toBe("en");
  });
});

describe("discussions are the open notes as the page shows them, thread by thread", () => {
  test("each one names its card, lists its messages in order, and says who is waited for", () => {
    const t = table(ORDERING).script('note "Qui réserve ?" --on P1\nnote "Et le reste ?"');
    t.script('reply N1 "L\'entrepôt"\nnote "Réglé" --on E1', "human");
    t.script("resolve N4");
    expect(discussions(t.board())).toEqual([
      {
        id: "N1",
        on: { id: "P1", label: "Quand commande passée, réserver le stock" },
        waits: "claude",
        notes: [
          { id: "N1", by: "agent", text: "Qui réserve ?" },
          { id: "N3", by: "human", text: "L'entrepôt" },
        ],
      },
      { id: "N2", on: undefined, waits: "you", notes: [{ id: "N2", by: "agent", text: "Et le reste ?" }] },
    ]);
  });

  test("a discussion outlives its card: the id stays, the label is gone", () => {
    const t = table(ORDERING).script('note "Qui réserve ?" --on P1\nrm P1');
    expect(discussions(t.board())).toMatchObject([{ id: "N1", on: { id: "P1", label: undefined } }]);
  });

  test("the page's words for a discussion", () => {
    expect(MESSAGES.en.openNotes(2)).toBe("Open notes (2)");
    expect([MESSAGES.en.wholeBoard, MESSAGES.fr.wholeBoard]).toEqual(["Whole board", "Tout le tableau"]);
    expect(MESSAGES.en.cardGone("P1")).toBe("P1 (removed)");
    expect(MESSAGES.fr.cardGone("P1")).toBe("P1 (supprimé)");
    expect([MESSAGES.en.author.human, MESSAGES.en.author.agent]).toEqual(["You", "Claude"]);
    expect([MESSAGES.fr.author.human, MESSAGES.fr.author.agent]).toEqual(["Toi", "Claude"]);
    expect([MESSAGES.en.waits.you, MESSAGES.en.waits.claude]).toEqual([
      "Awaits your answer",
      "Awaits Claude",
    ]);
    expect([MESSAGES.fr.waits.you, MESSAGES.fr.waits.claude]).toEqual(["Attend ta réponse", "Attend Claude"]);
    expect(MESSAGES.en.replyTo("N1")).toBe("Reply to N1");
    expect(MESSAGES.fr.replyTo("N1")).toBe("Répondre à N1");
    expect([MESSAGES.en.reply, MESSAGES.fr.reply]).toEqual(["Reply", "Répondre"]);
  });
});

describe("the history says when a line takes an earlier one back", () => {
  const t = table(ORDERING).script('rename E1 "Validée"\nrm H1', "human");
  const last = (locale: "en" | "fr"): string => describeEvent(t.events.at(-1) as never, locale);

  test("a restored element, an undone rename, a redone one", () => {
    t.do({ kind: "undo", board: "commande" }, "human");
    expect(last("en")).toBe("You restore H1 “Et si le stock manque ?” (undo)");
    expect(last("fr")).toBe("Tu restaures H1 « Et si le stock manque ? » (annulation)");
    t.do({ kind: "undo", board: "commande" }, "human");
    expect(last("en")).toBe("You rename E1 to “Commande passée” (undo)");
    t.do({ kind: "redo", board: "commande" }, "human");
    expect(last("en")).toBe("You rename E1 to “Validée” (redo)");
    expect(last("fr")).toBe("Tu renommes E1 en « Validée » (rétablissement)");
  });

  test("a restored board", () => {
    t.script("board rm commande").do({ kind: "undo", board: "commande" });
    expect(last("en")).toBe("Claude restores the board “Passage de commande” (undo)");
    expect(last("fr")).toBe("Claude restaure le tableau « Passage de commande » (annulation)");
  });
});

describe("what Undo and Redo in the page would act on", () => {
  test("nothing, until the reader has done something on the board shown", () => {
    const t = table(ORDERING);
    expect(undoTarget(t.ws, "commande")).toBeUndefined();
    expect(redoTarget(t.ws, "commande")).toBeUndefined();
    expect(undoTarget(t.ws, undefined)).toBeUndefined();
  });

  test("the board shown, for the reader's own gestures only", () => {
    const t = table(ORDERING).script('rename E1 "Validée"', "human");
    expect(undoTarget(t.ws, "commande")).toBe("commande");
    expect(undoTarget(t.ws, "commande", "system")).toBeUndefined();
    t.do({ kind: "undo", board: "commande" }, "human");
    expect(undoTarget(t.ws, "commande")).toBeUndefined();
    expect(redoTarget(t.ws, "commande")).toBe("commande");
  });

  test("a board the reader just removed, even though another one is shown", () => {
    const t = table(ORDERING).script(KANBAN).script("move T3 --lane doing", "human");
    t.script("board rm commande", "human");
    expect(undoTarget(t.ws, "sprint")).toBe("commande");
    expect(undoTarget(t.ws, undefined)).toBe("commande");
    // A later gesture on the board shown comes first; the removal is next in line.
    t.script("move T4 --lane doing", "human", "sprint");
    expect(undoTarget(t.ws, "sprint")).toBe("sprint");
    t.do({ kind: "undo", board: "sprint" }, "human");
    expect(undoTarget(t.ws, "sprint")).toBe("commande");
  });

  test("never a board Claude removed", () => {
    const t = table(ORDERING).script(KANBAN).script("board rm commande", "agent");
    expect(undoTarget(t.ws, "sprint")).toBeUndefined();
  });
});

describe("addOffers: a + in the free room under the pointer, one per kind of card that goes there", () => {
  test("a timeline cell offers the kind of its row, just under its stack", () => {
    const board = table(ORDERING).board();
    const target = { kind: "cell", col: 2, type: "readmodel" } as const;
    const room = vacancy(board, target);
    if (!room) throw new Error("no room");
    const [offer, ...others] = addOffers(board, target, "fr");
    expect(others).toEqual([]);
    expect(offer).toMatchObject({ type: "readmodel", text: "+", label: "Ajouter : Vue" });
    if (!offer) throw new Error("no offer");
    // Centred in the column, and inside the empty row from top to bottom.
    expect(offer.x + offer.w / 2).toBe(room.x + room.w / 2);
    expect(offer.y).toBeGreaterThanOrEqual(room.y);
    expect(offer.y + offer.h).toBeLessThanOrEqual(room.y + room.h);
    expect(offer.fill).toMatch(/^#/);
  });

  test("a lane offers each kind of card of the workshop, side by side, close under the last card", () => {
    const board = table(KANBAN).board();
    const target = { kind: "slot", lane: "todo", before: "T3" } as const;
    const room = vacancy(board, target);
    const last = layoutBoard(board).cards.find((c) => c.id === "T4");
    if (!room || !last) throw new Error("no room");
    const offers = addOffers(board, target);
    expect(offers.map((o) => `${o.type} ${o.text} ${o.label}`)).toEqual([
      "task + T Add: Task",
      "blocker + B Add: Blocker",
    ]);
    const [task, blocker] = offers;
    if (!task || !blocker) throw new Error("no offers");
    expect(blocker.x).toBeGreaterThan(task.x + task.w);
    expect((task.x + blocker.x + blocker.w) / 2).toBe(room.x + room.w / 2);
    expect(task.y).toBe(blocker.y);
    // Under the last card without touching it, and near it rather than at the foot of the lane.
    expect(task.y).toBeGreaterThan(last.y + last.h);
    expect(task.y).toBeLessThan(last.y + last.h + 40);
  });

  test("nothing is offered off the board, nor on a flow", () => {
    expect(addOffers(table(KANBAN).board(), { kind: "none" })).toEqual([]);
    expect(addOffers(table(FLOW).board(), { kind: "cell", col: 1, type: "step" })).toEqual([]);
  });
});
