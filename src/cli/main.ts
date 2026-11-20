#!/usr/bin/env bun
/**
 * `sideco`: the companion from the terminal. Reading commands replay the journal
 * from disk and need no server; writing commands go through the running
 * companion, which is started on demand.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CommandError, isElementId, slugify } from "../domain/commands.ts";
import { decide } from "../domain/decide.ts";
import { describeBoard, describeCard, describeSessions } from "../domain/digest.ts";
import { ACTORS, type Actor } from "../domain/events.ts";
import { toIndexHtml } from "../domain/export/html.ts";
import { EXPORT_FORMATS, EXTENSION, exportBoard } from "../domain/export/index.ts";
import { fromModel } from "../domain/export/model.ts";
import { FORMATS } from "../domain/formats.ts";
import { asLocale, DEFAULT_LOCALE, LOCALES, type Locale, WORDS } from "../domain/i18n.ts";
import {
  type Board,
  findBoard,
  latestSession,
  replay,
  sessionLabel,
  type Workspace,
} from "../domain/workspace.ts";
import { IDLE_GRACE_MS } from "../server/idle.ts";
import { openJournal } from "../server/journal.ts";
import { DEFAULT_PORT, dataDir, start } from "../server/start.ts";
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
import {
  Blocked,
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
import { runHook } from "./hook.ts";
import { readSetting } from "./setting.ts";

const HELP = `sideco — a visual companion for Claude Code

  sideco open                         start the companion if needed and show the page (a page already open is left alone)
  sideco url                          print its address
  sideco serve [--port N] [--lang L]  run it in the foreground
  sideco stop                         stop the companion; the journal stays. It also stops by itself
                                      5 min after the last page and session leave ($SIDECO_IDLE_MS, or off)
  sideco init                         create a workspace (.sideco/) here
  sideco status                       boards, sessions, server

Model (BOARD defaults to the only board, or --board ID, or $SIDECO_BOARD)
  sideco formats                      the workshops and their element types
  sideco board new "Title" [--format F] [--id ID]
  sideco board rm ID                  remove a board; its history stays in the journal
  sideco retitle "Title"              give the board a new title; its id stays
  sideco boards
  sideco show [BOARD]                 a board as text; a part of it with --lane L, --col N, --brief (no details),
                                    --notes (the open notes only). The first line names the part.
  sideco show ID                      one card: where it is, its links, its threads
  sideco add TYPE "Label" [--col N | --lane L] [--before ID] [--id E1] [--from ID [--edge "label"]] [--detail "…"]
  sideco rename ID "Label"            sideco detail ID "Text"
  sideco move ID --col N | --lane L [--before ID]   (--before alone: before that card, in its cell)
  sideco done ID                      sideco undone ID
  sideco undo [--dry-run]             take back your own last gesture, named; sideco redo puts it back.
                                    Never the human's: one they changed since is refused, and says why
  sideco rm ID                        sideco insert-col N         sideco rm-col N (an empty column)
  sideco move-col FROM TO             a column takes the number TO, its cards with it
  sideco lane LANE "Name"             call a lane of this board your own way
  sideco sessions                     the sessions open on this project, and what each follows
  sideco session name "Name"          name this session, so the page can tell it from another
  sideco purpose "Question?"          ask this board its own question; "" gives the workshop's back
  sideco lane hint LANE "What for"     say what a lane stands for on this board; "" gives the workshop's back
  sideco axis x|y "Name" [Low] [High] name an axis of a plan and its ends (left/bottom, right/top); "" gives it back
  sideco lane add "Name" [--before L] a kanban lane of this board's own; lane rm L (empty) · lane move L [--before L]
  sideco slice add "Name" [--before S] a story map's slice, a named line under its stories; slice rm S
  sideco link SRC DST ["label"]       sideco unlink SRC DST
  sideco focus [ID…] [--why "…"]      no id clears the focus
  sideco note "Text" [--on ID]        open a discussion, on the board or on one element
  sideco reply N1 "Text"              answer in the thread of a note
  sideco resolve N1                   close the thread
  sideco apply [FILE]                 run a batch of the commands above, all or nothing (stdin by default)
                                    in a batch, \`add … --alias NAME\` (or \`note … --alias NAME\`) names what the line
                                    creates, and @NAME is its id on the lines after it: \`link @NAME E1\`

Work with the human
  sideco changes                      what the human changed since you last asked
  sideco pass ["message"]             hand the turn to the human (--to agent [--for SESSION]: to one session)
  sideco follow BOARD…                take these boards: you are told what the human changes on the boards you
                                    follow (those you wrote on or read with \`sideco show\`), not on another session's
  sideco unfollow BOARD…              let go of boards, until you write on one again
  sideco wait [--timeout SECONDS]     block until the human hands it back, then print their changes

Share
  sideco export [BOARD] --format md|html|svg|mermaid|json [-o FILE] [--lang L]
  sideco import FILE [--id ID]        a model.json (faceto files load as they are)
  sideco publish [--out DIR] [--lang L]  every board as a static site

Options: --as human|agent   --session ID   --board ID

Language: this terminal speaks English. The page and the exports are in English too,
or in French with --lang fr or SIDECO_LANG=fr; in the page, each reader picks their own.
`;

/** Every verb that is not a board command; with `BOARD_VERBS`, the whole CLI. */
export const CLI_VERBS: ReadonlySet<string> = new Set([
  "help",
  "hook",
  "init",
  "serve",
  "stop",
  "formats",
  "open",
  "url",
  "status",
  "sessions",
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
  if (verb === "hook") return hook(rest.includes("--rewake"));
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
  const read = (): Workspace => replay(openJournal(dataDir(root)).load());

  switch (verb) {
    case "url":
      console.log((await ensureServer(root)).url);
      return 0;
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
      console.log(await statusText(root, read()));
      return 0;
    case "boards":
      console.log(boardsText(read()));
      return 0;
    case "sessions":
      console.log(describeSessions(read(), args.flags.get("session") ?? setting("SIDECO_SESSION")));
      return 0;
    case "show": {
      // `show E1` is one card of the board; `show backlog` is a board.
      const named = args.positional[0];
      const card = named !== undefined && isElementId(named) ? named : undefined;
      const board = chooseBoard(read(), card ? args.flags.get("board") : (named ?? args.flags.get("board")));
      console.log(shown(board, card, args));
      await followQuietly(root, args.flags.get("session") ?? setting("SIDECO_SESSION"), board.id);
      return 0;
    }
    case "export":
      return exportOne(read(), args);
    case "publish":
      return publish(root, read(), args);
  }

  const server = await ensureServer(root);
  const actor = args.flags.get("as") ?? setting("SIDECO_ACTOR") ?? "agent";
  const session = args.flags.get("session") ?? setting("SIDECO_SESSION") ?? latestSession(read())?.id;

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
      const done = await post(server, actor, session, fromModel(model, id));
      console.log(`imported as board ${id} (seq ${done.seq})`);
      return 0;
    }
  }

  if (!BOARD_VERBS.has(verb)) throw new UsageError(`unknown command "${verb}" (try \`sideco help\`)`);
  // `board new` and `board rm` name their board themselves, and `session name` is on none: no default applies.
  const action = boardAction(
    [verb, ...rest.filter((_token, i) => !isGlobalFlag(rest, i))],
    verb === "board" || verb === "session" ? undefined : defaultBoard(read(), args, true),
  );
  const { kind, board } = action.command;
  if ((kind === "undo" || kind === "redo") && typeof board === "string")
    return takeBack({ kind, board }, read(), asAuthor(actor), args.flags.has("dry-run"), (command) =>
      post(server, actor, session, [command]),
    );
  const done = await post(server, actor, session, [action.command]);
  console.log(outcome(action, done, server.url));
  return 0;
}

/**
 * Undo or redo, named: the gesture is said in the words of the CLI that did it.
 * With `--dry-run`, the same decision is made on the journal as read here, and
 * nothing is written.
 */
async function takeBack(
  command: { kind: "undo" | "redo"; board: string },
  ws: Workspace,
  actor: Actor,
  dryRun: boolean,
  send: (command: { kind: "undo" | "redo"; board: string }) => Promise<Posted>,
): Promise<number> {
  const kept = findBoard(ws, command.board) ?? ws.removed.find((b) => b.id === command.board);
  const gesture = kept?.trails[actor]?.[command.kind].at(-1);
  if (dryRun) {
    const decision = decide(ws, command, { actor });
    if (decision.refused) console.log(`would be refused: ${decision.refused.replace(/^refused: /, "")}`);
    else console.log(`would ${command.kind} seq ${gesture?.seq}: ${gesture?.name}`);
    return 0;
  }
  await send(command);
  console.log(`${command.kind === "undo" ? "undid" : "redid"} seq ${gesture?.seq}: ${gesture?.name}`);
  return 0;
}

/** `--as` names one of the authors; anything else is a mistake said in words. */
function asAuthor(name: string): Actor {
  const actor = ACTORS.find((a) => a === name);
  if (!actor) throw new UsageError(`--as is one of: ${ACTORS.join(", ")}`);
  return actor;
}

/** What one board command prints: the thing the caller needs next. */
function outcome(action: Action, done: Posted, url: string): string {
  if (action.command.kind === "create-board") return `${action.board} (${url}/#/b/${action.board})`;
  if (action.command.kind === "remove-board") return `removed board ${action.command.board}`;
  return done.minted[0] ?? `ok (seq ${done.seq})`;
}

function setting(name: string): string | undefined {
  return readSetting(name, process.env);
}

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

function defaultBoard(ws: Workspace, args: Args, required: boolean): string | undefined {
  const chosen = args.flags.get("board") ?? setting("SIDECO_BOARD");
  if (chosen) return chosen;
  if (ws.boards.length === 1) return ws.boards[0]?.id;
  if (!required) return undefined;
  throw new UsageError(
    ws.boards.length === 0
      ? 'no board yet; create one with `sideco board new "Title"`'
      : `which board? pass --board ID (boards: ${ws.boards.map((b) => b.id).join(", ")})`,
  );
}

function chooseBoard(ws: Workspace, id: string | undefined): Board {
  const chosen = id ?? setting("SIDECO_BOARD") ?? (ws.boards.length === 1 ? ws.boards[0]?.id : undefined);
  if (!chosen)
    throw new UsageError(`which board? (boards: ${ws.boards.map((b) => b.id).join(", ") || "none yet"})`);
  const board = findBoard(ws, chosen);
  if (!board)
    throw new UsageError(
      `no board "${chosen}" (boards: ${ws.boards.map((b) => b.id).join(", ") || "none yet"})`,
    );
  return board;
}

/** Whatever arrives on stdin, a hook exits 0 unless it means to wake the agent. */
async function hook(rewake: boolean): Promise<number> {
  let input: unknown;
  try {
    input = JSON.parse(await Bun.stdin.text());
  } catch {
    return 0;
  }
  if (typeof input !== "object" || input === null) return 0;
  const result = await runHook(input as Record<string, unknown>, process.env, rewake);
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  return result.exitCode;
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

/** How many pages follow this companion right now. */
async function watchers(server: Server): Promise<number> {
  return (await get<{ watching?: number }>(server, "/health", 1000)).watching ?? 0;
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

async function statusText(root: string, ws: Workspace): Promise<string> {
  const server = await findServer(root).catch((error: unknown) => {
    if (error instanceof Blocked) return "out of reach from this shell (a sandbox blocks local connections)";
    throw error;
  });
  const session = latestSession(ws);
  const watching = server && typeof server !== "string" ? await watchers(server).catch(() => 0) : 0;
  const page =
    watching > 0
      ? `open in ${watching} window${watching === 1 ? "" : "s"}`
      : "not open (open it with `sideco open`)";
  return [
    `workspace  ${root}`,
    `server     ${typeof server === "string" ? server : server ? server.url : "not running (start it with `sideco open`)"}`,
    `page       ${page}`,
    `journal    seq ${ws.seq}, ${ws.boards.length} board${ws.boards.length === 1 ? "" : "s"}, ${ws.sessions.length} session${ws.sessions.length === 1 ? "" : "s"}`,
    ...(session
      ? [`session    ${sessionLabel(session)} is ${session.status} (all: \`sideco sessions\`)`]
      : []),
    ...ws.boards.map((b) => `board      ${b.id}  ${b.format}  ${b.elements.length} elements`),
  ].join("\n");
}

function exportOne(ws: Workspace, args: Args): number {
  const board = chooseBoard(ws, args.positional[0] ?? args.flags.get("board"));
  const format = EXPORT_FORMATS.find((f) => f === (args.flags.get("format") ?? "md"));
  if (!format) throw new UsageError(`--format is one of: ${EXPORT_FORMATS.join(", ")}`);
  const text = exportBoard(board, format, { exportedAt: new Date().toISOString(), locale: language(args) });
  const out = args.flags.get("out");
  if (out) {
    writeFileSync(out, text);
    console.log(`wrote ${out}`);
  } else {
    process.stdout.write(text);
  }
  return 0;
}

async function publish(root: string, ws: Workspace, args: Args): Promise<number> {
  const out = resolve(args.flags.get("out") ?? join(dataDir(root), "site"));
  const locale = language(args);
  const meta = { exportedAt: new Date().toISOString(), locale };
  mkdirSync(out, { recursive: true });
  for (const board of ws.boards) {
    for (const format of EXPORT_FORMATS) {
      if (format !== "mermaid")
        writeFileSync(join(out, `${board.id}.${EXTENSION[format]}`), exportBoard(board, format, meta));
    }
  }
  const entries = ws.boards.map((b) => ({
    id: b.id,
    title: b.title,
    format: b.format,
    elements: b.elements.length,
  }));
  writeFileSync(join(out, "index.html"), toIndexHtml(WORDS[locale].site, entries, meta));
  // Publishing only writes files; a companion out of reach just leaves the address unsaid.
  const server =
    out === join(dataDir(root), "site") ? await findServer(root).catch(() => undefined) : undefined;
  console.log(
    `published ${ws.boards.length} board${ws.boards.length === 1 ? "" : "s"} to ${out}${server ? `\nserved at ${server.url}/pub/` : ""}`,
  );
  return 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
