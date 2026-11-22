/**
 * The boards of the project, as the page offers them: the picker at the top,
 * the first screen when there is none, and the sheet that creates one.
 */
import { slugify } from "../domain/commands.ts";
import { FORMATS, findFormat } from "../domain/formats.ts";
import { findBoard } from "../domain/workspace.ts";
import { h, region } from "./dom.ts";
import { locale, t } from "./locale.ts";
import { openBoard, send, state } from "./store.ts";

export interface BoardPickerModel {
  boards: { id: string; title: string }[];
  current: string | undefined;
  live: boolean;
}

/** The board picker, top left. */
export const boardPicker = h("div", { class: "board-picker" });

/** The first screen, while there is no board. */
export const empty = h("div", { class: "empty", hidden: true });

/** The sheet that creates a board. */
export const newBoardSheet = h("dialog", { class: "sheet new-board" });

export const paintBoardPicker = region(boardPicker, (m: BoardPickerModel) => {
  return [
    m.boards.length > 0 &&
      h(
        "select",
        {
          name: "board",
          "aria-label": t.boardShown,
          onchange: (event: Event) => openBoard((event.target as HTMLSelectElement).value),
        },
        ...m.boards.map((b) => h("option", { value: b.id, selected: b.id === m.current }, b.title)),
      ),
    // No board yet: creating one is the only thing to do, so it stays in sight.
    m.boards.length === 0 &&
      h("button", { type: "button", class: "quiet", onclick: () => openNewBoard() }, t.newBoardButton),
  ];
});

export const paintEmpty = region(empty, (m: { live: boolean }) => [
  h("h1", {}, t.emptyTitle),
  h("p", {}, t.emptyHint),
  h(
    "div",
    { class: "formats" },
    ...FORMATS.map((format) => formatCard(format.id, () => openNewBoard(format.id), !m.live)),
  ),
]);

function formatCard(id: string, onPick: () => void, disabled = false): HTMLElement {
  const format = findFormat(id);
  return h(
    "button",
    { type: "button", class: "format", disabled, onclick: onPick },
    h("span", { class: "format-name" }, format?.name[locale] ?? id),
    h("span", { class: "format-purpose" }, format?.purpose[locale] ?? ""),
    h(
      "span",
      { class: "format-swatches", "aria-hidden": "true" },
      ...(format?.types ?? []).map((t) => h("span", { style: `background:${t.fill}` })),
    ),
  );
}

export function openNewBoard(formatId = "event-storming"): void {
  const dialog = newBoardSheet;
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
    dialog.close();
    openBoard(id);
  };
  dialog.replaceChildren(
    h(
      "form",
      { onsubmit: (event: Event) => void create(event) },
      h("h2", {}, t.newBoard),
      h("label", { class: "field" }, t.title, title),
      h("fieldset", {}, h("legend", {}, t.workshop), ...choices),
      h(
        "div",
        { class: "actions" },
        h("button", { type: "button", class: "quiet", onclick: () => dialog.close() }, t.cancel),
        h("button", { type: "submit", class: "primary" }, t.create),
      ),
    ),
  );
  dialog.showModal();
  title.focus();
}

/** A board id not in use yet: the slug, or the slug with the first free number. */
function freeId(slug: string): string {
  if (!findBoard(state.live, slug)) return slug;
  for (let n = 2; ; n++) {
    const candidate = `${slug.slice(0, 36)}-${n}`;
    if (!findBoard(state.live, candidate)) return candidate;
  }
}
