/**
 * The README's moving picture: one turn of the loop on an event storming, then a
 * second prompt typed in the terminal that opens a kanban, the terminal beside the
 * board. The board is the real page, driven by the real commands and hooks; the
 * terminal is drawn here, from what the session sends and what the hook answers.
 *
 * It also makes the repository's social preview, from the film's own picture.
 *
 *   bun scripts/loop.ts [OUT_DIR]   (default docs/img; needs Chrome, ffmpeg and a local port)
 */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, chromium, type FrameLocator, type Locator, type Page } from "playwright-core";
import { parseBatch } from "../src/cli/argv.ts";
import { initRoot } from "../src/cli/client.ts";
import { runHook } from "../src/cli/hook.ts";
import { start } from "../src/server/start.ts";

const OUT = process.argv[2] ?? "docs/img";
const SESSION = "loop";
const SCHEMES = ["light", "dark"] as const;
type Scheme = (typeof SCHEMES)[number];
const STAGE = { width: 1370, height: 770 };
const TERMINAL = 440;
const PROMPT = "Model how an order is placed, on the Sideco board";
const QUESTION = "Who reserves the stock: us or the warehouse?";
const NEXT_PROMPT = "Now the work to do, as a kanban";

const STAGE_HTML = (url: string) => `<!doctype html><style>
  body { margin: 0; width: ${STAGE.width}px; height: ${STAGE.height}px; overflow: hidden; display: flex; background: #0d1117; }
  #side { width: ${TERMINAL}px; box-sizing: border-box; padding: 16px 18px; display: flex; flex-direction: column; color: #d1d7e0;
    background: #0d1117; font: 14px/1.55 ui-monospace, "SF Mono", Menlo, monospace; white-space: pre-wrap; }
  #terminal { flex: 1; overflow: hidden; }
  #input { border: 1px solid #30363d; border-radius: 6px; padding: 8px 10px; min-height: 22px; color: #fff; }
  #input::before { content: "> "; color: #7d8590; }
  #input::after { content: "▏"; color: #7d8590; }
  #terminal .bar { color: #7d8590; margin-bottom: 12px; }
  #terminal .you { color: #fff; }
  #terminal .you::before { content: "> "; color: #7d8590; }
  #terminal .run::before { content: "⏺ "; color: #3fb950; }
  #terminal .back { color: #7d8590; padding-left: 18px; }
  #terminal .wait { color: #d29922; }
  iframe { flex: 1; border: 0; border-left: 1px solid #30363d; }
  #pointer { position: fixed; left: 900px; top: 420px; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%;
    background: rgba(26, 111, 174, 0.35); border: 2px solid #1a6fae; opacity: 0;
    transition: left 0.6s ease-out, top 0.6s ease-out, opacity 0.2s; pointer-events: none; }
</style>
<div id="side"><div id="terminal"><div class="bar">claude · ~/shop</div></div>
<div id="input"></div></div>
<iframe src="${url}/#/b/ordering"></iframe><div id="pointer"></div>`;

const pause = (ms: number) => Bun.sleep(ms);

/** A line of the drawn terminal; a prompt is typed letter by letter in the prompt field, then sent up. */
async function line(page: Page, kind: "you" | "run" | "back" | "wait", text: string): Promise<void> {
  await page.evaluate(
    async ([kind, text]) => {
      const row = document.createElement("div");
      row.className = kind as string;
      row.textContent = text as string;
      if (kind === "you") {
        const input = document.getElementById("input") as HTMLElement;
        for (const letter of text as string) {
          input.textContent += letter;
          await new Promise((done) => setTimeout(done, 28));
        }
        await new Promise((done) => setTimeout(done, 450));
        input.textContent = "";
      }
      document.getElementById("terminal")?.append(row);
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
      pointer.style.opacity = "1";
      pointer.style.left = `${x}px`;
      pointer.style.top = `${y}px`;
    },
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  await pause(750);
}

/**
 * The repository's social preview, 1280×640: the film's own picture at the moment you are about to send,
 * the name and the tagline under it. The terminal's ground runs on to the left, the page's to the right.
 */
async function socialPreview(context: BrowserContext, first: Buffer, second: Buffer): Promise<void> {
  const page = await context.newPage();
  const data = (shot: Buffer) => `data:image/png;base64,${shot.toString("base64")}`;
  // Both shots are the whole stage, 544 px high here: the first shows the terminal and the first board; the
  // second lies under an oblique cut, slid so that only its board shows.
  const scale = 544 / STAGE.height;
  const cut = { top: 990, bottom: 962, gap: 6, board: 994 };
  await page.setViewportSize({ width: 1280, height: 640 });
  await page.setContent(`<!doctype html><style>
    body { margin: 0; width: 1280px; height: 640px; overflow: hidden; font-family: -apple-system, "Segoe UI", Inter, sans-serif;
      background: #fff; position: relative; }
    img { display: block; height: 544px; }
    .first { position: absolute; left: 0; top: 0; }
    .line, .second { position: absolute; left: 0; top: 0; width: 1280px; height: 544px; }
    .line { background: #1f2328;
      clip-path: polygon(${cut.top - cut.gap}px 0, ${cut.top}px 0, ${cut.bottom}px 100%, ${cut.bottom - cut.gap}px 100%); }
    .second { background: #fff; clip-path: polygon(${cut.top}px 0, 100% 0, 100% 100%, ${cut.bottom}px 100%); }
    .second div { position: absolute; left: ${cut.board}px; top: 0; right: 0; height: 544px; overflow: hidden; }
    .second img { margin-left: ${-Math.round(TERMINAL * scale)}px; }
    .band { position: absolute; left: 0; top: 544px; width: 1280px; height: 96px; background: #1f2328; color: #fff; display: flex;
      align-items: center; gap: 28px; padding: 0 48px; box-sizing: border-box; }
    .band b { font-size: 40px; letter-spacing: -0.5px; }
    .band span { font-size: 23px; line-height: 1.25; opacity: 0.92; }
  </style><img class="first" src="${data(first)}">
  <div class="second"><div><img src="${data(second)}"></div></div><div class="line"></div>
  <div class="band"><b>Sideco</b><span>Turn your coding agent's walls of text into a conversation you can see and reshape.</span></div>`);
  for (const img of await page.locator("img").all()) await img.evaluate((el: HTMLImageElement) => el.decode());
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, "social-preview.png") });
  console.log(join(OUT, "social-preview.png"));
  await page.close();
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
  await post(`board new "Placing an order" --format event-storming --id ordering`);

  const frames = mkdtempSync(join(tmpdir(), "sideco-loop-frames-"));
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: STAGE, colorScheme: scheme });
  const page = await context.newPage();
  await page.setContent(STAGE_HTML(running.url));
  const board: FrameLocator = page.frameLocator("iframe");
  await board.locator("svg.sideco-board").first().waitFor();
  await pause(600);
  // The film opens on a turn under way: the prompt is sent and the first cards are on the board, so its
  // first picture, the one a reader sees before it moves, already shows a terminal and a board at work.
  await line(page, "you", PROMPT);
  await hook({ hook_event_name: "UserPromptSubmit", prompt: PROMPT });
  await pause(500);
  await line(page, "run", "sideco apply   4 cards");
  await post(
    `add actor "Customer" --col 1
add command "Place order" --col 1 --alias place
add event "Order placed" --col 2 --alias placed
add policy "Reserve the stock" --col 3 --alias reserve
link @place @placed
link @placed @reserve`,
    "ordering",
  );
  await pause(1000); // the cards glide to their place
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

  // Claude's turn goes on: two more cards, the question, then it parks.
  await pause(1000);
  await line(page, "run", "sideco apply   2 cards");
  await post(
    `add system "Warehouse" --col 3
add event "Stock reserved" --col 4 --alias reserved
link R1 @reserved`,
    "ordering",
  );
  await pause(1100);
  await line(page, "run", `sideco pass "${QUESTION}"`);
  await post(`pass "${QUESTION}"`, "ordering");
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
  const card = board.locator("g.card", { hasText: "Warehouse" });
  await point(page, card);
  await card.dblclick();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Partner warehouse", { delay: 45 });
  await pause(300);
  await page.keyboard.press("Enter");
  await pause(500);
  await page.keyboard.press("Escape"); // leaves the card: its detail folds away and the board takes its room back
  // Opening the card slid the board aside: you slide it back to see the whole of it.
  await board.locator("body").evaluate((body) => {
    for (const part of body.querySelectorAll("*")) if (part.scrollLeft > 0) part.scrollTo({ left: 0, behavior: "smooth" });
  });
  await pause(600);
  const send = board.locator("button.primary", { hasText: "Send to Claude" });
  await point(page, send);
  const still = await page.screenshot(); // the social preview's picture, composed once the film is over
  await send.click();

  // What the hook hands to Claude is what the terminal shows.
  const woke = await parked;
  const said = `${woke.stdout ?? ""}\n${woke.stderr ?? ""}`
    .split("\n")
    .map((row) => row.trim())
    .filter((row) => row.includes("renamed"));
  if (said.length === 0) throw new Error(`the hook said nothing of the rename: ${JSON.stringify(woke)}`);
  const command = `sideco add hotspot "What if stock runs out?" --col 3`;
  await hook({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });
  await line(page, "back", said[0] ?? "");
  await pause(1000);
  await line(page, "run", command);
  await post(command.replace("sideco ", ""), "ordering");
  await hook({ hook_event_name: "Stop" });
  await pause(1500);

  // The terminal is still yours: a second prompt, typed there, opens another workshop.
  await page.evaluate(() => {
    (document.getElementById("pointer") as HTMLElement).style.opacity = "0";
  });
  await line(page, "you", NEXT_PROMPT);
  await hook({ hook_event_name: "UserPromptSubmit", prompt: NEXT_PROMPT });
  await pause(400);
  await line(page, "run", `sideco board new "Sprint 12" --format kanban`);
  await post(`board new "Sprint 12" --format kanban --id sprint`);
  await line(page, "run", "sideco apply   5 cards");
  await post(
    `add task "Payment page" --lane done
add task "E-mail reminders" --lane doing
add blocker "Warehouse API access" --lane doing
add task "Stock reservation" --lane todo
add task "Out-of-stock notice" --lane todo`,
    "sprint",
  );
  await pause(600);
  // The page stays on the board you are on and says Claude made another: you go to it.
  const boards = board.locator("select").first();
  await point(page, boards);
  await boards.selectOption({ label: "Sprint 12" });
  await board.locator("g.card", { hasText: "Stock reservation" }).waitFor();
  await page.evaluate(() => {
    (document.getElementById("pointer") as HTMLElement).style.opacity = "0";
  });
  await pause(2600);
  rolling = false;
  await camera;
  const end = Date.now();

  if (scheme === "light") await socialPreview(context, still, await page.screenshot());
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
