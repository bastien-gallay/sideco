/**
 * The pictures of the README and of the repository's social preview, taken from
 * the page as it is today: a companion on a throwaway workspace, boards written
 * through the CLI grammar, one photo per board.
 *
 *   bun scripts/screenshots.ts [OUT_DIR]   (default docs/img; needs Chrome and a local port)
 */
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";
import { parseBatch } from "../src/cli/argv.ts";
import { initRoot } from "../src/cli/client.ts";
import { runHook } from "../src/cli/hook.ts";
import { start } from "../src/server/start.ts";

const OUT = process.argv[2] ?? "docs/img";
const SESSION = "readme";

/** One board per workshop, small enough to read on a README. */
const BOARDS: { id: string; script: string; human?: string; tab?: string }[] = [
  {
    id: "ordering",
    script: `board new "Placing an order" --format event-storming --id ordering
add actor "Customer" --col 1
add command "Place order" --col 1 --alias place
add aggregate "Cart" --col 1
add event "Order placed" --col 2 --alias placed
add policy "Reserve the stock" --col 3 --alias reserve
add system "Warehouse" --col 3
add event "Stock reserved" --col 4 --alias reserved
add hotspot "What if stock runs out?" --col 3
link @place @placed
link @placed @reserve
link @reserve @reserved`,
    human: `rename G1 "Partner warehouse"`,
  },
  {
    id: "payment",
    script: `board new "Payment declined" --format flow --id payment
add step "Customer pays" --alias pays
add decision "Bank agrees?" --from @pays --alias bank
add outcome "Order confirmed" --from @bank --edge "yes"
add step "Offer another method" --from @bank --edge "no" --alias other
add outcome "Cart kept for 24 h" --from @other
note "How many attempts before we block the card?" --on @bank
focus @bank --why "The retry rule is not settled"
pass "How many attempts before we block the card?"`,
    human: `reply N1 "Three, then block it for an hour."`,
    tab: "#tab-notes",
  },
  {
    id: "journey",
    script: `board new "Buying journey" --format story-map --id journey
add activity "Find" --col 1
add activity "Buy" --col 3
add task "Search" --col 1
add task "Compare" --col 2
add task "Pay" --col 3
add task "Track" --col 4
add story "Search by name" --col 1
add story "Product page" --col 2
add story "Card payment" --col 3
add story "E-mail tracking" --col 4
slice add "Release 1"`,
  },
  {
    id: "sprint",
    script: `board new "Sprint 12" --format kanban --id sprint
add task "Payment page" --lane done
add task "E-mail reminders" --lane doing
add task "Sales dashboard" --lane doing
add blocker "Bank API access" --lane doing
add task "Accounting export" --lane todo
add task "Loyalty discounts" --lane todo`,
    human: `move T2 --lane done`,
  },
];

const root = initRoot(realpathSync(mkdtempSync(join(tmpdir(), "sideco-shots-"))));
const running = await start(root, 0);

async function post(actor: "agent" | "human", script: string, board?: string): Promise<void> {
  const response = await fetch(`${running.url}/api/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actor, session: SESSION, commands: parseBatch(script, board) }),
  });
  if (!response.ok) throw new Error(`batch refused: ${await response.text()}`);
}

const hook = (payload: Record<string, unknown>) =>
  runHook({ session_id: SESSION, cwd: root, ...payload }, {}, false);

await hook({ hook_event_name: "SessionStart", source: "startup" });
await hook({ hook_event_name: "UserPromptSubmit", prompt: "Model the ordering flow with me" });
for (const board of BOARDS) await post("agent", board.script);
await hook({ hook_event_name: "Stop" });
for (const board of BOARDS) if (board.human) await post("human", board.human, board.id);

const browser = await chromium.launch({ channel: "chrome", headless: true });
mkdirSync(OUT, { recursive: true });

async function photo(page: Page, board: string, name: string, tab?: string): Promise<void> {
  await page.goto(`${running.url}/#/b/${board}`);
  await page.locator("g.card").first().waitFor();
  await page.locator(tab ?? "#tab-session").click();
  await Bun.sleep(800); // the cards glide to their place
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(join(OUT, `${name}.png`));
}

/** One piece of the page, twice as sharp, as a data URL the composed picture can hold. */
async function piece(page: Page, board: string, selector: string): Promise<string> {
  await page.goto(`${running.url}/#/b/${board}`);
  await page.locator("g.card").first().waitFor();
  await page.locator("#tab-notes").click();
  await Bun.sleep(800);
  const png = await page.locator(selector).first().screenshot();
  return `data:image/png;base64,${png.toString("base64")}`;
}

/**
 * The social preview, 1280×640: two workshops cut by an oblique line, the
 * thread where the human answered, and the tagline. Each side is a piece of
 * the real page; only the layout is made here.
 */
async function socialPreview(): Promise<void> {
  const sharp = await browser.newPage({ viewport: { width: 2200, height: 1000 }, deviceScaleFactor: 2 });
  // What Claude just changed keeps its outline: the page fades it in 2.4 s, the photo holds its first instant.
  await sharp.addInitScript(() => {
    addEventListener("DOMContentLoaded", () => {
      const hold = document.createElement("style");
      hold.textContent = ".card.is-fresh .card-shape { animation-play-state: paused !important; }";
      document.head.append(hold);
    });
  });
  await sharp.goto(`${running.url}/#/b/ordering`);
  await sharp.locator("g.card").first().waitFor();
  await Bun.sleep(800);
  await post("agent", `detail P1 "One reservation per order line."\ndetail E2 "Sent to billing."`, "ordering");
  await sharp.locator("g.card.is-fresh").first().waitFor();
  const stormingPng = await sharp.locator("svg.sideco-board").first().screenshot();
  const storming = `data:image/png;base64,${stormingPng.toString("base64")}`;
  const flow = await piece(sharp, "payment", "svg.sideco-board");
  const thread = await piece(sharp, "payment", ".thread");
  const status = await piece(sharp, "payment", ".status");
  const waits = await piece(sharp, "payment", ".waits");
  await sharp.close();
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
  await page.setContent(`<!doctype html><style>
    body { margin: 0; width: 1280px; height: 640px; overflow: hidden; background: #fff; position: relative;
      font-family: -apple-system, "Segoe UI", Inter, sans-serif; color: #1f2328; }
    .side { position: absolute; inset: 0 0 96px 0; overflow: hidden; }
    .left { clip-path: polygon(0 0, 800px 0, 560px 100%, 0 100%); }
    .right { clip-path: polygon(808px 0, 100% 0, 100% 100%, 568px 100%); }
    .left > img { position: absolute; left: 8px; top: 58px; height: 480px; }
    .right img.flow { position: absolute; left: 690px; top: 48px; height: 500px; }
    .right img.thread { position: absolute; right: 20px; top: 48px; width: 290px; border-radius: 8px;
      box-shadow: 0 6px 24px rgba(31, 35, 40, 0.18); }
    .status { position: absolute; left: 24px; top: 12px; display: flex; gap: 14px; align-items: center;
      padding: 4px 14px; border-radius: 18px; background: #fff; box-shadow: 0 2px 10px rgba(31, 35, 40, 0.14); }
    .status img { zoom: 0.6; }
    .cut { position: absolute; inset: 0 0 96px 0; background: #1a6fae;
      clip-path: polygon(800px 0, 808px 0, 568px 100%, 560px 100%); }
    .band { position: absolute; left: 0; right: 0; bottom: 0; height: 96px; background: #1f2328; color: #fff;
      display: flex; align-items: center; gap: 28px; padding: 0 48px; box-sizing: border-box; }
    .band b { font-size: 40px; letter-spacing: -0.5px; }
    .band span { font-size: 23px; line-height: 1.25; opacity: 0.92; }
  </style>
  <div class="side left"><img src="${storming}"><div class="status"><img src="${status}"><img src="${waits}"></div></div>
  <div class="side right"><img class="flow" src="${flow}"><img class="thread" src="${thread}"></div>
  <div class="cut"></div>
  <div class="band"><b>Sideco</b><span>Turn your coding agent's walls of text into a conversation you can see and reshape.</span></div>`);
  await page.screenshot({ path: join(OUT, "social-preview.png") });
  console.log(join(OUT, "social-preview.png"));
}

try {
  const wide = await browser.newPage({ viewport: { width: 1440, height: 820 } });
  for (const board of BOARDS) await photo(wide, board.id, `sideco-${board.id}`, board.tab);
  await socialPreview();
} finally {
  await browser.close();
  running.stop();
}
