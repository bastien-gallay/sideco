import { expect, test } from "bun:test";
import { readSetting } from "../../src/cli/setting.ts";

test("a variable set but empty counts as not set", () => {
  expect(readSetting("SIDECO_BOARD", { SIDECO_BOARD: "" })).toBeUndefined();
  expect(readSetting("SIDECO_BOARD", { SIDECO_BOARD: "nom" })).toBe("nom");
});

test("the VICO_ variable a hook installed before the rename exports still counts", () => {
  expect(readSetting("SIDECO_SESSION", { VICO_SESSION: "s1" })).toBe("s1");
});

test("the new variable wins, even emptied, over the old one", () => {
  expect(readSetting("SIDECO_SESSION", { SIDECO_SESSION: "s2", VICO_SESSION: "s1" })).toBe("s2");
  expect(readSetting("SIDECO_SESSION", { SIDECO_SESSION: "", VICO_SESSION: "s1" })).toBeUndefined();
});
