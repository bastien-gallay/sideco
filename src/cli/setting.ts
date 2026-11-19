/**
 * An environment variable; set but empty counts as not set. When `SIDECO_X`
 * is absent, the `VICO_X` that hooks installed before the rename still export
 * stands in for it.
 */
export function readSetting(name: string, env: Record<string, string | undefined>): string | undefined {
  const value = name in env ? env[name] : env[name.replace(/^SIDECO_/, "VICO_")];
  return value || undefined;
}
