import { describe, expect, test } from "bun:test";
import { arrowHead, edgePull } from "../../src/web/wire-shape.ts";

describe("the arrow at the end of the wire (T268)", () => {
  test("points where the wire goes, its tip on the pointer", () => {
    // Pulled straight to the right: the tip at the end, the two barbs behind it, one each side.
    expect(arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 })).toBe("M100 0L90 -5L90 5Z");
    // Pulled straight down.
    expect(arrowHead({ x: 0, y: 0 }, { x: 0, y: 50 })).toBe("M0 50L5 40L-5 40Z");
  });

  test("a wire too short to say a way has no arrow yet", () => {
    expect(arrowHead({ x: 10, y: 10 }, { x: 12, y: 11 })).toBe("");
    expect(arrowHead({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe("");
  });
});

describe("the board scrolls while a wire is held near its edge (T267)", () => {
  test("not in the middle of the board", () => {
    expect(edgePull(400, 0, 800)).toBe(0);
    expect(edgePull(41, 0, 800)).toBe(0);
  });

  test("towards the edge the pointer is near, faster the nearer it is", () => {
    expect(edgePull(790, 0, 800)).toBeGreaterThan(0);
    expect(edgePull(10, 0, 800)).toBeLessThan(0);
    expect(edgePull(798, 0, 800)).toBeGreaterThan(edgePull(780, 0, 800));
    expect(Math.abs(edgePull(2, 0, 800))).toBeGreaterThan(Math.abs(edgePull(30, 0, 800)));
  });

  test("past the edge it pulls as fast as it can, no faster", () => {
    expect(edgePull(900, 0, 800)).toBe(edgePull(800, 0, 800));
    expect(edgePull(-50, 0, 800)).toBe(edgePull(0, 0, 800));
  });
});
