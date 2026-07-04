/**
 * Shared low-level parser: extracts import/export specifiers from JS/TS source.
 * Used by both collect-imports (direct mode) and traverse-local-modules (local-graph).
 *
 * Adapted from packages/sprite-plugin/src/analyzer/parse-imports.ts.
 */

export type DeclarationKind = 'import' | 'reexport';

export interface Declaration {
  specifier: string;
  kind: DeclarationKind;
}

// ─── Node.js built-ins ────────────────────────────────────────────────────────

const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
  'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net',
  'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls',
  'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads',
  'zlib',
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

export function isNodeBuiltin(
  specifier: string,
  knownDependencies?: ReadonlySet<string>,
): boolean {
  // An explicit node: prefix is always a builtin, regardless of dependencies.
  if (specifier.startsWith('node:')) return true;

  const base = specifier.split('/')[0];
  if (!NODE_BUILTINS.has(base)) return false;

  // A builtin name that is also a declared dependency is a browser polyfill
  // package (e.g. `events`, `stream`, `buffer`) — treat it as a real package
  // so its duplication across MFs stays visible.
  return knownDependencies?.has(base) ? false : true;
}

/**
 * Normalizes a module specifier to its package name.
 *   lodash/get        → lodash
 *   @scope/name/deep  → @scope/name
 *   react             → react
 */
export function normalizePackageName(specifier: string): string {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.slice(0, 2).join('/');
  }
  return specifier.split('/')[0];
}

// ─── Source preprocessing ─────────────────────────────────────────────────────

/** Strips // and block comments while preserving string literals. */
function stripComments(source: string): string {
  // Use an array of chunks instead of string concatenation to avoid
  // O(N²) string allocation behaviour in tight loops over large files.
  const chunks: string[] = [];
  let i = 0;
  let segStart = i;

  const flush = (end: number) => {
    if (end > segStart) chunks.push(source.slice(segStart, end));
  };

  while (i < source.length) {
    if (source[i] === '"' || source[i] === "'" || source[i] === '`') {
      const quote = source[i];
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i++;
        if (i < source.length) i++;
      }
      if (i < source.length) i++;
    } else if (source[i] === '/' && source[i + 1] === '*') {
      flush(i);
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      chunks.push(' ');
      segStart = i;
    } else if (source[i] === '/' && source[i + 1] === '/') {
      flush(i);
      i += 2;
      while (i < source.length && source[i] !== '\n') i++;
      segStart = i;
    } else {
      i++;
    }
  }

  flush(i);
  return chunks.join('');
}

/** Collapses multiline import/export statements to single lines. */
function normalizeMultiline(source: string): string {
  // [^;{}]* is bounded by statement terminators — avoids catastrophic
  // backtracking that [\s\S]*? causes on files with many import keywords.
  return source.replace(
    /(?:import|export)\s[^;{}]*?from\s+['"][^'"]+['"]/g,
    (match) => match.replace(/\s+/g, ' '),
  );
}

// ─── Regex patterns ───────────────────────────────────────────────────────────

/**
 * Static imports — excludes:
 *   - dynamic import('pkg')  via (?!\s*\()
 *   - type-only imports      via (?!\s+type[\s{])
 */
const STATIC_IMPORT_RE =
  /\bimport(?!\s*\()(?!\s+type[\s{])\s+(?:[^'"]*?\bfrom\s+)?['"]([^'"]+)['"]/gm;

/**
 * Re-exports — matches:
 *   export { X } from 'pkg'
 *   export * from 'pkg'
 * Excludes export type { X } from 'pkg' via (?!type[\s{])
 */
const REEXPORT_RE =
  /\bexport\s+(?!type[\s{])(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/gm;

/** CommonJS require — require('pkg') */
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

/** Dynamic import with a literal string — import('pkg') */
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

/**
 * True when a static import/export statement's only bindings are inline
 * `type` specifiers, e.g. `import { type Foo, type Bar } from 'react'`.
 *
 * Such statements are erased by the TS compiler (verbatimModuleSyntax) and
 * never reach the bundle, so they must not count as a runtime use of the
 * package — otherwise the package surfaces as a false-positive share candidate.
 *
 * A default or namespace binding before the block (`import React, { type FC }`)
 * is a value import and is kept.
 */
function isTypeOnlyStatement(statement: string): boolean {
  const braceStart = statement.indexOf('{');
  if (braceStart === -1) return false;

  // Anything between `import`/`export` and `{` is a default/namespace value binding.
  const head = statement
    .slice(0, braceStart)
    .replace(/^\s*(?:import|export)\s*/, '')
    .replace(/,\s*$/, '')
    .trim();
  if (head.length > 0) return false;

  const braceEnd = statement.indexOf('}', braceStart);
  if (braceEnd === -1) return false;

  const specs = statement
    .slice(braceStart + 1, braceEnd)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (specs.length === 0) return false;

  return specs.every((s) => /^type\s+/.test(s));
}

// ─── Main parser ──────────────────────────────────────────────────────────────

/**
 * Parse all import/export declarations from JS/TS source text.
 * Returns one entry per specifier occurrence.
 */
export function parseDeclarations(fileContent: string): Declaration[] {
  const src = normalizeMultiline(stripComments(fileContent));
  const results: Declaration[] = [];

  // `typeAware` patterns carry named-binding blocks that may be inline
  // type-only; require()/import() take a bare string and never do.
  const patterns: Array<[RegExp, DeclarationKind, boolean]> = [
    [STATIC_IMPORT_RE, 'import', true],
    [REQUIRE_RE, 'import', false],
    [DYNAMIC_IMPORT_RE, 'import', false],
    [REEXPORT_RE, 'reexport', true],
  ];

  for (const [pattern, kind, typeAware] of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(src)) !== null) {
      if (typeAware && isTypeOnlyStatement(match[0])) continue;
      results.push({ specifier: match[1], kind });
    }
  }

  return results;
}
