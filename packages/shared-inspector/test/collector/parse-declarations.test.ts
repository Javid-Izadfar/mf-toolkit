import { describe, it, expect } from 'vitest';
import { parseDeclarations, isNodeBuiltin } from '../../src/collector/parse-declarations.js';

describe('parseDeclarations — inline type-only imports', () => {
  it('ignores an import whose named bindings are all inline `type`', () => {
    // Erased by the TS compiler under verbatimModuleSyntax — never reaches the bundle,
    // so it must not count as a runtime use of react.
    const decls = parseDeclarations(`import { type Foo, type Bar } from 'react';`);
    expect(decls.some((d) => d.specifier === 'react')).toBe(false);
  });

  it('keeps an import that mixes an inline-type and a value binding', () => {
    const decls = parseDeclarations(`import { type Foo, Bar } from 'react';`);
    expect(decls.some((d) => d.specifier === 'react' && d.kind === 'import')).toBe(true);
  });

  it('ignores a re-export whose named bindings are all inline `type`', () => {
    const decls = parseDeclarations(`export { type Foo } from 'react';`);
    expect(decls.some((d) => d.specifier === 'react')).toBe(false);
  });

  it('keeps a value default import even when a type binding follows', () => {
    const decls = parseDeclarations(`import React, { type FC } from 'react';`);
    expect(decls.some((d) => d.specifier === 'react' && d.kind === 'import')).toBe(true);
  });
});

describe('isNodeBuiltin — builtin name vs polyfill package', () => {
  it('treats a builtin name as a package when it is a declared dependency', () => {
    // `events`/`stream`/`buffer` are real npm polyfills in browser MF builds;
    // if declared, their duplication across MFs must stay visible.
    expect(isNodeBuiltin('events', new Set(['events']))).toBe(false);
  });

  it('treats a builtin name as builtin when it is NOT a declared dependency', () => {
    expect(isNodeBuiltin('events', new Set(['react']))).toBe(true);
  });

  it('always treats a node: prefixed specifier as builtin, even if declared', () => {
    expect(isNodeBuiltin('node:events', new Set(['events']))).toBe(true);
  });
});
