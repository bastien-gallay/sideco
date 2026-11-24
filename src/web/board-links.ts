/**
 * The links between cards on screen: drawn with a wide band that catches the
 * pointer, picked by a click, offered Name and Remove where they were
 * clicked, and named in place. board-view.ts keeps which link is picked;
 * this module says what a gesture on a link shows.
 */
import type { Scene } from "../domain/layout/index.ts";
import { connectorMarkup } from "../domain/render/svg.ts";
import type { Board } from "../domain/workspace.ts";
import { h, svg } from "./dom.ts";
import { t } from "./locale.ts";
import { type Ends, type Lit, lightAt, linkKey } from "./spotlight.ts";
import { send } from "./store.ts";

/** A link the human clicked, and where in the board's frame: its toolbar opens there. */
export interface PickedLink {
  src: string;
  dst: string;
  x: number;
  y: number;
}

/** Draws the links, each under a wide transparent twin of its line: a thin line is hard to hit. */
export function drawLinks(layer: SVGGElement, scene: Scene): void {
  layer.innerHTML = scene.connectors.map(connectorMarkup).join("");
  for (const conn of layer.querySelectorAll<SVGGElement>(".conn")) {
    const path = conn.querySelector("path");
    if (path) conn.prepend(svg("path", { class: "conn-hit", d: path.getAttribute("d") ?? "" }));
  }
}

/** The link under a click, if any, and where the click fell in the board's frame. */
export function linkAt(
  target: Element | null | undefined,
  at: { clientX: number; clientY: number },
  frame: DOMRect,
): PickedLink | undefined {
  const { src, dst } = target?.closest<SVGGElement>("g.conn")?.dataset ?? {};
  return src && dst ? { src, dst, x: at.clientX - frame.left, y: at.clientY - frame.top } : undefined;
}

/** A link removed meanwhile is no longer picked. */
export const stillLinked = (board: Board, link: PickedLink): boolean =>
  board.edges.some((e) => e.src === link.src && e.dst === link.dst);

/** The toolbar of a picked link, under where it was clicked: what it joins, Name, Remove. */
export function showLinkTools(
  tools: HTMLElement,
  board: string,
  link: PickedLink,
  act: { name: () => void; dropped: () => void },
): void {
  const remove = (): void => {
    act.dropped();
    void send({ kind: "unlink", board, src: link.src, dst: link.dst });
  };
  tools.replaceChildren(
    h("span", { class: "tools-label" }, t.linkBetween(link.src, link.dst)),
    h("button", { type: "button", onclick: act.name }, t.nameLink),
    h("button", { type: "button", class: "danger", onclick: remove }, t.removeLink),
  );
  tools.hidden = false;
  tools.style.left = `${Math.max(8, link.x)}px`;
  tools.style.top = `${Math.max(8, link.y + 12)}px`;
}

/** Where a link's name is edited: over its name when it has one, else where it was clicked. */
export function nameSpot(
  layer: SVGGElement,
  frame: DOMRect,
  link: { src: string; dst: string },
  picked: PickedLink | undefined,
): DOMRect {
  const conn = [...layer.querySelectorAll<SVGGElement>("g.conn")].find(
    (g) => g.dataset.src === link.src && g.dataset.dst === link.dst,
  );
  const named = conn?.querySelector("text.conn-label")?.getBoundingClientRect();
  const at = named ?? new DOMRect(frame.left + (picked?.x ?? 0), frame.top + (picked?.y ?? 0), 0, 0);
  return new DOMRect(at.left - 6, at.top - 8, 180, 36);
}

/** Lights what the spotlight holds and lets the rest of the board recede; with no light, nothing recedes. */
function paintLight(
  root: SVGSVGElement,
  layer: SVGGElement,
  cards: Iterable<[string, { g: SVGGElement }]>,
  lit: Lit | undefined,
): void {
  root.classList.toggle("is-spotlit", lit !== undefined);
  for (const g of layer.querySelectorAll<SVGGElement>("g.conn"))
    g.classList.toggle("is-lit", lit?.links.has(linkKey(g.dataset.src ?? "", g.dataset.dst ?? "")) ?? false);
  for (const [id, node] of cards) node.g.classList.toggle("is-lit", lit?.cards.has(id) ?? false);
}

/**
 * The spotlight of a board (S325): follows the pointer from card to card, and
 * gives back what repaints it when the link picked or the card chosen changes.
 * `at` says what may own it now: no links while nothing may, the board stays lit.
 */
export function watchLight(
  root: SVGSVGElement,
  layer: SVGGElement,
  cards: ReadonlyMap<string, { g: SVGGElement }>,
  at: () => { edges: readonly Ends[]; picked: Ends | undefined; chosen: string | undefined },
): () => void {
  let hovered: string | undefined;
  const paint = (): void => {
    const now = at();
    paintLight(root, layer, cards, lightAt(now.edges, { hovered, picked: now.picked, chosen: now.chosen }));
  };
  root.addEventListener("pointerover", (event) => {
    const id = (event.target as Element | null)?.closest?.<SVGGElement>("g.card")?.dataset.id;
    if (id === hovered) return;
    hovered = id;
    paint();
  });
  root.addEventListener("pointerleave", () => {
    hovered = undefined;
    paint();
  });
  return paint;
}
