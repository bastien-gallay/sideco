import { describe, expect, test } from "bun:test";
import { along, labelBox, overlap, placeConnectorLabels } from "../../src/domain/layout/connector-labels.ts";
import { layoutBoard, type Scene } from "../../src/domain/layout/index.ts";
import { connectorMarkup } from "../../src/domain/render/svg.ts";
import { FLOW, table } from "../support.ts";

const named = (scene: Scene) => scene.connectors.filter((c) => c.label);
const boxOf = (c: { label?: string; labelX: number; labelY: number }) =>
  labelBox(c.label ?? "", c.labelX, c.labelY);

/** Every name written, none over another, none over a card, each beside its own link. */
function expectReadable(scene: Scene): void {
  const names = named(scene);
  expect(names.length).toBeGreaterThan(0);
  expect(names.filter((c) => c.unwritten).map((c) => c.label)).toEqual([]);
  for (const [k, c] of names.entries()) {
    const box = boxOf(c);
    for (const other of names.slice(k + 1)) expect(overlap(box, boxOf(other))).toBe(0);
    for (const card of scene.cards)
      expect([c.label, card.id, overlap(box, card)]).toEqual([c.label, card.id, 0]);
    const reach = Math.min(...along(c.d).map(([x, y]) => Math.hypot(x - c.labelX, y - c.labelY)));
    // Beside its line, or a few lines above or under it.
    expect(reach).toBeLessThan(box.w / 2 + 6 * 14);
  }
}

describe("a link's name", () => {
  test("two links into one card, from two cards side by side, keep their names apart", () => {
    const scene = layoutBoard(
      table(
        'board new "Système" --format flow --id sys\nadd step "Agent"\nadd step "Page"\n' +
          'add step "Compagnon" --from F1 --edge "lit et écrit par la CLI ; hooks de session"\n' +
          'link F2 F3 "page et direct (HTTP, flux)"',
      ).board(),
    );
    expectReadable(scene);
  });

  test("a link across a lane full of cards writes its name where no card is", () => {
    const scene = layoutBoard(
      table(
        'board new "Sprint" --format kanban --id sprint\n' +
          'add task "Publier" --lane done\n' +
          'add task "Tester" --lane doing\nadd task "Brancher" --lane doing\nadd task "Relire" --lane doing\n' +
          'add task "Écrire" --lane todo\n' +
          'link T1 T5 "prérequis"\nlink T2 T5 "prérequis"',
      ).board(),
      "fr",
      900,
    );
    expectReadable(scene);
  });

  test("a name with no free spot is not written over a card: the link says it on hover", () => {
    const scene = layoutBoard(
      table(
        'board new "Sprint" --format kanban --id sprint\n' +
          'add task "Tester" --lane doing\nadd task "Brancher" --lane doing\n' +
          'add task "Relire" --lane doing\nadd task "Publier" --lane doing\nlink T2 T3 "prérequis"',
      ).board(),
      "fr",
      900,
    );
    const [link] = named(scene);
    expect(link?.unwritten).toBe(true);
    const markup = link ? connectorMarkup(link) : "";
    expect(markup).toContain("<title>prérequis</title>");
    expect(markup).not.toContain("conn-label");
  });

  test("a name already on a free spot stays where its layout put it", () => {
    const scene = layoutBoard(table(FLOW).board());
    expect(placeConnectorLabels(scene)).toEqual(scene);
  });

  test("a path is walked every few pixels, its curves included", () => {
    expect(along("M0 0 H16")).toEqual([
      [0, 0],
      [8, 0],
      [16, 0],
    ]);
    const curve = along("M0 0 C0 40 40 40 40 0");
    expect(curve.at(-1)).toEqual([40, 0]);
    expect(Math.max(...curve.map(([, y]) => y))).toBeCloseTo(30, 0);
  });
});
