/**
 * The board on screen: paints a scene as SVG and turns pointer and keyboard
 * gestures into commands. It never edits the board itself; a gesture sends a
 * command, and the board changes when the event comes back.
 */
import type { Command } from "../domain/commands.ts";
import { type Format, findFormat, findType } from "../domain/formats.ts";
import { layoutBoard, locate, type Scene, type Target } from "../domain/layout/index.ts";
import { arrowDefs, bandMarkup, cardMarkup, connectorMarkup } from "../domain/render/svg.ts";
import type { Board } from "../domain/workspace.ts";
import { h, svg } from "./dom.ts";
import { locale, t } from "./locale.ts";
import { changed, isLive, send, state } from "./store.ts";

const DRAG_THRESHOLD = 4;
const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5];

interface Editing {
  commit(value: string): void;
}

export interface BoardView {
  paint(board: Board | undefined): void;
  /** Opens the label editor for a new element of this type. */
  beginAdd(typeId: string, place?: { col?: number; lane?: string; x: number; y: number }): void;
  zoomBy(step: -1 | 1): number;
  /** Marks one card as the one being talked about, without selecting it; no id clears the mark. */
  point(id: string | undefined): void;
  /** Scrolls the board so that the card is in view. */
  reveal(id: string): void;
}

export function mountBoard(host: HTMLElement): BoardView {
  const root = svg("svg", { class: "vico-board" });
  root.innerHTML = arrowDefs();
  const bands = root.appendChild(svg("g", { class: "layer-bands" }));
  const hint = root.appendChild(svg("rect", { class: "drop-hint", rx: 8, visibility: "hidden" }));
  const conns = root.appendChild(svg("g", { class: "layer-conns" }));
  const cards = root.appendChild(svg("g", { class: "layer-cards" }));
  const scroll = h("div", { class: "canvas-scroll" });
  scroll.append(root);
  const tools = h("div", { class: "card-tools", hidden: true });
  const editor = h("textarea", { class: "card-editor", hidden: true, rows: 3, "aria-label": t.cardLabel });
  host.append(scroll, tools, editor);

  const nodes = new Map<string, { g: SVGGElement; signature: string }>();
  let board: Board | undefined;
  let scene: Scene = { width: 0, height: 0, bands: [], cards: [], connectors: [] };
  let zoom = 1;
  let editing: Editing | undefined;
  let paintedBoard: string | undefined;
  /** The link the human clicked, and where, so its toolbar opens under the pointer. */
  let pickedLink: { src: string; dst: string; x: number; y: number } | undefined;

  const format = (): Format | undefined => (board ? findFormat(board.format) : undefined);

  function paint(next: Board | undefined): void {
    board = next;
    if (!board) {
      root.setAttribute("visibility", "hidden");
      tools.hidden = true;
      return;
    }
    root.removeAttribute("visibility");
    scene = layoutBoard(board, locale);
    const w = Math.max(scene.width, 320);
    const hgt = Math.max(scene.height, 200);
    root.setAttribute("viewBox", `0 0 ${w} ${hgt}`);
    root.setAttribute("width", String(w * zoom));
    root.setAttribute("height", String(hgt * zoom));
    bands.innerHTML = scene.bands.map(bandMarkup).join("");
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
      const signature = JSON.stringify(look);
      let node = nodes.get(card.id);
      if (!node) {
        const g = svg("g", { class: "card", "data-id": card.id, tabindex: 0, role: "button" });
        if (switched) g.classList.add("no-motion");
        cards.append(g);
        node = { g, signature: "" };
        nodes.set(card.id, node);
      }
      if (node.signature !== signature) {
        node.g.innerHTML = cardMarkup(card);
        node.signature = signature;
      }
      // A card in the human's hand stays there, whatever arrives meanwhile.
      if (!(drag?.moving && drag.id === card.id)) node.g.style.transform = `translate(${x}px, ${y}px)`;
      node.g.classList.toggle("is-selected", state.selected === card.id);
      node.g.classList.toggle("is-link-source", state.linking === card.id);
      node.g.classList.toggle("is-fresh", state.fresh.has(`${board.id}/${card.id}`));
      node.g.classList.toggle("is-focus", focus?.has(card.id) ?? false);
      node.g.classList.toggle("is-dim", focus !== undefined && !focus.has(card.id));
    }
    for (const [id, node] of nodes) {
      if (alive.has(id)) continue;
      node.g.remove();
      nodes.delete(id);
    }
    if (switched)
      requestAnimationFrame(() => {
        for (const g of cards.querySelectorAll(".no-motion")) g.classList.remove("no-motion");
      });
    host.classList.toggle("is-linking", state.linking !== null);
    host.classList.toggle("is-past", !isLive());
    paintTools();
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
    tools.replaceChildren(
      h("button", { type: "button", onclick: () => rename(id) }, t.rename),
      h(
        "button",
        { type: "button", onclick: () => annotate(id) },
        element?.detail ? `${t.detail} ≡` : t.detail,
      ),
      h("button", { type: "button", onclick: () => beginLink(id) }, t.link),
      h("button", { type: "button", onclick: () => noteOn(id) }, t.noteForClaude),
      h(
        "button",
        { type: "button", class: "danger", onclick: () => void send({ kind: "remove", board: boardId, id }) },
        t.remove,
      ),
    );
    tools.hidden = false;
    const box = node.g.getBoundingClientRect();
    const frame = host.getBoundingClientRect();
    tools.style.left = `${Math.max(8, box.left - frame.left)}px`;
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

  function openEditor(
    box: DOMRect,
    value: string,
    placeholder: string,
    colours: { fill: string; ink: string },
    commit: (value: string) => void,
  ): void {
    const frame = host.getBoundingClientRect();
    editor.value = value;
    editor.placeholder = placeholder;
    editor.style.left = `${box.left - frame.left}px`;
    editor.style.top = `${box.top - frame.top}px`;
    editor.style.width = `${Math.max(box.width, 152)}px`;
    editor.style.height = `${Math.max(box.height, 72)}px`;
    editor.style.background = colours.fill;
    editor.style.color = colours.ink;
    editor.hidden = false;
    editing = { commit };
    tools.hidden = true;
    editor.focus();
    editor.select();
  }

  function closeEditor(save: boolean): void {
    const current = editing;
    if (!current) return;
    editing = undefined;
    editor.hidden = true;
    const value = editor.value.replace(/\s+/g, " ").trim();
    if (save && value !== "") current.commit(value);
    changed();
  }

  editor.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      closeEditor(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeEditor(false);
    }
    event.stopPropagation();
  });
  editor.addEventListener("blur", () => closeEditor(true));

  function colours(typeId: string | undefined): { fill: string; ink: string } {
    const f = format();
    const type = f && typeId ? findType(f, typeId) : undefined;
    return { fill: type?.fill ?? "#FFFFFF", ink: type?.ink ?? "#1F2328" };
  }

  function rename(id: string): void {
    const node = nodes.get(id);
    const element = board?.elements.find((e) => e.id === id);
    if (!board || !node || !element || !isLive()) return;
    const boardId = board.id;
    openEditor(node.g.getBoundingClientRect(), element.label, t.cardLabel, colours(element.type), (label) => {
      if (label !== element.label) void send({ kind: "rename", board: boardId, id, label });
    });
  }

  function annotate(id: string): void {
    const node = nodes.get(id);
    const element = board?.elements.find((e) => e.id === id);
    if (!board || !node || !element) return;
    const boardId = board.id;
    const box = node.g.getBoundingClientRect();
    const below = new DOMRect(box.left, box.bottom + 6, 260, 96);
    openEditor(
      below,
      element.detail ?? "",
      t.detailPlaceholder,
      { fill: "var(--surface)", ink: "var(--ink)" },
      (detail) => {
        void send({ kind: "annotate", board: boardId, id, detail });
      },
    );
  }

  function noteOn(id: string): void {
    const node = nodes.get(id);
    if (!board || !node) return;
    const boardId = board.id;
    const box = node.g.getBoundingClientRect();
    const below = new DOMRect(box.left, box.bottom + 6, 260, 96);
    openEditor(below, "", t.noteOnPlaceholder(id), { fill: "var(--surface)", ink: "var(--ink)" }, (text) => {
      void send({ kind: "note", board: boardId, text, target: id });
    });
  }

  function beginLink(id: string): void {
    state.linking = id;
    changed();
  }

  function beginAdd(typeId: string, place?: { col?: number; lane?: string; x: number; y: number }): void {
    const f = format();
    const type = f ? findType(f, typeId) : undefined;
    if (!board || !f || !type || !isLive()) return;
    const boardId = board.id;
    const frame = host.getBoundingClientRect();
    const box = place
      ? new DOMRect(place.x, place.y, 152 * zoom, 88 * zoom)
      : new DOMRect(frame.left + 16, frame.top + 16, 168, 88);
    const from = f.layout === "graph" ? (state.selected ?? undefined) : undefined;
    openEditor(box, "", t.newCard(type.label[locale], type.hint[locale]), type, (label) => {
      const command: Command = {
        kind: "add",
        board: boardId,
        type: type.id,
        label,
        col: place?.col,
        lane: place?.lane,
        from,
      };
      void send(command).then((minted) => {
        const id = minted?.[0];
        if (id) {
          state.selected = id;
          changed();
        }
      });
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
      return;
    }
    hint.setAttribute("x", String(band.x + 2));
    hint.setAttribute("y", String(band.y + 2));
    hint.setAttribute("width", String(band.w - 4));
    hint.setAttribute("height", String(band.h - 4));
    hint.setAttribute("visibility", "visible");
  }

  let drag:
    | { id: string; startX: number; startY: number; dx: number; dy: number; moving: boolean; target: Target }
    | undefined;

  root.addEventListener("pointerdown", (event) => {
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

  root.addEventListener("pointermove", (event) => {
    if (!drag || !board) return;
    const at = toScene(event);
    const movable = isLive() && !state.linking && format()?.layout !== "graph";
    if (!drag.moving && movable && Math.hypot(at.x - drag.startX, at.y - drag.startY) > DRAG_THRESHOLD) {
      drag.moving = true;
      tools.hidden = true;
      nodes.get(drag.id)?.g.classList.add("is-dragging");
    }
    if (!drag.moving) return;
    const g = nodes.get(drag.id)?.g;
    if (g) g.style.transform = `translate(${at.x - drag.dx}px, ${at.y - drag.dy}px)`;
    drag.target = locate(board, at.x, at.y, drag.id);
    showHint(drag.target);
  });

  root.addEventListener("pointerup", (event) => {
    const done = drag;
    drag = undefined;
    hint.setAttribute("visibility", "hidden");
    if (root.hasPointerCapture(event.pointerId)) root.releasePointerCapture(event.pointerId);
    if (!done || !board) return;
    nodes.get(done.id)?.g.classList.remove("is-dragging");
    if (done.moving) {
      dropped = true;
      const element = board.elements.find((e) => e.id === done.id);
      const target = done.target;
      if (element && target.kind === "cell" && target.col !== element.col) {
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
    if (!board || !isLive()) return;
    const id = cardAt(under(event));
    if (id) {
      rename(id);
      return;
    }
    const f = format();
    const at = toScene(event);
    const target = locate(board, at.x, at.y);
    const snap = { x: event.clientX - 76 * zoom, y: event.clientY - 44 * zoom };
    if (target.kind === "cell") beginAdd(target.type, { col: target.col, ...snap });
    else if (target.kind === "slot" && f?.types[0]) beginAdd(f.types[0].id, { lane: target.lane, ...snap });
  });

  root.addEventListener("keydown", (event) => {
    const id = cardAt(event.target);
    if (!id || !board || !isLive()) return;
    if (event.key === "Enter" || event.key === "F2") rename(id);
    else if (event.key === " ") choose(id);
    else if (event.key === "Delete" || event.key === "Backspace")
      void send({ kind: "remove", board: board.id, id });
    else if (event.key.toLowerCase() === "l") beginLink(id);
    else if (event.key.toLowerCase() === "n") noteOn(id);
    else return;
    event.preventDefault();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || editing) return;
    pickedLink = undefined;
    tools.hidden = true;
    if (state.selected || state.linking) {
      state.selected = null;
      state.linking = null;
      changed();
    }
  });

  scroll.addEventListener("scroll", () => paintTools(), { passive: true });

  return {
    paint,
    beginAdd,
    point(id) {
      for (const [cardId, node] of nodes) node.g.classList.toggle("is-pointed", cardId === id);
    },
    reveal(id) {
      nodes.get(id)?.g.scrollIntoView({ block: "nearest", inline: "nearest" });
    },
    zoomBy(step) {
      const index = Math.min(ZOOMS.length - 1, Math.max(0, ZOOMS.indexOf(zoom) + step));
      zoom = ZOOMS[index] ?? 1;
      paint(board);
      return zoom;
    },
  };
}
