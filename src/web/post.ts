/**
 * One post of the human's commands, and what came of it. It always ends: a
 * companion that does not answer in time is a failure like any other, so that
 * what was typed can go back to the human instead of waiting forever.
 */

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export type Posted =
  | { ok: true; minted: (string | null)[] }
  | { ok: false; reason: "refused" | "unreachable"; error: string }
  | { ok: false; reason: "timeout" };

export interface PostOptions {
  fetch: Fetch;
  /** How long the companion has to answer before the post is given up. */
  timeoutMs: number;
  /** How long before an answer counts as slow, worth saying that the page is still saving. */
  slowMs?: number;
  onSlow?: () => void;
}

export async function postCommands(body: string, options: PostOptions): Promise<Posted> {
  const abandon = new AbortController();
  const timeout = setTimeout(() => abandon.abort(), options.timeoutMs);
  const slow = options.onSlow && setTimeout(options.onSlow, options.slowMs ?? 0);
  try {
    const response = await options.fetch("api/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: abandon.signal,
    });
    const answer = (await response.json().catch(() => ({}))) as {
      error?: string;
      minted?: (string | null)[];
    };
    if (!response.ok)
      return { ok: false, reason: "refused", error: answer.error ?? `HTTP ${response.status}` };
    return { ok: true, minted: answer.minted ?? [] };
  } catch (error) {
    if (abandon.signal.aborted) return { ok: false, reason: "timeout" };
    return {
      ok: false,
      reason: "unreachable",
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
    clearTimeout(slow);
  }
}
