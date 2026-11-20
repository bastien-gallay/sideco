/**
 * A switch over a union ends with `handledAll`: a kind added to the union and
 * left out of the switch breaks the build there. Checked by the typecheck.
 */
import { expect, test } from "bun:test";
import { handledAll } from "../../src/domain/handled-all.ts";

type Kind = "card" | "lane";

function named(kind: Kind): string {
  switch (kind) {
    case "card":
      return "a card";
    case "lane":
      return "a lane";
    default:
      handledAll(kind);
      return "";
  }
}

function forgetful(kind: Kind): string {
  switch (kind) {
    case "card":
      return "a card";
    default:
      // @ts-expect-error "lane" is left out: the build refuses it.
      handledAll(kind);
      return "";
  }
}

test("a switch that names every kind passes, and handledAll does nothing at run time", () => {
  expect(named("lane")).toBe("a lane");
  expect(forgetful("lane")).toBe("");
});
