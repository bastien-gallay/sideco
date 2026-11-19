/**
 * The page, built once at start-up into a single HTML document: markup, styles
 * and script inline, so the companion is one request and works offline.
 *
 * Every language travels with it; `locale` is only the one it opens in, until
 * the reader picks another.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_LOCALE, type Locale } from "../domain/i18n.ts";

const WEB = join(import.meta.dir, "..", "web");

export interface Page {
  html: string;
  /**
   * The fingerprint of the document, which carries it too: a tab that runs one
   * build and hears the companion serve another knows it is out of date.
   */
  build: string;
  /** The shared worker that holds the page's only event stream, whatever the number of tabs. */
  worker: string;
}

/** Where the document says which build it is; empty in the source, and while it is fingerprinted. */
const signature = (build: string): string => `<meta name="sideco-build" content="${build}">`;

/** The build of a document and its worker: either one changed, the tabs must fetch them again. */
export function fingerprint(unsigned: string, worker: string): string {
  return new Bun.CryptoHasher("sha256").update(unsigned).update(worker).digest("hex").slice(0, 16);
}

async function bundle(entry: string): Promise<string> {
  const built = await Bun.build({ entrypoints: [join(WEB, entry)], target: "browser", minify: true });
  if (!built.success) throw new Error(`${entry} did not build:\n${built.logs.join("\n")}`);
  const script = await built.outputs[0]?.text();
  if (script === undefined) throw new Error(`${entry} built to nothing`);
  return script;
}

export async function buildPage(locale: Locale = DEFAULT_LOCALE): Promise<Page> {
  const [script, worker] = await Promise.all([bundle("main.ts"), bundle("stream-worker.ts")]);
  const styles = readFileSync(join(WEB, "styles.css"), "utf8");
  const unsigned = readFileSync(join(WEB, "index.html"), "utf8")
    .replace('<html lang="en">', () => `<html lang="${locale}">`)
    .replace("/*__STYLES__*/", () => styles)
    .replace("/*__SCRIPT__*/", () => script.replace(/<\/script/gi, "<\\/script"));
  const build = fingerprint(unsigned, worker);
  return { html: unsigned.replace(signature(""), () => signature(build)), build, worker };
}
