import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveVersions } from '../../src/collector/resolve-versions.js';

const FIXTURES = join(import.meta.dirname, '../fixtures');

function tmpPackageJson(pkg: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'si-versions-'));
  const path = join(dir, 'package.json');
  writeFileSync(path, JSON.stringify(pkg));
  return path;
}

describe('resolveVersions — declared versions', () => {
  it('reads dependencies from package.json', async () => {
    const { declared } = await resolveVersions(
      join(FIXTURES, 'resolve-versions/package.json'),
    );

    expect(declared['react']).toBe('^19.0.0');
    expect(declared['mobx']).toBe('^6.12.0');
  });

  it('merges devDependencies into declared', async () => {
    const { declared } = await resolveVersions(
      join(FIXTURES, 'resolve-versions/package.json'),
    );

    expect(declared['typescript']).toBe('^5.0.0');
  });

  it('returns empty declared when package.json does not exist', async () => {
    const { declared } = await resolveVersions('/nonexistent/package.json');
    expect(declared).toEqual({});
  });

  it('includes all declared packages as keys', async () => {
    const { declared } = await resolveVersions(
      join(FIXTURES, 'resolve-versions/package.json'),
    );

    expect(Object.keys(declared)).toContain('react');
    expect(Object.keys(declared)).toContain('react-dom');
    expect(Object.keys(declared)).toContain('mobx');
    expect(Object.keys(declared)).toContain('typescript');
  });

  it('includes peerDependencies and optionalDependencies in declared', async () => {
    // Library-style remotes declare react as a peer only — it must still be
    // read so its installed version is looked up and mismatch can be detected.
    const path = tmpPackageJson({
      dependencies: { axios: '^1.0.0' },
      peerDependencies: { react: '^18.0.0' },
      optionalDependencies: { fsevents: '^2.3.0' },
    });
    try {
      const { declared } = await resolveVersions(path);
      expect(declared['react']).toBe('^18.0.0');   // peer
      expect(declared['fsevents']).toBe('^2.3.0'); // optional
      expect(declared['axios']).toBe('^1.0.0');    // dep
    } finally {
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });

  it('a dependencies range wins over a peerDependencies range for the same package', async () => {
    const path = tmpPackageJson({
      peerDependencies: { react: '^17.0.0' },
      dependencies: { react: '^18.2.0' },
    });
    try {
      const { declared } = await resolveVersions(path);
      expect(declared['react']).toBe('^18.2.0');
    } finally {
      rmSync(join(path, '..'), { recursive: true, force: true });
    }
  });
});

describe('resolveVersions — installed versions', () => {
  it('reads installed version from node_modules', async () => {
    const { installed } = await resolveVersions(
      join(FIXTURES, 'resolve-versions/package.json'),
    );

    expect(installed['react']).toBe('19.1.0');
    expect(installed['mobx']).toBe('6.13.5');
  });

  it('leaves installed empty for a package not installed anywhere up the tree', async () => {
    const { installed } = await resolveVersions(
      join(FIXTURES, 'resolve-versions/package.json'),
    );

    // @mf-fixture/absent is declared but installed in no node_modules,
    // local or hoisted — a ghost name that cannot resolve up to the FS root
    expect(installed['@mf-fixture/absent']).toBeUndefined();
  });

  it('returns empty installed when nothing is installed up the tree', async () => {
    // fixture declares only a ghost package and has no node_modules of its own
    const { installed } = await resolveVersions(
      join(FIXTURES, 'resolve-versions-empty/package.json'),
    );

    expect(installed).toEqual({});
  });

  it('installed is independent from declared — no fallback', async () => {
    const { declared, installed } = await resolveVersions(
      join(FIXTURES, 'resolve-versions/package.json'),
    );

    // installed must NOT copy from declared for a package that resolves nowhere
    expect(declared['@mf-fixture/absent']).toBe('^1.0.0');
    expect(installed['@mf-fixture/absent']).toBeUndefined();
  });
});

describe('resolveVersions — hoisted monorepo installs', () => {
  const SUB_APP = 'resolve-versions-monorepo/packages/sub-app/package.json';

  it('finds a hoisted version from a parent node_modules (npm/yarn workspaces)', async () => {
    const { installed } = await resolveVersions(join(FIXTURES, SUB_APP));

    // hoisted-lib exists only in the workspace-root node_modules,
    // not in the sub-package's own node_modules
    expect(installed['hoisted-lib']).toBe('3.4.5');
  });

  it('still reads a version from the local node_modules when present', async () => {
    const { installed } = await resolveVersions(join(FIXTURES, SUB_APP));

    // local node_modules must keep winning — regression guard for the fix
    expect(installed['local-only']).toBe('1.0.0');
  });
});
