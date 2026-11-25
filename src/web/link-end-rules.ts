/**
 * Where an end of a link may go (S350): plain rules, tested without a page.
 * link-ends.ts draws the ends and pulls them.
 */

export interface Link {
  src: string;
  dst: string;
}

/** The link once one of its ends is on `to`. */
export function relinked(link: Link, end: "src" | "dst", to: string): Link {
  return end === "src" ? { src: to, dst: link.dst } : { src: link.src, dst: to };
}

/** Whether an end may go to `to`: not onto the card at either end, nor where a link already is. */
export function mayGo(
  link: Link,
  end: "src" | "dst",
  to: string,
  linked: (src: string, dst: string) => boolean,
): boolean {
  if (to === link.src || to === link.dst) return false;
  const next = relinked(link, end, to);
  return !linked(next.src, next.dst);
}
