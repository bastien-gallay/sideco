/**
 * What the companion says about itself on the event stream, beside the journal.
 * The server writes it, the page reads it: one shape for both.
 */
export interface Presence {
  /** Agent sessions blocked on `vico wait` right now. */
  listening: number;
  /** This run of the companion. A page that meets another run starts over from the journal. */
  run: string;
  /** The page this run serves, by its fingerprint. A page of another build reloads to become it. */
  build: string;
}
