/**
 * The agent's day, through the real binary and a real companion on a real port:
 * what `tests/unit` cannot see (process start-up, the server note, stdin, exit codes).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const VICO = join(import.meta.dir, "..", "..", "bin", "vico");

let root: string;
let url: string;

interface Ran {
  code: number;
  out: string;
  err: string;
}

async function vico(
  args: string[],
  options: { stdin?: string; env?: Record<string, string>; cwd?: string } = {},
): Promise<Ran> {
  const child = Bun.spawn([VICO, ...args], {
    cwd: options.cwd ?? root,
    env: {
      ...process.env,
      VICO_PORT: "0",
      VICO_SESSION: "",
      VICO_BOARD: "",
      VICO_ACTOR: "",
      VICO_LANG: "",
      // No test opens a real browser window: the opener is a command that does nothing.
      BROWSER: "true",
      // These tests may themselves run inside a Claude Code session: start from an attended one.
      CLAUDE_CODE_SESSION_ATTENDED: "1",
      CLAUDE_CODE_ENTRYPOINT: "cli",
      ...options.env,
    },
    stdin: options.stdin === undefined ? "ignore" : new Blob([options.stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, out: out.trim(), err: err.trim() };
}

/** What the page does when the human edits: a batch posted as `human`. */
async function human(...commands: object[]): Promise<Response> {
  return fetch(`${url}/api/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actor: "human", commands }),
  });
}

function hook(payload: object, env: Record<string, string> = {}, rewake = false): Promise<Ran> {
  return vico(rewake ? ["hook", "--rewake"] : ["hook"], {
    stdin: JSON.stringify({ session_id: "s1", cwd: root, ...payload }),
    env,
  });
}

const note = (): { url: string; pid: number } =>
  JSON.parse(readFileSync(join(root, ".vico", "server.json"), "utf8"));

function stopCompanion(): void {
  if (!existsSync(join(root, ".vico", "server.json"))) return;
  try {
    process.kill(note().pid);
  } catch {
    // Already gone.
  }
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "vico-cli-")));
});

afterAll(() => {
  stopCompanion();
  rmSync(root, { recursive: true, force: true });
});

describe("a workspace", () => {
  test("outside one, a command says how to make one", async () => {
    const ran = await vico(["boards"]);
    expect(ran.code).toBe(1);
    expect(ran.err).toBe("vico: no Vico workspace here or above; run `vico init` or `vico open`");
  });

  test("a hook outside a workspace is silent and harmless", async () => {
    expect(await hook({ hook_event_name: "UserPromptSubmit", prompt: "bonjour" })).toEqual({
      code: 0,
      out: "",
      err: "",
    });
  });

  test("init creates it, with the session traces kept out of git", async () => {
    const ran = await vico(["init"]);
    expect(ran).toEqual({ code: 0, out: `workspace ready: ${join(root, ".vico")}`, err: "" });
    expect(readFileSync(join(root, ".vico", ".gitignore"), "utf8")).toContain("sessions.jsonl");
    expect((await vico(["status"])).out).toContain("server     not running");
  });
});

describe("the agent models from the terminal", () => {
  test("the first write starts the companion and prints where to look", async () => {
    const ran = await vico(["board", "new", "Passage de commande", "--format", "event-storming"]);
    expect(ran.err).toBe("");
    expect(ran.out).toMatch(/^passage-de-commande \(http:\/\/127\.0\.0\.1:\d+\/#\/b\/passage-de-commande\)$/);
    url = note().url;
    const health = (await (await fetch(`${url}/health`)).json()) as { name: string; workspace: string };
    expect(health).toMatchObject({ name: "vico", workspace: root });
  });

  test("the page is one self-contained document", async () => {
    const response = await fetch(url);
    const page = await response.text();
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(page).toContain('<div id="app">');
    expect(page).not.toMatch(/<script[^>]+src=|<link[^>]+stylesheet/);
  });

  test("single commands print the id they minted", async () => {
    expect((await vico(["add", "actor", "Client", "--col", "1"])).out).toBe("X1");
    expect((await vico(["add", "command", "Passer commande", "--col", "1"])).out).toBe("C1");
  });

  test("a batch on stdin is applied whole and reports its ids", async () => {
    const ran = await vico(["apply"], {
      stdin:
        'add event "Commande passée" --col 1\nadd policy "Réserver le stock" --col 2\nlink C1 E1\nlink E1 P1\n',
    });
    expect(ran).toEqual({ code: 0, out: "applied 4 commands (seq 7): E1 P1", err: "" });
  });

  test("a batch with one bad line changes nothing and names the line", async () => {
    const ran = await vico(["apply"], { stdin: 'add event "Payée" --col 3\nlink E2 Z9\n' });
    expect(ran.code).toBe(1);
    expect(ran.err).toStartWith("vico: command 2: ");
    expect((await vico(["show"])).out).not.toContain("Payée");
  });

  test("a batch names the cards it adds and links them in the same round trip", async () => {
    const ran = await vico(["apply"], {
      stdin: `board new "Checkout" --id checkout
add event "Order placed" --col 1 --alias placed
add policy "Reserve stock" --col 2 --alias reserve
link @placed @reserve
detail @placed "Emitted by the checkout"
note "Is the stock checked first?" --on @reserve
add command "Pay" --col 3 --from @placed
`,
    });
    expect(ran).toEqual({ code: 0, out: "applied 7 commands (seq 15): E1 P1 N1 C1", err: "" });
    const shown = (await vico(["show", "checkout"])).out;
    for (const piece of ["E1 -> P1", "E1 -> C1", "Emitted by the checkout", "N1 by agent on P1"])
      expect(shown).toContain(piece);
    expect(readFileSync(join(root, ".vico", "boards.jsonl"), "utf8")).not.toContain("@placed");
  });

  test("a batch that refers to a name it never gave changes nothing and names the line", async () => {
    try {
      const before = (await vico(["show", "checkout"])).out;
      const ran = await vico(["apply", "--board", "checkout"], {
        stdin: 'add event "Shipped" --col 4 --alias shipped\nlink @shipped @nowhere\n',
      });
      expect(ran).toEqual({
        code: 1,
        out: "",
        err: "vico: command 2: nothing is named @nowhere earlier in this batch (names so far: shipped)",
      });
      expect(before).toContain("Order placed");
      expect((await vico(["show", "checkout"])).out).toBe(before);
    } finally {
      // The tests below write to the only board there is.
      await vico(["board", "rm", "checkout"]);
    }
  });

  test("formats lists the workshops, and what each lane of impact / effort stands for", async () => {
    const listed = (await vico(["formats"])).out;
    expect(listed).toContain("impact-effort — Impact / Effort: ");
    expect(listed).toContain("place with --lane quick|bet|fill|avoid");
    expect(listed).toContain("    quick      Quick wins: High impact · low effort");
    expect(listed).toContain("    avoid      Avoid: Low impact · high effort");
    // A lane whose name says it all is not spelled out.
    expect(listed).not.toContain("    todo ");
  });

  test("show prints the board as the agent reads it", async () => {
    const shown = (await vico(["show"])).out;
    expect(shown).toContain("Passage de commande");
    for (const piece of ["X1", "C1", "E1", "P1", "C1 -> E1", "E1 -> P1"]) expect(shown).toContain(piece);
  });

  test("a mistake is explained on stderr with exit code 1", async () => {
    const ran = await vico(["add", "wizard", "Merlin"]);
    expect(ran.code).toBe(1);
    expect(ran.err).toStartWith("vico: ");
    expect(ran.out).toBe("");
  });
});

describe("the human answers on the board", () => {
  test("their edits come back as a digest, once", async () => {
    const posted = await human(
      { kind: "rename", board: "passage-de-commande", id: "E1", label: "Commande validée" },
      {
        kind: "add",
        board: "passage-de-commande",
        type: "hotspot",
        label: "Et si le stock manque ?",
        col: 2,
      },
    );
    expect(posted.status).toBe(200);

    const changes = (await vico(["changes"])).out;
    expect(changes).toContain("~ E1");
    expect(changes).toContain("Commande validée");
    expect(changes).toContain("+ H1");
    expect((await vico(["changes"])).out).toBe("no change from the human since you last asked");
  });

  test("wait blocks until the human hands the turn over, then prints what they did", async () => {
    const waiting = vico(["wait", "--timeout", "20"]);
    let listening = 0;
    for (let attempt = 0; attempt < 50 && listening === 0; attempt++) {
      await Bun.sleep(100);
      listening = ((await (await fetch(`${url}/health`)).json()) as { listening?: number }).listening ?? 0;
    }
    expect(listening).toBe(1);

    await human(
      { kind: "move", board: "passage-de-commande", id: "H1", col: 1 },
      { kind: "pass", board: "passage-de-commande", to: "agent", message: "à toi" },
    );
    const ran = await waiting;
    expect(ran.code).toBe(0);
    expect(ran.out).toContain("H1");
    expect(ran.out).toContain("à toi");
  }, 30_000);

  test("wait gives up politely at its timeout", async () => {
    const ran = await vico(["wait", "--timeout", "0.3"]);
    expect(ran.code).toBe(0);
    expect(ran.out).toContain("no hand-over yet");
  });
});

describe("Claude Code hooks, through stdin as Claude Code calls them", () => {
  test("SessionStart links the session, tells Claude where the board is and exports the session id", async () => {
    const envFile = join(root, "claude-env");
    const ran = await hook(
      { hook_event_name: "SessionStart", source: "startup" },
      { CLAUDE_ENV_FILE: envFile },
    );
    expect(ran.code).toBe(0);
    expect(ran.out).toContain(url);
    expect(ran.out).toContain("passage-de-commande (event-storming)");
    expect(readFileSync(envFile, "utf8")).toStartWith("export VICO_SESSION='s1'\nexport PATH='");
  });

  test("UserPromptSubmit hands Claude the human's edits as additional context", async () => {
    await human({ kind: "note", board: "passage-de-commande", text: "Qui réserve ?", target: "P1" });
    const ran = await hook({ hook_event_name: "UserPromptSubmit", prompt: "Continue le modèle" });
    expect(ran.code).toBe(0);
    const output = JSON.parse(ran.out) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    expect(output.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    expect(output.hookSpecificOutput.additionalContext).toContain("Qui réserve ?");
  });

  test("Claude answers a note in its thread, and reads the thread back", async () => {
    const replied = await vico(["reply", "N1", "L'entrepôt", "--board", "passage-de-commande"]);
    expect(replied.code).toBe(0);
    expect(replied.out.trim()).toBe("N2");
    const shown = await vico(["show", "passage-de-commande"]);
    expect(shown.out).toContain("  N1 by human on P1: Qui réserve ?\n    N2 by agent: L'entrepôt");
    const refused = await vico(["reply", "N9", "x", "--board", "passage-de-commande"]);
    expect(refused.code).not.toBe(0);
    expect(refused.err).toContain("no note N9");
  });

  test("tool calls and the end of the turn land in the session, visible in status", async () => {
    await hook({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_use_id: "t1",
      tool_input: { command: "bun test" },
    });
    expect((await vico(["status"])).out).toContain("session    s1 is running");
    await hook({
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_use_id: "t1",
      tool_response: "secret output",
    });
    await hook({ hook_event_name: "Stop", last_assistant_message: "Voilà." });
    expect((await vico(["status"])).out).toContain("session    s1 is idle");
    expect(readFileSync(join(root, ".vico", "sessions.jsonl"), "utf8")).not.toContain("secret output");
  });

  test("the Stop hook with --rewake wakes Claude (exit 2) when the human, page open, hands over", async () => {
    const page = new AbortController();
    const stream = await fetch(`${url}/api/events`, { signal: page.signal });
    const parked = hook({ hook_event_name: "Stop" }, {}, true);
    await Bun.sleep(600);
    await human(
      { kind: "rename", board: "passage-de-commande", id: "P1", label: "Réserver le stock sous 5 min" },
      { kind: "pass", board: "passage-de-commande", to: "agent" },
    );
    const ran = await parked;
    expect(ran.code).toBe(2);
    expect(ran.out).toBe("");
    expect(ran.err).toContain("Réserver le stock sous 5 min");
    page.abort();
    await stream.body?.cancel().catch(() => {});
  });

  test("the --rewake hook returns at once with no page open, and in an unattended session", async () => {
    const started = performance.now();
    expect(await hook({ hook_event_name: "Stop" }, {}, true)).toEqual({ code: 0, out: "", err: "" });

    const page = new AbortController();
    const stream = await fetch(`${url}/api/events`, { signal: page.signal });
    const headless = { CLAUDE_CODE_SESSION_ATTENDED: "0", CLAUDE_CODE_ENTRYPOINT: "sdk-cli" };
    expect(await hook({ hook_event_name: "Stop" }, headless, true)).toEqual({ code: 0, out: "", err: "" });
    expect(performance.now() - started).toBeLessThan(3000);
    page.abort();
    await stream.body?.cancel().catch(() => {});
  });

  test("the SessionEnd hook frees a parked hook, within the 1.5 s Claude Code gives a plugin", async () => {
    const page = new AbortController();
    const stream = await fetch(`${url}/api/events`, { signal: page.signal });
    const parked = hook({ hook_event_name: "Stop" }, {}, true);
    await Bun.sleep(600);
    const started = performance.now();
    const ended = await hook({ hook_event_name: "SessionEnd", reason: "prompt_input_exit" });
    const took = performance.now() - started;
    console.log(`SessionEnd hook, through the launcher: ${Math.round(took)} ms`);
    expect(ended).toEqual({ code: 0, out: "", err: "" });
    expect(took).toBeLessThan(1500);
    expect(await parked).toEqual({ code: 0, out: "", err: "" });
    expect((await vico(["status"])).out).toContain("session    s1 is ended");
    page.abort();
    await stream.body?.cancel().catch(() => {});
  });

  test("garbage on stdin never breaks the session", async () => {
    expect(await vico(["hook"], { stdin: "not json" })).toEqual({ code: 0, out: "", err: "" });
    expect(await vico(["hook"], { stdin: "[]" })).toEqual({ code: 0, out: "", err: "" });
  });
});

describe("sharing", () => {
  test("export writes a design note, a diagram, an image, a model", async () => {
    const md = (await vico(["export", "--format", "md"])).out;
    expect(md).toStartWith("# Passage de commande");
    expect(md).toContain("```mermaid");
    expect((await vico(["export", "--format", "mermaid"])).out).toContain("flowchart LR\n");
    expect((await vico(["export", "--format", "svg"])).out).toStartWith("<svg");
    const model = JSON.parse((await vico(["export", "--format", "json"])).out) as { title: string };
    expect(model.title).toBe("Passage de commande");
  });

  test("exports are in English unless --lang or VICO_LANG says otherwise", async () => {
    expect((await vico(["export"])).out).toContain("## Elements\n");
    expect((await vico(["export", "--lang", "fr"])).out).toContain("## Éléments\n");
    expect((await vico(["export"], { env: { VICO_LANG: "fr_FR.UTF-8" } })).out).toContain("## Éléments\n");
    // The flag wins over the environment.
    expect((await vico(["export", "--lang", "en"], { env: { VICO_LANG: "fr" } })).out).toContain(
      "## Elements\n",
    );
    const unknown = await vico(["export", "--lang", "tlh"]);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toBe("vico: --lang is one of: en, fr");
  });

  test("a file that cannot be written is one plain line on stderr, not a stack trace", async () => {
    const ran = await vico(["export", "--format", "md", "--out", join(root, "no", "such", "dir", "note.md")]);
    expect(ran.code).toBe(1);
    expect(ran.err.split("\n")).toHaveLength(1);
    expect(ran.err).toMatch(/^vico: ENOENT: no such file or directory/);
  });

  test("an exported model imports as a new board with the same elements and links", async () => {
    const file = join(root, "copie.model.json");
    await vico(["export", "--format", "json", "--out", file]);
    const ran = await vico(["import", file, "--id", "copie"]);
    expect(ran.out).toStartWith("imported as board copie");
    // The model carries the design, not the conversation: open notes stay behind.
    const body = (text: string): string =>
      text.split("\n").slice(1).join("\n").split("\nopen notes")[0] ?? "";
    expect(body((await vico(["show", "copie"])).out)).toBe(
      body((await vico(["show", "passage-de-commande"])).out),
    );
  });

  test("publish writes a static site that the companion serves", async () => {
    const ran = await vico(["publish"]);
    expect(ran.out).toContain(`served at ${url}/pub/`);
    for (const file of [
      "index.html",
      "passage-de-commande.md",
      "passage-de-commande.html",
      "passage-de-commande.svg",
    ])
      expect(existsSync(join(root, ".vico", "site", file))).toBe(true);
    const index = await (await fetch(`${url}/pub/`)).text();
    expect(index).toContain("Passage de commande");
    expect(index).toContain("<h1>Vico boards</h1>");
    await vico(["publish", "--lang", "fr"]);
    expect(await (await fetch(`${url}/pub/`)).text()).toContain("<h1>Tableaux Vico</h1>");
    expect((await fetch(`${url}/pub/passage-de-commande.svg`)).headers.get("content-type")).toContain(
      "image/svg+xml",
    );
  });
});

describe("opening the page, by the agent as well as the human", () => {
  /** A stand-in browser: it writes the address it was asked to open into a file. */
  const visits = (dir = root): string => join(dir, "visits.txt");
  const recorder = (dir = root): Record<string, string> => {
    const script = join(dir, "browser.sh");
    writeFileSync(script, `#!/bin/sh\necho "$1" >> '${visits(dir)}'\n`, { mode: 0o755 });
    return { BROWSER: script };
  };
  const visited = (dir = root): string[] =>
    existsSync(visits(dir)) ? readFileSync(visits(dir), "utf8").trim().split("\n") : [];

  /** Another project, with its own companion, stopped and removed afterwards. */
  async function elsewhere(run: (dir: string) => Promise<void>): Promise<void> {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "vico-cli-open-")));
    try {
      await run(dir);
    } finally {
      await vico(["stop"], { cwd: dir });
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("status says whether anyone is looking at the board", async () => {
    expect((await vico(["status"])).out).toContain("page       not open (open it with `vico open`)");
  });

  test("open shows the page once: with a page already open it only prints the address", async () => {
    const first = await vico(["open"], { env: recorder() });
    expect(first).toEqual({ code: 0, out: `${url}\nopened in the browser`, err: "" });
    expect(visited()).toEqual([url]);

    const page = new AbortController();
    const stream = await fetch(`${url}/api/events`, { signal: page.signal });
    expect((await vico(["status"])).out).toContain("page       open in 1 window");
    const second = await vico(["open"], { env: recorder() });
    expect(second).toEqual({ code: 0, out: `${url}\nalready open in the browser`, err: "" });
    expect(visited()).toEqual([url]);
    page.abort();
    await stream.body?.cancel().catch(() => {});
  });

  /** The address the companion of `dir` left for its clients, once it has started. */
  async function addressOf(dir: string): Promise<string> {
    const note = join(dir, ".vico", "server.json");
    for (let attempt = 0; attempt < 100; attempt++) {
      if (existsSync(note)) {
        const { url: address } = JSON.parse(readFileSync(note, "utf8")) as { url: string };
        if (
          await fetch(`${address}/health`)
            .then((r) => r.ok)
            .catch(() => false)
        )
          return address;
      }
      await Bun.sleep(50);
    }
    throw new Error("the companion did not start");
  }

  test("after a restart, open waits for the page left open to come back instead of opening another", () =>
    elsewhere(async (dir) => {
      await vico(["open"], { cwd: dir, env: recorder(dir) });
      await vico(["board", "new", "Atelier"], { cwd: dir });
      await vico(["stop"], { cwd: dir });
      expect(visited(dir)).toHaveLength(1);

      // The companion is down; the tab is still there and will reconnect a moment after it is back.
      const opening = vico(["open"], { cwd: dir, env: recorder(dir) });
      const address = await addressOf(dir);
      await Bun.sleep(600);
      const page = new AbortController();
      const stream = await fetch(`${address}/api/events`, { signal: page.signal });
      expect(await opening).toEqual({ code: 0, out: `${address}\nalready open in the browser`, err: "" });
      expect(visited(dir)).toHaveLength(1);
      page.abort();
      await stream.body?.cancel().catch(() => {});
    }));

  test("after a restart with no page left, open shows one once the wait is over", () =>
    elsewhere(async (dir) => {
      await vico(["open"], { cwd: dir, env: recorder(dir) });
      await vico(["board", "new", "Atelier"], { cwd: dir });
      await vico(["stop"], { cwd: dir });
      const env = { ...recorder(dir), VICO_PAGE_RETURN_MS: "400" };
      const began = Date.now();
      const ran = await vico(["open"], { cwd: dir, env });
      expect(ran.out).toEndWith("opened in the browser");
      expect(Date.now() - began).toBeGreaterThanOrEqual(400);
      expect(visited(dir)).toHaveLength(2);
    }));

  test("a shell that may not open a browser has the companion do it", () =>
    elsewhere(async (dir) => {
      // The companion starts where a browser opens, as the plugin's hook starts it outside the sandbox.
      const started = await vico(["open"], { cwd: dir, env: recorder(dir) });
      const address = started.out.split("\n")[0] ?? "";
      expect(visited(dir)).toEqual([address]);
      // The next shell cannot open one, as a sandboxed shell cannot.
      const asked = await vico(["open"], { cwd: dir, env: { BROWSER: "false" } });
      expect(asked).toEqual({ code: 0, out: `${address}\nopened in the browser`, err: "" });
      expect(visited(dir)).toEqual([address, address]);
    }));

  test("when neither the shell nor the companion can open a browser, open says so and fails", () =>
    elsewhere(async (dir) => {
      const ran = await vico(["open"], { cwd: dir, env: { BROWSER: "false" } });
      expect(ran.code).toBe(1);
      expect(ran.out).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect(ran.err).toBe(
        "vico: could not open the browser, from this shell or from the companion (a sandbox blocks it, or no browser is set). Run `vico open` outside the sandbox, or give the user the address above.",
      );
    }));
});

describe("the page's language", () => {
  test("the companion serves the page in English by default", async () => {
    expect(await (await fetch(url)).text()).toStartWith('<!doctype html>\n<html lang="en">');
  });

  test("a companion started with VICO_LANG=fr serves it in French", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "vico-cli-lang-")));
    try {
      const started = await vico(["open"], { cwd: dir, env: { VICO_LANG: "fr" } });
      const address = started.out.split("\n")[0] ?? "";
      expect(await (await fetch(address)).text()).toStartWith('<!doctype html>\n<html lang="fr">');
    } finally {
      await vico(["stop"], { cwd: dir });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("two sessions in one project", () => {
  const told = async (session: string): Promise<string> =>
    (await hook({ session_id: session, hook_event_name: "UserPromptSubmit", prompt: "Continue" })).out;

  test("each is told what the human changes on the boards it follows, and only there", async () => {
    await hook({ session_id: "s2", hook_event_name: "SessionStart" });
    const made = await vico(["board", "new", "Autre chantier", "--id", "autre", "--session", "s2"]);
    expect(made.code).toBe(0);
    await human({ kind: "note", board: "autre", text: "Pour la seconde session" });
    expect(await told("s1")).not.toContain("Pour la seconde session");
    expect(await told("s2")).toContain("Pour la seconde session");
  });

  test("reading a board with `vico show` takes it; `vico unfollow` lets go of it", async () => {
    await vico(["show", "passage-de-commande", "--session", "s2"]);
    await human({ kind: "note", board: "passage-de-commande", text: "Lue par les deux" });
    expect(await told("s2")).toContain("Lue par les deux");
    const left = await vico(["unfollow", "passage-de-commande", "--session", "s2"]);
    expect(left.out.trim()).toBe("no longer following passage-de-commande");
    await human({ kind: "note", board: "passage-de-commande", text: "Plus pour la seconde" });
    expect(await told("s2")).not.toContain("Plus pour la seconde");
    expect((await vico(["follow", "nulle-part", "--session", "s2"])).code).not.toBe(0);
  });
});

describe("tidying up", () => {
  test("a board is removed by its id and leaves the list; the journal keeps its history", async () => {
    await vico(["board", "new", "Brouillon", "--format", "kanban"]);
    await vico(["add", "task", "À jeter", "--lane", "todo", "--board", "brouillon"]);
    expect((await vico(["boards"])).out).toContain("brouillon");

    expect(await vico(["board", "rm", "brouillon"])).toEqual({
      code: 0,
      out: "removed board brouillon",
      err: "",
    });
    expect((await vico(["boards"])).out).not.toContain("brouillon");
    expect(readFileSync(join(root, ".vico", "boards.jsonl"), "utf8")).toContain('"label":"À jeter"');

    const again = await vico(["board", "rm", "brouillon"]);
    expect(again.code).toBe(1);
    expect(again.err).toContain('no board "brouillon"');
  });

  test("`board rm` without an id removes nothing", async () => {
    const ran = await vico(["board", "rm"]);
    expect(ran.code).toBe(1);
    expect(ran.err).toContain("`board rm` needs the id of the board");
    expect((await vico(["boards"])).out).toContain("passage-de-commande");
  });
});

describe("history", () => {
  test("the journal outlives the companion: same board, and the sequence goes on", async () => {
    const before = (await vico(["show", "passage-de-commande"])).out;
    const seq = Number(/seq (\d+)/.exec((await vico(["status"])).out)?.[1]);
    expect(await vico(["stop"])).toEqual({ code: 0, out: `stopped the companion at ${url}`, err: "" });
    expect(existsSync(join(root, ".vico", "server.json"))).toBe(false);
    expect((await vico(["stop"])).out).toBe("no companion is running for this workspace");
    expect((await vico(["status"])).out).toContain("server     not running");
    expect((await vico(["show", "passage-de-commande"])).out).toBe(before);

    const ran = await vico(["add", "event", "Stock réservé", "--col", "3", "--board", "passage-de-commande"]);
    expect(ran.out).toBe("E2");
    url = note().url;
    expect(Number(/seq (\d+)/.exec((await vico(["status"])).out)?.[1])).toBe(seq + 1);
  });

  test("boards are committable, sessions are not mixed into them", () => {
    const boards = readFileSync(join(root, ".vico", "boards.jsonl"), "utf8");
    expect(boards).toContain("BoardCreated");
    expect(boards).not.toContain("PromptSubmitted");
    expect(readFileSync(join(root, ".vico", "sessions.jsonl"), "utf8")).toContain("PromptSubmitted");
  });
});
