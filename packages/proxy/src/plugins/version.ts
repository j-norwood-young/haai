import type { plugins as pluginsTable } from "@haai/core";

type PluginRow = typeof pluginsTable.$inferSelect;

const SEMVER = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

interface ParsedVersion {
  core: [number, number, number];
  pre: string[];
}

function parseVersion(v: string): ParsedVersion | null {
  const m = SEMVER.exec(v.trim());
  if (!m) return null;
  return {
    core: [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)],
    pre: m[4] ? m[4].split(".") : [],
  };
}

/**
 * Compare two semver-style versions (`1.2.3`, `v1.2`, `1.0.0-beta.1`).
 * Returns a negative, zero or positive number, or null when either side isn't parseable.
 */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;

  for (let i = 0; i < 3; i++) {
    const diff = pa.core[i]! - pb.core[i]!;
    if (diff !== 0) return diff;
  }

  // A version with a prerelease tag sorts before the same version without one
  if (pa.pre.length === 0 || pb.pre.length === 0) return pb.pre.length - pa.pre.length;

  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) return Number(x) - Number(y);
    if (xNum) return -1;
    if (yNum) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/** Plugin names are unique regardless of case or surrounding whitespace */
export function samePluginName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export type InstallConflict =
  | { kind: "none" }
  /** A plugin with this name exists and the incoming one isn't a newer version of it */
  | { kind: "name_taken"; existing: PluginRow }
  /** A plugin with this name exists and the incoming one is strictly newer */
  | { kind: "upgrade"; existing: PluginRow };

/**
 * Decide what installing a plugin called `name` at `version` means given what's already installed.
 * The name is the identity: the same name may only be reused to upgrade to a newer version.
 */
export function checkInstallConflict(
  installed: PluginRow[],
  name: string,
  version: string | null,
): InstallConflict {
  const existing = installed.find((p) => samePluginName(p.name, name));
  if (!existing) return { kind: "none" };

  const cmp = version && existing.version ? compareVersions(version, existing.version) : null;
  return cmp !== null && cmp > 0 ? { kind: "upgrade", existing } : { kind: "name_taken", existing };
}
