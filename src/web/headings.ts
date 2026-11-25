/**
 * The names of a board's bands, lifted over its cards (out of board-view.ts,
 * T259): on a timeline they sit on a strip of the board's own surface, the step
 * numbers across the top and the row names down the left, the frozen panes of
 * a sheet. A lane keeps its heading, on a strip of the lane's own colour.
 * This module says what is lifted and how much of the board the names then
 * cover, and holds them in view as the board scrolls, given what
 * board-view.ts reads of the board.
 */
import { type Band, headingSlide, type Scene } from "../domain/layout/index.ts";
import { svg } from "./dom.ts";
import { t } from "./locale.ts";

const LANE_HEAD = 38;
const LANE_HEAD_HINTED = 44;
/** What a story map's step numbers take more, once they say their activity and task. */
const BACKBONE_H = 36;
/** What a lane heading keeps beside its name: the inset on the left and the count on the right. */
const LANE_COUNT_ROOM = 56;

/** How much of the top and of the left the frozen names cover, in scene units. */
export interface Frozen {
  top: number;
  left: number;
}

/** The heading of a lane: its name on a strip, where a subtitle would go, and its keys on a kanban. */
function laneHead(band: Band, index: number, texts: Iterable<Element>, keyed: boolean): SVGGElement {
  // The lane's name rides on a strip of the lane's own colour: what scrolls under it is hidden, not smeared.
  const head = svg("g", { class: "head band-lane", "data-band": index });
  head.append(
    svg("rect", {
      class: "heads-lane-strip",
      x: band.x,
      y: band.y,
      width: band.w,
      height: band.hint ? LANE_HEAD_HINTED : LANE_HEAD,
      rx: 10,
      // Folded, the whole band opens it, its heading too.
      ...(band.folded ? { "data-fold": band.id } : {}),
    }),
    ...texts,
  );
  // Where a subtitle would go, offered under the pointer: a double-click writes one.
  if (!band.hint && !band.folded) {
    const blank = svg("text", {
      class: "lane-hint-blank",
      x: band.x + 14,
      y: band.y + 37,
      "data-lane": band.id,
    });
    blank.textContent = t.addLaneHint;
    head.append(blank);
  }
  // On a kanban, a lane heading is a Tab stop: its keys rename, move, remove it, or add one beside it.
  // Folded, its button is the one stop: it says the name whole and the count, and opens it.
  const label = head.querySelector<SVGTextElement>("text.lane-label");
  if (label && keyed && !band.folded) {
    label.setAttribute("tabindex", "0");
    label.setAttribute("role", "button");
    label.setAttribute("aria-label", t.laneHeading(band.label, band.count ?? 0));
    label.setAttribute("aria-description", t.laneKeys);
  }
  return head;
}

/**
 * Takes the names out of `bands`, behind the cards, up to `heads`, the layer
 * over them. `keyed` says the lanes are the board's own, reached by the keyboard.
 */
export function liftHeadings(heads: SVGGElement, bands: SVGGElement, scene: Scene, keyed: boolean): Frozen {
  heads.replaceChildren();
  const steps = svg("g", { class: "heads-steps" });
  const rows = svg("g", { class: "heads-rows" });
  const top = Math.min(...scene.bands.filter((b) => b.kind === "row").map((b) => b.y));
  const left = Math.min(...scene.bands.filter((b) => b.kind === "step").map((b) => b.x));
  if (Number.isFinite(top))
    steps.append(svg("rect", { class: "heads-strip", width: scene.width, height: top }));
  if (Number.isFinite(top) && scene.backbone !== undefined)
    steps.append(
      svg("rect", {
        class: "heads-strip heads-backbone-strip",
        width: scene.width,
        height: top + BACKBONE_H,
      }),
    );
  if (Number.isFinite(left))
    rows.append(svg("rect", { class: "heads-strip", width: left, height: scene.height }));
  let laneTop = 0;
  bands.querySelectorAll(":scope > g.band").forEach((group, index) => {
    const band = scene.bands[index];
    const kind = band?.kind;
    if (kind === "step") steps.append(...group.querySelectorAll("text"));
    else if (kind === "row") rows.append(...group.querySelectorAll("rect, text"));
    // A slice's name stays in the frozen margin, like a row's; its line runs on under the cards.
    else if (kind === "slice") rows.append(...group.querySelectorAll("text"));
    else if (band && kind === "lane") {
      laneTop = Math.max(laneTop, band.hint ? LANE_HEAD_HINTED : LANE_HEAD);
      heads.append(laneHead(band, index, group.querySelectorAll("text"), keyed));
    }
  });
  if (steps.childElementCount > 1) heads.append(steps);
  if (rows.childElementCount > 1) heads.append(rows);
  return { top: Number.isFinite(top) ? top : laneTop, left: Number.isFinite(left) ? left : 0 };
}

/** What holding the headings in view reads of the board: where it is scrolled, and what is in the human's hand. */
export interface Held {
  heads: SVGGElement;
  scroll: HTMLElement;
  zoom: number;
  scene: Scene;
  frozen: Frozen;
  /** The lanes are the board's own, as a kanban's: their headings come down with the scroll. */
  ownLanes: boolean;
  timeline: boolean;
  /** The lane and the step in the human's hand, carried sideways by so much. */
  lane?: { lane: string; dx: number };
  step?: { from: number; dx: number };
}

/**
 * Keeps the names of rows, steps and lanes on screen while the board scrolls
 * under them, as the frozen headings of a sheet: the reader never has to
 * remember which row is which.
 */
export function holdInView(at: Held): void {
  const { heads, scroll, zoom, scene, frozen } = at;
  const sx = scroll.scrollLeft / zoom;
  const sy = scroll.scrollTop / zoom;
  const steps = heads.querySelector(".heads-steps");
  steps?.setAttribute("transform", `translate(0 ${sy})`);
  // On a story map, once the activities have scrolled under the numbers, each step says its activity and task.
  const backbone = scene.backbone !== undefined && sy > scene.backbone - frozen.top;
  steps?.classList.toggle("shows-backbone", backbone);
  holdSteps(at);
  heads.querySelector(".heads-rows")?.setAttribute("transform", `translate(${sx} 0)`);
  for (const head of heads.querySelectorAll<SVGGElement>("g.head")) {
    const band = scene.bands[Number(head.dataset.band)];
    if (band?.kind === "lane") holdLane(at, head, band, sx);
  }
  // A card the keyboard or a search brings into view lands clear of the frozen names, never under them.
  scroll.style.scrollPaddingTop = `${(frozen.top + (backbone ? BACKBONE_H : 0)) * zoom + 8}px`;
  scroll.style.scrollPaddingLeft = `${frozen.left * zoom + 8}px`;
}

/** The step in the human's hand stays there, its number and its captions, whatever is painted meanwhile. */
function holdSteps({ heads, step }: Held): void {
  for (const label of heads.querySelectorAll<SVGTextElement>(".heads-steps text")) {
    const inHand = step !== undefined && label.dataset.col === String(step.from);
    label.classList.toggle("is-dragging", inHand);
    if (inHand) label.setAttribute("transform", `translate(${step.dx} 0)`);
    else label.removeAttribute("transform");
  }
}

/** A lane's heading goes down to its last card at most; in the human's hand it stays there, whatever is painted meanwhile. */
function holdLane(at: Held, head: SVGGElement, band: Band, sx: number): void {
  const inHand = at.lane !== undefined && at.lane.lane === band.id;
  head.classList.toggle("is-dragging", inHand);
  head.setAttribute("transform", `translate(${inHand ? at.lane?.dx : 0} ${headDrop(at, band)})`);
  // Its name and what it stands for follow a sideways scroll too, short of the count at its right end.
  const words = [
    ...head.querySelectorAll<SVGTextElement>("text.lane-label:not(.is-upright), text.lane-hint"),
  ];
  const room = Math.max(0, ...words.map((text) => text.getComputedTextLength())) + LANE_COUNT_ROOM;
  const slide = headingSlide(band, sx, room);
  for (const text of words) {
    if (slide > 0) text.setAttribute("transform", `translate(${slide} 0)`);
    else text.removeAttribute("transform");
  }
}

/** How far a lane's heading has come down with the scroll: it never leaves its own lane. */
function headDrop({ scroll, zoom }: Held, band: { y: number; h: number }): number {
  return Math.max(0, Math.min(scroll.scrollTop / zoom - band.y, band.h - 56));
}

/** How far the headings came down with the scroll, step numbers or kanban headings: what is offered there comes down too. */
export function headingsDrop(at: Held): number {
  if (at.timeline) return at.scroll.scrollTop / at.zoom;
  // The headings of a kanban come down together: the first says how far.
  const first = at.scene.bands.find((band) => band.kind === "lane");
  return first && at.ownLanes ? headDrop(at, first) : 0;
}
