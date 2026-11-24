/**
 * Where a card carried by the pointer would land: its step or lane outlined,
 * and a line between the two cards it would go between, or under the last.
 */
import type { Scene, Target } from "../domain/layout/index.ts";
import type { Board } from "../domain/workspace.ts";

export function showDrop(
  marks: { hint: SVGRectElement; line: SVGRectElement },
  scene: Scene,
  board: Board,
  target: Target,
  moving: string | undefined,
): void {
  const { hint } = marks;
  const band =
    target.kind === "cell"
      ? scene.bands.find((b) => b.kind === "step" && b.id === String(target.col))
      : target.kind === "slot"
        ? scene.bands.find((b) => b.kind === "lane" && b.id === target.lane)
        : undefined;
  if (!band) {
    hint.setAttribute("visibility", "hidden");
    marks.line.setAttribute("visibility", "hidden");
    return;
  }
  hint.setAttribute("x", String(band.x + 2));
  hint.setAttribute("y", String(band.y + 2));
  hint.setAttribute("width", String(band.w - 4));
  hint.setAttribute("height", String(band.h - 4));
  hint.setAttribute("visibility", "visible");
  showDropLine(marks.line, scene, board, target, moving);
}

/** Where in its cell or lane the card would land: a line between two cards, or under the last. */
function showDropLine(
  dropLine: SVGRectElement,
  scene: Scene,
  board: Board,
  target: Target,
  moving: string | undefined,
): void {
  const peers =
    target.kind === "cell" || target.kind === "slot"
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
