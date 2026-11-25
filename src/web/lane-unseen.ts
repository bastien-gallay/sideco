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

type Side = "above" | "below";

/** A card out of sight, and where its top is on the screen. */
interface Out {
  g: SVGGElement;
  top: number;
}

interface Unseen {
  lane: string;
  /** The middle of the column, from the left of the canvas. */
  x: number;
  above: Out[];
  below: Out[];
}

const layer = h("div", { class: "unseen" });
/** The counts drawn, by lane and side: kept from one drawing to the next, so the keyboard stays on the one pressed. */
const chips = new Map<string, HTMLButtonElement>();
let shown: Board | undefined;
let lanes = new Map<string, string>();
let listening: HTMLElement | undefined;
let later: () => void = () => {};

/** The cards of each lane that are out of the window, by the top under the headings and by the bottom. */
function unseen(scroll: HTMLElement): Unseen[] {
  const box = scroll.getBoundingClientRect();
  const top = box.top + (Number.parseFloat(scroll.style.scrollPaddingTop) || 0);
  const found = new Map<string, Unseen>();
  for (const g of scroll.querySelectorAll<SVGGElement>("g.card")) {
    const lane = lanes.get(g.dataset.id ?? "");
    const rect = g.getBoundingClientRect();
    // A card that is not drawn, in a lane folded away, is not a card scrolled away.
    if (lane === undefined || rect.height === 0) continue;
    const at = found.get(lane) ?? { lane, x: rect.left + rect.width / 2 - box.left, above: [], below: [] };
    found.set(lane, at);
    if (rect.bottom < top + EDGE) at.above.push({ g, top: rect.top });
    else if (rect.top > box.bottom - EDGE) at.below.push({ g, top: rect.top });
  }
  return [...found.values()];
}

/** The count of one side of a column, drawn anew or brought up to date. */
function chip(side: Side, at: Unseen, name: string, top: number): string {
  const key = `${at.lane}|${side}`;
  const cards = [...at[side]].sort((a, b) => a.top - b.top);
  // A few at a time, so the reader keeps their place in the column: the fourth nearest, or the farthest.
  const far = side === "above" ? cards[Math.max(0, cards.length - 4)] : cards[Math.min(cards.length - 1, 3)];
  const button = chips.get(key) ?? h("button", { type: "button" });
  if (!chips.has(key)) {
    chips.set(key, button);
    layer.append(button);
  }
  const said = (side === "above" ? w.higher : w.lower)(cards.length, name);
  button.className = `unseen-chip is-${side}`;
  button.style.cssText = `left: ${at.x}px; ${side === "above" ? `top: ${top}px` : "bottom: 8px"}`;
  button.setAttribute("aria-label", said);
  button.title = said;
  button.textContent = `${side === "above" ? "↑" : "↓"} ${cards.length}`;
  button.onclick = () => far?.g.scrollIntoView({ block: "nearest" });
  return key;
}

function draw(canvas: HTMLElement): void {
  const scroll = canvas.querySelector<HTMLElement>(".canvas-scroll");
  const format = shown && findFormat(shown.format);
  const kept = new Set<string>();
  // Lanes that are columns, as a kanban's and a retro's: a grid's lanes are its four corners, a timeline has none.
  if (shown && scroll && format?.ownLanes && !format.grid && !canvas.hidden) {
    const board = shown;
    const top = (Number.parseFloat(scroll.style.scrollPaddingTop) || 0) + 2;
    for (const at of unseen(scroll)) {
      const name = laneName(format, board, at.lane, locale);
      if (at.above.length > 0) kept.add(chip("above", at, name, top));
      if (at.below.length > 0) kept.add(chip("below", at, name, top));
    }
  }
  for (const [key, button] of chips) {
    if (kept.has(key)) continue;
    button.remove();
    chips.delete(key);
  }
}

/** Follows the scroll and the size of what scrolls: one drawing a frame, whatever asks for it. */
function follow(canvas: HTMLElement, scroll: HTMLElement): void {
  listening = scroll;
  let waiting = false;
  later = (): void => {
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

/** Counts again what is out of sight; call it once the board is painted. It follows the scroll by itself. */
export function paintUnseen(canvas: HTMLElement, board: Board | undefined): void {
  shown = board;
  lanes = new Map((board?.elements ?? []).flatMap((e) => (e.lane === undefined ? [] : [[e.id, e.lane]])));
  const scroll = canvas.querySelector<HTMLElement>(".canvas-scroll");
  // The board is mounted once: what scrolls is the same for the life of the page.
  if (scroll && listening !== scroll) follow(canvas, scroll);
  if (layer.parentElement !== canvas) canvas.append(layer);
  // The cards are where the painting put them once it has settled.
  later();
}
