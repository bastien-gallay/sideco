import { describe, expect, test } from "bun:test";
import { lightAt, linkKey, spotlight } from "../../src/web/spotlight.ts";

const edges = [
  { src: "E1", dst: "E2" },
  { src: "E2", dst: "E3" },
  { src: "E4", dst: "E2" },
];

describe("what the spotlight lights (S325)", () => {
  test("a card lights its links and the cards at their other ends", () => {
    const lit = spotlight(edges, { card: "E2" });
    expect([...(lit?.cards ?? [])].sort()).toEqual(["E1", "E2", "E3", "E4"]);
    expect([...(lit?.links ?? [])].sort()).toEqual(
      [linkKey("E1", "E2"), linkKey("E2", "E3"), linkKey("E4", "E2")].sort(),
    );
  });

  test("a card at the end of one link lights that link and its neighbour only", () => {
    const lit = spotlight(edges, { card: "E1" });
    expect([...(lit?.cards ?? [])].sort()).toEqual(["E1", "E2"]);
    expect([...(lit?.links ?? [])]).toEqual([linkKey("E1", "E2")]);
  });

  test("a card with no link lights nothing: the board does not dim around a lone card", () => {
    expect(spotlight(edges, { card: "E9" })).toBeUndefined();
  });

  test("a link lights itself and its two cards", () => {
    const lit = spotlight(edges, { link: { src: "E2", dst: "E3" } });
    expect([...(lit?.cards ?? [])].sort()).toEqual(["E2", "E3"]);
    expect([...(lit?.links ?? [])]).toEqual([linkKey("E2", "E3")]);
  });

  test("a link removed meanwhile lights nothing", () => {
    expect(spotlight(edges, { link: { src: "E3", dst: "E1" } })).toBeUndefined();
  });

  test("no owner, no spotlight", () => {
    expect(spotlight(edges, undefined)).toBeUndefined();
  });
});

describe("who owns the spotlight (S325)", () => {
  const link = { src: "E1", dst: "E2" };
  const keys = (lit: ReturnType<typeof lightAt>) => [...(lit?.links ?? [])];

  test("the card under the pointer first", () => {
    expect(keys(lightAt(edges, { hovered: "E3", picked: link, chosen: "E4" }))).toEqual([
      linkKey("E2", "E3"),
    ]);
  });

  test("else the link picked", () => {
    expect(keys(lightAt(edges, { picked: link, chosen: "E4" }))).toEqual([linkKey("E1", "E2")]);
  });

  test("else the card chosen", () => {
    expect(keys(lightAt(edges, { chosen: "E4" }))).toEqual([linkKey("E4", "E2")]);
  });

  test("a card under the pointer with no link leaves the light where it was", () => {
    expect(keys(lightAt(edges, { hovered: "E9", chosen: "E4" }))).toEqual([linkKey("E4", "E2")]);
  });

  test("the card chosen stays sharp under its toolbar, whoever owns the light", () => {
    const lit = lightAt(edges, { hovered: "E3", chosen: "E1" });
    expect(keys(lit)).toEqual([linkKey("E2", "E3")]);
    expect(lit?.cards.has("E1")).toBe(true);
  });

  test("else nobody: a click in the void puts it out", () => {
    expect(lightAt(edges, {})).toBeUndefined();
  });
});
