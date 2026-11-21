/**
 * The layers of src/ and what each may import: the dependency rule of
 * docs/coding-standards.md, written as data so that a test can hold the code to it.
 */
import { dirname, normalize } from "node:path/posix";

type Layer = "domain" | "server" | "cli" | "web";

interface Reach {
  /** The layers its imports may land in. */
  layers: readonly Layer[];
  /** Whether it may import the platform: `node:`, `bun:` or a package. */
  platform: boolean;
  /** The one module through which it may enter another layer, where it may not go further in. */
  through?: Partial<Record<Layer, string>>;
}

const REACH: Record<Layer, Reach> = {
  domain: { layers: ["domain"], platform: false },
  web: { layers: ["domain", "web"], platform: false },
  server: { layers: ["domain", "server"], platform: true },
  // The command line starts the server: it is where the parts are put together,
  // through the server's entry point only.
  cli: { layers: ["domain", "server", "cli"], platform: true, through: { server: "src/server/start.ts" } },
};

const NAMES: Record<Layer | "platform", string> = {
  domain: "the domain",
  web: "the page",
  server: "the server",
  cli: "the command line",
  platform: "the platform",
};

/** `import … from "x"` and `export … from "x"`, over several lines; `import "x"`; `import("x")`. */
const IMPORTS = [
  /(?:^|\n)\s*(?:import|export)\b[^;"'`]*?\bfrom\s*["']([^"']+)["']/g,
  /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
  /\bimport\(\s*["']([^"']+)["']\s*\)/g,
];

const isLayer = (word: string | undefined): word is Layer => word !== undefined && word in REACH;

function layerOf(path: string): Layer | undefined {
  const [root, layer] = path.split("/");
  return root === "src" && isLayer(layer) ? layer : undefined;
}

function specifiers(source: string): string[] {
  return IMPORTS.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1] ?? ""));
}

/** Where an import from `path` lands: a layer of src/, or the platform. */
function target(path: string, specifier: string): Layer | "platform" | undefined {
  if (!specifier.startsWith(".")) return "platform";
  return layerOf(resolved(path, specifier));
}

const resolved = (path: string, specifier: string): string => normalize(`${dirname(path)}/${specifier}`);

/** Why an import into a layer it may reach still breaks the rule: it goes past that layer's entry point. */
function pastEntry(layer: Layer, path: string, specifier: string, lands: Layer): string[] {
  const entry = REACH[layer].through?.[lands];
  if (entry === undefined || resolved(path, specifier) === entry) return [];
  return [`${path} imports ${specifier}: ${NAMES[layer]} may reach ${NAMES[lands]} only through ${entry}`];
}

/** The imports of the module at `path`, relative to the root, that break the rule: one sentence each. */
export function breaches(path: string, source: string): string[] {
  const layer = layerOf(path);
  if (!layer) return [];
  return specifiers(source).flatMap((specifier) => {
    const lands = target(path, specifier);
    if (!lands) return [];
    const { layers, platform } = REACH[layer];
    const allowed = lands === "platform" ? platform : layers.includes(lands);
    if (!allowed) return [`${path} imports ${specifier}: ${NAMES[layer]} may not reach ${NAMES[lands]}`];
    return lands === "platform" ? [] : pastEntry(layer, path, specifier, lands);
  });
}
