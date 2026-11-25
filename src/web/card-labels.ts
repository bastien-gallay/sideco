/**
 * The labels of the card chosen, in its Detail tab: its chips, each with × to
 * take it off, and, live, the field that adds some, offering the labels the
 * project already uses. Out of main.ts (tidy-first for S310).
 */
import { sameLabel } from "../domain/labels.ts";
import { chipText, labelColours } from "../domain/render/labels.ts";
import { h } from "./dom.ts";
import { filteredBy, filterName, toggleLabelFilter } from "./label-filter.ts";
import { t } from "./locale.ts";
import { currentBoard, isLive, send, state } from "./store.ts";

/** What the panel says of the card's labels. */
export interface LabelsModel {
  id: string;
  live: boolean;
  /** Its labels, as kept, and those the project already uses, offered as it is typed. */
  labels: string[];
  known: string[];
}

/** How the page speaks to a screen reader: set by the panel each time it paints. */
let speak: (words: string) => void = () => {};

/** What the page does when the keyboard leaves the field by Escape: set by main.ts, which knows the board. */
let left: () => void = () => {};
export function onLabelsLeft(then: () => void): void {
  left = then;
}

/** Made once, like the detail's field: what is being typed keeps its place and the keyboard through every repaint. */
const labelField = h("input", {
  type: "text",
  name: "label",
  class: "label-field",
  list: "known-labels",
  autocomplete: "off",
  placeholder: t.addLabel,
  "aria-label": t.addLabel,
});
const knownLabels = h("datalist", { id: "known-labels" });
labelField.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    // Emptied first; empty already, the keyboard leaves the field for the card.
    if (labelField.value === "") left();
    labelField.value = "";
    return;
  }
  if (event.key !== "Enter") return;
  event.preventDefault();
  // Several at once, by commas: "type:bug, @bastien".
  const labels = labelField.value
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
  const board = currentBoard();
  const id = state.selected;
  if (!board || !id || labels.length === 0 || !isLive()) return;
  void send({ kind: "label", board: board.id, id, labels }).then((done) => {
    if (done === undefined) return;
    labelField.value = "";
    speak(t.labelsAdded(labels.map(chipText).join(", ")));
  });
});

/** A label taken off by its ×: once it is gone, the keyboard goes to the next ×, else the one before, else the field. */
let unlabelled: { id: string; label: string; at: number } | undefined;

export function refocusLabels(panel: HTMLElement, id: string, labels: readonly string[]): void {
  const was = unlabelled;
  if (!was || was.id !== id || labels.some((label) => sameLabel(label, was.label))) return;
  unlabelled = undefined;
  const buttons = [...panel.querySelectorAll<HTMLButtonElement>(".label-remove")];
  (buttons[Math.min(was.at, buttons.length - 1)] ?? labelField).focus();
}

/** Every label the project's cards wear, once each whatever its case, in the order first met. */
export function projectLabels(): string[] {
  const seen = new Map<string, string>();
  for (const board of state.live.boards)
    for (const e of board.elements) for (const label of e.labels ?? []) seen.set(label.toLowerCase(), label);
  return [...seen.values()];
}

/** The labels of the chosen card: its chips, then, live, the field that adds one, offering the project's others. */
export function labelSection(m: LabelsModel, speaker: (words: string) => void): HTMLElement | false {
  speak = speaker;
  if (m.labels.length === 0 && !m.live) return false;
  knownLabels.replaceChildren(
    ...m.known
      .filter((k) => !m.labels.some((own) => sameLabel(own, k)))
      .map((k) => h("option", { value: k })),
  );
  return h(
    "section",
    { class: "card-panel-labels", "aria-label": t.labelsHeading },
    m.labels.length > 0 && labelChips(m),
    m.live && labelField,
    m.live && knownLabels,
  );
}

/** The chosen card's labels: a chip each, its colour as on the card, and × to take it off. */
function labelChips(m: LabelsModel): HTMLElement {
  const board = currentBoard();
  return h(
    "ul",
    { class: "label-chips" },
    ...m.labels.map((label, at) => {
      const { fill, ink } = labelColours(label);
      return h(
        "li",
        { class: "label-chip", style: `background:${fill};color:${ink}` },
        h(
          "button",
          {
            type: "button",
            class: "label-filter-by",
            "data-label": label,
            "aria-label": filterName(label),
            "aria-pressed": String(filteredBy(label)),
            title: filterName(label),
            onclick: () => toggleLabelFilter(label),
          },
          chipText(label),
        ),
        m.live &&
          board &&
          h(
            "button",
            {
              type: "button",
              class: "label-remove",
              "aria-label": t.removeLabel(chipText(label)),
              title: t.removeLabel(chipText(label)),
              onclick: () => {
                unlabelled = { id: m.id, label, at };
                void send({ kind: "unlabel", board: board.id, id: m.id, labels: [label] }).then((done) => {
                  if (done !== undefined) speak(t.labelRemoved(chipText(label)));
                });
              },
            },
            "×",
          ),
      );
    }),
  );
}

/** The field holds the keyboard: it keeps it through the repaint. */
export const typingLabel = (): boolean => document.activeElement === labelField;

export function refocusLabelField(): void {
  if (document.activeElement !== labelField && labelField.isConnected) labelField.focus();
}
