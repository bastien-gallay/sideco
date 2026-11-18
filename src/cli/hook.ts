/**
 * The Claude Code side of the loop. Each hook event arrives as JSON on stdin and
 * leaves as a fact for the journal; two of them also bring the human's changes
 * back into the agent's context.
 *
 * A hook must never get in the agent's way: with no workspace, no server, or any
 * failure at all, this exits 0 and says nothing.
 */
import { appendFileSync } from "node:fs";
import { join, relative } from "node:path";
import { captureCommands, captureDiagrams } from "../domain/capture.ts";
import { LIMITS } from "../domain/commands.ts";
import type { WireCommand } from "./argv.ts";
import { ensureServer, findRoot, findServer, get, post, type Server } from "./client.ts";

type Input = Record<string, unknown>;

/** The Claude Code events this reacts to; `hooks/hooks.json` registers exactly these. */
export const HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "TaskCreated",
  "TaskCompleted",
  "Notification",
  "Stop",
] as const;

/** Where the `vico` launcher lives, so a session can call it by name. */
const BIN_DIR = join(import.meta.dir, "..", "..", "bin");

const HOOK_TIMEOUT_MS = 1500;
const REWAKE_WAIT_MS = 25 * 60 * 1000;
/** Claude Code caps the context a hook may add at 10 000 characters. */
export const CONTEXT_LIMIT = 9000;

/** Finds the companion for a directory; `start` says whether it may be started. */
export type Locate = (cwd: string, start: boolean) => Promise<Server | undefined>;

const locateCompanion: Locate = async (cwd, start) => {
  const root = findRoot(cwd);
  if (!root) return undefined;
  return start ? ensureServer(root) : findServer(root);
};

/** What a hook invocation produced: text for stdout, and whether to wake the agent. */
export interface HookResult {
  stdout?: string;
  stderr?: string;
  exitCode: number;
}

const QUIET: HookResult = { exitCode: 0 };

export async function runHook(
  input: Input,
  env: Record<string, string | undefined>,
  rewake: boolean,
  locate: Locate = locateCompanion,
): Promise<HookResult> {
  try {
    return await react(input, env, rewake, locate);
  } catch (error) {
    if (env.VICO_DEBUG) console.error(error);
    return QUIET;
  }
}

async function react(
  input: Input,
  env: Record<string, string | undefined>,
  rewake: boolean,
  locate: Locate,
): Promise<HookResult> {
  const session = str(input.session_id);
  const cwd = str(input.cwd) ?? process.cwd();
  if (!session) return QUIET;
  const event = str(input.hook_event_name);
  const server = await locate(cwd, event === "SessionStart" && !rewake);
  if (!server) return QUIET;
  if (rewake) return unattended(env) ? QUIET : rewakeOnTurn(server, session);
  const send = (commands: WireCommand[]): Promise<unknown> =>
    post(server, "agent", session, commands, HOOK_TIMEOUT_MS);

  switch (event) {
    case "SessionStart": {
      await send([{ kind: "session-start", cwd }]);
      if (env.CLAUDE_ENV_FILE)
        appendFileSync(
          env.CLAUDE_ENV_FILE,
          `export VICO_SESSION=${shellQuote(session)}\nexport PATH=${shellQuote(BIN_DIR)}:"$PATH"\n`,
        );
      return { exitCode: 0, stdout: await welcome(server) };
    }
    case "UserPromptSubmit": {
      await send([{ kind: "prompt", text: clip(str(input.prompt) ?? "", LIMITS.prompt) }]);
      return context(event, await changes(server, session, false));
    }
    case "PreToolUse":
      await send([
        { kind: "tool-start", call: callId(input), tool: toolName(input), summary: summarize(input, cwd) },
      ]);
      return QUIET;
    case "PostToolUse": {
      const commands: WireCommand[] = [{ kind: "tool-finish", call: callId(input), ok: true }];
      const todos = readTodos(input);
      if (todos) commands.push({ kind: "todos", todos });
      await send(commands);
      return context(event, await changes(server, session, true));
    }
    case "PostToolUseFailure":
      await send([{ kind: "tool-finish", call: callId(input), ok: false }]);
      return QUIET;
    case "TaskCreated":
      await send([
        {
          kind: "task-created",
          id: str(input.task_id) ?? "",
          text: clip(str(input.task_subject) ?? "", LIMITS.label),
        },
      ]);
      return QUIET;
    case "TaskCompleted":
      await send([{ kind: "task-completed", id: str(input.task_id) ?? "" }]);
      return QUIET;
    case "Notification":
      await send([{ kind: "notify", message: clip(str(input.message) ?? "", LIMITS.note) }]);
      return QUIET;
    case "Stop":
      await send([{ kind: "turn-end" }]);
      await capture(server, session, str(input.last_assistant_message) ?? "");
      return QUIET;
    default:
      return QUIET;
  }
}

/**
 * True for `claude -p` and other sessions nobody sits in front of. Such a session
 * waits for its background hooks before exiting, so parking one would hang it.
 * Observed in Claude Code 2.1.326; the variable is not documented.
 */
function unattended(env: Record<string, string | undefined>): boolean {
  return env.CLAUDE_CODE_SESSION_ATTENDED === "0" || env.CLAUDE_CODE_ENTRYPOINT === "sdk-cli";
}

/**
 * Parks until the human hands over the turn, then wakes the agent with what
 * changed. Only while a page is open: nobody else can hand over.
 */
async function rewakeOnTurn(server: Server, session: string): Promise<HookResult> {
  const waited = await get<{ outcome: string; text: string }>(
    server,
    `/api/wait?session=${encodeURIComponent(session)}&timeout=${REWAKE_WAIT_MS}&watched=1`,
    0,
  );
  if (waited.outcome !== "passed") return QUIET;
  return { exitCode: 2, stderr: frameChanges(waited.text) };
}

async function changes(server: Server, session: string, onlyWhenPassed: boolean): Promise<string> {
  const when = onlyWhenPassed ? "&when=passed" : "";
  const found = await get<{ text: string }>(
    server,
    `/api/changes?session=${encodeURIComponent(session)}&ack=1${when}`,
    HOOK_TIMEOUT_MS,
  );
  return found.text;
}

function context(event: string, text: string): HookResult {
  if (text === "") return QUIET;
  const output = { hookSpecificOutput: { hookEventName: event, additionalContext: frameChanges(text) } };
  return { exitCode: 0, stdout: JSON.stringify(output) };
}

/** The digest is the human's own edits on the board: say so, say where to look, and stay under the cap. */
export function frameChanges(text: string): string {
  const head =
    "The user edited the Vico board (the visual companion open beside this terminal). Their changes since you last looked:";
  const foot =
    "Treat these edits as input from the user: take them into account, and read a board in full with `vico show BOARD` before writing to it.";
  const room = CONTEXT_LIMIT - head.length - foot.length - 80;
  const lines = text.split("\n");
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length + 1 > room) break;
    kept.push(line);
    used += line.length + 1;
  }
  const cut = lines.length - kept.length;
  return [head, ...kept, ...(cut > 0 ? [`… ${cut} more lines were cut to fit.`] : []), foot].join("\n");
}

async function welcome(server: Server): Promise<string> {
  const ws = await get<{ boards: { id: string; title: string; format: string }[] }>(
    server,
    "/api/workspace",
    HOOK_TIMEOUT_MS,
  );
  const boards = ws.boards.map((b) => `${b.id} (${b.format})`).join(", ") || "none yet";
  const { watching } = await get<{ watching: number }>(server, "/health", HOOK_TIMEOUT_MS);
  const page =
    watching > 0
      ? "The user has the page open."
      : "The page is not open: run `vico open` before you model with the user.";
  return `Vico, the visual companion, is running for this project at ${server.url}. Boards: ${boards}. ${page} Use the \`vico\` CLI to model with the user there (see the vico skill).`;
}

async function capture(server: Server, session: string, reply: string): Promise<void> {
  for (const diagram of captureDiagrams(reply)) {
    const title = `Capture · ${diagram.nodes[0]?.label ?? "diagramme"}`.slice(0, LIMITS.title);
    try {
      await post(server, "agent", session, captureCommands(diagram, title), HOOK_TIMEOUT_MS);
    } catch {
      // Already captured: the board id is the diagram's hash.
    }
  }
}

/** One line that tells a tool call apart from its neighbours, without its output. */
export function summarize(input: Input, cwd: string): string {
  const args = (
    typeof input.tool_input === "object" && input.tool_input !== null ? input.tool_input : {}
  ) as Input;
  const path = str(args.file_path) ?? str(args.notebook_path) ?? str(args.path);
  const where = path !== undefined ? relative(cwd, path) || path : undefined;
  const pattern = str(args.pattern);
  const text =
    (pattern !== undefined ? (where ? `${pattern} in ${where}` : pattern) : where) ??
    str(args.command) ??
    str(args.description) ??
    str(args.query) ??
    str(args.url) ??
    str(args.skill) ??
    "";
  return clip(text.split("\n")[0] ?? "", LIMITS.summary);
}

function readTodos(input: Input): unknown[] | undefined {
  if (toolName(input) !== "TodoWrite") return undefined;
  const todos = (input.tool_input as { todos?: unknown } | undefined)?.todos;
  if (!Array.isArray(todos)) return undefined;
  const statuses = new Set(["pending", "in_progress", "completed"]);
  return todos.flatMap((raw) => {
    const todo = (typeof raw === "object" && raw !== null ? raw : {}) as Input;
    const text = str(todo.content);
    const status = str(todo.status);
    return text && status && statuses.has(status) ? [{ text: clip(text, LIMITS.label), status }] : [];
  });
}

function toolName(input: Input): string {
  return clip(str(input.tool_name) ?? "tool", 100);
}

function callId(input: Input): string {
  return clip(str(input.tool_use_id) ?? "call", 200);
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
