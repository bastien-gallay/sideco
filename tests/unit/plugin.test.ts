/**
 * The plugin is configuration, and configuration drifts: every hook it registers
 * must be one the CLI reacts to, and every command the skill teaches must exist.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BOARD_VERBS } from "../../src/cli/argv.ts";
import type { Server } from "../../src/cli/client.ts";
import { HOOK_EVENTS, runHook } from "../../src/cli/hook.ts";
import { CLI_VERBS } from "../../src/cli/main.ts";
import { handler } from "../../src/server/http.ts";
import { Hub } from "../../src/server/hub.ts";
import { openJournal } from "../../src/server/journal.ts";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

interface HookEntry {
  type: string;
  command: string;
  timeout?: number;
  asyncRewake?: boolean;
}
interface HooksFile {
  description?: string;
  hooks: Record<string, { matcher?: string; hooks: HookEntry[] }[]>;
}

const hooksFile = (): HooksFile => JSON.parse(read("hooks/hooks.json")) as HooksFile;
const entries = (file: HooksFile): [string, HookEntry][] =>
  Object.entries(file.hooks).flatMap(([event, groups]) =>
    groups.flatMap((group) => group.hooks.map((hook): [string, HookEntry] => [event, hook])),
  );

describe("the manifest", () => {
  test("names the plugin and carries the package's version", () => {
    const manifest = JSON.parse(read(".claude-plugin/plugin.json")) as Record<string, unknown>;
    const pkg = JSON.parse(read("package.json")) as { version: string };
    expect(manifest.name).toBe("vico");
    expect(manifest.version).toBe(pkg.version);
    expect(typeof manifest.description).toBe("string");
  });

  test("the launcher it points hooks at exists and is executable", () => {
    expect(statSync(join(ROOT, "bin", "vico")).mode & 0o111).not.toBe(0);
  });
});

describe("hooks/hooks.json", () => {
  test("registers exactly the events the CLI reacts to", () => {
    expect(Object.keys(hooksFile().hooks).sort()).toEqual([...HOOK_EVENTS].sort());
  });

  test("every hook is the bundled launcher, quoted against spaces in the plugin path", () => {
    for (const [, hook] of entries(hooksFile())) {
      expect(hook.type).toBe("command");
      expect(hook.command).toMatch(/^"\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/vico" hook( --rewake)?$/);
    }
  });

  test("hooks on the agent's path are bounded to a few seconds", () => {
    for (const [event, hook] of entries(hooksFile())) {
      if (hook.asyncRewake) continue;
      expect(hook.timeout).toBeLessThanOrEqual(event === "SessionStart" ? 15 : 5);
    }
  });

  test("only Stop parks a background hook that can wake Claude, and it outlasts its own wait", () => {
    const waking = entries(hooksFile()).filter(([, hook]) => hook.asyncRewake);
    expect(waking.map(([event]) => event)).toEqual(["Stop"]);
    expect(waking[0]?.[1].command).toEndWith("hook --rewake");
    expect(waking[0]?.[1].timeout).toBeGreaterThan(25 * 60);
  });
});

describe("every registered event leaves a trace in the journal", () => {
  let dir: string;
  let hub: Hub;
  let server: Server;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vico-plugin-"));
    hub = new Hub(openJournal(dir));
    const handle = handler({ hub, page: "", root: "/repo", siteDir: join(dir, "site") });
    server = {
      url: "http://127.0.0.1:4747",
      fetch: (url, init) =>
        handle(new Request(url, { ...init, headers: { host: "127.0.0.1:4747", ...init?.headers } })),
    };
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test.each([...HOOK_EVENTS])("%s", async (event) => {
    const fire = (name: string): Promise<unknown> => runHook(payload(name), {}, false, async () => server);
    // A task can only be completed once it exists.
    if (event === "TaskCompleted") await fire("TaskCreated");
    const before = hub.workspace.seq;
    await fire(event);
    expect(hub.workspace.seq).toBeGreaterThan(before);
  });
});

function payload(event: string): Record<string, unknown> {
  return {
    session_id: "s1",
    cwd: "/repo",
    hook_event_name: event,
    prompt: "p",
    tool_name: "Bash",
    tool_use_id: "t1",
    tool_input: { command: "ls" },
    task_id: "1",
    task_subject: "Tâche",
    message: "m",
  };
}

describe("the skill", () => {
  const skill = (): string => read("skills/vico/SKILL.md");

  test("has the frontmatter Claude Code reads to decide when to load it", () => {
    const front = /^---\n([\s\S]*?)\n---\n/.exec(skill())?.[1] ?? "";
    expect(front).toMatch(/^name: vico$/m);
    expect(/^description: (.+)$/m.exec(front)?.[1]?.length ?? 0).toBeGreaterThan(80);
  });

  test("teaches only commands that exist", () => {
    const taught = new Set([...skill().matchAll(/\bvico ([a-z][a-z-]*)/g)].map((match) => match[1] ?? ""));
    expect(taught.size).toBeGreaterThan(10);
    const known = new Set([...BOARD_VERBS, ...CLI_VERBS]);
    expect([...taught].filter((verb) => !known.has(verb))).toEqual([]);
  });

  test("teaches the loop: read before writing, pass the turn, wait for the human", () => {
    for (const verb of ["vico show", "vico apply", "vico pass", "vico wait", "vico changes", "vico focus"])
      expect(skill()).toContain(verb);
  });

  test("stays short enough to be read whole", () => {
    expect(skill().split("\n").length).toBeLessThanOrEqual(140);
  });
});

test("the README exists and shows how to start", () => {
  expect(existsSync(join(ROOT, "README.md"))).toBe(true);
  expect(read("README.md")).toContain("--plugin-dir");
});

test("the repository is its own marketplace, so the plugin installs without --plugin-dir", () => {
  const plugin = JSON.parse(read(".claude-plugin/plugin.json")) as { name: string; version: string };
  const market = JSON.parse(read(".claude-plugin/marketplace.json")) as {
    name: string;
    owner: { name: string };
    plugins: { name: string; source: string; version: string; description: string }[];
  };
  expect(market.name).toBe("vico");
  expect(market.owner.name).not.toBe("");
  expect(market.plugins).toHaveLength(1);
  expect(market.plugins[0]).toMatchObject({ name: plugin.name, source: "./", version: plugin.version });
  expect(read("README.md")).toContain("claude plugin install vico@vico");
});

test("the skill has the agent open the board itself, before it writes", () => {
  const loop = read("skills/vico/SKILL.md").split("## The loop")[1]?.split("## Rules")[0] ?? "";
  expect(loop.indexOf("vico open")).toBeGreaterThan(-1);
  expect(loop.indexOf("vico open")).toBeLessThan(loop.indexOf("vico apply"));
});
