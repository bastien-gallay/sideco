/**
 * One card of the board as its node in the page (out of board-view.ts, T259):
 * what is drawn in it, and what a screen reader hears of it. board-view.ts
 * keeps the nodes, and says where each one is and how it stands.
 */
import { cardName, type Scene } from "../domain/layout/scene.ts";
import { chipText } from "../domain/render/labels.ts";
import { cardMarkup } from "../domain/render/svg.ts";
import type { Board } from "../domain/workspace.ts";
import { changedMark, ringMarkup, unreadMark } from "./card-marks.ts";
import { svg } from "./dom.ts";
import { locale, t } from "./locale.ts";
import { cardLinks, cardPlace } from "./view.ts";

export interface CardNode {
  g: SVGGElement;
  /** What was last drawn: the node is redrawn only when it changes. */
  signature: string;
}

type Card = Scene["cards"][number];

/** What the reader has not seen of a card: not read since Claude wrote it, changed since their last visit. */
export interface Marks {
  isUnread: boolean;
  isNew: boolean;
}

export function newCardNode(id: string): CardNode {
  return { g: svg("g", { class: "card", "data-id": id, tabindex: -1, role: "button" }), signature: "" };
}

/**
 * Takes off the page the nodes of the cards no longer drawn; names the one that held the keyboard. A card not
 * drawn is not a card gone: its column may have scrolled past it.
 */
export function dropNodes(nodes: Map<string, CardNode>, alive: ReadonlySet<string>): string | undefined {
  let held: string | undefined;
  for (const [id, node] of nodes) {
    if (alive.has(id)) continue;
    if (node.g === document.activeElement) held = id;
    node.g.remove();
    nodes.delete(id);
  }
  return held;
}

/**
 * The card that held the keyboard is gone from the board, taken back or removed by Claude: the keyboard goes to
 * the card Tab stops at, and stays on the board (S353). Scrolled out of its column, the card is still there, and
 * nothing is taken for it: another card focused would bring the column back to itself.
 */
export function keepKeyboard(held: string | undefined, board: Board, to: CardNode | undefined): void {
  if (!held || document.activeElement !== document.body) return;
  if (!board.elements.some((e) => e.id === held)) to?.g.focus({ preventScroll: true });
}

/** Draws the card in its node, when what it shows changed. Where it is drawn is not part of it. */
export function drawCard(node: CardNode, card: Card, marks: Marks): void {
  const { x: _x, y: _y, cut: _cut, ...look } = card;
  cutCard(node.g, card);
  const signature = JSON.stringify({ ...look, ...marks });
  if (node.signature === signature) return;
  node.g.innerHTML =
    ringMarkup(card) +
    cardMarkup(card) +
    (marks.isUnread ? unreadMark() : "") +
    (marks.isNew ? changedMark(card.h) : "");
  node.signature = signature;
  cutCard(node.g, card);
}

/** Room around a card for what is drawn past its edges: its ring, its marks. */
const AROUND = 40;

/**
 * In a column that scrolls alone (S354), a card at an edge of the window shows the part of it that is inside:
 * the rest is clipped, and takes no pointer. The clip is the card's own, redrawn with it.
 */
function cutCard(g: SVGGElement, card: Card): void {
  const id = `cut-${card.id}`;
  let clip = g.querySelector<SVGClipPathElement>(":scope > clipPath");
  if (!card.cut) {
    clip?.remove();
    g.removeAttribute("clip-path");
    delete g.dataset.cut;
    return;
  }
  if (!clip) {
    clip = svg("clipPath", { id });
    clip.append(svg("rect", {}));
    g.append(clip);
    g.setAttribute("clip-path", `url(#${id})`);
    g.dataset.cut = "";
  }
  const top = card.cut.top > 0 ? card.cut.top : -AROUND;
  const bottom = card.cut.bottom > 0 ? card.h - card.cut.bottom : card.h + AROUND;
  const rect = clip.firstElementChild;
  rect?.setAttribute("x", String(-AROUND));
  rect?.setAttribute("y", String(top));
  rect?.setAttribute("width", String(card.w + 2 * AROUND));
  rect?.setAttribute("height", String(Math.max(0, bottom - top)));
}

/** A screen reader hears a card as one name: its words, where it is, then what its marks show. Its detail stays in the tooltip. */
function cardSaid(board: Board, bands: Scene["bands"], card: Card, marks: Marks): string {
  return [
    cardName(card),
    cardPlace(board, bands, card.id, locale),
    card.hasDetail ? t.hasDetail : undefined,
    card.notes > 0 ? t.openNotesOn(card.notes) : undefined,
    card.labels?.length ? t.labelledWith(card.labels.map(chipText).join(", ")) : undefined,
    marks.isUnread ? t.unread : undefined,
    marks.isNew ? t.changedSinceVisit : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Names the card for who hears it; its links, which the eye follows along the arrows, are told after its name. */
export function sayCard(g: SVGGElement, board: Board, bands: Scene["bands"], card: Card, marks: Marks): void {
  const name = cardSaid(board, bands, card, marks);
  if (g.getAttribute("aria-label") !== name) g.setAttribute("aria-label", name);
  const links = cardLinks(board, card.id, locale);
  if (links === undefined) g.removeAttribute("aria-description");
  else if (g.getAttribute("aria-description") !== links) g.setAttribute("aria-description", links);
}
