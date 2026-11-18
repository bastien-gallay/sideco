import { describe, expect, test } from "bun:test";
import { describeBoard, describeChanges } from "../../src/domain/digest.ts";
import { FLOW, IMPACT_EFFORT, KANBAN, ORDERING, type Table, table } from "../support.ts";

const human = (t: Table, script: string): Table => t.script(script, "human");
const changes = (t: Table, after: number): string => describeChanges(t.events, after).text;

describe("describeBoard", () => {
  test("a timeline reads column by column, in the order of the type rows", () => {
    const t = table(ORDERING)
      .script('detail P1 "Règle de gestion n°4"')
      .script('focus H1 --why "à trancher"');
    t.do({ kind: "note", board: "commande", text: "Qui réserve ?", target: "P1" }, "human");
    t.script('reply N1 "L\'entrepôt"');
    t.do({ kind: "note", board: "commande", text: "Réglé", target: "E1" }, "human");
    t.script("resolve N3");
    expect(describeBoard(t.board())).toBe(
      [
        `# commande — Passage de commande (event-storming, seq ${t.seq})`,
        "col 1",
        '  X1 actor "Client"',
        '  C1 command "Passer commande"',
        '  E1 event "Commande passée"',
        "col 2",
        '  C2 command "Réserver le stock"',
        '  E2 event "Stock réservé"',
        '  P1 policy "Quand commande passée, réserver le stock" — Règle de gestion n°4',
        '  H1 hotspot "Et si le stock manque ?"',
        "links",
        "  C1 -> E1",
        "  E1 -> P1",
        "open notes",
        "  N1 by human on P1: Qui réserve ?",
        "    N2 by agent: L'entrepôt",
        "focus: H1 — à trancher",
      ].join("\n"),
    );
  });

  test("a lane that says what it stands for says it to the agent too", () => {
    const lanes = describeBoard(table(IMPACT_EFFORT).board())
      .split("\n")
      .filter((line) => line.startsWith("lane "));
    expect(lanes).toEqual([
      "lane quick (Quick wins: High impact · low effort)",
      "lane bet (Big bets: High impact · high effort)",
      "lane fill (Fill-ins: Low impact · low effort)",
      "lane avoid (Avoid: Low impact · high effort)",
    ]);
  });

  test("columns read lane by lane, in stacking order", () => {
    expect(describeBoard(table(KANBAN).board()).split("\n").slice(1)).toEqual([
      "lane todo (To do)",
      '  T3 task "Tester de bout en bout"',
      '  T4 task "Publier"',
      "lane doing (Doing)",
      '  T2 task "Brancher les hooks"',
      '  B1 blocker "Port bloqué en bac à sable"',
      "lane done (Done)",
      '  T1 task "Écrire le PRD"',
    ]);
  });

  test("a graph lists its elements, then its links", () => {
    const text = describeBoard(table(FLOW).board());
    expect(text).toContain('elements\n  S1 step "Recevoir la commande"');
    expect(text).toContain('  D1 -> S2 "oui"');
  });

  test("an empty board says so", () => {
    expect(describeBoard(table('board new "Vide" --id vide').board())).toContain("(empty)");
  });
});

describe("describeChanges", () => {
  test("a removed board is one line, whatever was done on it before", () => {
    const t = table(ORDERING);
    const mark = t.seq;
    human(t, 'rename E1 "Validée"\nmove E2 --col 3\nboard rm commande');
    expect(describeChanges(t.events, mark)).toMatchObject({
      text: 'board commande "Passage de commande"\n  − board removed',
      count: 1,
    });
  });

  test("a board created and removed in between leaves no trace", () => {
    const t = table(ORDERING);
    const mark = t.seq;
    human(t, 'board new "Brouillon" --id brouillon\nadd event "X"\nboard rm brouillon');
    expect(describeChanges(t.events, mark)).toMatchObject({ text: "", count: 0 });
  });

  test("a board removed then made again reads as removed, then as the new one", () => {
    const t = table(ORDERING);
    const mark = t.seq;
    human(t, 'board rm commande\nboard new "Reprise" --id commande --format flow\nadd step "Recevoir"');
    expect(changes(t, mark).split("\n")).toEqual([
      'board commande "Reprise"',
      "  − board removed",
      '  + board created: "Reprise" (flow)',
      '  + S1 step "Recevoir"',
    ]);
  });

  test("nothing from the human means an empty digest", () => {
    const t = table(ORDERING);
    expect(describeChanges(t.events, 0)).toMatchObject({ text: "", count: 0, passed: false, upTo: t.seq });
  });

  test("each kind of change carries its sign", () => {
    const t = table(ORDERING);
    const mark = t.seq;
    human(
      t,
      'add event "Paiement reçu" --col 3\nrename E1 "Commande validée"\nmove E2 --col 3\nrm H1\nlink E2 E3\nunlink C1 E1',
    );
    expect(changes(t, mark).split("\n")).toEqual([
      'board commande "Passage de commande"',
      '  + E3 event "Paiement reçu" (col 3)',
      '  ~ E1 renamed "Commande passée" → "Commande validée"',
      "  → E2 moved col 2 → 3",
      '  − H1 hotspot "Et si le stock manque ?" removed',
      "  + link E2 -> E3",
      "  − link C1 -> E1",
    ]);
  });

  test("only changes after the mark, and only the human's", () => {
    const t = table(ORDERING);
    human(t, 'rename E1 "Avant"');
    const mark = t.seq;
    t.script('rename E2 "Par l\'agent"');
    human(t, 'rename X1 "Cliente"');
    expect(changes(t, mark)).toBe(
      'board commande "Passage de commande"\n  ~ X1 renamed "Client" → "Cliente"',
    );
  });

  test("back-and-forth nets out", () => {
    const t = table(ORDERING);
    const mark = t.seq;
    human(t, 'rename E1 "Essai"\nrename E1 "Commande passée"');
    human(t, "move E2 --col 5\nmove E2 --col 2");
    human(t, 'add event "Brouillon"\nrename E3 "Toujours brouillon"\nrm E3');
    human(t, "link E2 E1\nunlink E2 E1");
    expect(describeChanges(t.events, mark)).toMatchObject({ text: "", count: 0 });
  });

  test("an element added then edited shows once, in its final state", () => {
    const t = table(ORDERING);
    const mark = t.seq;
    human(t, 'add event "Payé"\nrename E3 "Paiement reçu"\nmove E3 --col 1');
    expect(changes(t, mark)).toBe(
      'board commande "Passage de commande"\n  + E3 event "Paiement reçu" (col 1)',
    );
  });

  test("a rename keeps the label the agent last saw as its origin", () => {
    const t = table(ORDERING);
    const mark = t.seq;
    human(t, 'rename E1 "Un"\nrename E1 "Deux"');
    expect(changes(t, mark)).toContain('~ E1 renamed "Commande passée" → "Deux"');
  });

  test("notes, focus and the hand-over reach the agent, with the message", () => {
    const t = table(ORDERING);
    const mark = t.seq;
    t.do({ kind: "note", board: "commande", text: "Qui réserve ?", target: "P1" }, "human");
    t.do({ kind: "focus", board: "commande", ids: ["H1"], reason: "on commence ici" }, "human");
    t.do({ kind: "pass", board: "commande", to: "agent", message: "à toi" }, "human");
    const found = describeChanges(t.events, mark);
    expect(found.passed).toBe(true);
    expect(found.text.split("\n")).toEqual([
      'board commande "Passage de commande"',
      "  note N1 on P1: Qui réserve ?",
      "  focus on H1: on commence ici",
      "The human passed you the turn: à toi",
    ]);
  });

  test("a reply names the note it answers and the card the thread is on", () => {
    const t = table(ORDERING).script('note "Qui réserve ?" --on P1\nnote "Et le reste ?"');
    const mark = t.seq;
    human(t, 'reply N1 "L\'entrepôt"\nreply N2 "Plus tard"');
    expect(changes(t, mark).split("\n")).toEqual([
      'board commande "Passage de commande"',
      "  reply N3 to N1 on P1: L'entrepôt",
      "  reply N4 to N2: Plus tard",
    ]);
  });

  test("a reply and the thread it closes are both told; a thread opened and closed unseen is not", () => {
    const t = table(ORDERING).script('note "Qui réserve ?" --on P1');
    const mark = t.seq;
    human(t, 'reply N1 "L\'entrepôt"\nresolve N1');
    human(t, 'note "Pour moi"\nreply N3 "Encore moi"\nresolve N3');
    expect(changes(t, mark).split("\n")).toEqual([
      'board commande "Passage de commande"',
      "  reply N2 to N1 on P1: L'entrepôt",
      "  ✓ note N1 resolved",
    ]);
  });

  test("a hand-over alone is still worth telling", () => {
    const t = table(ORDERING);
    const mark = t.seq;
    t.do({ kind: "pass", board: "commande", to: "agent" }, "human");
    expect(describeChanges(t.events, mark)).toMatchObject({
      text: "The human passed you the turn.",
      count: 0,
      passed: true,
    });
  });

  test("a word said at a hand-over is not erased by handing over again without one", () => {
    const t = table(ORDERING);
    const mark = t.seq;
    t.do({ kind: "pass", board: "commande", to: "agent", message: "j'ai répondu aux notes" }, "human");
    t.do({ kind: "pass", board: "commande", to: "agent" }, "human");
    expect(changes(t, mark)).toBe("The human passed you the turn: j'ai répondu aux notes");
    t.do({ kind: "pass", board: "commande", to: "agent", message: "et S20 ?" }, "human");
    t.do({ kind: "pass", board: "commande", to: "agent", message: "et S20 ?" }, "human");
    expect(changes(t, mark)).toBe("The human passed you the turn: j'ai répondu aux notes / et S20 ?");
  });

  test("changes are grouped by board", () => {
    const t = table(ORDERING).script(KANBAN);
    const mark = t.seq;
    t.script("move T3 --lane doing", "human", "sprint")
      .script('rename E1 "Validée"', "human", "commande")
      .script("rm T4", "human", "sprint");
    expect(changes(t, mark).split("\n")).toEqual([
      'board sprint "Sprint 12"',
      "  → T3 moved lane todo → doing",
      '  − T4 task "Publier" removed',
      'board commande "Passage de commande"',
      '  ~ E1 renamed "Commande passée" → "Validée"',
    ]);
  });

  test("reordering a lane is a change: priorities are told by position", () => {
    const t = table(KANBAN);
    const mark = t.seq;
    human(t, "move T4 --lane todo --before T3");
    expect(changes(t, mark)).toBe('board sprint "Sprint 12"\n  → T4 moved before T3 in lane todo');
  });

  test("a card moved to another lane says where it landed when that is not the end", () => {
    const t = table(KANBAN);
    const mark = t.seq;
    human(t, "move T3 --lane doing --before T2");
    expect(changes(t, mark)).toBe('board sprint "Sprint 12"\n  → T3 moved lane todo → doing, before T2');
  });
});

describe("the digest says which cards and threads its lines name, board by board", () => {
  const about = (t: Table, after: number) => describeChanges(t.events, after).about;

  test("every card a line names, once: added, renamed, detailed, moved, removed, linked, focused", () => {
    const t = table(ORDERING);
    const mark = t.seq;
    human(
      t,
      'add event "Payé" --col 3\nrename E1 "Validée"\nrename E1 "Commande validée"\ndetail E1 "à revoir"',
    );
    human(t, "move E2 --col 3\nrm H1\nlink C2 E2\nunlink C1 E1\nfocus P1");
    expect(about(t, mark)).toEqual([
      { board: "commande", elements: ["E3", "E1", "E2", "H1", "C2", "C1", "P1"], threads: [] },
    ]);
  });

  test("a change that nets out names nothing: renamed back, moved back, added then removed", () => {
    const t = table(ORDERING);
    const mark = t.seq;
    human(t, 'rename E1 "Essai"\nrename E1 "Commande passée"');
    human(t, "move E2 --col 5\nmove E2 --col 2");
    human(t, 'add event "Brouillon"\nrename E3 "Toujours brouillon"\nrm E3');
    expect(about(t, mark)).toEqual([]);
  });

  test("a note names its thread, and the card it is pinned on; a reply names the thread it answers", () => {
    const t = table(ORDERING).script('note "Qui réserve ?" --on P1\nnote "Et le reste ?"');
    const mark = t.seq;
    human(t, 'reply N1 "L\'entrepôt"\nreply N1 "Toujours"\nnote "Pour toi" --on E1\nresolve N2');
    expect(about(t, mark)).toEqual([
      { board: "commande", elements: ["P1", "E1"], threads: ["N1", "N5", "N2"] },
    ]);
  });

  test("a thread opened and closed unseen is not named; what the reader already saw is not either", () => {
    const t = table(ORDERING);
    human(t, 'rename E1 "Avant"');
    const mark = t.seq;
    human(t, 'note "Pour moi"\nreply N1 "Encore moi"\nresolve N1');
    t.script('rename E2 "Par l\'agent"');
    expect(about(t, mark)).toEqual([]);
  });

  test("each board has its own cards and threads; a line about the board itself names none", () => {
    const t = table(ORDERING).script(KANBAN);
    const mark = t.seq;
    t.script("move T3 --lane doing", "human", "sprint")
      .script('rename E1 "Validée"\nnote "Vu"', "human", "commande")
      .script('retitle "Sprint 13"', "human", "sprint");
    human(t, 'board new "Brouillon" --id brouillon');
    expect(describeChanges(t.events, mark).count).toBe(5);
    expect(about(t, mark)).toEqual([
      { board: "sprint", elements: ["T3"], threads: [] },
      { board: "commande", elements: ["E1"], threads: ["N1"] },
    ]);
  });
});

describe("moves are worded against the final board", () => {
  test("a card sent to the end of its lane", () => {
    const t = table(KANBAN);
    const mark = t.seq;
    human(t, "move T3 --lane todo");
    expect(changes(t, mark)).toBe('board sprint "Sprint 12"\n  → T3 moved to the end of lane todo');
  });

  test("a card moved away and back to its place is no change", () => {
    const t = table(KANBAN);
    const mark = t.seq;
    human(t, "move T3 --lane doing\nmove T3 --lane todo --before T4");
    expect(describeChanges(t.events, mark)).toMatchObject({ text: "", count: 0 });
  });

  test("a move keeps its place among the other changes", () => {
    const t = table(KANBAN);
    const mark = t.seq;
    human(t, 'rename T1 "PRD relu"\nmove T3 --lane done\nrm T4');
    expect(changes(t, mark).split("\n").slice(1)).toEqual([
      '  ~ T1 renamed "Écrire le PRD" → "PRD relu"',
      "  → T3 moved lane todo → done",
      '  − T4 task "Publier" removed',
    ]);
  });

  test("a card moved then removed leaves only the removal", () => {
    const t = table(KANBAN);
    const mark = t.seq;
    human(t, "move T3 --lane done\nrm T3");
    expect(changes(t, mark)).toBe('board sprint "Sprint 12"\n  − T3 task "Tester de bout en bout" removed');
  });
});
