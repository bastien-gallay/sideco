import { describe, expect, test } from "bun:test";
import { LOCALES } from "../../src/domain/i18n.ts";
import { layoutBoard, vacancy } from "../../src/domain/layout/index.ts";
import { MESSAGES, pickLocale } from "../../src/web/messages.ts";
import {
  addOffers,
  agentStatus,
  claudeWaits,
  describeEvent,
  discussions,
  handOverHint,
  handOverNotice,
  historyBoard,
  historyPlace,
  historyStep,
  historyStopAt,
  historyStops,
  keptLines,
  oneLine,
  pendingChanges,
  recentTurns,
  redoTarget,
  undoTarget,
  unreadOn,
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
    t.do({ kind: "tool-start", call: "c1", tool: "Bash", summary: "sideco wait" }, "agent", "s1");
    expect(agentStatus(session(t), 1)).toEqual({
      tone: "listening",
      text: "Claude is waiting for you to send",
    });
  });
});

test("an agent listening with no session linked (plain `sideco wait`) is still shown as listening", () => {
  expect(agentStatus(undefined, 1)).toEqual({
    tone: "listening",
    text: "Claude is waiting for you to send",
  });
});

describe("handOverHint says when Claude will see the changes", () => {
  test("at once when it listens", () => {
    expect(handOverHint("running", 1)).toBe("Claude reads them as soon as you send.");
  });
  test("after its current action when it works", () => {
    expect(handOverHint("running", 0)).toBe("Claude will read them after its current action.");
    expect(handOverHint("thinking", 0)).toBe("Claude will read them after its current action.");
  });
  test("at the next terminal message when it rests or waits there", () => {
    expect(handOverHint("idle", 0)).toBe("Claude will read them at your next message in the terminal.");
    expect(handOverHint("waiting", 0)).toBe("Claude will read them at your next message in the terminal.");
    expect(handOverHint(undefined, 0)).toBe("No Claude session here yet: they will be read when one starts.");
  });
});

describe("handOverNotice says, right after a hand-over, why nothing moves in the terminal", () => {
  test("nothing to add when Claude listens: it resumes at once", () => {
    expect(handOverNotice("idle", 1)).toBeUndefined();
  });
  test("Claude at rest reads it only at the next terminal message", () => {
    expect(handOverNotice("idle", 0)).toBe(
      "Sent. Claude is not listening: it will read it at your next message in the terminal.",
    );
    expect(handOverNotice("waiting", 0)).toBe(handOverNotice("idle", 0));
    expect(handOverNotice("idle", 0, "fr")).toBe(
      "Envoyé. Claude n'écoute pas : il le lira à ton prochain message dans le terminal.",
    );
  });
  test("Claude at work reads it after its current action; without a session, when one starts", () => {
    expect(handOverNotice("running", 0)).toBe("Sent. Claude will read it after its current action.");
    expect(handOverNotice(undefined, 0)).toBe(
      "Sent. No Claude session here yet: it will be read when one starts.",
    );
  });
});

describe("pendingChanges is what Claude has not been told, net of back-and-forth", () => {
  test("counts the human's net changes after the session's cursor", () => {
    const t = withSession();
    expect(pendingChanges(t.events, session(t)).count).toBe(0);
    t.script('rename E1 "Essai"\nrename E1 "Validée"\nrm H1', "human");
    expect(pendingChanges(t.events, session(t)).count).toBe(2);
    t.do({ kind: "delivered", upTo: t.seq }, "system", "s1");
    expect(pendingChanges(t.events, session(t)).count).toBe(0);
  });

  test("with no session, everything the human did is pending", () => {
    const t = table(ORDERING).script('rename E1 "Validée"', "human");
    expect(pendingChanges(t.events, undefined).count).toBe(1);
  });
});

describe("unreadOn is what the pending digest names on one board: the cards and threads to mark", () => {
  const unread = (t: Table, board = "commande"): ReturnType<typeof unreadOn> =>
    unreadOn(pendingChanges(t.events, session(t)), board);

  test("a card the human renamed and a thread they answered, until the changes are delivered", () => {
    const t = withSession().script('note "Qui réserve ?" --on P1');
    expect(unread(t)).toEqual({ cards: [], threads: [] });
    t.script('rename E1 "Validée"\nreply N1 "L\'entrepôt"', "human");
    expect(unread(t)).toEqual({ cards: ["E1", "P1"], threads: ["N1"] });
    t.do({ kind: "delivered", upTo: t.seq }, "system", "s1");
    expect(unread(t)).toEqual({ cards: [], threads: [] });
    t.script('rename E2 "Réservé"', "human");
    expect(unread(t)).toEqual({ cards: ["E2"], threads: [] });
  });

  test("net of back-and-forth, like the count: renamed back, or added then removed, is nothing to read", () => {
    const t = withSession();
    t.script('rename E1 "Essai"\nrename E1 "Commande passée"\nadd event "Brouillon"\nrm E3', "human");
    expect(unread(t)).toEqual({ cards: [], threads: [] });
    expect(pendingChanges(t.events, session(t)).count).toBe(0);
  });

  test("Claude's own changes are not marked, and each board has its own marks", () => {
    const t = withSession().script(KANBAN).script('rename T1 "PRD relu"');
    t.script("move T3 --lane doing", "human", "sprint").script('rename E1 "Validée"', "human", "commande");
    expect(unread(t, "sprint")).toEqual({ cards: ["T3"], threads: [] });
    expect(unread(t, "commande")).toEqual({ cards: ["E1"], threads: [] });
  });

  test("with no session, everything the human touched is unread", () => {
    const t = table(ORDERING).script('rename E1 "Validée"\nnote "Vu"', "human");
    expect(unread(t)).toEqual({ cards: ["E1"], threads: ["N1"] });
  });

  test("the page's words for it", () => {
    expect([MESSAGES.en.unread, MESSAGES.fr.unread]).toEqual([
      "Not read by Claude yet",
      "Pas encore lu par Claude",
    ]);
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
    expect(line(t)).toBe("You send to Claude");
    t.script('pass "à toi"');
    expect(line(t)).toBe("Claude passes you the turn: à toi");
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
    expect(agentStatus(session(t), 1, "fr").text).toBe("Claude attend ton envoi");
    t.do({ kind: "tool-start", call: "c1", tool: "Bash", summary: "bun test" }, "agent", "s1");
    expect(agentStatus(session(t), 0, "fr").text).toBe("Claude exécute Bash bun test");
    expect(handOverHint("running", 0, "fr")).toBe("Claude les lira après son action en cours.");
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
    expect(line()).toBe("Tu envoies à Claude");
    t.script('pass "à toi"');
    expect(line()).toBe("Claude te rend la main : à toi");
  });
});

describe("the page's own words", () => {
  test("count in the reader's language", () => {
    expect(MESSAGES.en.pending(1)).toBe("1 change not read yet");
    expect(MESSAGES.en.pending(3)).toBe("3 changes not read yet");
    expect(MESSAGES.fr.pending(1)).toBe("1 changement pas encore lu");
    expect(MESSAGES.fr.pending(3)).toBe("3 changements pas encore lus");
    expect(MESSAGES.en.live(1)).toBe("Live · 1 event");
    expect(MESSAGES.fr.live(2)).toBe("En direct · 2 événements");
    expect([MESSAGES.en.thisBoard, MESSAGES.en.everything]).toEqual(["This board", "Everything"]);
    expect([MESSAGES.fr.thisBoard, MESSAGES.fr.everything]).toEqual(["Ce tableau", "Tout"]);
    expect(MESSAGES.en.handOver).toBe("Send to Claude");
    expect(MESSAGES.fr.handOver).toBe("Envoyer à Claude");
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
    expect([MESSAGES.en.updated, MESSAGES.en.reload]).toEqual(["Sideco was updated.", "Reload"]);
    expect([MESSAGES.fr.updated, MESSAGES.fr.reload]).toEqual(["Sideco a été mis à jour.", "Recharger"]);
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

describe("the history stops at the events of one board, or at every event of the journal", () => {
  // seq 1 session · 2-3 commande · 4-5 sprint · 6 prompt · 7 commande · 8 sprint · 9 tool · 10 commande · 11 sprint
  const t = withSession("");
  t.script('board new "Commande" --id commande\nadd event "Passée" --col 1');
  t.script('board new "Sprint" --format kanban --id sprint\nadd task "Tester"');
  t.do({ kind: "prompt", text: "go" }, "agent", "s1");
  t.script('add event "Payée" --col 2', "agent", "commande");
  t.script('add task "Publier"', "agent", "sprint");
  t.do({ kind: "tool-start", call: "c1", tool: "Bash", summary: "bun test" }, "agent", "s1");
  t.script("pass", "agent", "commande");
  t.script('add task "Livrer"', "agent", "sprint");
  const commande = historyStops(t.events, "commande");
  const journal = historyStops(t.events);

  test("one board: its events only, from its creation, whatever the other boards and the session did", () => {
    expect(commande).toEqual([2, 3, 7, 10]);
    expect(historyStops(t.events, "sprint")).toEqual([4, 5, 8, 11]);
  });

  test("the whole journal: every event, and the moment before the first", () => {
    expect(t.seq).toBe(11);
    expect(journal).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  test("the board followed is the one in the address, then the one on screen, if the journal knows it", () => {
    expect(historyBoard(t.events, "commande", "sprint")).toBe("commande");
    expect(historyBoard(t.events, null, "sprint")).toBe("sprint");
    expect(historyBoard(t.events, "never-was", "sprint")).toBe("sprint");
    expect(historyBoard(t.events, null, undefined)).toBeUndefined();
  });

  test("live sits on the last stop: one step back shows the board before its latest event", () => {
    expect(historyStep(commande, null, -1)).toBe(7);
    expect(historyStep(journal, null, -1)).toBe(10);
    expect(historyStep(commande, null, 1)).toBeNull();
  });

  test("from a stop, a step goes to the one before or after; arriving on the last one is being live", () => {
    expect(historyStep(commande, 7, -1)).toBe(3);
    expect(historyStep(commande, 3, 1)).toBe(7);
    expect(historyStep(commande, 7, 1)).toBeNull();
    expect(historyStep(journal, 10, 1)).toBeNull();
  });

  test("from a position that is not a stop, a step goes to the nearest stop that way, never further", () => {
    expect(historyStep(commande, 5, -1)).toBe(3);
    expect(historyStep(commande, 5, 1)).toBe(7);
    expect(historyStep(commande, 9, 1)).toBeNull();
  });

  test("a board's history starts at its creation: nothing earlier to step back to", () => {
    expect(historyStep(commande, 2, -1)).toBe(2);
    expect(historyStep(commande, 1, -1)).toBe(1);
    expect(historyStep(commande, 1, 1)).toBe(2);
  });

  test("the whole journal starts before its first event", () => {
    expect(historyStep(journal, 1, -1)).toBe(0);
    expect(historyStep(journal, 0, -1)).toBe(0);
    expect(historyStep(journal, 0, 1)).toBe(1);
  });

  test("past the board's last event nothing is ahead but the present", () => {
    const sprint = historyStops(t.events.slice(0, 10), "sprint");
    expect(sprint).toEqual([4, 5, 8]);
    expect(historyStep(sprint, 9, 1)).toBeNull();
    expect(historyStep(sprint, 9, -1)).toBeNull();
  });

  test("the slider goes stop by stop, and its far end is live", () => {
    expect(historyStopAt(commande, 0)).toBe(2);
    expect(historyStopAt(commande, 2)).toBe(7);
    expect(historyStopAt(commande, 3)).toBeNull();
    expect(historyStopAt(journal, 5)).toBe(5);
    expect(historyStopAt(journal, 11)).toBeNull();
  });

  test("the place counts the events of the scope: how many have happened, out of how many, and the latest", () => {
    expect(historyPlace(commande, null)).toEqual({ index: 3, at: 4, of: 4, seq: 10 });
    expect(historyPlace(commande, 7)).toEqual({ index: 2, at: 3, of: 4, seq: 7 });
    expect(historyPlace(journal, null)).toEqual({ index: 11, at: 11, of: 11, seq: 11 });
    expect(historyPlace(journal, 5)).toEqual({ index: 5, at: 5, of: 11, seq: 5 });
  });

  test("between two stops the board is as its latest event left it; before the first, none has happened", () => {
    expect(historyPlace(commande, 5)).toEqual({ index: 1, at: 2, of: 4, seq: 3 });
    expect(historyPlace(commande, 1)).toEqual({ index: 0, at: 0, of: 4, seq: undefined });
    expect(historyPlace(journal, 0)).toEqual({ index: 0, at: 0, of: 11, seq: undefined });
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

  test("not a removal older than a gesture made since on another board", () => {
    const t = table(ORDERING).script(KANBAN).script("board rm commande", "human");
    t.script(`board new "Autre" --format kanban --id autre\nadd task "Ailleurs"`, "human");
    // The reader's latest gesture is on « autre »: from « sprint », Undo has nothing of theirs to take back.
    expect(undoTarget(t.ws, "sprint")).toBeUndefined();
    expect(undoTarget(t.ws, "autre")).toBe("autre");
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

  test("the edge between two steps offers a column there, on the rule and in the heading", () => {
    const board = table(ORDERING).board();
    const second = layoutBoard(board).bands.find((b) => b.kind === "step" && b.id === "2");
    if (!second) throw new Error("no second step");
    const [offer, ...others] = addOffers(board, { kind: "boundary", col: 2 }, "fr");
    expect(others).toEqual([]);
    expect(offer).toMatchObject({ type: "column", column: 2, text: "+", label: "Insérer une colonne ici" });
    if (!offer) throw new Error("no offer");
    expect(offer.x + offer.w / 2).toBe(second.x);
    expect(offer.y).toBeGreaterThanOrEqual(0);
    expect(offer.y + offer.h).toBeLessThanOrEqual(32);
    expect(addOffers(board, { kind: "boundary", col: 2 })[0]?.label).toBe("Insert a column here");
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

describe("what is typed on a card is kept tidy", () => {
  test("a label is kept on one line, single-spaced", () => {
    expect(oneLine("  Commande \n  passée  ")).toBe("Commande passée");
  });

  test("a detail keeps its lines: each one single-spaced, and no more than one empty line in a row", () => {
    expect(keptLines("  - un  point \n- un autre\n\n\n\nFin  \n")).toBe("- un point\n- un autre\n\nFin");
    expect(keptLines("une seule   ligne")).toBe("une seule ligne");
    expect(keptLines(" \n \n")).toBe("");
  });
});

describe("claudeWaits says where Claude waits for the human", () => {
  test("nothing while no turn was handed to the human", () => {
    expect(claudeWaits(table(KANBAN).ws)).toBeUndefined();
    const t = table(KANBAN);
    t.do({ kind: "pass", board: "sprint", to: "agent" }, "human");
    expect(claudeWaits(t.ws)).toBeUndefined();
  });

  test("the board Claude handed over on, with its words", () => {
    const t = table(KANBAN).script('pass "Ton avis sur T2 ?"');
    expect(claudeWaits(t.ws)).toEqual({
      board: "sprint",
      title: "Sprint 12",
      message: "Ton avis sur T2 ?",
      others: 0,
    });
  });

  test("on several boards: the latest hand-over, and how many others", () => {
    const t = table(KANBAN).script("pass");
    t.script('board new "Autre" --id autre');
    t.do({ kind: "pass", board: "autre", to: "human" });
    expect(claudeWaits(t.ws)).toMatchObject({ board: "autre", title: "Autre", others: 1 });
  });

  test("an answer anywhere ends every wait before it: a hand-over on another board, or a prompt in the terminal", () => {
    const t = table(KANBAN).script("pass");
    t.script('board new "Autre" --id autre');
    t.do({ kind: "pass", board: "autre", to: "agent" }, "human");
    expect(claudeWaits(t.ws)).toBeUndefined();

    const typed = table(KANBAN).script("pass");
    typed.do({ kind: "session-start" }, "agent", "s1");
    typed.do({ kind: "prompt", text: "Continue" }, "agent", "s1");
    expect(claudeWaits(typed.ws)).toBeUndefined();
    typed.script("pass", "agent", "sprint");
    expect(claudeWaits(typed.ws)).toMatchObject({ board: "sprint", others: 0 });
  });

  test("handing the turn back ends the wait", () => {
    const t = table(KANBAN).script("pass");
    t.do({ kind: "pass", board: "sprint", to: "agent" }, "human");
    expect(claudeWaits(t.ws)).toBeUndefined();
  });
});
