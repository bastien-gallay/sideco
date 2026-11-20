/**
 * The board on screen: paints a scene as SVG and turns pointer and keyboard
 * gestures into commands. It never edits the board itself; a gesture sends a
 * command, and the board changes when the event comes back.
 */
import type { Command } from "../domain/commands.ts";
import { type Format, findFormat, findType, isDone, lanesOf } from "../domain/formats.ts";
import {
  headingSlide,
  laneDrop,
  layoutBoard,
  locate,
  type Scene,
  stepDrop,
  type Target,
  vacancy,
} from "../domain/layout/index.ts";
import { cardName } from "../domain/layout/scene.ts";
import { chipText } from "../domain/render/labels.ts";
import { arrowDefs, bandMarkup, cardMarkup, connectorMarkup, esc } from "../domain/render/svg.ts";
import type { Board } from "../domain/workspace.ts";
import { h, svg } from "./dom.ts";
import { locale, t } from "./locale.ts";
import { changed, isLive, send, state } from "./store.ts";
import {
  addOffers,
  cardLinks,
  cardPlace,
  type Direction,
  keptLines,
  keyAdd,
  keyMove,
  laneKeyMove,
  neighbour,
  oneLine,
  type ReadingGroup,
  readingGroups,
} from "./view.ts";

const DRAG_THRESHOLD = 4;
/** The offers drawn in the headings: they come down with them when the board scrolls. */
const HEADING_OFFERS: ReadonlySet<string> = new Set(["lane", "remove-lane", "column", "remove-column"]);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5];
/** How tall the head of a lane is: its name, or its name and what it stands for. Above the first card, both. */
/** A card's move on the board, as styles.css times it (`.card` transition), and a little more. */
const CARD_MOVE_MS = 300;
/** The editor's least height: room for two lines of words. */
const EDITOR_MIN_H = 72;
const LANE_HEAD = 38;
const LANE_HEAD_HINTED = 44;
/** What a lane heading keeps beside its name: the inset on the left and the count on the right. */
const LANE_COUNT_ROOM = 56;
/** What a story map's step numbers take more, once they say their activity and task. */
const BACKBONE_H = 36;
/** How far outside its card the ring of a focused or selected card is drawn: off the sticky's colour, always. */
const RING = 5;
const ARROWS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

interface Editing {
  /** The text the editor opened with, as it would be saved: leaving it as it was saves nothing. */
  initial: string;
  /** Saves the words; true once the companion took them. Nothing to wait for when it returns nothing. */
  commit(value: string): Promise<boolean> | undefined;
  /** The words are on their way: the editor holds them, and nothing closes it meanwhile. */
  saving: boolean;
  /** How the words are kept: on one line for a label, line by line for a detail. */
  tidy(text: string): string;
  /** A text of several lines: read from the left, Shift+Enter breaks its lines. */
  lines: boolean;
  /** The card the keyboard goes back to once the editor closes. */
  from: string | undefined;
  /** Emptied, the words are saved too: a name taken off. */
  blank: boolean;
}

/** How an editor opens: what it is called, and whether its words are several lines read before they are changed. */
interface EditorKind {
  name: string;
  lines: boolean;
  from?: string;
  blank?: boolean;
}

export interface BoardHooks {
  /** A card or a lane left the board by a gesture: the page says so, and offers to take it back. */
  removed(said: string): void;
  /** Something a screen reader should hear, that the eye sees on the board: a card moved by a key. */
  announce(text: string): void;
  /** Something every reader is told, in the page's notice: why a key did nothing. */
  notice(text: string): void;
  /** The card's detail is to be written: the page opens it in its panel. */
  editDetail(id: string): void;
  /** The card's detail is to be read: the page shows it in its panel, unfolded if need be. */
  showDetail(id: string): void;
  /** The card's discussions are to be read: the page opens its Notes tab on them. */
  showNotes(id: string): void;
}

/**
 * The mark of a card that carries a change Claude has not read: a dot on the
 * corner the note count leaves free, with its words for a pointer resting on it.
 */
const UNREAD_MARK = `<g class="card-unread"><title>${esc(t.unread)}</title><circle cx="2" cy="2" r="5"/></g>`;

/**
 * The mark of a card Claude changed while the reader was away: a triangle on
 * the bottom corner nothing else takes, a shape of its own beside the dot.
 */
const changedMark = (height: number): string =>
  `<g class="card-changed" transform="translate(0 ${height})"><title>${esc(t.changedSinceVisit)}</title><path d="M0 -8 L8 5 L-8 5 Z"/></g>`;

export interface BoardView {
  /** `unread` lists the cards that carry a change Claude has not read; `changed`, those Claude changed while the reader was away. */
  paint(board: Board | undefined, unread: readonly string[], changed?: readonly string[]): void;
  /** Opens the label editor for a new element of this type. */
  beginAdd(typeId: string, place?: { col?: number; lane?: string; x: number; y: number }): void;
  zoomBy(step: -1 | 1): number;
  /** The whole board in the window; pressed again, back to 100 %. */
  fit(): number;
  /** Marks one card as the one being talked about, without selecting it; no id clears the mark. */
  point(id: string | undefined): void;
  /** Scrolls the board so that the card is in view. */
  reveal(id: string): void;
  /** Gives the card the keyboard: it is where Tab enters the board from now on. */
  focus(id: string): void;
}

export function mountBoard(host: HTMLElement, hooks: BoardHooks): BoardView {
  const root = svg("svg", { class: "sideco-board", role: "group" });
  root.innerHTML = arrowDefs();
  const bands = root.appendChild(svg("g", { class: "layer-bands" }));
  const hint = root.appendChild(svg("rect", { class: "drop-hint", rx: 8, visibility: "hidden" }));
  const conns = root.appendChild(svg("g", { class: "layer-conns" }));
  const cards = root.appendChild(svg("g", { class: "layer-cards" }));
  /** Over the cards, the one in the hand included: where it would land stays in sight. */
  const dropLine = root.appendChild(
    svg("rect", { class: "drop-line", rx: 2, height: 4, visibility: "hidden" }),
  );
  /** The names of rows, steps and lanes, over the cards: they stay on screen while the board scrolls under them. */
  const heads = root.appendChild(svg("g", { class: "layer-heads" }));
  // The "+" stays over everything: the one that inserts a column sits on the step numbers.
  const adds = root.appendChild(svg("g", { class: "layer-adds" }));
  const scroll = h("div", { class: "canvas-scroll" });
  scroll.append(root);
  const tools = h("div", { class: "card-tools", hidden: true });
  /** The ⋯ of the toolbar stays open through repaints while its card stays chosen. */
  let moreOpen = false;
  let moreFor: string | undefined;
  /** The keyboard is in the page's panels or header: the toolbar leaves the board to them. */
  const keyboardAway = (): boolean => {
    const active = document.activeElement;
    return active !== null && active !== document.body && !host.contains(active);
  };
  // Repainted only as the keyboard leaves the board or comes back: rebuilt on every focus, a button would vanish under its click.
  let away = false;
  document.addEventListener("focusin", () => {
    if (keyboardAway() === away) return;
    away = !away;
    paintTools();
  });
  const editor = h("textarea", {
    class: "card-editor",
    name: "card-editor",
    hidden: true,
    rows: 3,
    "aria-label": t.cardLabel,
  });
  host.append(scroll, tools, editor);
  // A window resized, or a panel folded or unfolded, shares its new width out over the lanes.
  new ResizeObserver(() => {
    const width = Math.floor(scroll.clientWidth - 16);
    if (width <= 0 || width === span) return;
    span = width;
    if (board) changed();
    keepChosenInSight();
  }).observe(scroll);
  /** The card chosen stays on screen while the board's width moves under it: brought back once it has settled. */
  let settling: ReturnType<typeof setTimeout> | undefined;
  function keepChosenInSight(): void {
    clearTimeout(settling);
    settling = setTimeout(() => {
      const id = state.selected;
      if (!id) return;
      nodes.get(id)?.g.scrollIntoView({ block: "nearest", inline: "nearest" });
      paintTools();
    }, CARD_MOVE_MS);
  }

  const nodes = new Map<string, { g: SVGGElement; signature: string }>();
  let board: Board | undefined;
  let unread: readonly string[] = [];
  let missed: readonly string[] = [];
  let scene: Scene = { width: 0, height: 0, bands: [], cards: [], connectors: [] };
  let zoom = 1;
  /**
   * The width the board has on screen, at its own size: lanes share it out.
   * The zoom leaves it alone, so that zooming out shows more of the board
   * rather than wider lanes.
   */
  let span: number | undefined;
  let editing: Editing | undefined;
  /** Where the pointer is, as a place to add to; and what is drawn there, to repaint only on a change. */
  let pointed: Target = { kind: "none" };
  let offered = "";
  let paintedBoard: string | undefined;
  /** The link the human clicked, and where, so its toolbar opens under the pointer. */
  let pickedLink: { src: string; dst: string; x: number; y: number } | undefined;
  /** The one card Tab stops at: the board is a single stop, and the arrows go from card to card inside it. */
  let current: string | undefined;
  /** The reader put the keyboard on `current`, or selected it: until then, Tab enters at the first card read. */
  let chosen = false;
  /** A lane of a kanban taken by its heading, how far it was carried, and where it would land. */
  let laneDrag:
    | {
        lane: string;
        startX: number;
        dx: number;
        moving: boolean;
        drop?: { before?: string; x: number };
      }
    | undefined;
  /** A step of a timeline taken by its number, how far it was carried, and the number it would take. */
  let stepDrag: { from: number; startX: number; dx: number; moving: boolean; to?: number } | undefined;
  /** A lane heading that should have the keyboard once drawn: after a key moved, named or added it. */
  let laneArriving: string | undefined;
  /** A card the human just added, not drawn yet: it comes back on the stream, after the save is answered. */
  let arriving: string | undefined;
  /** The group of each lane or step a screen reader enters, by its name. */
  const groups = new Map<string, SVGGElement>();

  /**
   * Puts the cards in the order they are read, each in the group of its lane
   * or step. The eye sees no change: a card moved to another group still
   * glides from where it was, and the keyboard stays on the card it was on.
   */
  function arrange(reading: readonly ReadingGroup[], glide: boolean): void {
    const wanted: SVGGElement[] = [];
    const inside = new Map<SVGGElement, SVGGElement[]>();
    for (const group of reading) {
      const members = group.ids.flatMap((id) => {
        const g = nodes.get(id)?.g;
        return g ? [g] : [];
      });
      if (group.label === undefined) {
        wanted.push(...members);
        continue;
      }
      let g = groups.get(group.label);
      if (!g) {
        g = svg("g", { class: "card-group", role: "group", "aria-label": group.label });
        groups.set(group.label, g);
      }
      inside.set(g, members);
      wanted.push(g);
    }
    const same = (parent: Element, children: readonly Element[]): boolean =>
      parent.children.length === children.length &&
      children.every((child, i) => parent.children[i] === child);
    const moving = [...inside].filter(([g, members]) => !same(g, members));
    if (moving.length === 0 && same(cards, wanted)) return;
    const focused = document.activeElement;
    // Where each card is on screen now, mid-glide included, before it changes parent.
    const from = new Map<SVGGElement, string>();
    if (glide && !reducedMotion.matches)
      for (const [, members] of moving)
        for (const g of members) if (g.parentElement !== null) from.set(g, getComputedStyle(g).transform);
    for (const [g, members] of moving) g.replaceChildren(...members);
    if (!same(cards, wanted)) cards.replaceChildren(...wanted);
    for (const [label, g] of groups) if (!inside.has(g)) groups.delete(label);
    for (const [g, was] of from) {
      const to = g.style.transform;
      if (was !== "none" && was !== getComputedStyle(g).transform)
        g.animate([{ transform: was }, { transform: to }], {
          duration: 260,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        });
    }
    if (focused instanceof SVGElement && focused !== document.activeElement && focused.isConnected)
      focused.focus({ preventScroll: true });
  }

  /** The markup of the bands last drawn. */
  let paintedBands = "";

  const format = (): Format | undefined => (board ? findFormat(board.format) : undefined);

  function paint(
    next: Board | undefined,
    notRead: readonly string[],
    sinceVisit: readonly string[] = [],
  ): void {
    board = next;
    unread = notRead;
    missed = sinceVisit;
    if (!board) {
      root.setAttribute("visibility", "hidden");
      tools.hidden = true;
      return;
    }
    root.removeAttribute("visibility");
    root.setAttribute("aria-label", t.boardCards(board.title));
    scene = layoutBoard(board, locale, span);
    const w = Math.max(scene.width, 320);
    const hgt = Math.max(scene.height, 200);
    root.setAttribute("viewBox", `0 0 ${w} ${hgt}`);
    root.setAttribute("width", String(w * zoom));
    root.setAttribute("height", String(hgt * zoom));
    // Rows, steps and lanes are redrawn only when they change: an event about a card leaves them, and their names, in place.
    const banding = scene.bands.map(bandMarkup).join("");
    if (banding !== paintedBands) {
      paintedBands = banding;
      bands.innerHTML = banding;
      liftHeadings();
    }
    holdHeadings();
    if (laneArriving) {
      const label = heads.querySelector<SVGTextElement>(`text.lane-label[data-lane="${laneArriving}"]`);
      const at = document.activeElement;
      if (label && (at === null || at === document.body || at === editor || !at.isConnected)) {
        label.focus({ preventScroll: true });
        laneArriving = undefined;
      }
    }
    conns.innerHTML = scene.connectors.map(connectorMarkup).join("");
    for (const conn of conns.querySelectorAll<SVGGElement>(".conn")) {
      const path = conn.querySelector("path");
      if (path) conn.prepend(svg("path", { class: "conn-hit", d: path.getAttribute("d") ?? "" }));
    }

    const switched = paintedBoard !== board.id;
    paintedBoard = board.id;
    const focus = board.focus ? new Set(board.focus.ids) : undefined;
    const alive = new Set<string>();
    for (const card of scene.cards) {
      alive.add(card.id);
      const { x, y, ...look } = card;
      const isUnread = unread.includes(card.id);
      const isNew = missed.includes(card.id);
      const signature = JSON.stringify({ ...look, isUnread, isNew });
      let node = nodes.get(card.id);
      if (!node) {
        const g = svg("g", { class: "card", "data-id": card.id, tabindex: -1, role: "button" });
        if (switched) g.classList.add("no-motion");
        cards.append(g);
        node = { g, signature: "" };
        nodes.set(card.id, node);
      }
      if (node.signature !== signature) {
        node.g.innerHTML =
          ringMarkup(card) +
          cardMarkup(card) +
          (isUnread ? UNREAD_MARK : "") +
          (isNew ? changedMark(card.h) : "");
        node.signature = signature;
      }
      // A screen reader hears a card as one name: its words, where it is, then what its marks show. Its detail stays in the tooltip.
      const place = cardPlace(board, scene.bands, card.id, locale);
      const name = [
        cardName(card),
        place,
        card.hasDetail ? t.hasDetail : undefined,
        card.notes > 0 ? t.openNotesOn(card.notes) : undefined,
        card.labels?.length ? t.labelledWith(card.labels.map(chipText).join(", ")) : undefined,
        isUnread ? t.unread : undefined,
        isNew ? t.changedSinceVisit : undefined,
      ]
        .filter(Boolean)
        .join(" · ");
      if (node.g.getAttribute("aria-label") !== name) node.g.setAttribute("aria-label", name);
      // Its links, which the eye follows along the arrows, are told after its name.
      const links = cardLinks(board, card.id, locale);
      if (links === undefined) node.g.removeAttribute("aria-description");
      else if (node.g.getAttribute("aria-description") !== links)
        node.g.setAttribute("aria-description", links);
      node.g.setAttribute("aria-pressed", String(state.selected === card.id));
      // A card in the human's hand stays there, whatever arrives meanwhile.
      if (!(drag?.moving && drag.id === card.id)) node.g.style.transform = `translate(${x}px, ${y}px)`;
      node.g.classList.toggle("is-selected", state.selected === card.id);
      node.g.classList.toggle("is-link-source", state.linking === card.id);
      node.g.classList.toggle("is-fresh", state.fresh.has(`${board.id}/${card.id}`));
      node.g.classList.toggle("is-new", isNew);
      node.g.classList.toggle("is-focus", focus?.has(card.id) ?? false);
      node.g.classList.toggle("is-dim", focus !== undefined && !focus.has(card.id));
    }
    // The card being written on was removed meanwhile: its words are handed back, not dropped.
    if (editing?.from && !alive.has(editing.from)) {
      const words = editing.tidy(editor.value);
      if (words !== "" && words !== editing.initial) state.notice = t.wordsOrphaned(editing.from, words);
      editing = undefined;
      editor.hidden = true;
    }
    for (const [id, node] of nodes) {
      if (alive.has(id)) continue;
      node.g.remove();
      nodes.delete(id);
    }
    const reading = readingGroups(board, scene, locale);
    arrange(reading, !switched);
    // The board is one Tab stop: the selected card, else the last one the keyboard was on, else the first one read.
    if (switched) chosen = false;
    if (state.selected && alive.has(state.selected)) {
      current = state.selected;
      chosen = true;
    }
    // A card nobody chose is never kept: the first one read may change as cards come and go.
    if (!chosen || !current || !alive.has(current)) {
      current = reading[0]?.ids[0];
      chosen = false;
    }
    for (const [id, node] of nodes) node.g.setAttribute("tabindex", id === current ? "0" : "-1");
    // The card just added takes the keyboard once drawn, unless the human has gone on elsewhere.
    if (arriving && alive.has(arriving)) {
      const id = arriving;
      arriving = undefined;
      const at = document.activeElement;
      if (at === null || at === document.body || at === editor) focusCard(id);
    }
    if (switched)
      requestAnimationFrame(() => {
        for (const g of cards.querySelectorAll(".no-motion")) g.classList.remove("no-motion");
      });
    host.classList.toggle("is-linking", state.linking !== null);
    host.classList.toggle("is-past", !isLive());
    host.classList.toggle("has-steps", format()?.layout === "timeline");
    host.classList.toggle("has-own-lanes", Boolean(format()?.ownLanes && !format()?.grid));
    paintTools();
    paintOffers();
  }

  /** The ring of a focused or selected card, drawn around it rather than on it: it reads on every sticky. */
  function ringMarkup(card: { w: number; h: number }): string {
    return `<rect class="card-ring" x="${-RING}" y="${-RING}" width="${card.w + 2 * RING}" height="${card.h + 2 * RING}" rx="${RING + 2}"/>`;
  }

  /**
   * Keeps the names of rows, steps and lanes on screen while the board scrolls
   * under them, as the frozen headings of a sheet: the reader never has to
   * remember which row is which.
   */
  function holdHeadings(): void {
    const sx = scroll.scrollLeft / zoom;
    const sy = scroll.scrollTop / zoom;
    const steps = heads.querySelector(".heads-steps");
    steps?.setAttribute("transform", `translate(0 ${sy})`);
    // On a story map, once the activities have scrolled under the numbers, each step says its activity and task.
    const backbone = scene.backbone !== undefined && sy > scene.backbone - frozen.top;
    steps?.classList.toggle("shows-backbone", backbone);
    // The step in the human's hand stays there, its number and its captions, whatever is painted meanwhile.
    for (const label of heads.querySelectorAll<SVGTextElement>(".heads-steps text")) {
      const held = stepDrag?.moving === true && label.dataset.col === String(stepDrag.from);
      label.classList.toggle("is-dragging", held);
      if (held) label.setAttribute("transform", `translate(${stepDrag?.dx ?? 0} 0)`);
      else label.removeAttribute("transform");
    }
    heads.querySelector(".heads-rows")?.setAttribute("transform", `translate(${sx} 0)`);
    for (const head of heads.querySelectorAll<SVGGElement>("g.head")) {
      const band = scene.bands[Number(head.dataset.band)];
      if (band?.kind !== "lane") continue;
      // A lane's heading goes down to its last card at most: it never leaves its own lane.
      // The heading in the human's hand stays there, whatever is painted meanwhile.
      const held = laneDrag?.moving === true && laneDrag.lane === band.id;
      head.classList.toggle("is-dragging", held);
      head.setAttribute("transform", `translate(${held ? laneDrag?.dx : 0} ${headDrop(band)})`);
      // Its name and what it stands for follow a sideways scroll too, short of the count at its right end.
      const words = [...head.querySelectorAll<SVGTextElement>("text.lane-label, text.lane-hint")];
      const room = Math.max(0, ...words.map((text) => text.getComputedTextLength())) + LANE_COUNT_ROOM;
      const slide = headingSlide(band, sx, room);
      for (const text of words) {
        if (slide > 0) text.setAttribute("transform", `translate(${slide} 0)`);
        else text.removeAttribute("transform");
      }
    }
    paintOffers();
    // A card the keyboard or a search brings into view lands clear of the frozen names, never under them.
    scroll.style.scrollPaddingTop = `${(frozen.top + (backbone ? BACKBONE_H : 0)) * zoom + 8}px`;
    scroll.style.scrollPaddingLeft = `${frozen.left * zoom + 8}px`;
  }

  /** How far a lane's heading has come down with the scroll: it never leaves its own lane. */
  function headDrop(band: { y: number; h: number }): number {
    return Math.max(0, Math.min(scroll.scrollTop / zoom - band.y, band.h - 56));
  }

  /** How far the headings of a kanban came down: what is offered in them comes down too. */
  function lanesDrop(): number {
    const first = scene.bands.find((band) => band.kind === "lane");
    return first && format()?.ownLanes ? headDrop(first) : 0;
  }

  /** How far the headings came down with the scroll, step numbers or kanban headings: what is offered there comes down too. */
  function headsDrop(): number {
    return format()?.layout === "timeline" ? scroll.scrollTop / zoom : lanesDrop();
  }

  /** What the pointer is on among the headings, as they are drawn after the scroll. */
  function inHeadings(x: number, y: number): Target | undefined {
    if (!board) return undefined;
    const target = locate(board, x, y - headsDrop(), undefined, span);
    return target.kind === "lane-edge" || target.kind === "boundary" || target.kind === "step-head"
      ? target
      : undefined;
  }

  /** How much of the top and of the left the frozen names cover, in scene units. */
  let frozen = { top: 0, left: 0 };

  /**
   * Takes the names out of the bands, behind the cards, up to the layer over
   * them. On a timeline they sit on a strip of the board's own surface, the step
   * numbers across the top and the row names down the left: the frozen panes of
   * a sheet. A lane keeps its heading, ringed by the lane's own colour.
   */
  function liftHeadings(): void {
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
        // The lane's name rides on a strip of the lane's own colour: what scrolls under it is hidden, not smeared.
        const tall = band.hint ? LANE_HEAD_HINTED : LANE_HEAD;
        laneTop = Math.max(laneTop, tall);
        const head = svg("g", { class: "head band-lane", "data-band": index });
        head.append(
          svg("rect", {
            class: "heads-lane-strip",
            x: band.x,
            y: band.y,
            width: band.w,
            height: tall,
            rx: 10,
          }),
          ...group.querySelectorAll("text"),
        );
        // Where a subtitle would go, offered under the pointer: a double-click writes one.
        if (!band.hint) {
          const blank = svg("text", {
            class: "lane-hint-blank",
            x: band.x + 14,
            y: band.y + 37,
            "data-lane": band.id,
          });
          blank.textContent = t.addLaneHint;
          head.append(blank);
        }
        heads.append(head);
        // On a kanban, a lane heading is a Tab stop: its keys rename, move, remove it, or add one beside it.
        const label = head.querySelector<SVGTextElement>("text.lane-label");
        if (label && format()?.ownLanes && !format()?.grid) {
          label.setAttribute("tabindex", "0");
          label.setAttribute("role", "button");
          label.setAttribute("aria-label", t.laneHeading(band.label, band.count ?? 0));
          label.setAttribute("aria-description", t.laneKeys);
        }
      }
    });
    frozen = {
      top: Number.isFinite(top) ? top : laneTop,
      left: Number.isFinite(left) ? left : 0,
    };
    if (steps.childElementCount > 1) heads.append(steps);
    if (rows.childElementCount > 1) heads.append(rows);
  }

  /** Draws a "+" for each kind of card that can be added where the pointer is. */
  function paintOffers(): void {
    const quiet =
      !board ||
      !isLive() ||
      editing !== undefined ||
      drag?.moving === true ||
      laneDrag?.moving === true ||
      stepDrag?.moving === true;
    const offers = quiet || !board ? [] : addOffers(board, pointed, locale, span);
    const drop = headsDrop();
    const signature = JSON.stringify({ offers, drop });
    if (signature === offered) return;
    offered = signature;
    adds.replaceChildren(
      ...offers.map((offer) => {
        const g = svg("g", {
          class: offer.type === "column" ? "add-here insert-column" : "add-here",
          "data-type": offer.type,
          ...(offer.column === undefined ? {} : { "data-column": offer.column }),
          ...(offer.before === undefined ? {} : { "data-before": offer.before }),
          ...(offer.lane === undefined ? {} : { "data-lane": offer.lane }),
          role: "button",
          "aria-label": offer.label,
          transform: `translate(${offer.x} ${offer.y + (HEADING_OFFERS.has(offer.type) ? drop : 0)})`,
        });
        const title = svg("title", {});
        title.textContent = offer.label;
        const text = svg("text", { x: offer.w / 2, y: offer.h / 2, fill: offer.ink });
        text.textContent = offer.text;
        g.append(title, svg("rect", { width: offer.w, height: offer.h, rx: 6, fill: offer.fill }), text);
        return g;
      }),
    );
  }

  /** Opens the editor for a new card of this kind where the pointer is: in its cell, or at the end of its lane. */
  function addHere(typeId: string): void {
    const room = board ? vacancy(board, pointed, span) : undefined;
    const matrix = root.getScreenCTM();
    if (!room || !matrix || pointed.kind === "none") return;
    const corner = new DOMPoint(room.x, room.y).matrixTransform(matrix);
    const place = { x: corner.x, y: corner.y };
    if (pointed.kind === "cell") beginAdd(typeId, { col: pointed.col, ...place });
    else if (pointed.kind === "slot") beginAdd(typeId, { lane: pointed.lane, ...place });
  }

  /** A card scrolled out of the board's window: its toolbar would stand alone at the edge, so it goes. */
  function outOfSight(g: SVGGElement): boolean {
    const card = g.getBoundingClientRect();
    const seen = scroll.getBoundingClientRect();
    return (
      card.right < seen.left || card.left > seen.right || card.bottom < seen.top || card.top > seen.bottom
    );
  }

  /**
   * A card the keyboard sent elsewhere: once it has landed, it is brought into
   * view, and its toolbar follows it there rather than stay where it was.
   */
  function follow(id: string): void {
    window.setTimeout(() => {
      nodes.get(id)?.g.scrollIntoView({ block: "nearest", inline: "nearest" });
      paintTools();
    }, CARD_MOVE_MS);
  }

  function paintTools(): void {
    const id = state.selected;
    const node = id ? nodes.get(id) : undefined;
    const link = pickedLink;
    if (
      board &&
      link &&
      isLive() &&
      !editing &&
      board.edges.some((e) => e.src === link.src && e.dst === link.dst)
    ) {
      const boardId = board.id;
      const remove = (): void => {
        pickedLink = undefined;
        void send({ kind: "unlink", board: boardId, src: link.src, dst: link.dst });
      };
      tools.replaceChildren(
        h("span", { class: "tools-label" }, t.linkBetween(link.src, link.dst)),
        h("button", { type: "button", onclick: () => nameLink(link.src, link.dst) }, t.nameLink),
        h("button", { type: "button", class: "danger", onclick: remove }, t.removeLink),
      );
      tools.hidden = false;
      tools.style.left = `${Math.max(8, link.x)}px`;
      tools.style.top = `${Math.max(8, link.y + 12)}px`;
      return;
    }
    pickedLink = undefined;
    if (
      !board ||
      !id ||
      !node ||
      !isLive() ||
      state.linking ||
      editing ||
      keyboardAway() ||
      outOfSight(node.g)
    ) {
      tools.hidden = true;
      return;
    }
    if (id !== moreFor) moreOpen = false;
    moreFor = id;
    const boardId = board.id;
    const element = board.elements.find((e) => e.id === id);
    // Each action says its key too: the shortcuts are learnt where they are used.
    const keyed = (label: string, key: string): { title: string } => ({ title: t.withKey(label, key) });
    const done = element !== undefined && isDone(board, element);
    const doneLabel = done ? t.notDone : t.done;
    // An action chosen in the list closes it: the list does not stay over the board it changed.
    const chosen = (act: () => void): void => {
      moreOpen = false;
      more.open = false;
      act();
    };
    // The actions taken most stay in view; the others wait under ⋯, their keys still at hand.
    const more = h(
      "details",
      {
        class: "menu card-more",
        open: moreOpen,
        ontoggle: () => {
          moreOpen = more.open;
          if (!more.open) return;
          // Low on the board, the list opens upwards rather than under the board's edge.
          const list = more.querySelector<HTMLElement>(".menu-items");
          const bottom = host.getBoundingClientRect().bottom;
          if (list) more.classList.toggle("opens-up", list.getBoundingClientRect().bottom > bottom - 8);
        },
      },
      h("summary", { title: t.moreActions, "aria-label": t.moreActions }, "⋯"),
      h(
        "div",
        { class: "menu-items" },
        h(
          "button",
          { type: "button", ...keyed(t.link, "L"), onclick: () => chosen(() => beginLink(id)) },
          t.link,
        ),
        h(
          "button",
          { type: "button", ...keyed(doneLabel, "D"), onclick: () => chosen(() => markDone(id, !done)) },
          doneLabel,
        ),
        h(
          "button",
          {
            type: "button",
            class: "danger",
            ...keyed(t.remove, "Delete"),
            onclick: () => chosen(() => void send({ kind: "remove", board: boardId, id })),
          },
          t.remove,
        ),
      ),
    );
    tools.replaceChildren(
      h("button", { type: "button", ...keyed(t.rename, "Enter"), onclick: () => rename(id) }, t.rename),
      // The ≡ the card wears when it has a detail: seen here too, not heard.
      h(
        "button",
        { type: "button", ...keyed(t.detail, "E"), onclick: () => hooks.editDetail(id) },
        t.detail,
        element?.detail ? h("span", { "aria-hidden": "true" }, " ≡") : undefined,
      ),
      ...leadsFrom(id, element?.type),
      h(
        "button",
        { type: "button", ...keyed(t.noteForClaude, "N"), onclick: () => noteOn(id) },
        t.noteForClaude,
      ),
      more,
    );
    tools.hidden = false;
    const box = node.g.getBoundingClientRect();
    const frame = host.getBoundingClientRect();
    // Inside the window: a toolbar cut by the edge hides the action at its end.
    const widest = Math.max(8, frame.width - tools.offsetWidth - 8);
    const highest = Math.max(8, frame.height - tools.offsetHeight - 8);
    const within = (x: number, y: number) => ({
      left: Math.min(widest, Math.max(8, x)),
      top: Math.min(highest, Math.max(8, y)),
    });
    const hides = ({ left, top }: { left: number; top: number }): boolean => {
      const span = {
        left: frame.left + left,
        right: frame.left + left + tools.offsetWidth,
        top: frame.top + top,
        bottom: frame.top + top + tools.offsetHeight,
      };
      return [...nodes].some(([other, { g }]) => {
        if (other === id) return false;
        const r = g.getBoundingClientRect();
        return r.left < span.right && r.right > span.left && r.top < span.bottom && r.bottom > span.top;
      });
    };
    const x = box.left - frame.left;
    const y = box.top - frame.top;
    // Above the card, else under it, else beside it, wherever it hides no other card. When every
    // place would, it sits on the chosen card itself: the one card the reader already knows.
    const places = [
      within(x, y - tools.offsetHeight - 8),
      within(x, box.bottom - frame.top + 8),
      within(box.right - frame.left + 8, y),
      within(x - tools.offsetWidth - 8, y),
    ];
    const { left, top } = places.find((place) => !hides(place)) ?? within(x, y + 4);
    tools.style.left = `${left}px`;
    tools.style.top = `${top}px`;
  }

  function toScene(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const matrix = root.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }

  function cardAt(target: EventTarget | null): string | undefined {
    return (target as Element | null)?.closest?.<SVGGElement>("g.card")?.dataset.id;
  }

  /**
   * What sits under the pointer. While a pointer is captured for a drag, the
   * click and double-click that follow are addressed to the board itself, so
   * their own target says nothing: ask the document instead.
   */
  function under(event: MouseEvent): Element | null {
    return document.elementFromPoint(event.clientX, event.clientY);
  }

  /**
   * Opens the editor over a card, or under it. A label is a few words replaced
   * at once: they come selected, and Enter saves them. A note is a few lines
   * written at once: Enter saves it and Shift with Enter breaks the line. A
   * card's detail is not written here but in the page's panel.
   */
  function openEditor(
    box: DOMRect,
    value: string,
    placeholder: string,
    colours: { fill: string; ink: string },
    commit: (value: string) => Promise<boolean> | undefined,
    kind: EditorKind = { name: t.cardLabel, lines: false },
  ): void {
    const frame = host.getBoundingClientRect();
    const tidy = kind.lines ? keptLines : oneLine;
    const width = Math.max(box.width, 152);
    editor.value = value;
    editor.placeholder = placeholder;
    editor.setAttribute("aria-label", kind.name);
    if (kind.lines) editor.setAttribute("aria-description", t.saveLines);
    else editor.removeAttribute("aria-description");
    editor.title = kind.lines ? t.saveLines : "";
    editor.classList.toggle("is-lines", kind.lines);
    editor.style.left = `${Math.min(Math.max(0, frame.width - width - 8), box.left - frame.left)}px`;
    editor.style.top = `${box.top - frame.top}px`;
    editor.style.width = `${width}px`;
    editor.style.height = `${Math.max(box.height, EDITOR_MIN_H)}px`;
    editor.style.background = colours.fill;
    editor.style.color = colours.ink;
    editor.hidden = false;
    editing = {
      initial: tidy(value),
      commit,
      tidy,
      lines: kind.lines,
      from: kind.from,
      blank: kind.blank ?? false,
      saving: false,
    };
    tools.hidden = true;
    paintOffers();
    editor.focus();
    if (kind.lines) editor.setSelectionRange(value.length, value.length);
    else editor.select();
  }

  /** `refocus`: the keyboard goes back to the card the editor was about, rather than to nowhere. */
  function closeEditor(save: boolean, refocus = true): void {
    const was = editing;
    if (!was || was.saving) return;
    const value = was.tidy(editor.value);
    const pending =
      save && (value !== "" || was.blank) && value !== was.initial ? was.commit(value) : undefined;
    if (pending) {
      hold(was, pending, refocus);
      return;
    }
    editing = undefined;
    editor.hidden = true;
    changed();
    if (refocus && was.from) nodes.get(was.from)?.g.focus({ preventScroll: true });
  }

  /**
   * Keeps the words on screen until the companion has them. Saved, the editor
   * closes; not saved, the words come back to the human, editable, with the
   * reason said by the page.
   */
  function hold(was: Editing, pending: Promise<boolean>, refocus: boolean): void {
    was.saving = true;
    editor.readOnly = true;
    editor.setAttribute("aria-busy", "true");
    void pending.then((saved) => {
      was.saving = false;
      editor.readOnly = false;
      editor.removeAttribute("aria-busy");
      if (editing !== was) return;
      if (saved) {
        closeEditor(false, refocus);
        return;
      }
      editor.focus();
    });
  }

  editor.addEventListener("keydown", (event) => {
    // As everywhere on the page: Enter saves, Shift+Enter breaks the line.
    const saves = event.key === "Enter" && !event.isComposing && !event.shiftKey;
    if (saves) {
      event.preventDefault();
      closeEditor(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeEditor(false);
    }
    event.stopPropagation();
  });
  // Leaving the editor for elsewhere keeps what was typed, and leaves the keyboard where it went.
  editor.addEventListener("blur", () => closeEditor(true, false));

  function colours(typeId: string | undefined): { fill: string; ink: string } {
    const f = format();
    const type = f && typeId ? findType(f, typeId) : undefined;
    return { fill: type?.fill ?? "#FFFFFF", ink: type?.ink ?? "#1F2328" };
  }

  /** Whether a send saved something: it answers undefined when nothing was. */
  function saved(sending: Promise<unknown>): Promise<boolean> {
    return sending.then((answer) => answer !== undefined);
  }

  function rename(id: string): void {
    const node = nodes.get(id);
    const element = board?.elements.find((e) => e.id === id);
    if (!board || !node || !element || !isLive()) return;
    const boardId = board.id;
    openEditor(
      node.g.getBoundingClientRect(),
      element.label,
      t.cardLabel,
      colours(element.type),
      (label) => {
        if (label !== element.label) return saved(send({ kind: "rename", board: boardId, id, label }));
      },
      { name: t.cardLabel, lines: false, from: id },
    );
  }

  /** Opens the editor on the name of a lane: what is typed is the name this board gives it. */
  function renameLane(heading: SVGTextElement): void {
    const lane = heading.dataset.lane;
    if (!board || !lane) return;
    const boardId = board.id;
    const box = heading.getBoundingClientRect();
    openEditor(
      new DOMRect(box.left - 6, box.top - 6, 180, 36),
      heading.textContent ?? "",
      t.laneName,
      { fill: "var(--surface)", ink: "var(--ink)" },
      (label) => {
        return saved(send({ kind: "name-lane", board: boardId, lane, label }));
      },
    );
  }

  /**
   * Opens the editor on what a lane stands for, under its name: over the
   * subtitle, or where one would go. Emptied, the workshop's words come back.
   */
  function hintLane(lane: string): void {
    if (!board || !isLive()) return;
    const boardId = board.id;
    const band = scene.bands.find((b) => b.kind === "lane" && b.id === lane);
    const spot = heads.querySelector<SVGTextElement>(
      `text.lane-hint[data-lane="${CSS.escape(lane)}"], text.lane-hint-blank[data-lane="${CSS.escape(lane)}"]`,
    );
    const box = (
      spot ?? heads.querySelector(`text.lane-label[data-lane="${CSS.escape(lane)}"]`)
    )?.getBoundingClientRect();
    if (!box) return;
    openEditor(
      new DOMRect(box.left - 6, box.top - 8, 220, 36),
      band?.hint ?? "",
      t.laneHintName,
      { fill: "var(--surface)", ink: "var(--ink)" },
      (hint) => saved(send({ kind: "hint-lane", board: boardId, lane, hint })),
      { name: t.laneHintName, lines: false, blank: true },
    );
  }

  /**
   * Where the editor opens on a word of an axis: over the word it replaces,
   * starting where it starts. The axis across the bottom has its editor above
   * it, clear of the footer; the upright one has it beside it.
   */
  function axisEditorBox(box: DOMRect, axis: string, bound: string | undefined): DOMRect {
    const w = 220;
    const h = 36;
    if (axis === "y") return new DOMRect(box.right + 6, box.top + box.height / 2 - h / 2, w, h);
    const left =
      bound === "low"
        ? box.left - 6
        : bound === "high"
          ? box.right + 6 - w
          : box.left + box.width / 2 - w / 2;
    // The editor is never less than EDITOR_MIN_H tall: it is lifted by that much, not by the box asked for.
    return new DOMRect(left, box.top - EDITOR_MIN_H - 4, w, h);
  }

  /**
   * Opens the editor on an axis of a plan: its name, or the word at one of its
   * ends. Emptied, the name gives back the workshop's axis, its ends with it;
   * an end gives back the workshop's word for it.
   */
  function nameAxis(text: SVGTextElement): void {
    const axis = text.dataset.axis;
    const band = scene.bands.find((b) => b.kind === "axis" && b.id === axis);
    if (!board || !isLive() || !axis || !band) return;
    const boardId = board.id;
    const bound = text.dataset.bound as "low" | "high" | undefined;
    const box = text.getBoundingClientRect();
    const value = bound ? (band[bound] ?? "") : band.label;
    const placeholder = bound === "low" ? t.axisLow : bound === "high" ? t.axisHigh : t.axisName;
    openEditor(
      axisEditorBox(box, axis, bound),
      value,
      placeholder,
      { fill: "var(--surface)", ink: "var(--ink)" },
      (word) =>
        saved(
          send(
            bound
              ? { kind: "name-axis", board: boardId, axis, label: band.label, [bound]: word }
              : { kind: "name-axis", board: boardId, axis, label: word },
          ),
        ),
      { name: placeholder, lines: false, blank: true },
    );
  }

  /** Opens the editor on the edge where the "+" was: what is typed names the lane added there. */
  function nameNewLane(offer: SVGGElement): void {
    const box = offer.getBoundingClientRect();
    nameLaneAt(new DOMRect(box.left + box.width / 2 - 90, box.top - 7, 180, 36), offer.dataset.before);
  }

  /** The editor that names a lane added before `before`, else last; once drawn, its heading has the keyboard. */
  function nameLaneAt(box: DOMRect, before: string | undefined): void {
    if (!board || !isLive()) return;
    const boardId = board.id;
    openEditor(box, "", t.laneName, { fill: "var(--surface)", ink: "var(--ink)" }, (label) =>
      saved(
        send({ kind: "add-lane", board: boardId, label, ...(before ? { before } : {}) }).then((minted) => {
          const lane = minted?.[0];
          if (lane) laneArriving = lane;
          return minted;
        }),
      ),
    );
  }

  function removeLane(lane: string): void {
    if (!board || !isLive()) return;
    const name = scene.bands.find((band) => band.kind === "lane" && band.id === lane)?.label ?? lane;
    void send({ kind: "remove-lane", board: board.id, lane }).then((done) => {
      if (done !== undefined) hooks.removed(t.laneRemoved(name));
    });
  }

  function removeStep(col: number): void {
    if (!board || !isLive()) return;
    void send({ kind: "remove-column", board: board.id, at: col }).then((done) => {
      if (done !== undefined) hooks.removed(t.stepRemoved(col));
    });
  }

  /**
   * Opens the editor on the name of a link, over the name when it has one: a
   * decision's branches are told apart by it. Emptied, the name comes off.
   */
  function nameLink(src: string, dst: string): void {
    const edge = board?.edges.find((e) => e.src === src && e.dst === dst);
    if (!board || !edge || !isLive()) return;
    const boardId = board.id;
    const conn = [...conns.querySelectorAll<SVGGElement>("g.conn")].find(
      (g) => g.dataset.src === src && g.dataset.dst === dst,
    );
    const named = conn?.querySelector("text.conn-label")?.getBoundingClientRect();
    const frame = host.getBoundingClientRect();
    const at =
      named ?? new DOMRect(frame.left + (pickedLink?.x ?? 0), frame.top + (pickedLink?.y ?? 0), 0, 0);
    pickedLink = undefined;
    openEditor(
      new DOMRect(at.left - 6, at.top - 8, 180, 36),
      edge.label ?? "",
      t.linkName,
      { fill: "var(--surface)", ink: "var(--ink)" },
      (label) => saved(send({ kind: "link", board: boardId, src, dst, ...(label ? { label } : {}) })),
      { name: t.linkNameOf(src, dst), lines: false, blank: true },
    );
  }

  function noteOn(id: string): void {
    const node = nodes.get(id);
    if (!board || !node) return;
    const boardId = board.id;
    const box = node.g.getBoundingClientRect();
    const below = new DOMRect(box.left, box.bottom + 6, 300, 96);
    openEditor(
      below,
      "",
      t.noteOnPlaceholder(id),
      { fill: "var(--surface)", ink: "var(--ink)" },
      (text) => {
        const sent = saved(send({ kind: "note", board: boardId, text, target: id }));
        // Written, the note is shown where it will be answered.
        void sent.then((ok) => ok && hooks.showNotes(id));
        return sent;
      },
      { name: t.noteOn(id), lines: true, from: id },
    );
  }

  /** Done, or no longer: on a kanban the card changes lane, and the ear is told where it went. */
  function markDone(id: string, done: boolean): void {
    if (!board) return;
    const lanes = lanesOf(board);
    const was = board.elements.find((e) => e.id === id)?.lane;
    const to = done ? lanes.at(-1) : was === lanes.at(-1) ? lanes.at(-2) : was;
    const place =
      format()?.doneLast && to !== was
        ? scene.bands.find((band) => band.kind === "lane" && band.id === to)?.label
        : undefined;
    void send({ kind: "mark", board: board.id, id, done }).then((answer) => {
      if (answer === undefined) return;
      if (to !== was) follow(id);
      if (place) hooks.announce(t.moved(id, place));
    });
  }

  function beginLink(id: string): void {
    state.linking = id;
    changed();
  }

  /** The button that makes, from a card, one of the kind it leads to: a point of a retro, an action. */
  function leadsFrom(id: string, typeId: string | undefined): HTMLElement[] {
    const f = format();
    const next = f && typeId ? findType(f, typeId)?.leadsTo : undefined;
    if (!next) return [];
    return [h("button", { type: "button", onclick: () => makeFrom(id, next.type) }, next.label[locale])];
  }

  /** Opens the editor for a card of `typeId`, beside this one, to be linked from it once named. */
  function makeFrom(id: string, typeId: string): void {
    const node = nodes.get(id);
    if (!node) return;
    const r = node.g.getBoundingClientRect();
    beginAdd(typeId, { from: id, x: r.right + 12 * zoom, y: r.top });
  }

  /** Opens the editor for a card of the focused one's kind, beside it where the arrow points. */
  function addBeside(id: string, direction: Direction): void {
    const node = nodes.get(id);
    const place = board ? keyAdd(board, id, direction) : undefined;
    if (!node || !place) return;
    const r = node.g.getBoundingClientRect();
    const gap = 12 * zoom;
    const x = direction === "right" ? r.right + gap : direction === "left" ? r.left - r.width - gap : r.left;
    const y = direction === "down" ? r.bottom + gap : direction === "up" ? r.top - r.height - gap : r.top;
    beginAdd(place.type, { ...place, x, y });
  }

  function beginAdd(
    typeId: string,
    place?: { col?: number; lane?: string; before?: string; from?: string; x: number; y: number },
  ): void {
    const f = format();
    const type = f ? findType(f, typeId) : undefined;
    if (!board || !f || !type || !isLive()) return;
    const boardId = board.id;
    const frame = host.getBoundingClientRect();
    const box = place
      ? new DOMRect(place.x, place.y, 152 * zoom, 88 * zoom)
      : new DOMRect(frame.left + 16, frame.top + 16, 168, 88);
    const from = place?.from ?? (f.layout === "graph" ? (state.selected ?? undefined) : undefined);
    openEditor(box, "", t.newCard(type.label[locale], type.hint[locale]), type, (label) => {
      const command: Command = {
        kind: "add",
        board: boardId,
        type: type.id,
        label,
        col: place?.col,
        lane: place?.lane,
        before: place?.before,
        from,
      };
      return saved(
        send(command).then((minted) => {
          const id = minted?.[0];
          if (id) {
            state.selected = id;
            arriving = id;
            changed();
          }
          return minted;
        }),
      );
    });
  }

  function showHint(target: Target): void {
    const band =
      target.kind === "cell"
        ? scene.bands.find((b) => b.kind === "step" && b.id === String(target.col))
        : target.kind === "slot"
          ? scene.bands.find((b) => b.kind === "lane" && b.id === target.lane)
          : undefined;
    if (!band) {
      hint.setAttribute("visibility", "hidden");
      dropLine.setAttribute("visibility", "hidden");
      return;
    }
    hint.setAttribute("x", String(band.x + 2));
    hint.setAttribute("y", String(band.y + 2));
    hint.setAttribute("width", String(band.w - 4));
    hint.setAttribute("height", String(band.h - 4));
    hint.setAttribute("visibility", "visible");
    showDropLine(target);
  }

  /** Where in its cell or lane the card would land: a line between two cards, or under the last. */
  function showDropLine(target: Target): void {
    const moving = drag?.id;
    const peers =
      board && (target.kind === "cell" || target.kind === "slot")
        ? board.elements.filter(
            (e) =>
              e.id !== moving &&
              (target.kind === "cell"
                ? e.col === target.col && e.type === target.type
                : target.kind === "slot" && e.lane === target.lane),
          )
        : [];
    const before = target.kind === "cell" || target.kind === "slot" ? target.before : undefined;
    const at = scene.cards.find((c) => c.id === (before ?? peers.at(-1)?.id));
    if (!at) {
      dropLine.setAttribute("visibility", "hidden");
      return;
    }
    dropLine.setAttribute("x", String(at.x));
    dropLine.setAttribute("y", String(before ? at.y - 6 : at.y + at.h + 2));
    dropLine.setAttribute("width", String(at.w));
    dropLine.setAttribute("visibility", "visible");
  }

  let drag:
    | { id: string; startX: number; startY: number; dx: number; dy: number; moving: boolean; target: Target }
    | undefined;

  const offerAt = (target: EventTarget | null): SVGGElement | null =>
    (target as Element | null)?.closest?.<SVGGElement>("g.add-here") ?? null;

  root.addEventListener("pointerdown", (event) => {
    const head = (event.target as Element | null)?.closest?.<SVGGElement>("g.head.band-lane");
    const band = head ? scene.bands[Number(head.dataset.band)] : undefined;
    if (
      head &&
      band?.kind === "lane" &&
      event.button === 0 &&
      isLive() &&
      format()?.ownLanes &&
      !format()?.grid
    ) {
      // The pointer is held once the heading moves: a click or a double click stays the heading's own.
      laneDrag = { lane: band.id, startX: toScene(event).x, dx: 0, moving: false };
      return;
    }
    const id = cardAt(event.target);
    const at = toScene(event);
    const step = !id && event.button === 0 && isLive() ? inHeadings(at.x, at.y) : undefined;
    if (step?.kind === "step-head" && !offerAt(event.target)) {
      // As for a lane: the pointer is held once the number moves, so a click stays a click.
      stepDrag = { from: step.col, startX: at.x, dx: 0, moving: false };
      return;
    }
    if (!id || event.button !== 0) return;
    const start = toScene(event);
    const card = scene.cards.find((c) => c.id === id);
    if (!card) return;
    drag = {
      id,
      startX: start.x,
      startY: start.y,
      dx: start.x - card.x,
      dy: start.y - card.y,
      moving: false,
      target: { kind: "none" },
    };
    root.setPointerCapture(event.pointerId);
  });

  // A mouse or a pen says where it is before it presses: that is where a card can be offered.
  root.addEventListener("pointermove", (event) => {
    if (drag || laneDrag?.moving || stepDrag?.moving || !board || event.pointerType === "touch") return;
    if (offerAt(event.target)) return;
    const at = toScene(event);
    // The headings come down with the scroll: what they offer is where they are drawn.
    pointed = inHeadings(at.x, at.y) ?? locate(board, at.x, at.y, undefined, span);
    paintOffers();
  });
  root.addEventListener("pointerleave", () => {
    pointed = { kind: "none" };
    paintOffers();
  });

  root.addEventListener("pointermove", (event) => {
    if (!drag || !board) return;
    const at = toScene(event);
    const movable = isLive() && !state.linking && format()?.layout !== "graph";
    if (!drag.moving && movable && Math.hypot(at.x - drag.startX, at.y - drag.startY) > DRAG_THRESHOLD) {
      drag.moving = true;
      tools.hidden = true;
      paintOffers();
      nodes.get(drag.id)?.g.classList.add("is-dragging");
    }
    if (!drag.moving) return;
    const g = nodes.get(drag.id)?.g;
    if (g) g.style.transform = `translate(${at.x - drag.dx}px, ${at.y - drag.dy}px)`;
    drag.target = locate(board, at.x, at.y, drag.id, span);
    showHint(drag.target);
  });

  root.addEventListener("pointermove", (event) => {
    if (!laneDrag || !board) return;
    const x = toScene(event).x;
    if (!laneDrag.moving && Math.abs(x - laneDrag.startX) > DRAG_THRESHOLD) {
      laneDrag.moving = true;
      root.setPointerCapture(event.pointerId);
      pointed = { kind: "none" };
      paintOffers();
    }
    if (!laneDrag.moving) return;
    laneDrag.dx = x - laneDrag.startX;
    holdHeadings();
    laneDrag.drop = laneDrop(board, x, laneDrag.lane, span);
    const band = scene.bands.find((b) => b.kind === "lane" && b.id === laneDrag?.lane);
    if (!laneDrag.drop || !band) {
      hint.setAttribute("visibility", "hidden");
      return;
    }
    hint.classList.add("is-lane-drop");
    hint.setAttribute("x", String(laneDrag.drop.x - 3));
    hint.setAttribute("y", String(band.y));
    hint.setAttribute("width", "6");
    hint.setAttribute("height", String(band.h));
    hint.setAttribute("visibility", "visible");
  });

  root.addEventListener("pointermove", (event) => {
    if (!stepDrag || !board) return;
    const x = toScene(event).x;
    if (!stepDrag.moving && Math.abs(x - stepDrag.startX) > DRAG_THRESHOLD) {
      stepDrag.moving = true;
      root.setPointerCapture(event.pointerId);
      root.classList.add("is-grabbing");
      pointed = { kind: "none" };
      paintOffers();
    }
    if (!stepDrag.moving) return;
    stepDrag.dx = x - stepDrag.startX;
    holdHeadings();
    stepDrag.to = stepDrop(board, x, stepDrag.from);
    const to = stepDrag.to;
    const band = scene.bands.find((b) => b.kind === "step" && b.id === String(to));
    if (to === undefined || !band) {
      hint.setAttribute("visibility", "hidden");
      return;
    }
    // The bar stands on the side of the step it would take the place of, the side it comes from.
    const edge = to > stepDrag.from ? band.x + band.w : band.x;
    hint.classList.add("is-lane-drop");
    hint.setAttribute("x", String(edge - 3));
    hint.setAttribute("y", String(band.y));
    hint.setAttribute("width", "6");
    hint.setAttribute("height", String(band.h));
    hint.setAttribute("visibility", "visible");
  });

  root.addEventListener("pointerup", (event) => {
    const step = stepDrag;
    stepDrag = undefined;
    if (step) {
      root.classList.remove("is-grabbing");
      hint.setAttribute("visibility", "hidden");
      hint.classList.remove("is-lane-drop");
      if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
      if (!step.moving || !board) return;
      dropped = true;
      holdHeadings();
      if (step.to !== undefined)
        void send({ kind: "move-column", board: board.id, from: step.from, to: step.to });
      return;
    }
    const lane = laneDrag;
    laneDrag = undefined;
    if (lane) {
      hint.setAttribute("visibility", "hidden");
      hint.classList.remove("is-lane-drop");
      if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
      if (!lane.moving || !board) return;
      dropped = true;
      holdHeadings();
      if (lane.drop)
        void send({
          kind: "move-lane",
          board: board.id,
          lane: lane.lane,
          ...(lane.drop.before ? { before: lane.drop.before } : {}),
        });
      return;
    }
    const done = drag;
    drag = undefined;
    hint.setAttribute("visibility", "hidden");
    dropLine.setAttribute("visibility", "hidden");
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
    if (!done || !board) return;
    nodes.get(done.id)?.g.classList.remove("is-dragging");
    if (done.moving) {
      dropped = true;
      const element = board.elements.find((e) => e.id === done.id);
      const target = done.target;
      if (element && target.kind === "cell" && target.type === element.type) {
        // Into another step, or to another place in its own cell; where it already is, nothing is sent.
        const cell = board.elements.filter((e) => e.col === element.col && e.type === element.type);
        const next = cell[cell.indexOf(element) + 1]?.id;
        if (target.col !== element.col || target.before !== next)
          void send({
            kind: "move",
            board: board.id,
            id: done.id,
            col: target.col,
            ...(target.before ? { before: target.before } : {}),
          });
      } else if (element && target.kind === "cell" && target.col !== element.col) {
        void send({ kind: "move", board: board.id, id: done.id, col: target.col });
      } else if (element && target.kind === "slot") {
        void send({ kind: "move", board: board.id, id: done.id, lane: target.lane, before: target.before });
      }
      changed();
      return;
    }
    choose(done.id);
  });

  function choose(id: string): void {
    if (!board) return;
    if (state.linking && state.linking !== id) {
      void send({ kind: "link", board: board.id, src: state.linking, dst: id });
      state.linking = null;
      state.selected = id;
    } else {
      state.linking = null;
      state.selected = id;
    }
    changed();
  }

  /** A drop ends with a click on the board; that click is not a new choice. */
  let dropped = false;

  root.addEventListener("click", (event) => {
    const wasDrop = dropped;
    dropped = false;
    const target = under(event);
    // The ≡ a card wears with a detail leads to it; the rest of the card was handled as it was pressed.
    const marked = target?.closest(".card-detail, .card-detail-hit") ? cardAt(target) : undefined;
    if (!wasDrop && marked) hooks.showDetail(marked);
    // Its note count leads to its discussions.
    const counted = target?.closest(".card-notes") ? cardAt(target) : undefined;
    if (!wasDrop && counted) hooks.showNotes(counted);
    if (wasDrop || cardAt(target)) return;
    const offer = offerAt(target);
    if (offer) {
      const { column, type, lane } = offer.dataset;
      if (type === "lane") nameNewLane(offer);
      else if (type === "remove-lane" && lane) removeLane(lane);
      else if (type === "remove-column" && column !== undefined) removeStep(Number(column));
      else if (column === undefined) addHere(type ?? "");
      else if (board && isLive()) void send({ kind: "insert-column", board: board.id, at: Number(column) });
      return;
    }
    const conn = target?.closest<SVGGElement>("g.conn");
    const { src, dst } = conn?.dataset ?? {};
    const frame = host.getBoundingClientRect();
    pickedLink =
      src && dst && isLive()
        ? { src, dst, x: event.clientX - frame.left, y: event.clientY - frame.top }
        : undefined;
    state.selected = null;
    state.linking = null;
    changed();
    paintTools();
  });

  root.addEventListener("dblclick", (event) => {
    if (!board || !isLive() || offerAt(under(event))) return;
    const id = cardAt(under(event));
    if (id) {
      rename(id);
      return;
    }
    const heading = under(event)?.closest<SVGTextElement>("text.lane-label");
    if (heading) {
      renameLane(heading);
      return;
    }
    const hint = under(event)?.closest<SVGTextElement>("text.lane-hint, text.lane-hint-blank");
    if (hint?.dataset.lane) {
      hintLane(hint.dataset.lane);
      return;
    }
    const axis = under(event)?.closest<SVGTextElement>("text.axis-label, text.axis-bound");
    if (axis) {
      nameAxis(axis);
      return;
    }
    const conn = under(event)?.closest<SVGGElement>("g.conn");
    if (conn?.dataset.src && conn.dataset.dst) {
      nameLink(conn.dataset.src, conn.dataset.dst);
      return;
    }
    const f = format();
    const at = toScene(event);
    const target = locate(board, at.x, at.y, undefined, span);
    const snap = { x: event.clientX - 76 * zoom, y: event.clientY - 44 * zoom };
    if (target.kind === "cell") beginAdd(target.type, { col: target.col, ...snap });
    else if (target.kind === "slot" && f?.types[0]) beginAdd(f.types[0].id, { lane: target.lane, ...snap });
  });

  /** The keyboard is on a card: Tab comes back to that one. */
  root.addEventListener("focusin", (event) => {
    const id = cardAt(event.target);
    if (!id) return;
    chosen = true;
    if (id === current) return;
    nodes.get(current ?? "")?.g.setAttribute("tabindex", "-1");
    nodes.get(id)?.g.setAttribute("tabindex", "0");
    current = id;
  });

  function focusCard(id: string): void {
    const node = nodes.get(id);
    if (!node) return;
    nodes.get(current ?? "")?.g.setAttribute("tabindex", "-1");
    node.g.setAttribute("tabindex", "0");
    current = id;
    chosen = true;
    node.g.focus({ preventScroll: true });
    node.g.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  root.addEventListener("keydown", (event) => {
    const id = cardAt(event.target);
    if (!id || !board) return;
    const direction = ARROWS[event.key];
    // The arrows read, so they work on the past too; Shift and an arrow move, so only live.
    if (direction && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      const next = neighbour(scene.cards, id, direction);
      if (!next) return;
      focusCard(next);
      // A card chosen goes along with the keyboard: one card is marked, never two. A link being drawn waits for its end.
      if (state.selected && !state.linking) {
        state.selected = next;
        changed();
      }
      return;
    }
    if (!isLive()) return;
    if (direction && event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      // A flow places its cards from their links: the keys say so rather than doing nothing.
      if (format()?.layout === "graph") {
        hooks.notice(t.placedByLinks(id));
        return;
      }
      const command = keyMove(board, id, direction);
      if (command?.kind !== "move") return;
      // Where it goes, said once it got there: the eye sees the move, the ear hears it.
      const place =
        command.col !== undefined
          ? t.step(command.col)
          : scene.bands.find((band) => band.kind === "lane" && band.id === command.lane)?.label;
      void send(command).then((done) => {
        if (done === undefined) return;
        follow(id);
        if (place) hooks.announce(t.moved(id, place));
      });
      return;
    }
    if (direction && event.altKey && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      addBeside(id, direction);
      return;
    }
    // ⌘↵ or Ctrl+Enter is the page's: it sends to Claude, whatever holds the keyboard.
    const plainEnter = event.key === "Enter" && !event.metaKey && !event.ctrlKey;
    if (plainEnter || event.key === "F2") rename(id);
    else if (event.key === " ") choose(id);
    else if (event.key === "Delete" || event.key === "Backspace") {
      // The keyboard goes on to the next card, and the page offers to take this one back.
      const next = neighbour(scene.cards, id, "down") ?? neighbour(scene.cards, id, "up");
      const boardId = board.id;
      void send({ kind: "remove", board: boardId, id }).then((done) => {
        if (done === undefined) return;
        hooks.removed(t.cardRemoved(id));
        if (next) focusCard(next);
      });
    } else if (event.key.toLowerCase() === "d") {
      const element = board.elements.find((e) => e.id === id);
      markDone(id, !(element && isDone(board, element)));
    } else if (event.key.toLowerCase() === "l") beginLink(id);
    else if (event.key.toLowerCase() === "n") noteOn(id);
    else if (event.key.toLowerCase() === "e") hooks.editDetail(id);
    else return;
    event.preventDefault();
  });

  root.addEventListener("keydown", (event) => {
    const label = (event.target as Element | null)?.closest?.<SVGTextElement>("text.lane-label");
    const lane = label?.dataset.lane;
    if (!label || !lane || !board) return;
    const lanes = lanesOf(board);
    const at = lanes.indexOf(lane);
    const name = label.textContent ?? lane;
    const direction = ARROWS[event.key];
    const plain = !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey;
    const focusLane = (id: string | undefined) =>
      id &&
      heads
        .querySelector<SVGTextElement>(`text.lane-label[data-lane="${id}"]`)
        ?.focus({ preventScroll: true });
    if ((direction === "left" || direction === "right") && plain)
      focusLane(lanes[at + (direction === "right" ? 1 : -1)]);
    else if (direction === "down" && plain) {
      const first = board.elements.find((e) => e.lane === lane);
      if (first) focusCard(first.id);
    } else if (!isLive()) return;
    else if (direction && event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      const command = laneKeyMove(board, lane, direction);
      if (!command) return;
      laneArriving = lane;
      void send(command).then((done) => {
        if (done !== undefined)
          hooks.announce(t.laneMovedTo(name, at + (direction === "right" ? 2 : 0), lanes.length));
      });
    } else if ((direction === "left" || direction === "right") && event.altKey) {
      const box = label.getBoundingClientRect();
      const before = direction === "right" ? lanes[at + 1] : lane;
      nameLaneAt(new DOMRect(box.left - 6, box.bottom + 6, 180, 36), before);
    } else if (event.key === "+") {
      const box = label.getBoundingClientRect();
      nameLaneAt(new DOMRect(box.left - 6, box.bottom + 6, 180, 36), lanes[at + 1]);
    } else if (event.key === "Enter" && event.shiftKey) {
      laneArriving = lane;
      hintLane(lane);
    } else if ((event.key === "Enter" && !event.metaKey && !event.ctrlKey) || event.key === "F2") {
      laneArriving = lane;
      renameLane(label);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      if (board.elements.some((e) => e.lane === lane)) hooks.notice(t.laneNotEmpty(name));
      else if (lanes.length < 2) return;
      else {
        laneArriving = lanes[at + 1] ?? lanes[at - 1];
        removeLane(lane);
      }
    } else return;
    event.preventDefault();
    event.stopPropagation();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || editing) return;
    pickedLink = undefined;
    // The toolbar closes under the keyboard: it goes back to its card, not to the top of the page.
    if (tools.contains(document.activeElement) && current)
      nodes.get(current)?.g.focus({ preventScroll: true });
    tools.hidden = true;
    if (state.selected || state.linking) {
      state.selected = null;
      state.linking = null;
      changed();
    }
  });

  // A chosen card that moved, by the keyboard or by Claude, has its toolbar put back once it landed.
  cards.addEventListener("transitionend", (event) => {
    if (state.selected && cardAt(event.target as Element) === state.selected) paintTools();
  });

  scroll.addEventListener(
    "scroll",
    () => {
      paintTools();
      holdHeadings();
    },
    { passive: true },
  );

  function zoomTo(next: number): number {
    zoom = next;
    paint(board, unread, missed);
    return zoom;
  }

  return {
    paint,
    beginAdd,
    point(id) {
      for (const [cardId, node] of nodes) node.g.classList.toggle("is-pointed", cardId === id);
    },
    reveal(id) {
      nodes.get(id)?.g.scrollIntoView({ block: "nearest", inline: "nearest" });
    },
    focus: focusCard,
    zoomBy(step) {
      // From a fitted zoom, the next step that way.
      const next = step > 0 ? ZOOMS.find((z) => z > zoom + 0.001) : ZOOMS.findLast((z) => z < zoom - 0.001);
      return zoomTo(next ?? zoom);
    },
    fit() {
      if (zoom !== 1) return zoomTo(1);
      const w = Math.max(scene.width, 320);
      const hgt = Math.max(scene.height, 200);
      const room = Math.min((scroll.clientWidth - 16) / w, (scroll.clientHeight - 16) / hgt);
      // Never below the smallest step: under it, a card is a coloured dot, and the words are gone.
      return zoomTo(Math.max(ZOOMS[0] ?? 0.25, Math.min(1, Math.floor(room * 100) / 100)));
    },
  };
}
