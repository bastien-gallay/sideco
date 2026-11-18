/**
 * The page the companion serves: one document, in the companion's language
 * until the reader picks another.
 */
import { expect, test } from "bun:test";
import { buildPage } from "../../src/server/page.ts";

test("the page is one self-contained document, in English by default", async () => {
  const page = await buildPage();
  expect(page).toStartWith('<!doctype html>\n<html lang="en">');
  expect(page).not.toContain("/*__SCRIPT__*/");
  expect(page).not.toContain("/*__STYLES__*/");
  expect(page).not.toMatch(/<script[^>]+src=/);
});

test("the page is served in the companion's language, both languages on board", async () => {
  const page = await buildPage("fr");
  expect(page).toStartWith('<!doctype html>\n<html lang="fr">');
  // The reader can still switch: both catalogues travel with the page.
  expect(page).toContain("Hand over to Claude");
  expect(page).toContain("Passer la main à Claude");
});
