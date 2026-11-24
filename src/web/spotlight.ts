/**
 * The spotlight, as faceto had it: what the reader looks at stays sharp, the
 * links it has stand out, and the rest of the board recedes, the way a
 * microscope dims the field around one cell. One owner at a time: the card
 * under the pointer, else the link picked, else the card chosen; a card with
 * no link lights nothing, so the light stays where it was, and a kanban does
 * not dim around a lone card.
 */

export interface Ends {
  src: string;
  dst: string;
}

export type Owner = { card: string } | { link: Ends };

export interface Lit {
  cards: ReadonlySet<string>;
  links: ReadonlySet<string>;
}

export const linkKey = (src: string, dst: string): string => `${src}\u0000${dst}`;

export function spotlight(edges: readonly Ends[], owner: Owner | undefined): Lit | undefined {
  if (!owner) return undefined;
  const lit =
    "card" in owner
      ? edges.filter((e) => e.src === owner.card || e.dst === owner.card)
      : edges.filter((e) => e.src === owner.link.src && e.dst === owner.link.dst);
  if (lit.length === 0) return undefined;
  return {
    cards: new Set(lit.flatMap((e) => [e.src, e.dst])),
    links: new Set(lit.map((e) => linkKey(e.src, e.dst))),
  };
}

/** The first of them that lights something: the card under the pointer, the link picked, the card chosen. */
export function lightAt(
  edges: readonly Ends[],
  at: { hovered?: string | undefined; picked?: Ends | undefined; chosen?: string | undefined },
): Lit | undefined {
  const lit =
    (at.hovered ? spotlight(edges, { card: at.hovered }) : undefined) ??
    (at.picked ? spotlight(edges, { link: at.picked }) : undefined) ??
    (at.chosen ? spotlight(edges, { card: at.chosen }) : undefined);
  // The card chosen stays sharp: its toolbar acts on it.
  return lit && at.chosen ? { ...lit, cards: new Set([...lit.cards, at.chosen]) } : lit;
}
