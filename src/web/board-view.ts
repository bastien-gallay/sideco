/**
 * The board on screen: paints a scene as SVG and turns pointer and keyboard
 * gestures into commands. It never edits the board itself; a gesture sends a
 * command, and the board changes when the event comes back.
 */

import type { Command } from "../domain/commands.ts";
import { type Format, findFormat, findType, isDone, lanesOf } from "../domain/formats.ts";
import {
  laneDrop,
  layoutBoard,
  locate,
  type Scene,
  stepDrop,
  type Target,
  vacancy,
} from "../domain/layout/index.ts";
import { arrowDefs, bandMarkup } from "../domain/render/svg.ts";
import type { Board } from "../domain/workspace.ts";
import { axisEditorBox, dressAxes } from "./axis-words.ts";
import type { BoardHooks, BoardView } from "./board-api.ts";
import { type CardKey, cardKey, type LaneKey, laneKey } from "./board-keys.ts";
import * as links from "./board-links.ts";
import { dropCommand, keyCommand, snapCommand, whereTo } from "./card-drop.ts";
import { mountEditor } from "./card-editor.ts";
import { type CardNode, drawCard, dropNodes, keepKeyboard, newCardNode, sayCard } from "./card-node.ts";
import { readDetail } from "./card-read.ts";
import { cardButtons, keyboardAway, leadButton, type MoreMenu, noPlace, standBy } from "./card-tools.ts";
import { h, svg } from "./dom.ts";
import { showDrop } from "./drop-hint.ts";
import { type Held, headingsDrop, holdInView, liftHeadings } from "./headings.ts";
import { mountLaneFold, seen } from "./lane-fold.ts";
import { linkEnds } from "./link-ends.ts";
import { linkHandle } from "./link-handle.ts";
import { linkChosen, linkFrom } from "./link-hint.ts";
import { locale, t } from "./locale.ts";
import { arrange } from "./reading-order.ts";
import { changed, isLive, send, state } from "./store.ts";
import { addOffers, type Direction, keyAdd, laneKeyMove, neighbour, readingGroups } from "./view.ts";

const DRAG_THRESHOLD = 4;
/** The offers drawn in the headings: they come down with them when the board scrolls. */
const HEADING_OFFERS: ReadonlySet<string> = new Set(["lane", "remove-lane", "column", "remove-column"]);
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5];
/** How tall the head of a lane is: its name, or its name and what it stands for. Above the first card, both. */
/** A card's move on the board, as styles.css times it (`.card` transition), and a little more. */
const CARD_MOVE_MS = 300;
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
  const more: MoreMenu = { open: false };
  // Repainted only as the keyboard leaves the board or comes back: rebuilt on every focus, a button would vanish under its click.
  let away = false;
  document.addEventListener("focusin", () => {
    if (keyboardAway(host) === away) return;
    away = !away;
    paintTools();
  });
  const editor = mountEditor(host, {
    opened() {
      tools.hidden = true;
      paintOffers();
    },
    back: (id) => nodes.get(id)?.g.focus({ preventScroll: true }),
  });
  host.append(scroll, tools, editor.el);
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

  const nodes = new Map<string, CardNode>();
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
  /** Where the pointer is, as a place to add to; and what is drawn there, to repaint only on a change. */
  let pointed: Target = { kind: "none" };
  let offered = "";
  let paintedBoard: string | undefined;
  /** The axis word just written: the keyboard goes back to it once the axis is drawn again. */
  let axisArriving: { axis: string; bound: "low" | "high" | undefined } | undefined;
  /** The link the human clicked, and where, so its toolbar opens under the pointer. */
  let pickedLink: links.PickedLink | undefined;
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

  /** The markup of the bands last drawn. */
  let paintedBands = "";

  const format = (): Format | undefined => (board ? findFormat(board.format) : undefined);

  /** The board's own size, its rows, steps and lanes, and its links. */
  function paintFrame(on: Board): void {
    root.removeAttribute("visibility");
    root.setAttribute("aria-label", t.boardCards(on.title));
    scene = layoutBoard(on, locale, seen(on, span));
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
      dressAxes(bands, scene.bands, isLive());
      frozen = liftHeadings(heads, bands, scene, !!format()?.ownLanes && !format()?.grid);
    }
    backToAxis();
    holdHeadings();
    landOnLane();
    links.drawLinks(conns, scene);
  }

  /** The lane heading a key moved, named or added takes the keyboard back once drawn, unless the human has gone on elsewhere. */
  function landOnLane(): void {
    if (!laneArriving) return;
    const label = heads.querySelector<SVGTextElement>(`text.lane-label[data-lane="${laneArriving}"]`);
    const at = document.activeElement;
    if (!label || !(at === null || at === document.body || at === editor.el || !at.isConnected)) return;
    label.focus({ preventScroll: true });
    laneArriving = undefined;
  }

  /** How a card stands: where it is, and whether it is chosen, linking, fresh, pointed at. */
  function standCard(on: Board, g: SVGGElement, card: Scene["cards"][number], isNew: boolean): void {
    const focus = on.focus?.ids;
    g.setAttribute("aria-pressed", String(state.selected === card.id));
    // A card in the human's hand stays there, whatever arrives meanwhile.
    if (!(drag?.moving && drag.id === card.id)) g.style.transform = `translate(${card.x}px, ${card.y}px)`;
    g.classList.toggle("is-selected", state.selected === card.id);
    g.classList.toggle("is-link-source", state.linking === card.id);
    g.classList.toggle("is-fresh", state.fresh.has(`${on.id}/${card.id}`));
    g.classList.toggle("is-new", isNew);
    g.classList.toggle("is-focus", focus?.includes(card.id) ?? false);
    g.classList.toggle("is-dim", focus !== undefined && !focus.includes(card.id));
  }

  /** Draws each card of the scene, a new one in a node of its own; gives the cards that are there. */
  function paintCards(on: Board, switched: boolean): Set<string> {
    const alive = new Set<string>();
    for (const card of scene.cards) {
      alive.add(card.id);
      const marks = { isUnread: unread.includes(card.id), isNew: missed.includes(card.id) };
      let node = nodes.get(card.id);
      if (!node) {
        node = newCardNode(card.id);
        if (switched) node.g.classList.add("no-motion");
        cards.append(node.g);
        nodes.set(card.id, node);
      }
      drawCard(node, card, marks);
      sayCard(node.g, on, scene.bands, card, marks);
      standCard(on, node.g, card, marks.isNew);
    }
    return alive;
  }

  /** The cards that are gone leave the page; the words being written on one of them are handed back, not dropped. */
  function dropGone(alive: ReadonlySet<string>): string | undefined {
    editor.dropGone(alive);
    return dropNodes(nodes, alive);
  }

  /** The board is one Tab stop: the selected card, else the last one the keyboard was on, else the first one read. */
  function keepTabStop(alive: ReadonlySet<string>, first: string | undefined, switched: boolean): void {
    if (switched) chosen = false;
    if (state.selected && alive.has(state.selected)) {
      current = state.selected;
      chosen = true;
    }
    // A card nobody chose is never kept: the first one read may change as cards come and go.
    if (!chosen || !current || !alive.has(current)) {
      current = first;
      chosen = false;
    }
    for (const [id, node] of nodes) node.g.setAttribute("tabindex", id === current ? "0" : "-1");
  }

  /** The card just added takes the keyboard once drawn, unless the human has gone on elsewhere. */
  function landOnCard(alive: ReadonlySet<string>): void {
    if (!arriving || !alive.has(arriving)) return;
    const id = arriving;
    arriving = undefined;
    const at = document.activeElement;
    if (at === null || at === document.body || at === editor.el) focusCard(id);
  }

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
    paintFrame(board);
    const switched = paintedBoard !== board.id;
    paintedBoard = board.id;
    const alive = paintCards(board, switched);
    const held = dropGone(alive);
    const reading = readingGroups(board, scene, locale);
    arrange(cards, groups, (id) => nodes.get(id)?.g, reading, !switched);
    keepTabStop(alive, reading[0]?.ids[0], switched);
    landOnCard(alive);
    if (!switched) keepKeyboard(held, board, nodes.get(current ?? ""));
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

  /** What holding the headings in view reads: where the board is scrolled, and what is in the human's hand. */
  const held = (): Held => ({
    heads,
    scroll,
    zoom,
    scene,
    frozen,
    ownLanes: format()?.ownLanes === true,
    timeline: format()?.layout === "timeline",
    lane: laneDrag?.moving ? laneDrag : undefined,
    step: stepDrag?.moving ? stepDrag : undefined,
  });

  /** Keeps the names of rows, steps and lanes on screen while the board scrolls under them (headings.ts). */
  function holdHeadings(): void {
    holdInView(held());
    paintOffers();
  }

  /** How far the headings came down with the scroll: what is offered there comes down too. */
  const headsDrop = (): number => headingsDrop(held());

  /** What the pointer is on among the headings, as they are drawn after the scroll. */
  function inHeadings(x: number, y: number): Target | undefined {
    if (!board) return undefined;
    const target = locate(board, x, y - headsDrop(), undefined, seen(board, span));
    return target.kind === "lane-edge" || target.kind === "boundary" || target.kind === "step-head"
      ? target
      : undefined;
  }

  /** How much of the top and of the left the frozen names cover, in scene units. */
  let frozen = { top: 0, left: 0 };

  /** Draws a "+" for each kind of card that can be added where the pointer is. */
  function paintOffers(): void {
    const quiet =
      !board ||
      !isLive() ||
      editor.writing() ||
      drag?.moving === true ||
      laneDrag?.moving === true ||
      stepDrag?.moving === true;
    const offers = quiet || !board ? [] : addOffers(board, pointed, locale, seen(board, span));
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
    const room = board ? vacancy(board, pointed, seen(board, span)) : undefined;
    const matrix = root.getScreenCTM();
    if (!room || !matrix || pointed.kind === "none") return;
    const corner = new DOMPoint(room.x, room.y).matrixTransform(matrix);
    const place = { x: corner.x, y: corner.y };
    if (pointed.kind === "cell") beginAdd(typeId, { col: pointed.col, ...place });
    else if (pointed.kind === "slot") beginAdd(typeId, { lane: pointed.lane, ...place });
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

  /** The spotlight (S325), out while a card is carried, written on or linked. */
  const light = links.watchLight(root, conns, nodes, () => ({
    edges: board && !editor.writing() && !drag?.moving && !state.linking ? board.edges : [],
    picked: pickedLink,
    chosen: state.selected ?? undefined,
  }));

  mountLaneFold(root, () => board);

  /** The handle of the card chosen, that pulls a link to another card (S326). */
  const paintHandle = linkHandle(root, {
    chosen: () =>
      isLive() && !editor.writing() ? scene.cards.find((c) => c.id === state.selected) : undefined,
    toScene,
    linked: (src, dst) => board?.edges.some((e) => e.src === src && e.dst === dst) ?? false,
    pulled: async (src, dst, cut) =>
      !!board && saved(send({ kind: cut ? "unlink" : "link", board: board.id, src, dst })),
    say: hooks.announce,
  });

  /** The ends of the link picked, each pulled to another card (S350). */
  const paintEnds = linkEnds(root, {
    picked: () => (board && pickedLink && isLive() && !editor.writing() ? pickedLink : undefined),
    toScene,
    linked: (src, dst) => board?.edges.some((e) => e.src === src && e.dst === dst) ?? false,
    moved: async (link, end, to) => {
      // Saved, the link it was is no more: its bar and its ends are put away as the board is painted.
      if (!board) return false;
      return saved(send({ kind: "relink", board: board.id, src: link.src, dst: link.dst, end, to }));
    },
    say: hooks.announce,
  });

  function paintTools(): void {
    light();
    paintHandle();
    paintEnds();
    const id = state.selected;
    const node = id ? nodes.get(id) : undefined;
    const link = pickedLink;
    if (board && link && isLive() && !editor.writing() && links.stillLinked(board, link)) {
      const dropped = (): void => {
        pickedLink = undefined;
      };
      links.showLinkTools(tools, board.id, link, { name: () => nameLink(link.src, link.dst), dropped });
      return;
    }
    pickedLink = undefined;
    if (
      !board ||
      !id ||
      !node ||
      !isLive() ||
      state.linking ||
      editor.writing() ||
      noPlace(host, node.g, scroll)
    ) {
      tools.hidden = true;
      return;
    }
    const boardId = board.id;
    const element = board.elements.find((e) => e.id === id);
    const done = element !== undefined && isDone(board, element);
    const shown = { id, hasDetail: !!element?.detail, done, leads: leadsFrom(id, element?.type) };
    tools.replaceChildren(
      ...cardButtons(shown, more, host, {
        rename: () => rename(id),
        detail: () => hooks.editDetail(id),
        note: () => noteOn(id),
        link: () => beginLink(id),
        done: () => markDone(id, !done),
        remove: () => void send({ kind: "remove", board: boardId, id }),
      }),
    );
    tools.hidden = false;
    const others = [...nodes].flatMap(([other, { g }]) => (other === id ? [] : [g]));
    standBy(tools, node.g, others, host);
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
  function under({ clientX, clientY }: MouseEvent): Element | null {
    // An end of the link picked lies over its line: a double click there is the link's, not the dot's.
    return document.elementsFromPoint(clientX, clientY).find((el) => !el.closest(".link-ends")) ?? null;
  }

  const openEditor = editor.open.bind(editor);

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
      { name: placeholder, lines: false, blank: true, short: true },
    );
    axisArriving = { axis, bound };
  }

  function backToAxis(): void {
    const was = axisArriving;
    if (!was || editor.writing()) return;
    const at = document.activeElement;
    if (at !== null && at !== document.body && at !== editor.el && at.isConnected) {
      axisArriving = undefined;
      return;
    }
    const bound = was.bound ? `[data-bound="${was.bound}"]` : ":not([data-bound])";
    const word = bands.querySelector<SVGTextElement>(`text[data-axis="${CSS.escape(was.axis)}"]${bound}`);
    if (!word) return;
    word.focus({ preventScroll: true });
    axisArriving = undefined;
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
    const spot = links.nameSpot(conns, host.getBoundingClientRect(), { src, dst }, pickedLink);
    pickedLink = undefined;
    openEditor(
      spot,
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

  const beginLink = (id: string): void => linkFrom(id, nodes.get(id)?.g);

  /** The button that makes, from a card, one of the kind it leads to: a point of a retro, an action. */
  function leadsFrom(id: string, typeId: string | undefined): HTMLElement[] {
    const f = format();
    const next = f && typeId ? findType(f, typeId)?.leadsTo : undefined;
    if (!next) return [];
    return [leadButton(next.label[locale], () => makeFrom(id, next.type))];
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

  let drag:
    | { id: string; startX: number; startY: number; dx: number; dy: number; moving: boolean; target: Target }
    | undefined;

  const offerAt = (target: EventTarget | null): SVGGElement | null =>
    (target as Element | null)?.closest?.<SVGGElement>("g.add-here") ?? null;

  /** A lane taken by its heading: held once the heading moves, so a click or a double click stays the heading's own. */
  function grabLane(event: PointerEvent): boolean {
    const head = (event.target as Element | null)?.closest?.<SVGGElement>("g.head.band-lane");
    const band = head ? scene.bands[Number(head.dataset.band)] : undefined;
    const f = format();
    if (band?.kind !== "lane" || !isLive() || !f?.ownLanes || f.grid) return false;
    laneDrag = { lane: band.id, startX: toScene(event).x, dx: 0, moving: false };
    return true;
  }

  /** As for a lane: a step is held once its number moves, so a click stays a click. */
  function grabStep(event: PointerEvent): boolean {
    const at = toScene(event);
    const step = isLive() ? inHeadings(at.x, at.y) : undefined;
    if (step?.kind !== "step-head" || offerAt(event.target)) return false;
    stepDrag = { from: step.col, startX: at.x, dx: 0, moving: false };
    return true;
  }

  function grabCard(id: string, event: PointerEvent): void {
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
  }

  root.addEventListener("pointerdown", (event) => {
    const main = event.button === 0;
    if (main && grabLane(event)) return;
    const id = cardAt(event.target);
    if (!id && main && grabStep(event)) return;
    if (id && main) grabCard(id, event);
  });

  // A mouse or a pen says where it is before it presses: that is where a card can be offered.
  root.addEventListener("pointermove", (event) => {
    if (drag || laneDrag?.moving || stepDrag?.moving || !board || event.pointerType === "touch") return;
    if (offerAt(event.target)) return;
    const at = toScene(event);
    // The headings come down with the scroll: what they offer is where they are drawn.
    pointed = inHeadings(at.x, at.y) ?? locate(board, at.x, at.y, undefined, seen(board, span));
    paintOffers();
  });
  root.addEventListener("pointerleave", () => {
    pointed = { kind: "none" };
    paintOffers();
  });

  root.addEventListener("pointermove", (event) => {
    if (!drag || !board) return;
    const at = toScene(event);
    const movable = isLive() && !state.linking;
    if (!drag.moving && movable && Math.hypot(at.x - drag.startX, at.y - drag.startY) > DRAG_THRESHOLD) {
      drag.moving = true;
      tools.hidden = true;
      paintOffers();
      nodes.get(drag.id)?.g.classList.add("is-dragging");
    }
    if (!drag.moving) return;
    const g = nodes.get(drag.id)?.g;
    if (g) g.style.transform = `translate(${at.x - drag.dx}px, ${at.y - drag.dy}px)`;
    drag.target = locate(board, at.x, at.y, drag.id, seen(board, span));
    showDrop({ hint, line: dropLine }, scene, board, drag.target, drag.id);
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
    laneDrag.drop = laneDrop(board, x, laneDrag.lane, seen(board, span));
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

  /** Puts away the line a carry draws, and lets the pointer go. */
  function letGo(event: PointerEvent): void {
    hint.setAttribute("visibility", "hidden");
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
  }

  /** The heading of a step let go: its column goes where the line said. */
  function dropStep(step: NonNullable<typeof stepDrag>, event: PointerEvent): void {
    root.classList.remove("is-grabbing");
    hint.classList.remove("is-lane-drop");
    letGo(event);
    if (!step.moving || !board) return;
    dropped = true;
    holdHeadings();
    if (step.to !== undefined)
      void send({ kind: "move-column", board: board.id, from: step.from, to: step.to });
  }

  /** The heading of a lane let go: the lane goes before the one the line said. */
  function dropLane(lane: NonNullable<typeof laneDrag>, event: PointerEvent): void {
    hint.classList.remove("is-lane-drop");
    letGo(event);
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
  }

  /** A card let go: put where it was carried, or chosen when it did not move. */
  function dropCard(done: typeof drag, event: PointerEvent): void {
    dropLine.setAttribute("visibility", "hidden");
    letGo(event);
    if (!done || !board) return;
    nodes.get(done.id)?.g.classList.remove("is-dragging");
    if (!done.moving) {
      choose(done.id);
      return;
    }
    dropped = true;
    const at = toScene(event);
    const command = dropCommand(board, done.id, done.target, { x: at.x - done.dx, y: at.y - done.dy, span });
    if (command) void send(command);
    changed();
  }

  // One carry at a time: the heading of a step, else that of a lane, else a card.
  root.addEventListener("pointerup", (event) => {
    const [step, lane] = [stepDrag, laneDrag];
    stepDrag = undefined;
    if (step) return dropStep(step, event);
    laneDrag = undefined;
    if (lane) return dropLane(lane, event);
    const done = drag;
    drag = undefined;
    dropCard(done, event);
  });

  function choose(id: string): void {
    if (!board) return;
    pickedLink = undefined;
    if (state.linking && state.linking !== id) linkChosen(board, state.linking, id, hooks.announce);
    state.linking = null;
    state.selected = id;
    changed();
  }

  /** A drop ends with a click on the board; that click is not a new choice. */
  let dropped = false;

  /** A click on what the board offers: a lane, a column or a card to add, a lane or a column to remove. */
  function takeOffer(offer: SVGGElement): void {
    const { column, type, lane } = offer.dataset;
    if (type === "lane") nameNewLane(offer);
    else if (type === "remove-lane" && lane) removeLane(lane);
    else if (type === "remove-column" && column !== undefined) removeStep(Number(column));
    else if (column === undefined) addHere(type ?? "");
    else if (board && isLive()) void send({ kind: "insert-column", board: board.id, at: Number(column) });
  }

  /** The ≡ a card wears with a detail leads to it, its note count to its discussions; the rest of the card was handled as it was pressed. */
  function followMark(target: Element | null): void {
    const id = cardAt(target);
    if (!id) return;
    if (target?.closest(".card-detail, .card-detail-hit")) hooks.showDetail(id);
    if (target?.closest(".card-notes")) hooks.showNotes(id);
  }

  root.addEventListener("click", (event) => {
    const wasDrop = dropped;
    dropped = false;
    if (wasDrop) return;
    const target = under(event);
    followMark(target);
    if (cardAt(target)) return;
    const offer = offerAt(target);
    if (offer) {
      takeOffer(offer);
      return;
    }
    pickedLink = isLive() ? links.linkAt(target, event, host.getBoundingClientRect()) : undefined;
    state.selected = null;
    state.linking = null;
    changed();
    paintTools();
  });

  /** What a double click writes, by what it lands on: a name, a hint, a word of an axis, a link. False for none of them. */
  function writeUnder(target: Element | null): boolean {
    const heading = target?.closest<SVGTextElement>("text.lane-label");
    const hinted = target?.closest<SVGTextElement>("text.lane-hint, text.lane-hint-blank")?.dataset.lane;
    const axis = target?.closest<SVGTextElement>("text.axis-label, text.axis-bound");
    const conn = target?.closest<SVGGElement>("g.conn")?.dataset;
    if (heading) renameLane(heading);
    else if (hinted) hintLane(hinted);
    else if (axis) nameAxis(axis);
    else if (conn?.src && conn.dst) nameLink(conn.src, conn.dst);
    else return false;
    return true;
  }

  /** A double click on an empty place adds a card there, its editor under the pointer. */
  function addAt(on: Board, event: MouseEvent): void {
    const at = toScene(event);
    const target = locate(on, at.x, at.y, undefined, seen(on, span));
    const snap = { x: event.clientX - 76 * zoom, y: event.clientY - 44 * zoom };
    const first = format()?.types[0];
    if (target.kind === "cell") beginAdd(target.type, { col: target.col, ...snap });
    else if (target.kind === "slot" && first) beginAdd(first.id, { lane: target.lane, ...snap });
  }

  root.addEventListener("dblclick", (event) => {
    const target = under(event);
    if (!board || !isLive() || offerAt(target)) return;
    const id = cardAt(target);
    if (id) {
      rename(id);
      return;
    }
    if (!writeUnder(target)) addAt(board, event);
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

  function focusCard(id: string, centred = false): void {
    const node = nodes.get(id);
    if (!node) return;
    nodes.get(current ?? "")?.g.setAttribute("tabindex", "-1");
    node.g.setAttribute("tabindex", "0");
    current = id;
    chosen = true;
    node.g.focus({ preventScroll: true });
    const at = centred ? "center" : "nearest";
    node.g.scrollIntoView({ block: at, inline: at });
  }

  /** The keyboard goes to the next card that way; a card chosen goes along, one card marked, never two. */
  function goFrom(id: string, direction: Direction): void {
    const next = neighbour(scene.cards, id, direction);
    if (!next) return;
    focusCard(next);
    // A link being drawn waits for its end.
    if (state.selected && !state.linking) {
      state.selected = next;
      changed();
    }
  }

  /** Where it goes, said once it got there: the eye sees the move, the ear hears it. */
  function moveByKey(on: Board, id: string, direction: Direction): void {
    const command = keyCommand(on, scene, id, direction, span);
    if (command?.kind !== "move" && command?.kind !== "place") return;
    const place = whereTo(command, scene);
    void send(command).then((done) => {
      if (done === undefined) return;
      follow(id);
      if (place) hooks.announce(t.moved(id, place));
    });
  }

  /** The keyboard goes on to the next card, and the page offers to take this one back. */
  function removeByKey(on: Board, id: string): void {
    const next = neighbour(scene.cards, id, "down") ?? neighbour(scene.cards, id, "up");
    void send({ kind: "remove", board: on.id, id }).then((done) => {
      if (done === undefined) return;
      hooks.removed(t.cardRemoved(id));
      if (next) focusCard(next);
    });
  }

  function toggleDone(on: Board, id: string): void {
    const element = on.elements.find((e) => e.id === id);
    markDone(id, !(element && isDone(on, element)));
  }

  /** What each key of a card does: which key asks for it is said in board-keys.ts. */
  const onCard: {
    [K in CardKey["ask"]]: (on: Board, id: string, key: Extract<CardKey, { ask: K }>) => void;
  } = {
    go: (_, id, key) => goFrom(id, key.direction),
    move: (on, id, key) => moveByKey(on, id, key.direction),
    beside: (_, id, key) => addBeside(id, key.direction),
    rename: (_, id) => rename(id),
    choose: (_, id) => choose(id),
    remove: removeByKey,
    done: toggleDone,
    link: (_, id) => beginLink(id),
    note: (_, id) => noteOn(id),
    detail: (_, id) => hooks.editDetail(id),
    read: (_, id) => readDetail(id, hooks.showDetail, focusCard),
    label: (_, id) => hooks.editLabels(id),
  };

  root.addEventListener("keydown", (event) => {
    const id = cardAt(event.target);
    const key = id && board ? cardKey(event) : undefined;
    if (!id || !board || !key || !("reads" in key || isLive())) return;
    event.preventDefault();
    (onCard[key.ask] as (on: Board, id: string, key: CardKey) => void)(board, id, key);
  });

  // A word of an axis: Enter or F2 writes it, as a double-click does.
  root.addEventListener("keydown", (event) => {
    const word = (event.target as Element | null)?.closest?.<SVGTextElement>(
      "text.axis-label, text.axis-bound",
    );
    if (!word || (event.key !== "Enter" && event.key !== "F2")) return;
    if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    nameAxis(word);
  });

  /** The name of a lane the keyboard is on, among the lanes of its board. */
  interface OnLane {
    on: Board;
    label: SVGTextElement;
    lane: string;
    lanes: string[];
    at: number;
  }

  const focusLane = (id: string | undefined): void =>
    heads.querySelector<SVGTextElement>(`text.lane-label[data-lane="${id}"]`)?.focus({ preventScroll: true });

  /** Moves a lane by its keys, and says where it got; false where it cannot go that way. */
  function moveLaneByKey({ on, label, lane, lanes, at }: OnLane, direction: Direction): boolean {
    const command = laneKeyMove(on, lane, direction);
    if (!command) return false;
    const name = label.textContent ?? lane;
    laneArriving = lane;
    void send(command).then((done) => {
      if (done !== undefined)
        hooks.announce(t.laneMovedTo(name, at + (direction === "right" ? 2 : 0), lanes.length));
    });
    return true;
  }

  /** Removes a lane by its key: one that holds cards says why not, and the last one stays. */
  function removeLaneByKey({ on, label, lane, lanes, at }: OnLane): boolean {
    if (on.elements.some((e) => e.lane === lane)) {
      hooks.notice(t.laneNotEmpty(label.textContent ?? lane));
      return true;
    }
    if (lanes.length < 2) return false;
    laneArriving = lanes[at + 1] ?? lanes[at - 1];
    removeLane(lane);
    return true;
  }

  /** What each key of a lane's name does; false for a key that had nothing to do, left to the browser. */
  const onLane: { [K in LaneKey["ask"]]: (l: OnLane, key: Extract<LaneKey, { ask: K }>) => unknown } = {
    "to-lane": (l, key) => {
      const next = l.lanes[l.at + key.by];
      if (next) focusLane(next);
    },
    "to-cards": (l) => {
      const first = l.on.elements.find((e) => e.lane === l.lane);
      if (first) focusCard(first.id);
    },
    move: (l, key) => moveLaneByKey(l, key.direction),
    add: (l, key) => {
      const box = l.label.getBoundingClientRect();
      nameLaneAt(new DOMRect(box.left - 6, box.bottom + 6, 180, 36), key.after ? l.lanes[l.at + 1] : l.lane);
    },
    hint: (l) => {
      laneArriving = l.lane;
      hintLane(l.lane);
    },
    rename: (l) => {
      laneArriving = l.lane;
      renameLane(l.label);
    },
    remove: removeLaneByKey,
  };

  root.addEventListener("keydown", (event) => {
    const label = (event.target as Element | null)?.closest?.<SVGTextElement>("text.lane-label");
    const lane = label?.dataset.lane;
    if (!label || !lane || !board) return;
    const key = laneKey(event);
    if (!key || !("reads" in key || isLive())) return;
    const lanes = lanesOf(board);
    const l: OnLane = { on: board, label, lane, lanes, at: lanes.indexOf(lane) };
    if ((onLane[key.ask] as (l: OnLane, key: LaneKey) => unknown)(l, key) === false) return;
    event.preventDefault();
    event.stopPropagation();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || editor.writing()) return;
    pickedLink = undefined;
    // The toolbar and the panel of the card close under the keyboard: it goes back to the card, not to the top of the page.
    if (document.activeElement?.closest(".card-tools, .card-panel") && current)
      nodes.get(current)?.g.focus({ preventScroll: true });
    // Repainted, the toolbar closes and the spotlight goes out.
    state.selected = null;
    state.linking = null;
    changed();
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
    snap(on) {
      if (board) void send(snapCommand(board, on, span));
    },
    renamed(from, to) {
      if (current === from) current = to;
      editor.renumbered(from, to);
      if (document.activeElement === nodes.get(from)?.g) arriving = to;
    },
    letGo() {
      if (dropped) dropped = false;
      else if (state.selected || state.linking) {
        pickedLink = undefined;
        state.selected = null;
        state.linking = null;
        changed();
        paintTools();
      }
    },
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
