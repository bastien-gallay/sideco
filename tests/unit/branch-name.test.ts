/**
 * A branch of a flow named, or named again: the link is laid once more with
 * the new name. The same name records nothing; undo gives the old one back.
 */
import { describe, expect, test } from "bun:test";
import { describeEvent } from "../../src/web/event-words.ts";
import { FLOW, type Table, table } from "../support.ts";

const name = (t: Table, src: string, dst: string): string | undefined =>
  t.board().edges.find((e) => e.src === src && e.dst === dst)?.label;

describe("naming a branch", () => {
  test("a link laid again takes the new name; the same name again records nothing", () => {
    const t = table(FLOW);
    t.do({ kind: "link", board: "livraison", src: "D1", dst: "S2", label: "en stock" }, "human");
    expect(name(t, "D1", "S2")).toBe("en stock");
    expect(t.board().edges).toHaveLength(5);
    const seq = t.seq;
    t.do({ kind: "link", board: "livraison", src: "D1", dst: "S2", label: "en stock" }, "human");
    expect(t.seq).toBe(seq);
  });

  test("an empty name takes the name off; undo gives it back", () => {
    const t = table(FLOW);
    t.do({ kind: "link", board: "livraison", src: "D1", dst: "S2" }, "human");
    expect(name(t, "D1", "S2")).toBeUndefined();
    t.do({ kind: "undo", board: "livraison" }, "human");
    expect(name(t, "D1", "S2")).toBe("oui");
  });

  test("the history says the name the branch was given", () => {
    const t = table(FLOW);
    t.do({ kind: "link", board: "livraison", src: "D1", dst: "S2", label: "en stock" }, "human");
    expect(describeEvent(t.events.at(-1) as never)).toBe("You link D1 → S2 “en stock”");
    expect(describeEvent(t.events.at(-1) as never, "fr")).toBe("Tu relies D1 → S2 « en stock »");
  });
});
