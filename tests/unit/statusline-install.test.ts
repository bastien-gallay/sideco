import { expect, test } from "bun:test";
import { join } from "node:path";
import { planStatusLine, stableBin } from "../../src/cli/statusline-install.ts";

const BIN = "/home/ada/.claude/plugins/marketplaces/sideco/bin/sideco";
const OURS = { type: "command", command: `${BIN} statusline` };

test("with no settings file, the status line is Sideco's", () => {
  const plan = planStatusLine(undefined, BIN);
  expect(plan.kind).toBe("set");
  if (plan.kind !== "set") return;
  expect(JSON.parse(plan.text)).toEqual({ statusLine: OURS });
  expect(plan.text.endsWith("\n")).toBe(true);
});

test("settings without a status line keep everything else, in order", () => {
  const before = JSON.stringify({ model: "opus", permissions: { allow: ["Bash(ls)"] } }, null, 2);
  const plan = planStatusLine(before, BIN);
  expect(plan.kind).toBe("set");
  if (plan.kind !== "set") return;
  expect(JSON.parse(plan.text)).toEqual({
    model: "opus",
    permissions: { allow: ["Bash(ls)"] },
    statusLine: OURS,
  });
  expect(plan.text.startsWith('{\n  "model": "opus"')).toBe(true);
});

test("an empty settings file is no settings", () => {
  expect(planStatusLine("  \n", BIN).kind).toBe("set");
});

test("a status line of Sideco's already there is left alone, wherever its binary lives", () => {
  const text = JSON.stringify({ statusLine: { type: "command", command: "~/sideco/bin/sideco statusline" } });
  expect(planStatusLine(text, BIN)).toEqual({ kind: "already", command: "~/sideco/bin/sideco statusline" });
});

test("a status line of the user's own is never replaced: they get the two lines for their script", () => {
  const text = JSON.stringify({ statusLine: { type: "command", command: "~/.claude/statusline.sh" } });
  const plan = planStatusLine(text, BIN);
  expect(plan.kind).toBe("own");
  if (plan.kind !== "own") return;
  expect(plan.command).toBe("~/.claude/statusline.sh");
  expect(plan.lines).toEqual([
    `sideco_line=$(printf '%s' "$input" | ${BIN} statusline 2>/dev/null)`,
    `[ -n "$sideco_line" ] && printf "%s\\n" "$sideco_line"`,
  ]);
});

test("settings that are not a JSON object are not touched", () => {
  expect(planStatusLine("{ not json", BIN).kind).toBe("unreadable");
  expect(planStatusLine("[1, 2]", BIN).kind).toBe("unreadable");
});

test("a path with a space is quoted in the command", () => {
  const plan = planStatusLine(undefined, "/Users/Ada Lovelace/sideco/bin/sideco");
  if (plan.kind !== "set") throw new Error(plan.kind);
  expect(JSON.parse(plan.text).statusLine.command).toBe("'/Users/Ada Lovelace/sideco/bin/sideco' statusline");
});

test("an installed plugin's binary is the marketplace's, which outlives each versioned copy", () => {
  const config = "/home/ada/.claude";
  const exists = (path: string) => path === join(config, "plugins/marketplaces/sideco/bin/sideco");
  expect(stableBin(join(config, "plugins/cache/sideco/sideco/0.1.0"), exists)).toBe(
    join(config, "plugins/marketplaces/sideco/bin/sideco"),
  );
});

test("a clone, or a cache with no marketplace beside it, is its own binary", () => {
  expect(stableBin("/home/ada/sideco", () => true)).toBe("/home/ada/sideco/bin/sideco");
  expect(stableBin("/home/ada/.claude/plugins/cache/sideco/sideco/0.1.0", () => false)).toBe(
    "/home/ada/.claude/plugins/cache/sideco/sideco/0.1.0/bin/sideco",
  );
});
