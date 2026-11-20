/**
 * The page the companion serves: one document, in the companion's language
 * until the reader picks another, signed with the fingerprint of what it is.
 */
import { expect, test } from "bun:test";
import { buildPage, fingerprint } from "../../src/server/page.ts";

test("the page is one self-contained document, in English by default", async () => {
  const { html } = await buildPage();
  expect(html).toStartWith('<!doctype html>\n<html lang="en">');
  expect(html).not.toContain("/*__SCRIPT__*/");
  expect(html).not.toContain("/*__STYLES__*/");
  expect(html).not.toMatch(/<script[^>]+src=/);
});

test("the page is served in the companion's language, both languages on board", async () => {
  const { html } = await buildPage("fr");
  expect(html).toStartWith('<!doctype html>\n<html lang="fr">');
  // The reader can still switch: both catalogues travel with the page.
  expect(html).toContain("Send to Claude");
  expect(html).toContain("Envoyer à Claude");
});

test("the page carries its build, and the same sources give the same build", async () => {
  const page = await buildPage();
  expect(page.build).toMatch(/^[0-9a-f]{16}$/);
  expect(page.html).toContain(`<meta name="sideco-build" content="${page.build}">`);
  expect(await buildPage()).toEqual(page);
});

test("a page that opens in another language is another build", async () => {
  // An open tab must fetch it: what it runs is no longer what the companion serves.
  expect((await buildPage("fr")).build).not.toBe((await buildPage("en")).build);
});

test("the page comes with the worker its tabs share for the event stream", async () => {
  const page = await buildPage();
  expect(page.worker).toContain("/api/events");
  // A tab of one build must not share the stream of another: the address carries the build.
  expect(page.html).toContain("/stream-worker.js?build=");
});

test("a change to the worker alone is another build", () => {
  expect(fingerprint("<html>", "worker one")).not.toBe(fingerprint("<html>", "worker two"));
});
