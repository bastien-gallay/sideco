#!/usr/bin/env bun
/**
 * `vico`: the companion from the terminal. Reading commands replay the journal
 * from disk and need no server; writing commands go through the running
 * companion, which is started on demand.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { slugify } from "../domain/commands.ts";
import { describeBoard } from "../domain/digest.ts";
import { toIndexHtml } from "../domain/export/html.ts";
import { EXPORT_FORMATS, EXTENSION, exportBoard } from "../domain/export/index.ts";
import { fromModel } from "../domain/export/model.ts";
import { FORMATS } from "../domain/formats.ts";
import { asLocale, DEFAULT_LOCALE, LOCALES, type Locale, WORDS } from "../domain/i18n.ts";
import { type Board, findBoard, latestSession, replay, type Workspace } from "../domain/workspace.ts";
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

const HELP = `vico — a visual companion for Claude Code

  vico open                         start the companion if needed and show the page (a page already open is left alone)
  vico url                          print its address
  vico serve [--port N] [--lang L]  run it in the foreground
  vico stop                         stop the companion; the journal stays
  vico init                         create a workspace (.vico/) here
  vico status                       boards, sessions, server

Model (BOARD defaults to the only board, or --board ID, or $VICO_BOARD)
  vico formats                      the workshops and their element types
  vico board new "Title" [--format F] [--id ID]
  vico board rm ID                  remove a board; its history stays in the journal
  vico boards
  vico show [BOARD]                 a board as text
  vico add TYPE "Label" [--col N | --lane L] [--id E1] [--from ID [--edge "label"]] [--detail "…"]
  vico rename ID "Label"            vico detail ID "Text"
  vico move ID --col N | --lane L [--before ID]
  vico rm ID                        vico insert-col N
  vico link SRC DST ["label"]       vico unlink SRC DST
  vico focus [ID…] [--why "…"]      no id clears the focus
  vico note "Text" [--on ID]        open a discussion, on the board or on one element
  vico reply N1 "Text"              answer in the thread of a note
  vico resolve N1                   close the thread
  vico apply [FILE]                 run a batch of the commands above, all or nothing (stdin by default)

Work with the human
  vico changes                      what the human changed since you last asked
  vico pass ["message"]             hand the turn to the human
  vico wait [--timeout SECONDS]     block until the human hands it back, then print their changes

Share
  vico export [BOARD] --format md|html|svg|mermaid|json [-o FILE] [--lang L]
  vico import FILE [--id ID]        a model.json (faceto files load as they are)
  vico publish [--out DIR] [--lang L]  every board as a static site

Options: --as human|agent   --session ID   --board ID

Language: this terminal speaks English. The page and the exports are in English too,
or in French with --lang fr or VICO_LANG=fr; in the page, each reader picks their own.
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
  "boards",
  "show",
  "export",
  "publish",
  "changes",
  "wait",
  "apply",
  "import",
]);

export async function main(argv: string[]): Promise<number> {
  const [verb = "help", ...rest] = argv;
  try {
    return await run(verb, rest);
  } catch (error) {
    if (error instanceof UsageError || error instanceof ClientError) {
      console.error(`vico: ${error.message}`);
      return 1;
    }
    if (isSystemError(error)) {
      console.error(`vico: ${error.message}`);
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
  if (!root) throw new UsageError("no Vico workspace here or above; run `vico init` or `vico open`");
  const read = (): Workspace => replay(openJournal(dataDir(root)).load());

  switch (verb) {
    case "url":
      console.log((await ensureServer(root)).url);
      return 0;
    case "open": {
      const server = await ensureServer(root);
      console.log(server.url);
      // Safe to repeat, so an agent can run it before modelling: a page already open is left alone.
      if ((await watchers(server)) > 0) {
        console.log("already open in the browser");
        return 0;
      }
      // This shell first; failing that the companion, which the plugin starts outside any sandbox.
      if (!((await openBrowser(server.url)) || (await showPage(server))))
        throw new ClientError(
          "could not open the browser, from this shell or from the companion (a sandbox blocks it, or no browser is set). Run `vico open` outside the sandbox, or give the user the address above.",
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
    case "show":
      console.log(describeBoard(chooseBoard(read(), args.positional[0] ?? args.flags.get("board"))));
      return 0;
    case "export":
      return exportOne(read(), args);
    case "publish":
      return publish(root, read(), args);
  }

  const server = await ensureServer(root);
  const actor = args.flags.get("as") ?? setting("VICO_ACTOR") ?? "agent";
  const session = args.flags.get("session") ?? setting("VICO_SESSION") ?? latestSession(read())?.id;

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
          : `no hand-over yet (${waited.outcome}); run \`vico wait\` again to keep listening`,
      );
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
      if (!file) throw new UsageError("usage: vico import FILE [--id ID]");
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

  if (!BOARD_VERBS.has(verb)) throw new UsageError(`unknown command "${verb}" (try \`vico help\`)`);
  // `board new` and `board rm` name their board themselves: no default applies.
  const action = boardAction(
    [verb, ...rest.filter((_token, i) => !isGlobalFlag(rest, i))],
    verb === "board" ? undefined : defaultBoard(read(), args, true),
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

/** An environment variable; set but empty counts as not set. */
function setting(name: string): string | undefined {
  return process.env[name] || undefined;
}

/**
 * The language of what a human will read (an export, the page a companion
 * opens in): `--lang`, else `$VICO_LANG`, else English. What the agent reads
 * on this terminal stays English.
 */
function language(args: Args): Locale {
  const asked = args.flags.get("lang");
  if (asked === undefined) return asLocale(setting("VICO_LANG")) ?? DEFAULT_LOCALE;
  const locale = asLocale(asked);
  if (!locale) throw new UsageError(`--lang is one of: ${LOCALES.join(", ")}`);
  return locale;
}

const GLOBAL_FLAGS = new Set(["--as", "--session"]);

/** True for `--as`/`--session` and their values, which are not part of the command itself. */
function isGlobalFlag(tokens: string[], index: number): boolean {
  return GLOBAL_FLAGS.has(tokens[index] ?? "") || GLOBAL_FLAGS.has(tokens[index - 1] ?? "");
}

function defaultBoard(ws: Workspace, args: Args, required: boolean): string | undefined {
  const chosen = args.flags.get("board") ?? setting("VICO_BOARD");
  if (chosen) return chosen;
  if (ws.boards.length === 1) return ws.boards[0]?.id;
  if (!required) return undefined;
  throw new UsageError(
    ws.boards.length === 0
      ? 'no board yet; create one with `vico board new "Title"`'
      : `which board? pass --board ID (boards: ${ws.boards.map((b) => b.id).join(", ")})`,
  );
}

function chooseBoard(ws: Workspace, id: string | undefined): Board {
  const chosen = id ?? setting("VICO_BOARD") ?? (ws.boards.length === 1 ? ws.boards[0]?.id : undefined);
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
  const port = Number(args.flags.get("port") ?? setting("VICO_PORT") ?? DEFAULT_PORT);
  const running = await start(root, port, { show: openBrowser, locale: language(args) });
  console.log(`vico is serving ${root}\n  ${running.url}`);
  const stop = (): void => {
    running.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise(() => {});
  return 0;
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
    const types = f.types.map((t) => `    ${t.id.padEnd(10)} ${t.prefix}  ${t.hint.en}`).join("\n");
    return `${f.id} — ${f.name.en}: ${f.purpose.en}\n  ${place}\n${types}`;
  }).join("\n\n");
}

function boardsText(ws: Workspace): string {
  if (ws.boards.length === 0) return 'no board yet; create one with `vico board new "Title"`';
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
      : "not open (open it with `vico open`)";
  return [
    `workspace  ${root}`,
    `server     ${typeof server === "string" ? server : server ? server.url : "not running (start it with `vico open`)"}`,
    `page       ${page}`,
    `journal    seq ${ws.seq}, ${ws.boards.length} board${ws.boards.length === 1 ? "" : "s"}, ${ws.sessions.length} session${ws.sessions.length === 1 ? "" : "s"}`,
    ...(session ? [`session    ${session.id} is ${session.status}`] : []),
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
