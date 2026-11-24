/**
 * Where the toolbar of the card chosen goes: around the card, never over it.
 */
import { describe, expect, test } from "bun:test";
import { placeNear, placeTools } from "../../src/web/tools-place.ts";

const frame = { width: 1000, height: 800 };
const size = { w: 300, h: 36 };
const chosen = { left: 400, top: 300, right: 552, bottom: 380 };

describe("the toolbar of the card chosen", () => {
  test("goes above the card when nothing is there", () => {
    expect(placeTools(chosen, [], size, frame)).toEqual({ left: 400, top: 256 });
  });

  test("goes under the card when the place above hides another", () => {
    const above = { left: 400, top: 200, right: 552, bottom: 290 };
    expect(placeTools(chosen, [above], size, frame)).toEqual({ left: 400, top: 388 });
  });

  test("with cards all around, hides a little of a neighbour rather than the card chosen", () => {
    const around = [
      { left: 400, top: 200, right: 552, bottom: 290 },
      { left: 400, top: 390, right: 552, bottom: 470 },
      { left: 560, top: 300, right: 712, bottom: 380 },
      { left: 240, top: 300, right: 392, bottom: 380 },
      // Most of the room above is a card wider than the one under.
      { left: 560, top: 200, right: 712, bottom: 290 },
    ];
    const place = placeTools(chosen, around, size, frame);
    const covers =
      place.left < chosen.right &&
      place.left + size.w > chosen.left &&
      place.top < chosen.bottom &&
      place.top + size.h > chosen.top;
    expect(covers).toBe(false);
    expect(place).toEqual({ left: 400, top: 388 });
  });

  test("near the top of the window, the place above is not taken: it would sit on the card", () => {
    const high = { left: 400, top: 10, right: 552, bottom: 90 };
    expect(placeTools(high, [], size, frame)).toEqual({ left: 400, top: 98 });
  });
});

describe("the toolbar of a link picked (T265)", () => {
  const bar = { w: 285, h: 36 };
  const hides = (
    at: { left: number; top: number },
    card: { left: number; top: number; right: number; bottom: number },
  ) =>
    at.left < card.right && card.left < at.left + bar.w && at.top < card.bottom && card.top < at.top + bar.h;

  test("opens just under the point when nothing is there", () => {
    expect(placeNear({ x: 400, y: 300 }, [], bar, frame)).toEqual({ left: 400, top: 312 });
  });

  test("picked just above the card the link leads to, it goes to the free side of the line", () => {
    const from = { left: 327, top: 68, right: 489, bottom: 150 };
    const to = { left: 240, top: 205, right: 402, bottom: 287 };
    const at = placeNear({ x: 316, y: 191 }, [from, to], bar, frame);
    expect(hides(at, from)).toBe(false);
    expect(hides(at, to)).toBe(false);
    // And it leaves the point picked in sight.
    expect(at.left <= 316 && 316 <= at.left + bar.w && at.top <= 191 && 191 <= at.top + bar.h).toBe(false);
  });

  test("stays inside the board's frame", () => {
    const at = placeNear({ x: 990, y: 790 }, [], bar, frame);
    expect(at.left + bar.w).toBeLessThanOrEqual(frame.width);
    expect(at.top + bar.h).toBeLessThanOrEqual(frame.height);
  });
});
