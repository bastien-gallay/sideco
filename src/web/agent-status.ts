/**
 * What Claude is doing and when it will read the human's changes, in words: pure
 * functions of the session, so the wording is tested like any other rule.
 */

import { DEFAULT_LOCALE, type Locale } from "../domain/i18n.ts";
import type { AgentStatus, Session } from "../domain/sessions.ts";
import { MESSAGES, type Messages } from "./messages.ts";

export type Tone = "off" | "idle" | "busy" | "waiting" | "listening";

/** What Claude is doing, in words; the title is what the words leave out. */
export interface Status {
  tone: Tone;
  text: string;
  title?: string;
}

/** What Claude Code says when it waits: read, so the page says it in its own language. */
const NEEDS_PERMISSION = /^Claude needs your permission to use (.+)$/;
const WAITS_FOR_INPUT = "Claude is waiting for your input";

/** A reason the page knows goes in the sentence; any other stays whole in the tooltip, as Claude Code wrote it. */
function waitingStatus(why: string | undefined, m: Messages): Status {
  const tool = why?.match(NEEDS_PERMISSION)?.[1];
  const said = tool !== undefined || !why || why === WAITS_FOR_INPUT;
  return { tone: "waiting", text: m.waitingInTerminal(tool), ...(said ? {} : { title: why }) };
}

export function agentStatus(
  session: Session | undefined,
  listening: number,
  locale: Locale = DEFAULT_LOCALE,
): Status {
  const m = MESSAGES[locale];
  if (listening > 0) return { tone: "listening", text: m.listening };
  if (!session) return { tone: "off", text: m.noSession };
  switch (session.status) {
    case "ended":
      return { tone: "off", text: m.noSession };
    case "idle":
      return { tone: "idle", text: m.idle };
    case "thinking":
      return { tone: "busy", text: m.thinking };
    case "running":
      return { tone: "busy", text: m.running(session.statusDetail) };
    case "waiting":
      return waitingStatus(session.statusDetail, m);
  }
}

/** The status the header shows. A save still waiting says so first: the human's words are on their way, not lost. */
export function shownStatus(
  status: Status,
  link: { connected: boolean; saving: boolean },
  locale: Locale = DEFAULT_LOCALE,
): Status {
  if (!link.connected) return { tone: "off", text: MESSAGES[locale].disconnected };
  return link.saving ? { tone: status.tone, text: MESSAGES[locale].saving } : status;
}

/** The honest answer to "when will Claude see what I just did?". */
export function handOverHint(
  status: AgentStatus | undefined,
  listening: number,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const m = MESSAGES[locale];
  if (listening > 0) return m.hintListening;
  if (status === undefined || status === "ended") return m.hintNoSession;
  if (status === "running" || status === "thinking") return m.hintWorking;
  return m.hintIdle;
}
/**
 * What the page says right after a hand-over that Claude will not read at once:
 * the page cannot wake a terminal at rest, so it says what will.
 */
export function handOverNotice(
  status: AgentStatus | undefined,
  listening: number,
  locale: Locale = DEFAULT_LOCALE,
): string | undefined {
  const m = MESSAGES[locale];
  if (listening > 0) return undefined;
  if (status === undefined || status === "ended") return m.handedOverNoSession;
  if (status === "running" || status === "thinking") return m.handedOverWorking;
  return m.handedOverIdle;
}
