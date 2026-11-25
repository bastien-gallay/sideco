import { expect, test } from "bun:test";
import { mayGo, relinked } from "../../src/web/link-end-rules.ts";

const link = { src: "A", dst: "B" };
const edges = [link, { src: "A", dst: "C" }, { src: "D", dst: "B" }];
const linked = (src: string, dst: string): boolean => edges.some((e) => e.src === src && e.dst === dst);

test("an end moved gives the link its other end unchanged", () => {
  expect(relinked(link, "dst", "E")).toEqual({ src: "A", dst: "E" });
  expect(relinked(link, "src", "E")).toEqual({ src: "E", dst: "B" });
});

test("an end goes to a card the link does not touch", () => {
  expect(mayGo(link, "dst", "E", linked)).toBe(true);
  expect(mayGo(link, "src", "E", linked)).toBe(true);
});

test("an end does not go onto the card at either end of its link", () => {
  expect(mayGo(link, "dst", "A", linked)).toBe(false);
  expect(mayGo(link, "dst", "B", linked)).toBe(false);
  expect(mayGo(link, "src", "B", linked)).toBe(false);
});

test("an end does not go where a link already is", () => {
  expect(mayGo(link, "dst", "C", linked)).toBe(false);
  expect(mayGo(link, "src", "D", linked)).toBe(false);
  // The other way round is another link: it may.
  expect(mayGo(link, "src", "C", linked)).toBe(true);
});
