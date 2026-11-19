/**
 * The board on screen: paints a scene as SVG and turns pointer and keyboard
 * gestures into commands. It never edits the board itself; a gesture sends a
 * command, and the board changes when the event comes back.
 */
import type { Command } from "../domain/commands.ts";
import { type Format, findFormat, findType, isDone, lanesOf } from "../domain/formats.ts";
import { laneDrop, layoutBoard, locate, type Scene, type Target, vacancy } from "../domain/layout/index.ts";
import { cardName } from "../domain/layout/scene.ts";
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
  neighbour,
  oneLine,
  type ReadingGroup,
  readingGroups,
} from "./view.ts";

const DRAG_THRESHOLD = 4;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5];
/** How tall the head of a lane is: its name, or its name and what it stands for. Above the first card, both. */
const LANE_HEAD = 38;
const LANE_HEAD_HINTED = 44;
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
}

/** How an editor opens: what it is called, and whether its words are several lines read before they are changed. */
interface EditorKind {
  name: string;
  lines: boolean;
  from?: string;
}

export interface BoardHooks {
  /** A card or a lane left the board by a gesture: the page says so, and offers to take it back. */
  removed(said: string): void;
  /** Something a screen reader should hear, that the eye sees on the board: a card moved by a key. */
  announce(text: string): void;
}

/**
 * The mark of a card that carries a change Claude has not read: a dot on the
 * corner the note count leaves free, with its words for a pointer resting on it.
 */
const UNREAD_MARK = `<g class="card-unread"><title>${esc(t.unread)}</title><circle cx="2" cy="2" r="5"/></g>`;

export interface BoardView {
  /** `unread` lists the cards that carry a change Claude has not read. */
  paint(board: Board | undefined, unread: readonly string[]): void;
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
  const editor = h("textarea", {
    class: "card-editor",
    name: "card-editor",
    hidden: true,
    rows: 3,
    "aria-label": t.cardLabel,
  });
  host.append(scroll, tools, editor);
  // A window resized shares its new width out over the lanes.
  new ResizeObserver(() => {
    const width = Math.floor(scroll.clientWidth - 16);
    if (width <= 0 || width === span) return;
    span = width;
    if (board) changed();
  }).observe(scroll);

  const nodes = new Map<string, { g: SVGGElement; signature: string }>();
  let board: Board | undefined;
  let unread: readonly string[] = [];
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

  function paint(next: Board | undefined, notRead: readonly string[]): void {
    board = next;
    unread = notRead;
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
      const signature = JSON.stringify({ ...look, isUnread });
      let node = nodes.get(card.id);
      if (!node) {
        const g = svg("g", { class: "card", "data-id": card.id, tabindex: -1, role: "button" });
        if (switched) g.classList.add("no-motion");
        cards.append(g);
        node = { g, signature: "" };
        nodes.set(card.id, node);
      }
      if (node.signature !== signature) {
        node.g.innerHTML = ringMarkup(card) + cardMarkup(card) + (isUnread ? UNREAD_MARK : "");
        node.signature = signature;
      }
      // A screen reader hears a card as one name: its words, where it is, then the mark's. Its detail stays in the tooltip.
      const place = cardPlace(board, scene.bands, card.id, locale);
      const name = [cardName(card), place, isUnread ? t.unread : undefined].filter(Boolean).join(" · ");
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
    heads.querySelector(".heads-steps")?.setAttribute("transform", `translate(0 ${sy})`);
    heads.querySelector(".heads-rows")?.setAttribute("transform", `translate(${sx} 0)`);
    for (const head of heads.querySelectorAll<SVGGElement>("g.head")) {
      const band = scene.bands[Number(head.dataset.band)];
      if (band?.kind !== "lane") continue;
      // A lane's heading goes down to its last card at most: it never leaves its own lane.
      // The heading in the human's hand stays there, whatever is painted meanwhile.
      const held = laneDrag?.moving === true && laneDrag.lane === band.id;
      head.classList.toggle("is-dragging", held);
      head.setAttribute("transform", `translate(${held ? laneDrag?.dx : 0} ${headDrop(band)})`);
    }
    paintOffers();
    // A card the keyboard or a search brings into view lands clear of the frozen names, never under them.
    scroll.style.scrollPaddingTop = `${frozen.top * zoom + 8}px`;
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
    if (Number.isFinite(left))
      rows.append(svg("rect", { class: "heads-strip", width: left, height: scene.height }));
    let laneTop = 0;
    bands.querySelectorAll(":scope > g.band").forEach((group, index) => {
      const band = scene.bands[index];
      const kind = band?.kind;
      if (kind === "step") steps.append(...group.querySelectorAll("text"));
      else if (kind === "row") rows.append(...group.querySelectorAll("rect, text"));
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
        heads.append(head);
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
      !board || !isLive() || editing !== undefined || drag?.moving === true || laneDrag?.moving === true;
    const offers = quiet || !board ? [] : addOffers(board, pointed, locale, span);
    const drop = lanesDrop();
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
          transform: `translate(${offer.x} ${offer.y + (offer.type === "lane" || offer.type === "remove-lane" ? drop : 0)})`,
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
        h("button", { type: "button", class: "danger", onclick: remove }, t.removeLink),
      );
      tools.hidden = false;
      tools.style.left = `${Math.max(8, link.x)}px`;
      tools.style.top = `${Math.max(8, link.y + 12)}px`;
      return;
    }
    pickedLink = undefined;
    if (!board || !id || !node || !isLive() || state.linking || editing) {
      tools.hidden = true;
      return;
    }
    const boardId = board.id;
    const element = board.elements.find((e) => e.id === id);
    // Each action says its key too: the shortcuts are learnt where they are used.
    const keyed = (label: string, key: string): { title: string } => ({ title: t.withKey(label, key) });
    const done = element !== undefined && isDone(board, element);
    const doneLabel = done ? t.notDone : t.done;
    tools.replaceChildren(
      h("button", { type: "button", ...keyed(t.rename, "Enter"), onclick: () => rename(id) }, t.rename),
      h(
        "button",
        { type: "button", onclick: () => annotate(id) },
        element?.detail ? `${t.detail} ≡` : t.detail,
      ),
      h("button", { type: "button", ...keyed(t.link, "L"), onclick: () => beginLink(id) }, t.link),
      h(
        "button",
        {
          type: "button",
          ...keyed(doneLabel, "D"),
          onclick: () => markDone(id, !done),
        },
        doneLabel,
      ),
      h(
        "button",
        { type: "button", ...keyed(t.noteForClaude, "N"), onclick: () => noteOn(id) },
        t.noteForClaude,
      ),
      h(
        "button",
        {
          type: "button",
          class: "danger",
          ...keyed(t.remove, "Delete"),
          onclick: () => void send({ kind: "remove", board: boardId, id }),
        },
        t.remove,
      ),
    );
    tools.hidden = false;
    const box = node.g.getBoundingClientRect();
    const frame = host.getBoundingClientRect();
    // Above the card, and inside the window: a toolbar cut by the edge hides the action at its end.
    const widest = Math.max(8, frame.width - tools.offsetWidth - 8);
    tools.style.left = `${Math.min(widest, Math.max(8, box.left - frame.left))}px`;
    tools.style.top = `${Math.max(8, box.top - frame.top - tools.offsetHeight - 8)}px`;
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
   * at once: they come selected, and Enter saves them. A detail or a note is
   * read before it is changed: it opens with the caret at its end, left-aligned,
   * Enter breaks the line and ⌘ or Ctrl with Enter saves.
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
    editor.style.height = `${Math.max(box.height, 72)}px`;
    editor.style.background = colours.fill;
    editor.style.color = colours.ink;
    editor.hidden = false;
    editing = { initial: tidy(value), commit, tidy, lines: kind.lines, from: kind.from, saving: false };
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
    const pending = save && value !== "" && value !== was.initial ? was.commit(value) : undefined;
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

  /** Opens the editor on the edge where the "+" was: what is typed names the lane added there. */
  function nameNewLane(offer: SVGGElement): void {
    if (!board || !isLive()) return;
    const boardId = board.id;
    const before = offer.dataset.before;
    const box = offer.getBoundingClientRect();
    openEditor(
      new DOMRect(box.left + box.width / 2 - 90, box.top - 7, 180, 36),
      "",
      t.laneName,
      { fill: "var(--surface)", ink: "var(--ink)" },
      (label) => saved(send({ kind: "add-lane", board: boardId, label, ...(before ? { before } : {}) })),
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

  function annotate(id: string): void {
    const node = nodes.get(id);
    const element = board?.elements.find((e) => e.id === id);
    if (!board || !node || !element) return;
    const boardId = board.id;
    const box = node.g.getBoundingClientRect();
    const below = new DOMRect(box.left, box.bottom + 6, 300, 120);
    openEditor(
      below,
      element.detail ?? "",
      t.detailPlaceholder,
      { fill: "var(--surface)", ink: "var(--ink)" },
      (detail) => {
        return saved(send({ kind: "annotate", board: boardId, id, detail }));
      },
      { name: t.detailOf(id), lines: true, from: id },
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
        return saved(send({ kind: "note", board: boardId, text, target: id }));
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
      format()?.ownLanes && to !== was
        ? scene.bands.find((band) => band.kind === "lane" && band.id === to)?.label
        : undefined;
    void send({ kind: "mark", board: board.id, id, done }).then((answer) => {
      if (answer !== undefined && place) hooks.announce(t.moved(id, place));
    });
  }

  function beginLink(id: string): void {
    state.linking = id;
    changed();
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
    if (drag || laneDrag?.moving || !board || event.pointerType === "touch" || offerAt(event.target)) return;
    const at = toScene(event);
    // The headings of a kanban come down with the scroll: their edges are where they are drawn.
    const edge = locate(board, at.x, at.y - lanesDrop(), undefined, span);
    pointed = edge.kind === "lane-edge" ? edge : locate(board, at.x, at.y, undefined, span);
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

  root.addEventListener("pointerup", (event) => {
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
      if (next) focusCard(next);
      return;
    }
    if (!isLive()) return;
    if (direction && event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      const command = keyMove(board, id, direction);
      if (command?.kind !== "move") return;
      // Where it goes, said once it got there: the eye sees the move, the ear hears it.
      const place =
        command.col !== undefined
          ? t.step(command.col)
          : scene.bands.find((band) => band.kind === "lane" && band.id === command.lane)?.label;
      void send(command).then((done) => {
        if (done === undefined) return;
        nodes.get(id)?.g.scrollIntoView({ block: "nearest", inline: "nearest" });
        if (place) hooks.announce(t.moved(id, place));
      });
      return;
    }
    if (direction && event.altKey && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      addBeside(id, direction);
      return;
    }
    if (event.key === "Enter" || event.key === "F2") rename(id);
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
    else return;
    event.preventDefault();
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
    paint(board, unread);
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
