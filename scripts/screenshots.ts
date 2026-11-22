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
/** Every picture is taken twice: GitHub shows the dark one to who reads in the dark. */
const SCHEMES = ["light", "dark"] as const;
type Scheme = (typeof SCHEMES)[number];
const suffix = (scheme: Scheme) => (scheme === "dark" ? "-dark" : "");
const SESSION = "readme";

/**
 * One board per workshop, small enough to read on a README. `shot` says how it is
 * photographed: the whole page, the board alone between its folded panels, or not
 * at all when it only feeds the composed picture. `late` is written just before the
 * photo: a hand-over shows in the header of every board, so it waits for its own.
 */
interface Board {
  id: string;
  script: string;
  human?: string;
  late?: string;
  shot?: "page" | "board";
  /** The window of a board photographed alone, when the usual one cuts it or leaves it half empty. */
  size?: { width: number; height: number };
  tab?: string;
}
const BOARDS: Board[] = [
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
    human: `rename X1 "Partner warehouse"`,
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
focus @bank --why "The retry rule is not settled"`,
    late: `pass "How many attempts before we block the card?"`,
    human: `reply N1 "Three, then block it for an hour."`,
    shot: "page",
    tab: "#tab-notes",
  },
  {
    id: "retro",
    script: `board new "Sprint 12 retro" --format retro --id retro
add point "Pairing on the payment page" --lane went-well
add point "Reviews waited two days" --lane went-badly
add point "Bank API access came late" --lane went-badly
add point "Daily at 9:30" --lane keep
add point "Estimating in hours" --lane drop --alias hours
add action "Size stories in points" --from @hours`,
    human: `add point "Demo with real data" --lane went-well`,
    shot: "board",
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
    shot: "board",
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
    // Ids are given once in the project: the story map above took T1 to T4, so "E-mail reminders" is T6.
    human: `move T6 --lane done`,
    shot: "board",
  },
  {
    id: "next",
    script: `board new "What next?" --format impact-effort --id next
add item "One-click reorder" --lane quick
add item "Saved cards" --lane quick
add item "Marketplace" --lane bet
add item "Order history export" --lane fill
add item "Custom invoices" --lane avoid`,
    human: `add item "Gift cards" --lane bet`,
    shot: "board",
    size: { width: 1090, height: 720 },
  },
  {
    id: "shop",
    script: `board new "The shop" --format c4-context --id shop
add person "Customer" --alias customer
add system "Online shop" --from @customer --edge "orders with" --alias shop
add external "Bank" --from @shop --edge "charges through"
add external "Warehouse" --from @shop --edge "reserves stock in"`,
    shot: "board",
    size: { width: 640, height: 500 },
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
await hook({ hook_event_name: "UserPromptSubmit", prompt: "Model the shop with me: orders, payment, the sprint" });
for (const board of BOARDS) await post("agent", board.script);
await hook({ hook_event_name: "Stop" });

const browser = await chromium.launch({ channel: "chrome", headless: true });
mkdirSync(OUT, { recursive: true });
const wide = await browser.newPage({ viewport: { width: 1440, height: 820 } });
await wide.goto(running.url);
// Claude parks at the end of its turn, as the plugin's second Stop hook does once a page is open:
// the page then says it waits for the human to send. The hook gives up at once while the companion
// has not seen the page yet, so it is sent again until it stays. Never awaited: it ends with this script.
const waiting = wide.locator(".status-text", { hasText: "waiting" });
for (let attempt = 0; !(await waiting.isVisible()); attempt++) {
  if (attempt === 20) throw new Error("Claude never parked: the page does not say it waits");
  void runHook({ session_id: SESSION, cwd: root, hook_event_name: "Stop" }, {}, true);
  await waiting.waitFor({ timeout: 1000 }).catch(() => undefined);
}
for (const board of BOARDS) if (board.human) await post("human", board.human, board.id);

async function photo(page: Page, board: Board): Promise<void> {
  if (board.late) await post("agent", board.late, board.id);
  await page.goto(`${running.url}/#/b/${board.id}`);
  await page.locator("g.card").first().waitFor();
  if (board.tab) await page.locator(board.tab).click();
  await Bun.sleep(800); // the cards glide to their place
  for (const scheme of SCHEMES) {
    await page.emulateMedia({ colorScheme: scheme });
    const path = join(OUT, `sideco-${board.id}${suffix(scheme)}.png`);
    await page.screenshot({ path });
    console.log(path);
  }
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
 * The three marks a card can carry, each on a real card of the event storming, enlarged and named:
 * at the size of a README a mark on a whole board is a few pixels. Taken while the outline holds.
 */
async function marks(sharp: Page, scheme: Scheme): Promise<void> {
  const MARKS = [
    { card: "Place order", says: "A diamond: Claude placed it" },
    { card: "Partner warehouse", says: "A dot: you touched it" },
    { card: "Stock reserved", says: "A blue outline: Claude just changed it" },
  ];
  // One window for the three, centred on each card: the outline widens the box of the card that carries it.
  const room = 7;
  let window: { width: number; height: number } | undefined;
  const cut: { png: string; says: string }[] = [];
  for (const mark of MARKS) {
    const box = await sharp.locator("g.card", { hasText: mark.card }).first().boundingBox();
    if (!box) throw new Error(`no card named ${mark.card}`);
    window ??= { width: box.width + 2 * room, height: box.height + 2 * room };
    const clip = { x: box.x + box.width / 2 - window.width / 2, y: box.y + box.height / 2 - window.height / 2, ...window };
    cut.push({ png: (await sharp.screenshot({ clip })).toString("base64"), says: mark.says });
  }
  const style = await sharp.evaluate(() => {
    const body = getComputedStyle(document.body);
    return { ground: body.backgroundColor, ink: body.color };
  });
  const page = await browser.newPage({ viewport: { width: 880, height: 400 }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><style>
    body { margin: 0; background: ${style.ground}; color: ${style.ink}; font: 600 15px/1.3 -apple-system, "Segoe UI", Inter, sans-serif; }
    main { display: flex; justify-content: space-around; padding: 18px 0 20px; }
    figure { margin: 0; width: 290px; text-align: center; white-space: nowrap; }
    img { width: 250px; display: block; margin: 0 auto 10px; }
  </style><main>${cut.map((one) => `<figure><img src="data:image/png;base64,${one.png}">${one.says}</figure>`).join("")}</main>`);
  const path = join(OUT, `sideco-marks${suffix(scheme)}.png`);
  await page.locator("main").screenshot({ path });
  console.log(path);
  await page.close();
}

/**
 * Two workshops cut by an oblique line, with the thread where the human
 * answered: the README's first picture, 1280×544, and the social preview,
 * 1280×640 with the name and the tagline under it. Each side is a piece of
 * the real page; only the layout is made here.
 */
async function twoWorkshops(scheme: Scheme): Promise<void> {
  const sharp = await browser.newPage({
    viewport: { width: 2200, height: 1000 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
  });
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
  // Written anew for each picture: only what Claude just changed is outlined.
  await post("agent", `detail R1 "One reservation per order line (${scheme})."\ndetail E2 "Sent to billing (${scheme})."`, "ordering");
  await sharp.locator("g.card.is-fresh").first().waitFor();
  const stormingPng = await sharp.locator("svg.sideco-board").first().screenshot();
  await marks(sharp, scheme);
  const storming = `data:image/png;base64,${stormingPng.toString("base64")}`;
  const flow = await piece(sharp, "payment", "svg.sideco-board");
  const thread = await piece(sharp, "payment", ".thread");
  const status = await piece(sharp, "payment", ".status");
  const waits = await piece(sharp, "payment", ".waits");
  const ground = await sharp.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await sharp.close();
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
  await page.setContent(`<!doctype html><style>
    body { margin: 0; width: 1280px; height: 640px; overflow: hidden; background: ${ground}; position: relative;
      font-family: -apple-system, "Segoe UI", Inter, sans-serif; color: #1f2328; }
    .side { position: absolute; inset: 0 0 96px 0; overflow: hidden; }
    .left { clip-path: polygon(0 0, 800px 0, 560px 100%, 0 100%); }
    .right { clip-path: polygon(808px 0, 100% 0, 100% 100%, 568px 100%); }
    .left > img { position: absolute; left: 8px; top: 58px; height: 480px; }
    .right img.flow { position: absolute; left: 690px; top: 48px; height: 500px; }
    .right img.thread { position: absolute; right: 20px; top: 48px; width: 290px; border-radius: 8px;
      box-shadow: 0 6px 24px rgba(31, 35, 40, 0.18); }
    .status { position: absolute; left: 24px; top: 12px; display: flex; gap: 14px; align-items: center;
      padding: 4px 14px; border-radius: 18px; background: ${ground}; box-shadow: 0 2px 10px rgba(31, 35, 40, 0.14); }
    .status img { zoom: 0.6; }
    .cut { position: absolute; inset: 0 0 96px 0; background: #1a6fae;
      clip-path: polygon(800px 0, 808px 0, 568px 100%, 560px 100%); }
    .band { position: absolute; left: 0; right: 0; bottom: 0; height: 96px; background: #1f2328; color: #fff;
      display: flex; align-items: center; gap: 28px; padding: 0 48px; box-sizing: border-box; }
    .band b { font-size: 40px; letter-spacing: -0.5px; }
    .band span { font-size: 23px; line-height: 1.25; opacity: 0.92; }
  </style>
  <div class="side left"><img src="${storming}"><div class="status"><img src="${status}"><img src="${waits}"></div></div>
  <div class="side right" id="right"><img class="flow" id="flow" src="${flow}"><img class="thread" src="${thread}"></div>
  <div class="cut"></div>
  <div class="band"><b>Sideco</b><span>Turn your coding agent's walls of text into a conversation you can see and reshape.</span></div>`);
  // The focus dims the flow's ground, which shows in the dark: its side takes the colour of its own corner.
  await page.evaluate(async () => {
    const flow = document.getElementById("flow") as HTMLImageElement;
    await flow.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const pen = canvas.getContext("2d");
    if (!pen) return;
    pen.drawImage(flow, 4, 4, 1, 1, 0, 0, 1, 1);
    const [r, g, b] = pen.getImageData(0, 0, 1, 1).data;
    (document.getElementById("right") as HTMLElement).style.background = `rgb(${r}, ${g}, ${b})`;
  });
  // The social preview has one face, the light one.
  if (scheme === "light") {
    await page.screenshot({ path: join(OUT, "social-preview.png") });
    console.log(join(OUT, "social-preview.png"));
  }
  // The README says the tagline itself, just above: its picture goes without the band.
  const path = join(OUT, `sideco-two-workshops${suffix(scheme)}.png`);
  await page.screenshot({ path, clip: { x: 0, y: 0, width: 1280, height: 544 } });
  console.log(path);
  await page.close();
}

try {
  // Under 1100 px the page folds its two panels: the board alone, large enough to read in a README.
  const usual = { width: 1090, height: 540 };
  const narrow = await browser.newPage({ viewport: usual });
  for (const board of BOARDS) {
    if (board.shot !== "board") continue;
    await narrow.setViewportSize(board.size ?? usual);
    await photo(narrow, board);
  }
  await narrow.close();
  for (const board of BOARDS) if (board.shot === "page") await photo(wide, board);
  for (const scheme of SCHEMES) await twoWorkshops(scheme);
} finally {
  await browser.close();
  running.stop();
}
process.exit(0);
