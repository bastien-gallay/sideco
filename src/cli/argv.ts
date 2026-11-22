/**
 * The command language. One grammar serves the shell (`sideco add event "Paid"`)
 * and batch files (`sideco apply`, one command per line), so what the agent learns
 * once works in both.
 */
import { slugify } from "../domain/commands.ts";

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
const SWITCHES: ReadonlySet<string> = new Set(["--brief", "--notes", "--dry-run"]);

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

/** A command as it goes on the wire; the server validates it. */
export type WireCommand = Record<string, unknown> & { kind: string };

export interface Action {
  command: WireCommand;
  /** Set by `board new`: the board the following lines write to. */
  board?: string;
}

/** The verbs that write to a board. `board` is the default board, when one is known. */
export function boardAction(tokens: readonly string[], board: string | undefined): Action {
  const [verb = "", ...rest] = tokens;
  const { positional: p, flags } = parseArgs(rest);
  const target = (): string => {
    const chosen = flags.get("board") ?? board;
    if (!chosen) throw new UsageError("which board? pass --board ID (see `sideco boards`)");
    return chosen;
  };
  /** How many positional arguments the verb read: one more is an argument in excess. */
  let used = 0;
  const at = (index: number): string | undefined => {
    used = Math.max(used, index + 1);
    return p[index];
  };
  const need = (index: number, what: string): string => {
    const value = at(index);
    if (value === undefined || value === "") throw new UsageError(`\`${verb}\` needs ${what}`);
    return value;
  };
  /** Like `need`, but "" is a value: it gives back what the workshop says. */
  const said = (index: number, what: string): string => {
    const value = at(index);
    if (value === undefined) throw new UsageError(`\`${verb}\` needs ${what}, or "" for the workshop's`);
    return value;
  };
  const number = (name: string): number | undefined => {
    const raw = flags.get(name);
    if (raw === undefined) return undefined;
    if (!/^\d+$/.test(raw)) throw new UsageError(`--${name} takes a whole number, got "${raw}"`);
    return Number(raw);
  };

  const action = ((): Action => {
    switch (verb) {
      case "board": {
        if (at(0) === "rm") {
          const id = at(1);
          if (!id)
            throw new UsageError("`board rm` needs the id of the board to remove (see `sideco boards`)");
          return { command: { kind: "remove-board", board: id } };
        }
        if (at(0) !== "new")
          throw new UsageError('usage: board new "Title" [--format F] [--id ID] | board rm ID');
        const title = need(1, "a title");
        const id = flags.get("id") ?? slugify(title);
        return {
          command: {
            kind: "create-board",
            board: id,
            title,
            format: flags.get("format") ?? "event-storming",
          },
          board: id,
        };
      }
      case "session":
        if (at(0) !== "name") throw new UsageError('usage: session name "Name"');
        return { command: { kind: "name-session", name: need(1, "a name") } };
      case "purpose":
        return { command: { kind: "purpose", board: target(), purpose: said(0, "a question") } };
      case "retitle":
        return { command: { kind: "retitle", board: target(), title: need(0, "a title") } };
      case "lane":
        if (at(0) === "add")
          return {
            command: {
              kind: "add-lane",
              board: target(),
              label: need(1, "a name"),
              before: flags.get("before"),
            },
          };
        if (at(0) === "rm")
          return { command: { kind: "remove-lane", board: target(), lane: need(1, "a lane") } };
        if (at(0) === "move")
          return {
            command: {
              kind: "move-lane",
              board: target(),
              lane: need(1, "a lane"),
              before: flags.get("before"),
            },
          };
        if (at(0) === "hint")
          return {
            command: { kind: "hint-lane", board: target(), lane: need(1, "a lane"), hint: said(2, "a hint") },
          };
        return {
          command: { kind: "name-lane", board: target(), lane: need(0, "a lane"), label: need(1, "a name") },
        };
      case "axis":
        return {
          command: {
            kind: "name-axis",
            board: target(),
            axis: need(0, "an axis, x or y"),
            label: said(1, "a name"),
            low: at(2),
            high: at(3),
          },
        };
      case "slice":
        if (at(0) === "add")
          return {
            command: {
              kind: "add-slice",
              board: target(),
              label: need(1, "a name"),
              before: flags.get("before"),
            },
          };
        if (at(0) === "rm")
          return { command: { kind: "remove-slice", board: target(), slice: need(1, "a slice") } };
        throw new UsageError('usage: slice add "Name" [--before SLICE] | slice rm SLICE');
      case "add":
        return {
          command: {
            kind: "add",
            board: target(),
            type: need(0, "a type"),
            label: need(1, "a label"),
            id: flags.get("id"),
            col: number("col"),
            lane: flags.get("lane"),
            detail: flags.get("detail"),
            before: flags.get("before"),
            from: flags.get("from"),
            edgeLabel: flags.get("edge"),
            alias: flags.get("alias"),
          },
        };
      case "rename":
        return {
          command: { kind: "rename", board: target(), id: need(0, "an id"), label: need(1, "a label") },
        };
      case "detail":
        return { command: { kind: "annotate", board: target(), id: need(0, "an id"), detail: at(1) ?? "" } };
      case "undo":
      case "redo":
        return { command: { kind: verb, board: target() } };
      case "label":
      case "unlabel":
        need(1, "a label");
        used = p.length;
        return { command: { kind: verb, board: target(), id: need(0, "an id"), labels: p.slice(1) } };
      case "done":
      case "undone":
        return { command: { kind: "mark", board: target(), id: need(0, "an id"), done: verb === "done" } };
      case "move":
        if (p.length < 2 && !["lane", "col", "before"].some((name) => flags.has(name)))
          throw new UsageError("`move` needs where to: --lane L, --col N or --before ID");
        return {
          command: {
            kind: "move",
            board: target(),
            id: need(0, "an id"),
            col: number("col"),
            lane: flags.get("lane"),
            before: flags.get("before"),
          },
        };
      case "rm":
        return { command: { kind: "remove", board: target(), id: need(0, "an id") } };
      case "renumber":
        return { command: { kind: "renumber", board: target(), id: need(0, "an id"), to: at(1) } };
      case "insert-col": {
        const at = need(0, "a column number");
        if (!/^\d+$/.test(at)) throw new UsageError(`insert-col takes a whole number, got "${at}"`);
        return { command: { kind: "insert-column", board: target(), at: Number(at) } };
      }
      case "rm-col": {
        const at = need(0, "a column number");
        if (!/^\d+$/.test(at)) throw new UsageError(`rm-col takes a whole number, got "${at}"`);
        return { command: { kind: "remove-column", board: target(), at: Number(at) } };
      }
      case "move-col": {
        const [from, to] = [need(0, "the number of the column to move"), need(1, "the number it takes")];
        for (const raw of [from, to])
          if (!/^\d+$/.test(raw)) throw new UsageError(`move-col takes whole numbers, got "${raw}"`);
        return { command: { kind: "move-column", board: target(), from: Number(from), to: Number(to) } };
      }
      case "link":
        return {
          command: {
            kind: "link",
            board: target(),
            src: need(0, "a source id"),
            dst: need(1, "a target id"),
            label: at(2),
          },
        };
      case "unlink":
        return {
          command: {
            kind: "unlink",
            board: target(),
            src: need(0, "a source id"),
            dst: need(1, "a target id"),
          },
        };
      case "focus":
        // Every argument is a card to focus on.
        used = p.length;
        return { command: { kind: "focus", board: target(), ids: p, reason: flags.get("why") } };
      case "note":
        return {
          command: {
            kind: "note",
            board: target(),
            text: need(0, "a text"),
            target: flags.get("on"),
            alias: flags.get("alias"),
          },
        };
      case "reply":
        return {
          command: { kind: "reply", board: target(), to: need(0, "a note id"), text: need(1, "a text") },
        };
      case "resolve":
        return { command: { kind: "resolve", board: target(), id: need(0, "a note id") } };
      case "pass":
        return {
          command: {
            kind: "pass",
            board: target(),
            to: flags.get("to") ?? "human",
            message: at(0),
            target: flags.get("for"),
          },
        };
      default:
        throw new UsageError(`unknown command "${verb}" (try \`sideco help\`)`);
    }
  })();
  const extra = p[used];
  if (extra !== undefined) {
    const said = `\`${verb}\` takes ${used} argument${used === 1 ? "" : "s"}, not "${extra}"`;
    throw new UsageError(verb === "move" ? `${said}: to choose the lane, --lane ${extra}` : said);
  }
  return action;
}

export const BOARD_VERBS: ReadonlySet<string> = new Set([
  "board",
  "retitle",
  "purpose",
  "session",
  "lane",
  "axis",
  "slice",
  "add",
  "rename",
  "detail",
  "done",
  "undone",
  "label",
  "unlabel",
  "undo",
  "redo",
  "move",
  "rm",
  "renumber",
  "insert-col",
  "rm-col",
  "move-col",
  "link",
  "unlink",
  "focus",
  "note",
  "reply",
  "resolve",
  "pass",
]);

/** A batch file to its commands. Errors name the line. */
export function parseBatch(text: string, board: string | undefined): WireCommand[] {
  const commands: WireCommand[] = [];
  let current = board;
  text.split("\n").forEach((line, index) => {
    try {
      const tokens = tokenize(line);
      if (tokens.length === 0) return;
      const action = boardAction(tokens, current);
      current = action.board ?? current;
      if (action.command.kind === "remove-board" && action.command.board === current) current = undefined;
      commands.push(action.command);
    } catch (error) {
      if (error instanceof UsageError) throw new UsageError(`line ${index + 1}: ${error.message}`);
      throw error;
    }
  });
  return commands;
}
