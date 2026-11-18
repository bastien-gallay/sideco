import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBatch } from "../../src/cli/argv.ts";
import { type Server, WAIT_LEG_MS } from "../../src/cli/client.ts";
import { CONTEXT_LIMIT, type HookResult, runHook, summarize } from "../../src/cli/hook.ts";
import { parseCommand } from "../../src/domain/commands.ts";
import type { Actor } from "../../src/domain/events.ts";
import { handler } from "../../src/server/http.ts";
import { Hub } from "../../src/server/hub.ts";
import { memoryJournal } from "../../src/server/journal.ts";
import { ORDERING, T0 } from "../support.ts";

const BASE = "http://127.0.0.1:4747";
let dir: string;
let hub: Hub;
let server: Server;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vico-hook-"));
  hub = new Hub(memoryJournal(), () => new Date(T0));
  const handle = handler({ hub, page: "", root: "/repo", siteDir: join(dir, "site") });
  server = {
    url: BASE,
    fetch: (url, init) =>
      handle(new Request(url, { ...init, headers: { host: "127.0.0.1:4747", ...init?.headers } })),
  };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Fires a hook the way Claude Code does: one JSON object, the common fields filled in. */
function fire(
  event: string,
  fields: Record<string, unknown> = {},
  options: { env?: Record<string, string>; rewake?: boolean } = {},
): Promise<HookResult> {
  const input = {
    session_id: "s1",
    transcript_path: "/t.jsonl",
    cwd: "/repo",
    hook_event_name: event,
    permission_mode: "default",
    ...fields,
  };
  return runHook(input, options.env ?? {}, options.rewake ?? false, async () => server);
}

const human = (script: string): void => {
  hub.dispatch(parseBatch(script, "commande").map(parseCommand), { actor: "human" as Actor });
};
const agent = (script: string): void => {
  hub.dispatch(parseBatch(script, "commande").map(parseCommand), { actor: "agent" as Actor, session: "s1" });
};
const session = (): NonNullable<(typeof hub.workspace.sessions)[number]> => {
  const found = hub.workspace.sessions.find((s) => s.id === "s1");
  if (!found) throw new Error("session s1 was not recorded");
  return found;
};
const context = (result: HookResult): string => {
  const parsed = JSON.parse(result.stdout ?? "{}") as { hookSpecificOutput?: { additionalContext?: string } };
  return parsed.hookSpecificOutput?.additionalContext ?? "";
};
const QUIET = { exitCode: 0 };

describe("the session trace", () => {
  test("SessionStart records the session, gives later commands its id, and tells the agent the companion is there", async () => {
    agent(ORDERING);
    const envFile = join(dir, "env");
    writeFileSync(envFile, "export OTHER=1\n");
    const result = await fire("SessionStart", { source: "startup" }, { env: { CLAUDE_ENV_FILE: envFile } });
    expect(session().cwd).toBe("/repo");
    // The session id for later `vico` calls, and the launcher on PATH so the agent can type `vico`.
    const bin = join(import.meta.dir, "..", "..", "bin");
    expect(readFileSync(envFile, "utf8")).toBe(
      `export OTHER=1\nexport VICO_SESSION='s1'\nexport PATH='${bin}':"$PATH"\n`,
    );
    expect(existsSync(join(bin, "vico"))).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(BASE);
    expect(result.stdout).toContain("commande (event-storming)");
    // Nobody looks at the board yet: the agent opens it itself when the user wants to model.
    expect(result.stdout).toContain("The page is not open: run `vico open` before you model with the user.");
  });

  test("SessionStart says when the user already has the page open", async () => {
    hub.subscribe(() => {});
    const result = await fire("SessionStart", { source: "startup" });
    expect(result.stdout).toContain("The user has the page open.");
    expect(result.stdout).not.toContain("vico open");
  });

  test("a prompt opens a turn; tools show as steps with a one-line summary", async () => {
    await fire("UserPromptSubmit", { prompt: "Modélise le passage de commande\navec les règles" });
    await fire("PreToolUse", {
      tool_name: "Read",
      tool_use_id: "t1",
      tool_input: { file_path: "/repo/src/order.ts" },
    });
    await fire("PostToolUse", {
      tool_name: "Read",
      tool_use_id: "t1",
      tool_input: { file_path: "/repo/src/order.ts" },
      tool_response: { content: "…" },
    });
    await fire("PreToolUse", {
      tool_name: "Bash",
      tool_use_id: "t2",
      tool_input: { command: "bun test\n# second line", description: "Run tests" },
    });
    await fire("PostToolUseFailure", {
      tool_name: "Bash",
      tool_use_id: "t2",
      tool_input: { command: "bun test" },
      error: "exit 1",
    });
    const turn = session().turns[0];
    expect(turn?.prompt).toBe("Modélise le passage de commande\navec les règles");
    expect(turn?.tools.map((t) => `${t.tool} ${t.summary} ${t.status}`)).toEqual([
      "Read src/order.ts ok",
      "Bash bun test failed",
    ]);
    expect(session().status).toBe("thinking");
  });

  test("the output of a tool never reaches the journal", async () => {
    await fire("PreToolUse", { tool_name: "Bash", tool_use_id: "t1", tool_input: { command: "cat .env" } });
    await fire("PostToolUse", {
      tool_name: "Bash",
      tool_use_id: "t1",
      tool_input: { command: "cat .env" },
      tool_response: { stdout: "SECRET=hunter2" },
    });
    expect(JSON.stringify(hub.events)).not.toContain("hunter2");
  });

  test("a TodoWrite call becomes the todo list", async () => {
    const todos = [
      { content: "Écrire les tests", status: "completed", activeForm: "Écriture des tests" },
      { content: "Brancher les hooks", status: "in_progress", activeForm: "Branchement" },
      { content: "", status: "pending" },
      { content: "Statut inconnu", status: "blocked" },
      "pas un objet",
    ];
    await fire("PostToolUse", { tool_name: "TodoWrite", tool_use_id: "t1", tool_input: { todos } });
    expect(session().todos).toEqual([
      { text: "Écrire les tests", status: "completed" },
      { text: "Brancher les hooks", status: "in_progress" },
    ]);
  });

  test("tasks created and completed by the harness become todos too", async () => {
    await fire("TaskCreated", { task_id: "7", task_subject: "Publier le site" });
    await fire("TaskCompleted", { task_id: "7", task_subject: "Publier le site" });
    expect(session().todos).toEqual([{ id: "7", text: "Publier le site", status: "completed" }]);
  });

  test("a notification means the agent is waiting for the human; Stop ends the turn", async () => {
    await fire("UserPromptSubmit", { prompt: "go" });
    await fire("Notification", {
      message: "Claude needs your permission to use Bash",
      notification_type: "permission_prompt",
    });
    expect(session()).toMatchObject({
      status: "waiting",
      statusDetail: "Claude needs your permission to use Bash",
    });
    await fire("Stop", { stop_hook_active: false, last_assistant_message: "Fini." });
    expect(session().status).toBe("idle");
    expect(session().turns[0]?.ended).toBe(true);
  });

  test("a long prompt is clipped, not refused", async () => {
    await fire("UserPromptSubmit", { prompt: "x".repeat(5000) });
    expect(session().turns[0]?.prompt).toHaveLength(2000);
  });
});

describe("bringing the human's changes back to the agent", () => {
  beforeEach(() => agent(ORDERING));

  test("the next prompt carries what the human changed on the board, once", async () => {
    human('rename E1 "Commande validée"\nrm H1');
    const first = await fire("UserPromptSubmit", { prompt: "et maintenant ?" });
    expect(JSON.parse(first.stdout ?? "")).toMatchObject({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit" },
    });
    expect(context(first)).toContain('~ E1 renamed "Commande passée" → "Commande validée"');
    expect(context(first)).toContain("− H1 hotspot");
    expect(context(first)).toContain("vico show");
    expect(await fire("UserPromptSubmit", { prompt: "encore" })).toEqual(QUIET);
  });

  test("with nothing changed, a hook says nothing at all", async () => {
    expect(await fire("UserPromptSubmit", { prompt: "bonjour" })).toEqual(QUIET);
    expect(await fire("PreToolUse", { tool_name: "Read", tool_use_id: "t1", tool_input: {} })).toEqual(QUIET);
    expect(await fire("PostToolUse", { tool_name: "Read", tool_use_id: "t1", tool_input: {} })).toEqual(
      QUIET,
    );
  });

  test("mid-turn, the agent is interrupted only when the human hands over", async () => {
    human('rename E1 "Commande validée"');
    expect(await fire("PostToolUse", { tool_name: "Read", tool_use_id: "t1", tool_input: {} })).toEqual(
      QUIET,
    );
    human('pass --to agent "regarde E1"');
    const told = await fire("PostToolUse", { tool_name: "Read", tool_use_id: "t2", tool_input: {} });
    expect(JSON.parse(told.stdout ?? "")).toMatchObject({
      hookSpecificOutput: { hookEventName: "PostToolUse" },
    });
    expect(context(told)).toContain("Commande validée");
    expect(context(told)).toContain("The human passed you the turn: regarde E1");
    expect(await fire("PostToolUse", { tool_name: "Read", tool_use_id: "t3", tool_input: {} })).toEqual(
      QUIET,
    );
  });

  test("the context stays under Claude Code's cap, and says it was cut", async () => {
    human(
      Array.from(
        { length: 120 },
        (_, i) => `add event "${"Événement très détaillé ".repeat(6)}${i}" --col ${i + 3}`,
      ).join("\n"),
    );
    const told = context(await fire("UserPromptSubmit", { prompt: "go" }));
    expect(told.length).toBeLessThanOrEqual(CONTEXT_LIMIT);
    expect(CONTEXT_LIMIT).toBeLessThanOrEqual(10_000);
    expect(told).toContain("more lines were cut");
    expect(told).toContain("vico show");
  });

  test("with no page open nobody can hand over, so nothing is parked", async () => {
    expect(await fire("Stop", {}, { rewake: true })).toEqual(QUIET);
    expect(hub.listening).toBe(0);
  });

  test("an unattended session (claude -p) is never parked: it must be free to exit", async () => {
    hub.subscribe(() => {});
    const result = await fire("Stop", {}, { rewake: true, env: { CLAUDE_CODE_SESSION_ATTENDED: "0" } });
    expect(result).toEqual(QUIET);
    expect(hub.listening).toBe(0);
  });

  test("an idle agent is woken when the human hands over: exit code 2, the changes on stderr", async () => {
    hub.subscribe(() => {});
    const parked = fire("Stop", {}, { rewake: true });
    await Bun.sleep(5);
    expect(hub.listening).toBe(1);
    human('rename E1 "Commande validée"\npass --to agent');
    const woken = await parked;
    expect(woken.exitCode).toBe(2);
    expect(woken.stderr).toContain("Commande validée");
    expect(woken.stderr).toContain("The human passed you the turn.");
    expect(woken.stdout).toBeUndefined();
  });

  test("an agent idle for long stays parked: one short request after another, until the hand-over", async () => {
    const asked: number[] = [];
    const answers = ["timeout", "timeout", "passed"];
    const slow: Server = {
      url: BASE,
      fetch: async (url) => {
        const query = new URL(String(url)).searchParams;
        expect(query.get("watched")).toBe("1");
        asked.push(Number(query.get("timeout")));
        const outcome = answers.shift() ?? "timeout";
        return Response.json({ outcome, text: outcome === "passed" ? "The human passed you the turn." : "" });
      },
    };
    const input = { session_id: "s1", cwd: "/repo", hook_event_name: "Stop" };
    const woken = await runHook(input, {}, true, async () => slow);
    expect(woken.exitCode).toBe(2);
    expect(woken.stderr).toContain("The human passed you the turn.");
    expect(asked).toEqual([WAIT_LEG_MS, WAIT_LEG_MS, WAIT_LEG_MS]);
  });

  test("a parked hook leaves quietly when the human types in the terminal instead", async () => {
    hub.subscribe(() => {});
    const parked = fire("Stop", {}, { rewake: true });
    await Bun.sleep(5);
    await fire("UserPromptSubmit", { prompt: "je reprends ici" });
    expect(await parked).toEqual(QUIET);
  });

  test("a parked hook leaves quietly when the session ends: nobody is left to wake", async () => {
    hub.subscribe(() => {});
    const parked = fire("Stop", {}, { rewake: true });
    await Bun.sleep(5);
    expect(hub.listening).toBe(1);
    await fire("SessionEnd", { reason: "prompt_input_exit" });
    expect(await parked).toEqual(QUIET);
    expect(hub.listening).toBe(0);
    expect(hub.workspace.sessions[0]?.status).toBe("ended");
  });

  test("parking records nothing: the turn end is the other Stop hook's job", async () => {
    const seq = hub.workspace.seq;
    hub.subscribe(() => {});
    const parked = fire("Stop", {}, { rewake: true });
    await Bun.sleep(5);
    expect(hub.workspace.seq).toBe(seq);
    hub.abandon("s1");
    await parked;
  });
});

describe("diagrams in the agent's reply", () => {
  const reply =
    "Voici le flux :\n\n```mermaid\nflowchart TD\n  A[Recevoir] --> B{En stock ?}\n  B -->|oui| C([Expédier])\n```\n";

  test("a flowchart in the last message becomes an editable board", async () => {
    await fire("Stop", { last_assistant_message: reply });
    const board = hub.workspace.boards[0];
    expect(board).toMatchObject({ format: "flow", title: "Capture · Recevoir" });
    expect(board?.elements.map((e) => e.label)).toEqual(["Recevoir", "En stock ?", "Expédier"]);
    expect(board?.elements.every((e) => e.by === "agent")).toBe(true);
  });

  test("the same diagram is captured once", async () => {
    await fire("Stop", { last_assistant_message: reply });
    await fire("Stop", { last_assistant_message: reply });
    expect(hub.workspace.boards).toHaveLength(1);
  });
});

describe("a hook never gets in the agent's way", () => {
  test("no companion for this project: silence", async () => {
    const result = await runHook(
      { session_id: "s1", cwd: "/elsewhere", hook_event_name: "UserPromptSubmit", prompt: "x" },
      {},
      false,
      async () => undefined,
    );
    expect(result).toEqual(QUIET);
  });

  test("a companion that fails or answers nonsense: silence", async () => {
    const broken: Server = {
      url: BASE,
      fetch: async () => {
        throw new Error("connection refused");
      },
    };
    const garbled: Server = {
      url: BASE,
      fetch: async () => new Response("<html>oops</html>", { status: 502 }),
    };
    for (const failing of [broken, garbled]) {
      for (const event of ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop"]) {
        const result = await runHook(
          { session_id: "s1", cwd: "/repo", hook_event_name: event, prompt: "x" },
          {},
          false,
          async () => failing,
        );
        expect(result).toEqual(QUIET);
      }
    }
    expect(
      await runHook(
        { session_id: "s1", cwd: "/repo", hook_event_name: "Stop" },
        {},
        true,
        async () => broken,
      ),
    ).toEqual(QUIET);
  });

  test("an input without a session, or an event this build does not know: silence, nothing recorded", async () => {
    expect(
      await runHook(
        { cwd: "/repo", hook_event_name: "UserPromptSubmit", prompt: "x" },
        {},
        false,
        async () => server,
      ),
    ).toEqual(QUIET);
    expect(await fire("PreCompact", { trigger: "auto" })).toEqual(QUIET);
    expect(hub.workspace.seq).toBe(0);
  });

  test("only SessionStart may start the companion; the other hooks use it if it runs", async () => {
    const asked: boolean[] = [];
    const locate = async (_cwd: string, start: boolean): Promise<Server | undefined> => {
      asked.push(start);
      return server;
    };
    const input = { session_id: "s1", cwd: "/repo" };
    await runHook({ ...input, hook_event_name: "SessionStart" }, {}, false, locate);
    await runHook({ ...input, hook_event_name: "UserPromptSubmit", prompt: "x" }, {}, false, locate);
    await runHook({ ...input, hook_event_name: "Stop" }, {}, false, locate);
    expect(asked).toEqual([true, false, false]);
  });
});

describe("summarize", () => {
  test.each([
    [{ tool_input: { file_path: "/repo/src/a.ts" } }, "src/a.ts"],
    [{ tool_input: { file_path: "/elsewhere/b.ts" } }, "../elsewhere/b.ts"],
    [{ tool_input: { command: "git status\n&& echo done" } }, "git status"],
    [{ tool_input: { pattern: "TODO", path: "/repo/src" } }, "TODO in src"],
    [{ tool_input: { pattern: "TODO" } }, "TODO"],
    [{ tool_input: { description: "Explore the layout code", prompt: "long…" } }, "Explore the layout code"],
    [{ tool_input: { url: "https://example.com" } }, "https://example.com"],
    [{ tool_input: {} }, ""],
    [{}, ""],
    [{ tool_input: "not an object" }, ""],
  ])("%j → %j", (input, summary) => {
    expect(summarize(input, "/repo")).toBe(summary);
  });

  test("is clipped to one short line", () => {
    const summary = summarize({ tool_input: { command: "x".repeat(500) } }, "/repo");
    expect(summary).toHaveLength(200);
    expect(summary.endsWith("…")).toBe(true);
  });
});
