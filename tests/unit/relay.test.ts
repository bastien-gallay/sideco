/**
 * One event stream for every tab of the page. A browser keeps six connections
 * per host: with one stream per tab, the sixth tab's writes queued behind the
 * streams and never left. The relay holds the only stream and hands each tab
 * what it would have read on its own.
 */
import { describe, expect, test } from "bun:test";
import { type Frame, type OpenSource, Relay, type SourceHandlers } from "../../src/web/relay.ts";

/** A stream the test drives by hand; it counts how many were opened and closed. */
function fakeSources(): {
  open: OpenSource;
  current: () => SourceHandlers;
  opened: () => number;
  closed: () => number;
} {
  const handlers: SourceHandlers[] = [];
  let closed = 0;
  return {
    open: (h) => {
      handlers.push(h);
      return { close: () => void closed++ };
    },
    current: () => {
      const last = handlers.at(-1);
      if (!last) throw new Error("no stream open");
      return last;
    },
    opened: () => handlers.length,
    closed: () => closed,
  };
}

const presence = (run: string, listening = 0): string => JSON.stringify({ listening, run, build: "b" });

function tab(): { post: (frame: Frame) => void; frames: Frame[] } {
  const frames: Frame[] = [];
  return { post: (frame) => frames.push(frame), frames };
}

describe("one stream, shared", () => {
  test("opens the stream with the first tab, and only once for any number of tabs", () => {
    const sources = fakeSources();
    const relay = new Relay(sources.open);
    expect(sources.opened()).toBe(0);
    for (let i = 0; i < 7; i++) relay.join(tab());
    expect(sources.opened()).toBe(1);
  });

  test("every tab hears what the stream says, in order", () => {
    const sources = fakeSources();
    const relay = new Relay(sources.open);
    const [a, b] = [tab(), tab()];
    relay.join(a);
    relay.join(b);
    sources.current().open();
    sources.current().event('{"seq":1}');
    sources.current().presence(presence("r1"));
    const heard: Frame[] = [
      { kind: "open" },
      { kind: "event", data: '{"seq":1}' },
      { kind: "presence", data: presence("r1") },
    ];
    expect(a.frames).toEqual(heard);
    expect(b.frames).toEqual(heard);
  });

  test("a tab that joins late is told the journal so far, then the last presence", () => {
    const sources = fakeSources();
    const relay = new Relay(sources.open);
    relay.join(tab());
    sources.current().open();
    sources.current().event('{"seq":1}');
    sources.current().presence(presence("r1", 0));
    sources.current().event('{"seq":2}');
    sources.current().presence(presence("r1", 1));
    const late = tab();
    relay.join(late);
    expect(late.frames).toEqual([
      { kind: "open" },
      { kind: "event", data: '{"seq":1}' },
      { kind: "event", data: '{"seq":2}' },
      { kind: "presence", data: presence("r1", 1) },
    ]);
  });

  test("a tab that joins mid-replay gets no presence yet: the replay is not over", () => {
    const sources = fakeSources();
    const relay = new Relay(sources.open);
    relay.join(tab());
    sources.current().event('{"seq":1}');
    const late = tab();
    relay.join(late);
    expect(late.frames).toEqual([{ kind: "event", data: '{"seq":1}' }]);
  });

  test("a lost stream is said to every tab, and to one that joins while it is lost", () => {
    const sources = fakeSources();
    const relay = new Relay(sources.open);
    const a = tab();
    relay.join(a);
    sources.current().open();
    sources.current().error();
    expect(a.frames).toEqual([{ kind: "open" }, { kind: "error" }]);
    const late = tab();
    relay.join(late);
    expect(late.frames).toEqual([{ kind: "error" }]);
  });

  test("a tab that leaves hears nothing more", () => {
    const sources = fakeSources();
    const relay = new Relay(sources.open);
    const [a, b] = [tab(), tab()];
    relay.join(a);
    relay.join(b);
    relay.leave(a);
    sources.current().event('{"seq":1}');
    expect(a.frames).toEqual([]);
    expect(b.frames).toHaveLength(1);
  });
});

describe("another run of the companion", () => {
  test("starts every tab over from a new stream, and forgets the old journal", () => {
    const sources = fakeSources();
    const relay = new Relay(sources.open);
    const a = tab();
    relay.join(a);
    sources.current().event('{"seq":1}');
    sources.current().presence(presence("r1"));
    a.frames.length = 0;

    // The companion restarted: the stream reconnected on its own and met another run.
    sources.current().presence(presence("r2"));
    expect(a.frames).toEqual([{ kind: "reset" }]);
    expect(sources.closed()).toBe(1);
    expect(sources.opened()).toBe(2);

    sources.current().event('{"seq":1}');
    sources.current().presence(presence("r2"));
    const late = tab();
    relay.join(late);
    expect(late.frames).toEqual([
      { kind: "event", data: '{"seq":1}' },
      { kind: "presence", data: presence("r2") },
    ]);
  });

  test("frames from the stream it closed are ignored", () => {
    const sources = fakeSources();
    const relay = new Relay(sources.open);
    const a = tab();
    relay.join(a);
    const old = sources.current();
    old.presence(presence("r1"));
    old.presence(presence("r2"));
    a.frames.length = 0;
    old.event('{"seq":9}');
    expect(a.frames).toEqual([]);
  });
});
