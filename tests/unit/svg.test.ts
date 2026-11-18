import { describe, expect, test } from "bun:test";
import { layoutBoard } from "../../src/domain/layout/index.ts";
import { bandMarkup, cardMarkup, esc, sceneToSvg } from "../../src/domain/render/svg.ts";
import { FLOW, IMPACT_EFFORT, KANBAN, ORDERING, table } from "../support.ts";

const svgOf = (script: string): string => {
  const board = table(script).board();
  return sceneToSvg(layoutBoard(board), board.title);
};

test("text is escaped wherever it lands", () => {
  expect(esc(`<a href="x">&</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  const svg = svgOf('board new "A <b> & \\"c\\"" --id x\nadd event "<script>alert(1)</script>"');
  expect(svg).not.toContain("<script>");
  expect(svg).toContain("&lt;script&gt;");
  expect(svg).toContain('aria-label="A &lt;b&gt; &amp; &quot;c&quot;"');
});

test("a card's tooltip carries its whole label and its detail, which the card itself may cut", () => {
  const long = "Ajout, modification et suppression des acteurs, idéalement avec une description visible";
  const t = table(`board new "Carte" --id carte\nadd event "${long}" --col 1`);
  t.do({ kind: "annotate", board: "carte", id: "E1", detail: "Règle n°4\nSource : atelier" });
  const card = layoutBoard(t.board()).cards[0];
  if (!card) throw new Error("the board has a card");
  expect(card.lines.at(-1)).toEndWith("…");
  const markup = cardMarkup(card);
  expect(markup).toContain(
    `<title>${esc(long)} · E1 · Event · added by Claude\nRègle n°4\nSource : atelier</title>`,
  );
});

test("the id and the marks of a card are drawn in full ink, so they read on every sticky colour", () => {
  const svg = svgOf(`${ORDERING}\ndetail P1 "Règle"`);
  expect(svg).toMatch(/\.card-id \{[^}]*\}/);
  expect(svg.match(/\.card-id \{[^}]*\}/)?.[0]).not.toContain("opacity");
  expect(svg.match(/\.card-detail \{[^}]*\}/)?.[0]).not.toContain("opacity");
});

test("small labels of the chrome use the muted ink, never the faint one", () => {
  const svg = svgOf(ORDERING);
  for (const rule of [".band-step-label", ".lane-count"]) {
    const css = svg.match(new RegExp(`\\${rule} \\{[^}]*\\}`))?.[0] ?? "";
    expect(css).toContain("--vico-muted");
    expect(css).not.toContain("--vico-faint");
  }
});

test("a lane that says what it stands for is drawn on two lines: its name, then that", () => {
  const svg = svgOf(IMPACT_EFFORT);
  expect(count(svg, '<text class="lane-hint"')).toBe(4);
  expect(svg).toContain(">High impact · low effort</text>");
  // The others keep their single line.
  expect(svgOf(KANBAN)).not.toContain('<text class="lane-hint"');

  // The name moves up, its count with it, and the second line still ends above the first card.
  const scene = layoutBoard(table(IMPACT_EFFORT).board());
  const [lane] = scene.bands;
  const [first] = scene.cards;
  if (!lane || !first) throw new Error("the board has a lane and a card");
  const baseline = (markup: string, cls: string): number =>
    Number(markup.match(new RegExp(`class="${cls}" x="[^"]+" y="([^"]+)"`))?.[1]);
  const said = bandMarkup(lane);
  const plain = bandMarkup({ ...lane, hint: undefined });
  expect(baseline(said, "lane-label")).toBeLessThan(baseline(plain, "lane-label"));
  expect(baseline(said, "lane-count")).toBe(baseline(said, "lane-label"));
  expect(baseline(said, "lane-hint") - baseline(said, "lane-label")).toBeGreaterThanOrEqual(14);
  expect(baseline(said, "lane-hint")).toBeLessThan(first.y);
});

test.each([
  ["timeline", ORDERING],
  ["columns", KANBAN],
  ["graph", FLOW],
])("a %s board is a standalone, well-formed SVG", (_layout, script) => {
  const svg = svgOf(script);
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  expect(svg.endsWith("</svg>")).toBe(true);
  expect(svg).toContain("<style>");
  for (const tag of ["g", "text", "svg", "tspan", "marker", "defs", "title", "style"]) {
    expect(count(svg, `<${tag}[ >]`)).toBe(count(svg, `</${tag}>`));
  }
  expect(svg).not.toMatch(/NaN|undefined|Infinity/);
});

test("every element shows its id, and every link an arrow", () => {
  const board = table(FLOW).board();
  const svg = sceneToSvg(layoutBoard(board), board.title);
  for (const e of board.elements)
    expect(svg).toMatch(new RegExp(`<text class="card-id" x="\\d+" y="14" fill="#1F2328">${e.id}</text>`));
  expect(count(svg, 'marker-end="url\\(#vico-arrow\\)"')).toBe(board.edges.length);
  expect(svg).toContain(">oui</text>");
});

describe("a card", () => {
  const t = table(ORDERING).script('detail P1 "Règle n°4"');
  t.do({ kind: "note", board: "commande", text: "Qui ?", target: "P1" }, "human");
  t.do({ kind: "add", board: "commande", type: "event", label: "Payée", col: 3 }, "human");
  const cards = layoutBoard(t.board()).cards;
  const markup = (id: string): string => cardMarkup(cards.find((c) => c.id === id) ?? (cards[0] as never));

  test("tells who added it by shape, not by colour: a diamond for the agent, a dot for the human", () => {
    expect(markup("E1")).toMatch(/<path class="card-author"/);
    expect(markup("E3")).toMatch(/<circle class="card-author"/);
    expect(markup("E1")).toContain("<title>E1 · Event · added by Claude</title>");
    expect(markup("E3")).toContain("<title>E3 · Event · added by you</title>");
  });

  test("marks a detail and counts its open notes", () => {
    expect(markup("P1")).toContain('class="card-detail"');
    expect(markup("P1")).toContain('<g class="card-notes">');
    expect(markup("E1")).not.toContain("card-detail");
    expect(markup("E1")).not.toContain("card-notes");
  });

  test("is drawn at the origin, so the page can move it without repainting", () => {
    expect(markup("E2")).toContain(
      '<rect class="card-shape" fill="#FF9F1C" width="152" height="48" rx="2"/>',
    );
  });
});

function count(text: string, pattern: string): number {
  return [...text.matchAll(new RegExp(pattern, "g"))].length;
}

test("on shapes with cut corners, the id and the author mark sit inside the shape", () => {
  const flow = layoutBoard(table(FLOW).board()).cards;
  const corner = (id: string): { idX: number; authorX: number; w: number } => {
    const c = flow.find((card) => card.id === id);
    if (!c) throw new Error(`no card ${id}`);
    const markup = cardMarkup(c);
    return {
      idX: Number(/class="card-id" x="([\d.]+)"/.exec(markup)?.[1]),
      authorX: Number(/class="card-author"[^>]* d="M([\d.]+) /.exec(markup)?.[1]),
      w: c.w,
    };
  };
  // S1 is a box: the corners are free. D1 is a diamond, O1 a pill: 14 px and more are cut away.
  expect(corner("S1").idX).toBe(8);
  for (const id of ["D1", "O1"]) {
    const { idX, authorX, w } = corner(id);
    expect(idX).toBeGreaterThanOrEqual(22);
    expect(authorX).toBeLessThanOrEqual(w - 26);
  }
});
