import { describe, expect, test } from "bun:test";
import { FORMATS, findFormat, NOTE_PREFIX, typeOfId } from "../../src/domain/formats.ts";

describe.each(FORMATS.map((f) => [f.id, f] as const))("format %s", (_id, format) => {
  test("prefixes are single capital letters, unique, and never the note prefix", () => {
    const prefixes = format.types.map((t) => t.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const prefix of prefixes) {
      expect(prefix).toMatch(/^[A-Z]$/);
      expect(prefix).not.toBe(NOTE_PREFIX);
    }
  });

  test("type ids are unique and every type explains itself", () => {
    expect(new Set(format.types.map((t) => t.id)).size).toBe(format.types.length);
    for (const type of format.types) {
      expect(type.label).not.toBe("");
      expect(type.hint).not.toBe("");
      expect(type.fill).toMatch(/^#[0-9A-F]{6}$/);
      expect(type.ink).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  test("only column layouts have lanes, and they have at least two", () => {
    if (format.layout === "columns") expect(format.lanes.length).toBeGreaterThanOrEqual(2);
    else expect(format.lanes).toEqual([]);
  });

  test("label text is readable on its fill (WCAG AA, 4.5:1)", () => {
    for (const type of format.types) expect(contrast(type.fill, type.ink)).toBeGreaterThanOrEqual(4.5);
  });
});

test("format ids are unique and found by id", () => {
  expect(new Set(FORMATS.map((f) => f.id)).size).toBe(FORMATS.length);
  expect(findFormat("kanban")?.name).toBe("Kanban");
  expect(findFormat("nope")).toBeUndefined();
});

test("an element id names its type through its prefix", () => {
  const storming = findFormat("event-storming");
  if (!storming) throw new Error("event-storming is missing");
  expect(typeOfId(storming, "E12")?.id).toBe("event");
  expect(typeOfId(storming, "Z1")).toBeUndefined();
});

test("event storming keeps faceto's prefixes, so its files load unchanged", () => {
  const prefixes = Object.fromEntries(
    (findFormat("event-storming")?.types ?? []).map((t) => [t.id, t.prefix]),
  );
  expect(prefixes).toEqual({
    actor: "X",
    command: "C",
    aggregate: "A",
    event: "E",
    policy: "P",
    readmodel: "R",
    system: "G",
    hotspot: "H",
  });
});

function luminance(hex: string): number {
  const channel = (i: number): number => {
    const v = Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
