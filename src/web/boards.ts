/**
 * The boards of the project, as the page offers them: the picker at the top,
 * the home page that shows them all (T90), first screen when there is none,
 * and the sheet that creates one. Its words live here, as messages.ts is at
 * its ceiling.
 */
import { slugify } from "../domain/commands.ts";
import { FORMATS, findFormat } from "../domain/formats.ts";
import type { Locale } from "../domain/i18n.ts";
import { isBoardId } from "../domain/ids.ts";
import { boardLink, HOME_LINK } from "../domain/links.ts";
import { type Board, findBoard, type Workspace } from "../domain/workspace.ts";
import { h, region } from "./dom.ts";
import { locale, t } from "./locale.ts";
import { isLive, openBoard, send, state } from "./store.ts";
import { discussions } from "./view.ts";

interface Words {
  all: string;
  boards: string;
  create: string;
  cards: (n: number) => string;
  notes: (n: number) => string;
  waits: string;
}

const WORDS: Record<Locale, Words> = {
  en: {
    all: "Every board",
    boards: "Boards",
    create: "Start another",
    cards: (n) => `${n} ${n === 1 ? "card" : "cards"}`,
    notes: (n) => `${n} open ${n === 1 ? "note" : "notes"}`,
    waits: "Claude waits for you here",
  },
  fr: {
    all: "Tous les tableaux",
    boards: "Tableaux",
    create: "En commencer un autre",
    cards: (n) => `${n} ${n === 1 ? "carte" : "cartes"}`,
    notes: (n) => `${n} ${n === 1 ? "note ouverte" : "notes ouvertes"}`,
    waits: "Claude t'attend ici",
  },
};
const words = WORDS[locale];

/** One board on the home page: what it is, how much is on it, and whether Claude waits there. */
export interface BoardTile {
  id: string;
  title: string;
  format: string;
  cards: number;
  notes: number;
  waits: boolean;
}

export interface HomeModel {
  boards: BoardTile[];
  live: boolean;
}

export function boardTiles(ws: Workspace, waitingOn: string | undefined): BoardTile[] {
  return ws.boards.map((b: Board) => ({
    id: b.id,
    title: b.title,
    format: b.format,
    cards: b.elements.length,
    notes: discussions(b).length,
    waits: b.id === waitingOn,
  }));
}

/** The name, top left: a way back to every board. */
export const brand = h("a", { class: "brand", href: HOME_LINK, title: words.all }, "Sideco");

export interface BoardPickerModel {
  boards: { id: string; title: string }[];
  current: string | undefined;
  live: boolean;
}

/** The board picker, top left. */
export const boardPicker = h("div", { class: "board-picker" });

/** Every board at a glance, and the workshops to start one: the first screen while there is none. */
export const home = h("div", { class: "home", hidden: true });

/** The sheets that create a board, and remove one. */
export const newBoardSheet = h("dialog", { class: "sheet new-board" });
export const removeSheet = h("dialog", { class: "sheet remove-board" });

export const paintBoardPicker = region(boardPicker, (m: BoardPickerModel) => {
  return [
    m.boards.length > 0 &&
      h(
        "select",
        {
          name: "board",
          "aria-label": t.boardShown,
          onchange: (event: Event) => {
            const id = (event.target as HTMLSelectElement).value;
            if (id) openBoard(id);
            else location.hash = HOME_LINK;
          },
        },
        h("option", { value: "", selected: m.current === undefined }, words.all),
        ...m.boards.map((b) => h("option", { value: b.id, selected: b.id === m.current }, b.title)),
      ),
    // No board yet: creating one is the only thing to do, so it stays in sight.
    m.boards.length === 0 &&
      h("button", { type: "button", class: "quiet", onclick: () => openNewBoard() }, t.newBoardButton),
  ];
});

export const paintHome = region(home, (m: HomeModel) => {
  const formats = h(
    "div",
    { class: "formats" },
    ...FORMATS.map((format) => formatCard(format.id, () => openNewBoard(format.id), !m.live)),
  );
  if (m.boards.length === 0) return [h("h1", {}, t.emptyTitle), h("p", {}, t.emptyHint), formats];
  return [
    h("h1", {}, words.boards),
    h("ul", { class: "board-tiles" }, ...m.boards.map((b) => h("li", {}, boardTile(b)))),
    h("h2", {}, words.create),
    formats,
  ];
});

function boardTile(b: BoardTile): HTMLElement {
  const format = findFormat(b.format);
  const counts = [words.cards(b.cards), ...(b.notes > 0 ? [words.notes(b.notes)] : [])].join(" · ");
  return h(
    "a",
    { class: "board-tile", href: isBoardId(b.id) ? boardLink(b.id) : undefined },
    swatches(b.format),
    h("span", { class: "board-title" }, b.title),
    h("span", { class: "board-format" }, format?.name[locale] ?? b.format),
    h("span", { class: "board-counts" }, counts),
    b.waits && h("span", { class: "board-waits" }, words.waits),
  );
}

/** A workshop's colours: what tells an event storming from a kanban at a glance (T54). */
function swatches(formatId: string): HTMLElement {
  return h(
    "span",
    { class: "format-swatches", "aria-hidden": "true" },
    ...(findFormat(formatId)?.types ?? []).map((type) => h("span", { style: `background:${type.fill}` })),
  );
}

function formatCard(id: string, onPick: () => void, disabled = false): HTMLElement {
  const format = findFormat(id);
  return h(
    "button",
    { type: "button", class: "format", disabled, onclick: onPick },
    h("span", { class: "format-name" }, format?.name[locale] ?? id),
    h("span", { class: "format-purpose" }, format?.purpose[locale] ?? ""),
    swatches(id),
  );
}

export function openNewBoard(formatId = "event-storming"): void {
  const title = h("input", {
    type: "text",
    name: "title",
    required: true,
    maxlength: 120,
    placeholder: t.titleExample,
    "aria-label": t.boardTitle,
  });
  const choices = FORMATS.map((format) =>
    h(
      "label",
      { class: "format choice" },
      h("input", { type: "radio", name: "format", value: format.id, checked: format.id === formatId }),
      h("span", { class: "format-name" }, format.name[locale]),
      h("span", { class: "format-purpose" }, format.purpose[locale]),
    ),
  );
  const create = async (event: Event): Promise<void> => {
    event.preventDefault();
    const format = new FormData(event.target as HTMLFormElement).get("format");
    const name = title.value.trim();
    if (!name || typeof format !== "string") return;
    const id = freeId(slugify(name));
    const done = await send({ kind: "create-board", board: id, title: name, format });
    if (!done) return;
    newBoardSheet.close();
    openBoard(id);
  };
  newBoardSheet.replaceChildren(
    h(
      "form",
      { onsubmit: (event: Event) => void create(event) },
      h("h2", {}, t.newBoard),
      h("label", { class: "field" }, t.title, title),
      h("fieldset", {}, h("legend", {}, t.workshop), ...choices),
      h(
        "div",
        { class: "actions" },
        h("button", { type: "button", class: "quiet", onclick: () => newBoardSheet.close() }, t.cancel),
        h("button", { type: "submit", class: "primary" }, t.create),
      ),
    ),
  );
  newBoardSheet.showModal();
  title.focus();
}

/**
 * Removing a board takes it from Claude too, so the page asks first, and the
 * answer that keeps the board has the focus. Once removed, `removed` offers to undo it.
 */
export function askToRemove(id: string, removed: (title: string) => void): void {
  const board = findBoard(state.live, id);
  if (!board || !isLive()) return;
  const keep = h("button", { type: "button", class: "quiet", onclick: () => removeSheet.close() }, t.cancel);
  const remove = async (): Promise<void> => {
    const done = await send({ kind: "remove-board", board: id });
    removeSheet.close();
    if (done) removed(board.title);
  };
  removeSheet.replaceChildren(
    h("h2", {}, t.removeBoardQuestion(board.title)),
    h("p", {}, t.removeBoardConsequence(board.elements.length)),
    h(
      "div",
      { class: "actions" },
      keep,
      h("button", { type: "button", class: "danger", onclick: () => void remove() }, t.remove),
    ),
  );
  removeSheet.showModal();
  keep.focus();
}

/** A board id not in use yet: the slug, or the slug with the first free number. */
function freeId(slug: string): string {
  if (!findBoard(state.live, slug)) return slug;
  for (let n = 2; ; n++) {
    const candidate = `${slug.slice(0, 36)}-${n}`;
    if (!findBoard(state.live, candidate)) return candidate;
  }
}
