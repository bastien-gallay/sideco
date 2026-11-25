/**
 * A line of the command language cut into its words, then into what is said in
 * order and what is said by a flag. What the words ask for is read in argv.ts.
 */
export class UsageError extends Error {
  override name = "UsageError";
}

/** Splits a line the way a shell would: spaces separate, quotes group, backslash escapes. */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | undefined;
  let started = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? "";
    if (quote) {
      if (ch === quote) quote = undefined;
      else if (ch === "\\" && quote === '"' && i + 1 < line.length) current += line[++i];
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (ch === "\\" && i + 1 < line.length) {
      current += line[++i];
      started = true;
    } else if (/\s/.test(ch)) {
      if (started || current) tokens.push(current);
      current = "";
      started = false;
    } else if (ch === "#" && !started && current === "") {
      break;
    } else {
      current += ch;
    }
  }
  if (quote) throw new UsageError(`unclosed ${quote} quote`);
  if (started || current) tokens.push(current);
  return tokens;
}

export interface Args {
  positional: string[];
  flags: Map<string, string>;
}

const SHORT: Record<string, string> = { "-o": "--out", "-b": "--board", "-f": "--format" };

/** The flags that say yes by being there. */
const SWITCHES: ReadonlySet<string> = new Set(["--brief", "--notes", "--dry-run", "--all"]);

/** Every flag takes a value, `--col 3` or `--col=3`, but the switches: `--brief`. */
export function parseArgs(tokens: readonly string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < tokens.length; i++) {
    const token = SHORT[tokens[i] ?? ""] ?? tokens[i] ?? "";
    if (!token.startsWith("--") || token === "--") {
      positional.push(token);
      continue;
    }
    if (SWITCHES.has(token)) {
      flags.set(token.slice(2), "yes");
      continue;
    }
    const eq = token.indexOf("=");
    if (eq !== -1) {
      flags.set(token.slice(2, eq), token.slice(eq + 1));
      continue;
    }
    const value = tokens[i + 1];
    if (value === undefined) throw new UsageError(`${token} needs a value`);
    flags.set(token.slice(2), value);
    i++;
  }
  return { positional, flags };
}
