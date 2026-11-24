/**
 * The handle that draws a link (S326), after faceto's connect handle: a dot on
 * the right edge of the frame of the card chosen, and of no other. Pulled, it lays a dashed
 * wire that follows the pointer; released anywhere on another card, it links
 * the two, or cuts the link when the card chosen already points at that one.
 * The card under the wire says which by its outline, solid to link, dashed red
 * to cut. Escape lets the wire go. The middle of a card is left to moving it.
 * Released where no card is, the wire goes back to the dot as it fades (T266).
 */
import { RING } from "./card-marks.ts";
import { svg } from "./dom.ts";
import { t } from "./locale.ts";

interface Point {
  x: number;
  y: number;
}

export interface HandleHooks {
  /** The card that wears the handle, in the board's frame; none while the board cannot be written. */
  chosen(): { id: string; x: number; y: number; w: number; h: number } | undefined;
  toScene(event: { clientX: number; clientY: number }): Point;
  linked(src: string, dst: string): boolean;
  /** Links the two cards, or cuts the link between them; answers whether it was saved. */
  pulled(src: string, dst: string, cut: boolean): Promise<boolean>;
  /** Says to a screen reader what releasing the wire did. */
  say(words: string): void;
}

interface Wire {
  src: string;
  from: Point;
  at?: Point;
  g: SVGGElement;
  target?: string | undefined;
}

/** How long the wire released in the void takes to go back to the dot. */
const FADE_MS = 220;

const cardUnder = (event: { clientX: number; clientY: number }): string | undefined =>
  document.elementFromPoint(event.clientX, event.clientY)?.closest<SVGGElement>("g.card")?.dataset.id;

/** The handle on the board, and the wire it lays while it is pulled. */
class Handle {
  private readonly layer: SVGGElement;
  private wire: Wire | undefined;

  constructor(
    private readonly root: SVGSVGElement,
    private readonly hooks: HandleHooks,
  ) {
    // A screen reader links by L, or from the Links section of the Detail tab.
    this.layer = root.appendChild(svg("g", { class: "link-handle", "aria-hidden": "true" }));
  }

  get on(): SVGGElement {
    return this.layer;
  }

  paint(): void {
    if (this.wire) return;
    this.layer.replaceChildren();
    const card = this.hooks.chosen();
    if (!card) return;
    const at = { cx: card.x + card.w + RING, cy: card.y + card.h / 2 };
    // The dot is drawn small; a finger takes it by a circle of 24 px (WCAG 2.5.8).
    const hit = svg("circle", { class: "link-handle-hit", ...at, r: 12 });
    hit.append(Object.assign(svg("title"), { textContent: t.withKey(t.link, "L") }));
    this.layer.append(hit, svg("circle", { class: "link-handle-dot", ...at, r: 6 }));
  }

  press(event: PointerEvent): void {
    const card = this.hooks.chosen();
    if (!card || event.button !== 0) return;
    // The board's own press would take the card, or let it go.
    event.stopPropagation();
    this.layer.setPointerCapture(event.pointerId);
    const g = this.layer.appendChild(svg("g", { class: "link-wire" }));
    g.append(svg("path"));
    this.wire = { src: card.id, from: { x: card.x + card.w + RING, y: card.y + card.h / 2 }, g };
    this.root.classList.add("is-wiring");
  }

  move(event: PointerEvent): void {
    const wire = this.wire;
    if (!wire) return;
    const at = this.hooks.toScene(event);
    wire.at = at;
    wire.g.firstElementChild?.setAttribute("d", `M${wire.from.x} ${wire.from.y}L${at.x} ${at.y}`);
    const id = cardUnder(event);
    this.aim(wire, id === wire.src ? undefined : id);
  }

  release(): void {
    const held = this.wire;
    const target = held?.target;
    const cut = held && target ? this.hooks.linked(held.src, target) : false;
    this.letGo(held !== undefined && !target);
    if (held && target) {
      const said = t.wired(t.linkBetween(held.src, target), cut);
      void this.hooks.pulled(held.src, target, cut).then((ok) => ok && this.hooks.say(said));
    } else if (held) this.hooks.say(t.wired(undefined, false));
  }

  /** Lets the wire go; `missed`, it goes back to the dot as it fades, so it does not look like a bug. */
  letGo(missed = false): void {
    if (!this.wire) return;
    this.aim(this.wire, undefined);
    if (missed) fadeBack(this.wire);
    else this.wire.g.remove();
    this.wire = undefined;
    this.root.classList.remove("is-wiring");
    this.paint();
  }

  /** The card under the wire says what releasing would do: solid outline to link, dashed red to cut. */
  private aim(held: Wire, id: string | undefined): void {
    if (id === held.target) return;
    if (held.target) this.outline(held.target, this.hooks.linked(held.src, held.target), false);
    held.target = id;
    const cut = id !== undefined && this.hooks.linked(held.src, id);
    held.g.classList.toggle("is-cut", cut);
    this.outline(id, cut, true);
  }

  private outline(id: string | undefined, cut: boolean, on: boolean): void {
    const g = id ? this.root.querySelector(`g.card[data-id="${CSS.escape(id)}"]`) : null;
    g?.classList.toggle(cut ? "is-unlink-target" : "is-link-target", on);
  }
}

/** Draws the wire shorter and fainter until it is back on the dot; at once when motion is reduced. */
function fadeBack({ g, from, at }: Wire): void {
  const path = g.firstElementChild;
  if (!at || !path || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    g.remove();
    return;
  }
  g.classList.add("is-missed");
  const start = performance.now();
  const step = (now: number): void => {
    const done = Math.min(1, (now - start) / FADE_MS);
    const left = (1 - done) ** 3;
    path.setAttribute(
      "d",
      `M${from.x} ${from.y}L${from.x + (at.x - from.x) * left} ${from.y + (at.y - from.y) * left}`,
    );
    g.style.opacity = String(left);
    if (done < 1) requestAnimationFrame(step);
    else g.remove();
  };
  requestAnimationFrame(step);
}

/** Draws the handle on the board and follows its pulls; gives back what repaints it. */
export function linkHandle(root: SVGSVGElement, hooks: HandleHooks): () => void {
  const handle = new Handle(root, hooks);
  handle.on.addEventListener("pointerdown", (event) => handle.press(event));
  handle.on.addEventListener("pointermove", (event) => handle.move(event));
  handle.on.addEventListener("pointerup", () => handle.release());
  // A pull ends in a click on the board's background, which would let the card chosen go.
  handle.on.addEventListener("click", (event) => event.stopPropagation());
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") handle.letGo();
  });
  return () => handle.paint();
}
