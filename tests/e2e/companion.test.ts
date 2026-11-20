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

beforeAll(async () => {
  root = initRoot(realpathSync(mkdtempSync(join(tmpdir(), "sideco-e2e-"))));
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

    await page.locator(".pass input").fill("J'ai corrigé la règle, continue");
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

  test("handing over while Claude is not listening says what will make it read", async () => {
    await page.locator(".pass input").fill("Un mot pour plus tard");
    await page.locator(".pass input").press("Enter");
    await page.locator(".toast", { hasText: "Sent." }).waitFor();
    expect(await page.locator(".toast").textContent()).toContain("at your next message in the terminal");
    expect(await page.locator(".pass input").inputValue()).toBe("");
    // Handing over again without a word does not erase the word already said.
    await page.locator(".pass button").click();
    await until("Claude would be told the word", async () =>
      (await pending()).includes("The human passed you the turn: Un mot pour plus tard"),
    );
  });

  test("a message being typed for Claude survives Claude handing the turn over, keyboard included", async () => {
    const field = page.locator(".pass input");
    await field.click();
    await page.keyboard.type("Bonne idée, le focus");
    await agent('pass "Qui réserve le stock ?"', "commande");
    await page.locator(".theirs", { hasText: "Qui réserve le stock ?" }).waitFor();
    expect(await field.inputValue()).toBe("Bonne idée, le focus");
    await page.keyboard.type(" !");
    expect(await field.inputValue()).toBe("Bonne idée, le focus !");
    await field.fill("");
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
    await agent(
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
    await card("E2").waitFor();
    const all = (await workspace()).seq;

    // This board, by default: one step back is its previous event, not the other board's.
    expect(await scope.inputValue()).toBe("board");
    expect(await scope.locator("option").allTextContents()).toEqual(["This board", "Everything"]);
    await reads(/^Live · 3 events$/);
    await back.click();
    await reads(/^2 \/ 3 · .*Claude adds E1 “Devis demandé”$/);
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
    await reads(new RegExp(`^${all - 1} / ${all} · .*Claude adds E2 “Devis signé”$`));
    expect(await page.locator("g.card").count()).toBe(2);
    await back.click();
    await reads(new RegExp(`^${all - 2} / ${all} · .*Claude adds E1 “Facture émise”$`));

    // Back to this board from a moment that is not one of its events: the board is as its latest
    // event left it, and a step goes to its nearest event that way.
    await scope.selectOption("board");
    await reads(/^2 \/ 3 · .*Claude adds E1 “Devis demandé”$/);
    await forward.click();
    await reads(/^Live · 3 events$/);
    await page.locator(".banner").waitFor({ state: "hidden" });

    await page.locator(".board-picker select").selectOption("commande");
    await card("E1").waitFor();
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
    // Another message may still be up: wait for this one, not for any.
    await page.locator(".toast", { hasText: "Claude created the board “Sprint 12”" }).waitFor();
    expect(page.url()).toEndWith("#/b/commande");
    await page.locator(".board-picker select").selectOption("sprint");
    await card("T3").waitFor();
    expect(await page.locator(".palette h2").textContent()).toBe("Kanban");
    // A board that asks its own question: the palette says it, not the workshop's.
    await agent('purpose "Qu\'est-ce qui bloque le sprint ?" --board sprint');
    await page.locator(".palette .purpose", { hasText: "Qu'est-ce qui bloque le sprint ?" }).waitFor();

    const doing = await centre("B1");
    await dragTo("T1", doing.x, doing.y + 120);
    await until("T1 is in progress", async () => (await elementOf("sprint", "T1"))?.lane === "doing");
    expect(await pending()).toContain("→ T1 moved lane todo → doing");
    await settled("T1");
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
    await card("T2").click();
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
    await until("T2 is in Done", async () => (await elementOf("sprint", "T2"))?.lane === "done");
    expect(await pending()).toContain("→ T2 moved lane todo → done");
    expect(await card("T2").locator(".card-done").count()).toBe(0);
    await page.locator(".card-tools button", { hasText: "Not done" }).waitFor({ state: "attached" });
    await shot("21-done");

    await card("T2").focus();
    await page.keyboard.press("d");
    await until("T2 is in À valider", async () => (await elementOf("sprint", "T2"))?.lane === "doing");
    await page.locator(".spoken", { hasText: "À valider" }).waitFor({ state: "attached" });
  });

  test("the card toolbar leaves the board to the panel: it hides when the keyboard goes there, and comes back with the card", async () => {
    const tools = page.locator(".card-tools");
    await card("T2").click();
    await tools.waitFor();
    await page.locator("#tab-history").click();
    await tools.waitFor({ state: "hidden" });
    await card("T2").click();
    await tools.waitFor();
    await page.keyboard.press("Escape");
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

  test("impact / effort: four lanes say the impact and the effort they stand for, and a drag re-sorts", async () => {
    await agent(
      [
        'board new "Priorités" --format impact-effort --id priorites',
        'add item "Insérer une colonne" --lane quick',
        'add item "Icône du type" --lane quick',
        'add item "Canevas libre" --lane fill',
      ].join("\n"),
    );
    await page.locator(".board-picker select").selectOption("priorites");
    await card("I3").waitFor();
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
    const quick = await centre("I1");
    const fill = await centre("I3");
    expect(fill.y).toBeGreaterThan(quick.y + 100);
    expect(await page.locator(".axis-label").allTextContents()).toEqual(["Impact →", "Effort →"]);
    const bets = await page.locator(".band-lane .lane-label", { hasText: "Big bets" }).boundingBox();
    if (!bets) throw new Error("no Big bets cell");
    await dragTo("I3", bets.x + 100, quick.y);
    await until("I3 is a big bet", async () => (await elementOf("priorites", "I3"))?.lane === "bet");
    expect(await pending()).toContain("→ I3 moved lane fill → bet");
    await settled("I3");
    await shot("19-impact-effort");

    // Each axis names its two ends; zoomed in and scrolled sideways, a cell keeps its name in sight.
    expect(await page.locator(".axis-bound").allTextContents()).toEqual(["low", "high", "low", "high"]);
    const zoomIn = page.getByRole("button", { name: "Zoom in" });
    const zoomOut = page.getByRole("button", { name: "Zoom out" });
    for (let i = 0; i < 4; i++) await zoomIn.click();
    const canvas = page.locator(".canvas-scroll");
    const quickName = page.locator(".lane-label", { hasText: "Quick wins" });
    const quickCell = page.locator(".band-lane .lane-bg").first();
    const frameLeft = (await canvas.boundingBox())?.x ?? 0;
    const cellLeft = (await quickCell.boundingBox())?.x ?? 0;
    await canvas.evaluate(
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
    expect(await page.locator(".palette h2").textContent()).toBe("Retrospective");

    await paletteType("Observation").click();
    await typeInEditor("Les revues sont rapides");
    await card("P1").waitFor();
    expect((await workspace()).boards.find((b) => b.id === "retro-sprint-12")?.elements[0]).toMatchObject({
      id: "P1",
      lane: "went-well",
    });

    // An action from the palette lands in Try; one made from a point is linked from it.
    await paletteType("Action").click();
    await typeInEditor("Garder des revues courtes");
    await card("A1").waitFor();
    expect((await elementOf("retro-sprint-12", "A1"))?.lane).toBe("try");
    await card("P1").click();
    await page.locator(".card-tools button", { hasText: "Make an action of it" }).click();
    await typeInEditor("Revue à deux");
    await card("A2").waitFor();
    const retro = (await workspace()).boards.find((b) => b.id === "retro-sprint-12");
    expect(retro?.elements.find((e) => e.id === "A2")?.lane).toBe("try");
    expect(retro?.edges).toContainEqual(expect.objectContaining({ src: "P1", dst: "A2" }));
    await settled("A2");
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

  test("Undo and Redo are offered once the human has done something, and only then", async () => {
    await agent(
      `board new "Retour" --id ${BOARD}\nadd event "Commande passée" --col 1\nadd event "Stock réservé" --col 2\nlink E1 E2`,
    );
    await page.locator(".board-picker select").selectOption(BOARD);
    // The board shown before also had an E1: wait for this one's label, not for any card.
    await card("E1").getByText("Commande passée").waitFor();
    expect(await undo().getAttribute("aria-label")).toStartWith("Undo");
    expect(await undo().isDisabled()).toBe(true);
    expect(await redo().isDisabled()).toBe(true);

    await card("E1").dblclick();
    await typeInEditor("Validée");
    await until("the rename reached the journal", async () => (await labelOf("E1")) === "Validée");
    await until("Undo is offered", async () => !(await undo().isDisabled()));
    await shot("13-undo");

    await undo().click();
    await until("the label is back", async () => (await labelOf("E1")) === "Commande passée");
    await card("E1").getByText("Commande passée").waitFor();
    await until("Redo is offered", async () => !(await redo().isDisabled()));
    expect(await undo().isDisabled()).toBe(true);
    await redo().click();
    await until("the rename is back", async () => (await labelOf("E1")) === "Validée");
  });

  test("the keyboard does the same, and leaves a text being typed alone", async () => {
    await offered(undo());
    await page.keyboard.press("Control+z");
    await until("Ctrl+Z took the rename back", async () => (await labelOf("E1")) === "Commande passée");
    await offered(redo());
    await page.keyboard.press("Control+Shift+z");
    await until("Ctrl+Shift+Z put it back", async () => (await labelOf("E1")) === "Validée");

    await card("E2").dblclick();
    const editor = page.locator("textarea.card-editor");
    await editor.waitFor({ state: "visible" });
    const before = (await workspace()).seq;
    await editor.press("Control+z");
    await Bun.sleep(150);
    expect((await workspace()).seq).toBe(before);
    await editor.press("Escape");
  });

  test("a removed card comes back under its id, with its link", async () => {
    await card("E2").focus();
    await page.keyboard.press("Delete");
    await until("E2 is gone", async () => (await elementOf(BOARD, "E2")) === undefined);
    await card("E2").waitFor({ state: "detached" });
    await page.keyboard.press("Control+z");
    await until("E2 is back", async () => (await elementOf(BOARD, "E2"))?.by === "agent");
    await card("E2").waitFor();
    const board = (await workspace()).boards.find((b) => b.id === BOARD);
    expect(board?.edges.map((e) => `${e.src}>${e.dst}`)).toEqual(["E1>E2"]);
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
    await card("E2").waitFor();
    expect(await labelOf("E1")).toBe("Validée");

    // Net of the back-and-forth, Claude is told one thing: the rename that stands.
    const told = await pending();
    expect(told).toContain('~ E1 renamed "Commande passée" → "Validée"');
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

  test("a note says which card it is about, who wrote it and who is waited for", async () => {
    await agent(
      `board new "Fil" --id ${BOARD}\nadd event "Commande passée" --col 1\nadd event "Stock réservé" --col 2\nnote "Qui réserve ?" --on E2\nnote "Et le reste ?"`,
    );
    await page.locator(".board-picker select").selectOption(BOARD);
    await thread("N1").waitFor({ state: "attached" });
    // Already there when the board was shown, they wait in their tab, which says so.
    const tab = page.locator("#tab-notes");
    expect(await tab.getAttribute("aria-selected")).toBe("false");
    expect(await tab.locator(".tab-count").textContent()).toBe("2");
    expect(await tab.locator(".tab-count").getAttribute("class")).toContain("is-yours");
    expect(await tab.getAttribute("aria-label")).toBe("Notes: 2 open, 2 awaiting your answer");
    await tab.click();
    await thread("N1").waitFor();
    expect(await page.locator(".notes h2").textContent()).toBe("Open notes (2)");
    expect(await thread("N1").locator(".thread-on").textContent()).toBe("E2 · Stock réservé");
    // The card a note is about says so in its name, as its badge does to the eye.
    expect(await card("E2").getAttribute("aria-label")).toContain(" · 1 open note");
    expect(await card("E1").getAttribute("aria-label")).not.toContain("open note");
    expect(await thread("N2").locator(".thread-on").textContent()).toBe("Whole board");
    expect(await said("N1").locator(".thread-author").textContent()).toBe("Claude");
    // The id Claude uses in the terminal is on the message it names.
    expect(await said("N1").locator(".thread-id").textContent()).toBe("N1");
    expect(await said("N1").locator("p").textContent()).toBe("Qui réserve ?");
    expect(await thread("N1").locator(".thread-waits").textContent()).toBe("Awaits your answer");
    expect(await badge("E2").textContent()).toBe("1");
  });

  test("the human answers in the thread, and Claude is told which note the answer is to", async () => {
    // Several lines in one answer: Shift+Enter breaks the line, Enter sends.
    await replyField("N1").fill("L'entrepôt");
    await replyField("N1").press("Shift+Enter");
    await replyField("N1").pressSequentially("de Lyon");
    await replyField("N1").press("Enter");
    await said("N1").nth(1).waitFor();
    expect(await said("N1").nth(1).locator(".thread-author").textContent()).toBe("You");
    expect(await said("N1").nth(1).locator("p").textContent()).toBe("L'entrepôt\nde Lyon");
    expect(
      await said("N1")
        .nth(1)
        .locator("p")
        .evaluate((p) => getComputedStyle(p).whiteSpace),
    ).toBe("pre-wrap");
    expect(await thread("N1").locator(".thread-waits").textContent()).toBe("Awaits Claude");
    expect(await replyField("N1").inputValue()).toBe("");
    // Still one discussion on the card, and two on the board.
    expect(await badge("E2").textContent()).toBe("1");
    expect(await page.locator(".notes h2").textContent()).toBe("Open notes (2)");
    expect(await pending()).toContain("reply N3 to N1 on E2: L'entrepôt");
  });

  test("Claude's answer lands in the same thread, and a reply being typed elsewhere survives it", async () => {
    await replyField("N2").fill("Brouillon en cours");
    await agent('reply N1 "Toujours l\'entrepôt ?"', BOARD);
    await said("N1").nth(2).waitFor();
    expect(await said("N1").allTextContents()).toEqual([
      "ClaudeN1Qui réserve ?",
      "YouN3L'entrepôt\nde Lyon",
      "ClaudeN4Toujours l'entrepôt ?",
    ]);
    expect(await thread("N1").locator(".thread-waits").textContent()).toBe("Awaits your answer");
    expect(await replyField("N2").inputValue()).toBe("Brouillon en cours");
    expect(await replyField("N2").evaluate((field) => field === document.activeElement)).toBe(true);
    await replyField("N2").fill("");
  });

  test("a card points to its discussions, and a discussion points back to its card", async () => {
    const classes = async (locator: ReturnType<typeof card>): Promise<string[]> =>
      ((await locator.getAttribute("class")) ?? "").split(" ");
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("Escape");
    await page.locator("#tab-session").click();
    await card("E2").click();
    // Chosen from the session, the card shows its detail, which leads to its discussions.
    const toNotes = page.locator(".card-panel-notes");
    await toNotes.waitFor();
    expect(await toNotes.textContent()).toBe("1 open note on this card");
    await toNotes.click();
    await until("the card's discussion is marked", async () =>
      (await classes(thread("N1"))).includes("is-current"),
    );
    expect(await page.locator("#tab-notes").getAttribute("aria-selected")).toBe("true");
    expect(await classes(thread("N2"))).not.toContain("is-current");
    await shot("15-threads");

    await page.keyboard.press("Escape");
    await until("nothing is selected", async () => !(await classes(card("E2"))).includes("is-selected"));
    await thread("N1").hover();
    await until("the card is pointed at", async () => (await classes(card("E2"))).includes("is-pointed"));
    await thread("N1").locator(".thread-on").click();
    await until("the card is selected", async () => (await classes(card("E2"))).includes("is-selected"));
    await page.keyboard.press("Escape");
    await until(
      "nothing is selected again",
      async () => !(await classes(card("E2"))).includes("is-selected"),
    );
    // Answering a note shows its card as its title does, and leaves the keyboard in the answer.
    await thread("N1").locator(".thread-reply textarea").click();
    await until("the card is selected by the answer", async () =>
      (await classes(card("E2"))).includes("is-selected"),
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
    await agent('note "Et la commande annulée ?" --on E1', BOARD);
    await until("the Notes tab opened", chosen);
    // Opened without being asked, it is said to whoever does not see the panel change.
    await page
      .locator(".spoken", { hasText: "Claude wrote a note that waits for you: the Notes tab is open." })
      .waitFor({ state: "attached" });
    await thread("N5").waitFor();
    expect(await notesTab.locator(".tab-count").textContent()).toBe("3");

    await page.locator("#tab-history").click();
    await badge("E1").click();
    await until("the count led to the Notes tab", chosen);
    await page.keyboard.press("Escape");
    await thread("N5").locator(".thread-resolve").click();
    await thread("N5").waitFor({ state: "detached" });
  });

  test("resolving closes the whole thread", async () => {
    await thread("N1").locator(".thread-resolve").click();
    await thread("N1").waitFor({ state: "detached" });
    await until("the card no longer counts it", async () => (await badge("E2").count()) === 0);
    expect(await page.locator(".notes h2").textContent()).toBe("Open notes (1)");
    expect(await pending()).toContain("✓ note N1 resolved");
  });

  test("closing a thread with an answer typed but not sent says it first: nothing typed is lost", async () => {
    const resolve = thread("N2").locator(".thread-resolve");
    expect(await resolve.textContent()).toBe("Resolve");
    await replyField("N2").fill("Réponse de dernière minute");
    // The button says what it will do with the words in the field.
    await until("the button offers both", async () => (await resolve.textContent()) === "Reply and resolve");
    await replyField("N2").fill("  ");
    await until("the button only closes", async () => (await resolve.textContent()) === "Resolve");
    await replyField("N2").fill("Réponse de dernière minute");
    await resolve.click();
    await thread("N2").waitFor({ state: "detached" });
    const told = await pending();
    expect(told).toContain("to N2: Réponse de dernière minute");
    expect(told).toContain("✓ note N2 resolved");
  });
});

describe("what Claude has not read yet", () => {
  const BOARD = "non-lu";
  const WORDS = "Not read by Claude yet";
  const cardMark = (id: string) => card(id).locator(".card-unread");
  const threadMark = (id: string) => page.locator(`.notes .thread[data-thread="${id}"] .thread-unread`);

  test("a card the human renamed and a thread they answered are marked, until Claude has read them", async () => {
    await agent(
      `board new "Non lu" --id ${BOARD}\nadd event "Facture émise" --col 1\nadd event "Facture payée" --col 2\nnote "Qui relance ?"`,
    );
    await page.locator(".board-picker select").selectOption(BOARD);
    await card("E2").getByText("Facture payée").waitFor();
    expect(await page.locator(".card-unread, .thread-unread").count()).toBe(0);

    await card("E1").dblclick();
    await typeInEditor("Facture envoyée");
    await cardMark("E1").waitFor();
    // Said in words too: to a pointer on the mark, and in the card's name for a screen reader.
    expect(await cardMark("E1").locator("title").textContent()).toBe(WORDS);
    expect(await card("E1").getAttribute("aria-label")).toEndWith(WORDS);
    expect(await cardMark("E2").count()).toBe(0);

    // Already there when the board was shown, the note is read in its tab.
    await page.locator("#tab-notes").click();
    const reply = page.locator(`.notes .thread[data-thread="N1"] .thread-reply [name^=reply-]`);
    await reply.fill("La compta");
    await reply.press("Enter");
    await threadMark("N1").waitFor();
    expect(await threadMark("N1").textContent()).toBe(WORDS);
    await shot("18-unread");

    // The marks tell about now: a board shown as it was carries none.
    await openHistory();
    await page.locator(".history button", { hasText: "◄" }).click();
    await page.locator(".banner").waitFor({ state: "visible" });
    await card("E1").getByText("Facture envoyée").waitFor();
    expect(await page.locator(".card-unread, .thread-unread").count()).toBe(0);
    await page.locator(".banner button").click();
    await cardMark("E1").waitFor();

    // The session reads its digest, as the hooks do.
    await fetch(`${running.url}/api/changes?session=${SESSION}&ack=1`);
    await cardMark("E1").waitFor({ state: "detached" });
    await threadMark("N1").waitFor({ state: "detached" });
    // Read, the card is heard by its words alone.
    expect(await card("E1").getAttribute("aria-label")).toStartWith("Facture envoyée · E1");
    expect(await card("E1").getAttribute("aria-label")).not.toEndWith(WORDS);
  });
});

describe("adding where the pointer is", () => {
  const offer = (type: string) => page.locator(`.sideco-board .add-here[data-type="${type}"]`);
  const offers = () => page.locator(".sideco-board .add-here");

  test("retro: a column offers one + per kind of card, and the card lands in that column", async () => {
    await agent(
      `board new "Rétro du sprint" --format retro --id ajout\nadd point "Les tests d'abord" --lane keep`,
    );
    await page.locator(".board-picker select").selectOption("ajout");
    await card("P1").getByText("Les tests").waitFor();
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

    await offer("action").click();
    await typeInEditor("Écrire le test avant le code");
    await until("the action is in Try", async () => {
      const added = await elementOf("ajout", "A1");
      return added?.type === "action" && added.lane === "try";
    });
    await card("A1").getByText("Écrire le test").waitFor();
    // How to add is in the keys sheet; the palette keeps the types, each saying what it is for on hover.
    expect(await page.locator(".palette .how").count()).toBe(0);
    expect(await page.locator(".palette .type", { hasText: "Action" }).getAttribute("title")).toContain(
      " · ",
    );
  });

  test("timeline: a cell offers the kind of its row, and the card lands in that step", async () => {
    await agent(
      `board new "Ajout en case" --id ajout-case\nadd event "Commande passée" --col 1\nadd event "Stock réservé" --col 2`,
    );
    await page.locator(".board-picker select").selectOption("ajout-case");
    await card("E2").getByText("Stock réservé").waitFor();
    // The row names sit over the cards, where they stay while the board scrolls.
    const row = await page.locator(".heads-rows .band-label", { hasText: "Policy" }).boundingBox();
    const e2 = await centre("E2");
    if (!row) throw new Error("no Policy row");
    await page.mouse.move(e2.x, row.y + row.height / 2);
    await offer("policy").waitFor();
    expect(await offers().count()).toBe(1);
    await Bun.sleep(200);
    await shot("17-add-in-cell");

    await offer("policy").click();
    await typeInEditor("Quand stock réservé, facturer");
    await until("the policy is in step 2", async () => (await elementOf("ajout-case", "P1"))?.col === 2);
    await card("P1").waitFor();
  });

  test("timeline: the edge between two steps offers a column, and the steps after it move over", async () => {
    const e2 = await settled("E2");
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
    await until("step 2 moved to 3", async () => (await elementOf("ajout-case", "E2"))?.col === 3);
    expect((await elementOf("ajout-case", "P1"))?.col).toBe(3);
    expect((await elementOf("ajout-case", "E1"))?.col).toBe(1);
  });

  test("timeline: an empty step offers a « × » at its top, and the steps after it move back", async () => {
    // The card added before is still selected: its toolbar would cover the step.
    await page.keyboard.press("Escape");
    await page.locator(".card-tools").waitFor({ state: "hidden" });
    // Step 2 is the empty one the column made; its event cell is level with E1, one step right.
    const e1 = await centre("E1");
    const step = await page.locator(".band-step-label", { hasText: /^2$/ }).boundingBox();
    if (!step) throw new Error("no heading for step 2");
    await page.mouse.move(step.x + step.width / 2, e1.y);
    const remove = page.locator('.sideco-board .add-here[data-type="remove-column"][data-column="2"]');
    await remove.waitFor();
    expect(await remove.getAttribute("aria-label")).toBe("Remove step 2");
    await Bun.sleep(200);
    await shot("21-remove-step");

    await remove.click();
    await until("step 3 moved back to 2", async () => (await elementOf("ajout-case", "E2"))?.col === 2);
    expect((await elementOf("ajout-case", "P1"))?.col).toBe(2);
    await page.keyboard.press("Control+z");
    await until(
      "Undo puts the empty step back",
      async () => (await elementOf("ajout-case", "E2"))?.col === 3,
    );
    // The page offers Redo once the undo has reached it, not before.
    await page.locator("button:not([disabled])", { hasText: /^Redo$/ }).waitFor();
    await page.keyboard.press("Control+Shift+z");
    await until("Redo takes it out again", async () => (await elementOf("ajout-case", "E2"))?.col === 2);
  });

  test("the offer leaves with the pointer, and is not made on a board shown as it was", async () => {
    // The card added before is still selected: its toolbar, kept inside the window, would cover E2.
    await page.keyboard.press("Escape");
    await page.locator(".card-tools").waitFor({ state: "hidden" });
    const e2 = await centre("E2");
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
        commands: [{ kind: "annotate", board: "ajout-case", id: "E1", detail }],
      }),
    });
    expect(posted.ok).toBe(true);
    await card("E1").locator(".card-detail").waitFor();
    const before = (await workspace()).seq;
    const field = page.locator("textarea.card-panel-editor");
    const editor = page.locator("textarea.card-editor");

    await card("E1").click();
    await page.locator(".card-tools button", { hasText: "Detail" }).click();
    await field.waitFor({ state: "visible" });
    // A detail is read before it is changed: nothing comes selected, the caret waits at its start.
    expect(
      await field.evaluate(
        (f: HTMLTextAreaElement) =>
          document.activeElement === f && f.selectionStart === 0 && f.selectionEnd === 0,
      ),
    ).toBe(true);
    expect(await field.getAttribute("aria-label")).toBe("Detail of E1");
    await field.press("ControlOrMeta+Enter");
    await field.waitFor({ state: "hidden" });

    await card("E1").dblclick();
    await editor.waitFor({ state: "visible" });
    await editor.press("Enter");
    await editor.waitFor({ state: "hidden" });

    await Bun.sleep(200);
    expect((await workspace()).seq).toBe(before);
    expect((await elementOf("ajout-case", "E1"))?.detail).toBe(detail);
  });

  test("a detail typed on several lines keeps its lines: Enter breaks the line, ⌘/Ctrl+Enter saves", async () => {
    const field = page.locator("textarea.card-panel-editor");
    await card("E1").click();
    await page.locator(".card-tools button", { hasText: "Detail" }).click();
    await field.waitFor({ state: "visible" });
    await field.fill("Première  ligne");
    await field.press("Enter");
    await field.pressSequentially("seconde ligne");
    await field.press("ControlOrMeta+Enter");
    await field.waitFor({ state: "hidden" });
    // The keyboard is back on the card the detail is about, and the ear is told it is kept.
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-id"))).toBe("E1");
    await until(
      "the detail is kept line by line",
      async () => (await elementOf("ajout-case", "E1"))?.detail === "Première ligne\nseconde ligne",
    );
    await until(
      "the save is said",
      async () => (await page.locator(".spoken").textContent()) === "Detail of E1 saved",
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
            id: "E1",
            detail: "Paiement par carte.\nVirement refusé.",
          },
        ],
      }),
    });
    expect(posted.ok).toBe(true);
    // A card chosen while the session is shown opens the Detail tab.
    await page.locator("#tab-session").click();
    await card("E1").click();
    await panel().waitFor({ state: "visible" });
    expect(await page.locator("#tab-detail").getAttribute("aria-selected")).toBe("true");
    expect(await panel().locator("h2").textContent()).toBe("Card E1");
    expect(await panel().locator(".card-panel-name").textContent()).toBe(
      (await elementOf("ajout-case", "E1"))?.label ?? null,
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
        commands: [{ kind: "annotate", board: "ajout-case", id: "E1", detail }],
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
    expect(await field.getAttribute("aria-label")).toBe("Detail of E1");
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
    await card("E1").focus();
    await page.keyboard.press("e");
    const field = panel().locator("textarea.card-panel-editor");
    await field.waitFor({ state: "visible" });
    expect(await page.evaluate(() => document.activeElement?.classList.contains("card-panel-editor"))).toBe(
      true,
    );
    // Choosing another card does not take the words away: the panel stays on the one being written.
    await card("E2").click();
    expect(await panel().locator("h2").textContent()).toBe("Card E1");
    await panel().locator("button", { hasText: "Cancel" }).click();
    await field.waitFor({ state: "hidden" });
    expect(await panel().locator("h2").textContent()).toBe("Card E2");
    await card("E1").click();
  });

  test("the Session tab, once chosen, stays while the board changes under it", async () => {
    await page.locator("#tab-session").click();
    await panel().waitFor({ state: "hidden" });
    await agent('rename E1 "Paiement accepté"', "ajout-case");
    await until("the board has the new name", async () =>
      ((await card("E1").textContent()) ?? "").includes("Paiement accepté"),
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
    // From History, past the quiet Detail, back round to Session.
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => document.activeElement?.id)).toBe("tab-session");
    await shot("57-tabs");
  });

  const foldedRight = () => page.locator(".work").evaluate((w) => w.classList.contains("fold-right"));

  test("Detail on a card's bar opens the folded panel on its Detail tab", async () => {
    await page.locator("#tab-history").click();
    await page.keyboard.press("]");
    await until("the right panel is folded", foldedRight);
    await card("E1").click();
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
    expect(await card("E1").getAttribute("aria-label")).toContain(" · has a detail");
    await card("E1").locator(".card-detail").click();
    await until("the right panel is open again", async () => !(await foldedRight()));
    expect(await page.locator("#tab-detail").getAttribute("aria-selected")).toBe("true");
    expect(await panel().locator(".card-panel-name").textContent()).toBe(
      (await elementOf("ajout-case", "E1"))?.label ?? null,
    );
    // Read, not written: the detail is shown, no editor opened.
    expect(await page.locator(".card-panel.is-editing").count()).toBe(0);
    // Chosen already, it opens the tab again from another one.
    await page.locator("#tab-history").click();
    await card("E1").locator(".card-detail").click();
    await until(
      "back on Detail",
      async () => (await page.locator("#tab-detail").getAttribute("aria-selected")) === "true",
    );
    await page.keyboard.press("Escape");
  });

  test("the tabs keep their names where they fit, with icons drawn alike, and only icons in the rail", async () => {
    const shown = (locator: ReturnType<typeof page.locator>) =>
      locator.evaluateAll((all) => all.map((e) => e.getBoundingClientRect().width > 4));
    // The panel is 300 px: the four names fit, the icons give way first.
    expect(await shown(page.locator(".tabs .tab-label"))).toEqual([true, true, true, true]);
    expect(await page.locator(".tabs .tab-icon svg").count()).toBe(4);
    // Folded, the rail keeps the icons alone.
    await page.keyboard.press("]");
    await until("the right panel is folded", foldedRight);
    expect(await shown(page.locator(".tabs .tab-label"))).toEqual([false, false, false, false]);
    expect(await shown(page.locator(".tabs .tab-icon"))).toEqual([true, true, true, true]);
    await page.keyboard.press("]");
    await until("the right panel is open again", async () => !(await foldedRight()));
    expect(await shown(page.locator(".tabs .tab-label"))).toEqual([true, true, true, true]);
  });

  test("in a narrow window, a card chosen unfolds its detail, and folds it back once left", async () => {
    await page.locator("#tab-session").click();
    await page.setViewportSize({ width: 1024, height: 800 });
    try {
      await until("the narrow window folds the panel", foldedRight);
      await card("E1").click();
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
    const selected = async () => ((await card("E1").getAttribute("class")) ?? "").includes("is-selected");
    for (const reading of ["history", "notes"]) {
      await page.locator(`#tab-${reading}`).click();
      await card("E1").click();
      await until("the card is chosen", selected);
      expect(await on(reading)).toBe(true);
      await page.keyboard.press("Escape");
      await until("the card is left", async () => !(await selected()));
      expect(await on(reading)).toBe(true);
    }
    await page.locator("#tab-session").click();
    await card("E1").click();
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
    await page.keyboard.press("/");
    const field = page.locator(".find-bar input");
    await field.waitFor({ state: "visible" });
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

  test("cards are read lane by lane, each lane a named group, whatever the order they were made in", async () => {
    await agent(
      `board new "Lecture" --format kanban --id ${BOARD}\nadd task "Fini" --lane done\nadd task "Après" --lane todo\nadd task "Avant" --lane todo`,
    );
    await page.locator(".board-picker select").selectOption(BOARD);
    await card("T3").waitFor();
    // T3 was made last; it sits at the top of To do, so it is read first.
    await agent("move T3 --lane todo --before T2", BOARD);
    await until("T3 is read before T2", async () => (await labels())[0]?.ids?.[0] === "T3");
    expect(await labels()).toEqual([
      { label: "To do", role: "group", ids: ["T3", "T2"] },
      { label: "Done", role: "group", ids: ["T1"] },
    ]);
    expect(await page.locator('g.card[tabindex="0"]').getAttribute("data-id")).toBe("T3");
  });

  test("a card moved by the keyboard joins its new group, and the keyboard stays on it", async () => {
    await card("T3").focus();
    await page.keyboard.press("Shift+ArrowRight");
    await until("T3 moved to Doing", async () => (await labels()).some((g) => g.label === "Doing"));
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-id"))).toBe("T3");
    expect((await labels()).find((g) => g.label === "Doing")?.ids).toEqual(["T3"]);
  });

  test("Undo is said, with what it took back", async () => {
    await page.keyboard.press("Control+z");
    await until("T3 is back in To do", async () => (await labels())[0]?.ids?.includes("T3") === true);
    await page.locator(".spoken", { hasText: /^Undone: / }).waitFor({ state: "attached" });
    await page.keyboard.press("Control+Shift+z");
    await page.locator(".spoken", { hasText: "Done again" }).waitFor({ state: "attached" });
  });

  test("on a flow, a card tells where it leads and where it comes from, branches named", async () => {
    await agent(
      `board new "Lecture flow" --format flow --id ${FLOWING}\nadd step "Recevoir"\nadd decision "En stock ?" --from S1\nadd step "Expédier" --from D1 --edge oui`,
    );
    await page.locator(".board-picker select").selectOption(FLOWING);
    await card("D1").waitFor();
    expect(await card("D1").getAttribute("aria-description")).toBe(
      "leads to S2 Expédier (oui) · comes from S1 Recevoir",
    );
    // Shift and an arrow cannot move a card a flow places from its links: the page says so.
    await card("D1").focus();
    await page.keyboard.press("Shift+ArrowRight");
    await page.locator(".toast", { hasText: "D1 is placed by its links" }).waitFor();
    await agent(`board rm ${FLOWING}\nboard rm ${BOARD}`);
    await until("the page has left the boards removed", async () => {
      const shown = await page.locator(".board-picker select").inputValue();
      return shown !== BOARD && shown !== FLOWING;
    });
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

  test("on an empty board, « Skip to the board » leads to the cards one can add", async () => {
    await agent(`board new "Ajout clavier" --format kanban --id ${BOARD}`);
    await page.locator(".board-picker select").selectOption(BOARD);
    await until("the board is shown, empty", async () => (await page.locator("g.card").count()) === 0);
    await page.locator(".skip").focus();
    await page.keyboard.press("Enter");
    expect(await active()).toMatchObject({ tag: "BUTTON", cls: "type" });
  });

  test("the card just added has the keyboard, not the page", async () => {
    await page.keyboard.press("Enter");
    await typeInEditor("Premier");
    await card("T1").waitFor();
    await until("the keyboard is on T1", async () => (await active()).id === "T1");
    expect(await page.locator('g.card[tabindex="0"]').getAttribute("data-id")).toBe("T1");
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
    await card("T1").focus();
    await page.keyboard.press("Alt+ArrowRight");
    await typeInEditor("À droite");
    await card("T2").waitFor();
    await until("the keyboard is on T2", async () => (await active()).id === "T2");
    expect(await lanes()).toEqual({ "To do": ["T1"], Doing: ["T2"] });

    await card("T1").focus();
    await page.keyboard.press("Alt+ArrowUp");
    await typeInEditor("Au-dessus");
    await card("T3").waitFor();
    expect((await lanes())["To do"]).toEqual(["T3", "T1"]);
  });

  test("one Undo takes the card added beside back", async () => {
    await page.keyboard.press("Control+z");
    await card("T3").waitFor({ state: "detached" });
    expect((await lanes())["To do"]).toEqual(["T1"]);
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
    await agent(
      `board new "Attente" --id ${BOARD}\nadd event "Devis envoyé" --col 1\npass "Ton avis sur E1 ?"`,
    );
    await page.locator(".board-picker select").selectOption(elsewhere);
    await pill().waitFor();
    // Other boards of this run may wait too: they are counted after the name.
    expect(await pill().textContent()).toStartWith("Claude waits · Attente");
    expect(await pill().getAttribute("title")).toBe("Ton avis sur E1 ?");
    // The tab says it too, for who looks at another one.
    expect(await page.title()).toStartWith("● Claude waits for you · ");
    // In the middle of the header, beside what Claude is doing.
    expect(await pill().evaluate((button) => button.closest(".top-claude") !== null)).toBe(true);
    await shot("22-claude-waits");

    await pill().click();
    await card("E1").getByText("Devis envoyé").waitFor();
    expect(await pill().textContent()).toStartWith("Claude waits for you");
    // Pressed, the pill says why: Claude's words, on the board they are about.
    await until("the words are said", async () =>
      ((await page.locator(".toast").textContent()) ?? "").includes("Your turn: Ton avis sur E1 ?"),
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

  test("Claude adds a card and renames another while a label is typed: the words stay, and are saved", async () => {
    await agent(`board new "Garde" --id ${BOARD}\nadd event "Première" --col 1\nadd event "Seconde" --col 2`);
    await page.locator(".board-picker select").selectOption(BOARD);
    await card("E1").getByText("Première").waitFor();
    await card("E1").dblclick();
    await editor().fill("En cours de frappe");
    await agent('add event "Arrivée entre-temps" --col 3\nrename E2 "Renommée par Claude"', BOARD);
    await card("E3").waitFor();
    await card("E2").getByText("Renommée par Claude").waitFor();
    expect(await editor().isVisible()).toBe(true);
    expect(await editor().inputValue()).toBe("En cours de frappe");
    expect(await editor().evaluate((field) => field === document.activeElement)).toBe(true);
    await editor().press("Enter");
    await until("the label typed is saved", async () => (await labelOf("E1")) === "En cours de frappe");
  });

  test("Claude renames the very card being edited: what the human types is kept, and wins", async () => {
    await card("E2").dblclick();
    await editor().fill("Mon libellé");
    await agent('rename E2 "Celui de Claude"', BOARD);
    await until("Claude's name reached the journal", async () => (await labelOf("E2")) === "Celui de Claude");
    expect(await editor().inputValue()).toBe("Mon libellé");
    await editor().press("Enter");
    await until("the human's label is saved", async () => (await labelOf("E2")) === "Mon libellé");
  });

  test("Claude removes the card being edited: the words are not lost without a word", async () => {
    await card("E3").dblclick();
    await editor().fill("Trop tard");
    await agent("rm E3", BOARD);
    await card("E3").waitFor({ state: "detached" });
    await editor().waitFor({ state: "hidden" });
    await page.locator(".toast", { hasText: "Trop tard" }).waitFor();
  });
});

describe("a save the companion does not answer", () => {
  const BOARD = "envoi";
  const editor = () => page.locator(".card-editor");

  test("the page says it is saving, and a failed save gives the words back to the editor", async () => {
    await agent(`board new "Envoi" --id ${BOARD}\nadd event "Avant" --col 1`);
    await page.locator(".board-picker select").selectOption(BOARD);
    await card("E1").getByText("Avant").waitFor();
    const held: import("playwright-core").Route[] = [];
    await page.route("**/api/commands", (route) => void held.push(route));
    await card("E1").dblclick();
    await editor().fill("Après");
    await editor().press("Enter");
    // Held: the words stay on screen, not editable, and the page says it is saving.
    await status().filter({ hasText: "Saving…" }).waitFor();
    expect(await editor().isVisible()).toBe(true);
    expect(await editor().getAttribute("aria-busy")).toBe("true");
    expect(await editor().inputValue()).toBe("Après");
    await until("the post left", async () => held.length === 1);
    await held[0]?.abort("connectionrefused");
    // Failed: the words come back to the editor, editable, and the page says why.
    await page.locator(".toast", { hasText: "nothing was saved" }).waitFor();
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
      async () => (await elementOf(BOARD, "E1"))?.label === "Après",
    );
    await editor().waitFor({ state: "hidden" });
    await agent(`board rm ${BOARD}`);
  });
});

describe("many tabs open on the companion", () => {
  const BOARD = "onglets";

  // A browser keeps six connections per host. With one event stream per tab,
  // the sixth tab's writes queued behind the streams and never left.
  test("the seventh tab still writes at once, and every tab hears it", async () => {
    await agent(`board new "Onglets" --id ${BOARD}\nadd event "Ouverte partout" --col 1`);
    const context = await browser.newContext();
    const tabs: Page[] = [];
    for (let i = 0; i < 7; i++) {
      const tab = await context.newPage();
      tab.setDefaultTimeout(4000);
      await tab.goto(`${running.url}/#/b/${BOARD}`);
      await tab.locator('g.card[data-id="E1"]').waitFor();
      tabs.push(tab);
    }
    const last = tabs.at(-1) as Page;
    const answered = await last.evaluate(async () => {
      const started = performance.now();
      const response = await fetch("/api/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          actor: "human",
          commands: [{ kind: "rename", board: "", id: "E1", label: "" }],
        }),
        signal: AbortSignal.timeout(3000),
      }).catch(() => null);
      return { status: response?.status ?? "stalled", ms: performance.now() - started };
    });
    // Refused for its empty label, but answered: the request reached the companion.
    expect(answered.status).toBe(400);
    expect(answered.ms).toBeLessThan(1000);
    await agent('add event "Vue partout" --col 2', BOARD);
    for (const tab of tabs) await tab.locator('g.card[data-id="E2"]').waitFor();
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
  const heading = async (name: string) => {
    const box = await page
      .locator(".layer-heads .lane-label", { hasText: new RegExp(`^${name}$`) })
      .boundingBox();
    if (!box) throw new Error(`no heading ${name}`);
    return box;
  };

  test("the edge between two headings offers a lane; named, it is added there", async () => {
    await agent(`board new "Colonnes" --format kanban --id ${BOARD}\nadd task "Là" --lane doing`);
    await page.locator(".board-picker select").selectOption(BOARD);
    await card("T1").waitFor();
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
    await card("T1").focus();
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
    expect((await elementOf(BOARD, "T1"))?.lane).toBe("doing");
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
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-id"))).toBe("T1");
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

  test("dropped on the upper half of a card, it lands before it; on its own place, nothing is sent", async () => {
    await agent(
      `board new "Pile" --id ${BOARD}\nadd event "Un" --col 1\nadd event "Deux" --col 1\nadd event "Trois" --col 1`,
    );
    await page.locator(".board-picker select").selectOption(BOARD);
    await card("E3").waitFor();
    const seq = (await workspace()).seq;
    const three = await centre("E3");
    await dragTo("E3", three.x, three.y + 3);
    await Bun.sleep(300);
    expect((await workspace()).seq).toBe(seq);
    const one = await settled("E1");
    await page.mouse.move(three.x, three.y);
    await page.mouse.down();
    await page.mouse.move(one.x + one.width / 2, one.y + 4, { steps: 12 });
    await page.locator(".drop-line").waitFor();
    await shot("43-reorder-in-cell");
    await page.mouse.up();
    await until("E3 is first in its cell", async () => (await stack()) === "E3,E1,E2");
    expect((await elementOf(BOARD, "E3"))?.col).toBe(1);
    // The ear hears where it now sits: its step, its row, its rank in the cell.
    await until("E3 is heard first in its cell", async () =>
      ((await card("E3").getAttribute("aria-label")) ?? "").includes("step 1, row Event, 1 of 3"),
    );
  });

  test("a step dragged by its number takes the number of the step it is dropped on, its cards with it", async () => {
    await agent("insert-col 1", BOARD);
    // The page has the empty step too: three numbers, the spare one included.
    await page.locator(".band-step-label", { hasText: /^3$/ }).waitFor();
    const two = await page.locator(".band-step-label", { hasText: /^2$/ }).boundingBox();
    const one = await page.locator(".band-step-label", { hasText: /^1$/ }).boundingBox();
    if (!one || !two) throw new Error("no step numbers");
    await page.mouse.move(two.x + two.width / 2, two.y + two.height / 2);
    await page.mouse.down();
    await page.mouse.move(one.x + one.width / 2, one.y + one.height / 2, { steps: 12 });
    await page.locator(".drop-hint.is-lane-drop").waitFor();
    await shot("46-move-step");
    await page.mouse.up();
    await until("the cards are in step 1", async () => (await elementOf(BOARD, "E1"))?.col === 1);
    expect((await elementOf(BOARD, "E2"))?.col).toBe(1);
    await agent(`board rm ${BOARD}`);
    await until("the page has left the board removed", async () => {
      return (await page.locator(".board-picker select").inputValue()) !== BOARD;
    });
  });
});

describe("a story map's step taken by its heading", () => {
  test('anywhere along the heading but its edges, with no "+" in the way', async () => {
    await agent(
      'board new "Poignée" --format story-map --id poignee\nadd activity "Chercher" --col 1\nadd activity "Payer" --col 2\nadd story "Par titre" --col 1',
    );
    await page.locator(".board-picker select").selectOption("poignee");
    await card("S1").waitFor();
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
    await until("Payer is in step 1", async () => (await elementOf("poignee", "A2"))?.col === 1);
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
    await card("S14").waitFor();
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
    await agent(
      `board new "Lots" --format story-map --id lots\nadd activity "Acheter" --col 1\nadd task "Chercher" --col 1\nadd story "Recherche simple" --col 1\nslice add "Lot 1"\nslice add "Plus tard"`,
    );
    await page.locator(".board-picker select").selectOption("lots");
    await card("S1").waitFor();
    const name = page.locator(".heads-rows .slice-label", { hasText: "Lot 1" });
    await name.waitFor();
    await page.locator(".heads-rows .slice-label", { hasText: "Plus tard" }).waitFor();
    const story = await card("S1").boundingBox();
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
    await agent(
      'board new "Branches" --format flow --id branches\nadd decision "En stock ?"\nadd step "Expédier" --from D1 --edge oui\nadd step "Commander" --from D1',
    );
    await page.locator(".board-picker select").selectOption("branches");
    await conn("D1", "S2").waitFor();

    // A click on the link opens its toolbar; Name opens the editor on its name.
    await named("D1", "S1").click();
    await page.locator(".card-tools button", { hasText: "Name" }).click();
    expect(await page.locator("textarea.card-editor").inputValue()).toBe("oui");
    await typeInEditor("en stock");
    await until("the branch is renamed", async () => (await named("D1", "S1").textContent()) === "en stock");

    // A double click on a link without a name names it.
    const middle = await conn("D1", "S2")
      .locator("path")
      .first()
      .evaluate((path: SVGPathElement) => {
        const at = path.getPointAtLength(path.getTotalLength() - 12);
        const point = new DOMPoint(at.x, at.y).matrixTransform(path.getScreenCTM() ?? undefined);
        return { x: point.x, y: point.y };
      });
    await page.mouse.dblclick(middle.x, middle.y);
    await typeInEditor("en rupture");
    await named("D1", "S2").waitFor();
    expect(await named("D1", "S2").textContent()).toBe("en rupture");
    await shot("51-flow-branches-named");

    // Emptied, the name comes off the link.
    await named("D1", "S1").dblclick();
    await typeInEditor("");
    await named("D1", "S1").waitFor({ state: "detached" });

    await agent("board rm branches");
    await until("the page has left the board removed", async () => {
      return (await page.locator(".board-picker select").inputValue()) !== "branches";
    });
  });
});

describe("a long flow in a wide window", () => {
  test("folds into columns side by side, and fits the window without scrolling", async () => {
    const steps = Array.from({ length: 14 }, (_, i) => `add step "Étape ${i + 2}" --from S${i + 1}`);
    await agent(['board new "Chaîne" --format flow --id chaine', 'add step "Étape 1"', ...steps].join("\n"));
    await page.locator(".board-picker select").selectOption("chaine");
    await card("S15").waitFor();
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
    await agent(`board new "Tenu" --format kanban --id ${MINE}\nadd task "Ici"`);
    const context = await browser.newContext();
    const tab = await context.newPage();
    tab.setDefaultTimeout(4000);
    await tab.goto(running.url);
    // The board shown is named in the address: it is that tab's own, not whichever came last.
    await tab.waitForFunction((id) => location.hash === `#/b/${id}`, MINE);
    await tab.locator('g.card[data-id="T1"]').focus();
    await tab.keyboard.press("Shift+ArrowRight");
    await until("T1 moved", async () => (await elementOf(MINE, "T1"))?.lane === "doing");
    await agent(`board new "Autre session" --format kanban --id ${OTHER}`);
    await tab.locator(".toast", { hasText: "Autre session" }).waitFor();
    expect(await tab.evaluate(() => location.hash)).toBe(`#/b/${MINE}`);
    await tab.keyboard.press("Control+z");
    await until("T1 is back", async () => (await elementOf(MINE, "T1"))?.lane === "todo");
    await agent(`board rm ${OTHER}\nboard rm ${MINE}`);
    await context.close();
  });
});

describe("tidying up", () => {
  const listed = (): Promise<string[]> =>
    page
      .locator(".board-picker option")
      .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));

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

  test("a board Claude removes leaves the picker; the page moves to one that exists and says so", async () => {
    await agent('board new "Brouillon" --format retro --id brouillon\nadd point "À jeter" --lane keep');
    await page.locator(".board-picker select").selectOption("brouillon");
    await card("P1").waitFor();

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
    await agent('board new "À jeter" --format kanban --id a-jeter\nadd task "Rien" --lane todo');
    await page.locator(".board-picker select").selectOption("a-jeter");
    await card("T1").waitFor();

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
    await agent('board new "Flux Sideco" --id flux-sideco\nadd event "Session démarrée" --col 1');

    for (let attempt = 0; attempt < 200 && (await listed()).join() !== "flux-sideco"; attempt++)
      await Bun.sleep(50);
    expect(await listed()).toEqual(["flux-sideco"]);
    await card("E1").waitFor();
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
    await agent('add event "Session reprise" --col 2', "flux-sideco");
    await card("E2").waitFor();
    expect(await marked()).toBe(true);
    forgiveTheCut(before);
  });

  test("a companion restarted with another page: the open tab reloads itself, once", async () => {
    const before = problems.length;
    await mark();
    const reloaded = page.waitForEvent("load", { timeout: 15_000 });
    // The language a page opens in is part of it: started in French, the companion serves another build.
    await restart("fr");
    await reloaded;
    await card("E2").waitFor();
    expect(await marked()).toBe(false);

    // The page it got is the page served: it stays.
    await mark();
    await agent('add event "Session rechargée" --col 3', "flux-sideco");
    await card("E3").waitFor();
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
    await card("E3").waitFor();
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
    await card("E3").waitFor();
  });

  test("the last board removed brings back the first screen", async () => {
    await agent("board rm flux-sideco");
    await page.locator(".empty h1").waitFor();
    expect(await listed()).toEqual([]);
    expect(page.url()).not.toContain("#/b/");
    await agent(
      'board new "Passage de commande" --id commande\nadd actor "Client" --col 1\nadd event "Commande passée" --col 1',
    );
    await card("E1").waitFor();
  });
});

describe("side panels folded away", () => {
  const width = async (selector: string): Promise<number> =>
    Math.round((await page.locator(selector).boundingBox())?.width ?? 0);
  const folded = (side: "left" | "right") =>
    page.locator(".work").evaluate((w, s) => w.classList.contains(`fold-${s}`), side);

  test("each folds into a rail, by its button or a key, and stays so after a reload", async () => {
    await page.locator(".board-picker select").selectOption("commande");
    await card("E1").waitFor();
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
    await card("E1").waitFor();
    expect([await folded("left"), await folded("right")]).toEqual([true, true]);
    await page.keyboard.press("[");
    await page.keyboard.press("]");
    await until(
      "both panels are open again",
      async () => !(await folded("left")) && !(await folded("right")),
    );
    await until("the left panel is whole again", async () => (await width(".left")) > 200);
  });
});

describe("the card toolbar", () => {
  test("stands above its card, or under it when the card above would be hidden", async () => {
    const picker = page.locator(".board-picker select");
    const before = await picker.inputValue();
    await agent(
      'board new "Barre" --id barre\nadd aggregate "Stock" --col 1\nadd event "Stock réservé" --col 1',
    );
    await page.locator('.board-picker option[value="barre"]').waitFor({ state: "attached" });
    await picker.selectOption("barre");
    await card("E1").waitFor();
    const tools = page.locator(".card-tools");
    const box = async (locator: ReturnType<typeof page.locator>) => {
      const b = await locator.boundingBox();
      if (!b) throw new Error("not on screen");
      return b;
    };
    // The event has the aggregate right above it: the toolbar goes under.
    await card("E1").click();
    await tools.waitFor();
    expect((await box(tools)).y).toBeGreaterThanOrEqual(
      (await box(card("E1"))).y + (await box(card("E1"))).height,
    );
    await page.keyboard.press("Escape");
    // Nothing above the aggregate but its row's band: the toolbar stays above.
    await card("A1").click();
    await tools.waitFor();
    const over = await box(tools);
    expect(over.y + over.height).toBeLessThanOrEqual((await box(card("A1"))).y);
    await page.keyboard.press("Escape");

    // A card between two others in a lane: the toolbar goes beside it, over neither.
    await agent(
      'board new "Pile" --format kanban --id pile\nadd task "Un" --lane todo\nadd task "Deux" --lane todo\nadd task "Trois" --lane todo',
    );
    await page.locator('.board-picker option[value="pile"]').waitFor({ state: "attached" });
    await picker.selectOption("pile");
    await card("T3").waitFor();
    await card("T2").click();
    await tools.waitFor();
    const bar = await box(tools);
    for (const other of ["T1", "T3"]) {
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
});

describe("what Claude changed while the reader was away", () => {
  // A page of its own: its storage starts empty, and it has heard the whole journal.
  let shared: Page;
  beforeAll(async () => {
    shared = page;
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(4000);
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

  test("back on a board, the page says what Claude changed there meanwhile, and marks it", async () => {
    await agent(
      'board new "Visite" --id visite\nadd event "Commande passée" --col 1\nadd event "Stock réservé" --col 2',
    );
    await agent('board new "Ailleurs" --id ailleurs\nadd event "Autre chose" --col 1');
    await show("visite", "Visite");
    expect(await bar().isHidden()).toBe(true);
    await show("ailleurs", "Ailleurs");
    // While the reader looks elsewhere, Claude works on the first board.
    await agent('rename E1 "Commande validée"\nadd event "Paiement accepté" --col 3', "visite");
    // The page has heard it all: the board on screen keeps its last look at the newest event.
    const seq = (await workspace()).seq;
    await until("the page has heard Claude's changes", async () => {
      const seen = await page.evaluate(() => localStorage.getItem("sideco.seen") ?? "{}");
      return (JSON.parse(seen) as Record<string, number>).ailleurs === seq;
    });
    await show("visite", "Visite");
    await card("E3").waitFor();
    await bar().waitFor({ state: "visible" });
    expect(await bar().textContent()).toContain("Since your last visit, Claude made 2 changes here.");
    const marked = await page
      .locator("g.card.is-new")
      .evaluateAll((gs) => gs.map((g) => g.getAttribute("data-id")));
    expect(marked.sort()).toEqual(["E1", "E3"]);
    expect(await card("E1").getAttribute("aria-label")).toContain("Changed by Claude since your last visit");
    expect(await page.locator("g.card.is-new", { has: page.locator("text") }).count()).toBe(2);
    // A sign of its own, in a corner: not the dashed ring a note or a link points with.
    const sign = card("E1").locator(".card-changed");
    expect(await sign.count()).toBe(1);
    expect(await sign.locator("title").textContent()).toBe("Changed by Claude since your last visit");
    expect(
      await card("E1")
        .locator(".card-shape")
        .evaluate((shape) => getComputedStyle(shape).strokeDasharray),
    ).toBe("none");
    // The bar goes from one changed card to the next, round to the first.
    const next = bar().getByRole("button", { name: "Next changed card (2)" });
    const focused = () => page.evaluate(() => document.activeElement?.getAttribute("data-id") ?? null);
    await next.click();
    await until("on the first changed card", async () => (await focused()) === "E1");
    await next.click();
    await until("on the second", async () => (await focused()) === "E3");
    await next.click();
    await until("round to the first", async () => (await focused()) === "E1");
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
    await card("E3").waitFor();
    expect(await bar().isHidden()).toBe(true);
  });

  test("what Claude does while the board is on screen is seen arriving, not reported as missed", async () => {
    await agent('add event "Facture envoyée" --col 4', "visite");
    await card("E4").waitFor();
    expect(await bar().isHidden()).toBe(true);
    expect(await page.locator("g.card.is-new").count()).toBe(0);
    await page.reload();
    await card("E4").waitFor();
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

  test("a second session gives a choice, by name, and the one chosen is the one the page tells about", async () => {
    await runHook(
      { session_id: OTHER, cwd: root, hook_event_name: "SessionStart", source: "startup" },
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
    await until("the chosen session's turns", async () => (await prompts()) === 0);
    // Chosen once, kept: a reload shows the same session.
    await page.reload();
    await picker().waitFor();
    expect(await picker().inputValue()).toBe(OTHER);
    expect(await prompts()).toBe(0);

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
    await agent('board new "Sous-titres" --format kanban --id colonnes-t118\nadd task "Là" --lane doing');
    await page.locator(".board-picker select").selectOption("colonnes-t118");
    await card("T1").waitFor();
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

  test("an axis takes a new name and new words at its ends; emptied, each gives the workshop's back", async () => {
    await agent('board new "Axes" --format impact-effort --id axes-t118\nadd item "Un" --lane quick');
    await page.locator(".board-picker select").selectOption("axes-t118");
    await card("I1").waitFor();
    const label = page.locator('.band-axis .axis-label[data-axis="y"]');
    await label.dblclick();
    expect(await editor().inputValue()).toBe("Impact");
    await typeInEditor("Valeur");
    await until("the axis renamed", async () => (await label.textContent()) === "Valeur →");
    expect((await boardOf("axes-t118"))?.axes?.y?.label).toBe("Valeur");

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
