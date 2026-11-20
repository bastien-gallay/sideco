/**
 * Labels on a card: small chips at its foot, coloured by what they are about
 * (the key before ":", else the whole word), each colour readable at AA, and
 * the card as tall as it needs to hold them, in every layout.
 */
import { describe, expect, test } from "bun:test";
import { layoutBoard } from "../../src/domain/layout/index.ts";
import { cardChipText, chipText, LABEL_COLOURS, labelColours } from "../../src/domain/render/labels.ts";
import { cardMarkup } from "../../src/domain/render/svg.ts";
import { table } from "../support.ts";

/** WCAG relative luminance of a #RRGGBB colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};

describe("a label's colour", () => {
  test("is the same for every label of one key, and for one word whatever its case", () => {
    expect(labelColours("type:bug")).toEqual(labelColours("type:story"));
    expect(labelColours("Urgent")).toEqual(labelColours("urgent"));
  });

  test("is always one of a few pairs, each readable at AA", () => {
    for (const { fill, ink } of LABEL_COLOURS) expect(contrast(fill, ink)).toBeGreaterThanOrEqual(4.5);
    const keys = [
      "type:x",
      "env:x",
      "release:x",
      "assignee:x",
      "urgent",
      "blocked",
      "ux",
      "api",
      "doc",
      "perf",
    ];
    const used = new Set(keys.map((k) => labelColours(k).fill));
    expect(used.size).toBeGreaterThan(3);
    for (const k of keys) expect(LABEL_COLOURS).toContainEqual(labelColours(k));
  });
});

describe("a label's words on a chip", () => {
  test("say an assignee the short way, and the rest as written", () => {
    expect(chipText("assignee:bastien")).toBe("@bastien");
    expect(chipText("type:bug")).toBe("type:bug");
  });

  test("on the card, a keyed label shows its value alone: its colour already says the key", () => {
    expect(cardChipText("type:bug")).toBe("bug");
    expect(cardChipText("release:2026.12")).toBe("2026.12");
    expect(cardChipText("assignee:bastien")).toBe("@bastien");
    expect(cardChipText("urgent")).toBe("urgent");
    expect(cardChipText("a:b:c")).toBe("b:c");
  });
});

const KANBAN = `
board new "Sprint" --format kanban --id sprint
add task "Sans label" --lane todo
add task "Avec labels" --lane todo
label T2 type:bug @bastien env:prod release:2026.12 urgent
add task "Dessous" --lane todo
`;

describe("a card with labels", () => {
  test("is a row taller than without, and the cards under it make room", () => {
    const cards = layoutBoard(table(KANBAN).board()).cards;
    const [bare, labelled, under] = ["T1", "T2", "T3"].map((id) => cards.find((c) => c.id === id));
    if (!bare || !labelled || !under) throw new Error("missing card");
    expect(labelled.labels).toEqual([
      "type:bug",
      "assignee:bastien",
      "env:prod",
      "release:2026.12",
      "urgent",
    ]);
    expect(bare.labels).toBeUndefined();
    expect(labelled.h).toBeGreaterThan(bare.h);
    expect(under.y).toBeGreaterThanOrEqual(labelled.y + labelled.h);
  });

  test("draws its chips at its foot, as many as fit, then how many more", () => {
    const card = layoutBoard(table(KANBAN).board()).cards.find((c) => c.id === "T2");
    if (!card) throw new Error("no T2");
    const svg = cardMarkup(card);
    expect(svg).toContain('class="card-labels"');
    expect(svg).toContain(">bug</text>");
    expect(svg).not.toContain(">type:bug</text>");
    // Five labels on a card 152 wide: the first two, then how many more; the tooltip and the Detail name them all.
    expect(svg).toContain(">@bastien</text>");
    expect(svg).toContain(">+3</text>");
    expect(chipText("assignee:bastien")).toBe("@bastien");
    const ys = [...svg.matchAll(/<rect class="card-label-chip" x="[\d.]+" y="([\d.]+)"/g)].map((m) =>
      Number(m[1]),
    );
    expect(ys.length).toBeGreaterThan(0);
    for (const y of ys) expect(y).toBeGreaterThan(card.h - 20);
    const xs = [...svg.matchAll(/<rect class="card-label-chip" x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/g)];
    for (const m of xs) expect(Number(m[1]) + Number(m[2])).toBeLessThanOrEqual(card.w - 6);
  });

  test("on a story map and a flow as well", () => {
    const map = layoutBoard(
      table(`board new "Carte" --format story-map --id carte
add activity "Choisir" --col 1
add task "Chercher" --col 1
label T1 ux
add story "Filtre" --col 1`).board(),
    ).cards;
    const [task, story] = ["T1", "S1"].map((id) => map.find((c) => c.id === id));
    expect(task?.labels).toEqual(["ux"]);
    if (task && story && task.x === story.x) expect(story.y).toBeGreaterThanOrEqual(task.y + task.h);
    const flow = layoutBoard(
      table(`board new "Parcours" --format flow --id parcours
add step "Payer"
label S1 api
add step "Livrer" --from S1`).board(),
    ).cards;
    expect(new Set(flow.map((c) => c.h)).size).toBe(1);
    expect(flow.find((c) => c.id === "S1")?.labels).toEqual(["api"]);
  });
});
