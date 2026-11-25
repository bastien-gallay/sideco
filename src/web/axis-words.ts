/**
 * The words of a plan's axes on the page (out of board-view.ts, T259): each a
 * key stop, and where the editor opens over one. board-view.ts opens the
 * editor and saves what is written.
 */
import type { Scene } from "../domain/layout/index.ts";
import { t } from "./locale.ts";

/**
 * Where the editor opens on a word of an axis: over the word it replaces,
 * starting where it starts. The axis across the bottom has its editor above
 * it, clear of the footer; the upright one has it beside it.
 */
export function axisEditorBox(box: DOMRect, axis: string, bound: string | undefined): DOMRect {
  const w = 220;
  const h = 36;
  if (axis === "y") return new DOMRect(box.right + 6, box.top + box.height / 2 - h / 2, w, h);
  const left =
    bound === "low" ? box.left - 6 : bound === "high" ? box.right + 6 - w : box.left + box.width / 2 - w / 2;
  return new DOMRect(left, box.top - h - 4, w, h);
}

/** The words of a plan's axes, each a key stop that Enter or F2 writes, as a double-click does. */
export function dressAxes(layer: SVGGElement, bands: Scene["bands"], live: boolean): void {
  for (const band of bands.filter((b) => b.kind === "axis")) {
    const group = layer.querySelector(`text.axis-label[data-axis="${CSS.escape(band.id)}"]`)?.parentElement;
    for (const word of group?.querySelectorAll<SVGTextElement>("text") ?? []) {
      const bound = word.dataset.bound as "low" | "high" | undefined;
      word.setAttribute("tabindex", live ? "0" : "-1");
      word.setAttribute("role", "button");
      word.setAttribute("aria-label", bound ? t.axisEndKey(bound, band[bound] ?? "") : t.axisKey(band.label));
      word.setAttribute("aria-description", t.axisKeys);
    }
  }
}
