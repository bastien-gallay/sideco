/**
 * The cards in the order they are read (out of board-view.ts, T259): each in
 * the group of its lane or step, which a screen reader enters by its name.
 * The eye sees no change: a card moved to another group still glides from
 * where it was, and the keyboard stays on the card it was on.
 */
import { svg } from "./dom.ts";
import type { ReadingGroup } from "./view.ts";

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const same = (parent: Element, children: readonly Element[]): boolean =>
  parent.children.length === children.length && children.every((child, i) => parent.children[i] === child);

/** The group of a name, made the first time it is read. */
function groupOf(groups: Map<string, SVGGElement>, label: string): SVGGElement {
  const known = groups.get(label);
  if (known) return known;
  const g = svg("g", { class: "card-group", role: "group", "aria-label": label });
  groups.set(label, g);
  return g;
}

/** What the layer of the cards should hold, in order, and the cards each group should hold. */
function wantedOrder(
  groups: Map<string, SVGGElement>,
  cardOf: (id: string) => SVGGElement | undefined,
  reading: readonly ReadingGroup[],
): { wanted: SVGGElement[]; inside: Map<SVGGElement, SVGGElement[]> } {
  const wanted: SVGGElement[] = [];
  const inside = new Map<SVGGElement, SVGGElement[]>();
  for (const group of reading) {
    const members = group.ids.flatMap((id) => cardOf(id) ?? []);
    if (group.label === undefined) {
      wanted.push(...members);
      continue;
    }
    const g = groupOf(groups, group.label);
    inside.set(g, members);
    wanted.push(g);
  }
  return { wanted, inside };
}

/** Where each card is on screen now, mid-glide included, before it changes parent. */
function placesNow(moving: readonly [SVGGElement, SVGGElement[]][]): Map<SVGGElement, string> {
  const from = new Map<SVGGElement, string>();
  for (const [, members] of moving)
    for (const g of members) if (g.parentElement !== null) from.set(g, getComputedStyle(g).transform);
  return from;
}

/** Each card that changed parent glides from where it was to where it is now. */
function glideFrom(from: ReadonlyMap<SVGGElement, string>): void {
  for (const [g, was] of from) {
    const to = g.style.transform;
    if (was !== "none" && was !== getComputedStyle(g).transform)
      g.animate([{ transform: was }, { transform: to }], {
        duration: 260,
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      });
  }
}

/**
 * Puts the cards of `layer` in the order they are read. `groups` is kept from
 * one call to the next: a group no longer read is forgotten.
 */
export function arrange(
  layer: SVGGElement,
  groups: Map<string, SVGGElement>,
  cardOf: (id: string) => SVGGElement | undefined,
  reading: readonly ReadingGroup[],
  glide: boolean,
): void {
  const { wanted, inside } = wantedOrder(groups, cardOf, reading);
  const moving = [...inside].filter(([g, members]) => !same(g, members));
  if (moving.length === 0 && same(layer, wanted)) return;
  const focused = document.activeElement;
  const from = glide && !reducedMotion.matches ? placesNow(moving) : new Map<SVGGElement, string>();
  for (const [g, members] of moving) g.replaceChildren(...members);
  if (!same(layer, wanted)) layer.replaceChildren(...wanted);
  for (const [label, g] of groups) if (!inside.has(g)) groups.delete(label);
  glideFrom(from);
  if (focused instanceof SVGElement && focused !== document.activeElement && focused.isConnected)
    focused.focus({ preventScroll: true });
}
