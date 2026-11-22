/**
 * `sideco statusline --install`: put the companion's address in Claude Code's status line.
 *
 * A plugin cannot set the status line; this command writes it into Claude Code's
 * user settings for the user who runs it. It never replaces a status line of the
 * user's own: it prints the two lines to append to their script instead.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";

/** What to do with the settings, given their text (undefined: no file yet). */
export type Plan =
  | { kind: "set"; text: string }
  | { kind: "already"; command: string }
  | { kind: "own"; command: string; lines: string[] }
  | { kind: "unreadable" };

const SIDECO_LINE = /\bsideco\b.*\bstatusline\b/;

export function planStatusLine(settings: string | undefined, bin: string): Plan {
  const parsed = parseObject(settings);
  if (parsed === undefined) return { kind: "unreadable" };
  const current = parsed.statusLine as { command?: unknown } | undefined;
  const command = typeof current?.command === "string" ? current.command : undefined;
  if (command !== undefined && SIDECO_LINE.test(command)) return { kind: "already", command };
  if (current !== undefined) {
    return {
      kind: "own",
      command: command ?? JSON.stringify(current),
      // `||`, not `[ -n … ] &&`: as the script's last command, a false test would be its
      // exit status, and Claude Code hides the whole status line of a script that fails.
      lines: [
        `sideco_line=$(printf '%s' "$input" | ${shellWord(bin)} statusline 2>/dev/null)`,
        `[ -z "$sideco_line" ] || printf "%s\\n" "$sideco_line"`,
      ],
    };
  }
  const next = { ...parsed, statusLine: { type: "command", command: `${shellWord(bin)} statusline` } };
  return { kind: "set", text: `${JSON.stringify(next, null, 2)}\n` };
}

function parseObject(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined || text.trim() === "") return {};
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function shellWord(path: string): string {
  return /^[\w./~-]+$/.test(path) ? path : `'${path.replaceAll("'", `'\\''`)}'`;
}

/**
 * The binary the status line should call. An installed plugin runs from a copy named
 * by its version, gone at the next update; the marketplace's clone stays, and is updated with it.
 */
export function stableBin(root: string, exists: (path: string) => boolean = existsSync): string {
  const own = join(root, "bin", "sideco");
  const cached = root.split(sep);
  const at = cached.lastIndexOf("cache");
  if (at < 1 || cached[at - 1] !== "plugins" || cached.length !== at + 4) return own;
  const marketplace = [
    ...cached.slice(0, at),
    "marketplaces",
    cached[at + 1] as string,
    "bin",
    "sideco",
  ].join(sep);
  return exists(marketplace) ? marketplace : own;
}

/** Claude Code's user settings: under CLAUDE_CONFIG_DIR when set, as Claude Code does. */
export function userSettingsPath(env: Record<string, string | undefined> = process.env): string {
  return join(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "settings.json");
}

export function installStatusLine(): number {
  const path = userSettingsPath();
  const bin = stableBin(join(import.meta.dir, "..", ".."));
  const plan = planStatusLine(existsSync(path) ? readFileSync(path, "utf8") : undefined, bin);
  switch (plan.kind) {
    case "set":
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, plan.text);
      console.log(`status line set in ${path}: it shows on Claude Code's next update`);
      return 0;
    case "already":
      console.log(`the status line already shows Sideco (${path}): ${plan.command}`);
      return 0;
    case "own":
      console.log(`your status line runs ${plan.command}, left as it is.`);
      console.log("Append these two lines to that script; they read the session's JSON from $input:\n");
      for (const line of plan.lines) console.log(`  ${line}`);
      return 0;
    case "unreadable":
      console.error(`sideco: ${path} is not a JSON object; left as it is`);
      return 1;
  }
}
