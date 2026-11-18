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
import type { Locale } from "../../src/domain/i18n.ts";
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
      "Impact / Effort",
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

  test("handing over while Claude is not listening says what will make it read", async () => {
    await page.locator(".pass input").fill("Un mot pour plus tard");
    await page.locator(".pass input").press("Enter");
    await page.locator(".toast", { hasText: "Handed over." }).waitFor();
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
    expect(await page.locator(".history-label").textContent()).toStartWith("Live · ");

    // The slider counts the board's own events: its creation, then one per card.
    await page.locator(".history input").fill("3");
    await page.locator(".banner").waitFor({ state: "visible" });
    expect(await page.locator("g.card").count()).toBe(3);
    expect(await page.locator(".history-label").textContent()).toMatch(/^4 \/ \d+ · .*Claude adds E1/);
    expect(await paletteType("Event").isDisabled()).toBe(true);
    expect(await page.locator(".board-picker button.remove-board").isDisabled()).toBe(true);
    await shot("06-history");

    await page.locator(".history button", { hasText: "►" }).click();
    await page.waitForFunction(() =>
      document.querySelector(".history-label")?.textContent?.startsWith("5 / "),
    );

    await page.locator(".banner button").click();
    await page.locator(".banner").waitFor({ state: "hidden" });
    expect(await page.locator("g.card").count()).toBe(live);
  });

  test("the arrows and the slider stop at the events of the board on screen, or at every event when asked", async () => {
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
    expect(await page.title()).toBe("Devis · Vico");
    await page.locator(".banner button").click();
    await reads(/^Live · 3 events$/);
    await page.locator(".history input").press("ArrowLeft");
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

    const doing = await centre("B1");
    await dragTo("T1", doing.x, doing.y + 120);
    await until("T1 is in progress", async () => (await elementOf("sprint", "T1"))?.lane === "doing");
    expect(await pending()).toContain("→ T1 moved lane todo → doing");
    await settled("T1");
    await shot("07-kanban");
  });

  test("kanban: a task is marked done from its toolbar or the keyboard, and the card shows a tick", async () => {
    const tick = (id: string) => card(id).locator(".card-done");
    await card("T2").click();
    await page.locator(".card-tools button", { hasText: "Mark done" }).click();
    await tick("T2").waitFor();
    expect((await elementOf("sprint", "T2"))?.done).toBe(true);
    expect(await pending()).toContain("~ T2 marked done");
    await page.locator(".card-tools button", { hasText: "Not done" }).waitFor();
    await shot("21-done");

    await card("T2").focus();
    await page.keyboard.press("d");
    await tick("T2").waitFor({ state: "detached" });
    expect((await elementOf("sprint", "T2"))?.done).toBeUndefined();
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
  });

  test("a new board from the page: pick a workshop, name it, start", async () => {
    await page.locator(".board-picker button", { hasText: "+ Board" }).click();
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
    expect(await page.locator(".history select option").allTextContents()).toEqual(["Ce tableau", "Tout"]);
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
    await page.locator(".board-picker button.remove-board").click();
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
    await thread("N1").waitFor();
    expect(await page.locator(".notes h2").textContent()).toBe("Open notes (2)");
    expect(await thread("N1").locator(".thread-on").textContent()).toBe("E2 · Stock réservé");
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
    await card("E2").click();
    await until("the card's discussion is marked", async () =>
      (await classes(thread("N1"))).includes("is-current"),
    );
    expect(await classes(thread("N2"))).not.toContain("is-current");
    await shot("15-threads");

    await page.keyboard.press("Escape");
    await until("nothing is selected", async () => !(await classes(card("E2"))).includes("is-selected"));
    await thread("N1").hover();
    await until("the card is pointed at", async () => (await classes(card("E2"))).includes("is-pointed"));
    await thread("N1").locator(".thread-on").click();
    await until("the card is selected", async () => (await classes(card("E2"))).includes("is-selected"));
    await page.keyboard.press("Escape");
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

    const reply = page.locator(`.notes .thread[data-thread="N1"] .thread-reply [name^=reply-]`);
    await reply.fill("La compta");
    await reply.press("Enter");
    await threadMark("N1").waitFor();
    expect(await threadMark("N1").textContent()).toBe(WORDS);
    await shot("18-unread");

    // The marks tell about now: a board shown as it was carries none.
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
    expect(await card("E1").getAttribute("aria-label")).toBeNull();
  });
});

describe("adding where the pointer is", () => {
  const offer = (type: string) => page.locator(`.vico-board .add-here[data-type="${type}"]`);
  const offers = () => page.locator(".vico-board .add-here");

  test("retro: a column offers one + per kind of card, and the card lands in that column", async () => {
    await agent(
      `board new "Rétro du sprint" --format retro --id ajout\nadd point "Les tests d'abord" --lane keep`,
    );
    await page.locator(".board-picker select").selectOption("ajout");
    await card("K1").getByText("Les tests").waitFor();
    // Nothing is offered while the pointer is elsewhere.
    await page.mouse.move(700, 20);
    expect(await offers().count()).toBe(0);

    const lane = await page.locator(".band-lane .lane-label", { hasText: "Try" }).boundingBox();
    if (!lane) throw new Error("no Try lane");
    await page.mouse.move(lane.x + 60, lane.y + 150);
    await offer("action").waitFor();
    expect(await offers().count()).toBe(2);
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
    expect(await page.locator(".palette .how").textContent()).toContain("+");
  });

  test("timeline: a cell offers the kind of its row, and the card lands in that step", async () => {
    await agent(
      `board new "Ajout en case" --id ajout-case\nadd event "Commande passée" --col 1\nadd event "Stock réservé" --col 2`,
    );
    await page.locator(".board-picker select").selectOption("ajout-case");
    await card("E2").getByText("Stock réservé").waitFor();
    const row = await page.locator(".band-row", { hasText: "Policy" }).locator("text").boundingBox();
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
    const column = page.locator('.vico-board .add-here[data-column="2"]');
    await column.waitFor();
    expect(await offers().count()).toBe(1);
    expect(await column.getAttribute("aria-label")).toBe("Insert a column here");
    await Bun.sleep(200);
    await shot("20-insert-column");

    await column.click();
    await until("step 2 moved to 3", async () => (await elementOf("ajout-case", "E2"))?.col === 3);
    expect((await elementOf("ajout-case", "P1"))?.col).toBe(3);
    expect((await elementOf("ajout-case", "E1"))?.col).toBe(1);
    // Back to where the next tests expect the cards.
    await agent("move E2 --col 2\nmove P1 --col 2", "ajout-case");
    await until("step 2 is back", async () => (await elementOf("ajout-case", "E2"))?.col === 2);
  });

  test("the offer leaves with the pointer, and is not made on a board shown as it was", async () => {
    const e2 = await centre("E2");
    await page.mouse.move(e2.x, e2.y);
    await offer("event").waitFor();
    await page.mouse.move(700, 20);
    await until("the offer is gone", async () => (await offers().count()) === 0);

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
    const editor = page.locator("textarea.card-editor");

    await card("E1").click();
    await page.locator(".card-tools button", { hasText: "Detail" }).click();
    await editor.waitFor({ state: "visible" });
    await editor.press("Enter");
    await editor.waitFor({ state: "hidden" });

    await card("E1").dblclick();
    await editor.waitFor({ state: "visible" });
    await editor.press("Enter");
    await editor.waitFor({ state: "hidden" });

    await Bun.sleep(200);
    expect((await workspace()).seq).toBe(before);
    expect((await elementOf("ajout-case", "E1"))?.detail).toBe(detail);
  });
});

describe("tidying up", () => {
  const listed = (): Promise<string[]> =>
    page
      .locator(".board-picker option")
      .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));

  /** Stops the companion and starts it again on the same port, as an update of Vico does. */
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

  test("the human removes a board from the page, after being asked once", async () => {
    await agent('board new "À jeter" --format kanban --id a-jeter\nadd task "Rien" --lane todo');
    await page.locator(".board-picker select").selectOption("a-jeter");
    await card("T1").waitFor();

    const remove = page.locator(".board-picker button.remove-board");
    const sheet = page.locator("dialog.remove-board");
    expect(await remove.getAttribute("title")).toBe("Remove the board “À jeter”");
    await remove.click();
    expect(await sheet.locator("h2").textContent()).toBe("Remove the board “À jeter”?");
    expect(await sheet.locator("p").textContent()).toStartWith("It holds 1 element. ");
    await shot("12-remove-board");
    // The safe answer has the focus: Enter keeps the board.
    await page.keyboard.press("Enter");
    await sheet.waitFor({ state: "hidden" });
    expect(await listed()).toContain("a-jeter");

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
    forgiveTheCut(before);
  });

  test("a companion restarted with the same page leaves the open tab as it is", async () => {
    const before = problems.length;
    await mark();
    await restart();
    // Once the tab follows the new run, its presence frame is sent: a card added then comes after it.
    for (let attempt = 0; attempt < 200 && running.hub.watching === 0; attempt++) await Bun.sleep(50);
    await agent('add event "Session reprise" --col 2', "flux-vico");
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
    await agent('add event "Session rechargée" --col 3', "flux-vico");
    await card("E3").waitFor();
    expect(await marked()).toBe(true);
    forgiveTheCut(before);
  });

  test("a reply typed and not sent keeps the tab from reloading: it offers to, and the reply stays", async () => {
    const before = problems.length;
    await agent('note "Et ensuite ?"', "flux-vico");
    const reply = page.locator(".notes .thread-reply [name^=reply-]");
    await reply.fill("Je cherche encore");
    await mark();
    // Back to the page that opens in English: another build again.
    await restart("en");

    const toast = page.locator(".toast", { hasText: "Vico was updated." });
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
    await reply.fill("Trouvé");
    await mark();
    await restart("fr");
    await page.locator(".toast", { hasText: "Vico was updated." }).waitFor({ timeout: 15_000 });
    expect(await marked()).toBe(true);

    // The offer may be gone by then: the tab must not stay the old page for that.
    const reloaded = page.waitForEvent("load", { timeout: 5_000 });
    await reply.press("Enter");
    await reloaded;
    await page.locator(".notes", { hasText: "Trouvé" }).waitFor();
    expect(await marked()).toBe(false);
    forgiveTheCut(before);
  });

  test("a reload that does not bring the page served is not tried twice: the tab offers instead", async () => {
    // A copy of another build answers in place of the companion, as a cache in the way would.
    const stale = (await (await fetch(running.url)).text()).replace(
      /(name="vico-build" content=")[^"]+/,
      "$1stale",
    );
    const thePage = (url: URL): boolean => url.pathname === "/";
    await page.route(thePage, (route) => route.fulfill({ contentType: "text/html", body: stale }));
    let loads = 0;
    const count = (): void => void loads++;
    page.on("load", count);
    await page.reload();
    const toast = page.locator(".toast", { hasText: "Vico was updated." });
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
