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
}

/** Where the document says which build it is; empty in the source, and while it is fingerprinted. */
const signature = (build: string): string => `<meta name="vico-build" content="${build}">`;

export async function buildPage(locale: Locale = DEFAULT_LOCALE): Promise<Page> {
  const built = await Bun.build({ entrypoints: [join(WEB, "main.ts")], target: "browser", minify: true });
  if (!built.success) throw new Error(`the page did not build:\n${built.logs.join("\n")}`);
  const script = await built.outputs[0]?.text();
  if (script === undefined) throw new Error("the page build produced no script");
  const styles = readFileSync(join(WEB, "styles.css"), "utf8");
  const unsigned = readFileSync(join(WEB, "index.html"), "utf8")
    .replace('<html lang="en">', () => `<html lang="${locale}">`)
    .replace("/*__STYLES__*/", () => styles)
    .replace("/*__SCRIPT__*/", () => script.replace(/<\/script/gi, "<\\/script"));
  const build = new Bun.CryptoHasher("sha256").update(unsigned).digest("hex").slice(0, 16);
  return { html: unsigned.replace(signature(""), () => signature(build)), build };
}
