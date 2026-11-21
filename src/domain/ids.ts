/**
 * The ids that have rules: a board's and an element's.
 *
 * Each is a branded string: a plain string becomes one only through the function
 * that checks its rule, so a value typed `BoardId` or `ElementId` has been
 * checked. An element id is unique within its board only: whatever points at an
 * element from outside its board carries both.
 */

declare const brand: unique symbol;
type Branded<T, B extends string> = T & { readonly [brand]: B };

export type BoardId = Branded<string, "BoardId">;
export type ElementId = Branded<string, "ElementId">;

/** Lowercase letters, digits and inner dashes, 40 at most. */
const BOARD_ID = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
/** A capital letter and a number without leading zero, like E1 or C12. */
const ELEMENT_ID = /^[A-Z][1-9][0-9]{0,5}$/;

export function isBoardId(value: string): value is BoardId {
  return BOARD_ID.test(value);
}

export function isElementId(value: string): value is ElementId {
  return ELEMENT_ID.test(value);
}

export function asBoardId(value: string): BoardId | undefined {
  return isBoardId(value) ? value : undefined;
}

export function asElementId(value: string): ElementId | undefined {
  return isElementId(value) ? value : undefined;
}
