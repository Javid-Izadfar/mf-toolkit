import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTsConfigPaths } from '../../src/collector/resolve-tsconfig-paths.js';

const created: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'si-tsconfig-'));
  created.push(dir);
  return dir;
}
// Alias roots keep a trailing slash from path.join('base', 'src/'); normalize
// it away for comparison (resolveAliasedSpecifier joins onto them either way).
const noSlash = (s: string): string => s.replace(/[\\/]+$/, '');

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('loadTsConfigPaths — JSONC tolerance', () => {
  it('parses block comments, line comments, and trailing commas', () => {
    const dir = tmp();
    writeFileSync(
      join(dir, 'tsconfig.json'),
      `{
        /* editor-generated project config */
        "compilerOptions": {
          "baseUrl": ".",
          "paths": {
            "@app/*": ["src/*"], // application sources
          },
        },
      }`,
    );
    const result = loadTsConfigPaths(join(dir, 'tsconfig.json'));
    expect(result).not.toBeNull();
    expect(result!.aliases.map((a) => a.pattern)).toContain('@app/');
    expect(noSlash(result!.aliases[0].roots[0])).toBe(join(dir, 'src'));
  });

  it('returns null for a missing tsconfig', () => {
    expect(loadTsConfigPaths('/no/such/tsconfig.json')).toBeNull();
  });
});

describe('loadTsConfigPaths — extends chains', () => {
  it('resolves paths defined in an extended base config (standard monorepo layout)', () => {
    const dir = tmp();
    writeFileSync(
      join(dir, 'tsconfig.base.json'),
      JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@shared/*': ['libs/shared/*'] } },
      }),
    );
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({ extends: './tsconfig.base.json', compilerOptions: { strict: true } }),
    );
    const result = loadTsConfigPaths(join(dir, 'tsconfig.json'));
    expect(result).not.toBeNull();
    expect(result!.aliases.map((a) => a.pattern)).toContain('@shared/');
    expect(noSlash(result!.aliases[0].roots[0])).toBe(join(dir, 'libs/shared'));
  });

  it('child paths override the base paths', () => {
    const dir = tmp();
    writeFileSync(
      join(dir, 'base.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@x/*': ['base/*'] } } }),
    );
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({ extends: './base.json', compilerOptions: { paths: { '@x/*': ['child/*'] } } }),
    );
    const result = loadTsConfigPaths(join(dir, 'tsconfig.json'));
    expect(noSlash(result!.aliases[0].roots[0])).toBe(join(dir, 'child'));
  });

  it('does not crash on a circular extends chain', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ extends: './b.json' }));
    writeFileSync(
      join(dir, 'b.json'),
      JSON.stringify({ extends: './a.json', compilerOptions: { baseUrl: '.', paths: { '@c/*': ['c/*'] } } }),
    );
    const result = loadTsConfigPaths(join(dir, 'a.json'));
    expect(result).not.toBeNull();
    expect(result!.aliases.map((a) => a.pattern)).toContain('@c/');
  });
});
