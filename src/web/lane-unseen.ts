/**
 * The cards of a column that are out of sight (S306, a first slice): where a
 * board's lanes are columns, a column longer than the window says how many
 * of its cards are higher, under its heading, and how many are lower. Pressed,
 * the count brings the next of them into view. The board still scrolls
 * whole: a column does not scroll alone yet.
 */
import { findFormat, laneName } from "../domain/formats.ts";
import type { Locale } from "../domain/i18n.ts";
import type { Board } from "../domain/workspace.ts";
import { h } from "./dom.ts";
import { locale } from "./locale.ts";

const WORDS: Record<
  Locale,
  { higher: (cards: number, lane: string) => string; lower: (cards: number, lane: string) => string }
> = {
  en: {
    higher: (cards, lane) => `${cards} card${cards > 1 ? "s" : ""} higher in ${lane}`,
    lower: (cards, lane) => `${cards} card${cards > 1 ? "s" : ""} lower in ${lane}`,
  },
  fr: {
    higher: (cards, lane) => `${cards} carte${cards > 1 ? "s" : ""} plus haut dans ${lane}`,
    lower: (cards, lane) => `${cards} carte${cards > 1 ? "s" : ""} plus bas dans ${lane}`,
  },
};
const w = WORDS[locale];

/** What is counted as out of sight: a card must be this far inside the window to be seen. */
const EDGE = 6;

interface Unseen {
  lane: string;
  /** The middle of the column, from the left of the canvas. */
  x: number;
  above: SVGGElement[];
  below: SVGGElement[];
}

const layer = h("div", { class: "unseen" });
let shown: Board | undefined;
let listening: Element | undefined;

/** The cards of each lane that are out of the window, by the top under the headings and by the bottom. */
function unseen(board: Board, scroll: HTMLElement): Unseen[] {
  const box = scroll.getBoundingClientRect();
  const top = box.top + (Number.parseFloat(scroll.style.scrollPaddingTop) || 0);
  const lanes = new Map<string, Unseen>();
  for (const g of scroll.querySelectorAll<SVGGElement>("g.card")) {
    const lane = board.elements.find((e) => e.id === g.dataset.id)?.lane;
    if (lane === undefined) continue;
    const rect = g.getBoundingClientRect();
    const at = lanes.get(lane) ?? { lane, x: rect.left + rect.width / 2 - box.left, above: [], below: [] };
    lanes.set(lane, at);
    if (rect.bottom < top + EDGE) at.above.push(g);
    else if (rect.top > box.bottom - EDGE) at.below.push(g);
  }
  return [...lanes.values()];
}

function chip(side: "above" | "below", at: Unseen, name: string, top: number): HTMLElement {
  const cards = at[side];
  // The nearest of them: the last of those higher, the first of those lower.
  const sorted = [...cards].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  const next = side === "above" ? sorted.at(-1) : sorted[0];
  const far =
    side === "above" ? sorted[Math.max(0, sorted.length - 4)] : sorted[Math.min(sorted.length - 1, 3)];
  return h(
    "button",
    {
      type: "button",
      class: `unseen-chip is-${side}`,
      style: `left: ${at.x}px; ${side === "above" ? `top: ${top}px` : "bottom: 8px"}`,
      "aria-label": (side === "above" ? w.higher : w.lower)(cards.length, name),
      title: (side === "above" ? w.higher : w.lower)(cards.length, name),
      // A few at a time, so the reader keeps their place in the column.
      onclick: () => (far ?? next)?.scrollIntoView({ block: "nearest", behavior: "auto" }),
    },
    `${side === "above" ? "↑" : "↓"} ${cards.length}`,
  );
}

function draw(canvas: HTMLElement): void {
  const scroll = canvas.querySelector<HTMLElement>(".canvas-scroll");
  const format = shown && findFormat(shown.format);
  // Lanes that are columns: a grid's lanes are its four corners, and a timeline has none.
  layer.replaceChildren();
  if (!shown || !scroll || !format || format.grid || canvas.hidden) return;
  const board = shown;
  const top = (Number.parseFloat(scroll.style.scrollPaddingTop) || 0) + 2;
  const name = (lane: string): string => laneName(format, board, lane, locale);
  layer.append(
    ...unseen(board, scroll).flatMap((at) => [
      ...(at.above.length > 0 ? [chip("above", at, name(at.lane), top)] : []),
      ...(at.below.length > 0 ? [chip("below", at, name(at.lane), top)] : []),
    ]),
  );
}

/** Counts again what is out of sight; call it once the board is painted. It follows the scroll by itself. */
export function paintUnseen(canvas: HTMLElement, board: Board | undefined): void {
  shown = board;
  const scroll = canvas.querySelector<HTMLElement>(".canvas-scroll");
  if (scroll && listening !== scroll) {
    listening = scroll;
    let waiting = false;
    const later = (): void => {
      if (waiting) return;
      waiting = true;
      requestAnimationFrame(() => {
        waiting = false;
        draw(canvas);
      });
    };
    scroll.addEventListener("scroll", later, { passive: true });
    new ResizeObserver(later).observe(scroll);
  }
  if (layer.parentElement !== canvas) canvas.append(layer);
  // The cards are where the painting put them once it has settled.
  requestAnimationFrame(() => draw(canvas));
}
