/**
 * Dots on the board that are pulled to another card (out of link-handle.ts,
 * for S350): pulled, a dot lays a dashed wire that follows the pointer, ending
 * on an arrow as the link laid will (T268); released on a card, it does what
 * the dot is for. The card under the wire says what by its outline, solid to
 * link, dashed red to cut. Escape lets the wire go. Released where nothing can
 * be done, the wire goes back to where it holds as it fades (T266); held near
 * an edge of the board, it scrolls the board towards the cards out of sight
 * (T267). Who mounts the dots says where they are and what a pull does.
 */
import { svg } from "./dom.ts";
import { arrowHead, edgePull } from "./wire-shape.ts";

export interface Point {
  x: number;
  y: number;
}

/** A dot that can be pulled, in the board's frame. */
export interface Grip {
  /** Where the dot is drawn. */
  at: Point;
  /** Where the wire holds while its other end follows the pointer. */
  from: Point;
  /** The card the wire holds on to: never where it is released. */
  held: string;
  /** What the pointer reads on the dot. */
  title: string;
  /** The arrow of the wire is at the end that holds, not under the pointer: the start of a link is being moved. */
  arrowHeld?: boolean;
  /** What releasing on this card would do; nothing when undefined. */
  would(target: string): "link" | "cut" | undefined;
  /** Does it; answers whether it was saved. */
  pulled(target: string): Promise<boolean>;
  /** What a screen reader hears once released: on a card, or where nothing could be done. */
  said(target: string | undefined): string;
}

export interface PullHooks {
  /** The dots to draw now; none while the board cannot be written. */
  grips(): Grip[];
  toScene(event: { clientX: number; clientY: number }): Point;
  say(words: string): void;
}

interface Wire {
  grip: Grip;
  at?: Point;
  g: SVGGElement;
  target?: string | undefined;
  /** Where the dot was pressed, on screen. */
  pressed: { clientX: number; clientY: number };
  /** Where the pointer is on screen, once it has pulled: the board scrolling under it moves the end of the wire. */
  pointer?: { clientX: number; clientY: number };
  /** The pointer has been clear of the edges: a dot that sits near one does not scroll the board at once. */
  armed?: boolean;
}

/** How far the pointer goes from where it pressed before the dot is pulled, in pixels of the screen. */
const SLACK = 4;

/** How long the wire released in the void takes to go back to where it holds. */
const FADE_MS = 220;

const cardUnder = (event: { clientX: number; clientY: number }): string | undefined =>
  document.elementFromPoint(event.clientX, event.clientY)?.closest<SVGGElement>("g.card")?.dataset.id;

/** The dots on the board, and the wire one of them lays while it is pulled. */
class Pull {
  private readonly layer: SVGGElement;
  private wire: Wire | undefined;
  private shown: Grip[] = [];

  constructor(
    private readonly root: SVGSVGElement,
    name: string,
    private readonly hooks: PullHooks,
  ) {
    // Not for a screen reader: who mounts the dots says what does the same without the pointer.
    this.layer = root.appendChild(svg("g", { class: name, "aria-hidden": "true" }));
  }

  get on(): SVGGElement {
    return this.layer;
  }

  paint(): void {
    if (this.wire) return;
    this.shown = this.hooks.grips();
    this.layer.replaceChildren(
      ...this.shown.flatMap((grip, at) => {
        const centre = { cx: grip.at.x, cy: grip.at.y };
        // The dot is drawn small; a finger takes it by a circle of 24 px (WCAG 2.5.8).
        const hit = svg("circle", { class: "link-handle-hit", ...centre, r: 12, "data-grip": at });
        hit.append(Object.assign(svg("title"), { textContent: grip.title }));
        return [hit, svg("circle", { class: "link-handle-dot", ...centre, r: 6 })];
      }),
    );
  }

  press(event: PointerEvent): void {
    const at = (event.target as Element | null)?.closest<SVGElement>("[data-grip]")?.dataset.grip;
    // Read anew: the board may have changed since the dots were drawn.
    const grip = at === undefined ? undefined : this.hooks.grips()[Number(at)];
    if (!grip || event.button !== 0) return;
    // The board's own press would take the card, or let it go.
    event.stopPropagation();
    this.layer.setPointerCapture(event.pointerId);
    const g = this.layer.appendChild(svg("g", { class: "link-wire" }));
    g.append(svg("path"), svg("path", { class: "link-wire-head" }));
    this.wire = { grip, g, pressed: { clientX: event.clientX, clientY: event.clientY } };
    this.root.classList.add("is-wiring");
  }

  move(event: PointerEvent): void {
    const wire = this.wire;
    if (!wire) return;
    const pulling = wire.pointer !== undefined;
    // A hand that trembles on the dot has not pulled it: the click it began stays a click.
    const far = Math.hypot(event.clientX - wire.pressed.clientX, event.clientY - wire.pressed.clientY);
    if (!pulling && far < SLACK) return;
    wire.pointer = { clientX: event.clientX, clientY: event.clientY };
    this.draw(wire);
    if (!pulling) requestAnimationFrame(() => this.scroll(wire));
  }

  /** Lays the wire to where the pointer is, and says which card it would reach. */
  private draw(wire: Wire): void {
    if (!wire.pointer) return;
    const at = this.hooks.toScene(wire.pointer);
    const { from, arrowHeld } = wire.grip;
    wire.at = at;
    wire.g.firstElementChild?.setAttribute("d", `M${from.x} ${from.y}L${at.x} ${at.y}`);
    wire.g.lastElementChild?.setAttribute("d", arrowHeld ? arrowHead(at, from) : arrowHead(from, at));
    const id = cardUnder(wire.pointer);
    this.aim(wire, id === wire.grip.held ? undefined : id);
  }

  /** While the wire is held near an edge of the board, the board scrolls that way, frame after frame. */
  private scroll(wire: Wire): void {
    const scroller = this.root.closest<HTMLElement>(".canvas-scroll");
    if (this.wire !== wire || !wire.pointer || !scroller) return;
    const box = scroller.getBoundingClientRect();
    const dx = edgePull(wire.pointer.clientX, box.left, box.right);
    const dy = edgePull(wire.pointer.clientY, box.top, box.bottom);
    if (dx === 0 && dy === 0) wire.armed = true;
    else if (wire.armed) {
      scroller.scrollBy(dx, dy);
      this.draw(wire);
    }
    requestAnimationFrame(() => this.scroll(wire));
  }

  release(): void {
    const held = this.wire;
    if (!held) return;
    const { grip, target } = held;
    const pulled = held.pointer !== undefined;
    this.letGo(!target);
    // A dot pressed and not pulled asked for nothing: nothing is said.
    if (!pulled) return;
    const said = grip.said(target);
    if (target) void grip.pulled(target).then((ok) => ok && this.hooks.say(said));
    else this.hooks.say(said);
  }

  /** Lets the wire go; `missed`, it goes back to where it holds as it fades, so it does not look like a bug. */
  letGo(missed = false): void {
    if (!this.wire) return;
    // A dot pressed and not pulled stays as it is: redrawn, the click it began would be lost, and the double click with it.
    const pulled = this.wire.pointer !== undefined;
    this.aim(this.wire, undefined);
    if (missed) fadeBack(this.wire);
    else this.wire.g.remove();
    this.wire = undefined;
    this.root.classList.remove("is-wiring");
    if (pulled) this.paint();
  }

  /** The card under the wire says what releasing would do: solid outline to link, dashed red to cut; none where nothing would be done. */
  private aim(held: Wire, id: string | undefined): void {
    const would = id === undefined ? undefined : held.grip.would(id);
    const target = would ? id : undefined;
    if (target === held.target) return;
    this.outline(held.target, undefined);
    held.target = target;
    held.g.classList.toggle("is-cut", would === "cut");
    this.outline(target, would);
  }

  private outline(id: string | undefined, would: "link" | "cut" | undefined): void {
    const g = id ? this.root.querySelector(`g.card[data-id="${CSS.escape(id)}"]`) : null;
    g?.classList.toggle("is-link-target", would === "link");
    g?.classList.toggle("is-unlink-target", would === "cut");
  }
}

/** Draws the wire shorter and fainter until it is back where it holds; at once when motion is reduced. */
function fadeBack({ g, grip, at }: Wire): void {
  const path = g.firstElementChild;
  const from = grip.from;
  if (!at || !path || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    g.remove();
    return;
  }
  g.classList.add("is-missed");
  g.lastElementChild?.setAttribute("d", "");
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

/** Draws the dots in a layer of their own (`name`, its class) and follows their pulls; gives back what repaints them. */
export function mountPull(root: SVGSVGElement, name: string, hooks: PullHooks): () => void {
  const pull = new Pull(root, name, hooks);
  pull.on.addEventListener("pointerdown", (event) => pull.press(event));
  pull.on.addEventListener("pointermove", (event) => pull.move(event));
  pull.on.addEventListener("pointerup", () => pull.release());
  // A pointer taken away by the system ends the pull: nothing is done, and the board stops scrolling.
  for (const lost of ["pointercancel", "lostpointercapture"])
    pull.on.addEventListener(lost, () => pull.letGo());
  // A pull ends in a click on the board's background, which would let the card chosen go.
  pull.on.addEventListener("click", (event) => event.stopPropagation());
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") pull.letGo();
  });
  return () => pull.paint();
}
