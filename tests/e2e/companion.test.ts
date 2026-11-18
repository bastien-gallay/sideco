/**
 * One working session, end to end, in a real browser: the agent writes from the
 * terminal side, the human edits in the page, and each sees the other.
 *
 * Needs a local port and Chrome: run it outside the sandbox (`bun run test:e2e`).
 * Screenshots go to $VICO_SHOTS when set.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "playwright-core";
import { parseBatch } from "../../src/cli/argv.ts";
import { initRoot } from "../../src/cli/client.ts";
import { runHook } from "../../src/cli/hook.ts";
import type { Workspace } from "../../src/domain/workspace.ts";
import { type Running, start } from "../../src/server/start.ts";

// Playwright gives up first (4 s) and says which locator it was waiting for.
setDefaultTimeout(20_000);

const SHOTS = process.env.VICO_SHOTS;
const SESSION = "s1";

let root: string;
let running: Running;
let browser: Browser;
let page: Page;
const problems: string[] = [];

/** The agent's side: a script in the CLI grammar, posted as one batch. */
async function agent(script: string, board?: string): Promise<void> {
  const response = await fetch(`${running.url}/api/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actor: "agent", session: SESSION, commands: parseBatch(script, board) }),
  });
  if (!response.ok) throw new Error(`agent batch refused: ${await response.text()}`);
}

/** Claude Code's side: one hook event, through the code the plugin runs. */
function hook(payload: Record<string, unknown>): ReturnType<typeof runHook> {
  return runHook({ session_id: SESSION, cwd: root, ...payload }, {}, false);
}

const workspace = async (): Promise<Workspace> =>
  (await (await fetch(`${running.url}/api/workspace`)).json()) as Workspace;

/** What the agent would be told now, without marking it as read. */
const pending = async (): Promise<string> =>
  ((await (await fetch(`${running.url}/api/changes?session=${SESSION}`)).json()) as { text: string }).text;

const card = (id: string) => page.locator(`g.card[data-id="${id}"]`);
const paletteType = (label: string) =>
  page
    .locator("button.type")
    .filter({ has: page.locator(".type-label", { hasText: new RegExp(`^${label}$`) }) });
const status = () => page.locator(".status-text");

async function shot(name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

async function typeInEditor(text: string): Promise<void> {
  const editor = page.locator("textarea.card-editor");
  await editor.waitFor({ state: "visible" });
  await editor.fill(text);
  await editor.press("Enter");
}

/** Polls from this side: a predicate that awaits cannot run inside `page.waitForFunction`. */
async function until(what: string, holds: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await holds()) return;
    await Bun.sleep(50);
  }
  throw new Error(`still not true after 4 s: ${what}`);
}

const elementOf = async (boardId: string, id: string) =>
  (await workspace()).boards.find((b) => b.id === boardId)?.elements.find((e) => e.id === id);

/** A card's box once it has stopped gliding to its place. */
async function settled(id: string): Promise<{ x: number; y: number; width: number; height: number }> {
  let last = await card(id).boundingBox();
  for (let attempt = 0; attempt < 40; attempt++) {
    await Bun.sleep(60);
    const now = await card(id).boundingBox();
    if (last && now && now.x === last.x && now.y === last.y) return now;
    last = now;
  }
  throw new Error(`card ${id} never settled`);
}

async function dragTo(id: string, x: number, y: number): Promise<void> {
  const box = await settled(id);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.up();
}

async function centre(id: string): Promise<{ x: number; y: number }> {
  const box = await settled(id);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

beforeAll(async () => {
  root = initRoot(realpathSync(mkdtempSync(join(tmpdir(), "vico-e2e-"))));
  running = await start(root, 0);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  page.setDefaultTimeout(4000);
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  await page.goto(running.url);
}, 30_000);

afterAll(async () => {
  await browser?.close();
  running?.stop();
  rmSync(root, { recursive: true, force: true });
});

describe("first look", () => {
  test("an empty companion says what it is for and offers the workshops", async () => {
    await page.locator(".empty h1").waitFor();
    expect(await page.locator(".empty h1").textContent()).toBe("What do you want to model?");
    expect(await page.locator(".empty .format-name").allTextContents()).toEqual([
      "Event Storming",
      "Flow",
      "Kanban",
      "Story Mapping",
      "Retrospective",
    ]);
    expect(await status().textContent()).toBe("No Claude Code session linked");
    await shot("01-empty");
  });
});

describe("the agent writes, the page follows", () => {
  test("a session starting in the terminal shows up in the page", async () => {
    const started = await hook({ hook_event_name: "SessionStart", source: "startup" });
    expect(started.stdout).toContain(running.url);
    await page.waitForFunction(
      () => document.querySelector(".status-text")?.textContent === "Claude is idle",
    );
  });

  test("a board the agent creates opens by itself, with its stickies and links", async () => {
    await agent(
      [
        'board new "Passage de commande" --format event-storming --id commande',
        'add actor "Client" --col 1',
        'add command "Passer commande" --col 1',
        'add event "Commande passée" --col 1',
        'add policy "Réserver le stock" --col 2',
        'add command "Réserver" --col 2',
        'add event "Stock réservé" --col 2',
        "link C1 E1",
        "link E1 P1",
        "link P1 C2",
        "link C2 E2",
      ].join("\n"),
    );
    await card("E2").waitFor();
    expect(await page.locator("g.card").count()).toBe(6);
    expect(await page.locator("g.conn").count()).toBe(4);
    expect(await card("E1").textContent()).toContain("Commande passée");
    expect(await page.title()).toBe("Passage de commande · Vico");
    expect(page.url()).toEndWith("#/b/commande");
  });

  test("one more sticky from the terminal is on screen in well under half a second", async () => {
    const before = performance.now();
    await agent('add hotspot "Et si le stock manque ?" --col 2', "commande");
    await card("H1").waitFor();
    const elapsed = performance.now() - before;
    console.log(`agent write → visible in the page: ${elapsed.toFixed(0)} ms`);
    expect(elapsed).toBeLessThan(500);
    expect(await card("H1").getAttribute("class")).toContain("is-fresh");
  });

  test("the agent points at what it wants discussed", async () => {
    await agent('focus P1 --why "Qui décide de réserver ?"', "commande");
    await page.locator(".focus-bar").waitFor({ state: "visible" });
    expect(await page.locator(".focus-bar").textContent()).toContain("Focus: P1 — Qui décide de réserver ?");
    expect(await card("P1").getAttribute("class")).toContain("is-focus");
    expect(await card("E1").getAttribute("class")).toContain("is-dim");
    await shot("02-agent-wrote");
    await page.locator(".focus-bar button").click();
    await page.locator(".focus-bar").waitFor({ state: "hidden" });
    await agent("pass", "commande");
  });
});

describe("the session beside the board", () => {
  test("prompt, tool calls and tasks follow the terminal", async () => {
    await hook({ hook_event_name: "UserPromptSubmit", prompt: "Modélise le passage de commande" });
    await page.waitForFunction(
      () => document.querySelector(".status-text")?.textContent === "Claude is thinking",
    );
    expect(await page.locator(".turns .prompt").last().textContent()).toContain(
      "Modélise le passage de commande",
    );

    await hook({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_use_id: "t1",
      tool_input: { command: "bun test" },
    });
    await page.waitForFunction(
      () => document.querySelector(".status-text")?.textContent === "Claude is running Bash bun test",
    );
    expect(await page.locator(".tools li.tool-running").textContent()).toContain("Bash bun test");

    await hook({
      hook_event_name: "PostToolUse",
      tool_name: "TodoWrite",
      tool_use_id: "t1",
      tool_input: {
        todos: [
          { content: "Poser les événements", status: "completed" },
          { content: "Trouver les règles", status: "in_progress" },
        ],
      },
    });
    await page.locator(".tools li.tool-ok").waitFor();
    expect(await page.locator(".todos li").allTextContents()).toEqual([
      "☑ Poser les événements",
      "◐ Trouver les règles",
    ]);
    await shot("03-session");

    await hook({ hook_event_name: "Stop", last_assistant_message: "Voilà le premier jet." });
    await page.waitForFunction(
      () => document.querySelector(".status-text")?.textContent === "Claude is idle",
    );
  });
});

describe("the human edits, the agent is told", () => {
  test("a sticky added from the palette", async () => {
    await paletteType("Event").click();
    await typeInEditor("Paiement accepté");
    await card("E3").waitFor();
    expect(await card("E3").textContent()).toContain("Paiement accepté");
    expect(await pending()).toContain('+ E3 event "Paiement accepté"');
  });

  test("a double-click renames in place", async () => {
    await card("E1").dblclick();
    const editor = page.locator("textarea.card-editor");
    await editor.waitFor({ state: "visible" });
    expect(await editor.inputValue()).toBe("Commande passée");
    await typeInEditor("Commande validée");
    await page.waitForFunction(
      () =>
        document.querySelector('g.card[data-id="E1"]')?.textContent?.includes("Commande validée") ?? false,
    );
    expect(await pending()).toContain("~ E1");
  });

  test("a drag moves a sticky to another step", async () => {
    const col = async (id: string): Promise<number | undefined> => (await elementOf("commande", id))?.col;
    expect(await col("E3")).toBe(3);
    const target = await centre("E1");
    await dragTo("E3", target.x, target.y);
    await until("E3 is in step 1", async () => (await col("E3")) === 1);
    // Net of back-and-forth: added then moved reads as added there.
    expect(await pending()).toContain('+ E3 event "Paiement accepté" (col 1)');

    // Dropped where it already is: nothing is recorded and the card glides back.
    const home = await centre("E2");
    await dragTo("E2", home.x, home.y + 60);
    expect(await centre("E2")).toEqual(home);
    expect(await col("E2")).toBe(2);

    const first = await centre("E1");
    await dragTo("E2", first.x, first.y);
    await until("E2 is in step 1", async () => (await col("E2")) === 1);
    expect(await pending()).toContain("→ E2 moved col 2 → 1");
  });

  test("the card toolbar pins a note for Claude", async () => {
    await card("P1").click();
    await page.locator(".card-tools button", { hasText: "Note for Claude" }).click();
    await typeInEditor("L'entrepôt réserve, pas nous");
    await page.locator(".notes .note-list li").waitFor();
    expect(await page.locator(".notes h2").textContent()).toBe("Open notes (1)");
    expect(await page.locator(".notes .note-list li").textContent()).toContain(
      "L'entrepôt réserve, pas nous",
    );
  });

  test("the keyboard does it too: select, link, delete", async () => {
    await card("H1").focus();
    await page.keyboard.press("l");
    await card("E2").click();
    await page.waitForFunction(() => document.querySelectorAll("g.conn").length === 5);
    await card("H1").focus();
    await page.keyboard.press("Delete");
    await card("H1").waitFor({ state: "detached" });
  });

  test("the footer counts what Claude has not read, and says when it will read it", async () => {
    const told = await page.locator(".pending").textContent();
    expect(told).toMatch(/^\d+ changes Claude has not read · /);
    expect(told).toContain("Claude is idle: it will read your changes at your next message in the terminal.");
    const lines = (await pending()).split("\n").filter((line) => line.startsWith("  ")).length;
    expect(Number(/^\d+/.exec(told ?? "")?.[0])).toBe(lines);
    await shot("04-human-edited");
  });

  test("handing over wakes a waiting agent with the digest", async () => {
    const waiting = fetch(`${running.url}/api/wait?session=${SESSION}&timeout=20000`).then(
      (response) => response.json() as Promise<{ outcome: string; text: string }>,
    );
    await page.waitForFunction(
      () => document.querySelector(".status-text")?.textContent === "Claude is waiting for you to hand over",
    );
    expect(await page.locator(".pending").textContent()).toContain(
      "Claude resumes as soon as you hand over.",
    );
    await shot("05-listening");

    await page.locator(".pass input").fill("J'ai corrigé la règle, continue");
    await page.locator(".pass button").click();
    const waited = await waiting;
    expect(waited.outcome).toBe("passed");
    expect(waited.text).toContain("J'ai corrigé la règle, continue");
    expect(waited.text).toContain("Paiement accepté");
    expect(waited.text).toContain("L'entrepôt réserve, pas nous");
    await page.waitForFunction(
      () => document.querySelector(".pending strong")?.textContent === "Claude is up to date",
    );
  });
});

describe("history", () => {
  test("stepping back shows the board as it was, read-only, and comes back", async () => {
    const live = await page.locator("g.card").count();
    expect(await page.locator(".history-label").textContent()).toStartWith("Live · ");

    await page.locator(".history input").fill("5");
    await page.locator(".banner").waitFor({ state: "visible" });
    expect(await page.locator("g.card").count()).toBe(3);
    expect(await page.locator(".history-label").textContent()).toMatch(/^5 \/ \d+ · .*Claude adds E1/);
    expect(await paletteType("Event").isDisabled()).toBe(true);
    await shot("06-history");

    await page.locator(".history button", { hasText: "►" }).click();
    await page.waitForFunction(() =>
      document.querySelector(".history-label")?.textContent?.startsWith("6 / "),
    );

    await page.locator(".banner button").click();
    await page.locator(".banner").waitFor({ state: "hidden" });
    expect(await page.locator("g.card").count()).toBe(live);
  });
});

describe("other workshops", () => {
  test("kanban: dragging a task to another column tells the agent which lane", async () => {
    await agent(
      [
        'board new "Sprint 12" --format kanban --id sprint',
        'add task "Brancher le paiement" --lane todo',
        'add task "Écrire les tests" --lane todo',
        'add task "Maquette" --lane doing',
        'add blocker "Clé API manquante" --lane doing',
      ].join("\n"),
    );
    // The human stays on their board; a line says a new one exists.
    await page.locator(".toast").waitFor({ state: "visible" });
    expect(await page.locator(".toast").textContent()).toStartWith("Claude created the board “Sprint 12”");
    expect(page.url()).toEndWith("#/b/commande");
    await page.locator(".board-picker select").selectOption("sprint");
    await card("T3").waitFor();
    expect(await page.locator(".palette h2").textContent()).toBe("Kanban");

    const doing = await centre("B1");
    await dragTo("T1", doing.x, doing.y + 120);
    await until("T1 is in progress", async () => (await elementOf("sprint", "T1"))?.lane === "doing");
    expect(await pending()).toContain("→ T1 moved lane todo → doing");
    await settled("T1");
    await shot("07-kanban");
  });

  test("flow: a step added while another is selected is linked to it", async () => {
    await agent(
      [
        'board new "Livraison" --format flow --id livraison',
        'add step "Recevoir la commande"',
        'add decision "En stock ?" --from S1',
        'add step "Expédier" --from D1 --edge "oui"',
        'add outcome "Commande annulée" --from D1 --edge "non"',
      ].join("\n"),
    );
    await page.locator(".board-picker select").selectOption("livraison");
    await card("S2").waitFor();
    await card("S2").click();
    await page.waitForFunction(
      () => document.querySelector(".palette .how")?.textContent === "The new element will be linked to S2.",
    );
    await paletteType("Outcome").click();
    await typeInEditor("Colis livré");
    await card("O2").waitFor();
    const board = (await workspace()).boards.find((b) => b.id === "livraison");
    expect(board?.edges.some((e) => e.src === "S2" && e.dst === "O2")).toBe(true);
    await shot("08-flow");
  });

  test("a new board from the page: pick a workshop, name it, start", async () => {
    await page.locator(".board-picker button").click();
    await page.locator("dialog.new-board").waitFor({ state: "visible" });
    await page.locator('dialog.new-board input[name="title"]').fill("Rétro sprint 12");
    await page.locator("dialog.new-board label.choice", { hasText: "Retrospective" }).click();
    await shot("09-new-board");
    await page.locator("dialog.new-board button[type=submit]").click();
    await page.waitForFunction(() => location.hash === "#/b/retro-sprint-12");
    expect(await page.locator(".palette h2").textContent()).toBe("Retrospective");

    await paletteType("Observation").click();
    await typeInEditor("Les revues sont rapides");
    await card("K1").waitFor();
    expect((await workspace()).boards.find((b) => b.id === "retro-sprint-12")?.elements[0]).toMatchObject({
      id: "K1",
      lane: "keep",
    });
  });
});

describe("keeping the model", () => {
  test("the export menu downloads a design note that carries the diagram", async () => {
    await page.locator(".board-picker select").selectOption("commande");
    await card("E1").waitFor();
    await page.locator(".menu summary").click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(".menu-items button", { hasText: "Markdown" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("commande.md");
    const note = readFileSync(await download.path(), "utf8");
    expect(note).toStartWith("# Passage de commande");
    expect(note).toContain("```mermaid");
    expect(note).toContain("Commande validée");
  });

  test("a reload rebuilds the same board from the journal", async () => {
    const before = await page.locator("g.card").count();
    await page.reload();
    await card("E1").waitFor();
    // History replayed is not news: the page stays on its board and nothing pulses.
    expect(page.url()).toEndWith("#/b/commande");
    expect(await page.locator("g.card.is-fresh").count()).toBe(0);
    expect(await page.locator("g.card").count()).toBe(before);
    expect(await card("E1").textContent()).toContain("Commande validée");
  });
});

describe("the reader's language", () => {
  const language = () => page.locator("select.language");

  test("the page opens in English, and says so to the browser", async () => {
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
    expect(await language().inputValue()).toBe("en");
    expect(await language().locator("option").allTextContents()).toEqual(["English", "Français"]);
    expect(await page.locator(".pass button.primary").textContent()).toBe("Hand over to Claude");
    expect(await page.locator("g.card[data-id='E1'] title").textContent()).toMatch(/^E1 · Event · added by /);
  });

  test("choosing French turns the whole page, the drawing and the exports to French, and it sticks", async () => {
    await language().selectOption("fr");
    await page.waitForFunction(() => document.documentElement.lang === "fr");
    await card("E1").waitFor();
    expect(page.url()).toEndWith("#/b/commande");
    expect(await page.locator(".pass button.primary").textContent()).toBe("Passer la main à Claude");
    expect(await page.locator(".palette h2").textContent()).toBe("Event Storming");
    expect(await paletteType("Événement").count()).toBe(1);
    expect(await page.locator(".history-label").textContent()).toStartWith("En direct · ");
    expect(await page.locator("g.card[data-id='E1'] title").textContent()).toMatch(
      /^E1 · Événement · ajouté par /,
    );
    // What the user wrote is theirs: it is never translated.
    expect(await card("E1").textContent()).toContain("Commande validée");

    await page.locator(".menu summary").click();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator(".menu-items button", { hasText: "Markdown" }).click(),
    ]);
    expect(readFileSync(await download.path(), "utf8")).toContain("## Éléments\n");

    await page.reload();
    await card("E1").waitFor();
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("fr");
    await shot("09b-french");
  });

  test("and back to English", async () => {
    await language().selectOption("en");
    await page.waitForFunction(() => document.documentElement.lang === "en");
    await card("E1").waitFor();
    expect(await page.locator(".pass button.primary").textContent()).toBe("Hand over to Claude");
  });
});

describe("tidying up", () => {
  const listed = (): Promise<string[]> =>
    page
      .locator(".board-picker option")
      .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));

  test("a board Claude removes leaves the picker; the page moves to one that exists and says so", async () => {
    await agent('board new "Brouillon" --format retro --id brouillon\nadd point "À jeter" --lane keep');
    await page.locator(".board-picker select").selectOption("brouillon");
    await card("K1").waitFor();

    await agent("board rm brouillon");
    await until("the removed board left the picker", async () => !(await listed()).includes("brouillon"));
    await page.locator(".toast", { hasText: "Claude removed the board “Brouillon”" }).waitFor();
    const remaining = (await workspace()).boards.map((b) => b.id);
    expect(await listed()).toEqual(remaining);
    expect(page.url()).toEndWith(`#/b/${remaining.at(-1)}`);
    expect(await page.locator(".board-picker select").inputValue()).toBe(remaining.at(-1) ?? "");
    expect(await page.locator("g.card").count()).toBeGreaterThan(0);
  });

  test("a companion restarted on another journal: the page forgets the boards that are gone", async () => {
    expect((await listed()).length).toBeGreaterThan(1);
    const port = running.port;
    const before = problems.length;
    running.stop();
    renameSync(join(root, ".vico", "boards.jsonl"), join(root, ".vico", "boards.jsonl.bak"));
    running = await start(root, port);
    await agent('board new "Flux Vico" --id flux-vico\nadd event "Session démarrée" --col 1');

    for (let attempt = 0; attempt < 200 && (await listed()).join() !== "flux-vico"; attempt++)
      await Bun.sleep(50);
    expect(await listed()).toEqual(["flux-vico"]);
    await card("E1").waitFor();
    expect(await page.locator("g.card").count()).toBe(1);
    expect(page.url()).toEndWith("#/b/flux-vico");
    expect(await status().textContent()).not.toContain("disconnected");
    // Chrome logs the stream this test cut; anything else it logged stays a problem.
    const cut = /net::ERR_(INCOMPLETE_CHUNKED_ENCODING|CONNECTION_REFUSED)/;
    problems.splice(before, problems.length - before, ...problems.slice(before).filter((p) => !cut.test(p)));
  });

  test("the last board removed brings back the first screen", async () => {
    await agent("board rm flux-vico");
    await page.locator(".empty h1").waitFor();
    expect(await listed()).toEqual([]);
    expect(page.url()).not.toContain("#/b/");
    await agent(
      'board new "Passage de commande" --id commande\nadd actor "Client" --col 1\nadd event "Commande passée" --col 1',
    );
    await card("E1").waitFor();
  });
});

describe("look", () => {
  test("dark scheme and a narrow window keep the board usable", async () => {
    await page.emulateMedia({ colorScheme: "dark" });
    await shot("10-dark");
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 900, height: 700 });
    expect(await page.locator(".right").isVisible()).toBe(false);
    expect(await page.locator(".pass button").isVisible()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // The page is one screen: the hand-over bar stays whole and in view, nothing scrolls but the regions.
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const fit = await page.evaluate(() => {
      const bottom = (selector: string): number =>
        Math.round(document.querySelector(selector)?.getBoundingClientRect().bottom ?? Number.NaN);
      return {
        page: document.documentElement.scrollHeight <= window.innerHeight,
        bar: bottom(".bottom") <= window.innerHeight,
        button: bottom(".pass button") <= window.innerHeight,
        top: Math.round(document.querySelector(".top")?.getBoundingClientRect().top ?? Number.NaN),
      };
    });
    expect(fit).toEqual({ page: true, bar: true, button: true, top: 0 });
    await shot("11-narrow");
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("nothing went wrong in the page along the way", () => {
    expect(problems).toEqual([]);
  });
});
