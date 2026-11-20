/**
 * Where the toolbar of the card chosen goes: around the card, never over it.
 */
import { describe, expect, test } from "bun:test";
import { placeTools } from "../../src/web/tools-place.ts";

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
