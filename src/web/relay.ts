/**
 * One event stream for every tab of the page. A browser keeps six connections
 * per host, and each open stream holds one: with a stream per tab, a sixth tab
 * left the human's writes queued and the text they typed was lost. The relay
 * holds the only stream, in a worker the tabs share, and hands each tab what it
 * would have read on its own: the journal replayed, then each event as it comes.
 */
import type { Presence } from "../domain/presence.ts";

/** What a tab hears from the relay. `data` is the stream's text, parsed by the tab. */
export type Frame =
  | { kind: "open" }
  | { kind: "error" }
  | { kind: "event"; data: string }
  | { kind: "presence"; data: string }
  /** Another run of the companion answered: drop what was folded, the replay starts over. */
  | { kind: "reset" };

/**
 * What a tab tells the relay: it leaves when hidden into the back-forward cache,
 * and joins again when shown, to hear the journal it missed.
 */
export type Request = { kind: "leave" } | { kind: "join" };

export interface SourceHandlers {
  open(): void;
  /** `closed`: the browser gave the stream up and will not reconnect it on its own. */
  error(closed?: boolean): void;
  event(data: string): void;
  presence(data: string): void;
}

export type OpenSource = (handlers: SourceHandlers) => { close(): void };

export interface Listener {
  post(frame: Frame): void;
}

/** How long a lost stream waits before it is opened again. */
const RETRY_MS = 2000;
/** `EventSource.CLOSED`, spelled out: the tests run where EventSource does not exist. */
const CLOSED = 2;

export class Relay {
  private readonly listeners = new Set<Listener>();
  private source: { close(): void } | null = null;
  /** Each stream gets a generation; frames from a closed one are dropped. */
  private generation = 0;
  private connected: boolean | null = null;
  private events: string[] = [];
  private presence: string | null = null;
  private run: string | null = null;
  /** A new stream is already asked for: one at a time. */
  private retrying = false;

  constructor(
    private readonly openSource: OpenSource,
    /** Runs `again` a moment later: the time a companion takes to come back. */
    private readonly later: (again: () => void) => void = (again) => void setTimeout(again, RETRY_MS),
  ) {}

  join(listener: Listener): void {
    if (this.connected !== null) listener.post({ kind: this.connected ? "open" : "error" });
    for (const data of this.events) listener.post({ kind: "event", data });
    if (this.presence !== null) listener.post({ kind: "presence", data: this.presence });
    this.listeners.add(listener);
    if (this.source === null) this.follow();
  }

  leave(listener: Listener): void {
    this.listeners.delete(listener);
  }

  private follow(): void {
    const generation = ++this.generation;
    const live = (): boolean => generation === this.generation;
    this.source = this.openSource({
      open: () => live() && this.said({ kind: "open" }),
      error: (closed) => live() && this.lost(closed === true),
      event: (data) => live() && this.said({ kind: "event", data }),
      presence: (data) => live() && this.heard(data),
    });
  }

  private heard(data: string): void {
    const { run } = JSON.parse(data) as Presence;
    if (this.run !== null && run !== this.run) {
      // The stream reconnected to another run: its journal may not be the one replayed so far.
      this.startOver();
      return;
    }
    this.run = run;
    this.said({ kind: "presence", data });
  }

  /**
   * A stream the browser gave up on is never opened again by the browser: left so,
   * every tab, and every tab opened later, would show the journal as it stood.
   */
  private lost(closed: boolean): void {
    this.said({ kind: "error" });
    if (!closed || this.retrying) return;
    this.retrying = true;
    this.later(() => {
      this.retrying = false;
      this.startOver();
    });
  }

  /** A new stream replays the journal from its start: every tab drops what it folded. */
  private startOver(): void {
    this.source?.close();
    this.connected = null;
    this.events = [];
    this.presence = null;
    this.run = null;
    this.broadcast({ kind: "reset" });
    this.follow();
  }

  private said(frame: Frame): void {
    if (frame.kind === "open" || frame.kind === "error") this.connected = frame.kind === "open";
    else if (frame.kind === "event") this.events.push(frame.data);
    else if (frame.kind === "presence") this.presence = frame.data;
    this.broadcast(frame);
  }

  private broadcast(frame: Frame): void {
    for (const listener of this.listeners) listener.post(frame);
  }
}

/** The stream itself, as the browser reads it. */
export const eventSource =
  (url: string): OpenSource =>
  (handlers) => {
    const source = new EventSource(url);
    source.onopen = () => handlers.open();
    source.onerror = () => handlers.error(source.readyState === CLOSED);
    source.onmessage = (message) => handlers.event(message.data);
    source.addEventListener("presence", (message) =>
      handlers.presence((message as MessageEvent<string>).data),
    );
    return source;
  };
