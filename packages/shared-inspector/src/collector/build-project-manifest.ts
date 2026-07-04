import { resolve, dirname } from 'node:path';
import type { CollectorOptions, ProjectManifest, PackageOccurrence } from '../types.js';
import { collectImports, scanFiles } from './collect-imports.js';
import { traverseLocalModules } from './traverse-local-modules.js';
import { parseSharedConfig } from './parse-shared-config.js';
import { resolveVersions } from './resolve-versions.js';

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/**
 * Phase 1 of the two-phase pipeline: collect observable dependency facts
 * and assemble them into a self-contained ProjectManifest.
 *
 * The manifest captures facts at the chosen depth; it does not make
 * any policy decisions — that is the analyzer's job.
 */
export async function buildProjectManifest(
  options: CollectorOptions,
): Promise<ProjectManifest> {
  const {
    name,
    sourceDirs,
    depth = 'local-graph',
    sharedConfig,
    kind = 'unknown',
    packageJsonPath = './package.json',
    extensions = DEFAULT_EXTENSIONS,
    ignore,
    tsconfigPath,
    workspacePackages,
  } = options;

  const resolvedPkgJsonPath = resolve(packageJsonPath);
  const root = dirname(resolvedPkgJsonPath);

  // ── Step 1: scan files (for filesScanned count) ───────────────────────────
  const allFiles = await scanFiles(sourceDirs, extensions);

  // ── Step 2: resolve versions ──────────────────────────────────────────────
  // Done before collection so declared names can disambiguate a node builtin
  // from a same-named polyfill package (e.g. `events`, `stream`, `buffer`).
  const versions = await resolveVersions(resolvedPkgJsonPath);
  const knownDependencies = Object.keys(versions.declared);

  // ── Step 3: collect package occurrences ───────────────────────────────────
  let occurrences: PackageOccurrence[];
  let effectiveDepth: 'direct' | 'local-graph';

  if (depth === 'local-graph') {
    occurrences = await traverseLocalModules({ sourceDirs, extensions, ignore, tsconfigPath, workspacePackages, knownDependencies });
    effectiveDepth = 'local-graph';
  } else {
    occurrences = await collectImports({ sourceDirs, extensions, ignore, workspacePackages, knownDependencies });
    effectiveDepth = 'direct';
  }

  // ── Step 3: aggregate occurrences into packageDetails ────────────────────
  const byPackage = new Map<
    string,
    {
      files: Set<string>;
      via: 'direct' | 'reexport';
      deepImports: Set<string>;
      deepImportFiles: Set<string>;
    }
  >();
  for (const occ of occurrences) {
    let entry = byPackage.get(occ.package);
    if (!entry) {
      entry = { files: new Set(), via: occ.via, deepImports: new Set(), deepImportFiles: new Set() };
      byPackage.set(occ.package, entry);
    }
    entry.files.add(occ.file);
    // Direct import takes precedence over reexport at the manifest level too
    if (occ.via === 'direct') entry.via = 'direct';
    if (occ.specifier !== occ.package) {
      entry.deepImports.add(occ.specifier);
      entry.deepImportFiles.add(occ.file);
    }
  }

  const packageDetails = Array.from(byPackage.entries()).map(
    ([pkg, { files, via, deepImports, deepImportFiles }]) => ({
      package: pkg,
      importCount: files.size,
      files: [...files].sort(),
      via,
      deepImports: [...deepImports].sort(),
      deepImportFiles: [...deepImportFiles].sort(),
    }),
  );

  const directPackages = packageDetails
    .filter((d) => d.via === 'direct')
    .map((d) => d.package);

  // resolvedPackages = all observed packages (direct + reexport)
  const resolvedPackages = packageDetails.map((d) => d.package);

  // ── Step 4: parse shared config ───────────────────────────────────────────
  const sharedDeclared = parseSharedConfig(sharedConfig);

  // ── Assemble manifest ─────────────────────────────────────────────────────
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),

    project: { name, root, kind },

    source: {
      depth: effectiveDepth,
      sourceDirs,
      filesScanned: allFiles.length,
    },

    usage: {
      directPackages,
      resolvedPackages,
      packageDetails,
    },

    shared: {
      declared: sharedDeclared,
      source: 'explicit',
    },

    versions,
  };
}
