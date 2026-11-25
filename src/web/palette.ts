/**
 * The palette beside the board: the workshop's name or the board's own axes, the
 * question it asks, its kinds of card to add, and the way to the keys. Moved out of
 * main.ts (tidy-first for S344) to make room.
 */
import { boardPurpose, findFormat } from "../domain/formats.ts";
import { boardSheetWords, openBoardSheet } from "./board-sheet.ts";
import { kindSwatch } from "./boards.ts";
import { type Child, h } from "./dom.ts";
import { locale, t } from "./locale.ts";

export interface PaletteModel {
  format: string | undefined;
  /** The question the board asks, where it asks its own. */
  purpose: string | undefined;
  /** A plan's axes, where the board names its own: the palette is called by them, not by the workshop. */
  axes: { x: string; y: string } | undefined;
  live: boolean;
  from: string | null;
  /** On a diagram, whether it is Snap: its cards stay where they are put (S344). Undefined off a diagram. */
  snap?: boolean;
}

/** What the palette does when used: add a card of a kind, open the keys; its question, double-clicked, opens the sheet that changes it. */
export interface PaletteActs {
  add(type: string): void;
  keys(): void;
  snap(on: boolean): void;
}

export function paletteContent(m: PaletteModel, acts: PaletteActs): Child[] {
  const format = m.format ? findFormat(m.format) : undefined;
  if (!format) return [];
  // How to add and move is in the keys sheet; only a flow says what is not on screen: the card the next one links to.
  const how = format.layout === "graph" && m.from ? t.howGraphFrom(m.from) : undefined;
  return [
    // A plan whose axes the board renamed is called by them: a SWOT is no longer an Impact / Effort.
    h("h2", {}, m.axes ? `${m.axes.y} / ${m.axes.x}` : format.name[locale]),
    h(
      "p",
      {
        class: "purpose",
        title: m.live ? boardSheetWords.tip : undefined,
        ondblclick: m.live ? () => openBoardSheet("purpose") : undefined,
      },
      boardPurpose(format, { purpose: m.purpose }, locale),
    ),
    h(
      "ul",
      { class: "types" },
      ...format.types.map((type) =>
        h(
          "li",
          {},
          h(
            "button",
            {
              type: "button",
              class: "type",
              disabled: !m.live,
              title: `${t.add(type.label[locale])} · ${type.hint[locale]}`,
              onclick: () => acts.add(type.id),
            },
            h("span", kindSwatch(format, type), type.prefix),
            h("span", { class: "type-text" }, h("span", { class: "type-label" }, type.label[locale])),
          ),
        ),
      ),
    ),
    how && h("p", { class: "how" }, how),
    m.snap !== undefined && snapSwitch(m.snap, m.live, acts),
    h(
      "button",
      {
        type: "button",
        class: "quiet keys-open",
        onclick: acts.keys,
      },
      t.withKey(t.shortcuts, "?"),
    ),
  ];
}

/** The switch of a diagram between Snap, its cards where they are put, and placed by its links. */
function snapSwitch(on: boolean, live: boolean, acts: PaletteActs): Child {
  return h(
    "button",
    {
      type: "button",
      class: "snap",
      "aria-pressed": String(on),
      disabled: !live,
      title: t.snap.tip,
      onclick: () => acts.snap(!on),
    },
    t.snap.name,
  );
}
