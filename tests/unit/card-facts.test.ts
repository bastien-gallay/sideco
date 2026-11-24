import { expect, test } from "bun:test";
import { cardFacts } from "../../src/web/card-facts.ts";
import { KANBAN, ORDERING, table } from "../support.ts";

const NOW = new Date("2026-11-24T15:00:00");

test("a card says who added it, and nothing more while no one changed it since (S311)", () => {
  const t = table(ORDERING);
  expect(cardFacts(t.board(), "E1", t.events, "en", NOW)).toBe("Added by Claude");
  expect(cardFacts(t.board(), "E1", t.events, "fr", NOW)).toBe("Ajoutée par Claude");
});

test("its last change says who and when: the hour today, the day before that", () => {
  const t = table(ORDERING);
  t.do({ kind: "rename", board: "commande", id: "E1", label: "Commande reçue" }, "human");
  const changed = t.board().elements.find((e) => e.id === "E1")?.changedSeq;
  const stamped = (ts: string) => t.events.map((e) => (e.seq === changed ? { ...e, ts } : e));
  const today = stamped("2026-11-24T09:05:00");
  expect(cardFacts(t.board(), "E1", today, "en", NOW)).toBe("Added by Claude · changed by you at 09:05");
  expect(cardFacts(t.board(), "E1", today, "fr", NOW)).toBe("Ajoutée par Claude · changée par toi à 09:05");
  const before = stamped("2026-11-21T18:40:00");
  expect(cardFacts(t.board(), "E1", before, "en", NOW)).toBe(
    "Added by Claude · changed by you on 21/11 at 18:40",
  );
  expect(cardFacts(t.board(), "E1", before, "fr", NOW)).toBe(
    "Ajoutée par Claude · changée par toi le 21/11 à 18:40",
  );
});

test("a card done says so, where the board does not say it by its last lane", () => {
  const t = table(ORDERING);
  t.do({ kind: "mark", board: "commande", id: "E1", done: true }, "agent");
  expect(cardFacts(t.board(), "E1", t.events, "en", NOW)).toMatch(
    /^Added by Claude · changed by Claude on 17\/11 at \d\d:\d\d · done$/,
  );
  expect(cardFacts(t.board(), "E1", t.events, "fr", NOW)).toMatch(/ · faite$/);
  // A kanban says it by the lane the card is in: the line does not say it twice.
  const k = table(KANBAN);
  const last = k.board().elements.at(-1);
  if (!last) throw new Error("the kanban has a card");
  expect(cardFacts(k.board(), last.id, k.events, "en", NOW)).not.toContain("done");
});

test("a card that is gone says nothing", () => {
  const t = table(ORDERING);
  expect(cardFacts(t.board(), "E99", t.events, "en", NOW)).toBe("");
});
