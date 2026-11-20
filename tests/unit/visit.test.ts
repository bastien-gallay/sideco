import { describe, expect, test } from "bun:test";
import { sinceLastVisit } from "../../src/web/view.ts";
import { ORDERING, table } from "../support.ts";

describe("sinceLastVisit tells what Claude changed on a board while the reader was away", () => {
  test("the cards Claude added, renamed or moved after the last visit, up to the arrival", () => {
    const t = table(ORDERING);
    const left = t.seq;
    t.script('rename E1 "Commande validée"\nadd event "Paiement accepté" --col 3');
    const arrived = t.seq;
    // Seen arriving, not missed: after the reader came back.
    t.script('add policy "Facturer" --col 3');
    const visit = sinceLastVisit(t.events, "commande", left, arrived);
    expect(visit.count).toBe(2);
    expect(visit.cards.sort()).toEqual(["E1", "E3"]);
  });

  test("the reader's own changes are not news to them", () => {
    const t = table(ORDERING);
    const left = t.seq;
    t.script('rename E1 "À moi"', "human");
    expect(sinceLastVisit(t.events, "commande", left, t.seq)).toEqual({ count: 0, cards: [] });
  });

  test("a card Claude added then removed meanwhile is nothing to show", () => {
    const t = table(ORDERING);
    const left = t.seq;
    t.script('add event "Brouillon" --col 3\nrm E3');
    expect(sinceLastVisit(t.events, "commande", left, t.seq).count).toBe(0);
  });

  test("only the board shown: another board's changes wait for their own visit", () => {
    const t = table(ORDERING);
    const left = t.seq;
    t.script('board new "Autre" --id autre\nadd event "Ailleurs" --col 1');
    expect(sinceLastVisit(t.events, "commande", left, t.seq).count).toBe(0);
    expect(sinceLastVisit(t.events, "autre", left, t.seq).count).toBeGreaterThan(0);
  });

  test("a card removed is counted, though there is no card left to mark", () => {
    const t = table(ORDERING);
    const left = t.seq;
    t.script("rm H1");
    expect(sinceLastVisit(t.events, "commande", left, t.seq)).toEqual({ count: 1, cards: [] });
  });
});
