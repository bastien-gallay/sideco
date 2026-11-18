/**
 * The single writer. The hub owns the journal and its projection, turns batches
 * of commands into recorded events, and tells subscribers about each one.
 * No HTTP here: the server and the tests drive it the same way.
 */
import { type Command, CommandError } from "../domain/commands.ts";
import { type Context, decide } from "../domain/decide.ts";
import { type Changes, describeChanges } from "../domain/digest.ts";
import type { Recorded, VicoEvent } from "../domain/events.ts";
import { apply, findSession, replay, type Workspace } from "../domain/workspace.ts";
import type { Journal } from "./journal.ts";

export interface Dispatched {
  events: Recorded[];
  /** One entry per command: the id it minted, if it minted one. */
  minted: (string | undefined)[];
}

export type WaitOutcome = "passed" | "timeout" | "released";

export class BatchError extends CommandError {
  constructor(
    message: string,
    readonly index: number,
  ) {
    super(message);
  }
}

type Listener = (event: Recorded) => void;

export class Hub {
  /** This run of the companion. A page that meets another run starts over from the journal. */
  readonly run: string = crypto.randomUUID();
  readonly events: Recorded[];
  workspace: Workspace;
  private readonly listeners = new Set<Listener>();
  private readonly presenceListeners = new Set<(listening: number) => void>();
  private readonly waiters = new Map<string, (outcome: WaitOutcome) => void>();

  constructor(
    private readonly journal: Journal,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.events = journal.load();
    this.workspace = replay(this.events);
  }

  /** All the commands, or none: a batch that fails midway leaves no trace. */
  dispatch(commands: readonly Command[], ctx: Context): Dispatched {
    const single = commands.length === 1;
    const draft = single ? this.workspace : structuredClone(this.workspace);
    const staged: Recorded[] = [];
    const minted: (string | undefined)[] = [];
    const ts = this.now().toISOString();

    commands.forEach((command, index) => {
      let decision: ReturnType<typeof decide>;
      try {
        decision = decide(draft, command, ctx);
      } catch (error) {
        if (error instanceof CommandError) throw new BatchError(error.message, index);
        throw error;
      }
      minted.push(decision.minted);
      for (const event of decision.events) {
        const recorded = this.stamp(event, ctx, ts, this.workspace.seq + staged.length + 1);
        staged.push(recorded);
        if (!single) apply(draft, recorded);
      }
    });

    this.journal.append(staged);
    if (single) for (const event of staged) apply(this.workspace, event);
    else this.workspace = draft;
    this.events.push(...staged);
    for (const event of staged) this.announce(event);
    return { events: staged, minted };
  }

  private stamp(event: VicoEvent, ctx: Context, ts: string, seq: number): Recorded {
    return { seq, ts, actor: ctx.actor, ...(ctx.session ? { session: ctx.session } : {}), ...event };
  }

  private announce(event: Recorded): void {
    for (const listener of this.listeners) listener(event);
    if (event.event === "TurnPassed" && event.to === "agent") this.settleAll("passed");
    const movedOn = event.event === "PromptSubmitted" || event.event === "SessionEnded";
    if (movedOn && event.session) this.settle(event.session, "released");
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** How many pages follow the journal right now: the humans who could hand a turn over. */
  get watching(): number {
    return this.listeners.size;
  }

  eventsAfter(seq: number): Recorded[] {
    const first = this.events.findIndex((e) => e.seq > seq);
    return first === -1 ? [] : this.events.slice(first);
  }

  /** What the human changed that `session` has not been told yet; `ack` records that it now has. */
  changesFor(session: string, ack: boolean): Changes {
    const after = findSession(this.workspace, session)?.deliveredUpTo ?? 0;
    const changes = describeChanges(this.events, after);
    if (ack && changes.text !== "")
      this.dispatch([{ kind: "delivered", upTo: changes.upTo }], { actor: "system", session });
    return changes;
  }

  /** True when the human handed over the turn and `session` has not been told. */
  hasPendingTurn(session: string): boolean {
    const after = findSession(this.workspace, session)?.deliveredUpTo ?? 0;
    return this.workspace.boards.some((b) => b.turn?.to === "agent" && b.turn.seq > after);
  }

  /** Resolves when the human passes the turn, when the session moves on, or at the timeout. */
  waitForTurn(session: string, timeoutMs: number): Promise<WaitOutcome> {
    if (this.hasPendingTurn(session)) return Promise.resolve("passed");
    this.settle(session, "released");
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.settle(session, "timeout"), timeoutMs);
      this.waiters.set(session, (outcome) => {
        clearTimeout(timer);
        resolve(outcome);
      });
      this.announcePresence();
    });
  }

  /** Gives up a wait whose caller went away. */
  abandon(session: string): void {
    this.settle(session, "released");
  }

  private settle(session: string, outcome: WaitOutcome): void {
    const waiter = this.waiters.get(session);
    if (!waiter) return;
    this.waiters.delete(session);
    waiter(outcome);
    this.announcePresence();
  }

  private settleAll(outcome: WaitOutcome): void {
    for (const session of [...this.waiters.keys()]) this.settle(session, outcome);
  }

  /** How many agent sessions are blocked waiting for the human right now. */
  get listening(): number {
    return this.waiters.size;
  }

  onPresence(listener: (listening: number) => void): () => void {
    this.presenceListeners.add(listener);
    return () => this.presenceListeners.delete(listener);
  }

  private announcePresence(): void {
    for (const listener of this.presenceListeners) listener(this.listening);
  }
}
