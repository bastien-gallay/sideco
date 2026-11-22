/**
 * One working session, end to end, in a real browser: the agent writes from the
 * terminal side, the human edits in the page, and each sees the other.
 *
 * Needs a local port and Chrome: run it outside the sandbox (`bun run test:e2e`).
 * Screenshots go to $SIDECO_SHOTS when set.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "playwright-core";
import { parseBatch } from "../../src/cli/argv.ts";
import { initRoot } from "../../src/cli/client.ts";
import { runHook } from "../../src/cli/hook.ts";
import type { Locale } from "../../src/domain/i18n.ts";
import { mint } from "../../src/domain/minting.ts";
import type { Workspace } from "../../src/domain/workspace.ts";
import { type Running, start } from "../../src/server/start.ts";

// Playwright gives up first (4 s) and says which locator it was waiting for.
setDefaultTimeout(20_000);

const SHOTS = process.env.SIDECO_SHOTS;
const SESSION = "s1";

let root: string;
let running: Running;
let browser: Browser;
let page: Page;
const problems: string[] = [];

/** The ids a batch made, in order. Ids are given once in the project: a test reads them, never guesses them. */
type Made = [string, string, string, string, string, string, string, string, ...string[]];

/** The agent's side: a script in the CLI grammar, posted as one batch. Gives the ids it made, in order. */
async function agent(script: string, board?: string): Promise<Made> {
  const response = await fetch(`${running.url}/api/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actor: "agent", session: SESSION, commands: parseBatch(script, board) }),
  });
  if (!response.ok) throw new Error(`agent batch refused: ${await response.text()}`);
  const { minted } = (await response.json()) as { minted: (string | null)[] };
  return minted.filter((id): id is string => id !== null) as Made;
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

/** The history is a tab of the right panel: open it before stepping through it. */
async function openHistory(): Promise<void> {
  await page.locator("#tab-history").click();
  await page.locator(".history-list").waitFor();
}

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

/** `SIDECO_SLOW=6` runs the page six times slower, as a loaded CI runner does: a race shows up here first. */
async function slowDown(tab: Page): Promise<void> {
  const rate = Number(process.env.SIDECO_SLOW ?? 1);
  if (rate > 1)
    await (await tab.context().newCDPSession(tab)).send("Emulation.setCPUThrottlingRate", { rate });
}

beforeAll(async () => {
  root = initRoot(realpathSync(mkdtempSync(join(tmpdir(), "sideco-e2e-"))));
  running = await start(root, 0);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  page.setDefaultTimeout(4000);
  await slowDown(page);
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
    await page.locator(".home h1").waitFor();
    expect(await page.locator(".home h1").textContent()).toBe("What do you want to model?");
    expect(await page.locator(".home .format-name").allTextContents()).toEqual([
      "Event Storming",
      "Flow",
      "Kanban",
      "Story Mapping",
      "Retrospective",
      "Impact / Effort",
      "C4 · System context",
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
    expect(await page.title()).toBe("Passage de commande · Sideco");
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
    await page.locator(".notes .thread").waitFor();
    expect(await page.locator(".notes h2").textContent()).toBe("Open notes (1)");
    expect(await page.locator(".notes .thread").textContent()).toContain("L'entrepôt réserve, pas nous");
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
    expect(told).toMatch(/^\d+ changes not read yet · /);
    expect(told).toContain("Claude will read them at your next message in the terminal.");
    const lines = (await pending()).split("\n").filter((line) => line.startsWith("  ")).length;
    expect(Number(/^\d+/.exec(told ?? "")?.[0])).toBe(lines);
    await shot("04-human-edited");
  });

  test("handing over wakes a waiting agent with the digest", async () => {
    const waiting = fetch(`${running.url}/api/wait?session=${SESSION}&timeout=20000`).then(
      (response) => response.json() as Promise<{ outcome: string; text: string }>,
    );
    await page.waitForFunction(
      () => document.querySelector(".status-text")?.textContent === "Claude is waiting for you to send",
    );
    expect(await page.locator(".pending").textContent()).toContain("Claude reads them as soon as you send.");
    // One session runs: the one the turn goes to is said on the button only, not on a line of its own.
    expect(await page.locator(".pass button").getAttribute("title")).toMatch(
      /^Send to Claude \((⌘↵|Ctrl\+Enter)\) · To the session .+ · s1$/,
    );
    expect(await page.locator(".pass-to").count()).toBe(0);
    await shot("05-listening");

    await page.locator(".pass textarea").fill("J'ai corrigé la règle, continue");
    // From the board, not only from the field: ⌘↵ or Ctrl+Enter sends, the word typed with it.
    // A card holding the keyboard does not take the chord for its own Enter, which renames it.
    await card("P1").focus();
    await page.keyboard.press("ControlOrMeta+Enter");
    const waited = await waiting;
    expect(await page.locator("textarea.card-editor").isVisible()).toBe(false);
    expect(waited.outcome).toBe("passed");
    expect(waited.text).toContain("J'ai corrigé la règle, continue");
    expect(waited.text).toContain("Paiement accepté");
    expect(waited.text).toContain("L'entrepôt réserve, pas nous");
    await page.waitForFunction(
      () => document.querySelector(".pending")?.textContent === "Claude is up to date",
    );
  });

  test("Send to Claude wakes the waiting agent in well under half a second", async () => {
    // The Stop hook the plugin runs with --rewake, parked until the human hands over; exit 2 wakes Claude.
    const parked = runHook({ session_id: SESSION, cwd: root, hook_event_name: "Stop" }, {}, true);
    await page.waitForFunction(
      () => document.querySelector(".status-text")?.textContent === "Claude is waiting for you to send",
    );
    await page.locator(".pass textarea").fill("Mesure du réveil");
    const before = performance.now();
    await page.locator(".pass button").click();
    const result = await parked;
    const elapsed = performance.now() - before;
    console.log(`Send to Claude → agent woken: ${elapsed.toFixed(0)} ms`);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Mesure du réveil");
    expect(elapsed).toBeLessThan(500);
    // "Up to date" held before the wake too: what says the wake reached the page is Claude no longer waiting.
    await page.waitForFunction(
      () => document.querySelector(".status-text")?.textContent !== "Claude is waiting for you to send",
    );
  });

  test("handing over while Claude is not listening says what will make it read", async () => {
    await page.locator(".pass textarea").fill("Un mot pour plus tard");
    await page.locator(".pass textarea").press("Enter");
    await page.locator(".toast", { hasText: "Sent." }).waitFor();
    expect(await page.locator(".toast").textContent()).toContain("at your next message in the terminal");
    expect(await page.locator(".pass textarea").inputValue()).toBe("");
    // Handing over again without a word does not erase the word already said.
    await page.locator(".pass button").click();
    await until("Claude would be told the word", async () =>
      (await pending()).includes("The human passed you the turn: Un mot pour plus tard"),
    );
  });

  test("a message being typed for Claude survives Claude handing the turn over, keyboard included", async () => {
    const field = page.locator(".pass textarea");
    await field.click();
    await page.keyboard.type("Bonne idée, le focus");
    await agent('pass "Qui réserve le stock ?"', "commande");
    await page.locator(".theirs", { hasText: "Qui réserve le stock ?" }).waitFor();
    expect(await field.inputValue()).toBe("Bonne idée, le focus");
    await page.keyboard.type(" !");
    expect(await field.inputValue()).toBe("Bonne idée, le focus !");
    await field.fill("");
  });

  test("the message for Claude takes several lines: it grows on focus, Shift+Enter breaks the line", async () => {
    const field = page.locator(".pass textarea");
    const height = async () => (await field.boundingBox())?.height ?? 0;
    await card("P1").focus();
    const resting = await height();
    await field.click();
    // Room to write as soon as the field has the keyboard, and back to one line once it is left.
    await until("the field grows on focus", async () => (await height()) > resting * 2);
    await page.keyboard.type("Deux choses :");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("le stock, puis le paiement");
    expect(await field.inputValue()).toBe("Deux choses :\nle stock, puis le paiement");
    await page.keyboard.press("Enter");
    await page.locator(".toast", { hasText: "Sent." }).waitFor();
    expect(await field.inputValue()).toBe("");
    await until("Claude would be told both lines", async () =>
      (await pending()).includes("Deux choses :\nle stock, puis le paiement"),
    );
    await card("P1").focus();
    await until("the field is back to one line", async () => (await height()) <= resting + 1);
  });
});

describe("history", () => {
  test("stepping back shows the board as it was, read-only, and comes back", async () => {
    const live = await page.locator("g.card").count();
    await openHistory();
    expect(await page.locator(".history-label").textContent()).toStartWith("Live · ");
    // The present on top, marked as the moment shown.
    expect(await page.locator('.history-list [aria-current="step"]').textContent()).toStartWith("● Live");

    // A moment of the list shows the board as that event left it: its creation, then one per card.
    await page.locator(".history-list .moment", { hasText: /Claude adds E1 / }).click();
    await page.locator(".banner").waitFor({ state: "visible" });
    expect(await page.locator("g.card").count()).toBe(3);
    expect(await page.locator(".history-label").textContent()).toMatch(/^4 \/ \d+ · .*Claude adds E1/);
    expect(await paletteType("Event").isDisabled()).toBe(true);
    expect(await page.locator(".board-menu button.remove-board").isDisabled()).toBe(true);
    await shot("06-history");

    // The keyboard goes on from there: ↑ is a newer moment.
    await page.locator('.history-list [aria-current="step"]').press("ArrowUp");
    await page.waitForFunction(() =>
      document.querySelector(".history-label")?.textContent?.startsWith("5 / "),
    );
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-current"))).toBe("step");

    await page.locator(".banner button").click();
    await page.locator(".banner").waitFor({ state: "hidden" });
    expect(await page.locator("g.card").count()).toBe(live);
  });

  test("the arrows and the slider stop at the events of the board on screen, or at every event when asked", async () => {
    await openHistory();
    const scope = page.getByRole("combobox", { name: "The history steps through" });
    const back = page.locator(".history button", { hasText: "◄" });
    const forward = page.locator(".history button", { hasText: "►" });
    const reads = (what: RegExp): Promise<void> =>
      until(`the history reads ${what}`, async () =>
        what.test((await page.locator(".history-label").textContent()) ?? ""),
      );
    const [asked, issued, signed] = await agent(
      [
        'board new "Devis" --id devis',
        'board new "Facture" --id facture',
        'add event "Devis demandé" --col 1 --board devis',
        'add event "Facture émise" --col 1 --board facture',
        'add event "Devis signé" --col 2 --board devis',
        'add event "Facture payée" --col 2 --board facture',
      ].join("\n"),
    );
    await page.locator(".board-picker select").selectOption("devis");
    await card(signed).waitFor();
    const all = (await workspace()).seq;

    // This board, by default: one step back is its previous event, not the other board's.
    expect(await scope.inputValue()).toBe("board");
    expect(await scope.locator("option").allTextContents()).toEqual(["This board", "Everything"]);
    await reads(/^Live · 3 events$/);
    await back.click();
    await reads(new RegExp(`^2 / 3 · .*Claude adds ${asked} “Devis demandé”$`));
    expect(await page.locator("g.card").count()).toBe(1);
    await back.click();
    await reads(/^1 \/ 3 · .*Claude creates the board “Devis”$/);
    // The board's history starts at its creation: no earlier moment would show it.
    await back.click();
    await Bun.sleep(150);
    expect(await page.locator(".history-label").textContent()).toStartWith("1 / 3 · ");
    expect(await page.title()).toBe("Devis · Sideco");
    await page.locator(".banner button").click();
    await reads(/^Live · 3 events$/);
    await page.locator('.history-list [aria-current="step"]').press("ArrowDown");
    await reads(/^2 \/ 3 · /);
    await page.locator(".banner button").click();

    // Everything: the same step back is the journal's very previous event.
    await scope.selectOption("everything");
    await reads(new RegExp(`^Live · ${all} events$`));
    await back.click();
    await reads(new RegExp(`^${all - 1} / ${all} · .*Claude adds ${signed} “Devis signé”$`));
    expect(await page.locator("g.card").count()).toBe(2);
    await back.click();
    await reads(new RegExp(`^${all - 2} / ${all} · .*Claude adds ${issued} “Facture émise”$`));

    // Back to this board from a moment that is not one of its events: the board is as its latest
    // event left it, and a step goes to its nearest event that way.
    await scope.selectOption("board");
    await reads(new RegExp(`^2 / 3 · .*Claude adds ${asked} “Devis demandé”$`));
    await forward.click();
    await reads(/^Live · 3 events$/);
    await page.locator(".banner").waitFor({ state: "hidden" });

    await page.locator(".board-picker select").selectOption("commande");
    await card("E1").waitFor();
  });
});

describe("other workshops", () => {
  // The task the sprint's tests move about.
  let write = "";

  test("kanban: dragging a task to another column tells the agent which lane", async () => {
    const [plug, written, mockup, blocker] = await agent(
      [
        'board new "Sprint 12" --format kanban --id sprint',
        'add task "Brancher le paiement" --lane todo',
        'add task "Écrire les tests" --lane todo',
        'add task "Maquette" --lane doing',
        'add blocker "Clé API manquante" --lane doing',
      ].join("\n"),
    );
    // The human stays on their board; a line says a new one exists.
    // Another message may still be up: wait for this one, not for any.
    await page.locator(".toast", { hasText: "Claude created the board “Sprint 12”" }).waitFor();
    expect(page.url()).toEndWith("#/b/commande");
    await page.locator(".board-picker select").selectOption("sprint");
    write = written;
    await card(mockup).waitFor();
    expect(await page.locator(".palette h2").textContent()).toBe("Kanban");
    // A board that asks its own question: the palette says it, not the workshop's.
    await agent('purpose "Qu\'est-ce qui bloque le sprint ?" --board sprint');
    await page.locator(".palette .purpose", { hasText: "Qu'est-ce qui bloque le sprint ?" }).waitFor();

    const doing = await centre(blocker);
    await dragTo(plug, doing.x, doing.y + 120);
    await until("the task is in progress", async () => (await elementOf("sprint", plug))?.lane === "doing");
    expect(await pending()).toContain(`→ ${plug} moved lane todo → doing`);
    await settled(plug);
    await shot("07-kanban");
  });

  test("kanban: a double-click on the name of a column renames it for this board", async () => {
    const name = page.locator(".lane-label", { hasText: "Doing" });
    await name.dblclick();
    const editor = page.locator(".card-editor");
    await editor.waitFor();
    expect(await editor.inputValue()).toBe("Doing");
    await editor.fill("À valider");
    await editor.press("Enter");
    await page.locator(".lane-label", { hasText: "À valider" }).waitFor();
    expect(await pending()).toContain('~ lane doing named "À valider"');
    await shot("23-lane-renamed");
  });

  test("kanban: Mark done takes a task to the last lane, D to the lane before; the lane says it, not a tick", async () => {
    await card(write).click();
    // Out of the way under ⋯: the toolbar shows the actions taken most.
    const tools = page.locator(".card-tools");
    expect(await tools.locator(":scope > button").allTextContents()).toEqual([
      "Rename",
      "Detail",
      "Note for Claude",
    ]);
    expect(await tools.locator("button", { hasText: "Mark done" }).isVisible()).toBe(false);
    await tools.locator("summary").click();
    expect(await tools.locator(".menu-items button").allTextContents()).toEqual([
      "Link",
      "Mark done",
      "Remove",
    ]);
    await tools.locator(".menu-items button", { hasText: "Mark done" }).click();
    await until(
      "the list closed",
      async () => (await tools.locator("details.card-more").getAttribute("open")) === null,
    );
    await until("the task is in Done", async () => (await elementOf("sprint", write))?.lane === "done");
    expect(await pending()).toContain(`→ ${write} moved lane todo → done`);
    expect(await card(write).locator(".card-done").count()).toBe(0);
    await page.locator(".card-tools button", { hasText: "Not done" }).waitFor({ state: "attached" });
    await shot("21-done");

    await card(write).focus();
    await page.keyboard.press("d");
    await until("the task is in À valider", async () => (await elementOf("sprint", write))?.lane === "doing");
    await page.locator(".spoken", { hasText: "À valider" }).waitFor({ state: "attached" });
  });

  test("the card toolbar leaves the board to the panel: it hides when the keyboard goes there, and comes back with the card", async () => {
    const tools = page.locator(".card-tools");
    await card(write).click();
    await tools.waitFor();
    await page.locator("#tab-history").click();
    await tools.waitFor({ state: "hidden" });
    await card(write).click();
    await tools.waitFor();
    await page.keyboard.press("Escape");
  });

  test("a click beside the drawing lets the card go; the panels and the controls keep it", async () => {
    const chosen = async () => ((await card(write).getAttribute("class")) ?? "").includes("is-selected");
    const choose = async () => {
      await card(write).click();
      await until("the card is chosen", chosen);
    };
    const letGo = async (what: string) => until(`${what} lets the card go`, async () => !(await chosen()));
    // The stage under the drawing.
    const board = await page.locator(".sideco-board").boundingBox();
    const stage = await page.locator(".canvas").boundingBox();
    if (!board || !stage) throw new Error("no board on screen");
    expect(stage.y + stage.height).toBeGreaterThan(board.y + board.height + 20);
    await choose();
    await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height - 10);
    await letGo("the stage");
    // The bare header and footer.
    await choose();
    // The brand is a link home now (T90): the header's bare corner.
    await page.locator("header.top").click({ position: { x: 2, y: 2 } });
    await letGo("the header");
    await choose();
    await page.locator("footer.bottom").click({ position: { x: 4, y: 4 } });
    await letGo("the footer");
    // The panels, the bare one included, and the controls work on the card: they keep it.
    await choose();
    await page.locator("#tab-history").click();
    await page.locator("aside.left").click({ position: { x: 8, y: 300 } });
    await page.locator(".zoom button").last().click();
    await page.locator(".zoom button").first().click();
    expect(await chosen()).toBe(true);
    await page.keyboard.press("Escape");
  });

  test("with cards all around it, the card toolbar never covers the card chosen", async () => {
    const lane = (name: string, n: number) =>
      Array.from({ length: n }, (_, k) => `add task "${name} ${k + 1}" --lane ${name}`);
    const made = await agent(
      [
        'board new "Serré" --format kanban --id serre-tools',
        ...lane("todo", 5),
        ...lane("doing", 5),
        ...lane("done", 5),
      ].join("\n"),
    );
    await page.locator(".board-picker select").selectOption("serre-tools");
    // The third of the middle lane: a card above, one under, a lane on each side.
    const middle = made[7];
    await card(middle).click();
    const tools = page.locator(".card-tools");
    await tools.waitFor();
    const [bar, chosen] = [await tools.boundingBox(), await card(middle).boundingBox()];
    if (!bar || !chosen) throw new Error("drawn");
    const covers =
      bar.x < chosen.x + chosen.width &&
      bar.x + bar.width > chosen.x &&
      bar.y < chosen.y + chosen.height &&
      bar.y + bar.height > chosen.y;
    expect(covers).toBe(false);
    await page.keyboard.press("Escape");
  });

  test("flow: a step added while another is selected is linked to it", async () => {
    const [, , ship] = await agent(
      [
        'board new "Livraison" --format flow --id livraison',
        'add step "Recevoir la commande" --alias recevoir',
        'add decision "En stock ?" --from @recevoir --alias stock',
        'add step "Expédier" --from @stock --edge "oui"',
        'add outcome "Commande annulée" --from @stock --edge "non"',
      ].join("\n"),
    );
    await page.locator(".board-picker select").selectOption("livraison");
    await card(ship).waitFor();
    await card(ship).click();
    await page.waitForFunction(
      (id) =>
        document.querySelector(".palette .how")?.textContent === `The new element will be linked to ${id}.`,
      ship,
    );
    const delivered = mint(await workspace(), "O");
    await paletteType("Outcome").click();
    await typeInEditor("Colis livré");
    await card(delivered).waitFor();
    const board = (await workspace()).boards.find((b) => b.id === "livraison");
    expect(board?.edges.some((e) => e.src === ship && e.dst === delivered)).toBe(true);
    await shot("08-flow");
  });

  test("impact / effort: four lanes say the impact and the effort they stand for, and a drag re-sorts", async () => {
    const [insert, , canvas] = await agent(
      [
        'board new "Priorités" --format impact-effort --id priorites',
        'add item "Insérer une colonne" --lane quick',
        'add item "Icône du type" --lane quick',
        'add item "Canevas libre" --lane fill',
      ].join("\n"),
    );
    await page.locator(".board-picker select").selectOption("priorites");
    await card(canvas).waitFor();
    expect(await page.locator(".palette h2").textContent()).toBe("Impact / Effort");
    expect(await page.locator(".lane-label").allTextContents()).toEqual([
      "Quick wins",
      "Big bets",
      "Fill-ins",
      "Avoid",
    ]);
    expect(await page.locator(".lane-hint").allTextContents()).toEqual([
      "High impact · low effort",
      "High impact · high effort",
      "Low impact · low effort",
      "Low impact · high effort",
    ]);

    // The plan is two cells by two: the low-impact cell sits under the quick wins, the big bets beside them.
    const quick = await centre(insert);
    const fill = await centre(canvas);
    expect(fill.y).toBeGreaterThan(quick.y + 100);
    expect(await page.locator(".axis-label").allTextContents()).toEqual(["Impact →", "Effort →"]);
    const bets = await page.locator(".band-lane .lane-label", { hasText: "Big bets" }).boundingBox();
    if (!bets) throw new Error("no Big bets cell");
    await dragTo(canvas, bets.x + 100, quick.y);
    await until("the item is a big bet", async () => (await elementOf("priorites", canvas))?.lane === "bet");
    expect(await pending()).toContain(`→ ${canvas} moved lane fill → bet`);
    await settled(canvas);
    await shot("19-impact-effort");

    // Each axis names its two ends; zoomed in and scrolled sideways, a cell keeps its name in sight.
    expect(await page.locator(".axis-bound").allTextContents()).toEqual(["low", "high", "low", "high"]);
    const zoomIn = page.getByRole("button", { name: "Zoom in" });
    const zoomOut = page.getByRole("button", { name: "Zoom out" });
    for (let i = 0; i < 4; i++) await zoomIn.click();
    const scroller = page.locator(".canvas-scroll");
    const quickName = page.locator(".lane-label", { hasText: "Quick wins" });
    const quickCell = page.locator(".band-lane .lane-bg").first();
    const frameLeft = (await scroller.boundingBox())?.x ?? 0;
    const cellLeft = (await quickCell.boundingBox())?.x ?? 0;
    await scroller.evaluate(
      (el, by) => {
        el.scrollLeft += by;
      },
      cellLeft - frameLeft + 120,
    );
    // The cell's left edge is out of sight; its name is not.
    await until(
      "the cell scrolled past its left edge",
      async () => ((await quickCell.boundingBox())?.x ?? 0) < frameLeft,
    );
    await until("the name of the cell followed the scroll", async () => {
      const at = await quickName.boundingBox();
      return at !== null && at.x >= frameLeft;
    });
    await shot("48-impact-effort-scrolled");
    for (let i = 0; i < 4; i++) await zoomOut.click();
  });

  test("a new board from the page: pick a workshop, name it, start", async () => {
    await page.locator(".board-menu summary").click();
    await page.locator(".board-menu .menu-items button", { hasText: "New board…" }).click();
    await page.locator("dialog.new-board").waitFor({ state: "visible" });
    await page.locator('dialog.new-board input[name="title"]').fill("Rétro sprint 12");
    await page.locator("dialog.new-board label.choice", { hasText: "Retrospective" }).click();
    await shot("09-new-board");
    await page.locator("dialog.new-board button[type=submit]").click();
    await page.waitForFunction(() => location.hash === "#/b/retro-sprint-12");
    // The address changes before the palette is drawn again: wait for it rather than read the board before.
    await page.locator(".palette h2", { hasText: "Retrospective" }).waitFor();
    expect(await page.locator(".palette h2").textContent()).toBe("Retrospective");

    const point = mint(await workspace(), "P");
    await paletteType("Observation").click();
    await typeInEditor("Les revues sont rapides");
    await card(point).waitFor();
    expect((await workspace()).boards.find((b) => b.id === "retro-sprint-12")?.elements[0]).toMatchObject({
      id: point,
      lane: "went-well",
    });

    // An action from the palette lands in Try; one made from a point is linked from it.
    const action = mint(await workspace(), "A");
    await paletteType("Action").click();
    await typeInEditor("Garder des revues courtes");
    await card(action).waitFor();
    expect((await elementOf("retro-sprint-12", action))?.lane).toBe("try");
    const made = mint(await workspace(), "A");
    await card(point).click();
    await page.locator(".card-tools button", { hasText: "Make an action of it" }).click();
    await typeInEditor("Revue à deux");
    await card(made).waitFor();
    const retro = (await workspace()).boards.find((b) => b.id === "retro-sprint-12");
    expect(retro?.elements.find((e) => e.id === made)?.lane).toBe("try");
    expect(retro?.edges).toContainEqual(expect.objectContaining({ src: point, dst: made }));
    await settled(made);
    await shot("47-retro-action");
  });
});

describe("keeping the model", () => {
  test("the export menu downloads a design note that carries the diagram", async () => {
    await page.locator(".board-picker select").selectOption("commande");
    await card("E1").waitFor();
    await page.locator(".board-menu summary").click();
    await shot("53-board-menu");
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
    // The cards are painted one board at a time: count once they are all back.
    await until("every card is back", async () => (await page.locator("g.card").count()) === before);
    expect(await page.locator("g.card.is-fresh").count()).toBe(0);
    expect(await card("E1").textContent()).toContain("Commande validée");
  });
});

describe("the reader's language", () => {
  const language = () => page.locator("select.language");

  test("the page opens in English, and says so to the browser", async () => {
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
    expect(await language().inputValue()).toBe("en");
    expect(await language().locator("option").allTextContents()).toEqual(["English", "Français"]);
    expect(await page.locator(".pass button.primary").textContent()).toBe("Send to Claude");
    expect(await page.locator("g.card[data-id='E1'] title").textContent()).toMatch(/^E1 · Event · added by /);
  });

  test("choosing French turns the whole page, the drawing and the exports to French, and it sticks", async () => {
    await language().selectOption("fr");
    await page.waitForFunction(() => document.documentElement.lang === "fr");
    await card("E1").waitFor();
    expect(page.url()).toEndWith("#/b/commande");
    expect(await page.locator(".pass button.primary").textContent()).toBe("Envoyer à Claude");
    expect(await page.locator(".palette h2").textContent()).toBe("Event Storming");
    expect(await paletteType("Événement").count()).toBe(1);
    await openHistory();
    expect(await page.locator(".history-label").textContent()).toStartWith("En direct · ");
    expect(await page.locator(".history select option").allTextContents()).toEqual(["Ce tableau", "Tout"]);
    expect(await page.locator("g.card[data-id='E1'] title").textContent()).toMatch(
      /^E1 · Événement · ajouté par /,
    );
    // What the user wrote is theirs: it is never translated.
    expect(await card("E1").textContent()).toContain("Commande validée");

    await page.locator(".board-menu summary").click();
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
    expect(await page.locator(".pass button.primary").textContent()).toBe("Send to Claude");
  });
});

describe("taking a gesture back", () => {
  const BOARD = "retour";
  const undo = () => page.locator(".undo button").first();
  const redo = () => page.locator(".undo button").last();
  const labelOf = async (id: string): Promise<string | undefined> => (await elementOf(BOARD, id))?.label;
  /** The page offers only what it has been told: wait for it, as a hand on the keyboard would. */
  const offered = (button: ReturnType<typeof undo>): Promise<void> =>
    until("the page offers it", async () => !(await button.isDisabled()));

  let [placed, reserved] = ["", ""];

  test("Undo and Redo are offered once the human has done something, and only then", async () => {
    [placed, reserved] = await agent(
      `board new "Retour" --id ${BOARD}\nadd event "Commande passée" --col 1 --alias a\nadd event "Stock réservé" --col 2 --alias b\nlink @a @b`,
    );
    await page.locator(".board-picker select").selectOption(BOARD);
    // Wait for this card's label, not for any card.
    await card(placed).getByText("Commande passée").waitFor();
    expect(await undo().getAttribute("aria-label")).toStartWith("Undo");
    expect(await undo().isDisabled()).toBe(true);
    expect(await redo().isDisabled()).toBe(true);

    await card(placed).dblclick();
    await typeInEditor("Validée");
    await until("the rename reached the journal", async () => (await labelOf(placed)) === "Validée");
    await until("Undo is offered", async () => !(await undo().isDisabled()));
    await shot("13-undo");

    await undo().click();
    await until("the label is back", async () => (await labelOf(placed)) === "Commande passée");
    await card(placed).getByText("Commande passée").waitFor();
    await until("Redo is offered", async () => !(await redo().isDisabled()));
    expect(await undo().isDisabled()).toBe(true);
    await redo().click();
    await until("the rename is back", async () => (await labelOf(placed)) === "Validée");
  });

  test("the keyboard does the same, and leaves a text being typed alone", async () => {
    await offered(undo());
    await page.keyboard.press("Control+z");
    await until("Ctrl+Z took the rename back", async () => (await labelOf(placed)) === "Commande passée");
    await offered(redo());
    await page.keyboard.press("Control+Shift+z");
    await until("Ctrl+Shift+Z put it back", async () => (await labelOf(placed)) === "Validée");

    await card(reserved).dblclick();
    const editor = page.locator("textarea.card-editor");
    await editor.waitFor({ state: "visible" });
    const before = (await workspace()).seq;
    await editor.press("Control+z");
    await Bun.sleep(150);
    expect((await workspace()).seq).toBe(before);
    await editor.press("Escape");
  });

  test("a removed card comes back under its id, with its link", async () => {
    await card(reserved).focus();
    await page.keyboard.press("Delete");
    await until("the card is gone", async () => (await elementOf(BOARD, reserved)) === undefined);
    await card(reserved).waitFor({ state: "detached" });
    await page.keyboard.press("Control+z");
    await until("the card is back", async () => (await elementOf(BOARD, reserved))?.by === "agent");
    await card(reserved).waitFor();
    const board = (await workspace()).boards.find((b) => b.id === BOARD);
    expect(board?.edges.map((e) => `${e.src}>${e.dst}`)).toEqual([`${placed}>${reserved}`]);
  });

  test("a removed board is offered back at once, and comes back whole", async () => {
    const sheet = page.locator("dialog.remove-board");
    await page.locator(".board-menu summary").click();
    await page.locator(".board-menu button.remove-board").click();
    expect(await sheet.locator("p").textContent()).toContain("Undo brings it back");
    await sheet.locator("button.danger").click();
    await until("the board is gone", async () => !(await workspace()).boards.some((b) => b.id === BOARD));

    const offer = page.locator(".toast button");
    await offer.waitFor();
    expect(await page.locator(".toast").textContent()).toContain("Board “Retour” removed");
    await shot("14-undo-removed-board");
    await offer.click();
    await until("the board is back", async () => (await workspace()).boards.some((b) => b.id === BOARD));
    await until("the page shows it again", async () => page.url().endsWith(`#/b/${BOARD}`));
    await card(reserved).waitFor();
    expect(await labelOf(placed)).toBe("Validée");

    // Net of the back-and-forth, Claude is told one thing: the rename that stands.
    const told = await pending();
    expect(told).toContain(`~ ${placed} renamed "Commande passée" → "Validée"`);
    expect(told).not.toContain("removed");
    expect(told).not.toContain("restored");
  });
});

describe("talking it through, note by note", () => {
  const BOARD = "fil";
  const thread = (id: string) => page.locator(`.notes .thread[data-thread="${id}"]`);
  const said = (id: string) => thread(id).locator(".thread-notes > li");
  const replyField = (id: string) => thread(id).locator(".thread-reply [name^=reply-]");
  const badge = (id: string) => card(id).locator(".card-notes text");
  // The cards and the two notes Claude starts with; the human's answer, once given.
  let [placed, reserved, asked, rest, answer] = ["", "", "", "", ""];

  test("a note says which card it is about, who wrote it and who is waited for", async () => {
    [placed, reserved, asked, rest] = await agent(
      `board new "Fil" --id ${BOARD}\nadd event "Commande passée" --col 1\nadd event "Stock réservé" --col 2 --alias b\nnote "Qui réserve ?" --on @b\nnote "Et le reste ?"`,
    );
    await page.locator(".board-picker select").selectOption(BOARD);
    await thread(asked).waitFor({ state: "attached" });
    // Already there when the board was shown, they wait in their tab, which says so.
    const tab = page.locator("#tab-notes");
    expect(await tab.getAttribute("aria-selected")).toBe("false");
    expect(await tab.locator(".tab-count").textContent()).toBe("2");
    expect(await tab.locator(".tab-count").getAttribute("class")).toContain("is-yours");
    expect(await tab.getAttribute("aria-label")).toBe("Notes: 2 open, 2 awaiting your answer");
    await tab.click();
    await thread(asked).waitFor();
    expect(await page.locator(".notes h2").textContent()).toBe("Open notes (2)");
    expect(await thread(asked).locator(".thread-on").textContent()).toBe(`${reserved} · Stock réservé`);
    // The card a note is about says so in its name, as its badge does to the eye.
    expect(await card(reserved).getAttribute("aria-label")).toContain(" · 1 open note");
    expect(await card(placed).getAttribute("aria-label")).not.toContain("open note");
    expect(await thread(rest).locator(".thread-on").textContent()).toBe("Whole board");
    expect(await said(asked).locator(".thread-author").textContent()).toBe("Claude");
    // The id Claude uses in the terminal is on the message it names.
    expect(await said(asked).locator(".thread-id").textContent()).toBe(asked);
    expect(await said(asked).locator("p").textContent()).toBe("Qui réserve ?");
    expect(await thread(asked).locator(".thread-waits").textContent()).toBe("Awaits your answer");
    expect(await badge(reserved).textContent()).toBe("1");
  });

  test("the human answers in the thread, and Claude is told which note the answer is to", async () => {
    // Several lines in one answer: Shift+Enter breaks the line, Enter sends.
    answer = mint(await workspace(), "N");
    await replyField(asked).fill("L'entrepôt");
    await replyField(asked).press("Shift+Enter");
    await replyField(asked).pressSequentially("de Lyon");
    await replyField(asked).press("Enter");
    await said(asked).nth(1).waitFor();
    expect(await said(asked).nth(1).locator(".thread-author").textContent()).toBe("You");
    expect(await said(asked).nth(1).locator("p").textContent()).toBe("L'entrepôt\nde Lyon");
    expect(
      await said(asked)
        .nth(1)
        .locator("p")
        .evaluate((p) => getComputedStyle(p).whiteSpace),
    ).toBe("pre-wrap");
    expect(await thread(asked).locator(".thread-waits").textContent()).toBe("Awaits Claude");
    expect(await replyField(asked).inputValue()).toBe("");
    // Still one discussion on the card, and two on the board.
    expect(await badge(reserved).textContent()).toBe("1");
    expect(await page.locator(".notes h2").textContent()).toBe("Open notes (2)");
    expect(await pending()).toContain(`reply ${answer} to ${asked} on ${reserved}: L'entrepôt`);
  });

  test("Claude's answer lands in the same thread, and a reply being typed elsewhere survives it", async () => {
    await replyField(rest).fill("Brouillon en cours");
    const [again] = await agent(`reply ${asked} "Toujours l'entrepôt ?"`, BOARD);
    await said(asked).nth(2).waitFor();
    expect(await said(asked).allTextContents()).toEqual([
      `Claude${asked}Qui réserve ?`,
      `You${answer}L'entrepôt\nde Lyon`,
      `Claude${again}Toujours l'entrepôt ?`,
    ]);
    expect(await thread(asked).locator(".thread-waits").textContent()).toBe("Awaits your answer");
    expect(await replyField(rest).inputValue()).toBe("Brouillon en cours");
    expect(await replyField(rest).evaluate((field) => field === document.activeElement)).toBe(true);
    await replyField(rest).fill("");
  });

  test("a card points to its discussions, and a discussion points back to its card", async () => {
    const classes = async (locator: ReturnType<typeof card>): Promise<string[]> =>
      ((await locator.getAttribute("class")) ?? "").split(" ");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Escape");
    await page.locator("#tab-session").click();
    await card(reserved).click();
    // Chosen from the session, the card shows its detail, which leads to its discussions.
    const toNotes = page.locator(".card-panel-notes");
    await toNotes.waitFor();
    expect(await toNotes.textContent()).toBe("1 open note on this card");
    await toNotes.click();
    await until("the card's discussion is marked", async () =>
      (await classes(thread(asked))).includes("is-current"),
    );
    expect(await page.locator("#tab-notes").getAttribute("aria-selected")).toBe("true");
    expect(await classes(thread(rest))).not.toContain("is-current");
    await shot("15-threads");

    await page.keyboard.press("Escape");
    await until("nothing is selected", async () => !(await classes(card(reserved))).includes("is-selected"));
    await thread(asked).hover();
    await until("the card is pointed at", async () => (await classes(card(reserved))).includes("is-pointed"));
    await thread(asked).locator(".thread-on").click();
    await until("the card is selected", async () => (await classes(card(reserved))).includes("is-selected"));
    await page.keyboard.press("Escape");
    await until(
      "nothing is selected again",
      async () => !(await classes(card(reserved))).includes("is-selected"),
    );
    // Answering a note shows its card as its title does, and leaves the keyboard in the answer.
    await thread(asked).locator(".thread-reply textarea").click();
    await until("the card is selected by the answer", async () =>
      (await classes(card(reserved))).includes("is-selected"),
    );
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("TEXTAREA");
    // Chosen from its discussion, the card leaves the reader in the Notes tab.
    expect(await page.locator("#tab-notes").getAttribute("aria-selected")).toBe("true");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Escape");
  });

  test("a note Claude adds opens the Notes tab on its own, and a card's count leads there too", async () => {
    const notesTab = page.locator("#tab-notes");
    const chosen = async () => (await notesTab.getAttribute("aria-selected")) === "true";
    await page.locator("#tab-session").click();
    const [cancelled] = await agent(`note "Et la commande annulée ?" --on ${placed}`, BOARD);
    await until("the Notes tab opened", chosen);
    // Opened without being asked, it is said to whoever does not see the panel change.
    await page
      .locator(".spoken", { hasText: "Claude wrote a note that waits for you: the Notes tab is open." })
      .waitFor({ state: "attached" });
    await thread(cancelled).waitFor();
    expect(await notesTab.locator(".tab-count").textContent()).toBe("3");

    await page.locator("#tab-history").click();
    await badge(placed).click();
    await until("the count led to the Notes tab", chosen);
    await page.keyboard.press("Escape");
    await thread(cancelled).locator(".thread-resolve").click();
    await thread(cancelled).waitFor({ state: "detached" });
  });

  test("resolving closes the whole thread", async () => {
    await thread(asked).locator(".thread-resolve").click();
    await thread(asked).waitFor({ state: "detached" });
    await until("the card no longer counts it", async () => (await badge(reserved).count()) === 0);
    expect(await page.locator(".notes h2").textContent()).toBe("Open notes (1)");
    expect(await pending()).toContain(`✓ note ${asked} resolved`);
  });

  test("closing a thread with an answer typed but not sent says it first: nothing typed is lost", async () => {
    const resolve = thread(rest).locator(".thread-resolve");
    expect(await resolve.textContent()).toBe("Resolve");
    await replyField(rest).fill("Réponse de dernière minute");
    // The button says what it will do with the words in the field.
    await until("the button offers both", async () => (await resolve.textContent()) === "Reply and resolve");
    await replyField(rest).fill("  ");
    await until("the button only closes", async () => (await resolve.textContent()) === "Resolve");
    await replyField(rest).fill("Réponse de dernière minute");
    await resolve.click();
    await thread(rest).waitFor({ state: "detached" });
    const told = await pending();
    expect(told).toContain(`to ${rest}: Réponse de dernière minute`);
    expect(told).toContain(`✓ note ${rest} resolved`);
  });
});

describe("what Claude has not read yet", () => {
  const BOARD = "non-lu";
  const WORDS = "Not read by Claude yet";
  const cardMark = (id: string) => card(id).locator(".card-unread");
  const threadMark = (id: string) => page.locator(`.notes .thread[data-thread="${id}"] .thread-unread`);

  test("a card the human renamed and a thread they answered are marked, until Claude has read them", async () => {
    const [issued, paid, chase] = await agent(
      `board new "Non lu" --id ${BOARD}\nadd event "Facture émise" --col 1\nadd event "Facture payée" --col 2\nnote "Qui relance ?"`,
    );
    await page.locator(".board-picker select").selectOption(BOARD);
    await card(paid).getByText("Facture payée").waitFor();
    expect(await page.locator(".card-unread, .thread-unread").count()).toBe(0);

    await card(issued).dblclick();
    await typeInEditor("Facture envoyée");
    await cardMark(issued).waitFor();
    // Said in words too: to a pointer on the mark, and in the card's name for a screen reader.
    expect(await cardMark(issued).locator("title").textContent()).toBe(WORDS);
    expect(await card(issued).getAttribute("aria-label")).toEndWith(WORDS);
    expect(await cardMark(paid).count()).toBe(0);

    // Already there when the board was shown, the note is read in its tab.
    await page.locator("#tab-notes").click();
    const reply = page.locator(`.notes .thread[data-thread="${chase}"] .thread-reply [name^=reply-]`);
    await reply.fill("La compta");
    await reply.press("Enter");
    await threadMark(chase).waitFor();
    expect(await threadMark(chase).textContent()).toBe(WORDS);
    await shot("18-unread");

    // The marks tell about now: a board shown as it was carries none.
    await openHistory();
    await page.locator(".history button", { hasText: "◄" }).click();
    await page.locator(".banner").waitFor({ state: "visible" });
    await card(issued).getByText("Facture envoyée").waitFor();
    expect(await page.locator(".card-unread, .thread-unread").count()).toBe(0);
    await page.locator(".banner button").click();
    await cardMark(issued).waitFor();

    // The session reads its digest, as the hooks do.
    await fetch(`${running.url}/api/changes?session=${SESSION}&ack=1`);
    await cardMark(issued).waitFor({ state: "detached" });
    await threadMark(chase).waitFor({ state: "detached" });
    // Read, the card is heard by its words alone.
    expect(await card(issued).getAttribute("aria-label")).toStartWith(`Facture envoyée · ${issued}`);
    expect(await card(issued).getAttribute("aria-label")).not.toEndWith(WORDS);
  });
});

// The two events of the board "ajout-case", read by the describes that follow it too.
let [placed, reserved] = ["", ""];

describe("adding where the pointer is", () => {
  const offer = (type: string) => page.locator(`.sideco-board .add-here[data-type="${type}"]`);
  const offers = () => page.locator(".sideco-board .add-here");
  let policy = "";

  test("retro: a column offers one + per kind of card, and the card lands in that column", async () => {
    const [tests] = await agent(
      `board new "Rétro du sprint" --format retro --id ajout\nadd point "Les tests d'abord" --lane keep`,
    );
    await page.locator(".board-picker select").selectOption("ajout");
    await card(tests).getByText("Les tests").waitFor();
    // Nothing is offered while the pointer is elsewhere.
    await page.mouse.move(700, 20);
    expect(await offers().count()).toBe(0);

    const lane = await page.locator(".band-lane .lane-label", { hasText: "Try" }).boundingBox();
    if (!lane) throw new Error("no Try lane");
    await page.mouse.move(lane.x + 60, lane.y + 150);
    await offer("action").waitFor();
    // One + per kind of card, and the × of the empty lane: a retro's lanes are its own.
    expect(await offers().count()).toBe(3);
    expect(await offer("remove-lane").count()).toBe(1);
    expect(await offer("action").getAttribute("aria-label")).toBe("Add: Action");
    expect(await offer("point").getAttribute("aria-label")).toBe("Add: Observation");
    // Let the offer finish fading in before the picture.
    await Bun.sleep(200);
    await shot("16-add-here");

    const action = mint(await workspace(), "A");
    await offer("action").click();
    await typeInEditor("Écrire le test avant le code");
    await until("the action is in Try", async () => {
      const added = await elementOf("ajout", action);
      return added?.type === "action" && added.lane === "try";
    });
    await card(action).getByText("Écrire le test").waitFor();
    // How to add is in the keys sheet; the palette keeps the types, each saying what it is for on hover.
    expect(await page.locator(".palette .how").count()).toBe(0);
    expect(await page.locator(".palette .type", { hasText: "Action" }).getAttribute("title")).toContain(
      " · ",
    );
  });

  test("timeline: a cell offers the kind of its row, and the card lands in that step", async () => {
    [placed, reserved] = await agent(
      `board new "Ajout en case" --id ajout-case\nadd event "Commande passée" --col 1\nadd event "Stock réservé" --col 2`,
    );
    await page.locator(".board-picker select").selectOption("ajout-case");
    await card(reserved).getByText("Stock réservé").waitFor();
    // The row names sit over the cards, where they stay while the board scrolls.
    const row = await page.locator(".heads-rows .band-label", { hasText: "Policy" }).boundingBox();
    const e2 = await centre(reserved);
    if (!row) throw new Error("no Policy row");
    await page.mouse.move(e2.x, row.y + row.height / 2);
    await offer("policy").waitFor();
    expect(await offers().count()).toBe(1);
    await Bun.sleep(200);
    await shot("17-add-in-cell");

    policy = mint(await workspace(), "P");
    await offer("policy").click();
    await typeInEditor("Quand stock réservé, facturer");
    await until("the policy is in step 2", async () => (await elementOf("ajout-case", policy))?.col === 2);
    await card(policy).waitFor();
  });

  test("timeline: the edge between two steps offers a column, and the steps after it move over", async () => {
    const e2 = await settled(reserved);
    const heading = await page.locator(".band-step-label", { hasText: /^2$/ }).boundingBox();
    if (!heading) throw new Error("no heading for step 2");
    // Just right of the rule that opens step 2, as high as the step numbers.
    await page.mouse.move(e2.x - 4, heading.y + heading.height / 2);
    const column = page.locator('.sideco-board .add-here[data-column="2"]');
    await column.waitFor();
    expect(await offers().count()).toBe(1);
    expect(await column.getAttribute("aria-label")).toBe("Insert a column here");
    await Bun.sleep(200);
    await shot("20-insert-column");

    await column.click();
    await until("step 2 moved to 3", async () => (await elementOf("ajout-case", reserved))?.col === 3);
    expect((await elementOf("ajout-case", policy))?.col).toBe(3);
    expect((await elementOf("ajout-case", placed))?.col).toBe(1);
  });

  test("timeline: an empty step offers a « × » at its top, and the steps after it move back", async () => {
    // The card added before is still selected: its toolbar would cover the step.
    await page.keyboard.press("Escape");
    await page.locator(".card-tools").waitFor({ state: "hidden" });
    // Step 2 is the empty one the column made; its event cell is level with the first event, one step right.
    const e1 = await centre(placed);
    const step = await page.locator(".band-step-label", { hasText: /^2$/ }).boundingBox();
    if (!step) throw new Error("no heading for step 2");
    await page.mouse.move(step.x + step.width / 2, e1.y);
    const remove = page.locator('.sideco-board .add-here[data-type="remove-column"][data-column="2"]');
    await remove.waitFor();
    expect(await remove.getAttribute("aria-label")).toBe("Remove step 2");
    await Bun.sleep(200);
    await shot("21-remove-step");

    await remove.click();
    await until("step 3 moved back to 2", async () => (await elementOf("ajout-case", reserved))?.col === 2);
    expect((await elementOf("ajout-case", policy))?.col).toBe(2);
    await page.keyboard.press("Control+z");
    await until(
      "Undo puts the empty step back",
      async () => (await elementOf("ajout-case", reserved))?.col === 3,
    );
    // The page offers Redo once the undo has reached it, not before.
    await page.locator("button:not([disabled])", { hasText: /^Redo$/ }).waitFor();
    await page.keyboard.press("Control+Shift+z");
    await until("Redo takes it out again", async () => (await elementOf("ajout-case", reserved))?.col === 2);
  });

  test("the offer leaves with the pointer, and is not made on a board shown as it was", async () => {
    // The card added before is still selected: its toolbar, kept inside the window, would cover the second event.
    await page.keyboard.press("Escape");
    await page.locator(".card-tools").waitFor({ state: "hidden" });
    const e2 = await centre(reserved);
    await page.mouse.move(e2.x, e2.y);
    await offer("event").waitFor();
    await page.mouse.move(700, 20);
    await until("the offer is gone", async () => (await offers().count()) === 0);

    await openHistory();
    await page.locator(".history button", { hasText: "◄" }).click();
    await page.locator(".banner").waitFor({ state: "visible" });
    await page.mouse.move(e2.x, e2.y + 4);
    await Bun.sleep(150);
    expect(await offers().count()).toBe(0);
    await page.locator(".banner button").click();
    await page.locator(".banner").waitFor({ state: "hidden" });
    await page.mouse.move(e2.x, e2.y);
    await offer("event").waitFor();
  });
});

describe("reopening a card without changing it", () => {
  test("says nothing to Claude: not its label, not a detail Claude wrote on several lines", async () => {
    const detail = "Paiement par carte.\nVirement refusé.";
    // Posted as JSON: the CLI grammar holds one command per line.
    const posted = await fetch(`${running.url}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor: "agent",
        session: SESSION,
        commands: [{ kind: "annotate", board: "ajout-case", id: placed, detail }],
      }),
    });
    expect(posted.ok).toBe(true);
    await card(placed).locator(".card-detail").waitFor();
    const before = (await workspace()).seq;
    const field = page.locator("textarea.card-panel-editor");
    const editor = page.locator("textarea.card-editor");

    await card(placed).click();
    await page.locator(".card-tools button", { hasText: "Detail" }).click();
    await field.waitFor({ state: "visible" });
    // A detail is read before it is changed: nothing comes selected, the caret waits at its start.
    expect(
      await field.evaluate(
        (f: HTMLTextAreaElement) =>
          document.activeElement === f && f.selectionStart === 0 && f.selectionEnd === 0,
      ),
    ).toBe(true);
    expect(await field.getAttribute("aria-label")).toBe(`Detail of ${placed}`);
    await field.press("ControlOrMeta+Enter");
    await field.waitFor({ state: "hidden" });

    await card(placed).dblclick();
    await editor.waitFor({ state: "visible" });
    await editor.press("Enter");
    await editor.waitFor({ state: "hidden" });

    await Bun.sleep(200);
    expect((await workspace()).seq).toBe(before);
    expect((await elementOf("ajout-case", placed))?.detail).toBe(detail);
  });

  test("a detail typed on several lines keeps its lines: Enter breaks the line, ⌘/Ctrl+Enter saves", async () => {
    const field = page.locator("textarea.card-panel-editor");
    await card(placed).click();
    await page.locator(".card-tools button", { hasText: "Detail" }).click();
    await field.waitFor({ state: "visible" });
    await field.fill("Première  ligne");
    await field.press("Enter");
    await field.pressSequentially("seconde ligne");
    await field.press("ControlOrMeta+Enter");
    await field.waitFor({ state: "hidden" });
    // The keyboard is back on the card the detail is about, and the ear is told it is kept.
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-id"))).toBe(placed);
    await until(
      "the detail is kept line by line",
      async () => (await elementOf("ajout-case", placed))?.detail === "Première ligne\nseconde ligne",
    );
    await until(
      "the save is said",
      async () => (await page.locator(".spoken").textContent()) === `Detail of ${placed} saved`,
    );
    await page.keyboard.press("Escape");
  });
});

describe("the chosen card, read in the right panel", () => {
  const panel = () => page.locator(".card-panel");

  test("shows the card's name, its kind and its whole detail, line by line", async () => {
    // Posted as JSON: the CLI grammar holds one command per line.
    const posted = await fetch(`${running.url}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor: "agent",
        session: SESSION,
        commands: [
          {
            kind: "annotate",
            board: "ajout-case",
            id: placed,
            detail: "Paiement par carte.\nVirement refusé.",
          },
        ],
      }),
    });
    expect(posted.ok).toBe(true);
    // A card chosen while the session is shown opens the Detail tab.
    await page.locator("#tab-session").click();
    await card(placed).click();
    await panel().waitFor({ state: "visible" });
    expect(await page.locator("#tab-detail").getAttribute("aria-selected")).toBe("true");
    expect(await panel().locator("h2").textContent()).toBe(`Card ${placed}`);
    expect(await panel().locator(".card-panel-name").textContent()).toBe(
      (await elementOf("ajout-case", placed))?.label ?? null,
    );
    // One paragraph, its two lines kept.
    expect(await panel().locator(".card-panel-detail p").count()).toBe(1);
    expect(await panel().locator(".card-panel-detail p br").count()).toBe(1);
    expect(await panel().locator(".card-panel-detail p").textContent()).toBe(
      "Paiement par carte.Virement refusé.",
    );
    await shot("55-card-panel");
  });

  test("reads the detail as simple markdown, and HTML as words", async () => {
    const detail =
      "**Règle** : voir [la doc](https://example.org/regle), `stock`.\n- payer\n- livrer\n\n<b>pas du gras</b>";
    await fetch(`${running.url}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor: "agent",
        session: SESSION,
        commands: [{ kind: "annotate", board: "ajout-case", id: placed, detail }],
      }),
    });
    const shown = panel().locator(".card-panel-detail");
    await shown.locator("strong").waitFor();
    expect(await shown.locator("strong").textContent()).toBe("Règle");
    const link = shown.locator("a");
    expect(await link.getAttribute("href")).toBe("https://example.org/regle");
    expect(await link.getAttribute("rel")).toBe("noopener noreferrer");
    // Read on the panel: the link in the accent made for words, the code in a chip that shows.
    const style = (locator: ReturnType<typeof page.locator>, property: string) =>
      locator.evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), property);
    const accentText = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--accent-text").trim(),
    );
    expect(await style(link, "color")).toBe(
      await page.evaluate((c) => {
        const probe = document.createElement("i");
        probe.style.color = c;
        document.body.append(probe);
        const rgb = getComputedStyle(probe).color;
        probe.remove();
        return rgb;
      }, accentText),
    );
    expect(await style(shown.locator("code"), "border-top-style")).toBe("solid");
    expect(await shown.locator("li").allTextContents()).toEqual(["payer", "livrer"]);
    expect(await shown.locator("b").count()).toBe(0);
    expect(await shown.locator("p").last().textContent()).toBe("<b>pas du gras</b>");
    await shot("56-card-panel-markdown");
  });

  test("writes the detail where it is read, and Esc leaves it as it was", async () => {
    const field = panel().locator("textarea.card-panel-editor");
    await panel().locator("button", { hasText: "Edit the detail" }).click();
    await field.waitFor({ state: "visible" });
    expect(await field.getAttribute("aria-label")).toBe(`Detail of ${placed}`);
    // The whole detail from its first line: the field grows with its words.
    expect(await field.evaluate((f: HTMLTextAreaElement) => f.scrollHeight <= f.clientHeight + 2)).toBe(true);
    expect(await panel().locator(".card-panel-keys").textContent()).toContain("⌘/Ctrl+Enter saves");
    await shot("58-card-panel-editing");
    const before = (await workspace()).seq;
    await field.press("End");
    await field.pressSequentially(" brouillon");
    await field.press("Escape");
    await field.waitFor({ state: "hidden" });
    // Nothing was kept, and the keyboard is back on the button it left.
    expect((await workspace()).seq).toBe(before);
    expect(await page.evaluate(() => document.activeElement?.classList.contains("edit-detail"))).toBe(true);
  });

  test("E on a card opens its detail in the panel; another card chosen meanwhile waits", async () => {
    await card(placed).focus();
    await page.keyboard.press("e");
    const field = panel().locator("textarea.card-panel-editor");
    await field.waitFor({ state: "visible" });
    expect(await page.evaluate(() => document.activeElement?.classList.contains("card-panel-editor"))).toBe(
      true,
    );
    // Choosing another card does not take the words away: the panel stays on the one being written.
    await card(reserved).click();
    expect(await panel().locator("h2").textContent()).toBe(`Card ${placed}`);
    await panel().locator("button", { hasText: "Cancel" }).click();
    await field.waitFor({ state: "hidden" });
    expect(await panel().locator("h2").textContent()).toBe(`Card ${reserved}`);
    await card(placed).click();
  });

  test("the Session tab, once chosen, stays while the board changes under it", async () => {
    await page.locator("#tab-session").click();
    await panel().waitFor({ state: "hidden" });
    await agent(`rename ${placed} "Paiement accepté"`, "ajout-case");
    await until("the board has the new name", async () =>
      ((await card(placed).textContent()) ?? "").includes("Paiement accepté"),
    );
    expect(await page.locator(".session").isVisible()).toBe(true);
    await page.locator("#tab-detail").click();
    expect(await panel().locator(".card-panel-name").textContent()).toBe("Paiement accepté");
  });

  test("with no card chosen, Detail is quiet and the arrows pass it by", async () => {
    await page.keyboard.press("Escape");
    await panel().waitFor({ state: "hidden" });
    const detail = page.locator("#tab-detail");
    expect(await detail.getAttribute("aria-disabled")).toBe("true");
    expect(await page.locator("#tab-session").getAttribute("aria-selected")).toBe("true");
    await detail.click({ force: true });
    expect(await page.locator("#tab-session").getAttribute("aria-selected")).toBe("true");
    await page.locator("#tab-session").focus();
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("tab-notes");
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("tab-history");
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("tab-notices");
    // From Notifications, past the quiet Detail, back round to Session.
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("tab-session");
    await shot("57-tabs");
  });

  const foldedRight = () => page.locator(".work").evaluate((w) => w.classList.contains("fold-right"));

  test("Detail on a card's bar opens the folded panel on its Detail tab", async () => {
    await page.locator("#tab-history").click();
    await page.keyboard.press("]");
    await until("the right panel is folded", foldedRight);
    await card(placed).click();
    await page.locator(".card-tools button", { hasText: "Detail" }).click();
    await until("the right panel is open again", async () => !(await foldedRight()));
    expect(await page.locator("#tab-detail").getAttribute("aria-selected")).toBe("true");
    await panel().waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
  });

  test("the ≡ a card wears opens its detail, the panel too when it was folded", async () => {
    await page.locator("#tab-session").click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("]");
    await until("the right panel is folded", foldedRight);
    // Heard as well as seen: the name says the card has a detail.
    expect(await card(placed).getAttribute("aria-label")).toContain(" · has a detail");
    await card(placed).locator(".card-detail").click();
    await until("the right panel is open again", async () => !(await foldedRight()));
    expect(await page.locator("#tab-detail").getAttribute("aria-selected")).toBe("true");
    expect(await panel().locator(".card-panel-name").textContent()).toBe(
      (await elementOf("ajout-case", placed))?.label ?? null,
    );
    // Read, not written: the detail is shown, no editor opened.
    expect(await page.locator(".card-panel.is-editing").count()).toBe(0);
    // Chosen already, it opens the tab again from another one.
    await page.locator("#tab-history").click();
    await card(placed).locator(".card-detail").click();
    await until(
      "back on Detail",
      async () => (await page.locator("#tab-detail").getAttribute("aria-selected")) === "true",
    );
    await page.keyboard.press("Escape");
  });

  test("the tabs keep their names where they fit, with icons drawn alike, and only icons in the rail", async () => {
    const shown = (locator: ReturnType<typeof page.locator>) =>
      locator.evaluateAll((all) => all.map((e) => e.getBoundingClientRect().width > 4));
    // The panel is 300 px: the four names fit, the icons give way first; Notifications stays a bell (T89).
    const names = page.locator(".tabs .tab:not(#tab-notices) .tab-label");
    expect(await shown(names)).toEqual([true, true, true, true]);
    expect(await shown(page.locator("#tab-notices .tab-icon"))).toEqual([true]);
    expect(await page.locator("#tab-notices").getAttribute("aria-label")).toBe("Notifications");
    expect(await page.locator(".tabs .tab-icon svg").count()).toBe(5);
    // Folded, the rail keeps the icons alone.
    await page.keyboard.press("]");
    await until("the right panel is folded", foldedRight);
    expect(await shown(page.locator(".tabs .tab-label"))).toEqual([false, false, false, false, false]);
    expect(await shown(page.locator(".tabs .tab-icon"))).toEqual([true, true, true, true, true]);
    await page.keyboard.press("]");
    await until("the right panel is open again", async () => !(await foldedRight()));
    // The names come back once the panel has its width again, measured after the unfolding.
    await until("the four names back", async () => (await shown(names)).every(Boolean));
  });

  test("in a narrow window, a card chosen unfolds its detail, and folds it back once left", async () => {
    await page.locator("#tab-session").click();
    await page.setViewportSize({ width: 1024, height: 800 });
    try {
      await until("the narrow window folds the panel", foldedRight);
      await card(placed).click();
      await until("the panel unfolds for the card", async () => !(await foldedRight()));
      expect(await page.locator("#tab-detail").getAttribute("aria-selected")).toBe("true");
      await page.keyboard.press("Escape");
      await until("folded back once the card is left", foldedRight);
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    await until("wide again, the panel is open", async () => !(await foldedRight()));
  });

  test("a card chosen from Notes or History leaves the reader there; from Session it opens Detail, then gives Session back", async () => {
    const on = async (id: string) =>
      (await page.locator(`#tab-${id}`).getAttribute("aria-selected")) === "true";
    const selected = async () => ((await card(placed).getAttribute("class")) ?? "").includes("is-selected");
    for (const reading of ["history", "notes"]) {
      await page.locator(`#tab-${reading}`).click();
      await card(placed).click();
      await until("the card is chosen", selected);
      expect(await on(reading)).toBe(true);
      await page.keyboard.press("Escape");
      await until("the card is left", async () => !(await selected()));
      expect(await on(reading)).toBe(true);
    }
    await page.locator("#tab-session").click();
    await card(placed).click();
    await until("Detail opened from Session", () => on("detail"));
    await page.keyboard.press("Escape");
    await until("Session given back", () => on("session"));
  });
});

describe("the board from the keyboard", () => {
  const focused = () => page.evaluate(() => document.activeElement?.getAttribute("data-id") ?? null);

  test("the board is one Tab stop, and the arrows go from card to card", async () => {
    // A fresh page, no card chosen yet: Tab enters at the first card read, top left.
    await page.reload();
    await page.locator("g.card").first().waitFor();
    expect(await page.locator('g.card[tabindex="0"]').count()).toBe(1);
    const first = await page.locator('g.card[tabindex="0"]').getAttribute("data-id");
    const topLeft = await page.evaluate(() => {
      const at = (g: Element) =>
        (g.getAttribute("style") ?? "").match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/);
      return (
        [...document.querySelectorAll("g.card")]
          .map((g) => ({ id: g.getAttribute("data-id"), x: Number(at(g)?.[1]), y: Number(at(g)?.[2]) }))
          .sort((a, b) => Math.round(a.x) - Math.round(b.x) || a.y - b.y)[0]?.id ?? null
      );
    });
    expect(first).toBe(topLeft);
    // The way there skips the header and the palette.
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.className)).toBe("skip");
    await page.keyboard.press("Enter");
    expect(await focused()).toBe(first);
    for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]) {
      await page.keyboard.press(key);
      if ((await focused()) !== first) break;
    }
    const now = await focused();
    expect(now).not.toBeNull();
    expect(now).not.toBe(first);
    // Tab enters the board where the keyboard left it.
    expect(await card(now ?? "").getAttribute("tabindex")).toBe("0");
    expect(await page.locator('g.card[tabindex="0"]').count()).toBe(1);
  });

  test("a card chosen by a click goes along with the arrows: one card is marked, never two", async () => {
    const first = (await page.locator("g.card").first().getAttribute("data-id")) ?? "";
    await card(first).click();
    await until(
      "the card is chosen",
      async () => (await card(first).getAttribute("aria-pressed")) === "true",
    );
    for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]) {
      await page.keyboard.press(key);
      if ((await focused()) !== first) break;
    }
    const now = await focused();
    expect(now).not.toBe(first);
    await until(
      "the choice follows the keyboard",
      async () =>
        (await page.locator('g.card[aria-pressed="true"]').count()) === 1 &&
        (await card(now ?? "").getAttribute("aria-pressed")) === "true",
    );
    expect(await page.locator("g.card.is-selected").count()).toBe(1);
    // The panel reads the card the keyboard is on.
    expect(await page.locator(".card-panel h2").textContent()).toContain(now ?? "");
    await page.keyboard.press("Escape");
  });

  test("`/` finds a card by its id, and Esc leaves the keyboard on it", async () => {
    const id = (await page.locator("g.card").first().getAttribute("data-id")) ?? "";
    await page.locator(".canvas").click({ position: { x: 4, y: 4 } });
    const shut = await page.locator(".canvas").boundingBox();
    await page.keyboard.press("/");
    const field = page.locator(".find-bar input");
    await field.waitFor({ state: "visible" });
    // The bar lies over the board: the board keeps its place and its width (T212).
    expect(await page.locator(".canvas").boundingBox()).toEqual(shut);
    await field.fill(id.toLowerCase());
    // The count names the card found: a screen reader hears which one, not just how many.
    expect(await page.locator(".find-count").textContent()).toMatch(new RegExp(`^1 / \\d+ · ${id} \\S`));
    expect(await card(id).getAttribute("class")).toContain("is-pointed");
    await field.press("Escape");
    await page.locator(".find-bar").waitFor({ state: "hidden" });
    expect(await focused()).toBe(id);
  });

  test("`?` lists the keys of the page", async () => {
    await page.keyboard.press("?");
    const sheet = page.locator("dialog.keys");
    await sheet.waitFor({ state: "visible" });
    expect(await sheet.locator("kbd", { hasText: "Shift + ← → ↑ ↓" }).count()).toBe(1);
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "hidden" });
  });
});

describe("the board for who cannot see it", () => {
  const BOARD = "lecture";
  const FLOWING = "lecture-flow";
  const labels = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".layer-cards > g.card-group")].map((group) => ({
        label: group.getAttribute("aria-label"),
        role: group.getAttribute("role"),
        ids: [...group.querySelectorAll("g.card")].map((g) => g.getAttribute("data-id")),
      })),
    );

  let [finished, after, before] = ["", "", ""];

  test("cards are read lane by lane, each lane a named group, whatever the order they were made in", async () => {
    [finished, after, before] = await agent(
      `board new "Lecture" --format kanban --id ${BOARD}\nadd task "Fini" --lane done\nadd task "Après" --lane todo\nadd task "Avant" --lane todo`,
    );
    await page.locator(".board-picker select").selectOption(BOARD);
    await card(before).waitFor();
    // Made last, it sits at the top of To do, so it is read first.
    await agent(`move ${before} --lane todo --before ${after}`, BOARD);
    await until("Avant is read before Après", async () => (await labels())[0]?.ids?.[0] === before);
    expect(await labels()).toEqual([
      { label: "To do", role: "group", ids: [before, after] },
      { label: "Done", role: "group", ids: [finished] },
    ]);
    expect(await page.locator('g.card[tabindex="0"]').getAttribute("data-id")).toBe(before);
  });

  test("a card moved by the keyboard joins its new group, and the keyboard stays on it", async () => {
    await card(before).focus();
    await page.keyboard.press("Shift+ArrowRight");
    await until("Avant moved to Doing", async () => (await labels()).some((g) => g.label === "Doing"));
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-id"))).toBe(before);
    expect((await labels()).find((g) => g.label === "Doing")?.ids).toEqual([before]);
  });

  test("Undo is said, with what it took back", async () => {
    await page.keyboard.press("Control+z");
    await until("Avant is back in To do", async () => (await labels())[0]?.ids?.includes(before) === true);
    await page.locator(".spoken", { hasText: /^Undone: / }).waitFor({ state: "attached" });
    await page.keyboard.press("Control+Shift+z");
    await page.locator(".spoken", { hasText: "Done again" }).waitFor({ state: "attached" });
  });

  test("on a flow, a card tells where it leads and where it comes from, branches named", async () => {
    const [receive, stock, ship] = await agent(
      `board new "Lecture flow" --format flow --id ${FLOWING}\nadd step "Recevoir" --alias r\nadd decision "En stock ?" --from @r --alias d\nadd step "Expédier" --from @d --edge oui`,
    );
    await page.locator(".board-picker select").selectOption(FLOWING);
    await card(stock).waitFor();
    expect(await card(stock).getAttribute("aria-description")).toBe(
      `leads to ${ship} Expédier (oui) · comes from ${receive} Recevoir`,
    );
    // Shift and an arrow cannot move a card a flow places from its links: the page says so.
    await card(stock).focus();
    await page.keyboard.press("Shift+ArrowRight");
    await page.locator(".toast", { hasText: `${stock} is placed by its links` }).waitFor();
    await agent(`board rm ${FLOWING}\nboard rm ${BOARD}`);
    await until("the page has left the boards removed", async () => {
      const shown = await page.locator(".board-picker select").inputValue();
      return shown !== BOARD && shown !== FLOWING;
    });
  });
});

describe("undoing a gesture Claude changed since (B8)", () => {
  const BOARD = "ecrase";
  const undo = () => page.locator(".undo button").first();
  const ask = () => page.locator("dialog.undo-ask");
  const labelOf = async (id: string): Promise<string | undefined> => (await elementOf(BOARD, id))?.label;
  const offered = (): Promise<void> => until("Undo is offered", async () => !(await undo().isDisabled()));
  const renameOnPage = async (id: string, text: string): Promise<void> => {
    await card(id).dblclick();
    await typeInEditor(text);
    await until(`${id} renamed on the page`, async () => (await labelOf(id)) === text);
  };

  let [first, second] = ["", ""];

  test("the page asks first; Escape leaves everything as it was", async () => {
    [first, second] = await agent(
      `board new "Écrase" --id ${BOARD}\nadd event "Avant" --col 1\nadd event "Deux" --col 2`,
    );
    await page.locator(".board-picker select").selectOption(BOARD);
    await card(first).getByText("Avant").waitFor();
    await renameOnPage(first, "À moi");
    await agent(`rename ${first} "À Claude"`, BOARD);
    await card(first).getByText("À Claude").waitFor();
    await offered();
    await undo().click();
    await ask().waitFor({ state: "visible" });
    expect(await ask().locator("h2").textContent()).toBe("Claude changed it since. Undo anyway?");
    expect(await ask().textContent()).toContain(`Claude renames ${first} to “À Claude”`);
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Keep Claude's change");
    const before = (await workspace()).seq;
    await page.keyboard.press("Escape");
    await ask().waitFor({ state: "hidden" });
    expect((await workspace()).seq).toBe(before);
    expect(await undo().isDisabled()).toBe(false);
  });

  test("Undo anyway brings the old label back over Claude's", async () => {
    await undo().click();
    await ask().getByRole("button", { name: "Undo anyway" }).click();
    await until("the old label is back", async () => (await labelOf(first)) === "Avant");
    await ask().waitFor({ state: "hidden" });
  });

  test("keeping Claude's change takes the gesture off the Undo list, with no error shown", async () => {
    await renameOnPage(second, "Moi");
    await agent(`rename ${second} "Le sien"`, BOARD);
    await card(second).getByText("Le sien").waitFor();
    await undo().click();
    await ask().getByRole("button", { name: "Keep Claude's change" }).click();
    await ask().waitFor({ state: "hidden" });
    // The rename of the first card was already taken back: with the second's gone too, nothing is left to undo.
    await until("the gesture left the Undo list", async () => await undo().isDisabled());
    expect(await labelOf(second)).toBe("Le sien");
    expect(await page.locator(".toast", { hasText: "refused" }).count()).toBe(0);
  });

  test("a card Claude removed since offers only to keep its change", async () => {
    const [third] = await agent('add event "Trois" --col 3', BOARD);
    await card(third).waitFor();
    await renameOnPage(third, "Mien");
    await agent(`rm ${third}`, BOARD);
    await card(third).waitFor({ state: "detached" });
    await offered();
    await undo().click();
    await ask().waitFor({ state: "visible" });
    expect(await ask().getByRole("button", { name: "Undo anyway" }).count()).toBe(0);
    await ask().getByRole("button", { name: "Keep Claude's change" }).click();
    await ask().waitFor({ state: "hidden" });
    await agent(`board rm ${BOARD}`);
  });
});

describe("adding from the keyboard", () => {
  const BOARD = "ajout-clavier";
  const active = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      return {
        id: el?.getAttribute("data-id") ?? null,
        tag: el?.tagName ?? null,
        cls: el?.className ?? null,
      };
    });
  let [first, above] = ["", ""];

  test("on an empty board, « Skip to the board » leads to the cards one can add", async () => {
    await agent(`board new "Ajout clavier" --format kanban --id ${BOARD}`);
    await page.locator(".board-picker select").selectOption(BOARD);
    await until("the board is shown, empty", async () => (await page.locator("g.card").count()) === 0);
    await page.locator(".skip").focus();
    await page.keyboard.press("Enter");
    expect(await active()).toMatchObject({ tag: "BUTTON", cls: "type" });
  });

  test("the card just added has the keyboard, not the page", async () => {
    first = mint(await workspace(), "T");
    await page.keyboard.press("Enter");
    await typeInEditor("Premier");
    await card(first).waitFor();
    await until("the keyboard is on the card", async () => (await active()).id === first);
    expect(await page.locator('g.card[tabindex="0"]').getAttribute("data-id")).toBe(first);
  });

  const lanes = () =>
    page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll(".layer-cards > g.card-group")].map((group) => [
          group.getAttribute("aria-label"),
          [...group.querySelectorAll("g.card")].map((g) => g.getAttribute("data-id")),
        ]),
      ),
    );

  test("Alt and an arrow add a card of its kind beside the focused one, and give it the keyboard", async () => {
    const right = mint(await workspace(), "T");
    await card(first).focus();
    await page.keyboard.press("Alt+ArrowRight");
    await typeInEditor("À droite");
    await card(right).waitFor();
    await until("the keyboard is on the card added", async () => (await active()).id === right);
    expect(await lanes()).toEqual({ "To do": [first], Doing: [right] });

    above = mint(await workspace(), "T");
    await card(first).focus();
    await page.keyboard.press("Alt+ArrowUp");
    await typeInEditor("Au-dessus");
    await card(above).waitFor();
    expect((await lanes())["To do"]).toEqual([above, first]);
  });

  test("one Undo takes the card added beside back", async () => {
    await page.keyboard.press("Control+z");
    await card(above).waitFor({ state: "detached" });
    expect((await lanes())["To do"]).toEqual([first]);
    await agent(`board rm ${BOARD}`);
    await until("the page has left the board removed", async () => {
      return (await page.locator(".board-picker select").inputValue()) !== BOARD;
    });
  });
});

describe("Claude waits for the human", () => {
  const BOARD = "attente";
  const pill = () => page.locator(`.top .waits button[data-board="${BOARD}"]`);

  test("a pill in the header says so, from another board too, and leads to the board", async () => {
    const elsewhere = await page.locator(".board-picker select").inputValue();
    expect(elsewhere).not.toBe(BOARD);
    const [sent] = await agent(
      `board new "Attente" --id ${BOARD}\nadd event "Devis envoyé" --col 1\npass "Ton avis sur le devis ?"`,
    );
    await page.locator(".board-picker select").selectOption(elsewhere);
    await pill().waitFor();
    // Other boards of this run may wait too: they are counted after the name.
    expect(await pill().textContent()).toStartWith("Claude waits · Attente");
    expect(await pill().getAttribute("title")).toBe("Ton avis sur le devis ?");
    // The tab says it too, for who looks at another one.
    expect(await page.title()).toStartWith("● Claude waits for you · ");
    // In the middle of the header, beside what Claude is doing.
    expect(await pill().evaluate((button) => button.closest(".top-claude") !== null)).toBe(true);
    await shot("22-claude-waits");

    await pill().click();
    await card(sent).getByText("Devis envoyé").waitFor();
    expect(await pill().textContent()).toStartWith("Claude waits for you");
    // Pressed, the pill says why: Claude's words, on the board they are about.
    await until("the words are said", async () =>
      ((await page.locator(".toast").textContent()) ?? "").includes("Your turn: Ton avis sur le devis ?"),
    );
  });

  test("with Claude listening for the answer, the pill and the tab say it is blocked", async () => {
    // Nothing is left to tell: the wait that follows is a real one.
    await fetch(`${running.url}/api/changes?session=${SESSION}&ack=1`);
    const listening = fetch(`${running.url}/api/wait?session=${SESSION}&timeout=20000`).then((response) =>
      response.json(),
    );
    await page.locator(".top .waits button.is-blocked").waitFor();
    expect(await pill().textContent()).toStartWith("Claude is blocked on you");
    expect(await page.title()).toBe("● Claude is blocked on you · Attente · Sideco");
    await shot("24-claude-blocked");
    await page.locator(".turn button", { hasText: "Send to Claude" }).click();
    await listening;
    await pill().waitFor({ state: "detached" });
    expect(await page.title()).toBe("Attente · Sideco");
  });

  test("handing the turn back ends the wait", async () => {
    await agent('pass "Encore une question"', BOARD);
    await pill().waitFor();
    await page.locator(".turn button", { hasText: "Send to Claude" }).click();
    await pill().waitFor({ state: "detached" });
  });
});

describe("an editor kept while the board changes under it", () => {
  const BOARD = "garde";
  const editor = () => page.locator(".card-editor");
  const labelOf = async (id: string): Promise<string | undefined> => (await elementOf(BOARD, id))?.label;

  let [first, second, third] = ["", "", ""];

  test("Claude adds a card and renames another while a label is typed: the words stay, and are saved", async () => {
    [first, second] = await agent(
      `board new "Garde" --id ${BOARD}\nadd event "Première" --col 1\nadd event "Seconde" --col 2`,
    );
    await page.locator(".board-picker select").selectOption(BOARD);
    await card(first).getByText("Première").waitFor();
    await card(first).dblclick();
    await editor().fill("En cours de frappe");
    [third] = await agent(
      `add event "Arrivée entre-temps" --col 3\nrename ${second} "Renommée par Claude"`,
      BOARD,
    );
    await card(third).waitFor();
    await card(second).getByText("Renommée par Claude").waitFor();
    expect(await editor().isVisible()).toBe(true);
    expect(await editor().inputValue()).toBe("En cours de frappe");
    expect(await editor().evaluate((field) => field === document.activeElement)).toBe(true);
    await editor().press("Enter");
    await until("the label typed is saved", async () => (await labelOf(first)) === "En cours de frappe");
  });

  test("Claude renames the very card being edited: what the human types is kept, and wins", async () => {
    await card(second).dblclick();
    await editor().fill("Mon libellé");
    await agent(`rename ${second} "Celui de Claude"`, BOARD);
    await until(
      "Claude's name reached the journal",
      async () => (await labelOf(second)) === "Celui de Claude",
    );
    expect(await editor().inputValue()).toBe("Mon libellé");
    await editor().press("Enter");
    await until("the human's label is saved", async () => (await labelOf(second)) === "Mon libellé");
  });

  test("Claude removes the card being edited: the words are not lost without a word", async () => {
    await card(third).dblclick();
    await editor().fill("Trop tard");
    await agent(`rm ${third}`, BOARD);
    await card(third).waitFor({ state: "detached" });
    await editor().waitFor({ state: "hidden" });
    await page.locator(".toast", { hasText: "Trop tard" }).waitFor();
  });
});

describe("a save the companion does not answer", () => {
  const BOARD = "envoi";
  const editor = () => page.locator(".card-editor");

  test("the page says it is saving, and a failed save gives the words back to the editor", async () => {
    const [before] = await agent(`board new "Envoi" --id ${BOARD}\nadd event "Avant" --col 1`);
    await page.locator(".board-picker select").selectOption(BOARD);
    await card(before).getByText("Avant").waitFor();
    const held: import("playwright-core").Route[] = [];
    await page.route("**/api/commands", (route) => void held.push(route));
    await card(before).dblclick();
    await editor().fill("Après");
    await editor().press("Enter");
    // Held: the words stay on screen, not editable, and the page says it is saving.
    await status().filter({ hasText: "Saving…" }).waitFor();
    expect(await editor().isVisible()).toBe(true);
    expect(await editor().getAttribute("aria-busy")).toBe("true");
    expect(await editor().inputValue()).toBe("Après");
    await until("the post left", async () => held.length === 1);
    await held[0]?.abort("connectionrefused");
    // Failed: the words come back to the editor, editable, and the page says why, until a save goes through (T89).
    await page.locator(".error-bar", { hasText: "nothing was saved" }).waitFor();
    // The browser logs the refusal this test staged; that one line is not a fault of the page.
    const staged = problems.indexOf("console: Failed to load resource: net::ERR_CONNECTION_REFUSED");
    if (staged >= 0) problems.splice(staged, 1);
    expect(await editor().getAttribute("aria-busy")).toBeNull();
    expect(await editor().inputValue()).toBe("Après");
    expect(await editor().evaluate((field) => field === document.activeElement)).toBe(true);
    await status().filter({ hasNotText: "Saving…" }).waitFor();
    await page.unroute("**/api/commands");
    await editor().press("Enter");
    await until(
      "the label is saved once the companion answers",
      async () => (await elementOf(BOARD, before))?.label === "Après",
    );
    await editor().waitFor({ state: "hidden" });
    await page.locator(".error-bar").waitFor({ state: "hidden" });
    await agent(`board rm ${BOARD}`);
  });
});

describe("a reply handed over in one chord (T208)", () => {
  test("⌘↵ in a note's reply sends the reply, then hands the turn to Claude", async () => {
    const [, who] = await agent(
      `board new "Accord" --id accord\nadd event "Livré" --col 1 --alias l\nnote "Qui livre ?" --on @l`,
    );
    await page.locator(".board-picker select").selectOption("accord");
    await page.locator("#tab-notes").click();
    const reply = page.locator(`.notes .thread[data-thread="${who}"] .thread-reply [name^=reply-]`);
    await reply.fill("Le transporteur");
    await reply.press("ControlOrMeta+Enter");
    await until("the reply and the hand-over are both recorded", async () => {
      const board = (await workspace()).boards.find((b) => b.id === "accord");
      const replied = board?.notes.some((n) => n.text === "Le transporteur") ?? false;
      return replied && board?.turn?.to === "agent";
    });
    expect(await reply.inputValue()).toBe("");
    await agent("board rm accord");
  });
});

describe("every board at a glance (T90)", () => {
  const tile = (title: string) =>
    page.locator(".home .board-tile").filter({ has: page.getByText(title, { exact: true }) });

  test("the home page shows each board with its workshop, its cards and its open notes, and opens one", async () => {
    await agent(
      `board new "Sprint du jeudi" --format kanban --id jeudi\nadd task "Livrer" --lane todo\nadd task "Tester" --lane todo`,
    );
    await agent(
      `board new "Parcours client" --format flow --id parcours\nadd step "Commander" --alias c\nnote "Et le retour ?" --on @c`,
    );
    await page.locator(".brand").click();
    await page.locator(".home .board-tile").first().waitFor();
    expect(new URL(page.url()).hash).toBe("#/boards");
    expect(await page.locator(".board-picker select").inputValue()).toBe("");
    expect(await tile("Sprint du jeudi").locator(".board-format").textContent()).toBe("Kanban");
    expect(await tile("Sprint du jeudi").locator(".board-counts").textContent()).toBe("2 cards");
    expect(await tile("Parcours client").locator(".board-counts").textContent()).toBe("1 card · 1 open note");
    expect(await page.locator(".home .formats .format").count()).toBeGreaterThan(0);

    // Claude creating a board while the reader looks at them all does not take them away.
    await agent(`board new "Rétro" --format retro --id retro-home`);
    await tile("Rétro").waitFor();
    expect(new URL(page.url()).hash).toBe("#/boards");

    await tile("Sprint du jeudi").click();
    await page.locator("g.card", { hasText: "Livrer" }).waitFor();
    expect(new URL(page.url()).hash).toBe("#/b/jeudi");
    expect(await page.locator(".board-picker select").inputValue()).toBe("jeudi");
    await page.locator(".board-picker select").selectOption("");
    await tile("Parcours client").waitFor();
    await agent("board rm jeudi\nboard rm parcours\nboard rm retro-home");
  });
});

describe("what the page said, kept in its tab (T89)", () => {
  const BOARD = "avis";
  const tab = () => page.locator("#tab-notices");
  const items = () => page.locator(".notices-list li");

  let [one, two] = ["", ""];

  test("a notice said over an offer leaves the offer in the Notifications tab, still pressable", async () => {
    [one, two] = await agent(
      `board new "Avis" --id ${BOARD}\nadd event "Un" --col 1\nadd event "Deux" --col 2`,
    );
    await page.locator(".board-picker select").selectOption(BOARD);
    // What earlier tests had said, seen: from here the tab counts afresh.
    await tab().click();
    await page.locator("#tab-session").click();
    await card(one).focus();
    await page.keyboard.press("Delete");
    await page.locator(".toast", { hasText: `${one} removed.` }).waitFor();
    // Claude speaks over it: the toast says Claude's words, the tab keeps both.
    await agent(`board new "Ailleurs" --id ailleurs`);
    await page.locator(".toast", { hasText: "Claude created the board" }).waitFor();
    await tab().locator(".tab-count", { hasText: "2" }).waitFor();
    await tab().click();
    expect(await items().nth(0).textContent()).toContain("Claude created the board “Ailleurs”");
    expect(await items().nth(1).textContent()).toContain(`${one} removed.`);
    await shot("62-notices-tab");
    // Seen: the count leaves the tab.
    await tab().locator(".tab-count").waitFor({ state: "hidden" });
    await items().nth(1).getByRole("button", { name: "Undo" }).click();
    await until("the card is back", async () => (await elementOf(BOARD, one)) !== undefined);
    // Taken, the offer leaves the list: the line stays, its button goes.
    await items().nth(1).getByRole("button").waitFor({ state: "detached" });
    await agent("board rm ailleurs");
    // Said once it lands: waited for here, so it does not speak over the next test's toast.
    await page.locator(".toast", { hasText: "Claude removed the board “Ailleurs”" }).waitFor();
  });

  test("an offer holds until the reader's next gesture, in the toast as in the tab", async () => {
    await card(two).focus();
    await page.keyboard.press("Delete");
    await page.locator(".toast button", { hasText: "Undo" }).waitFor();
    // Another gesture: Undo would now take that one back, so the offer leaves everywhere.
    await card(one).dblclick();
    await page.locator(".card-editor").fill("Un bis");
    await page.locator(".card-editor").press("Enter");
    await until("the rename is saved", async () => (await elementOf(BOARD, one))?.label === "Un bis");
    await page.locator(".toast button").waitFor({ state: "detached" });
    await tab().click();
    expect(
      await items()
        .filter({ hasText: `${two} removed.` })
        .getByRole("button")
        .count(),
    ).toBe(0);
    await agent(`board rm ${BOARD}`);
  });

  test("an error stays until dismissed, and the tab keeps it once", async () => {
    const [before] = await agent(`board new "Panne" --id panne\nadd event "Avant" --col 1`);
    await page.locator(".board-picker select").selectOption("panne");
    await card(before).getByText("Avant").waitFor();
    const errors = page.locator(".notices-list li.is-error");
    const already = await errors.count();
    await page.route("**/api/commands", (route) => void route.abort("connectionrefused"));
    await card(before).dblclick();
    await page.locator(".card-editor").fill("Après");
    await page.locator(".card-editor").press("Enter");
    const bar = page.locator(".error-bar", { hasText: "nothing was saved" });
    await bar.waitFor();
    const staged = problems.indexOf("console: Failed to load resource: net::ERR_CONNECTION_REFUSED");
    if (staged >= 0) problems.splice(staged, 1);
    await page.unroute("**/api/commands");
    await page.locator(".card-editor").press("Escape");
    // Claude's change repaints the page: the error is neither gone nor said again.
    const [during] = await agent(`add event "Pendant" --col 2`, "panne");
    await card(during).waitFor();
    expect(await bar.isVisible()).toBe(true);
    await tab().click();
    expect(await errors.count()).toBe(already + 1);
    await shot("63-error-bar");
    await bar.getByRole("button", { name: "Dismiss" }).click();
    await bar.waitFor({ state: "hidden" });
    await agent("board rm panne");
  });
});

describe("many tabs open on the companion", () => {
  const BOARD = "onglets";

  // A browser keeps six connections per host. With one event stream per tab,
  // the sixth tab's writes queued behind the streams and never left.
  test("the seventh tab still writes at once, and every tab hears it", async () => {
    const [open] = await agent(`board new "Onglets" --id ${BOARD}\nadd event "Ouverte partout" --col 1`);
    const context = await browser.newContext();
    const tabs: Page[] = [];
    for (let i = 0; i < 7; i++) {
      const tab = await context.newPage();
      tab.setDefaultTimeout(4000);
      await tab.goto(`${running.url}/#/b/${BOARD}`);
      await tab.locator(`g.card[data-id="${open}"]`).waitFor();
      tabs.push(tab);
    }
    const last = tabs.at(-1) as Page;
    const answered = await last.evaluate(async (id) => {
      const started = performance.now();
      const response = await fetch("/api/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actor: "human",
          commands: [{ kind: "rename", board: "", id, label: "" }],
        }),
        signal: AbortSignal.timeout(3000),
      }).catch(() => null);
      return { status: response?.status ?? "stalled", ms: performance.now() - started };
    }, open);
    // Refused for its empty label, but answered: the request reached the companion.
    expect(answered.status).toBe(400);
    expect(answered.ms).toBeLessThan(1000);
    const [seen] = await agent('add event "Vue partout" --col 2', BOARD);
    for (const tab of tabs) await tab.locator(`g.card[data-id="${seen}"]`).waitFor();
    await agent(`board rm ${BOARD}`);
    await context.close();
  });
});

describe("a kanban's own lanes, from the page", () => {
  const BOARD = "colonnes";
  const lanes = async (): Promise<string[]> =>
    ((await workspace()).boards.find((b) => b.id === BOARD)?.laneOrder as string[] | undefined) ?? [
      "todo",
      "doing",
      "done",
    ];
  /** Where a heading is once it stays put: a lane restored, a panel folding or a scroll can still be moving it. */
  const heading = async (name: string) => {
    const label = page.locator(".layer-heads .lane-label", { hasText: new RegExp(`^${name}$`) });
    let box = await label.boundingBox();
    for (let attempt = 0; attempt < 40; attempt++) {
      await Bun.sleep(60);
      const next = await label.boundingBox();
      if (box && next && next.x === box.x && next.y === box.y) return next;
      box = next;
    }
    throw new Error(`no steady heading ${name}`);
  };

  let there = "";

  test("the edge between two headings offers a lane; named, it is added there", async () => {
    [there] = await agent(`board new "Colonnes" --format kanban --id ${BOARD}\nadd task "Là" --lane doing`);
    await page.locator(".board-picker select").selectOption(BOARD);
    await card(there).waitFor();
    const doing = await heading("Doing");
    // The label sits 14 px into its lane; the edge is the gap just left of the lane.
    await page.mouse.move(doing.x - 14 - 8, doing.y + doing.height / 2);
    const plus = page.locator('.sideco-board .add-here[data-type="lane"]');
    await plus.waitFor();
    expect(await plus.getAttribute("aria-label")).toBe("Add a lane here");
    expect(await plus.getAttribute("data-before")).toBe("doing");
    await Bun.sleep(200);
    await shot("40-add-lane");
    await plus.click();
    await typeInEditor("Prêt");
    await until(
      "the lane is added before Doing",
      async () => (await lanes()).join() === "todo,lane-1,doing,done",
    );
    await page.locator(".layer-heads .lane-label", { hasText: /^Prêt$/ }).waitFor();
  });

  test("`?` on a kanban says what D does there, and what the mouse does to lanes", async () => {
    await card(there).focus();
    await page.keyboard.press("?");
    const sheet = page.locator("dialog.keys");
    await sheet.waitFor({ state: "visible" });
    expect(await sheet.locator("dd", { hasText: "Move the card to the last lane" }).count()).toBe(1);
    expect(await sheet.locator("dd", { hasText: "← → a lane, ↑ ↓ its place in its lane" }).count()).toBe(1);
    expect(await sheet.locator("h3", { hasText: "With the mouse" }).count()).toBe(1);
    expect(await sheet.locator("dt", { hasText: "+ between two lane headings" }).count()).toBe(1);
    // What the marks of a card mean, each drawn as the card draws it.
    expect(await sheet.locator("h3", { hasText: "On a card" }).count()).toBe(1);
    const marks = sheet.locator(".mark-list");
    expect(await marks.locator("dt svg").count()).toBe(7);
    expect(await marks.locator("dd", { hasText: "Has a detail" }).count()).toBe(1);
    expect(await marks.locator("dd", { hasText: "Changed by Claude since your last visit" }).count()).toBe(1);
    await shot("44-keys-kanban");
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "hidden" });
    expect(await page.locator(".palette .keys-open").textContent()).toBe("Keys and gestures (?)");
  });

  test("an empty lane offers to remove it; Undo in the notice puts it back", async () => {
    const ready = await heading("Prêt");
    await page.mouse.move(ready.x + 20, ready.y + 120);
    const cross = page.locator('.sideco-board .add-here[data-type="remove-lane"]');
    await cross.waitFor();
    expect(await cross.getAttribute("aria-label")).toBe("Remove the lane Prêt");
    // A lane with cards offers no such thing.
    const doing = await heading("Doing");
    await page.mouse.move(doing.x + 20, doing.y + 160);
    await page.locator('.sideco-board .add-here[data-type="task"]').waitFor();
    expect(await cross.count()).toBe(0);
    await page.mouse.move(ready.x + 20, ready.y + 120);
    await Bun.sleep(200);
    await shot("41-remove-lane");
    await cross.click();
    await until("the lane is gone", async () => !(await lanes()).includes("lane-1"));
    await page.locator(".toast", { hasText: "Lane Prêt removed." }).getByRole("button").click();
    await until("the lane is back", async () => (await lanes()).join() === "todo,lane-1,doing,done");
  });

  test("a lane dragged by its heading lands where it is dropped, its cards with it", async () => {
    const doing = await heading("Doing");
    const todo = await heading("To do");
    await page.mouse.move(doing.x + 60, doing.y + doing.height / 2);
    await page.mouse.down();
    await page.mouse.move(todo.x - 10, doing.y + doing.height / 2, { steps: 12 });
    await page.locator(".drop-hint.is-lane-drop").waitFor();
    await shot("42-move-lane");
    await page.mouse.up();
    await until("Doing is first", async () => (await lanes()).join() === "doing,todo,lane-1,done");
    expect((await elementOf(BOARD, there))?.lane).toBe("doing");
    // A double click on the name still renames it: the drag takes the heading only once it moves.
    await page.locator(".layer-heads .lane-label", { hasText: /^Doing$/ }).dblclick();
    await typeInEditor("En cours");
    await page.locator(".layer-heads .lane-label", { hasText: /^En cours$/ }).waitFor();
  });

  test("a lane heading takes the keyboard: Shift moves it, + adds one beside it, Delete removes it", async () => {
    const label = (name: string) =>
      page.locator(".layer-heads .lane-label", { hasText: new RegExp(`^${name}$`) });
    const focused = () => page.evaluate(() => document.activeElement?.textContent ?? null);
    // Order now: En cours, To do, Prêt, Done.
    await label("To do").focus();
    expect(await label("To do").getAttribute("aria-label")).toBe("Lane To do, 0 cards");
    await page.keyboard.press("Shift+ArrowLeft");
    await until("To do is first", async () => (await lanes())[0] === "todo");
    await until("the keyboard is still on To do", async () => (await focused()) === "To do");
    await page.locator(".spoken", { hasText: "Lane To do moved: 1 of 4." }).waitFor({ state: "attached" });

    await page.keyboard.press("+");
    await typeInEditor("Revue");
    await until(
      "Revue is after To do",
      async () => (await lanes()).join() === "todo,lane-2,doing,lane-1,done",
    );
    await until("the keyboard is on Revue", async () => (await focused()) === "Revue");

    await page.keyboard.press("Delete");
    await until("Revue is gone", async () => !(await lanes()).includes("lane-2"));
    await label("En cours").focus();
    await page.keyboard.press("Delete");
    await page.locator(".toast", { hasText: "Lane En cours still has cards" }).waitFor();
    await page.keyboard.press("ArrowDown");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-id"))).toBe(there);
    await agent(`board rm ${BOARD}`);
    await until("the page has left the board removed", async () => {
      return (await page.locator(".board-picker select").inputValue()) !== BOARD;
    });
  });
});

describe("a card reordered in its cell, by the mouse", () => {
  const BOARD = "pile";
  const stack = async (): Promise<string> =>
    ((await workspace()).boards.find((b) => b.id === BOARD)?.elements ?? []).map((e) => e.id).join();

  let [one, two, three] = ["", "", ""];

  test("dropped on the upper half of a card, it lands before it; on its own place, nothing is sent", async () => {
    [one, two, three] = await agent(
      `board new "Pile" --id ${BOARD}\nadd event "Un" --col 1\nadd event "Deux" --col 1\nadd event "Trois" --col 1`,
    );
    await page.locator(".board-picker select").selectOption(BOARD);
    await card(three).waitFor();
    const seq = (await workspace()).seq;
    const at = await centre(three);
    await dragTo(three, at.x, at.y + 3);
    await Bun.sleep(300);
    expect((await workspace()).seq).toBe(seq);
    const first = await settled(one);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(first.x + first.width / 2, first.y + 4, { steps: 12 });
    await page.locator(".drop-line").waitFor();
    await shot("43-reorder-in-cell");
    await page.mouse.up();
    await until("Trois is first in its cell", async () => (await stack()) === [three, one, two].join());
    expect((await elementOf(BOARD, three))?.col).toBe(1);
    // The ear hears where it now sits: its step, its row, its rank in the cell.
    await until("Trois is heard first in its cell", async () =>
      ((await card(three).getAttribute("aria-label")) ?? "").includes("step 1, row Event, 1 of 3"),
    );
  });

  test("a step dragged by its number takes the number of the step it is dropped on, its cards with it", async () => {
    await agent("insert-col 1", BOARD);
    // The page has the empty step too: three numbers, the spare one included.
    await page.locator(".band-step-label", { hasText: /^3$/ }).waitFor();
    const second = await page.locator(".band-step-label", { hasText: /^2$/ }).boundingBox();
    const first = await page.locator(".band-step-label", { hasText: /^1$/ }).boundingBox();
    if (!first || !second) throw new Error("no step numbers");
    await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2, { steps: 12 });
    await page.locator(".drop-hint.is-lane-drop").waitFor();
    await shot("46-move-step");
    await page.mouse.up();
    await until("the cards are in step 1", async () => (await elementOf(BOARD, one))?.col === 1);
    expect((await elementOf(BOARD, two))?.col).toBe(1);
    await agent(`board rm ${BOARD}`);
    await until("the page has left the board removed", async () => {
      return (await page.locator(".board-picker select").inputValue()) !== BOARD;
    });
  });
});

describe("a story map's step taken by its heading", () => {
  test('anywhere along the heading but its edges, with no "+" in the way', async () => {
    const [, pay, story] = await agent(
      'board new "Poignée" --format story-map --id poignee\nadd activity "Chercher" --col 1\nadd activity "Payer" --col 2\nadd story "Par titre" --col 1',
    );
    await page.locator(".board-picker select").selectOption("poignee");
    await card(story).waitFor();
    const two = await page.locator(".band-step-label", { hasText: /^2$/ }).boundingBox();
    const one = await page.locator(".band-step-label", { hasText: /^1$/ }).boundingBox();
    if (!one || !two) throw new Error("no step numbers");
    // Hovered in its middle, a heading offers nothing to add: it is a handle.
    await page.mouse.move(two.x + two.width / 2, two.y + two.height / 2);
    await page.mouse.move(two.x + two.width / 2 + 2, two.y + two.height / 2);
    expect(await page.locator(".add-here").count()).toBe(0);
    // Taken off its number, 30 of its 176 units from its left edge, where an insertion used to be offered, it still moves.
    const column = two.x - one.x;
    await page.mouse.move(two.x + two.width / 2 - (column * 58) / 176, two.y + two.height / 2);
    expect(await page.locator(".add-here").count()).toBe(0);
    await page.mouse.down();
    await page.mouse.move(one.x + one.width / 2, one.y + one.height / 2, { steps: 12 });
    await page.locator(".drop-hint.is-lane-drop").waitFor();
    expect(await page.locator("svg.sideco-board").getAttribute("class")).toContain("is-grabbing");
    await page.mouse.up();
    await until("Payer is in step 1", async () => (await elementOf("poignee", pay))?.col === 1);
    await agent("board rm poignee");
    await until("the page has left the board removed", async () => {
      return (await page.locator(".board-picker select").inputValue()) !== "poignee";
    });
  });
});

describe("a story map scrolled down", () => {
  test("keeps each step's activity and task in sight under its number", async () => {
    const stories = Array.from({ length: 14 }, (_, i) => `add story "Story ${i + 1}" --col 1`).join("\n");
    await agent(
      `board new "Carte" --format story-map --id carte-longue\nadd activity "Trouver un livre" --col 1\nadd task "Chercher par titre" --col 1\n${stories}`,
    );
    await page.locator(".board-picker select").selectOption("carte-longue");
    await page.locator("g.card", { hasText: "Story 14" }).waitFor();
    // The activity runs on into the spare step: the caption of step 1 is the first.
    const caption = page.locator(".heads-steps .step-caption", { hasText: "Trouver un livre" }).first();
    // At rest the activity is on the board itself: the caption would only say it twice.
    expect(await caption.isVisible()).toBe(false);
    await page.locator(".canvas-scroll").evaluate((el) => {
      el.scrollTop = 600;
    });
    await caption.waitFor({ state: "visible" });
    await page.locator(".heads-steps .step-caption", { hasText: "Chercher par titre" }).waitFor();
    await shot("49-story-map-backbone");
    await agent("board rm carte-longue");
    await until("the page has left the board removed", async () => {
      return (await page.locator(".board-picker select").inputValue()) !== "carte-longue";
    });
  });
});

describe("a story map cut into slices", () => {
  test("draws each slice as a line under the stories, its name in the frozen margin", async () => {
    const [, , search] = await agent(
      `board new "Lots" --format story-map --id lots\nadd activity "Acheter" --col 1\nadd task "Chercher" --col 1\nadd story "Recherche simple" --col 1\nslice add "Lot 1"\nslice add "Plus tard"`,
    );
    await page.locator(".board-picker select").selectOption("lots");
    await card(search).waitFor();
    const name = page.locator(".heads-rows .slice-label", { hasText: "Lot 1" });
    await name.waitFor();
    await page.locator(".heads-rows .slice-label", { hasText: "Plus tard" }).waitFor();
    const story = await card(search).boundingBox();
    const line = await name.boundingBox();
    if (!story || !line) throw new Error("no story or no slice name");
    expect(line.y).toBeGreaterThan(story.y + story.height);
    await shot("50-story-map-slices");
    await agent("board rm lots");
    await until("the page has left the board removed", async () => {
      return (await page.locator(".board-picker select").inputValue()) !== "lots";
    });
  });
});

describe("a flow's branches named from the page", () => {
  const conn = (src: string, dst: string) => page.locator(`g.conn[data-src="${src}"][data-dst="${dst}"]`);
  const named = (src: string, dst: string) => conn(src, dst).locator("text.conn-label");

  test("a link takes a name from its toolbar or a double click, and an empty name comes off", async () => {
    const [stock, ship, order] = await agent(
      'board new "Branches" --format flow --id branches\nadd decision "En stock ?" --alias d\nadd step "Expédier" --from @d --edge oui\nadd step "Commander" --from @d',
    );
    await page.locator(".board-picker select").selectOption("branches");
    await conn(stock, order).waitFor();

    // A click on the link opens its toolbar; Name opens the editor on its name.
    await named(stock, ship).click();
    await page.locator(".card-tools button", { hasText: "Name" }).click();
    expect(await page.locator("textarea.card-editor").inputValue()).toBe("oui");
    await typeInEditor("en stock");
    await until("the branch is renamed", async () => (await named(stock, ship).textContent()) === "en stock");

    // A double click on a link without a name names it.
    const middle = await conn(stock, order)
      .locator("path")
      .first()
      .evaluate((path: SVGPathElement) => {
        const at = path.getPointAtLength(path.getTotalLength() - 12);
        const point = new DOMPoint(at.x, at.y).matrixTransform(path.getScreenCTM() ?? undefined);
        return { x: point.x, y: point.y };
      });
    await page.mouse.dblclick(middle.x, middle.y);
    await typeInEditor("en rupture");
    await named(stock, order).waitFor();
    expect(await named(stock, order).textContent()).toBe("en rupture");
    await shot("51-flow-branches-named");

    // Emptied, the name comes off the link.
    await named(stock, ship).dblclick();
    await typeInEditor("");
    await named(stock, ship).waitFor({ state: "detached" });

    await agent("board rm branches");
    await until("the page has left the board removed", async () => {
      return (await page.locator(".board-picker select").inputValue()) !== "branches";
    });
  });
});

describe("a long flow in a wide window", () => {
  test("folds into columns side by side, and fits the window without scrolling", async () => {
    const steps = Array.from(
      { length: 14 },
      (_, i) => `add step "Étape ${i + 2}" --from @s${i + 1} --alias s${i + 2}`,
    );
    await agent(
      ['board new "Chaîne" --format flow --id chaine', 'add step "Étape 1" --alias s1', ...steps].join("\n"),
    );
    await page.locator(".board-picker select").selectOption("chaine");
    await page.locator("g.card", { hasText: "Étape 15" }).waitFor();
    const lefts = await page
      .locator("g.card")
      .evaluateAll((cards) => [...new Set(cards.map((c) => Math.round(c.getBoundingClientRect().left)))]);
    expect(lefts.length).toBeGreaterThan(1);
    const room = await page.locator(".canvas-scroll").evaluate((el) => ({
      wide: el.scrollWidth <= el.clientWidth,
      tall: el.scrollHeight <= el.clientHeight,
    }));
    expect(room).toEqual({ wide: true, tall: true });
    await shot("52-flow-folded");
    await agent("board rm chaine");
    await until("the page has left the board removed", async () => {
      return (await page.locator(".board-picker select").inputValue()) !== "chaine";
    });
  });
});

describe("a tab opened on no board in particular", () => {
  const MINE = "tenu";
  const OTHER = "autre-session";

  test("keeps the board it shows when another one is created, and Undo acts on it", async () => {
    const [here] = await agent(`board new "Tenu" --format kanban --id ${MINE}\nadd task "Ici"`);
    const context = await browser.newContext();
    const tab = await context.newPage();
    tab.setDefaultTimeout(4000);
    await tab.goto(running.url);
    // The board shown is named in the address: it is that tab's own, not whichever came last.
    await tab.waitForFunction((id) => location.hash === `#/b/${id}`, MINE);
    await tab.locator(`g.card[data-id="${here}"]`).focus();
    await tab.keyboard.press("Shift+ArrowRight");
    await until("the task moved", async () => (await elementOf(MINE, here))?.lane === "doing");
    await agent(`board new "Autre session" --format kanban --id ${OTHER}`);
    await tab.locator(".toast", { hasText: "Autre session" }).waitFor();
    expect(await tab.evaluate(() => location.hash)).toBe(`#/b/${MINE}`);
    await tab.keyboard.press("Control+z");
    await until("the task is back", async () => (await elementOf(MINE, here))?.lane === "todo");
    await agent(`board rm ${OTHER}\nboard rm ${MINE}`);
    await context.close();
  });
});

describe("tidying up", () => {
  const listed = (): Promise<string[]> =>
    page
      .locator(".board-picker option")
      // The first option is every board, the home page (T90).
      .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value).filter(Boolean));

  /** Stops the companion and starts it again on the same port, as an update of Sideco does. */
  const restart = async (locale?: Locale): Promise<void> => {
    const port = running.port;
    running.stop();
    running = await start(root, port, { locale });
  };
  /** Chrome logs the stream a restart cut; anything else it logged since `before` stays a problem. */
  const forgiveTheCut = (before: number): void => {
    const cut = /net::ERR_(INCOMPLETE_CHUNKED_ENCODING|CONNECTION_REFUSED)/;
    problems.splice(before, problems.length - before, ...problems.slice(before).filter((p) => !cut.test(p)));
  };
  /** A mark only a reload takes away: it lives on the document's `window`. */
  const mark = (): Promise<void> =>
    page.evaluate(() => {
      (window as { sameDocument?: true }).sameDocument = true;
    });
  const marked = (): Promise<boolean> =>
    page.evaluate(() => (window as { sameDocument?: true }).sameDocument === true);
  // The cards of "flux-sideco", as Claude adds them across the restarts.
  let [started, resumed, latest] = ["", "", ""];

  test("a board Claude removes leaves the picker; the page moves to one that exists and says so", async () => {
    const [discard] = await agent(
      'board new "Brouillon" --format retro --id brouillon\nadd point "À jeter" --lane keep',
    );
    await page.locator(".board-picker select").selectOption("brouillon");
    await card(discard).waitFor();

    await agent("board rm brouillon");
    await until("the removed board left the picker", async () => !(await listed()).includes("brouillon"));
    await page.locator(".toast", { hasText: "Claude removed the board “Brouillon”" }).waitFor();
    const remaining = (await workspace()).boards.map((b) => b.id);
    expect(await listed()).toEqual(remaining);
    expect(page.url()).toEndWith(`#/b/${remaining.at(-1)}`);
    expect(await page.locator(".board-picker select").inputValue()).toBe(remaining.at(-1) ?? "");
    expect(await page.locator("g.card").count()).toBeGreaterThan(0);
  });

  test("the human removes a board from the page, after being asked once", async () => {
    const [nothing] = await agent(
      'board new "À jeter" --format kanban --id a-jeter\nadd task "Rien" --lane todo',
    );
    await page.locator(".board-picker select").selectOption("a-jeter");
    await card(nothing).waitFor();

    const remove = page.locator(".board-menu button.remove-board");
    const sheet = page.locator("dialog.remove-board");
    expect(await remove.getAttribute("title")).toBe("Remove the board “À jeter”");
    // Out of the way, one click off: the board menu, beside the board's name.
    await page.locator(".board-menu summary").click();
    expect(await page.locator(".board-menu summary").getAttribute("aria-label")).toBe(
      "Board: new, export, remove",
    );
    await remove.click();
    expect(await sheet.locator("h2").textContent()).toBe("Remove the board “À jeter”?");
    expect(await sheet.locator("p").textContent()).toStartWith("It holds 1 element. ");
    await shot("12-remove-board");
    // The safe answer has the focus: Enter keeps the board.
    await page.keyboard.press("Enter");
    await sheet.waitFor({ state: "hidden" });
    expect(await listed()).toContain("a-jeter");

    await page.locator(".board-menu summary").click();
    await remove.click();
    await sheet.locator("button.danger").click();
    await until("the removed board left the picker", async () => !(await listed()).includes("a-jeter"));
    await sheet.waitFor({ state: "hidden" });
    const remaining = (await workspace()).boards.map((b) => b.id);
    expect(remaining).not.toContain("a-jeter");
    expect(page.url()).toEndWith(`#/b/${remaining.at(-1)}`);
    // The agent is told: the removal is one of the human's changes.
    expect(await pending()).toContain("a-jeter");
  });

  test("a companion restarted on another journal: the page forgets the boards that are gone", async () => {
    expect((await listed()).length).toBeGreaterThan(1);
    const port = running.port;
    const before = problems.length;
    running.stop();
    renameSync(join(root, ".sideco", "boards.jsonl"), join(root, ".sideco", "boards.jsonl.bak"));
    running = await start(root, port);
    [started] = await agent('board new "Flux Sideco" --id flux-sideco\nadd event "Session démarrée" --col 1');

    for (let attempt = 0; attempt < 200 && (await listed()).join() !== "flux-sideco"; attempt++)
      await Bun.sleep(50);
    expect(await listed()).toEqual(["flux-sideco"]);
    await card(started).waitFor();
    expect(await page.locator("g.card").count()).toBe(1);
    expect(page.url()).toEndWith("#/b/flux-sideco");
    expect(await status().textContent()).not.toContain("disconnected");
    forgiveTheCut(before);
  });

  test("a companion restarted with the same page leaves the open tab as it is", async () => {
    const before = problems.length;
    await mark();
    await restart();
    // Once the tab follows the new run, its presence frame is sent: a card added then comes after it.
    for (let attempt = 0; attempt < 200 && running.hub.watching === 0; attempt++) await Bun.sleep(50);
    [resumed] = await agent('add event "Session reprise" --col 2', "flux-sideco");
    await card(resumed).waitFor();
    expect(await marked()).toBe(true);
    forgiveTheCut(before);
  });

  test("a companion restarted with the same page keeps the card chosen, without a reload", async () => {
    const before = problems.length;
    await card(started).click();
    const chosen = async () => ((await card(started).getAttribute("class")) ?? "").includes("is-selected");
    await until("chosen", chosen);
    await mark();
    await restart();
    for (let attempt = 0; attempt < 200 && running.hub.watching === 0; attempt++) await Bun.sleep(50);
    // The tab replays the journal again: the card comes back chosen once it is done.
    [latest] = await agent('add event "Après le redémarrage" --col 3', "flux-sideco");
    await card(latest).waitFor();
    await until("chosen again after the restart", chosen);
    expect(await marked()).toBe(true);
    await page.keyboard.press("Escape");
    await until("left", async () => !(await chosen()));
    forgiveTheCut(before);
  });

  test("a companion restarted with another page: the open tab reloads itself, once", async () => {
    const before = problems.length;
    await mark();
    const reloaded = page.waitForEvent("load", { timeout: 15_000 });
    // The language a page opens in is part of it: started in French, the companion serves another build.
    await restart("fr");
    await reloaded;
    await card(resumed).waitFor();
    expect(await marked()).toBe(false);

    // The page it got is the page served: it stays.
    await mark();
    [latest] = await agent('add event "Session rechargée" --col 3', "flux-sideco");
    await card(latest).waitFor();
    expect(await marked()).toBe(true);
    forgiveTheCut(before);
  });

  test("a reply typed and not sent keeps the tab from reloading: it offers to, and the reply stays", async () => {
    const before = problems.length;
    await agent('note "Et ensuite ?"', "flux-sideco");
    const reply = page.locator(".notes .thread-reply [name^=reply-]");
    await reply.fill("Je cherche encore");
    await mark();
    // Back to the page that opens in English: another build again.
    await restart("en");

    const toast = page.locator(".toast", { hasText: "Sideco was updated." });
    await toast.waitFor({ timeout: 15_000 });
    expect(await marked()).toBe(true);
    expect(await reply.inputValue()).toBe("Je cherche encore");

    // Reloading is theirs to choose, words included.
    const reloaded = page.waitForEvent("load");
    await toast.locator("button", { hasText: "Reload" }).click();
    await reloaded;
    await card(latest).waitFor();
    expect(await marked()).toBe(false);
    forgiveTheCut(before);
  });

  test("the reply once sent, the tab reloads without being asked: nothing is left to lose", async () => {
    const before = problems.length;
    const reply = page.locator(".notes .thread-reply [name^=reply-]");
    // Reloaded, the page opened on its first tab.
    await page.locator("#tab-notes").click();
    await reply.fill("Trouvé");
    await mark();
    await restart("fr");
    await page.locator(".toast", { hasText: "Sideco was updated." }).waitFor({ timeout: 15_000 });
    expect(await marked()).toBe(true);

    // The offer may be gone by then: the tab must not stay the old page for that.
    const reloaded = page.waitForEvent("load", { timeout: 5_000 });
    await reply.press("Enter");
    await reloaded;
    await page.locator("#tab-notes").click();
    await page.locator(".notes", { hasText: "Trouvé" }).waitFor();
    expect(await marked()).toBe(false);
    forgiveTheCut(before);
  });

  test("a reload that does not bring the page served is not tried twice: the tab offers instead", async () => {
    // A copy of another build answers in place of the companion, as a cache in the way would.
    const stale = (await (await fetch(running.url)).text()).replace(
      /(name="sideco-build" content=")[^"]+/,
      "$1stale",
    );
    const thePage = (url: URL): boolean => url.pathname === "/";
    await page.route(thePage, (route) => route.fulfill({ contentType: "text/html", body: stale }));
    let loads = 0;
    const count = (): void => void loads++;
    page.on("load", count);
    await page.reload();
    const toast = page.locator(".toast", { hasText: "Sideco was updated." });
    await toast.waitFor();
    // The reload asked for above, then the one the tab tried by itself.
    expect(loads).toBe(2);
    page.off("load", count);

    await page.unroute(thePage);
    const reloaded = page.waitForEvent("load");
    await toast.locator("button", { hasText: "Reload" }).click();
    await reloaded;
    await card(latest).waitFor();
  });

  test("the last board removed brings back the first screen", async () => {
    await agent("board rm flux-sideco");
    await page.locator(".home h1").waitFor();
    expect(await listed()).toEqual([]);
    expect(page.url()).not.toContain("#/b/");
    const [, placed] = await agent(
      'board new "Passage de commande" --id commande\nadd actor "Client" --col 1\nadd event "Commande passée" --col 1',
    );
    await card(placed).waitFor();
  });
});

describe("side panels folded away", () => {
  const width = async (selector: string): Promise<number> =>
    Math.round((await page.locator(selector).boundingBox())?.width ?? 0);
  const folded = (side: "left" | "right") =>
    page.locator(".work").evaluate((w, s) => w.classList.contains(`fold-${s}`), side);

  test("each folds into a rail, by its button or a key, and stays so after a reload", async () => {
    await page.locator(".board-picker select").selectOption("commande");
    // The board made again as the last one: its event, whatever id it was given.
    const board = (await workspace()).boards.find((b) => b.id === "commande");
    const placed = board?.elements.find((e) => e.type === "event")?.id ?? "";
    await card(placed).waitFor();
    const stage = await width(".stage");
    const left = page.locator(".left button.fold");
    expect(await left.getAttribute("aria-expanded")).toBe("true");
    await left.click();
    await until("the left panel is a rail", async () => (await width(".left")) <= 44);
    expect(await left.getAttribute("aria-expanded")).toBe("false");
    expect(await left.getAttribute("aria-label")).toBe("Show the palette");
    // Folded, the palette is still there: a kind of card is one click off.
    await paletteType("Event").click();
    await page.locator("textarea.card-editor").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.locator(".stage").click({ position: { x: 600, y: 600 } });
    await page.keyboard.press("]");
    await until("the right panel is a rail", async () => (await width(".right")) <= 44);
    expect(await width(".stage")).toBeGreaterThan(stage + 400);
    await shot("54-panels-folded");

    await page.reload();
    await card(placed).waitFor();
    expect([await folded("left"), await folded("right")]).toEqual([true, true]);
    await page.keyboard.press("[");
    await page.keyboard.press("]");
    await until(
      "both panels are open again",
      async () => !(await folded("left")) && !(await folded("right")),
    );
    await until("the left panel is whole again", async () => (await width(".left")) > 200);

    // < and > too, a key away on a French keyboard, where [ and ] are not (T201): the sign shows the side.
    expect(await left.getAttribute("title")).toBe("Fold the palette (<)");
    await card(placed).focus();
    await page.keyboard.press("<");
    await page.keyboard.press(">");
    expect([await folded("left"), await folded("right")]).toEqual([true, true]);
    expect(
      await page.evaluate(() => document.activeElement?.closest("g.card")?.getAttribute("data-id")),
    ).toBe(placed);
    await page.keyboard.press("<");
    await page.keyboard.press(">");
    expect([await folded("left"), await folded("right")]).toEqual([false, false]);
  });
});

describe("the card toolbar", () => {
  test("stands above its card, or under it when the card above would be hidden", async () => {
    const picker = page.locator(".board-picker select");
    const before = await picker.inputValue();
    const [stock, reserved] = await agent(
      'board new "Barre" --id barre\nadd aggregate "Stock" --col 1\nadd event "Stock réservé" --col 1',
    );
    await page.locator('.board-picker option[value="barre"]').waitFor({ state: "attached" });
    await picker.selectOption("barre");
    await card(reserved).waitFor();
    const tools = page.locator(".card-tools");
    const box = async (locator: ReturnType<typeof page.locator>) => {
      const b = await locator.boundingBox();
      if (!b) throw new Error("not on screen");
      return b;
    };
    // The event has the aggregate right above it: the toolbar goes under.
    await card(reserved).click();
    await tools.waitFor();
    expect((await box(tools)).y).toBeGreaterThanOrEqual(
      (await box(card(reserved))).y + (await box(card(reserved))).height,
    );
    await page.keyboard.press("Escape");
    // Nothing above the aggregate but its row's band: the toolbar stays above.
    await card(stock).click();
    await tools.waitFor();
    const over = await box(tools);
    expect(over.y + over.height).toBeLessThanOrEqual((await box(card(stock))).y);
    await page.keyboard.press("Escape");

    // A card between two others in a lane: the toolbar goes beside it, over neither.
    const [one, two, three] = await agent(
      'board new "Pile" --format kanban --id pile\nadd task "Un" --lane todo\nadd task "Deux" --lane todo\nadd task "Trois" --lane todo',
    );
    await page.locator('.board-picker option[value="pile"]').waitFor({ state: "attached" });
    await picker.selectOption("pile");
    await card(three).waitFor();
    await card(two).click();
    await tools.waitFor();
    const bar = await box(tools);
    for (const other of [one, three]) {
      const r = await box(card(other));
      const meets =
        r.x < bar.x + bar.width &&
        r.x + r.width > bar.x &&
        r.y < bar.y + bar.height &&
        r.y + r.height > bar.y;
      expect(meets).toBe(false);
    }
    await page.keyboard.press("Escape");
    await picker.selectOption(before);
  });

  test("follows its card when the keyboard sends it out of sight, and never stays behind alone", async () => {
    const picker = page.locator(".board-picker select");
    const before = await picker.inputValue();
    await page.setViewportSize({ width: 760, height: 700 });
    // Put back whatever happens: a narrow window left behind fails the tests after this one.
    try {
      const [leave] = await agent(
        'board new "Loin" --format kanban --id loin\nadd task "Partir" --lane todo\nadd task "Rester" --lane todo',
      );
      await page.locator('.board-picker option[value="loin"]').waitFor({ state: "attached" });
      await picker.selectOption("loin");
      await card(leave).waitFor();
      const tools = page.locator(".card-tools");
      const near = async () => {
        const [c, b, seen] = await Promise.all([
          card(leave).boundingBox(),
          tools.boundingBox(),
          page.locator(".canvas-scroll").boundingBox(),
        ]);
        if (!c || !b || !seen) return false;
        const inView = c.x >= seen.x - 1 && c.x + c.width <= seen.x + seen.width + 1;
        const gap = Math.max(
          b.x - (c.x + c.width),
          c.x - (b.x + b.width),
          b.y - (c.y + c.height),
          c.y - (b.y + b.height),
        );
        return inView && gap <= 12;
      };
      await card(leave).click();
      await tools.waitFor();
      // Done sends it to the last lane, out of a narrow window: it is brought into view, its toolbar with it.
      await page.keyboard.press("d");
      await until("the task in Done", async () => (await elementOf("loin", leave))?.lane === "done");
      await until("the card in view, its toolbar beside it", near);
      // The panels fold under 1100 px: until the board's width stops moving, the page may still bring
      // the card back (T154), and a scroll made before that would be undone.
      const width = () => page.locator(".canvas-scroll").evaluate((el) => el.clientWidth);
      let settled = -1;
      await until("the board's width settled", async () => {
        const last = settled;
        await Bun.sleep(400);
        settled = await width();
        return settled === last;
      });
      // Scrolled away from it by hand, the toolbar goes rather than stand alone at the edge.
      await page.locator(".canvas-scroll").evaluate((el) => el.scrollTo({ left: 0 }));
      await until("the toolbar hidden", async () => await tools.isHidden());
    } finally {
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 1440, height: 900 });
      await picker.selectOption(before);
    }
  });
});

describe("what Claude changed while the reader was away", () => {
  // A page of its own: its storage starts empty, and it has heard the whole journal.
  let shared: Page;
  beforeAll(async () => {
    shared = page;
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(4000);
    await slowDown(page);
    // In English whatever the companion's language is by now: the words are part of what is checked.
    await page.addInitScript(() => localStorage.setItem("sideco.lang", "en"));
    await page.goto(running.url);
  });
  afterAll(async () => {
    await page.close();
    page = shared;
  });
  const bar = () => page.locator(".visit-bar");
  const show = async (board: string, title: string) => {
    // The picker learns of a board Claude just made a moment later: chosen too early, it would not move.
    await page.locator(`.board-picker option[value="${board}"]`).waitFor({ state: "attached" });
    await page.locator(".board-picker select").selectOption(board);
    // Drawn, not only chosen: a card of the same id on the board before would not tell them apart.
    await page.locator(`svg[aria-label="Cards of “${title}”"]`).waitFor({ state: "attached" });
  };

  let [placed, paid] = ["", ""];

  test("back on a board, the page says what Claude changed there meanwhile, and marks it", async () => {
    [placed] = await agent(
      'board new "Visite" --id visite\nadd event "Commande passée" --col 1\nadd event "Stock réservé" --col 2',
    );
    await agent('board new "Ailleurs" --id ailleurs\nadd event "Autre chose" --col 1');
    await show("visite", "Visite");
    expect(await bar().isHidden()).toBe(true);
    await show("ailleurs", "Ailleurs");
    // While the reader looks elsewhere, Claude works on the first board.
    [paid] = await agent(
      `rename ${placed} "Commande validée"\nadd event "Paiement accepté" --col 3`,
      "visite",
    );
    // The page has heard it all: the board on screen keeps its last look at the newest event.
    const seq = (await workspace()).seq;
    await until("the page has heard Claude's changes", async () => {
      const seen = await page.evaluate(() => localStorage.getItem("sideco.seen") ?? "{}");
      return (JSON.parse(seen) as Record<string, number>).ailleurs === seq;
    });
    await show("visite", "Visite");
    await card(paid).waitFor();
    await bar().waitFor({ state: "visible" });
    expect(await bar().textContent()).toContain("Since your last visit, Claude made 2 changes here.");
    const marked = await page
      .locator("g.card.is-new")
      .evaluateAll((gs) => gs.map((g) => g.getAttribute("data-id")));
    expect(marked.sort()).toEqual([placed, paid].sort());
    expect(await card(placed).getAttribute("aria-label")).toContain(
      "Changed by Claude since your last visit",
    );
    expect(await page.locator("g.card.is-new", { has: page.locator("text") }).count()).toBe(2);
    // A sign of its own, in a corner: not the dashed ring a note or a link points with.
    const sign = card(placed).locator(".card-changed");
    expect(await sign.count()).toBe(1);
    expect(await sign.locator("title").textContent()).toBe("Changed by Claude since your last visit");
    expect(
      await card(placed)
        .locator(".card-shape")
        .evaluate((shape) => getComputedStyle(shape).strokeDasharray),
    ).toBe("none");
    // The bar goes from one changed card to the next, round to the first.
    const next = bar().getByRole("button", { name: "Next changed card (2)" });
    const focused = () => page.evaluate(() => document.activeElement?.getAttribute("data-id") ?? null);
    await next.click();
    await until("on the first changed card", async () => (await focused()) === placed);
    await next.click();
    await until("on the second", async () => (await focused()) === paid);
    await next.click();
    await until("round to the first", async () => (await focused()) === placed);
    await shot("59-since-last-visit");

    // In History, the moments missed stand out.
    await bar().getByRole("button", { name: "See them in History" }).click();
    expect(await page.locator("#tab-history").getAttribute("aria-selected")).toBe("true");
    expect(await page.locator(".moment-missed").count()).toBe(2);

    // Seen: the marks go, and a reload has nothing new to say.
    await bar().getByRole("button", { name: "Got it" }).click();
    await bar().waitFor({ state: "hidden" });
    expect(await page.locator("g.card.is-new").count()).toBe(0);
    expect(await page.locator(".moment-missed").count()).toBe(0);
    await page.reload();
    await card(paid).waitFor();
    expect(await bar().isHidden()).toBe(true);
  });

  test("what Claude does while the board is on screen is seen arriving, not reported as missed", async () => {
    const [sent] = await agent('add event "Facture envoyée" --col 4', "visite");
    await card(sent).waitFor();
    expect(await bar().isHidden()).toBe(true);
    expect(await page.locator("g.card.is-new").count()).toBe(0);
    await page.reload();
    await card(sent).waitFor();
    expect(await bar().isHidden()).toBe(true);
  });
});

describe("two sessions on one project", () => {
  const OTHER = "s2";
  const picker = () => page.locator(".session-picker select");
  const prompts = () => page.locator(".session .turns .prompt").count();

  test("one session alone needs no choosing", async () => {
    expect(await picker().count()).toBe(0);
  });

  test("a second session started and never spoken to is not offered (T195)", async () => {
    await runHook(
      { session_id: OTHER, cwd: root, hook_event_name: "SessionStart", source: "startup" },
      {},
      false,
    );
    await until("the session recorded", async () => (await workspace()).sessions.some((s) => s.id === OTHER));
    expect(await picker().count()).toBe(0);
  });

  test("a second session gives a choice, by name, and the one chosen is the one the page tells about", async () => {
    await runHook(
      { session_id: OTHER, cwd: root, hook_event_name: "UserPromptSubmit", prompt: "Une question" },
      {},
      false,
    );
    const named = await fetch(`${running.url}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor: "agent",
        session: OTHER,
        commands: [{ kind: "name-session", name: "sideco-ui" }],
      }),
    });
    expect(named.ok).toBe(true);
    await until(
      "the second session, by its name",
      async () => (await picker().locator("option").allTextContents()).join() === `${SESSION},sideco-ui`,
    );
    const before = await prompts();
    expect(before).toBeGreaterThan(0);

    await picker().selectOption({ label: "sideco-ui" });
    const asked = () => page.locator(".session .turns .prompt").allTextContents();
    await until("the chosen session's turns", async () => (await asked()).join().endsWith(" Une question"));
    // Handed over from the page, the turn goes to the session chosen, not to the board's last writer.
    expect(await page.locator(".pass button").getAttribute("title")).toContain("To the session sideco-ui");
    await page.locator(".pass textarea").fill("Pour la session choisie");
    await page.locator(".pass textarea").press("Enter");
    await until("the turn handed over", async () =>
      (await workspace()).boards.some((b) => b.turn?.message === "Pour la session choisie"),
    );
    const turn = (await workspace()).boards.find((b) => b.turn?.message === "Pour la session choisie")?.turn;
    expect(turn?.target).toBe(OTHER);
    // Chosen once, kept: a reload shows the same session.
    await page.reload();
    await picker().waitFor();
    expect(await picker().inputValue()).toBe(OTHER);
    await until("the chosen session's turns again", async () =>
      (await asked()).join().endsWith(" Une question"),
    );

    await picker().selectOption(SESSION);
    await until("the first session back", async () => (await prompts()) === before);
  });

  test("a session that ends leaves the choice when it is not the one shown", async () => {
    await runHook({ session_id: OTHER, cwd: root, hook_event_name: "SessionEnd", reason: "exit" }, {}, false);
    await until("the picker gone", async () => (await picker().count()) === 0);
  });
});

describe("a lane's subtitle and a plan's axes, rewritten by the mouse", () => {
  const boardOf = async (id: string) => (await workspace()).boards.find((b) => b.id === id);
  const editor = () => page.locator("textarea.card-editor");

  test("a lane without a subtitle offers one under the pointer; written, then emptied, it comes and goes", async () => {
    const [there] = await agent(
      'board new "Sous-titres" --format kanban --id colonnes-t118\nadd task "Là" --lane doing',
    );
    await page.locator(".board-picker select").selectOption("colonnes-t118");
    await card(there).waitFor();
    const blank = page.locator('.layer-heads .lane-hint-blank[data-lane="doing"]');
    expect(await blank.evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
    await page.locator('.layer-heads .lane-label[data-lane="doing"]').hover();
    await until(
      "the offer shows",
      async () => (await blank.evaluate((el) => getComputedStyle(el).opacity)) === "1",
    );
    expect(await blank.textContent()).toBe("Add a subtitle");
    await blank.dblclick();
    await typeInEditor("Ce qui avance");
    await until(
      "the lane has its subtitle",
      async () => (await boardOf("colonnes-t118"))?.hints?.doing === "Ce qui avance",
    );
    const hint = page.locator('.layer-heads .lane-hint[data-lane="doing"]');
    await until("the subtitle drawn", async () => (await hint.textContent()) === "Ce qui avance");

    await hint.dblclick();
    expect(await editor().inputValue()).toBe("Ce qui avance");
    await typeInEditor("");
    await until(
      "the subtitle gone",
      async () => (await boardOf("colonnes-t118"))?.hints?.doing === undefined,
    );
    await until("the offer back", async () => (await blank.count()) === 1);
  });

  test("the page keeps what only some readers see out of the others' way, and its lane headings readable", async () => {
    // A stylesheet that lost its rules once showed all of this: black headings, the skip link and the spoken lines.
    const looks = await page.evaluate(() => {
      const style = (selector: string) => {
        const el = document.querySelector(selector);
        return el ? getComputedStyle(el) : undefined;
      };
      return {
        strip: style(".layer-heads .heads-lane-strip")?.fill,
        skip: style(".skip")?.transform,
        spoken: style(".spoken")?.width,
        card: style("g.card")?.cursor,
      };
    });
    expect(looks.strip).not.toBe("rgb(0, 0, 0)");
    expect(looks.skip).not.toBe("none");
    expect(looks.spoken).toBe("1px");
    expect(looks.card).toBe("grab");
  });

  test("an axis takes a new name and new words at its ends; emptied, each gives the workshop's back", async () => {
    const [one] = await agent(
      'board new "Axes" --format impact-effort --id axes-t118\nadd item "Un" --lane quick',
    );
    await page.locator(".board-picker select").selectOption("axes-t118");
    await card(one).waitFor();
    const label = page.locator('.band-axis .axis-label[data-axis="y"]');
    await label.dblclick();
    expect(await editor().inputValue()).toBe("Impact");
    await typeInEditor("Valeur");
    await until("the axis renamed", async () => (await label.textContent()) === "Valeur →");
    expect((await boardOf("axes-t118"))?.axes?.y?.label).toBe("Valeur");
    // Renamed, the plan is called by its axes in the palette, and the keys say them.
    expect(await page.locator(".palette h2").textContent()).toBe("Valeur / Effort");
    await page.locator("body").press("?");
    await until("the keys say the axis", async () =>
      ((await page.locator("dialog.keys").textContent()) ?? "").includes("↑ ↓ valeur, ← → effort"),
    );
    await page.keyboard.press("Escape");

    // The editor opens on the word it replaces, above the axis across the bottom, clear of the footer.
    const across = page.locator('.band-axis .axis-bound[data-axis="x"][data-bound="low"]');
    await across.dblclick();
    const [word, field, footer] = await Promise.all([
      across.boundingBox(),
      editor().boundingBox(),
      page.locator(".bottom").boundingBox(),
    ]);
    if (!word || !field || !footer) throw new Error("not on screen");
    expect(Math.abs(field.x - word.x)).toBeLessThanOrEqual(12);
    expect(field.y + field.height).toBeLessThanOrEqual(word.y + 2);
    expect(field.y + field.height).toBeLessThanOrEqual(footer.y);
    await page.keyboard.press("Escape");
    const low = page.locator('.band-axis .axis-bound[data-axis="y"][data-bound="low"]');
    await low.dblclick();
    expect(await editor().inputValue()).toBe("low");
    await typeInEditor("faible");
    await until("the start renamed", async () => (await low.textContent()) === "faible");
    expect((await boardOf("axes-t118"))?.axes?.y).toEqual({ label: "Valeur", low: "faible" });

    await low.dblclick();
    await typeInEditor("");
    await until("the start given back", async () => (await low.textContent()) === "low");
    await label.dblclick();
    await typeInEditor("");
    await until("the axis given back", async () => (await label.textContent()) === "Impact →");
    expect((await boardOf("axes-t118"))?.axes?.y).toBeUndefined();
    expect(await page.locator(".palette h2").textContent()).toBe("Impact / Effort");
  });
});

describe("a plan's axes, from the keyboard", () => {
  const boardOf = async (id: string) => (await workspace()).boards.find((b) => b.id === id);
  const editor = () => page.locator("textarea.card-editor");

  test("each word of an axis is a key stop: Enter or F2 writes it on one line, and the keyboard comes back to it", async () => {
    const [one] = await agent(
      'board new "Axes clavier" --format impact-effort --id axes-t157\nadd item "Un" --lane quick\naxis y "Valeur"',
    );
    await page.locator(".board-picker select").selectOption("axes-t157");
    await card(one).waitFor();
    const label = page.locator('.band-axis .axis-label[data-axis="y"]');
    await until("the axis named by the board", async () =>
      ((await label.getAttribute("aria-label")) ?? "").includes("Valeur"),
    );
    expect(await label.getAttribute("tabindex")).toBe("0");
    // Its ends too, said by what they are.
    const low = page.locator('.band-axis .axis-bound[data-axis="y"][data-bound="low"]');
    expect(await low.getAttribute("tabindex")).toBe("0");
    expect(await low.getAttribute("aria-label")).toBe("Where the axis starts: low");

    await label.focus();
    await page.keyboard.press("Enter");
    await editor().waitFor({ state: "visible" });
    expect(await editor().inputValue()).toBe("Valeur");
    // One word, one line.
    expect((await editor().boundingBox())?.height ?? 99).toBeLessThanOrEqual(40);
    await page.keyboard.press("Escape");
    await until("the keyboard back on the axis", async () =>
      page.evaluate(() => document.activeElement?.getAttribute("data-axis") === "y"),
    );

    await low.focus();
    await page.keyboard.press("F2");
    await editor().waitFor({ state: "visible" });
    expect(await editor().inputValue()).toBe("low");
    await page.keyboard.type("faible");
    await page.keyboard.press("Enter");
    await until("the start written", async () => (await boardOf("axes-t157"))?.axes?.y?.low === "faible");
    await until("drawn as a word of the axis", async () => (await low.textContent()) === "faible");
    await until("the keyboard on it", async () =>
      page.evaluate(
        () =>
          document.activeElement?.getAttribute("data-axis") === "y" &&
          document.activeElement?.getAttribute("data-bound") === "low",
      ),
    );
  });
});

describe("labels on a card, from the page", () => {
  test("a card wears its labels as chips, says them, and the Detail tab adds and takes them off", async () => {
    const [fix, deliver] = await agent(
      [
        'board new "Étiquettes" --format kanban --id etiquettes',
        'add task "Corriger la connexion" --lane todo',
        'add task "Livrer" --lane todo',
      ].join("\n"),
    );
    await agent(`label ${fix} type:bug @bastien\nlabel ${deliver} env:prod`, "etiquettes");
    await page.locator(".board-picker select").selectOption("etiquettes");
    await card(deliver).waitFor();
    // On the card: a chip each, and its name says them.
    // The chip says the value, its colour the key; the name says the label whole.
    expect(await card(fix).locator(".card-labels text").allTextContents()).toEqual(["bug", "@bastien"]);
    expect(await card(fix).getAttribute("aria-label")).toContain("labels type:bug, @bastien");

    await card(fix).click();
    await page.getByRole("tab", { name: "Detail" }).click();
    const chips = page.locator(".card-panel-labels .label-chip");
    await until("the chips in the Detail tab", async () => (await chips.count()) === 2);
    // The project's other labels are offered as it is typed; those it wears are not.
    expect(
      await page
        .locator("#known-labels option")
        .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value)),
    ).toEqual(["env:prod"]);

    const field = page.locator(".label-field");
    await field.fill("urgent, release:2026.12");
    await field.press("Enter");
    await until(
      "two labels more",
      async () => ((await elementOf("etiquettes", fix))?.labels ?? []).length === 4,
    );
    await until("the field emptied", async () => (await field.inputValue()) === "");

    await page.getByRole("button", { name: "Remove the label @bastien" }).click();
    await until(
      "the assignee taken off",
      async () => !((await elementOf("etiquettes", fix))?.labels ?? []).includes("assignee:bastien"),
    );
    expect((await elementOf("etiquettes", fix))?.labels).toEqual(["type:bug", "urgent", "release:2026.12"]);
    await until("the page took it off too", async () => (await chips.count()) === 3);
    await shot("60-labels");
    await page.keyboard.press("Escape");
  });

  test("the keyboard stays in the labels: the field after Enter, the next × after one, and each change is said", async () => {
    const [sort] = await agent(
      ['board new "Clavier labels" --format kanban --id labels-t155', 'add task "Trier" --lane todo'].join(
        "\n",
      ),
    );
    await page.locator(".board-picker select").selectOption("labels-t155");
    await card(sort).click();
    await page.getByRole("tab", { name: "Detail" }).click();
    const field = page.locator(".label-field");
    await field.fill("alpha, beta, gamma");
    await field.press("Enter");
    await until(
      "three labels",
      async () => ((await elementOf("labels-t155", sort))?.labels ?? []).length === 3,
    );
    await until("the field emptied", async () => (await field.inputValue()) === "");
    const active = () =>
      page.evaluate(() => {
        const a = document.activeElement;
        return a?.classList.contains("label-field")
          ? "field"
          : (a?.getAttribute("aria-label") ?? a?.tagName ?? "");
      });
    await until("the field keeps the keyboard", async () => (await active()) === "field");
    await until("the labels added are said", async () =>
      ((await page.locator(".spoken").textContent()) ?? "").includes("alpha, beta, gamma"),
    );

    await page.getByRole("button", { name: "Remove the label beta" }).click();
    await until(
      "beta taken off",
      async () => !((await elementOf("labels-t155", sort))?.labels ?? []).includes("beta"),
    );
    await until("the keyboard on the next ×", async () => (await active()) === "Remove the label gamma");
    await until("the removal is said", async () =>
      ((await page.locator(".spoken").textContent()) ?? "").includes("beta"),
    );
    await page.keyboard.press("Enter");
    await until(
      "gamma taken off",
      async () => !((await elementOf("labels-t155", sort))?.labels ?? []).includes("gamma"),
    );
    // The last one gone, the keyboard goes back to the one before, then to the field.
    await until("the keyboard on the × left", async () => (await active()) === "Remove the label alpha");
    await page.keyboard.press("Enter");
    await until(
      "no label left",
      async () => ((await elementOf("labels-t155", sort))?.labels ?? []).length === 0,
    );
    await until("the keyboard back in the field", async () => (await active()) === "field");
    await page.keyboard.press("Escape");
  });
});

describe("the card chosen, through a reload", () => {
  test("a reload keeps the card chosen, and the keyboard on it", async () => {
    const [, two] = await agent(
      'board new "Rechargement" --format kanban --id recharge-t160\nadd task "Un" --lane todo\nadd task "Deux" --lane todo',
    );
    await page.locator(".board-picker select").selectOption("recharge-t160");
    await card(two).click();
    await until("chosen", async () =>
      ((await card(two).getAttribute("class")) ?? "").includes("is-selected"),
    );
    await page.reload();
    await until("chosen again after the reload", async () =>
      ((await card(two).getAttribute("class")) ?? "").includes("is-selected"),
    );
    await until("the keyboard on it", async () =>
      page.evaluate((id) => document.activeElement?.getAttribute("data-id") === id, two),
    );
    // Left, it is not chosen again at the next reload.
    await page.keyboard.press("Escape");
    await until("left", async () => !((await card(two).getAttribute("class")) ?? "").includes("is-selected"));
    await page.reload();
    await card(two).waitFor();
    await Bun.sleep(300);
    expect(await page.locator("g.card.is-selected").count()).toBe(0);
  });
});

describe("a link to a card", () => {
  test("the address says the card chosen, and a link to a card opens its board on it, centred and lit up", async () => {
    const made = await agent(
      [
        'board new "Lien direct" --format kanban --id lien-t182',
        ...Array.from({ length: 40 }, (_, k) => `add task "Carte ${k + 1}" --lane todo`),
      ].join("\n"),
    );
    await page.locator(".board-picker select").selectOption("lien-t182");
    const [first] = made;
    // Halfway down a long lane.
    const far = made[19] ?? "";
    await card(first).click();
    await until("the address names the card", async () => page.url().endsWith(`#/b/lien-t182/${first}`));
    await page.keyboard.press("Escape");
    await until("and the board alone once it is left", async () => page.url().endsWith("#/b/lien-t182"));

    // Pasted in the address bar: from another board, to a card halfway down a long lane.
    await page.locator(".board-picker select").selectOption({ index: 0 });
    await page.evaluate((id) => {
      location.hash = `#/b/lien-t182/${id}`;
    }, far);
    const chosen = async () => ((await card(far).getAttribute("class")) ?? "").includes("is-selected");
    await until("chosen", chosen);
    expect(await card(far).getAttribute("class")).toContain("is-fresh");
    await until("the keyboard on it", async () =>
      page.evaluate((id) => document.activeElement?.getAttribute("data-id") === id, far),
    );
    // Centred: its middle near the middle of the board's frame.
    const [frame, box] = [await page.locator(".canvas").boundingBox(), await card(far).boundingBox()];
    if (!frame || !box) throw new Error("drawn");
    expect(Math.abs(box.y + box.height / 2 - (frame.y + frame.height / 2))).toBeLessThan(frame.height / 4);
    await page.keyboard.press("Escape");
  });
});

describe("search across the boards, from the page", () => {
  const focused = () => page.evaluate(() => document.activeElement?.getAttribute("data-id") ?? null);

  test("Ctrl+K lists the cards found on every board as words are typed, and Enter goes to one elsewhere", async () => {
    const [read, pay] = await agent(
      [
        'board new "Recherche ici" --format kanban --id cherche-ici',
        'add task "Relire la note quetzal" --lane todo',
        'board new "Recherche ailleurs" --format kanban --id cherche-ailleurs',
        'add task "Payer la note quetzal du traiteur" --lane todo',
        'add task "Réserver la salle" --lane todo --alias salle',
        'detail @salle "Après la note quetzal."',
      ].join("\n"),
    );
    await page.locator(".board-picker select").selectOption("cherche-ici");
    await card(read).waitFor();
    await page.locator(".canvas").click({ position: { x: 4, y: 4 } });
    const boardTop = async () => (await card(read).boundingBox())?.y;
    const before = await boardTop();
    await page.keyboard.press("Control+k");
    const field = page.getByRole("combobox", { name: "Find a card" });
    await field.waitFor({ state: "visible" });
    // The bar lies over the board: the cards stay where they were.
    expect(await boardTop()).toBe(before);
    await field.fill("QUETZAL");
    const options = page.getByRole("listbox", { name: "Find a card" }).getByRole("option");
    await until("three cards, on two boards", async () => (await options.count()) === 3);
    // The board shown first, its own card pointed; the others say their board, and where the words were.
    const texts = await options.allTextContents();
    expect(texts[0]).toContain("Relire la note quetzal");
    expect(texts[1]).toBe(`${pay} Payer la note quetzal du traiteur Recherche ailleurs`);
    expect(texts[2]).toContain("Après la note quetzal.");
    // The words asked are marked where they were found, as written there.
    expect(await options.first().locator("mark").allTextContents()).toEqual(["quetzal"]);
    expect(await card(read).getAttribute("class")).toContain("is-pointed");
    expect(await options.first().getAttribute("aria-selected")).toBe("true");

    await field.press("ArrowDown");
    expect(await field.getAttribute("aria-activedescendant")).toBe(await options.nth(1).getAttribute("id"));
    expect(await page.locator(".find-count").textContent()).toMatch(new RegExp(`^2 / 3 · ${pay} Payer`));
    await shot("61-find");
    await field.press("Enter");
    // Another board: the page goes there, and the keyboard lands on the card.
    // The card's own address: the board, then the card.
    await until("on the other board", async () => page.url().endsWith(`#/b/cherche-ailleurs/${pay}`));
    await page.locator(".find-bar").waitFor({ state: "hidden" });
    await until("the card has the keyboard", async () => (await focused()) === pay);
    expect(await card(pay).textContent()).toContain("Payer");
  });
});

describe("a card chosen stays in sight", () => {
  test("in a narrow window, the panel unfolding for a card leaves that card on screen", async () => {
    const cols = [1, 2, 3, 4, 5, 6, 7].map((n) => `add activity "Activité ${n}" --col ${n}`);
    await agent(
      ['board new "Large" --format story-map --id large-t154', ...cols, 'add story "Au bout" --col 7'].join(
        "\n",
      ),
    );
    await page.locator(".board-picker select").selectOption("large-t154");
    await page.setViewportSize({ width: 1024, height: 800 });
    const folded = () => page.locator(".work").evaluate((w) => w.classList.contains("fold-right"));
    try {
      const both = () =>
        page
          .locator(".work")
          .evaluate((w) => w.classList.contains("fold-right") && w.classList.contains("fold-left"));
      await until("the narrow window folds both panels", both);
      // The panels' width moves for 200 ms.
      await Bun.sleep(300);
      const last = page.locator("g.card", { hasText: "Au bout" });
      // The card at the right edge of what is seen: the panel unfolding takes that edge away.
      await last.evaluate((g) => {
        const scroll = g.closest(".canvas-scroll") as HTMLElement;
        scroll.scrollLeft += g.getBoundingClientRect().right - scroll.getBoundingClientRect().right + 8;
      });
      await last.click();
      await until("the panel unfolds for the card", async () => !(await folded()));
      const inSight = () =>
        last.evaluate((g) => {
          const card = g.getBoundingClientRect();
          const seen = (g.closest(".canvas-scroll") as HTMLElement).getBoundingClientRect();
          return (
            card.left >= seen.left &&
            card.right <= seen.right &&
            card.top >= seen.top &&
            card.bottom <= seen.bottom
          );
        });
      await until("the card chosen is on screen", inSight);
      await page.keyboard.press("Escape");
      await until("folded back once the card is left", folded);
    } finally {
      await page.setViewportSize({ width: 1440, height: 900 });
    }
  });
});

describe("look", () => {
  test("dark scheme and a narrow window keep the board usable", async () => {
    await page.emulateMedia({ colorScheme: "dark" });
    await shot("10-dark");
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 900, height: 700 });
    // A narrow window folds both panels into rails: the board keeps the room.
    await until("both panels are folded", async () =>
      page
        .locator(".work")
        .evaluate((w) => w.classList.contains("fold-left") && w.classList.contains("fold-right")),
    );
    await until(
      "the right panel is a rail",
      async () => Math.round((await page.locator(".right").boundingBox())?.width ?? 0) <= 44,
    );
    expect(await page.locator(".pass button").isVisible()).toBe(true);
    // The header gives way inside: the board title shrinks, the words on the buttons stay whole.
    const header = await page.evaluate(() => {
      const box = (selector: string): DOMRect | undefined =>
        document.querySelector(selector)?.getBoundingClientRect();
      return {
        fits: (box(".top .language")?.right ?? Number.NaN) <= window.innerWidth,
        // With the session panel hidden, the status must still be read whole.
        status: ((text) => (text ? text.scrollWidth <= text.clientWidth : false))(
          document.querySelector(".status-text"),
        ),
        // A button whose words wrapped would be two lines tall.
        oneLine: (box(".undo button")?.height ?? Number.NaN) < 36,
      };
    });
    expect(header).toEqual({ fits: true, status: true, oneLine: true });
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

// Last, for its long board would slow every test after it.
describe("a long journal", () => {
  test("a reload shows the board once, whole: never a board half replayed", async () => {
    // Long enough that its replay spans several frames: a batch holds 500 commands at most.
    await agent(`board new "Long" --format kanban --id long`);
    for (let batch = 0; batch < 3; batch++)
      await agent(
        Array.from({ length: 500 }, (_, i) => `add task "Carte ${batch * 500 + i}" --lane todo`).join("\n"),
        "long",
      );
    await page.goto(`${running.url}/#/b/long`);
    await until("the long board is drawn", async () => (await page.locator("g.card").count()) === 1500);
    // Counts the cards at every frame of the next load; only a page that asks for it is watched.
    await page.evaluate(() => sessionStorage.setItem("sideco.watch-paint", "1"));
    await page.addInitScript(() => {
      if (sessionStorage.getItem("sideco.watch-paint") !== "1") return;
      const seen: number[] = [];
      (window as unknown as { cardCounts: number[] }).cardCounts = seen;
      const look = (): void => {
        const n = document.querySelectorAll("g.card").length;
        if (n !== seen.at(-1)) seen.push(n);
        requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
    await page.reload();
    await until("every card is back", async () => (await page.locator("g.card").count()) === 1500);
    const counts = await page.evaluate(() => (window as unknown as { cardCounts: number[] }).cardCounts);
    await page.evaluate(() => sessionStorage.removeItem("sideco.watch-paint"));
    expect(counts.filter((n) => n > 0)).toEqual([1500]);
    await agent("board rm long");
  });

  test("a page opens on the board as it stands, and fetches the journal's past only to travel back", async () => {
    await agent(`board new "Ancien" --format kanban --id ancien`);
    const [named] = await agent(`add task "Premier nom" --lane todo`, "ancien");
    await agent(`rename ${named} "Nom d'aujourd'hui"`, "ancien");
    // Pushes the board's start out of the events a page opens with.
    await agent(`board new "Remplissage" --format kanban --id remplissage`);
    for (let batch = 0; batch < 2; batch++)
      await agent(
        Array.from({ length: 400 }, (_, i) => `add task "R${batch}-${i}" --lane todo`).join("\n"),
        "remplissage",
      );
    await agent("board rm remplissage");

    const asked: string[] = [];
    const watch = (request: { url(): string }): void => {
      if (request.url().includes("/api/history")) asked.push(request.url());
    };
    page.on("request", watch);
    await page.goto(`${running.url}/#/b/ancien`);
    await page.locator("g.card", { hasText: "Nom d'aujourd'hui" }).waitFor();
    // Live on, as before: what happens next is drawn.
    await agent(`rename ${named} "Nom de ce soir"`, "ancien");
    await page.locator("g.card", { hasText: "Nom de ce soir" }).waitFor();
    expect(asked).toEqual([]);

    await openHistory();
    await page.locator(".history-list .moment", { hasText: `Claude adds ${named} ` }).click();
    await page.locator(".banner").waitFor({ state: "visible" });
    await page.locator("g.card", { hasText: "Premier nom" }).waitFor();
    expect(asked).toHaveLength(1);
    page.off("request", watch);
    await page.locator(".banner button").click();
    await page.locator(".banner").waitFor({ state: "hidden" });
    await agent("board rm ancien");
  });
});
