/**
 * What Claude is doing and when it will read the human's changes, in words: pure
 * functions of the session, so the wording is tested like any other rule.
 */

import { DEFAULT_LOCALE, type Locale } from "../domain/i18n.ts";
import type { AgentStatus, Session } from "../domain/sessions.ts";
import { MESSAGES } from "./messages.ts";

export type Tone = "off" | "idle" | "busy" | "waiting" | "listening";

export function agentStatus(
  session: Session | undefined,
  listening: number,
  locale: Locale = DEFAULT_LOCALE,
): { tone: Tone; text: string } {
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
      return { tone: "waiting", text: m.waitingInTerminal(session.statusDetail ?? "") };
  }
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
