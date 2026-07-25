import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

/**
 * Resolved tsconfig path aliases.
 * Each alias pattern maps to one or more local directory roots.
 *
 * Example tsconfig.json:
 *   { "compilerOptions": { "baseUrl": ".", "paths": { "@app/*": ["src/*"] } } }
 *
 * Produces:
 *   { aliases: [{ pattern: '@app/', roots: ['/project/src/'] }] }
 */
export interface ResolvedTsConfigPaths {
  /** Absolute base directory (compilerOptions.baseUrl resolved against tsconfig location) */
  baseDir: string;
  aliases: Array<{
    /** The alias prefix without the trailing '*', e.g. '@app/' */
    pattern: string;
    /** Resolved absolute directory roots (trailing '*' stripped from each mapping) */
    roots: string[];
  }>;
}

// ─── JSONC + extends resolution ───────────────────────────────────────────────

/** Strip comments and trailing commas so JSON.parse accepts a tsconfig (JSONC). */
function stripJsonc(input: string): string {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, '')       // block comments
    .replace(/(^|[^:"'])\/\/[^\n]*/g, '$1')  // line comments (keep http:// in strings)
    .replace(/,(\s*[}\]])/g, '$1');          // trailing commas
}

interface RawTsConfig {
  extends?: string | string[];
  compilerOptions?: { baseUrl?: unknown; paths?: unknown };
}

function readRawTsConfig(path: string): RawTsConfig | null {
  if (!existsSync(path)) return null;
  let raw: string;
  try { raw = readFileSync(path, 'utf-8'); } catch { return null; }
  try { return JSON.parse(stripJsonc(raw)) as RawTsConfig; } catch { return null; }
}

/** Resolve an `extends` specifier to a concrete tsconfig file path, or null. */
function resolveExtends(spec: string, fromDir: string): string | null {
  const base = spec.startsWith('.')
    ? resolve(fromDir, spec)
    : join(fromDir, 'node_modules', spec); // bare specifier → node_modules (best effort)
  const candidates = [base, `${base}.json`, join(base, 'tsconfig.json')];
  return candidates.find((c) => c.endsWith('.json') && existsSync(c)) ?? null;
}

interface EffectiveConfig {
  baseUrl?: string;
  baseUrlDir?: string; // dir of the tsconfig that set baseUrl
  paths?: Record<string, string[]>;
  pathsDir?: string;   // dir of the tsconfig that set paths
}

/** Walk the `extends` chain (parents first) and merge with child-wins semantics. */
function collectEffective(tsconfigPath: string, seen: Set<string>): EffectiveConfig {
  const abs = resolve(tsconfigPath);
  if (seen.has(abs)) return {}; // cycle guard
  seen.add(abs);

  const config = readRawTsConfig(abs);
  if (!config) return {};
  const dir = dirname(abs);

  let eff: EffectiveConfig = {};

  const ext = config.extends;
  const parents = Array.isArray(ext) ? ext : ext ? [ext] : [];
  for (const parent of parents) {
    const parentPath = resolveExtends(parent, dir);
    if (parentPath) eff = { ...eff, ...collectEffective(parentPath, seen) };
  }

  // This file overrides its parents.
  const co = config.compilerOptions;
  if (co && typeof co.baseUrl === 'string') { eff.baseUrl = co.baseUrl; eff.baseUrlDir = dir; }
  if (co && co.paths && typeof co.paths === 'object') {
    eff.paths = co.paths as Record<string, string[]>;
    eff.pathsDir = dir;
  }
  return eff;
}

/**
 * Loads tsconfig.json and extracts path alias mappings. Supports JSONC
 * (block/line comments, trailing commas) and `extends` chains (relative and
 * best-effort node_modules), so monorepo tsconfigs that keep `paths` in a shared
 * base config resolve correctly. Returns null when tsconfig is absent,
 * unreadable, or defines no usable wildcard aliases.
 *
 * Only handles the common `"alias/*": ["dir/*"]` wildcard pattern.
 * Exact aliases (no wildcard) are not currently supported.
 */
export function loadTsConfigPaths(tsconfigPath: string): ResolvedTsConfigPaths | null {
  const eff = collectEffective(tsconfigPath, new Set());
  if (!eff.paths) return null;

  const fallbackDir = dirname(resolve(tsconfigPath));
  // baseUrl resolves against the file that set it; path roots resolve against
  // baseUrl when present, otherwise against the file that set `paths`.
  const baseDir = eff.baseUrl
    ? resolve(eff.baseUrlDir ?? fallbackDir, eff.baseUrl)
    : (eff.pathsDir ?? fallbackDir);

  const aliases: ResolvedTsConfigPaths['aliases'] = [];

  for (const [aliasPattern, mappings] of Object.entries(eff.paths)) {
    // Only handle wildcard aliases: "@alias/*" → ["dir/*"]
    if (!aliasPattern.endsWith('/*')) continue;
    if (!Array.isArray(mappings) || mappings.length === 0) continue;

    const prefix = aliasPattern.slice(0, -1); // "@alias/" (remove trailing *)
    const roots = mappings
      .filter((m): m is string => typeof m === 'string' && m.endsWith('/*'))
      .map((m) => join(baseDir, m.slice(0, -1))); // resolve to absolute, remove trailing *

    if (roots.length > 0) {
      aliases.push({ pattern: prefix, roots });
    }
  }

  if (aliases.length === 0) return null;

  return { baseDir, aliases };
}

/**
 * Resolves a TypeScript path alias specifier to an absolute file path.
 * Returns null when the specifier does not match any alias or the file
 * cannot be found on disk.
 *
 * @param specifier  - e.g. '@app/components/Button'
 * @param paths      - result of loadTsConfigPaths
 * @param contentMap - pre-read file map; used for O(1) existence checks
 */
export function resolveAliasedSpecifier(
  specifier: string,
  paths: ResolvedTsConfigPaths,
  contentMap: Map<string, string>,
): string | null {
  for (const alias of paths.aliases) {
    if (!specifier.startsWith(alias.pattern)) continue;

    const rest = specifier.slice(alias.pattern.length); // 'components/Button'

    for (const root of alias.roots) {
      const base = join(root, rest); // '/project/src/components/Button'

      // Try direct extensions, then index files
      for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
        const candidate = base + ext;
        if (contentMap.has(candidate)) return candidate;
      }
      for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
        const candidate = join(base, 'index' + ext);
        if (contentMap.has(candidate)) return candidate;
      }
    }
  }

  return null;
}
