/**
 * The README's moving picture: one turn of the loop, the terminal beside the
 * board. The board is the real page, driven by the real commands and hooks; the
 * terminal is drawn here, from what the session sends and what the hook answers.
 *
 *   bun scripts/loop.ts [OUT_DIR]   (default docs/img; needs Chrome, ffmpeg and a local port)
 */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type FrameLocator, type Locator, type Page } from "playwright-core";
import { parseBatch } from "../src/cli/argv.ts";
import { initRoot } from "../src/cli/client.ts";
import { runHook } from "../src/cli/hook.ts";
import { start } from "../src/server/start.ts";

const OUT = process.argv[2] ?? "docs/img";
const SESSION = "loop";
const SCHEMES = ["light", "dark"] as const;
type Scheme = (typeof SCHEMES)[number];
const STAGE = { width: 1280, height: 720 };
const TERMINAL = 440;
const PROMPT = "Model a declined payment on the Sideco board";
const QUESTION = "What do we offer when the bank says no?";

const STAGE_HTML = (url: string) => `<!doctype html><style>
  body { margin: 0; width: ${STAGE.width}px; height: ${STAGE.height}px; overflow: hidden; display: flex; background: #0d1117; }
  #terminal { width: ${TERMINAL}px; box-sizing: border-box; padding: 16px 18px; color: #d1d7e0; background: #0d1117;
    font: 14px/1.55 ui-monospace, "SF Mono", Menlo, monospace; white-space: pre-wrap; overflow: hidden; }
  #terminal .bar { color: #7d8590; margin-bottom: 12px; }
  #terminal .you { color: #fff; }
  #terminal .you::before { content: "> "; color: #7d8590; }
  #terminal .run::before { content: "⏺ "; color: #3fb950; }
  #terminal .back { color: #7d8590; padding-left: 18px; }
  #terminal .wait { color: #d29922; }
  iframe { flex: 1; border: 0; border-left: 1px solid #30363d; }
  #pointer { position: fixed; left: 900px; top: 420px; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%;
    background: rgba(26, 111, 174, 0.35); border: 2px solid #1a6fae; transition: left 0.6s ease-out, top 0.6s ease-out;
    pointer-events: none; }
</style>
<div id="terminal"><div class="bar">claude · ~/shop</div></div>
<iframe src="${url}/#/b/payment"></iframe><div id="pointer"></div>`;

const pause = (ms: number) => Bun.sleep(ms);

/** A line of the drawn terminal; a prompt is typed letter by letter. */
async function line(page: Page, kind: "you" | "run" | "back" | "wait", text: string): Promise<void> {
  await page.evaluate(
    async ([kind, text]) => {
      const row = document.createElement("div");
      row.className = kind as string;
      document.getElementById("terminal")?.append(row);
      if (kind !== "you") {
        row.textContent = text as string;
        return;
      }
      for (const letter of text as string) {
        row.textContent += letter;
        await new Promise((done) => setTimeout(done, 22));
      }
    },
    [kind, text],
  );
}

/** Brings the drawn pointer over an element of the board, so the eye sees who acts. */
async function point(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error("nothing to point at");
  await page.evaluate(
    ([x, y]) => {
      const pointer = document.getElementById("pointer") as HTMLElement;
      pointer.style.left = `${x}px`;
      pointer.style.top = `${y}px`;
    },
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  await pause(750);
}

async function film(scheme: Scheme): Promise<void> {
  const root = initRoot(realpathSync(mkdtempSync(join(tmpdir(), "sideco-loop-"))));
  const running = await start(root, 0);
  const post = async (script: string, board?: string) => {
    const response = await fetch(`${running.url}/api/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor: "agent", session: SESSION, commands: parseBatch(script, board) }),
    });
    if (!response.ok) throw new Error(`batch refused: ${await response.text()}`);
  };
  const hook = (payload: Record<string, unknown>, rewake = false) =>
    runHook({ session_id: SESSION, cwd: root, ...payload }, {}, rewake);

  await hook({ hook_event_name: "SessionStart", source: "startup" });
  await post(`board new "Payment declined" --format flow --id payment`);

  const frames = mkdtempSync(join(tmpdir(), "sideco-loop-frames-"));
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: STAGE, colorScheme: scheme });
  const page = await context.newPage();
  await page.setContent(STAGE_HTML(running.url));
  const board: FrameLocator = page.frameLocator("iframe");
  await board.locator("svg.sideco-board").first().waitFor();
  await pause(600);
  // The film is a photo every tenth of a second, each kept with the time it stayed on screen.
  const shots: { file: string; at: number }[] = [];
  let rolling = true;
  const camera = (async () => {
    while (rolling) {
      const at = Date.now();
      const file = join(frames, `${String(shots.length).padStart(4, "0")}.png`);
      writeFileSync(file, await page.screenshot());
      shots.push({ file, at });
      await pause(Math.max(0, 100 - (Date.now() - at)));
    }
  })();

  // Claude's turn: the prompt, two batches, the question, then it parks.
  await line(page, "you", PROMPT);
  await hook({ hook_event_name: "UserPromptSubmit", prompt: PROMPT });
  await pause(500);
  await line(page, "run", "sideco apply   3 cards");
  await post(
    `add step "Customer pays" --alias pays
add decision "Bank agrees?" --from @pays --alias bank
add outcome "Order confirmed" --from @bank --edge "yes"`,
    "payment",
  );
  await pause(1300);
  await line(page, "run", "sideco apply   1 card");
  await post(`add step "Offer another method" --from D1 --edge "no"`, "payment");
  await pause(1100);
  await line(page, "run", `sideco pass "${QUESTION}"`);
  await post(`pass "${QUESTION}"`, "payment");
  await hook({ hook_event_name: "Stop" });
  // The parked hook gives up at once while the companion has not seen the page: sent again until it stays.
  const waiting = board.locator(".status-text", { hasText: "waiting" });
  let parked = hook({ hook_event_name: "Stop" }, true);
  for (let attempt = 0; !(await waiting.isVisible()); attempt++) {
    if (attempt === 20) throw new Error("Claude never parked: the page does not say it waits");
    await waiting.waitFor({ timeout: 1000 }).catch(() => undefined);
    if (!(await waiting.isVisible())) parked = hook({ hook_event_name: "Stop" }, true);
  }
  await line(page, "wait", "waiting for you on the board…");
  await pause(700);

  // Your turn, in the page: rename a card, then hand the turn back.
  const card = board.locator("g.card", { hasText: "Offer another method" });
  await point(page, card);
  await card.dblclick();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Offer a bank transfer", { delay: 45 });
  await pause(300);
  await page.keyboard.press("Enter");
  await pause(500);
  await page.keyboard.press("Escape"); // leaves the card: its detail folds away and the board takes its room back
  await pause(500);
  const send = board.locator("button.primary", { hasText: "Send to Claude" });
  await point(page, send);
  await send.click();

  // What the hook hands to Claude is what the terminal shows.
  const woke = await parked;
  const said = `${woke.stdout ?? ""}\n${woke.stderr ?? ""}`
    .split("\n")
    .map((row) => row.trim())
    .filter((row) => row.includes("renamed"));
  if (said.length === 0) throw new Error(`the hook said nothing of the rename: ${JSON.stringify(woke)}`);
  const command = `sideco add outcome "Paid by transfer" --from S2`;
  await hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });
  await line(page, "back", said[0] ?? "");
  await pause(1100);
  await line(page, "run", command);
  await post(command.replace("sideco ", ""), "payment");
  await pause(2400);
  rolling = false;
  await camera;
  const end = Date.now();

  await context.close();
  await browser.close();
  running.stop();

  mkdirSync(OUT, { recursive: true });
  const list = join(frames, "frames.txt");
  const rows = shots.map((shot, n) => `file '${shot.file}'\nduration ${(((shots[n + 1]?.at ?? end) - shot.at) / 1000).toFixed(3)}`);
  writeFileSync(list, `${rows.join("\n")}\nfile '${shots.at(-1)?.file}'\n`);
  const length = (end - (shots[0]?.at ?? end)) / 1000;
  const gif = join(OUT, `sideco-loop${scheme === "dark" ? "-dark" : ""}.gif`);
  const filter =
    "fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle";
  const made = Bun.spawnSync(
    ["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", filter, gif],
    { stderr: "inherit" },
  );
  if (made.exitCode !== 0) throw new Error("ffmpeg could not make the picture");
  console.log(`${gif}  ${(Bun.file(gif).size / 1e6).toFixed(2)} MB  ${length.toFixed(1)} s`);
}

for (const scheme of SCHEMES) await film(scheme);
process.exit(0);
