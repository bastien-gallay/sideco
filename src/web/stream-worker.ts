/**
 * The shared worker every tab of the page connects to: it holds the only event
 * stream (see `relay.ts`) and hands each tab its frames through a message port.
 */
import { eventSource, Relay, type Request } from "./relay.ts";

/** The part of a shared worker's global scope used here; the DOM types do not describe it. */
interface SharedScope {
  onconnect: ((event: MessageEvent) => void) | null;
}

const relay = new Relay(eventSource("/api/events"));

(self as unknown as SharedScope).onconnect = (connection) => {
  const port = connection.ports[0];
  if (!port) return;
  const listener = { post: (frame: unknown) => port.postMessage(frame) };
  port.onmessage = (message: MessageEvent<Request>) => {
    if (message.data.kind === "leave") relay.leave(listener);
    else relay.join(listener);
  };
  relay.join(listener);
};
