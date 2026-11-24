/**
 * The palette beside the board: the workshop's name or the board's own axes, the
 * question it asks, its kinds of card to add, and the way to the keys. Moved out of
 * main.ts (tidy-first for S344) to make room.
 */
import { boardPurpose, findFormat } from "../domain/formats.ts";
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
}

/** What the palette does when used: add a card of a kind, open the keys. */
export interface PaletteActs {
  add(type: string): void;
  keys(): void;
}

export function paletteContent(m: PaletteModel, acts: PaletteActs): Child[] {
  const format = m.format ? findFormat(m.format) : undefined;
  if (!format) return [];
  // How to add and move is in the keys sheet; only a flow says what is not on screen: the card the next one links to.
  const how = format.layout === "graph" && m.from ? t.howGraphFrom(m.from) : undefined;
  return [
    // A plan whose axes the board renamed is called by them: a SWOT is no longer an Impact / Effort.
    h("h2", {}, m.axes ? `${m.axes.y} / ${m.axes.x}` : format.name[locale]),
    h("p", { class: "purpose" }, boardPurpose(format, { purpose: m.purpose }, locale)),
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
