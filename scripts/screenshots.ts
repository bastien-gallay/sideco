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
add hotspot "What if stock runs out?" --col 4
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

try {
  const wide = await browser.newPage({ viewport: { width: 1440, height: 820 } });
  for (const board of BOARDS) await photo(wide, board.id, `sideco-${board.id}`, board.tab);
  const social = await browser.newPage({ viewport: { width: 1280, height: 640 } });
  await photo(social, "payment", "social-preview", "#tab-notes");
} finally {
  await browser.close();
  running.stop();
}
