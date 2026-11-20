/**
 * `sideco find`: a card found by what is written on it, across every board,
 * without knowing where it is. One line per card, its board and id first, so
 * that `show ID` takes over.
 */
import { describe, expect, test } from "bun:test";
import { describeFind } from "../../src/domain/digest.ts";
import { FLOW, KANBAN, table } from "../support.ts";

describe("`sideco find`", () => {
  test("finds a card by its name, across boards, whatever the case and the accents", () => {
    const t = table(KANBAN).script(FLOW);
    expect(describeFind(t.ws, "ecrire")).toBe('sprint T1 task "Écrire le PRD"');
    expect(describeFind(t.ws, "COMMANDE")).toBe(
      ['livraison S1 step "Recevoir la commande"', 'livraison S3 step "Commander au fournisseur"'].join("\n"),
    );
  });

  test("every word must be there, in any order", () => {
    const t = table(KANBAN);
    expect(describeFind(t.ws, "hooks brancher")).toBe('sprint T2 task "Brancher les hooks"');
    expect(describeFind(t.ws, "hooks publier")).toBe('nothing matches "hooks publier"');
  });

  test("a word found in the detail, a label or a note says where, with the words around it", () => {
    const t = table(KANBAN).script(
      [
        'detail T4 "Sur le registre npm, après la revue de sécurité et le tag v0.1.0."',
        "label T3 env:staging",
        'note "Le port 4752 est pris par le compagnon" --on B1',
      ].join("\n"),
    );
    expect(describeFind(t.ws, "revue")).toBe(
      'sprint T4 task "Publier" — detail: …registre npm, après la revue de sécurité et le tag v0.1.0.',
    );
    expect(describeFind(t.ws, "staging")).toBe('sprint T3 task "Tester de bout en bout" [env:staging]');
    expect(describeFind(t.ws, "4752")).toBe(
      'sprint B1 blocker "Port bloqué en bac à sable" — note N1: Le port 4752 est pris par le compagnon',
    );
  });

  test("an id finds its card and the cards that cite it, never a longer id", () => {
    const t = table(KANBAN).script('detail T3 "Après T2, avant T4."\nadd task "Relire T22"');
    expect(describeFind(t.ws, "t2")).toBe(
      [
        'sprint T2 task "Brancher les hooks"',
        'sprint T3 task "Tester de bout en bout" — detail: Après T2, avant T4.',
      ].join("\n"),
    );
  });

  test("a note on the board itself is found too; --board keeps to one board", () => {
    const t = table(KANBAN).script(FLOW).script('note "Penser à la commande groupée"', "human", "sprint");
    expect(describeFind(t.ws, "commande", "sprint")).toBe('sprint N1 note "Penser à la commande groupée"');
    expect(describeFind(t.ws, "commande").split("\n")).toHaveLength(3);
  });
});
