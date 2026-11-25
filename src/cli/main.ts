#!/usr/bin/env bun
/**
 * `sideco`: the companion from the terminal. Reading commands replay the journal
 * from disk and need no server; writing commands go through the running
 * companion, which is started on demand.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Command, CommandError, slugify } from "../domain/commands.ts";
import { describeBoard, describeCard } from "../domain/digest.ts";
import { fromModel } from "../domain/export/model.ts";
import { FORMATS } from "../domain/formats.ts";
import { asLocale, DEFAULT_LOCALE, LOCALES, type Locale } from "../domain/i18n.ts";
import { describeFind, describeLabels, describeSessions } from "../domain/project-digest.ts";
import { latestSession } from "../domain/sessions.ts";
import type { Board, Workspace } from "../domain/workspace.ts";
import { DEFAULT_PORT, dataDir, IDLE_GRACE_MS, readJournal, readWorkspace, start } from "../server/start.ts";
import { addressOf } from "./address.ts";
import {
  type Action,
  type Args,
  BOARD_VERBS,
  boardAction,
  parseArgs,
  parseBatch,
  UsageError,
} from "./argv.ts";
import { openBrowser } from "./browser.ts";
import { chooseBoard, defaultBoard, named } from "./choose.ts";
import {
  ClientError,
  ensureServer,
  findRoot,
  findServer,
  get,
  initRoot,
  listen,
  type Posted,
  post,
  type Server,
  showPage,
  stopServer,
} from "./client.ts";
import { exportOne, publish } from "./export.ts";
import { HELP } from "./help.ts";
import { hookFromStdin } from "./hook.ts";
import { renumberAll } from "./renumber-all.ts";
import { readSetting } from "./setting.ts";
import { statusText, watchers } from "./status.ts";
import { statusline } from "./statusline.ts";
import { takeBack } from "./take-back.ts";

/** Every verb that is not a board command; with `BOARD_VERBS`, the whole CLI. */
export const CLI_VERBS: ReadonlySet<string> = new Set([
  "help",
  "hook",
  "statusline",
  "init",
  "serve",
  "stop",
  "formats",
  "open",
  "url",
  "status",
  "sessions",
  "labels",
  "find",
  "boards",
  "show",
  "export",
  "publish",
  "changes",
  "follow",
  "unfollow",
  "wait",
  "apply",
  "import",
]);

/** Reading a board is following it. Said to the companion if one runs; never a reason for `show` to fail. */
async function followQuietly(root: string, session: string | undefined, board: string): Promise<void> {
  if (!session) return;
  try {
    const server = await findServer(root);
    if (server) await post(server, "agent", session, [{ kind: "follow", boards: [board] }]);
  } catch {
    // The board was shown: that is what was asked.
  }
}

export async function main(argv: string[]): Promise<number> {
  const [verb = "help", ...rest] = argv;
  try {
    return await run(verb, rest);
  } catch (error) {
    if (error instanceof UsageError || error instanceof ClientError) {
      console.error(`sideco: ${error.message}`);
      return 1;
    }
    if (isSystemError(error)) {
      console.error(`sideco: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

/** A refusal by the operating system (a missing directory, a read-only file): the user's to fix, not a bug. */
function isSystemError(error: unknown): error is Error {
  return error instanceof Error && typeof (error as { syscall?: unknown }).syscall === "string";
}

async function run(verb: string, rest: string[]): Promise<number> {
  if (verb === "hook") return hookFromStdin(rest.includes("--rewake"));
  if (verb === "statusline") return statusline(rest.includes("--install"));
  const args = parseArgs(rest);
  const cwd = process.cwd();

  switch (verb) {
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return 0;
    case "init": {
      const root = initRoot(findRoot(cwd) ?? cwd);
      console.log(`workspace ready: ${dataDir(root)}`);
      return 0;
    }
    case "serve":
      return serveForeground(resolve(args.flags.get("root") ?? findRoot(cwd) ?? cwd), args);
    case "formats":
      console.log(formatsText());
      return 0;
  }

  const root = verb === "open" ? initRoot(findRoot(cwd) ?? cwd) : findRoot(cwd);
  if (!root) throw new UsageError("no Sideco workspace here or above; run `sideco init` or `sideco open`");
  const read = (): Workspace => readWorkspace(root);

  switch (verb) {
    case "url": {
      const origin = (await ensureServer(root)).url;
      const { board, card } = args.positional[0] === undefined ? {} : named(read(), args);
      console.log(board ? addressOf(origin, board, card) : origin);
      return 0;
    }
    case "open": {
      const restarted = !(await findServer(root)) && read().seq > 0;
      const server = await ensureServer(root);
      console.log(server.url);
      // Safe to repeat, so an agent can run it before modelling: a page already open is left alone.
      if (await watched(server, restarted ? pageReturnMs() : 0)) {
        console.log("already open in the browser");
        return 0;
      }
      // This shell first; failing that the companion, which the plugin starts outside any sandbox.
      if (!((await openBrowser(server.url)) || (await showPage(server))))
        throw new ClientError(
          "could not open the browser, from this shell or from the companion (a sandbox blocks it, or no browser is set). Run `sideco open` outside the sandbox, or give the user the address above.",
        );
      console.log("opened in the browser");
      return 0;
    }
    case "stop": {
      const stopped = await stopServer(root);
      console.log(
        stopped ? `stopped the companion at ${stopped}` : "no companion is running for this workspace",
      );
      return 0;
    }
    case "status":
      console.log(await statusText(root, readJournal(root)));
      return 0;
    case "boards":
      console.log(boardsText(read()));
      return 0;
    case "labels":
      console.log(describeLabels(read(), args.positional[0]));
      return 0;
    case "find": {
      if (args.positional.length === 0)
        throw new UsageError("find needs a word to look for: sideco find WORDS");
      const ws = read();
      const only = args.flags.get("board");
      console.log(
        describeFind(
          ws,
          args.positional.join(" "),
          only === undefined ? undefined : chooseBoard(ws, only).id,
        ),
      );
      return 0;
    }
    case "sessions":
      console.log(describeSessions(read(), sessionGiven(args), Date.now()));
      return 0;
    case "show": {
      const { board, card } = named(read(), args);
      const server = card ? await findServer(root) : undefined;
      const [head, ...rest] = shown(board, card, args).split("\n");
      console.log([head, ...(server ? [`  ${addressOf(server.url, board, card)}`] : []), ...rest].join("\n"));
      await followQuietly(root, sessionGiven(args), board.id);
      return 0;
    }
    case "export":
      return exportOne(read(), args, language(args));
    case "publish":
      return publish(root, read(), args, language(args));
  }

  const server = await ensureServer(root);
  const actor = args.flags.get("as") ?? setting("SIDECO_ACTOR") ?? "agent";
  const session = sessionGiven(args) ?? latestSession(read())?.id;

  switch (verb) {
    case "changes": {
      const found = await get<{ text: string }>(
        server,
        `/api/changes?session=${encodeURIComponent(session ?? "cli")}&ack=1`,
      );
      console.log(found.text || "no change from the human since you last asked");
      return 0;
    }
    case "wait": {
      const seconds = Number(args.flags.get("timeout") ?? 540);
      const waited = await listen(server, session ?? "cli", seconds * 1000);
      console.log(
        waited.outcome === "passed"
          ? waited.text
          : `no hand-over yet (${waited.outcome}); run \`sideco wait\` again to keep listening`,
      );
      return 0;
    }
    case "follow":
    case "unfollow": {
      if (args.positional.length === 0) throw new UsageError(`usage: sideco ${verb} BOARD…`);
      if (!session) throw new UsageError(`\`${verb}\` is said by a session: none is known here`);
      await post(server, actor, session, [{ kind: verb, boards: args.positional }]);
      const boards = args.positional.join(", ");
      console.log(verb === "follow" ? `following ${boards}` : `no longer following ${boards}`);
      return 0;
    }
    case "apply": {
      const file = args.positional[0];
      const text = file ? readFileSync(file, "utf8") : await Bun.stdin.text();
      const commands = parseBatch(text, defaultBoard(read(), args, false));
      if (commands.length === 0) throw new UsageError("nothing to apply");
      const done = await post(server, actor, session, commands);
      const ids = done.minted.filter((id): id is string => id !== null);
      console.log(
        `applied ${commands.length} command${commands.length > 1 ? "s" : ""} (seq ${done.seq})${ids.length ? `: ${ids.join(" ")}` : ""}`,
      );
      return 0;
    }
    case "import": {
      const file = args.positional[0];
      if (!file) throw new UsageError("usage: sideco import FILE [--id ID]");
      const model: unknown = JSON.parse(readFileSync(file, "utf8"));
      const title = (model as { title?: unknown }).title;
      const id =
        args.flags.get("id") ??
        slugify(typeof title === "string" ? title : file.replace(/^.*\//, "").replace(/\..*$/, ""));
      const done = await post(server, actor, session, fromModel(model, id, read()));
      console.log(`imported as board ${id} (seq ${done.seq})`);
      return 0;
    }
  }

  if (verb === "renumber" && args.flags.has("all")) {
    const send = (commands: Command[]) => post(server, actor, session, commands);
    console.log(await renumberAll(read(), args.flags.has("dry-run"), send));
    return 0;
  }
  if (!BOARD_VERBS.has(verb)) throw new UsageError(`unknown command "${verb}" (try \`sideco help\`)`);
  // `board new` and `board rm` name their board themselves, and `session name` is on none: no default applies.
  const action = boardAction(
    [verb, ...rest.filter((_token, i) => !isGlobalFlag(rest, i))],
    verb === "board" || verb === "session" ? undefined : defaultBoard(read(), args, true),
  );
  const { kind, board } = action.command;
  if ((kind === "undo" || kind === "redo") && typeof board === "string")
    return takeBack({ kind, board }, read(), actor, args.flags.has("dry-run"), (command) =>
      post(server, actor, session, [command]),
    );
  const done = await post(server, actor, session, [action.command]);
  console.log(outcome(action, done, server.url));
  return 0;
}

/** What one board command prints: the thing the caller needs next. */
function outcome(action: Action, done: Posted, url: string): string {
  if (action.command.kind === "create-board") return `${action.board} (${url}/#/b/${action.board})`;
  if (action.command.kind === "remove-board") return `removed board ${action.command.board}`;
  return done.minted[0] ?? `ok (seq ${done.seq})`;
}

const setting = (name: string): string | undefined => readSetting(name, process.env);

/** The session a command speaks for: the one named, else the one the shell says. */
const sessionGiven = (args: Args) => args.flags.get("session") ?? setting("SIDECO_SESSION");

/**
 * The language of what a human will read (an export, the page a companion
 * opens in): `--lang`, else `$SIDECO_LANG`, else English. What the agent reads
 * on this terminal stays English.
 */
function language(args: Args): Locale {
  const asked = args.flags.get("lang");
  if (asked === undefined) return asLocale(setting("SIDECO_LANG")) ?? DEFAULT_LOCALE;
  const locale = asLocale(asked);
  if (!locale) throw new UsageError(`--lang is one of: ${LOCALES.join(", ")}`);
  return locale;
}

const GLOBAL_FLAGS = new Set(["--as", "--session"]);

/** True for `--as`/`--session` and their values, which are not part of the command itself. */
/** A board as text: all of it, the part the flags name, or one card. */
function shown(board: Board, card: string | undefined, args: Args): string {
  const col = args.flags.get("col");
  if (col !== undefined && !/^\d+$/.test(col))
    throw new UsageError(`--col takes a whole number, got "${col}"`);
  try {
    if (card) return describeCard(board, card);
    return describeBoard(board, {
      lane: args.flags.get("lane"),
      col: col === undefined ? undefined : Number(col),
      brief: args.flags.has("brief"),
      notes: args.flags.has("notes"),
    });
  } catch (error) {
    if (error instanceof CommandError) throw new UsageError(error.message);
    throw error;
  }
}

function isGlobalFlag(tokens: string[], index: number): boolean {
  return GLOBAL_FLAGS.has(tokens[index] ?? "") || GLOBAL_FLAGS.has(tokens[index - 1] ?? "");
}

async function serveForeground(given: string, args: Args): Promise<number> {
  const root = initRoot(given);
  const port = Number(args.flags.get("port") ?? setting("SIDECO_PORT") ?? DEFAULT_PORT);
  const graceMs = idleGraceMs();
  const running = await start(root, port, {
    show: openBrowser,
    locale: language(args),
    idle: graceMs === undefined ? undefined : { graceMs, onIdle: () => stop() },
  });
  console.log(`sideco is serving ${root}\n  ${running.url}`);
  const stop = (): void => {
    running.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise(() => {});
  return 0;
}

/**
 * How long the companion stays once no page, no session uses it: SIDECO_IDLE_MS,
 * or five minutes. `off` keeps it running until `sideco stop`.
 */
function idleGraceMs(): number | undefined {
  const asked = setting("SIDECO_IDLE_MS");
  if (asked === "off") return undefined;
  const ms = Number(asked);
  return asked !== undefined && Number.isFinite(ms) && ms > 0 ? ms : IDLE_GRACE_MS;
}

/**
 * How long a page left open takes to find a companion that was started again:
 * the browser retries its stream a few seconds after losing it.
 */
const PAGE_RETURN_MS = 8000;

function pageReturnMs(): number {
  const asked = Number(process.env.SIDECO_PAGE_RETURN_MS);
  return Number.isFinite(asked) && asked >= 0 && process.env.SIDECO_PAGE_RETURN_MS ? asked : PAGE_RETURN_MS;
}

/** Whether a page shows the board, looking again for up to `withinMs`: time for one left open to come back. */
async function watched(server: Server, withinMs: number): Promise<boolean> {
  const until = Date.now() + withinMs;
  for (;;) {
    if ((await watchers(server)) > 0) return true;
    if (Date.now() >= until) return false;
    await Bun.sleep(200);
  }
}

function formatsText(): string {
  return FORMATS.map((f) => {
    const place =
      f.layout === "timeline"
        ? "place with --col N"
        : f.layout === "columns"
          ? `place with --lane ${f.lanes.map((l) => l.id).join("|")}`
          : "placed by their links (--from ID)";
    // A lane is spelled out only when its name does not say what it stands for.
    const lanes = f.lanes.flatMap((l) =>
      l.hint ? [`    ${l.id.padEnd(10)} ${l.label.en}: ${l.hint.en}`] : [],
    );
    const types = f.types.map((t) => `    ${t.id.padEnd(10)} ${t.prefix}  ${t.hint.en}`);
    return [`${f.id} — ${f.name.en}: ${f.purpose.en}`, `  ${place}`, ...lanes, ...types].join("\n");
  }).join("\n\n");
}

function boardsText(ws: Workspace): string {
  if (ws.boards.length === 0) return 'no board yet; create one with `sideco board new "Title"`';
  return ws.boards.map((b) => `${b.id}  ${b.format}  ${b.elements.length} elements  "${b.title}"`).join("\n");
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
