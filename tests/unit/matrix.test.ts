/**
 * Impact / Effort reads as a matrix: each axis says which way it grows, and
 * what its two ends stand for, low and high.
 */
import { describe, expect, test } from "bun:test";
import { headingSlide, layoutBoard } from "../../src/domain/layout/index.ts";
import { bandMarkup } from "../../src/domain/render/svg.ts";
import { IMPACT_EFFORT, table } from "../support.ts";

const axes = (locale: "en" | "fr") =>
  layoutBoard(table(IMPACT_EFFORT).board(), locale).bands.filter((b) => b.kind === "axis");

describe("the axes of an impact / effort plan", () => {
  test("name their low and their high end, in the reader's language", () => {
    expect(axes("en").map((b) => [b.id, b.label, b.low, b.high])).toEqual([
      ["y", "Impact", "low", "high"],
      ["x", "Effort", "low", "high"],
    ]);
    expect(axes("fr").map((b) => [b.low, b.high])).toEqual([
      ["faible", "fort"],
      ["faible", "fort"],
    ]);
  });

  test("draw low where the axis starts and high where it ends: bottom and top, left and right", () => {
    const [y, x] = axes("en");
    if (!x || !y) throw new Error("no axes");
    const horizontal = bandMarkup(x);
    expect(horizontal).toContain(`<text class="axis-bound" x="${x.x + 8}"`);
    expect(horizontal).toMatch(/<text class="axis-bound is-high" x="[\d.]+"[^>]*>high<\/text>/);
    // The vertical axis is the horizontal one turned a quarter left: its start is at the bottom.
    const vertical = bandMarkup(y);
    expect(vertical).toMatch(/class="axis-bound"[^>]*transform="rotate\(-90[^"]*"[^>]*>low</);
    expect(vertical).toMatch(/class="axis-bound is-high"[^>]*transform="rotate\(-90[^"]*"[^>]*>high</);
  });
});

describe("the name of a cell, when the board scrolls sideways", () => {
  const cell = { x: 100, w: 400 };
  test("stays where it is while the cell's left edge is in sight", () => {
    expect(headingSlide(cell, 0, 160)).toBe(0);
    expect(headingSlide(cell, 100, 160)).toBe(0);
  });
  test("follows the scroll past it, and stops short of the cell's right end", () => {
    expect(headingSlide(cell, 250, 160)).toBe(150);
    expect(headingSlide(cell, 900, 160)).toBe(240);
  });
});
