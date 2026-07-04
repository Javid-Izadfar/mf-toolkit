import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export interface ResolvedVersions {
  /** Versions from package.json dependencies + devDependencies */
  declared: Record<string, string>;
  /**
   * Versions from node_modules/<pkg>/package.json.
   * Empty object when node_modules is not accessible —
   * mismatch checks are skipped for packages absent from this map.
   */
  installed: Record<string, string>;
}

/**
 * Reads declared and installed versions for all packages listed in package.json.
 */
export async function resolveVersions(packageJsonPath: string): Promise<ResolvedVersions> {
  const declared = await readDeclaredVersions(packageJsonPath);
  const installed = await readInstalledVersions(packageJsonPath, Object.keys(declared));
  return { declared, installed };
}

// ─── Internals ────────────────────────────────────────────────────────────────

async function readDeclaredVersions(packageJsonPath: string): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await readFile(packageJsonPath, 'utf-8');
  } catch {
    return {};
  }

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }

  const deps = (pkg['dependencies'] ?? {}) as Record<string, string>;
  const devDeps = (pkg['devDependencies'] ?? {}) as Record<string, string>;

  return { ...deps, ...devDeps };
}

async function readInstalledVersions(
  packageJsonPath: string,
  packages: string[],
): Promise<Record<string, string>> {
  const startDir = dirname(packageJsonPath);
  const installed: Record<string, string> = {};

  await Promise.all(
    packages.map(async (pkg) => {
      const version = await findInstalledVersion(startDir, pkg);
      if (version !== undefined) {
        installed[pkg] = version;
      }
    }),
  );

  return installed;
}

/**
 * Walks up the node_modules chain from `startDir` to the filesystem root,
 * mirroring Node's module resolution. Returns the version of the nearest
 * install — which is the one the bundler would actually resolve.
 *
 * This is what makes version checks work in hoisting package managers
 * (npm/yarn workspaces), where a sub-package's deps live in the
 * workspace-root node_modules rather than the sub-package's own.
 */
async function findInstalledVersion(
  startDir: string,
  pkg: string,
): Promise<string | undefined> {
  let dir = startDir;

  for (;;) {
    const pkgJsonPath = join(dir, 'node_modules', pkg, 'package.json');
    try {
      const raw = await readFile(pkgJsonPath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      // Nearest install wins, even if its package.json lacks a version.
      return typeof parsed['version'] === 'string' ? parsed['version'] : undefined;
    } catch {
      // Not installed at this level — walk up one directory.
    }

    const parent = dirname(dir);
    if (parent === dir) return undefined; // reached filesystem root
    dir = parent;
  }
}
