/**
 * The names of a board's bands, lifted over its cards (out of board-view.ts,
 * T259): on a timeline they sit on a strip of the board's own surface, the step
 * numbers across the top and the row names down the left, the frozen panes of
 * a sheet. A lane keeps its heading, on a strip of the lane's own colour.
 * board-view.ts holds them in view as the board scrolls; this module says
 * what is lifted, and how much of the board the names then cover.
 */
import type { Band, Scene } from "../domain/layout/index.ts";
import { svg } from "./dom.ts";
import { t } from "./locale.ts";

const LANE_HEAD = 38;
const LANE_HEAD_HINTED = 44;
/** What a story map's step numbers take more, once they say their activity and task. */
export const BACKBONE_H = 36;

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
