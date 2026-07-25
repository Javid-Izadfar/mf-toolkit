import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import type { PackageOccurrence } from '../types.js';
import {
  parseDeclarations,
  isRelativeSpecifier,
  isNodeBuiltin,
  normalizePackageName,
} from './parse-declarations.js';

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const IGNORED_DIRS = ['node_modules', '.git', 'dist', 'build', 'coverage'];

// ─── File scanner ─────────────────────────────────────────────────────────────

export async function scanFiles(dirs: string[], extensions: string[]): Promise<string[]> {
  const files: string[] = [];

  for (const dir of dirs) {
    try {
      const entries = await readdir(dir, { recursive: true });
      for (const entry of entries) {
        if (typeof entry !== 'string') continue;
        if (!extensions.includes(extname(entry))) continue;
        // Split on both separators — recursive readdir returns backslash paths
        // on Windows, so splitting on '/' alone would never match nested
        // node_modules/dist/build segments there.
        if (entry.split(/[\\/]/).some((seg) => IGNORED_DIRS.includes(seg))) continue;
        files.push(join(dir, entry));
      }
    } catch {
      // Directory does not exist — skip silently
    }
  }

  return files;
}

// ─── Collector options ────────────────────────────────────────────────────────

export interface CollectImportsOptions {
  sourceDirs: string[];
  extensions?: string[];
  ignore?: string[];
  workspacePackages?: string[];
  /**
   * Declared dependency names (package.json). A builtin-named entry that is
   * also declared is treated as a browser polyfill package, not a node builtin.
   */
  knownDependencies?: string[];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Direct mode collector.
 *
 * Scans all source files and extracts explicitly imported package names.
 * Counts only `import` and `require` declarations — re-exports are NOT counted
 * (they are the domain of traverse-local-modules in local-graph mode).
 */
export async function collectImports(
  options: CollectImportsOptions,
): Promise<PackageOccurrence[]> {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const files = await scanFiles(options.sourceDirs, extensions);
  const knownDeps = new Set(options.knownDependencies ?? []);

  /** (package, file) → Set of distinct specifiers observed for that pair */
  const occurrences = new Map<string, { package: string; file: string; specifiers: Set<string> }>();

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, 'utf-8');
    } catch {
      continue;
    }

    const declarations = parseDeclarations(content);

    for (const decl of declarations) {
      // Direct mode: only explicit imports, no re-exports
      if (decl.kind !== 'import') continue;

      const { specifier } = decl;
      if (isRelativeSpecifier(specifier)) continue;
      if (isNodeBuiltin(specifier, knownDeps)) continue;

      const pkg = normalizePackageName(specifier);

      if (options.ignore?.some((pattern) => matchesIgnorePattern(pkg, pattern))) continue;
      if (options.workspacePackages?.some((pattern) => matchesIgnorePattern(pkg, pattern))) continue;

      const key = `${pkg} ${file}`;
      let entry = occurrences.get(key);
      if (!entry) {
        entry = { package: pkg, file, specifiers: new Set() };
        occurrences.set(key, entry);
      }
      entry.specifiers.add(specifier);
    }
  }

  // Emit one PackageOccurrence per distinct (package, file, specifier) triple,
  // so callers can detect deep-import bypass (specifier !== package).
  const out: PackageOccurrence[] = [];
  for (const { package: pkg, file, specifiers } of occurrences.values()) {
    for (const specifier of specifiers) {
      out.push({ package: pkg, specifier, file, via: 'direct' });
    }
  }
  return out;
}

// ─── Ignore pattern matching ──────────────────────────────────────────────────

/** Supports exact match and simple glob: '@company/*' */
function matchesIgnorePattern(pkg: string, pattern: string): boolean {
  if (pattern.endsWith('/*')) {
    const scope = pattern.slice(0, -2);
    return pkg.startsWith(scope + '/');
  }
  return pkg === pattern;
}
